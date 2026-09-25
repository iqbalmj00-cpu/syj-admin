# STALE DOCUMENT / DO NOT READ OR REFERENCE

<a id="enrichment-current-2026-09-25"></a>
## Enrichment update — September 25, 2026

The required booking signal follows the actual booking/quote entry. Contact requested on the first meaningful screen must be separate from requiredness, price order, and staff confirmation. The current classification corrections remain pending.

See the [current enrichment workflow and status](</Volumes/CODE/SYJ THINKING- CODEX/Documents/New documents/JAMALS ADMIN DASHBOARD/Enrichment Agent - Workflow and Code Map.md#enrichment-current-2026-09-25>). Original snapshot bodies, prior edits, and stale-document notices are preserved.

---

> **Do not use this file as evidence about the repository.** It is kept for history only.
> Statements here may contradict current source and have not been reverified.
>
> The authoritative knowledge base is the verified corpus at
> `/Volumes/CODE/SYJ THINKING- CODEX/Documents/New documents/`.
> Start from `00 - START HERE - DOCUMENT ROUTING INDEX.md` and read only the documents it routes you to.
>
> Live, maintained documentation for the worker agents lives with the agents themselves:
> `Lead Scraper Agent/` in this repo, and `/Volumes/CODE/ENRICHMENT AGENT/`.

---

# Historical: Booking Flow Type Schema Changes

> **Archived implementation snapshot, rechecked 2026-06-29.** The booking-flow fields described below already exist in both live Prisma schema files and are populated/accepted/displayed by the current enrichment worker, result route, lead filters, detail UI, and outreach variables. Do not run the archived schema, SQL, Prisma, migration, generate, or old-path steps below.

**Date:** 2026-04-17
**Scope:** `ScrapedLead` model — add 3 new fields classifying the booking flow type
**Action required:** Mirror to the JAMALS WEBSITE Prisma schema and run `prisma db push`

---

## Why

The enrichment agent previously detected whether a lead had booking at all (`hasTrueOnlineBooking`) and which platform powered it (`bookingPlatform`). Now we also detect **what the booking flow looks like** — specifically whether the customer can:

1. **Upload photos** of the junk they want removed (for AI-generated estimate or human quote)
2. **Select a date/time slot** for self-scheduling
3. **Both** (photo + timeslot picker — the ideal flow)
4. **Other** (has booking but doesn't fit those categories — e.g., contact form wrapped in booking UI)

This creates a much richer set of outreach angles. A lead that has **timeslot but no photo upload** = "your customers can pick a time but can't show you what they need removed — SYJ does both." A lead with **photo upload but no timeslot** = "customers can send pics but can't self-schedule — SYJ completes the loop."

---

## Schema Changes

Add these **3 new fields** to the `ScrapedLead` model in `prisma/schema.prisma`. Changes already made in the JAMALS ADMIN DASH repo (around line 1605).

```prisma
model ScrapedLead {
  // ... existing booking fields ...
  bookingPlatform String?
  bookingType     String?
  bookingCtaTargetsPhone Boolean @default(false)

  // ── NEW: Booking flow type detection ──
  bookingHasPhotoUpload Boolean @default(false)          // NEW: accepts photo uploads in booking flow
  bookingHasTimeslotSelection Boolean @default(false)    // NEW: has date/time slot picker
  bookingFlowType String?                                // NEW: "photo_upload" | "timeslot_selection" | "photo_and_timeslot" | "other" | null

  // ... rest unchanged ...
}
```

### Summary of new columns

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| `bookingHasPhotoUpload` | `Boolean` | No | `false` | Booking flow accepts photo uploads |
| `bookingHasTimeslotSelection` | `Boolean` | No | `false` | Booking flow has date/time slot picker |
| `bookingFlowType` | `String` | Yes | — | Classifies the flow: photo_upload / timeslot_selection / photo_and_timeslot / other |

**All booleans default to `false`.** String is nullable. Existing rows get default values with no data loss.

---

## Action Items for You

### 1. Mirror the schema changes to the JAMALS WEBSITE Prisma schema
Location: `/Users/jamal/Documents/Jamals Website/scaleyourjunk/prisma/schema.prisma`

### 2. Run `prisma db push`

```bash
cd "/Users/jamal/Documents/Jamals Website/scaleyourjunk"
npx prisma db push
```

Adds 2 `Boolean` columns (default false) and 1 nullable `TEXT` column to the `ScrapedLead` table. No data loss.

### 3. Run `prisma generate` in the website project

```bash
cd "/Users/jamal/Documents/Jamals Website/scaleyourjunk" && npx prisma generate
```

Admin dashboard already done on my end.

---

## Detection Logic (for your reference)

All detection is HTML pattern matching — zero cost, no new APIs.

### Photo upload signals (1+ match triggers flag)
- `<input type="file" accept="image/*">` or variations
- Upload widget libraries: Filepond, Dropzone, Uppy, Cloudinary widget
- Text patterns: "upload photos/pictures/images", "snap a pic", "send us pictures"
- CSS classes: `dropzone`, `photo-upload`, `photo-quote`, `picture-quote`, `image-estimate`

### Timeslot selection signals (2+ matches required to avoid false positives)
- `<input type="date|time|datetime-local">`
- Date picker libraries: flatpickr, pikaday, air-datepicker, fullcalendar
- CSS classes: `time-slot`, `booking-slot`, `slot-selector`, `appointment-slot`
- Text patterns: "select/choose/pick a date/time/appointment", "available times/slots/appointments"

### Flow classification
```
if photo_upload AND timeslot_selection  → "photo_and_timeslot"
elif photo_upload                        → "photo_upload"
elif timeslot_selection                  → "timeslot_selection"
elif hasTrueOnlineBooking                → "other"    # has booking, couldn't classify
else                                     → null      # no booking
```

---

## Downstream Changes Already Made in Admin Dashboard

1. **`agent/website_analyzer.py`**: `analyze_booking()` returns 3 new fields (`bookingHasPhotoUpload`, `bookingHasTimeslotSelection`, `bookingFlowType`)
2. **`agent/main.py`**: passes the 3 new fields in the enrichment payload
3. **`src/app/api/agents/enrichment-results/route.ts`**: `ALLOWED_FIELDS` whitelist extended
4. **`src/app/(dashboard)/leads/scraped/page.tsx`**: expanded lead detail panel now shows:
   - Booking Flow ("📷 Photo upload only" / "🗓️ Timeslot only" / "📷🗓️ Photo + Timeslot" / "Other")
   - Has Photo Upload (tree-indented)
   - Has Timeslot Picker (tree-indented)

---

## Rollback Plan

```prisma
// Remove these 3 lines from ScrapedLead:
bookingHasPhotoUpload Boolean @default(false)
bookingHasTimeslotSelection Boolean @default(false)
bookingFlowType String?
```

Then `prisma db push` again. Clean rollback — no foreign keys, all defaults/nullable.

---

## Cost Impact

**Zero.** Pure HTML pattern matching — no new API calls, no AI calls. Same HTML we already fetch, more patterns to match against.

---

## Expected Outreach Angles

| Flow Type | % of Leads (est.) | Pain Point |
|---|---|---|
| `photo_and_timeslot` | ~10-15% | None — they've got a solid flow. Harder sell. |
| `timeslot_selection` only | ~25-30% | "Your customers book a time but you're flying blind on what they need removed" |
| `photo_upload` only | ~10-15% | "Customers send photos but have to wait for you to call back to schedule" |
| `other` | ~5-10% | "You have booking but it's basically a contact form" |
| `null` (no booking) | ~30-40% | "You have no online booking at all" |

---

## Questions?

Contact Jamal. Schema change at line ~1605 of `/Users/jamal/Documents/JAMALS ADMIN DASH/prisma/schema.prisma`.
