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

                console.log("[AUTH] Attempt:", inputEmail, "| Admin configured:", !!adminEmail);

                if (!adminEmail || !adminPassword) {
                    console.log("[AUTH] FAIL: env vars missing");
                    return null;
                }
                if (inputEmail !== adminEmail) {
                    console.log("[AUTH] FAIL: email mismatch", JSON.stringify(inputEmail), "!==", JSON.stringify(adminEmail));
                    return null;
                }
                if (inputPassword !== adminPassword) {
                    console.log("[AUTH] FAIL: password mismatch");
                    return null;
                }

                console.log("[AUTH] SUCCESS");
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
