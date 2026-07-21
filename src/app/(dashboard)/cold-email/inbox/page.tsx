import { Suspense } from "react";
import { ColdEmailInboxPage } from "@/components/cold-email/ColdEmailInboxPage";

export default function Page() { return <Suspense fallback={<div>Loading Cold Email Inbox…</div>}><ColdEmailInboxPage /></Suspense>; }
