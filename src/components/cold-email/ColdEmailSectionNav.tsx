"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
    ["/cold-email", "Overview"],
    ["/cold-email/campaigns", "Campaigns"],
    ["/cold-email/inbox", "Inbox"],
    ["/cold-email/opportunities", "Opportunities"],
    ["/cold-email/lead-groups", "Lead Groups"],
    ["/cold-email/templates", "Templates"],
    ["/cold-email/accounts", "Accounts"],
    ["/cold-email/deliverability", "Deliverability"],
    ["/cold-email/domains", "Domains"],
    ["/cold-email/reports", "Reports"],
    ["/cold-email/do-not-contact", "Do Not Contact"],
    ["/cold-email/settings", "Settings"],
] as const;

export function ColdEmailSectionNav() {
    const pathname = usePathname();
    return (
        <nav aria-label="Cold Email sections" className="tab-bar" style={{ overflowX: "auto" }}>
            {ITEMS.map(([href, label]) => {
                const active = href === "/cold-email" ? pathname === href : pathname.startsWith(href);
                return (
                    <Link
                        key={href}
                        href={href}
                        className={`tab-button${active ? " active" : ""}`}
                        style={{ textDecoration: "none", whiteSpace: "nowrap" }}
                        aria-current={active ? "page" : undefined}
                    >
                        {label}
                    </Link>
                );
            })}
        </nav>
    );
}
