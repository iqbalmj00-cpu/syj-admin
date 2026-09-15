import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedModule,nextResponseMock} from './helpers/isolated-module.ts';
import * as eligibility from '../junk-eligibility.ts';
import * as classify from '../lead-classify.ts';
import * as website from '../lead-website.ts';
import * as geography from '../lead-geography.ts';
const imports={'next/server':nextResponseMock,'@prisma/client':{Prisma:{}},'@/lib/auth':{getSession:async()=>({user:{email:'test'}})},'@/lib/junk-eligibility':eligibility,'@/lib/lead-classify':classify,'@/lib/lead-website':website,'@/lib/lead-geography':geography,'@/lib/lead-cleaner-db':{},'@/lib/lead-deletion':{},'@/lib/lead-filter-query':{},'@/lib/enrichment-evidence':{},'@/lib/enrichment-signals':{},'@/lib/lead-filter-definition':{}};
function routeFor(scrapedLead:any, transaction?:any) {
 const prisma={scrapedLead,$transaction:transaction || (async (callback:any,options:any)=>{assert.equal(options.isolationLevel,'Serializable');return callback({scrapedLead});})};
 return isolatedModule('src/app/api/agents/leads/route.ts',{...imports,'@/lib/prisma':{prisma}});
}
const send=(route:any,lead:any)=>route.POST({json:async()=>({leads:[lead]})}).then((r:any)=>r.json());
const lead={name:'Example',market:'Boston',state:'MA',googlePlaceId:'same'};
test('actual intake preserves archived identity without a write',async()=>{
 let writes=0;const row={...lead,id:'one',archivedAt:new Date()};
 const route=routeFor({findUnique:async()=>row,updateMany:async()=>{writes++;},create:async()=>{writes++;}});
 const result=await send(route,lead);assert.equal(result.results[0].reason,'archived_identity_preserved');assert.equal(writes,0);
});
test('actual pending intake promotes the same identity when junk evidence arrives and preserves unrelated notes',async()=>{
 const row={...lead,id:'one',archivedAt:null,updatedAt:new Date(),categories:['Dumpster rental service'],notesFlags:['reviewed website','junk_eligibility:pending_review']};let update:any;
 const route=routeFor({findUnique:async()=>row,updateMany:async(args:any)=>{update=args;return {count:1};}});
 const result=await send(route,{...lead,categories:['Junk removal service']});
 assert.equal(result.results[0].id,'one');assert.equal(result.results[0].reason,'eligibility:eligible');
 assert.deepEqual(JSON.parse(JSON.stringify(update.data.notesFlags)),['reviewed website','junk_eligibility:eligible']);
 assert.equal(update.where.archivedAt,null);assert.equal(update.where.updatedAt,row.updatedAt);
});
test('concurrent archive or update is not overwritten and remains retryable',async()=>{
 const row={...lead,id:'one',archivedAt:null,updatedAt:new Date(),categories:[],notesFlags:[]};
 const route=routeFor({findUnique:async()=>row,updateMany:async()=>({count:0})});
 const result=await send(route,lead);assert.equal(result.updated,0);assert.equal(result.results[0].reason,'write_failed');
});
test('repeat intake leaves unmarked legacy unknowns visible',async()=>{
 let update:any;const row={...lead,id:'legacy',archivedAt:null,updatedAt:new Date(),categories:[],notesFlags:['manual note']};
 const result=await send(routeFor({findUnique:async()=>row,updateMany:async(args:any)=>{update=args;return {count:1};}}),lead);
 assert.equal(result.updated,1);assert.deepEqual(update.data.notesFlags,['manual note']);
});
test('new unknowns are explicitly pending and reviewable',async()=>{
 let created:any;
 const result=await send(routeFor({findUnique:async()=>null,findMany:async()=>[],create:async(args:any)=>{created=args.data;return {id:'new'};}}),lead);
 assert.equal(result.created,1);assert.deepEqual(created.notesFlags,['junk_eligibility:pending_review']);
});
test('incoming false and notes cannot erase existing client suppression',async()=>{
 let update:any;const row={...lead,id:'client',isExistingClient:true,archivedAt:null,updatedAt:new Date(),notesFlags:['junk_eligibility:suppressed'],categories:[]};
 const result=await send(routeFor({findUnique:async()=>row,updateMany:async(args:any)=>{update=args;return {count:1};}}),{...lead,name:'Junk Removal',isExistingClient:false,notesFlags:['new note']});
 assert.equal(result.results[0].reason,'eligibility:suppressed');assert.equal(update.data.isExistingClient,true);assert.ok(update.data.notesFlags.includes('junk_eligibility:suppressed'));
});
test('archived fallback identity is found without place ID, including casing and phone formatting',async()=>{
 let query:any;const row={...lead,name:'EXAMPLE',state:'ma',phone:'(617) 555-1234',id:'archived',archivedAt:new Date()};
 const result=await send(routeFor({findMany:async(args:any)=>{query=args;return [row];}}),{...lead,googlePlaceId:null,phone:'6175551234'});
 assert.equal(result.results[0].reason,'archived_identity_preserved');assert.equal(query.where.OR[0].name.mode,'insensitive');assert.equal(query.where.archivedAt,undefined);
});
test('serialization conflicts are retryable and no success is reported before commit',async()=>{
 const result=await send(routeFor({},async (_callback:any,options:any)=>{assert.equal(options.isolationLevel,'Serializable');throw new Error('could not serialize concurrent identity creation');}),lead);
 assert.equal(result.created,0);assert.equal(result.results[0].reason,'write_failed');
});

test('archived fallback after the first page cannot be recreated',async()=>{
 let reads=0;const archived={name:'A & B',market:'Boston',state:'MA',phone:'6175551234',id:'last',archivedAt:new Date()};
 const route=routeFor({findMany:async(args:any)=>{reads++;if(reads===1){assert.equal(args.where.OR[0].name.contains,'a');return Array.from({length:50},(_,i)=>({...archived,id:String(i),name:'Another business'}));}assert.equal(args.cursor.id,'49');return [archived];}});
 const result=await send(route,{...archived,googlePlaceId:null,name:'A and B',archivedAt:undefined});
 assert.equal(result.results[0].reason,'archived_identity_preserved');assert.equal(reads,2);
});
