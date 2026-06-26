"""
Lead Scraper Agent — FastAPI server + self-driving control loop.

Discovers junk-removal & dumpster-rental businesses on Google Maps (Outscraper)
by city/market targets, and ingests thin leads into the SYJ admin dashboard for
enrichment.

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
from scraper import control, ingest as ingest_mod, mapper, region, relevance
from scraper.ledger import Ledger
from scraper.outscraper_client import (
    OutscraperTransient,
    normalize_search_data,
    outscraper_search,
    poll_outscraper_request,
    submit_outscraper_search,
)

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("lead_scraper")

ENV = load_env()
LEDGER = Ledger()

_state = {
    "running_sweep": False,
    "last_control": None,
    "budget_stop_reason": None,
    "current_activity": None,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _progress_payload(state: str, start_nonce) -> dict:
    p = LEDGER.target_progress(state) if cfg.discovery_mode == "city" else LEDGER.progress(state)
    p["startNonce"] = start_nonce
    p["updatedAt"] = _now_iso()
    if _state.get("budget_stop_reason"):
        p["stopReason"] = _state["budget_stop_reason"]
    if _state.get("current_activity"):
        p["currentActivity"] = _state["current_activity"]
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
        progress = LEDGER.target_progress(state) if cfg.discovery_mode == "city" else LEDGER.progress(state)
        logger.info("[DRY_RUN] progress: %s", progress)
        return
    await control.post_progress(ENV.dashboard_url, ENV.callback_secret,
                                _progress_payload(state, start_nonce))


async def _get_control() -> dict:
    if ENV.dry_run_target:
        return {"active": True, "target": ENV.dry_run_target, "startNonce": "dry-run",
                "progress": None, "agentStatus": "running"}
    return await control.get_control(ENV.dashboard_url, ENV.callback_secret)


def _target_terms(target: dict) -> list[str]:
    terms = list(cfg.search_terms)
    if target.get("targetType") == "grid":
        for term in cfg.expansion_search_terms:
            if term not in terms:
                terms.append(term)
    return terms


def _target_query(term: str, target: dict) -> str:
    return f'{term}, {target["city"]}, {target["state"]}'


def _target_coordinates(target: dict) -> str | None:
    if target.get("targetType") != "grid":
        return None
    lat = target.get("lat")
    lng = target.get("lng")
    if lat is None or lng is None:
        return None
    return f"{float(lat):.5f},{float(lng):.5f}"


def _term_from_query(query: str | None, terms: list[str]) -> str | None:
    if not query:
        return None
    q = query.lower()
    return next((term for term in terms if term.lower() in q), None)


def _saved_result(result: dict) -> bool:
    if result.get("status") in ("created", "updated"):
        return True
    # Dashboard validation skips are intentional terminal outcomes; retrying them
    # would not save the lead and would keep the target stuck forever.
    reason = str(result.get("reason") or "")
    return result.get("status") == "skipped" and (
        reason.startswith("invalid")
        or reason in {"name is required", "market is required"}
    )


def _failed_result(result: dict) -> bool:
    return result.get("status") == "skipped" and not _saved_result(result)


def _result_index(result: dict, size: int) -> int | None:
    try:
        idx = int(result.get("index"))
    except (TypeError, ValueError):
        return None
    return idx if 0 <= idx < size else None


def _ingest_resolution(leads: list[dict], ingest_result: dict) -> tuple[set[int], set[int]]:
    """Return saved/terminal indexes plus failed indexes that must go to outbox."""
    results = ingest_result.get("results")
    if isinstance(results, list):
        saved_indexes: set[int] = set()
        failed_indexes: set[int] = set()
        for result in results:
            if not isinstance(result, dict):
                continue
            idx = _result_index(result, len(leads))
            if idx is None:
                continue
            if _saved_result(result):
                saved_indexes.add(idx)
            elif _failed_result(result):
                failed_indexes.add(idx)
        missing_indexes = set(range(len(leads))) - saved_indexes - failed_indexes
        failed_indexes.update(missing_indexes)
        return saved_indexes, failed_indexes

    # Backward-compatible fallback for older/stubbed dashboard responses.
    skipped = int(ingest_result.get("skipped", 0) or 0)
    if skipped == 0:
        return set(range(len(leads))), set()
    return set(), set(range(len(leads)))


def _summary_statuses(size: int, ingest_result: dict) -> list[str]:
    """Best-effort per-row statuses when only aggregate ingest counts exist."""
    updated = max(int(ingest_result.get("updated", 0) or 0), 0)
    created = max(int(ingest_result.get("created", 0) or 0), 0)
    skipped = max(int(ingest_result.get("skipped", 0) or 0), 0)
    statuses = (["updated"] * updated) + (["created"] * created) + (["skipped"] * skipped)
    if len(statuses) < size:
        statuses.extend(["created"] * (size - len(statuses)))
    return statuses[:size]


def _rows_from_results(results: list[dict], queries: list[str], terms: list[str],
                       target: dict) -> tuple[list[dict], bool]:
    rows: list[dict] = []
    if len(results) == 1 and results[0].get("combined"):
        if results[0].get("error"):
            return [], True
        for row in results[0].get("data", []):
            tagged = dict(row)
            tagged["_term"] = _term_from_query(str(row.get("query") or ""), terms) or terms[0]
            tagged["_target_key"] = target["key"]
            tagged["_target_type"] = target["targetType"]
            rows.append(tagged)
        return rows, False

    if len(results) != len(queries):
        return [], True

    for i, res in enumerate(results):
        if res is None or res.get("error"):
            return [], True
        term = terms[i] if i < len(terms) else _term_from_query(queries[i], terms) or terms[0]
        for row in res.get("data", []):
            tagged = dict(row)
            tagged["_term"] = term
            tagged["_target_key"] = target["key"]
            tagged["_target_type"] = target["targetType"]
            rows.append(tagged)
    return rows, False


def _provider_job_key(target: dict, term: str) -> str:
    normalized_term = "-".join(str(term or "").lower().split())
    return f'{target["key"]}|{normalized_term}'


def _adaptive_secondary_enabled(target: dict) -> bool:
    return bool(getattr(cfg, "adaptive_secondary_terms", False)) and target.get("targetType") == "city"


def _initial_target_terms(target: dict) -> list[str]:
    terms = _target_terms(target)
    if _adaptive_secondary_enabled(target) and len(terms) > 1:
        return terms[:1]
    return terms


def _provider_job_specs(target: dict, terms: list[str] | None = None) -> list[dict]:
    coordinates = _target_coordinates(target)
    specs = []
    for term in (terms or _target_terms(target)):
        specs.append({
            "job_key": _provider_job_key(target, term),
            "term": term,
            "query": _target_query(term, target),
            "coordinates": coordinates,
        })
    return specs


def _remaining_provider_job_specs(target: dict) -> list[dict]:
    all_terms = _target_terms(target)
    existing_terms = {
        str(job.get("term") or "")
        for job in LEDGER.provider_jobs_for_target(target["key"])
        if job.get("term")
    }
    return _provider_job_specs(target, [term for term in all_terms if term not in existing_terms])


def _should_schedule_secondary_terms(target: dict, *, raw_rows: int,
                                     duplicate_rows: int, accepted: int) -> bool:
    """Protect recall unless this target is clearly overlap-only."""
    if not _adaptive_secondary_enabled(target):
        return False
    remaining = _remaining_provider_job_specs(target)
    if not remaining:
        return False
    if accepted > 0:
        return True
    min_rows = max(int(getattr(cfg, "secondary_term_skip_min_raw_rows", 20) or 20), 1)
    if raw_rows < min_rows:
        return True
    duplicate_rate = duplicate_rows / max(raw_rows, 1)
    threshold = float(getattr(cfg, "secondary_term_skip_duplicate_rate", 0.80) or 0.80)
    return duplicate_rate < threshold


def _rows_from_provider_data(data: list) -> list[dict]:
    normalized = normalize_search_data(data or [], 1, drop_duplicates=cfg.enable_drop_duplicates)
    if not normalized:
        return []
    if len(normalized) == 1 and not normalized[0].get("error"):
        return list(normalized[0].get("data", []))
    rows: list[dict] = []
    for result in normalized:
        if result.get("error"):
            continue
        rows.extend(result.get("data", []))
    return rows


def _target_terminal_status(target_key: str, failed_leads: bool = False) -> str | None:
    """Return the target's terminal/holding status if provider work is settled."""
    summary = LEDGER.provider_summary_for_target(target_key)
    if summary["pending_submit"] or summary["submitted"] or summary["finished"]:
        return None
    remaining_outbox = LEDGER.outbox_remaining_by_target(target_key)
    if remaining_outbox:
        return "outbox_pending" if failed_leads else "outbox_error"
    stats = LEDGER.target_stats(target_key) or {}
    if summary["total"] == 0:
        saved = int(stats.get("accepted_leads") or 0) + int(stats.get("created_leads") or 0) + int(stats.get("updated_leads") or 0)
        return "done" if saved else "empty"
    if summary["fetch_error"]:
        return "fetch_error"
    return "empty" if int(stats.get("raw_rows") or 0) == 0 else "done"


def _finalize_target_if_ready(target_key: str, *, failed_leads: bool = False,
                              last_error: str | None = None) -> bool:
    status = _target_terminal_status(target_key, failed_leads=failed_leads)
    if not status:
        return False
    if status == "fetch_error":
        last_error = last_error or "one or more provider jobs failed; retry will fetch only failed jobs"
    elif status in ("done", "empty"):
        last_error = None
    elif status.startswith("outbox"):
        last_error = last_error or "dashboard ingest failed; retrying from local outbox"
    LEDGER.set_target_status(target_key, status, last_error)
    return True


async def _process_ready_target(state: str, target_key: str, start_nonce,
                                accepted_keys: set, run_counters: dict) -> bool:
    """Process locally finished provider rows for one target. Returns budget-stop."""
    target = LEDGER.target_by_key(target_key)
    if not target:
        return False
    jobs = LEDGER.provider_jobs_for_target(target_key, ("finished",))
    if not jobs:
        _finalize_target_if_ready(target_key)
        return False

    for prior_job in LEDGER.provider_jobs_for_target(target_key, ("processed",)):
        for prior_row in prior_job.get("rows", []):
            accepted_keys.add(mapper.dedup_key(prior_row))

    rows: list[dict] = []
    for job in jobs:
        for row in job.get("rows", []):
            tagged = dict(row)
            tagged["_term"] = job["term"]
            tagged["_target_key"] = target["key"]
            tagged["_target_type"] = target["targetType"]
            rows.append(tagged)

    raw_rows = len(rows)
    deduped_rows = mapper.dedup_by_place_id(rows)
    lead_items: list[tuple[tuple, dict]] = []
    rejected: list[dict] = []
    duplicate_rows = max(raw_rows - len(deduped_rows), 0)
    location = {"city": target["city"], "state": target["state"]}

    for row in deduped_rows:
        key = mapper.dedup_key(row)
        if key in accepted_keys:
            duplicate_rows += 1
            continue
        lead, reason = mapper.to_lead_with_reason(row, location)
        if lead:
            lead_items.append((key, lead))
        else:
            rejected.append(relevance.rejection_sample(row, reason or "rejected"))

    leads = [lead for _key, lead in lead_items]
    if cfg.max_accepted_leads_per_run:
        remaining = max(cfg.max_accepted_leads_per_run - run_counters["accepted"], 0)
        if len(leads) > remaining:
            rejected.extend(
                {"name": lead["name"], "categories": lead.get("categories", []), "reason": "accepted_lead_cap"}
                for lead in leads[remaining:]
            )
            leads = leads[:remaining]
            lead_items = lead_items[:remaining]

    ingest_result = await _ingest_leads(leads) if leads else {"created": 0, "updated": 0, "skipped": 0}
    created = int(ingest_result.get("created", 0) or 0)
    updated = int(ingest_result.get("updated", 0) or 0)
    skipped = int(ingest_result.get("skipped", 0) or 0)
    saved_indexes, failed_indexes = _ingest_resolution(leads, ingest_result)
    for index in sorted(saved_indexes | failed_indexes):
        if 0 <= index < len(lead_items):
            accepted_keys.add(lead_items[index][0])

    failed_leads = [leads[index] for index in sorted(failed_indexes) if 0 <= index < len(leads)]
    if failed_leads:
        LEDGER.save_outbox_leads(
            target["key"],
            state,
            failed_leads,
            mapper.lead_dedup_key,
            "dashboard ingest failed",
        )

    accepted = len(leads)
    run_counters["accepted"] += accepted
    LEDGER.add_target_discovery_counts(
        target["key"],
        raw_rows=raw_rows,
        unique_rows=len(deduped_rows),
        duplicate_rows=duplicate_rows,
        filtered_rows=len(rejected),
        accepted_leads=accepted,
        created_leads=created,
        updated_leads=updated,
        skipped_leads=skipped,
    )
    LEDGER.mark_provider_processed([job["id"] for job in jobs])
    scheduled_secondary = 0
    accepted_cap_reached = bool(
        cfg.max_accepted_leads_per_run
        and run_counters["accepted"] >= cfg.max_accepted_leads_per_run
    )
    if not failed_leads and not accepted_cap_reached and _should_schedule_secondary_terms(
        target,
        raw_rows=raw_rows,
        duplicate_rows=duplicate_rows,
        accepted=accepted,
    ):
        secondary_specs = _remaining_provider_job_specs(target)
        scheduled_secondary = LEDGER.ensure_provider_jobs(target, secondary_specs)
    _finalize_target_if_ready(target["key"], failed_leads=bool(failed_leads))

    logger.info(
        "state=%s target=%s type=%s provider_jobs=%d raw_rows=%d unique_rows=%d accepted=%d "
        "filtered=%d duplicate=%d created=%d updated=%d secondary_terms_scheduled=%d",
        state, target["city"], target["targetType"], len(jobs), raw_rows, len(deduped_rows),
        accepted, len(rejected), duplicate_rows, created, updated, scheduled_secondary,
    )
    if rejected:
        logger.info("state=%s target=%s rejected_examples=%s", state, target["key"], rejected[:3])

    if failed_leads:
        _state["budget_stop_reason"] = (
            f"outbox retry pending ({len(failed_leads)} lead(s)); no new Outscraper spend"
        )
        await _report_progress(state, start_nonce)
        return True
    if cfg.max_accepted_leads_per_run and run_counters["accepted"] >= cfg.max_accepted_leads_per_run:
        _state["budget_stop_reason"] = f"accepted lead cap reached ({cfg.max_accepted_leads_per_run})"
        await _report_progress(state, start_nonce)
        return True
    return False


async def _process_ready_targets(state: str, start_nonce, accepted_keys: set,
                                 run_counters: dict) -> bool:
    budget_stopped = False
    for target_key in LEDGER.ready_target_keys(state, cfg.batch_target_count):
        budget_stopped = await _process_ready_target(state, target_key, start_nonce,
                                                     accepted_keys, run_counters)
        if budget_stopped:
            break
    return budget_stopped


async def _ensure_provider_jobs_for_pending_targets(state: str) -> int:
    added = 0
    for target in LEDGER.next_targets(state, cfg.batch_target_count):
        specs = _provider_job_specs(target, _initial_target_terms(target))
        added += LEDGER.ensure_provider_jobs(target, specs)
    return added


async def _submit_provider_jobs(state: str, start_nonce, run_counters: dict) -> bool:
    capacity = max(int(cfg.outscraper_job_concurrency or 1), 1) - LEDGER.submitted_provider_job_count(state)
    if capacity <= 0:
        return False
    pending = LEDGER.pending_provider_jobs(state, capacity)
    for job in pending:
        if cfg.max_queries_per_run and run_counters["queries"] + 1 > cfg.max_queries_per_run:
            _state["budget_stop_reason"] = f"query cap reached ({cfg.max_queries_per_run})"
            await _report_progress(state, start_nonce)
            return True
        if cfg.max_accepted_leads_per_run and run_counters["accepted"] >= cfg.max_accepted_leads_per_run:
            _state["budget_stop_reason"] = f"accepted lead cap reached ({cfg.max_accepted_leads_per_run})"
            await _report_progress(state, start_nonce)
            return True

        try:
            submitted = await submit_outscraper_search(
                [job["query"]],
                ENV.outscraper_api_key,
                limit=cfg.results_limit,
                coordinates=job.get("coordinates"),
                drop_duplicates=cfg.enable_drop_duplicates,
                total_limit=cfg.total_limit_per_target or None,
                region=cfg.outscraper_region,
                fields=cfg.outscraper_fields,
            )
            LEDGER.mark_provider_submitted(
                job["id"],
                submitted.get("requestId"),
                submitted.get("resultsLocation"),
            )
            run_counters["queries"] += 1
            if submitted.get("status") == "finished":
                rows = _rows_from_provider_data(submitted.get("data") or [])
                LEDGER.mark_provider_finished(job["id"], rows)
                logger.info("state=%s provider job finished immediately target=%s term=%s rows=%d",
                            state, job["target_key"], job["term"], len(rows))
            else:
                logger.info("state=%s provider job submitted target=%s term=%s request=%s",
                            state, job["target_key"], job["term"], submitted.get("requestId"))
        except Exception as e:  # noqa: BLE001
            logger.warning("provider submit failed target=%s term=%s: %s", job["target_key"], job["term"], e)
            target_key = LEDGER.mark_provider_error(job["id"], str(e))
            if target_key:
                _finalize_target_if_ready(target_key, last_error=str(e)[:300])
    return False


async def _poll_provider_jobs(state: str) -> int:
    activity = 0
    expired_targets = LEDGER.expire_stale_provider_jobs(state, cfg.outscraper_job_timeout_seconds)
    for target_key in expired_targets:
        logger.warning("provider job timed out target=%s", target_key)
        _finalize_target_if_ready(target_key, last_error="provider job timed out")
        activity += 1

    due = LEDGER.submitted_provider_jobs_due(
        state,
        cfg.outscraper_poll_interval_seconds,
        limit=max(int(cfg.outscraper_job_concurrency or 1), 1),
    )
    for job in due:
        try:
            result = await poll_outscraper_request(job["results_location"], ENV.outscraper_api_key)
            LEDGER.mark_provider_polled(job["id"])
            activity += 1
            if result.get("status") == "finished":
                rows = _rows_from_provider_data(result.get("data") or [])
                LEDGER.mark_provider_finished(job["id"], rows)
                logger.info("state=%s provider job finished target=%s term=%s rows=%d",
                            state, job["target_key"], job["term"], len(rows))
        except OutscraperTransient as e:
            LEDGER.record_provider_poll_error(job["id"], str(e))
            activity += 1
            logger.warning("provider poll transient target=%s term=%s: %s",
                           job["target_key"], job["term"], e)
        except Exception as e:  # noqa: BLE001
            logger.warning("provider poll failed target=%s term=%s: %s", job["target_key"], job["term"], e)
            target_key = LEDGER.mark_provider_error(job["id"], str(e))
            if target_key:
                _finalize_target_if_ready(target_key, last_error=str(e)[:300])
            activity += 1
    return activity


def _state_has_pending_targets(state: str) -> bool:
    return bool(LEDGER.next_targets(state, 1))


async def _process_target(state: str, target: dict, start_nonce, accepted_keys: set,
                          run_counters: dict) -> bool:
    """Process one city/grid target. Returns True when a budget cap stops the run."""
    terms = _target_terms(target)
    queries = [_target_query(term, target) for term in terms]
    if cfg.max_queries_per_run and run_counters["queries"] + len(queries) > cfg.max_queries_per_run:
        reason = f"query cap reached ({cfg.max_queries_per_run})"
        _state["budget_stop_reason"] = reason
        await _report_progress(state, start_nonce)
        return True
    if cfg.max_accepted_leads_per_run and run_counters["accepted"] >= cfg.max_accepted_leads_per_run:
        reason = f"accepted lead cap reached ({cfg.max_accepted_leads_per_run})"
        _state["budget_stop_reason"] = reason
        await _report_progress(state, start_nonce)
        return True

    try:
        results = await outscraper_search(
            queries,
            ENV.outscraper_api_key,
            limit=cfg.results_limit,
            coordinates=_target_coordinates(target),
            drop_duplicates=cfg.enable_drop_duplicates,
            total_limit=cfg.total_limit_per_target or None,
            region=cfg.outscraper_region,
            fields=cfg.outscraper_fields,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("target search failed (%s): %s", target["key"], e)
        LEDGER.mark_target(target["key"], "fetch_error", queries=len(queries), last_error=str(e)[:300])
        await _report_progress(state, start_nonce)
        return False

    run_counters["queries"] += len(queries)
    rows, errored = _rows_from_results(results, queries, terms, target)
    if errored:
        logger.warning("target result/query mismatch or task error (%s)", target["key"])
        LEDGER.mark_target(target["key"], "fetch_error", queries=len(queries),
                           last_error="result/query mismatch or task failed")
        await _report_progress(state, start_nonce)
        return False

    raw_rows = len(rows)
    deduped_rows = mapper.dedup_by_place_id(rows)
    lead_items: list[tuple[tuple, dict]] = []
    rejected: list[dict] = []
    duplicate_rows = max(raw_rows - len(deduped_rows), 0)
    location = {"city": target["city"], "state": target["state"]}

    for row in deduped_rows:
        key = mapper.dedup_key(row)
        if key in accepted_keys:
            duplicate_rows += 1
            continue
        lead, reason = mapper.to_lead_with_reason(row, location)
        if lead:
            lead_items.append((key, lead))
        else:
            rejected.append(relevance.rejection_sample(row, reason or "rejected"))
    leads = [lead for _key, lead in lead_items]

    if cfg.max_accepted_leads_per_run:
        remaining = max(cfg.max_accepted_leads_per_run - run_counters["accepted"], 0)
        if len(leads) > remaining:
            rejected.extend(
                {"name": lead["name"], "categories": lead.get("categories", []), "reason": "accepted_lead_cap"}
                for lead in leads[remaining:]
            )
            leads = leads[:remaining]
            lead_items = lead_items[:remaining]

    ingest_result = await _ingest_leads(leads) if leads else {"created": 0, "updated": 0, "skipped": 0}
    created = ingest_result.get("created", 0)
    updated = ingest_result.get("updated", 0)
    skipped = ingest_result.get("skipped", 0)
    saved_indexes, failed_indexes = _ingest_resolution(leads, ingest_result)
    for index in sorted(saved_indexes | failed_indexes):
        if 0 <= index < len(lead_items):
            accepted_keys.add(lead_items[index][0])
    failed_leads = [leads[index] for index in sorted(failed_indexes) if 0 <= index < len(leads)]
    if failed_leads:
        LEDGER.save_outbox_leads(
            target["key"],
            state,
            failed_leads,
            mapper.lead_dedup_key,
            "dashboard ingest failed",
        )
    accepted = len(leads)
    run_counters["accepted"] += accepted
    status = "empty" if raw_rows == 0 else ("outbox_pending" if failed_leads else "done")
    LEDGER.mark_target(
        target["key"],
        status,
        queries=len(queries),
        raw_rows=raw_rows,
        unique_rows=len(deduped_rows),
        duplicate_rows=duplicate_rows,
        filtered_rows=len(rejected),
        accepted_leads=accepted,
        created_leads=created,
        updated_leads=updated,
        skipped_leads=skipped,
        last_error="dashboard ingest failed; retrying from local outbox" if failed_leads else None,
    )
    logger.info(
        "state=%s target=%s type=%s queries=%d raw_rows=%d unique_rows=%d accepted=%d "
        "filtered=%d duplicate=%d created=%d updated=%d",
        state, target["city"], target["targetType"], len(queries), raw_rows, len(deduped_rows),
        accepted, len(rejected), duplicate_rows, created, updated,
    )
    if rejected:
        logger.info("state=%s target=%s rejected_examples=%s", state, target["key"], rejected[:3])
    if cfg.max_accepted_leads_per_run and run_counters["accepted"] >= cfg.max_accepted_leads_per_run:
        _state["budget_stop_reason"] = f"accepted lead cap reached ({cfg.max_accepted_leads_per_run})"
        await _report_progress(state, start_nonce)
        return True
    await _report_progress(state, start_nonce)
    return False


async def _retry_outbox_for_state(state: str, start_nonce) -> bool:
    """Retry locally preserved paid-for leads before spending on new fetches.

    Returns True when unresolved outbox rows remain and this run should halt
    without fetching new Outscraper targets.
    """
    remaining = LEDGER.outbox_remaining_for_state(state)
    if remaining == 0:
        return False

    logger.info("state=%s retrying %d preserved outbox lead(s) before new fetches", state, remaining)
    while True:
        rows = LEDGER.pending_outbox(state, cfg.ingest_chunk_size)
        if not rows:
            break
        leads = [row["payload"] for row in rows]
        ingest_result = await _ingest_leads(leads)
        saved_indexes, failed_indexes = _ingest_resolution(leads, ingest_result)
        saved_ids: list[int] = []
        failures: list[tuple[int, str]] = []
        target_deltas: dict[str, dict[str, int]] = {}

        results = ingest_result.get("results") if isinstance(ingest_result.get("results"), list) else []
        summary_statuses = _summary_statuses(len(leads), ingest_result) if not results else []
        result_by_index = {
            _result_index(result, len(leads)): result
            for result in results
            if isinstance(result, dict) and _result_index(result, len(leads)) is not None
        }

        for index, row in enumerate(rows):
            target_key = row["target_key"]
            target_deltas.setdefault(target_key, {"created": 0, "updated": 0, "skipped": 0})
            result = result_by_index.get(index, {})
            if index in saved_indexes:
                saved_ids.append(row["id"])
                status = result.get("status") or (summary_statuses[index] if index < len(summary_statuses) else None)
                if status == "created":
                    target_deltas[target_key]["created"] += 1
                elif status == "updated":
                    target_deltas[target_key]["updated"] += 1
                else:
                    target_deltas[target_key]["skipped"] += 1
            elif index in failed_indexes:
                reason = str(result.get("reason") or result.get("error") or "outbox retry failed")
                failures.append((row["id"], reason))
            else:
                failures.append((row["id"], "missing ingest result"))

        LEDGER.mark_outbox_saved(saved_ids)
        LEDGER.mark_outbox_failed(failures)
        for target_key, delta in target_deltas.items():
            LEDGER.add_target_ingest_counts(target_key, **delta)
            if LEDGER.outbox_remaining_by_target(target_key) == 0:
                if not _finalize_target_if_ready(target_key):
                    LEDGER.set_target_status(target_key, "done")
            else:
                LEDGER.set_target_status(target_key, "outbox_error", "dashboard ingest retry failed")
        await _report_progress(state, start_nonce)

    unresolved = LEDGER.outbox_remaining_for_state(state)
    if unresolved:
        _state["budget_stop_reason"] = f"outbox retry pending ({unresolved} lead(s)); no new Outscraper spend"
        await _report_progress(state, start_nonce)
        return True
    return False


async def run_sweep(ctrl: dict) -> None:
    """Sweep the control target end-to-end. Honors Stop between provider poll cycles."""
    target = ctrl["target"]
    start_nonce = ctrl.get("startNonce")
    stopped = False
    budget_stopped = False
    _state["budget_stop_reason"] = None
    accepted_keys: set = set()
    run_counters = {"queries": 0, "accepted": 0}

    for st in region.expand(target):
        if stopped or budget_stopped:
            break
        targets = region.discovery_targets_for_state(
            st,
            include_grid=cfg.enable_grid_expansion,
            spacing_miles=cfg.grid_spacing_miles,
            max_grid_points=cfg.max_grid_points_per_market,
            grid_min_population=cfg.grid_min_population,
            grid_min_zip_count=cfg.grid_min_zip_count,
        )
        if not targets:
            logger.warning("no discovery targets for state %s — skipping", st)
            continue
        LEDGER.seed_targets(st, targets)
        LEDGER.start_target_sweep_if_needed(st, start_nonce, cfg.skip_empty)
        if await _retry_outbox_for_state(st, start_nonce):
            budget_stopped = True
            break

        while True:
            ctrl = await _get_control()
            if not ctrl.get("active"):
                stopped = True
                break  # Stop -> leave WITHOUT post_done

            activity = 0
            _state["current_activity"] = "processing completed provider results"
            if await _process_ready_targets(st, start_nonce, accepted_keys, run_counters):
                budget_stopped = True
            if LEDGER.outbox_remaining_for_state(st):
                budget_stopped = True
                _state["budget_stop_reason"] = (
                    f"outbox retry pending ({LEDGER.outbox_remaining_for_state(st)} lead(s)); "
                    "no new Outscraper spend"
                )

            if not budget_stopped:
                _state["current_activity"] = "preparing provider jobs"
                activity += await _ensure_provider_jobs_for_pending_targets(st)
                _state["current_activity"] = "submitting provider jobs"
                if await _submit_provider_jobs(st, start_nonce, run_counters):
                    budget_stopped = True

            _state["current_activity"] = "polling provider jobs"
            activity += await _poll_provider_jobs(st)

            _state["current_activity"] = "processing completed provider results"
            if await _process_ready_targets(st, start_nonce, accepted_keys, run_counters):
                budget_stopped = True

            logger.info("state=%s progress=%s", st, LEDGER.target_progress(st))
            await _report_progress(st, start_nonce)
            if stopped:
                break
            provider_activity = LEDGER.provider_activity(st)
            has_paid_provider_work = (
                provider_activity.get("providerJobsInFlight", 0) > 0
                or provider_activity.get("providerJobsFinished", 0) > 0
            )
            has_open_work = (
                _state_has_pending_targets(st)
                or LEDGER.state_has_open_provider_work(st)
                or LEDGER.outbox_remaining_for_state(st) > 0
            )
            if not has_open_work:
                break
            if budget_stopped and not has_paid_provider_work:
                break
            if activity == 0:
                await asyncio.sleep(max(float(cfg.outscraper_loop_sleep_seconds or 1.0), 0.1))

    if not stopped and not ENV.dry_run_target:
        _state["current_activity"] = None
        await control.post_done(ENV.dashboard_url, ENV.callback_secret, start_nonce)
        logger.info("target '%s' finished — posted done%s", target,
                    f" ({_state['budget_stop_reason']})" if budget_stopped else "")


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
