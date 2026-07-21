"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
    ApiState,
    ColdEmailSavedViewPicker,
    ColdEmailWorkspace,
    EmptyState,
    Notice,
    Panel,
    StatusBadge,
    coldEmailMutation,
    coldEmailStyles as styles,
    formatDate,
    formatMoney,
    useColdEmailApi,
} from "@/components/cold-email/ColdEmailWorkspace";

type Value = Record<string, unknown>;
const stages = ["qualification", "meeting_requested", "meeting_booked", "meeting_completed", "proposal_sent", "negotiation", "closed_won", "closed_lost"];
function value(input: unknown, fallback = "—") { return input === null || input === undefined || input === "" ? fallback : String(input); }
function tomorrowLocalDateTime() {
    const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function nowLocalDateTime() {
    const date = new Date();
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function ColdEmailOpportunitiesPage() {
    const searchParams = useSearchParams();
    const requestedOpportunityId = searchParams.get("id");
    const requestedCompanyId = searchParams.get("companyId");
    const [deepLinkMode, setDeepLinkMode] = useState(Boolean(requestedOpportunityId || requestedCompanyId));
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState("");
    const [ownerId, setOwnerId] = useState("");
    const [cursor, setCursor] = useState<string | null>(null);
    const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
    const [selected, setSelected] = useState<string | null>(requestedOpportunityId);
    useEffect(() => {
        if (!requestedOpportunityId && !requestedCompanyId) return;
        setDeepLinkMode(true); setCursor(null); setCursorHistory([]);
        if (requestedOpportunityId) setSelected(requestedOpportunityId);
    }, [requestedOpportunityId, requestedCompanyId]);
    const query = useMemo(() => new URLSearchParams({ take: "100", ...(!deepLinkMode && search ? { search } : {}), ...(!deepLinkMode && status ? { status } : {}), ...(!deepLinkMode && ownerId ? { ownerId } : {}), ...(deepLinkMode && requestedOpportunityId ? { id: requestedOpportunityId } : {}), ...(deepLinkMode && !requestedOpportunityId && requestedCompanyId ? { companyId: requestedCompanyId } : {}), ...(cursor ? { cursor } : {}) }).toString(), [search, status, ownerId, deepLinkMode, requestedOpportunityId, requestedCompanyId, cursor]);
    const api = useColdEmailApi<{ items: Value[]; nextCursor: string | null }>(`/api/cold-email/platform/opportunities?${query}`);
    const [nextStage, setNextStage] = useState("meeting_requested");
    const [reason, setReason] = useState("");
    const [meetingId, setMeetingId] = useState("");
    const [meetingSchedule, setMeetingSchedule] = useState<Record<string, { startsAt: string; endsAt: string; timezone: string }>>({});
    const [meetingFollowup, setMeetingFollowup] = useState(() => ({ dueAt: tomorrowLocalDateTime(), note: "" }));
    const [proposal, setProposal] = useState({ title: "ScaleYourJunk proposal", amount: "", plan: "", checkoutUrl: "", expiresAt: "", campaignVersionId: "" });
    const [task, setTask] = useState({ title: "Follow up", description: "", dueAt: "", assignedToId: "", taskType: "follow_up" });
    const [stripeReview, setStripeReview] = useState({ providerEventId: "", reason: "" });
    const [manualPayment, setManualPayment] = useState({ evidenceType: "payment", amount: "", currency: "usd", externalReference: "", note: "", occurredAt: nowLocalDateTime() });
    const [busy, setBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
    const active = api.data?.items.find((item) => item.id === selected) || null;
    useEffect(() => {
        if (deepLinkMode && requestedOpportunityId) { setSelected(requestedOpportunityId); return; }
        if (selected && api.data?.items.some((item) => item.id === selected)) return;
        setSelected(api.data?.items[0]?.id ? String(api.data.items[0].id) : null);
    }, [api.data, selected, deepLinkMode, requestedOpportunityId]);
    async function mutate(action: string, body: Record<string, unknown>) {
        setBusy(action); setNotice(null);
        try {
            await coldEmailMutation("/api/cold-email/platform/opportunities", { action, ...body });
            setNotice({ tone: "success", text: `${action.replaceAll("_", " ")} was recorded.` });
            await api.reload();
        } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Opportunity action failed" }); }
        finally { setBusy(null); }
    }
    async function meetingAction(meeting: Value, action: "reschedule" | "cancel") {
        const bookingId = value(meeting.demoBookingId, "");
        if (!bookingId) { setNotice({ tone: "danger", text: "This meeting is not linked to a DemoBooking." }); return; }
        setBusy(`${action}:${bookingId}`); setNotice(null);
        try {
            const draft = meetingSchedule[bookingId];
            await coldEmailMutation(`/api/demo-scheduler/bookings/${encodeURIComponent(bookingId)}/${action}`, action === "cancel" ? { confirm: true } : { confirm: true, startsAt: new Date(draft.startsAt).toISOString(), endsAt: new Date(draft.endsAt).toISOString(), timezone: draft.timezone });
            setNotice({ tone: "success", text: `Meeting ${action} was queued for Calendar read-back confirmation.` }); await api.reload();
        } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Meeting action failed" }); }
        finally { setBusy(null); }
    }
    return <ColdEmailWorkspace title="Opportunities" description="Operator-owned pipeline from qualified reply through meeting, proposal, closed won, activation, and payment observation." actions={<a className="btn btn-sm btn-ghost" href="/api/cold-email/platform/export?surface=opportunities">Export CSV</a>}>
        {notice && <Notice title={notice.tone === "success" ? "Pipeline updated" : "Action blocked"} tone={notice.tone}>{notice.text}</Notice>}
        <div className={styles.toolbar}><div className={styles.controls}><input className={styles.control} aria-label="Search opportunities" placeholder="Search opportunity or company" value={search} onChange={(event) => { setDeepLinkMode(false); setSearch(event.target.value); setCursor(null); setCursorHistory([]); setSelected(null); }} /><select className={styles.control} aria-label="Filter opportunity status" value={status} onChange={(event) => { setDeepLinkMode(false); setStatus(event.target.value); setCursor(null); setCursorHistory([]); setSelected(null); }}><option value="">All statuses</option>{["open", "won", "lost"].map((item) => <option key={item}>{item}</option>)}</select><input className={styles.control} aria-label="Filter opportunity owner" placeholder="Owner ID" value={ownerId} onChange={(event) => { setDeepLinkMode(false); setOwnerId(event.target.value); setCursor(null); setCursorHistory([]); setSelected(null); }} /><ColdEmailSavedViewPicker surface="opportunities" currentFilters={{ search, status, ownerId }} onApply={(view) => { const filters = view.filters || {}; setDeepLinkMode(false); setSearch(typeof filters.search === "string" ? filters.search : ""); setStatus(typeof filters.status === "string" ? filters.status : ""); setOwnerId(typeof filters.ownerId === "string" ? filters.ownerId : ""); setCursor(null); setCursorHistory([]); setSelected(null); }} /></div><span className={styles.listMeta}>{api.data?.items.length ?? 0} opportunities on this page</span></div>
        <Panel title="Pipeline" description="Stage changes enforce required evidence; payment never fabricates closed won.">
            <ApiState loading={api.loading} error={api.error} empty={api.data?.items.length === 0} emptyTitle="No opportunities yet" emptyCopy="Qualify a conversation in the Inbox, then create its opportunity record." onRetry={api.reload}>
                <div className={styles.kanban}>{stages.map((stage) => {
                    const items = (api.data?.items || []).filter((item) => item.stage === stage);
                    return <section className={styles.kanbanColumn} key={stage}><div className={styles.kanbanTitle}><span>{stage.replaceAll("_", " ")}</span><span>{items.length}</span></div>{items.map((item) => <button type="button" className={styles.opportunityCard} style={{ width: "100%", textAlign: "left", cursor: "pointer" }} key={value(item.id)} onClick={() => setSelected(value(item.id))}><div className={styles.listTop}><span className={styles.listTitle}>{value(item.name)}</span><StatusBadge value={value(item.status)} /></div><span className={styles.listMeta}>{value((item.company as Value | undefined)?.name)}</span><strong>{formatMoney(item.valueCents, value(item.currency, "usd"))}</strong><span className={styles.listMeta}>Next action {formatDate(item.nextActionAt, true)}</span></button>)}</section>;
                })}</div>
                <div className={styles.toolbar} style={{ marginTop: 12 }}><button className="btn btn-xs btn-ghost" disabled={cursorHistory.length === 0 || api.loading} onClick={() => { const previous = cursorHistory.at(-1) ?? null; setCursorHistory((current) => current.slice(0, -1)); setCursor(previous); setSelected(null); }}>Previous page</button><button className="btn btn-xs btn-ghost" disabled={!api.data?.nextCursor || api.loading} onClick={() => { setCursorHistory((current) => [...current, cursor]); setCursor(api.data?.nextCursor || null); setSelected(null); }}>Next page</button></div>
            </ApiState>
        </Panel>
        {active ? <div className={styles.split}>
            <Panel title={value(active.name)} description={`${value((active.company as Value | undefined)?.name)} · owner ${value(active.ownerId)}`}>
                <div className={styles.formGrid}>
                    <div className={styles.field}><label>Next stage</label><select className={styles.control} value={nextStage} onChange={(event) => setNextStage(event.target.value)}>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></div>
                    <div className={styles.field}><label>Reason or loss reason</label><input className={styles.control} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required for closed lost" /></div>
                </div>
                <button className="btn btn-sm btn-primary" style={{ marginTop: 10 }} disabled={busy !== null} onClick={() => void mutate("transition", { opportunityId: active.id, nextStage, reason, lossReason: nextStage === "closed_lost" ? reason : undefined, operatorConfirmedWon: nextStage === "closed_won" })}>{busy === "transition" ? "Updating…" : "Confirm stage change"}</button>
                <div className={styles.list} style={{ marginTop: 14 }}>
                    {((active.meetings as Value[] | undefined) || []).map((meeting) => {
                        const meetingIdValue = value(meeting.id, "");
                        const bookingId = value(meeting.demoBookingId, "");
                        const meetingStatus = value(meeting.status, "");
                        const canRecordOutcome = ["scheduled", "rescheduled"].includes(meetingStatus);
                        const draft = meetingSchedule[bookingId] || { startsAt: "", endsAt: "", timezone: value(meeting.timezone, "America/Chicago") };
                        return <div className={styles.listItem} key={meetingIdValue}>
                            <div className={styles.listTop}><span className={styles.listTitle}>Meeting · {formatDate(meeting.startsAt, true)}</span><div className={styles.actions}><StatusBadge value={meetingStatus} /><StatusBadge value={value(meeting.syncState)} /></div></div>
                            <div className={styles.formGridWide}><input aria-label="New meeting start" type="datetime-local" className={styles.control} value={draft.startsAt} onChange={(event) => setMeetingSchedule((current) => ({ ...current, [bookingId]: { ...draft, startsAt: event.target.value } }))} /><input aria-label="New meeting end" type="datetime-local" className={styles.control} value={draft.endsAt} onChange={(event) => setMeetingSchedule((current) => ({ ...current, [bookingId]: { ...draft, endsAt: event.target.value } }))} /><input aria-label="Meeting timezone" className={styles.control} value={draft.timezone} onChange={(event) => setMeetingSchedule((current) => ({ ...current, [bookingId]: { ...draft, timezone: event.target.value } }))} /></div>
                            <div className={styles.actions}><button className="btn btn-xs btn-ghost" disabled={busy !== null || !bookingId || !draft.startsAt || !draft.endsAt} onClick={() => void meetingAction(meeting, "reschedule")}>Reschedule</button><button className="btn btn-xs btn-ghost" disabled={busy !== null || !bookingId} onClick={() => void meetingAction(meeting, "cancel")}>Cancel meeting</button></div>
                            {canRecordOutcome ? <>
                                <div className={styles.formGrid} style={{ marginTop: 10 }}>
                                    <div className={styles.field}><label>Outcome follow-up due</label><input aria-label="Meeting outcome follow-up due" type="datetime-local" className={styles.control} value={meetingFollowup.dueAt} onChange={(event) => setMeetingFollowup((current) => ({ ...current, dueAt: event.target.value }))} /></div>
                                    <div className={styles.field}><label>Outcome note</label><input aria-label="Meeting outcome note" className={styles.control} value={meetingFollowup.note} onChange={(event) => setMeetingFollowup((current) => ({ ...current, note: event.target.value }))} placeholder="Optional task context" /></div>
                                </div>
                                <div className={styles.actions}><button className="btn btn-xs btn-primary" disabled={busy !== null || !meetingFollowup.dueAt} onClick={() => void mutate("meeting_outcome", { meetingId: meetingIdValue, outcome: "completed", followupDueAt: new Date(meetingFollowup.dueAt).toISOString(), note: meetingFollowup.note })}>Record completed + task</button><button className="btn btn-xs btn-ghost" disabled={busy !== null || !meetingFollowup.dueAt} onClick={() => void mutate("meeting_outcome", { meetingId: meetingIdValue, outcome: "no_show", followupDueAt: new Date(meetingFollowup.dueAt).toISOString(), note: meetingFollowup.note })}>Record no-show + task</button></div>
                            </> : null}
                        </div>;
                    })}
                    {((active.proposals as Value[] | undefined) || []).map((item) => <div className={styles.listItem} key={value(item.id)}><div className={styles.listTop}><span className={styles.listTitle}>{value(item.title)}</span><StatusBadge value={value(item.status)} /></div><span className={styles.listMeta}>{formatMoney(item.amountCents)}</span></div>)}
                    {((active.customerLinks as Value[] | undefined) || []).map((customer) => <div className={styles.listItem} key={value(customer.id)}><div className={styles.listTop}><span className={styles.listTitle}>ScaleYourJunk customer</span><StatusBadge value={value(customer.status)} /></div><span className={styles.listMeta}>Activation and payment are owned by ScaleYourJunk and Stripe projections.</span></div>)}
                    {((active.manualPaymentEvidence as Value[] | undefined) || []).map((payment) => <div className={styles.listItem} key={value(payment.id)}><div className={styles.listTop}><span className={styles.listTitle}>Manual {value(payment.evidenceType).replaceAll("_", " ")} evidence</span><StatusBadge value={value(payment.status)} /></div><span className={styles.listMeta}>{payment.amountCents === null || payment.amountCents === undefined ? "No amount claimed" : formatMoney(payment.amountCents, value(payment.currency, "usd"))} · observed {formatDate(payment.occurredAt, true)} · recorded by {value(payment.recordedBy)}</span><span className={styles.listMeta}>{value(payment.note)}{payment.externalReference ? ` · reference ${value(payment.externalReference)}` : ""}</span><span className={styles.listMeta}>Operator evidence only; excluded from authoritative Stripe revenue.</span></div>)}
                    {((active.tasks as Value[] | undefined) || []).map((item) => <div className={styles.listItem} key={value(item.id)}><div className={styles.listTop}><span className={styles.listTitle}>{value(item.title)}</span><StatusBadge value={value(item.status)} /></div><span className={styles.listMeta}>{value(item.taskType).replaceAll("_", " ")} · due {formatDate(item.dueAt, true)} · assigned {value(item.assignedToId)}</span>{item.description ? <span className={styles.listMeta}>{value(item.description)}</span> : null}<div className={styles.actions}>{item.status === "open" ? <><button className="btn btn-xs btn-ghost" disabled={busy !== null} onClick={() => void mutate("mutate_task", { taskId: item.id, taskAction: "complete" })}>Complete</button><button className="btn btn-xs btn-ghost" disabled={busy !== null} onClick={() => void mutate("mutate_task", { taskId: item.id, taskAction: "cancel" })}>Cancel</button></> : <button className="btn btn-xs btn-ghost" disabled={busy !== null} onClick={() => void mutate("mutate_task", { taskId: item.id, taskAction: "reopen" })}>Reopen</button>}</div></div>)}
                </div>
            </Panel>
            <Panel title="Meeting & proposal evidence" description="Link an existing DemoBooking or record a proposal with an attributed HTTPS checkout reference.">
                <div className={styles.field}><label>DemoBooking ID</label><input className={styles.control} value={meetingId} onChange={(event) => setMeetingId(event.target.value)} /><button className="btn btn-sm btn-ghost" disabled={busy !== null || !meetingId.trim()} onClick={() => void mutate("link_meeting", { opportunityId: active.id, demoBookingId: meetingId })}>Link meeting</button></div>
                <div className={styles.formGrid} style={{ marginTop: 14 }}>
                    <div className={styles.field}><label>Proposal title</label><input className={styles.control} value={proposal.title} onChange={(e) => setProposal({ ...proposal, title: e.target.value })} /></div>
                    <div className={styles.field}><label>Amount (USD)</label><input className={styles.control} type="number" min="0" step="0.01" value={proposal.amount} onChange={(e) => setProposal({ ...proposal, amount: e.target.value })} /></div>
                    <div className={styles.field}><label>Plan</label><input className={styles.control} value={proposal.plan} onChange={(e) => setProposal({ ...proposal, plan: e.target.value })} /></div>
                    <div className={styles.field}><label>Campaign version ID</label><input className={styles.control} value={proposal.campaignVersionId} onChange={(e) => setProposal({ ...proposal, campaignVersionId: e.target.value })} /></div>
                    <div className={`${styles.field} ${styles.spanAll}`}><label>HTTPS checkout URL</label><input className={styles.control} type="url" value={proposal.checkoutUrl} onChange={(e) => setProposal({ ...proposal, checkoutUrl: e.target.value })} /></div>
                    <div className={styles.field}><label>Expires at</label><input className={styles.control} type="datetime-local" value={proposal.expiresAt} onChange={(e) => setProposal({ ...proposal, expiresAt: e.target.value })} /></div>
                </div>
                <button className="btn btn-sm btn-primary" style={{ marginTop: 10 }} disabled={busy !== null || !proposal.amount || !proposal.plan || !proposal.checkoutUrl || !proposal.expiresAt || !proposal.campaignVersionId} onClick={() => void mutate("create_proposal", { opportunityId: active.id, title: proposal.title, amountCents: Math.round(Number(proposal.amount) * 100), plan: proposal.plan, checkoutUrl: proposal.checkoutUrl, expiresAt: new Date(proposal.expiresAt).toISOString(), campaignVersionId: proposal.campaignVersionId })}>Create proposal</button>
                <div className={styles.formGrid} style={{ marginTop: 20 }}>
                    <div className={styles.field}><label>Follow-up task</label><input className={styles.control} value={task.title} onChange={(event) => setTask({ ...task, title: event.target.value })} /></div>
                    <div className={styles.field}><label>Task type</label><select className={styles.control} value={task.taskType} onChange={(event) => setTask({ ...task, taskType: event.target.value })}>{["follow_up", "meeting_outcome", "proposal_follow_up", "customer_activation"].map((item) => <option key={item}>{item}</option>)}</select></div>
                    <div className={styles.field}><label>Due at</label><input className={styles.control} type="datetime-local" value={task.dueAt} onChange={(event) => setTask({ ...task, dueAt: event.target.value })} /></div>
                    <div className={styles.field}><label>Assigned operator ID</label><input className={styles.control} value={task.assignedToId} onChange={(event) => setTask({ ...task, assignedToId: event.target.value })} placeholder={value(active.ownerId, "Opportunity owner")} /></div>
                    <div className={`${styles.field} ${styles.spanAll}`}><label>Description</label><textarea className={styles.textarea} value={task.description} onChange={(event) => setTask({ ...task, description: event.target.value })} /></div>
                </div>
                <button className="btn btn-sm btn-primary" style={{ marginTop: 10 }} disabled={busy !== null || !task.title.trim()} onClick={() => void mutate("create_task", { opportunityId: active.id, title: task.title, description: task.description, taskType: task.taskType, assignedToId: task.assignedToId || active.ownerId, ...(task.dueAt ? { dueAt: new Date(task.dueAt).toISOString() } : {}) })}>Create follow-up task</button>
                <div className={styles.listItem} style={{ marginTop: 20 }}><div className={styles.listTop}><span className={styles.listTitle}>Manual Stripe attribution review</span><StatusBadge value="super_admin" /></div><span className={styles.listMeta}>Use only for an alert whose local provider-event evidence you reviewed. This links the event to this opportunity&apos;s immutable source campaign and queues safe reprojection when needed; it never overwrites an existing Stripe/customer link.</span><div className={styles.formGrid} style={{ marginTop: 10 }}><div className={styles.field}><label>Local Stripe provider event ID</label><input className={styles.control} value={stripeReview.providerEventId} onChange={(event) => setStripeReview({ ...stripeReview, providerEventId: event.target.value })} /></div><div className={styles.field}><label>Evidence and reason</label><input className={styles.control} value={stripeReview.reason} onChange={(event) => setStripeReview({ ...stripeReview, reason: event.target.value })} /></div></div><button className="btn btn-sm btn-ghost" style={{ marginTop: 10 }} disabled={busy !== null || !stripeReview.providerEventId.trim() || !stripeReview.reason.trim()} onClick={() => void mutate("attribute_payment_event", { providerEventId: stripeReview.providerEventId, opportunityId: active.id, reason: stripeReview.reason })}>Confirm manual attribution review</button></div>
                <div className={styles.listItem} style={{ marginTop: 12 }}><div className={styles.listTop}><span className={styles.listTitle}>Manual payment evidence</span><StatusBadge value="super_admin" /></div><span className={styles.listMeta}>This creates a separate immutable operator-evidence record. It never changes a Stripe projection and is excluded from authoritative revenue totals.</span><div className={styles.formGridWide} style={{ marginTop: 10 }}><div className={styles.field}><label>Evidence type</label><select className={styles.control} value={manualPayment.evidenceType} onChange={(event) => setManualPayment({ ...manualPayment, evidenceType: event.target.value })}>{["payment", "refund", "comp", "dispute", "other"].map((item) => <option key={item}>{item}</option>)}</select></div><div className={styles.field}><label>Amount (optional)</label><input className={styles.control} type="number" min="0" step="0.01" value={manualPayment.amount} onChange={(event) => setManualPayment({ ...manualPayment, amount: event.target.value })} /></div><div className={styles.field}><label>Currency</label><input className={styles.control} maxLength={3} value={manualPayment.currency} onChange={(event) => setManualPayment({ ...manualPayment, currency: event.target.value })} /></div><div className={styles.field}><label>Observed at</label><input className={styles.control} type="datetime-local" value={manualPayment.occurredAt} onChange={(event) => setManualPayment({ ...manualPayment, occurredAt: event.target.value })} /></div><div className={styles.field}><label>External reference (optional)</label><input className={styles.control} value={manualPayment.externalReference} onChange={(event) => setManualPayment({ ...manualPayment, externalReference: event.target.value })} /></div><div className={styles.field}><label>Evidence note</label><input className={styles.control} value={manualPayment.note} onChange={(event) => setManualPayment({ ...manualPayment, note: event.target.value })} /></div></div><button className="btn btn-sm btn-ghost" style={{ marginTop: 10 }} disabled={busy !== null || !manualPayment.note.trim() || !manualPayment.occurredAt} onClick={() => void mutate("record_manual_payment_evidence", { opportunityId: active.id, evidenceType: manualPayment.evidenceType, amountCents: manualPayment.amount ? Math.round(Number(manualPayment.amount) * 100) : null, currency: manualPayment.currency, externalReference: manualPayment.externalReference, note: manualPayment.note, occurredAt: new Date(manualPayment.occurredAt).toISOString() })}>Record separate payment evidence</button></div>
            </Panel>
        </div> : <EmptyState title="Select an opportunity" copy="Choose a pipeline card to review evidence or advance its stage." />}
    </ColdEmailWorkspace>;
}
