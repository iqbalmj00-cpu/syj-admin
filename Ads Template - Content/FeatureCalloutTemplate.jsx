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

/* ---------- Position map (Satori-safe absolute coords) ---------- */
const POSITION_STYLES = {
  "top-left":     { top: 40,  left: 60 },
  "top-right":    { top: 40,  right: 60 },
  "middle-left":  { top: 280, left: 60 },
  "middle-right": { top: 280, right: 60 },
  "bottom-left":  { bottom: 40, left: 60 },
  "bottom-right": { bottom: 40, right: 60 },
};

/* ---------- Single callout ---------- */
function Callout({ number, label, position }) {
  const pos = POSITION_STYLES[position] || POSITION_STYLES["top-left"];
  return (
    <div
      style={{
        position: "absolute",
        ...pos,
        display: "flex",
        alignItems: "center",
        zIndex: 20,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          backgroundColor: "#FF6B00",
          border: "4px solid #FFFFFF",
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#FFFFFF",
          fontSize: 22,
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        {number}
      </div>
      <div
        style={{
          backgroundColor: "#0A192F",
          color: "#FFFFFF",
          fontSize: 14,
          fontWeight: 500,
          padding: "8px 14px",
          borderRadius: 8,
          whiteSpace: "nowrap",
          marginLeft: 12,
        }}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * FeatureCalloutTemplate — 1080×1080
 *
 *   A) Header   (top 140px)  — dark navy, logo + headline
 *   B) Mockup   (mid 800px)  — off-white + numbered callouts
 *   C) Footer   (bot 140px)  — dark navy, subheadline + CTA
 */
export default function FeatureCalloutTemplate({
  headline = "Built for the way you dispatch.",
  subheadline = "Ranked, routed, and dispatched before you finish your morning coffee.",
  ctaLabel = "SEE IT IN ACTION →",
  callouts = [
    { number: 1, label: "AI ranks jobs by profit", position: "top-right" },
    { number: 2, label: "One-click dispatch",      position: "middle-left" },
    { number: 3, label: "Auto-routed in 2s",       position: "bottom-right" },
  ],
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
      {/* ===================== ZONE A — HEADER ===================== */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 140,
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
            textAlign: "right",
            maxWidth: 760,
            margin: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {headline}
        </h1>
      </div>

      {/* ===================== ZONE B — ANNOTATED MOCKUP ===================== */}
      <div
        style={{
          position: "absolute",
          top: 140,
          left: 0,
          right: 0,
          height: 800,
          backgroundColor: "#F8FAFC",
          padding: "50px 60px",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 900,
          }}
        >
          <div
            style={{
              width: "100%",
              boxShadow: "0 30px 80px rgba(10, 25, 47, 0.2)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {mockup || <PlaceholderMockup />}
          </div>

          {/* Callout overlay */}
          {callouts.map((c) => (
            <Callout
              key={c.number}
              number={c.number}
              label={c.label}
              position={c.position}
            />
          ))}
        </div>
      </div>

      {/* ===================== ZONE C — FOOTER ===================== */}
      <div
        style={{
          position: "absolute",
          top: 940,
          left: 0,
          right: 0,
          height: 140,
          backgroundColor: "#0A192F",
          padding: "32px 60px",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <p
          style={{
            color: "#94A3B8",
            fontSize: 17,
            fontWeight: 500,
            lineHeight: 1.4,
            maxWidth: 640,
            margin: 0,
          }}
        >
          {subheadline}
        </p>
        <div
          style={{
            color: "#FF6B00",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {ctaLabel}
        </div>
      </div>
    </div>
  );
}

/* ---------- Placeholder mockup ---------- */
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
          height: 44,
          backgroundColor: "#F1F5F9",
          borderBottom: "1px solid #E2E8F0",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", gap: 7 }}>
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#FF5F57" }} />
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#FEBC2E" }} />
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#28C840" }} />
        </div>
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            width: 320,
            height: 26,
            background: "#fff",
            borderRadius: 999,
            border: "1px solid #CBD5E1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            color: "#1d1d1f",
          }}
        >
          scaleyourjunk.com/dispatch
        </div>
      </div>

      <div
        style={{
          aspectRatio: "16 / 10",
          display: "flex",
          background: "#F8FAFC",
        }}
      >
        <div
          style={{
            width: 160,
            background: "#0F172A",
            padding: "18px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 12, marginBottom: 14 }}>
            Dispatch HQ
          </div>
          {["Live Board", "Routes", "Crews", "Customers", "Messages", "Reports"].map((t, i) => (
            <div
              key={t}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                fontSize: 11,
                color: i === 0 ? "#fff" : "#94A3B8",
                background: i === 0 ? "#1E293B" : "transparent",
                fontWeight: i === 0 ? 600 : 400,
              }}
            >
              {t}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
                Monday morning
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0A192F" }}>
                Live dispatch board
              </div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#059669", background: "#D1FAE5", padding: "4px 10px", borderRadius: 999 }}>
              4 crews active
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 10, flex: 1 }}>
            <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #E2E8F0", overflow: "hidden", position: "relative" }}>
              <svg viewBox="0 0 400 260" style={{ width: "100%", height: "100%" }}>
                <rect width="400" height="260" fill="#E8F0F5" />
                <path d="M0,80 L400,95" stroke="#CBD5E1" strokeWidth="5" />
                <path d="M0,170 L400,150" stroke="#CBD5E1" strokeWidth="5" />
                <path d="M110,0 L125,260" stroke="#CBD5E1" strokeWidth="5" />
                <path d="M260,0 L250,260" stroke="#CBD5E1" strokeWidth="5" />
                <path
                  d="M60,210 Q150,160 200,130 T340,60"
                  stroke="#F59E0B"
                  strokeWidth="2.5"
                  strokeDasharray="5 3"
                  fill="none"
                />
                {[
                  [60, 210, "#F59E0B"],
                  [160, 160, "#F59E0B"],
                  [240, 120, "#F59E0B"],
                  [340, 60, "#10B981"],
                ].map(([x, y, c], i) => (
                  <g key={i}>
                    <circle cx={x} cy={y} r="8" fill={c} opacity="0.25" />
                    <circle cx={x} cy={y} r="4" fill={c} />
                  </g>
                ))}
              </svg>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #E2E8F0", padding: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#0A192F", marginBottom: 8 }}>
                  Active crews
                </div>
                {["Truck 01", "Truck 02", "Truck 03", "Truck 04"].map((t) => (
                  <div key={t} style={{ fontSize: 9, color: "#475569", padding: "2px 0" }}>
                    {t}
                  </div>
                ))}
              </div>
              <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #E2E8F0", padding: 10, flex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#0A192F", marginBottom: 8 }}>
                  Incoming
                </div>
                {["Katy, TX", "Sugar Land", "Pearland"].map((loc) => (
                  <div key={loc} style={{ fontSize: 9, color: "#475569", padding: "3px 0", borderTop: "1px solid #F1F5F9" }}>
                    {loc}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
