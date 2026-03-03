const VERCEL_TOKEN = process.env.SYJ_VERCEL_TOKEN;
const VERCEL_TEAM_ID = process.env.SYJ_VERCEL_TEAM_ID;
const BASE = "https://api.vercel.com";

function headers() {
    return {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        "Content-Type": "application/json",
    };
}

/** Delete a Vercel project */
export async function deleteVercelProject(projectId: string) {
    if (!VERCEL_TOKEN) throw new Error("Vercel not configured");
    const url = `${BASE}/v9/projects/${projectId}${VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : ""}`;
    const res = await fetch(url, { method: "DELETE", headers: headers() });
    if (!res.ok && res.status !== 404) {
        const body = await res.text();
        throw new Error(`Vercel delete failed: ${res.status} ${body}`);
    }
    return true;
}

/** Trigger a redeploy for a Vercel project */
export async function redeployVercelProject(projectId: string) {
    if (!VERCEL_TOKEN) throw new Error("Vercel not configured");
    // Get latest deployment to redeploy from
    const listUrl = `${BASE}/v6/deployments?projectId=${projectId}&limit=1${VERCEL_TEAM_ID ? `&teamId=${VERCEL_TEAM_ID}` : ""}`;
    const listRes = await fetch(listUrl, { headers: headers() });
    if (!listRes.ok) throw new Error(`Failed to list deployments: ${listRes.status}`);
    const listData = await listRes.json();
    const latest = listData.deployments?.[0];
    if (!latest) throw new Error("No deployments found for project");

    // Use the "redeploy from existing deployment" approach
    const url = `${BASE}/v13/deployments${VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : ""}`;

    const body: Record<string, unknown> = {
        name: latest.name,
        deploymentId: latest.uid,
        target: "production",
        meta: { action: "redeploy" },
    };

    // Only include gitSource if available
    if (latest.gitSource) {
        body.gitSource = latest.gitSource;
    }

    const res = await fetch(url, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Vercel redeploy failed: ${res.status} ${errBody}`);
    }
    return res.json();
}

/** List recent deployments for a project */
export async function listDeployments(projectId: string, limit = 10) {
    if (!VERCEL_TOKEN) throw new Error("Vercel not configured");
    const url = `${BASE}/v6/deployments?projectId=${projectId}&limit=${limit}${VERCEL_TEAM_ID ? `&teamId=${VERCEL_TEAM_ID}` : ""}`;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error(`Failed to list deployments: ${res.status}`);
    const data = await res.json();
    return data.deployments || [];
}

/** Get build logs for a specific deployment */
export async function getDeploymentLogs(deploymentId: string) {
    if (!VERCEL_TOKEN) throw new Error("Vercel not configured");
    const url = `${BASE}/v2/deployments/${deploymentId}/events${VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : ""}`;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error(`Failed to get deployment logs: ${res.status}`);
    return res.json();
}

/** Push environment variables to a Vercel project */
export async function pushEnvVars(projectId: string, envVars: Record<string, string>) {
    if (!VERCEL_TOKEN) throw new Error("Vercel not configured");
    // Get existing env vars
    const listUrl = `${BASE}/v9/projects/${projectId}/env${VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : ""}`;
    const listRes = await fetch(listUrl, { headers: headers() });
    const existingVars = listRes.ok ? ((await listRes.json()).envs || []) : [];
    const existingMap = new Map(existingVars.map((e: { key: string; id: string }) => [e.key, e.id]));

    const results: { key: string; action: string }[] = [];
    for (const [key, value] of Object.entries(envVars)) {
        if (existingMap.has(key)) {
            // Update existing
            const envId = existingMap.get(key);
            const patchUrl = `${BASE}/v9/projects/${projectId}/env/${envId}${VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : ""}`;
            await fetch(patchUrl, { method: "PATCH", headers: headers(), body: JSON.stringify({ value, target: ["production", "preview"] }) });
            results.push({ key, action: "updated" });
        } else {
            // Create new
            const createUrl = `${BASE}/v9/projects/${projectId}/env${VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : ""}`;
            await fetch(createUrl, { method: "POST", headers: headers(), body: JSON.stringify({ key, value, target: ["production", "preview"], type: "plain" }) });
            results.push({ key, action: "created" });
        }
    }
    return results;
}
