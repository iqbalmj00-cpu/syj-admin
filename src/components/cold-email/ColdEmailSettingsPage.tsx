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
type Settings = { role: string; configuration: Record<string, unknown>; retentionPolicy: Record<string, unknown>; recoveryTargets: Record<string, unknown>; capabilities: Value[]; cursors: Value[]; retentionRuns: Value[]; reconciliationRuns: Value[]; operators: Value[]; blackouts: Value[]; sourceOfTruth: Value[]; metricDefinitions: Record<string, Value> };
function value(input: unknown, fallback = "—") { return input === null || input === undefined || input === "" ? fallback : String(input); }
const CONTROLLED_CAPABILITIES = ["campaigns.create", "campaigns.activate_pause", "campaigns.test_send", "leads.bulk_enroll", "emails.reply", "block_list_entries.create_delete"];

export function ColdEmailSettingsPage() {
    const settings = useColdEmailApi<Settings>("/api/cold-email/platform/settings");
    const recovery = useColdEmailApi<{ items: Value[]; nextCursor: string | null }>("/api/cold-email/platform/recovery?take=100&status=open");
    const views = useColdEmailApi<{ items: Value[] }>("/api/cold-email/platform/saved-views");
    const [busy, setBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
    const [evidence, setEvidence] = useState<Record<string, string>>({});
    const [view, setView] = useState({ name: "", surface: "campaigns", filter: "", shared: false });
    const [blackout, setBlackout] = useState({ name: "", dateKey: "", timezone: "America/Chicago", scope: "global", campaignId: "" });
    const [blackoutReasons, setBlackoutReasons] = useState<Record<string, string>>({});
    const [certification, setCertification] = useState({ capabilityKey: CONTROLLED_CAPABILITIES[0], status: "available", evidenceSummary: "" });
    async function settingAction(action: string, body: Record<string, unknown> = {}) {
        setBusy(action); setNotice(null);
        try {
            const result = await coldEmailMutation<Value>("/api/cold-email/platform/settings", { action, ...body });
            setNotice({ tone: "success", text: `${action.replaceAll("_", " ")} completed: ${JSON.stringify(result).slice(0, 220)}` }); await settings.reload(); return true;
        } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Settings action failed" }); return false; }
        finally { setBusy(null); }
    }
    async function recoveryAction(item: Value, action: string) {
        const key = value(item.id); setBusy(key); setNotice(null);
        try {
            if (action === "replay_dead_letter") await coldEmailMutation("/api/cold-email/platform/recovery", { action, id: item.id, reason: evidence[key] || "Operator-requested replay after reviewing the dead-letter evidence" });
            else {
                const operation = item.providerOperation as Value | undefined;
                await coldEmailMutation("/api/cold-email/platform/recovery", { action: "repair_operation", id: operation?.id, repairAction: action, evidence: evidence[key] || "Operator reviewed source and provider evidence in the recovery queue" });
            }
            setNotice({ tone: "success", text: "Recovery action was recorded." }); await Promise.all([recovery.reload(), settings.reload()]);
        } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Recovery action failed" }); }
        finally { setBusy(null); }
    }
    async function saveView() {
        setBusy("saved_view"); setNotice(null);
        try {
            await coldEmailMutation("/api/cold-email/platform/saved-views", { name: view.name, surface: view.surface, filters: view.filter.trim() ? { search: view.filter.trim() } : {}, shared: view.shared });
            setView({ ...view, name: "" }); setNotice({ tone: "success", text: "Saved view created." }); await views.reload();
        } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Saved view failed" }); }
        finally { setBusy(null); }
    }
    async function deleteView(id: string) {
        setBusy(`delete_view:${id}`); setNotice(null);
        try {
            await coldEmailMutation("/api/cold-email/platform/saved-views", { action: "delete", id });
            setNotice({ tone: "success", text: "Saved view deleted." }); await views.reload();
        } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Saved view deletion failed" }); }
        finally { setBusy(null); }
    }
    async function createBlackout() {
        if (await settingAction("blackout_create", blackout)) setBlackout((current) => ({ ...current, name: "", dateKey: "", campaignId: "" }));
    }
    async function certifyCapability() {
        if (!window.confirm("Confirm that this result comes from a separately authorized controlled provider test and contains no secrets or customer data.")) return;
        if (await settingAction("capability_certify", { ...certification, confirm: true, ttlHours: 24 })) {
            setCertification((current) => ({ ...current, evidenceSummary: "" }));
        }
    }
    const config = settings.data?.configuration || {};
    const canManageSettings = settings.data?.role === "super_admin";
    return <ColdEmailWorkspace title="Settings & recovery" description="Control-plane state, provider capabilities, synchronization cursors, retention controls, role visibility, saved views, and audited recovery work.">
        {notice && <Notice title={notice.tone === "success" ? "Operation complete" : "Operation blocked"} tone={notice.tone}>{notice.text}</Notice>}
        <Panel title="Control-plane cutover" description="Provider writes are gated separately from canonical UI and persistence.">
            <ApiState loading={settings.loading} error={settings.error} empty={!settings.data} emptyTitle="Settings unavailable" emptyCopy="Canonical settings persistence is not ready." onRetry={settings.reload}>
                <div className={styles.metricGrid}>{Object.entries(config).map(([key, entry]) => <div className={styles.metric} key={key}><div className={styles.metricLabel}>{key.replaceAll(/([A-Z])/g, " $1")}</div><div className={styles.metricValue} style={{ fontSize: 16 }}>{typeof entry === "boolean" ? <StatusBadge value={entry ? "enabled" : "disabled"} /> : value(entry)}</div></div>)}</div>
                {config.controlPlane !== "canonical" || config.canonicalProviderMutationsEnabled !== true ? <Notice title="Canonical provider mutations are blocked" tone="warning">Campaign preparation, testing, lifecycle changes, and the provider worker cannot mutate Instantly until the control plane is canonical and the provider mutation kill switch is explicitly enabled.</Notice> : <Notice title="Canonical provider mutations are enabled" tone="success">The canonical outbox is authorized to execute provider work. Continue monitoring reconciliation and dead letters.</Notice>}
            </ApiState>
        </Panel>
        <Panel title="Provider capability evidence" description="Scheduled read checks and controlled mutation certifications remain separate, time-bounded evidence.">
            <ApiState loading={settings.loading} error={settings.error} empty={!settings.data} emptyTitle="Capability evidence unavailable" emptyCopy="Canonical capability persistence is not ready." onRetry={settings.reload}>
                <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Capability</th><th>Status</th><th>Source</th><th>Observed</th><th>Expires</th></tr></thead><tbody>{(settings.data?.capabilities || []).map((item) => <tr key={`${value(item.provider)}:${value(item.workspaceId)}:${value(item.capabilityKey)}`}><td className={styles.primaryCell}>{value(item.capabilityKey)}</td><td><StatusBadge value={value(item.status)} /></td><td>{value(item.source)}</td><td>{formatDate(item.observedAt, true)}</td><td>{formatDate(item.expiresAt, true)}</td></tr>)}</tbody></table></div>
                {settings.data?.role === "super_admin" ? <div className={styles.formGridWide} style={{ marginTop: 12 }}>
                    <div className={styles.field}><label>Controlled capability</label><select className={styles.control} value={certification.capabilityKey} onChange={(event) => setCertification({ ...certification, capabilityKey: event.target.value })}>{CONTROLLED_CAPABILITIES.map((item) => <option key={item}>{item}</option>)}</select></div>
                    <div className={styles.field}><label>Observed result</label><select className={styles.control} value={certification.status} onChange={(event) => setCertification({ ...certification, status: event.target.value })}>{["available", "degraded", "unavailable"].map((item) => <option key={item}>{item}</option>)}</select></div>
                    <div className={`${styles.field} ${styles.spanAll}`}><label>Sanitized controlled-test evidence</label><input className={styles.control} value={certification.evidenceSummary} maxLength={500} onChange={(event) => setCertification({ ...certification, evidenceSummary: event.target.value })} placeholder="Internal test ID, observed result, and provider reference summary; no secrets or customer data" /></div>
                    <button className="btn btn-sm btn-primary" disabled={busy !== null || certification.evidenceSummary.trim().length < 12} onClick={() => void certifyCapability()}>Confirm 24-hour certification</button>
                </div> : <Notice title="Certification is Super Admin only">Your role can review current evidence but cannot certify provider mutations.</Notice>}
            </ApiState>
        </Panel>
        <Panel title="Holiday & blackout calendar" description="Active campaigns that enforce blackouts are paused for the configured local date and resumed only when that blackout pause remains the latest lifecycle operation.">
            <div className={styles.formGridWide}>
                <div className={styles.field}><label>Name</label><input className={styles.control} value={blackout.name} onChange={(event) => setBlackout({ ...blackout, name: event.target.value })} placeholder="US federal holiday or internal blackout" /></div>
                <div className={styles.field}><label>Date</label><input className={styles.control} type="date" value={blackout.dateKey} onChange={(event) => setBlackout({ ...blackout, dateKey: event.target.value })} /></div>
                <div className={styles.field}><label>Timezone</label><input className={styles.control} value={blackout.timezone} onChange={(event) => setBlackout({ ...blackout, timezone: event.target.value })} /></div>
                <div className={styles.field}><label>Scope</label><select className={styles.control} value={blackout.scope} onChange={(event) => setBlackout({ ...blackout, scope: event.target.value })}><option value="global">All campaigns</option><option value="campaign">One campaign</option></select></div>
                {blackout.scope === "campaign" && <div className={`${styles.field} ${styles.spanAll}`}><label>Campaign ID</label><input className={styles.control} value={blackout.campaignId} onChange={(event) => setBlackout({ ...blackout, campaignId: event.target.value })} /></div>}
            </div>
            {!canManageSettings && <Notice title="Blackout changes are Super Admin only">Your role can review the blackout calendar but cannot change it.</Notice>}
            <button className="btn btn-sm btn-primary" style={{ marginTop: 10 }} disabled={!canManageSettings || busy !== null || !blackout.name.trim() || !blackout.dateKey || !blackout.timezone.trim() || (blackout.scope === "campaign" && !blackout.campaignId.trim())} onClick={() => void createBlackout()}>Add blackout</button>
            <div className={styles.list} style={{ marginTop: 12 }}>
                {(settings.data?.blackouts || []).map((item) => { const id = value(item.id); const campaign = item.campaign as Value | undefined; return <div className={styles.listItem} key={id}><div className={styles.listTop}><span className={styles.listTitle}>{value(item.name)}</span><StatusBadge value={item.active ? "active" : "inactive"} /></div><span className={styles.listMeta}>{formatDate(item.date)} · {value(item.timezone)} · {item.scope === "campaign" ? value(campaign?.name, value(item.campaignId)) : "all campaigns"}</span>{Boolean(item.active) && canManageSettings && <div className={styles.actions} style={{ marginTop: 8 }}><input className={styles.control} aria-label={`Deactivation reason for ${value(item.name)}`} value={blackoutReasons[id] || ""} onChange={(event) => setBlackoutReasons((current) => ({ ...current, [id]: event.target.value }))} placeholder="Reason required to deactivate" /><button className="btn btn-xs btn-ghost" disabled={busy !== null || !blackoutReasons[id]?.trim()} onClick={() => void settingAction("blackout_deactivate", { id, reason: blackoutReasons[id] })}>Deactivate</button></div>}</div>; })}
                {!settings.loading && (settings.data?.blackouts || []).length === 0 && <span className={styles.listMeta}>No recent or upcoming blackouts are configured.</span>}
            </div>
            <Notice title="Scheduler release gate">The protected blackout scheduler queues durable pause/resume operations only after canonical provider mutations and the certified activate/pause capability are enabled. Deployment scheduling remains a separate release step.</Notice>
        </Panel>
        <div className={styles.split}>
            <Panel title="Synchronization cursors" description="Every provider and partition exposes its freshness state." flush>
                <ApiState loading={settings.loading} error={settings.error} empty={settings.data?.cursors.length === 0} emptyTitle="No cursor evidence" emptyCopy="Cursor records appear after the synchronization workers run." onRetry={settings.reload}>
                    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Provider / resource</th><th>Status</th><th>Partition</th><th>Last success</th><th>Error</th></tr></thead><tbody>{(settings.data?.cursors || []).map((cursor) => <tr key={value(cursor.id)}><td><span className={styles.primaryCell}>{value(cursor.provider)} · {value(cursor.resourceType)}</span></td><td><StatusBadge value={value(cursor.status)} /></td><td className={styles.mono}>{value(cursor.partitionKey)}</td><td>{formatDate(cursor.lastSuccessfulAt, true)}</td><td>{value(cursor.redactedError)}</td></tr>)}</tbody></table></div>
                </ApiState>
            </Panel>
            <Panel title="Operators & roles" description={`Your resolved role is ${settings.data?.role || "unknown"}.`} flush>
                <ApiState loading={settings.loading} error={settings.error} empty={settings.data?.operators.length === 0} emptyTitle="No canonical operators" emptyCopy="Authorized sessions default to the configured policy until operators are mirrored." onRetry={settings.reload}>
                    <div className={styles.list}>{(settings.data?.operators || []).map((operator) => <div className={styles.listItem} key={value(operator.id)}><div className={styles.listTop}><span className={styles.listTitle}>{value(operator.displayName, value(operator.email))}</span><StatusBadge value={value(operator.role)} /></div><span className={styles.listMeta}>{value(operator.email)} · last seen {formatDate(operator.lastSeenAt, true)}</span></div>)}</div>
                </ApiState>
            </Panel>
        </div>
        <Panel title="Recovery queue" description="Dead-letter replay and ambiguous operation repair require an operator reason or evidence. Retrying an ambiguous mutation is deliberately unavailable here without verified provider absence." flush>
            <ApiState loading={recovery.loading} error={recovery.error} empty={recovery.data?.items.length === 0} emptyTitle="Recovery queue is clear" emptyCopy="Permanently failed events and operations appear here with redacted evidence." onRetry={recovery.reload}>
                <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Source</th><th>Reason</th><th>State</th><th>Evidence note</th><th>Actions</th></tr></thead><tbody>{(recovery.data?.items || []).map((item) => { const operation = item.providerOperation as Value | undefined; return <tr key={value(item.id)}><td><span className={styles.primaryCell}>{value(item.sourceType)}</span><span className={styles.secondary}>{value(item.sourceId)}</span></td><td>{value(item.reason)}<span className={styles.secondary}>{value(item.attemptCount)} attempts · {formatDate(item.lastFailedAt, true)}</span></td><td><StatusBadge value={value(operation?.state, value(item.status))} /></td><td><input className={styles.control} disabled={!canManageSettings} aria-label={`Evidence for ${value(item.id)}`} value={evidence[value(item.id)] || ""} onChange={(event) => setEvidence((current) => ({ ...current, [value(item.id)]: event.target.value }))} placeholder="Operator evidence or replay reason" /></td><td>{canManageSettings ? <div className={styles.actions}><button className="btn btn-xs btn-ghost" disabled={busy !== null} onClick={() => void recoveryAction(item, "replay_dead_letter")}>Replay</button>{operation && ["provider_accepted", "reconciliation_required"].includes(value(operation.state)) && <button className="btn btn-xs btn-ghost" disabled={busy !== null || !evidence[value(item.id)]} onClick={() => void recoveryAction(item, "confirm_observed")}>Confirm observed</button>}{operation && ["pending", "retry_eligible", "reconciliation_required"].includes(value(operation.state)) && <button className="btn btn-xs btn-ghost" disabled={busy !== null || !evidence[value(item.id)]} onClick={() => void recoveryAction(item, "cancel")}>Cancel</button>}</div> : <StatusBadge value="read_only" />}</td></tr>; })}</tbody></table></div>
            </ApiState>
        </Panel>
        <div className={styles.split}>
            <Panel title="Retention" description="Dry-run previews are safe. Apply stays kill-switch protected and requires a separate explicit click.">
                <pre className={styles.mono} style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(settings.data?.retentionPolicy || {}, null, 2)}</pre>
                {!canManageSettings && <Notice title="Retention actions are Super Admin only">Your role can review retention evidence but cannot start a run.</Notice>}
                <div className={styles.actions} style={{ marginTop: 10 }}><button className="btn btn-sm btn-ghost" disabled={!canManageSettings || busy !== null} onClick={() => void settingAction("retention_dry_run")}>Run dry preview</button><button className="btn btn-sm btn-ghost" disabled={!canManageSettings || busy !== null || config.retentionEnabled !== true} onClick={() => void settingAction("retention_apply", { confirm: true })}>Confirm retention apply</button></div>
                <div className={styles.list} style={{ marginTop: 10 }}>{(settings.data?.retentionRuns || []).map((run) => <div className={styles.listItem} key={value(run.id)}><div className={styles.listTop}><span className={styles.listTitle}>{run.dryRun ? "Dry run" : "Applied run"}</span><StatusBadge value={value(run.status)} /></div><span className={styles.listMeta}>{formatDate(run.startedAt, true)} · candidates {JSON.stringify(run.candidateCounts)}</span></div>)}</div>
            </Panel>
            <Panel title="Saved views" description="Persist operator-specific filters for the main operating surfaces.">
                <div className={styles.formGrid}><div className={styles.field}><label>View name</label><input className={styles.control} value={view.name} onChange={(event) => setView({ ...view, name: event.target.value })} /></div><div className={styles.field}><label>Surface</label><select className={styles.control} value={view.surface} onChange={(event) => setView({ ...view, surface: event.target.value })}>{["campaigns", "inbox", "opportunities", "do-not-contact"].map((surface) => <option key={surface}>{surface}</option>)}</select></div><div className={`${styles.field} ${styles.spanAll}`}><label>Search filter</label><input className={styles.control} value={view.filter} onChange={(event) => setView({ ...view, filter: event.target.value })} /></div><label className={`${styles.inline} ${styles.spanAll}`}><input type="checkbox" checked={view.shared} onChange={(event) => setView({ ...view, shared: event.target.checked })} /><span className={styles.fieldLabel}>Share with other Cold Email operators (Campaign Manager or Super Admin only)</span></label></div>
                <button className="btn btn-sm btn-primary" style={{ marginTop: 10 }} disabled={busy !== null || !view.name.trim()} onClick={() => void saveView()}>Save view</button>
                <div className={styles.list} style={{ marginTop: 10 }}>{(views.data?.items || []).map((item) => <div className={styles.listItem} key={value(item.id)}><div className={styles.listTop}><span className={styles.listTitle}>{value(item.name)}</span><div className={styles.actions}><StatusBadge value={value(item.surface)} />{item.shared ? <StatusBadge value="shared" /> : null}{item.owned ? <button className="btn btn-xs btn-ghost" disabled={busy !== null} onClick={() => void deleteView(value(item.id))}>Delete</button> : null}</div></div><span className={styles.listMeta}>{JSON.stringify(item.filters)}</span></div>)}</div>
            </Panel>
        </div>
        <Panel title="Source-of-truth ledger" description="The platform never silently merges provider observation, operator judgment, and cross-system authority." flush>
            <ApiState loading={settings.loading} error={settings.error} empty={settings.data?.sourceOfTruth.length === 0} onRetry={settings.reload}>
                <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Field</th><th>Authority</th><th>Provider role</th></tr></thead><tbody>{(settings.data?.sourceOfTruth || []).map((entry) => <tr key={value(entry.field)}><td className={styles.primaryCell}>{value(entry.field)}</td><td><StatusBadge value={value(entry.authority)} /></td><td>{value(entry.providerRole)}</td></tr>)}</tbody></table></div>
            </ApiState>
        </Panel>
    </ColdEmailWorkspace>;
}
