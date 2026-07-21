import assert from "node:assert/strict";
import test from "node:test";
import {
    InstantlyApiError,
    createInstantlyBlockListEntry,
    createInstantlyWebhook,
    deleteInstantlyBlockListEntry,
    getInstantlyEmail,
    getInstantlyWorkspacePlanDetails,
    listInstantlyBlockListEntries,
    listInstantlyWebhookEventTypes,
    listInstantlyWebhookEvents,
    resumeInstantlyWebhook,
} from "../instantly.ts";

type RequestRecord = { url: string; init: RequestInit };

async function withMockFetch(run: (requests: RequestRecord[]) => Promise<void>) {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.INSTANTLY_API_KEY;
    const requests: RequestRecord[] = [];
    process.env.INSTANTLY_API_KEY = "test-key";
    globalThis.fetch = async (input, init) => {
        requests.push({ url: String(input), init: init || {} });
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
        await run(requests);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.INSTANTLY_API_KEY;
        else process.env.INSTANTLY_API_KEY = originalKey;
    }
}

test("provider control-plane reads use the verified API v2 paths", async () => {
    await withMockFetch(async (requests) => {
        await listInstantlyWebhookEventTypes();
        await listInstantlyWebhookEvents({ limit: 25, starting_after: "evt cursor" });
        await listInstantlyBlockListEntries({ limit: 100 });
        await getInstantlyWorkspacePlanDetails();
        await getInstantlyEmail("email/id");

        assert.deepEqual(requests.map((request) => new URL(request.url).pathname), [
            "/api/v2/webhooks/event-types",
            "/api/v2/webhook-events",
            "/api/v2/block-lists-entries",
            "/api/v2/workspace-billing/plan-details",
            "/api/v2/emails/email%2Fid",
        ]);
        assert.equal(new URL(requests[1].url).searchParams.get("starting_after"), "evt cursor");
        assert.ok(requests.every((request) => request.init.method === "GET"));
    });
});

test("webhook registration and recovery send the verified request shapes", async () => {
    await withMockFetch(async (requests) => {
        await createInstantlyWebhook({
            targetHookUrl: "https://admin.example.com/api/webhooks/instantly",
            eventType: "all_events",
            name: "Jamal Admin canonical receiver",
            headers: { "x-instantly-webhook-secret": "secret-reference-value" },
        });
        await resumeInstantlyWebhook("hook/id");

        assert.equal(new URL(requests[0].url).pathname, "/api/v2/webhooks");
        assert.equal(requests[0].init.method, "POST");
        assert.deepEqual(JSON.parse(String(requests[0].init.body)), {
            target_hook_url: "https://admin.example.com/api/webhooks/instantly",
            event_type: "all_events",
            name: "Jamal Admin canonical receiver",
            headers: { "x-instantly-webhook-secret": "secret-reference-value" },
        });
        assert.equal(new URL(requests[1].url).pathname, "/api/v2/webhooks/hook%2Fid/resume");
        assert.equal(requests[1].init.method, "POST");
    });
});

test("manual DNC provider projection uses block-list entry endpoints", async () => {
    await withMockFetch(async (requests) => {
        await createInstantlyBlockListEntry("lead@example.com");
        await deleteInstantlyBlockListEntry("entry/id");

        assert.equal(new URL(requests[0].url).pathname, "/api/v2/block-lists-entries");
        assert.equal(requests[0].init.method, "POST");
        assert.deepEqual(JSON.parse(String(requests[0].init.body)), { bl_value: "lead@example.com" });
        assert.equal(new URL(requests[1].url).pathname, "/api/v2/block-lists-entries/entry%2Fid");
        assert.equal(requests[1].init.method, "DELETE");
    });
});

test("ambiguous POST failures are not automatically retried", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.INSTANTLY_API_KEY;
    let calls = 0;
    process.env.INSTANTLY_API_KEY = "test-key";
    globalThis.fetch = async () => {
        calls += 1;
        return new Response("temporary upstream failure", { status: 503 });
    };
    try {
        await assert.rejects(
            createInstantlyBlockListEntry("lead@example.com"),
            (error) => error instanceof InstantlyApiError && error.status === 503,
        );
        assert.equal(calls, 1);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.INSTANTLY_API_KEY;
        else process.env.INSTANTLY_API_KEY = originalKey;
    }
});
