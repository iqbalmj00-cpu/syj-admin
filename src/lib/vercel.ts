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
    // Get latest deployment to redeploy
    const listUrl = `${BASE}/v6/deployments?projectId=${projectId}&limit=1${VERCEL_TEAM_ID ? `&teamId=${VERCEL_TEAM_ID}` : ""}`;
    const listRes = await fetch(listUrl, { headers: headers() });
    if (!listRes.ok) throw new Error(`Failed to list deployments: ${listRes.status}`);
    const listData = await listRes.json();
    const latest = listData.deployments?.[0];
    if (!latest) throw new Error("No deployments found for project");

    const url = `${BASE}/v13/deployments${VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : ""}`;
    const res = await fetch(url, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            name: latest.name,
            target: "production",
            gitSource: latest.gitSource,
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Vercel redeploy failed: ${res.status} ${body}`);
    }
    return res.json();
}
