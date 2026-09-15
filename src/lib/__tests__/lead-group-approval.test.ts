import test from "node:test";
import assert from "node:assert/strict";
import { isolatedModule, nextResponseMock } from "./helpers/isolated-module.ts";
import * as policy from "../lead-group-policy.ts";
import * as refresh from "../lead-group-refresh.ts";
import * as signals from "../enrichment-signals.ts";
import * as evidence from "../enrichment-evidence.ts";
import * as campaign from "../cold-email-campaign.ts";
import * as platform from "../cold-email-platform.ts";
import * as blackout from "../cold-email-blackout.ts";
import * as timezone from "../cold-email-timezone.ts";
const T=Date.UTC(2026,8,10);
function fixture(filterDefinition:unknown, refreshRequired=false){
    const calls:string[]=[],snapshots:any[]=[];
    const wizard={details:{name:'Fixture',ownerId:'admin',objective:'Replies',successMetric:'Replies'},audience:{leadGroupId:'g',refreshBeforeSnapshot:refreshRequired,cooldownDays:30,companyContactCap:1},messaging:{sequenceVersionId:'s'},infrastructure:{sendingPoolId:'p'},schedule:{timezone:'America/Chicago',days:{'1':true},windows:[{from:'09:00',to:'16:00'}],dailyLimit:10,dailyMaxNewLeads:5,emailGapMinutes:10,randomWaitMaxMinutes:1,respectBlackouts:true},policies:{stopOnReply:true,bounceProtectionEnabled:true},review:{confirmed:true}};
    const group={id:'g',name:'Fixture',channel:'email',filterDefinition,lastRefreshedAt:new Date(T+1000),updatedAt:new Date(T),members:[{leadId:'lead',lead:{name:'Example'}}]};
    const client:any={
        $queryRaw:async(strings:TemplateStringsArray,id:string)=>{assert.match(strings.join('?'),/FOR UPDATE/);assert.equal(id,'g');calls.push('lock');},
        leadGroup:{findUnique:async()=>{assert.equal(calls[0],'lock');calls.push('read-group');return group;}},
        coldEmailCampaignVersion:{findUnique:async()=>({id:'v',campaignId:'c',status:'draft',createdAt:new Date(T),operationalRules:{wizard}}),updateMany:async()=>({count:1})},
        coldEmailSequenceVersion:{findUnique:async()=>({id:'s',status:'approved',steps:[{id:'step'}]})},
        coldEmailSendingPool:{findUnique:async()=>({id:'p',active:true,memberships:[{id:'account'}]})},
        coldEmailAudienceSnapshot:{create:async({data}:any)=>{snapshots.push(structuredClone(data));return {id:'snapshot'};}},
        coldEmailAudienceMember:{createMany:async()=>({count:1})},coldEmailCampaign:{updateMany:async()=>({count:1})},coldEmailAuditEvent:{create:async()=>({})},
        $transaction:async(fn:any,options:any)=>{if(options)assert.equal(options.isolationLevel,'Serializable');return fn(client);},
    };
    const store=isolatedModule('src/lib/cold-email-campaign-store.ts',{'./lead-group-refresh.ts':refresh,'./lead-group-policy.ts':policy,'./enrichment-signals.ts':{...signals,requireSignalsAvailable:()=>{}},'./enrichment-evidence.ts':evidence,'@/lib/prisma':{prisma:client},'@/lib/cold-email':{COLD_EMAIL_PERSONALIZATION_LEAD_SELECT:{}},'@/lib/cold-email-campaign':campaign,'@/lib/cold-email-platform':platform,'@/lib/cold-email-blackout':blackout,'@/lib/cold-email-timezone':timezone});
    return {group,calls,snapshots,store,invoke:()=>store.approveCanonicalColdEmailCampaignVersion({versionId:'v',actorId:'admin'})};
}
test("actual approval store refuses unready/malformed groups with refresh toggle off",async()=>{
    for(const definition of [policy.newGroupEnvelope({version:2,expression:{type:'match_all'}}),{badRule:'unsupported'},{version:99}]){
        const f=fixture(definition,false);await assert.rejects(f.invoke(),/Refresh|invalid rules/);assert.equal(f.snapshots.length,0);
    }
});
test("actual approval freezes a coherent ready revision and honors optional after-draft evaluation",async()=>{
    const envelope=policy.newGroupEnvelope({version:2,expression:{type:'match_all'}});
    envelope.membership={readiness:'ready',appliedRevision:1,evaluatedAt:T,completedAt:T+1000,eligibleCount:1};
    const f=fixture(envelope);await f.invoke();
    assert.equal(f.snapshots[0].sourceDefinition.rules.definitionRevision,1);
    assert.equal(f.snapshots[0].sourceDefinition.rules.membership.evaluatedAt,T);
    assert.equal(typeof f.snapshots[0].sourceDefinition.definitionHash,'string');
    (f.group as any).filterDefinition=policy.newGroupEnvelope({version:2,expression:{type:'match_all'}},2);
    assert.equal(f.snapshots[0].sourceDefinition.rules.definitionRevision,1);
    const old=structuredClone(envelope);old.membership.evaluatedAt=T-1;
    await assert.rejects(fixture(old,true).invoke(),/after this campaign draft/);
    await fixture(envelope,true).invoke();
});
test("manual groups and strict valid legacy empty rules preserve approval compatibility",async()=>{
    await fixture(null,false).invoke();await fixture({},false).invoke();
    await assert.rejects(fixture(null,true).invoke(),/static.*Edit the draft/);
});
test("direct membership edits reject v2 dynamic rules after the group lock",async()=>{
    let mutations=0,locked=false;
    const prisma:any={$queryRaw:async()=>{locked=true;},leadGroup:{findUnique:async()=>{assert.ok(locked);return {filterDefinition:policy.newGroupEnvelope({version:2,expression:{type:'match_all'}})};}},leadGroupMember:{createMany:async()=>{mutations++;},deleteMany:async()=>{mutations++;}},$transaction:async(fn:any)=>fn(prisma)};
    const route=isolatedModule('src/app/api/agents/lead-groups/members/route.ts',{'@/lib/lead-group-refresh':refresh,'@/lib/lead-group-policy':policy,'@/lib/prisma':{prisma},'@/lib/auth':{getSession:async()=>({user:{id:'admin'}})},'next/server':nextResponseMock});
    for(const method of ['POST','DELETE']){const res=await route[method]({json:async()=>({groupId:'g',leadIds:['lead']})});assert.equal(res.status,409);}
    assert.equal(mutations,0);
});

test("preparation still rejects a draft before provider work",async()=>{
    const f=fixture(null);
    await assert.rejects(f.store.requestCanonicalColdEmailCampaignPreparation({versionId:"v",actorId:"admin",workspaceId:"workspace"}),/Only an approved/);
    assert.equal(f.snapshots.length,0);assert.equal(f.calls.length,0);
});
