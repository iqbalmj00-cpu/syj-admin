"""
Lead Scraper Agent — FastAPI server + self-driving control loop.

Discovers junk-removal & dumpster-rental businesses on Google Maps (Outscraper)
by ZIP, and ingests thin leads into the SYJ admin dashboard for enrichment.

MANUAL-ONLY: the loop acts only while the dashboard's lead_scraper_active flag is
true (the operator pressed Start). No cron, no timers. Implements the algorithm
in LEAD_SCRAPER_TECHNICAL_PLAN.md §5.

Start (same conventions as the enrichment agent):
    cd "/Volumes/CODE/JAMALS ADMIN DASH/Lead Scraper Agent/worker"
    source venv/bin/activate
    caffeinate -dimsu python -m uvicorn server:app --host 127.0.0.1 --port 8007
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI

from scraper.config import cfg, load_env
from scraper import control, ingest as ingest_mod, mapper, region
from scraper.ledger import Ledger
from scraper.outscraper_client import outscraper_search

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("lead_scraper")

ENV = load_env()
LEDGER = Ledger()

_state = {"running_sweep": False, "last_control": None}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _progress_payload(state: str, start_nonce) -> dict:
    p = LEDGER.progress(state)
    p["startNonce"] = start_nonce
    p["updatedAt"] = _now_iso()
    return p


async def _ingest_leads(leads: list[dict]) -> dict:
    """Real ingest, or a stubbed log in DRY_RUN mode."""
    if ENV.dry_run_target:
        logger.info("[DRY_RUN] would ingest %d leads (e.g. %s)", len(leads),
                    leads[0]["name"] if leads else "—")
        return {"created": len(leads), "updated": 0, "skipped": 0, "total": len(leads)}
    return await ingest_mod.post_leads(leads, ENV.dashboard_url, ENV.callback_secret,
                                       chunk_size=cfg.ingest_chunk_size)


async def _report_progress(state: str, start_nonce) -> None:
    if ENV.dry_run_target:
        logger.info("[DRY_RUN] progress: %s", LEDGER.progress(state))
        return
    await control.post_progress(ENV.dashboard_url, ENV.callback_secret,
                                _progress_payload(state, start_nonce))


async def _get_control() -> dict:
    if ENV.dry_run_target:
        return {"active": True, "target": ENV.dry_run_target, "startNonce": "dry-run",
                "progress": None, "agentStatus": "running"}
    return await control.get_control(ENV.dashboard_url, ENV.callback_secret)


async def run_sweep(ctrl: dict) -> None:
    """Sweep the control target end-to-end (plan §5). Honors Stop between batches."""
    target = ctrl["target"]
    start_nonce = ctrl.get("startNonce")
    stopped = False

    for st in region.expand(target):
        if stopped:
            break
        zip_rows = region.zips_for_state(st)
        if not zip_rows:
            logger.warning("no ZIPs for state %s — skipping", st)
            continue
        LEDGER.seed_from_csv(st, zip_rows)
        LEDGER.start_sweep_if_needed(st, start_nonce, cfg.skip_empty)
        ziprow_by_zip = {r["zip"]: r for r in zip_rows}

        while True:
            ctrl = await _get_control()
            if not ctrl.get("active"):
                stopped = True
                break  # Stop -> leave WITHOUT post_done
            batch = LEDGER.next_batch(st, cfg.batch_zip_count)
            if not batch:
                break  # this state's sweep is finished

            # Guard: a ledger ZIP absent from the current CSV (dataset swapped between runs) would
            # KeyError on the ziprow lookup below and crash-loop the sweep. Mark such ZIPs error so
            # they leave the pending queue, then proceed with the rest.
            missing = [z for z in batch if z["zip"] not in ziprow_by_zip]
            if missing:
                for z in missing:
                    LEDGER.mark(z["zip"], "error", last_error="zip not in current CSV dataset")
                logger.warning("%d ledger ZIP(s) absent from CSV — marked error", len(missing))
                batch = [z for z in batch if z["zip"] in ziprow_by_zip]
                if not batch:
                    await _report_progress(st, start_nonce)
                    continue

            pairs = [(z, term) for z in batch for term in cfg.search_terms]
            queries = [f'{term}, {ziprow_by_zip[z["zip"]]["city"]}, {st} {z["zip"]}'
                       for (z, term) in pairs]

            try:
                results = await outscraper_search(queries, ENV.outscraper_api_key,
                                                  limit=cfg.results_limit)
            except Exception as e:  # noqa: BLE001 — whole batch retried next sweep
                logger.warning("batch search failed (%s ZIPs): %s", len(batch), e)
                for z in batch:
                    LEDGER.mark(z["zip"], "error", last_error=str(e)[:300])
                await _report_progress(st, start_nonce)
                continue

            if len(results) != len(queries):
                logger.warning("result/query length mismatch (%d vs %d) — batch error",
                               len(results), len(queries))
                for z in batch:
                    LEDGER.mark(z["zip"], "error", last_error="result/query length mismatch")
                await _report_progress(st, start_nonce)
                continue

            by_zip = {z["zip"]: {"rows": [], "errored": False} for z in batch}
            for i, res in enumerate(results):
                z, term = pairs[i]
                if res is None or res.get("error"):
                    by_zip[z["zip"]]["errored"] = True
                    continue
                for row in res.get("data", []):
                    row["_term"] = term
                    by_zip[z["zip"]]["rows"].append(row)

            for z in batch:
                bucket = by_zip[z["zip"]]
                if bucket["errored"]:
                    LEDGER.mark(z["zip"], "error", last_error="task failed")
                    continue
                rows = mapper.dedup_by_place_id(bucket["rows"])
                ziprow = ziprow_by_zip[z["zip"]]
                leads = [L for row in rows if (L := mapper.to_lead(row, ziprow))]
                r = await _ingest_leads(leads) if leads else {"created": 0, "updated": 0}
                LEDGER.mark(z["zip"], "empty" if not rows else "done",
                            raw_rows=len(bucket["rows"]),
                            new_leads=r.get("created", 0) + r.get("updated", 0))

            await _report_progress(st, start_nonce)
            logger.info("state=%s progress=%s", st, LEDGER.progress(st))

    if not stopped and not ENV.dry_run_target:
        await control.post_done(ENV.dashboard_url, ENV.callback_secret, start_nonce)
        logger.info("target '%s' finished — posted done", target)


async def control_loop() -> None:
    """Poll the control plane; run a sweep whenever the operator has it active."""
    logger.info("Lead Scraper started — polling %s every %ds (dry_run=%s)",
                ENV.dashboard_url, ENV.poll_interval, ENV.dry_run_target or "off")
    while True:
        try:
            ctrl = await _get_control()
            _state["last_control"] = ctrl
            if ctrl.get("active") and ctrl.get("target") and not _state["running_sweep"]:
                _state["running_sweep"] = True
                try:
                    await run_sweep(ctrl)
                finally:
                    _state["running_sweep"] = False
        except Exception as e:  # noqa: BLE001 — never let the loop die
            logger.error("control loop error: %s", e)
            _state["running_sweep"] = False
        if ENV.dry_run_target:
            logger.info("[DRY_RUN] single pass complete — exiting loop")
            return
        await asyncio.sleep(ENV.poll_interval)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(control_loop())
    yield
    task.cancel()


app = FastAPI(title="Lead Scraper Agent", lifespan=lifespan)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "agent": "lead_scraper",
        "mode": "dry_run" if ENV.dry_run_target else "live",
        "running_sweep": _state["running_sweep"],
        "dashboard": ENV.dashboard_url,
    }
