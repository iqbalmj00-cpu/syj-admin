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
 * QuoteCardTemplate — 1080×1080
 *
 * Pure typographic testimonial. No mockup slot — by design.
 */
export default function QuoteCardTemplate({
  quote = "We were drowning in missed calls before SYJ. Now every one gets booked — even the 3AM ones.",
  attribution = "Mike Johnson",
  role = "Owner, Clean Haulers LLC",
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
        background: "linear-gradient(135deg, #0A192F 0%, #1A2B4A 100%)",
        boxShadow: "0 20px 60px rgba(10, 25, 47, 0.15)",
      }}
    >
      {/* Top orange accent bar */}
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

      {/* Decorative giant quotation mark */}
      <div
        style={{
          position: "absolute",
          top: 40,
          left: 60,
          fontSize: 360,
          fontWeight: 800,
          lineHeight: 1,
          color: "#FF6B00",
          opacity: 0.15,
          zIndex: 0,
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        "
      </div>

      {/* Logo top-right */}
      <div
        style={{
          position: "absolute",
          top: 48,
          right: 60,
          zIndex: 2,
        }}
      >
        <ScaleYourJunkLogo variant="light" height={36} />
      </div>

      {/* Quote content — flex-centered layer (Satori-safe) */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxWidth: 900,
            padding: "0 90px",
          }}
        >
          {/* Quote text */}
          <p
            style={{
              color: "#FFFFFF",
              fontSize: 38,
              fontWeight: 800,
              lineHeight: 1.3,
              letterSpacing: "-0.01em",
              textAlign: "left",
              margin: 0,
            }}
          >
            "{quote}"
          </p>

          {/* Star rating */}
          <div
            style={{
              display: "flex",
              gap: 4,
              marginTop: 32,
              color: "#FFB800",
              fontSize: 28,
              fontWeight: 400,
            }}
          >
            ★★★★★
          </div>

          {/* Attribution */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: 16,
            }}
          >
            <div
              style={{
                color: "#FFFFFF",
                fontSize: 20,
                fontWeight: 700,
                margin: 0,
              }}
            >
              {attribution}
            </div>
            <div
              style={{
                color: "#94A3B8",
                fontSize: 15,
                fontWeight: 400,
                marginTop: 4,
              }}
            >
              {role}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom tagline strip */}
      <div
        style={{
          position: "absolute",
          bottom: 40,
          left: 0,
          right: 0,
          textAlign: "center",
          color: "#64748B",
          fontSize: 12,
          fontWeight: 400,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        SCALE YOUR JUNK REMOVAL BUSINESS
      </div>
    </div>
  );
}
