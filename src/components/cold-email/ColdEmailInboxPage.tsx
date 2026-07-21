"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
    ApiState,
    ColdEmailSavedViewPicker,
    ColdEmailWorkspace,
    EmptyState,
    Notice,
    StatusBadge,
    coldEmailMutation,
    coldEmailStyles as styles,
    formatDate,
    useColdEmailApi,
} from "@/components/cold-email/ColdEmailWorkspace";
import { replyAllCcForMessage } from "@/lib/cold-email-inbox";
import { instantlyAccountsHandoff, instantlyUniboxHandoff } from "@/lib/cold-email-links";

type Value = Record<string, unknown>;
type ListResponse = { items: Value[]; nextCursor: string | null };
type Catalog = { templates: Value[] };

function value(input: unknown, fallback = "—") { return input === null || input === undefined || input === "" ? fallback : String(input); }
function safeHttpsUrl(input: unknown) { try { const url = new URL(String(input)); return url.protocol === "https:" ? url.toString() : null; } catch { return null; } }
function contactName(conversation: Value) {
    const contact = conversation.primaryContact as Value | undefined;
    const company = conversation.company as Value | undefined;
    return value(contact?.fullName || company?.name || (conversation.primaryEmailIdentity as Value | undefined)?.normalizedEmail, "Unknown contact");
}

const queues = [
    { value: "", label: "All conversations" },
    { value: "needs_reply", label: "Needs reply" },
    { value: "reminder_due", label: "Reminder due" },
    { value: "waiting_on_lead", label: "Waiting on lead" },
    { value: "snoozed", label: "Snoozed" },
    { value: "resolved", label: "Resolved" },
];

export function ColdEmailInboxPage() {
    const searchParams = useSearchParams();
    const requestedConversationId = searchParams.get("conversationId");
    const requestedContactId = searchParams.get("contactId");
    const [deepLinkMode, setDeepLinkMode] = useState(Boolean(requestedConversationId || requestedContactId));
    const [queue, setQueue] = useState("needs_reply");
    const [search, setSearch] = useState("");
    const [cursor, setCursor] = useState<string | null>(null);
    const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
    const [selected, setSelected] = useState<string | null>(requestedConversationId);
    useEffect(() => {
        if (!requestedConversationId && !requestedContactId) return;
        setDeepLinkMode(true); setCursor(null); setCursorHistory([]);
        if (requestedConversationId) setSelected(requestedConversationId);
    }, [requestedConversationId, requestedContactId]);
    const url = useMemo(() => `/api/cold-email/platform/inbox?${new URLSearchParams({ take: "80", ...(!deepLinkMode && queue ? { workflowState: queue } : {}), ...(!deepLinkMode && search ? { search } : {}), ...(deepLinkMode && requestedConversationId ? { conversationId: requestedConversationId } : {}), ...(deepLinkMode && !requestedConversationId && requestedContactId ? { contactId: requestedContactId } : {}), ...(cursor ? { cursor } : {}) })}`, [queue, search, deepLinkMode, requestedConversationId, requestedContactId, cursor]);
    const list = useColdEmailApi<ListResponse>(url);
    const catalog = useColdEmailApi<Catalog>("/api/cold-email/platform/catalog");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    useEffect(() => {
        if (deepLinkMode && requestedConversationId) { setSelected(requestedConversationId); return; }
        if (selected && list.data?.items.some((item) => item.id === selected)) return;
        setSelected(list.data?.items[0]?.id ? String(list.data.items[0].id) : null);
    }, [list.data, selected, deepLinkMode, requestedConversationId]);
    const detail = useColdEmailApi<{ conversation: Value }>(selected ? `/api/cold-email/platform/inbox/${encodeURIComponent(selected)}` : null);
    const [bodyText, setBodyText] = useState("");
    const [scheduledAt, setScheduledAt] = useState("");
    const [cc, setCc] = useState("");
    const [bcc, setBcc] = useState("");
    const [dispositionDraft, setDispositionDraft] = useState("unclassified");
    const [oooReturnAt, setOooReturnAt] = useState("");
    const [assignee, setAssignee] = useState("");
    const [actionBusy, setActionBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ tone: "danger" | "success" | "warning"; text: string } | null>(null);
    const conversation = detail.data?.conversation;
    const threads = (conversation?.threads as Value[] | undefined) || [];
    const activeThread = threads[0];
    const instantlyHandoff = instantlyUniboxHandoff(activeThread?.providerThreadId);
    const messages = (activeThread?.messages as Value[] | undefined) || [];
    const activeDraft = (activeThread?.drafts as Value[] | undefined)?.[0];
    const sendingAccount = activeThread?.sendingAccount as Value | undefined;
    const accountHandoff = instantlyAccountsHandoff(sendingAccount?.id);
    const originalMailboxReady = sendingAccount?.readiness === "ready" && sendingAccount?.localReviewRequired !== true;
    const lastInboundMessage = [...messages].reverse().find((message) => message.direction === "inbound");
    useEffect(() => {
        setDispositionDraft(value(conversation?.disposition, "unclassified"));
        setAssignee(value(conversation?.ownerId, ""));
    }, [conversation?.id, conversation?.disposition, conversation?.ownerId]);
    useEffect(() => {
        setBodyText(value(activeDraft?.bodyText, ""));
        setCc(Array.isArray(activeDraft?.cc) ? (activeDraft.cc as string[]).join(", ") : "");
        setBcc(Array.isArray(activeDraft?.bcc) ? (activeDraft.bcc as string[]).join(", ") : "");
    }, [activeThread?.id, activeDraft?.id, activeDraft?.updatedAt, activeDraft?.bodyText, activeDraft?.cc, activeDraft?.bcc]);

    async function mutate(action: string, extra: Record<string, unknown> = {}) {
        if (!selected) return;
        setActionBusy(action); setNotice(null);
        try {
            await coldEmailMutation(`/api/cold-email/platform/inbox/${encodeURIComponent(selected)}`, { action, ...extra });
            setNotice({ tone: "success", text: `${action.replaceAll("_", " ")} was recorded.` });
            if (action === "schedule_reply") { setBodyText(""); setScheduledAt(""); }
            await Promise.all([detail.reload(), list.reload()]);
        } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Conversation action failed" }); }
        finally { setActionBusy(null); }
    }
    async function scheduleReply() {
        if (!activeThread) return;
        const when = scheduledAt ? new Date(scheduledAt).toISOString() : new Date(Date.now() + 60_000).toISOString();
        await mutate("schedule_reply", {
            confirm: true,
            threadId: activeThread.id,
            subject: value(activeThread.subject, "Re:"),
            bodyText,
            cc,
            bcc,
            scheduledAt: when,
            requestId: crypto.randomUUID(),
            ...(activeDraft?.id ? { draftId: activeDraft.id } : {}),
        });
    }
    async function aiDraft() {
        if (!selected) return;
        setActionBusy("ai_draft"); setNotice(null);
        try {
            const result = await coldEmailMutation<{ draft: string }>(`/api/cold-email/platform/inbox/${encodeURIComponent(selected)}/ai-draft`, {});
            setBodyText(result.draft); setNotice({ tone: "success", text: "AI draft created and saved locally. Review or edit it before scheduling." }); await detail.reload();
        } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "AI draft failed" }); }
        finally { setActionBusy(null); }
    }
    async function bulk(action: string, extra: Record<string, unknown> = {}) {
        if (!selectedIds.length) return;
        setActionBusy(`bulk_${action}`); setNotice(null);
        try {
            const result = await coldEmailMutation<{ updated: number; failed: number }>("/api/cold-email/platform/inbox", { action, conversationIds: selectedIds, ...extra });
            setNotice({ tone: result.failed ? "warning" : "success", text: `${result.updated} conversations updated${result.failed ? `; ${result.failed} need individual review` : ""}.` });
            setSelectedIds([]); await list.reload();
        } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Bulk Inbox action failed" }); }
        finally { setActionBusy(null); }
    }

    return <ColdEmailWorkspace title="Unified inbox" description="Read, triage, assign, disposition, remind, and human-approve replies across synchronized Cold Email threads.">
        {notice && <Notice title={notice.tone === "success" ? "Conversation updated" : "Action blocked"} tone={notice.tone}>{notice.text}</Notice>}
        <div className={styles.toolbar}><div className={styles.controls}><input className={styles.control} aria-label="Search inbox" placeholder="Search company, contact, email, or subject" value={search} onChange={(event) => { setDeepLinkMode(false); setSearch(event.target.value); setCursor(null); setCursorHistory([]); setSelected(null); }} /><ColdEmailSavedViewPicker surface="inbox" currentFilters={{ search, workflowState: queue }} onApply={(view) => { const filters = view.filters || {}; setDeepLinkMode(false); setSearch(typeof filters.search === "string" ? filters.search : ""); setQueue(typeof filters.workflowState === "string" ? filters.workflowState : ""); setCursor(null); setCursorHistory([]); setSelected(null); }} />{selectedIds.length > 0 && <><span className={styles.listMeta}>{selectedIds.length} selected</span><button className="btn btn-xs btn-ghost" onClick={() => void bulk("mark_read")}>Mark read</button><button className="btn btn-xs btn-ghost" onClick={() => void bulk("set_workflow", { workflowState: "resolved" })}>Resolve</button></>}</div><div className={styles.listMeta}>Replies are never sent without an explicit operator action.</div></div>
        <div className={styles.inboxGrid}>
            <aside className={styles.inboxRail} aria-label="Inbox queues">{queues.map((item) => <button type="button" className={`${styles.queueButton} ${!deepLinkMode && queue === item.value ? styles.queueActive : ""}`} key={item.value} onClick={() => { setDeepLinkMode(false); setQueue(item.value); setCursor(null); setCursorHistory([]); setSelected(null); }}><span>{item.label}</span></button>)}</aside>
            <section className={styles.inboxList} aria-label="Conversations">
                <ApiState loading={list.loading} error={list.error} empty={list.data?.items.length === 0} emptyTitle="This queue is clear" emptyCopy="Conversations appear after inbound provider facts are projected." onRetry={list.reload}>
                    {(list.data?.items || []).map((item) => {
                        const thread = (item.threads as Value[] | undefined)?.[0];
                        const identity = item.primaryEmailIdentity as Value | undefined;
                        const id = value(item.id);
                        return <div key={id} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr)", alignItems: "start", borderBottom: "1px solid var(--line-soft)" }}><input aria-label={`Select ${contactName(item)}`} type="checkbox" style={{ margin: "15px 0 0 10px" }} checked={selectedIds.includes(id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, id] : current.filter((entry) => entry !== id))} /><button type="button" className={`${styles.conversationButton} ${selected === item.id ? styles.conversationActive : ""}`} style={{ borderBottom: 0 }} onClick={() => setSelected(id)}><div className={styles.listTop}><span className={styles.listTitle}>{contactName(item)}</span><StatusBadge value={value(item.workflowState)} /></div><div className={styles.listMeta}>{value(thread?.subject, "No subject")}</div><div className={styles.listMeta}>{value(identity?.normalizedEmail)} · {formatDate(item.lastMessageAt, true)}</div></button></div>;
                    })}
                    <div className={styles.toolbar} style={{ padding: 10 }}><button className="btn btn-xs btn-ghost" disabled={cursorHistory.length === 0 || list.loading} onClick={() => { const previous = cursorHistory.at(-1) ?? null; setCursorHistory((current) => current.slice(0, -1)); setCursor(previous); }}>Previous</button><button className="btn btn-xs btn-ghost" disabled={!list.data?.nextCursor || list.loading} onClick={() => { setCursorHistory((current) => [...current, cursor]); setCursor(list.data?.nextCursor || null); }}>Next</button></div>
                </ApiState>
            </section>
            <section className={styles.thread} aria-label="Selected conversation">
                {!selected ? <EmptyState title="Select a conversation" copy="Choose a conversation from the queue to read its source-defined history." /> : <ApiState loading={detail.loading} error={detail.error} empty={!conversation} emptyTitle="Conversation unavailable" emptyCopy="This record may have changed during synchronization." onRetry={detail.reload}>
                    {conversation && <>
                        <div className={styles.panelHeader}><div><div className={styles.panelTitle}>{contactName(conversation)}</div><div className={styles.panelDescription}>{value((conversation.company as Value | undefined)?.name)} · {value((conversation.primaryEmailIdentity as Value | undefined)?.normalizedEmail)}</div></div><div className={styles.actions}><select aria-label="Workflow state" className={styles.control} value={value(conversation.workflowState, "needs_reply")} onChange={(event) => void mutate("set_workflow", { workflowState: event.target.value })}>{["needs_review", "needs_reply", "reply_scheduled", "waiting_on_lead", "reminder_due", "snoozed", "resolved"].map((item) => <option key={item}>{item}</option>)}</select>{instantlyHandoff ? <a className="btn btn-xs btn-ghost" href={instantlyHandoff} target="_blank" rel="noreferrer">Open in Instantly</a> : null}</div></div>
                        <div className={styles.threadMessages}>
                            {messages.length ? messages.map((message) => <article className={`${styles.message} ${message.direction === "outbound" ? styles.messageOutbound : ""}`} key={value(message.id)}><div className={styles.listTop}><strong>{value(message.sender, value(message.direction))}</strong><span className={styles.listMeta}>{formatDate(message.receivedAt || message.sentAt, true)}</span></div><div style={{ marginTop: 7, whiteSpace: "pre-wrap" }}>{value(message.bodyText, message.retentionState === "purged" ? "Message content was purged under retention policy." : "No text body available")}</div>{((message.attachments as Value[] | undefined) || []).map((attachment) => { const href = safeHttpsUrl(attachment.providerUrl); return <div className={styles.listMeta} style={{ marginTop: 7 }} key={value(attachment.id)}>{value(attachment.filename, "Attachment")} · {value(attachment.mimeType)} · {value(attachment.sizeBytes, "unknown size")}{href && !attachment.purgedAt ? <> · <a href={href} target="_blank" rel="noreferrer">Open provider attachment</a></> : ""}</div>; })}{Boolean(message.providerStatus) && <div style={{ marginTop: 7 }}><StatusBadge value={value(message.providerStatus)} /></div>}</article>) : <EmptyState title="No projected messages" copy="The thread exists, but message facts have not been synchronized or retained." />}
                            {(activeThread?.scheduledReplies as Value[] | undefined)?.map((reply) => <Notice title="Reply scheduled" tone={reply.status === "reconciliation_required" ? "warning" : "info"} key={value(reply.id)}>{formatDate(reply.scheduledAt, true)} · {value(reply.status)} {reply.redactedError ? `· ${reply.redactedError}` : ""}<button type="button" className="btn btn-xs btn-ghost" style={{ marginLeft: 8 }} disabled={actionBusy !== null || reply.status !== "scheduled"} onClick={() => void mutate("cancel_reply", { replyId: reply.id, reason: "Canceled by operator before execution" })}>Cancel</button></Notice>)}
                        </div>
                        <div className={styles.composer}>
                            <Notice title={originalMailboxReady ? "Reply mailbox confirmed" : "Original reply mailbox is not ready"} tone={originalMailboxReady ? "success" : "danger"}>{originalMailboxReady ? `${value(sendingAccount?.email)} · Reply-To ${value(sendingAccount?.replyTo, "same as mailbox")}. The server will recheck readiness before queuing the provider operation.` : <>Replies are blocked until the original sending mailbox is synchronized and marked ready. Drafting and Inbox triage remain available.{accountHandoff ? <> <a href={accountHandoff} target="_blank" rel="noreferrer">Open Instantly accounts to reconnect or review it.</a></> : null}</>}</Notice>
                            {sendingAccount?.signature ? <details><summary className="btn btn-xs btn-ghost">Preview mailbox signature</summary><pre className={styles.mono} style={{ marginTop: 8, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{value(sendingAccount.signature)}</pre></details> : null}
                            <div className={styles.formGridWide}><div className={styles.field}><label>Disposition</label><select className={styles.control} value={dispositionDraft} onChange={(event) => setDispositionDraft(event.target.value)}>{["unclassified", "interested", "not_interested", "out_of_office", "wrong_person", "referral", "unsubscribed", "unreachable", "opportunity"].map((item) => <option key={item}>{item}</option>)}</select></div>{dispositionDraft === "out_of_office" && <div className={styles.field}><label>Return time</label><input className={styles.control} type="datetime-local" value={oooReturnAt} onChange={(event) => setOooReturnAt(event.target.value)} /></div>}<div className={styles.field}><label>Owner ID</label><div className={styles.actions}><input className={styles.control} value={assignee} onChange={(event) => setAssignee(event.target.value)} /><button type="button" className="btn btn-xs btn-ghost" onClick={() => void mutate("assign", { assignedToId: assignee, reason: "Inbox assignment" })}>Assign</button></div></div></div>
                            <button type="button" className="btn btn-xs btn-ghost" style={{ justifySelf: "start" }} disabled={actionBusy !== null || (dispositionDraft === "out_of_office" && !oooReturnAt)} onClick={() => void mutate("set_disposition", { disposition: dispositionDraft, ...(dispositionDraft === "out_of_office" ? { returnAt: new Date(oooReturnAt).toISOString() } : {}) })}>Apply disposition</button>
                            <label className={styles.fieldLabel} htmlFor="cold-email-reply">Human-approved reply</label>
                            <Notice title="Outbound attachments are unavailable">Attachment bytes are never stored, and the verified reply endpoint does not support upload. {instantlyHandoff ? "Use the verified Instantly handoff above when an attachment must be sent." : "No retained provider thread identity is available, so the Dashboard cannot offer an Instantly handoff for this thread."}</Notice>
                            <div className={styles.actions}><select className={styles.control} aria-label="Insert approved template snippet" value="" onChange={(event) => { const template = (catalog.data?.templates || []).find((item) => item.id === event.target.value); if (template) setBodyText(value(template.bodyText, value(template.bodyHtml, ""))); }}><option value="">Insert approved template snippet…</option>{(catalog.data?.templates || []).map((template) => <option key={value(template.id)} value={value(template.id)}>{value(template.name)} · {value(template.subject)}</option>)}</select><button type="button" className="btn btn-xs btn-ghost" disabled={actionBusy !== null || !activeThread} onClick={() => void aiDraft()}>{actionBusy === "ai_draft" ? "Drafting…" : "AI draft"}</button><button type="button" className="btn btn-xs btn-ghost" disabled={!lastInboundMessage} onClick={() => setCc(replyAllCcForMessage({ recipients: lastInboundMessage?.recipients, sendingAccountEmail: value(sendingAccount?.email, ""), leadEmail: value((conversation.primaryEmailIdentity as Value | undefined)?.normalizedEmail, "") }).join(", "))}>Reply all</button></div>
                            <textarea id="cold-email-reply" className={styles.textarea} placeholder="Write the reply that should be scheduled through the original ready mailbox…" value={bodyText} onChange={(event) => setBodyText(event.target.value)} />
                            <div className={styles.formGrid}><div className={styles.field}><label>CC</label><input className={styles.control} value={cc} onChange={(event) => setCc(event.target.value)} placeholder="comma-separated" /></div><div className={styles.field}><label>BCC</label><input className={styles.control} value={bcc} onChange={(event) => setBcc(event.target.value)} placeholder="comma-separated" /></div></div>
                            <div className={styles.actions}><input className={styles.control} aria-label="Schedule reply time" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /><button type="button" className="btn btn-sm btn-ghost" disabled={actionBusy !== null || !bodyText.trim() || !activeThread} onClick={() => void mutate("save_draft", { threadId: activeThread?.id, subject: value(activeThread?.subject, "Re:"), bodyText, cc, bcc })}>Save draft</button>{activeDraft && <button type="button" className="btn btn-sm btn-ghost" disabled={actionBusy !== null} onClick={() => void mutate("discard_draft", { draftId: activeDraft.id })}>Discard draft</button>}<button type="button" className="btn btn-sm btn-ghost" disabled={actionBusy !== null} onClick={() => void mutate("mark_read")}>Mark read</button><button type="button" className="btn btn-sm btn-ghost" disabled={actionBusy !== null} onClick={() => void mutate("remind", { dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), title: "Follow up" })}>Remind tomorrow</button><button type="button" className="btn btn-sm btn-ghost" disabled={actionBusy !== null} onClick={() => void mutate("snooze", { until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), reason: "Snoozed by operator" })}>Snooze 1 week</button><button type="button" className="btn btn-sm btn-primary" disabled={actionBusy !== null || !bodyText.trim() || !activeThread || !originalMailboxReady} onClick={() => void scheduleReply()}>{actionBusy === "schedule_reply" ? "Scheduling…" : "Approve & schedule reply"}</button></div>
                        </div>
                    </>}
                </ApiState>}
            </section>
        </div>
    </ColdEmailWorkspace>;
}
