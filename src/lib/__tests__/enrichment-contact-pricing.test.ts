import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSignalPayload} from '../enrichment-signals-schema.ts';
const at=Date.now();
const fact=(value:unknown)=>({state:'confirmed',value,observedAtMs:at});
function payload() {return {contractVersion:1,runId:'test',attemptId:'test',attemptStartedAtMs:at,checkedAtMs:at,sources:{website:'https://example.test/',place:null},replacements:[],records:[{kind:'route',key:'published-junk-item',serviceScope:'junk_removal',dependency:'website',state:'unknown',outcome:'partial',facts:{'route.instantPricing':fact(true),'route.pricingType':fact('fixed'),'route.pricingShown':fact(true),'route.upfrontContact':fact('no'),'route.emailRequired':{state:'unknown',observedAtMs:at}},proof:{url:'https://example.test/items/junk-removal/','method':'browser_published_booking_path',excerpt:'Junk Removal Price $100.00; no phone/email required before price exploration.'},coverage:{complete:false,reasons:['final_confirmation_unverified']}}]};}
test('receiver accepts fixed junk pricing without asserting self-service or optional email',()=>{
 const parsed=validateSignalPayload(payload(),at);const facts=parsed.records[0].facts;
 assert.equal(facts['route.instantPricing'].value,true);assert.equal(facts['route.emailRequired'].state,'unknown');assert.equal(facts['route.confirmation'],undefined);
});
test('receiver rejects an invalid instant-pricing boolean',()=>{
 const input=payload();input.records[0].facts['route.instantPricing']=fact('yes');assert.throws(()=>validateSignalPayload(input,at));
});
