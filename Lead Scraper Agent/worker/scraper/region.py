"""
Region expansion: a target (state code or "ALL") -> ZIP rows or city targets.

The original scraper swept every ZIP. The current default discovery mode sweeps
every unique city/town once, then adds coordinate grid targets only for large
markets. This preserves small-town recall without paying for every overlapping
ZIP centroid in dense metros.
"""

from __future__ import annotations

import csv
import math
import os
import re
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


def _to_float(value) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _to_int(value) -> int:
    try:
        return int(float(value)) if value not in (None, "") else 0
    except (TypeError, ValueError):
        return 0


def _slug(value: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower())
    return text.strip("-") or "unknown"


def _read_detailed_rows(path: str | None = None) -> Iterator[dict]:
    """Yield detailed ZIP rows for every in-scope ZIP in the CSV.

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
            yield {
                "zip": zip_code,
                "city": city,
                "state": state,
                "lat": _to_float(r.get("lat")),
                "lng": _to_float(r.get("lng")),
                "population": _to_int(r.get("population")),
                "density": _to_float(r.get("density")) or 0.0,
            }


def _read_rows(path: str | None = None) -> Iterator[dict]:
    """Yield the legacy minimal ZIP row shape."""
    for row in _read_detailed_rows(path):
        yield {"zip": row["zip"], "city": row["city"], "state": row["state"]}


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


def detailed_zips_for_state(state: str, path: str | None = None) -> list[dict]:
    """Detailed ZIP rows for exactly one 2-letter state code."""
    s = (state or "").strip().upper()
    if s not in US_STATES_SET:
        return []
    return [row for row in _read_detailed_rows(path) if row["state"] == s]


def _weighted_average(rows: list[dict], key: str) -> float | None:
    valid = [r for r in rows if r.get(key) is not None]
    if not valid:
        return None
    total_weight = sum(max(int(r.get("population") or 0), 1) for r in valid)
    return sum(float(r[key]) * max(int(r.get("population") or 0), 1) for r in valid) / total_weight


def _tier(population: int, density: float, zip_count: int) -> str:
    if population >= 500_000 or zip_count >= 30:
        return "major"
    if population >= 150_000 or density >= 2_500 or zip_count >= 15:
        return "large"
    if population >= 50_000 or density >= 1_000 or zip_count >= 5:
        return "medium"
    return "small"


def city_targets_for_state(state: str, path: str | None = None) -> list[dict]:
    """Return one baseline target for every unique city/town in a state.

    Population and density are aggregated from ZIP rows; they are used only for
    ordering and grid-expansion decisions, never to drop small towns.
    """
    groups: dict[tuple[str, str], list[dict]] = {}
    for row in detailed_zips_for_state(state, path):
        city = (row.get("city") or "").strip()
        if not city:
            continue
        key = (city.lower(), row["state"])
        groups.setdefault(key, []).append(row)

    targets: list[dict] = []
    for (_city_key, st), rows in groups.items():
        city = rows[0]["city"].strip()
        population = sum(int(r.get("population") or 0) for r in rows)
        density = max(float(r.get("density") or 0.0) for r in rows)
        lat = _weighted_average(rows, "lat")
        lng = _weighted_average(rows, "lng")
        zip_count = len(rows)
        city_slug = _slug(city)
        targets.append({
            "key": f"{st}:city:{city_slug}",
            "state": st,
            "city": city,
            "targetType": "city",
            "lat": lat,
            "lng": lng,
            "population": population,
            "density": density,
            "zipCount": zip_count,
            "zips": sorted(r["zip"] for r in rows),
            "tier": _tier(population, density, zip_count),
        })

    # Large markets first for fast feedback, then deterministic city order.
    return sorted(targets, key=lambda t: (-int(t["population"]), t["state"], t["city"].lower()))


def _grid_radius_miles(target: dict, min_population: int, min_zip_count: int) -> float:
    population = int(target.get("population") or 0)
    zip_count = int(target.get("zipCount") or 0)
    if population < min_population and zip_count < min_zip_count:
        return 0.0
    if population >= 500_000 or zip_count >= 30:
        return 20.0
    if population >= 250_000 or zip_count >= 15:
        return 15.0
    return 10.0


def grid_targets_for_city(
    target: dict,
    *,
    spacing_miles: float = 10.0,
    max_points: int = 12,
    min_population: int = 100_000,
    min_zip_count: int = 8,
) -> list[dict]:
    """Generate coordinate expansion targets around a large market.

    The city baseline target already covers the geocoded city center, so the
    grid excludes the zero-offset point.
    """
    if not target.get("lat") or not target.get("lng") or max_points <= 0:
        return []
    radius = _grid_radius_miles(target, min_population, min_zip_count)
    if radius <= 0:
        return []

    spacing = max(float(spacing_miles or 10.0), 1.0)
    center_lat = float(target["lat"])
    center_lng = float(target["lng"])
    lat_degree_miles = 69.0
    lng_degree_miles = max(69.0 * math.cos(math.radians(center_lat)), 1.0)

    offsets: list[tuple[float, float, float]] = []
    steps = range(-math.ceil(radius / spacing), math.ceil(radius / spacing) + 1)
    for ix in steps:
        for iy in steps:
            dx = ix * spacing
            dy = iy * spacing
            distance = math.hypot(dx, dy)
            if distance == 0 or distance > radius:
                continue
            offsets.append((distance, dx, dy))
    offsets.sort(key=lambda item: (item[0], abs(item[1]), abs(item[2])))

    out: list[dict] = []
    city_slug = _slug(target["city"])
    for distance, dx, dy in offsets[:max_points]:
        lat = center_lat + (dy / lat_degree_miles)
        lng = center_lng + (dx / lng_degree_miles)
        lat_r = round(lat, 5)
        lng_r = round(lng, 5)
        out.append({
            **target,
            "key": f'{target["state"]}:grid:{city_slug}:{lat_r:.5f}:{lng_r:.5f}',
            "targetType": "grid",
            "lat": lat_r,
            "lng": lng_r,
            "gridDistanceMiles": round(distance, 2),
        })
    return out


def discovery_targets_for_state(
    state: str,
    path: str | None = None,
    *,
    include_grid: bool = True,
    spacing_miles: float = 10.0,
    max_grid_points: int = 12,
    grid_min_population: int = 100_000,
    grid_min_zip_count: int = 8,
) -> list[dict]:
    """Baseline city targets plus optional large-market grid targets."""
    cities = city_targets_for_state(state, path)
    targets: list[dict] = []
    for city in cities:
        targets.append(city)
        if include_grid:
            targets.extend(grid_targets_for_city(
                city,
                spacing_miles=spacing_miles,
                max_points=max_grid_points,
                min_population=grid_min_population,
                min_zip_count=grid_min_zip_count,
            ))
    return targets


def is_valid_target(target: str) -> bool:
    t = (target or "").strip().upper()
    return t == "ALL" or t in US_STATES_SET
