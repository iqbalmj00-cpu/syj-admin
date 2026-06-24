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


# ── Locked agent config (mirrors the A1 seed config in the admin repo) ──
SEARCH_TERMS = ["junk removal", "dumpster rental"]
BATCH_ZIP_COUNT = int(os.getenv("BATCH_ZIP_COUNT", "4"))  # ZIPs per worker batch (×2 terms)
SKIP_EMPTY_ON_RERUN = True
RESULTS_LIMIT = int(os.getenv("RESULTS_LIMIT", "400"))  # explicit high cap — never omit `limit`
INGEST_CHUNK_SIZE = 50        # ≤50 leads per POST (plan §3B/ingest)


@dataclass(frozen=True)
class Cfg:
    search_terms: list = field(default_factory=lambda: list(SEARCH_TERMS))
    batch_zip_count: int = BATCH_ZIP_COUNT
    skip_empty: bool = SKIP_EMPTY_ON_RERUN
    results_limit: int = RESULTS_LIMIT
    ingest_chunk_size: int = INGEST_CHUNK_SIZE


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
