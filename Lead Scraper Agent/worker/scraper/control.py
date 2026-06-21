"""
Control-plane client — talks to the dashboard's lead-scraper route (plan §4A).

  GET  {DASHBOARD}/api/agents/lead-scraper?secret=…
       -> {active, target, startNonce, progress, agentStatus}
  POST {DASHBOARD}/api/agents/lead-scraper {secret, action:"progress"|"done", ...}

The worker only ever acts when GET returns active=true (manual-only — the
operator pressed Start in the dashboard). There are NO timers here.
"""

from __future__ import annotations

import logging

import httpx

logger = logging.getLogger("lead_scraper.control")


async def get_control(dashboard_url: str, secret: str) -> dict:
    """Return the current control state; a safe idle reading on any failure."""
    idle = {"active": False, "target": None, "startNonce": None, "progress": None, "agentStatus": "idle"}
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(
                f"{dashboard_url}/api/agents/lead-scraper",
                params={"secret": secret},
            )
            if resp.status_code != 200:
                logger.warning("get_control HTTP %s", resp.status_code)
                return idle
            data = resp.json()
            return {
                "active": bool(data.get("active")),
                "target": data.get("target"),
                "startNonce": data.get("startNonce"),
                "progress": data.get("progress"),
                "agentStatus": data.get("agentStatus", "idle"),
            }
    except Exception as e:  # noqa: BLE001
        logger.warning("get_control error: %s", e)
        return idle


async def post_progress(dashboard_url: str, secret: str, progress: dict) -> None:
    await _post(dashboard_url, secret, {"action": "progress", "progress": progress})


async def post_done(dashboard_url: str, secret: str, start_nonce: str | None = None) -> None:
    # Carry the run's start nonce so the dashboard can discard a `done` from a superseded run
    # (operator did Stop→Start while this worker was finishing its old sweep's final batch).
    await _post(dashboard_url, secret, {"action": "done", "startNonce": start_nonce})


async def _post(dashboard_url: str, secret: str, body: dict) -> None:
    body = {"secret": secret, **body}
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.post(f"{dashboard_url}/api/agents/lead-scraper", json=body)
            if resp.status_code != 200:
                logger.warning("control POST %s -> HTTP %s: %s",
                               body.get("action"), resp.status_code, resp.text[:200])
    except Exception as e:  # noqa: BLE001
        logger.warning("control POST %s error: %s", body.get("action"), e)
