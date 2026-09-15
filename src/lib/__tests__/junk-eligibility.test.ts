import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyJunkEligibility as classify,eligibilityNotes,preserveEligibilityNotes,junkEligibilityWhere} from '../junk-eligibility.ts';
import {getRuleDecision,getIntakeEligibility} from '../lead-classify.ts';
const now=Date.now(); const website='https://example.test/';
function service(scope:string,value:boolean,extra:Record<string,unknown>={}) {return {serviceScope:scope,data:{kind:'service',serviceScope:scope,source:website,state:'confirmed',facts:{'service.offered':{state:'confirmed',value,observedAtMs:now}},proof:{url:website,excerpt:'Reviewed all published service routes.',method:'reviewed_service_coverage'},coverage:{complete:true},...extra}};}
const complete={name:'Example Dumpsters',website,enrichmentRecords:[service('junk_removal',false),service('dumpster_rental',true)]};
test('default false, type and missing category cannot establish dumpster-only',()=>{
 for(const input of [{name:'Example',offersJunkRemoval:false,offersDumpsterRental:true},{name:'Example',companyType:'dumpster_rental',serviceTypes:['dumpster_rental'],categories:['Dumpster rental service']}]) assert.equal(classify(input,now).status,'pending_review');
});
test('junk plus ANY other service qualifies, including dumpsters and old deny categories',()=>{
 for(const other of ['Dumpster rental service','Junkyard','Auto parts store','Landscaper','Moving service']) assert.equal(classify({name:'Example',categories:['Junk removal service',other]},now).status,'eligible');
});
test('complete current sourced no-junk plus dumpster is the dumpster-only boundary',()=>{
 assert.equal(classify(complete,now).status,'dumpster_only');
 for(const override of [{coverage:{complete:false}},{state:'unknown'},{source:'https://old.test/'},{proof:{url:website,excerpt:'Default false',method:'model_guess'}},{facts:{'service.offered':{state:'unknown',value:false,observedAtMs:now}}},{facts:{'service.offered':{state:'confirmed',value:false,observedAtMs:now-8*86400000}}}]) assert.equal(classify({...complete,enrichmentRecords:[service('junk_removal',false,override),service('dumpster_rental',true)]},now).status,'pending_review');
});
test('conflicting junk evidence prevents an archive',()=>{assert.equal(classify({...complete,categories:['Junk removal service']},now).status,'pending_review');});
test('pending can be promoted by later evidence using the same identity',()=>{
 const lead={id:'same',name:'Example',website,notesFlags:['manual_note','junk_eligibility:pending_review']};
 const decision=classify({...lead,enrichmentRecords:[service('junk_removal',true)]},now);
 assert.equal(decision.status,'eligible');assert.deepEqual(eligibilityNotes(lead.notesFlags,decision),['manual_note','junk_eligibility:eligible']);
});
test('intake and cleaner share the service boundary',()=>{
 for(const candidate of [complete,{name:'Example'}, {name:'Junk Removal + Dumpster Rentals'}]) {
  const lead={id:'one',...candidate};const intake=getIntakeEligibility(lead);const clean=getRuleDecision(lead)!;
  assert.equal(clean.judged,intake.status!=='pending_review');
  assert.equal(clean.verdict,intake.status==='dumpster_only'?'reject':'keep');
 }
});
test('archive/client/franchise/custom suppression is not erased',()=>{
 assert.equal(classify({name:'Junk removal',archivedAt:new Date()},now).reason,'archived_identity_preserved');
 assert.equal(getIntakeEligibility({id:'one',name:'Junk removal',isExistingClient:true}).status,'suppressed');
 assert.equal(getIntakeEligibility({id:'one',name:'Junk King of Denver'}).status,'suppressed');
 assert.equal(getIntakeEligibility({id:'one',name:'Junk removal',notesFlags:['junk_eligibility:suppressed']}).status,'suppressed');
 assert.deepEqual(preserveEligibilityNotes(['junk_eligibility:pending_review'],['new note','junk_eligibility:eligible']),['new note','junk_eligibility:pending_review']);
});
test('active default excludes only explicit inactive markers; legacy remains reviewable',()=>{
 assert.deepEqual(junkEligibilityWhere(),{NOT:{notesFlags:{hasSome:['junk_eligibility:pending_review','junk_eligibility:dumpster_only','junk_eligibility:suppressed']}}});
 assert.deepEqual(junkEligibilityWhere('pending_review'),{notesFlags:{has:'junk_eligibility:pending_review'}});
 assert.deepEqual(junkEligibilityWhere('all'),{});
});
test('routine trash, waste management, freight, materials and junk cars alone are pending',()=>{
 for(const name of ['Metro Trash Pickup','Metro Waste Management','Fast Freight Hauling','Aggregate Hauling','Material Delivery','Car Towing','Cash for Junk Cars','Junk Car Removal','Junk Removal of Cars','Generic Hauling']) assert.equal(classify({name},now).status,'pending_review',name);
});
test('clear household haul-away and cleanouts qualify alongside other services',()=>{
 for(const name of ['Waste Management & Junk Removal','Freight and Junk Hauling','Auto Salvage & Junk Removal','Haul Away Unwanted Items','Garage Cleanouts','Appliance Removal','Junk Removal of Cars and Appliance Removal']) assert.equal(classify({name},now).status,'eligible',name);
});
test('loose junk category cannot override conflicting car or freight identity; actual service evidence can',()=>{
 for(const name of ['Cash for Junk Cars','Freight Hauling','Municipal Waste']) {
  const candidate={name,website,categories:['Junk removal service']};
  assert.equal(classify(candidate,now).status,'pending_review');
  assert.equal(classify({...candidate,enrichmentRecords:[service('junk_removal',true)]},now).status,'eligible');
 }
});
