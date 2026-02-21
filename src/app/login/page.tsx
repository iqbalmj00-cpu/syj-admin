"use client";

import { useState, FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError("");

        const result = await signIn("credentials", {
            email,
            password,
            redirect: false,
        });

        if (result?.error) {
            setError("Invalid credentials");
            setLoading(false);
        } else {
            router.push("/");
        }
    }

    return (
        <div className="login-page">
            <div className="login-card fade-in">
                <div className="login-logo">SYJ</div>
                <h1 style={{ textAlign: "center", fontSize: 22, fontWeight: 700, fontFamily: "var(--font-heading)", color: "var(--text)", marginBottom: 4 }}>
                    ScaleYourJunk
                </h1>
                <p style={{ textAlign: "center", fontSize: 13, color: "var(--text-faint)", marginBottom: 28 }}>
                    Operations Console
                </p>

                <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {error && (
                        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "var(--danger-dark)" }}>
                            {error}
                        </div>
                    )}
                    <div>
                        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Email</label>
                        <input
                            className="input"
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="admin@scaleyourjunk.com"
                            required
                        />
                    </div>
                    <div>
                        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Password</label>
                        <input
                            className="input"
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        className="btn btn-primary btn-sm"
                        disabled={loading}
                        style={{ width: "100%", justifyContent: "center", padding: "10px 20px", marginTop: 4 }}
                    >
                        {loading ? "Signing in..." : "Sign In"}
                    </button>
                </form>
            </div>
        </div>
    );
}
