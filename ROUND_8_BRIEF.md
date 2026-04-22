# Round 8 — Pain Severity, Business Specialty, Review Trend + Enrichment Retry Fix

Addresses 4 targeted issues surfaced during post-Round-7 review:

| Issue | Fix |
|---|---|
| **#3 — No single pain-intensity score** | Added `painSeverityScore Int?` — weighted 0-100 combining pain breadth, negative review %, response inverse, and recency |
| **#5 — No Claude-extracted business angle** | Added `businessSpecialty String?` — one-line distinctive-angle summary (e.g. "eco-friendly hauler serving upscale Chicago neighborhoods") |
| **#6 — No review trend signal** | Added `recentReviewTrend String?` — time-series classifier over the 50 stored reviews: `improving / stable / declining / dormant / insufficient_data` |
| **#17 — `enrichedAt` stamped on failed runs** | Admin-dash route now only stamps `enrichedAt` if the payload is substantive (grade assigned + at least one external-call signal). Partial / failed enrichments stay `enrichedAt: null` so the next default batch retries them. |

Bonus fix while I was in `company_extractor.py`: replaced a hardcoded `2026` in the years-in-business cross-fill logic with `datetime.now().year` so it won't rot.

---

## 1. What's shipped (admin dash — already committed)

| File | Change |
|---|---|
| `prisma/schema.prisma` | +3 fields on `ScrapedLead` |
| `src/app/api/agents/enrichment-results/route.ts` | +3 entries in `ALLOWED_FIELDS`; **substantive-only** `enrichedAt` stamping for `action: "enrich"` (Issue 17 fix). The `action: "skip"` branch is unchanged — it still stamps `enrichedAt` unconditionally for existing-client skips. |
| `src/app/api/agents/leads/route.ts` | +2 filter params: `recentReviewTrend` (multi-select, OR) + `painSeverityMin` (gte) |
| `src/app/(dashboard)/leads/scraped/page.tsx` | Trend-chip row + pain-severity dropdown appended to the Primary-Bottleneck segment block; expanded detail view shows pain severity + trend under the Primary Bottleneck box, plus a standalone Business Specialty block |
| `npx prisma generate` | Ran clean |
| `npx tsc --noEmit` | Passes clean |

Cross-check verified: **144 keys in agent `enrichment_data` → 0 mismatches** against `ALLOWED_FIELDS`.

---

## 2. What's shipped (enrichment agent — local)

| File | Change |
|---|---|
| `agent/main.py` | Derivation block: `_compute_pain_severity()` (weighted 0-100), `_compute_review_trend()` (time-series on stored reviews). Wires `painSeverityScore`, `recentReviewTrend`, `businessSpecialty` into `enrichment_data` dict. |
| `agent/company_extractor.py` | Claude prompt extended with `business_specialty` JSON key (≤160 chars, focused on niche+geography+angle). Hardcoded `2026` replaced with `datetime.now().year`. `businessSpecialty` sanitized to ≤160 chars in the return dict. |

Python syntax check + import test both pass.

### Pain Severity Formula

```
breadth      = min(1.0, painTagCount / 5.0)
neg_percent  = negativeReviewPercent            (defaults 0 if null)
inv_response = 1.0 - ownerResponseRate          (defaults 0.5 when null — "moderate")
recency      = 1.0  if daysSinceMostRecentNegative < 30
             = 0.6  if < 90
             = 0.3  if < 180
             = 0.0  otherwise

score = (0.30·breadth + 0.30·neg_percent + 0.20·inv_response + 0.20·recency) × 100
```

### Review Trend Algorithm

```
if reviewsAnalyzedCount < 10 → "insufficient_data"
if most recent review > 90 days old → "dormant"
Else:
  Sort reviews by date desc
  Split into recent_half + older_half
  diff = avg(recent) - avg(older)
  diff > +0.3  → "improving"
  diff < -0.3  → "declining"
  else         → "stable"
```

### Issue 17 — `enrichedAt` Guard Logic

```typescript
const hasGrade = typeof d.grade === "string" && d.grade.length > 0;
const hasWebsiteSignal = (typeof d.cmsDetected === "string" && d.cmsDetected.length > 0)
                       || (typeof d.websiteScore === "number" && d.websiteScore > 0);
const hasReviewSignal = typeof d.reviewsAnalyzedCount === "number" && d.reviewsAnalyzedCount > 0;
const hasGbpSignal    = typeof d.profileCompletenessScore === "number" && d.profileCompletenessScore > 0;
const isSubstantive = hasGrade && (hasWebsiteSignal || hasReviewSignal || hasGbpSignal);
if (isSubstantive) safeData.enrichedAt = new Date();
```

**Critical safety point:** partial data is STILL written (any signal is better than none) — only the `enrichedAt` timestamp is withheld. So a failed enrichment doesn't lose data; it just stays eligible for re-enrichment on the next default run.

---

## 3. DATABASE MIGRATION — you run this

```sql
ALTER TABLE "ScrapedLead"
    ADD COLUMN "painSeverityScore"  INTEGER,
    ADD COLUMN "businessSpecialty"  TEXT,
    ADD COLUMN "recentReviewTrend"  TEXT;
```

No new indexes required (filters on `recentReviewTrend` are low-cardinality enum; `painSeverityScore` gte filters are fine without an index unless the table exceeds ~100k rows).

### Prisma CLI alternative

```bash
cd "/Users/jamal/Documents/JAMALS ADMIN DASH"
npx prisma migrate dev --name round_8_severity_specialty_trend
```

### Mirror to JAMALS WEBSITE

Copy the 3 new field lines from `prisma/schema.prisma` (look for the `// ── Round 8: severity + trend + specialty ──` comment block inside `ScrapedLead`) into `/Users/jamal/Documents/Jamals Website/scaleyourjunk/prisma/schema.prisma`, then run `npx prisma generate` in that repo.

### Rollback

```sql
ALTER TABLE "ScrapedLead"
    DROP COLUMN IF EXISTS "recentReviewTrend",
    DROP COLUMN IF EXISTS "businessSpecialty",
    DROP COLUMN IF EXISTS "painSeverityScore";
```

---

## 4. Deployment order

1. **Merge + deploy admin-dash** (this commit). Filters default to "all" — safe.
2. **Run migration SQL** against Neon.
3. **Mirror** to JAMALS WEBSITE schema + `prisma generate`.
4. **Restart enrichment agent** — it picks up the new derivations immediately.
5. **Re-enrich existing leads** via Leads table → Enriched filter → Select All Matching → 🧪 Enrich Selected.

---

## 5. Verification after re-enrichment

Open an enriched lead with ≥ 10 reviews. In the Marketing & Reviews panel:
- **🎯 Primary Bottleneck** box now also shows `Pain severity: X/100` (color-coded) and `Trend: ...`
- **🎯 Business Specialty** box (blue) shows a one-line Claude-extracted angle

In Segment Filters (top of panel):
- Trend chip row (Improving / Stable / Declining / Dormant / Insufficient data)
- "Pain severity ≥" dropdown (40 / 60 / 80)

### Issue 17 verification

After a deliberately-failed enrichment (e.g. restart the agent mid-run), the lead's `enrichedAt` should stay `null` instead of being stamped to `now()`. The next default batch picks it up again.

Run this to see how many leads got retried:
```sql
SELECT count(*) FROM "ScrapedLead"
WHERE "enrichedAt" IS NOT NULL
  AND "grade" IS NULL
  AND "websiteScore" = 0;
```

Expected: small or zero (these are stale pre-fix enrichments). Going forward, new partial runs won't add to this count.

---

## 6. Outreach template ideas unlocked

- `{painSeverityScore}` → sort leads by severity before daily send; thresholds map to urgency of pitch
- `{recentReviewTrend == "declining"}` → "I noticed your recent reviews have taken a dip — something changed?"
- `{recentReviewTrend == "dormant"}` → "Your reviews went quiet about {daysSinceLastReview} days ago — everything OK?"
- `{businessSpecialty}` → direct quote: "Saw you specialize in {businessSpecialty} — how's it going?"

---

## 7. Rollback

- Admin dash: `git revert` this commit
- Agent: revert `main.py` + `company_extractor.py`
- DB: SQL in section 3
- JAMALS WEBSITE: revert schema mirror

Data loss: **none** — additive fields only.
