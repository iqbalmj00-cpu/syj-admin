"""
Outscraper Maps discovery — thin async wrapper over the same `maps/search-v3`
REST endpoint + `X-API-KEY` header the enrichment worker uses
(ENRICHMENT AGENT/agent/gbp_profile.py). Plan §4C/§6.

Contract (so the control loop §5 can rely on it):
  outscraper_search(queries) -> list[dict], length == len(queries) on success.
  Each element is {"data": [business_dict, ...]} — the businesses Google
  returned for that query (empty list for a 0-result query).
  Raises on transport/HTTP/task failure so the loop marks the whole batch `error`.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

logger = logging.getLogger("lead_scraper.outscraper")

SEARCH_URL = "https://api.app.outscraper.com/maps/search-v3"
_FINISHED = {"finished", "success", "completed"}
_PENDING = {"pending", "running", "in progress", "in-progress"}

# Polling bounds for async tasks (large jobs queue for minutes).
POLL_EVERY_S = 25
MAX_WAIT_S = 30 * 60


async def outscraper_search(queries: list[str], api_key: str, limit: int = 400,
                            timeout: float = 60.0) -> list[dict]:
    """Submit a batch of Maps queries (async) and return per-query result objects."""
    if not queries:
        return []
    if not api_key:
        raise RuntimeError("OUTSCRAPER_API_KEY is not set")

    headers = {"X-API-KEY": api_key}
    params = [("query", q) for q in queries]
    params += [("async", "true"), ("limit", str(limit))]

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(SEARCH_URL, params=params, headers=headers)

        # Transient "try again" — let the caller's batch-level retry/backoff handle it.
        if resp.status_code == 249:
            raise OutscraperTransient("Outscraper 249 (try again)")
        if resp.status_code not in (200, 201, 202):
            raise OutscraperError(f"submit HTTP {resp.status_code}: {resp.text[:300]}")

        payload = resp.json()
        data = _extract_finished_data(payload)
        if data is None:
            results_location = payload.get("results_location") or payload.get("id")
            data = await _poll_until_finished(client, results_location, headers)

    return _normalize(data, len(queries))


def _extract_finished_data(payload: dict):
    """Return `data` if the payload is already finished, else None."""
    status = str(payload.get("status", "")).lower()
    if status in _FINISHED and isinstance(payload.get("data"), list):
        return payload["data"]
    # Some sync responses just carry `data` with no status.
    if "data" in payload and "status" not in payload and isinstance(payload["data"], list):
        return payload["data"]
    return None


async def _poll_until_finished(client: httpx.AsyncClient, results_location, headers) -> list:
    if not results_location:
        raise OutscraperError("async submit returned no results_location/id")
    url = results_location if str(results_location).startswith("http") \
        else f"https://api.app.outscraper.com/requests/{results_location}"

    waited = 0
    while waited < MAX_WAIT_S:
        await asyncio.sleep(POLL_EVERY_S)
        waited += POLL_EVERY_S
        r = await client.get(url, headers=headers)
        if r.status_code == 202 or r.status_code == 204:
            continue  # still processing
        if r.status_code != 200:
            raise OutscraperError(f"poll HTTP {r.status_code}: {r.text[:300]}")
        body = r.json()
        status = str(body.get("status", "")).lower()
        if status in _FINISHED and isinstance(body.get("data"), list):
            return body["data"]
        if status and status not in _PENDING and status not in _FINISHED:
            raise OutscraperError(f"task ended with status '{status}'")
    raise OutscraperError(f"task did not finish within {MAX_WAIT_S}s")


def _normalize(data: list, n_queries: int) -> list[dict]:
    """Outscraper list-of-lists -> [{"data": [...]}] aligned to the queries."""
    if not isinstance(data, list):
        raise OutscraperError("response `data` is not a list")
    out = []
    for entry in data:
        rows = entry if isinstance(entry, list) else (entry.get("data", []) if isinstance(entry, dict) else [])
        out.append({"data": rows, "error": None})
    # The §5 loop hard-checks len(out) == n_queries; we don't pad/guess here.
    return out


class OutscraperError(RuntimeError):
    pass


class OutscraperTransient(OutscraperError):
    pass
