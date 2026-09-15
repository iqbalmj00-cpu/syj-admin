import asyncio,tempfile,unittest
from pathlib import Path
from scraper import relevance,mapper
from scraper.ledger import Ledger

class JunkEligibilityTests(unittest.TestCase):
    def test_only_standalone_dumpster_discovery_is_disallowed(self):
        for term in ['dumpster rental','roll off dumpster','waste container rental','bin rental','container rental','dumpster rental junk removal of cars','']:
            self.assertFalse(relevance.allowed_discovery_term(term),term)
        for term in ['junk removal','junk removal and dumpster rental','dumpster rental with junk removal','bin rental and appliance removal']:
            self.assertTrue(relevance.allowed_discovery_term(term),term)
    def test_excluded_hauling_meanings_and_actual_hybrids(self):
        for name in ['Trash Pickup','Waste Management','Freight Hauling','Aggregate Hauling','Material Delivery','Junk Car Removal','Generic Hauling','Junk Removal of Cars']:
            self.assertEqual(relevance.classify_row({'name':name}).reason,'pending_review')
        for name in ['Waste Management and Junk Removal','Auto Salvage and Junk Removal','Freight and Junk Hauling','Garage Cleanouts','Haul Away Unwanted Items','Junk Removal of Cars and Appliance Removal']:
            self.assertEqual(relevance.classify_row({'name':name}).reason,'supported_junk_service')
        self.assertEqual(relevance.classify_row({'name':'Cash for Junk Cars','type':'Junk removal service'}).reason,'pending_review')

    def test_ledger_survives_reopen_and_terminal_cannot_be_requalified(self):
        with tempfile.TemporaryDirectory() as tmp:
            db=str(Path(tmp)/'ledger.db');key=('pid','same')
            Ledger(db).record_lead_eligibility(key,'pending_review')
            self.assertEqual(Ledger(db).lead_eligibility(key),'pending_review')
            Ledger(db).record_lead_eligibility(key,'eligible')
            self.assertEqual(Ledger(db).lead_eligibility(key),'eligible')
            Ledger(db).record_lead_eligibility(key,'terminal')
            Ledger(db).record_lead_eligibility(key,'pending_review')
            self.assertEqual(Ledger(db).lead_eligibility(key),'terminal')
    def test_concurrent_terminal_acknowledgment_cannot_be_overwritten(self):
        from concurrent.futures import ThreadPoolExecutor
        with tempfile.TemporaryDirectory() as tmp:
            ledger=Ledger(str(Path(tmp)/'ledger.db'));key=('pid','concurrent')
            with ThreadPoolExecutor(max_workers=8) as pool:
                futures=[pool.submit(ledger.record_lead_eligibility,key,status) for status in ['pending_review','terminal','eligible','pending_review']*10]
                for future in futures:future.result()
            self.assertEqual(ledger.lead_eligibility(key),'terminal')

    def test_richer_duplicate_does_not_lose_junk_hybrid_category(self):
        rows=[{'name':'Example','place_id':'same','type':'Dumpster rental service','website':'https://example.test','phone':'123'},
              {'name':'Example','place_id':'same','type':'Junk removal service'}]
        merged=mapper.dedup_by_place_id(rows)
        self.assertEqual(len(merged),1)
        self.assertEqual(relevance.classify_row(merged[0]).reason,'supported_junk_service')
        self.assertEqual(set(merged[0]['categories']),{'Dumpster rental service','Junk removal service'})

    def test_identity_unchanged_when_later_junk_category_arrives(self):
        location={'state':'MA','city':'Boston','zip':'02108'}
        old={'name':'Example','place_id':'same','type':'Dumpster rental service'}
        new={**old,'subtypes':'Junk removal service'}
        self.assertEqual(relevance.classify_row(old).reason,'pending_review')
        self.assertEqual(relevance.classify_row(new).reason,'supported_junk_service')
        self.assertEqual(mapper.lead_dedup_key(mapper.to_lead(old,location)),mapper.lead_dedup_key(mapper.to_lead(new,location)))

class JobBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_stale_dumpster_job_is_retired_without_provider_submission(self):
        import server
        from types import SimpleNamespace
        old={k:getattr(server,k) for k in ['LEDGER','cfg','_finalize_target_if_ready','submit_outscraper_search']}
        try:
            calls=[]
            server.LEDGER=SimpleNamespace(submitted_provider_job_count=lambda *a:0,pending_provider_jobs=lambda *a:[{'id':1,'term':'dumpster rental','target_key':'t'}],skip_disallowed_provider_job=lambda id:calls.append(id))
            server.cfg=SimpleNamespace(outscraper_job_concurrency=1)
            server._finalize_target_if_ready=lambda key:None
            async def forbidden(*a,**k):raise AssertionError('Paid call attempted')
            server.submit_outscraper_search=forbidden
            await server._submit_provider_jobs('MA','n',{'queries':0,'accepted':0})
            self.assertEqual(calls,[1])
        finally:
            for k,v in old.items():setattr(server,k,v)
    async def test_archived_acknowledgment_is_terminal_not_retry_failure(self):
        import server
        saved,failed=server._ingest_resolution([{'name':'Example'}],{'results':[{'index':0,'status':'skipped','reason':'archived_identity_preserved'}]})
        self.assertEqual(saved,{0});self.assertEqual(failed,set())
