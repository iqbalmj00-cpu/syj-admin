export { auth as middleware } from "@/lib/auth";

export const config = {
    matcher: ["/((?!login|api/auth|api/gmail/callback|api/demo-scheduler/callback|api/agents/seed|api/agents/callback|api/agents/leads|api/agents/lead-scraper|api/agents/pending-runs|api/agents/claim-run|api/agents/blogs|api/agents/content|api/agents/outreach-log|api/agents/outreach-queue|api/agents/send-message|api/agents/incoming-message|api/agents/error-log|api/agents/enrichment-data|api/agents/enrichment-results|api/agents/email-cleaner/callback|api/agents/facebook-scraper/callback|api/agents/facebook-owner-lookup|api/webhooks/stripe|api/monitoring/cron|api/cron|_next/static|_next/image|favicon.ico).*)"],
};
