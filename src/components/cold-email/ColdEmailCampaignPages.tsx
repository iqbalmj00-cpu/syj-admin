"use client";

import { isDynamicLeadGroup } from "@/lib/lead-group-policy";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import {
    ApiState,
    ColdEmailSavedViewPicker,
    ColdEmailWorkspace,
    EmptyState,
    Metric,
    Notice,
    PageLink,
    Panel,
    StatusBadge,
    coldEmailMutation,
    coldEmailStyles as styles,
    formatDate,
    useColdEmailApi,
} from "@/components/cold-email/ColdEmailWorkspace";
import { coldEmailCampaignReviewIssues, coldEmailSequencePreviews } from "@/lib/cold-email-campaign-review";

type RecordValue = Record<string, unknown>;
type Catalog = { leadGroups: RecordValue[]; sequences: RecordValue[]; templates: RecordValue[] };
type Infrastructure = { accounts: RecordValue[]; domains: RecordValue[]; pools: RecordValue[]; capabilities: RecordValue[] };
type Wizard = {
    details: { name: string; objective: string; ownerId: string; priority: number; successMetric: string; attribution: string };
    audience: { leadGroupId: string; refreshBeforeSnapshot: boolean; cooldownDays: number; companyContactCap: number };
    messaging: { sequenceVersionId: string };
    infrastructure: { sendingPoolId: string };
    schedule: { timezone: string; startDate: string | null; endDate: string | null; days: Record<string, boolean>; windows: Array<{ from: string; to: string }>; dailyLimit: number; dailyMaxNewLeads: number; emailGapMinutes: number; randomWaitMaxMinutes: number; respectBlackouts: boolean };
    policies: { stopOnReply: boolean; stopForCompany: boolean; stopOnAutoReply: boolean; allowRiskyContacts: boolean; bounceProtectionEnabled: boolean; openTracking: boolean; linkTracking: boolean; matchLeadEsp: boolean };
    review: { confirmed: boolean };
};

const initialWizard: Wizard = {
    details: { name: "", objective: "", ownerId: "", priority: 100, successMetric: "Qualified replies", attribution: "first_touch" },
    audience: { leadGroupId: "", refreshBeforeSnapshot: true, cooldownDays: 30, companyContactCap: 2 },
    messaging: { sequenceVersionId: "" },
    infrastructure: { sendingPoolId: "" },
    schedule: { timezone: "America/Chicago", startDate: null, endDate: null, days: { "0": false, "1": true, "2": true, "3": true, "4": true, "5": true, "6": false }, windows: [{ from: "09:00", to: "16:30" }], dailyLimit: 30, dailyMaxNewLeads: 20, emailGapMinutes: 10, randomWaitMaxMinutes: 5, respectBlackouts: true },
    policies: { stopOnReply: true, stopForCompany: true, stopOnAutoReply: false, allowRiskyContacts: false, bounceProtectionEnabled: true, openTracking: false, linkTracking: false, matchLeadEsp: true },
    review: { confirmed: false },
};

const stages = ["Campaign details", "Audience", "Messaging", "Infrastructure", "Schedule", "Safety policies", "Review & create"];

function text(value: unknown, fallback = "—") { return value === null || value === undefined || value === "" ? fallback : String(value); }
function relationCount(record: RecordValue) { return Number((record._count as RecordValue | undefined)?.members || 0); }

export function ColdEmailCampaignListPage() {
    const [status, setStatus] = useState("");
    const [search, setSearch] = useState("");
    const [cursor, setCursor] = useState<string | null>(null);
    const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
    const [columns, setColumns] = useState({ eligible: true, owner: true, updated: true });
    const query = useMemo(() => new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { search } : {}), ...(cursor ? { cursor } : {}), take: "50" }).toString(), [status, search, cursor]);
    const api = useColdEmailApi<{ items: RecordValue[]; nextCursor: string | null }>(`/api/cold-email/platform/campaigns?${query}`);
    return <ColdEmailWorkspace title="Campaigns" description="Design, approve, prepare, test, and operate immutable campaign versions from one auditable lifecycle." actions={<><a className="btn btn-sm btn-ghost" href="/api/cold-email/platform/export?surface=campaigns">Export CSV</a><PageLink href="/cold-email/campaigns/new" primary>New campaign</PageLink></>}>
        <div className={styles.toolbar}><div className={styles.controls}><input className={styles.control} aria-label="Search campaigns" placeholder="Search campaigns" value={search} onChange={(event) => { setSearch(event.target.value); setCursor(null); setCursorHistory([]); }} /><select className={styles.control} aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); setCursor(null); setCursorHistory([]); }}><option value="">All statuses</option>{["draft", "scheduled", "active", "paused", "completed", "archived"].map((value) => <option key={value}>{value}</option>)}</select><ColdEmailSavedViewPicker surface="campaigns" currentFilters={{ search, status }} currentColumns={columns} onApply={(view) => { const filters = view.filters || {}; setSearch(typeof filters.search === "string" ? filters.search : ""); setStatus(typeof filters.status === "string" ? filters.status : ""); if (view.columns) setColumns((current) => ({ eligible: typeof view.columns?.eligible === "boolean" ? view.columns.eligible : current.eligible, owner: typeof view.columns?.owner === "boolean" ? view.columns.owner : current.owner, updated: typeof view.columns?.updated === "boolean" ? view.columns.updated : current.updated })); setCursor(null); setCursorHistory([]); }} /><details><summary className="btn btn-xs btn-ghost">Columns</summary><div className={styles.listItem} style={{ position: "absolute", zIndex: 5 }}>{Object.entries(columns).map(([key, shown]) => <Check key={key} label={key} checked={shown} onChange={(checked) => setColumns((current) => ({ ...current, [key]: checked }))} />)}</div></details></div><span className={styles.listMeta}>{api.data?.items.length ?? 0} campaigns on this page</span></div>
        <Panel flush>
            <ApiState loading={api.loading} error={api.error} empty={api.data?.items.length === 0} emptyTitle="No campaigns match" emptyCopy="Change the filters or create a new campaign." onRetry={api.reload}>
                <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Campaign</th><th>Status</th><th>Health</th><th>Version</th>{columns.eligible && <th>Eligible</th>}{columns.owner && <th>Owner</th>}{columns.updated && <th>Updated</th>}</tr></thead><tbody>{(api.data?.items || []).map((campaign) => {
                    const activeVersion = campaign.activeVersion as RecordValue | null;
                    const latest = (campaign.versions as RecordValue[] | undefined)?.[0];
                    const audience = activeVersion?.audienceSnapshot as RecordValue | undefined;
                    return <tr key={text(campaign.id)}><td><Link href={`/cold-email/campaigns/${campaign.id}`} className={styles.primaryCell}>{text(campaign.name)}</Link><span className={styles.secondary}>{text(campaign.objective, "No objective")}</span></td><td><StatusBadge value={text(campaign.status)} /></td><td><StatusBadge value={text(campaign.health)} /></td><td>v{text(activeVersion?.version ?? latest?.version)}</td>{columns.eligible && <td>{text(audience?.eligibleCount)}</td>}{columns.owner && <td>{text(campaign.ownerId)}</td>}{columns.updated && <td>{formatDate(campaign.updatedAt, true)}</td>}</tr>;
                })}</tbody></table></div>
            </ApiState>
            <div className={styles.toolbar} style={{ padding: 14 }}><button className="btn btn-xs btn-ghost" disabled={cursorHistory.length === 0 || api.loading} onClick={() => { const previous = cursorHistory.at(-1) ?? null; setCursorHistory((current) => current.slice(0, -1)); setCursor(previous); }}>Previous page</button><button className="btn btn-xs btn-ghost" disabled={!api.data?.nextCursor || api.loading} onClick={() => { setCursorHistory((current) => [...current, cursor]); setCursor(api.data?.nextCursor || null); }}>Next page</button></div>
        </Panel>
    </ColdEmailWorkspace>;
}

function Field({ label, help, children, span = false }: { label: string; help?: string; children: React.ReactNode; span?: boolean }) {
    return <div className={`${styles.field} ${span ? styles.spanAll : ""}`}><label>{label}</label>{children}{help && <span className={styles.fieldHelp}>{help}</span>}</div>;
}

function Check({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
    return <label className={styles.inline}><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span className={styles.fieldLabel}>{label}</span></label>;
}

export function ColdEmailCampaignWizardPage() {
    const router = useRouter();
    const catalog = useColdEmailApi<Catalog>("/api/cold-email/platform/catalog");
    const infrastructure = useColdEmailApi<Infrastructure>("/api/cold-email/platform/infrastructure");
    const [stage, setStage] = useState(0);
    const [wizard, setWizard] = useState<Wizard>(initialWizard);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const selectedGroup = (catalog.data?.leadGroups || []).find(group => group.id === wizard.audience.leadGroupId);
    const dynamicGroup = isDynamicLeadGroup(selectedGroup?.filterDefinition);
    const selectedSequence = (catalog.data?.sequences || []).find((sequence) => sequence.id === wizard.messaging.sequenceVersionId) || null;
    const selectedPool = (infrastructure.data?.pools || []).find((pool) => pool.id === wizard.infrastructure.sendingPoolId) || null;
    const sequencePreviews = useMemo(() => coldEmailSequencePreviews(selectedSequence), [selectedSequence]);
    const reviewIssues = useMemo(() => coldEmailCampaignReviewIssues({ wizard, sequence: selectedSequence, pool: selectedPool }), [wizard, selectedSequence, selectedPool]);
    const setSection = <K extends keyof Wizard>(key: K, value: Wizard[K]) => setWizard((current) => ({ ...current, [key]: value }));
    async function create(event: FormEvent) {
        event.preventDefault();
        if (stage < 6) { setStage((value) => value + 1); return; }
        if (reviewIssues.length) { setError(reviewIssues.map((issue) => `Stage ${issue.stage}: ${issue.message}`).join("; ")); return; }
        setSubmitting(true); setError(null);
        try {
            const response = await coldEmailMutation<{ campaign: { id: string } }>("/api/cold-email/platform/campaigns", { wizard });
            router.push(`/cold-email/campaigns/${response.campaign.id}`);
        } catch (mutationError) { setError(mutationError instanceof Error ? mutationError.message : "Campaign creation failed"); }
        finally { setSubmitting(false); }
    }
    return <ColdEmailWorkspace title="Create campaign" description="A seven-stage launch gate that freezes audience, messaging, infrastructure, schedule, and operator-approved policies into one version." actions={<PageLink href="/cold-email/campaigns">Cancel</PageLink>}>
        {error && <Notice title="Campaign cannot be created" tone="danger">{error}</Notice>}
        {(catalog.error || infrastructure.error) && <Notice title="Required catalog data is unavailable" tone="warning">{catalog.error || infrastructure.error}. The wizard remains editable, but creation will be blocked until canonical persistence is ready.</Notice>}
        <form className={styles.wizard} onSubmit={create}>
            <nav className={styles.steps} aria-label="Campaign creation stages">{stages.map((label, index) => <button className={`${styles.step} ${stage === index ? styles.stepActive : ""}`} type="button" key={label} onClick={() => setStage(index)} aria-current={stage === index ? "step" : undefined}><span className={styles.stepNumber}>{index + 1}</span><span className={styles.stepLabel}>{label}</span></button>)}</nav>
            <Panel title={`${stage + 1}. ${stages[stage]}`} description="Fields in this stage become source-defined campaign policy after approval.">
                {stage === 0 && <div className={styles.formGrid}>
                    <Field label="Campaign name"><input required className={styles.control} value={wizard.details.name} onChange={(e) => setSection("details", { ...wizard.details, name: e.target.value })} /></Field>
                    <Field label="Owner ID" help="Use the operator identifier responsible for this campaign."><input required className={styles.control} value={wizard.details.ownerId} onChange={(e) => setSection("details", { ...wizard.details, ownerId: e.target.value })} /></Field>
                    <Field label="Objective" span><textarea required className={styles.textarea} value={wizard.details.objective} onChange={(e) => setSection("details", { ...wizard.details, objective: e.target.value })} /></Field>
                    <Field label="Success metric"><input required className={styles.control} value={wizard.details.successMetric} onChange={(e) => setSection("details", { ...wizard.details, successMetric: e.target.value })} /></Field>
                    <Field label="Priority"><input type="number" min="1" className={styles.control} value={wizard.details.priority} onChange={(e) => setSection("details", { ...wizard.details, priority: Number(e.target.value) })} /></Field>
                </div>}
                {stage === 1 && <div className={styles.formGrid}>
                    <Field label="Lead Group" help="Approval freezes group membership. Eligibility evaluation follows approval."><select required className={styles.control} value={wizard.audience.leadGroupId} onChange={(e) => setSection("audience", { ...wizard.audience, leadGroupId: e.target.value, refreshBeforeSnapshot: isDynamicLeadGroup(catalog.data?.leadGroups.find(group => group.id === e.target.value)?.filterDefinition) })}><option value="">Choose a Lead Group</option>{(catalog.data?.leadGroups || []).map((group) => <option key={text(group.id)} value={text(group.id)}>{text(group.name)} ({relationCount(group)})</option>)}</select></Field>
                    <Field label="Cooldown days"><input type="number" min="0" className={styles.control} value={wizard.audience.cooldownDays} onChange={(e) => setSection("audience", { ...wizard.audience, cooldownDays: Number(e.target.value) })} /></Field>
                    <Field label="Contacts per company"><input type="number" min="1" className={styles.control} value={wizard.audience.companyContactCap} onChange={(e) => setSection("audience", { ...wizard.audience, companyContactCap: Number(e.target.value) })} /></Field>
                    <Field label="Snapshot refresh" help={dynamicGroup ? "After creating the draft, refresh this dynamic group from the campaign detail page before approval." : "Static membership is manually curated. Review it before approval; no refresh is required."}><Check label="Require a dynamic group refresh after draft creation" disabled={!dynamicGroup} checked={dynamicGroup && wizard.audience.refreshBeforeSnapshot} onChange={(value) => setSection("audience", { ...wizard.audience, refreshBeforeSnapshot: value })} /></Field>
                </div>}
                {stage === 2 && <div className={styles.formGrid}>
                    <Field label="Approved sequence version" help="Only the selected immutable sequence version will be projected to the provider." span><select required className={styles.control} value={wizard.messaging.sequenceVersionId} onChange={(e) => setSection("messaging", { sequenceVersionId: e.target.value })}><option value="">Choose a sequence</option>{(catalog.data?.sequences || []).map((sequence) => <option key={text(sequence.id)} value={text(sequence.id)} disabled={sequence.status !== "approved"}>{text(sequence.name)} · v{text(sequence.version)} · {text(sequence.status)}</option>)}</select></Field>
                    <Notice title="Message source of truth">Templates and sequence steps are immutable after approval. Create a new version to change copy.</Notice>
                    {sequencePreviews.length > 0 && <div className={`${styles.list} ${styles.spanAll}`}>{sequencePreviews.map((preview) => <div className={styles.listItem} key={preview.key}><div className={styles.listTop}><span className={styles.listTitle}>Step {preview.stepOrder} · Variant {preview.label}</span><StatusBadge value="approved" /></div><span className={styles.listMeta}>Delay {preview.delayDays} days {preview.delayHours} hours · weight {preview.weight} · variables {preview.variables.join(", ") || "none"}</span><strong style={{ marginTop: 8 }}>{preview.subject}</strong><pre className={styles.mono} style={{ marginTop: 6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{preview.body || "No text preview"}</pre></div>)}</div>}
                </div>}
                {stage === 3 && <div className={styles.formGrid}>
                    <Field label="Sending pool" span><select required className={styles.control} value={wizard.infrastructure.sendingPoolId} onChange={(e) => setSection("infrastructure", { sendingPoolId: e.target.value })}><option value="">Choose a sending pool</option>{(infrastructure.data?.pools || []).map((pool) => <option key={text(pool.id)} value={text(pool.id)} disabled={pool.active === false}>{text(pool.name)} · {(pool.memberships as unknown[] | undefined)?.length || 0} mailboxes</option>)}</select></Field>
                    <Notice title="Capacity is fail closed" tone="warning">Every mailbox must be ready and every sender domain must have an explicit daily cap. Missing warmup volume is treated as unknown, never zero.</Notice>
                    {selectedPool && <div className={`${styles.list} ${styles.spanAll}`}>{((selectedPool.memberships as RecordValue[] | undefined) || []).map((membership) => { const account = membership.sendingAccount as RecordValue | undefined; return <div className={styles.listItem} key={text(membership.id)}><div className={styles.listTop}><span className={styles.listTitle}>{text(account?.email)}</span><StatusBadge value={account?.localReviewRequired ? "blocked" : text(account?.readiness)} /></div><span className={styles.listMeta}>Reply-To {text(account?.replyTo, "same as mailbox")} · membership priority {text(membership.priority)}</span>{account?.signature ? <pre className={styles.mono} style={{ marginTop: 6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{text(account.signature)}</pre> : null}</div>; })}</div>}
                </div>}
                {stage === 4 && <div className={styles.formGridWide}>
                    <Field label="Timezone"><input required className={styles.control} value={wizard.schedule.timezone} onChange={(e) => setSection("schedule", { ...wizard.schedule, timezone: e.target.value })} /></Field>
                    <Field label="Start date"><input type="date" className={styles.control} value={wizard.schedule.startDate || ""} onChange={(e) => setSection("schedule", { ...wizard.schedule, startDate: e.target.value || null })} /></Field>
                    <Field label="End date"><input type="date" className={styles.control} value={wizard.schedule.endDate || ""} onChange={(e) => setSection("schedule", { ...wizard.schedule, endDate: e.target.value || null })} /></Field>
                    {wizard.schedule.windows.map((window, index) => <div className={`${styles.formGrid} ${styles.spanAll}`} key={index}><Field label={`Window ${index + 1} from`}><input type="time" className={styles.control} value={window.from} onChange={(e) => setSection("schedule", { ...wizard.schedule, windows: wizard.schedule.windows.map((item, itemIndex) => itemIndex === index ? { ...item, from: e.target.value } : item) })} /></Field><Field label={`Window ${index + 1} to`}><div className={styles.actions}><input type="time" className={styles.control} value={window.to} onChange={(e) => setSection("schedule", { ...wizard.schedule, windows: wizard.schedule.windows.map((item, itemIndex) => itemIndex === index ? { ...item, to: e.target.value } : item) })} />{wizard.schedule.windows.length > 1 && <button type="button" className="btn btn-xs btn-ghost" onClick={() => setSection("schedule", { ...wizard.schedule, windows: wizard.schedule.windows.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>}</div></Field></div>)}
                    <div className={styles.spanAll}><button type="button" className="btn btn-xs btn-ghost" onClick={() => setSection("schedule", { ...wizard.schedule, windows: [...wizard.schedule.windows, { from: "09:00", to: "12:00" }] })}>Add sending window</button></div>
                    <Field label="Daily limit"><input type="number" min="1" className={styles.control} value={wizard.schedule.dailyLimit} onChange={(e) => setSection("schedule", { ...wizard.schedule, dailyLimit: Number(e.target.value) })} /></Field>
                    <Field label="New leads per day"><input type="number" min="0" className={styles.control} value={wizard.schedule.dailyMaxNewLeads} onChange={(e) => setSection("schedule", { ...wizard.schedule, dailyMaxNewLeads: Number(e.target.value) })} /></Field>
                    <Field label="Email gap (minutes)"><input type="number" min="1" className={styles.control} value={wizard.schedule.emailGapMinutes} onChange={(e) => setSection("schedule", { ...wizard.schedule, emailGapMinutes: Number(e.target.value) })} /></Field>
                    <Field label="Random wait max"><input type="number" min="0" className={styles.control} value={wizard.schedule.randomWaitMaxMinutes} onChange={(e) => setSection("schedule", { ...wizard.schedule, randomWaitMaxMinutes: Number(e.target.value) })} /></Field>
                    <Field label="Sending days" span><div className={styles.inline}>{Object.entries(wizard.schedule.days).map(([day, enabled]) => <Check key={day} label={["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][Number(day)] ?? day} checked={enabled} onChange={(value) => setSection("schedule", { ...wizard.schedule, days: { ...wizard.schedule.days, [day]: value } })} />)}</div></Field>
                </div>}
                {stage === 5 && <div className={styles.formGrid}>
                    <Check label="Stop on human reply (required)" checked={wizard.policies.stopOnReply} disabled onChange={() => undefined} />
                    <Check label="Bounce protection (required)" checked={wizard.policies.bounceProtectionEnabled} disabled onChange={() => undefined} />
                    <Check label="Stop other contacts at the company" checked={wizard.policies.stopForCompany} onChange={(value) => setSection("policies", { ...wizard.policies, stopForCompany: value })} />
                    <Check label="Stop on automatic reply" checked={wizard.policies.stopOnAutoReply} onChange={(value) => setSection("policies", { ...wizard.policies, stopOnAutoReply: value })} />
                    <Check label="Provider risky-contact option (local eligibility still requires verified-deliverable email)" checked={wizard.policies.allowRiskyContacts} onChange={(value) => setSection("policies", { ...wizard.policies, allowRiskyContacts: value })} />
                    <Check label="Match lead email provider" checked={wizard.policies.matchLeadEsp} onChange={(value) => setSection("policies", { ...wizard.policies, matchLeadEsp: value })} />
                    <Check label="Open tracking" checked={wizard.policies.openTracking} onChange={(value) => setSection("policies", { ...wizard.policies, openTracking: value })} />
                    <Check label="Link tracking" checked={wizard.policies.linkTracking} onChange={(value) => setSection("policies", { ...wizard.policies, linkTracking: value })} />
                </div>}
                {stage === 6 && <div className={styles.list}>
                    <div className={styles.metricGrid}><Metric label="Campaign" value={wizard.details.name || "Unnamed"} sub={wizard.details.objective || "No objective"} /><Metric label="Audience" value={(catalog.data?.leadGroups || []).find((group) => group.id === wizard.audience.leadGroupId)?.name as string || "Not selected"} sub={`${wizard.audience.cooldownDays}-day cooldown`} /><Metric label="Volume" value={wizard.schedule.dailyMaxNewLeads} sub={`${wizard.schedule.dailyLimit} maximum sends/day`} /><Metric label="Timezone" value={wizard.schedule.timezone} sub={`${wizard.schedule.windows[0].from}–${wizard.schedule.windows[0].to}`} /></div>
                    <Notice title="Creation does not send email">The new campaign starts as a draft. Refresh the dynamic group if required, approve to freeze membership, wait for eligibility evaluation, forecast and reserve capacity, prepare, reconcile provider operations, test this version, then activate.</Notice>
                    {reviewIssues.length ? reviewIssues.map((issue) => <Notice title={`Stage ${issue.stage} is blocked`} tone="danger" key={issue.code}>{issue.message}</Notice>) : <Notice title="Launch definition is internally complete" tone="success">The selected audience, approved sequence, ready sending pool, schedule, and required safety policies have source-defined review evidence. Provider capability, capacity reservation, test, and final activation remain separate gates.</Notice>}
                    {sequencePreviews.length > 0 && <details><summary className="btn btn-xs btn-ghost">Representative message previews</summary><div className={styles.list} style={{ marginTop: 8 }}>{sequencePreviews.map((preview) => <div className={styles.listItem} key={preview.key}><strong>Step {preview.stepOrder} · {preview.label} · {preview.subject}</strong><pre className={styles.mono} style={{ marginTop: 6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{preview.body || "No text preview"}</pre></div>)}</div></details>}
                    <Check label="I confirm this campaign definition is ready to create" checked={wizard.review.confirmed} onChange={(value) => setSection("review", { confirmed: value })} />
                </div>}
                <div className={styles.toolbar} style={{ marginTop: 18 }}><button type="button" className="btn btn-sm btn-ghost" disabled={stage === 0} onClick={() => setStage((value) => Math.max(0, value - 1))}>Back</button><button type="submit" className="btn btn-sm btn-primary" disabled={submitting || (stage === 6 && (!wizard.review.confirmed || reviewIssues.length > 0))}>{submitting ? "Creating…" : stage === 6 ? "Create draft campaign" : "Continue"}</button></div>
            </Panel>
        </form>
    </ColdEmailWorkspace>;
}

export function ColdEmailCampaignDetailPage() {
    const params = useParams<{ id: string }>();
    const id = params.id;
    const api = useColdEmailApi<{ campaign: RecordValue }>(id ? `/api/cold-email/platform/campaigns/${encodeURIComponent(id)}` : null);
    const [busy, setBusy] = useState<string | null>(null);
    const [message, setMessage] = useState<{ tone: "danger" | "success" | "warning"; text: string } | null>(null);
    const [recipient, setRecipient] = useState("");
    const [sendingAccountId, setSendingAccountId] = useState("");
    const [capacityDate, setCapacityDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [capacity, setCapacity] = useState<RecordValue | null>(null);
    const [audienceStatus, setAudienceStatus] = useState("");
    const [audienceReason, setAudienceReason] = useState("");
    const [audienceSearch, setAudienceSearch] = useState("");
    const [audienceCursor, setAudienceCursor] = useState<string | null>(null);
    const [audienceCursorHistory, setAudienceCursorHistory] = useState<Array<string | null>>([]);
    const audienceQuery = useMemo(() => new URLSearchParams({
        take: "50",
        ...(audienceStatus ? { status: audienceStatus } : {}),
        ...(audienceReason ? { ruleCode: audienceReason } : {}),
        ...(audienceSearch ? { search: audienceSearch } : {}),
        ...(audienceCursor ? { cursor: audienceCursor } : {}),
    }).toString(), [audienceStatus, audienceReason, audienceSearch, audienceCursor]);
    const audienceEvidence = useColdEmailApi<{ audience: RecordValue; diagnosis: RecordValue }>(id ? `/api/cold-email/platform/campaigns/${encodeURIComponent(id)}/audience?${audienceQuery}` : null);
    const campaign = api.data?.campaign;
    const versions = (campaign?.versions as RecordValue[] | undefined) || [];
    const version = versions[0];
    async function action(name: string) {
        if (!campaign || !version) return;
        setBusy(name); setMessage(null);
        try {
            await coldEmailMutation(`/api/cold-email/platform/campaigns/${encodeURIComponent(id)}/actions`, { action: name, confirm: true, versionId: version.id, ...(name === "test" ? { recipient, sendingAccountId } : {}) });
            setMessage({ tone: "success", text: `${name.replaceAll("_", " ")} was accepted and recorded.` });
            await Promise.all([api.reload(), audienceEvidence.reload()]);
        } catch (error) { setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Campaign action failed" }); }
        finally { setBusy(null); }
    }
    async function capacityAction(reserve: boolean) {
        if (!version) return;
        setBusy(reserve ? "reserve_capacity" : "forecast_capacity"); setMessage(null);
        try {
            const result = await coldEmailMutation<RecordValue>("/api/cold-email/platform/infrastructure", { action: reserve ? "reserve" : "forecast", campaignVersionId: version.id, dateKey: capacityDate });
            setCapacity(result); setMessage({ tone: "success", text: reserve ? "Capacity was reserved for the selected campaign date." : "Capacity forecast refreshed." });
        } catch (error) { setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Capacity action failed" }); }
        finally { setBusy(null); }
    }
    const rules = (version?.operationalRules as RecordValue | undefined)?.wizard as RecordValue | undefined;
    const audience = version?.audienceSnapshot as RecordValue | undefined;
    const operations = (version?.providerOperations as RecordValue[] | undefined) || [];
    const audienceEvidenceRows = (audienceEvidence.data?.audience.items as RecordValue[] | undefined) || [];
    const audienceReasonCounts = (audienceEvidence.data?.audience.reasonCounts as RecordValue[] | undefined) || [];
    const diagnosis = audienceEvidence.data?.diagnosis;
    const diagnosisIssues = (diagnosis?.issues as RecordValue[] | undefined) || [];
    const diagnosisFacts = diagnosis?.facts as RecordValue | undefined;
    const sendingPoolFacts = diagnosisFacts?.sendingPool as RecordValue | null | undefined;
    const capacityFacts = diagnosisFacts?.capacity as RecordValue | undefined;
    const timezoneGroupFacts = (diagnosisFacts?.timezoneGroups as RecordValue[] | undefined) || [];
    const audienceRules = rules?.audience as RecordValue | undefined;
    async function refreshAudienceGroup() {
        if (!audienceRules?.leadGroupId) return;
        setBusy("refresh_group"); setMessage(null);
        try {
            const result = await coldEmailMutation<{ total: number }>("/api/agents/lead-groups/refresh", { groupId: audienceRules.leadGroupId });
            setMessage({ tone: "success", text: `Group refresh confirmed: ${result.total} members. Review membership before approving.` });
            await api.reload();
        } catch (error) { setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Group refresh failed" }); }
        finally { setBusy(null); }
    }
    function actionBlock(name: string): string | null {
        if (name === "approve") return version?.status !== "draft" ? "Only a draft can be approved" : null;
        if (name === "prepare") {
            if (version?.status !== "approved") return "Approve this version first";
            if (audienceEvidence.loading || audienceEvidence.error || !diagnosis) return "Reload audience eligibility and capacity evidence";
            const blocker = diagnosisIssues.find(issue => ["audience_not_frozen", "audience_evaluation_pending", "no_eligible_audience", "capacity_not_reserved", "capacity_uncertain"].includes(String(issue.code)));
            return blocker ? String(blocker.detail) : null;
        }
        if (name === "activate" || name === "resume") {
            if (campaign?.status !== (name === "resume" ? "paused" : "scheduled")) return name === "resume" ? "Only a paused campaign can resume" : "Finish preparation and provider reconciliation first";
            if (version?.testState !== "confirmed" || version?.testedFingerprint !== version?.immutableHash) return "Confirm a test of this exact version first";
        }
        if (name === "pause" && !["active", "scheduled"].includes(String(campaign?.status))) return "Only active or scheduled campaigns can pause";
        if (name === "complete" && !["active", "paused"].includes(String(campaign?.status))) return "Only active or paused campaigns can complete";
        if (name === "archive" && !["draft", "scheduled", "paused", "completed"].includes(String(campaign?.status))) return "Pause an active campaign before archiving";
        return null;
    }
    const totalCapacityAllocated = ((capacity?.allocations as RecordValue[] | undefined) || []).reduce((sum, row) => sum + Number(row.followUpAllocated || 0) + Number(row.newLeadAllocated || 0), 0);
    return <ColdEmailWorkspace title={text(campaign?.name, "Campaign")} description={text(campaign?.objective, "Campaign lifecycle, immutable version, provider projection, and recovery evidence.")} actions={<PageLink href="/cold-email/campaigns">All campaigns</PageLink>}>
        {message && <Notice title={message.tone === "success" ? "Action recorded" : "Action blocked"} tone={message.tone}>{message.text}</Notice>}
        <ApiState loading={api.loading} error={api.error} empty={!campaign && !api.loading} emptyTitle="Campaign not found" emptyCopy="The campaign may have been removed or is not accessible." onRetry={api.reload}>
            {campaign && <>
                <div className={styles.metricGrid}><Metric label="Lifecycle" value={<StatusBadge value={text(campaign.status)} />} sub={`Version record ${text(campaign.recordVersion)}`} /><Metric label="Health" value={<StatusBadge value={text(campaign.health)} />} /><Metric label="Latest version" value={`v${text(version?.version)}`} sub={text(version?.status)} /><Metric label="Test state" value={<StatusBadge value={text(version?.testState)} />} sub={version?.lastTestedAt ? formatDate(version.lastTestedAt, true) : "No version-bound test"} /><Metric label="Eligible audience" value={text(audience?.eligibleCount)} sub={`${text(audience?.excludedCount, "0")} excluded`} /><Metric label="Last updated" value={formatDate(campaign.updatedAt)} /></div>
                <Panel title="Lifecycle actions" description="Every action requires explicit confirmation. Provider-changing actions stay blocked until canonical cutover and the mutation kill switch are both enabled.">
                    <p className={styles.listMeta}>Approve → eligibility evaluation → forecast and reserve capacity → prepare → provider reconciliation → controlled test → activate. Server checks remain required at each step.</p>
                    {version?.status === "draft" && audienceRules?.refreshBeforeSnapshot === true && <div className={styles.actions}><button className="btn btn-sm btn-ghost" disabled={busy !== null} onClick={() => void refreshAudienceGroup()}>Refresh audience group</button><PageLink href="/cold-email/lead-groups">Review membership</PageLink><span className={styles.listMeta}>A dynamic group refresh is required after draft creation. Static drafts with this setting must be corrected or recreated with refresh off.</span></div>}
                    <div className={styles.actions}>{["approve", "prepare", "activate", "pause", "resume", "complete", "archive"].map((name) => <button className={`btn btn-sm ${name === "activate" ? "btn-primary" : "btn-ghost"}`} key={name} title={actionBlock(name) || undefined} disabled={busy !== null || Boolean(actionBlock(name))} onClick={() => void action(name)}>{busy === name ? "Working…" : name.replaceAll("_", " ")}</button>)}</div>
                    <div className={styles.formGrid} style={{ marginTop: 14 }}><Field label="Test recipient"><input className={styles.control} type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="approved test address" /></Field><Field label="Sending account ID"><input className={styles.control} value={sendingAccountId} onChange={(event) => setSendingAccountId(event.target.value)} placeholder="ready mailbox ID" /></Field></div>
                    <button className="btn btn-sm btn-ghost" style={{ marginTop: 10 }} disabled={busy !== null || !recipient || !sendingAccountId || version?.status !== "scheduled"} onClick={() => void action("test")}>{busy === "test" ? "Queuing…" : "Queue controlled test"}</button>
                </Panel>
                <Panel title="Capacity forecast & reservation" description="Follow-ups are allocated first. New leads consume only the remaining ready mailbox and sender-domain capacity.">
                    <div className={styles.actions}><input className={styles.control} aria-label="Capacity date" type="date" value={capacityDate} onChange={(event) => setCapacityDate(event.target.value)} /><button className="btn btn-sm btn-ghost" disabled={busy !== null} onClick={() => void capacityAction(false)}>Forecast</button><button className="btn btn-sm btn-primary" disabled={busy !== null} onClick={() => void capacityAction(true)}>Confirm reservation</button></div>
                    {capacity && <div className={styles.metricGrid} style={{ marginTop: 12 }}><Metric label="Demand" value={text(capacity.demand)} /><Metric label="Allocated" value={totalCapacityAllocated} /><Metric label="New-lead shortfall" value={text(capacity.newLeadShortfall)} /><Metric label="State" value={<StatusBadge value={text(capacity.dataState)} />} sub={capacity.reserved ? "Reservation persisted" : "Preview only"} /></div>}
                    {Array.isArray(capacity?.limitations) && capacity.limitations.length > 0 && <Notice title="Capacity limitations" tone="warning">{capacity.limitations.map((item) => String(item)).join("; ")}</Notice>}
                </Panel>
                <div className={styles.split}>
                    <Panel title="Frozen version policy" description="The selected version is the Admin source of truth."><pre className={styles.mono} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(rules || {}, null, 2)}</pre></Panel>
                    <Panel title="Audience snapshot" description="Eligibility and exclusion counts frozen during preparation.">{audience ? <div className={styles.metricGrid}><Metric label="Total" value={text(audience.totalCount)} /><Metric label="Eligible" value={text(audience.eligibleCount)} /><Metric label="Excluded" value={text(audience.excludedCount)} /><Metric label="Frozen" value={formatDate(audience.frozenAt, true)} /></div> : <EmptyState title="Audience not frozen" copy="Prepare the campaign after its draft definition is complete." />}</Panel>
                </div>
                <Panel title="Diagnose sending" description={`Canonical launch and sending evidence as of ${formatDate(diagnosis?.asOf, true)}. External provider behavior is shown only when synchronized into a source record.`}>
                    <ApiState loading={audienceEvidence.loading} error={audienceEvidence.error} empty={!diagnosis && !audienceEvidence.loading} emptyTitle="Diagnosis unavailable" emptyCopy="The campaign version has no canonical diagnostic snapshot yet." onRetry={audienceEvidence.reload}>
                        {diagnosis && <>
                            <div className={styles.metricGrid}>
                                <Metric label="Ready mailboxes" value={text(sendingPoolFacts?.readyAccountCount)} sub={`${text(sendingPoolFacts?.accountCount, "0")} in frozen pool`} />
                                <Metric label="Reserved follow-ups" value={text(capacityFacts?.followUpReserved, "0")} sub={`${text(capacityFacts?.newLeadReserved, "0")} new leads`} />
                                <Metric label="Unknown capacity" value={text(capacityFacts?.uncertainCount, "0")} />
                                <Metric label="Timezone groups" value={timezoneGroupFacts.length} sub={`${text(diagnosisFacts?.timezoneFallbackCount, "0")} campaign-timezone fallbacks`} />
                                <Metric label="Diagnostic time" value={formatDate(diagnosis.diagnosticInstant, true)} />
                            </div>
                            {timezoneGroupFacts.length > 0 && <div className={styles.list} style={{ marginTop: 14 }}>{timezoneGroupFacts.map((group) => <div className={styles.listItem} key={text(group.id)}><div className={styles.listTop}><span className={styles.listTitle}>{text(group.timezone)}</span><StatusBadge value={text(group.status)} /></div><span className={styles.listMeta}>{text(group.enrollmentCount, "0")} contacts · source evidence {Object.entries((group.sources as Record<string, unknown> | undefined) || {}).map(([source, count]) => `${source.replaceAll("_", " ")} ${String(count)}`).join(", ") || "unavailable"}</span><span className={styles.listMeta}>Provider campaign {text((group.providerMapping as RecordValue | undefined)?.providerObjectId, "not confirmed")}</span></div>)}</div>}
                            <div className={styles.list} style={{ marginTop: 14 }}>
                                {diagnosisIssues.length ? diagnosisIssues.map((issue) => <Notice key={text(issue.code)} title={text(issue.title)} tone={issue.severity === "blocking" ? "danger" : issue.severity === "warning" ? "warning" : "info"}>{text(issue.detail)}</Notice>) : <Notice title="No source-defined blockers" tone="success">Current canonical records show no launch blocker. This does not assert deployment or live-provider success.</Notice>}
                            </div>
                        </>}
                    </ApiState>
                </Panel>
                <Panel title="Audience eligibility evidence" description="Every frozen contact retains its primary decision, recent decision history, provider enrollment state, and sanitized evidence used by the rule.">
                    <div className={styles.toolbar}>
                        <div className={styles.controls}>
                            <input className={styles.control} aria-label="Search campaign audience" placeholder="Search company, contact, or email" value={audienceSearch} onChange={(event) => { setAudienceSearch(event.target.value); setAudienceCursor(null); setAudienceCursorHistory([]); }} />
                            <select className={styles.control} aria-label="Filter audience status" value={audienceStatus} onChange={(event) => { setAudienceStatus(event.target.value); setAudienceCursor(null); setAudienceCursorHistory([]); }}><option value="">All audience states</option>{["pending", "evaluating", "eligible", "excluded"].map((value) => <option key={value}>{value}</option>)}</select>
                            <select className={styles.control} aria-label="Filter exclusion reason" value={audienceReason} onChange={(event) => { setAudienceReason(event.target.value); setAudienceCursor(null); setAudienceCursorHistory([]); }}><option value="">All exclusion reasons</option>{audienceReasonCounts.map((row) => <option key={text(row.ruleCode)} value={text(row.ruleCode)}>{text(row.ruleCode).replaceAll("_", " ")} ({text(row.count)})</option>)}</select>
                        </div>
                        <span className={styles.listMeta}>{audienceEvidenceRows.length} contacts on this page</span>
                    </div>
                    {audienceReasonCounts.length > 0 && <div className={styles.actions} style={{ marginBottom: 12 }}>{audienceReasonCounts.map((row) => <button type="button" className="btn btn-xs btn-ghost" key={text(row.ruleCode)} onClick={() => { setAudienceReason(text(row.ruleCode)); setAudienceCursor(null); setAudienceCursorHistory([]); }}>{text(row.ruleCode).replaceAll("_", " ")} · {text(row.count)}</button>)}</div>}
                    <ApiState loading={audienceEvidence.loading} error={audienceEvidence.error} empty={audienceEvidenceRows.length === 0} emptyTitle="No audience members match" emptyCopy="Change the evidence filters or approve the version to freeze an audience." onRetry={audienceEvidence.reload}>
                        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Contact</th><th>Audience state</th><th>Primary decision</th><th>Enrollment</th><th>Evidence</th><th>Evaluated</th></tr></thead><tbody>{audienceEvidenceRows.map((member) => {
                            const lead = member.sourceLead as RecordValue | undefined;
                            const contact = member.contact as RecordValue | undefined;
                            const company = member.company as RecordValue | undefined;
                            const identity = member.emailIdentity as RecordValue | undefined;
                            const decision = (member.eligibilityDecisions as RecordValue[] | undefined)?.[0];
                            const enrollment = (member.enrollments as RecordValue[] | undefined)?.[0];
                            const snapshot = member.variablesSnapshot as RecordValue | undefined;
                            const timezoneGroup = enrollment?.timezoneGroup as RecordValue | undefined;
                            return <tr key={text(member.id)}><td><span className={styles.primaryCell}>{text(contact?.fullName || lead?.name || snapshot?.ownerName, "Unknown contact")}</span><span className={styles.secondary}>{text(company?.name || lead?.name || snapshot?.name)} · {text(identity?.normalizedEmail || lead?.email || snapshot?.email)}</span></td><td><StatusBadge value={text(member.status)} /></td><td><span className={styles.primaryCell}>{text(member.decisionCode || decision?.ruleCode).replaceAll("_", " ")}</span><span className={styles.secondary}>{text(decision?.category)}</span></td><td><StatusBadge value={text(enrollment?.status, "not created")} />{timezoneGroup ? <span className={styles.secondary}>{text(timezoneGroup.timezone)} · {text(enrollment?.timezoneSource).replaceAll("_", " ")}</span> : null}{enrollment?.stopReason ? <span className={styles.secondary}>{text(enrollment.stopReason).replaceAll("_", " ")}</span> : null}</td><td>{decision?.evidence ? <details><summary className="btn btn-xs btn-ghost">View evidence</summary><pre className={styles.mono} style={{ marginTop: 8, whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxWidth: 420 }}>{JSON.stringify(decision.evidence, null, 2)}</pre></details> : "—"}</td><td>{formatDate(member.evaluatedAt || decision?.evaluatedAt, true)}</td></tr>;
                        })}</tbody></table></div>
                    </ApiState>
                    <div className={styles.toolbar} style={{ marginTop: 12 }}><button className="btn btn-xs btn-ghost" disabled={audienceCursorHistory.length === 0 || audienceEvidence.loading} onClick={() => { const previous = audienceCursorHistory.at(-1) ?? null; setAudienceCursorHistory((current) => current.slice(0, -1)); setAudienceCursor(previous); }}>Previous page</button><button className="btn btn-xs btn-ghost" disabled={!audienceEvidence.data?.audience.nextCursor || audienceEvidence.loading} onClick={() => { setAudienceCursorHistory((current) => [...current, audienceCursor]); setAudienceCursor(text(audienceEvidence.data?.audience.nextCursor, "")); }}>Next page</button></div>
                </Panel>
                <Panel title="Provider operations" description="Durable outbox state, references, and reconciliation failures." flush>
                    {operations.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Operation</th><th>State</th><th>Provider reference</th><th>Error</th><th>Updated</th></tr></thead><tbody>{operations.map((operation) => <tr key={text(operation.id)}><td>{text(operation.operationType)}</td><td><StatusBadge value={text(operation.state)} /></td><td className={styles.mono}>{text(operation.providerReference)}</td><td>{text(operation.redactedError)}</td><td>{formatDate(operation.updatedAt, true)}</td></tr>)}</tbody></table></div> : <EmptyState title="No provider operations" copy="Operations appear after preparation, testing, or lifecycle actions are requested." />}
                </Panel>
            </>}
        </ApiState>
    </ColdEmailWorkspace>;
}
