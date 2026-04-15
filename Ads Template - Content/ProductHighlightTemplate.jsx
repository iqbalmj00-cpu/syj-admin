import React from "react";

/* ---------- Inline logo ---------- */
function ScaleYourJunkLogo({ variant = "light", height = 32 }) {
  const yourJunkColor = variant === "dark" ? "#0A192F" : "#FFFFFF";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height,
        fontFamily:
          'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontWeight: 800,
        fontSize: height * 0.72,
        letterSpacing: "-0.02em",
        lineHeight: 1,
        whiteSpace: "nowrap",
        userSelect: "none",
      }}
    >
      <span style={{ color: "#FF6B00" }}>Scale</span>
      <span style={{ color: yourJunkColor }}>YourJunk</span>
    </span>
  );
}

/**
 * ProductHighlightTemplate — 1080×1080
 *   A) Headline card  (top 30%)  — dark navy, centered logo + headline
 *   B) Hero mockup    (mid 55%)  — orange
 *   C) Link card      (bot 15%)  — off-white w/ centered eyebrow pill
 */
export default function ProductHighlightTemplate({
  categoryLabel = "SOFTWARE BUILT FOR THE JUNK REMOVAL COMMUNITY",
  headline = "Answer every call, even when you're on the truck.",
  subheadline = "ScaleYourJunk's AI phone agent books jobs, quotes prices, and updates your calendar in real time.",
  linkTitle = "See the phone agent in action",
  url = "SCALEYOURJUNK.COM",
  ctaLabel = "Learn more",
  mockup,
  scale = 0.6,
}) {
  return (
    <div
      style={{
        width: 1080,
        height: 1080,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        fontFamily:
          'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        position: "relative",
        overflow: "hidden",
        boxShadow: "0 20px 60px rgba(10, 25, 47, 0.15)",
      }}
    >
      {/* ZONE A — HEADLINE */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 324,
          backgroundColor: "#0A192F",
          padding: "48px 60px 40px 60px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Top orange bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            backgroundColor: "#FF6B00",
          }}
        />

        {/* Large centered logo */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <ScaleYourJunkLogo variant="light" height={56} />
        </div>

        {/* Headline + subheadline, centered */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            textAlign: "center",
            maxWidth: 920,
            marginTop: 24,
          }}
        >
          <h1
            style={{
              color: "#FFFFFF",
              fontSize: 52,
              fontWeight: 800,
              lineHeight: 1.1,
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            {headline}
          </h1>
          <p
            style={{
              color: "#94A3B8",
              fontSize: 22,
              fontWeight: 400,
              lineHeight: 1.35,
              margin: "16px 0 0 0",
              maxWidth: 820,
            }}
          >
            {subheadline}
          </p>
        </div>
      </div>

      {/* ZONE B — HERO MOCKUP */}
      <div
        style={{
          position: "absolute",
          top: 324,
          left: 0,
          right: 0,
          height: 594,
          background: "linear-gradient(180deg, #FF6B00 0%, #E85A00 100%)",
          padding: 60,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "100%",
            maxHeight: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            filter: "drop-shadow(0 30px 80px rgba(10, 25, 47, 0.35))",
          }}
        >
          {mockup || <PlaceholderMockup />}
        </div>
      </div>

      {/* ZONE C — LINK CARD */}
      <div
        style={{
          position: "absolute",
          top: 918,
          left: 0,
          right: 0,
          height: 162,
          backgroundColor: "#F8FAFC",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 40px",
        }}
      >
        {/* Centered eyebrow — absolutely positioned at top of zone */}
        <div
          style={{
            position: "absolute",
            top: 18,
            left: 0,
            right: 0,
            textAlign: "center",
            color: "#FF6B00",
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {categoryLabel}
        </div>

        {/* Left text stack */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            marginTop: 28,
            minWidth: 0,
            flex: 1,
            paddingRight: 24,
          }}
        >
          <div
            style={{
              color: "#64748B",
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            {url}
          </div>
          <div
            style={{
              color: "#0A192F",
              fontSize: 22,
              fontWeight: 700,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {linkTitle}
          </div>
        </div>

        {/* CTA */}
        <button
          style={{
            backgroundColor: "#0A192F",
            color: "#FFFFFF",
            fontSize: 14,
            fontWeight: 500,
            padding: "12px 24px",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            whiteSpace: "nowrap",
            marginTop: 28,
            fontFamily: "inherit",
          }}
        >
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}

function PlaceholderMockup() {
  return (
    <div
      style={{
        width: "100%",
        borderRadius: 12,
        overflow: "hidden",
        backgroundColor: "#fff",
        boxShadow: "0 20px 60px rgba(10, 25, 47, 0.15)",
      }}
    >
      <div
        style={{
          height: 48,
          backgroundColor: "#F1F5F9",
          borderBottom: "1px solid #E2E8F0",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#FF5F57" }} />
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#FEBC2E" }} />
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#28C840" }} />
        </div>
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            width: 400,
            height: 28,
            background: "#fff",
            borderRadius: 999,
            border: "1px solid #CBD5E1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            color: "#64748B",
            fontFamily: "ui-monospace, Menlo, monospace",
          }}
        >
          scaleyourjunk.com/dashboard
        </div>
      </div>
      <div
        style={{
          aspectRatio: "16 / 10",
          background: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#94A3B8",
          fontSize: 18,
          fontWeight: 500,
        }}
      >
        [ Your mockup goes here ]
      </div>
    </div>
  );
}
