import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeSignalRecords, mergeLegacyEvidence, persistSignalMerge, evidenceHash, STORED_SIGNAL_RECORD_BYTES, type StoredSignalRecord } from "../enrichment-evidence.ts";
import {SIGNAL_REGISTRY, SIGNAL_LIMITS} from '../enrichment-signals.ts';
import {validateSignalPayload} from '../enrichment-signals-schema.ts';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/enrichment-signals/payload.json',import.meta.url),'utf8'));
const T=fixture.checkedAtMs;
const source={website:fixture.sources.website,googlePlaceId:fixture.sources.place,signalSourceWebsite:fixture.sources.website,signalSourcePlaceId:fixture.sources.place};
function payload(at:number,id:string,records=fixture.records){const p=structuredClone(fixture);p.attemptId=id;p.attemptStartedAtMs=at;p.checkedAtMs=at+10;p.records=structuredClone(records);p.replacements=[];for(const row of p.records)for(const fact of Object.values(row.facts) as any[]) fact.observedAtMs=at+10;return p;}
test("idempotent delivery, conflicting identity and out-of-order failure/success", () => {
    const first=mergeSignalRecords([],fixture,source,T);
    const repeat=mergeSignalRecords(first.records,fixture,source,T+100);
    assert.deepEqual(repeat.records,first.records);
    const conflict=structuredClone(fixture);conflict.records[0].proof.excerpt='changed';
    assert.throws(()=>mergeSignalRecords(first.records,conflict,source,T+100),/identity reused/);
    const failedRow={...fixture.records[0],state:'unknown',outcome:'failed',facts:{},coverage:{complete:false,reasons:['http_503']}};
    const failure=payload(T+100,'failed',[failedRow]);
    const retained=mergeSignalRecords(first.records,failure,source,T+200).records;
    assert.equal(retained[0].data.facts['website.active'].value,true);
    assert.equal(retained[0].collectionOutcome,'failed');
    assert.equal(retained[0].observedAt!.getTime(),T);
    const missing=mergeSignalRecords([],failure,source,T+200).records;
    const lateSuccess=payload(T+20,'late',[fixture.records[0]]);
    const repaired=mergeSignalRecords(missing,lateSuccess,source,T+200).records;
    assert.equal(repaired[0].state,'confirmed');
    assert.equal(repaired[0].collectionOutcome,'failed');
    assert.equal(repaired[0].data.latestAttempt.id,'failed');
});
test("complete empty clears only its source/scope and old callbacks cannot resurrect it", () => {
    const first=mergeSignalRecords([],fixture,source,T).records;
    const coverage={kind:'coverage',key:'review',serviceScope:'business',dependency:'place',state:'confirmed',outcome:'success',facts:{},proof:{method:'validated_complete_provider_response'},coverage:{complete:true,reasons:[]}};
    const emptySample={...coverage,kind:'review_sample',key:'sample',sample:{datesDescMs:[],datedCount:0,complete:true,limit:50,order:'newest',invalidDateCount:0}};
    const clear=payload(T+100,'clear',[coverage,emptySample]);clear.replacements=[{kind:'review',serviceScope:'business',dependency:'place'}];
    const cleared=mergeSignalRecords(first,clear,source,T+200).records;
    assert.equal(cleared.filter(r=>r.kind==='review').length,0);
    assert.ok(cleared.some(r=>r.kind==='service'));
    const late=payload(T+50,'old',fixture.records.filter((r:any)=>r.kind==='review'));
    const replay=mergeSignalRecords(cleared,late,source,T+200).records;
    assert.equal(replay.filter(r=>r.kind==='review').length,0);
});
test("source changes invalidate old rows immediately; independent place rows survive website replacement", () => {
    const first=mergeSignalRecords([],fixture,source,T).records;
    assert.throws(()=>mergeSignalRecords(first,fixture,{...source,website:'https://new.example/'},T+100),/source differs/);
    const next=payload(T+100,'new-site',[fixture.records[0]]);next.sources.website='https://new.example/';
    const merged=mergeSignalRecords(first,next,{...source,website:next.sources.website},T+200);
    assert.equal(merged.records.filter(r=>r.sourceDependencies.includes('website')).length,1);
    assert.equal(merged.records.filter(r=>r.kind==='review').length,6);
    assert.equal(merged.signalSourceWebsite,next.sources.website);
});
test("legacy sibling merges cannot erase the signal namespace", () => {
    const existing={signals:{contractVersion:1,recordCount:22},legacy:{old:true}};
    assert.deepEqual(mergeLegacyEvidence(existing,{legacy:{new:true},signals:null}),{signals:existing.signals,legacy:{new:true}});
    assert.equal((mergeLegacyEvidence(existing,null) as any).signals,existing.signals);
});
test("injected transaction rolls back lead and projection on a failed write", async () => {
    let committed={records:[] as StoredSignalRecord[],lead:{...source,enrichmentEvidence:{legacy:'old'}} as any};
    async function transaction(fail:boolean){
        const draft=structuredClone(committed);
        const tx={leadEnrichmentRecord:{findMany:async()=>draft.records,deleteMany:async()=>{draft.records=[];},createMany:async(args:any)=>{draft.records.push(...args.data);},updateMany:async()=>{}},scrapedLead:{update:async(args:any)=>{if(fail)throw new Error('injected lead write failure');Object.assign(draft.lead,args.data);}}};
        await persistSignalMerge(tx,'fixture',draft.lead,fixture,{enrichmentEvidence:{legacy:'new'},grade:'A'},T);
        committed=draft;
    }
    const before=evidenceHash(committed);
    await assert.rejects(transaction(true),/injected/);assert.equal(evidenceHash(committed),before);
    await transaction(false);assert.equal(committed.records.length,fixture.records.length);assert.equal(committed.lead.grade,'A');
});

test("partial attempts preserve each retained fact's source and check time", () => {
    const original=structuredClone(fixture.records.find((r:any)=>r.kind==='service'&&r.key==='junk_removal'));
    const first=mergeSignalRecords([],payload(T,'proof-old',[original]),source,T+20).records;
    const partial=structuredClone(original); partial.outcome='partial';partial.coverage={complete:false,reasons:['booking_unresolved']};
    partial.proof={url:'https://booking.example.com/route',excerpt:'New contact route',method:'static_service_route_coverage'};
    partial.facts={'service.offered':{state:'unknown',observedAtMs:T+110},'service.contactForm':{state:'confirmed',value:true,observedAtMs:T+110}};
    const second=mergeSignalRecords(first,payload(T+100,'proof-new',[partial]),source,T+120).records[0];
    assert.equal(second.data.facts['service.offered'].observedAtMs,T+10);
    assert.equal(second.data.factProofDomains!['service.offered'],'example.com');
    assert.equal(second.data.factProofDomains!['service.contactForm'],'booking.example.com');
    assert.equal(second.data.latestAttempt.reasons[0],'booking_unresolved');
});

test("retention eviction removes unsupported service negatives and exact sample coverage", () => {
    const original=mergeSignalRecords([],fixture,source,T).records;
    const example=original.find(row=>row.kind==='review')!;
    const crowded=[...original,...Array.from({length:200},(_,index)=>{const row=structuredClone(example);row.key=`old-${index}`;row.data.key=row.key;row.observedAt=new Date(0);return row;})];
    const merged=mergeSignalRecords(crowded,payload(T+100,'retention',[fixture.records[0]]),source,T+120);
    assert.equal(merged.records.length,200);assert.equal(merged.coverageLost,true);
    const service=merged.records.find(row=>row.kind==='service'&&row.key==='junk_removal')!;
    assert.equal(service.data.facts['service.selfService'].state,'unknown');
    assert.equal(service.data.facts['service.quoteRequest'].state,'unknown');
    assert.equal(service.data.coverage.complete,false);
    assert.equal(merged.records.find(row=>row.kind==='review_sample')!.data.sample!.complete,false);
});

test("targeted correction retires a prior false offering with retry and ordering protection", () => {
    const original=structuredClone(fixture.records.find((r:any)=>r.kind==='service'&&r.key==='junk_removal'));
    const first=mergeSignalRecords([],payload(T,'known-old',[original,...fixture.records.filter((r:any)=>r.kind==='review')]),source,T+20).records;
    const correction=structuredClone(original);correction.outcome='partial';correction.state='unknown';correction.coverage={complete:false,reasons:['service_scope_misclassification']};
    correction.facts={'service.offered':{state:'unknown',observedAtMs:T+110}};
    const next=payload(T+100,'correction',[correction]);
    next.invalidations=[{kind:'service',key:'junk_removal',serviceScope:'junk_removal',dependency:'website',factIds:['service.offered'],priorAttemptId:'known-old',reason:'service_scope_misclassification'}];
    const result=mergeSignalRecords(first,next,source,T+120).records;
    const corrected=result.find(r=>r.kind==='service')!;
    assert.equal(corrected.data.facts['service.offered'].state,'unknown');
    assert.equal(corrected.data.invalidations![0].reason,'service_scope_misclassification');
    assert.deepEqual(result.filter(r=>r.kind==='review'),first.filter(r=>r.kind==='review'));
    assert.deepEqual(mergeSignalRecords(result,next,source,T+130).records,result);
    const late=payload(T+50,'late-old',[original]);
    assert.equal(mergeSignalRecords(result,late,source,T+140).records.find(r=>r.kind==='service')!.data.facts['service.offered'].state,'unknown');
    const mismatch=structuredClone(next);mismatch.attemptId='wrong';mismatch.invalidations[0].priorAttemptId='not-old';
    assert.throws(()=>mergeSignalRecords(first,mismatch,source,T+140),/prior attempt/);
    const corrupt=structuredClone(next);corrupt.records[0].proof.excerpt='different';
    assert.throws(()=>mergeSignalRecords(result,corrupt,source,T+140),/identity reused/);
    const wrongSource={...source,website:'https://other.example/'};
    assert.throws(()=>mergeSignalRecords(first,next,wrongSource,T+140),/source differs/);
});

test("coverage loss clears retained negatives without discarding independent positive evidence", () => {
    const row=structuredClone(fixture.records.find((r:any)=>r.kind==='service'&&r.key==='junk_removal'));
    const first=mergeSignalRecords([],payload(T,'covered',[row]),source,T+20).records;
    const partial=structuredClone(row);partial.outcome='partial';partial.coverage={complete:false,reasons:['dynamic_intake_not_inspected']};
    partial.facts={'service.coverageComplete':{state:'confirmed',value:false,observedAtMs:T+110},'service.selfService':{state:'unknown',observedAtMs:T+110},'service.onlyContactForm':{state:'unknown',observedAtMs:T+110}};
    const result=mergeSignalRecords(first,payload(T+100,'coverage-lost',[partial]),source,T+120).records[0];
    assert.equal(result.data.facts['service.selfService'].state,'unknown');assert.equal(result.data.facts['service.onlyContactForm'].state,'unknown');
    assert.equal(result.data.facts['service.offered'].value,true);assert.equal(result.data.facts['service.contactForm'].value,true);
});

test("failed service recheck retains positive evidence but cannot renew absence coverage", () => {
    const row=structuredClone(fixture.records.find((r:any)=>r.kind==='service'&&r.key==='junk_removal'));
    const old=mergeSignalRecords([],payload(T,'good-service',[row]),source,T+20).records;
    const failed={...row,facts:{},state:'unknown',outcome:'failed',coverage:{complete:false,reasons:['http_403']}};
    const result=mergeSignalRecords(old,payload(T+100,'blocked-service',[failed]),source,T+120).records[0];
    assert.equal(result.data.facts['service.offered'].value,true);
    assert.equal(result.data.facts['service.selfService'].state,'unknown');
    assert.equal(result.data.coverage.complete,false);
    assert.equal(result.data.facts['service.coverageComplete'].value,false);
});

const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length;
function provenancePayload(hostLength:number, sourcePadding=0) {
 const url='https://'+'a'.repeat(hostLength)+'.test/';
 const row={kind:'route',key:'budget',serviceScope:'junk_removal',dependency:'website',state:'unknown',outcome:'partial',facts:Object.fromEntries(Object.values(SIGNAL_REGISTRY).filter(spec=>spec.kind==='route'&&!spec.legacyField).map(spec=>[spec.id,{state:'unknown',observedAtMs:T+10}])),proof:{url,method:'static_service_route_coverage',excerpt:'Reviewed route'},coverage:{complete:false,reasons:['unresolved']}};
 const input=payload(T,'budget',[row]);input.sources.website='https://example.com/'+'x'.repeat(sourcePadding);
 const lead={...source,website:input.sources.website,signalSourceWebsite:input.sources.website};
 return {input,lead};
}
test('valid dense input retains all proof metadata beyond 8 KiB and remains idempotent',()=>{
 const {input,lead}=provenancePayload(120);
 assert.ok(bytes(input.records[0])<SIGNAL_LIMITS.recordBytes);
 const before=structuredClone(input),merged=mergeSignalRecords([],input,lead,T+20);
 assert.ok(bytes(merged.records[0].data)>SIGNAL_LIMITS.recordBytes);
 assert.ok(bytes(merged.records[0].data)<=STORED_SIGNAL_RECORD_BYTES);
 assert.deepEqual(input,before);
 assert.deepEqual(merged.records[0].data.facts,input.records[0].facts);
 for(const id of Object.keys(input.records[0].facts)) assert.deepEqual(merged.records[0].data.proofs![merged.records[0].data.factProofIds![id]],input.records[0].proof);
 assert.deepEqual(mergeSignalRecords(merged.records,input,lead,T+30).records,merged.records);
});
test('stored byte boundary accepts exactly 16 KiB and rejects one additional UTF-8 byte',()=>{
 let selected:any;
 for(let host=100;host<600;host++) {
  const candidate=provenancePayload(host);try { const result=mergeSignalRecords([],candidate.input,candidate.lead,T+20);const size=bytes(result.records[0].data);if(STORED_SIGNAL_RECORD_BYTES-size<100){selected={host,size};break;} } catch {break;}
 }
 assert.ok(selected,'locate a valid near-boundary proof-domain expansion');
 const {input,lead}=provenancePayload(selected.host,STORED_SIGNAL_RECORD_BYTES-selected.size);
 const merged=mergeSignalRecords([],input,lead,T+20);assert.equal(bytes(merged.records[0].data),STORED_SIGNAL_RECORD_BYTES);
 const plusOne=provenancePayload(selected.host,STORED_SIGNAL_RECORD_BYTES-selected.size+1);
 assert.throws(()=>mergeSignalRecords([],plusOne.input,plusOne.lead,T+20),/Retained record/);
 const unicode=structuredClone(merged.records);unicode[0].data.source=unicode[0].data.source!.slice(0,-1)+'é';
 assert.equal(bytes(unicode[0].data),STORED_SIGNAL_RECORD_BYTES+1);
 assert.throws(()=>mergeSignalRecords(unicode,input,lead,T+30),/Retained record/);
 assert.equal(bytes(merged.records[0].data),STORED_SIGNAL_RECORD_BYTES);
});
test('8 KiB input and total payload limits are unchanged; extreme valid metadata fails closed',()=>{
 assert.equal(SIGNAL_LIMITS.recordBytes,8192);assert.equal(SIGNAL_LIMITS.payloadBytes,196608);assert.equal(SIGNAL_LIMITS.records,200);
 const {input,lead}=provenancePayload(1000);assert.ok(bytes(input.records[0])<=8192);validateSignalPayload(input,T+20);
 assert.throws(()=>mergeSignalRecords([],input,lead,T+20),/Retained record/);
 const huge=structuredClone(input);huge.records[0].proof.excerpt='x'.repeat(8192);
 assert.throws(()=>validateSignalPayload(huge,T+20),/Record exceeds byte budget/);
 const oversized=structuredClone(input);oversized.records=Array.from({length:200},()=>input.records[0]);
 assert.throws(()=>validateSignalPayload(oversized,T+20),/Signal payload exceeds byte budget/);
});

test('repeated partial provenance fails atomically at the retained cap without losing earlier evidence',async()=>{
 let current:StoredSignalRecord[]=[];let failedInput:any;let failure:unknown;
 const facts=Object.values(SIGNAL_REGISTRY).filter(spec=>spec.kind==='route'&&spec.type==='boolean'&&spec.id!=='route.bookingLinked');
 for(let index=0;index<facts.length;index++) {
  const at=T+index*100;const row={kind:'route',key:'history',serviceScope:'junk_removal',dependency:'website',state:'confirmed',outcome:'partial',facts:{[facts[index].id]:{state:'confirmed',value:true,observedAtMs:at+10}},proof:{url:'https://example.com/route/'+index,excerpt:'e'.repeat(600),sourceId:'s'.repeat(300),method:'static_service_route_coverage'},coverage:{complete:false,reasons:['unresolved']}};
  const input=payload(at,'history-'+index,[row]);const before=evidenceHash(current);
  assert.ok(bytes(input.records[0])<8192);
  try {current=mergeSignalRecords(current,input,source,at+20).records;}
  catch(error){assert.equal(evidenceHash(current),before);failedInput=input;failure=error;break;}
 }
 assert.ok(failedInput,'repeated independently sourced facts must hit finite retention limit');
 assert.match(String(failure),/route:history:junk_removal: \d+ > 16384 UTF-8 bytes/);
 assert.ok(Object.keys(current[0].data.proofs!).length>1);
 let writes=0;const tx={leadEnrichmentRecord:{findMany:async()=>current,deleteMany:async()=>{writes++;},createMany:async()=>{writes++;},updateMany:async()=>{writes++;}},scrapedLead:{update:async()=>{writes++;}}};
 const prior=evidenceHash(current);
 await assert.rejects(persistSignalMerge(tx,'budget',source,failedInput,{},T+10000),/Retained record/);
 assert.equal(writes,0);assert.equal(evidenceHash(current),prior);
});

// Exercise the persisted lead write, including callback retries, without a database.
async function persistNotesCase(notesFlags:string[], records:any[], extra:Record<string,unknown> = {}, safeData:Record<string,unknown> = {}) {
 const at=Date.now()-1000;
 const input=payload(at,'notes-preservation',records);
 const lead:any={...source,name:'Example Services',categories:[],notesFlags:structuredClone(notesFlags),...extra};
 let stored:StoredSignalRecord[]=[];const writes:any[]=[];
 const key=(r:any)=>`${r.kind}:${r.key}:${r.serviceScope}`;
 const tx={leadEnrichmentRecord:{findMany:async()=>stored,deleteMany:async(args:any)=>{stored=stored.filter(r=>!args.where.OR.some((s:any)=>key(s)===key(r)));},createMany:async(args:any)=>{stored.push(...args.data);},updateMany:async(args:any)=>{const row=stored.find(r=>key(r)===key(args.where));Object.assign(row!,args.data);}},scrapedLead:{update:async(args:any)=>{writes.push(structuredClone(args.data));Object.assign(lead,args.data);}}};
 await persistSignalMerge(tx,'notes-case',lead,input,safeData,at+100);
 const first=structuredClone(lead.notesFlags),recordHash=evidenceHash(stored);
 await persistSignalMerge(tx,'notes-case',lead,input,safeData,at+200);
 assert.deepEqual(lead.notesFlags,first,'retry preserves the first notes result');
 assert.equal(evidenceHash(stored),recordHash,'retry preserves stored evidence');
 return {notes:lead.notesFlags,writes};
}
const offeredJunk=()=>structuredClone(fixture.records.find((r:any)=>r.kind==='service'&&r.key==='junk_removal'));
const unknownJunk=()=>({...offeredJunk(),state:'unknown',outcome:'partial',facts:{'service.offered':{state:'unknown',observedAtMs:T}},coverage:{complete:false,reasons:['unresolved']}});
const offeredDumpster=()=>({...offeredJunk(),key:'dumpster_rental',serviceScope:'dumpster_rental'});
test('website service enrichment preserves legacy visible notes for unknown and mixed junk offerings',async()=>{
 for(const notes of [[],['custom:z','custom:a','custom:z','junk_eligibility:review_context']]) {
  for(const records of [[unknownJunk()],[offeredJunk(),offeredDumpster()]]) {
   const result=await persistNotesCase(notes,records);
   assert.equal(JSON.stringify(result.notes),JSON.stringify(notes));
   assert.ok(result.writes.every(write=>!Object.hasOwn(write,'notesFlags')));
  }
 }
});
test('only explicitly pending prospects promote on supported junk evidence, preserving other notes',async()=>{
 const notes=['custom:z','junk_eligibility:pending_review','custom:z','junk_eligibility:review_context'];
 const result=await persistNotesCase(notes,[offeredJunk(),offeredDumpster()]);
 assert.deepEqual(result.notes,['custom:z','junk_eligibility:eligible','custom:z','junk_eligibility:review_context']);
 assert.ok(!Object.hasOwn(result.writes[1],'notesFlags'),'retry does not reclassify an eligible lead');
 for(const records of [[unknownJunk()],[offeredDumpster()]]) {
  const held=await persistNotesCase(notes,records);
  assert.deepEqual(held.notes,notes);assert.ok(held.writes.every(write=>!Object.hasOwn(write,'notesFlags')));
 }
});
test('enrichment cannot change suppressed, dumpster-only, client, franchise or already eligible visibility',async()=>{
 for(const flags of [['junk_eligibility:suppressed'],['junk_eligibility:dumpster_only'],['junk_eligibility:eligible'],['junk_eligibility:pending_review','junk_eligibility:suppressed'],['junk_eligibility:pending_review','junk_eligibility:dumpster_only']]) {
  for(const records of [[offeredJunk()],[unknownJunk()]]) {
   const notes=['custom:z',...flags,'custom:z'];const result=await persistNotesCase(notes,records);
   assert.deepEqual(result.notes,notes);assert.ok(result.writes.every(write=>!Object.hasOwn(write,'notesFlags')));
  }
 }
 for(const notes of [[],['junk_eligibility:pending_review']]) {
  const result=await persistNotesCase(notes,[offeredJunk()],{isExistingClient:true});assert.deepEqual(result.notes,notes);
  assert.ok(result.writes.every(write=>!Object.hasOwn(write,'notesFlags')));
 }
 const notes=['junk_eligibility:pending_review'];
 const franchise=await persistNotesCase(notes,[offeredJunk()],{name:'Junk King Example'});
 assert.deepEqual(franchise.notes,notes);assert.ok(franchise.writes.every(write=>!Object.hasOwn(write,'notesFlags')));
});
test('pending promotion cannot overwrite conflicting callback suppression or invent missing notes',async()=>{
 for(const incoming of [['junk_eligibility:suppressed'],[],['junk_eligibility:pending_review','junk_eligibility:dumpster_only']]) {
  const result=await persistNotesCase(['junk_eligibility:pending_review'],[offeredJunk()],{},{notesFlags:incoming});
  assert.deepEqual(result.notes,incoming);
 }
});
