import os
import tempfile
import unittest

from scraper.ledger import Ledger

MA_ZIPS = [
    {"zip": "02108", "city": "Boston", "state": "MA"},
    {"zip": "02109", "city": "Boston", "state": "MA"},
    {"zip": "01060", "city": "Northampton", "state": "MA"},
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


if __name__ == "__main__":
    unittest.main()
