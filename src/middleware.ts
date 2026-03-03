export { auth as middleware } from "@/lib/auth";

export const config = {
    matcher: ["/((?!login|api/auth|api/agents/migrate|api/agents/seed|api/agents/callback|api/agents/leads|api/agents/blogs|api/agents/outreach-log|api/agents/outreach-queue|api/agents/send-message|api/agents/incoming-message|api/agents/error-log|api/webhooks/stripe|api/monitoring/cron|api/cron|_next/static|_next/image|favicon.ico).*)"],
};
