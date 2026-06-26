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

    def test_city_targets_include_every_unique_city_once(self):
        targets = region.city_targets_for_state("MA", FIXTURE)
        by_city = {t["city"]: t for t in targets}
        self.assertEqual(set(by_city), {"Boston", "Northampton"})
        self.assertEqual(by_city["Boston"]["zipCount"], 2)
        self.assertEqual(by_city["Northampton"]["zipCount"], 1)
        self.assertEqual(by_city["Boston"]["targetType"], "city")

    def test_discovery_targets_add_grid_only_for_large_market(self):
        city = {
            "key": "TX:city:austin",
            "state": "TX",
            "city": "Austin",
            "targetType": "city",
            "lat": 30.2672,
            "lng": -97.7431,
            "population": 500000,
            "density": 1200.0,
            "zipCount": 20,
            "zips": ["73301"],
            "tier": "large",
        }
        grid = region.grid_targets_for_city(city, spacing_miles=10, max_points=5)
        self.assertEqual(len(grid), 5)
        self.assertTrue(all(t["targetType"] == "grid" for t in grid))
        self.assertTrue(all(t["key"].startswith("TX:grid:austin:") for t in grid))

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
