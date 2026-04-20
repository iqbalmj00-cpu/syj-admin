# FINAL CONSOLIDATED BRIEF — Lead Enrichment Expansion (Phases 1–6)

## Overview

This PR ships the admin-dashboard side of a 6-phase expansion to the lead-enrichment pipeline:

- **Phase 1** — Canonical pain/praise taxonomy (20 pain + 11 praise tags).
- **Phase 2** — GBP profile completeness + sentiment-split review response rates.
- **Phase 2.5** — Booking-flow sophistication tiers + 7 granular component booleans.
- **Phase 3** — Per-platform competitor booleans + payment-stack detection.
- **Phase 4** — Filter UI for already-captured fields (no schema / no scraping changes).
- **Phase 5** — Contact quality fields (email domain classification, phone line type, owner refinement).
- **Phase 6** — Website crawl depth (last-updated year, pricing page, blog, sitemap, service-area on site).

**Total: 64 new fields on `ScrapedLead`, 4 new indexes, 63 new filter controls on the leads table.**

---

## What's already shipped in admin dash (this commit)

| File | Change |
|---|---|
| `src/lib/pain-taxonomy.ts` | NEW — single source of truth for 20 pain + 11 praise canonical tag IDs, labels, categories. |
| `prisma/schema.prisma` | 64 new fields + 4 indexes added to `ScrapedLead`. |
| `src/app/api/agents/enrichment-results/route.ts` | `ALLOWED_FIELDS` whitelist extended — all 64 new fields accepted from the enrichment agent. |
| `src/app/api/agents/leads/route.ts` | 63 new filter query params + Prisma where-clause logic. |
| `src/app/(dashboard)/leads/scraped/page.tsx` | Multi-select chip rows + dropdowns + toggles for all new filters; expanded-detail view surfaces every new field. |
| `scripts/analyze-pain-complaints.mjs` | Read-only diagnostic — run after re-enrichment to verify pain-tag distribution. |
| `PAIN_TAXONOMY_BRIEF.md` | Phase 1 enrichment-agent Claude prompt rewrite (superseded by this brief for deployment steps; keep for the prompt text). |

**Verification state:**
- `npx prisma generate` succeeds.
- `npx tsc --noEmit` passes clean.
- 80 filter state variables in `fetchLeads`, 80 in `useCallback` deps — no stale closures.
- Badge active-count formula covers all 63 filter controls.
- Schema ↔ ALLOWED_FIELDS are 100% in sync (audited field-by-field).

Filters default to `"all"` so they won't query the new columns until the user opts in — safe to deploy ahead of migration.

---

## 1. DATABASE MIGRATION (you run this)

### Consolidated SQL (run once against Neon)

```sql
-- ========================================================
-- Phase 1 — Pain / praise taxonomy
-- ========================================================
ALTER TABLE "ScrapedLead"
    ADD COLUMN "painTags"                     TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
    ADD COLUMN "painTagCounts"                JSONB,
    ADD COLUMN "painTagCount"                 INTEGER,
    ADD COLUMN "praiseTags"                   TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
    ADD COLUMN "praiseTagCounts"              JSONB,
    ADD COLUMN "negativeReviewPercent"        DOUBLE PRECISION,
    ADD COLUMN "mostRecentNegativeReviewDate" TIMESTAMP(3);

-- ========================================================
-- Phase 2 — GBP profile completeness + sentiment-split response
-- ========================================================
ALTER TABLE "ScrapedLead"
    ADD COLUMN "businessDescription"          TEXT,
    ADD COLUMN "hasBusinessDescription"       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "hasBusinessHours"             BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "isOpen24_7"                   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "photoCount"                   INTEGER,
    ADD COLUMN "hasQandAActivity"             BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "gbpPostsLast90d"              INTEGER,
    ADD COLUMN "hasRecentGbpPosts"            BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "profileCompletenessScore"     INTEGER,
    ADD COLUMN "negativeResponseRate"         DOUBLE PRECISION,
    ADD COLUMN "positiveResponseRate"         DOUBLE PRECISION,
    ADD COLUMN "respondsToNegativeReviews"    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "respondsToPositiveReviews"    BOOLEAN NOT NULL DEFAULT FALSE;

-- ========================================================
-- Phase 2.5 — Booking-flow components + sophistication tier
-- ========================================================
ALTER TABLE "ScrapedLead"
    ADD COLUMN "bookingHasAddressInput"       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "bookingHasJobSizeInput"       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "bookingHasItemSelector"       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "bookingHasInstantQuote"       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "bookingHasPriceEstimate"      BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "bookingCollectsPayment"       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "bookingIsQuoteRequestOnly"    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "bookingSophistication"        TEXT;

-- ========================================================
-- Phase 3 — Per-platform competitor booleans + payment stack
-- ========================================================
ALTER TABLE "ScrapedLead"
    ADD COLUMN "usesJobber"                   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "usesWorkiz"                   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "usesHousecallPro"             BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "usesServiceTitan"             BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "usesThryv"                    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "usesGorillaDesk"              BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "usesFieldPulse"               BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "usesQuoteIQ"                  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "usesDocket"                   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "usesDumpstersCom"             BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "usesStripe"                   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "usesSquare"                   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "mentionsCashOnly"             BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "hasOnlinePayment"             BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "paymentPlatform"              TEXT;

-- ========================================================
-- Phase 5 — Contact quality
-- ========================================================
ALTER TABLE "ScrapedLead"
    ADD COLUMN "ownerFirstName"               TEXT,
    ADD COLUMN "ownerLastName"                TEXT,
    ADD COLUMN "ownerLinkedInUrl"             TEXT,
    ADD COLUMN "isDirectContact"              BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "emailDomain"                  TEXT,
    ADD COLUMN "emailDomainType"              TEXT,
    ADD COLUMN "emailDomainMatchesWebsite"    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "emailDeliverable"             BOOLEAN,
    ADD COLUMN "emailRiskScore"               INTEGER,
    ADD COLUMN "emailVerifiedAt"              TIMESTAMP(3),
    ADD COLUMN "phoneLineType"                TEXT,
    ADD COLUMN "phoneCarrier"                 TEXT,
    ADD COLUMN "phoneDeliverable"             BOOLEAN,
    ADD COLUMN "phoneVerifiedAt"              TIMESTAMP(3);

-- ========================================================
-- Phase 6 — Website crawl depth
-- ========================================================
ALTER TABLE "ScrapedLead"
    ADD COLUMN "lastUpdatedYear"              INTEGER,
    ADD COLUMN "hasPricingPage"               BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "pricingSnippet"               TEXT,
    ADD COLUMN "hasBlog"                      BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "serviceAreaPagesCount"        INTEGER,
    ADD COLUMN "hasServiceAreaPublishedOnSite" BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "totalPageCount"               INTEGER;

-- ========================================================
-- Indexes
-- ========================================================
CREATE INDEX "ScrapedLead_painTagCount_idx"                 ON "ScrapedLead"("painTagCount");
CREATE INDEX "ScrapedLead_mostRecentNegativeReviewDate_idx" ON "ScrapedLead"("mostRecentNegativeReviewDate");
CREATE INDEX "ScrapedLead_profileCompletenessScore_idx"     ON "ScrapedLead"("profileCompletenessScore");
CREATE INDEX "ScrapedLead_rating_idx"                       ON "ScrapedLead"("rating");
```

### Prisma CLI alternative

```bash
cd "/Users/jamal/Documents/JAMALS ADMIN DASH"
npx prisma migrate dev --name expand_lead_enrichment_schema
```

### ⚠ Mirror to JAMALS WEBSITE

The Neon DB is shared with the `scaleyourjunk` website repo. Run the migration once, but also **add the matching field declarations to `/Users/jamal/Documents/Jamals Website/scaleyourjunk/prisma/schema.prisma`** — copy the `ScrapedLead` model block from this PR over to that repo, then `npx prisma generate` there. Otherwise the website's Prisma client will throw "unknown column" errors when it reads `ScrapedLead`.

### Rollback

```sql
DROP INDEX IF EXISTS "ScrapedLead_rating_idx";
DROP INDEX IF EXISTS "ScrapedLead_profileCompletenessScore_idx";
DROP INDEX IF EXISTS "ScrapedLead_mostRecentNegativeReviewDate_idx";
DROP INDEX IF EXISTS "ScrapedLead_painTagCount_idx";

ALTER TABLE "ScrapedLead"
    DROP COLUMN IF EXISTS "totalPageCount",
    DROP COLUMN IF EXISTS "hasServiceAreaPublishedOnSite",
    DROP COLUMN IF EXISTS "serviceAreaPagesCount",
    DROP COLUMN IF EXISTS "hasBlog",
    DROP COLUMN IF EXISTS "pricingSnippet",
    DROP COLUMN IF EXISTS "hasPricingPage",
    DROP COLUMN IF EXISTS "lastUpdatedYear",
    DROP COLUMN IF EXISTS "phoneVerifiedAt",
    DROP COLUMN IF EXISTS "phoneDeliverable",
    DROP COLUMN IF EXISTS "phoneCarrier",
    DROP COLUMN IF EXISTS "phoneLineType",
    DROP COLUMN IF EXISTS "emailVerifiedAt",
    DROP COLUMN IF EXISTS "emailRiskScore",
    DROP COLUMN IF EXISTS "emailDeliverable",
    DROP COLUMN IF EXISTS "emailDomainMatchesWebsite",
    DROP COLUMN IF EXISTS "emailDomainType",
    DROP COLUMN IF EXISTS "emailDomain",
    DROP COLUMN IF EXISTS "isDirectContact",
    DROP COLUMN IF EXISTS "ownerLinkedInUrl",
    DROP COLUMN IF EXISTS "ownerLastName",
    DROP COLUMN IF EXISTS "ownerFirstName",
    DROP COLUMN IF EXISTS "paymentPlatform",
    DROP COLUMN IF EXISTS "hasOnlinePayment",
    DROP COLUMN IF EXISTS "mentionsCashOnly",
    DROP COLUMN IF EXISTS "usesSquare",
    DROP COLUMN IF EXISTS "usesStripe",
    DROP COLUMN IF EXISTS "usesDumpstersCom",
    DROP COLUMN IF EXISTS "usesDocket",
    DROP COLUMN IF EXISTS "usesQuoteIQ",
    DROP COLUMN IF EXISTS "usesFieldPulse",
    DROP COLUMN IF EXISTS "usesGorillaDesk",
    DROP COLUMN IF EXISTS "usesThryv",
    DROP COLUMN IF EXISTS "usesServiceTitan",
    DROP COLUMN IF EXISTS "usesHousecallPro",
    DROP COLUMN IF EXISTS "usesWorkiz",
    DROP COLUMN IF EXISTS "usesJobber",
    DROP COLUMN IF EXISTS "bookingSophistication",
    DROP COLUMN IF EXISTS "bookingIsQuoteRequestOnly",
    DROP COLUMN IF EXISTS "bookingCollectsPayment",
    DROP COLUMN IF EXISTS "bookingHasPriceEstimate",
    DROP COLUMN IF EXISTS "bookingHasInstantQuote",
    DROP COLUMN IF EXISTS "bookingHasItemSelector",
    DROP COLUMN IF EXISTS "bookingHasJobSizeInput",
    DROP COLUMN IF EXISTS "bookingHasAddressInput",
    DROP COLUMN IF EXISTS "respondsToPositiveReviews",
    DROP COLUMN IF EXISTS "respondsToNegativeReviews",
    DROP COLUMN IF EXISTS "positiveResponseRate",
    DROP COLUMN IF EXISTS "negativeResponseRate",
    DROP COLUMN IF EXISTS "profileCompletenessScore",
    DROP COLUMN IF EXISTS "hasRecentGbpPosts",
    DROP COLUMN IF EXISTS "gbpPostsLast90d",
    DROP COLUMN IF EXISTS "hasQandAActivity",
    DROP COLUMN IF EXISTS "photoCount",
    DROP COLUMN IF EXISTS "isOpen24_7",
    DROP COLUMN IF EXISTS "hasBusinessHours",
    DROP COLUMN IF EXISTS "hasBusinessDescription",
    DROP COLUMN IF EXISTS "businessDescription",
    DROP COLUMN IF EXISTS "mostRecentNegativeReviewDate",
    DROP COLUMN IF EXISTS "negativeReviewPercent",
    DROP COLUMN IF EXISTS "praiseTagCounts",
    DROP COLUMN IF EXISTS "praiseTags",
    DROP COLUMN IF EXISTS "painTagCount",
    DROP COLUMN IF EXISTS "painTagCounts",
    DROP COLUMN IF EXISTS "painTags";
```

---

## 2. ENRICHMENT AGENT CHANGES (Python — `/Users/jamal/Documents/ENRICHMENT AGENT`)

You apply these. Admin-dash code is complete and waiting.

### Phase 1 — Canonical pain/praise tagging

Full details + replacement Claude prompt are in [`PAIN_TAXONOMY_BRIEF.md`](PAIN_TAXONOMY_BRIEF.md). In summary:

- Rewrite the `analyze_reviews()` prompt in `agent/review_analyzer.py` to emit `pain_tag_counts` + `praise_tag_counts` dicts keyed by the canonical IDs listed in `src/lib/pain-taxonomy.ts`.
- In `agent/main.py`, after `analyze_reviews` returns, derive:
  - `painTags = list(painTagCounts.keys())`
  - `painTagCount = len(painTagCounts)` (plus same for praise)
  - `negativeReviewPercent = negativeReviewCount / reviewsAnalyzedCount` (guard divide-by-zero)
  - `mostRecentNegativeReviewDate = max(review.date for review in reviews if rating <= 2)`
- Add all 7 new fields to the `enrichment_data` dict pushed to the dashboard.

**Canonical IDs (exactly these strings — no variation):**

Pain (20): `missed_calls`, `slow_response`, `communication`, `broken_followup_promises`, `website_issues`, `no_show`, `missed_pickup`, `hard_to_book`, `hard_to_cancel`, `service_refusal`, `damage`, `refuses_damage_claims`, `incomplete_job`, `rude_crew`, `unsafe_driving`, `dishonest_conduct`, `scope_mismatch`, `pricing_surprise`, `billing_problem`, `out_of_business_signal`.

Praise (11): `fast_service`, `on_time`, `professional`, `friendly_crew`, `goes_above_beyond`, `thorough_cleanup`, `reliable`, `fair_pricing`, `good_communication`, `easy_to_book`, `flexible_scheduling`.

---

### Phase 2 — GBP profile completeness + sentiment-split response

**New file:** `agent/gbp_profile.py`

Fetch the GBP profile payload via Outscraper's Google Maps Data endpoint (separate from the reviews endpoint) using `googlePlaceId`. Extract:

```python
{
  "businessDescription": <str or None>,       # GBP description
  "hasBusinessDescription": <bool>,           # description present and non-empty
  "hasBusinessHours": <bool>,                 # working_hours present
  "isOpen24_7": <bool>,                       # all 7 days "Open 24 hours"
  "photoCount": <int or None>,                # photos_count field
  "hasQandAActivity": <bool>,                 # questions_count > 0
  "gbpPostsLast90d": <int or None>,           # count GBP posts in last 90d (may require separate posts endpoint)
  "hasRecentGbpPosts": <bool>,                # gbpPostsLast90d > 0
}
```

**Completeness score** (computed in `main.py`):
```python
profileCompletenessScore = (
    (20 if hasBusinessDescription else 0) +
    (15 if hasBusinessHours else 0) +
    (20 if (photoCount or 0) >= 10 else 10 if (photoCount or 0) >= 1 else 0) +
    (15 if hasQandAActivity else 0) +
    (15 if hasRecentGbpPosts else 0) +
    (15 if (reviewCount or 0) >= 10 else 0)
)  # max 100
```

**Sentiment-split response rates** — in `agent/review_analyzer.py`, iterate reviews and compute:
```python
negative_reviews = [r for r in reviews if r["rating"] <= 2]
positive_reviews = [r for r in reviews if r["rating"] >= 4]
negativeResponseRate = (sum(1 for r in negative_reviews if r.get("ownerAnswer")) / len(negative_reviews)) if negative_reviews else None
positiveResponseRate = (sum(1 for r in positive_reviews if r.get("ownerAnswer")) / len(positive_reviews)) if positive_reviews else None
respondsToNegativeReviews = (negativeResponseRate or 0) >= 0.5
respondsToPositiveReviews = (positiveResponseRate or 0) >= 0.5
```

Push all 13 new fields via `enrichment_data`.

---

### Phase 2.5 — Booking-flow components + sophistication tier

Extend `agent/website_analyzer.py::analyze_booking()` to detect each of the 7 new components from the HTML:

| Field | Detection heuristic |
|---|---|
| `bookingHasAddressInput` | Flow contains `input[name*="address"]` / autocomplete address field |
| `bookingHasJobSizeInput` | Regex: "truck size\|truckload\|half truck\|full truck\|quarter truck\|volume\|cubic yards" |
| `bookingHasItemSelector` | Checkbox/select with item names: "sofa\|fridge\|mattress\|appliance\|furniture" |
| `bookingHasInstantQuote` | JS computes price client-side; DOM has `$X` or "estimated price" that updates |
| `bookingHasPriceEstimate` | Static pricing ranges shown before booking (e.g. "$150–$600") |
| `bookingCollectsPayment` | Form has Stripe / Square / PayPal / credit-card fields before "Confirm" |
| `bookingIsQuoteRequestOnly` | Form submit = "Request quote" / "Get quote", no scheduling or payment |

Then compute `bookingSophistication` (single enum):
```python
if not hasTrueOnlineBooking and not hasBookingCta:
    sophistication = "none"
elif hasBookingCta and not hasTrueOnlineBooking:
    sophistication = "cta_only"
elif bookingCollectsPayment and bookingHasTimeslotSelection:
    sophistication = "full_booking"
elif bookingHasInstantQuote:
    sophistication = "instant_quote"
elif bookingIsQuoteRequestOnly:
    sophistication = "quote_form"
elif bookingHasPhotoUpload and not bookingHasTimeslotSelection:
    sophistication = "photo_collector"
elif bookingHasTimeslotSelection:
    sophistication = "basic_scheduler"
else:
    sophistication = "other"
```

Push all 8 new fields.

---

### Phase 3 — Competitor expansion + payment stack detection

**Extend `detect_competitor()`** in `agent/website_analyzer.py`:

Add to the competitor-domain dict:
```python
"quoteiq.com": "QuoteIQ",
"docket.com": "Docket",
"dumpsters.com": "Dumpsters.com partnership",
```

Add to the iframe/script regex list:
```python
(re.compile(r'quoteiq\.com/book|app\.quoteiq', re.I), "QuoteIQ"),
(re.compile(r'docket\.com/(schedule|book)', re.I), "Docket"),
(re.compile(r'(dumpsters\.com)/booking|partner\.dumpsters\.com', re.I), "Dumpsters.com partnership"),
```

Then in `main.py`, derive the per-platform booleans from `competitorPlatform`:
```python
platform = competitor.get("platform") or ""
enrichment_data["usesJobber"]       = platform == "Jobber"
enrichment_data["usesWorkiz"]       = platform == "Workiz"
enrichment_data["usesHousecallPro"] = platform == "Housecall Pro"
enrichment_data["usesServiceTitan"] = platform == "ServiceTitan"
enrichment_data["usesThryv"]        = platform == "Thryv"
enrichment_data["usesGorillaDesk"]  = platform == "GorillaDesk"
enrichment_data["usesFieldPulse"]   = platform == "FieldPulse"
enrichment_data["usesQuoteIQ"]      = platform == "QuoteIQ"
enrichment_data["usesDocket"]       = platform == "Docket"
enrichment_data["usesDumpstersCom"] = platform == "Dumpsters.com partnership"
```

**New function `detect_payment(html)`** in `agent/website_analyzer.py`:
```python
def detect_payment(html: str) -> dict:
    html_lower = (html or "").lower()
    uses_stripe = bool(re.search(r'js\.stripe\.com|data-stripe|stripe\.com/v3', html_lower))
    uses_square = bool(re.search(r'squareupcdn\.com|square\.site|js\.squareup', html_lower))
    mentions_cash_only = bool(re.search(r'cash\s+(only|or\s+check)|we\s+(only\s+)?accept\s+cash', html_lower))
    platform = " + ".join(filter(None, ["Stripe" if uses_stripe else None, "Square" if uses_square else None])) or None
    return {
        "usesStripe": uses_stripe,
        "usesSquare": uses_square,
        "mentionsCashOnly": mentions_cash_only,
        "paymentPlatform": platform,
    }
```

Then in `main.py`:
```python
payment = detect_payment(html) if html else {"usesStripe": False, "usesSquare": False, "mentionsCashOnly": False, "paymentPlatform": None}
enrichment_data.update(payment)
enrichment_data["hasOnlinePayment"] = payment["usesStripe"] or payment["usesSquare"] or booking_analysis["hasTrueOnlineBooking"]
```

Push all 15 new fields.

---

### Phase 5 — Contact quality

**Owner name split** (at write time in `main.py`):
```python
if owner_name:
    parts = owner_name.strip().split(None, 1)
    enrichment_data["ownerFirstName"] = parts[0] if parts else None
    enrichment_data["ownerLastName"]  = parts[1] if len(parts) > 1 else None
```

**LinkedIn URL promotion**:
```python
if owner_name_source == "web_search" and owner_name_source_url and "linkedin.com" in owner_name_source_url.lower():
    enrichment_data["ownerLinkedInUrl"] = owner_name_source_url
```

**Email domain classification** (at write time):
```python
PERSONAL_EMAIL_DOMAINS = {"gmail.com", "yahoo.com", "aol.com", "outlook.com", "hotmail.com", "icloud.com", "live.com", "me.com"}

email = lead.get("email", "") or ""
if "@" in email:
    domain = email.split("@", 1)[1].lower().strip()
    enrichment_data["emailDomain"] = domain
    enrichment_data["emailDomainType"] = "personal" if domain in PERSONAL_EMAIL_DOMAINS else ("business_custom" if domain else "unknown")
    if website:
        website_host = re.sub(r'^https?://(www\.)?', '', website.lower()).split('/')[0]
        enrichment_data["emailDomainMatchesWebsite"] = website_host.endswith(domain) or domain.endswith(website_host)
```

**Direct-contact heuristic**:
```python
is_direct = False
if enrichment_data.get("emailDomainMatchesWebsite"):
    is_direct = True
elif email and owner_first_name:
    local = email.split("@", 1)[0].lower()
    if owner_first_name.lower() in local:
        is_direct = True
enrichment_data["isDirectContact"] = is_direct
```

**Phone line type (Twilio Lookup v2) + email verification** — these cost money per call, so **defer to outreach-queue time**, NOT per-lead at enrichment. Add a separate worker that processes `OutreachQueue` items before sending:

```python
# In your outreach worker, before sending to a given lead:
# 1. Twilio Lookup v2 — $0.005 per phone
# 2. ZeroBounce / NeverBounce — $0.007 per email
# Then PATCH the lead with:
#   phoneLineType, phoneCarrier, phoneDeliverable, phoneVerifiedAt
#   emailDeliverable, emailRiskScore, emailVerifiedAt
```

Push `ownerFirstName`, `ownerLastName`, `ownerLinkedInUrl`, `isDirectContact`, `emailDomain`, `emailDomainType`, `emailDomainMatchesWebsite` at enrichment time. The deliverability fields can stay null until outreach-queue verification runs.

---

### Phase 6 — Website crawl depth

Expand `fetch_html()` in `agent/website_analyzer.py` to also fetch:
- `/pricing`, `/services/pricing` — detect `hasPricingPage`
- `/blog`, `/news`, `/resources` — detect `hasBlog`
- `sitemap.xml` — parse URL list for `totalPageCount` and count service-area paths for `serviceAreaPagesCount`

```python
async def crawl_site_depth(website: str) -> dict:
    """Fetches pricing page, blog, sitemap. Returns depth metrics."""
    result = {
        "hasPricingPage": False,
        "pricingSnippet": None,
        "hasBlog": False,
        "serviceAreaPagesCount": None,
        "hasServiceAreaPublishedOnSite": False,
        "totalPageCount": None,
        "lastUpdatedYear": None,
    }
    if not website:
        return result

    # Pricing page
    for path in ["/pricing", "/services/pricing", "/price-list"]:
        html, _, ok = await fetch_html(website.rstrip("/") + path)
        if ok and html and re.search(r'\$\s?\d', html):
            result["hasPricingPage"] = True
            # Extract first pricing snippet
            match = re.search(r'.{0,80}\$\d[\d,.]*[^\d].{0,80}', html)
            if match:
                result["pricingSnippet"] = re.sub(r'<[^>]+>', ' ', match.group(0)).strip()[:200]
            break

    # Blog
    for path in ["/blog", "/news", "/resources"]:
        html, _, ok = await fetch_html(website.rstrip("/") + path)
        if ok and html and "<html" in html.lower():
            result["hasBlog"] = True
            break

    # Sitemap
    html, _, ok = await fetch_html(website.rstrip("/") + "/sitemap.xml")
    if ok and html:
        urls = re.findall(r'<loc>([^<]+)</loc>', html)
        if urls:
            result["totalPageCount"] = len(urls)
            sa_pages = [u for u in urls if re.search(r'/(service-area|locations|areas-we-serve|cities|service-areas)/', u, re.I)]
            result["serviceAreaPagesCount"] = len(sa_pages)
            result["hasServiceAreaPublishedOnSite"] = len(sa_pages) > 0

    return result


def extract_copyright_year(html: str) -> int | None:
    """Parses copyright footer or latest blog post year."""
    if not html:
        return None
    years = re.findall(r'(?:©|&copy;|copyright)\s*(20\d{2})', html, re.I)
    return max(int(y) for y in years) if years else None
```

In `main.py`:
```python
if has_active_website and website:
    site_depth = await crawl_site_depth(website)
    enrichment_data.update(site_depth)
    enrichment_data["lastUpdatedYear"] = extract_copyright_year(html)
```

Push all 7 new fields.

---

## 3. DEPLOYMENT ORDER

1. **Merge + deploy admin-dash code** (this PR). Safe — no new fields queried unless users opt in.
2. **Run migration** (Section 1 SQL). Also update the JAMALS WEBSITE schema.prisma and run `prisma generate` in that repo.
3. **Update enrichment agent** (Section 2 code changes). Restart `uvicorn server:app --port 8006`.
4. **Re-enrich existing leads.** From the admin dash Leads table:
   - Filter `Enriched = Yes`
   - Select all → click **🧪 Enrich Selected**
   - Agent re-processes each lead and pushes the new canonical fields.

---

## 4. VERIFICATION

### Immediate (after migration)

```bash
# Confirm columns exist
psql $DATABASE_URL -c "\d \"ScrapedLead\"" | grep -E "painTags|bookingSophistication|profileCompletenessScore"
```

### After agent deploy + re-enrichment

```bash
cd "/Users/jamal/Documents/JAMALS ADMIN DASH"
node --env-file=.env scripts/analyze-pain-complaints.mjs
```

Extend the script to also count `painTags` distribution (top 20 frequencies). Expect clean tags like `missed_calls: 42, rude_crew: 31, refuses_damage_claims: 18, …` — not 331 unique free-text strings.

### UI smoke test

- Open the Leads table → Segment Filters panel → confirm all 11 new sections are visible (Pain / Praise / Severity / GBP / Booking Sophistication / Competitor Stack / Payment Stack / Tech Stack / Marketing Signals / Team & Profile / Market Context / Contact Quality / Website Depth).
- Click a pain-tag chip → lead count should drop and only leads with that tag should show.
- Expand any lead → verify all new fields appear in Company / Website & Tech / Marketing & Reviews panels.

---

## 5. ROLLBACK

If anything breaks:

1. Revert this PR via `git revert`.
2. Run the rollback SQL in Section 1.
3. Restore the original `agent/review_analyzer.py` prompt.
4. Mirror the schema rollback to JAMALS WEBSITE.

Data loss: **none** — old `reviewComplaints` / `reviewPraise` free-text fields and existing scalar filter columns are untouched.

---

## 6. REFERENCE — FIELD INVENTORY

**Phase 1 (7):** `painTags` · `painTagCounts` · `painTagCount` · `praiseTags` · `praiseTagCounts` · `negativeReviewPercent` · `mostRecentNegativeReviewDate`

**Phase 2 (13):** `businessDescription` · `hasBusinessDescription` · `hasBusinessHours` · `isOpen24_7` · `photoCount` · `hasQandAActivity` · `gbpPostsLast90d` · `hasRecentGbpPosts` · `profileCompletenessScore` · `negativeResponseRate` · `positiveResponseRate` · `respondsToNegativeReviews` · `respondsToPositiveReviews`

**Phase 2.5 (8):** `bookingHasAddressInput` · `bookingHasJobSizeInput` · `bookingHasItemSelector` · `bookingHasInstantQuote` · `bookingHasPriceEstimate` · `bookingCollectsPayment` · `bookingIsQuoteRequestOnly` · `bookingSophistication`

**Phase 3 (15):** `usesJobber` · `usesWorkiz` · `usesHousecallPro` · `usesServiceTitan` · `usesThryv` · `usesGorillaDesk` · `usesFieldPulse` · `usesQuoteIQ` · `usesDocket` · `usesDumpstersCom` · `usesStripe` · `usesSquare` · `mentionsCashOnly` · `hasOnlinePayment` · `paymentPlatform`

**Phase 4:** No new fields. 23 new filter controls against existing fields.

**Phase 5 (14):** `ownerFirstName` · `ownerLastName` · `ownerLinkedInUrl` · `isDirectContact` · `emailDomain` · `emailDomainType` · `emailDomainMatchesWebsite` · `emailDeliverable` · `emailRiskScore` · `emailVerifiedAt` · `phoneLineType` · `phoneCarrier` · `phoneDeliverable` · `phoneVerifiedAt`

**Phase 6 (7):** `lastUpdatedYear` · `hasPricingPage` · `pricingSnippet` · `hasBlog` · `serviceAreaPagesCount` · `hasServiceAreaPublishedOnSite` · `totalPageCount`

**Indexes (4):** `painTagCount`, `mostRecentNegativeReviewDate`, `profileCompletenessScore`, `rating`.

**Grand total: 64 new fields + 4 indexes + 63 new filter controls.**
