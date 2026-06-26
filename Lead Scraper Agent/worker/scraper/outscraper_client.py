"""
Outscraper Maps discovery — thin async wrapper over the same `maps/search-v3`
REST endpoint + `X-API-KEY` header the enrichment worker uses
(ENRICHMENT AGENT/agent/gbp_profile.py). Plan §4C/§6.

Contract:
  submit_outscraper_search(...) returns immediately with either finished rows or
  a provider request id/location.
  poll_outscraper_request(...) checks one existing provider request without
  blocking the state sweep.
  outscraper_search(...) remains as the legacy blocking wrapper for tests and
  simple callers.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from urllib.parse import urlparse

import httpx

logger = logging.getLogger("lead_scraper.outscraper")

SEARCH_URL = os.getenv("OUTSCRAPER_SEARCH_URL", "https://api.app.outscraper.com/maps/search-v3")
_FINISHED = {"finished", "success", "completed"}
_PENDING = {"pending", "running", "in progress", "in-progress"}

# Polling bounds for async tasks (large jobs queue for minutes).
POLL_EVERY_S = 25
MAX_WAIT_S = 30 * 60


def _headers(api_key: str) -> dict:
    if not api_key:
        raise RuntimeError("OUTSCRAPER_API_KEY is not set")
    return {"X-API-KEY": api_key}


def _build_params(queries: list[str], limit: int, *, coordinates: str | None,
                  drop_duplicates: bool, total_limit: int | None,
                  region: str | None, fields: str | None) -> list[tuple[str, str]]:
    params = [("query", q) for q in queries]
    params += [("async", "true"), ("limit", str(limit))]
    if coordinates:
        params.append(("coordinates", coordinates))
    if drop_duplicates:
        params.append(("dropDuplicates", "true"))
    if total_limit and total_limit > 0:
        params.append(("totalLimit", str(total_limit)))
    if region:
        params.append(("region", region))
    if fields:
        params.append(("fields", fields))
    return params


def request_url(results_location) -> str:
    """Normalize an Outscraper request id/results_location into a poll URL."""
    if not results_location:
        raise OutscraperError("async submit returned no results_location/id")
    raw = str(results_location)
    if raw.startswith("http"):
        return raw
    return f"https://api.app.outscraper.com/requests/{raw}"


def request_id_from_location(results_location) -> str:
    raw = str(results_location or "")
    if not raw:
        return ""
    if raw.startswith("http"):
        path = urlparse(raw).path.rstrip("/")
        return path.rsplit("/", 1)[-1]
    return raw


async def submit_outscraper_search(queries: list[str], api_key: str, limit: int = 400,
                                   timeout: float = 60.0, *, coordinates: str | None = None,
                                   drop_duplicates: bool = False,
                                   total_limit: int | None = None,
                                   region: str | None = "US",
                                   fields: str | None = None) -> dict:
    """Submit Maps queries and return without waiting for an async provider job."""
    if not queries:
        return {"status": "finished", "data": []}

    headers = _headers(api_key)
    params = _build_params(
        queries,
        limit,
        coordinates=coordinates,
        drop_duplicates=drop_duplicates,
        total_limit=total_limit,
        region=region,
        fields=fields,
    )

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = None
        for attempt in range(1, 4):
            resp = await client.get(SEARCH_URL, params=params, headers=headers)
            if resp.status_code in (249, 429) or 500 <= resp.status_code < 600:
                if attempt < 3:
                    await asyncio.sleep(5 * attempt)
                    continue
                if resp.status_code == 249:
                    raise OutscraperTransient("Outscraper 249 (try again)")
                raise OutscraperTransient(f"submit transient HTTP {resp.status_code}: {resp.text[:300]}")
            break

        # Transient "try again" — let the caller's batch-level retry/backoff handle it.
        if resp.status_code == 249:
            raise OutscraperTransient("Outscraper 249 (try again)")
        if resp.status_code not in (200, 201, 202):
            raise OutscraperError(f"submit HTTP {resp.status_code}: {resp.text[:300]}")

    payload = resp.json()
    data = _extract_finished_data(payload)
    results_location = payload.get("results_location") or payload.get("id")
    if data is not None:
        return {
            "status": "finished",
            "data": data,
            "requestId": request_id_from_location(results_location),
            "resultsLocation": request_url(results_location) if results_location else None,
        }
    if not results_location:
        raise OutscraperError("async submit returned no results_location/id")
    return {
        "status": "pending",
        "requestId": request_id_from_location(results_location),
        "resultsLocation": request_url(results_location),
    }


async def poll_outscraper_request(results_location: str, api_key: str,
                                  timeout: float = 60.0) -> dict:
    """Poll one existing provider request once; never sleep/retry in a long loop."""
    headers = _headers(api_key)
    url = request_url(results_location)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        r = await client.get(url, headers=headers)
    if r.status_code in (202, 204):
        return {"status": "pending"}
    if r.status_code in (249, 429) or 500 <= r.status_code < 600:
        raise OutscraperTransient(f"poll transient HTTP {r.status_code}: {r.text[:300]}")
    if r.status_code != 200:
        raise OutscraperError(f"poll HTTP {r.status_code}: {r.text[:300]}")

    body = r.json()
    data = _extract_finished_data(body)
    if data is not None:
        return {"status": "finished", "data": data}
    status = _normalize_status(body.get("status"))
    if status in _PENDING or not status:
        return {"status": "pending"}
    raise OutscraperError(f"task ended with status '{status}'")


def _extract_finished_data(payload: dict):
    """Return `data` if the payload is already finished, else None."""
    status = str(payload.get("status", "")).lower()
    if status in _FINISHED and isinstance(payload.get("data"), list):
        return payload["data"]
    # Some sync responses just carry `data` with no status.
    if "data" in payload and "status" not in payload and isinstance(payload["data"], list):
        return payload["data"]
    return None


def _normalize_status(value) -> str:
    text = str(value or "").strip().lower()
    return re.sub(r"\s+", " ", text)


async def _poll_until_finished(client: httpx.AsyncClient, results_location, headers) -> list:
    url = request_url(results_location)

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
        status = _normalize_status(body.get("status"))
        if status in _FINISHED and isinstance(body.get("data"), list):
            return body["data"]
        if status and status not in _PENDING and status not in _FINISHED:
            raise OutscraperError(f"task ended with status '{status}'")
    raise OutscraperError(f"task did not finish within {MAX_WAIT_S}s")


async def outscraper_search(queries: list[str], api_key: str, limit: int = 400,
                            timeout: float = 60.0, *, coordinates: str | None = None,
                            drop_duplicates: bool = False, total_limit: int | None = None,
                            region: str | None = "US", fields: str | None = None) -> list[dict]:
    """Legacy blocking wrapper: submit, then poll until finished."""
    submitted = await submit_outscraper_search(
        queries,
        api_key,
        limit,
        timeout,
        coordinates=coordinates,
        drop_duplicates=drop_duplicates,
        total_limit=total_limit,
        region=region,
        fields=fields,
    )
    data = submitted.get("data")
    if submitted.get("status") != "finished":
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            data = await _poll_until_finished(client, submitted.get("resultsLocation"), _headers(api_key))
    return _normalize(data or [], len(queries), drop_duplicates=drop_duplicates)


def _normalize(data: list, n_queries: int, *, drop_duplicates: bool = False) -> list[dict]:
    """Outscraper list-of-lists -> [{"data": [...]}] aligned to the queries."""
    if not isinstance(data, list):
        raise OutscraperError("response `data` is not a list")

    if drop_duplicates and not data:
        return [{"data": [], "error": None, "combined": True}]
    if drop_duplicates and _looks_like_combined_rows(data, n_queries):
        return [{"data": data, "error": None, "combined": True}]

    out = []
    for entry in data:
        if isinstance(entry, list):
            out.append({"data": entry, "error": None})
            continue
        if isinstance(entry, dict):
            status = _normalize_status(entry.get("status"))
            error = entry.get("error") or entry.get("message")
            if status and status not in _PENDING and status not in _FINISHED:
                error = error or f"task status {status}"
            rows = entry.get("data", []) if isinstance(entry.get("data", []), list) else []
            out.append({"data": rows, "error": error, "status": status or None})
            continue
        out.append({"data": [], "error": "unexpected result entry"})
    # The §5 loop hard-checks len(out) == n_queries; we don't pad/guess here.
    return out


def normalize_search_data(data: list, n_queries: int = 1, *,
                          drop_duplicates: bool = False) -> list[dict]:
    """Public normalization helper for non-blocking provider jobs."""
    return _normalize(data, n_queries, drop_duplicates=drop_duplicates)


def _looks_like_combined_rows(data: list, n_queries: int) -> bool:
    if not data:
        return False
    if all(isinstance(item, dict) and ("name" in item or "place_id" in item or "google_id" in item)
           for item in data):
        return True
    # A one-query response is ambiguous; list-of-lists is still not combined.
    if n_queries == 1 and len(data) == 1 and isinstance(data[0], list):
        return False
    return False


class OutscraperError(RuntimeError):
    pass


class OutscraperTransient(OutscraperError):
    pass
