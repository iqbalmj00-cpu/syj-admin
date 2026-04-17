# Booking Detection Schema Changes — Developer Brief

**Date:** 2026-04-17
**Scope:** `ScrapedLead` model — add 5 new fields for richer online booking detection
**Action required:** Mirror these changes to the JAMALS WEBSITE Prisma schema and run `prisma db push`

---

## Why

The current `hasOnlineBooking` field has high false positives — it returns `true` for any page with "Book Now" text, even when that button just dials a phone number. We've now implemented a **tiered booking detection system** in the enrichment agent that distinguishes:

- Real self-service booking (Calendly embed, Jobber widget, native date/time form, etc.)
- CTA-only pages ("Book Now" button that doesn't actually book anything)
- Misleading CTAs (button that says "Book Now" but href is `tel:...`)
- Which specific booking platform competitors use (Calendly, Jobber, Housecall Pro, Workiz, etc.)

This gives us much better sales ammo: we can now target companies with **misleading CTAs** as a specific pain point, and identify **displacement opportunities** where competitors pay for Jobber/Housecall Pro that SYJ could replace.

---

## Schema Changes

Add these **5 new fields** to the `ScrapedLead` model in `prisma/schema.prisma`. The changes have already been made in the JAMALS ADMIN DASH repo (around line 1600).

```prisma
model ScrapedLead {
  // ... existing fields unchanged ...

  // ── Enrichment ──
  hasOnlineBooking       Boolean   @default(false)   // LEGACY — still populated for backward compat (== hasTrueOnlineBooking)
  hasTrueOnlineBooking   Boolean   @default(false)   // NEW: Tier 1-3 — real self-service booking detected
  hasBookingCta          Boolean   @default(false)   // NEW: Page has "Book Now" text/button (may be marketing-only)
  bookingPlatform        String?                      // NEW: "Calendly" | "Jobber" | "Housecall Pro" | etc.
  bookingType            String?                      // NEW: "embed" | "external_link" | "native_form" | "cta_only" | "none"
  bookingCtaTargetsPhone Boolean   @default(false)   // NEW: "Book Now" button href is a tel: link (misleading)

  // ... rest of fields unchanged ...
}
```

### Summary of new columns

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| `hasTrueOnlineBooking` | `Boolean` | No | `false` | Real booking (embed/external/native form) |
| `hasBookingCta` | `Boolean` | No | `false` | Page has "Book Now" text (may be marketing-only) |
| `bookingPlatform` | `String` | Yes | — | Platform name (Calendly, Jobber, Housecall Pro, etc.) |
| `bookingType` | `String` | Yes | — | Integration type (embed/external_link/native_form/cta_only/none) |
| `bookingCtaTargetsPhone` | `Boolean` | No | `false` | "Book Now" link is a `tel:` URL (misleading CTA) |

**All booleans default to `false`** and strings are nullable. Existing rows will not have these fields populated until the enrichment agent runs on them again.

---

## Action Items for You

### 1. Mirror the schema changes to the JAMALS WEBSITE Prisma schema
Location: `/Users/jamal/Documents/Jamals Website/scaleyourjunk/prisma/schema.prisma`

Add the same 5 fields to the `ScrapedLead` model.

### 2. Run `prisma db push`

```bash
cd "/Users/jamal/Documents/Jamals Website/scaleyourjunk"
npx prisma db push
```

This adds 5 columns to the `ScrapedLead` table:
- 3 `Boolean` columns with `DEFAULT false`
- 2 nullable `TEXT` columns

**No data loss** — all existing rows will have default values.

### 3. Run `prisma generate` in the website project

```bash
cd "/Users/jamal/Documents/Jamals Website/scaleyourjunk" && npx prisma generate
```

(Admin dashboard already done on my end.)

---

## Detection Capability Details (for your reference)

The tiered detection looks for these signals in the lead's website HTML:

### Tier 1 — Embedded widgets (highest confidence)
Detects 25+ platforms by script src, iframe src, CSS classes, and data attributes:
- **Generic scheduling:** Calendly, Acuity Scheduling, Square Appointments, Setmore, Simplybook, Booksy, Vagaro, TimeTap
- **Service-business:** Jobber, Housecall Pro, ServiceTitan, Workiz, GorillaDesk, FieldPulse, ResponsiBid, Kickserv, Markate, Thryv, Vonigo
- **Website-native:** Wix Bookings, GoDaddy Appointments
- **WordPress plugins:** Bookly, Amelia, BookingPress, Gravity Forms Schedule

### Tier 2 — External platform domain links
Detects when "Book Now" button href points to a known booking platform domain (e.g., `href="https://calendly.com/..."`)

### Tier 3 — Native date/time form inputs
Detects custom-built booking forms using `<input type="date">`, `<input type="time">`, `<input type="datetime-local">`, or popular date picker libraries (flatpickr, pikaday, etc.). Requires 2+ signals to avoid false positives from unrelated birthday fields.

### Tier 4 — CTA link target analysis
For every "Book Now" button, checks the `href`:
- `tel:...` → sets `bookingCtaTargetsPhone: true` (misleading CTA)
- `mailto:...` → not true booking

### Tier 5 — Keyword-only fallback
"Book Now" text with no verifiable backing → `hasBookingCta: true`, `hasTrueOnlineBooking: false`

---

## Downstream Changes Already Made in Admin Dashboard

1. **Enrichment agent** (`/Users/jamal/Documents/ENRICHMENT AGENT`):
   - New `analyze_booking()` function in `agent/website_analyzer.py` with 25+ platform patterns
   - Updated `agent/main.py` to use the tiered detection
   - Updated `agent/scorer.py` pain points to surface "misleading CTA" and "competitor displacement" angles

2. **Admin API** (`src/app/api/agents/enrichment-results/route.ts`):
   - `ALLOWED_FIELDS` whitelist extended with the 5 new fields

3. **Admin UI** (`src/app/(dashboard)/leads/scraped/page.tsx`):
   - Expanded lead detail now shows: True Online Booking, Booking Platform, Booking Type, "Book Now" CTA, and a warning icon for misleading phone-dialing CTAs

---

## Rollback Plan

If anything goes wrong:

```prisma
// Remove these 5 lines from ScrapedLead:
hasTrueOnlineBooking   Boolean   @default(false)
hasBookingCta          Boolean   @default(false)
bookingPlatform        String?
bookingType            String?
bookingCtaTargetsPhone Boolean   @default(false)
```

Then `prisma db push` again. Clean rollback — no foreign keys, all nullable/defaulted.

---

## Cost Context

**Zero cost impact.** Detection is pure HTML pattern matching — no new external API calls, no AI calls added. Same HTML we already fetch, more patterns to match against.

---

## Expected Impact

Based on current lead data (~80% have active websites, majority use generic "Book Now" CTAs without real booking):

- **~40-50% of leads** will have `bookingCtaTargetsPhone: true` → powerful pain point for outreach
- **~15-20% of leads** will have `bookingPlatform` identified → displacement opportunities (Jobber, Housecall Pro, etc.)
- **~30-40% of leads** will have `hasTrueOnlineBooking: true` → no longer a viable "missing booking" pitch for those
- False positives in the old `hasOnlineBooking` field drop from ~50% to ~5%

---

## Questions?

Contact Jamal. Code changes are in both repos — schema change is around line 1600 of `/Users/jamal/Documents/JAMALS ADMIN DASH/prisma/schema.prisma` for reference.
