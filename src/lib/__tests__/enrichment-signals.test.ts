import * as junkEligibility from "../junk-eligibility.ts";
import * as leadClassify from "../lead-classify.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSignalPayload } from "../enrichment-signals-schema.ts";
import { SIGNAL_REGISTRY } from "../enrichment-signals.ts";
const fixture = JSON.parse(readFileSync(new URL('./fixtures/enrichment-signals/payload.json',import.meta.url),'utf8'));
test("committed worker-generated contract fixture validates", () => {
    assert.equal(validateSignalPayload(fixture,fixture.checkedAtMs).records.length,23);
    // Optional cross-repository parity check; the standalone dashboard suite is portable.
    if (process.env.ENRICHMENT_WORKER_CONTRACT_FIXTURE) {
        const worker = readFileSync(process.env.ENRICHMENT_WORKER_CONTRACT_FIXTURE, "utf8");
        assert.deepEqual(JSON.parse(worker), fixture);
    }
    for(const row of fixture.records) for(const id of Object.keys(row.facts)) assert.ok(SIGNAL_REGISTRY[id]);
});
test("nested contract rejects malformed versions, nulls, keys, types and future clocks", () => {
    const corruptions = [
        (p:any)=>p.contractVersion=2,
        (p:any)=>p.records[0].facts['website.active'].value='false',
        (p:any)=>p.records[0].facts['website.active'].observedAtMs=p.checkedAtMs+1,
        (p:any)=>p.checkedAtMs=p.attemptStartedAtMs-1,
        (p:any)=>p.records[0].facts['website.active'].surprise='x',
        (p:any)=>p.records[0].proof.url='javascript:alert(1)',
        (p:any)=>p.records[0].facts['website.active'].value=null,
        (p:any)=>p.records.push(p.records[0]),
        (p:any)=>p.records[0].proof.excerpt='x'.repeat(601),
        (p:any)=>p.records[0].outcome='failed',
        (p:any)=>p.sources.extra='unsafe',
    ];
    for(const corrupt of corruptions){const input=structuredClone(fixture);corrupt(input);assert.throws(()=>validateSignalPayload(input,fixture.checkedAtMs));}
});
test("negative service assertions, complete counts and self-service require sufficient proof", () => {
    const input=structuredClone(fixture);
    const service=input.records.find((r:any)=>r.kind==='service'&&r.key==='junk_removal');
    service.coverage.complete=false;service.coverage.reasons=['blocked'];service.outcome='partial';
    assert.throws(()=>validateSignalPayload(input,fixture.checkedAtMs),/Negative\/ONLY/);
    const badSample=structuredClone(fixture);
    badSample.records.find((r:any)=>r.kind==='review_sample').sample.complete=true;
    assert.throws(()=>validateSignalPayload(badSample,fixture.checkedAtMs),/upper bound/);
    const badRoute=structuredClone(fixture);
    const route=badRoute.records.find((r:any)=>r.kind==='route');
    route.facts['route.method'].value='self_service';
    assert.throws(()=>validateSignalPayload(badRoute,fixture.checkedAtMs),/Self-service/);
});

test("receiver accepts the underscore field and protects disabled signals and legacy namespaces", async () => {
    const {isolatedModule,nextResponseMock}=await import('./helpers/isolated-module.ts');
    const website=await import('../lead-website.ts'), schema=await import('../enrichment-signals-schema.ts'), signals=await import('../enrichment-signals.ts'), evidence=await import('../enrichment-evidence.ts');
    let writes:any[]=[];let reads=0;let locked=false;
    const current={id:'lead',website:'https://example.com/',googlePlaceId:'place',archivedAt:null,cleanedAt:new Date(),signalSourceWebsite:null,signalSourcePlaceId:null,enrichmentEvidence:{signals:{recordCount:2},legacy:'old'}};
    const prisma:any={scrapedLead:{findUnique:async()=>{reads++;return current;},update:async({data}:any)=>{assert.ok(locked);writes.push(data);}},adminSetting:{findUnique:async()=>null},$queryRaw:async()=>{locked=true;},$transaction:async(fn:any)=>fn(prisma)};
    const route=isolatedModule('src/app/api/agents/enrichment-results/route.ts',{'@/lib/junk-eligibility':junkEligibility,'@/lib/lead-classify':leadClassify,'next/server':nextResponseMock,'@/lib/prisma':{prisma},'@/lib/lead-website':website,'@/lib/lead-cleaner-db':{isLeadCleanerSchemaReady:async()=>false},'@/lib/enrichment-signals-schema':schema,'@/lib/enrichment-signals':{...signals,requireSignalsAvailable:()=>{throw new signals.SignalFeatureUnavailable();}},'@/lib/enrichment-evidence':evidence},{AGENT_CALLBACK_SECRET:'fixture'});
    const send=(data:any,version='v2')=>route.POST({json:async()=>({secret:'fixture',leadId:'lead',action:'enrich',version,data})});
    const disabled=await send({enrichmentEvidence:{signals:fixture}});assert.equal(disabled.status,503);assert.equal(reads,0);assert.equal(writes.length,0);
    const accepted=await send({isOpen24_7:true,enrichmentEvidence:{legacy:'new'}});
    assert.equal(accepted.status,200);const body=await accepted.json();assert.ok(body.acceptedFields.includes('isOpen24_7'));
    assert.equal(writes[0].isOpen24_7,true);assert.equal(writes[0].enrichmentEvidence.signals.recordCount,2);
    const invalid=await send({isOpen24_7:true,unsupportedField:1});assert.equal(invalid.status,400);assert.equal(writes.length,1);
    current.website='https://gmail.com/';const bad=await send({isOpen24_7:true});assert.equal(bad.status,409);assert.equal(writes.length,1);
});

test("field inventory covers the actual receiver, including underscores, and fixed JSON theme counts", () => {
    const source=readFileSync('src/app/api/agents/enrichment-results/route.ts','utf8').split('const ALLOWED_FIELDS = new Set([')[1].split(']);')[0];
    const keys=[...source.matchAll(/"([A-Za-z][A-Za-z0-9_]+)"/g)].map(match=>match[1]);
    const leadSchema=readFileSync(new URL('../../../prisma/schema.prisma',import.meta.url),'utf8').split('model ScrapedLead {')[1].split('\n}')[0];
    const columns=new Set([...leadSchema.matchAll(/^\s*(\w+)\s+\w+/gm)].map(match=>match[1]));
    assert.equal(keys.length,211);
    assert.equal(new Set(keys).size,keys.length);
    for(const field of keys) assert.ok(columns.has(field),`Receiver field ${field} is absent from the checked-in Prisma schema`);
    assert.equal(SIGNAL_REGISTRY['legacy.isOpen24_7'].type,'boolean');
    assert.deepEqual(SIGNAL_REGISTRY['legacy.painTagCounts.missed_calls'].legacyJsonPath,['missed_calls']);
});
