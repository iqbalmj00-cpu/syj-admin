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
 * StatSplitTemplate — 1080×1080
 *   A) Stat panel  (left 50%)  — dark navy, giant number
 *   B) Screenshot  (right 50%) — orange, mockup
 */
export default function StatSplitTemplate({
  statLabel = "MONTHLY REVENUE CAPTURED",
  statValue = "$12k",
  statContext = "Extra revenue operators capture every month by answering after-hours calls with an AI phone agent.",
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
      {/* ZONE A — STAT PANEL */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 540,
          height: 1080,
          backgroundColor: "#0A192F",
          padding: 60,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Real logo — centered and larger */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <ScaleYourJunkLogo variant="light" height={52} />
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              color: "#FF6B00",
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              lineHeight: 1.2,
            }}
          >
            {statLabel}
          </div>

          <div
            style={{
              color: "#FFFFFF",
              fontSize: 140,
              fontWeight: 800,
              lineHeight: 1.0,
              margin: "16px 0",
              letterSpacing: "-0.04em",
              whiteSpace: "nowrap",
            }}
          >
            {statValue}
          </div>

          <div
            style={{
              color: "#94A3B8",
              fontSize: 20,
              fontWeight: 500,
              lineHeight: 1.4,
              maxWidth: 420,
            }}
          >
            {statContext}
          </div>
        </div>
      </div>

      {/* Orange vertical accent bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 538,
          width: 8,
          height: 1080,
          backgroundColor: "#FF6B00",
          zIndex: 2,
        }}
      />

      {/* ZONE B — SCREENSHOT */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 540,
          width: 540,
          height: 1080,
          backgroundColor: "#FF6B00",
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
            maxWidth: 420,
            filter: "drop-shadow(-20px 20px 60px rgba(10, 25, 47, 0.3))",
          }}
        >
          {mockup || <PlaceholderMockup />}
        </div>
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
          height: 36,
          backgroundColor: "#F1F5F9",
          borderBottom: "1px solid #E2E8F0",
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#FF5F57" }} />
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#FEBC2E" }} />
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#28C840" }} />
        </div>
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            width: 260,
            height: 22,
            background: "#fff",
            borderRadius: 999,
            border: "1px solid #CBD5E1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            color: "#64748B",
            fontFamily: "ui-monospace, Menlo, monospace",
          }}
        >
          scaleyourjunk.com/revenue
        </div>
      </div>
      <div
        style={{
          aspectRatio: "16 / 10",
          background: "#F8FAFC",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "#94A3B8",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Revenue this month
        </div>
        <div style={{ fontSize: 32, fontWeight: 800, color: "#0A192F", lineHeight: 1 }}>
          $48,920
        </div>
        <div
          style={{
            flex: 1,
            background: "#fff",
            borderRadius: 8,
            border: "1px solid #E2E8F0",
            padding: 12,
          }}
        >
          <svg viewBox="0 0 400 140" style={{ width: "100%", height: "100%" }}>
            <defs>
              <linearGradient id="statg" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#FF6B00" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#FF6B00" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,110 C50,95 80,70 130,75 C180,80 210,40 260,35 C310,30 340,60 390,45 L400,45 L400,140 L0,140 Z"
              fill="url(#statg)"
            />
            <path
              d="M0,110 C50,95 80,70 130,75 C180,80 210,40 260,35 C310,30 340,60 390,45 L400,45"
              fill="none"
              stroke="#FF6B00"
              strokeWidth="2.5"
            />
          </svg>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            ["Calls", "214"],
            ["Booked", "187"],
            ["Rate", "87%"],
          ].map(([k, v]) => (
            <div
              key={k}
              style={{
                flex: 1,
                background: "#fff",
                border: "1px solid #E2E8F0",
                borderRadius: 6,
                padding: "6px 8px",
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: "#94A3B8",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {k}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0A192F" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
