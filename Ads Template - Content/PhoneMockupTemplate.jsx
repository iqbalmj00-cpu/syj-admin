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
 * PhoneMockupTemplate — 1080×1080
 *
 *   A) Headline band (top 238px)  — dark navy, headline + logo
 *   B) Device showcase (rest)     — orange gradient, phone + subheadline
 */
export default function PhoneMockupTemplate({
  headline = "Answer every call. Even when you're on the truck.",
  subheadline = "ScaleYourJunk's AI phone agent books jobs, answers questions, and updates your dispatch in real time.",
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
      {/* ===================== ZONE A — HEADLINE BAND ===================== */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 238,
          backgroundColor: "#0A192F",
          padding: "48px 60px 24px 60px",
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

        <h1
          style={{
            color: "#FFFFFF",
            fontSize: 42,
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: "-0.01em",
            margin: 0,
            maxWidth: 680,
          }}
        >
          {headline}
        </h1>

        <div style={{ alignSelf: "flex-start", marginTop: 8 }}>
          <ScaleYourJunkLogo variant="light" height={40} />
        </div>
      </div>

      {/* ===================== ZONE B — DEVICE SHOWCASE ===================== */}
      <div
        style={{
          position: "absolute",
          top: 238,
          left: 0,
          right: 0,
          bottom: 0,
          background: "linear-gradient(180deg, #FF6B00 0%, #E85A00 100%)",
          padding: "40px 60px 60px 60px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Phone mockup container */}
        <div
          style={{
            width: "auto",
            maxHeight: 680,
            display: "flex",
            justifyContent: "center",
          }}
        >
          {mockup || <PlaceholderPhoneMockup />}
        </div>

        {/* Subheadline */}
        <p
          style={{
            color: "#FFFFFF",
            fontSize: 22,
            fontWeight: 500,
            lineHeight: 1.4,
            textAlign: "center",
            maxWidth: 820,
            margin: "40px 0 0 0",
          }}
        >
          {subheadline}
        </p>
      </div>
    </div>
  );
}

/* ---------- Placeholder phone mockup ---------- */
function PlaceholderPhoneMockup() {
  return (
    <div
      style={{
        position: "relative",
        width: 340,
        height: 680,
        backgroundColor: "#1D1D1F",
        borderRadius: 52,
        padding: 8,
        boxSizing: "border-box",
        boxShadow: "0 40px 100px rgba(10, 25, 47, 0.45)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          backgroundColor: "#000",
          borderRadius: 44,
          overflow: "hidden",
        }}
      >
        {/* Dynamic island */}
        <div
          style={{
            position: "absolute",
            top: 18,
            left: "50%",
            transform: "translateX(-50%)",
            width: 120,
            height: 32,
            backgroundColor: "#000",
            borderRadius: 999,
            zIndex: 10,
          }}
        />

        {/* Screen content placeholder */}
        <div
          style={{
            width: "100%",
            height: "100%",
            background:
              "linear-gradient(160deg, #1a2540 0%, #2d3d6b 50%, #6b4a8a 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(255,255,255,0.5)",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          [ Your phone screen here ]
        </div>
      </div>
    </div>
  );
}
