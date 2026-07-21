import { Suspense } from "react";
import { ColdEmailOpportunitiesPage } from "@/components/cold-email/ColdEmailOpportunitiesPage";

export default function Page() { return <Suspense fallback={<div>Loading Cold Email opportunities…</div>}><ColdEmailOpportunitiesPage /></Suspense>; }
