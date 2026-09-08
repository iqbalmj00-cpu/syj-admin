// Conservative source-field normalization. Raw market and saved audience filters stay intact.
const STATE_CODES: Record<string, string> = {
    "alabama": "AL",
    "alaska": "AK",
    "arizona": "AZ",
    "arkansas": "AR",
    "california": "CA",
    "colorado": "CO",
    "connecticut": "CT",
    "delaware": "DE",
    "district of columbia": "DC",
    "florida": "FL",
    "georgia": "GA",
    "hawaii": "HI",
    "idaho": "ID",
    "illinois": "IL",
    "indiana": "IN",
    "iowa": "IA",
    "kansas": "KS",
    "kentucky": "KY",
    "louisiana": "LA",
    "maine": "ME",
    "maryland": "MD",
    "massachusetts": "MA",
    "michigan": "MI",
    "minnesota": "MN",
    "mississippi": "MS",
    "missouri": "MO",
    "montana": "MT",
    "nebraska": "NE",
    "nevada": "NV",
    "new hampshire": "NH",
    "new jersey": "NJ",
    "new mexico": "NM",
    "new york": "NY",
    "north carolina": "NC",
    "north dakota": "ND",
    "ohio": "OH",
    "oklahoma": "OK",
    "oregon": "OR",
    "pennsylvania": "PA",
    "rhode island": "RI",
    "south carolina": "SC",
    "south dakota": "SD",
    "tennessee": "TN",
    "texas": "TX",
    "utah": "UT",
    "vermont": "VT",
    "virginia": "VA",
    "washington": "WA",
    "west virginia": "WV",
    "wisconsin": "WI",
    "wyoming": "WY"
};
const VALID_CODES = new Set(Object.values(STATE_CODES));
export function normalizeLeadState(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const clean = value.trim().replace(/\s+/g, " ");
    return VALID_CODES.has(clean.toUpperCase()) ? clean.toUpperCase() : STATE_CODES[clean.toLowerCase()] || null;
}
export function cleanLeadCity(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const clean = value.trim().replace(/\s+/g, " ");
    if (!clean || !/^[\p{L} .’'-]+$/u.test(clean) || /^(unknown|download|n\/?a|null|none)$/i.test(clean)) return null;
    return clean;
}
export function leadGeography(input: { city?: unknown; state?: unknown; market?: unknown }): { city: string | null; state: string | null } {
    const state = normalizeLeadState(input.state);
    const explicitCity = cleanLeadCity(input.city);
    if (explicitCity) return { city: explicitCity, state };
    const market = typeof input.market === "string" ? input.market.trim().replace(/\s+/g, " ") : "";
    const suffixes = [...Object.keys(STATE_CODES), ...VALID_CODES].sort((a, b) => b.length - a.length);
    for (const suffix of suffixes) {
        const ending = new RegExp(`(?:,\\s*|\\s+)${suffix}$`, "i");
        if (!ending.test(market)) continue;
        const suffixState = normalizeLeadState(suffix);
        const city = cleanLeadCity(market.replace(ending, ""));
        // Contradictory state evidence remains unresolved; never personalize a guessed city.
        if (city && suffixState && (!state || state === suffixState)) return { city, state: suffixState };
        return { city: null, state };
    }
    return { city: state ? cleanLeadCity(market) : null, state };
}
