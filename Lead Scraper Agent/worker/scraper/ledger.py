"""
Local SQLite ledger — the authoritative per-ZIP record of what has been swept.

Schema + sweep semantics: technical plan §4D.
  status: pending | done | empty | error
  - within a sweep, the queue is `status='pending'` only (done/empty/error excluded)
  - a fresh Start (new per-state nonce) on a finished state re-queues done+error -> pending;
    empty stays excluded iff skip_empty is true.
  - the start nonce is tracked PER STATE in `meta` ('last_start_nonce:<ST>') so one Start
    press triggers the reset check in every state of an ALL run.

No database, no network — purely local. Safe to unit-test.
"""

from __future__ import annotations

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
