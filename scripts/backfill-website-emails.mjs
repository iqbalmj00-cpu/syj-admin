// One-shot backfill: crawl every scraped lead's website, extract all emails,
// rank them, and populate `email`, `emailsDiscovered`, `emailDiscoveryCategory`
// + derived (`emailDomain`, `emailDomainType`, `emailDomainMatchesWebsite`,
// `isDirectContact`).
//
// Mirrors the agent's Phase 7 logic verbatim so first-time backfill matches
// what future enrichment runs will do.
//
// Safe to run before the next enrichment; idempotent (skips leads that already
// have emailsDiscovered populated so you can resume after a crash).
// Requires the migration in EMAIL_EXTRACTION_BRIEF.md to have run first
// (the new columns must exist).

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connString = (process.env.DATABASE_URL || "").replace(/[&?]channel_binding=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: connString, ssl: { rejectUnauthorized: false } });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const CONCURRENCY = 3;
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };

// ── Email extraction (mirror of agent/website_analyzer.py extract_all_emails) ──
const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
const MAILTO_RE = /mailto:([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/gi;

const GENERIC_LOCAL_PARTS = new Set([
    "info", "support", "contact", "hello", "admin", "sales", "office", "team",
    "hi", "customerservice", "customer-service", "billing", "accounts",
    "inquiries", "enquiries", "mail", "email", "general", "service", "services",
    "help", "feedback", "operations", "ops", "reception", "reservations",
    "bookings", "booking", "scheduling", "schedule", "dispatch", "main",
    "marketing", "press", "media", "hr", "jobs", "careers", "noreply",
    "no-reply", "donotreply", "orders", "order", "invoice", "invoices",
    "accounting", "accountspayable", "accountsreceivable", "ap", "ar",
]);
const EXCLUDED_EMAIL_DOMAINS = new Set([
    "example.com", "example.net", "example.org", "domain.com", "yoursite.com",
    "sentry.io", "sentry-cdn.com", "google.com", "gmail.com", "googleapis.com",
    "w3.org", "schema.org", "placeholder.com", "test.com",
    "wordpress.org", "wp.com", "elementor.com",
]);
const SUSPICIOUS_LOCAL_PREFIXES = new Set([
    "example", "your", "name", "yourname", "first.last", "johndoe", "janedoe",
]);
const CATEGORY_RANK = { owner_direct: 0, personalized: 1, unknown: 2, generic: 3 };

const PERSONAL_EMAIL_DOMAINS = new Set([
    "gmail.com", "yahoo.com", "aol.com", "outlook.com", "hotmail.com",
    "icloud.com", "live.com", "me.com", "protonmail.com", "proton.me",
    "mail.com", "ymail.com", "msn.com", "comcast.net", "verizon.net",
    "sbcglobal.net", "att.net", "bellsouth.net", "cox.net",
]);

function extractAllEmails(...blobs) {
    const found = new Set();
    for (const html of blobs) {
        if (!html) continue;
        for (const m of html.matchAll(MAILTO_RE)) found.add(m[1].toLowerCase());
        for (const m of html.matchAll(EMAIL_RE)) found.add(m[0].toLowerCase());
    }
    const out = [];
    for (const e of found) {
        if (e.split("@").length - 1 !== 1) continue;
        const [local, domain] = e.split("@");
        if (!local || !domain || !domain.includes(".")) continue;
        if (EXCLUDED_EMAIL_DOMAINS.has(domain)) continue;
        if (SUSPICIOUS_LOCAL_PREFIXES.has(local)) continue;
        if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(domain)) continue;
        if (local.length > 64 || domain.length > 80) continue;
        out.push(e);
    }
    return out;
}

function categorizeEmail(email, ownerFirstName, ownerLastName) {
    if (!email || !email.includes("@")) return "unknown";
    const local = email.split("@")[0].toLowerCase();
    if (ownerFirstName) {
        const f = ownerFirstName.toLowerCase().trim();
        if (f && f.length >= 2 && local.includes(f)) return "owner_direct";
    }
    if (ownerLastName) {
        const l = ownerLastName.toLowerCase().trim();
        if (l && l.length >= 2 && local.includes(l)) return "owner_direct";
    }
    if (GENERIC_LOCAL_PARTS.has(local)) return "generic";
    for (const prefix of GENERIC_LOCAL_PARTS) {
        if (local.startsWith(prefix + ".") || local.startsWith(prefix + "-") || local.startsWith(prefix + "_")) return "generic";
    }
    const alphas = [...local].filter(c => /[a-z]/i.test(c)).length;
    if (local.length <= 20 && alphas >= 3 && alphas / Math.max(local.length, 1) >= 0.6) return "personalized";
    return "unknown";
}

function rankEmails(emails, ownerFirstName, ownerLastName, websiteDomain) {
    if (!emails.length) return [];
    let host = null;
    if (websiteDomain) host = websiteDomain.trim().toLowerCase().replace(/^https?:\/\/(?:www\.)?/, "").split("/")[0];
    const enriched = emails.map(e => {
        const cat = categorizeEmail(e, ownerFirstName, ownerLastName);
        const domain = e.split("@")[1];
        const matches = Boolean(host && (domain === host || domain.endsWith("." + host) || host.endsWith("." + domain)));
        return { email: e, category: cat, matchesWebsite: matches };
    });
    enriched.sort((a, b) =>
        (CATEGORY_RANK[a.category] ?? 99) - (CATEGORY_RANK[b.category] ?? 99)
        || (a.matchesWebsite === b.matchesWebsite ? 0 : a.matchesWebsite ? -1 : 1)
        || a.email.split("@")[0].length - b.email.split("@")[0].length
    );
    return enriched;
}

// ── Web fetching ──
async function fetchWithTimeout(url, ms = 5000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
        const resp = await fetch(url, { headers: UA, signal: ctrl.signal, redirect: "follow" });
        if (resp.status < 200 || resp.status >= 300) return "";
        const text = await resp.text();
        return text.slice(0, 80_000);
    } catch { return ""; }
    finally { clearTimeout(t); }
}

async function fetchHomepageAndContact(websiteUrl) {
    const base = websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`;
    let origin;
    try { const u = new URL(base); origin = `${u.protocol}//${u.host}`; }
    catch { return { homepage: "", contact: "" }; }

    const homepage = await fetchWithTimeout(origin, 5000);
    const paths = ["/contact", "/contact-us", "/about", "/about-us", "/team"];
    let contact = "";
    for (const p of paths) {
        const body = await fetchWithTimeout(origin + p, 4000);
        if (body && body.length > 200) { contact = body; break; }
    }
    return { homepage, contact };
}

// ── Main ──
const leads = await prisma.scrapedLead.findMany({
    where: {
        website: { not: null },
        // Idempotent: skip leads that already have emailsDiscovered populated
        emailsDiscovered: { isEmpty: true },
    },
    select: {
        id: true, name: true, website: true, email: true,
        ownerFirstName: true, ownerLastName: true, ownerName: true,
    },
});

console.log(`\n=== Website email backfill ===`);
console.log(`Found ${leads.length} leads with website and no emailsDiscovered yet\n`);

const stats = { updated: 0, no_emails: 0, fetch_failed: 0, errors: 0 };
const startTime = Date.now();

async function processLead(lead, idx) {
    try {
        const { homepage, contact } = await fetchHomepageAndContact(lead.website);
        if (!homepage) { stats.fetch_failed++; return { name: lead.name, status: "fetch_failed" }; }

        const scraped = extractAllEmails(homepage, contact);
        const ownerFirst = lead.ownerFirstName || (lead.ownerName || "").trim().split(/\s+/)[0] || null;
        const ownerLast = lead.ownerLastName || ((lead.ownerName || "").trim().split(/\s+/).slice(1).join(" ") || null);

        const pool = [...scraped];
        const existing = (lead.email || "").trim().toLowerCase();
        if (existing && existing.includes("@") && !pool.includes(existing)) pool.push(existing);

        const ranked = rankEmails(pool, ownerFirst, ownerLast, lead.website);
        if (!ranked.length) { stats.no_emails++; return { name: lead.name, status: "no_emails" }; }

        const best = ranked[0];
        const emails = ranked.map(r => r.email);

        // Re-derive existing email fields from the chosen email
        const [_, bestDomain] = best.email.split("@");
        const websiteHost = (lead.website || "").toLowerCase().replace(/^https?:\/\/(?:www\.)?/, "").split("/")[0];
        const domainType = PERSONAL_EMAIL_DOMAINS.has(bestDomain) ? "personal" : bestDomain ? "business_custom" : "unknown";
        const matchesWebsite = Boolean(websiteHost && bestDomain && (websiteHost === bestDomain || websiteHost.endsWith("." + bestDomain) || bestDomain.endsWith("." + websiteHost)));
        const isDirectContact = matchesWebsite || (ownerFirst && best.email.split("@")[0].toLowerCase().includes(ownerFirst.toLowerCase()));

        await prisma.scrapedLead.update({
            where: { id: lead.id },
            data: {
                email: best.email,
                emailsDiscovered: emails,
                emailDiscoveryCategory: best.category,
                emailDomain: bestDomain,
                emailDomainType: domainType,
                emailDomainMatchesWebsite: matchesWebsite,
                isDirectContact: Boolean(isDirectContact),
            },
        });
        stats.updated++;
        return { name: lead.name, status: "updated", count: emails.length, cat: best.category, best: best.email };
    } catch (e) {
        stats.errors++;
        return { name: lead.name, status: "error", msg: e.message };
    }
}

async function worker(iter) {
    for (const { lead, idx } of iter) {
        const r = await processLead(lead, idx);
        if (idx % 50 === 0 || r.status !== "updated") {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const details = r.count ? ` (${r.count} emails, best=${r.best} [${r.cat}])` : r.msg ? ` (${r.msg.slice(0, 60)})` : "";
            console.log(`  [${String(idx).padStart(4)}/${leads.length}] ${r.status.padEnd(14)} ${r.name}${details}  | ${elapsed}s`);
        }
    }
}

function* enumerate() { for (let i = 0; i < leads.length; i++) yield { lead: leads[i], idx: i + 1 }; }
const iter = enumerate();
await Promise.all(Array(CONCURRENCY).fill(0).map(() => worker(iter)));

const elapsed = Math.floor((Date.now() - startTime) / 1000);
console.log(`\n─── Done in ${Math.floor(elapsed / 60)}m ${elapsed % 60}s ───`);
console.log(`  Updated:         ${stats.updated}`);
console.log(`  No emails found: ${stats.no_emails}`);
console.log(`  Fetch failed:    ${stats.fetch_failed}`);
console.log(`  Errors:          ${stats.errors}`);

await prisma.$disconnect();
