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
 * BeforeAfterSplitTemplate — 1080×1080
 *
 *   A) Header strip (top 130px)        — dark navy, logo + headline
 *   B) Split panels (130 → 952)        — Before (left) | divider | After (right)
 *   C) CTA strip   (952 → 1080)        — off-white, text + pill
 */
export default function BeforeAfterSplitTemplate({
  headline = "Before ScaleYourJunk vs. After.",
  beforeCaption = "Missed calls, sticky notes, and spreadsheets running your dispatch.",
  afterCaption = "Automated dispatch. AI phone agent. Every call booked on autopilot.",
  ctaText = "See how we automate every step.",
  ctaLabel = "Learn more",
  mockup,
  beforeVisual,
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
      {/* ===================== ZONE A — HEADER ===================== */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 130,
          backgroundColor: "#0A192F",
          padding: "48px 60px 32px 60px",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
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

        <ScaleYourJunkLogo variant="light" height={32} />

        <h1
          style={{
            color: "#FFFFFF",
            fontSize: 34,
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: "-0.01em",
            margin: 0,
            textAlign: "right",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 700,
          }}
        >
          {headline}
        </h1>
      </div>

      {/* ===================== ZONE B — SPLIT PANELS ===================== */}

      {/* LEFT — Before */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 130,
          width: 536,
          height: 822,
          backgroundColor: "#1A2332",
          padding: "50px 40px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {/* BEFORE chip */}
        <div
          style={{
            alignSelf: "flex-start",
            backgroundColor: "rgba(239, 68, 68, 0.15)",
            border: "1px solid #EF4444",
            borderRadius: 999,
            padding: "6px 16px",
            color: "#EF4444",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          BEFORE
        </div>

        {/* Before visual */}
        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 400,
            marginTop: 32,
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}
        >
          {beforeVisual || <PlaceholderBeforeVisual />}
          {/* Red unifying overlay */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(239, 68, 68, 0.08)",
              pointerEvents: "none",
            }}
          />
        </div>

        {/* Caption */}
        <p
          style={{
            color: "#CBD5E1",
            fontSize: 16,
            fontWeight: 500,
            lineHeight: 1.4,
            textAlign: "left",
            maxWidth: 400,
            marginTop: 24,
            marginBottom: 0,
          }}
        >
          {beforeCaption}
        </p>
      </div>

      {/* Vertical orange divider */}
      <div
        style={{
          position: "absolute",
          left: 536,
          top: 130,
          width: 8,
          height: 822,
          backgroundColor: "#FF6B00",
          zIndex: 2,
        }}
      />

      {/* RIGHT — After */}
      <div
        style={{
          position: "absolute",
          left: 544,
          top: 130,
          width: 536,
          height: 822,
          backgroundColor: "#0A192F",
          padding: "50px 40px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {/* AFTER chip */}
        <div
          style={{
            alignSelf: "flex-start",
            backgroundColor: "rgba(16, 185, 129, 0.15)",
            border: "1px solid #10B981",
            borderRadius: 999,
            padding: "6px 16px",
            color: "#10B981",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          AFTER
        </div>

        {/* Mockup */}
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            marginTop: 32,
            boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {mockup || <PlaceholderMockup />}
        </div>

        {/* Caption */}
        <p
          style={{
            color: "#E2E8F0",
            fontSize: 16,
            fontWeight: 500,
            lineHeight: 1.4,
            maxWidth: 400,
            marginTop: 24,
            marginBottom: 0,
          }}
        >
          {afterCaption}
        </p>
      </div>

      {/* ===================== ZONE C — CTA STRIP ===================== */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 952,
          height: 128,
          backgroundColor: "#F8FAFC",
          padding: "0 48px",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            color: "#0A192F",
            fontSize: 18,
            fontWeight: 700,
            lineHeight: 1.2,
          }}
        >
          {ctaText}
        </div>
        <div
          style={{
            backgroundColor: "#0A192F",
            color: "#FFFFFF",
            fontSize: 14,
            fontWeight: 500,
            padding: "12px 24px",
            borderRadius: 8,
            whiteSpace: "nowrap",
          }}
        >
          {ctaLabel}
        </div>
      </div>
    </div>
  );
}

/* ---------- Placeholder: Before visual (chaotic spreadsheet) ---------- */
function PlaceholderBeforeVisual() {
  return (
    <div
      style={{
        width: "100%",
        aspectRatio: "16 / 11",
        background: "linear-gradient(135deg, #2a2330 0%, #1a1520 100%)",
        position: "relative",
        padding: 16,
        boxSizing: "border-box",
      }}
    >
      {/* Misaligned cell rectangles */}
      <div
        style={{
          position: "absolute",
          top: 18,
          left: 18,
          width: "55%",
          height: 14,
          background: "rgba(239, 68, 68, 0.4)",
          borderRadius: 2,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 38,
          left: 24,
          width: "70%",
          height: 10,
          background: "rgba(255, 255, 255, 0.18)",
          borderRadius: 2,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 56,
          left: 16,
          width: "50%",
          height: 10,
          background: "rgba(255, 255, 255, 0.12)",
          borderRadius: 2,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 74,
          left: 28,
          width: "62%",
          height: 10,
          background: "rgba(255, 255, 255, 0.18)",
          borderRadius: 2,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 92,
          left: 22,
          width: "48%",
          height: 10,
          background: "rgba(255, 255, 255, 0.1)",
          borderRadius: 2,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 110,
          left: 30,
          width: "58%",
          height: 10,
          background: "rgba(255, 255, 255, 0.18)",
          borderRadius: 2,
        }}
      />

      {/* Crossed-out DELIVERED? label */}
      <div
        style={{
          position: "absolute",
          right: 20,
          top: 30,
          color: "#EF4444",
          fontSize: 18,
          fontWeight: 800,
          letterSpacing: "0.05em",
          textDecoration: "line-through",
          textDecorationThickness: 2,
          transform: "rotate(-6deg)",
        }}
      >
        DELIVERED?
      </div>

      {/* Sticky note */}
      <div
        style={{
          position: "absolute",
          bottom: 18,
          right: 20,
          width: 80,
          height: 60,
          background: "#FCD34D",
          padding: 6,
          fontSize: 9,
          color: "#451a03",
          fontWeight: 700,
          lineHeight: 1.2,
          transform: "rotate(4deg)",
          boxShadow: "0 4px 8px rgba(0,0,0,0.3)",
        }}
      >
        CALL BACK
        <br />
        CHRIS @ 2pm
      </div>

      {/* CHAOS label */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: 20,
          color: "#EF4444",
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        ⚠ CHAOS
      </div>
    </div>
  );
}

/* ---------- Placeholder: After mockup (mini browser) ---------- */
function PlaceholderMockup() {
  return (
    <div
      style={{
        width: "100%",
        backgroundColor: "#fff",
      }}
    >
      <div
        style={{
          height: 32,
          backgroundColor: "#F1F5F9",
          borderBottom: "1px solid #E2E8F0",
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#FF5F57" }} />
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#FEBC2E" }} />
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#28C840" }} />
        </div>
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            width: 200,
            height: 18,
            background: "#fff",
            borderRadius: 999,
            border: "1px solid #CBD5E1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
            color: "#64748B",
          }}
        >
          scaleyourjunk.com
        </div>
      </div>
      <div
        style={{
          aspectRatio: "16 / 10",
          background: "#F8FAFC",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 9, color: "#94A3B8", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Today's revenue
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#0A192F", lineHeight: 1 }}>
          $4,820
        </div>
        <div style={{ flex: 1, background: "#fff", borderRadius: 6, border: "1px solid #E2E8F0", padding: 8 }}>
          <svg viewBox="0 0 300 80" style={{ width: "100%", height: "100%" }}>
            <defs>
              <linearGradient id="bag" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,60 C40,55 60,40 100,42 C140,44 160,20 200,18 C240,16 260,30 300,24 L300,80 L0,80 Z"
              fill="url(#bag)"
            />
            <path
              d="M0,60 C40,55 60,40 100,42 C140,44 160,20 200,18 C240,16 260,30 300,24"
              fill="none"
              stroke="#10B981"
              strokeWidth="2"
            />
          </svg>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[
            ["Jobs", "12"],
            ["Booked", "11"],
            ["Calls", "24"],
          ].map(([k, v]) => (
            <div key={k} style={{ flex: 1, background: "#fff", border: "1px solid #E2E8F0", borderRadius: 4, padding: "5px 6px" }}>
              <div style={{ fontSize: 7, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em" }}>{k}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#0A192F" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
