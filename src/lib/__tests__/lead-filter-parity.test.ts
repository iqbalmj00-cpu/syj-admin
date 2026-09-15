import * as junkEligibility from "../junk-eligibility.ts";
import * as leadClassify from "../lead-classify.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSignalFilter, buildSavedLeadQuery, groupEligibleWhere, parseLeadQuery } from "../lead-filter-query.ts";
import { LEAD_SIGNAL_RECIPES, type FilterExpression, type SignalPredicate } from "../lead-filter-definition.ts";
import { bindings, T, source, known, record, lead, matches, reference } from "./fixtures/enrichment-signals/reference.ts";
import { DAY_MS } from "../enrichment-signals.ts";
const p = (signal:string,op:SignalPredicate["op"],value?:SignalPredicate["value"],extra={}) => ({type:"predicate",signal,op,...(value === undefined ? {} : {value}),...extra}) as SignalPredicate;
function parity(expression:FilterExpression, leads:any[], at=T) {
    const query=compileSignalFilter({version:2,expression},at,bindings);
    for (const row of leads) {
        const expected=reference(expression,row,at), yes=matches(row,query.pair.yes), no=matches(row,query.pair.no);
        assert.equal(yes && no,false,`overlapping TRUE/FALSE for ${row.id}`);
        assert.equal(yes ? "true" : no ? "false" : "unknown",expected,`${row.id} ${JSON.stringify(expression)}`);
    }
    return leads.filter(row => matches(row,query.where)).map(row => row.id);
}
test("source guards are per OR branch and missing/null evidence stays unknown", () => {
    const website=record('signal','website.active',{'website.active':known(true)});
    const review=record('review','r',{'review.date':{...known(T-DAY_MS),eventMinMs:T-DAY_MS,eventMaxMs:T-DAY_MS}},'business','place');
    const rows=[lead('both',[website,review]),lead('website_changed',[website,review],{website:'https://changed.example/'}),lead('missing'),lead('null_data',[{...website,data:null}]),lead('null_fact',[{...website,data:{facts:{'website.active':{...known(null)}}}}])];
    const expression:FilterExpression={type:'any',children:[p('website.active','eq',true),p('review.date','recent',undefined,{days:90})]};
    assert.deepEqual(parity(expression,rows),['both','website_changed']);
    assert.deepEqual(parity(p('website.active','eq',false),rows),[]);
    assert.deepEqual(parity(p('website.active','unknown'),rows),['website_changed','missing','null_data','null_fact']);
});
test("bounded numeric ranges, stale facts, inferred states and old claims", () => {
    const rows=[0,1,3,4].map(n=>lead(String(n),[record('signal','fleet.trucks',{'fleet.trucks':known(n)})]));
    rows.push(lead('unbounded',[record('signal','fleet.trucks',{'fleet.trucks':{state:'confirmed',observedAtMs:T,lower:1}})]));
    rows.push(lead('overlap',[record('signal','fleet.trucks',{'fleet.trucks':{state:'confirmed',observedAtMs:T,lower:1,upper:4}})]));
    rows.push(lead('stale',[record('signal','fleet.trucks',{'fleet.trucks':known(2,T-31*DAY_MS)})]));
    rows.push(lead('old_claim',[record('signal','fleet.trucks',{'fleet.trucks':{...known(2),eventMinMs:T-365*DAY_MS,eventMaxMs:T-365*DAY_MS}})]));
    assert.deepEqual(parity(p('fleet.trucks','between',undefined,{min:1,max:3}),rows),['1','3']);
    assert.deepEqual(parity(p('fleet.trucks','stale'),rows),['stale','old_claim']);
});
test("complaint and recent date must be in the same review", () => {
    const review=(id:string,date:number,tags:string[])=>record('review',id,{'review.date':{...known(date),eventMinMs:date,eventMaxMs:date},'review.complaints':known(tags)},'business','place');
    const rows=[lead('split',[review('a',T-100*DAY_MS,['missed_calls']),review('b',T-DAY_MS,['damage'])],{reviewCount:100}),lead('same',[review('a',T-DAY_MS,['missed_calls'])]),lead('none')];
    const expression:FilterExpression={type:'scope',kind:'review',scope:'business',expression:{type:'all',children:[p('review.date','recent',undefined,{days:90}),p('review.complaints','in',['missed_calls'])]}};
    assert.deepEqual(parity(expression,rows),['same']);
});
test("hybrid is BOTH offerings plus EITHER independently verified gap", () => {
    const service=(scope:string,selfService?:boolean)=>record('service',scope,{'service.offered':known(true),'service.selfService':selfService === undefined ? {state:'unknown',observedAtMs:T} : known(selfService)},scope,"website",selfService === false);
    const activity=record('activity','post',{'activity.date':{...known(T),eventMinMs:T,eventMaxMs:T}},'business','place');
    const rows=[lead('either',[service('junk_removal',false),service('dumpster_rental'),activity]),lead('neither',[service('junk_removal',true),service('dumpster_rental',true),activity]),lead('one_service',[service('junk_removal',false),activity])];
    assert.deepEqual(parity(LEAD_SIGNAL_RECIPES[2].definition.expression,rows),['either']);
});
test("ordinal counts age at query time and preserve incomplete upper-bound unknown", () => {
    const rows:any[]=[];
    for (const complete of [false,true]) for (let count=0;count<=8;count++) {
        const sample=record('review_sample','sample',{},'business','place');
        (sample.data as any).sample={datesDescMs:Array.from({length:count},(_,i)=>T-(i<6?1:100)*DAY_MS),datedCount:count,complete};
        rows.push(lead(`${complete}:${count}`,[sample]));
    }
    for (const op of ['gte','lte','eq'] as const) for (const value of [0,1,1.5,6,8,10]) {
        parity(p('reviews.recentCount',op,value,{days:90}),rows);
        parity(p('reviews.recentCount',op,value,{days:90}),rows,T+91*DAY_MS);
    }
    parity(p('reviews.recentCount','between',undefined,{min:1.2,max:1.8,days:90}),rows);
});
test("list, ids, contacts, preview and refresh share a predicate; membership exclusions remain separate", () => {
    const definition={version:2,expression:p('website.active','eq',true)};
    const rows=[lead('a',[record('signal','website.active',{'website.active':known(true)})]),lead('b',[record('signal','website.active',{'website.active':known(true)})],{outreachStatus:'replied'}),lead('c')];
    const hashes=new Set<string>();
    for(const mode of ['', 'idsOnly', 'contactsOnly', 'preview']) {
        const params=new URLSearchParams({filterDefinition:JSON.stringify(definition),...(mode?{[mode]:'true'}:{})});
        const parsed=parseLeadQuery(params),query=buildSavedLeadQuery(parsed.definition,T,bindings);hashes.add(query.hash);
        assert.deepEqual(rows.filter(r=>matches(r,query.where)).map(r=>r.id),['a','b']);
        assert.deepEqual(rows.filter(r=>matches(r,groupEligibleWhere(query.where))).map(r=>r.id),['a']);
    }
    assert.equal(hashes.size,1);
    assert.equal(matches(lead('legacy',[],{isExistingClient:true}),buildSavedLeadQuery({},T,bindings).where),true);
    assert.equal(matches(lead('ui',[],{isExistingClient:true}),buildSavedLeadQuery({isExistingClient:'false'},T,bindings).where),false);
});

test("legacy theme counts have fixed typed JSON paths and missing counts stay unknown", () => {
    const d:any={version:2,expression:{type:'predicate',signal:'legacy.painTagCounts.missed_calls',op:'gte',value:2}};
    const compiled=compileSignalFilter(d,T,bindings);
    const rows=[lead('missing'),lead('null',[],{painTagCounts:null}),lead('zero',[],{painTagCounts:{missed_calls:0}}),lead('yes',[],{painTagCounts:{missed_calls:3}})];
    assert.deepEqual(rows.filter(r=>matches(r,compiled.where)).map(r=>r.id),['yes']);
    const unknown=compileSignalFilter({...d,expression:{...d.expression,op:'unknown',value:undefined}},T,bindings);
    assert.deepEqual(rows.filter(r=>matches(r,unknown.where)).map(r=>r.id),['missing','null']);
});

test("opt-in disposable PostgreSQL executes the generated relation, JSON, null and source predicates", {skip:process.env.RUN_ENRICHMENT_DISPOSABLE_DB_TESTS!=='I_AUTHORIZE_DISPOSABLE_DB_ONLY'}, async () => {
    const url=process.env.ENRICHMENT_DISPOSABLE_DATABASE_URL || '';
    const parsed=new URL(url);
    assert.ok(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname));
    assert.match(parsed.pathname,/^\/enrichment_signals_disposable(?:_[a-z0-9]+)?$/);
    const {PrismaClient,Prisma}=await import('@prisma/client');
    const {PrismaPg}=await import('@prisma/adapter-pg');
    const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})});
    const rollback=new Error('intentional_fixture_rollback');
    try {
        await assert.rejects(db.$transaction(async tx=>{
            const b={website:db.scrapedLead.fields.website,googlePlaceId:db.scrapedLead.fields.googlePlaceId,dbNull:Prisma.DbNull,jsonNull:Prisma.JsonNull};
            const ids:string[]=[];
            for(const [index,value] of [true,false,null].entries()) {
                const item=await tx.scrapedLead.create({data:{name:`Disposable signal fixture ${index}`,market:'test',categories:[],techDetected:[],website:'https://example.com/',signalSourceWebsite:'https://example.com/',serviceTypes:[],serviceAreaCities:[],painPoints:[],reasons:[],notesFlags:[],ctaPromiseTags:[],leadHandlingPromiseTags:[],emailsDiscovered:[],reviewComplaints:[],reviewPraise:[],mentionedStaffNames:[],painTags:[],praiseTags:[],lowStarComplaintTags:[]}});
                ids.push(item.id);
                if(value!==null) await tx.leadEnrichmentRecord.create({data:{leadId:item.id,kind:'signal',key:'website.active',serviceScope:'business',contractVersion:1,detectorVersion:'fixture',state:'confirmed',collectionOutcome:'success',observedAt:new Date(T),sourceDependencies:['website'],data:{facts:{'website.active':known(value)},coverage:{complete:true,reasons:[]}}}});
            }
            const selected=async(op:string,value?:boolean)=>tx.scrapedLead.findMany({where:{AND:[{id:{in:ids}},compileSignalFilter({version:2,expression:{type:'predicate',signal:'website.active',op,...(value===undefined?{}:{value})}},T,b).where]},select:{id:true}});
            assert.deepEqual((await selected('eq',false)).map(r=>r.id),[ids[1]]);
            assert.deepEqual((await selected('unknown')).map(r=>r.id),[ids[2]]);
            await tx.scrapedLead.update({where:{id:ids[0]},data:{website:'https://changed.example/'}});
            assert.equal((await selected('eq',true)).length,0);
            assert.deepEqual(new Set((await selected('unknown')).map(r=>r.id)),new Set([ids[0],ids[2]]));
            throw rollback;
        },{isolationLevel:'Serializable',timeout:30000}),e=>e===rollback);
    } finally { await db.$disconnect(); }
});

test("a claim interval crossing the freshness boundary is neither fresh nor stale", () => {
    const r=record('signal','fleet.trucks',{'fleet.trucks':{...known(2),eventMinMs:T-30*DAY_MS-1,eventMaxMs:T-30*DAY_MS+1}});
    const row=lead('crossing',[r]);
    for(const expression of [p('fleet.trucks','fresh'),p('fleet.trucks','stale'),p('fleet.trucks','eq',2)]) {
        const query=compileSignalFilter({version:2,expression},T,bindings);
        assert.equal(matches(row,query.pair.yes),false);assert.equal(matches(row,query.pair.no),false);
    }
});

test("real leads route shares all query modes and rejects malformed filters before database access", async () => {
    const {isolatedModule,nextResponseMock}=await import('./helpers/isolated-module.ts');
    const query=await import('../lead-filter-query.ts'), evidence=await import('../enrichment-evidence.ts'), signals=await import('../enrichment-signals.ts'), definitions=await import('../lead-filter-definition.ts'),website=await import('../lead-website.ts'),geography=await import('../lead-geography.ts'),deletion=await import('../lead-deletion.ts');
    const rows=[lead('a',[record('signal','website.active',{'website.active':known(true,Date.now())})]),lead('b',[record('signal','website.active',{'website.active':known(true,Date.now())})],{outreachStatus:'replied'}),lead('c')];
    let reads=0;
    const prisma={scrapedLead:{fields:{website:bindings.website,googlePlaceId:bindings.googlePlaceId},findMany:async({where,skip=0,take}:any)=>{reads++;return rows.filter(row=>matches(row,where)).slice(skip,skip+take);},count:async({where}:any)=>{reads++;return rows.filter(row=>matches(row,where)).length;},groupBy:async()=>[]}};
    const route=isolatedModule('src/app/api/agents/leads/route.ts',{'@/lib/junk-eligibility':junkEligibility,'@/lib/lead-classify':leadClassify,'next/server':nextResponseMock,'@prisma/client':{Prisma:{DbNull:bindings.dbNull,JsonNull:bindings.jsonNull}},'@/lib/prisma':{prisma},'@/lib/auth':{getSession:async()=>({user:{id:'admin'}})},'@/lib/lead-website':website,'@/lib/lead-geography':geography,'@/lib/lead-cleaner-db':{},'@/lib/lead-deletion':deletion,'@/lib/lead-filter-query':query,'@/lib/enrichment-evidence':evidence,'@/lib/enrichment-signals':{...signals,requireSignalsAvailable:()=>{},signalsAvailable:()=>true},'@/lib/lead-filter-definition':definitions},{AUTH_SECRET:'test-secret-with-more-than-32-characters'});
    const base={filterDefinition:JSON.stringify({version:2,expression:p('website.active','eq',true)})};let context:string|undefined,time:number|undefined;
    for(const mode of ['', 'idsOnly','contactsOnly','preview']) {
        const params=new URLSearchParams({...base,...(context?{evaluationContext:context}:{}),...(mode?{[mode]:'true'}:{})});
        const response=await route.GET({url:`https://fixture.invalid/api?${params}`});assert.equal(response.status,200);
        const body=await response.json();assert.deepEqual(body.ids||((body.contacts||body.leads).map((r:any)=>r.id)),['a','b']);assert.equal(body.eligibleCount,1);assert.equal(body.dataSnapshotFrozen,false);
        if(time!==undefined)assert.equal(body.evaluatedAtMs,time);time=body.evaluatedAtMs;context=body.evaluationContext;
    }
    const before=reads;const bad=await route.GET({url:'https://fixture.invalid/api?unknownField=true'});assert.equal(bad.status,400);assert.equal(reads,before);
});

test("old coverage-dependent facts cannot qualify after current coverage is lost", () => {
    const stale=record('service','junk_removal',{'service.offered':known(true),'service.selfService':known(false),'service.phoneOnly':known(true)},'junk_removal','website',false);
    const rows=[lead('unsafe-old',[stale])];
    assert.deepEqual(parity(p('service.selfService','eq',false,{scope:'junk_removal'}),rows),[]);
    assert.deepEqual(parity(p('service.selfService','unknown',undefined,{scope:'junk_removal'}),rows),['unsafe-old']);
    assert.deepEqual(parity(p('service.phoneOnly','eq',true,{scope:'junk_removal'}),rows),[]);
    assert.deepEqual(parity(p('service.offered','eq',true,{scope:'junk_removal'}),rows),['unsafe-old']);
});

test('legacy scalar nullability matches the schema and preserves required versus nullable truth',async()=>{
    const {readFileSync}=await import('node:fs');const {SIGNAL_REGISTRY}=await import('../enrichment-signals.ts');
    const schema=readFileSync(new URL('../../../prisma/schema.prisma',import.meta.url),'utf8').split('model ScrapedLead {')[1].split('\n}')[0];
    const columns=new Map([...schema.matchAll(/^\s*(\w+)\s+(\w+)(\?|\[\])?/gm)].map(m=>[m[1],m[3]||'required']));
    let requiredCount=0,nullableCount=0;
    for(const spec of Object.values(SIGNAL_REGISTRY).filter(s=>s.legacyField&&!s.legacyJsonPath&&s.type!=='string[]')) {
        const field=spec.legacyField!;assert.ok(columns.has(field),field);
        const q=compileSignalFilter({version:2,expression:p(spec.id,'unknown')},T,bindings);
        if(columns.get(field)==='required') {requiredCount++;assert.deepEqual(q.pair,{yes:{OR:[]},no:{AND:[]}},field);}
        else {nullableCount++;assert.deepEqual(q.pair,{yes:{[field]:null},no:{[field]:{not:null}}},field);}
    }
    assert.ok(requiredCount>0&&nullableCount>0);
    for(const field of ['name','phone']) {
        const samples=field==='name'?[lead('match',[],{name:'Bender'}),lead('other',[],{name:'Other'}),lead('empty',[],{name:''})]:[lead('match',[],{phone:'Bender'}),lead('other',[],{phone:'Other'}),lead('unknown',[],{phone:null})];
        for(const op of ['eq','not_in','unknown'] as const) {
            const expression=p('legacy.'+field,op,op==='eq'?'Bender':op==='not_in'?['Bender']:undefined);
            parity(expression,samples);
        }
    }
    assert.deepEqual(parity(p('legacy.hasOnlineBooking','eq',false),[lead('default',[],{hasOnlineBooking:false}),lead('yes',[],{hasOnlineBooking:true})]),['default']);
});

test('real leads idsOnly name filter keeps pricing and contact on the same junk route',async()=>{
    const {isolatedModule,nextResponseMock}=await import('./helpers/isolated-module.ts');
    const query=await import('../lead-filter-query.ts'),evidence=await import('../enrichment-evidence.ts'),signals=await import('../enrichment-signals.ts'),definitions=await import('../lead-filter-definition.ts'),website=await import('../lead-website.ts'),geography=await import('../lead-geography.ts'),deletion=await import('../lead-deletion.ts');
    const at=Date.now()-100;const facts=(data:Record<string,unknown>)=>Object.fromEntries(Object.entries(data).map(([k,v])=>[k,known(v,at)]));
    const service=record('service','junk_removal',facts({'service.offered':true}),'junk_removal');
    const pricing=record('route','pricing',facts({'route.instantPricing':true,'route.upfrontContact':'no','route.method':'self_service'}),'junk_removal');
    const phone=record('route','phone',facts({'route.method':'phone','route.upfrontContact':'no'}),'junk_removal');
    const item=(id:string,routes:any[],extra={})=>lead(id,[service,...routes],{name:'Bender General Contracting',notesFlags:[],...extra});
    const rows=[item('same',[pricing,phone]),item('split',[{...pricing,data:{...pricing.data,facts:facts({'route.instantPricing':true,'route.upfrontContact':'yes'})}},phone]),item('wrong-service',[{...pricing,serviceScope:'dumpster_rental'},phone]),item('unknown',[{...pricing,data:{facts:facts({'route.instantPricing':true})}}]),item('archived',[pricing,phone],{archivedAt:new Date()}),item('suppressed',[pricing,phone],{notesFlags:['junk_eligibility:suppressed']}),item('pending',[pricing,phone],{notesFlags:['junk_eligibility:pending_review']})];
    // Reproduce the provider validation that a pure predicate interpreter cannot catch.
    const checked=(where:any)=>{assert.ok(!JSON.stringify(where).includes('"name":{"not":null}'));return rows.filter(row=>matches(row,where));};
    const prisma={scrapedLead:{fields:{website:bindings.website,googlePlaceId:bindings.googlePlaceId},count:async({where}:any)=>checked(where).length,findMany:async({where,select}:any)=>{assert.equal(JSON.stringify(select),JSON.stringify({id:true}));return checked(where).map(({id})=>({id}));}}};
    const mod=isolatedModule('src/app/api/agents/leads/route.ts',{'@/lib/junk-eligibility':junkEligibility,'@/lib/lead-classify':leadClassify,'next/server':nextResponseMock,'@prisma/client':{Prisma:{DbNull:bindings.dbNull,JsonNull:bindings.jsonNull}},'@/lib/prisma':{prisma},'@/lib/auth':{getSession:async()=>null},'@/lib/lead-website':website,'@/lib/lead-geography':geography,'@/lib/lead-cleaner-db':{},'@/lib/lead-deletion':deletion,'@/lib/lead-filter-query':query,'@/lib/enrichment-evidence':evidence,'@/lib/enrichment-signals':signals,'@/lib/lead-filter-definition':definitions},{AGENT_CALLBACK_SECRET:'fixture-agent-secret',AUTH_SECRET:'test-secret-with-more-than-32-characters'});
    const all=(...children:FilterExpression[]):FilterExpression=>({type:'all',children});
    const scoped=(...conditions:FilterExpression[]):FilterExpression=>({type:'scope',kind:'route',scope:'junk_removal',expression:all(...conditions)});
    const cases:[FilterExpression,string[]][]=[
        [scoped(p('route.instantPricing','eq',true),p('route.upfrontContact','eq','no')),['same']],
        [scoped(p('route.instantPricing','eq',true),p('route.upfrontContact','eq','yes')),['split']],
        [scoped(p('route.instantPricing','eq',true),p('route.method','eq','phone')),[]],
        [all(scoped(p('route.instantPricing','eq',true)),scoped(p('route.method','eq','phone'))),['same','split']],
    ];
    for(const [expression,expected] of cases) {
        const definition={version:2,expression:all(p('legacy.name','eq','Bender General Contracting'),p('service.offered','eq',true,{scope:'junk_removal'}),expression)};
        const params=new URLSearchParams({secret:'fixture-agent-secret',idsOnly:'true',filterDefinition:JSON.stringify(definition)});
        const response=await mod.GET({url:'https://fixture.invalid/api/agents/leads?'+params});assert.equal(response.status,200);const body=await response.json();
        assert.deepEqual(body.ids,expected);assert.equal(body.eligibleCount,expected.length);assert.equal(body.truncated,false);assert.equal(body.evidenceFiltersAvailable,true);
    }
});
