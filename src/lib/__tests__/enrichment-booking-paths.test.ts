import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSignalPayload } from '../enrichment-signals-schema.ts';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/enrichment-signals/payload.json', import.meta.url), 'utf8'));
function candidate() {
    const p = structuredClone(fixture), row = p.records.find((r:any) => r.kind === 'route');
    const fact = (value:unknown) => ({ state: 'confirmed', observedAtMs: p.checkedAtMs, value });
    Object.assign(row.facts, { 'route.method': fact('self_service'), 'route.confirmation': fact(true), 'route.staffApproval': fact(false), 'route.nextStep': fact('junk_pickup'), 'route.bookingLinked': fact(true) });
    row.proof = { url: 'https://example.com/pickup', method: 'browser_linked_form_workflow', journey: { ctaText: 'Book junk removal', sourceUrl: 'https://example.com/', entryKind: 'booking', outcome: 'self_service', gaps: [], steps: [{ url: 'https://example.com/', action: 'Book junk removal', destinationUrl: 'https://example.com/pickup', observation: 'Published destination' }, { url: 'https://example.com/pickup', action: 'Inspect destination', observation: 'Rendered form' }] } };
    return {p,row};
}
test('self-service contract requires a linked visible workflow and explicit confirmation without staff approval', () => {
    const {p} = candidate(); assert.doesNotThrow(() => validateSignalPayload(p,p.checkedAtMs));
    for (const change of [(r:any) => delete r.proof.journey, (r:any) => r.proof.method = 'static_form_workflow', (r:any) => r.facts['route.staffApproval'].value = true, (r:any) => r.facts['route.bookingLinked'] = {state:'unknown',observedAtMs:p.checkedAtMs}, (r:any) => r.proof.journey.gaps = ['later_booking_steps_not_inspected']]) {
        const c = candidate(); change(c.row); assert.throws(() => validateSignalPayload(c.p,c.p.checkedAtMs));
    }
});
test('journey rejects unsafe destinations, oversized steps and a mismatched source', () => {
    for (const change of [(r:any) => r.proof.journey.steps[0].destinationUrl = 'javascript:alert(1)', (r:any) => r.proof.journey.steps = Array(11).fill(r.proof.journey.steps[0]), (r:any) => r.proof.journey.sourceUrl = 'https://unrelated.com/']) {
        const {p,row} = candidate(); change(row); assert.throws(() => validateSignalPayload(p,p.checkedAtMs));
    }
});
test('a separate contact form cannot assert booking linkage without its observed CTA path', () => {
    const p = structuredClone(fixture), row = p.records.find((r:any) => r.kind === 'route');
    row.facts['route.bookingLinked'] = { state:'confirmed', observedAtMs:p.checkedAtMs, value:true };
    assert.throws(() => validateSignalPayload(p,p.checkedAtMs), /Booking linkage/);
});
test('upfront-contact proxy requires phone/email on the same path and cannot coexist with visible simultaneous pricing', () => {
    const {p,row} = candidate(), fact = (value:unknown) => ({state:'confirmed',observedAtMs:p.checkedAtMs,value});
    row.facts['route.upfrontContact']=fact('yes');
    assert.throws(() => validateSignalPayload(p,p.checkedAtMs), /Upfront contact/);
    row.facts['route.emailRequired']=fact(true);
    row.proof.journey.firstStepEvidence=[{url:'https://example.com/pickup',observation:'Email required at first form; no service/date/price exploration observed before it. Saving was not tested.'}];
    assert.doesNotThrow(() => validateSignalPayload(p,p.checkedAtMs));
    row.facts['route.pricingContactOrder']=fact('simultaneous');
    assert.throws(() => validateSignalPayload(p,p.checkedAtMs), /Upfront contact/);
});
