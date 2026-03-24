---
description: Database safety rules - NEVER run prisma db push without explicit user approval
---

# Database Safety Rules

> **CRITICAL: This codebase shares a Neon PostgreSQL database with the client-facing dashboard (JAMALS WEBSITE/scaleyourjunk). Any schema changes affect BOTH applications.**

## Rules

1. **NEVER run `npx prisma db push`** without explicit user approval. Always ask first.
2. **NEVER run `npx prisma db push --accept-data-loss`** — this can destroy client data.
3. **NEVER remove models or columns** from `schema.prisma` — they may be used by the client-facing dashboard even if the admin dashboard doesn't reference them.
4. **NEVER run `prisma migrate reset` or `prisma db push --force-reset`** — this wipes the entire database.
5. When adding new models/columns, **only ADD** — never remove or rename existing ones.
6. After any schema change, run `npx prisma validate` first, then ask the user before pushing.
7. If `prisma db push` shows data loss warnings, **STOP and report to user** — do not proceed.
8. The client-facing developer must also add any new admin-only models to their schema to stay in sync.
9. **After adding ANY new models or columns** to `schema.prisma`, always remind the user to share the new schema additions with their client-facing dashboard developer so they can add them to `JAMALS WEBSITE/scaleyourjunk/prisma/schema.prisma` too. Both schemas must always contain every model/column in the database.
