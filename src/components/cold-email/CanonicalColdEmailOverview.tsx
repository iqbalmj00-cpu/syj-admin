"use client";

import Link from "next/link";
import {
    ApiState,
    ColdEmailWorkspace,
    Metric,
    Notice,
    PageLink,
    Panel,
    StatusBadge,
    coldEmailStyles as styles,
    formatDate,
    formatMoney,
    useColdEmailApi,
} from "@/components/cold-email/ColdEmailWorkspace";
import { safeColdEmailInternalHref } from "@/lib/cold-email-links";

type Overview = {
    dataState: string;
    asOf: string;
    workload: { openAlerts: number; criticalAlerts: number; needsReply: number; reminderDue: number; openTasks: number; deadLetters: number; staleCursors: number };
    capacity: { followups: number; newLeads: number; uncertain: number };
    campaigns: Array<Record<string, unknown>>;
    opportunities: Array<Record<string, unknown>>;
    upcomingMeetings: Array<Record<string, unknown>>;
    recentPayments: Array<Record<string, unknown>>;
    alerts: Array<Record<string, unknown>>;
};

function named(record: Record<string, unknown>, relation: string, fallback: string) {
    const value = record[relation] as Record<string, unknown> | undefined;
    return String(value?.name || fallback);
}

export function CanonicalColdEmailOverview() {
    const api = useColdEmailApi<Overview>("/api/cold-email/platform/overview");
    const data = api.data;
    return <ColdEmailWorkspace
        title="Cold Email command center"
        description="One source of truth for campaigns, replies, pipeline, sending capacity, and recovery work."
        actions={<><PageLink href="/cold-email/inbox">Open inbox</PageLink><PageLink href="/cold-email/campaigns/new" primary>New campaign</PageLink></>}
    >
        {data?.dataState && data.dataState !== "complete" && <Notice title="Operational data is stale" tone="warning">One or more provider cursors are behind. Counts remain visible but should not be treated as complete until synchronization recovers. <Link href="/cold-email/settings">Open synchronization evidence.</Link></Notice>}
        <Panel>
            <ApiState loading={api.loading} error={api.error} onRetry={api.reload}>
                <div className={styles.metricGrid}>
                    <Metric label="Needs reply" value={data?.workload.needsReply ?? "—"} sub={`${data?.workload.reminderDue ?? 0} reminders due`} href="/cold-email/inbox" />
                    <Metric label="Open alerts" value={data?.workload.openAlerts ?? "—"} sub={`${data?.workload.criticalAlerts ?? 0} critical`} href="/cold-email/deliverability" />
                    <Metric label="Open tasks" value={data?.workload.openTasks ?? "—"} sub="Due in the next seven days" href="/cold-email/opportunities" />
                    <Metric label="Reserved volume" value={(data?.capacity.followups ?? 0) + (data?.capacity.newLeads ?? 0)} sub={`${data?.capacity.followups ?? 0} follow-ups · ${data?.capacity.uncertain ?? 0} uncertain`} href="/cold-email/accounts" />
                    <Metric label="Recovery queue" value={data?.workload.deadLetters ?? "—"} sub={`${data?.workload.staleCursors ?? 0} stale cursors`} href="/cold-email/settings" />
                </div>
            </ApiState>
        </Panel>

        <div className={styles.split}>
            <Panel title="Campaign control" description="Latest campaigns and their source-defined lifecycle." actions={<PageLink href="/cold-email/campaigns">View all</PageLink>} flush>
                <ApiState loading={api.loading} error={api.error} empty={data?.campaigns.length === 0} emptyTitle="No canonical campaigns" emptyCopy="Create the first campaign with the guided launch workflow." onRetry={api.reload}>
                    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Campaign</th><th>Status</th><th>Health</th><th>Audience</th><th>Updated</th></tr></thead><tbody>
                        {(data?.campaigns || []).map((campaign) => {
                            const version = campaign.activeVersion as Record<string, unknown> | null;
                            const audience = version?.audienceSnapshot as Record<string, unknown> | undefined;
                            return <tr key={String(campaign.id)}><td><Link className={styles.primaryCell} href={`/cold-email/campaigns/${campaign.id}`}>{String(campaign.name)}</Link><span className={styles.secondary}>Priority {String(campaign.priority ?? "—")}</span></td><td><StatusBadge value={String(campaign.status)} /></td><td><StatusBadge value={String(campaign.health)} /></td><td>{String(audience?.eligibleCount ?? "—")}</td><td>{formatDate(campaign.updatedAt, true)}</td></tr>;
                        })}
                    </tbody></table></div>
                </ApiState>
            </Panel>
            <Panel title="Attention queue" description="Durable alerts with direct recovery paths." actions={<PageLink href="/cold-email/settings">Operations</PageLink>} flush>
                <ApiState loading={api.loading} error={api.error} empty={data?.alerts.length === 0} emptyTitle="No open alerts" emptyCopy="Provider health, recovery, and data freshness alerts will surface here." onRetry={api.reload}>
                    <div className={styles.list}>{(data?.alerts || []).map((alert) => { const actionHref = safeColdEmailInternalHref(alert.directActionHref); return <div className={styles.listItem} key={String(alert.id)}><div className={styles.listTop}><span className={styles.listTitle}>{String(alert.title)}</span><StatusBadge value={String(alert.severity)} /></div><div className={styles.listMeta}>{String(alert.message || "Review this alert")} · {formatDate(alert.lastSeenAt, true)}</div>{actionHref ? <Link href={actionHref} className={styles.listMeta}>Open recovery path</Link> : <span className={styles.listMeta}>No safe corrective-action route was recorded.</span>}</div>; })}</div>
                </ApiState>
            </Panel>
        </div>

        <div className={styles.split}>
            <Panel title="Open opportunities" description="Qualified pipeline created from operator-reviewed conversations." actions={<PageLink href="/cold-email/opportunities">Open pipeline</PageLink>} flush>
                <ApiState loading={api.loading} error={api.error} empty={data?.opportunities.length === 0} emptyTitle="No open opportunities" emptyCopy="Qualified replies can be promoted from the Inbox." onRetry={api.reload}>
                    <div className={styles.list}>{(data?.opportunities || []).map((opportunity) => <div className={styles.listItem} key={String(opportunity.id)}><div className={styles.listTop}><span className={styles.listTitle}>{String(opportunity.name)}</span><StatusBadge value={String(opportunity.stage)} /></div><div className={styles.listMeta}>{named(opportunity, "company", "Company not linked")} · {formatMoney(opportunity.valueCents)} · Next action {formatDate(opportunity.nextActionAt, true)}</div></div>)}</div>
                </ApiState>
            </Panel>
            <Panel title="Meetings and revenue" description="Upcoming meetings plus recent Stripe-observed payment facts." flush>
                <ApiState loading={api.loading} error={api.error} empty={data?.upcomingMeetings.length === 0 && data?.recentPayments.length === 0} emptyTitle="No meetings or payments yet" emptyCopy="Calendar and Stripe projections will appear after linked activity." onRetry={api.reload}>
                    <div className={styles.list}>
                        {(data?.upcomingMeetings || []).slice(0, 5).map((meeting) => <div className={styles.listItem} key={String(meeting.id)}><div className={styles.listTop}><span className={styles.listTitle}>{named(meeting, "opportunity", "Sales meeting")}</span><StatusBadge value={String(meeting.syncState)} /></div><div className={styles.listMeta}>{formatDate(meeting.startsAt, true)}</div></div>)}
                        {(data?.recentPayments || []).slice(0, 5).map((payment) => <div className={styles.listItem} key={String(payment.id)}><div className={styles.listTop}><span className={styles.listTitle}>{String(payment.eventType)}</span><StatusBadge value={String(payment.status)} /></div><div className={styles.listMeta}>{formatMoney(payment.amountCents, String(payment.currency || "usd"))} · {formatDate(payment.occurredAt, true)}</div></div>)}
                    </div>
                </ApiState>
            </Panel>
        </div>
    </ColdEmailWorkspace>;
}
