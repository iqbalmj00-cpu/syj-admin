import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers: [
        Credentials({
            name: "Admin Login",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            authorize(credentials) {
                const adminEmail = process.env.ADMIN_EMAIL;
                const adminPassword = process.env.ADMIN_PASSWORD;
                if (!adminEmail || !adminPassword) return null;
                if (credentials?.email !== adminEmail) return null;

                // Support both hashed and plain passwords
                const passwordStr = String(credentials.password);
                const isValid =
                    adminPassword.startsWith("$2")
                        ? bcrypt.compareSync(passwordStr, adminPassword)
                        : passwordStr === adminPassword;

                if (!isValid) return null;
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
