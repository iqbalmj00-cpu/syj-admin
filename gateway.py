"""
SYJ Agent Gateway — gateway.py

Single entry point for all agent triggers. Runs on one port (8000),
routes to the correct agent server based on URL path.

Routes:
  POST /lead_scraper/run    → localhost:8001/run
  POST /cold_outreach/run   → localhost:8002/run
  POST /content_generator/run → localhost:8003/run
  POST /blog_writer/run     → localhost:8004/run
  GET  /health              → gateway health
"""

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI(title="SYJ Agent Gateway")

AGENT_PORTS = {
    # lead_scraper removed — it polls the dashboard directly, no gateway needed
    "cold_outreach": 8002,
    "content_generator": 8003,
    "blog_writer": 8004,
}


@app.get("/health")
async def health():
    """Gateway health check — also checks which agents are reachable."""
    statuses = {}
    async with httpx.AsyncClient(timeout=3) as client:
        for slug, port in AGENT_PORTS.items():
            try:
                r = await client.get(f"http://localhost:{port}/health")
                statuses[slug] = {"status": "up", "port": port, "response": r.json()}
            except Exception:
                statuses[slug] = {"status": "down", "port": port}
    return {"gateway": "ok", "agents": statuses}


@app.api_route("/{agent_slug}/run", methods=["POST"])
async def proxy_run(agent_slug: str, request: Request):
    """Forward run request to the correct agent server."""
    port = AGENT_PORTS.get(agent_slug)
    if not port:
        return JSONResponse({"error": f"Unknown agent: {agent_slug}"}, status_code=404)

    body = await request.json()

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(f"http://localhost:{port}/run", json=body)
            return JSONResponse(resp.json(), status_code=resp.status_code)
    except httpx.ConnectError:
        return JSONResponse(
            {"error": f"Agent {agent_slug} is not running on port {port}"},
            status_code=503,
        )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)
