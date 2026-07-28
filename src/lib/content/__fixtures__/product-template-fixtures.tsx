/**
 * Fixture nodes for the six existing product-ad templates.
 *
 * These exist so the compositor extraction can be proved not to change product
 * output. The fixtures deliberately pass `mockup: null` and `beforeVisual:
 * null`: mockup frames embed remote screenshot URLs, and a renderer that
 * fetched them would make the snapshot depend on the network. Text, layout,
 * spacing, colour and every font weight still render, which is what the
 * extraction could plausibly break.
 *
 * The slot copy is invented sample text. It is not marketing copy, contains no
 * customer or claim material, and is never published.
 */

import React from "react";
import ProductHighlightTemplate from "@/lib/content/templates/ProductHighlightTemplate";
import StatSplitTemplate from "@/lib/content/templates/StatSplitTemplate";
import PhoneMockupTemplate from "@/lib/content/templates/PhoneMockupTemplate";
import BeforeAfterSplitTemplate from "@/lib/content/templates/BeforeAfterSplitTemplate";
import FeatureCalloutTemplate from "@/lib/content/templates/FeatureCalloutTemplate";
import QuoteCardTemplate from "@/lib/content/templates/QuoteCardTemplate";
import type { TemplateId } from "@/lib/content/templates";

export interface ProductTemplateFixture {
    id: TemplateId;
    node: React.ReactElement;
}

export const PRODUCT_TEMPLATE_FIXTURES: ProductTemplateFixture[] = [
    {
        id: "headline_hero",
        node: (
            <ProductHighlightTemplate
                categoryLabel="Dispatch"
                headline="Every job on one board"
                subheadline="Crews, trucks and time slots in a single view, updated as the day moves."
                linkTitle="See the dashboard"
                ctaLabel="Learn more"
                mockup={null}
            />
        ),
    },
    {
        id: "stat_spotlight",
        node: (
            <StatSplitTemplate
                statLabel="Sample metric"
                statValue="3.4x"
                statContext="Illustrative figure used only to exercise the renderer."
                mockup={null}
            />
        ),
    },
    {
        id: "phone_mockup",
        node: (
            <PhoneMockupTemplate
                headline="Book from the kerb"
                subheadline="Drivers confirm the next stop without calling the office."
                mockup={null}
            />
        ),
    },
    {
        id: "before_after",
        node: (
            <BeforeAfterSplitTemplate
                headline="Whiteboard to dispatch board"
                beforeCaption="Before: a photo of a whiteboard in a group chat"
                afterCaption="After: the same day, assigned and time-stamped"
                ctaText="Move the schedule off the wall"
                ctaLabel="See how"
                beforeVisual={null}
                mockup={null}
            />
        ),
    },
    {
        id: "feature_callout",
        node: (
            <FeatureCalloutTemplate
                headline="Three things the office stops chasing"
                subheadline="Confirmations, arrival windows and photo proof."
                ctaLabel="Learn more"
                callouts={[
                    { number: 1, label: "Auto-confirm", position: "top-left" },
                    { number: 2, label: "Arrival window", position: "top-right" },
                    { number: 3, label: "Photo proof", position: "bottom-left" },
                ]}
                mockup={null}
            />
        ),
    },
    {
        id: "quote_card",
        node: (
            <QuoteCardTemplate
                quote="Sample quotation text used purely to exercise the renderer across weights."
                attribution="Sample Attribution"
                role="Sample Role"
            />
        ),
    },
];

/** Dimensions the product generator has always used. */
export const PRODUCT_CANVAS = { width: 1080, height: 1080 } as const;
