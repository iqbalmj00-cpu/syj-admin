"""
Ingest — POST thin leads to the dashboard's existing upsert route.

POST {DASHBOARD}/api/agents/leads {secret, leads}  (no agentRunId — plan §2/§4B).
Chunked ≤50/POST (mandatory: the leads route has no maxDuration and each lead is
2-3 sequential DB roundtrips). Retry a failed chunk once, then return per-lead
failure details so `server.py` can preserve paid rows in the local outbox. The
dashboard identity contract makes confirmed re-posts idempotent. Plan §3B.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

logger = logging.getLogger("lead_scraper.ingest")

CHUNK_SIZE = 50


async def post_leads(leads: list[dict], dashboard_url: str, secret: str,
                     chunk_size: int = CHUNK_SIZE) -> dict:
    """Upsert leads in chunks.

    Returns the legacy summary plus per-lead results so the worker can preserve
    paid-for leads that failed to upload:
    {created, updated, skipped, total, results, failed_leads, saved_leads}.
    """
    totals = {
        "created": 0,
        "updated": 0,
        "skipped": 0,
        "total": len(leads),
        "results": [],
        "failed_leads": [],
        "saved_leads": [],
    }
    if not leads:
        return totals

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        for i in range(0, len(leads), chunk_size):
            chunk = leads[i:i + chunk_size]
            data = await _post_chunk(client, chunk, dashboard_url, secret)
            if data is None:  # both attempts failed
                totals["skipped"] += len(chunk)
                for offset, lead in enumerate(chunk):
                    result = {
                        "index": i + offset,
                        "name": lead.get("name"),
                        "status": "skipped",
                        "reason": "chunk_failed",
                    }
                    totals["results"].append(result)
                    totals["failed_leads"].append(lead)
                continue
            totals["created"] += data.get("created", 0)
            totals["updated"] += data.get("updated", 0)
            totals["skipped"] += data.get("skipped", 0)
            results = data.get("results") if isinstance(data, dict) else None
            if not isinstance(results, list):
                # Backward-compatible fallback for an older dashboard build.
                updated_count = int(data.get("updated", 0) or 0)
                created_count = int(data.get("created", 0) or 0)
                for offset, lead in enumerate(chunk):
                    if offset < updated_count:
                        status = "updated"
                    elif offset < updated_count + created_count:
                        status = "created"
                    else:
                        status = "skipped"
                    result = {"index": i + offset, "name": lead.get("name"), "status": status}
                    totals["results"].append(result)
                    if status in ("created", "updated"):
                        totals["saved_leads"].append(lead)
                    else:
                        result["reason"] = "legacy_summary_skipped"
                        totals["failed_leads"].append(lead)
                continue
            for result in results:
                local_index = int(result.get("index", 0) or 0)
                global_index = i + local_index
                normalized = {**result, "index": global_index}
                totals["results"].append(normalized)
                if 0 <= local_index < len(chunk):
                    lead = chunk[local_index]
                    status = result.get("status")
                    reason = result.get("reason")
                    if (
                        status in ("created", "updated")
                        or str(reason or "").startswith("invalid")
                        or reason in ("name is required", "market is required")
                    ):
                        totals["saved_leads"].append(lead)
                    else:
                        totals["failed_leads"].append(lead)
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
