"""
Region expansion: a target (state code or "ALL") -> its list of ZIP rows.

Reads the bundled SimpleMaps `uszips` CSV (columns: zip, city, state_id, ...).
Filters to the 50 states + DC only — territories (PR/VI/GU/AS/MP) and military
(AA/AE/AP) ZIPs are excluded, including under "ALL" (plan §3B).

A ZIP row is a plain dict {"zip", "city", "state"} (state = 2-letter code).
"""

from __future__ import annotations

import csv
import os
from typing import Iterator

# 50 states + DC. No territories, no military.
US_STATES = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    "DC",
]
US_STATES_SET = set(US_STATES)

_WORKER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DATA_DIR = os.path.join(_WORKER_DIR, "data")
DEFAULT_CSV = os.path.join(_DATA_DIR, "us_zips.csv")
SIMPLEMAPS_CSV = os.path.join(_WORKER_DIR, "simplemaps_uszips_basicv1", "uszips.csv")


def _csv_path() -> str:
    # Allow an env override (e.g. tests point at a fixture); else use the standard
    # data path or the uploaded SimpleMaps folder.
    override = os.getenv("US_ZIPS_CSV")
    if override:
        return override
    for candidate in (DEFAULT_CSV, SIMPLEMAPS_CSV):
        if os.path.exists(candidate):
            return candidate
    return DEFAULT_CSV


def _read_rows(path: str | None = None) -> Iterator[dict]:
    """Yield {zip, city, state} for every in-scope ZIP in the CSV.

    SimpleMaps columns: `zip`, `city`, `state_id` (2-letter). We tolerate a
    `state` column too (fixtures), preferring `state_id` when present.
    """
    path = path or _csv_path()
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"ZIP dataset not found. Place the SimpleMaps `uszips` CSV at {DEFAULT_CSV} "
            f"or {SIMPLEMAPS_CSV} (or set US_ZIPS_CSV). See README."
        )
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            state = (r.get("state_id") or r.get("state") or "").strip().upper()
            if state not in US_STATES_SET:
                continue
            zip_code = (r.get("zip") or "").strip()
            city = (r.get("city") or "").strip()
            if not zip_code:
                continue
            yield {"zip": zip_code, "city": city, "state": state}


def expand(target: str) -> list[str]:
    """A target -> the ordered list of state codes to sweep."""
    t = (target or "").strip().upper()
    if t == "ALL":
        return list(US_STATES)
    return [t] if t in US_STATES_SET else []


def zips_for_target(target: str, path: str | None = None) -> list[dict]:
    """All in-scope ZIP rows for a single state code (or every state for ALL)."""
    states = set(expand(target))
    if not states:
        return []
    return [row for row in _read_rows(path) if row["state"] in states]


def zips_for_state(state: str, path: str | None = None) -> list[dict]:
    """ZIP rows for exactly one 2-letter state code."""
    s = (state or "").strip().upper()
    if s not in US_STATES_SET:
        return []
    return [row for row in _read_rows(path) if row["state"] == s]


def is_valid_target(target: str) -> bool:
    t = (target or "").strip().upper()
    return t == "ALL" or t in US_STATES_SET
