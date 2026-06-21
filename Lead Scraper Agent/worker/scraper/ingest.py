"""
Ingest — POST thin leads to the dashboard's existing upsert route.

POST {DASHBOARD}/api/agents/leads {secret, leads}  (no agentRunId — plan §2/§4B).
Chunked ≤50/POST (mandatory: the leads route has no maxDuration and each lead is
2-3 sequential DB roundtrips). Retry a failed chunk once, then log and continue
(the googlePlaceId upsert makes re-posts idempotent). Plan §3B.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

logger = logging.getLogger("lead_scraper.ingest")

CHUNK_SIZE = 50


async def post_leads(leads: list[dict], dashboard_url: str, secret: str,
                     chunk_size: int = CHUNK_SIZE) -> dict:
    """Upsert leads in chunks. Returns {created, updated, skipped, total}."""
    totals = {"created": 0, "updated": 0, "skipped": 0, "total": len(leads)}
    if not leads:
        return totals

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        for i in range(0, len(leads), chunk_size):
            chunk = leads[i:i + chunk_size]
            data = await _post_chunk(client, chunk, dashboard_url, secret)
            if data is None:  # both attempts failed
                totals["skipped"] += len(chunk)
                continue
            totals["created"] += data.get("created", 0)
            totals["updated"] += data.get("updated", 0)
            totals["skipped"] += data.get("skipped", 0)
    return totals


async def _post_chunk(client: httpx.AsyncClient, chunk: list[dict],
                      dashboard_url: str, secret: str):
    payload = {"secret": secret, "leads": chunk}
    url = f"{dashboard_url}/api/agents/leads"
    for attempt in (1, 2):
        try:
            resp = await client.post(url, json=payload)
            if resp.status_code == 200:
                return resp.json()
            logger.warning("ingest chunk HTTP %s (attempt %s): %s",
                           resp.status_code, attempt, resp.text[:200])
        except Exception as e:  # noqa: BLE001 — log and retry/continue
            logger.warning("ingest chunk error (attempt %s): %s", attempt, e)
        if attempt == 1:
            await asyncio.sleep(2)
    return None
