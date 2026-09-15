import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileLeadGroup, lockLeadGroup, GROUP_REFRESH_LIMIT } from "../lead-group-refresh.ts";
import { newGroupEnvelope, leadGroupSnapshotIssue } from "../lead-group-policy.ts";
import { bindings, T, lead, matches } from "./fixtures/enrichment-signals/reference.ts";
const definition={version:2,expression:{type:'match_all'}};

function fixture(size=5){
    const events:string[]=[];
    const rows=Array.from({length:size},(_,i)=>lead(String(i).padStart(7,'0'),[],{outreachStatus:i===1?'replied':'new'}));
    const state={group:{id:'group',filterDefinition:newGroupEnvelope(definition),lastRefreshedAt:null as Date|null},members:new Set(['obsolete']),otherGroup:new Set(['0000000'])};
    let locked=false;
    const tx:any={
        $queryRaw:async(strings:TemplateStringsArray,id:string)=>{assert.match(strings.join('?'),/FOR UPDATE/);assert.equal(id,'group');events.push('lock');locked=true;},
        leadGroup:{findUnique:async()=>{assert.ok(locked);events.push('read-rules');return state.group;},update:async({data}:any)=>{events.push('ready');Object.assign(state.group,data);return state.group;}},
        scrapedLead:{findMany:async({where,cursor,skip=0,take}:any)=>{const selected=rows.filter(row=>matches(row,where));const start=cursor?selected.findIndex(row=>row.id===cursor.id)+skip:0;return selected.slice(start,start+take).map(({id})=>({id}));}},
        leadGroupMember:{findMany:async()=>[...state.members].map(leadId=>({leadId})),createMany:async({data}:any)=>{data.forEach((row:any)=>state.members.add(row.leadId));return {count:data.length};},deleteMany:async({where}:any)=>{let count=0;where.leadId.in.forEach((id:string)=>{if(state.members.delete(id))count++;});return {count};}},
    };
    return {tx,state,events,rows};
}
test("refresh reconciles all eligible pages, overlapping groups and one matching revision",async()=>{
    const f=fixture(2501);
    const result=await reconcileLeadGroup(f.tx,{groupId:'group',expectedRevision:1,evaluatedAtMs:T,previewCount:2501},bindings,()=>{});
    assert.equal(result.total,2500);assert.equal(f.state.members.size,2500);assert.equal(result.removed,1);
    assert.deepEqual([...f.state.otherGroup],['0000000']);
    assert.equal(f.state.group.filterDefinition.membership.appliedRevision,1);
    assert.equal(f.state.group.filterDefinition.membership.evaluatedAt,T);
    assert.deepEqual(f.events.slice(0,2),['lock','read-rules']);
    assert.equal(result.countChangedSincePreview,true);
    const repeated=await reconcileLeadGroup(f.tx,{groupId:'group',expectedRevision:1,evaluatedAtMs:T},bindings,()=>{});
    assert.equal(repeated.added,0);assert.equal(repeated.removed,0);
});
test("refresh is independent of the 100,000 bulk response cap",async()=>{
    const f=fixture(100002);
    const result=await reconcileLeadGroup(f.tx,{groupId:'group',expectedRevision:1,evaluatedAtMs:T},bindings,()=>{});
    assert.equal(result.total,100001);
    const eligible=f.rows.filter(r=>r.outreachStatus!=='replied').map(r=>r.id);
    const prefix=eligible.slice(0,100000);
    assert.equal(prefix.length,100000);assert.equal(result.total>prefix.length,true);
    assert.deepEqual([...f.state.members].sort(),eligible);
});
test("stale revisions, disabled activation, malformed legacy rules and manual refresh fail closed",async()=>{
    const f=fixture();
    await assert.rejects(reconcileLeadGroup(f.tx,{groupId:'group',expectedRevision:2,evaluatedAtMs:T},bindings,()=>{}),/rules changed/);
    await assert.rejects(reconcileLeadGroup(f.tx,{groupId:'group',expectedRevision:1,evaluatedAtMs:T},bindings,()=>{throw new Error('disabled');}),/disabled/);
    (f.state.group as any).filterDefinition={unknownFilter:'bad'};
    await assert.rejects(reconcileLeadGroup(f.tx,{groupId:'group',evaluatedAtMs:T},bindings,()=>{}),/Unsupported filter/);
    (f.state.group as any).filterDefinition=null;
    await assert.rejects(reconcileLeadGroup(f.tx,{groupId:'group',evaluatedAtMs:T},bindings,()=>{}),/Manual groups/);
    assert.deepEqual([...f.state.members],['obsolete']);
});
test("size/transaction failure never marks a partial audience ready",async()=>{
    const f=fixture();
    f.tx.scrapedLead.findMany=async()=>Array.from({length:1000},(_,i)=>({id:String(i)}));
    await assert.rejects(reconcileLeadGroup(f.tx,{groupId:'group',expectedRevision:1,evaluatedAtMs:T},bindings,()=>{}),/transaction bound/);
    assert.equal(f.state.group.filterDefinition.membership.readiness,'unready');
    assert.deepEqual([...f.state.members],['obsolete']);
});
test("an edit after refresh invalidates future approval without rewriting frozen rules",async()=>{
    const f=fixture();
    await reconcileLeadGroup(f.tx,{groupId:'group',expectedRevision:1,evaluatedAtMs:T},bindings,()=>{});
    const frozen=structuredClone(f.state.group.filterDefinition);
    await lockLeadGroup(f.tx,'group');
    f.state.group.filterDefinition=newGroupEnvelope(definition,2);f.state.group.lastRefreshedAt=null;
    assert.match(leadGroupSnapshotIssue({filterDefinition:f.state.group.filterDefinition,refreshRequired:false,versionCreatedAt:new Date(T),lastRefreshedAt:null})!,/Refresh/);
    assert.equal(frozen.definitionRevision,1);assert.equal(frozen.membership.readiness,'ready');
    await assert.rejects(reconcileLeadGroup(f.tx,{groupId:'group',expectedRevision:1,evaluatedAtMs:T},bindings,()=>{}),/rules changed/);
});

test("real create/refresh/edit routes retain identity after failure and reject stale revisions",async()=>{
    const {isolatedModule,nextResponseMock}=await import('./helpers/isolated-module.ts');
    const filter=await import('../lead-filter.ts'),signals=await import('../enrichment-signals.ts'),definitions=await import('../lead-filter-definition.ts'),refresh=await import('../lead-group-refresh.ts'),policy=await import('../lead-group-policy.ts'),query=await import('../lead-filter-query.ts'),evidence=await import('../enrichment-evidence.ts');
    const f=fixture(5);let creates=0,fail=true;
    const prisma:any={...f.tx,scrapedLead:{...f.tx.scrapedLead,fields:{website:bindings.website,googlePlaceId:bindings.googlePlaceId}},leadGroup:{...f.tx.leadGroup,findUnique:async()=>f.state.group,create:async({data}:any)=>{creates++;Object.assign(f.state.group,data);return f.state.group;}},$transaction:async(fn:any)=>{if(fail)throw new Error('injected transaction unavailable');return fn(f.tx);}};
    const common={'next/server':nextResponseMock,'@prisma/client':{Prisma:{DbNull:bindings.dbNull,JsonNull:bindings.jsonNull}},'@/lib/prisma':{prisma},'@/lib/auth':{getSession:async()=>({user:{id:'admin'}})},'@/lib/lead-filter':filter,'@/lib/enrichment-signals':{...signals,requireSignalsAvailable:()=>{}},'@/lib/lead-filter-definition':definitions,'@/lib/lead-group-refresh':{...refresh,reconcileLeadGroup:(tx:any,input:any,b:any)=>refresh.reconcileLeadGroup(tx,input,b,()=>{})},'@/lib/lead-group-policy':policy,'@/lib/lead-filter-query':query,'@/lib/enrichment-evidence':evidence};
    const secret='test-secret-more-than-32-characters';const at=Date.now();
    const token=query.signEvaluationContext({version:1,user:'admin',hash:evidence.evidenceHash(definition),evaluatedAtMs:at,expiresAtMs:at+15*60000,eligibleCount:4},secret);
    const route=isolatedModule('src/app/api/agents/lead-groups/route.ts',common,{AUTH_SECRET:secret});
    const req=(body:any)=>({json:async()=>body});
    const created=await route.POST(req({name:'Saved fixture',filterDefinition:definition,evaluationContext:token}));
    assert.equal(created.status,201);const data=await created.json();assert.equal(data.id,'group');assert.equal(data.membershipReady,false);assert.equal(data.retryExistingGroup,true);assert.equal(creates,1);
    fail=false;
    const retry=isolatedModule('src/app/api/agents/lead-groups/refresh/route.ts',common,{AUTH_SECRET:secret});
    const result=await retry.POST(req({groupId:data.id,expectedRevision:1,evaluationContext:token}));
    assert.equal(result.status,200);assert.equal((await result.json()).total,4);assert.equal(creates,1);assert.equal(f.state.group.filterDefinition.membership.readiness,'ready');
    const stale=await route.PATCH(req({id:data.id,filterDefinition:definition,expectedRevision:0}));assert.equal(stale.status,409);
    const edited=await route.PATCH(req({id:data.id,filterDefinition:definition,expectedRevision:1}));assert.equal(edited.status,200);assert.equal(f.state.group.filterDefinition.definitionRevision,2);assert.equal(f.state.group.filterDefinition.membership.readiness,'unready');
    const staleRetry=await retry.POST(req({groupId:data.id,expectedRevision:1}));assert.equal(staleRetry.status,409);assert.equal(f.state.group.filterDefinition.membership.readiness,'unready');
});
