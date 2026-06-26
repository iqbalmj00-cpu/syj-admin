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
        self.assertEqual(lead["companyType"], "dumpster_rental")
        self.assertEqual(lead["website"], "https://joesjunk.com")
        self.assertEqual(lead["address"], "1 Main St, Boston, MA 02108")
        self.assertEqual(lead["rating"], 4.8)
        self.assertEqual(lead["reviewCount"], 212)
        self.assertIsInstance(lead["latitude"], float)

    def test_current_outscraper_website_and_address_keys(self):
        lead = mapper.to_lead(_row(site=None, full_address=None,
                                   website="https://current.example",
                                   address="2 Current St, Boston, MA 02108"), ZIPROW)
        self.assertEqual(lead["website"], "https://current.example")
        self.assertEqual(lead["address"], "2 Current St, Boston, MA 02108")

    def test_categories_are_real_outscraper_values_only(self):
        lead = mapper.to_lead(_row(type="Dumpster rental service", subtypes="",
                                   _term="junk removal"), ZIPROW)
        self.assertEqual(lead["categories"], ["Dumpster rental service"])
        self.assertNotIn("junk removal", [c.lower() for c in lead["categories"]])

    def test_dumpster_evidence_company_type(self):
        lead = mapper.to_lead(_row(name="Acme Roll Off", type="Waste management service",
                                   subtypes="", _term="junk removal"), ZIPROW)
        self.assertEqual(lead["companyType"], "dumpster_rental")

    def test_search_term_only_breaks_ambiguous_company_type_tie(self):
        lead = mapper.to_lead(_row(name="Acme Hauling", type="Garbage collection service",
                                   subtypes="", _term="dumpster rental"), ZIPROW)
        self.assertEqual(lead["companyType"], "dumpster_rental")

    def test_search_term_does_not_make_irrelevant_row_valid(self):
        self.assertIsNone(mapper.to_lead(_row(name="AutoZone Auto Parts",
                                              type="Auto parts store",
                                              subtypes="",
                                              _term="junk removal"), ZIPROW))

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
        b = _row(place_id=None, full_address="1 Main Street, Boston MA 02108")
        c = _row(place_id=None, name="Different", full_address="9 Other Rd")
        out = mapper.dedup_by_place_id([a, b, c])
        self.assertEqual(len(out), 2)  # a&b merge, c distinct

    def test_dedup_uses_google_id_fallback(self):
        a = _row(place_id=None, google_id="0xabc")
        b = _row(place_id=None, google_id="0xabc", full_address="99 Changed Rd")
        out = mapper.dedup_by_place_id([a, b])
        self.assertEqual(len(out), 1)

    def test_term_preference_when_only_dumpster(self):
        a = _row(place_id="P9", _term="dumpster rental")
        out = mapper.dedup_by_place_id([a])
        self.assertEqual(out[0]["_term"], "dumpster rental")

    def test_duplicate_keeps_richest_row(self):
        sparse = _row(place_id="P10", site=None, phone=None, full_address=None, reviews="1",
                      _term="dumpster rental")
        rich = _row(place_id="P10", site="https://rich.example", phone="+1 617-555-2222",
                    full_address="10 Rich St, Boston, MA", reviews="200", _term="junk removal")
        out = mapper.dedup_by_place_id([sparse, rich])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["site"], "https://rich.example")
        self.assertEqual(out[0]["phone"], "+1 617-555-2222")
        self.assertEqual(out[0]["_term"], "junk removal")

    def test_lead_dedup_key_normalizes_address(self):
        a = {"name": "Joe's Junk Removal", "state": "MA", "address": "1 Main St"}
        b = {"name": "Joe s Junk Removal", "state": "MA", "address": "1 Main Street"}
        self.assertEqual(mapper.lead_dedup_key(a), mapper.lead_dedup_key(b))


if __name__ == "__main__":
    unittest.main()
