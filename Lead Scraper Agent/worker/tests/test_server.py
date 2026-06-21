"""
Regression guard for the §5 control loop (run_sweep) — the exact error/empty/done
classification where the Rev 5 data-loss bug lived (a failed task must mark a ZIP
`error`, NOT `empty`, or skip-empty would drop it forever).

server.py imports fastapi/httpx/dotenv (not installed in a stdlib-only test env), so we
install minimal stubs BEFORE importing it, then monkeypatch run_sweep's I/O dependencies.
No network, no DB, no real Outscraper.
"""

from __future__ import annotations

import sys
import types
import tempfile
import unittest

# ── stub heavy deps so `import server` works under stdlib-only python ──
if "httpx" not in sys.modules:
    sys.modules["httpx"] = types.ModuleType("httpx")
if "dotenv" not in sys.modules:
    _d = types.ModuleType("dotenv")
    _d.load_dotenv = lambda *a, **k: None
    sys.modules["dotenv"] = _d
if "fastapi" not in sys.modules:
    _f = types.ModuleType("fastapi")

    class _StubApp:
        def get(self, *a, **k):
            def deco(fn):
                return fn
            return deco

    _f.FastAPI = lambda *a, **k: _StubApp()
    sys.modules["fastapi"] = _f

import server  # noqa: E402
from scraper.ledger import Ledger  # noqa: E402

MA_ZIPS = [
    {"zip": "00001", "city": "Boston", "state": "MA"},
    {"zip": "00002", "city": "Boston", "state": "MA"},
    {"zip": "00003", "city": "Boston", "state": "MA"},
]

ROW = {
    "name": "Acme Hauling", "place_id": "P-acme", "full_address": "1 Main St, Boston, MA 00001",
    "city": "Boston", "state": "Massachusetts", "site": "https://acme.test",
    "rating": "4.7", "reviews": "88", "business_status": "OPERATIONAL",
}


def _async(val):
    async def _f(*a, **k):
        return val
    return _f


def make_search(rows_by_zip, per_task_error_zips=frozenset(), raise_exc=None, wrong_len=False):
    async def _search(queries, api_key, limit=400):
        if raise_exc:
            raise raise_exc
        if wrong_len:
            return []  # triggers the len(results) != len(queries) batch-error branch
        out = []
        for q in queries:
            z = q.split()[-1]  # query ends with the ZIP
            if z in per_task_error_zips:
                out.append({"data": [], "error": "task failed"})
            else:
                out.append({"data": [dict(r) for r in rows_by_zip.get(z, [])], "error": None})
        return out
    return _search


class TestRunSweep(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.ledger = Ledger(self.tmp.name)
        self.ledger.seed_from_csv("MA", MA_ZIPS)
        # redirect the module globals run_sweep reads
        self._orig = {k: getattr(server, k) for k in
                      ["LEDGER", "_get_control", "_ingest_leads", "_report_progress", "region"]}
        server.LEDGER = self.ledger
        server._get_control = _async({"active": True, "target": "MA", "startNonce": "N1"})
        server._ingest_leads = _async({"created": 1, "updated": 0, "skipped": 0, "total": 1})
        server._report_progress = _async(None)
        server.region = types.SimpleNamespace(
            expand=lambda t: ["MA"],
            zips_for_state=lambda st: list(MA_ZIPS),
        )
        self.done_calls = []

        async def _post_done(url, secret, nonce=None):
            self.done_calls.append(nonce)
        server.control = types.SimpleNamespace(post_done=_post_done)

    def tearDown(self):
        for k, v in self._orig.items():
            setattr(server, k, v)
        import os
        os.unlink(self.tmp.name)

    def _status(self, zip_code):
        with self.ledger._conn() as c:
            return c.execute("SELECT status, raw_rows, new_leads FROM zip_status WHERE zip = ?",
                             (zip_code,)).fetchone()

    async def test_done_empty_error_mix(self):
        # 00001 -> rows (done), 00002 -> no rows (empty), 00003 -> per-task error (error)
        server.outscraper_search = make_search(
            {"00001": [ROW]}, per_task_error_zips={"00003"})
        await server.run_sweep({"target": "MA", "startNonce": "N1"})
        self.assertEqual(self._status("00001")["status"], "done")
        self.assertEqual(self._status("00001")["raw_rows"], 2)   # both terms returned the row (pre-dedup)
        self.assertEqual(self._status("00001")["new_leads"], 1)  # ingest created 1
        self.assertEqual(self._status("00002")["status"], "empty")
        self.assertEqual(self._status("00003")["status"], "error")
        self.assertEqual(self.done_calls, ["N1"])  # done posted once, carrying the nonce

    async def test_search_throws_marks_all_error(self):
        server.outscraper_search = make_search({}, raise_exc=RuntimeError("boom"))
        await server.run_sweep({"target": "MA", "startNonce": "N1"})
        for z in ("00001", "00002", "00003"):
            self.assertEqual(self._status(z)["status"], "error")
        # a fully-errored sweep still "finished" (no pending) -> done fires; that's fine, errors
        # are re-queued on the next Start (sweep reset). The point: NONE were marked empty.

    async def test_length_mismatch_marks_all_error(self):
        server.outscraper_search = make_search({}, wrong_len=True)
        await server.run_sweep({"target": "MA", "startNonce": "N1"})
        for z in ("00001", "00002", "00003"):
            self.assertEqual(self._status(z)["status"], "error")

    async def test_stop_breaks_without_done(self):
        server._get_control = _async({"active": False, "target": "MA", "startNonce": "N1"})
        server.outscraper_search = make_search({"00001": [ROW]})
        await server.run_sweep({"target": "MA", "startNonce": "N1"})
        # Stop seen at the first batch-top -> no ZIP processed, no done posted
        self.assertEqual(self._status("00001")["status"], "pending")
        self.assertEqual(self.done_calls, [])

    async def test_failed_task_never_marked_empty(self):
        # The Rev 5 bug: a task that returns no rows due to FAILURE must be `error`, not `empty`.
        server.outscraper_search = make_search({}, per_task_error_zips={"00001", "00002", "00003"})
        await server.run_sweep({"target": "MA", "startNonce": "N1"})
        for z in ("00001", "00002", "00003"):
            self.assertEqual(self._status(z)["status"], "error")  # never "empty"


if __name__ == "__main__":
    unittest.main()
