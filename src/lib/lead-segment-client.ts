// Shared by initial population and retry: refresh the existing group, never recreate it.
export async function refreshEmailSegment(groupId: string, request: typeof fetch = fetch): Promise<number> {
    const response = await request("/api/agents/lead-groups/refresh", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId }),
    });
    const data = await response.json();
    if (!response.ok || data.ok !== true || !Number.isInteger(data.total) || data.total < 0) {
        throw new Error(data.error || "Membership was not confirmed. Retry the group refresh.");
    }
    return data.total;
}
