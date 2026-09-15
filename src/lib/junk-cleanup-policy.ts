import { classifyJunkEligibility, type JunkEligibilityInput } from './junk-eligibility.ts';

export const DUMPSTER_CLEANUP_POLICY_VERSION = 'stored-dumpster-only-v6';
export type DumpsterCleanupDecision = {
    version: typeof DUMPSTER_CLEANUP_POLICY_VERSION;
    action: 'keep' | 'propose_archive';
    reason: string;
    evidence: string[];
    basis: 'stored_data_policy';
};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const rental = /\b(?:dumpster(?:s)?(?:\s*rental)?|roll[ -]*offs?|(?:waste|trash|garbage|debris)\s*(?:container|bin)s?\s*rental)\b/i;
const onlyRentalLabel = /^(?:(?:dumpster|roll[ -]*off|(?:waste|trash|garbage|debris)\s*(?:container|bin))s?(?:\s*(?:rental|rentals|service|services))*|service establishment)$/i;
const otherService = /\b(?:junk|rubbish|furniture|appliance|debris|garbage|waste|trash)\s*(?:removal|hauling|pickup)|\b(?:junk|hauling|transport\w*|carting|trailer\s*rentals?|trash\s*be\s*gone|cleanouts?|clean[ -]*outs?|haul[ -]*away|moving|demolition|landscaping|towing|junk\s*cars?|freight|trucking|waste\s*management|trash\s*(?:collection|pickup)|garbage\s*collection|recycling|excavation|portable\s*(?:toilet|restroom)|storage|construction|roofing|cleaning|scrap|salvage)\b/i;

/** Current-list cleanup ONLY. All other or uncertain businesses stay kept.
 * A proposal is a stored-data policy inference, not verified service absence.
 * This function performs no reads/writes/network calls and must not gate future
 * junk-only discovery. Archive/client guards are preserved for the batch owner.
 */
export function classifyStoredDumpsterOnlyCleanup(input: JunkEligibilityInput): DumpsterCleanupDecision {
    const result = (action: DumpsterCleanupDecision['action'], reason: string, evidence: string[] = []): DumpsterCleanupDecision => ({ version: DUMPSTER_CLEANUP_POLICY_VERSION, action, reason, evidence, basis: 'stored_data_policy' });
    if (input.archivedAt) return result('keep', 'already_archived');
    if (input.isExistingClient === true) return result('keep', 'existing_client_preserved');
    const base = classifyJunkEligibility(input);
    if (base.status === 'eligible' || base.reason.startsWith('conflicting_') || input.offersJunkRemoval === true) return result('keep', 'junk_or_conflicting_service_evidence', base.evidence);
    const name = String(input.name || '');
    const categories = strings(input.categories);
    const types = strings(input.serviceTypes).map(v => v.replaceAll('_', ' '));
    const labels = [...categories, ...types];
    const rentalEvidence = [name, ...labels].filter(v => rental.test(v));
    if (!rentalEvidence.length) return result('keep', 'no_explicit_dumpster_rental_evidence');
    // Any additional category/service, even an uncertain one, protects a current lead.
    if (/junk|haul|transport|recycl|waste|trash|garbage|rubbish|debris|transfer\s*station/i.test(name)) return result('keep', 'ambiguous_or_additional_name_service', [name]);
    if (/trailer|\bdemo\b|equipment\s*rentals?|(?:and|&)\s*more\b|(?:outdoor|home|property)\s*(?:services?|solutions?)|sanitation/i.test(name)) return result('keep', 'additional_or_uncertain_name_service', [name]);
    const additional = labels.filter(v => !onlyRentalLabel.test(v.trim()));
    if (additional.length || otherService.test(name)) return result('keep', 'additional_or_uncertain_service', [...additional, ...(otherService.test(name) ? [name] : [])]);
    for (const raw of Array.isArray(input.enrichmentRecords) ? input.enrichmentRecords : []) {
        const row = record(raw), data = record(row.data || raw);
        const scope = row.serviceScope || data.serviceScope;
        if (!scope || scope === 'dumpster_rental') continue;
        const offered = record(record(data.facts)['service.offered']);
        if (offered.value === true || offered.state !== 'confirmed' || offered.value !== false) return result('keep', 'additional_or_uncertain_service_record', [String(scope)]);
    }
    // Descriptions and generated summaries can only protect a lead; never prove absence.
    for (const field of ['businessDescription', 'description', 'analysisSummary', 'serviceAreaDescription', 'serviceMixEvidence']) {
        const text = typeof input[field] === 'string' ? input[field] as string : '';
        if (text && otherService.test(text)) return result('keep', 'description_requires_keep', [field + ': ' + text.slice(0,500)]);
    }
    if (!labels.length) return result('keep', 'name_only_service_mix_unknown', rentalEvidence);
    return result('propose_archive', 'stored_dumpster_rental_only_policy', rentalEvidence);
}
