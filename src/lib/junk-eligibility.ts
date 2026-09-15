/** Pure eligibility boundary. Search terms, companyType and legacy false are not absence evidence. */
export const JUNK_ELIGIBILITY_VERSION = 'junk-v2-service-freshness';
export type JunkEligibilityStatus = 'eligible' | 'pending_review' | 'dumpster_only' | 'suppressed';
export type JunkEligibilityInput = { name?: unknown; categories?: unknown; website?: unknown; archivedAt?: unknown; isExistingClient?: unknown; enrichmentRecords?: unknown; [key:string]:unknown };
export type JunkEligibilityDecision = { version: typeof JUNK_ELIGIBILITY_VERSION; status: JunkEligibilityStatus; reason: string; evidence: string[]; checkedAtMs: number };
export const ELIGIBILITY_PREFIX = 'junk_eligibility:';
export const ELIGIBILITY_FLAGS = ['eligible','pending_review','dumpster_only','suppressed'].map(s=>ELIGIBILITY_PREFIX+s);
export const JUNK_SERVICE_PATTERN = /\b(?:junk\s*(?:removal|hauling|pickup)|hauling\s+junk|rubbish\s+removal|debris\s+removal|furniture\s+removal|appliance\s+removal|house\s+clearance|(?:estate|house|home|garage|property|hoarder)\s*cleanouts?|haul(?:ing)?[ -]*away\s+(?:junk|unwanted\s+items|furniture|appliances))\b/i;
// A loose provider category cannot resolve a conflicting car/freight/municipal
// identity. Explicit household-junk service names or current service proof can.
export const NON_JUNK_IDENTITY_PATTERN = /\b(?:junk\s*(?:cars?|vehicles?)|cash\s*for\s*(?:junk|cars?|vehicles?)|(?:auto|car|vehicle)\s*(?:salvage|wreck\w*|removal|towing)|freight|aggregate|material\s+delivery|towing|routine\s+trash|municipal\s+(?:waste|trash|garbage))\b/i;
function qualifyingLabel(label:string):boolean {
    // Remove the car-only phrase, retaining a separate actual household service.
    const services = label.replace(/\bjunk\s*(?:removal|hauling)\s+(?:of\s+)?(?:cars?|vehicles?|scrap\s+cars?)\b/gi, '');
    return JUNK_SERVICE_PATTERN.test(services);
}
const object = (v:unknown):Record<string,any> => v && typeof v==='object' && !Array.isArray(v) ? v as Record<string,any> : {};
function serviceObservation(input:JunkEligibilityInput, service:string, now:number) {
    const observations:{value:boolean; proof:string}[]=[];
    for (const raw of Array.isArray(input.enrichmentRecords)?input.enrichmentRecords:[]) {
        const row=object(raw), data=object(row.data || raw);
        if ((row.serviceScope || data.serviceScope)!==service || data.kind!=='service' || data.source!==input.website || !input.website) continue;
        const fact=object(object(data.facts)['service.offered']);
        const proofId=object(data.factProofIds)['service.offered'];
        const proof=object(object(data.proofs)[proofId] || data.proof);
        if (fact.state!=='confirmed' || typeof fact.value!=='boolean' || !Number.isFinite(fact.observedAtMs) || fact.observedAtMs>now || now-fact.observedAtMs>7*86400000) continue;
        if (typeof proof.url!=='string' || !/^https?:\/\//i.test(proof.url) || !proof.excerpt || !['browser_service_route_coverage','static_service_route_coverage','reviewed_service_coverage'].includes(proof.method)) continue;
        // A positive observation stands alone. Absence additionally needs a complete,
        // confirmed service inspection; partial/error/default false never qualifies.
        if (fact.value===false && !(data.coverage?.complete===true && data.state==='confirmed')) continue;
        observations.push({value:fact.value,proof:proof.url+': '+String(proof.excerpt).slice(0,400)});
    }
    return observations;
}
export function classifyJunkEligibility(input:JunkEligibilityInput, now=Date.now()):JunkEligibilityDecision {
    const result=(status:JunkEligibilityStatus,reason:string,evidence:string[]=[]):JunkEligibilityDecision=>({version:JUNK_ELIGIBILITY_VERSION,status,reason,evidence,checkedAtMs:now});
    if (input.archivedAt) return result('suppressed','archived_identity_preserved');
    if (input.isExistingClient===true) return result('suppressed','existing_client');
    const categories=(Array.isArray(input.categories)?input.categories:[]).filter((v):v is string=>typeof v==='string');
    const name=String(input.name||'');
    const labels=[name,...categories].filter(qualifyingLabel);
    const categoryConflict=labels.length>0 && !qualifyingLabel(name) && NON_JUNK_IDENTITY_PATTERN.test(name);
    const junk=serviceObservation(input,'junk_removal',now), dumpster=serviceObservation(input,'dumpster_rental',now);
    const positive=junk.some(o=>o.value), negative=junk.some(o=>!o.value);
    if (negative && (positive || labels.length)) return result('pending_review','conflicting_junk_evidence',[...labels,...junk.map(o=>o.proof)]);
    if (positive) return result('eligible','confirmed_junk_service',junk.filter(o=>o.value).map(o=>o.proof));
    if (categoryConflict) return result('pending_review','conflicting_business_identity',[name,...labels]);
    if (labels.length) return result('eligible','explicit_junk_service_label',labels);
    if (negative && dumpster.some(o=>o.value)) return result('dumpster_only','confirmed_dumpster_and_confirmed_no_junk',[...junk,...dumpster].map(o=>o.proof));
    return result('pending_review','junk_service_unverified',dumpster.map(o=>o.proof));
}
export function eligibilityNotes(flags:unknown, decision:JunkEligibilityDecision):string[] {
    return [...new Set([...(Array.isArray(flags)?flags:[]).filter((v):v is string=>typeof v==='string'&&!v.startsWith(ELIGIBILITY_PREFIX)),ELIGIBILITY_PREFIX+decision.status])];
}
export function preserveEligibilityNotes(existing:unknown,incoming:unknown):string[] {
    return [...new Set([...(Array.isArray(incoming)?incoming:[]).filter((v):v is string=>typeof v==='string'&&!v.startsWith(ELIGIBILITY_PREFIX)),...(Array.isArray(existing)?existing:[]).filter((v):v is string=>typeof v==='string'&&v.startsWith(ELIGIBILITY_PREFIX))])];
}
export function isPendingEligibility(flags:unknown):boolean {
    return Array.isArray(flags)&&flags.some(f=>[ELIGIBILITY_PREFIX+'pending_review',ELIGIBILITY_PREFIX+'dumpster_only',ELIGIBILITY_PREFIX+'suppressed'].includes(f));
}
/** Existing unmarked leads remain reviewable until a separately reviewed bulk transition. */
export function junkEligibilityWhere(view='active'):Record<string,unknown> {
    if (view==='all') return {};
    if (view==='legacy_unreviewed') return {NOT:{notesFlags:{hasSome:ELIGIBILITY_FLAGS}}};
    if (view!=='active') return {notesFlags:{has:ELIGIBILITY_PREFIX+view}};
    return {NOT:{notesFlags:{hasSome:['pending_review','dumpster_only','suppressed'].map(s=>ELIGIBILITY_PREFIX+s)}}};
}
