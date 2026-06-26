"""
Worker configuration.

`cfg` is the agent-config snapshot the worker reads once at boot. Per the
technical plan (§5), changing these in the dashboard requires a worker restart —
the control route returns control state, not config.

Env (.env, same conventions as ENRICHMENT AGENT):
  OUTSCRAPER_API_KEY    — Outscraper key (same key the enrichment worker uses)
  AGENT_CALLBACK_URL    — dashboard base URL (e.g. https://syj-admin.vercel.app)
  AGENT_CALLBACK_SECRET — shared secret for dashboard worker routes
  POLL_INTERVAL         — control-poll cadence, seconds (default 10)
  DRY_RUN_TARGET        — dev only: bypass control route, sweep this state, stub ingest
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _csv(value: str | None, default: list[str]) -> list[str]:
    if not value:
        return list(default)
    items = [item.strip() for item in value.split(",") if item.strip()]
    return items or list(default)


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


# ── Discovery defaults ──
DISCOVERY_MODE = os.getenv("DISCOVERY_MODE", "city").strip().lower()

# Every city/town gets the two high-intent terms. Broader terms are deliberately
# expansion-only so the long tail stays covered without reintroducing ZIP-level
# overlap spend.
SEARCH_TERMS = _csv(os.getenv("SEARCH_TERMS"), ["junk removal", "dumpster rental"])
EXPANSION_SEARCH_TERMS = _csv(os.getenv("EXPANSION_SEARCH_TERMS"), ["roll off dumpster"])

# Legacy ZIP setting remains for compatibility, but city mode uses target batches.
BATCH_ZIP_COUNT = _int_env("BATCH_ZIP_COUNT", 4)
BATCH_TARGET_COUNT = _int_env("BATCH_TARGET_COUNT", 4)
SKIP_EMPTY_ON_RERUN = True
RESULTS_LIMIT = _int_env("RESULTS_LIMIT", 400)  # explicit cap — never omit `limit`
INGEST_CHUNK_SIZE = 50        # ≤50 leads per POST (plan §3B/ingest)

# City/market expansion and cost guardrails.
ENABLE_GRID_EXPANSION = _bool_env("ENABLE_GRID_EXPANSION", True)
GRID_SPACING_MILES = _float_env("GRID_SPACING_MILES", 10.0)
MAX_GRID_POINTS_PER_MARKET = _int_env("MAX_GRID_POINTS_PER_MARKET", 12)
GRID_MIN_POPULATION = _int_env("GRID_MIN_POPULATION", 100_000)
GRID_MIN_ZIP_COUNT = _int_env("GRID_MIN_ZIP_COUNT", 8)
ENABLE_DROP_DUPLICATES = _bool_env("ENABLE_DROP_DUPLICATES", False)
TOTAL_LIMIT_PER_TARGET = _int_env("TOTAL_LIMIT_PER_TARGET", 0)  # 0 = no totalLimit
MAX_QUERIES_PER_RUN = _int_env("MAX_QUERIES_PER_RUN", 0)        # 0 = no hard stop
MAX_ACCEPTED_LEADS_PER_RUN = _int_env("MAX_ACCEPTED_LEADS_PER_RUN", 0)
OUTSCRAPER_REGION = os.getenv("OUTSCRAPER_REGION", "US").strip() or "US"
OUTSCRAPER_FIELDS = os.getenv("OUTSCRAPER_FIELDS", "").strip() or None
OUTSCRAPER_JOB_CONCURRENCY = _int_env("OUTSCRAPER_JOB_CONCURRENCY", 3)
OUTSCRAPER_POLL_INTERVAL_SECONDS = _int_env("OUTSCRAPER_POLL_INTERVAL_SECONDS", 25)
OUTSCRAPER_JOB_TIMEOUT_SECONDS = _int_env("OUTSCRAPER_JOB_TIMEOUT_SECONDS", 30 * 60)
OUTSCRAPER_LOOP_SLEEP_SECONDS = _float_env("OUTSCRAPER_LOOP_SLEEP_SECONDS", 5.0)
ADAPTIVE_SECONDARY_TERMS = _bool_env("ADAPTIVE_SECONDARY_TERMS", True)
SECONDARY_TERM_SKIP_DUPLICATE_RATE = _float_env("SECONDARY_TERM_SKIP_DUPLICATE_RATE", 0.80)
SECONDARY_TERM_SKIP_MIN_RAW_ROWS = _int_env("SECONDARY_TERM_SKIP_MIN_RAW_ROWS", 20)


@dataclass(frozen=True)
class Cfg:
    search_terms: list = field(default_factory=lambda: list(SEARCH_TERMS))
    expansion_search_terms: list = field(default_factory=lambda: list(EXPANSION_SEARCH_TERMS))
    discovery_mode: str = DISCOVERY_MODE
    batch_zip_count: int = BATCH_ZIP_COUNT
    batch_target_count: int = BATCH_TARGET_COUNT
    skip_empty: bool = SKIP_EMPTY_ON_RERUN
    results_limit: int = RESULTS_LIMIT
    ingest_chunk_size: int = INGEST_CHUNK_SIZE
    enable_grid_expansion: bool = ENABLE_GRID_EXPANSION
    grid_spacing_miles: float = GRID_SPACING_MILES
    max_grid_points_per_market: int = MAX_GRID_POINTS_PER_MARKET
    grid_min_population: int = GRID_MIN_POPULATION
    grid_min_zip_count: int = GRID_MIN_ZIP_COUNT
    enable_drop_duplicates: bool = ENABLE_DROP_DUPLICATES
    total_limit_per_target: int = TOTAL_LIMIT_PER_TARGET
    max_queries_per_run: int = MAX_QUERIES_PER_RUN
    max_accepted_leads_per_run: int = MAX_ACCEPTED_LEADS_PER_RUN
    outscraper_region: str = OUTSCRAPER_REGION
    outscraper_fields: str | None = OUTSCRAPER_FIELDS
    outscraper_job_concurrency: int = OUTSCRAPER_JOB_CONCURRENCY
    outscraper_poll_interval_seconds: int = OUTSCRAPER_POLL_INTERVAL_SECONDS
    outscraper_job_timeout_seconds: int = OUTSCRAPER_JOB_TIMEOUT_SECONDS
    outscraper_loop_sleep_seconds: float = OUTSCRAPER_LOOP_SLEEP_SECONDS
    adaptive_secondary_terms: bool = ADAPTIVE_SECONDARY_TERMS
    secondary_term_skip_duplicate_rate: float = SECONDARY_TERM_SKIP_DUPLICATE_RATE
    secondary_term_skip_min_raw_rows: int = SECONDARY_TERM_SKIP_MIN_RAW_ROWS


cfg = Cfg()


@dataclass(frozen=True)
class Env:
    outscraper_api_key: str
    dashboard_url: str
    callback_secret: str
    poll_interval: int
    dry_run_target: str | None


def load_env() -> Env:
    return Env(
        outscraper_api_key=os.getenv("OUTSCRAPER_API_KEY", ""),
        dashboard_url=os.getenv("AGENT_CALLBACK_URL", "https://syj-admin.vercel.app").rstrip("/"),
        callback_secret=os.getenv("AGENT_CALLBACK_SECRET", ""),
        poll_interval=int(os.getenv("POLL_INTERVAL", "10")),
        dry_run_target=os.getenv("DRY_RUN_TARGET") or None,
    )
