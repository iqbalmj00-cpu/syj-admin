"use client";

/**
 * Social Studio.
 *
 * Five tabs: Inbox (capture and qualify ideas), Review (the package for each
 * post and every decision on it), Knowledge (the Fact Book, banned phrases and
 * examples), Assets (screenshots) and History (what has actually gone out).
 *
 * Two things this screen deliberately never does: it never posts anything
 * anywhere, and it never approves anything on its own. Every approval is a
 * button Jamal presses, and every warning has to be seen and accepted before
 * that button works.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

/* ─── Types mirrored from the API responses ──────────────────────── */

interface Seed {
    id: string;
    body: string;
    sourceType: string;
    audience: string | null;
    proofLevel: string;
    permissionRequired: boolean;
    permissionStatus: string;
    anonymized: boolean;
    anonymizedReviewedAt: string | null;
    status: string;
    infoRequest: string | null;
    infoAnswer: string | null;
    rejectedReason: string | null;
    qualifiedCategory: string | null;
    qualifiedPlatforms: string[];
    useCount: number;
    postCount: number;
    createdAt: string;
    updatedAt: string;
}

interface PostListItem {
    id: string;
    platform: string;
    format: string;
    category: string | null;
    status: string;
    factbookStale: boolean;
    verificationStale: boolean;
    postedAt: string | null;
    postedUrl: string | null;
    createdAt: string;
    currentRevisionId: string | null;
    seed: { id: string; body: string; sourceType: string } | null;
    currentRevision: {
        id: string;
        revision: number;
        caption: string;
        topicTags: string[];
        visualPath: string | null;
        createdByType: string;
        verificationResult: string | null;
        warningCount: number;
    } | null;
}

interface Warning {
    code: string;
    message: string;
    detail?: Record<string, unknown>;
}

interface DimensionScore {
    score: number;
    supportingQuote: string | null;
    resemblesAntiExample: boolean | null;
}

interface Attempt {
    id: string;
    attempt: number;
    result: string;
    checks: {
        failures?: Array<{ code: string; message: string }>;
        quality?: { total: number; reason: string; dimensions?: Record<string, DimensionScore> };
        mislabelledStatements?: string[];
        unsupportedClaims?: string[];
    } | null;
    warnings: Warning[] | null;
    verifierModelId: string;
    createdAt: string;
}

interface Revision {
    id: string;
    revision: number;
    purpose: string | null;
    angle: string | null;
    caption: string;
    altOpenings: string[];
    altText: string | null;
    visualPath: string | null;
    visualSpec: unknown;
    contentLabel: string | null;
    topicTags: string[];
    createdByType: string;
    createdByLabel: string | null;
    createdAt: string;
    sources: { sources?: Array<{ id: string; httpsUrl: string; title: string; publisher: string }> } | null;
    generationSnapshot: {
        selection?: {
            chosenTrueIndex: number;
            selectionUnavailable: string | null;
            rationales: Array<{ index: number; oneLine: string }> | null;
            topOpeningRationale: string | null;
            losingCandidates: Array<{ index: number; caption: string }>;
        };
        candidateAngles?: string[];
        angleReuseReason?: string;
        researchSkippedForDeadline?: boolean;
    } | null;
    attempts: Attempt[];
}

interface PostEvent {
    id: string;
    kind: string;
    actorType: string;
    actorLabel: string | null;
    fromStatus: string | null;
    toStatus: string | null;
    note: string | null;
    createdAt: string;
}

interface PostPackage {
    post: {
        id: string;
        platform: string;
        format: string;
        status: string;
        category: string | null;
        factbookStale: boolean;
        verificationStale: boolean;
        currentRevisionId: string | null;
        approvedRevisionId: string | null;
        postedRevisionId: string | null;
        postedUrl: string | null;
        seed: { id: string; body: string; permissionRequired: boolean; permissionStatus: string } | null;
    };
    revisions: Revision[];
    events: PostEvent[];
    blockers: Array<{ code: string; message: string }>;
    availableActions: string[];
}

interface FactRevision {
    id: string;
    revision: number;
    text: string;
    evidenceSummary: string;
    riskTier: string;
    verifiedBy: string;
    createdAt: string;
}

interface Fact {
    id: string;
    claimId: string;
    category: string;
    status: string;
    version: number;
    currentRevision: FactRevision | null;
    revisions: FactRevision[];
}

interface BannedPhrase {
    id: string;
    phrase: string;
    explanation: string;
    severity: string;
    active: boolean;
    updatedAt: string;
}

interface Example {
    id: string;
    platform: string;
    kind: string;
    text: string;
    reason: string | null;
    active: boolean;
    updatedAt: string;
}

interface Asset {
    id: string;
    feature: string | null;
    state: string | null;
    orientation: string;
    storyTags: string[];
    blobPath: string | null;
    pixelWidth: number | null;
    pixelHeight: number | null;
    active: boolean;
    publishable: boolean;
    updatedAt: string;
}

/* ─── Presentation helpers ───────────────────────────────────────── */

const TABS = ["inbox", "review", "knowledge", "assets", "history"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
    inbox: "Inbox",
    review: "Review",
    knowledge: "Knowledge",
    assets: "Assets",
    history: "History",
};

const STATUS_TONE: Record<string, string> = {
    drafted: "var(--muted)",
    verification_failed: "var(--danger)",
    verified: "var(--info)",
    in_review: "var(--accent)",
    revision_requested: "var(--warn)",
    approved: "var(--success)",
    held: "var(--warn)",
    rejected: "var(--muted-soft)",
    posted: "var(--success-dark)",
    archived: "var(--muted-faint)",
};

const STATUS_LABELS: Record<string, string> = {
    drafted: "Draft — needs checking",
    verification_failed: "Held back — failed checks",
    verified: "Checked — ready to review",
    in_review: "In review",
    revision_requested: "Changes requested",
    approved: "Approved — ready to post",
    held: "On hold",
    rejected: "Rejected",
    posted: "Posted",
    archived: "Archived",
};

function Panel({ title, subtitle, children, actions }: {
    title: string;
    subtitle?: string;
    children: React.ReactNode;
    actions?: React.ReactNode;
}) {
    return (
        <section style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
                <div>
                    <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--ink-strong)", margin: 0 }}>{title}</h2>
                    {subtitle ? <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>{subtitle}</p> : null}
                </div>
                {actions}
            </div>
            {children}
        </section>
    );
}

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
    return (
        <span style={{
            display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11,
            fontWeight: 600, color: tone, border: `1px solid ${tone}`, whiteSpace: "nowrap",
        }}>
            {children}
        </span>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return <p style={{ color: "var(--muted-faint)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>{children}</p>;
}

function Failure({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div style={{ padding: 16, background: "var(--danger-bg)", border: "1px solid var(--danger)", borderRadius: 8 }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--danger-dark)" }}>{message}</p>
            <button onClick={onRetry} style={btn("ghost")} type="button">Try again</button>
        </div>
    );
}

function btn(kind: "primary" | "ghost" | "danger" = "ghost"): React.CSSProperties {
    const base: React.CSSProperties = {
        padding: "7px 12px", borderRadius: 6, fontSize: 13, fontWeight: 600,
        cursor: "pointer", border: "1px solid var(--line)", background: "var(--surface-raised)", color: "var(--ink)",
    };
    if (kind === "primary") return { ...base, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" };
    if (kind === "danger") return { ...base, color: "var(--danger-dark)", borderColor: "var(--danger)" };
    return base;
}

const input: React.CSSProperties = {
    width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--line)",
    fontSize: 13, background: "var(--surface-raised)", color: "var(--ink)",
};

/** Every failed request shows the server's plain sentence, never a status code. */
async function call<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error((body as { error?: string }).error ?? "Something went wrong. Try again.");
    }
    return body as T;
}

/* ─── Page ───────────────────────────────────────────────────────── */

export default function SocialStudioPage() {
    const [tab, setTab] = useState<Tab>("inbox");
    const [toast, setToast] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

    const notify = useCallback((tone: "ok" | "bad", text: string) => {
        setToast({ tone, text });
        setTimeout(() => setToast(null), 6_000);
    }, []);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <nav style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {TABS.map((name) => (
                    <button
                        key={name}
                        type="button"
                        onClick={() => setTab(name)}
                        aria-current={tab === name ? "page" : undefined}
                        style={{
                            ...btn(tab === name ? "primary" : "ghost"),
                            padding: "8px 14px",
                        }}
                    >
                        {TAB_LABELS[name]}
                    </button>
                ))}
            </nav>

            {toast ? (
                <div
                    role="status"
                    style={{
                        padding: "10px 14px", borderRadius: 8, fontSize: 13,
                        background: toast.tone === "ok" ? "var(--success-bg)" : "var(--danger-bg)",
                        color: toast.tone === "ok" ? "var(--success-dark)" : "var(--danger-dark)",
                        border: `1px solid ${toast.tone === "ok" ? "var(--success)" : "var(--danger)"}`,
                    }}
                >
                    {toast.text}
                </div>
            ) : null}

            {tab === "inbox" ? <InboxTab notify={notify} /> : null}
            {tab === "review" ? <ReviewTab notify={notify} /> : null}
            {tab === "knowledge" ? <KnowledgeTab notify={notify} /> : null}
            {tab === "assets" ? <AssetsTab notify={notify} /> : null}
            {tab === "history" ? <HistoryTab /> : null}
        </div>
    );
}

type Notify = (tone: "ok" | "bad", text: string) => void;

/* ─── Inbox ──────────────────────────────────────────────────────── */

function InboxTab({ notify }: { notify: Notify }) {
    const [seeds, setSeeds] = useState<Seed[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [draft, setDraft] = useState({ body: "", sourceType: "note", proofLevel: "observation", audience: "", confirmed: false });

    const load = useCallback(() => {
        call<{ seeds: Seed[] }>("/api/social/seeds")
            .then((data) => { setSeeds(data.seeds); setError(null); })
            .catch((e: Error) => setError(e.message));
    }, []);

    useEffect(load, [load]);

    async function create() {
        if (!draft.confirmed) {
            notify("bad", "Confirm the note contains no customer names, contact details or other private information.");
            return;
        }
        setBusy("create");
        try {
            await call("/api/social/seeds", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    body: draft.body,
                    sourceType: draft.sourceType,
                    proofLevel: draft.proofLevel,
                    audience: draft.audience || null,
                    sanitizationConfirmed: true,
                }),
            });
            setDraft({ body: "", sourceType: "note", proofLevel: "observation", audience: "", confirmed: false });
            notify("ok", "Idea saved.");
            load();
        } catch (e) {
            notify("bad", (e as Error).message);
        } finally {
            setBusy(null);
        }
    }

    async function generate(seed: Seed, platform: "facebook" | "linkedin") {
        const format = platform === "facebook" ? "graphic" : "text";
        setBusy(`${seed.id}:${platform}`);
        try {
            const result = await call<{ postId: string; verificationResult: string }>("/api/social/generate", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    seedId: seed.id,
                    platform,
                    format,
                    // One identifier per button press, reused if the network
                    // drops, so a lost response never creates a second post.
                    operationId: crypto.randomUUID(),
                }),
            });
            notify("ok", `Post created and checked (${result.verificationResult}). Open the Review tab.`);
            load();
        } catch (e) {
            notify("bad", (e as Error).message);
        } finally {
            setBusy(null);
        }
    }

    async function act(seed: Seed, body: Record<string, unknown>, message: string) {
        setBusy(seed.id);
        try {
            await call("/api/social/seeds", {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ id: seed.id, expectedUpdatedAt: seed.updatedAt, ...body }),
            });
            notify("ok", message);
            load();
        } catch (e) {
            notify("bad", (e as Error).message);
        } finally {
            setBusy(null);
        }
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Panel title="New idea" subtitle="A note, an objection you heard, something that happened on a job. Rough is fine.">
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <label style={{ fontSize: 13, fontWeight: 600 }}>
                        The note
                        <textarea
                            value={draft.body}
                            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                            rows={4}
                            maxLength={8_000}
                            style={{ ...input, marginTop: 6, fontFamily: "inherit", resize: "vertical" }}
                            placeholder="What happened, what someone said, or what you think."
                        />
                    </label>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <label style={{ fontSize: 13, fontWeight: 600, flex: "1 1 200px" }}>
                            Kind
                            <select value={draft.sourceType} onChange={(e) => setDraft({ ...draft, sourceType: e.target.value })} style={{ ...input, marginTop: 6 }}>
                                <option value="note">Note</option>
                                <option value="customer_story">Customer story</option>
                                <option value="objection">Objection</option>
                                <option value="product_update">Product update</option>
                                <option value="opinion">Opinion</option>
                                <option value="news">News</option>
                                <option value="question">Question</option>
                            </select>
                        </label>
                        <label style={{ fontSize: 13, fontWeight: 600, flex: "1 1 200px" }}>
                            How well supported
                            <select value={draft.proofLevel} onChange={(e) => setDraft({ ...draft, proofLevel: e.target.value })} style={{ ...input, marginTop: 6 }}>
                                <option value="observation">Something I noticed</option>
                                <option value="supported">Backed by something</option>
                                <option value="verified">Checked and verified</option>
                            </select>
                        </label>
                        <label style={{ fontSize: 13, fontWeight: 600, flex: "1 1 200px" }}>
                            Who it is for (optional)
                            <input value={draft.audience} onChange={(e) => setDraft({ ...draft, audience: e.target.value })} maxLength={500} style={{ ...input, marginTop: 6 }} />
                        </label>
                    </div>
                    {draft.sourceType === "customer_story" ? (
                        <p style={{ fontSize: 12, color: "var(--warn-dark)", margin: 0 }}>
                            A customer story always needs their permission before it can be approved. You can record that on the idea once it is saved.
                        </p>
                    ) : null}
                    <label style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <input type="checkbox" checked={draft.confirmed} onChange={(e) => setDraft({ ...draft, confirmed: e.target.checked })} />
                        <span>
                            I have checked this note contains no customer names, contact details, addresses, transcripts, account identifiers or passwords.
                        </span>
                    </label>
                    <div>
                        <button type="button" style={btn("primary")} disabled={!draft.body.trim() || busy === "create"} onClick={create}>
                            {busy === "create" ? "Saving…" : "Save idea"}
                        </button>
                    </div>
                </div>
            </Panel>

            <Panel title="Ideas" subtitle="Each idea can produce a Facebook post and a LinkedIn post, created separately, in any order.">
                {error ? <Failure message={error} onRetry={load} /> : null}
                {!error && seeds === null ? <Empty>Loading…</Empty> : null}
                {seeds?.length === 0 ? <Empty>No ideas yet. Add the first one above.</Empty> : null}

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {(seeds ?? []).map((seed) => (
                        <article key={seed.id} style={{ border: "1px solid var(--line-soft)", borderRadius: 8, padding: 14 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                                <p style={{ margin: 0, fontSize: 13, color: "var(--ink)", flex: "1 1 400px", whiteSpace: "pre-wrap" }}>{seed.body}</p>
                                <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                                    <Pill tone="var(--muted)">{seed.sourceType.replace(/_/g, " ")}</Pill>
                                    <Pill tone={seed.status === "rejected" ? "var(--muted-soft)" : "var(--info)"}>{seed.status.replace(/_/g, " ")}</Pill>
                                    {seed.postCount > 0 ? <Pill tone="var(--success)">{seed.postCount} post{seed.postCount === 1 ? "" : "s"}</Pill> : null}
                                </div>
                            </div>

                            {seed.infoRequest ? (
                                <p style={{ fontSize: 12, marginTop: 10, color: "var(--warn-dark)" }}>Needs more detail: {seed.infoRequest}</p>
                            ) : null}
                            {seed.permissionRequired ? (
                                <p style={{ fontSize: 12, marginTop: 10, color: seed.permissionStatus === "granted" ? "var(--success-dark)" : "var(--warn-dark)" }}>
                                    Customer permission: {seed.permissionStatus.replace(/_/g, " ")}
                                    {seed.anonymizedReviewedAt ? " · anonymised version reviewed" : ""}
                                </p>
                            ) : null}

                            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                                {seed.status !== "rejected" && seed.status !== "needs_info" ? (
                                    <>
                                        <button type="button" style={btn("primary")} disabled={busy !== null} onClick={() => generate(seed, "facebook")}>
                                            {busy === `${seed.id}:facebook` ? "Creating…" : "Create Facebook post"}
                                        </button>
                                        <button type="button" style={btn("primary")} disabled={busy !== null} onClick={() => generate(seed, "linkedin")}>
                                            {busy === `${seed.id}:linkedin` ? "Creating…" : "Create LinkedIn post"}
                                        </button>
                                    </>
                                ) : null}
                                {seed.permissionRequired && seed.permissionStatus !== "granted" ? (
                                    <button
                                        type="button"
                                        style={btn()}
                                        disabled={busy !== null}
                                        onClick={() => {
                                            const evidence = window.prompt("How was permission given? (kept internal, never sent to the AI)");
                                            if (evidence) void act(seed, { action: "grant_permission", permissionEvidence: evidence }, "Permission recorded.");
                                        }}
                                    >
                                        Record permission
                                    </button>
                                ) : null}
                                {seed.status !== "rejected" ? (
                                    <button
                                        type="button"
                                        style={btn("danger")}
                                        disabled={busy !== null}
                                        onClick={() => {
                                            const reason = window.prompt("Why is this idea being dropped?");
                                            if (reason) void act(seed, { action: "reject", reason }, "Idea rejected.");
                                        }}
                                    >
                                        Drop
                                    </button>
                                ) : null}
                            </div>
                        </article>
                    ))}
                </div>
            </Panel>
        </div>
    );
}

/* ─── Review ─────────────────────────────────────────────────────── */

function ReviewTab({ notify }: { notify: Notify }) {
    const [posts, setPosts] = useState<PostListItem[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<string>("");

    const load = useCallback(() => {
        const query = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
        call<{ posts: PostListItem[] }>(`/api/social/posts${query}`)
            .then((data) => { setPosts(data.posts); setError(null); })
            .catch((e: Error) => setError(e.message));
    }, [statusFilter]);

    useEffect(load, [load]);

    const lanes = useMemo(() => {
        const groups: Record<string, PostListItem[]> = {};
        for (const post of posts ?? []) {
            (groups[post.status] ??= []).push(post);
        }
        return groups;
    }, [posts]);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Panel
                title="Posts"
                subtitle="Nothing here is published. Everything waits for you."
                actions={
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...input, width: 220 }}>
                        <option value="">All statuses</option>
                        {Object.keys(STATUS_LABELS).map((status) => (
                            <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                        ))}
                    </select>
                }
            >
                {error ? <Failure message={error} onRetry={load} /> : null}
                {!error && posts === null ? <Empty>Loading…</Empty> : null}
                {posts?.length === 0 ? <Empty>No posts yet. Create one from an idea in the Inbox.</Empty> : null}

                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                    {Object.entries(lanes).map(([status, items]) => (
                        <div key={status}>
                            <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: STATUS_TONE[status] ?? "var(--muted)", margin: "0 0 8px" }}>
                                {STATUS_LABELS[status] ?? status} ({items.length})
                            </h3>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {items.map((post) => (
                                    <button
                                        key={post.id}
                                        type="button"
                                        onClick={() => setSelectedId(post.id)}
                                        style={{
                                            textAlign: "left", border: "1px solid var(--line-soft)", borderRadius: 8,
                                            padding: 12, background: selectedId === post.id ? "var(--accent-soft)" : "var(--surface-raised)",
                                            cursor: "pointer",
                                        }}
                                    >
                                        <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                                            <Pill tone="var(--ink)">{post.platform}</Pill>
                                            {post.currentRevision?.verificationResult ? (
                                                <Pill tone={post.currentRevision.verificationResult === "pass" ? "var(--success)" : post.currentRevision.verificationResult === "warn" ? "var(--warn)" : "var(--danger)"}>
                                                    {post.currentRevision.verificationResult}
                                                </Pill>
                                            ) : null}
                                            {post.currentRevision && post.currentRevision.warningCount > 0 ? (
                                                <Pill tone="var(--warn)">{post.currentRevision.warningCount} to review</Pill>
                                            ) : null}
                                            {post.factbookStale ? <Pill tone="var(--danger)">fact changed</Pill> : null}
                                        </div>
                                        <p style={{ margin: 0, fontSize: 13, color: "var(--ink)" }}>
                                            {post.currentRevision?.caption ?? "No content yet"}
                                        </p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </Panel>

            {selectedId ? <PostDetail postId={selectedId} notify={notify} onChanged={load} /> : null}
        </div>
    );
}

function PostDetail({ postId, notify, onChanged }: { postId: string; notify: Notify; onChanged: () => void }) {
    const [data, setData] = useState<PostPackage | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState(false);
    const [caption, setCaption] = useState("");
    const [showCandidates, setShowCandidates] = useState(false);

    const load = useCallback(() => {
        call<PostPackage>(`/api/social/posts/${postId}`)
            .then((pkg) => {
                setData(pkg);
                setCaption(pkg.revisions[0]?.caption ?? "");
                setError(null);
            })
            .catch((e: Error) => setError(e.message));
    }, [postId]);

    useEffect(load, [load]);

    if (error) return <Panel title="Post"><Failure message={error} onRetry={load} /></Panel>;
    if (!data) return <Panel title="Post"><Empty>Loading…</Empty></Panel>;

    const current = data.revisions.find((revision) => revision.id === data.post.currentRevisionId) ?? data.revisions[0];
    const attempt = current?.attempts[0] ?? null;
    const warnings = attempt?.warnings ?? [];
    const failures = attempt?.checks?.failures ?? [];
    const overridden = new Set(
        data.events
            .filter((event) => event.kind === "warning_overridden")
            .map((event) => (event as unknown as { data?: { warningCode?: string } }).data?.warningCode)
            .filter(Boolean) as string[],
    );

    async function act(body: Record<string, unknown>, message: string) {
        if (!data) return;
        setBusy(true);
        try {
            await call(`/api/social/posts/${postId}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    expectedCurrentRevisionId: data.post.currentRevisionId,
                    expectedStatus: data.post.status,
                    ...body,
                }),
            });
            notify("ok", message);
            setEditing(false);
            load();
            onChanged();
        } catch (e) {
            notify("bad", (e as Error).message);
        } finally {
            setBusy(false);
        }
    }

    const canApprove = data.post.status === "in_review" && data.blockers.length === 0;

    return (
        <Panel
            title={`${data.post.platform} post`}
            subtitle={STATUS_LABELS[data.post.status] ?? data.post.status}
            actions={<Pill tone={STATUS_TONE[data.post.status] ?? "var(--muted)"}>{data.post.status.replace(/_/g, " ")}</Pill>}
        >
            {data.blockers.length > 0 ? (
                <div style={{ padding: 12, background: "var(--danger-bg)", border: "1px solid var(--danger)", borderRadius: 8, marginBottom: 16 }}>
                    <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 13, color: "var(--danger-dark)" }}>
                        This post cannot be approved yet:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--danger-dark)" }}>
                        {data.blockers.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}
                    </ul>
                </div>
            ) : null}

            {failures.length > 0 ? (
                <div style={{ padding: 12, background: "var(--danger-bg)", borderRadius: 8, marginBottom: 16 }}>
                    <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 13, color: "var(--danger-dark)" }}>Failed checks</p>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--danger-dark)" }}>
                        {failures.map((failure, index) => <li key={`${failure.code}-${index}`}>{failure.message}</li>)}
                    </ul>
                </div>
            ) : null}

            {/* The caption. Editing re-checks it; it never re-writes it. */}
            <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", margin: "0 0 8px" }}>Caption</h3>
                {editing ? (
                    <>
                        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={10} style={{ ...input, fontFamily: "inherit", resize: "vertical" }} />
                        <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 0" }}>
                            Saving re-runs the checks on your words. The AI never rewrites what you type.
                        </p>
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <button type="button" style={btn("primary")} disabled={busy} onClick={() => act({ action: "edit", edit: { caption } }, "Saved and re-checked.")}>
                                {busy ? "Checking…" : "Save and re-check"}
                            </button>
                            <button type="button" style={btn()} disabled={busy} onClick={() => { setEditing(false); setCaption(current?.caption ?? ""); }}>Cancel</button>
                        </div>
                    </>
                ) : (
                    <p style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.6, margin: 0, color: "var(--ink)" }}>{current?.caption}</p>
                )}
            </div>

            {current?.visualPath ? (
                <div style={{ marginBottom: 16 }}>
                    <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", margin: "0 0 8px" }}>Graphic</h3>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={`/api/social/media/${current.visualPath}`}
                        alt={current.altText ?? "Post graphic"}
                        style={{
                            maxWidth: 320, borderRadius: 8, border: "1px solid var(--line)",
                            // Anything not yet approved is watermarked, so a
                            // screenshot of a draft cannot be mistaken for the
                            // finished thing.
                            opacity: data.post.status === "approved" || data.post.status === "posted" ? 1 : 0.55,
                        }}
                    />
                    {data.post.status !== "approved" && data.post.status !== "posted" ? (
                        <p style={{ fontSize: 12, fontWeight: 700, color: "var(--danger-dark)", marginTop: 6 }}>DRAFT — NOT APPROVED</p>
                    ) : null}
                    {current.altText ? <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Alt text: {current.altText}</p> : null}
                </div>
            ) : null}

            {/* Ranked openings, best first, with the reason for the top one. */}
            {current && current.altOpenings.length > 0 ? (
                <div style={{ marginBottom: 16 }}>
                    <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", margin: "0 0 8px" }}>
                        Other openings, best first
                    </h3>
                    <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink)" }}>
                        {current.altOpenings.map((opening, index) => (
                            <li key={opening} style={{ marginBottom: 4 }}>
                                {opening}
                                {index === 0 ? <strong style={{ color: "var(--success-dark)" }}> — recommended</strong> : null}
                            </li>
                        ))}
                    </ol>
                    {current.generationSnapshot?.selection?.topOpeningRationale ? (
                        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                            Why: {current.generationSnapshot.selection.topOpeningRationale}
                        </p>
                    ) : null}
                </div>
            ) : null}

            {/* Per-dimension scores with the quote that justified each. */}
            {attempt?.checks?.quality?.dimensions ? (
                <div style={{ marginBottom: 16 }}>
                    <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", margin: "0 0 8px" }}>
                        How it scored ({attempt.checks.quality.total} of 20)
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {Object.entries(attempt.checks.quality.dimensions).map(([name, score]) => (
                            <div key={name} style={{ fontSize: 13 }}>
                                <strong style={{ textTransform: "capitalize" }}>{name.replace(/([A-Z])/g, " $1")}</strong>: {score.score}/4
                                {score.supportingQuote ? (
                                    <span style={{ color: "var(--muted)" }}> — &ldquo;{score.supportingQuote}&rdquo;</span>
                                ) : (
                                    <span style={{ color: "var(--muted-faint)" }}> — no supporting text</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {/* Warnings, each needing an explicit, reasoned acceptance. */}
            {warnings.length > 0 ? (
                <div style={{ marginBottom: 16 }}>
                    <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--warn-dark)", margin: "0 0 8px" }}>
                        Things to look at ({warnings.length})
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {warnings.map((warning) => (
                            <div key={warning.code} style={{ padding: 10, background: "var(--warn-bg)", borderRadius: 6, fontSize: 13 }}>
                                <p style={{ margin: 0, color: "var(--warn-dark)" }}>{warning.message}</p>
                                {overridden.has(warning.code) ? (
                                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--success-dark)" }}>Accepted by you.</p>
                                ) : (
                                    <button
                                        type="button"
                                        style={{ ...btn(), marginTop: 6 }}
                                        disabled={busy}
                                        onClick={() => {
                                            const note = window.prompt("Why is this acceptable?");
                                            if (note) void act({ action: "override_warning", warningCode: warning.code, note }, "Noted.");
                                        }}
                                    >
                                        Accept this
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {/* Why this version — the losing drafts and the selection reasoning. */}
            {current?.generationSnapshot?.selection ? (
                <div style={{ marginBottom: 16 }}>
                    <button type="button" style={btn()} onClick={() => setShowCandidates((value) => !value)}>
                        {showCandidates ? "Hide" : "Show"} why this version
                    </button>
                    {showCandidates ? (
                        <div style={{ marginTop: 10, fontSize: 13 }}>
                            {current.generationSnapshot.selection.selectionUnavailable ? (
                                <p style={{ color: "var(--muted)" }}>
                                    The editor step did not run ({current.generationSnapshot.selection.selectionUnavailable.replace(/_/g, " ")}), so the first valid draft was used.
                                </p>
                            ) : null}
                            {(current.generationSnapshot.selection.rationales ?? []).map((rationale) => (
                                <p key={rationale.index} style={{ margin: "4px 0", color: "var(--muted)" }}>
                                    Draft {rationale.index + 1}: {rationale.oneLine}
                                </p>
                            ))}
                            {current.generationSnapshot.selection.losingCandidates.map((candidate) => (
                                <div key={candidate.index} style={{ marginTop: 10, padding: 10, background: "var(--surface)", borderRadius: 6 }}>
                                    <p style={{ margin: 0, fontSize: 12, color: "var(--muted-soft)" }}>Not chosen</p>
                                    <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{candidate.caption}</p>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}

            {/* Actions. */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--line-soft)", paddingTop: 16 }}>
                {data.availableActions.includes("edit") && !editing ? (
                    <button type="button" style={btn()} disabled={busy} onClick={() => setEditing(true)}>Edit</button>
                ) : null}
                {data.availableActions.includes("retry_verification") ? (
                    <button type="button" style={btn()} disabled={busy} onClick={() => act({ action: "retry_verification" }, "Checked again.")}>Check again</button>
                ) : null}
                {data.availableActions.includes("submit") ? (
                    <button type="button" style={btn("primary")} disabled={busy} onClick={() => act({ action: "submit" }, "Sent for review.")}>Send to review</button>
                ) : null}
                {data.availableActions.includes("approve") ? (
                    <button type="button" style={btn("primary")} disabled={busy || !canApprove} onClick={() => act({ action: "approve" }, "Approved.")}>
                        Approve
                    </button>
                ) : null}
                {data.availableActions.includes("hold") ? (
                    <button type="button" style={btn()} disabled={busy} onClick={() => act({ action: "hold" }, "Put on hold.")}>Hold</button>
                ) : null}
                {data.availableActions.includes("unhold") ? (
                    <button type="button" style={btn()} disabled={busy} onClick={() => act({ action: "unhold" }, "Back in review.")}>Take off hold</button>
                ) : null}
                {data.availableActions.includes("request_revision") ? (
                    <button type="button" style={btn()} disabled={busy} onClick={() => {
                        const note = window.prompt("What needs changing?");
                        if (note) void act({ action: "request_revision", note }, "Changes requested.");
                    }}>Request changes</button>
                ) : null}
                {data.availableActions.includes("reject") ? (
                    <button type="button" style={btn("danger")} disabled={busy} onClick={() => {
                        const note = window.prompt("Why is this being rejected?");
                        if (note) void act({ action: "reject", note }, "Rejected.");
                    }}>Reject</button>
                ) : null}
                {data.post.status === "approved" ? (
                    <button type="button" style={btn("primary")} disabled={busy} onClick={() => {
                        const url = window.prompt("Paste the link to the published post (optional)") ?? "";
                        void act({ action: "mark_posted", postedUrl: url || null }, "Marked as posted.");
                    }}>Mark as posted</button>
                ) : null}
                {(data.post.status === "approved" || data.post.status === "posted") && data.post.currentRevisionId ? (
                    <button
                        type="button"
                        style={btn()}
                        disabled={busy}
                        onClick={async () => {
                            try {
                                const result = await call<{ caption: string }>(`/api/social/posts/${postId}/exports`, {
                                    method: "POST",
                                    headers: { "content-type": "application/json" },
                                    body: JSON.stringify({ kind: "copy", expectedRevisionId: data.post.currentRevisionId }),
                                });
                                await navigator.clipboard.writeText(result.caption);
                                notify("ok", "Caption copied.");
                            } catch (e) {
                                notify("bad", (e as Error).message);
                            }
                        }}
                    >
                        Copy caption
                    </button>
                ) : null}
            </div>

            {/* Every decision, in order. */}
            <details style={{ marginTop: 16 }}>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>History of this post ({data.events.length})</summary>
                <ul style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, paddingLeft: 18 }}>
                    {data.events.map((event) => (
                        <li key={event.id} style={{ marginBottom: 4 }}>
                            {new Date(event.createdAt).toLocaleString()} — {event.kind.replace(/_/g, " ")}
                            {event.actorLabel ? ` by ${event.actorLabel}` : ""}
                            {event.note ? `: ${event.note}` : ""}
                        </li>
                    ))}
                </ul>
            </details>
        </Panel>
    );
}

/* ─── Knowledge ──────────────────────────────────────────────────── */

function KnowledgeTab({ notify }: { notify: Notify }) {
    const [facts, setFacts] = useState<Fact[] | null>(null);
    const [phrases, setPhrases] = useState<BannedPhrase[] | null>(null);
    const [examples, setExamples] = useState<Example[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(() => {
        Promise.all([
            call<{ facts: Fact[] }>("/api/social/facts"),
            call<{ phrases: BannedPhrase[] }>("/api/social/banned"),
            call<{ examples: Example[] }>("/api/social/examples"),
        ])
            .then(([f, b, e]) => {
                setFacts(f.facts);
                setPhrases(b.phrases);
                setExamples(e.examples);
                setError(null);
            })
            .catch((e: Error) => setError(e.message));
    }, []);

    useEffect(load, [load]);

    if (error) return <Panel title="Knowledge"><Failure message={error} onRetry={load} /></Panel>;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Panel
                title="Fact Book"
                subtitle="The only place the agent may take a statement about the product, pricing, limits or results. Editing a fact creates a new version and flags every post that used the old one."
            >
                {facts === null ? <Empty>Loading…</Empty> : null}
                {facts?.length === 0 ? <Empty>No facts yet. Until this has entries, the agent cannot say anything specific about ScaleYourJunk.</Empty> : null}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {(facts ?? []).map((fact) => (
                        <article key={fact.id} style={{ border: "1px solid var(--line-soft)", borderRadius: 8, padding: 12 }}>
                            <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                                <Pill tone="var(--muted)">{fact.category}</Pill>
                                <Pill tone={fact.status === "active" ? "var(--success)" : "var(--muted-soft)"}>{fact.status}</Pill>
                                {fact.currentRevision?.riskTier === "high" ? <Pill tone="var(--danger)">high risk</Pill> : null}
                                <Pill tone="var(--info)">version {fact.version}</Pill>
                            </div>
                            <p style={{ margin: 0, fontSize: 13 }}>{fact.currentRevision?.text}</p>
                            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)" }}>{fact.currentRevision?.evidenceSummary}</p>
                            {fact.revisions.length > 1 ? (
                                <details style={{ marginTop: 8 }}>
                                    <summary style={{ cursor: "pointer", fontSize: 12 }}>Earlier wordings ({fact.revisions.length - 1})</summary>
                                    <ul style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, paddingLeft: 18 }}>
                                        {fact.revisions.slice(1).map((revision) => (
                                            <li key={revision.id}>v{revision.revision}: {revision.text}</li>
                                        ))}
                                    </ul>
                                </details>
                            ) : null}
                        </article>
                    ))}
                </div>
            </Panel>

            <Panel title="Phrases to avoid" subtitle="Plain phrases, matched exactly. Blocking phrases stop a post; warning phrases only flag it.">
                {phrases === null ? <Empty>Loading…</Empty> : null}
                {phrases?.length === 0 ? <Empty>No phrases yet.</Empty> : null}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(phrases ?? []).map((phrase) => (
                        <div key={phrase.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: 10, border: "1px solid var(--line-soft)", borderRadius: 6, flexWrap: "wrap" }}>
                            <div>
                                <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>&ldquo;{phrase.phrase}&rdquo;</p>
                                <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>{phrase.explanation}</p>
                            </div>
                            <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                                <Pill tone={phrase.severity === "block" ? "var(--danger)" : "var(--warn)"}>{phrase.severity}</Pill>
                                <button
                                    type="button"
                                    style={btn()}
                                    onClick={async () => {
                                        try {
                                            await call("/api/social/banned", {
                                                method: "PATCH",
                                                headers: { "content-type": "application/json" },
                                                body: JSON.stringify({ id: phrase.id, expectedUpdatedAt: phrase.updatedAt, active: !phrase.active }),
                                            });
                                            notify("ok", phrase.active ? "Phrase switched off." : "Phrase switched on.");
                                            load();
                                        } catch (e) {
                                            notify("bad", (e as Error).message);
                                        }
                                    }}
                                >
                                    {phrase.active ? "Switch off" : "Switch on"}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </Panel>

            <Panel title="Examples" subtitle="Good examples set the standard the agent writes towards. Bad examples are what stop it writing generic filler.">
                {examples === null ? <Empty>Loading…</Empty> : null}
                {examples?.length === 0 ? <Empty>No examples yet.</Empty> : null}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(examples ?? []).map((example) => (
                        <div key={example.id} style={{ padding: 10, border: "1px solid var(--line-soft)", borderRadius: 6 }}>
                            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                                <Pill tone="var(--ink)">{example.platform}</Pill>
                                <Pill tone={example.kind === "exemplar" ? "var(--success)" : "var(--danger)"}>
                                    {example.kind === "exemplar" ? "good" : "bad"}
                                </Pill>
                            </div>
                            <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>{example.text}</p>
                            {example.reason ? <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)" }}>Why: {example.reason}</p> : null}
                        </div>
                    ))}
                </div>
            </Panel>
        </div>
    );
}

/* ─── Assets ─────────────────────────────────────────────────────── */

function AssetsTab({ notify }: { notify: Notify }) {
    const [assets, setAssets] = useState<Asset[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        call<{ assets: Asset[] }>("/api/social/assets")
            .then((data) => { setAssets(data.assets); setError(null); })
            .catch((e: Error) => setError(e.message));
    }, []);

    useEffect(load, [load]);

    async function upload(form: HTMLFormElement) {
        setBusy(true);
        try {
            const body = new FormData(form);
            const response = await fetch("/api/social/assets", { method: "POST", body });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error((result as { error?: string }).error ?? "Upload failed.");
            notify("ok", "Screenshot added.");
            form.reset();
            load();
        } catch (e) {
            notify("bad", (e as Error).message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Panel title="Add a screenshot" subtitle="Used inside post graphics. Never shown to a customer, and never sent to the AI as an image.">
                <form
                    onSubmit={(event) => { event.preventDefault(); void upload(event.currentTarget); }}
                    style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                    <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required style={{ fontSize: 13 }} />
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <label style={{ fontSize: 13, fontWeight: 600, flex: "1 1 200px" }}>
                            Shape
                            <select name="orientation" style={{ ...input, marginTop: 6 }} required>
                                <option value="desktop">Desktop</option>
                                <option value="desktop-lifestyle">Desktop in context</option>
                                <option value="mobile-portrait">Phone</option>
                                <option value="tablet-landscape">Tablet</option>
                            </select>
                        </label>
                        <label style={{ fontSize: 13, fontWeight: 600, flex: "1 1 200px" }}>
                            What it shows
                            <input name="feature" maxLength={120} style={{ ...input, marginTop: 6 }} placeholder="dispatch board" />
                        </label>
                        <label style={{ fontSize: 13, fontWeight: 600, flex: "1 1 200px" }}>
                            Tags (comma separated)
                            <input name="storyTags" style={{ ...input, marginTop: 6 }} placeholder="automation, time saved" />
                        </label>
                    </div>
                    <label style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <input type="checkbox" name="sanitizationConfirmed" value="true" required />
                        <span>I have checked this screenshot shows no customer names, addresses, phone numbers, email addresses or other private information.</span>
                    </label>
                    <div>
                        <button type="submit" style={btn("primary")} disabled={busy}>{busy ? "Uploading…" : "Add screenshot"}</button>
                    </div>
                </form>
            </Panel>

            <Panel title="Screenshots">
                {error ? <Failure message={error} onRetry={load} /> : null}
                {!error && assets === null ? <Empty>Loading…</Empty> : null}
                {assets?.length === 0 ? <Empty>No screenshots yet.</Empty> : null}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
                    {(assets ?? []).map((asset) => (
                        <div key={asset.id} style={{ border: "1px solid var(--line-soft)", borderRadius: 8, padding: 10 }}>
                            {asset.blobPath ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={`/api/social/media/${asset.blobPath}`} alt={asset.feature ?? "Screenshot"} style={{ width: "100%", borderRadius: 6 }} />
                            ) : (
                                <p style={{ fontSize: 12, color: "var(--danger-dark)" }}>No image stored — this one cannot be used in a post.</p>
                            )}
                            <p style={{ margin: "8px 0 0", fontSize: 13, fontWeight: 600 }}>{asset.feature ?? "Untitled"}</p>
                            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
                                {asset.pixelWidth} × {asset.pixelHeight} · {asset.orientation}
                            </p>
                        </div>
                    ))}
                </div>
            </Panel>
        </div>
    );
}

/* ─── History ────────────────────────────────────────────────────── */

function HistoryTab() {
    const [posts, setPosts] = useState<PostListItem[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(() => {
        call<{ posts: PostListItem[] }>("/api/social/posts?status=posted&limit=100")
            .then((data) => { setPosts(data.posts); setError(null); })
            .catch((e: Error) => setError(e.message));
    }, []);

    useEffect(load, [load]);

    return (
        <Panel title="Posted" subtitle="What has actually gone out. This is also the memory the repetition checks compare new posts against.">
            {error ? <Failure message={error} onRetry={load} /> : null}
            {!error && posts === null ? <Empty>Loading…</Empty> : null}
            {posts?.length === 0 ? <Empty>Nothing posted yet.</Empty> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(posts ?? []).map((post) => (
                    <article key={post.id} style={{ border: "1px solid var(--line-soft)", borderRadius: 8, padding: 12 }}>
                        <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                            <Pill tone="var(--ink)">{post.platform}</Pill>
                            <span style={{ fontSize: 12, color: "var(--muted)" }}>
                                {post.postedAt ? new Date(post.postedAt).toLocaleDateString() : ""}
                            </span>
                            {post.currentRevision?.topicTags.map((tag) => <Pill key={tag} tone="var(--muted-soft)">{tag}</Pill>)}
                        </div>
                        <p style={{ margin: 0, fontSize: 13 }}>{post.currentRevision?.caption}</p>
                        {post.postedUrl ? (
                            <a href={post.postedUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--accent)" }}>
                                View the published post
                            </a>
                        ) : null}
                    </article>
                ))}
            </div>
        </Panel>
    );
}
