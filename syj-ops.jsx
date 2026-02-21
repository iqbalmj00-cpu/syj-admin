import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════
// DESIGN TOKENS
// ═══════════════════════════════════════════════════
const C = {
  orange: "#FF6B00", orangeHover: "#FF8533", navy: "#0A192F", navyLight: "#112240",
  success: "#00D84A", successDark: "#00A83A", info: "#2563EB", warn: "#F59E0B", warnDark: "#D97706",
  danger: "#EF4444", dangerDark: "#991B1B", purple: "#8B5CF6",
  bg: "#F1F5F9", surface: "#F8FAFC", white: "#FFFFFF",
  text: "#0A192F", textMuted: "#334155", textLight: "#64748B", textFaint: "#94A3B8",
  border: "#E2E8F0", borderLight: "#F1F5F9",
};
const font = { heading: "'Space Grotesk', sans-serif", body: "'Inter', -apple-system, sans-serif" };

// ═══════════════════════════════════════════════════
// MOCK DATA
// ═══════════════════════════════════════════════════
const PLANS = {
  starter: { name: "Starter", price: 149, color: C.info, trucks: "1-2" },
  growth: { name: "Growth", price: 299, color: C.orange, trucks: "3-10" },
  enterprise: { name: "Enterprise", price: 549, color: C.purple, trucks: "10+" },
};

const STATUS = {
  active: { bg: C.success + "20", color: C.successDark, label: "Active" },
  trial: { bg: C.info + "20", color: C.info, label: "Trial" },
  suspended: { bg: C.danger + "20", color: C.danger, label: "Suspended" },
  cancelled: { bg: "#6B728020", color: "#6B7280", label: "Cancelled" },
  past_due: { bg: C.warn + "20", color: C.warnDark, label: "Past Due" },
};

const MOCK_CLIENTS = [
  { id: "cl_001", cuid: "cmluy7rjv000001ih8v4ik4aa", company: "Junk King Austin", owner: "Marcus Rivera", email: "marcus@junkkingaustin.com", phone: "(512) 555-0142", plan: "growth", status: "active", trucks: 5, mrr: 299, joined: "2025-11-15", lastActive: "2026-02-21", jobs: 847, city: "Austin", state: "TX", ltv: 1196, monthsActive: 4,
    website: { subdomain: "junkkingaustin", vercelId: "prj_abc123", status: "live", lastDeploy: "2026-02-18T14:30:00Z", templateVer: "1.4.2" },
    phoneAgent: { number: "+15125550142", twilioSid: "PN_abc001", areaCode: "512", status: "active", flyApp: "syj-agent-cl001", totalCalls: 234, minutes: 412, cost: 48.60, lastRestart: "2026-02-20T03:00:00Z", errors: 0 },
    onboarding: { completed: true, step: 5, totalSteps: 5 },
    features: { scheduling: true, crm: true, driverPortal: true, photoQuote: true, phoneAgent: true, marketing: false } },
  { id: "cl_002", cuid: "cmluy7rjv000002ih8v4ik4bb", company: "Houston Haul Away", owner: "Deandre Williams", email: "deandre@houstonhaulaway.com", phone: "(713) 555-0198", plan: "starter", status: "active", trucks: 2, mrr: 149, joined: "2025-12-01", lastActive: "2026-02-21", jobs: 312, city: "Houston", state: "TX", ltv: 447, monthsActive: 3,
    website: { subdomain: "houstonhaulaway", vercelId: "prj_def456", status: "live", lastDeploy: "2026-02-15T10:12:00Z", templateVer: "1.4.2" },
    phoneAgent: { number: "+17135550198", twilioSid: "PN_abc002", areaCode: "713", status: "active", flyApp: "syj-agent-cl002", totalCalls: 89, minutes: 156, cost: 18.40, lastRestart: "2026-02-20T03:00:00Z", errors: 0 },
    onboarding: { completed: true, step: 5, totalSteps: 5 },
    features: { scheduling: true, crm: true, driverPortal: false, photoQuote: false, phoneAgent: true, marketing: false } },
  { id: "cl_003", cuid: "cmluy7rjv000003ih8v4ik4cc", company: "CleanSweep DFW", owner: "Sarah Chen", email: "sarah@cleansweep-dfw.com", phone: "(214) 555-0267", plan: "growth", status: "trial", trucks: 4, mrr: 0, joined: "2026-02-10", lastActive: "2026-02-21", jobs: 23, city: "Dallas", state: "TX", ltv: 0, monthsActive: 0,
    website: { subdomain: "cleansweep-dfw", vercelId: "prj_ghi789", status: "building", lastDeploy: "2026-02-21T07:45:00Z", templateVer: "1.4.2" },
    phoneAgent: { number: "+12145550267", twilioSid: "PN_abc003", areaCode: "214", status: "active", flyApp: "syj-agent-cl003", totalCalls: 8, minutes: 14, cost: 1.65, lastRestart: "2026-02-21T07:45:00Z", errors: 0 },
    onboarding: { completed: false, step: 3, totalSteps: 5 },
    features: { scheduling: true, crm: true, driverPortal: false, photoQuote: true, phoneAgent: true, marketing: false } },
  { id: "cl_004", cuid: "cmluy7rjv000004ih8v4ik4rp", company: "Bay Area Junk Pros", owner: "Mike Thornton", email: "mike@bajunkpros.com", phone: "(415) 555-0331", plan: "enterprise", status: "active", trucks: 12, mrr: 549, joined: "2025-10-20", lastActive: "2026-02-19", jobs: 2104, city: "San Francisco", state: "CA", ltv: 2745, monthsActive: 5,
    website: { subdomain: "bajunkpros", vercelId: "prj_jkl012", status: "live", lastDeploy: "2026-02-12T16:20:00Z", templateVer: "1.4.1" },
    phoneAgent: { number: "+14155550331", twilioSid: "PN_abc004", areaCode: "415", status: "error", flyApp: "syj-agent-cl004", totalCalls: 567, minutes: 1023, cost: 120.70, lastRestart: "2026-02-21T09:12:00Z", errors: 3 },
    onboarding: { completed: true, step: 5, totalSteps: 5 },
    features: { scheduling: true, crm: true, driverPortal: true, photoQuote: true, phoneAgent: true, marketing: true } },
  { id: "cl_005", cuid: "cmluy7rjv000005ih8v4ik4ee", company: "Denver Debris Removal", owner: "Lisa Park", email: "lisa@denverdebris.com", phone: "(303) 555-0455", plan: "growth", status: "past_due", trucks: 6, mrr: 299, joined: "2025-11-28", lastActive: "2026-02-14", jobs: 567, city: "Denver", state: "CO", ltv: 897, monthsActive: 3,
    website: { subdomain: "denverdebris", vercelId: "prj_mno345", status: "live", lastDeploy: "2026-02-01T09:00:00Z", templateVer: "1.4.0" },
    phoneAgent: { number: "+13035550455", twilioSid: "PN_abc005", areaCode: "303", status: "active", flyApp: "syj-agent-cl005", totalCalls: 156, minutes: 278, cost: 32.80, lastRestart: "2026-02-20T03:00:00Z", errors: 0 },
    onboarding: { completed: true, step: 5, totalSteps: 5 },
    features: { scheduling: true, crm: true, driverPortal: true, photoQuote: true, phoneAgent: true, marketing: true } },
  { id: "cl_006", cuid: "cmluy7rjv000006ih8v4ik4ff", company: "Phoenix Junk Solutions", owner: "Carlos Mendez", email: "carlos@phxjunksolutions.com", phone: "(602) 555-0512", plan: "starter", status: "suspended", trucks: 1, mrr: 0, joined: "2025-09-15", lastActive: "2026-01-03", jobs: 89, city: "Phoenix", state: "AZ", ltv: 596, monthsActive: 4,
    website: { subdomain: "phxjunksolutions", vercelId: "prj_pqr678", status: "suspended", lastDeploy: "2025-12-20T11:00:00Z", templateVer: "1.3.0" },
    phoneAgent: { number: null, twilioSid: null, areaCode: "602", status: "released", flyApp: null, totalCalls: 34, minutes: 61, cost: 7.20, lastRestart: null, errors: 0 },
    onboarding: { completed: true, step: 5, totalSteps: 5 },
    features: { scheduling: true, crm: true, driverPortal: false, photoQuote: false, phoneAgent: false, marketing: false } },
  { id: "cl_007", cuid: "cmluy7rjv000007ih8v4ik4gg", company: "ATL Junk Removal Co", owner: "Jamal Washington", email: "jamal@atljunkco.com", phone: "(404) 555-0678", plan: "growth", status: "active", trucks: 7, mrr: 299, joined: "2025-12-18", lastActive: "2026-02-21", jobs: 431, city: "Atlanta", state: "GA", ltv: 598, monthsActive: 2,
    website: { subdomain: "atljunkco", vercelId: "prj_stu901", status: "live", lastDeploy: "2026-02-19T13:15:00Z", templateVer: "1.4.2" },
    phoneAgent: { number: "+14045550678", twilioSid: "PN_abc007", areaCode: "404", status: "active", flyApp: "syj-agent-cl007", totalCalls: 145, minutes: 267, cost: 31.50, lastRestart: "2026-02-20T03:00:00Z", errors: 0 },
    onboarding: { completed: true, step: 5, totalSteps: 5 },
    features: { scheduling: true, crm: true, driverPortal: true, photoQuote: true, phoneAgent: true, marketing: false } },
  { id: "cl_008", cuid: "cmluy7rjv000008ih8v4ik4hh", company: "Seattle Clean Out", owner: "Amy Nakamura", email: "amy@seattlecleanout.com", phone: "(206) 555-0789", plan: "enterprise", status: "active", trucks: 15, mrr: 549, joined: "2025-08-22", lastActive: "2026-02-20", jobs: 3201, city: "Seattle", state: "WA", ltv: 3843, monthsActive: 7,
    website: { subdomain: "seattlecleanout", vercelId: "prj_vwx234", status: "live", lastDeploy: "2026-02-17T08:30:00Z", templateVer: "1.4.2" },
    phoneAgent: { number: "+12065550789", twilioSid: "PN_abc008", areaCode: "206", status: "active", flyApp: "syj-agent-cl008", totalCalls: 823, minutes: 1489, cost: 175.60, lastRestart: "2026-02-20T03:00:00Z", errors: 0 },
    onboarding: { completed: true, step: 5, totalSteps: 5 },
    features: { scheduling: true, crm: true, driverPortal: true, photoQuote: true, phoneAgent: true, marketing: true } },
  { id: "cl_009", cuid: "cmluy7rjv000009ih8v4ik4ii", company: "Tampa Trash Haulers", owner: "Robert Garcia", email: "robert@tampatrash.com", phone: "(813) 555-0890", plan: "starter", status: "cancelled", trucks: 2, mrr: 0, joined: "2025-10-05", lastActive: "2025-12-28", jobs: 156, city: "Tampa", state: "FL", ltv: 447, monthsActive: 3,
    website: { subdomain: null, vercelId: null, status: "deleted", lastDeploy: null, templateVer: null },
    phoneAgent: { number: null, twilioSid: null, areaCode: "813", status: "released", flyApp: null, totalCalls: 45, minutes: 82, cost: 9.70, lastRestart: null, errors: 0 },
    onboarding: { completed: true, step: 5, totalSteps: 5 },
    features: { scheduling: false, crm: false, driverPortal: false, photoQuote: false, phoneAgent: false, marketing: false } },
  { id: "cl_010", cuid: "cmluy7rjv000010ih8v4ik4jj", company: "Chicago Junk Express", owner: "David Kim", email: "david@chijunkexpress.com", phone: "(312) 555-0934", plan: "growth", status: "active", trucks: 8, mrr: 299, joined: "2026-01-08", lastActive: "2026-02-21", jobs: 289, city: "Chicago", state: "IL", ltv: 448, monthsActive: 2,
    website: { subdomain: "chijunkexpress", vercelId: "prj_yz0567", status: "live", lastDeploy: "2026-02-20T19:00:00Z", templateVer: "1.4.2" },
    phoneAgent: { number: "+13125550934", twilioSid: "PN_abc010", areaCode: "312", status: "active", flyApp: "syj-agent-cl010", totalCalls: 98, minutes: 176, cost: 20.80, lastRestart: "2026-02-20T03:00:00Z", errors: 0 },
    onboarding: { completed: true, step: 5, totalSteps: 5 },
    features: { scheduling: true, crm: true, driverPortal: true, photoQuote: true, phoneAgent: true, marketing: false } },
];

const ALERTS = [
  { id: 1, type: "phone_error", severity: "critical", title: "Phone agent auth failure", detail: "Bay Area Junk Pros (cmluy7rjv000004ih8v4ik4rp) — 401 Unauthorized on config fetch. Agent crashed 3x in last hour.", client: "cl_004", time: "9 min ago", resolved: false },
  { id: 2, type: "payment", severity: "warning", title: "Payment failed", detail: "Denver Debris Removal — Visa ending 4242 declined. 2nd retry scheduled.", client: "cl_005", time: "7 hrs ago", resolved: false },
  { id: 3, type: "deploy", severity: "info", title: "Website building", detail: "CleanSweep DFW — Build in progress after onboarding step 3.", client: "cl_003", time: "45 min ago", resolved: false },
  { id: 4, type: "phone_error", severity: "warning", title: "High call volume", detail: "Seattle Clean Out — 823 calls this month, approaching 1000 call soft limit.", client: "cl_008", time: "2 hrs ago", resolved: false },
  { id: 5, type: "deploy", severity: "success", title: "Deploy successful", detail: "Chicago Junk Express — v1.4.2 deployed successfully.", client: "cl_010", time: "Yesterday", resolved: true },
  { id: 6, type: "payment", severity: "success", title: "Payment recovered", detail: "ATL Junk Removal Co — $299.00 collected on retry.", client: "cl_007", time: "Yesterday", resolved: true },
];

const CANCELLATIONS = [
  { client: "Tampa Trash Haulers", date: "2025-12-28", reason: "Too expensive for our volume", plan: "starter", monthsActive: 3, ltv: 447 },
];

const SIGNUP_DATA = [
  { date: "2025-08", count: 1 }, { date: "2025-09", count: 2 }, { date: "2025-10", count: 3 },
  { date: "2025-11", count: 3 }, { date: "2025-12", count: 3 }, { date: "2026-01", count: 2 }, { date: "2026-02", count: 1 },
];

const ONBOARDING_FUNNEL = [
  { step: "Signup", count: 15, pct: 100 },
  { step: "Company Info", count: 13, pct: 87 },
  { step: "Service Areas", count: 12, pct: 80 },
  { step: "Pricing Setup", count: 11, pct: 73 },
  { step: "Payment Method", count: 10, pct: 67 },
];

// ═══════════════════════════════════════════════════
// ICONS (inline SVGs)
// ═══════════════════════════════════════════════════
const I = {
  dashboard: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  users: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  dollar: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  globe: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  phone: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>,
  bell: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  chart: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  settings: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  search: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  plus: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  x: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  trash: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  edit: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  eye: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  arrowUp: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>,
  arrowDown: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>,
  refresh: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
  external: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
  pause: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>,
  play: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  check: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  copy: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
  impersonate: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  resetOnboard: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>,
  truck: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  activity: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
};

// ═══════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
const inputStyle = { padding: "9px 13px", borderRadius: "10px", border: `1px solid ${C.border}`, fontSize: "13px", color: C.text, outline: "none", width: "100%", boxSizing: "border-box", fontFamily: font.body };
const selectStyle = { ...inputStyle, background: "#fff", cursor: "pointer" };

function Badge({ status }) { const s = STATUS[status]; return <span style={{ background: s.bg, color: s.color, padding: "2px 9px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase" }}>{s.label}</span>; }
function PlanBadge({ plan }) { const p = PLANS[plan]; return <span style={{ background: p.color + "18", color: p.color, padding: "2px 9px", borderRadius: "20px", fontSize: "11px", fontWeight: 600 }}>{p.name}</span>; }

function SiteBadge({ status }) {
  const m = { live: { bg: C.success+"20", c: C.successDark, l: "Live" }, building: { bg: C.info+"20", c: C.info, l: "Building" }, error: { bg: C.danger+"20", c: C.danger, l: "Error" }, suspended: { bg: C.warn+"20", c: C.warnDark, l: "Suspended" }, deleted: { bg: "#6B728020", c: "#6B7280", l: "Deleted" } };
  const s = m[status] || m.error;
  return <span style={{ background: s.bg, color: s.c, padding: "2px 9px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, textTransform: "uppercase" }}>{s.l}</span>;
}

function PhoneStatusBadge({ status }) {
  const m = { active: { bg: C.success+"20", c: C.successDark, l: "Active" }, error: { bg: C.danger+"20", c: C.danger, l: "Error" }, released: { bg: "#6B728020", c: "#6B7280", l: "Released" }, disabled: { bg: C.warn+"20", c: C.warnDark, l: "Disabled" } };
  const s = m[status] || m.error;
  return <span style={{ background: s.bg, color: s.c, padding: "2px 9px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, textTransform: "uppercase" }}>{s.l}</span>;
}

function Kpi({ icon, label, value, change, dir, sub }) {
  return (
    <div style={{ background: C.white, borderRadius: "14px", padding: "20px", border: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <span style={{ color: C.textLight, fontSize: "12px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</span>
        <span style={{ color: C.textFaint }}>{icon}</span>
      </div>
      <div style={{ fontSize: "28px", fontWeight: 700, color: C.text, letterSpacing: "-0.02em", fontFamily: font.heading }}>{value}</div>
      {(change || sub) && <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", marginTop: "6px" }}>
        {change && <span style={{ display: "flex", alignItems: "center", gap: "2px", color: dir === "up" ? C.successDark : C.danger, fontWeight: 600 }}>{dir === "up" ? I.arrowUp : I.arrowDown} {change}</span>}
        {sub && <span style={{ color: C.textFaint }}>{sub}</span>}
      </div>}
    </div>
  );
}

function Card({ children, title, headerRight, noPad }) {
  return (
    <div style={{ background: C.white, borderRadius: "14px", border: `1px solid ${C.border}`, overflow: "hidden" }}>
      {title && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${C.borderLight}` }}>
        <h3 style={{ fontSize: "14px", fontWeight: 700, color: C.text, margin: 0, fontFamily: font.heading }}>{title}</h3>
        {headerRight}
      </div>}
      <div style={noPad ? {} : { padding: "20px" }}>{children}</div>
    </div>
  );
}

function Btn({ children, color = C.orange, variant = "primary", size = "sm", onClick, disabled, style: sx }) {
  const isPrimary = variant === "primary";
  return (
    <button disabled={disabled} onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: "6px",
      padding: size === "xs" ? "4px 10px" : size === "sm" ? "7px 14px" : "10px 20px",
      borderRadius: size === "xs" ? "7px" : "10px",
      border: isPrimary ? "none" : `1px solid ${color}30`,
      background: disabled ? "#CBD5E1" : isPrimary ? color : `${color}08`,
      color: isPrimary ? "#fff" : color,
      fontSize: size === "xs" ? "12px" : "13px", fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
      transition: "all 0.15s", fontFamily: font.body, ...sx
    }}>{children}</button>
  );
}

function Modal({ open, onClose, title, width, children }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(10,25,47,0.6)", backdropFilter: "blur(4px)" }} />
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", background: C.white, borderRadius: "18px", width: width || "560px", maxWidth: "95vw", maxHeight: "90vh", overflow: "auto", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px 0" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 700, color: C.text, fontFamily: font.heading, margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.textFaint, padding: "4px" }}>{I.x}</button>
        </div>
        <div style={{ padding: "16px 24px 24px" }}>{children}</div>
      </div>
    </div>
  );
}

function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, []);
  const bg = type === "success" ? C.success : type === "error" ? C.danger : C.info;
  return <div style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 2000, background: bg, color: "#fff", padding: "12px 20px", borderRadius: "12px", fontSize: "13px", fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.2)", display: "flex", alignItems: "center", gap: "8px", fontFamily: font.body }}>
    {type === "success" && I.check}{message}
  </div>;
}

function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel, danger }) {
  const [typed, setTyped] = useState("");
  if (!open) return null;
  const needsTyping = danger?.confirmText;
  return (
    <Modal open={open} onClose={() => { setTyped(""); onClose(); }} title={title} width="460px">
      {danger && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "10px", padding: "14px", marginBottom: "16px" }}>
        <p style={{ color: C.dangerDark, fontSize: "13px", margin: 0, lineHeight: 1.5 }}>{message}</p>
      </div>}
      {!danger && <p style={{ color: C.textMuted, fontSize: "14px", lineHeight: 1.5, margin: "0 0 16px" }}>{message}</p>}
      {needsTyping && <div style={{ marginBottom: "16px" }}>
        <label style={{ fontSize: "12px", fontWeight: 600, color: C.textMuted, marginBottom: "4px", display: "block" }}>Type <strong style={{ color: C.danger }}>{danger.confirmText}</strong> to confirm</label>
        <input style={inputStyle} value={typed} onChange={e => setTyped(e.target.value)} placeholder={danger.confirmText} />
      </div>}
      <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
        <Btn variant="ghost" color={C.textLight} onClick={() => { setTyped(""); onClose(); }}>Cancel</Btn>
        <Btn color={danger ? C.danger : C.orange} disabled={needsTyping && typed !== danger.confirmText} onClick={() => { setTyped(""); onConfirm(); }}>{confirmLabel || "Confirm"}</Btn>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════
// PAGE: CLIENT OVERVIEW
// ═══════════════════════════════════════════════════
function PageOverview({ clients, alerts, setPage, setSelectedClient }) {
  const active = clients.filter(c => ["active","trial","past_due"].includes(c.status));
  const totalMrr = clients.reduce((s, c) => s + c.mrr, 0);
  const totalTrucks = clients.filter(c => c.status === "active").reduce((s, c) => s + c.trucks, 0);
  const churnRate = clients.length ? ((clients.filter(c => c.status === "cancelled").length / clients.length) * 100).toFixed(1) : 0;
  const trials = clients.filter(c => c.status === "trial");
  const unresolvedAlerts = alerts.filter(a => !a.resolved);

  return (<div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "16px" }}>
      <Kpi icon={I.users} label="Total Clients" value={clients.length} change="+3" dir="up" sub="this month" />
      <Kpi icon={I.dollar} label="MRR" value={`$${totalMrr.toLocaleString()}`} change="+18%" dir="up" sub="vs last month" />
      <Kpi icon={I.truck} label="Trucks Managed" value={totalTrucks} />
      <Kpi icon={I.users} label="Active Trials" value={trials.length} sub={trials.length ? `${trials.map(t=>t.company).join(", ")}` : "No active trials"} />
      <Kpi icon={I.activity} label="Churn Rate" value={`${churnRate}%`} change="1 cancel" dir="down" sub="lifetime" />
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "20px" }}>
      <Card title="Client Directory" headerRight={<Btn size="xs" onClick={() => setPage("clients")}>{I.eye} View All</Btn>} noPad>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead><tr style={{ background: C.surface }}>
              {["Company","Plan","Status","Site","Phone","Jobs"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: "11px", fontWeight: 600, color: C.textLight, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>)}
            </tr></thead>
            <tbody>{clients.slice(0, 6).map(c => (
              <tr key={c.id} onClick={() => { setSelectedClient(c); setPage("clients"); }} style={{ borderBottom: `1px solid ${C.borderLight}`, cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = C.surface} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "10px 14px" }}><div style={{ fontWeight: 600, color: C.text }}>{c.company}</div><div style={{ fontSize: "11px", color: C.textFaint }}>{c.city}, {c.state}</div></td>
                <td style={{ padding: "10px 14px" }}><PlanBadge plan={c.plan} /></td>
                <td style={{ padding: "10px 14px" }}><Badge status={c.status} /></td>
                <td style={{ padding: "10px 14px" }}><SiteBadge status={c.website.status} /></td>
                <td style={{ padding: "10px 14px" }}><PhoneStatusBadge status={c.phoneAgent.status} /></td>
                <td style={{ padding: "10px 14px", fontWeight: 600, fontFamily: font.heading }}>{c.jobs.toLocaleString()}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>

      <Card title="Active Alerts" headerRight={<span style={{ fontSize: "12px", fontWeight: 700, color: unresolvedAlerts.length ? C.danger : C.successDark }}>{unresolvedAlerts.length} unresolved</span>}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {unresolvedAlerts.map(a => (
            <div key={a.id} style={{ padding: "10px 12px", borderRadius: "10px", border: `1px solid ${a.severity === "critical" ? C.danger : a.severity === "warning" ? C.warn : C.info}30`, background: `${a.severity === "critical" ? C.danger : a.severity === "warning" ? C.warn : C.info}08` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <span style={{ fontSize: "12px", fontWeight: 700, color: a.severity === "critical" ? C.danger : a.severity === "warning" ? C.warnDark : C.info }}>{a.title}</span>
                <span style={{ fontSize: "10px", color: C.textFaint, flexShrink: 0, marginLeft: "8px" }}>{a.time}</span>
              </div>
              <div style={{ fontSize: "11px", color: C.textMuted, marginTop: "3px", lineHeight: 1.4 }}>{a.detail}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════
// PAGE: CLIENTS (full CRUD + actions)
// ═══════════════════════════════════════════════════
function PageClients({ clients, setClients, selectedClient, setSelectedClient, addToast }) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPlan, setFilterPlan] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [detail, setDetail] = useState(selectedClient || null);
  const [sortField, setSortField] = useState("company");
  const [sortDir, setSortDir] = useState("asc");

  useEffect(() => { if (selectedClient) { setDetail(selectedClient); setSelectedClient(null); } }, [selectedClient]);

  const filtered = clients.filter(c => {
    const s = search.toLowerCase();
    return (!s || c.company.toLowerCase().includes(s) || c.owner.toLowerCase().includes(s) || c.email.toLowerCase().includes(s) || c.cuid.includes(s) || c.city.toLowerCase().includes(s))
      && (filterStatus === "all" || c.status === filterStatus)
      && (filterPlan === "all" || c.plan === filterPlan);
  }).sort((a, b) => {
    let av = a[sortField], bv = b[sortField];
    if (typeof av === "string") { av = av.toLowerCase(); bv = bv.toLowerCase(); }
    return sortDir === "asc" ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
  });

  const toggleSort = f => { if (sortField === f) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortField(f); setSortDir("asc"); } };
  const ThCell = ({ field, children }) => <th onClick={() => toggleSort(field)} style={{ padding: "10px 14px", textAlign: "left", fontSize: "11px", fontWeight: 600, color: C.textLight, textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", borderBottom: `2px solid ${C.borderLight}` }}>
    <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>{children}{sortField === field && (sortDir === "asc" ? I.arrowUp : I.arrowDown)}</span></th>;

  const updateClient = (id, upd) => setClients(prev => prev.map(c => c.id === id ? { ...c, ...upd } : c));
  const deleteClient = (id) => { setClients(prev => prev.filter(c => c.id !== id)); addToast("Client deleted — all services torn down", "success"); };
  const addClient = (c) => { setClients(prev => [c, ...prev]); addToast(`${c.company} created`, "success"); };

  return (<div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", gap: "12px", flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: C.textFaint }}>{I.search}</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, CUID..." style={{ ...inputStyle, paddingLeft: "32px", width: "240px" }} />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...selectStyle, width: "auto" }}>
          <option value="all">All Status</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)} style={{ ...selectStyle, width: "auto" }}>
          <option value="all">All Plans</option>
          {Object.entries(PLANS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
        </select>
        <span style={{ fontSize: "12px", color: C.textFaint }}>{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
      </div>
      <Btn onClick={() => setShowAdd(true)}>{I.plus} Add Client</Btn>
    </div>

    <Card noPad>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead><tr style={{ background: C.surface }}>
            <ThCell field="company">Company</ThCell>
            <ThCell field="plan">Plan</ThCell>
            <ThCell field="status">Account</ThCell>
            <th style={{ padding: "10px 14px", fontSize: "11px", fontWeight: 600, color: C.textLight, textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "left", borderBottom: `2px solid ${C.borderLight}` }}>Site</th>
            <th style={{ padding: "10px 14px", fontSize: "11px", fontWeight: 600, color: C.textLight, textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "left", borderBottom: `2px solid ${C.borderLight}` }}>Phone</th>
            <ThCell field="mrr">MRR</ThCell>
            <ThCell field="jobs">Jobs</ThCell>
            <ThCell field="lastActive">Active</ThCell>
            <th style={{ padding: "10px 14px", borderBottom: `2px solid ${C.borderLight}`, width: "140px" }}></th>
          </tr></thead>
          <tbody>{filtered.map(c => (
            <tr key={c.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}
              onMouseEnter={e => e.currentTarget.style.background = C.surface} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <td style={{ padding: "10px 14px" }}>
                <div style={{ fontWeight: 600, color: C.text }}>{c.company}</div>
                <div style={{ fontSize: "11px", color: C.textFaint }}>{c.city}, {c.state} · {c.owner}</div>
              </td>
              <td style={{ padding: "10px 14px" }}><PlanBadge plan={c.plan} /></td>
              <td style={{ padding: "10px 14px" }}><Badge status={c.status} /></td>
              <td style={{ padding: "10px 14px" }}><SiteBadge status={c.website.status} /></td>
              <td style={{ padding: "10px 14px" }}><PhoneStatusBadge status={c.phoneAgent.status} /></td>
              <td style={{ padding: "10px 14px", fontWeight: 600, fontFamily: font.heading }}>${c.mrr}</td>
              <td style={{ padding: "10px 14px" }}>{c.jobs.toLocaleString()}</td>
              <td style={{ padding: "10px 14px", fontSize: "12px", color: C.textFaint }}>{fmtDate(c.lastActive)}</td>
              <td style={{ padding: "10px 14px" }}>
                <div style={{ display: "flex", gap: "4px" }}>
                  <Btn variant="ghost" color={C.textLight} size="xs" onClick={() => setDetail(c)}>{I.eye}</Btn>
                  <Btn variant="ghost" color={C.orange} size="xs" onClick={() => setDetail(c)}>{I.edit}</Btn>
                  <Btn variant="ghost" color={C.danger} size="xs" onClick={() => setDeleteTarget(c)}>{I.trash}</Btn>
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table>
        {filtered.length === 0 && <div style={{ padding: "40px", textAlign: "center", color: C.textFaint, fontSize: "13px" }}>No clients match your filters</div>}
      </div>
    </Card>

    {/* Add Client Modal */}
    <AddClientModal open={showAdd} onClose={() => setShowAdd(false)} onAdd={addClient} />

    {/* Delete Confirm */}
    <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Client Account" danger={{ confirmText: deleteTarget?.company }}
      message={<>All data for <strong>{deleteTarget?.company}</strong> will be permanently destroyed. This triggers: Stripe subscription cancel → Vercel project delete → Twilio number release → full DB cascade delete.</>}
      confirmLabel="Delete Everything" onConfirm={() => { deleteClient(deleteTarget.id); setDeleteTarget(null); }} />

    {/* Client Detail Drawer */}
    <ClientDetailDrawer client={detail ? clients.find(c => c.id === detail.id) : null} onClose={() => setDetail(null)} onUpdate={updateClient} onDelete={id => { setDetail(null); setDeleteTarget(clients.find(c => c.id === id)); }} addToast={addToast} />
  </div>);
}

function AddClientModal({ open, onClose, onAdd }) {
  const [f, setF] = useState({ company: "", owner: "", email: "", phone: "", plan: "growth", trucks: 1, city: "", state: "", skipTrial: false, sendInvite: true });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const valid = f.company && f.owner && f.email;

  return <Modal open={open} onClose={onClose} title="Add New Client (Skip Onboarding)" width="600px">
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
      {[["Company Name", "company", "e.g. Junk King Austin", true], ["Owner Name", "owner", "Full name", true], ["Email", "email", "owner@company.com", true, "email"], ["Phone", "phone", "(555) 000-0000"]].map(([label, key, ph, req, type]) =>
        <div key={key}><label style={{ fontSize: "12px", fontWeight: 600, color: C.textMuted, marginBottom: "4px", display: "block" }}>{label}{req && <span style={{ color: C.danger }}> *</span>}</label>
        <input type={type || "text"} style={inputStyle} value={f[key]} onChange={e => set(key, e.target.value)} placeholder={ph} /></div>
      )}
      <div><label style={{ fontSize: "12px", fontWeight: 600, color: C.textMuted, marginBottom: "4px", display: "block" }}>Plan</label>
        <select style={selectStyle} value={f.plan} onChange={e => set("plan", e.target.value)}>
          {Object.entries(PLANS).map(([k, v]) => <option key={k} value={k}>{v.name} — ${v.price}/mo</option>)}
        </select></div>
      <div><label style={{ fontSize: "12px", fontWeight: 600, color: C.textMuted, marginBottom: "4px", display: "block" }}>Trucks</label>
        <input type="number" min="1" style={inputStyle} value={f.trucks} onChange={e => set("trucks", e.target.value)} /></div>
      <div><label style={{ fontSize: "12px", fontWeight: 600, color: C.textMuted, marginBottom: "4px", display: "block" }}>City</label>
        <input style={inputStyle} value={f.city} onChange={e => set("city", e.target.value)} placeholder="City" /></div>
      <div><label style={{ fontSize: "12px", fontWeight: 600, color: C.textMuted, marginBottom: "4px", display: "block" }}>State</label>
        <input style={inputStyle} value={f.state} onChange={e => set("state", e.target.value)} placeholder="TX" maxLength={2} /></div>
    </div>
    <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
      {[["skipTrial", "Skip trial — activate with billing immediately"], ["sendInvite", "Send welcome email with login credentials"]].map(([key, label]) =>
        <label key={key} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", color: C.textMuted }}>
          <input type="checkbox" checked={f[key]} onChange={e => set(key, e.target.checked)} style={{ width: "16px", height: "16px", accentColor: C.orange }} />{label}
        </label>
      )}
    </div>
    <div style={{ marginTop: "20px", display: "flex", gap: "10px", justifyContent: "flex-end" }}>
      <Btn variant="ghost" color={C.textLight} onClick={onClose}>Cancel</Btn>
      <Btn disabled={!valid} onClick={() => {
        onAdd({ id: "cl_" + Date.now().toString(36), cuid: "cm" + Math.random().toString(36).slice(2, 24), company: f.company, owner: f.owner, email: f.email, phone: f.phone, plan: f.plan, status: f.skipTrial ? "active" : "trial", trucks: Number(f.trucks), mrr: f.skipTrial ? PLANS[f.plan].price : 0, joined: new Date().toISOString().split("T")[0], lastActive: new Date().toISOString().split("T")[0], jobs: 0, city: f.city, state: f.state, ltv: 0, monthsActive: 0,
          website: { subdomain: f.company.toLowerCase().replace(/[^a-z0-9]/g, ""), vercelId: null, status: "building", lastDeploy: null, templateVer: "1.4.2" },
          phoneAgent: { number: null, twilioSid: null, areaCode: "", status: "disabled", flyApp: null, totalCalls: 0, minutes: 0, cost: 0, lastRestart: null, errors: 0 },
          onboarding: { completed: f.skipTrial, step: f.skipTrial ? 5 : 0, totalSteps: 5 },
          features: { scheduling: true, crm: true, driverPortal: false, photoQuote: f.plan !== "starter", phoneAgent: f.plan !== "starter", marketing: false }
        });
        setF({ company: "", owner: "", email: "", phone: "", plan: "growth", trucks: 1, city: "", state: "", skipTrial: false, sendInvite: true });
        onClose();
      }}>Create Account</Btn>
    </div>
  </Modal>;
}

function ClientDetailDrawer({ client, onClose, onUpdate, onDelete, addToast }) {
  const [editPlan, setEditPlan] = useState(false);
  if (!client) return null;
  const c = client;
  const act = (label, fn) => { fn(); addToast(label, "success"); };

  return <Modal open={true} onClose={() => { setEditPlan(false); onClose(); }} title={c.company} width="720px">
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "20px" }}>
      <Badge status={c.status} /><PlanBadge plan={c.plan} /><SiteBadge status={c.website.status} /><PhoneStatusBadge status={c.phoneAgent.status} />
      <span style={{ fontSize: "11px", color: C.textFaint, display: "flex", alignItems: "center", gap: "3px", marginLeft: "4px" }}>{I.copy} {c.cuid}</span>
    </div>

    {/* Info Grid */}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 24px", marginBottom: "24px", fontSize: "13px" }}>
      {[["Owner", c.owner], ["Email", c.email], ["Phone", c.phone || "—"], ["Location", `${c.city}, ${c.state}`], ["Joined", fmtDate(c.joined)], ["Last Active", fmtDate(c.lastActive)], ["Trucks", c.trucks], ["Total Jobs", c.jobs.toLocaleString()], ["MRR", `$${c.mrr}`], ["LTV", `$${c.ltv}`], ["Months Active", c.monthsActive], ["Onboarding", c.onboarding.completed ? "Complete" : `Step ${c.onboarding.step}/${c.onboarding.totalSteps}`]].map(([l, v]) =>
        <div key={l}><div style={{ fontSize: "11px", color: C.textFaint, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "2px" }}>{l}</div><div style={{ color: C.text, fontWeight: 500 }}>{v}</div></div>
      )}
    </div>

    {/* Website Info */}
    <div style={{ borderTop: `1px solid ${C.borderLight}`, paddingTop: "16px", marginBottom: "16px" }}>
      <h4 style={{ fontSize: "12px", fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px" }}>Website</h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", fontSize: "12px" }}>
        <div><span style={{ color: C.textFaint }}>Subdomain:</span> <span style={{ fontWeight: 500 }}>{c.website.subdomain || "—"}</span></div>
        <div><span style={{ color: C.textFaint }}>Template:</span> <span style={{ fontWeight: 500 }}>{c.website.templateVer || "—"}</span></div>
        <div><span style={{ color: C.textFaint }}>Last Deploy:</span> <span style={{ fontWeight: 500 }}>{fmtDateTime(c.website.lastDeploy)}</span></div>
      </div>
    </div>

    {/* Phone Info */}
    <div style={{ borderTop: `1px solid ${C.borderLight}`, paddingTop: "16px", marginBottom: "16px" }}>
      <h4 style={{ fontSize: "12px", fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px" }}>Phone Agent</h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", fontSize: "12px" }}>
        <div><span style={{ color: C.textFaint }}>Number:</span> <span style={{ fontWeight: 500 }}>{c.phoneAgent.number || "—"}</span></div>
        <div><span style={{ color: C.textFaint }}>Calls:</span> <span style={{ fontWeight: 500 }}>{c.phoneAgent.totalCalls} ({c.phoneAgent.minutes} min)</span></div>
        <div><span style={{ color: C.textFaint }}>Twilio Cost:</span> <span style={{ fontWeight: 500 }}>${c.phoneAgent.cost.toFixed(2)}</span></div>
        <div><span style={{ color: C.textFaint }}>Fly App:</span> <span style={{ fontWeight: 500 }}>{c.phoneAgent.flyApp || "—"}</span></div>
        <div><span style={{ color: C.textFaint }}>Errors:</span> <span style={{ fontWeight: 500, color: c.phoneAgent.errors > 0 ? C.danger : C.successDark }}>{c.phoneAgent.errors}</span></div>
        <div><span style={{ color: C.textFaint }}>Last Restart:</span> <span style={{ fontWeight: 500 }}>{fmtDateTime(c.phoneAgent.lastRestart)}</span></div>
      </div>
    </div>

    {/* Feature Usage */}
    <div style={{ borderTop: `1px solid ${C.borderLight}`, paddingTop: "16px", marginBottom: "20px" }}>
      <h4 style={{ fontSize: "12px", fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px" }}>Feature Usage</h4>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {Object.entries(c.features).map(([k, v]) => <span key={k} style={{ padding: "3px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, background: v ? C.success + "18" : C.border, color: v ? C.successDark : C.textFaint }}>{k.replace(/([A-Z])/g, " $1").trim()}</span>)}
      </div>
    </div>

    {/* Actions */}
    <div style={{ borderTop: `1px solid ${C.borderLight}`, paddingTop: "16px" }}>
      <h4 style={{ fontSize: "12px", fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>Actions</h4>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {!editPlan ? (
          <Btn variant="ghost" color={C.purple} size="xs" onClick={() => setEditPlan(true)}>{I.edit} Change Plan</Btn>
        ) : (
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            {Object.entries(PLANS).map(([k, v]) => <Btn key={k} variant={k === c.plan ? "primary" : "ghost"} color={v.color} size="xs" onClick={() => { onUpdate(c.id, { plan: k, mrr: c.status === "active" ? v.price : c.mrr }); setEditPlan(false); addToast(`Plan changed to ${v.name}`, "success"); }}>{v.name}</Btn>)}
            <button onClick={() => setEditPlan(false)} style={{ background: "none", border: "none", fontSize: "11px", color: C.textFaint, cursor: "pointer" }}>cancel</button>
          </div>
        )}
        {c.status === "active" && <Btn variant="ghost" color={C.warn} size="xs" onClick={() => act("Account suspended", () => onUpdate(c.id, { status: "suspended", mrr: 0 }))}>{I.pause} Suspend</Btn>}
        {c.status === "suspended" && <Btn variant="ghost" color={C.success} size="xs" onClick={() => act("Account reactivated", () => onUpdate(c.id, { status: "active", mrr: PLANS[c.plan].price }))}>{I.play} Reactivate</Btn>}
        {c.status === "trial" && <Btn variant="ghost" color={C.success} size="xs" onClick={() => act("Converted to paid", () => onUpdate(c.id, { status: "active", mrr: PLANS[c.plan].price }))}>{I.check} Convert to Paid</Btn>}
        {c.status === "past_due" && <Btn variant="ghost" color={C.info} size="xs" onClick={() => addToast("Payment retry triggered", "success")}>{I.refresh} Retry Payment</Btn>}
        <Btn variant="ghost" color={C.info} size="xs" onClick={() => addToast(`Impersonating ${c.company}...`, "success")}>{I.impersonate} Impersonate</Btn>
        {!c.onboarding.completed && <Btn variant="ghost" color={C.warnDark} size="xs" onClick={() => { onUpdate(c.id, { onboarding: { completed: false, step: 0, totalSteps: 5 } }); addToast("Onboarding reset", "success"); }}>{I.resetOnboard} Reset Onboarding</Btn>}
        {c.website.status !== "deleted" && <Btn variant="ghost" color={C.info} size="xs" onClick={() => addToast(`Redeploy triggered for ${c.website.subdomain}`, "success")}>{I.refresh} Redeploy Site</Btn>}
        {c.phoneAgent.status === "error" && <Btn variant="ghost" color={C.danger} size="xs" onClick={() => { onUpdate(c.id, { phoneAgent: { ...c.phoneAgent, status: "active", errors: 0 } }); addToast("Phone agent restarted", "success"); }}>{I.refresh} Restart Agent</Btn>}
        <Btn variant="ghost" color={C.danger} size="xs" onClick={() => { onClose(); onDelete(c.id); }}>{I.trash} Delete Account</Btn>
      </div>
    </div>
  </Modal>;
}

// ═══════════════════════════════════════════════════
// PAGE: REVENUE & BILLING
// ═══════════════════════════════════════════════════
function PageBilling({ clients }) {
  const totalMrr = clients.reduce((s, c) => s + c.mrr, 0);
  const pastDue = clients.filter(c => c.status === "past_due");
  const totalLtv = clients.reduce((s, c) => s + c.ltv, 0);
  const avgLtv = clients.length ? Math.round(totalLtv / clients.length) : 0;

  const payments = [
    { client: "ATL Junk Removal Co", amount: 299, date: "Feb 21", status: "paid" },
    { client: "Bay Area Junk Pros", amount: 549, date: "Feb 20", status: "paid" },
    { client: "Houston Haul Away", amount: 149, date: "Feb 20", status: "paid" },
    { client: "Denver Debris Removal", amount: 299, date: "Feb 19", status: "failed" },
    { client: "Junk King Austin", amount: 299, date: "Feb 18", status: "paid" },
    { client: "Chicago Junk Express", amount: 299, date: "Feb 15", status: "paid" },
    { client: "Seattle Clean Out", amount: 549, date: "Feb 14", status: "paid" },
  ];

  return (<div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
      <Kpi icon={I.dollar} label="MRR" value={`$${totalMrr.toLocaleString()}`} change="+$847" dir="up" sub="vs last month" />
      <Kpi icon={I.dollar} label="ARR (Projected)" value={`$${(totalMrr * 12).toLocaleString()}`} />
      <Kpi icon={I.dollar} label="Avg LTV" value={`$${avgLtv}`} />
      <Kpi icon={I.bell} label="Past Due" value={pastDue.length} change={pastDue.length > 0 ? "Action needed" : "None"} dir={pastDue.length > 0 ? "down" : "up"} />
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
      <Card title="Recent Payments">
        {payments.map((p, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < payments.length - 1 ? `1px solid ${C.borderLight}` : "none" }}>
            <div><div style={{ fontSize: "13px", fontWeight: 500, color: C.textMuted }}>{p.client}</div><div style={{ fontSize: "11px", color: C.textFaint }}>{p.date}</div></div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "14px", fontWeight: 600, fontFamily: font.heading }}>${p.amount}</span>
              <span style={{ padding: "2px 7px", borderRadius: "20px", fontSize: "10px", fontWeight: 600, background: p.status === "paid" ? C.success + "20" : C.danger + "20", color: p.status === "paid" ? C.successDark : C.danger, textTransform: "uppercase" }}>{p.status}</span>
            </div>
          </div>
        ))}
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <Card title="Revenue by Plan">
          {Object.entries(PLANS).map(([k, v]) => {
            const pc = clients.filter(c => c.plan === k && c.status === "active");
            const rev = pc.length * v.price;
            return <div key={k} style={{ marginBottom: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: C.textMuted }}>{v.name} <span style={{ color: C.textFaint, fontWeight: 400 }}>({pc.length})</span></span>
                <span style={{ fontSize: "13px", fontWeight: 700, color: v.color, fontFamily: font.heading }}>${rev}/mo</span>
              </div>
              <div style={{ height: "6px", background: C.borderLight, borderRadius: "3px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: totalMrr ? `${(rev / totalMrr) * 100}%` : "0%", background: v.color, borderRadius: "3px" }} />
              </div>
            </div>;
          })}
        </Card>

        <Card title="Revenue per Client">
          <div style={{ maxHeight: "200px", overflowY: "auto" }}>
            {clients.filter(c => c.mrr > 0).sort((a, b) => b.ltv - a.ltv).map(c => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.borderLight}`, fontSize: "12px" }}>
                <span style={{ color: C.textMuted, fontWeight: 500 }}>{c.company}</span>
                <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                  <span style={{ color: C.textFaint }}>${c.mrr}/mo</span>
                  <span style={{ fontWeight: 600, color: C.text, fontFamily: font.heading }}>${c.ltv} LTV</span>
                  <span style={{ color: C.textFaint }}>{c.monthsActive}mo</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {CANCELLATIONS.length > 0 && <Card title="Cancellation Log">
          {CANCELLATIONS.map((c, i) => (
            <div key={i} style={{ padding: "10px 12px", background: "#FEF2F2", borderRadius: "10px", marginBottom: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: C.dangerDark }}>{c.client}</span>
                <span style={{ fontSize: "11px", color: C.textFaint }}>{fmtDate(c.date)}</span>
              </div>
              <div style={{ fontSize: "12px", color: C.textMuted, marginTop: "3px" }}>Reason: "{c.reason}" · {c.monthsActive}mo active · ${c.ltv} LTV</div>
            </div>
          ))}
        </Card>}
      </div>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════
// PAGE: WEBSITE MANAGEMENT
// ═══════════════════════════════════════════════════
function PageWebsites({ clients, setClients, addToast }) {
  const sites = clients.filter(c => c.website.status !== "deleted");
  const liveCount = sites.filter(s => s.website.status === "live").length;
  const outdated = sites.filter(s => s.website.templateVer && s.website.templateVer !== "1.4.2");

  return (<div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
      <Kpi icon={I.globe} label="Deployed Sites" value={sites.length} />
      <Kpi icon={I.check} label="Live & Healthy" value={liveCount} />
      <Kpi icon={I.refresh} label="Outdated Template" value={outdated.length} sub={outdated.length > 0 ? "Need redeploy" : "All current"} />
      <Kpi icon={I.settings} label="Current Template" value="v1.4.2" />
    </div>

    <Card title="All Client Websites" headerRight={<Btn size="xs" color={C.purple} onClick={() => addToast("Bulk redeploy triggered for all sites", "success")}>{I.refresh} Bulk Redeploy All</Btn>} noPad>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead><tr style={{ background: C.surface }}>
          {["Client","Subdomain","Vercel ID","Status","Template","Last Deploy",""].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: "11px", fontWeight: 600, color: C.textLight, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>)}
        </tr></thead>
        <tbody>{sites.map(c => (
          <tr key={c.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}
            onMouseEnter={e => e.currentTarget.style.background = C.surface} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <td style={{ padding: "10px 14px", fontWeight: 600, color: C.text }}>{c.company}</td>
            <td style={{ padding: "10px 14px" }}><span style={{ fontFamily: "monospace", fontSize: "12px", background: C.surface, padding: "2px 6px", borderRadius: "4px" }}>{c.website.subdomain}.scaleyourjunk.com</span></td>
            <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: "11px", color: C.textFaint }}>{c.website.vercelId || "—"}</td>
            <td style={{ padding: "10px 14px" }}><SiteBadge status={c.website.status} /></td>
            <td style={{ padding: "10px 14px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: c.website.templateVer === "1.4.2" ? C.successDark : C.warnDark }}>{c.website.templateVer || "—"}</span>
            </td>
            <td style={{ padding: "10px 14px", fontSize: "12px", color: C.textFaint }}>{fmtDateTime(c.website.lastDeploy)}</td>
            <td style={{ padding: "10px 14px" }}>
              <div style={{ display: "flex", gap: "4px" }}>
                <Btn variant="ghost" color={C.info} size="xs" onClick={() => addToast(`Redeploy: ${c.website.subdomain}`, "success")}>{I.refresh}</Btn>
                <Btn variant="ghost" color={C.textLight} size="xs" onClick={() => window.open(`https://${c.website.subdomain}.scaleyourjunk.com`, "_blank")}>{I.external}</Btn>
                <Btn variant="ghost" color={C.danger} size="xs" onClick={() => { setClients(prev => prev.map(cl => cl.id === c.id ? { ...cl, website: { ...cl.website, status: "deleted", vercelId: null } } : cl)); addToast("Site deleted", "success"); }}>{I.trash}</Btn>
              </div>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  </div>);
}

// ═══════════════════════════════════════════════════
// PAGE: PHONE AGENT MANAGEMENT
// ═══════════════════════════════════════════════════
function PagePhoneAgents({ clients, setClients, addToast }) {
  const agents = clients.filter(c => c.phoneAgent.number || c.phoneAgent.status !== "released");
  const activeAgents = agents.filter(a => a.phoneAgent.status === "active");
  const errorAgents = agents.filter(a => a.phoneAgent.status === "error");
  const totalCalls = clients.reduce((s, c) => s + c.phoneAgent.totalCalls, 0);
  const totalCost = clients.reduce((s, c) => s + c.phoneAgent.cost, 0);

  return (<div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "16px" }}>
      <Kpi icon={I.phone} label="Provisioned Numbers" value={agents.filter(a => a.phoneAgent.number).length} />
      <Kpi icon={I.check} label="Active Agents" value={activeAgents.length} />
      <Kpi icon={I.bell} label="Errored Agents" value={errorAgents.length} change={errorAgents.length > 0 ? "Fix now" : ""} dir="down" />
      <Kpi icon={I.activity} label="Total Calls" value={totalCalls.toLocaleString()} sub="all time" />
      <Kpi icon={I.dollar} label="Twilio Cost" value={`$${totalCost.toFixed(2)}`} sub="all time" />
    </div>

    {errorAgents.length > 0 && <div style={{ background: "#FEF2F2", border: `1px solid #FECACA`, borderRadius: "14px", padding: "16px 20px" }}>
      <h4 style={{ fontSize: "13px", fontWeight: 700, color: C.dangerDark, marginBottom: "10px" }}>Agent Errors Requiring Attention</h4>
      {errorAgents.map(c => (
        <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid #FECACA40` }}>
          <div>
            <span style={{ fontSize: "13px", fontWeight: 600, color: C.dangerDark }}>{c.company}</span>
            <span style={{ fontSize: "11px", color: C.textFaint, marginLeft: "8px" }}>{c.phoneAgent.flyApp} · {c.phoneAgent.errors} errors</span>
            <div style={{ fontSize: "11px", color: C.textMuted, fontFamily: "monospace", marginTop: "2px" }}>401 Unauthorized on config fetch for {c.cuid}</div>
          </div>
          <Btn size="xs" color={C.danger} onClick={() => { setClients(prev => prev.map(cl => cl.id === c.id ? { ...cl, phoneAgent: { ...cl.phoneAgent, status: "active", errors: 0 } } : cl)); addToast(`Agent restarted: ${c.phoneAgent.flyApp}`, "success"); }}>{I.refresh} Restart</Btn>
        </div>
      ))}
    </div>}

    <Card title="All Phone Agents" noPad>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead><tr style={{ background: C.surface }}>
          {["Client","Number","Twilio SID","Status","Fly App","Calls","Minutes","Cost","Last Restart",""].map(h => <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: "10px", fontWeight: 600, color: C.textLight, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>)}
        </tr></thead>
        <tbody>{clients.filter(c => c.phoneAgent.status !== "released").map(c => (
          <tr key={c.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}
            onMouseEnter={e => e.currentTarget.style.background = C.surface} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <td style={{ padding: "10px 12px", fontWeight: 600, color: C.text }}>{c.company}</td>
            <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: "12px" }}>{c.phoneAgent.number || "—"}</td>
            <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: "11px", color: C.textFaint }}>{c.phoneAgent.twilioSid || "—"}</td>
            <td style={{ padding: "10px 12px" }}><PhoneStatusBadge status={c.phoneAgent.status} /></td>
            <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: "11px" }}>{c.phoneAgent.flyApp || "—"}</td>
            <td style={{ padding: "10px 12px", fontWeight: 600, fontFamily: font.heading }}>{c.phoneAgent.totalCalls}</td>
            <td style={{ padding: "10px 12px" }}>{c.phoneAgent.minutes}</td>
            <td style={{ padding: "10px 12px", fontFamily: font.heading }}>${c.phoneAgent.cost.toFixed(2)}</td>
            <td style={{ padding: "10px 12px", fontSize: "11px", color: C.textFaint }}>{fmtDateTime(c.phoneAgent.lastRestart)}</td>
            <td style={{ padding: "10px 12px" }}>
              <div style={{ display: "flex", gap: "4px" }}>
                {c.phoneAgent.status === "error" && <Btn variant="ghost" color={C.danger} size="xs" onClick={() => { setClients(prev => prev.map(cl => cl.id === c.id ? { ...cl, phoneAgent: { ...cl.phoneAgent, status: "active", errors: 0 } } : cl)); addToast("Agent restarted", "success"); }}>{I.refresh}</Btn>}
                {c.phoneAgent.number && <Btn variant="ghost" color={C.textLight} size="xs" onClick={() => { setClients(prev => prev.map(cl => cl.id === c.id ? { ...cl, phoneAgent: { ...cl.phoneAgent, number: null, twilioSid: null, status: "released", flyApp: null } } : cl)); addToast("Number released", "success"); }}>{I.trash}</Btn>}
              </div>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  </div>);
}

// ═══════════════════════════════════════════════════
// PAGE: ALERTS
// ═══════════════════════════════════════════════════
function PageAlerts({ alerts, setAlerts }) {
  const [filter, setFilter] = useState("all");
  const filtered = alerts.filter(a => filter === "all" || (filter === "unresolved" && !a.resolved) || (filter === "resolved" && a.resolved) || a.type === filter);
  const sevColors = { critical: C.danger, warning: C.warn, info: C.info, success: C.success };

  return (<div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
      <Kpi icon={I.bell} label="Total Alerts" value={alerts.length} />
      <Kpi icon={I.bell} label="Unresolved" value={alerts.filter(a => !a.resolved).length} change={alerts.filter(a => !a.resolved && a.severity === "critical").length ? "critical" : ""} dir="down" />
      <Kpi icon={I.phone} label="Phone Errors" value={alerts.filter(a => a.type === "phone_error" && !a.resolved).length} />
      <Kpi icon={I.dollar} label="Payment Issues" value={alerts.filter(a => a.type === "payment" && !a.resolved).length} />
    </div>

    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
      {[["all", "All"], ["unresolved", "Unresolved"], ["phone_error", "Phone"], ["payment", "Payment"], ["deploy", "Deploy"]].map(([k, l]) =>
        <button key={k} onClick={() => setFilter(k)} style={{ padding: "6px 14px", borderRadius: "20px", border: `1px solid ${filter === k ? C.orange : C.border}`, background: filter === k ? C.orange + "12" : C.white, color: filter === k ? C.orange : C.textLight, fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>{l}</button>
      )}
    </div>

    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {filtered.map(a => (
        <div key={a.id} style={{ background: C.white, borderRadius: "12px", border: `1px solid ${C.border}`, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", opacity: a.resolved ? 0.5 : 1 }}>
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: sevColors[a.severity], marginTop: "4px", flexShrink: 0 }} />
            <div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "3px" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: C.text }}>{a.title}</span>
                <span style={{ fontSize: "10px", fontWeight: 600, color: sevColors[a.severity], textTransform: "uppercase", background: sevColors[a.severity] + "18", padding: "1px 6px", borderRadius: "4px" }}>{a.severity}</span>
                <span style={{ fontSize: "10px", fontWeight: 500, color: C.textFaint, background: C.surface, padding: "1px 6px", borderRadius: "4px" }}>{a.type.replace("_", " ")}</span>
              </div>
              <div style={{ fontSize: "12px", color: C.textMuted, lineHeight: 1.4 }}>{a.detail}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexShrink: 0 }}>
            <span style={{ fontSize: "11px", color: C.textFaint }}>{a.time}</span>
            {!a.resolved && <Btn size="xs" variant="ghost" color={C.success} onClick={() => setAlerts(prev => prev.map(al => al.id === a.id ? { ...al, resolved: true } : al))}>{I.check} Resolve</Btn>}
          </div>
        </div>
      ))}
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════
// PAGE: GROWTH METRICS
// ═══════════════════════════════════════════════════
function PageGrowth({ clients }) {
  const maxSignup = Math.max(...SIGNUP_DATA.map(d => d.count));
  const totalSignups = SIGNUP_DATA.reduce((s, d) => s + d.count, 0);
  const paidClients = clients.filter(c => c.status === "active").length;
  const convRate = totalSignups ? ((paidClients / totalSignups) * 100).toFixed(0) : 0;

  return (<div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
      <Kpi icon={I.chart} label="Total Signups" value={totalSignups} sub="all time" />
      <Kpi icon={I.check} label="Paid Conversions" value={paidClients} />
      <Kpi icon={I.chart} label="Conversion Rate" value={`${convRate}%`} sub="signup → paid" />
      <Kpi icon={I.users} label="Cancelled" value={clients.filter(c => c.status === "cancelled").length} />
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
      <Card title="Signups Over Time">
        <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", height: "160px" }}>
          {SIGNUP_DATA.map(d => (
            <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
              <span style={{ fontSize: "12px", fontWeight: 700, color: C.text, fontFamily: font.heading }}>{d.count}</span>
              <div style={{ width: "100%", borderRadius: "6px 6px 0 0", background: `linear-gradient(180deg, ${C.orange}, ${C.orange}80)`, height: `${(d.count / maxSignup) * 120}px`, minHeight: "8px", transition: "height 0.3s ease" }} />
              <span style={{ fontSize: "10px", color: C.textFaint, transform: "rotate(-45deg)", transformOrigin: "center", whiteSpace: "nowrap" }}>{d.date}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Onboarding Funnel">
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {ONBOARDING_FUNNEL.map((step, i) => (
            <div key={step.step}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span style={{ fontSize: "13px", fontWeight: 500, color: C.textMuted }}>{i + 1}. {step.step}</span>
                <span style={{ fontSize: "13px", fontWeight: 700, color: C.text, fontFamily: font.heading }}>{step.count} <span style={{ color: C.textFaint, fontWeight: 400 }}>({step.pct}%)</span></span>
              </div>
              <div style={{ height: "8px", background: C.borderLight, borderRadius: "4px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${step.pct}%`, background: i === 0 ? C.info : i < 3 ? C.orange : C.success, borderRadius: "4px", transition: "width 0.4s ease" }} />
              </div>
            </div>
          ))}
          <div style={{ fontSize: "12px", color: C.textFaint, marginTop: "4px" }}>Drop-off: {ONBOARDING_FUNNEL[0].count - ONBOARDING_FUNNEL[ONBOARDING_FUNNEL.length - 1].count} users ({100 - ONBOARDING_FUNNEL[ONBOARDING_FUNNEL.length - 1].pct}%) didn't complete</div>
        </div>
      </Card>

      <Card title="Feature Adoption" style={{ gridColumn: "span 2" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
          {["scheduling", "crm", "driverPortal", "photoQuote", "phoneAgent", "marketing"].map(f => {
            const using = clients.filter(c => c.features[f] && c.status !== "cancelled").length;
            const total = clients.filter(c => c.status !== "cancelled").length;
            const pct = total ? Math.round((using / total) * 100) : 0;
            return <div key={f} style={{ padding: "12px", background: C.surface, borderRadius: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: C.textMuted, textTransform: "capitalize" }}>{f.replace(/([A-Z])/g, " $1")}</span>
                <span style={{ fontSize: "13px", fontWeight: 700, color: C.text, fontFamily: font.heading }}>{pct}%</span>
              </div>
              <div style={{ height: "6px", background: C.border, borderRadius: "3px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: pct > 70 ? C.success : pct > 40 ? C.orange : C.info, borderRadius: "3px" }} />
              </div>
              <div style={{ fontSize: "11px", color: C.textFaint, marginTop: "4px" }}>{using}/{total} clients</div>
            </div>;
          })}
        </div>
      </Card>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════
// PAGE: PLATFORM SETTINGS
// ═══════════════════════════════════════════════════
function PageSettings({ addToast }) {
  const [templateVer] = useState("1.4.2");
  const [announcement, setAnnouncement] = useState("");
  const [keys, setKeys] = useState({ vercel: "v_••••••••••k4rp", twilio: "SK••••••••••a1b2", stripe: "sk_live_••••••••c3d4" });
  const [showKey, setShowKey] = useState({});

  return (<div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
      <Card title="Template Management">
        <div style={{ marginBottom: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 600, color: C.text }}>Current Version</div>
              <div style={{ fontSize: "24px", fontWeight: 700, color: C.orange, fontFamily: font.heading }}>v{templateVer}</div>
            </div>
            <Btn onClick={() => addToast("Bulk redeploy triggered — all client sites rebuilding", "success")}>{I.refresh} Push to All Sites</Btn>
          </div>
          <div style={{ padding: "12px", background: C.surface, borderRadius: "10px", fontSize: "12px", color: C.textMuted, lineHeight: 1.6 }}>
            <strong>v1.4.2</strong> — Feb 18, 2026: Updated booking widget, fixed mobile nav, improved Core Web Vitals scores.<br />
            <strong>v1.4.1</strong> — Feb 5, 2026: New testimonials section, schema markup for local SEO.<br />
            <strong>v1.4.0</strong> — Jan 22, 2026: Complete template redesign with new hero section.
          </div>
        </div>
      </Card>

      <Card title="API Keys">
        {Object.entries({ vercel: "Vercel", twilio: "Twilio", stripe: "Stripe" }).map(([k, label]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.borderLight}` }}>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: C.textMuted }}>{label}</div>
              <div style={{ fontFamily: "monospace", fontSize: "12px", color: C.textFaint }}>{showKey[k] ? keys[k].replace(/•/g, "x") : keys[k]}</div>
            </div>
            <div style={{ display: "flex", gap: "4px" }}>
              <Btn variant="ghost" color={C.textLight} size="xs" onClick={() => setShowKey(p => ({ ...p, [k]: !p[k] }))}>{I.eye}</Btn>
              <Btn variant="ghost" color={C.info} size="xs" onClick={() => addToast(`${label} key rotated`, "success")}>{I.refresh} Rotate</Btn>
            </div>
          </div>
        ))}
      </Card>

      <Card title="Announcement Banner" style={{ gridColumn: "span 2" }}>
        <div style={{ display: "flex", gap: "10px" }}>
          <input style={{ ...inputStyle, flex: 1 }} value={announcement} onChange={e => setAnnouncement(e.target.value)} placeholder="Type a message to display on all client dashboards..." />
          <Btn onClick={() => { if (announcement) { addToast("Announcement pushed to all clients", "success"); setAnnouncement(""); } }} disabled={!announcement}>Push to All</Btn>
          <Btn variant="ghost" color={C.danger} onClick={() => addToast("Announcement cleared", "success")}>Clear</Btn>
        </div>
      </Card>

      <Card title="Quick Operations">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          {[
            { label: "Clear All Caches", desc: "CDN + API cache flush", color: C.info },
            { label: "Seed Demo Account", desc: "Create demo client with sample data", color: C.purple },
            { label: "Export Full DB", desc: "PostgreSQL pg_dump backup", color: C.navy },
            { label: "Run Prisma Migrate", desc: "Apply pending schema changes", color: C.successDark },
            { label: "Purge Old Logs", desc: "Delete logs > 90 days", color: C.danger },
            { label: "Restart All Agents", desc: "Rolling restart on Fly.io", color: C.warnDark },
          ].map(op => (
            <button key={op.label} onClick={() => addToast(`${op.label} triggered`, "success")} style={{ padding: "12px 14px", borderRadius: "10px", border: `1px solid ${op.color}20`, background: `${op.color}06`, textAlign: "left", cursor: "pointer", transition: "all 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.background = op.color + "12"} onMouseLeave={e => e.currentTarget.style.background = op.color + "06"}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: op.color }}>{op.label}</div>
              <div style={{ fontSize: "11px", color: C.textFaint, marginTop: "2px" }}>{op.desc}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card title="System Health">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          {[
            { label: "API Uptime", value: "99.97%", ok: true },
            { label: "Avg Response", value: "142ms", ok: true },
            { label: "Phone Latency", value: "1.2s", ok: true },
            { label: "Vision Pipeline", value: "3.4s avg", ok: false },
            { label: "Stripe Webhooks", value: "Healthy", ok: true },
            { label: "Twilio", value: "Operational", ok: true },
            { label: "OpenAI API", value: "Operational", ok: true },
            { label: "DB Capacity", value: "12% used", ok: true },
            { label: "Fly.io Agents", value: "7/8 healthy", ok: false },
            { label: "Vercel Builds", value: "All passing", ok: true },
          ].map(s => (
            <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: C.surface, borderRadius: "8px" }}>
              <span style={{ fontSize: "12px", color: C.textMuted }}>{s.label}</span>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: s.ok ? C.successDark : C.warnDark }}>{s.value}</span>
                <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: s.ok ? C.success : C.warn }} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════
const NAV = [
  { id: "overview", label: "Overview", icon: I.dashboard },
  { id: "clients", label: "Clients", icon: I.users },
  { id: "billing", label: "Revenue", icon: I.dollar },
  { id: "websites", label: "Websites", icon: I.globe },
  { id: "phones", label: "Phone Agents", icon: I.phone },
  { id: "alerts", label: "Alerts", icon: I.bell },
  { id: "growth", label: "Growth", icon: I.chart },
  { id: "settings", label: "Settings", icon: I.settings },
];

const TITLES = { overview: "Dashboard Overview", clients: "Client Accounts", billing: "Revenue & Billing", websites: "Website Management", phones: "Phone Agent Management", alerts: "Alerts & Monitoring", growth: "Growth Metrics", settings: "Platform Settings" };

export default function App() {
  const [page, setPage] = useState("overview");
  const [clients, setClients] = useState(MOCK_CLIENTS);
  const [alerts, setAlerts] = useState(ALERTS);
  const [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const addToast = (msg, type) => setToast({ msg, type });
  const unresolvedCount = alerts.filter(a => !a.resolved).length;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg, fontFamily: font.body, fontSize: "14px", color: C.text }}>
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* SIDEBAR */}
      <div style={{ width: collapsed ? "64px" : "220px", background: C.navy, display: "flex", flexDirection: "column", transition: "width 0.2s ease", flexShrink: 0, position: "relative" }}>
        <div style={{ padding: collapsed ? "20px 10px" : "20px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", overflow: "hidden" }}>
            <div style={{ width: "34px", height: "34px", borderRadius: "9px", background: `linear-gradient(135deg, ${C.orange}, ${C.orangeHover})`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "14px", fontFamily: font.heading, color: "#fff", flexShrink: 0 }}>SYJ</div>
            {!collapsed && <div><div style={{ fontWeight: 700, fontSize: "14px", fontFamily: font.heading, color: "#fff", whiteSpace: "nowrap" }}>ScaleYourJunk</div><div style={{ fontSize: "10px", color: C.textLight, whiteSpace: "nowrap" }}>Operations Console</div></div>}
          </div>
        </div>

        <nav style={{ padding: "12px 8px", flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
          {NAV.map(n => (
            <button key={n.id} onClick={() => setPage(n.id)} style={{
              display: "flex", alignItems: "center", gap: "10px", width: "100%", padding: collapsed ? "10px" : "9px 12px", borderRadius: "9px", border: "none",
              background: page === n.id ? `${C.orange}20` : "transparent", color: page === n.id ? C.orangeHover : C.textFaint,
              cursor: "pointer", fontSize: "13px", fontWeight: page === n.id ? 600 : 400, transition: "all 0.15s", justifyContent: collapsed ? "center" : "flex-start", position: "relative",
              fontFamily: font.body
            }}
              onMouseEnter={e => { if (page !== n.id) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={e => { if (page !== n.id) e.currentTarget.style.background = "transparent"; }}>
              {n.icon}
              {!collapsed && n.label}
              {n.id === "alerts" && unresolvedCount > 0 && <span style={{ position: collapsed ? "absolute" : "static", top: collapsed ? "4px" : undefined, right: collapsed ? "4px" : undefined, marginLeft: collapsed ? 0 : "auto", width: "18px", height: "18px", borderRadius: "50%", background: C.danger, color: "#fff", fontSize: "10px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{unresolvedCount}</span>}
            </button>
          ))}
        </nav>

        <button onClick={() => setCollapsed(c => !c)} style={{ position: "absolute", right: "-12px", top: "50%", transform: "translateY(-50%)", width: "24px", height: "24px", borderRadius: "50%", background: C.navyLight, border: `2px solid ${C.textLight}40`, color: C.textFaint, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", zIndex: 10 }}>
          {collapsed ? "›" : "‹"}
        </button>

        <div style={{ padding: "14px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {!collapsed && <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "28px", height: "28px", borderRadius: "7px", background: `linear-gradient(135deg, ${C.orange}, ${C.orangeHover})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700, color: "#fff" }}>J</div>
            <div><div style={{ fontSize: "12px", fontWeight: 600, color: "#E2E8F0" }}>Janmal</div><div style={{ fontSize: "10px", color: C.textLight }}>Super Admin</div></div>
          </div>}
        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "14px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: C.text, margin: 0, fontFamily: font.heading }}>{TITLES[page]}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "12px", color: C.textFaint }}>Feb 21, 2026</span>
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}><div style={{ width: "7px", height: "7px", borderRadius: "50%", background: C.success }} /><span style={{ fontSize: "11px", color: C.textFaint }}>Systems OK</span></div>
          </div>
        </header>

        <main style={{ flex: 1, padding: "24px 28px", overflowY: "auto" }}>
          {page === "overview" && <PageOverview clients={clients} alerts={alerts} setPage={setPage} setSelectedClient={setSelectedClient} />}
          {page === "clients" && <PageClients clients={clients} setClients={setClients} selectedClient={selectedClient} setSelectedClient={setSelectedClient} addToast={addToast} />}
          {page === "billing" && <PageBilling clients={clients} />}
          {page === "websites" && <PageWebsites clients={clients} setClients={setClients} addToast={addToast} />}
          {page === "phones" && <PagePhoneAgents clients={clients} setClients={setClients} addToast={addToast} />}
          {page === "alerts" && <PageAlerts alerts={alerts} setAlerts={setAlerts} />}
          {page === "growth" && <PageGrowth clients={clients} />}
          {page === "settings" && <PageSettings addToast={addToast} />}
        </main>
      </div>

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
