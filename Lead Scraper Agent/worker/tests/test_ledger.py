import os
import tempfile
import unittest

from scraper.ledger import Ledger

MA_ZIPS = [
    {"zip": "02108", "city": "Boston", "state": "MA"},
    {"zip": "02109", "city": "Boston", "state": "MA"},
    {"zip": "01060", "city": "Northampton", "state": "MA"},
]

MA_TARGETS = [
    {"key": "MA:city:boston", "city": "Boston", "state": "MA", "targetType": "city",
     "lat": 42.36, "lng": -71.06, "population": 100000, "density": 1000.0, "zipCount": 2},
    {"key": "MA:city:northampton", "city": "Northampton", "state": "MA", "targetType": "city",
     "lat": 42.32, "lng": -72.64, "population": 30000, "density": 500.0, "zipCount": 1},
]


class TestLedger(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.ledger = Ledger(self.tmp.name)

    def tearDown(self):
        os.unlink(self.tmp.name)

    def test_seed_idempotent(self):
        self.assertEqual(self.ledger.seed_from_csv("MA", MA_ZIPS), 3)
        self.assertEqual(self.ledger.seed_from_csv("MA", MA_ZIPS), 0)  # no dupes

    def test_next_batch_pending_only(self):
        self.ledger.seed_from_csv("MA", MA_ZIPS)
        batch = self.ledger.next_batch("MA", 2)
        self.assertEqual(len(batch), 2)
        self.ledger.mark(batch[0]["zip"], "done", raw_rows=5, new_leads=3)
        self.ledger.mark(batch[1]["zip"], "empty")
        # only the 1 remaining pending comes back
        nxt = self.ledger.next_batch("MA", 10)
        self.assertEqual(len(nxt), 1)

    def test_next_batch_excludes_error(self):
        self.ledger.seed_from_csv("MA", MA_ZIPS)
        for z in MA_ZIPS:
            self.ledger.mark(z["zip"], "error", last_error="boom")
        self.assertEqual(self.ledger.next_batch("MA", 10), [])  # error not retried this sweep

    def test_resume_after_crash(self):
        self.ledger.seed_from_csv("MA", MA_ZIPS)
        self.ledger.mark("02108", "done", new_leads=2)
        # 02109 + 01060 still pending -> resume sees exactly those
        remaining = {r["zip"] for r in self.ledger.next_batch("MA", 10)}
        self.assertEqual(remaining, {"02109", "01060"})

    def test_sweep_reset_on_new_nonce_when_finished(self):
        self.ledger.seed_from_csv("MA", MA_ZIPS)
        self.ledger.mark("02108", "done", new_leads=2)
        self.ledger.mark("02109", "error")
        self.ledger.mark("01060", "empty")
        # finished state (no pending). A NEW nonce -> reset done+error to pending, keep empty skipped.
        started = self.ledger.start_sweep_if_needed("MA", "nonce-1", skip_empty=True)
        self.assertTrue(started)
        pend = {r["zip"] for r in self.ledger.next_batch("MA", 10)}
        self.assertEqual(pend, {"02108", "02109"})  # empty (01060) stays excluded

    def test_no_reset_on_same_nonce(self):
        self.ledger.seed_from_csv("MA", MA_ZIPS)
        for z in MA_ZIPS:
            self.ledger.mark(z["zip"], "done", new_leads=1)
        self.assertTrue(self.ledger.start_sweep_if_needed("MA", "n1", True))   # first apply -> reset
        # same nonce again must NOT reset (idempotent)
        self.assertFalse(self.ledger.start_sweep_if_needed("MA", "n1", True))

    def test_no_reset_when_pending_remains(self):
        self.ledger.seed_from_csv("MA", MA_ZIPS)
        self.ledger.mark("02108", "done", new_leads=1)  # 2 still pending -> mid-sweep
        started = self.ledger.start_sweep_if_needed("MA", "n-resume", True)
        self.assertFalse(started)  # resume, not reset

    def test_reset_includes_empty_when_flag_false(self):
        self.ledger.seed_from_csv("MA", MA_ZIPS)
        self.ledger.mark("02108", "done")
        self.ledger.mark("02109", "empty")
        self.ledger.mark("01060", "empty")
        self.ledger.start_sweep_if_needed("MA", "n1", skip_empty=False)
        pend = {r["zip"] for r in self.ledger.next_batch("MA", 10)}
        self.assertEqual(pend, {"02108", "02109", "01060"})  # empties reset too

    def test_progress_counts(self):
        self.ledger.seed_from_csv("MA", MA_ZIPS)
        self.ledger.mark("02108", "done", raw_rows=10, new_leads=4)
        self.ledger.mark("02109", "empty")
        p = self.ledger.progress("MA")
        self.assertEqual(p["zipsTotal"], 3)
        self.assertEqual(p["zipsDone"], 1)
        self.assertEqual(p["zipsEmpty"], 1)
        self.assertEqual(p["zipsPending"], 1)
        self.assertEqual(p["leadsFound"], 4)

    def test_per_state_nonce_isolation(self):
        # An ALL run: one Start nonce must trigger reset in EACH state independently.
        tx = [{"zip": "73301", "city": "Austin", "state": "TX"}]
        self.ledger.seed_from_csv("MA", MA_ZIPS)
        self.ledger.seed_from_csv("TX", tx)
        for z in MA_ZIPS:
            self.ledger.mark(z["zip"], "done", new_leads=1)
        self.ledger.mark("73301", "done", new_leads=1)
        self.assertTrue(self.ledger.start_sweep_if_needed("MA", "run9", True))
        self.assertTrue(self.ledger.start_sweep_if_needed("TX", "run9", True))  # same nonce, different state

    def test_target_seed_next_mark_progress(self):
        self.assertEqual(self.ledger.seed_targets("MA", MA_TARGETS), 2)
        self.assertEqual(self.ledger.seed_targets("MA", MA_TARGETS), 0)
        batch = self.ledger.next_targets("MA", 10)
        self.assertEqual({t["key"] for t in batch}, {"MA:city:boston", "MA:city:northampton"})
        self.ledger.mark_target(
            "MA:city:boston",
            "done",
            queries=2,
            raw_rows=10,
            unique_rows=6,
            duplicate_rows=2,
            filtered_rows=1,
            accepted_leads=3,
            created_leads=2,
            updated_leads=1,
        )
        p = self.ledger.target_progress("MA")
        self.assertEqual(p["targetsTotal"], 2)
        self.assertEqual(p["targetsDone"], 1)
        self.assertEqual(p["targetsPending"], 1)
        self.assertEqual(p["queriesSubmitted"], 2)
        self.assertEqual(p["rawRowsReturned"], 10)
        self.assertEqual(p["duplicatesSkipped"], 2)
        self.assertEqual(p["acceptedLeads"], 3)
        self.assertEqual(p["leadsFound"], 3)
        self.assertEqual(p["estimatedWastedRows"], 7)
        self.assertEqual(p["duplicateRate"], 0.2)
        self.assertEqual(p["filteredRate"], 0.1)
        self.assertEqual(p["acceptedRate"], 0.3)
        self.assertEqual(p["createdRate"], 0.2)
        self.assertEqual(p["rawToAcceptedRatio"], 3.33)
        self.assertEqual(p["rawToCreatedRatio"], 5.0)

    def test_target_sweep_reset_on_new_nonce(self):
        self.ledger.seed_targets("MA", MA_TARGETS)
        self.ledger.mark_target("MA:city:boston", "done")
        self.ledger.mark_target("MA:city:northampton", "empty")
        self.assertTrue(self.ledger.start_target_sweep_if_needed("MA", "n1", skip_empty=True))
        pending = {t["key"] for t in self.ledger.next_targets("MA", 10)}
        self.assertEqual(pending, {"MA:city:boston"})

    def test_target_sweep_reset_requeues_fetch_errors_not_empty(self):
        self.ledger.seed_targets("MA", MA_TARGETS)
        self.ledger.mark_target("MA:city:boston", "fetch_error", last_error="provider failed")
        self.ledger.mark_target("MA:city:northampton", "empty")
        self.assertTrue(self.ledger.start_target_sweep_if_needed("MA", "n1", skip_empty=True))
        pending = {t["key"] for t in self.ledger.next_targets("MA", 10)}
        self.assertEqual(pending, {"MA:city:boston"})

    def test_outbox_owned_target_blocks_refetch_reset(self):
        self.ledger.seed_targets("MA", MA_TARGETS)
        self.ledger.mark_target("MA:city:boston", "outbox_pending", accepted_leads=1)
        self.ledger.mark_target("MA:city:northampton", "done")
        started = self.ledger.start_target_sweep_if_needed("MA", "n1", skip_empty=True)
        self.assertFalse(started)
        pending = {t["key"] for t in self.ledger.next_targets("MA", 10)}
        self.assertEqual(pending, set())

    def test_outbox_save_retry_and_progress_counts(self):
        self.ledger.seed_targets("MA", MA_TARGETS)
        lead = {"name": "Joe's Junk Removal", "state": "MA", "address": "1 Main St"}
        added = self.ledger.save_outbox_leads(
            "MA:city:boston",
            "MA",
            [lead],
            lambda item: (item["name"], item["state"], item["address"]),
            "write failed",
        )
        self.assertEqual(added, 1)
        self.ledger.mark_target("MA:city:boston", "outbox_pending", accepted_leads=1)
        p = self.ledger.target_progress("MA")
        self.assertEqual(p["targetsOutboxPending"], 1)
        self.assertEqual(p["targetsError"], 0)
        rows = self.ledger.pending_outbox("MA", 10)
        self.assertEqual(len(rows), 1)
        self.ledger.mark_outbox_saved([rows[0]["id"]])
        self.assertEqual(self.ledger.outbox_remaining_by_target("MA:city:boston"), 0)

    def test_provider_jobs_track_fetching_progress_and_rows(self):
        self.ledger.seed_targets("MA", MA_TARGETS)
        target = MA_TARGETS[0]
        added = self.ledger.ensure_provider_jobs(target, [
            {
                "job_key": "MA:city:boston|junk-removal",
                "term": "junk removal",
                "query": "junk removal, Boston, MA",
                "coordinates": None,
            },
        ])
        self.assertEqual(added, 1)
        p = self.ledger.target_progress("MA")
        self.assertEqual(p["targetsFetching"], 1)
        self.assertEqual(p["providerJobsPendingSubmit"], 1)

        job = self.ledger.pending_provider_jobs("MA", 1)[0]
        self.ledger.mark_provider_submitted(job["id"], "req-1", "req-1")
        self.ledger.mark_provider_finished(job["id"], [{"name": "Joe's Junk Removal"}])
        ready = self.ledger.ready_target_keys("MA")
        self.assertEqual(ready, ["MA:city:boston"])
        rows = self.ledger.provider_jobs_for_target("MA:city:boston", ("finished",))[0]["rows"]
        self.assertEqual(rows[0]["name"], "Joe's Junk Removal")

    def test_fetch_error_reset_retries_only_failed_provider_jobs(self):
        self.ledger.seed_targets("MA", MA_TARGETS)
        target = MA_TARGETS[0]
        self.ledger.ensure_provider_jobs(target, [
            {"job_key": "MA:city:boston|junk", "term": "junk removal", "query": "junk removal, Boston, MA"},
            {"job_key": "MA:city:boston|dumpster", "term": "dumpster rental", "query": "dumpster rental, Boston, MA"},
        ])
        jobs = self.ledger.pending_provider_jobs("MA", 10)
        self.ledger.mark_provider_submitted(jobs[0]["id"], "req-j", "req-j")
        self.ledger.mark_provider_finished(jobs[0]["id"], [{"name": "Joe"}])
        self.ledger.mark_provider_processed([jobs[0]["id"]])
        self.ledger.mark_provider_submitted(jobs[1]["id"], "req-d", "req-d")
        self.ledger.mark_provider_error(jobs[1]["id"], "provider failed")
        self.ledger.mark_target("MA:city:boston", "fetch_error", queries=2, raw_rows=1, accepted_leads=1)
        self.ledger.mark_target("MA:city:northampton", "empty")

        self.assertTrue(self.ledger.start_target_sweep_if_needed("MA", "n1", skip_empty=True))
        pending = self.ledger.pending_provider_jobs("MA", 10)
        self.assertEqual([job["job_key"] for job in pending], ["MA:city:boston|dumpster"])


if __name__ == "__main__":
    unittest.main()
