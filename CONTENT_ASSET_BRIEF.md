# ContentAsset Schema Brief

**For:** SYJ developer (maintains both JAMALS ADMIN DASH and JAMALS WEBSITE codebases)
**Reason:** Content Generator agent rebuild — adds a screenshot/asset library the agent picks from when composing social media ads.
**Risk level:** Low (additive only, no existing tables touched)
**Admin dash status:** Model already added to admin dash `prisma/schema.prisma` and `npx prisma generate` has been run. Only JAMALS WEBSITE schema mirroring + `db push` remain.

## What to add

The admin dash already has the model. Mirror it to the JAMALS WEBSITE `prisma/schema.prisma` so both TypeScript clients stay in sync, then run `db push` once (the shared Neon DB only needs one push).

```prisma
model ContentAsset {
  id               String   @id @default(cuid())
  type             String   @default("screenshot")  // "screenshot" | "before_image"
  surface          String?                          // "admin_dashboard" | "driver_app" | "customer_portal" | "customer_website"
  feature          String?                          // free text — e.g. "dispatch", "revenue", "booking"
  state            String?  @db.Text                // human description of what's shown
  storyTags        String[]                         // e.g. ["automation", "time_saved", "night_bookings"]
  orientation      String                           // "desktop" | "desktop-lifestyle" | "mobile-portrait" | "tablet-landscape"
  blobUrl          String                           // public Vercel Blob URL of the screenshot
  annotationZones  Json?                            // optional {top-left: {x,y}, top-right: {x,y}, ...} for Feature Callout template
  active           Boolean  @default(true)          // admin can toggle off without deleting
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([type])
  @@index([orientation])
  @@index([active])
}
```

## Why

The content generator agent needs a queryable library of real product screenshots to pick from when composing ads. Metadata on each asset lets Claude (the AI) choose a screenshot that matches the content type (e.g., "stat_highlight" picks an asset tagged with numeric state, "phone_agent_highlight" picks a mobile-portrait orientation).

## Code dependencies (not yet created by developer)

The following files will reference `prisma.contentAsset` once the model exists:

- `src/lib/content/library.ts` — queries all active assets for the content generator
- `src/lib/content-generator.tsx` — main agent that reads from the library

**Until the model is added**, the content generator uses an in-memory stub array with the same shape. The pipeline works end-to-end with placeholder images. Once the Prisma model exists, a one-line swap replaces the stub with `prisma.contentAsset.findMany({ where: { active: true } })`.

## Rollout steps

1. Add the model above to **admin dash** `prisma/schema.prisma`
2. Add the same model to **website** `prisma/schema.prisma` (must match exactly)
3. Run `npx prisma validate` in both projects
4. Run `npx prisma db push` **from one project only** (since both share the same DB, pushing once updates both)
5. Run `npx prisma generate` in both projects to update client types
6. Tell the agent work can now swap from in-memory stub to the real DB

## Risks

- **None to existing data** — model is additive, no changes to any existing table
- **Schema drift risk** if only one project adds the model — must be added to both to keep TypeScript happy on both sides

## Seeding (optional, can be done later)

Once the model exists, seed it with real product screenshots by:
1. Capturing screenshots of admin dash / driver app / customer portal / customer website
2. Uploading each to Vercel Blob
3. Inserting a `ContentAsset` row with the Blob URL + metadata

A capture script may be added later to automate this.

---

Questions? Ping Jamal.
