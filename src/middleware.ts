export { auth as middleware } from "@/lib/auth";

export const config = {
    matcher: ["/((?!login|api/auth|api/agents/migrate|api/agents/seed|api/agents/callback|api/agents/leads|api/agents/outreach-log|api/agents/send-message|api/agents/incoming-message|_next/static|_next/image|favicon.ico).*)"],
};
