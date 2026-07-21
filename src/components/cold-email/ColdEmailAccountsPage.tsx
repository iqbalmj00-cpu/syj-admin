"use client";

import { useState } from "react";
import {
    ApiState,
    ColdEmailWorkspace,
    Notice,
    Panel,
    StatusBadge,
    coldEmailMutation,
    coldEmailStyles as styles,
    formatDate,
    useColdEmailApi,
} from "@/components/cold-email/ColdEmailWorkspace";

type Value = Record<string, unknown>;
type Infrastructure = { accounts: Value[]; domains: Value[]; pools: Value[]; capabilities: Value[] };
function value(input: unknown, fallback: unknown = "—") { return input === null || input === undefined || input === "" ? String(fallback) : String(input); }

export function ColdEmailAccountsPage() {
    const api = useColdEmailApi<Infrastructure>("/api/cold-email/platform/infrastructure");
    const [caps, setCaps] = useState<Record<string, string>>({});
    const [poolName, setPoolName] = useState("");
    const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
    async function mutate(action: string, body: Record<string, unknown>) {
        setBusy(action); setNotice(null);
        try {
            await coldEmailMutation("/api/cold-email/platform/infrastructure", { action, ...body });
            setNotice({ tone: "success", text: `${action.replaceAll("_", " ")} was recorded.` });
            if (action === "create_pool") { setPoolName(""); setSelectedAccounts([]); }
            await api.reload();
        } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Infrastructure action failed" }); }
        finally { setBusy(null); }
    }
    return <ColdEmailWorkspace title="Sending infrastructure" description="Provider-observed mailbox health plus Admin-owned domain caps, sending pools, and fail-closed capacity inputs." actions={<a className="btn btn-sm btn-ghost" href="https://app.instantly.ai/app/accounts" target="_blank" rel="noreferrer">Open Instantly accounts</a>}>
        {notice && <Notice title={notice.tone === "success" ? "Infrastructure updated" : "Update blocked"} tone={notice.tone}>{notice.text}</Notice>}
        <Notice title="Provider facts and Admin policy stay separate">Instantly owns account status and sending limits. This dashboard owns pool membership, sender-domain caps, readiness decisions, and reservations.</Notice>
        <Panel title="Sending accounts" description="Latest normalized provider observations. A missing or stale health fact never becomes a healthy zero." flush>
            <ApiState loading={api.loading} error={api.error} empty={api.data?.accounts.length === 0} emptyTitle="No synchronized accounts" emptyCopy="Account synchronization will populate mailboxes after Instantly is configured." onRetry={api.reload}>
                <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Mailbox</th><th>Readiness</th><th>Warmup</th><th>Daily limit</th><th>Domain</th><th>Tracking domain</th><th>Last sync</th></tr></thead><tbody>{(api.data?.accounts || []).map((account) => <tr key={value(account.id)}><td><span className={styles.primaryCell}>{value(account.email)}</span><span className={styles.secondary}>{value(account.providerStatusMessage, value(account.status))}</span>{account.localReviewRequired ? <span className={styles.secondary}>Admin block: {value(account.localBlockReason).replaceAll("_", " ")} · resolve its health alert after review to resume</span> : null}</td><td><StatusBadge value={value(account.effectiveReadiness, account.readiness)} /></td><td>{value(account.warmupStatus)} {account.warmupScore !== null && account.warmupScore !== undefined ? `· ${account.warmupScore}` : ""}</td><td>{value(account.dailyLimit)}</td><td>{value((account.sendingDomain as Value | undefined)?.normalizedDomain)}</td><td><StatusBadge value={value(account.trackingDomainStatus, account.trackingDomain ? "unknown" : "unavailable")} /></td><td>{formatDate(account.lastSyncedAt, true)}</td></tr>)}</tbody></table></div>
            </ApiState>
        </Panel>
        <div className={styles.split}>
            <Panel title="Sender-domain caps" description="Required before capacity can be reserved.">
                <ApiState loading={api.loading} error={api.error} empty={api.data?.domains.length === 0} emptyTitle="No sending domains" emptyCopy="Domains are derived from synchronized sending accounts." onRetry={api.reload}>
                    <div className={styles.list}>{(api.data?.domains || []).map((domain) => <div className={styles.listItem} key={value(domain.id)}><div className={styles.listTop}><span className={styles.listTitle}>{value(domain.normalizedDomain)}</span><StatusBadge value={value(domain.readiness)} /></div><div className={styles.actions}><input aria-label={`Daily cap for ${value(domain.normalizedDomain)}`} className={styles.control} type="number" min="1" placeholder={value(domain.dailyCap, "Daily cap")} value={caps[value(domain.id)] || ""} onChange={(event) => setCaps((current) => ({ ...current, [value(domain.id)]: event.target.value }))} /><button className="btn btn-xs btn-ghost" disabled={busy !== null || !caps[value(domain.id)]} onClick={() => void mutate("set_domain_cap", { domainId: domain.id, dailyCap: Number(caps[value(domain.id)]) })}>Set cap</button></div></div>)}</div>
                </ApiState>
            </Panel>
            <Panel title="Create sending pool" description="Prioritized group of ready mailboxes for campaign allocation.">
                <div className={styles.field}><label>Pool name</label><input className={styles.control} value={poolName} onChange={(event) => setPoolName(event.target.value)} /></div>
                <div className={styles.list} style={{ marginTop: 10 }}>{(api.data?.accounts || []).map((account) => <label className={styles.listItem} key={value(account.id)}><span className={styles.inline}><input type="checkbox" checked={selectedAccounts.includes(value(account.id))} onChange={(event) => setSelectedAccounts((current) => event.target.checked ? [...current, value(account.id)] : current.filter((id) => id !== account.id))} /><span className={styles.listTitle}>{value(account.email)}</span><StatusBadge value={value(account.effectiveReadiness, account.readiness)} /></span></label>)}</div>
                <button className="btn btn-sm btn-primary" style={{ marginTop: 10 }} disabled={busy !== null || !poolName.trim() || selectedAccounts.length === 0} onClick={() => void mutate("create_pool", { name: poolName, accountIds: selectedAccounts })}>{busy === "create_pool" ? "Creating…" : "Create pool"}</button>
            </Panel>
        </div>
        <Panel title="Sending pools" description="Current membership and readiness ordering." flush>
            <ApiState loading={api.loading} error={api.error} empty={api.data?.pools.length === 0} emptyTitle="No sending pools" emptyCopy="Create a pool before preparing a campaign." onRetry={api.reload}>
                <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Pool</th><th>Status</th><th>Priority</th><th>Mailboxes</th><th>Policies</th></tr></thead><tbody>{(api.data?.pools || []).map((pool) => <tr key={value(pool.id)}><td><span className={styles.primaryCell}>{value(pool.name)}</span><span className={styles.secondary}>{value(pool.description, "No description")}</span></td><td><StatusBadge value={pool.active ? "active" : "paused"} /></td><td>{value(pool.priority)}</td><td>{((pool.memberships as Value[] | undefined) || []).map((membership) => value((membership.sendingAccount as Value | undefined)?.email)).join(", ")}</td><td className={styles.mono}>{JSON.stringify({ readiness: pool.readinessPolicy, fallback: pool.fallbackPolicy }).slice(0, 140)}</td></tr>)}</tbody></table></div>
            </ApiState>
        </Panel>
        <Panel title="Provider capabilities" description="Runtime truth is persisted evidence, not assumptions from documentation." flush>
            <ApiState loading={api.loading} error={api.error} empty={api.data?.capabilities.length === 0} emptyTitle="No capability evidence" emptyCopy="The capability probe stores available, unavailable, and unknown results." onRetry={api.reload}>
                <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Capability</th><th>Status</th><th>Source</th><th>Observed</th><th>Expires</th></tr></thead><tbody>{(api.data?.capabilities || []).map((capability) => <tr key={value(capability.capabilityKey)}><td className={styles.mono}>{value(capability.capabilityKey)}</td><td><StatusBadge value={value(capability.status)} /></td><td>{value(capability.source)}</td><td>{formatDate(capability.observedAt, true)}</td><td>{formatDate(capability.expiresAt, true)}</td></tr>)}</tbody></table></div>
            </ApiState>
        </Panel>
    </ColdEmailWorkspace>;
}
