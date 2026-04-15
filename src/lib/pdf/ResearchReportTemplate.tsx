import React from "react";
import {
    Document,
    Page,
    Text,
    View,
    StyleSheet,
    Link,
} from "@react-pdf/renderer";

/* ─── Types ──────────────────────────────────────────────────────── */

export interface ResearchReportPdfData {
    title: string;
    subtitle: string;
    category: string;
    author: string;
    publishedDate: string;   // YYYY-MM-DD
    execSummary: string;
    keyFindings: string[];
    body: {
        sections: Array<{
            heading: string;
            paragraphs?: string[];
            bullets?: string[];
        }>;
        conclusion: string;
    };
    sources: Array<{ title: string; url: string; snippet?: string }>;
    dataRange: string;
    methodology: string;
    sourceCount: number;
}

/* ─── Brand colors ───────────────────────────────────────────────── */

const BRAND = {
    navy: "#0A192F",
    navyLight: "#1A2B4A",
    orange: "#FF6B00",
    orangeDark: "#E85A00",
    muted: "#64748B",
    mutedLight: "#94A3B8",
    body: "#1A2332",
    border: "#E2E8F0",
    offwhite: "#F8FAFC",
    white: "#FFFFFF",
};

/* ─── Styles ─────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
    // Cover page
    coverPage: {
        padding: 70,
        backgroundColor: BRAND.navy,
        color: BRAND.white,
        flexDirection: "column",
        justifyContent: "space-between",
    },
    coverBrandMark: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 20,
    },
    coverBrandScale: {
        fontSize: 18,
        fontWeight: 800,
        color: BRAND.orange,
    },
    coverBrandYj: {
        fontSize: 18,
        fontWeight: 800,
        color: BRAND.white,
    },
    coverCategoryLabel: {
        fontSize: 11,
        fontWeight: 700,
        color: BRAND.orange,
        letterSpacing: 2,
        marginBottom: 14,
    },
    coverAccentBar: {
        width: 80,
        height: 4,
        backgroundColor: BRAND.orange,
        marginBottom: 24,
    },
    coverTitle: {
        fontSize: 34,
        fontWeight: 800,
        color: BRAND.white,
        lineHeight: 1.15,
        marginBottom: 16,
    },
    coverSubtitle: {
        fontSize: 16,
        fontWeight: 400,
        color: BRAND.mutedLight,
        lineHeight: 1.5,
    },
    coverFooter: {
        flexDirection: "column",
    },
    coverFooterLine1: {
        fontSize: 11,
        color: BRAND.orange,
        fontWeight: 700,
        letterSpacing: 1.5,
        marginBottom: 4,
    },
    coverFooterLine2: {
        fontSize: 10,
        color: BRAND.mutedLight,
    },

    // Content pages
    contentPage: {
        paddingTop: 60,
        paddingBottom: 70,
        paddingHorizontal: 60,
        backgroundColor: BRAND.white,
        color: BRAND.body,
        flexDirection: "column",
    },
    pageHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 28,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: BRAND.border,
        borderBottomStyle: "solid",
    },
    pageHeaderBrand: {
        flexDirection: "row",
        alignItems: "center",
    },
    pageHeaderScale: {
        fontSize: 11,
        fontWeight: 800,
        color: BRAND.orange,
    },
    pageHeaderYj: {
        fontSize: 11,
        fontWeight: 800,
        color: BRAND.navy,
    },
    pageHeaderLabel: {
        fontSize: 9,
        color: BRAND.muted,
        letterSpacing: 1,
    },

    h1: {
        fontSize: 22,
        fontWeight: 800,
        color: BRAND.navy,
        marginTop: 0,
        marginBottom: 8,
    },
    accentBar: {
        width: 48,
        height: 3,
        backgroundColor: BRAND.orange,
        marginBottom: 18,
    },
    h2: {
        fontSize: 15,
        fontWeight: 700,
        color: BRAND.navy,
        marginTop: 20,
        marginBottom: 10,
    },
    body: {
        fontSize: 11,
        lineHeight: 1.55,
        color: BRAND.body,
        marginBottom: 10,
    },
    bulletRow: {
        flexDirection: "row",
        marginBottom: 6,
        paddingLeft: 6,
    },
    bulletMark: {
        fontSize: 11,
        color: BRAND.orange,
        fontWeight: 700,
        marginRight: 8,
        lineHeight: 1.55,
    },
    bulletText: {
        fontSize: 11,
        lineHeight: 1.55,
        color: BRAND.body,
        flex: 1,
    },

    keyFindingsBox: {
        backgroundColor: BRAND.offwhite,
        borderLeftWidth: 4,
        borderLeftColor: BRAND.orange,
        borderLeftStyle: "solid",
        padding: 18,
        marginTop: 12,
        marginBottom: 12,
    },
    keyFindingsLabel: {
        fontSize: 10,
        fontWeight: 700,
        color: BRAND.orange,
        letterSpacing: 1.2,
        marginBottom: 10,
    },

    conclusionBox: {
        backgroundColor: BRAND.offwhite,
        borderLeftWidth: 4,
        borderLeftColor: BRAND.navy,
        borderLeftStyle: "solid",
        padding: 18,
        marginTop: 16,
    },
    conclusionLabel: {
        fontSize: 10,
        fontWeight: 700,
        color: BRAND.navy,
        letterSpacing: 1.2,
        marginBottom: 10,
    },

    refEntry: {
        flexDirection: "row",
        marginBottom: 12,
    },
    refNumber: {
        fontSize: 10,
        fontWeight: 700,
        color: BRAND.orange,
        width: 24,
    },
    refText: {
        flex: 1,
    },
    refTitle: {
        fontSize: 10,
        fontWeight: 700,
        color: BRAND.navy,
        marginBottom: 2,
    },
    refUrl: {
        fontSize: 9,
        color: BRAND.muted,
        textDecoration: "none",
    },

    pageNumber: {
        position: "absolute",
        bottom: 30,
        left: 60,
        right: 60,
        fontSize: 9,
        color: BRAND.muted,
        textAlign: "center",
    },
});

/* ─── Brand mark components ──────────────────────────────────────── */

function CoverBrand() {
    return (
        <View style={styles.coverBrandMark}>
            <Text style={styles.coverBrandScale}>Scale</Text>
            <Text style={styles.coverBrandYj}>YourJunk</Text>
        </View>
    );
}

function HeaderBrand() {
    return (
        <View style={styles.pageHeader} fixed>
            <View style={styles.pageHeaderBrand}>
                <Text style={styles.pageHeaderScale}>Scale</Text>
                <Text style={styles.pageHeaderYj}>YourJunk</Text>
            </View>
            <Text style={styles.pageHeaderLabel}>RESEARCH REPORT</Text>
        </View>
    );
}

function PageNumber() {
    return (
        <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) =>
                `${pageNumber} / ${totalPages}   ·   ScaleYourJunk Research`
            }
            fixed
        />
    );
}

/* ─── Main document ──────────────────────────────────────────────── */

export function ResearchReportTemplate({ report }: { report: ResearchReportPdfData }) {
    return (
        <Document title={report.title} author={report.author}>
            {/* Cover */}
            <Page size="LETTER" style={styles.coverPage}>
                <View>
                    <CoverBrand />
                    <Text style={styles.coverCategoryLabel}>{report.category.toUpperCase()}</Text>
                    <View style={styles.coverAccentBar} />
                    <Text style={styles.coverTitle}>{report.title}</Text>
                    <Text style={styles.coverSubtitle}>{report.subtitle}</Text>
                </View>
                <View style={styles.coverFooter}>
                    <Text style={styles.coverFooterLine1}>SCALEYOURJUNK RESEARCH</Text>
                    <Text style={styles.coverFooterLine2}>
                        {report.publishedDate} · By {report.author} · {report.sourceCount} sources · Data range {report.dataRange}
                    </Text>
                </View>
            </Page>

            {/* Executive Summary */}
            <Page size="LETTER" style={styles.contentPage}>
                <HeaderBrand />
                <Text style={styles.h1}>Executive Summary</Text>
                <View style={styles.accentBar} />
                <Text style={styles.body}>{report.execSummary}</Text>

                <View style={styles.keyFindingsBox}>
                    <Text style={styles.keyFindingsLabel}>KEY FINDINGS</Text>
                    {report.keyFindings.map((finding, i) => (
                        <View key={i} style={styles.bulletRow}>
                            <Text style={styles.bulletMark}>•</Text>
                            <Text style={styles.bulletText}>{finding}</Text>
                        </View>
                    ))}
                </View>
                <PageNumber />
            </Page>

            {/* Body sections */}
            {report.body.sections.map((section, sIdx) => (
                <Page key={sIdx} size="LETTER" style={styles.contentPage}>
                    <HeaderBrand />
                    <Text style={styles.h1}>{section.heading}</Text>
                    <View style={styles.accentBar} />
                    {section.paragraphs?.map((p, i) => (
                        <Text key={i} style={styles.body}>
                            {p}
                        </Text>
                    ))}
                    {section.bullets && section.bullets.length > 0 && (
                        <View style={{ marginTop: 6, marginBottom: 6 }}>
                            {section.bullets.map((b, i) => (
                                <View key={i} style={styles.bulletRow}>
                                    <Text style={styles.bulletMark}>•</Text>
                                    <Text style={styles.bulletText}>{b}</Text>
                                </View>
                            ))}
                        </View>
                    )}
                    <PageNumber />
                </Page>
            ))}

            {/* Conclusion */}
            {report.body.conclusion && (
                <Page size="LETTER" style={styles.contentPage}>
                    <HeaderBrand />
                    <Text style={styles.h1}>Conclusion</Text>
                    <View style={styles.accentBar} />
                    <View style={styles.conclusionBox}>
                        <Text style={styles.conclusionLabel}>KEY TAKEAWAY</Text>
                        <Text style={styles.body}>{report.body.conclusion}</Text>
                    </View>
                    <PageNumber />
                </Page>
            )}

            {/* References */}
            <Page size="LETTER" style={styles.contentPage}>
                <HeaderBrand />
                <Text style={styles.h1}>References</Text>
                <View style={styles.accentBar} />
                <Text style={{ fontSize: 10, color: BRAND.muted, marginBottom: 16 }}>
                    All claims in this report are sourced from the following {report.sources.length} references. Every citation marker [n] in the body maps to the corresponding entry below.
                </Text>
                {report.sources.map((source, i) => (
                    <View key={i} style={styles.refEntry}>
                        <Text style={styles.refNumber}>[{i + 1}]</Text>
                        <View style={styles.refText}>
                            <Text style={styles.refTitle}>{source.title || source.url}</Text>
                            <Link src={source.url} style={styles.refUrl}>
                                {source.url}
                            </Link>
                        </View>
                    </View>
                ))}

                {/* Methodology footer */}
                <View style={{ marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: BRAND.border, borderTopStyle: "solid" }}>
                    <Text style={{ fontSize: 9, fontWeight: 700, color: BRAND.muted, letterSpacing: 1, marginBottom: 6 }}>
                        METHODOLOGY
                    </Text>
                    <Text style={{ fontSize: 9, color: BRAND.muted, lineHeight: 1.5 }}>
                        {report.methodology}
                    </Text>
                </View>
                <PageNumber />
            </Page>
        </Document>
    );
}
