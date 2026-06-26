"""
Outscraper row -> ScrapedLead ingest shape (technical plan §4B), plus the
per-target dedup the worker does before posting (§5).

Rows are plain dicts from the Outscraper `maps/search-v3` response, each tagged
with `_term` (the search term that found it) by the control loop.
"""

from __future__ import annotations

import re

from scraper import relevance

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


def _as_categories(row: dict) -> list:
    """Real row categories/types only; never inject the search term."""
    return relevance.extract_categories(row)


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


def _first_non_empty(row: dict, *keys: str):
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return value
    return None


def to_lead(row: dict, ziprow: dict):
    lead, _reason = to_lead_with_reason(row, ziprow)
    return lead


def to_lead_with_reason(row: dict, ziprow: dict):
    """Outscraper dict -> ScrapedLead ingest dict, or None to drop the row.

    Drops rows that are name-less, permanently closed, or not clearly in the
    target industry. Prefers the row's own city/state, falling back to the
    queried ZIP's dataset values (plan §4B).
    """
    name = (row.get("name") or "").strip()
    if not name:
        return None, "missing_name"
    if (row.get("business_status") or "").upper() == "CLOSED_PERMANENTLY":
        return None, "closed_permanently"

    classification = relevance.classify_row(row)
    if not classification.relevant:
        return None, classification.reason

    term = row.get("_term") or _TERM_PREFERENCE[0]
    company_type = classification.company_type or _TERM_TO_COMPANY_TYPE.get(term, "junk_removal")

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
        "website": _first_non_empty(row, "website", "site"),
        "address": _first_non_empty(row, "address", "full_address"),
        "categories": _as_categories(row),
        "companyType": company_type,
        "rating": _coerce_float(row.get("rating")),
        "reviewCount": _coerce_int(row.get("reviews")),
        "googleMapsUrl": row.get("location_link") or None,
        "latitude": _coerce_float(row.get("latitude")),
        "longitude": _coerce_float(row.get("longitude")),
    }
    return lead, None


_STREET_ABBREVIATIONS = {
    "st": "street",
    "rd": "road",
    "ave": "avenue",
    "av": "avenue",
    "blvd": "boulevard",
    "dr": "drive",
    "ln": "lane",
    "ct": "court",
    "cir": "circle",
    "hwy": "highway",
    "pkwy": "parkway",
    "ste": "suite",
}


def _normalize_key_text(value) -> str:
    text = str(value or "").lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    tokens = [_STREET_ABBREVIATIONS.get(t, t) for t in text.split()]
    return " ".join(tokens)


def _phone_digits(value) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def dedup_key(row: dict):
    pid = row.get("place_id")
    if pid:
        return ("pid", str(pid))
    google_id = row.get("google_id") or row.get("cid")
    if google_id:
        return ("gid", str(google_id))
    # Fallback when place_id is absent (rare): name + address.
    address = _first_non_empty(row, "address", "full_address") or ""
    name = _normalize_key_text(row.get("name"))
    if address:
        return ("na", name, _normalize_key_text(address))
    phone = _phone_digits(row.get("phone"))
    if phone:
        return ("np", name, phone)
    city_state = _normalize_key_text(f'{row.get("city") or ""} {row.get("state") or ""}')
    return ("nc", name, city_state)


def lead_dedup_key(lead: dict):
    """Stable local identity for already-accepted/outbox lead payloads."""
    pid = lead.get("googlePlaceId")
    if pid:
        return ("pid", str(pid))
    name = _normalize_key_text(lead.get("name"))
    state = normalize_state(lead.get("state")) or ""
    address = lead.get("address") or ""
    if address:
        return ("nsa", name, state, _normalize_key_text(address))
    phone = _phone_digits(lead.get("phone"))
    if phone:
        return ("nsp", name, state, phone)
    city = _normalize_key_text(lead.get("city") or lead.get("market") or "")
    return ("nsc", name, state, city)


def _richness_score(row: dict) -> tuple:
    categories = _as_categories(row)
    return (
        1 if row.get("place_id") else 0,
        1 if (row.get("google_id") or row.get("cid")) else 0,
        1 if _first_non_empty(row, "website", "site") else 0,
        1 if row.get("phone") else 0,
        1 if _first_non_empty(row, "address", "full_address") else 0,
        min(len(categories), 8),
        1 if _coerce_float(row.get("rating")) is not None else 0,
        _coerce_int(row.get("reviews")) or 0,
        1 if row.get("location_link") else 0,
        1 if (_coerce_float(row.get("latitude")) is not None and _coerce_float(row.get("longitude")) is not None) else 0,
    )


def dedup_by_place_id(rows: list[dict]) -> list[dict]:
    """Collapse duplicate businesses within a ZIP (plan §5 contract).

    Group by place_id (fallback name+address). Keep the richest row per group
    and set its `_term` to the preferred term among the group's members. Order is
    still preserved by first appearance of the group.
    """
    groups: dict = {}
    order: list = []
    for row in rows:
        key = dedup_key(row)
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(row)

    survivors = []
    for key in order:
        members = groups[key]
        terms = {m.get("_term") for m in members if m.get("_term")}
        winning = next((t for t in _TERM_PREFERENCE if t in terms), members[0].get("_term"))
        survivor = dict(max(members, key=_richness_score))
        survivor["_term"] = winning
        survivors.append(survivor)
    return survivors
