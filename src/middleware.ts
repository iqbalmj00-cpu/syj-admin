export { auth as middleware } from "@/lib/auth";

export const config = {
    matcher: ["/((?!login|api/auth|api/agents/migrate|api/agents/seed|api/agents/callback|api/agents/leads|_next/static|_next/image|favicon.ico).*)"],
};
