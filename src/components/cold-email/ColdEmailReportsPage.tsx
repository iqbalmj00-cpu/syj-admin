"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
    ApiState,
    ColdEmailWorkspace,
    Metric,
    Notice,
    Panel,
    StatusBadge,
    coldEmailStyles as styles,
    formatDate,
    formatMoney,
    useColdEmailApi,
} from "@/components/cold-email/ColdEmailWorkspace";

type Value = Record<string, unknown>;
type Report = { range: { from: string; to: string }; campaignId: string | null; asOf: string; dataState: string; maturity: { state: string; maturesAt: string | null }; definitions: Record<string, Value>; values: Record<string, number>; rates: Record<string, number | null>; revenue: Record<string, number>; unavailable: Record<string, string>; evidence: Record<string, string>; snapshots: Value[] };
function dateInput(date: Date) { return date.toISOString().slice(0, 10); }
function percent(input: number | null | undefined) { return input === null || input === undefined ? "—" : `${(input * 100).toFixed(1)}%`; }

const funnelKeys = ["selected", "eligible", "enrollmentRequested", "providerAcceptedContacts", "uniqueProviderSentContacts", "humanRepliers", "positiveRepliers", "meetings", "proposals", "closedWon", "payingCustomers"];

export function ColdEmailReportsPage() {
    const [draft, setDraft] = useState(() => ({ from: dateInput(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)), to: dateInput(new Date()), campaignId: "" }));
    const [filters, setFilters] = useState(draft);
    const url = useMemo(() => `/api/cold-email/platform/reports?${new URLSearchParams({ from: filters.from, to: filters.to, ...(filters.campaignId ? { campaignId: filters.campaignId } : {}) })}`, [filters]);
    const api = useColdEmailApi<Report>(url);
    const data = api.data;
    return <ColdEmailWorkspace title="Reports" description="Source-defined funnel, reply, pipeline, activation, and Stripe-attributed revenue metrics with freshness and maturity evidence." actions={<><a className="btn btn-sm btn-ghost" href="/api/cold-email/platform/export?surface=campaigns">Export campaigns</a><a className="btn btn-sm btn-ghost" href="/api/cold-email/platform/export?surface=opportunities">Export opportunities</a></>}>
        <div className={styles.toolbar}><div className={styles.controls}><label className={styles.inline}><span className={styles.fieldLabel}>From</span><input type="date" className={styles.control} value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label><label className={styles.inline}><span className={styles.fieldLabel}>To</span><input type="date" className={styles.control} value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label><input className={styles.control} aria-label="Campaign ID filter" placeholder="Optional campaign ID" value={draft.campaignId} onChange={(event) => setDraft({ ...draft, campaignId: event.target.value })} /><button className="btn btn-sm btn-primary" onClick={() => setFilters(draft)}>Apply</button></div></div>
        {data?.dataState === "partial" && <Notice title="Report data is partial" tone="warning">At least one Instantly or Stripe cursor is missing, stale, or in error. Displayed facts are real, but totals may be incomplete.</Notice>}
        <div className={styles.metricGrid}><Metric label="Human reply rate" value={percent(data?.rates.humanReplyRate)} sub="Distinct human repliers / distinct sent contacts" /><Metric label="Positive reply rate" value={percent(data?.rates.positiveReplyRate)} sub="Operator-reviewed positive replies / human repliers" /><Metric label="Bounce rate" value={percent(data?.rates.bounceRate)} sub="Observed bounces / provider-sent messages" /><Metric label="Net attributed revenue" value={formatMoney(data?.values.attributedRevenueCents)} /><Metric label="MRR" value={formatMoney(data?.values.mrrCents)} /><Metric label="ARR" value={formatMoney(data?.values.arrCents)} /></div>
        <div className={styles.split}>
            <Panel title="Lifecycle funnel" description="Each stage uses a named canonical fact and an explicit denominator." flush>
                <ApiState loading={api.loading} error={api.error} empty={!data} emptyTitle="No report" emptyCopy="Apply a valid date range." onRetry={api.reload}>
                    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Stage</th><th>Count</th><th>Authoritative fact</th><th>Denominator</th></tr></thead><tbody>{funnelKeys.map((key) => { const definition = data?.definitions[key]; return <tr key={key}><td className={styles.primaryCell}>{String(definition?.label || key)}</td><td>{data?.values[key] ?? "—"}</td><td>{String(definition?.numerator || "—")}</td><td>{String(definition?.denominator || "—")}</td></tr>; })}</tbody></table></div>
                </ApiState>
            </Panel>
            <Panel title="Evidence state" description="Freshness, maturity, and intentionally unavailable metrics.">
                <div className={styles.list}><div className={styles.listItem}><div className={styles.listTop}><span className={styles.listTitle}>Data completeness</span><StatusBadge value={data?.dataState} /></div><span className={styles.listMeta}>As of {formatDate(data?.asOf, true)}</span></div><div className={styles.listItem}><div className={styles.listTop}><span className={styles.listTitle}>Campaign maturity</span><StatusBadge value={data?.maturity.state} /></div><span className={styles.listMeta}>{data?.maturity.maturesAt ? `Matures ${formatDate(data.maturity.maturesAt, true)}` : "No last planned message date is available"}</span></div>{Object.entries(data?.unavailable || {}).map(([metric, explanation]) => <div className={styles.listItem} key={metric}><div className={styles.listTop}><span className={styles.listTitle}>{metric}</span><StatusBadge value="unavailable" /></div><span className={styles.listMeta}>{explanation}</span></div>)}</div>
            </Panel>
        </div>
        <Panel title="Revenue evidence" description="Stripe cash, refund, dispute, and chargeback projections. Tax is excluded from attributed revenue.">
            <div className={styles.metricGrid}><Metric label="Gross invoices" value={formatMoney(data?.revenue.grossInvoiceCents)} /><Metric label="Cash collected" value={formatMoney(data?.revenue.cashCollectedCents)} /><Metric label="Refunds" value={formatMoney(data?.revenue.refundCents)} /><Metric label="Pending disputes" value={formatMoney(data?.revenue.pendingDisputeCents)} /><Metric label="Lost chargebacks" value={formatMoney(data?.revenue.lostChargebackCents)} /><Metric label="Net attribution" value={formatMoney(data?.revenue.netAttributedRevenueCents)} /></div>
        </Panel>
        <Panel title="Drill-through evidence" description="Open the canonical records supporting the report."><div className={styles.actions}>{Object.entries(data?.evidence || {}).map(([label, href]) => <Link className="btn btn-sm btn-ghost" href={href} key={label}>{label}</Link>)}</div></Panel>
    </ColdEmailWorkspace>;
}
