import unittest

from scraper.outscraper_client import _normalize


class TestOutscraperNormalize(unittest.TestCase):
    def test_normalizes_per_query_response(self):
        data = [[{"name": "A"}], [{"name": "B"}]]
        out = _normalize(data, 2, drop_duplicates=False)
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]["data"][0]["name"], "A")

    def test_normalizes_combined_drop_duplicates_response(self):
        data = [{"name": "A", "place_id": "P1"}, {"name": "B", "place_id": "P2"}]
        out = _normalize(data, 2, drop_duplicates=True)
        self.assertEqual(len(out), 1)
        self.assertTrue(out[0]["combined"])
        self.assertEqual(len(out[0]["data"]), 2)

    def test_normalizes_empty_combined_drop_duplicates_response(self):
        out = _normalize([], 2, drop_duplicates=True)
        self.assertEqual(len(out), 1)
        self.assertTrue(out[0]["combined"])
        self.assertEqual(out[0]["data"], [])

    def test_preserves_failed_per_query_entry(self):
        out = _normalize([{"status": "failed", "message": "quota"}], 1, drop_duplicates=False)
        self.assertEqual(out[0]["data"], [])
        self.assertEqual(out[0]["error"], "quota")
        self.assertEqual(out[0]["status"], "failed")


if __name__ == "__main__":
    unittest.main()
