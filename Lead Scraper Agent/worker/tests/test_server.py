"""
Regression guard for the control loop (run_sweep) — failed Outscraper targets
must be marked `fetch_error`, not `empty`, so they can be retried on the next
Start, while dashboard ingest failures stay in the local outbox and do not
trigger a paid refetch.

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

MA_TARGETS = [
    {"key": "MA:city:boston", "city": "Boston", "state": "MA", "targetType": "city",
     "lat": 42.36, "lng": -71.06, "population": 100000, "density": 1000.0, "zipCount": 2},
    {"key": "MA:city:cambridge", "city": "Cambridge", "state": "MA", "targetType": "city",
     "lat": 42.37, "lng": -71.10, "population": 90000, "density": 1000.0, "zipCount": 2},
    {"key": "MA:city:salem", "city": "Salem", "state": "MA", "targetType": "city",
     "lat": 42.52, "lng": -70.90, "population": 45000, "density": 500.0, "zipCount": 1},
]

ROW = {
    "name": "Acme Hauling", "place_id": "P-acme", "full_address": "1 Main St, Boston, MA 00001",
    "city": "Boston", "state": "Massachusetts", "site": "https://acme.test",
    "rating": "4.7", "reviews": "88", "business_status": "OPERATIONAL",
    "type": "Garbage collection service", "subtypes": "Junk removal service",
}


def _async(val):
    async def _f(*a, **k):
        return val
    return _f


def _city_from_query(query: str) -> str:
    return query.split(",")[1].strip()


def _term_from_query(query: str) -> str:
    return query.split(",")[0].strip()


class ProviderMock:
    def __init__(self, rows_by_city, *, error_cities=frozenset(), pending_then_error=frozenset(),
                 submit_error_cities=frozenset()):
        self.rows_by_city = rows_by_city
        self.error_cities = set(error_cities)
        self.pending_then_error = set(pending_then_error)
        self.submit_error_cities = set(submit_error_cities)
        self.submitted_queries: list[str] = []
        self.polls: dict[str, int] = {}

    async def submit(self, queries, api_key, limit=400, **kwargs):
        query = queries[0]
        city = _city_from_query(query)
        if city in self.submit_error_cities:
            raise RuntimeError("submit boom")
        term = _term_from_query(query)
        self.submitted_queries.append(query)
        request_id = f"{city}|{term}"
        return {"status": "pending", "requestId": request_id, "resultsLocation": request_id}

    async def poll(self, results_location, api_key, timeout=60.0):
        request_id = str(results_location)
        city = request_id.split("|", 1)[0]
        self.polls[request_id] = self.polls.get(request_id, 0) + 1
        if city in self.pending_then_error and self.polls[request_id] == 1:
            return {"status": "pending"}
        if city in self.error_cities or city in self.pending_then_error:
            raise RuntimeError("task failed")
        return {"status": "finished", "data": [[dict(r) for r in self.rows_by_city.get(city, [])]]}


class TestRunSweep(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.ledger = Ledger(self.tmp.name)
        # redirect the module globals run_sweep reads
        self._orig = {k: getattr(server, k) for k in [
            "LEDGER", "_get_control", "_ingest_leads", "_report_progress", "region",
            "submit_outscraper_search", "poll_outscraper_request", "cfg",
        ]}
        server.LEDGER = self.ledger
        server._get_control = _async({"active": True, "target": "MA", "startNonce": "N1"})
        server._ingest_leads = _async({"created": 1, "updated": 0, "skipped": 0, "total": 1})
        server._report_progress = _async(None)
        server.cfg = types.SimpleNamespace(
            search_terms=["junk removal", "dumpster rental"],
            expansion_search_terms=["roll off dumpster"],
            discovery_mode="city",
            batch_target_count=10,
            skip_empty=True,
            results_limit=400,
            ingest_chunk_size=50,
            enable_grid_expansion=False,
            grid_spacing_miles=10.0,
            max_grid_points_per_market=12,
            grid_min_population=100000,
            grid_min_zip_count=8,
            enable_drop_duplicates=False,
            total_limit_per_target=0,
            max_queries_per_run=0,
            max_accepted_leads_per_run=0,
            outscraper_region="US",
            outscraper_fields=None,
            outscraper_job_concurrency=4,
            outscraper_poll_interval_seconds=0,
            outscraper_job_timeout_seconds=1800,
            outscraper_loop_sleep_seconds=0.01,
            adaptive_secondary_terms=False,
            secondary_term_skip_duplicate_rate=0.80,
            secondary_term_skip_min_raw_rows=20,
        )
        server.region = types.SimpleNamespace(
            expand=lambda t: ["MA"],
            discovery_targets_for_state=lambda st, **k: list(MA_TARGETS),
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

    def _status(self, target_key):
        with self.ledger._conn() as c:
            return c.execute(
                "SELECT status, raw_rows, accepted_leads, created_leads, updated_leads "
                "FROM target_status WHERE target_key = ?",
                (target_key,),
            ).fetchone()

    def test_validation_skips_are_terminal(self):
        saved, failed = server._ingest_resolution(
            [{"name": "", "market": ""}],
            {"results": [{"index": 0, "status": "skipped", "reason": "name is required"}]},
        )
        self.assertEqual(saved, {0})
        self.assertEqual(failed, set())

    def test_provider_rows_support_combined_drop_duplicates_shape(self):
        server.cfg.enable_drop_duplicates = True
        rows = server._rows_from_provider_data([dict(ROW)])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], ROW["name"])

    async def test_done_empty_error_mix(self):
        # Boston -> rows (done), Cambridge -> no rows (empty), Salem -> per-task error (fetch_error)
        provider = ProviderMock({"Boston": [ROW]}, error_cities={"Salem"})
        server.submit_outscraper_search = provider.submit
        server.poll_outscraper_request = provider.poll
        await server.run_sweep({"target": "MA", "startNonce": "N1"})
        self.assertEqual(self._status("MA:city:boston")["status"], "done")
        self.assertEqual(self._status("MA:city:boston")["raw_rows"], 2)  # both terms returned the row
        self.assertEqual(self._status("MA:city:boston")["accepted_leads"], 1)
        self.assertEqual(self._status("MA:city:cambridge")["status"], "empty")
        self.assertEqual(self._status("MA:city:salem")["status"], "fetch_error")
        self.assertEqual(self.done_calls, ["N1"])  # done posted once, carrying the nonce

    async def test_search_throws_marks_all_error(self):
        provider = ProviderMock({}, submit_error_cities={"Boston", "Cambridge", "Salem"})
        server.submit_outscraper_search = provider.submit
        await server.run_sweep({"target": "MA", "startNonce": "N1"})
        for key in ("MA:city:boston", "MA:city:cambridge", "MA:city:salem"):
            self.assertEqual(self._status(key)["status"], "fetch_error")
        # a fully errored sweep still "finished" (no pending) -> done fires; fetch errors
        # are requeued on the next Start. The point: NONE were marked empty.

    async def test_stop_breaks_without_done(self):
        server._get_control = _async({"active": False, "target": "MA", "startNonce": "N1"})
        await server.run_sweep({"target": "MA", "startNonce": "N1"})
        # Stop seen at the first batch-top -> no target processed, no done posted
        self.assertEqual(self._status("MA:city:boston")["status"], "pending")
        self.assertEqual(self.done_calls, [])

    async def test_failed_task_never_marked_empty(self):
        # A task that returns no rows due to FAILURE must be `fetch_error`, not `empty`.
        provider = ProviderMock({}, error_cities={"Boston", "Cambridge", "Salem"})
        server.submit_outscraper_search = provider.submit
        server.poll_outscraper_request = provider.poll
        await server.run_sweep({"target": "MA", "startNonce": "N1"})
        for key in ("MA:city:boston", "MA:city:cambridge", "MA:city:salem"):
            self.assertEqual(self._status(key)["status"], "fetch_error")  # never "empty"

    async def test_run_level_dedup_skips_already_accepted_place(self):
        provider = ProviderMock({"Boston": [ROW], "Cambridge": [ROW]})
        server.submit_outscraper_search = provider.submit
        server.poll_outscraper_request = provider.poll
        await server.run_sweep({"target": "MA", "startNonce": "N1"})
        self.assertEqual(self._status("MA:city:boston")["accepted_leads"], 1)
        self.assertEqual(self._status("MA:city:cambridge")["accepted_leads"], 0)
        with self.ledger._conn() as c:
            boston_dupes = c.execute(
                "SELECT duplicate_rows FROM target_status WHERE target_key = ?",
                ("MA:city:boston",),
            ).fetchone()["duplicate_rows"]
            cambridge_dupes = c.execute(
                "SELECT duplicate_rows FROM target_status WHERE target_key = ?",
                ("MA:city:cambridge",),
            ).fetchone()["duplicate_rows"]
        self.assertEqual(boston_dupes, 1)
        self.assertEqual(cambridge_dupes, 2)

    async def test_pending_provider_job_does_not_block_later_target(self):
        provider = ProviderMock({"Cambridge": [ROW]}, pending_then_error={"Boston"})
        server.submit_outscraper_search = provider.submit
        server.poll_outscraper_request = provider.poll
        ingested_cities: list[str] = []

        async def record_ingest(leads):
            ingested_cities.extend(lead.get("city") for lead in leads)
            return {
                "created": len(leads),
                "updated": 0,
                "skipped": 0,
                "total": len(leads),
                "results": [{"index": i, "status": "created", "id": f"lead-{i}"} for i, _ in enumerate(leads)],
            }

        server._ingest_leads = record_ingest
        await server.run_sweep({"target": "MA", "startNonce": "N1"})

        self.assertIn("Boston|junk removal", provider.polls)
        self.assertEqual(self._status("MA:city:boston")["status"], "fetch_error")
        self.assertEqual(self._status("MA:city:cambridge")["status"], "done")
        self.assertTrue(ingested_cities)

    async def test_ingest_failure_goes_to_outbox_and_retry_precedes_refetch(self):
        server.region = types.SimpleNamespace(
            expand=lambda t: ["MA"],
            discovery_targets_for_state=lambda st, **k: [MA_TARGETS[0]],
        )

        async def fail_ingest(leads):
            return {
                "created": 0,
                "updated": 0,
                "skipped": len(leads),
                "total": len(leads),
                "results": [
                    {"index": i, "status": "skipped", "reason": "write_failed"}
                    for i, _lead in enumerate(leads)
                ],
            }

        provider = ProviderMock({"Boston": [ROW]})
        server.submit_outscraper_search = provider.submit
        server.poll_outscraper_request = provider.poll
        server._ingest_leads = fail_ingest
        await server.run_sweep({"target": "MA", "startNonce": "N1"})
        self.assertEqual(self._status("MA:city:boston")["status"], "outbox_pending")
        with self.ledger._conn() as c:
            outbox_count = c.execute(
                "SELECT COUNT(*) AS n FROM lead_outbox WHERE status = 'pending'",
            ).fetchone()["n"]
        self.assertEqual(outbox_count, 1)

        async def save_ingest(leads):
            return {
                "created": len(leads),
                "updated": 0,
                "skipped": 0,
                "total": len(leads),
                "results": [
                    {"index": i, "status": "created", "id": f"lead-{i}"}
                    for i, _lead in enumerate(leads)
                ],
            }

        async def should_not_refetch(*args, **kwargs):
            raise AssertionError("outbox retry must happen before any paid refetch")

        server._get_control = _async({"active": True, "target": "MA", "startNonce": "N2"})
        server._ingest_leads = save_ingest
        server.submit_outscraper_search = should_not_refetch
        await server.run_sweep({"target": "MA", "startNonce": "N2"})

        self.assertEqual(self._status("MA:city:boston")["status"], "done")
        self.assertEqual(self._status("MA:city:boston")["created_leads"], 1)
        with self.ledger._conn() as c:
            saved_count = c.execute(
                "SELECT COUNT(*) AS n FROM lead_outbox WHERE status = 'saved'",
            ).fetchone()["n"]
        self.assertEqual(saved_count, 1)

    async def test_fetch_error_retry_submits_only_failed_term(self):
        server.region = types.SimpleNamespace(
            expand=lambda t: ["MA"],
            discovery_targets_for_state=lambda st, **k: [MA_TARGETS[0]],
        )
        provider = ProviderMock({"Boston": [ROW]}, error_cities={"Boston"})

        async def poll_one_term_fails(results_location, api_key, timeout=60.0):
            request_id = str(results_location)
            if request_id == "Boston|dumpster rental":
                raise RuntimeError("task failed")
            return {"status": "finished", "data": [[dict(ROW)]]}

        server.submit_outscraper_search = provider.submit
        server.poll_outscraper_request = poll_one_term_fails
        await server.run_sweep({"target": "MA", "startNonce": "N1"})
        self.assertEqual(self._status("MA:city:boston")["status"], "fetch_error")
        first_submits = list(provider.submitted_queries)

        retry_provider = ProviderMock({"Boston": [ROW]})
        server.submit_outscraper_search = retry_provider.submit
        server.poll_outscraper_request = retry_provider.poll
        server._get_control = _async({"active": True, "target": "MA", "startNonce": "N2"})
        await server.run_sweep({"target": "MA", "startNonce": "N2"})

        self.assertTrue(any(q.startswith("junk removal, Boston") for q in first_submits))
        self.assertEqual(retry_provider.submitted_queries, ["dumpster rental, Boston, MA"])
        self.assertEqual(self._status("MA:city:boston")["accepted_leads"], 1)
        self.assertEqual(self._status("MA:city:boston")["created_leads"], 1)

    async def test_adaptive_secondary_terms_skips_duplicate_heavy_city(self):
        server.cfg.adaptive_secondary_terms = True
        server.cfg.secondary_term_skip_duplicate_rate = 0.50
        server.cfg.secondary_term_skip_min_raw_rows = 1
        duplicate_row = dict(ROW)
        provider = ProviderMock({
            "Boston": [ROW],
            "Cambridge": [duplicate_row],
        })
        server.submit_outscraper_search = provider.submit
        server.poll_outscraper_request = provider.poll

        await server.run_sweep({"target": "MA", "startNonce": "N1"})

        self.assertIn("junk removal, Cambridge, MA", provider.submitted_queries)
        self.assertNotIn("dumpster rental, Cambridge, MA", provider.submitted_queries)
        self.assertEqual(self._status("MA:city:cambridge")["status"], "done")
        self.assertEqual(self._status("MA:city:cambridge")["accepted_leads"], 0)

    async def test_adaptive_secondary_terms_preserves_recall_after_accepted_city(self):
        server.cfg.adaptive_secondary_terms = True
        server.region = types.SimpleNamespace(
            expand=lambda t: ["MA"],
            discovery_targets_for_state=lambda st, **k: [MA_TARGETS[0]],
        )
        provider = ProviderMock({"Boston": [ROW]})
        server.submit_outscraper_search = provider.submit
        server.poll_outscraper_request = provider.poll

        await server.run_sweep({"target": "MA", "startNonce": "N1"})

        self.assertIn("junk removal, Boston, MA", provider.submitted_queries)
        self.assertIn("dumpster rental, Boston, MA", provider.submitted_queries)
        self.assertEqual(self._status("MA:city:boston")["status"], "done")


if __name__ == "__main__":
    unittest.main()
