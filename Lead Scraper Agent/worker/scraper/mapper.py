"""
Outscraper row -> ScrapedLead ingest shape (technical plan §4B), plus the
per-ZIP dedup the worker does before posting (§5).

Rows are plain dicts from the Outscraper `maps/search-v3` response, each tagged
with `_term` (the search term that found it) by the control loop.
"""

from __future__ import annotations

# Full state name -> 2-letter (Outscraper returns the full name, plan §4B/§4C).
_STATE_NAME_TO_CODE = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "district of columbia": "DC", "florida": "FL", "georgia": "GA", "hawaii": "HI",
    "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY",
}

_TERM_TO_COMPANY_TYPE = {
    "junk removal": "junk_removal",
    "dumpster rental": "dumpster_rental",
}

# Junk-removal preferred when a place was found under both terms (primary product).
_TERM_PREFERENCE = ["junk removal", "dumpster rental"]


def normalize_state(value, fallback: str | None = None) -> str | None:
    """Outscraper full state name (or already-2-letter) -> 2-letter code."""
    if not value:
        return fallback
    v = str(value).strip()
    if len(v) == 2 and v.isalpha():
        return v.upper()
    code = _STATE_NAME_TO_CODE.get(v.lower())
    return code or fallback


def _as_categories(row: dict, term: str) -> list:
    """[search term, row.type, *row.subtypes] -> deduped non-empty string list.

    The leading search term guarantees a relevance-regex match downstream even
    for website-less leads (plan §4B; enrichment main.py:1207-1212).
    """
    out = [term]
    t = row.get("type")
    if t:
        out.append(str(t))
    subtypes = row.get("subtypes")
    if isinstance(subtypes, str):
        out.extend(s.strip() for s in subtypes.split(",") if s.strip())
    elif isinstance(subtypes, (list, tuple)):
        out.extend(str(s).strip() for s in subtypes if str(s).strip())
    # de-dup, preserve order, case-insensitive
    seen, result = set(), []
    for c in out:
        k = c.lower()
        if c and k not in seen:
            seen.add(k)
            result.append(c)
    return result


def _coerce_float(v):
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _coerce_int(v):
    try:
        return int(float(v)) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def to_lead(row: dict, ziprow: dict):
    """Outscraper dict -> ScrapedLead ingest dict, or None to drop the row.

    Drops rows that are name-less or permanently closed. Prefers the row's own
    city/state, falling back to the queried ZIP's dataset values (plan §4B).
    """
    name = (row.get("name") or "").strip()
    if not name:
        return None
    if (row.get("business_status") or "").upper() == "CLOSED_PERMANENTLY":
        return None

    term = row.get("_term") or _TERM_PREFERENCE[0]
    company_type = _TERM_TO_COMPANY_TYPE.get(term, "junk_removal")

    city = (row.get("city") or "").strip() or ziprow.get("city") or None
    state = normalize_state(row.get("state"), fallback=ziprow.get("state"))
    market = (row.get("city") or "").strip() or ziprow.get("city") or "Unknown"

    lead = {
        "name": name,
        "market": market,
        "city": city,
        "state": state,
        "discoveredVia": "google_maps",
        "source": "google",
        "googlePlaceId": row.get("place_id") or None,
        "phone": (row.get("phone") or None),
        "website": (row.get("site") or None),
        "address": (row.get("full_address") or None),
        "categories": _as_categories(row, term),
        "companyType": company_type,
        "rating": _coerce_float(row.get("rating")),
        "reviewCount": _coerce_int(row.get("reviews")),
        "googleMapsUrl": row.get("location_link") or None,
        "latitude": _coerce_float(row.get("latitude")),
        "longitude": _coerce_float(row.get("longitude")),
    }
    return lead


def _dedup_key(row: dict):
    pid = row.get("place_id")
    if pid:
        return ("pid", str(pid))
    # Fallback when place_id is absent (rare): name + address.
    return ("na", (row.get("name") or "").strip().lower(), (row.get("full_address") or "").strip().lower())


def dedup_by_place_id(rows: list[dict]) -> list[dict]:
    """Collapse duplicate businesses within a ZIP (plan §5 contract).

    Group by place_id (fallback name+address). Keep one row per group and set
    its `_term` to the preferred term among the group's members (junk removal
    preferred). Order is preserved by first appearance.
    """
    groups: dict = {}
    order: list = []
    for row in rows:
        key = _dedup_key(row)
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(row)

    survivors = []
    for key in order:
        members = groups[key]
        terms = {m.get("_term") for m in members if m.get("_term")}
        winning = next((t for t in _TERM_PREFERENCE if t in terms), members[0].get("_term"))
        survivor = dict(members[0])
        survivor["_term"] = winning
        survivors.append(survivor)
    return survivors
