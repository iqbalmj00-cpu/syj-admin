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
type Catalog = { leadGroups: Value[]; sequences: Value[]; templates: Value[] };
type Step = { delayDays: number; delayHours: number; variants: Array<{ label: string; subject: string; bodyHtml: string; bodyText: string; weight: number }> };
function value(input: unknown, fallback = "—") { return input === null || input === undefined || input === "" ? fallback : String(input); }
function memberCount(group: Value) { return Number((group._count as Value | undefined)?.members || 0); }

export function ColdEmailLeadGroupsPage() {
    const api = useColdEmailApi<Catalog>("/api/cold-email/platform/catalog");
    const [busy, setBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
    async function refresh(id: string) {
        setBusy(id); setNotice(null);
        try {
            const result = await coldEmailMutation<{ added: number; removed: number; total: number }>("/api/agents/lead-groups/refresh", { groupId: id });
            setNotice({ tone: "success", text: `Refresh complete: ${result.total} members, ${result.added} added, ${result.removed} removed.` });
            await api.reload();
        } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Lead Group refresh failed" }); }
        finally { setBusy(null); }
    }
    return <ColdEmailWorkspace title="Lead Groups" description="Saved email-channel segments that can be refreshed and frozen into campaign-specific audience snapshots.">
        {notice && <Notice title={notice.tone === "success" ? "Lead Group refreshed" : "Refresh blocked"} tone={notice.tone}>{notice.text}</Notice>}
        <Notice title="Refresh and snapshot are separate">Refresh reconciles a dynamic Lead Group. Campaign preparation later applies identity eligibility, manual Do Not Contact, cooldown, company caps, and global assignment rules before freezing its audience.</Notice>
        <Panel flush>
            <ApiState loading={api.loading} error={api.error} empty={api.data?.leadGroups.length === 0} emptyTitle="No email Lead Groups" emptyCopy="Create an email-channel Lead Group from the Leads workspace before building a campaign." onRetry={api.reload}>
                <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Lead Group</th><th>Members</th><th>Type</th><th>Last refreshed</th><th>Filter definition</th><th></th></tr></thead><tbody>{(api.data?.leadGroups || []).map((group) => <tr key={value(group.id)}><td><span className={styles.primaryCell}>{value(group.name)}</span><span className={styles.secondary}>{value(group.description, "No description")}</span></td><td>{memberCount(group)}</td><td><StatusBadge value={group.filterDefinition ? "dynamic" : "static"} /></td><td>{formatDate(group.lastRefreshedAt, true)}</td><td className={styles.mono}>{group.filterDefinition ? JSON.stringify(group.filterDefinition).slice(0, 120) : "Manual membership"}</td><td className={styles.right}><button className="btn btn-xs btn-ghost" type="button" disabled={busy !== null || !group.filterDefinition} onClick={() => void refresh(value(group.id))}>{busy === group.id ? "Refreshing…" : "Refresh"}</button></td></tr>)}</tbody></table></div>
            </ApiState>
        </Panel>
    </ColdEmailWorkspace>;
}

const emptyStep = (): Step => ({ delayDays: 0, delayHours: 0, variants: [{ label: "A", subject: "", bodyHtml: "", bodyText: "", weight: 100 }] });

export function ColdEmailTemplatesPage() {
    const api = useColdEmailApi<Catalog>("/api/cold-email/platform/catalog");
    const [name, setName] = useState("");
    const [steps, setSteps] = useState<Step[]>([emptyStep()]);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
    function updateStep(index: number, next: Step) { setSteps((current) => current.map((step, stepIndex) => stepIndex === index ? next : step)); }
    async function create() {
        setBusy(true); setNotice(null);
        try {
            const result = await coldEmailMutation<{ sequence: Value }>("/api/cold-email/platform/catalog", { action: "create_sequence", confirm: true, draft: { name, steps } });
            setNotice({ tone: "success", text: `${value(result.sequence.name)} v${value(result.sequence.version)} was frozen and approved.` });
            setName(""); setSteps([emptyStep()]); await api.reload();
        } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Sequence creation failed" }); }
        finally { setBusy(false); }
    }
    return <ColdEmailWorkspace title="Templates & sequences" description="Compose versioned message steps, validate supported personalization variables, and freeze an immutable approved sequence.">
        {notice && <Notice title={notice.tone === "success" ? "Sequence approved" : "Sequence blocked"} tone={notice.tone}>{notice.text}</Notice>}
        <Panel title="New sequence version" description="Creating a sequence also creates immutable template versions for every step and variant.">
            <div className={styles.field}><label>Sequence name</label><input className={styles.control} value={name} onChange={(event) => setName(event.target.value)} placeholder="Commercial haulers · operational efficiency" /><span className={styles.fieldHelp}>Use variables such as [first_name], [company_name], and [city]. Unknown tokens are rejected.</span></div>
            {steps.map((step, index) => <section key={index} className={styles.panel} style={{ marginTop: 12 }}><div className={styles.panelHeader}><div><div className={styles.panelTitle}>Step {index + 1}</div><div className={styles.panelDescription}>Delay from the preceding step; stop-on-reply is always enabled.</div></div>{steps.length > 1 && <button type="button" className="btn btn-xs btn-ghost" onClick={() => setSteps((current) => current.filter((_, stepIndex) => stepIndex !== index))}>Remove</button>}</div><div className={styles.panelBody}>
                <div className={styles.formGrid}><div className={styles.field}><label>Delay days</label><input type="number" min="0" className={styles.control} value={step.delayDays} onChange={(event) => updateStep(index, { ...step, delayDays: Number(event.target.value) })} /></div><div className={styles.field}><label>Delay hours</label><input type="number" min="0" className={styles.control} value={step.delayHours} onChange={(event) => updateStep(index, { ...step, delayHours: Number(event.target.value) })} /></div></div>
                {step.variants.map((variant, variantIndex) => <div className={styles.formGrid} style={{ marginTop: 12 }} key={variantIndex}><div className={styles.field}><label>Variant label</label><input className={styles.control} value={variant.label} onChange={(event) => updateStep(index, { ...step, variants: step.variants.map((item, i) => i === variantIndex ? { ...item, label: event.target.value } : item) })} /></div><div className={styles.field}><label>Weight</label><input type="number" min="0" className={styles.control} value={variant.weight} onChange={(event) => updateStep(index, { ...step, variants: step.variants.map((item, i) => i === variantIndex ? { ...item, weight: Number(event.target.value) } : item) })} /></div><div className={`${styles.field} ${styles.spanAll}`}><label>Subject</label><input className={styles.control} value={variant.subject} onChange={(event) => updateStep(index, { ...step, variants: step.variants.map((item, i) => i === variantIndex ? { ...item, subject: event.target.value } : item) })} /></div><div className={`${styles.field} ${styles.spanAll}`}><label>Message body</label><textarea className={styles.textarea} value={variant.bodyHtml} onChange={(event) => updateStep(index, { ...step, variants: step.variants.map((item, i) => i === variantIndex ? { ...item, bodyHtml: event.target.value, bodyText: event.target.value } : item) })} /></div></div>)}
                <button type="button" className="btn btn-xs btn-ghost" style={{ marginTop: 10 }} onClick={() => updateStep(index, { ...step, variants: [...step.variants, { label: String.fromCharCode(65 + step.variants.length), subject: "", bodyHtml: "", bodyText: "", weight: 100 }] })}>Add variant</button>
            </div></section>)}
            <div className={styles.actions} style={{ marginTop: 12 }}><button type="button" className="btn btn-sm btn-ghost" onClick={() => setSteps((current) => [...current, emptyStep()])}>Add step</button><button type="button" className="btn btn-sm btn-primary" disabled={busy || !name.trim()} onClick={() => void create()}>{busy ? "Freezing…" : "Confirm & approve version"}</button></div>
        </Panel>
        <Panel title="Approved sequence library" description="Campaigns pin the exact selected version." flush>
            <ApiState loading={api.loading} error={api.error} empty={api.data?.sequences.length === 0} emptyTitle="No sequence versions" emptyCopy="Create and approve the first message sequence above." onRetry={api.reload}>
                <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Sequence</th><th>Status</th><th>Steps</th><th>Approved</th><th>Immutable hash</th></tr></thead><tbody>{(api.data?.sequences || []).map((sequence) => <tr key={value(sequence.id)}><td><span className={styles.primaryCell}>{value(sequence.name)} · v{value(sequence.version)}</span><span className={styles.secondary}>Created by {value(sequence.createdBy)}</span></td><td><StatusBadge value={value(sequence.status)} /></td><td>{(sequence.steps as unknown[] | undefined)?.length || 0}</td><td>{formatDate(sequence.approvedAt, true)}</td><td className={styles.mono}>{value(sequence.immutableHash).slice(0, 16)}…</td></tr>)}</tbody></table></div>
            </ApiState>
        </Panel>
        <Panel title="Template versions" description="Immutable message artifacts created by sequence approval." flush>
            <ApiState loading={api.loading} error={api.error} empty={api.data?.templates.length === 0} emptyTitle="No templates" emptyCopy="Templates appear with their approved sequence versions." onRetry={api.reload}>
                <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Template</th><th>Subject</th><th>Variables</th><th>Created</th></tr></thead><tbody>{(api.data?.templates || []).map((template) => <tr key={value(template.id)}><td><span className={styles.primaryCell}>{value(template.name)} · v{value(template.version)}</span></td><td>{value(template.subject)}</td><td className={styles.mono}>{((template.variablesUsed as string[] | undefined) || []).join(", ") || "None"}</td><td>{formatDate(template.createdAt, true)}</td></tr>)}</tbody></table></div>
            </ApiState>
        </Panel>
    </ColdEmailWorkspace>;
}
