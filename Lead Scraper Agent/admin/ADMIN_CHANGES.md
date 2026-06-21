# Admin dashboard — exact Lead Scraper changes (apply to the canonical repo)

These are the **only** changes the Lead Scraper needs inside the existing admin dashboard
(`JAMALS ADMIN DASH`). They are presented as anchor-based snippets (find X → add Y) rather
than a diff **on purpose**: the working tree these were authored in has unrelated uncommitted
work in some of the same files (a facebook-scraper removal, schema edits), so a raw `git diff`
would be misleading. Apply each change below onto your clean canonical copy.

One brand-new file is provided whole: `NEW_FILE__api_agents_lead-scraper__route.ts` →
place it at `src/app/api/agents/lead-scraper/route.ts`.

All changes were type-checked together: `tsc --noEmit` → exit 0, 0 errors.

Labels (A1–A7) match the technical plan (`docs/LEAD_SCRAPER_TECHNICAL_PLAN.md`).

---

## A2 — NEW FILE: `src/app/api/agents/lead-scraper/route.ts`
Copy `NEW_FILE__api_agents_lead-scraper__route.ts` to that path verbatim. It is the control
plane the worker and the dashboard card talk to (GET status; POST start/stop/progress/done),
fail-closed auth, compare-and-set Start, null-safe reads, stale-nonce discard on progress AND
done. No other file provides this.

---

## A1 — `src/app/api/agents/seed/route.ts`
**Add a 7th agent** to the `agents` array. Insert this object as the LAST element of the array
(after the `research_writer` entry, immediately before the closing `];`):

```ts
            {
                slug: "lead_scraper",
                name: "Lead Scraper",
                description: "Discovers junk removal & dumpster rental businesses on Google Maps (Outscraper), by ZIP. Manual start only — controlled via the Lead Scraper card (Start/Stop), run by an external worker; ingests thin leads for enrichment.",
                schedule: null, // permanent — manual-only operation, never give this agent a cron
                config: {
                    search_terms: ["junk removal", "dumpster rental"],
                    results_per_query_limit: null, // "no cap" intent; worker sends explicit limit=400
                    fetch_reviews: false, // thin discovery — enrichment does the deep pull
                    batch_zip_count: 12, // ZIPs per worker batch (×2 terms = 24 queries ≤ 25-cap)
                    skip_empty_zips_on_rerun: true,
                },
            },
```
(The existing `upsert` loop handles it — re-running seed is safe and converts any pre-existing
`lead_scraper` row.)

---

## A3 — `src/middleware.ts`
**Add `api/agents/lead-scraper` to the matcher's negative-lookahead exclusion list.** Find the
existing token `api/agents/leads` and add `api/agents/lead-scraper` right after it:

Before:
```
...api/agents/callback|api/agents/leads|api/agents/pending-runs|api/agents/claim-run|...
```
After:
```
...api/agents/callback|api/agents/leads|api/agents/lead-scraper|api/agents/pending-runs|api/agents/claim-run|...
```
Required so the worker's secret-authenticated calls (no session) reach the route instead of
being 401'd by middleware.

---

## A5 — `src/app/api/agents/[id]/route.ts`
**Guard the generic trigger route** so a stray "Run Now" can never strand an unclaimed run.
In the `POST` handler, immediately AFTER the agent fetch + not-found check, and BEFORE the
`if (!agent.enabled)` check, insert:

```ts
        // lead_scraper is controlled via the Lead Scraper card (Start/Stop), not the generic
        // trigger. Guard BEFORE the enabled check and run-row create so a stray Run Now can
        // never strand an unclaimed run (nothing polls pending-runs for this slug).
        if (agent.slug === "lead_scraper") {
            return NextResponse.json(
                { error: "lead_scraper is controlled via the Lead Scraper card (Start/Stop), not Run Now" },
                { status: 400 },
            );
        }
```
Context (the lines it goes between):
```ts
        const agent = await prisma.syjAgent.findUnique({ where: { id } });
        if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
        // >>> INSERT THE lead_scraper GUARD HERE <<<
        if (!agent.enabled) return NextResponse.json({ error: "Agent is disabled" }, { status: 400 });
```

---

## A6 + A7 — `src/app/api/agents/leads/route.ts` (four small additions)

**A6.1 — add the create-defaults constant.** Insert immediately BEFORE the
`// POST /api/agents/leads ...` comment / `export async function POST` line:

```ts
// ScrapedLead scalar-list columns that have NO database default. A create() that omits
// them stores SQL NULL (inconsistent with []). Spread these on CREATE ONLY so every caller
// (scraper, manual add, any future worker) yields []-initialized arrays. Never applied to
// updateData — an empty array would pass the non-empty check and could clobber enrichment.
const LIST_FIELD_DEFAULTS: Record<string, string[]> = {
    categories: [], techDetected: [], notesFlags: [], serviceTypes: [], serviceAreaCities: [],
    reviewComplaints: [], reviewPraise: [], mentionedStaffNames: [], painTags: [], praiseTags: [],
    emailsDiscovered: [], reasons: [], painPoints: [],
};
```

**A6.2 — spread it on create only.** In the POST handler, change:
```ts
                const createData = { ...lead, agentRunId: validRunId };
```
to:
```ts
                const createData = { ...LIST_FIELD_DEFAULTS, ...lead, agentRunId: validRunId };
```
(Leave `updateData` exactly as-is — do NOT add the defaults there.)

**A7.1 — read the `state` query param.** In the GET handler, after
`const market = searchParams.get("market");` add:
```ts
    const state = searchParams.get("state"); // 2-letter US state code (e.g. "MA") — for pilot/region observability
```

**A7.2 — apply it to the where clause.** After `if (market) where.market = market;` add:
```ts
        if (state) where.state = state;
```

**A7.3 — return distinct states.** After the existing markets groupBy block
(`const markets = marketGroups.map(...)...`) add:
```ts
        // Get distinct states for the region filter dropdown (A7 — pilot/region observability)
        const stateGroups = await prisma.scrapedLead.groupBy({
            by: ["state"],
            _count: true,
        });
        const states = stateGroups.map(s => s.state).filter(Boolean).sort();
```

**A7.4 — include `states` in the response.** Change the GET's final response:
```ts
        return NextResponse.json({ leads, total, page, limit, funnel, markets, companyTypes });
```
to:
```ts
        return NextResponse.json({ leads, total, page, limit, funnel, markets, states, companyTypes });
```

---

## A7 (UI) — `src/app/(dashboard)/leads/scraped/page.tsx` (state filter dropdown)

**A7.5 — add the state filter state vars.** After the existing
`const [availableMarkets, setAvailableMarkets] = useState<string[]>([]);` add:
```tsx
    const [stateFilter, setStateFilter] = useState("all");
    const [availableStates, setAvailableStates] = useState<string[]>([]);
```

**A7.6 — set the `state` param on the lead fetches.** There are TWO places that build the query
params (the main list fetch and the "select-all" / export fetch). In BOTH, after the line
`if (marketFilter !== "all") params.set("market", marketFilter);` add:
```tsx
            if (stateFilter !== "all") params.set("state", stateFilter);
```

**A7.7 — populate the dropdown from the response.** After
`if (data.markets) setAvailableMarkets(data.markets);` add:
```tsx
                if (data.states) setAvailableStates(data.states);
```

**A7.8 — add `stateFilter` to the fetch effect's dependency array.** Find the big `useEffect`
deps array that starts `[gradeFilter, archivedFilter, outreachFilter, marketFilter,
companyTypeFilter, ...]` and insert `stateFilter` right after `marketFilter`:
```tsx
    }, [gradeFilter, archivedFilter, outreachFilter, marketFilter, stateFilter, companyTypeFilter, enrichedFilter, competitorFilter, ...
```

**A7.9 — render the dropdown.** Find the existing "All Sources" `<select>` (sourceFilter) and add
this `<select>` immediately after its closing `</select>`:
```tsx
                <select value={stateFilter} onChange={e => setStateFilter(e.target.value)}
                    style={{ padding: "4px 8px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)" }}>
                    <option value="all">All States</option>
                    {availableStates.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
```

> Note: A7 is the **recommended/optional** observability filter (see plan §3A-A7). The agent
> functions without it; it just lets you view "all MA leads" during the pilot. If your developer
> prefers to defer it, skip this file and the A7.x changes in `leads/route.ts` — nothing else
> depends on them.

---

## A4 — `src/app/(dashboard)/agents/page.tsx` (the dedicated card)

**A4.1 — add the component.** Insert this block at module scope, just BEFORE the
`/* ─── Schedule Editor ─── */` comment / `function ScheduleEditor(...)`:

```tsx
/* ─── Lead Scraper Controls (dedicated card — replaces the generic action bar) ─── */

const US_STATE_OPTIONS = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
    "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
    "VA", "WA", "WV", "WI", "WY", "DC",
];

interface ScraperControl {
    active: boolean; target: string | null; startNonce: string | null; agentStatus: string;
    progress: { state?: string; zipsDone?: number; zipsTotal?: number; zipsEmpty?: number; zipsError?: number; leadsFound?: number; updatedAt?: string } | null;
}

function LeadScraperControls({ showToast }: { showToast: (m: string, t?: string) => void }) {
    const [ctrl, setCtrl] = useState<ScraperControl | null>(null);
    const [selected, setSelected] = useState("MA");
    const [busy, setBusy] = useState(false);

    const fetchCtrl = useCallback(async () => {
        try {
            const res = await fetch("/api/agents/lead-scraper");
            if (res.ok) setCtrl(await res.json());
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { fetchCtrl(); }, [fetchCtrl]);
    useEffect(() => {
        if (!ctrl?.active) return;
        const t = setInterval(fetchCtrl, 10000);
        return () => clearInterval(t);
    }, [ctrl?.active, fetchCtrl]);

    const post = async (body: Record<string, unknown>, okMsg: string) => {
        setBusy(true);
        try {
            const res = await fetch("/api/agents/lead-scraper", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) showToast(okMsg);
            else showToast(data.error || "Action failed", "error");
            fetchCtrl();
        } catch { showToast("Action failed", "error"); }
        setBusy(false);
    };

    const active = !!ctrl?.active;
    const p = ctrl?.progress;
    const total = p?.zipsTotal ?? 0;
    const done = (p?.zipsDone ?? 0) + (p?.zipsEmpty ?? 0);
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const staleMin = p?.updatedAt ? (Date.now() - new Date(p.updatedAt).getTime()) / 60000 : null;
    const offline = active && staleMin !== null && staleMin > 10;

    return (
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border-light)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select value={selected} onChange={e => setSelected(e.target.value)} disabled={active}
                    style={{ flex: 1, padding: "6px 8px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: active ? "var(--neutral-bg)" : "var(--white)" }}>
                    <option value="ALL">All states</option>
                    {US_STATE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {active ? (
                    <button className="btn btn-xs" onClick={() => post({ action: "stop" }, "Lead Scraper stopped")} disabled={busy}
                        style={{ color: "var(--danger)", background: "var(--danger-bg)", border: "1px solid var(--danger-border)", padding: "6px 14px" }}>Stop</button>
                ) : (
                    <button className="btn btn-xs btn-primary" onClick={() => post({ action: "start", target: selected }, `Lead Scraper started — ${selected}`)} disabled={busy}
                        style={{ padding: "6px 14px" }}>Start</button>
                )}
            </div>
            {(active || p) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ height: 6, background: "var(--neutral-bg)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: offline ? "var(--warn-dark)" : "var(--info)", transition: "width 0.3s" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-light)" }}>
                        <span>{p?.state || ctrl?.target || "—"}: {done}/{total} ZIPs ({pct}%)</span>
                        <span>{p?.leadsFound ?? 0} leads</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-faint)" }}>
                        <span>{p?.zipsEmpty ?? 0} empty · {p?.zipsError ?? 0} error</span>
                        <span>{p?.updatedAt ? `updated ${relTime(p.updatedAt)}` : ""}</span>
                    </div>
                    {offline && (
                        <div style={{ fontSize: 10, color: "var(--warn-dark)", background: "var(--warn-bg)", padding: "4px 8px", borderRadius: 6 }}>
                            Worker may be offline — no progress in {Math.round(staleMin!)} min. Check the scraper process or press Stop to reset.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
```
(Uses `relTime` and `useState/useEffect/useCallback`, all already present in this file. All
`var(--…)` tokens used here are already defined in `globals.css`.)

**A4.2 — render the card instead of the generic action bar for this agent.** In `AgentsTab`,
the per-card action bar is a `<div>` containing a `a.status === "running" ? (...) : (...)`
ternary plus a Configure button and an enable/disable toggle. Wrap that ENTIRE action-bar
`<div>` in a slug check so `lead_scraper` renders `LeadScraperControls` instead (and the generic
Run/Stop/Reset/enable controls are all bypassed):

Change the OPENING of the action bar from:
```tsx
                        {/* ── Simplified Action Bar ── */}
                        <div style={{ padding: "10px 20px", borderTop: "1px solid var(--border-light)", display: "flex", gap: 6, alignItems: "center" }}>
                            {/* Primary action: Run or Running indicator */}
```
to:
```tsx
                        {/* ── Action Bar — lead_scraper gets its own dedicated controls (hides generic Run/Stop/Reset/toggle) ── */}
                        {a.slug === "lead_scraper" ? (
                            <LeadScraperControls showToast={showToast} />
                        ) : (
                        <div style={{ padding: "10px 20px", borderTop: "1px solid var(--border-light)", display: "flex", gap: 6, alignItems: "center" }}>
                            {/* Primary action: Run or Running indicator */}
```
Then CLOSE the ternary: the action-bar `</div>` is immediately followed by the card's closing
`</div>` and `);`. Add `)}` right after the action-bar `</div>`:
```tsx
                            </button>
                        </div>
                        )}
                    </div>
                );
```
(The `</button>` shown is the end of the enable-toggle button — i.e. the last child of the
action-bar div. The `)}` closes the `a.slug === "lead_scraper" ? (...) : (...)` ternary.)
