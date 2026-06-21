import unittest

from scraper import mapper

ZIPROW = {"zip": "02108", "city": "Boston", "state": "MA"}


def _row(**kw):
    base = {
        "name": "Joe's Junk Removal",
        "place_id": "ChIJabc123",
        "full_address": "1 Main St, Boston, MA 02108",
        "city": "Boston",
        "state": "Massachusetts",
        "site": "https://joesjunk.com",
        "phone": "+1 617-555-0100",
        "type": "Garbage collection service",
        "subtypes": "Junk removal service, Dumpster rental service",
        "rating": "4.8",
        "reviews": "212",
        "latitude": "42.3576",
        "longitude": "-71.0644",
        "location_link": "https://maps.google.com/?cid=1",
        "business_status": "OPERATIONAL",
        "_term": "junk removal",
    }
    base.update(kw)
    return base


class TestMapper(unittest.TestCase):
    def test_basic_mapping(self):
        lead = mapper.to_lead(_row(), ZIPROW)
        self.assertEqual(lead["name"], "Joe's Junk Removal")
        self.assertEqual(lead["market"], "Boston")
        self.assertEqual(lead["state"], "MA")  # full name normalized
        self.assertEqual(lead["discoveredVia"], "google_maps")
        self.assertEqual(lead["source"], "google")
        self.assertEqual(lead["googlePlaceId"], "ChIJabc123")
        self.assertEqual(lead["companyType"], "junk_removal")
        self.assertEqual(lead["rating"], 4.8)
        self.assertEqual(lead["reviewCount"], 212)
        self.assertIsInstance(lead["latitude"], float)

    def test_categories_seeded_with_term(self):
        lead = mapper.to_lead(_row(), ZIPROW)
        self.assertEqual(lead["categories"][0], "junk removal")  # relevance-gate guarantee
        self.assertIn("Garbage collection service", lead["categories"])
        # subtypes comma-string split
        self.assertIn("Junk removal service", lead["categories"])

    def test_dumpster_term_company_type(self):
        lead = mapper.to_lead(_row(_term="dumpster rental"), ZIPROW)
        self.assertEqual(lead["companyType"], "dumpster_rental")
        self.assertEqual(lead["categories"][0], "dumpster rental")

    def test_drop_nameless(self):
        self.assertIsNone(mapper.to_lead(_row(name=""), ZIPROW))

    def test_drop_permanently_closed(self):
        self.assertIsNone(mapper.to_lead(_row(business_status="CLOSED_PERMANENTLY"), ZIPROW))

    def test_state_fallback_to_ziprow(self):
        lead = mapper.to_lead(_row(state=""), ZIPROW)
        self.assertEqual(lead["state"], "MA")  # fell back to ZIP dataset

    def test_market_prefers_row_city(self):
        lead = mapper.to_lead(_row(city="Cambridge"), ZIPROW)
        self.assertEqual(lead["market"], "Cambridge")
        self.assertEqual(lead["city"], "Cambridge")

    def test_no_enrichment_owned_keys(self):
        lead = mapper.to_lead(_row(), ZIPROW)
        forbidden = {"serviceTypes", "painTags", "praiseTags", "emailsDiscovered",
                     "reviewComplaints", "reviewPraise", "techDetected", "notesFlags",
                     "reasons", "painPoints", "email", "enrichedAt", "ownerName"}
        self.assertEqual(forbidden & set(lead.keys()), set())

    def test_two_letter_state_passthrough(self):
        lead = mapper.to_lead(_row(state="MA"), ZIPROW)
        self.assertEqual(lead["state"], "MA")


class TestDedup(unittest.TestCase):
    def test_collapses_same_place_id(self):
        a = _row(place_id="P1", _term="dumpster rental")
        b = _row(place_id="P1", _term="junk removal")
        out = mapper.dedup_by_place_id([a, b])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["_term"], "junk removal")  # junk removal preferred

    def test_keeps_distinct_place_ids(self):
        a = _row(place_id="P1")
        b = _row(place_id="P2", name="Other Co")
        self.assertEqual(len(mapper.dedup_by_place_id([a, b])), 2)

    def test_fallback_name_address_when_no_place_id(self):
        a = _row(place_id=None)
        b = _row(place_id=None)
        c = _row(place_id=None, name="Different", full_address="9 Other Rd")
        out = mapper.dedup_by_place_id([a, b, c])
        self.assertEqual(len(out), 2)  # a&b merge, c distinct

    def test_term_preference_when_only_dumpster(self):
        a = _row(place_id="P9", _term="dumpster rental")
        out = mapper.dedup_by_place_id([a])
        self.assertEqual(out[0]["_term"], "dumpster rental")


if __name__ == "__main__":
    unittest.main()
