"""
Local SQLite ledger — authoritative local sweep state.

Legacy ZIP rows remain for compatibility tests. The live city-mode scraper uses
target_status, provider_jobs, and lead_outbox:
  target status: pending|fetching|done|empty|fetch_error|outbox_pending|outbox_error|skipped_budget
  - fetch_error means no paid rows were preserved, so a fresh completed sweep may refetch.
  - outbox_pending/outbox_error means paid rows exist locally and must upload before refetch.
  - provider_jobs stores paid Outscraper request ids and completed raw rows before ingest.
  - a fresh Start requeues done/fetch_error/skipped_budget only when no pending/outbox target exists.

No shared database, no network — purely local. Safe to unit-test.
"""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager

DEFAULT_DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scraper_ledger.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS zip_status (
  zip         TEXT PRIMARY KEY,
  state       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending|done|empty|error
  raw_rows    INTEGER DEFAULT 0,                -- billed rows returned (pre-dedup), cost reconciliation
  new_leads   INTEGER DEFAULT 0,               -- ingest created+updated, feeds progress.leadsFound
  last_run_at TEXT,
  last_error  TEXT
);
CREATE INDEX IF NOT EXISTS ix_state_status ON zip_status(state, status);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS target_status (
  target_key     TEXT PRIMARY KEY,
  state          TEXT NOT NULL,
  city           TEXT NOT NULL,
  target_type    TEXT NOT NULL,                 -- city|grid
  lat            REAL,
  lng            REAL,
  population     INTEGER DEFAULT 0,
  density        REAL DEFAULT 0,
  zip_count      INTEGER DEFAULT 0,
	  status         TEXT NOT NULL DEFAULT 'pending', -- pending|fetching|done|empty|fetch_error|outbox_pending|outbox_error|skipped_budget
  queries        INTEGER DEFAULT 0,
  raw_rows       INTEGER DEFAULT 0,
  unique_rows    INTEGER DEFAULT 0,
  duplicate_rows INTEGER DEFAULT 0,
  filtered_rows  INTEGER DEFAULT 0,
  accepted_leads INTEGER DEFAULT 0,
  created_leads  INTEGER DEFAULT 0,
  updated_leads  INTEGER DEFAULT 0,
  skipped_leads  INTEGER DEFAULT 0,
  last_run_at    TEXT,
  last_error     TEXT
);
	CREATE INDEX IF NOT EXISTS ix_target_state_status ON target_status(state, status);

	CREATE TABLE IF NOT EXISTS provider_jobs (
	  id               INTEGER PRIMARY KEY AUTOINCREMENT,
	  job_key          TEXT NOT NULL UNIQUE,
	  target_key       TEXT NOT NULL,
	  state            TEXT NOT NULL,
	  city             TEXT NOT NULL,
	  target_type      TEXT NOT NULL,
	  term             TEXT NOT NULL,
	  query            TEXT NOT NULL,
	  coordinates      TEXT,
	  request_id       TEXT,
	  results_location TEXT,
	  status           TEXT NOT NULL DEFAULT 'pending_submit', -- pending_submit|submitted|finished|processed|fetch_error
	  rows_json        TEXT,
	  row_count        INTEGER DEFAULT 0,
	  attempts         INTEGER DEFAULT 0,
	  poll_count       INTEGER DEFAULT 0,
	  submitted_at     TEXT,
	  last_poll_at     TEXT,
	  completed_at     TEXT,
	  processed_at     TEXT,
	  last_error       TEXT,
	  created_at       TEXT DEFAULT (datetime('now')),
	  updated_at       TEXT DEFAULT (datetime('now'))
	);
	CREATE INDEX IF NOT EXISTS ix_provider_state_status ON provider_jobs(state, status);
	CREATE INDEX IF NOT EXISTS ix_provider_target_status ON provider_jobs(target_key, status);

	CREATE TABLE IF NOT EXISTS lead_outbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target_key  TEXT NOT NULL,
  state       TEXT NOT NULL,
  lead_key    TEXT NOT NULL,
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending|failed|saved
  attempts    INTEGER DEFAULT 0,
  last_error  TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(target_key, lead_key)
);
CREATE INDEX IF NOT EXISTS ix_outbox_state_status ON lead_outbox(state, status);
CREATE INDEX IF NOT EXISTS ix_outbox_target_status ON lead_outbox(target_key, status);
"""


class Ledger:
    def __init__(self, db_path: str | None = None):
        self.db_path = db_path or os.getenv("SCRAPER_LEDGER_DB", DEFAULT_DB)
        with self._conn() as c:
            c.executescript(_SCHEMA)

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # ── seeding ──
    def seed_from_csv(self, state: str, zip_rows: list[dict]) -> int:
        """Insert any not-yet-known ZIPs for `state` as pending. Idempotent.

        `zip_rows` is the region.zips_for_state(state) list. Existing rows are
        left untouched (INSERT OR IGNORE), so prior status survives.
        """
        added = 0
        with self._conn() as c:
            for row in zip_rows:
                cur = c.execute(
                    "INSERT OR IGNORE INTO zip_status (zip, state, status) VALUES (?, ?, 'pending')",
                    (row["zip"], state),
                )
                added += cur.rowcount
        return added

    # ── sweep control ──
    def _meta_get(self, c, key: str) -> str | None:
        r = c.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return r["value"] if r else None

    def _meta_set(self, c, key: str, value: str) -> None:
        c.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )

    def start_sweep_if_needed(self, state: str, nonce: str | None, skip_empty: bool) -> bool:
        """Apply §4D reset rules for `state` given the server's start nonce.

        Returns True if a new sweep was started (a reset happened), else False
        (a resume, or the nonce was already applied).
        """
        if not nonce:
            return False
        key = f"last_start_nonce:{state}"
        with self._conn() as c:
            seen = self._meta_get(c, key)
            if seen == nonce:
                return False  # this Start already applied to this state
            pending = c.execute(
                "SELECT COUNT(*) AS n FROM zip_status WHERE state = ? AND status = 'pending'",
                (state,),
            ).fetchone()["n"]
            self._meta_set(c, key, nonce)  # record the nonce either way
            if pending > 0:
                return False  # resume mid-sweep — do NOT reset
            # finished state + a fresh Start -> begin a new sweep
            c.execute(
                "UPDATE zip_status SET status = 'pending' WHERE state = ? AND status IN ('done', 'error')",
                (state,),
            )
            if not skip_empty:
                c.execute(
                    "UPDATE zip_status SET status = 'pending' WHERE state = ? AND status = 'empty'",
                    (state,),
                )
            return True

    def next_batch(self, state: str, size: int) -> list[dict]:
        """Up to `size` pending ZIP rows for `state` (ordered by zip for determinism)."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT zip, state FROM zip_status WHERE state = ? AND status = 'pending' "
                "ORDER BY zip LIMIT ?",
                (state, size),
            ).fetchall()
        return [{"zip": r["zip"], "state": r["state"]} for r in rows]

    def mark(self, zip_code: str, status: str, raw_rows: int = 0, new_leads: int = 0,
             last_error: str | None = None) -> None:
        """Record a terminal status for one ZIP. First arg is the bare ZIP string."""
        with self._conn() as c:
            c.execute(
                "UPDATE zip_status SET status = ?, raw_rows = ?, new_leads = ?, "
                "last_run_at = datetime('now'), last_error = ? WHERE zip = ?",
                (status, raw_rows, new_leads, last_error, zip_code),
            )

    # ── progress / reporting ──
    def progress(self, state: str) -> dict:
        with self._conn() as c:
            rows = c.execute(
                "SELECT status, COUNT(*) AS n, COALESCE(SUM(new_leads),0) AS leads "
                "FROM zip_status WHERE state = ? GROUP BY status",
                (state,),
            ).fetchall()
        counts = {r["status"]: r["n"] for r in rows}
        leads = sum(r["leads"] for r in rows)
        total = sum(counts.values())
        done = counts.get("done", 0)
        empty = counts.get("empty", 0)
        error = counts.get("error", 0)
        return {
            "state": state,
            "zipsTotal": total,
            "zipsDone": done,
            "zipsEmpty": empty,
            "zipsError": error,
            "zipsPending": counts.get("pending", 0),
            "leadsFound": leads,
        }

    # ── city/market target ledger ──
    def seed_targets(self, state: str, targets: list[dict]) -> int:
        """Insert any not-yet-known city/grid targets for `state` as pending."""
        added = 0
        with self._conn() as c:
            for target in targets:
                cur = c.execute(
                    "INSERT OR IGNORE INTO target_status "
                    "(target_key, state, city, target_type, lat, lng, population, density, zip_count, status) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
                    (
                        target["key"],
                        state,
                        target["city"],
                        target["targetType"],
                        target.get("lat"),
                        target.get("lng"),
                        int(target.get("population") or 0),
                        float(target.get("density") or 0.0),
                        int(target.get("zipCount") or 0),
                    ),
                )
                added += cur.rowcount
        return added

    def start_target_sweep_if_needed(self, state: str, nonce: str | None,
                                     skip_empty: bool) -> bool:
        """Apply reset rules for city/grid targets for a new dashboard Start."""
        if not nonce:
            return False
        key = f"last_target_start_nonce:{state}"
        with self._conn() as c:
            seen = self._meta_get(c, key)
            if seen == nonce:
                return False
            active_targets = c.execute(
                "SELECT COUNT(*) AS n FROM target_status WHERE state = ? "
                "AND status IN ('pending', 'fetching')",
                (state,),
            ).fetchone()["n"]
            outbox_owned = c.execute(
                "SELECT COUNT(*) AS n FROM target_status "
                "WHERE state = ? AND status IN ('outbox_pending', 'outbox_error')",
                (state,),
            ).fetchone()["n"]
            provider_open = c.execute(
                "SELECT COUNT(*) AS n FROM provider_jobs WHERE state = ? "
                "AND status IN ('pending_submit', 'submitted', 'finished')",
                (state,),
            ).fetchone()["n"]
            self._meta_set(c, key, nonce)
            if active_targets > 0 or outbox_owned > 0 or provider_open > 0:
                return False

            done_targets = [
                r["target_key"]
                for r in c.execute(
                    "SELECT target_key FROM target_status WHERE state = ? "
                    "AND status IN ('done', 'skipped_budget')",
                    (state,),
                ).fetchall()
            ]
            empty_targets: list[str] = []
            if not skip_empty:
                empty_targets = [
                    r["target_key"]
                    for r in c.execute(
                        "SELECT target_key FROM target_status WHERE state = ? AND status = 'empty'",
                        (state,),
                    ).fetchall()
                ]
            fetch_error_targets = [
                r["target_key"]
                for r in c.execute(
                    "SELECT target_key FROM target_status WHERE state = ? AND status = 'fetch_error'",
                    (state,),
                ).fetchall()
            ]

            reset_all_targets = done_targets + empty_targets
            if reset_all_targets:
                c.executemany(
                    "UPDATE provider_jobs SET status = 'pending_submit', request_id = NULL, "
                    "results_location = NULL, rows_json = NULL, row_count = 0, attempts = 0, "
                    "poll_count = 0, submitted_at = NULL, last_poll_at = NULL, completed_at = NULL, "
                    "processed_at = NULL, last_error = NULL, updated_at = datetime('now') "
                    "WHERE target_key = ?",
                    [(target_key,) for target_key in reset_all_targets],
                )
            if fetch_error_targets:
                c.executemany(
                    "UPDATE provider_jobs SET status = 'pending_submit', request_id = NULL, "
                    "results_location = NULL, rows_json = NULL, row_count = 0, attempts = 0, "
                    "poll_count = 0, submitted_at = NULL, last_poll_at = NULL, completed_at = NULL, "
                    "processed_at = NULL, last_error = NULL, updated_at = datetime('now') "
                    "WHERE target_key = ? AND status = 'fetch_error'",
                    [(target_key,) for target_key in fetch_error_targets],
                )

            c.execute(
                "UPDATE target_status SET status = 'pending', queries = 0, raw_rows = 0, "
                "unique_rows = 0, duplicate_rows = 0, filtered_rows = 0, accepted_leads = 0, "
                "created_leads = 0, updated_leads = 0, skipped_leads = 0, last_error = NULL "
                "WHERE state = ? AND status IN ('done', 'skipped_budget')",
                (state,),
            )
            c.execute(
                "UPDATE target_status SET status = 'pending', last_error = NULL "
                "WHERE state = ? AND status = 'fetch_error'",
                (state,),
            )
            if not skip_empty:
                c.execute(
                    "UPDATE target_status SET status = 'pending', queries = 0, raw_rows = 0, "
                    "unique_rows = 0, duplicate_rows = 0, filtered_rows = 0, accepted_leads = 0, "
                    "created_leads = 0, updated_leads = 0, skipped_leads = 0, last_error = NULL "
                    "WHERE state = ? AND status = 'empty'",
                    (state,),
                )
            return True

    def next_targets(self, state: str, size: int) -> list[dict]:
        """Up to `size` pending city/grid targets for `state`."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT target_key, state, city, target_type, lat, lng, population, density, zip_count "
                "FROM target_status WHERE state = ? AND status = 'pending' "
                "ORDER BY population DESC, city ASC, target_type ASC, target_key ASC LIMIT ?",
                (state, size),
            ).fetchall()
        return [
            {
                "key": r["target_key"],
                "state": r["state"],
                "city": r["city"],
                "targetType": r["target_type"],
                "lat": r["lat"],
                "lng": r["lng"],
                "population": r["population"],
                "density": r["density"],
                "zipCount": r["zip_count"],
            }
            for r in rows
        ]

    def target_by_key(self, target_key: str) -> dict | None:
        with self._conn() as c:
            r = c.execute(
                "SELECT target_key, state, city, target_type, lat, lng, population, density, zip_count "
                "FROM target_status WHERE target_key = ?",
                (target_key,),
            ).fetchone()
        if not r:
            return None
        return {
            "key": r["target_key"],
            "state": r["state"],
            "city": r["city"],
            "targetType": r["target_type"],
            "lat": r["lat"],
            "lng": r["lng"],
            "population": r["population"],
            "density": r["density"],
            "zipCount": r["zip_count"],
        }

    # ── provider jobs ──
    def ensure_provider_jobs(self, target: dict, jobs: list[dict]) -> int:
        """Create local Outscraper jobs for a target without spending provider credits."""
        if not jobs:
            return 0
        added = 0
        with self._conn() as c:
            for job in jobs:
                cur = c.execute(
                    "INSERT OR IGNORE INTO provider_jobs "
                    "(job_key, target_key, state, city, target_type, term, query, coordinates, status) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_submit')",
                    (
                        job["job_key"],
                        target["key"],
                        target["state"],
                        target["city"],
                        target["targetType"],
                        job["term"],
                        job["query"],
                        job.get("coordinates"),
                    ),
                )
                added += cur.rowcount
            c.execute(
                "UPDATE target_status SET status = 'fetching', last_run_at = datetime('now'), "
                "last_error = NULL WHERE target_key = ? AND status = 'pending'",
                (target["key"],),
            )
        return added

    def pending_provider_jobs(self, state: str, limit: int) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT id, job_key, target_key, state, city, target_type, term, query, coordinates "
                "FROM provider_jobs WHERE state = ? AND status = 'pending_submit' "
                "ORDER BY id ASC LIMIT ?",
                (state, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def submitted_provider_jobs_due(self, state: str, poll_interval_seconds: int,
                                    limit: int = 50) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT id, job_key, target_key, state, city, target_type, term, query, coordinates, "
                "request_id, results_location, submitted_at, last_poll_at, poll_count "
                "FROM provider_jobs WHERE state = ? AND status = 'submitted' "
                "AND (last_poll_at IS NULL OR datetime(last_poll_at, '+' || ? || ' seconds') <= datetime('now')) "
                "ORDER BY COALESCE(last_poll_at, submitted_at, created_at) ASC LIMIT ?",
                (state, int(poll_interval_seconds), limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def submitted_provider_job_count(self, state: str) -> int:
        with self._conn() as c:
            return c.execute(
                "SELECT COUNT(*) AS n FROM provider_jobs WHERE state = ? AND status = 'submitted'",
                (state,),
            ).fetchone()["n"]

    def mark_provider_submitted(self, job_id: int, request_id: str | None,
                                results_location: str | None) -> None:
        with self._conn() as c:
            row = c.execute(
                "SELECT target_key, status FROM provider_jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
            if not row:
                return
            was_pending = row["status"] == "pending_submit"
            c.execute(
                "UPDATE provider_jobs SET status = 'submitted', request_id = ?, results_location = ?, "
                "attempts = attempts + 1, submitted_at = COALESCE(submitted_at, datetime('now')), "
                "updated_at = datetime('now'), last_error = NULL WHERE id = ?",
                (request_id, results_location, job_id),
            )
            if was_pending:
                c.execute(
                    "UPDATE target_status SET queries = COALESCE(queries,0) + 1, "
                    "status = CASE WHEN status = 'pending' THEN 'fetching' ELSE status END, "
                    "last_run_at = datetime('now') WHERE target_key = ?",
                    (row["target_key"],),
                )

    def mark_provider_finished(self, job_id: int, rows: list[dict]) -> None:
        payload = json.dumps(rows or [], sort_keys=True, default=str)
        with self._conn() as c:
            c.execute(
                "UPDATE provider_jobs SET status = 'finished', rows_json = ?, row_count = ?, "
                "completed_at = datetime('now'), updated_at = datetime('now'), last_error = NULL "
                "WHERE id = ?",
                (payload, len(rows or []), job_id),
            )

    def mark_provider_polled(self, job_id: int) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE provider_jobs SET poll_count = poll_count + 1, last_poll_at = datetime('now'), "
                "updated_at = datetime('now') WHERE id = ?",
                (job_id,),
            )

    def record_provider_poll_error(self, job_id: int, error: str) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE provider_jobs SET poll_count = poll_count + 1, last_poll_at = datetime('now'), "
                "updated_at = datetime('now'), last_error = ? WHERE id = ? AND status = 'submitted'",
                (str(error)[:300], job_id),
            )

    def mark_provider_error(self, job_id: int, error: str) -> str | None:
        with self._conn() as c:
            row = c.execute("SELECT target_key FROM provider_jobs WHERE id = ?", (job_id,)).fetchone()
            if not row:
                return None
            c.execute(
                "UPDATE provider_jobs SET status = 'fetch_error', last_error = ?, "
                "updated_at = datetime('now') WHERE id = ?",
                (str(error)[:300], job_id),
            )
            return row["target_key"]

    def expire_stale_provider_jobs(self, state: str, timeout_seconds: int) -> list[str]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT id, target_key FROM provider_jobs WHERE state = ? AND status = 'submitted' "
                "AND submitted_at IS NOT NULL "
                "AND datetime(submitted_at, '+' || ? || ' seconds') <= datetime('now')",
                (state, int(timeout_seconds)),
            ).fetchall()
            if rows:
                c.executemany(
                    "UPDATE provider_jobs SET status = 'fetch_error', "
                    "last_error = 'provider job timed out', updated_at = datetime('now') WHERE id = ?",
                    [(r["id"],) for r in rows],
                )
        return [r["target_key"] for r in rows]

    def ready_target_keys(self, state: str, limit: int = 20) -> list[str]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT target_key FROM provider_jobs WHERE state = ? GROUP BY target_key "
                "HAVING SUM(CASE WHEN status IN ('pending_submit', 'submitted') THEN 1 ELSE 0 END) = 0 "
                "AND SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) > 0 "
                "ORDER BY MIN(id) ASC LIMIT ?",
                (state, limit),
            ).fetchall()
        return [r["target_key"] for r in rows]

    def provider_jobs_for_target(self, target_key: str, statuses: tuple[str, ...] | None = None) -> list[dict]:
        params: list = [target_key]
        where = "target_key = ?"
        if statuses:
            where += " AND status IN ({})".format(",".join("?" for _ in statuses))
            params.extend(statuses)
        with self._conn() as c:
            rows = c.execute(
                "SELECT id, job_key, target_key, state, city, target_type, term, query, coordinates, "
                "request_id, results_location, status, rows_json, row_count, attempts, poll_count, "
                "submitted_at, last_poll_at, completed_at, processed_at, last_error "
                f"FROM provider_jobs WHERE {where} ORDER BY id ASC",
                params,
            ).fetchall()
        out = []
        for row in rows:
            item = dict(row)
            if item.get("rows_json"):
                try:
                    item["rows"] = json.loads(item["rows_json"])
                except json.JSONDecodeError:
                    item["rows"] = []
            else:
                item["rows"] = []
            out.append(item)
        return out

    def mark_provider_processed(self, ids: list[int]) -> None:
        if not ids:
            return
        with self._conn() as c:
            c.executemany(
                "UPDATE provider_jobs SET status = 'processed', processed_at = datetime('now'), "
                "updated_at = datetime('now') WHERE id = ?",
                [(i,) for i in ids],
            )

    def add_target_discovery_counts(self, target_key: str, *, raw_rows: int = 0,
                                    unique_rows: int = 0, duplicate_rows: int = 0,
                                    filtered_rows: int = 0, accepted_leads: int = 0,
                                    created_leads: int = 0, updated_leads: int = 0,
                                    skipped_leads: int = 0) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE target_status SET raw_rows = COALESCE(raw_rows,0) + ?, "
                "unique_rows = COALESCE(unique_rows,0) + ?, "
                "duplicate_rows = COALESCE(duplicate_rows,0) + ?, "
                "filtered_rows = COALESCE(filtered_rows,0) + ?, "
                "accepted_leads = COALESCE(accepted_leads,0) + ?, "
                "created_leads = COALESCE(created_leads,0) + ?, "
                "updated_leads = COALESCE(updated_leads,0) + ?, "
                "skipped_leads = COALESCE(skipped_leads,0) + ?, "
                "last_run_at = datetime('now') WHERE target_key = ?",
                (
                    raw_rows, unique_rows, duplicate_rows, filtered_rows, accepted_leads,
                    created_leads, updated_leads, skipped_leads, target_key,
                ),
            )

    def target_stats(self, target_key: str) -> dict | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT target_key, status, queries, raw_rows, unique_rows, duplicate_rows, "
                "filtered_rows, accepted_leads, created_leads, updated_leads, skipped_leads "
                "FROM target_status WHERE target_key = ?",
                (target_key,),
            ).fetchone()
        return dict(row) if row else None

    def provider_summary_for_target(self, target_key: str) -> dict:
        with self._conn() as c:
            rows = c.execute(
                "SELECT status, COUNT(*) AS n FROM provider_jobs WHERE target_key = ? GROUP BY status",
                (target_key,),
            ).fetchall()
        counts = {r["status"]: r["n"] for r in rows}
        return {
            "pending_submit": counts.get("pending_submit", 0),
            "submitted": counts.get("submitted", 0),
            "finished": counts.get("finished", 0),
            "processed": counts.get("processed", 0),
            "fetch_error": counts.get("fetch_error", 0),
            "total": sum(counts.values()),
        }

    def provider_activity(self, state: str) -> dict:
        with self._conn() as c:
            rows = c.execute(
                "SELECT status, COUNT(*) AS n FROM provider_jobs WHERE state = ? GROUP BY status",
                (state,),
            ).fetchall()
        counts = {r["status"]: r["n"] for r in rows}
        return {
            "providerJobsPendingSubmit": counts.get("pending_submit", 0),
            "providerJobsSubmitted": counts.get("submitted", 0),
            "providerJobsInFlight": counts.get("submitted", 0),
            "providerJobsFinished": counts.get("finished", 0),
            "providerJobsProcessed": counts.get("processed", 0),
            "providerJobsFetchError": counts.get("fetch_error", 0),
        }

    def state_has_open_provider_work(self, state: str) -> bool:
        with self._conn() as c:
            return c.execute(
                "SELECT COUNT(*) AS n FROM provider_jobs WHERE state = ? "
                "AND status IN ('pending_submit', 'submitted', 'finished')",
                (state,),
            ).fetchone()["n"] > 0

    def mark_target(self, target_key: str, status: str, *, queries: int = 0,
                    raw_rows: int = 0, unique_rows: int = 0, duplicate_rows: int = 0,
                    filtered_rows: int = 0, accepted_leads: int = 0,
                    created_leads: int = 0, updated_leads: int = 0,
                    skipped_leads: int = 0, last_error: str | None = None) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE target_status SET status = ?, queries = ?, raw_rows = ?, unique_rows = ?, "
                "duplicate_rows = ?, filtered_rows = ?, accepted_leads = ?, created_leads = ?, "
                "updated_leads = ?, skipped_leads = ?, last_run_at = datetime('now'), last_error = ? "
                "WHERE target_key = ?",
                (
                    status, queries, raw_rows, unique_rows, duplicate_rows, filtered_rows,
                    accepted_leads, created_leads, updated_leads, skipped_leads, last_error,
                    target_key,
                ),
            )

    def set_target_status(self, target_key: str, status: str, last_error: str | None = None) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE target_status SET status = ?, last_run_at = datetime('now'), last_error = ? "
                "WHERE target_key = ?",
                (status, last_error, target_key),
            )

    def add_target_ingest_counts(self, target_key: str, *, created: int = 0,
                                 updated: int = 0, skipped: int = 0) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE target_status SET created_leads = COALESCE(created_leads,0) + ?, "
                "updated_leads = COALESCE(updated_leads,0) + ?, "
                "skipped_leads = COALESCE(skipped_leads,0) + ?, "
                "last_run_at = datetime('now') WHERE target_key = ?",
                (created, updated, skipped, target_key),
            )

    def save_outbox_leads(self, target_key: str, state: str, leads: list[dict],
                          lead_key_fn, reason: str) -> int:
        if not leads:
            return 0
        added = 0
        with self._conn() as c:
            for lead in leads:
                lead_key = str(lead_key_fn(lead))
                payload = json.dumps(lead, sort_keys=True)
                cur = c.execute(
                    "INSERT INTO lead_outbox (target_key, state, lead_key, payload, status, last_error) "
                    "VALUES (?, ?, ?, ?, 'pending', ?) "
                    "ON CONFLICT(target_key, lead_key) DO UPDATE SET "
                    "payload = excluded.payload, status = 'pending', last_error = excluded.last_error, "
                    "updated_at = datetime('now')",
                    (target_key, state, lead_key, payload, reason),
                )
                added += cur.rowcount
        return added

    def pending_outbox(self, state: str, limit: int = 50) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT id, target_key, state, lead_key, payload, attempts, last_error "
                "FROM lead_outbox WHERE state = ? AND status IN ('pending', 'failed') "
                "ORDER BY id ASC LIMIT ?",
                (state, limit),
            ).fetchall()
        out = []
        for row in rows:
            try:
                payload = json.loads(row["payload"])
            except json.JSONDecodeError:
                payload = {}
            out.append({
                "id": row["id"],
                "target_key": row["target_key"],
                "state": row["state"],
                "lead_key": row["lead_key"],
                "payload": payload,
                "attempts": row["attempts"],
                "last_error": row["last_error"],
            })
        return out

    def mark_outbox_saved(self, ids: list[int]) -> None:
        if not ids:
            return
        with self._conn() as c:
            c.executemany(
                "UPDATE lead_outbox SET status = 'saved', attempts = attempts + 1, "
                "updated_at = datetime('now'), last_error = NULL WHERE id = ?",
                [(i,) for i in ids],
            )

    def mark_outbox_failed(self, failures: list[tuple[int, str]]) -> None:
        if not failures:
            return
        with self._conn() as c:
            c.executemany(
                "UPDATE lead_outbox SET status = 'failed', attempts = attempts + 1, "
                "updated_at = datetime('now'), last_error = ? WHERE id = ?",
                [(err[:300], i) for i, err in failures],
            )

    def outbox_remaining_by_target(self, target_key: str) -> int:
        with self._conn() as c:
            return c.execute(
                "SELECT COUNT(*) AS n FROM lead_outbox "
                "WHERE target_key = ? AND status IN ('pending', 'failed')",
                (target_key,),
            ).fetchone()["n"]

    def outbox_remaining_for_state(self, state: str) -> int:
        with self._conn() as c:
            return c.execute(
                "SELECT COUNT(*) AS n FROM lead_outbox "
                "WHERE state = ? AND status IN ('pending', 'failed')",
                (state,),
            ).fetchone()["n"]

    def target_progress(self, state: str) -> dict:
        with self._conn() as c:
            rows = c.execute(
                "SELECT status, COUNT(*) AS n, COALESCE(SUM(queries),0) AS queries, "
                "COALESCE(SUM(raw_rows),0) AS raw_rows, COALESCE(SUM(unique_rows),0) AS unique_rows, "
                "COALESCE(SUM(duplicate_rows),0) AS duplicate_rows, "
                "COALESCE(SUM(filtered_rows),0) AS filtered_rows, "
                "COALESCE(SUM(accepted_leads),0) AS accepted_leads, "
                "COALESCE(SUM(created_leads),0) AS created_leads, "
                "COALESCE(SUM(updated_leads),0) AS updated_leads, "
                "COALESCE(SUM(skipped_leads),0) AS skipped_leads "
                "FROM target_status WHERE state = ? GROUP BY status",
                (state,),
            ).fetchall()
        counts = {r["status"]: r["n"] for r in rows}
        total = sum(counts.values())
        done = counts.get("done", 0)
        empty = counts.get("empty", 0)
        fetch_error = counts.get("fetch_error", 0)
        outbox_pending = counts.get("outbox_pending", 0)
        outbox_error = counts.get("outbox_error", 0)
        error = fetch_error + outbox_error
        skipped_budget = counts.get("skipped_budget", 0)
        pending = counts.get("pending", 0)
        fetching = counts.get("fetching", 0)

        sums = {
            "queriesSubmitted": sum(r["queries"] for r in rows),
            "rawRowsReturned": sum(r["raw_rows"] for r in rows),
            "uniqueRowsSeen": sum(r["unique_rows"] for r in rows),
            "duplicatesSkipped": sum(r["duplicate_rows"] for r in rows),
            "filteredRows": sum(r["filtered_rows"] for r in rows),
            "acceptedLeads": sum(r["accepted_leads"] for r in rows),
            "createdLeads": sum(r["created_leads"] for r in rows),
            "updatedLeads": sum(r["updated_leads"] for r in rows),
            "skippedLeads": sum(r["skipped_leads"] for r in rows),
        }
        leads = sums["createdLeads"] + sums["updatedLeads"]
        raw_rows = sums["rawRowsReturned"]
        accepted_leads = sums["acceptedLeads"]
        created_leads = sums["createdLeads"]
        duplicate_rows = sums["duplicatesSkipped"]
        filtered_rows = sums["filteredRows"]
        estimated_wasted_rows = max(raw_rows - accepted_leads, 0)

        def _rate(numerator: int, denominator: int) -> float:
            return round(numerator / denominator, 4) if denominator else 0.0

        provider = self.provider_activity(state)
        return {
            "state": state,
            "discoveryMode": "city",
            "targetsTotal": total,
            "targetsDone": done,
            "targetsEmpty": empty,
            "targetsError": error,
            "targetsFetchError": fetch_error,
            "targetsFetching": fetching,
            "targetsOutboxPending": outbox_pending,
            "targetsOutboxError": outbox_error,
            "targetsSkippedBudget": skipped_budget,
            "targetsPending": pending,
            "marketsTotal": total,
            "marketsDone": done,
            "marketsEmpty": empty,
            "marketsError": error,
            "marketsFetching": fetching,
            "marketsOutboxPending": outbox_pending,
            "marketsPending": pending,
            **provider,
            **sums,
            "leadsFound": leads,
            "estimatedWastedRows": estimated_wasted_rows,
            "duplicateRate": _rate(duplicate_rows, raw_rows),
            "filteredRate": _rate(filtered_rows, raw_rows),
            "acceptedRate": _rate(accepted_leads, raw_rows),
            "createdRate": _rate(created_leads, raw_rows),
            "rawToAcceptedRatio": round(raw_rows / accepted_leads, 2) if accepted_leads else raw_rows,
            "rawToCreatedRatio": round(raw_rows / created_leads, 2) if created_leads else raw_rows,
            # Backward-compatible aliases for older dashboard builds.
            "zipsTotal": total,
            "zipsDone": done,
            "zipsEmpty": empty,
            "zipsError": error,
            "zipsPending": pending,
        }
