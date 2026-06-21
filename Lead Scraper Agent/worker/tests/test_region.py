import os
import unittest

from scraper import region

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "us_zips_sample.csv")


class TestRegion(unittest.TestCase):
    def test_expand_single_state(self):
        self.assertEqual(region.expand("MA"), ["MA"])
        self.assertEqual(region.expand("ma"), ["MA"])

    def test_expand_all_is_51(self):
        self.assertEqual(len(region.expand("ALL")), 51)  # 50 states + DC
        self.assertIn("DC", region.expand("ALL"))
        self.assertNotIn("PR", region.expand("ALL"))

    def test_expand_unknown(self):
        self.assertEqual(region.expand("ZZ"), [])
        self.assertEqual(region.expand(""), [])

    def test_zips_for_state_filters(self):
        ma = region.zips_for_state("MA", FIXTURE)
        self.assertEqual({r["zip"] for r in ma}, {"02108", "02109", "01060"})
        self.assertTrue(all(r["state"] == "MA" for r in ma))

    def test_territories_and_military_excluded(self):
        # PR / GU / AE rows in the fixture must never appear, even under ALL.
        all_rows = region.zips_for_target("ALL", FIXTURE)
        states = {r["state"] for r in all_rows}
        self.assertNotIn("PR", states)
        self.assertNotIn("GU", states)
        self.assertNotIn("AE", states)
        self.assertIn("DC", states)

    def test_dc_included(self):
        dc = region.zips_for_state("DC", FIXTURE)
        self.assertEqual([r["zip"] for r in dc], ["20001"])

    def test_is_valid_target(self):
        self.assertTrue(region.is_valid_target("MA"))
        self.assertTrue(region.is_valid_target("ALL"))
        self.assertTrue(region.is_valid_target("DC"))
        self.assertFalse(region.is_valid_target("PR"))
        self.assertFalse(region.is_valid_target(""))


if __name__ == "__main__":
    unittest.main()
