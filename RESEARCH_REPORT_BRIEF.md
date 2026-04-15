# Research Report Agent — Unified Developer Brief

**For:** SYJ developer (maintains both JAMALS ADMIN DASH and JAMALS WEBSITE codebases)
**Reason:** New Research Report agent — generates professional research PDFs + commits JSON fixtures to `scaleyourjunk.com/reports` page.
**Risk level:** Low (additive schema only, no existing tables touched)

## Summary of changes

The admin dash now has a `research_writer` agent that:
1. Takes a research topic from Jamal via the dashboard
2. Runs Perplexity sonar-pro research across 4-5 sub-questions
3. Claude Sonnet 4 writes a 3000-word structured report with strict citation rules
4. Renders a branded PDF via `@react-pdf/renderer`
5. Uploads the PDF to Vercel Blob at `reports/{slug}.pdf`
6. Saves a draft row to the shared Neon DB
7. On approval + publish, commits a JSON metadata file to `src/data/content/reports/{slug}.json` in the JAMALS WEBSITE codebase via GitHub Contents API

**Your part (this brief):**
- Mirror the new `ResearchReport` Prisma model to JAMALS WEBSITE's schema + run `db push`
- Build `/reports` listing page and `/reports/{slug}` detail page on scaleyourjunk.com
- Everything else is already wired.

---

## 1. Schema change (required for TypeScript compilation on both sides)

The admin dash already has the model in its `prisma/schema.prisma` and `npx prisma generate` has been run. **You need to mirror it to the JAMALS WEBSITE schema** so both TypeScript clients stay in sync, then run `db push` **once** (the shared Neon DB only needs one push).

Add this to **JAMALS WEBSITE** `prisma/schema.prisma`:

```prisma
model ResearchReport {
  id                String       @id @default(cuid())
  agentRunId        String?
  agentRun          SyjAgentRun? @relation(fields: [agentRunId], references: [id])

  // Report identity
  slug              String       @unique
  title             String
  subtitle          String       @db.Text
  category          String
  categoryIcon      String
  author            String       @default("Jamal Iqbal")

  // Content
  topic             String       @db.Text        // the research topic the user entered
  reportType        String       @default("custom")  // market_analysis | competitor_study | trend_report | operational_benchmark | custom
  excerpt           String       @db.Text        // 1-2 sentence card preview
  execSummary       String       @db.Text        // 3-5 sentence paragraph for detail page
  keyFindings       String[]                     // 4-6 bullets
  fullReportContent Json                         // { sections: [{heading, paragraphs, bullets}], conclusion }

  // About this report
  sourceCount       Int          @default(0)
  dataRange         String                       // e.g. "2024-2026"
  methodology       String       @db.Text        // 1 paragraph
  sources           Json                         // [{title, url, snippet}]

  // SEO
  keywords          String[]
  metaDescription   String       @db.Text        // ≤160 chars

  // PDF
  pageCount         Int          @default(0)
  pdfSizeMb         Float        @default(0)
  draftPdfUrl       String?                      // URL of the PDF on Vercel Blob
  publishedPdfUrl   String?                      // same URL once published (kept separate for audit)

  // Workflow
  status            String       @default("draft") // draft | approved | published | archived | rejected
  warnings          Json?                        // validation warnings from generator
  publishedAt       DateTime?
  archivedAt        DateTime?
  githubSha         String?                      // SHA of GitHub commit when published
  rejectedReason    String?                      // optional note when user rejects a draft

  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt

  @@index([status])
  @@index([category])
  @@index([agentRunId])
}
```

Also add the back-relation on `SyjAgentRun`:

```prisma
model SyjAgentRun {
  // ... existing fields ...
  researchReports  ResearchReport[]
}
```

**Rollout:**
1. Add the model above to JAMALS WEBSITE `prisma/schema.prisma`
2. Add the back-relation on `SyjAgentRun`
3. `npx prisma validate` to confirm valid
4. `npx prisma db push` once (from either project — the admin dash schema is already in sync)
5. `npx prisma generate` on the JAMALS WEBSITE side to update the TS client

---

## 2. What the agent produces (already built, no changes needed on your end)

When Jamal clicks Publish on a draft in the dashboard, the agent emits two artifacts:

**A. PDF file** — uploaded to Vercel Blob at path `reports/{slug}.pdf` (public access)

**B. JSON metadata file** — committed to JAMALS WEBSITE repo at `src/data/content/reports/{slug}.json` via GitHub Contents API (reuses the existing `GITHUB_TOKEN` / `GITHUB_REPO` / `GITHUB_BRANCH` env vars from the blog agent)

The JSON schema matches your existing `ReportFixture` TypeScript type at `scaleyourjunk/src/types/templates/report.ts`. Every field is populated from the DB row + generated content:

```typescript
{
  slug: string;
  title: string;
  subtitle: string;
  category: string;
  categoryIcon: string;
  excerpt: string;
  author: string;                  // defaults to "Jamal Iqbal", editable per-report
  publishedDate: string;           // ISO YYYY-MM-DD
  updatedDate: string;             // ISO YYYY-MM-DD
  pdf: {
    url: string;                   // Vercel Blob public URL
    sizeMb: number;                // rounded to 1 decimal
    pageCount: number;             // parsed from PDF via pdf-lib
  };
  execSummary: string;
  keyFindings: string[];
  aboutThisReport: {
    sourceCount: number;
    dataRange: string;             // e.g. "2024-2026"
    methodology: string;           // 1 paragraph
  };
  keywords: string[];
  meta: {
    title: string;                 // "{title} — {year} Research | ScaleYourJunk"
    description: string;           // ≤160 chars
    canonical: string;              // "/reports/{slug}"
  };
}
```

Fields explicitly omitted (per your earlier instructions): `relatedReports`, `relatedProducts`, `meta.ogImage`. The website derives these at render time.

---

## 3. Categories (constrained to your CATEGORY_TO_PRODUCT map)

The agent is hardcoded to pick from this exact list so product cross-links on the detail page always work:

| Category | Icon | Linked product |
|---|---|---|
| Missed Call Economics | `phone_missed` | AI Phone Agent |
| Speed-to-Lead | `timer` | AI Phone Agent |
| SMS vs Email | `sms` | Marketing Automation |
| Star Ratings & Revenue | `star` | Marketing Automation |
| Self-Booking Conversion | `event_available` | Online Booking & Estimating |
| Platform Consolidation | `schedule` | CRM & Operations Dashboard |

If Claude tries to invent a category outside this list, the agent forces it to fall back to "Missed Call Economics" with the `phone_missed` icon. If you want to add a new category, just tell me and I'll extend the allowed list in `src/lib/research-report-generator.tsx` — you add the matching `CATEGORY_TO_PRODUCT` entry in the website.

---

## 4. Publish workflow on the admin side (already built, no changes needed)

On Publish click in the dashboard:

```ts
// 1. Load draft from shared DB
// 2. Build fixture JSON matching ReportFixture type
// 3. Commit JSON to JAMALS WEBSITE repo at src/data/content/reports/{slug}.json
//    via GitHub Contents API (handles both new-file and update-existing cases)
// 4. Update DB: status=published, publishedAt=now(), githubSha=<commit SHA>
```

On Archive click:

```ts
// 1. Delete JSON file from GitHub (commit: "reports: archive {slug}")
// 2. Update DB: status=archived, archivedAt=now()
// 3. PDF stays on Blob (avoid 404ing bookmarked URLs)
```

Auto-bump slug suffixes (`-v2`, `-v3`, etc.) on collision. Slug uniqueness enforced at DB level.

---

## 5. Your build — the `/reports` listing page and `/reports/{slug}` detail page

Everything below is what you need to build on the JAMALS WEBSITE side. None of this exists yet on the website.

### 5a. Folder structure

Create the directory:
```
src/data/content/reports/
```

The agent will commit JSON files here. Mirror whatever content-loader indexing pattern you use for blogs — reports should auto-register for sitemap inclusion at build time.

### 5b. `/reports` listing page

Static page that reads all JSON files from `src/data/content/reports/*.json` at build time, sorts by `publishedDate` descending, renders a grid of report cards.

Each card shows:
- Title + subtitle
- Category badge (with Material Symbol icon from `categoryIcon`)
- Published date
- Page count + file size ("18-page report · 2.4 MB")
- Short description (from `excerpt`)
- "Read report" button linking to `/reports/{slug}`

Design: match the existing blog listing visual language. Category filter bar at the top is nice-to-have.

### 5c. `/reports/{slug}` detail page

Static dynamic route that reads one JSON file by slug, renders a landing page:

**Hero section:**
- Title + subtitle
- Category badge with Material icon
- Published date + author
- Big prominent "Download PDF" button linking to `fixture.pdf.url`
- File size + page count labels ("18-page report · 2.4 MB")

**Body:**
- **Executive Summary block** — `fixture.execSummary` as readable prose
- **Key Findings block** — `fixture.keyFindings` as visually emphasized bullet list (orange bullets, card background, the way Gartner/Forrester highlight key takeaways)
- **"About this report" sidebar/block** — shows `sourceCount` sources, `dataRange`, and `methodology` paragraph
- **Related product cross-link** — use your existing `CATEGORY_TO_PRODUCT` map to show "Learn more about {product}" below the fold
- **Related reports** — auto-derive at render time: same category, most recent first, limit 3

**Critical:** the detail page does NOT render the full report body. Only exec summary + key findings as previews. The full content lives inside the PDF. Readers click Download to get the rest. This is the standard Gartner/Forrester model.

**SEO:**
- Page `<title>` from `fixture.meta.title`
- Meta description from `fixture.meta.description`
- Canonical URL from `fixture.meta.canonical`
- Open Graph tags populated from fixture (fallback to default SYJ OG image for now; `meta.ogImage` is optional v2 enhancement)
- JSON-LD structured data (Report type) injected in head

### 5d. What you do NOT need to build

- No database queries from the website — reports live as static JSON files like blogs
- No API endpoints — all static file reads
- No auth / gating — reports are free downloads for v1 (can add email gate later as a pure website-side enhancement)
- No PDF rendering — the agent generates the PDF and hosts it on Vercel Blob; the website just links to the URL
- No rebuild trigger — Vercel auto-redeploys when the agent commits the JSON file

---

## 6. Status workflow

```
draft → approved → published → archived
         └──→ rejected (hard delete)
```

- **draft** — Agent generated, sitting in dashboard. PDF uploaded to Blob, NOT committed to GitHub.
- **approved** — Jamal approved in dashboard. Intermediate state. Still not committed.
- **published** — Jamal hit Publish. JSON committed to `src/data/content/reports/{slug}.json`. Website rebuilds, report goes live.
- **archived** — Jamal hit Archive. JSON deleted from GitHub (commit: `reports: archive {slug}`). PDF stays on Blob. Website rebuilds, report disappears from listing.
- **rejected** — Hard delete from DB. No PDF upload, no GitHub activity. For garbage drafts only.

---

## 7. What happens after publish (website side auto-behavior)

1. Agent commits JSON fixture to `main`
2. Vercel detects the push, starts a new build
3. Next.js regenerates static pages for `/reports` and `/reports/{slug}`
4. New report appears in the listing grid
5. Detail page renders hero + exec summary + key findings + about + download button
6. Sitemap auto-includes the new URL (via your existing content-loader pattern)

**Latency:** ~60 seconds from Publish click to report live on the website.

---

## 8. Checklist for you

- [ ] Add `ResearchReport` model to JAMALS WEBSITE `prisma/schema.prisma`
- [ ] Add `researchReports ResearchReport[]` to `SyjAgentRun` in website schema
- [ ] Run `npx prisma validate` and `npx prisma db push` once
- [ ] Run `npx prisma generate` in JAMALS WEBSITE
- [ ] Create `src/data/content/reports/` directory (commit a `.gitkeep`)
- [ ] Register the reports folder in your content-loader / sitemap generator
- [ ] Build `/reports` listing page
- [ ] Build `/reports/{slug}` detail page
- [ ] Verify first published report renders correctly
- [ ] (Optional v2) Add email-gate form on the detail page for lead capture

---

## 9. What's already done on the admin dash side

- ✅ `ResearchReport` model in admin dash `prisma/schema.prisma`
- ✅ `npx prisma generate` run (admin dash TS client updated)
- ✅ `@react-pdf/renderer` + `pdf-lib` dependencies installed
- ✅ PDF template at `src/lib/pdf/ResearchReportTemplate.tsx` (branded cover page, exec summary with key findings box, body sections, conclusion, references, methodology footer, page numbers)
- ✅ Main generator at `src/lib/research-report-generator.tsx` (plan → Perplexity → dedupe → Claude → validate → PDF → Blob → DB)
- ✅ API routes at `src/app/api/agents/research-reports/` (list + create + detail + patch + delete + GitHub publish/archive helpers)
- ✅ `research_writer` agent seed entry
- ✅ Research Reports dashboard tab with topic input form, list, approve/reject/publish/archive actions, inline expand preview, warnings banner
- ✅ Slug collision auto-bump (`-v2`, `-v3`, etc.)
- ✅ Citation validation with 7 different hallucination checks
- ✅ Full error handling and rollback on generation failures

---

Questions? Ping Jamal.
