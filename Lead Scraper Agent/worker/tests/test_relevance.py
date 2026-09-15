import unittest

from scraper import relevance


def _row(**kw):
    base = {
        "name": "Birmingham Junk Removal",
        "type": "Garbage collection service",
        "subtypes": "",
        "_term": "junk removal",
        "business_status": "OPERATIONAL",
    }
    base.update(kw)
    return base


class TestRelevance(unittest.TestCase):
    def test_accepts_name_plus_generic_garbage_category(self):
        result = relevance.classify_row(_row())
        self.assertTrue(result.relevant)
        self.assertEqual(result.company_type, "junk_removal")

    def test_accepts_rolloff_dumpster_business(self):
        result = relevance.classify_row(_row(name="Wasatch Roll Off Dumpsters",
                                             type="Waste management service"))
        self.assertTrue(result.relevant)
        self.assertEqual(result.company_type, "dumpster_rental")

    def test_accepts_contextual_hauling_with_waste_category(self):
        result = relevance.classify_row(_row(name="Acme Hauling",
                                             type="Garbage collection service"))
        self.assertTrue(result.relevant)
        self.assertEqual(result.company_type, "other")  # query cannot establish service scope
        self.assertEqual(result.reason, "pending_review")

    def test_accepts_college_hunks_junk_despite_moving_category(self):
        result = relevance.classify_row(_row(
            name="College Hunks Hauling Junk and Moving Atlanta",
            type="Mover",
            subtypes="Moving service, Debris removal service, Junk removal service",
        ))
        self.assertTrue(result.relevant)
        self.assertEqual(result.company_type, "junk_removal")

    def test_accepts_pick_and_roll_junk_removal_despite_storage_category(self):
        result = relevance.classify_row(_row(
            name="Pick and Roll Junk Removal",
            type="Junk removal service",
            subtypes="Garbage collection service, Moving and storage service, Waste management service",
        ))
        self.assertTrue(result.relevant)

    def test_accepts_brand_junk_with_waste_management_category(self):
        result = relevance.classify_row(_row(
            name="Junk-it ATL",
            type="Waste management service",
            subtypes="",
        ))
        self.assertTrue(result.relevant)
        self.assertEqual(result.company_type, "other")

    def test_accepts_1_800_got_junk_as_relevant_junk_company(self):
        result = relevance.classify_row(_row(
            name="1-800-GOT-JUNK? Atlanta Westside",
            type="Junk removal service",
            subtypes="Debris removal service, Garbage collection service, Recycling center",
        ))
        self.assertTrue(result.relevant)

    def test_accepts_waste_container_rental(self):
        result = relevance.classify_row(_row(name="County Waste Containers",
                                             type="Waste container rental service"))
        self.assertTrue(result.relevant)
        self.assertEqual(result.company_type, "dumpster_rental")

    def test_accepts_generic_waste_company_with_waste_category(self):
        result = relevance.classify_row(_row(name="Metro Disposal",
                                             type="Waste management service",
                                             subtypes="Garbage collection service"))
        self.assertTrue(result.relevant)
        self.assertEqual(result.reason, "pending_review")

    def test_accepts_tree_company_when_debris_removal_is_real_evidence(self):
        result = relevance.classify_row(_row(name="Northside Tree and Debris Removal",
                                             type="Tree service",
                                             subtypes="Debris removal service"))
        self.assertTrue(result.relevant)
        self.assertEqual(result.company_type, "junk_removal")

    def test_accepts_ri_junk_guy_despite_mixed_service_categories(self):
        result = relevance.classify_row(_row(
            name="RI Junk Guy - Junk Removal, Moving and Delivery",
            type="Waste management service",
            subtypes=(
                "Debris removal service, Demolition contractor, "
                "Garbage collection service, Gutter cleaning service"
            ),
        ))
        self.assertTrue(result.relevant)
        self.assertEqual(result.company_type, "junk_removal")

    def test_accepts_sivo_junk_removal_despite_demolition_and_landscaper(self):
        result = relevance.classify_row(_row(
            name="Sivo & Sons Junk Removal and Disposal",
            type="Demolition contractor",
            subtypes="Dry wall contractor, Landscaper",
        ))
        self.assertTrue(result.relevant)
        self.assertEqual(result.company_type, "junk_removal")

    def test_accepts_junk_company_despite_janitorial_service(self):
        result = relevance.classify_row(_row(
            name="Clutter Crew Junk Removal & Janitorial Services - Rhode Island",
            type="Waste management service",
            subtypes="Janitorial service, Cleaning service",
        ))
        self.assertTrue(result.relevant)
        self.assertEqual(result.company_type, "junk_removal")

    def test_conflicting_junk_car_identity_needs_review(self):
        result = relevance.classify_row(_row(
            name="Bouk Cash for Junk Cars, RI (Rhode Island)",
            type="Junk dealer",
            subtypes="Auto tune up service, Auto wrecker, Car dealer, Junk removal service",
        ))
        self.assertTrue(result.relevant)
        self.assertEqual(result.reason, "pending_review")

    def test_retains_pending_storage_container_rental_without_waste_context(self):
        result = relevance.classify_row(_row(name="Portable Storage Containers",
                                             type="Container rental service",
                                             subtypes="Storage facility"))
        self.assertTrue(result.relevant)
        self.assertEqual(result.reason, "pending_review")

    def test_retains_pending_dumpster_cleaning_without_rental_context(self):
        result = relevance.classify_row(_row(name="Dumpster Cleaning Pros",
                                             type="Cleaning service",
                                             subtypes="Pressure washing service"))
        self.assertTrue(result.relevant)
        self.assertEqual(result.reason, "pending_review")

    def test_retains_pending_construction_container_rental_without_waste_context(self):
        result = relevance.classify_row(_row(name="Construction Container Rentals",
                                             type="Container rental service",
                                             subtypes="Construction equipment supplier"))
        self.assertTrue(result.relevant)

    def test_search_term_is_not_relevance_evidence(self):
        result = relevance.classify_row(_row(name="Bob's Hardware",
                                             type="Hardware store",
                                             _term="dumpster rental"))
        self.assertTrue(result.relevant)
        self.assertEqual(result.reason, "pending_review")

    def test_retains_pending_alabama_false_positive_examples(self):
        examples = [
            ("AutoZone Auto Parts", "Auto parts store"),
            ("U-Haul Neighborhood Dealer", "Truck rental agency"),
            ("Birmingham Police Department", "Police station"),
            ("Southern Tree Service", "Tree service"),
            ("Fast Tow LLC", "Towing service"),
            ("Green Valley Landscaping", "Landscaping service"),
            ("Teardown Cleaning Services", "Cleaning service"),
            ("Black Warrior Paper Mill", "Paper mill"),
            ("Bama Lawn Care", "Lawn care service"),
            ("Smith Paving", "Paving contractor"),
        ]
        for name, business_type in examples:
            with self.subTest(name=name):
                result = relevance.classify_row(_row(name=name, type=business_type,
                                                     subtypes="", _term="junk removal"))
                self.assertTrue(result.relevant)
                self.assertEqual(result.reason, "pending_review")

    def test_retains_pending_standalone_demolition(self):
        result = relevance.classify_row(_row(name="ABC Demolition",
                                             type="Demolition contractor",
                                             subtypes=""))
        self.assertTrue(result.relevant)
        self.assertEqual(result.reason, "pending_review")

    def test_retains_pending_standalone_excavation(self):
        result = relevance.classify_row(_row(name="ABC Excavating",
                                             type="Excavating contractor",
                                             subtypes=""))
        self.assertTrue(result.relevant)
        self.assertEqual(result.reason, "pending_review")

    def test_retains_pending_restoration_without_strong_junk_signal(self):
        result = relevance.classify_row(_row(name="Flood Restoration Debris Cleanup",
                                             type="Water damage restoration service",
                                             subtypes=""))
        self.assertTrue(result.relevant)
        self.assertEqual(result.reason, "pending_review")


if __name__ == "__main__":
    unittest.main()
