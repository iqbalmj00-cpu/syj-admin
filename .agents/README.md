# Agent Instructions Index

Read these files at the start of every conversation in this repo:

1. `.agents/PROJECT_KNOWLEDGE.md`
   - Complete verified codebase knowledge for the Jamals Admin Dashboard / ScaleYourJunk admin repo.
   - Must be updated after every meaningful action/change that alters code, workflow behavior, verification results, deployment state, known risks, or repo operating rules.
2. `.agents/workflows/database-safety.md`
   - Mandatory shared-database safety rules.
   - Must be followed before any Prisma schema, migration, seed, reset, backfill, or database-mutating workflow.

Rules for future agents:

- Do not rely on memory or summaries alone. Verify against active code, routes, configs, scripts, schema, and safe command results.
- Treat `.agents/PROJECT_KNOWLEDGE.md` as durable working context, not ultimate truth. If it conflicts with code, update the file.
- After each action/change, either update `.agents/PROJECT_KNOWLEDGE.md` or explicitly record in the final response that no durable project-knowledge update was needed.
- Do not print or store secret values.
- Do not run destructive commands, production database mutations, deploys, real outreach, payments, Twilio/Vercel/Stripe mutations, or external side-effect workflows without explicit user approval.
