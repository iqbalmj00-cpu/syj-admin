import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedModule,nextResponseMock} from './helpers/isolated-module.ts';
import * as eligibility from '../junk-eligibility.ts';
import * as website from '../lead-website.ts';
import * as schema from '../enrichment-signals-schema.ts';
import * as signals from '../enrichment-signals.ts';
import * as evidence from '../enrichment-evidence.ts';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/enrichment-signals/payload.json',import.meta.url),'utf8'));
function synthetic() {
    const lead:any={id:'transaction-fixture',name:'Example Services',website:fixture.sources.website,googlePlaceId:fixture.sources.place,signalSourceWebsite:fixture.sources.website,signalSourcePlaceId:fixture.sources.place,notesFlags:[],archivedAt:null,enrichmentEvidence:{legacy:'retained'}};
    lead.enrichmentRecords=evidence.mergeSignalRecords([],fixture,lead,fixture.checkedAtMs).records;
    const input=structuredClone(fixture);input.attemptId='transaction-fixture-next';input.attemptStartedAtMs=Date.now()-1000;input.checkedAtMs=Date.now()-900;
    for(const row of input.records)for(const fact of Object.values(row.facts) as any[])fact.observedAtMs=input.checkedAtMs;
    return {lead,callback:{leadId:lead.id,data:{enrichmentEvidence:{signals:input},websiteScore:80}}};
}
function harness(initial:any,writeCostMs=300,overrideTimeout?:number) {
    const source=structuredClone(initial);const records=(source.enrichmentRecords||[]).map((r:any)=>({...r,observedAt:r.observedAt?new Date(r.observedAt):null,eventAt:r.eventAt?new Date(r.eventAt):null}));delete source.enrichmentRecords;
    let committed={lead:source,records};let transactions=0,commits=0,rollbacks=0,lastCost=0,lastWrites=0;const options:any[]=[];
    const key=(r:any)=>`${r.kind}:${r.key}:${r.serviceScope}`;
    const prisma:any={scrapedLead:{findUnique:async()=>committed.lead},adminSetting:{findUnique:async()=>null},$transaction:async(fn:any,settings:any)=>{
        transactions++;options.push(structuredClone(settings));const draft=structuredClone(committed);let elapsed=0,writes=0,locked=false;
        const write=()=>{assert.ok(locked);elapsed+=writeCostMs;writes++;if(elapsed>(overrideTimeout??settings.timeout??5000))throw Object.assign(new Error('Transaction API error: expired transaction'),{name:'PrismaClientKnownRequestError',code:'P2028'});};
        const tx={$queryRaw:async()=>{locked=true;},scrapedLead:{findUnique:async()=>draft.lead,update:async({data}:any)=>{write();Object.assign(draft.lead,data);}},leadEnrichmentRecord:{findMany:async()=>draft.records,deleteMany:async({where}:any)=>{write();draft.records=draft.records.filter((r:any)=>!where.OR.some((s:any)=>key(s)===key(r)));},createMany:async({data}:any)=>{write();draft.records.push(...structuredClone(data));},updateMany:async({where,data}:any)=>{write();const row=draft.records.find((r:any)=>key(r)===key(where));assert.ok(row);Object.assign(row,data);}}};
        try {const result=await fn(tx);committed=draft;commits++;return result;} catch(error){rollbacks++;throw error;} finally {lastCost=elapsed;lastWrites=writes;}
    }};
    const mod=isolatedModule('src/app/api/agents/enrichment-results/route.ts',{'@/lib/junk-eligibility':eligibility,'@/lib/lead-website':website,'@/lib/enrichment-signals-schema':schema,'@/lib/enrichment-signals':signals,'@/lib/enrichment-evidence':evidence,'next/server':nextResponseMock,'@/lib/prisma':{prisma},'@/lib/lead-cleaner-db':{isLeadCleanerSchemaReady:async()=>false}},{AGENT_CALLBACK_SECRET:'fixture-only-secret'});
    return {send:(callback:any)=>mod.POST({json:async()=>({secret:'fixture-only-secret',action:'enrich',version:'v2',...structuredClone(callback)})}),state:()=>structuredClone(committed),stats:()=>({transactions,commits,rollbacks,lastCost,lastWrites,options})};
}
async function verifyAtomicBudget(lead:any,callback:any,writeCostMs:number) {
    const old=harness(lead,writeCostMs,5000),before=evidence.evidenceHash(old.state());
    const rejected=await old.send(callback);assert.equal(rejected.status,500);assert.equal((await rejected.json()).detail.code,'P2028');assert.equal(evidence.evidenceHash(old.state()),before);assert.ok(old.stats().lastWrites>1);assert.equal(old.stats().commits,0);
    const fixed=harness(lead,writeCostMs);const accepted=await fixed.send(callback);assert.equal(accepted.status,200,JSON.stringify(await accepted.clone().json()));assert.equal(fixed.stats().options[0].timeout,30000);assert.equal(fixed.stats().options[0].isolationLevel,'Serializable');assert.ok(fixed.stats().lastCost>5000&&fixed.stats().lastCost<=30000);
    const state=fixed.state(),firstStats=fixed.stats();assert.deepEqual(state.lead.notesFlags,lead.notesFlags);
    for(const field of ['archivedAt','archiveReason','archiveSource','isExistingClient'])assert.deepEqual(state.lead[field],lead[field]);
    const repeat=await fixed.send(callback);assert.equal(repeat.status,200);const retried=fixed.state();assert.equal(evidence.evidenceHash(retried.records),evidence.evidenceHash(state.records));
    delete retried.lead.enrichedAt;delete state.lead.enrichedAt;assert.equal(evidence.evidenceHash(retried.lead),evidence.evidenceHash(state.lead));assert.equal(fixed.stats().lastWrites,1,'idempotent retry performs only the lead write');
    const expired=harness(lead,3000);const original=evidence.evidenceHash(expired.state());const timedOut=await expired.send(callback);assert.equal(timedOut.status,500);assert.equal((await timedOut.json()).detail.code,'P2028');assert.equal(evidence.evidenceHash(expired.state()),original);assert.equal(expired.stats().commits,0);assert.equal(expired.stats().rollbacks,1);
    return {payloadCanonicalHash:evidence.evidenceHash(callback),successfulVirtualMs:firstStats.lastCost,successfulWriteCalls:firstStats.lastWrites,oldBudgetRollback:true,newBudgetRollback:true,idempotent:true};
}
test('receiver bounded signal budget accepts multirow work over 5s and preserves atomic timeout rollback and retry',async()=>{
    const {lead,callback}=synthetic();await verifyAtomicBudget(lead,callback,300);
});
test('receiver retains the 5s legacy budget and existing archive/source guards',async()=>{
    const {lead,callback}=synthetic();const legacy=harness(lead);assert.equal((await legacy.send({leadId:lead.id,data:{websiteScore:70}})).status,200);assert.equal(legacy.stats().options[0].timeout,5000);
    const archived=harness({...lead,archivedAt:new Date()});const original=evidence.evidenceHash(archived.state());assert.equal((await archived.send(callback)).status,409);assert.equal(archived.stats().transactions,0);assert.equal(evidence.evidenceHash(archived.state()),original);
    const changed=harness({...lead,website:'https://changed.example/'});const prior=evidence.evidenceHash(changed.state());assert.equal((await changed.send(callback)).status,409);assert.equal(evidence.evidenceHash(changed.state()),prior);assert.equal(changed.stats().commits,0);
});
const captureDir=process.env.ENRICHMENT_TIMEOUT_CAPTURE_DIR;
test('exact captured normal callback passes actual receiver with rollback and idempotency checks',{skip:!captureDir},async t=>{
    const lead=JSON.parse(readFileSync(join(captureDir!,'before.json'),'utf8')).lead;
    const callback=JSON.parse(readFileSync(join(captureDir!,'scoped-result.json'),'utf8'));
    const result=await verifyAtomicBudget(lead,callback,100);t.diagnostic(JSON.stringify(result));
});
