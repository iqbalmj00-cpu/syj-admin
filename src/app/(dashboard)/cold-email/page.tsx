"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";

type Candidate = {
    id: string;
    name: string;
    email: string | null;
    website: string | null;
    city: string | null;
    state: string | null;
    market: string | null;
    ownerName: string | null;
    grade: string | null;
    leadScore: number | null;
    websiteScore: number | null;
    outreachStatus: string;
    emailVerificationState: string | null;
    emailDiscoveryCategory: string | null;
    emailConfidence: string | null;
    bookingStatus: string | null;
    pricingStatus: string | null;
};

type LeadGroup = {
    id: string;
    name: string;
    description: string | null;
    templateSubject: string | null;
    templateBody: string | null;
    memberCount: number;
};

type LocalStats = {
    candidateCount: number;
    readyGroupCount: number;
    localOutboundCount: number;
    localPendingCount: number;
    localInboundUnreadCount: number;
    localReplyCount: number;
};

type InstantlyState = {
    configured: boolean;
    defaultCampaignId: string | null;
    selectedCampaignId: string | null;
    campaigns: unknown[];
    analytics: unknown[];
    emails: EmailRecord[];
    error: string | null;
};

type Overview = {
    dateRange: { startDate: string; endDate: string };
    local: LocalStats;
    candidates: Candidate[];
    groups: LeadGroup[];
    instantly: InstantlyState;
};

type EmailRecord = Record<string, unknown> & {
    id?: string;
    syjLeadEmail?: string | null;
    syjLead?: {
        id: string;
        name: string;
        email: string | null;
        ownerName: string | null;
        market: string | null;
        city: string | null;
        outreachStatus: string;
    } | null;
    syjPreviewText?: string;
};

type CampaignAnalyticsTotals = {
    sent: number;
    contacted: number;
    leads: number;
    opens: number;
    replies: number;
    clicks: number;
    bounced: number;
    unsubscribed: number;
};

const EMPTY_ANALYTICS_TOTALS: CampaignAnalyticsTotals = {
    sent: 0,
    contacted: 0,
    leads: 0,
    opens: 0,
    replies: 0,
    clicks: 0,
    bounced: 0,
    unsubscribed: 0,
};

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = "") {
    if (value === null || value === undefined) return fallback;
    return String(value);
}

function numberValue(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getString(record: unknown, keys: string[], fallback = "") {
    const source = asRecord(record);
    for (const key of keys) {
        const value = source[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return fallback;
}

function firstEmail(value: unknown): string {
    if (typeof value !== "string") return "";
    const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match?.[0]?.toLowerCase() || "";
}

function emailAddress(email: EmailRecord) {
    return (
        getString(email, ["syjLeadEmail"]) ||
        firstEmail(getString(email, ["lead", "lead_email", "to_address_email_list", "from_address_email"])) ||
        "Unknown lead"
    );
}

function subjectLine(email: EmailRecord) {
    return getString(email, ["subject"], "(no subject)");
}

function threadId(email: EmailRecord) {
    return getString(email, ["thread_id", "threadId"]);
}

function eaccount(email: EmailRecord) {
    return getString(email, ["eaccount", "email_account", "from_address_email"]);
}

function emailId(email: EmailRecord) {
    return getString(email, ["id", "uuid"]);
}

function timestamp(email: EmailRecord) {
    return getString(email, ["timestamp_email", "timestamp_created", "created_at"]);
}

function formatDate(value: unknown) {
    if (!value) return "No date";
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function isUnread(email: EmailRecord) {
    return numberValue(email.is_unread) === 1 || email.is_unread === true;
}

function bodyText(email: EmailRecord) {
    const body = asRecord(email.body);
    const plain = text(body.text || email.syjPreviewText || email.content_preview);
    if (plain) return plain;
    return text(body.html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function campaignId(campaign: unknown) {
    return getString(campaign, ["id", "campaign_id"]);
}

function campaignName(campaign: unknown) {
    return getString(campaign, ["name", "campaign_name"], campaignId(campaign) || "Untitled campaign");
}

function campaignStatus(campaign: unknown) {
    const status = numberValue(asRecord(campaign).status ?? asRecord(campaign).campaign_status);
    if (status === 1) return "Active";
    if (status === 2) return "Paused";
    if (status === 3) return "Completed";
    if (status === 4) return "Draft";
    return "Unknown";
}

function aggregateAnalytics(items: unknown[]) {
    return items.reduce<CampaignAnalyticsTotals>((acc, item) => {
        const record = asRecord(item);
        acc.sent += numberValue(record.emails_sent_count);
        acc.contacted += numberValue(record.contacted_count);
        acc.leads += numberValue(record.leads_count);
        acc.opens += numberValue(record.open_count_unique || record.open_count);
        acc.replies += numberValue(record.reply_count_unique || record.reply_count);
        acc.clicks += numberValue(record.link_click_count_unique || record.link_click_count);
        acc.bounced += numberValue(record.bounced_count);
        acc.unsubscribed += numberValue(record.unsubscribed_count);
        return acc;
    }, { ...EMPTY_ANALYTICS_TOTALS });
}

function rate(part: number, total: number) {
    if (!total) return "0.0%";
    return `${((part / total) * 100).toFixed(1)}%`;
}

function gradeClass(grade: string | null) {
    if (grade === "A") return styles.gradeA;
    if (grade === "B") return styles.gradeB;
    return styles.gradeC;
}

export default function ColdEmailPage() {
    const [overview, setOverview] = useState<Overview | null>(null);
    const [campaign, setCampaign] = useState("");
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [query, setQuery] = useState("");
    const [leadSearch, setLeadSearch] = useState("");
    const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
    const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
    const [templateSubject, setTemplateSubject] = useState("");
    const [templateBody, setTemplateBody] = useState("");
    const [sendResult, setSendResult] = useState<string | null>(null);
    const [emails, setEmails] = useState<EmailRecord[]>([]);
    const [emailLoading, setEmailLoading] = useState(false);
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);
    const [threadEmails, setThreadEmails] = useState<EmailRecord[]>([]);
    const [replyText, setReplyText] = useState("");
    const [actionError, setActionError] = useState<string | null>(null);
    const subjectRef = useRef<HTMLInputElement>(null);
    const bodyRef = useRef<HTMLTextAreaElement>(null);

    const loadOverview = useCallback(async (nextCampaign = campaign, quiet = false) => {
        if (quiet) setRefreshing(true);
        else setLoading(true);
        try {
            const params = new URLSearchParams();
            if (nextCampaign) params.set("campaignId", nextCampaign);
            const response = await fetch(`/api/cold-email/overview?${params.toString()}`, { cache: "no-store" });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Failed to load cold email dashboard");
            setOverview(data);
            const resolvedCampaign = data.instantly?.selectedCampaignId || data.instantly?.defaultCampaignId || campaign;
            if (!campaign && resolvedCampaign) setCampaign(resolvedCampaign);
            setEmails(data.instantly?.emails || []);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to load cold email dashboard");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [campaign]);

    const loadEmails = useCallback(async (options: { thread?: string; search?: string; unread?: boolean } = {}) => {
        setEmailLoading(true);
        try {
            const params = new URLSearchParams();
            if (campaign) params.set("campaignId", campaign);
            if (options.thread) params.set("threadId", options.thread);
            if (options.search) params.set("search", options.search);
            if (options.unread) params.set("isUnread", "true");
            params.set("mode", "emode_all");
            params.set("previewOnly", options.thread ? "false" : "true");
            params.set("limit", options.thread ? "100" : "40");
            const response = await fetch(`/api/cold-email/emails?${params.toString()}`, { cache: "no-store" });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Failed to load email threads");
            if (options.thread) setThreadEmails(data.items || []);
            else setEmails(data.items || []);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to load emails");
        } finally {
            setEmailLoading(false);
        }
    }, [campaign]);

    useEffect(() => {
        void loadOverview();
    }, []);

    useEffect(() => {
        if (!campaign) return;
        void loadOverview(campaign, true);
    }, [campaign]);

    const analytics = useMemo(() => aggregateAnalytics(overview?.instantly.analytics || []), [overview]);
    const filteredLeads = useMemo(() => {
        const needle = leadSearch.trim().toLowerCase();
        const leads = overview?.candidates || [];
        if (!needle) return leads;
        return leads.filter((lead) =>
            [lead.name, lead.email, lead.ownerName, lead.city, lead.state, lead.market, lead.grade]
                .some((value) => String(value || "").toLowerCase().includes(needle)),
        );
    }, [leadSearch, overview]);

    const campaigns = overview?.instantly.campaigns || [];
    const configured = overview?.instantly.configured;
    const local = overview?.local;
    const selectionCount = selectedLeadIds.length + selectedGroupIds.reduce((sum, groupId) => {
        const group = overview?.groups.find((item) => item.id === groupId);
        return sum + (group?.memberCount || 0);
    }, 0);

    const toggleLead = (id: string) => {
        setSelectedLeadIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    };

    const toggleGroup = (group: LeadGroup) => {
        setSelectedGroupIds((current) => current.includes(group.id) ? current.filter((item) => item !== group.id) : [...current, group.id]);
        if (!templateSubject && group.templateSubject) setTemplateSubject(group.templateSubject);
        if (!templateBody && group.templateBody) setTemplateBody(group.templateBody);
    };

    const insertVariable = (variable: string, target: "subject" | "body") => {
        if (target === "subject") {
            const input = subjectRef.current;
            const start = input?.selectionStart ?? templateSubject.length;
            const end = input?.selectionEnd ?? templateSubject.length;
            const next = `${templateSubject.slice(0, start)}${variable}${templateSubject.slice(end)}`;
            setTemplateSubject(next);
            requestAnimationFrame(() => {
                input?.focus();
                input?.setSelectionRange(start + variable.length, start + variable.length);
            });
            return;
        }

        const input = bodyRef.current;
        const start = input?.selectionStart ?? templateBody.length;
        const end = input?.selectionEnd ?? templateBody.length;
        const next = `${templateBody.slice(0, start)}${variable}${templateBody.slice(end)}`;
        setTemplateBody(next);
        requestAnimationFrame(() => {
            input?.focus();
            input?.setSelectionRange(start + variable.length, start + variable.length);
        });
    };

    const queueCampaign = async () => {
        setActionError(null);
        setSendResult(null);
        if (!campaign) {
            setActionError("Select an Instantly campaign first.");
            return;
        }
        if (selectedLeadIds.length === 0 && selectedGroupIds.length === 0) {
            setActionError("Select at least one lead or email group.");
            return;
        }
        const confirmed = window.confirm(`Queue ${selectionCount} selected lead${selectionCount === 1 ? "" : "s"} into this Instantly campaign? Instantly will control the actual sending schedule.`);
        if (!confirmed) return;

        const response = await fetch("/api/cold-email/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                campaignId: campaign,
                leadIds: selectedLeadIds,
                groupIds: selectedGroupIds,
                templateSubject,
                templateBody,
                confirm: true,
            }),
        });
        const data = await response.json();
        if (!response.ok) {
            setActionError(data.error || "Failed to queue campaign");
            return;
        }
        setSendResult(`Queued ${data.queued} lead${data.queued === 1 ? "" : "s"} in Instantly. ${data.skipped?.length || 0} skipped.`);
        setSelectedLeadIds([]);
        setSelectedGroupIds([]);
        void loadOverview(campaign, true);
    };

    const openEmail = async (email: EmailRecord) => {
        setSelectedEmail(email);
        setReplyText("");
        const id = threadId(email);
        if (id) await loadEmails({ thread: id });
        else setThreadEmails([email]);
    };

    const markRead = async () => {
        if (!selectedEmail) return;
        const id = threadId(selectedEmail);
        if (!id) return;
        const response = await fetch("/api/cold-email/read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ threadId: id, leadId: selectedEmail.syjLead?.id }),
        });
        const data = await response.json();
        if (!response.ok) {
            setActionError(data.error || "Failed to mark thread read");
            return;
        }
        await loadEmails({ search: query, unread: unreadOnly });
    };

    const sendReply = async () => {
        if (!selectedEmail) return;
        const account = eaccount(selectedEmail);
        const replyUuid = emailId(selectedEmail);
        if (!account || !replyUuid) {
            setActionError("Instantly did not return the required reply account or email id.");
            return;
        }
        if (!replyText.trim()) {
            setActionError("Reply body is required.");
            return;
        }
        const confirmed = window.confirm("Send this reply through Instantly?");
        if (!confirmed) return;
        const subject = subjectLine(selectedEmail).toLowerCase().startsWith("re:") ? subjectLine(selectedEmail) : `Re: ${subjectLine(selectedEmail)}`;
        const response = await fetch("/api/cold-email/reply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                eaccount: account,
                replyToUuid: replyUuid,
                subject,
                text: replyText,
                leadId: selectedEmail.syjLead?.id,
                leadEmail: selectedEmail.syjLeadEmail,
                confirm: true,
            }),
        });
        const data = await response.json();
        if (!response.ok) {
            setActionError(data.error || "Failed to send reply");
            return;
        }
        setReplyText("");
        await loadEmails({ thread: threadId(selectedEmail) });
        await loadEmails({ search: query, unread: unreadOnly });
    };

    if (loading) {
        return <div className={styles.loading}>Loading cold email console...</div>;
    }

    return (
        <div className={styles.page}>
            <section className={styles.commandBar}>
                <div>
                    <div className={styles.eyebrow}>Instantly Command Center</div>
                    <h2>Cold Email Campaigns</h2>
                </div>
                <div className={styles.commandActions}>
                    <select className="input" value={campaign} onChange={(event) => setCampaign(event.target.value)} disabled={!configured}>
                        <option value="">Select campaign</option>
                        {campaigns.map((item) => {
                            const id = campaignId(item);
                            if (!id) return null;
                            return <option key={id} value={id}>{campaignName(item)} / {campaignStatus(item)}</option>;
                        })}
                    </select>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => loadOverview(campaign, true)} disabled={refreshing}>
                        {refreshing ? "Refreshing" : "Refresh"}
                    </button>
                </div>
            </section>

            {!configured && (
                <div className={styles.notice}>
                    Set `INSTANTLY_API_KEY` in the deployment environment to enable campaign metrics, Unibox, replies, and queueing.
                </div>
            )}
            {overview?.instantly.error && <div className={styles.error}>{overview.instantly.error}</div>}
            {actionError && <div className={styles.error}>{actionError}</div>}
            {sendResult && <div className={styles.success}>{sendResult}</div>}

            <section className={styles.kpiGrid}>
                <div className="kpi-card">
                    <div className="kpi-label">Emails Sent</div>
                    <div className="kpi-value">{analytics.sent.toLocaleString()}</div>
                    <div className="kpi-sub">{analytics.contacted.toLocaleString()} contacted / {analytics.leads.toLocaleString()} leads</div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-label">Open Rate</div>
                    <div className="kpi-value">{rate(analytics.opens, analytics.sent)}</div>
                    <div className="kpi-sub">{analytics.opens.toLocaleString()} unique opens</div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-label">Reply Rate</div>
                    <div className="kpi-value">{rate(analytics.replies, analytics.sent)}</div>
                    <div className="kpi-sub">{analytics.replies.toLocaleString()} replies / {local?.localReplyCount || 0} local replies</div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-label">Bounce Rate</div>
                    <div className="kpi-value">{rate(analytics.bounced, analytics.sent)}</div>
                    <div className="kpi-sub">{analytics.bounced.toLocaleString()} bounced / {analytics.unsubscribed.toLocaleString()} unsubscribed</div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-label">Click Rate</div>
                    <div className="kpi-value">{rate(analytics.clicks, analytics.sent)}</div>
                    <div className="kpi-sub">{analytics.clicks.toLocaleString()} unique clicks</div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-label">Ready Leads</div>
                    <div className="kpi-value">{local?.candidateCount.toLocaleString() || "0"}</div>
                    <div className="kpi-sub">{local?.readyGroupCount || 0} email groups / {local?.localInboundUnreadCount || 0} unread replies</div>
                </div>
            </section>

            <section className={styles.workspace}>
                <div className={styles.leftColumn}>
                    <div className="card">
                        <div className="card-header">
                            <h3>Queue Campaign</h3>
                            <span className={styles.selectionPill}>{selectionCount} selected</span>
                        </div>
                        <div className={`card-body ${styles.queueBody}`}>
                            <label className={styles.fieldLabel}>Subject variable</label>
                            <input ref={subjectRef} className="input" value={templateSubject} onChange={(event) => setTemplateSubject(event.target.value)} placeholder="Optional subject custom variable" />
                            <div className={styles.variableRow}>
                                <button type="button" onClick={() => insertVariable("[Owner_Name]", "subject")}>[Owner_Name]</button>
                                <button type="button" onClick={() => insertVariable("[Location]", "subject")}>[Location]</button>
                            </div>
                            <label className={styles.fieldLabel}>Personalization variable</label>
                            <textarea ref={bodyRef} className={`input ${styles.textArea}`} value={templateBody} onChange={(event) => setTemplateBody(event.target.value)} placeholder="Optional body/personalization custom variable for Instantly" />
                            <div className={styles.variableRow}>
                                <button type="button" onClick={() => insertVariable("[Owner_Name]", "body")}>[Owner_Name]</button>
                                <button type="button" onClick={() => insertVariable("[Location]", "body")}>[Location]</button>
                            </div>
                            <button type="button" className="btn btn-primary btn-sm" onClick={queueCampaign} disabled={!configured || !campaign || selectionCount === 0}>
                                Queue selected in Instantly
                            </button>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header">
                            <h3>Email Groups</h3>
                            <span className={styles.muted}>{overview?.groups.length || 0} groups</span>
                        </div>
                        <div className={`card-body ${styles.groupList}`}>
                            {overview?.groups.map((group) => (
                                <button key={group.id} type="button" className={`${styles.groupItem} ${selectedGroupIds.includes(group.id) ? styles.selected : ""}`} onClick={() => toggleGroup(group)}>
                                    <span>
                                        <strong>{group.name}</strong>
                                        <small>{group.description || "Email group"} / {group.memberCount} leads</small>
                                    </span>
                                    <span className={styles.checkBox}>{selectedGroupIds.includes(group.id) ? "Selected" : "Add"}</span>
                                </button>
                            ))}
                            {overview?.groups.length === 0 && <div className={styles.empty}>No email groups found.</div>}
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header">
                            <h3>Lead Selection</h3>
                            <span className={styles.muted}>{selectedLeadIds.length} picked</span>
                        </div>
                        <div className={`card-body ${styles.leadSelector}`}>
                            <input className="input" value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} placeholder="Search verified leads" />
                            <div className={styles.leadList}>
                                {filteredLeads.map((lead) => (
                                    <button key={lead.id} type="button" className={`${styles.leadItem} ${selectedLeadIds.includes(lead.id) ? styles.selected : ""}`} onClick={() => toggleLead(lead.id)}>
                                        <span className={`${styles.grade} ${gradeClass(lead.grade)}`}>{lead.grade || "C"}</span>
                                        <span className={styles.leadCopy}>
                                            <strong>{lead.name}</strong>
                                            <small>{lead.email} / {lead.city || lead.market || "No market"} {lead.state || ""}</small>
                                        </span>
                                        <span className={styles.leadMeta}>{lead.leadScore || 0}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className={styles.rightColumn}>
                    <div className="card">
                        <div className="card-header">
                            <h3>Unibox</h3>
                            <div className={styles.inboxActions}>
                                <button type="button" className={`btn btn-xs ${unreadOnly ? "btn-primary" : "btn-ghost"}`} onClick={() => {
                                    const next = !unreadOnly;
                                    setUnreadOnly(next);
                                    void loadEmails({ search: query, unread: next });
                                }}>
                                    Unread
                                </button>
                                <button type="button" className="btn btn-ghost btn-xs" onClick={() => loadEmails({ search: query, unread: unreadOnly })} disabled={emailLoading}>
                                    Refresh
                                </button>
                            </div>
                        </div>
                        <div className={`card-body ${styles.inboxBody}`}>
                            <div className={styles.searchRow}>
                                <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
                                    if (event.key === "Enter") void loadEmails({ search: query, unread: unreadOnly });
                                }} placeholder="Search lead email, subject, or thread" />
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => loadEmails({ search: query, unread: unreadOnly })}>Search</button>
                            </div>
                            <div className={styles.emailList}>
                                {emails.map((email) => (
                                    <button key={emailId(email) || `${threadId(email)}-${timestamp(email)}`} type="button" className={`${styles.emailItem} ${selectedEmail && emailId(selectedEmail) === emailId(email) ? styles.activeEmail : ""}`} onClick={() => openEmail(email)}>
                                        <span className={styles.emailTopline}>
                                            <strong>{subjectLine(email)}</strong>
                                            {isUnread(email) && <span className={styles.unreadDot}>Unread</span>}
                                        </span>
                                        <span className={styles.emailMeta}>{email.syjLead?.name || emailAddress(email)} / {formatDate(timestamp(email))}</span>
                                        <span className={styles.emailPreview}>{bodyText(email).slice(0, 160)}</span>
                                    </button>
                                ))}
                                {emails.length === 0 && <div className={styles.empty}>{emailLoading ? "Loading emails..." : "No Instantly emails returned."}</div>}
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header">
                            <h3>Thread</h3>
                            {selectedEmail && (
                                <button type="button" className="btn btn-ghost btn-xs" onClick={markRead} disabled={!threadId(selectedEmail)}>
                                    Mark read
                                </button>
                            )}
                        </div>
                        <div className={`card-body ${styles.threadBody}`}>
                            {!selectedEmail ? (
                                <div className={styles.empty}>Select an email to read and reply.</div>
                            ) : (
                                <>
                                    <div className={styles.threadHeader}>
                                        <div>
                                            <h3>{subjectLine(selectedEmail)}</h3>
                                            <p>{selectedEmail.syjLead?.name || emailAddress(selectedEmail)} / {selectedEmail.syjLead?.market || "Instantly thread"}</p>
                                        </div>
                                        <span className={styles.threadId}>{threadId(selectedEmail) || "No thread id"}</span>
                                    </div>

                                    <div className={styles.messages}>
                                        {(threadEmails.length ? threadEmails : [selectedEmail]).map((email) => (
                                            <div key={emailId(email) || `${timestamp(email)}-${subjectLine(email)}`} className={styles.message}>
                                                <div className={styles.messageHeader}>
                                                    <strong>{getString(email, ["from_address_email"], "Unknown sender")}</strong>
                                                    <span>{formatDate(timestamp(email))}</span>
                                                </div>
                                                <p>{bodyText(email) || "No message body returned."}</p>
                                            </div>
                                        ))}
                                    </div>

                                    <div className={styles.replyBox}>
                                        <textarea className={`input ${styles.replyInput}`} value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder="Write a reply" />
                                        <div className={styles.replyActions}>
                                            <span>{eaccount(selectedEmail) || "No sending account returned"}</span>
                                            <button type="button" className="btn btn-primary btn-sm" onClick={sendReply} disabled={!replyText.trim() || !eaccount(selectedEmail) || !emailId(selectedEmail)}>
                                                Send reply
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
