import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers: [
        Credentials({
            name: "Admin Login",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                const adminEmail = process.env.ADMIN_EMAIL;
                const adminPassword = process.env.ADMIN_PASSWORD;

                const inputEmail = String(credentials?.email || "").trim();
                const inputPassword = String(credentials?.password || "");

                if (!adminEmail || !adminPassword) {
                    return null;
                }
                if (inputEmail !== adminEmail) {
                    return null;
                }
                if (inputPassword !== adminPassword) {
                    return null;
                }

                return { id: "admin", email: adminEmail, name: "Admin" };
            },
        }),
    ],
    pages: { signIn: "/login" },
    session: { strategy: "jwt" as const },
    callbacks: {
        authorized({ auth: session, request }) {
            const isLoggedIn = !!session?.user;
            const isLoginPage = request.nextUrl.pathname === "/login";
            if (isLoginPage) return true;
            return isLoggedIn;
        },
    },
});

/** Require admin auth for API routes — returns 401 if not authenticated */
export async function requireAdmin() {
    const session = await auth();
    if (!session?.user) {
        throw new Error("Unauthorized");
    }
    return session;
}

/**
 * Check if the request has a valid admin session (for dashboard API calls on
 * routes excluded from middleware). Returns the session if valid, null if not.
 */
export async function getSession() {
    const session = await auth();
    return session?.user ? session : null;
}

/**
 * Verify AGENT_CALLBACK_SECRET from a parsed request body.
 * Use this in POST handlers where the agent sends the secret in the body.
 */
export function verifyAgentSecret(secret: string | undefined): boolean {
    const expected = process.env.AGENT_CALLBACK_SECRET;
    return !!expected && secret === expected;
}
