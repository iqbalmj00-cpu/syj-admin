import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isolatedModule, nextResponseMock } from "./helpers/isolated-module.ts";

const env = { INTEGRATION_TOKEN_ENCRYPTION_KEY: "synthetic-shared-key", GOOGLE_CALENDAR_CLIENT_ID: "synthetic-id", GOOGLE_CALENDAR_CLIENT_SECRET: "synthetic-secret" };
const codec = (config = env) => isolatedModule("src/lib/integration-token-encryption.ts", {}, config);
// Construct the shared website format independently of Admin's codec.
function sharedEnvelope(token: string) {
    const iv = Buffer.alloc(12, 7);
    const cipher = crypto.createCipheriv("aes-256-gcm", crypto.createHash("sha256").update(env.INTEGRATION_TOKEN_ENCRYPTION_KEY).digest(), iv);
    const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return `enc:v1:${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

test("shared token format, authenticated encryption and legacy reads are compatible", () => {
    const c = codec();
    assert.equal(c.decryptIntegrationTokenCompat(sharedEnvelope("access")), "access");
    assert.equal(c.decryptIntegrationTokenCompat("legacy"), "legacy");
    assert.equal(c.decryptIntegrationTokenCompat(null), null);
    const stored = c.encryptIntegrationToken("new-token");
    assert.match(stored, /^enc:v1:/);
    const [iv, tag, data] = stored.slice(7).split(".").map((p: string) => Buffer.from(p, "base64url"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", crypto.createHash("sha256").update(env.INTEGRATION_TOKEN_ENCRYPTION_KEY).digest(), iv);
    decipher.setAuthTag(tag);
    assert.equal(Buffer.concat([decipher.update(data), decipher.final()]).toString(), "new-token");
    for (const bad of ["enc:v2:secret", "enc:v1:a.b.c", stored + ".extra", sharedEnvelope("access").slice(0, -2) + "ZZ"]) assert.throws(() => c.decryptIntegrationTokenCompat(bad));
    const missing = isolatedModule("src/lib/integration-token-encryption.ts", {});
    assert.equal(missing.decryptIntegrationTokenCompat("legacy"), "legacy");
    assert.throws(() => missing.encryptIntegrationToken("token"));
    assert.throws(() => missing.decryptIntegrationTokenCompat(stored));
});

function integrationStore(initial: Record<string, any>) {
    let row = { ...initial };
    const writes: any[] = [];
    const same = (left: any, right: any) => left instanceof Date && right instanceof Date ? left.getTime() === right.getTime() : left === right;
    const replace = (data: Record<string, any>) => {
        row = { ...row, ...data, updatedAt: new Date(row.updatedAt.getTime() + 1) };
    };
    const update = async ({ where, data }: any) => {
        if (!Object.entries(where).every(([key, value]) => same(row[key], value))) return { count: 0 };
        writes.push(data);
        replace(data);
        return { count: 1 };
    };
    return {
        writes, replace, row: () => ({ ...row }),
        delegate: { findUnique: async () => ({ ...row }), updateMany: update,
            update: async (args: any) => { await update(args); return { ...row }; } },
    };
}

function authFixture({ expired = false, encrypted = true, missingKey = false, badResponse = false, denied = false, rotate = true } = {}) {
    const config = missingKey ? { ...env, INTEGRATION_TOKEN_ENCRYPTION_KEY: "" } : env;
    let requests = 0;
    const store = integrationStore({ id: "google", status: "connected", accessToken: encrypted ? sharedEnvelope("access") : "access", refreshToken: encrypted ? sharedEnvelope("refresh") : "refresh", expiresAt: new Date(Date.now() + (expired ? -1 : 3600000)), updatedAt: new Date(0) });
    const auth = isolatedModule("src/lib/demo-scheduler-auth.ts", {
        "@/lib/prisma": { prisma: { adminIntegration: store.delegate } },
        "@/lib/integration-token-encryption": codec(config),
    }, config, { fetch: async (_url, init) => {
        requests++;
        assert.equal(new URLSearchParams(String(init?.body)).get("refresh_token"), "refresh");
        return Response.json(badResponse ? {} : { access_token: "renewed", ...(rotate ? { refresh_token: "rotated" } : {}), expires_in: 3600 }, { status: denied ? 401 : 200 });
    } });
    return { auth, updates: store.writes, requests: () => requests };
}

for (const encrypted of [false, true]) {
    test(`Google access uses ${encrypted ? "encrypted" : "legacy"} valid token without writes or refresh`, async () => {
        const f = authFixture({ encrypted });
        assert.equal(await f.auth.getAdminAccessToken(), "access");
        assert.equal(f.requests(), 0);
        assert.equal(f.updates.length, 0);
    });
    test(`Google refresh encrypts new writes from ${encrypted ? "encrypted" : "legacy"} storage`, async () => {
        const f = authFixture({ encrypted, expired: true });
        assert.equal(await f.auth.getAdminAccessToken(), "renewed");
        assert.equal(f.updates.length, 1);
        assert.equal(codec().decryptIntegrationTokenCompat(f.updates[0].accessToken), "renewed");
        assert.equal(codec().decryptIntegrationTokenCompat(f.updates[0].refreshToken), "rotated");
    });
    test(`Google refresh without rotation preserves and encrypts the ${encrypted ? "encrypted" : "legacy"} credential`, async () => {
        const f = authFixture({ encrypted, expired: true, rotate: false });
        assert.equal(await f.auth.getAdminAccessToken(), "renewed");
        assert.match(f.updates[0].refreshToken, /^enc:v1:/);
        assert.equal(codec().decryptIntegrationTokenCompat(f.updates[0].refreshToken), "refresh");
    });
}

test("missing key never submits encrypted tokens or downgrades refreshed storage", async () => {
    for (const encrypted of [false, true]) {
        const f = authFixture({ encrypted, expired: true, missingKey: true });
        assert.equal(await f.auth.getAdminAccessToken(), null);
        assert.equal(f.requests(), 0);
        assert.equal(f.updates.length, 0);
    }
});

test("Google refresh failures return no token and never overwrite tokens with malformed values", async () => {
    const bad = authFixture({ expired: true, badResponse: true });
    assert.equal(await bad.auth.getAdminAccessToken(), null);
    assert.equal(bad.updates.length, 0);
    const denied = authFixture({ expired: true, denied: true });
    assert.equal(await denied.auth.getAdminAccessToken(), null);
    assert.equal(denied.updates[0].status, "error");
    assert.equal(Object.keys(denied.updates[0]).length, 1);
});

function concurrentAuthFixture(requestCount: number) {
    const store = integrationStore({ id: "google", status: "connected", accessToken: sharedEnvelope("access"), refreshToken: sharedEnvelope("refresh"), expiresAt: new Date(0), updatedAt: new Date(0) });
    const responses: Array<(response: Response) => void> = [];
    let ready!: () => void;
    const requested = new Promise<void>(resolve => { ready = resolve; });
    const auth = isolatedModule("src/lib/demo-scheduler-auth.ts", {
        "@/lib/prisma": { prisma: { adminIntegration: store.delegate } },
        "@/lib/integration-token-encryption": codec(),
    }, env, { fetch: async (_url, init) => {
        assert.equal(new URLSearchParams(String(init?.body)).get("refresh_token"), "refresh");
        return new Promise<Response>(resolve => {
            responses.push(resolve);
            if (responses.length === requestCount) ready();
        });
    } });
    return { auth, store, responses, requested };
}

test("a slower refresh cannot overwrite a rotated token or return its stale result", async () => {
    const f = concurrentAuthFixture(2);
    const first = f.auth.getAdminAccessToken();
    const second = f.auth.getAdminAccessToken();
    await f.requested;
    f.responses[0](Response.json({ access_token: "winner", refresh_token: "rotated", expires_in: 3600 }));
    assert.equal(await first, "winner");
    f.responses[1](Response.json({ access_token: "stale", expires_in: 3600 }));
    assert.equal(await second, null);
    assert.equal(f.store.writes.length, 1);
    assert.equal(codec().decryptIntegrationTokenCompat(f.store.row().refreshToken), "rotated");
    assert.equal(codec().decryptIntegrationTokenCompat(f.store.row().accessToken), "winner");
});

for (const outcome of ["success", "denied"]) {
    for (const transition of ["reconnect", "disconnect", "same-token-reconnect"]) {
        test(`a stale ${outcome} response cannot undo ${transition}`, async () => {
            const f = concurrentAuthFixture(1);
            const refresh = f.auth.getAdminAccessToken();
            await f.requested;
            f.store.replace(transition === "reconnect" ? {
                accessToken: sharedEnvelope("reconnected-access"), refreshToken: sharedEnvelope("reconnected-refresh"),
                expiresAt: new Date(Date.now() + 3600000),
            } : transition === "disconnect" ? { status: "disconnected" } : {});
            const changed = f.store.row();
            f.responses[0](Response.json(outcome === "success" ? { access_token: "stale", refresh_token: "stale-rotation", expires_in: 3600 } : { error: "invalid_grant" }, { status: outcome === "success" ? 200 : 401 }));
            assert.equal(await refresh, null);
            assert.deepEqual(f.store.row(), changed);
            assert.equal(f.store.writes.length, 0);
        });
    }
}

test("a failed conditional token write never returns an unpersisted token", async () => {
    const f = concurrentAuthFixture(1);
    f.store.delegate.updateMany = async () => { throw new Error("Synthetic persistence failure"); };
    const refresh = f.auth.getAdminAccessToken();
    await f.requested;
    f.responses[0](Response.json({ access_token: "unpersisted", expires_in: 3600 }));
    assert.equal(await refresh, null);
    assert.equal(f.store.writes.length, 0);
});

test("OAuth callback encrypts both create/update and preserves an existing refresh token on re-auth", async () => {
    for (const refresh_token of ["refresh", undefined]) {
        const updates: any[] = [];
        const route = isolatedModule("src/app/api/demo-scheduler/callback/route.ts", {
            "next/server": { NextResponse: { redirect: (url: string) => Response.redirect(url) } },
            "@/lib/prisma": { prisma: { adminIntegration: { upsert: async (args: any) => { updates.push(args); } } } },
            "@/lib/integration-token-encryption": codec(),
        }, env, { fetch: async (url) => Response.json(String(url).includes("userinfo") ? { email: "mock@example.com" } : { access_token: "access", refresh_token, expires_in: 3600 }) });
        assert.equal((await route.GET({ nextUrl: new URL("https://isolated.invalid/?code=mock&state=mock") })).status, 302);
        assert.equal(codec().decryptIntegrationTokenCompat(updates[0].create.accessToken), "access");
        assert.equal(codec().decryptIntegrationTokenCompat(updates[0].update.accessToken), "access");
        if (refresh_token) assert.equal(codec().decryptIntegrationTokenCompat(updates[0].update.refreshToken), "refresh");
        else assert.equal("refreshToken" in updates[0].update, false);
    }
});

const storageUrl = "https://synthetic.private.blob.vercel-storage.com/reports/mock.pdf";
const pdf = Buffer.from("%PDF-1.7\nmock\n%%EOF");
const streamResult = (bytes = pdf, size = bytes.length) => ({ statusCode: 200, stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), blob: { contentType: "application/pdf", size } });

function deliveryFixture(get: (...args: any[]) => any = async () => streamResult()) {
    return isolatedModule("src/lib/research-report-delivery.ts", { "@vercel/blob": { get } }, { NEXTAUTH_URL: "https://admin.example.com" });
}

test("PDF delivery validates storage locations and full readable PDF before publication", async () => {
    let reads = 0;
    const delivery = deliveryFixture(async (url, options) => { reads++; assert.equal(url, storageUrl); assert.equal(options.access, "private"); assert.equal(options.useCache, false); return streamResult(); });
    await delivery.verifyReportPdfDeliverable(storageUrl);
    assert.equal(delivery.publicReportDownloadUrl("report-1"), "https://admin.example.com/api/reports/report-1/download");
    for (const bad of [null, "https://attacker.invalid/reports/a.pdf", "https://synthetic.private.blob.vercel-storage.com/secrets/a.pdf", storageUrl + "?token=secret", "http://localhost/reports/a.pdf"]) await assert.rejects(delivery.readPrivateReportPdf(bad));
    assert.equal(reads, 1);
    await assert.rejects(deliveryFixture(async () => streamResult(Buffer.from("html"))).verifyReportPdfDeliverable(storageUrl));
    await assert.rejects(deliveryFixture(async () => streamResult(pdf, 500)).verifyReportPdfDeliverable(storageUrl));
    await assert.rejects(deliveryFixture(async () => null).verifyReportPdfDeliverable(storageUrl));
});

for (const status of [null, "draft", "approved", "archived", "published"]) {
    test(`anonymous PDF download enforces ${status || "missing"} publication state`, async () => {
        let reads = 0;
        const route = isolatedModule("src/app/api/reports/[id]/download/route.ts", {
            "@/lib/prisma": { prisma: { researchReport: { findUnique: async () => status ? { status, publishedPdfUrl: storageUrl, archivedAt: null } : null } } },
            "@/lib/research-report-delivery": deliveryFixture(async () => { reads++; return streamResult(); }),
        });
        const res = await route.GET({}, { params: Promise.resolve({ id: "report" }) });
        assert.equal(res.status, status === "published" ? 200 : 404);
        assert.equal(reads, status === "published" ? 1 : 0);
        assert.match(res.headers.get("cache-control"), /no-store/);
        if (status === "published") {
            assert.equal(await res.text(), pdf.toString());
            assert.match(res.headers.get("content-disposition"), /^attachment/);
            assert.equal(res.headers.has("location"), false);
        }
    });
}

test("Admin preview requires session before reading a draft or its storage", async () => {
    for (const authenticated of [false, true]) {
        let reads = 0;
        const route = isolatedModule("src/app/api/agents/research-reports/[id]/pdf/route.ts", {
            "@/lib/auth": { getSession: async () => authenticated ? {} : null },
            "@/lib/prisma": { prisma: { researchReport: { findUnique: async () => { reads++; return { draftPdfUrl: storageUrl }; } } } },
            "@/lib/research-report-delivery": deliveryFixture(),
        });
        const res = await route.GET({}, { params: Promise.resolve({ id: "report" }) });
        assert.equal(res.status, authenticated ? 200 : 401);
        assert.equal(reads, authenticated ? 1 : 0);
        if (authenticated) assert.match(res.headers.get("content-disposition"), /^inline/);
    }
});

test("report publication preflights storage; fixture contains only the stable public route", async () => {
    for (const failure of ["storage", "github", "database", null]) {
        const updates: any[] = [];
        let requests = 0;
        const delivery = deliveryFixture(async () => { if (failure === "storage") throw new Error("unavailable"); return streamResult(); });
        const report = { id: "report", slug: "example", title: "Research", status: "approved", draftPdfUrl: storageUrl, updatedAt: new Date() };
        const route = isolatedModule("src/app/api/agents/research-reports/[id]/route.ts", {
            "next/server": nextResponseMock, "@/lib/auth": { getSession: async () => ({}) },
            "@/lib/prisma": { prisma: { researchReport: { findUnique: async () => report, update: async (args: any) => { if (failure === "database") throw new Error("mock failure"); updates.push(args); return args.data; } } } },
            "@/lib/research-report-delivery": delivery,
        }, { GITHUB_TOKEN: "synthetic", GITHUB_REPO: "synthetic/reports" }, { fetch: async (_url, init) => {
            requests++;
            if (init?.method !== "PUT") return Response.json({}, { status: 404 });
            const fixture = JSON.parse(Buffer.from(JSON.parse(String(init.body)).content, "base64").toString());
            assert.equal(fixture.pdf.url, "https://admin.example.com/api/reports/report/download");
            assert.doesNotMatch(JSON.stringify(fixture), /private\.blob|synthetic-shared-key/);
            return Response.json({ content: { sha: "mock-sha" } }, { status: failure === "github" ? 503 : 200 });
        } });
        const res = await route.PATCH({ json: async () => ({ action: "publish" }) }, { params: Promise.resolve({ id: "report" }) });
        assert.equal(res.status, failure ? failure === "storage" ? 503 : 500 : 200);
        assert.equal(updates.length, failure ? 0 : 1);
        if (failure === "storage") assert.equal(requests, 0);
        if (!failure) {
            assert.equal(updates[0].where.status, "approved");
            assert.equal(updates[0].where.updatedAt, report.updatedAt);
            assert.equal(updates[0].data.publishedPdfUrl, storageUrl);
        }
    }
});

test("middleware exemption is limited to the public report download path", () => {
    const middleware = isolatedModule("src/middleware.ts", { "@/lib/auth": { auth: () => {} } });
    // Exercise Next's actual matcher compiler without loading app config or auth.
    const { getMiddlewareMatchers } = createRequire(import.meta.url)("next/dist/build/analysis/get-page-static-info.js");
    const matcher = new RegExp(getMiddlewareMatchers(middleware.config.matcher, {})[0].regexp);
    assert.equal(matcher.test("/api/reports/report/download"), false);
    for (const path of ["/api/reports/report", "/api/reports/report/download/edit", "/api/agents/research-reports/report/pdf"]) assert.equal(matcher.test(path), true);
    assert.match(readFileSync("src/lib/research-report-generator.tsx", "utf8"), /allowOverwrite: false/);
});
