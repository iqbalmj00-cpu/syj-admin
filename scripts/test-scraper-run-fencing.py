"""AST-only regressions: never import the worker, load its env, or open its ledger."""
import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace
import unittest

SOURCE = Path("Lead Scraper Agent/worker/server.py")
NAMES = {"RunSuperseded", "_assert_run_current", "run_sweep", "_submit_provider_jobs", "_process_ready_targets", "_retry_outbox_for_state"}
TREE = ast.parse(SOURCE.read_text())
MODULE = ast.fix_missing_locations(ast.Module(body=[n for n in TREE.body if getattr(n, "name", None) in NAMES], type_ignores=[]))


class FencingTests(unittest.IsolatedAsyncioTestCase):
    def fixture(self, controls):
        calls = []
        index = 0

        async def get_control():
            nonlocal index
            ctrl = controls[min(index, len(controls) - 1)]
            index += 1
            return ctrl

        async def record(*args):
            calls.append("work")
            return False

        async def done(*args):
            calls.append("done")

        ns = dict(
            _get_control=get_control, _state={}, asyncio=asyncio,
            logger=SimpleNamespace(info=lambda *a: None, warning=lambda *a: None),
            region=SimpleNamespace(expand=lambda target: [target], discovery_targets_for_state=lambda *a, **k: [{}]),
            cfg=SimpleNamespace(enable_grid_expansion=False, grid_spacing_miles=1, max_grid_points_per_market=1, grid_min_population=1, grid_min_zip_count=1, skip_empty=True),
            LEDGER=SimpleNamespace(seed_targets=lambda *a: calls.append("seed"), start_target_sweep_if_needed=lambda *a: calls.append("ledger"), outbox_remaining_for_state=lambda *a: 0, provider_activity=lambda *a: {}, state_has_open_provider_work=lambda *a: False, target_progress=lambda *a: {}),
            ENV=SimpleNamespace(dry_run_target=None, dashboard_url="mock", callback_secret="mock"),
            control=SimpleNamespace(post_done=done), _state_has_pending_targets=lambda *a: False,
            _ensure_provider_jobs_for_pending_targets=record, _poll_provider_jobs=record, _report_progress=record,
        )
        exec(compile(MODULE, str(SOURCE), "exec"), ns)
        ns.update(_retry_outbox_for_state=record, _submit_provider_jobs=record, _process_ready_targets=record)
        return ns, calls

    async def test_stop_target_and_nonce_changes_do_no_work_or_done(self):
        original = dict(active=True, target="CO", startNonce="old")
        for latest in [dict(original, active=False), dict(original, target="MA"), dict(original, startNonce="new")]:
            with self.subTest(latest=latest):
                ns, calls = self.fixture([latest])
                await ns["run_sweep"](original)
                self.assertEqual(calls, [])

    async def test_stop_start_between_processing_and_submission_leaves_new_run_untouched(self):
        original = dict(active=True, target="CO", startNonce="old")
        ns, calls = self.fixture([original] * 2 + [dict(original, startNonce="new")])
        await ns["run_sweep"](original)
        self.assertNotIn("done", calls)
        self.assertEqual(calls.count("work"), 2)  # outbox check and first processing only

    async def test_unchanged_identity_can_complete(self):
        original = dict(active=True, target="CO", startNonce="old")
        ns, calls = self.fixture([original])
        await ns["run_sweep"](original)
        self.assertEqual(calls.count("done"), 1)

    async def test_missing_nonce_cannot_authorize_work(self):
        original = dict(active=True, target="CO", startNonce=None)
        ns, calls = self.fixture([original])
        await ns["run_sweep"](original)
        self.assertEqual(calls, [])

    async def test_each_ready_target_is_fenced(self):
        original = dict(active=True, target="CO", startNonce="old")
        ns, calls = self.fixture([original, dict(original, startNonce="new")])
        exec(compile(MODULE, str(SOURCE), "exec"), ns)
        ns["cfg"].batch_target_count = 2
        ns["LEDGER"].ready_target_keys = lambda *a: ["one", "two"]
        async def process(*a):
            calls.append(a[1])
            return False
        ns["_process_ready_target"] = process
        with self.assertRaises(ns["RunSuperseded"]):
            await ns["_process_ready_targets"]("CO", "old", set(), {}, "CO")
        self.assertEqual(calls, ["one"])

    async def test_superseded_outbox_is_preserved_without_upload(self):
        original = dict(active=True, target="CO", startNonce="old")
        ns, calls = self.fixture([dict(original, startNonce="new")])
        exec(compile(MODULE, str(SOURCE), "exec"), ns)
        ns["LEDGER"].outbox_remaining_for_state = lambda *a: 2
        with self.assertRaises(ns["RunSuperseded"]):
            await ns["_retry_outbox_for_state"]("CO", "old", "CO")
        self.assertEqual(calls, [])

    async def test_supersession_before_completion_never_posts_done(self):
        original = dict(active=True, target="CO", startNonce="old")
        ns, calls = self.fixture([original])
        async def report(*args):
            ns["_get_control"] = lambda: asyncio.sleep(0, result=dict(original, startNonce="new"))
        ns["_report_progress"] = report
        await ns["run_sweep"](original)
        self.assertNotIn("done", calls)

    async def test_each_paid_submission_is_fenced_and_first_receipt_preserved(self):
        original = dict(active=True, target="CO", startNonce="old")
        ns, calls = self.fixture([original, dict(original, startNonce="new")])
        exec(compile(MODULE, str(SOURCE), "exec"), ns)
        ns["cfg"] = SimpleNamespace(outscraper_job_concurrency=2, max_queries_per_run=0, max_accepted_leads_per_run=0, results_limit=1, enable_drop_duplicates=True, total_limit_per_target=0, outscraper_region="US", outscraper_fields=[])
        ns["ENV"].outscraper_api_key = "synthetic"
        ns["LEDGER"] = SimpleNamespace(submitted_provider_job_count=lambda *a: 0, pending_provider_jobs=lambda *a: [dict(id=i, query="query", target_key="target", term="term") for i in [1, 2]], mark_provider_submitted=lambda *a: calls.append(("receipt", a)))
        async def submit(*a, **kw):
            calls.append("paid")
            return {"requestId": "paid-request", "resultsLocation": "synthetic", "status": "pending"}
        ns["submit_outscraper_search"] = submit
        with self.assertRaises(ns["RunSuperseded"]):
            await ns["_submit_provider_jobs"]("CO", "old", {"queries": 0, "accepted": 0}, "CO")
        self.assertEqual(calls, ["paid", ("receipt", (1, "paid-request", "synthetic"))])


if __name__ == "__main__":
    unittest.main()
