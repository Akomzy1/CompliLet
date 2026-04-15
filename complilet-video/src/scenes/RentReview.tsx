import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, SCENE } from "../brand";
import { WhatsAppPhone } from "../components/WhatsAppPhone";

const MESSAGES = [
  {
    text: "It's been 12 months since Priya moved into 14 Maple Street. Just checking in:\n\n1️⃣ Everything's fine — continue\n2️⃣ I'd like to review the rent\n3️⃣ I have concerns about the tenancy\n\nReply 1, 2, or 3.",
    from: "agent" as const,
    appearsAt: 8,
  },
  {
    text: "2",
    from: "landlord" as const,
    appearsAt: 45,
  },
  {
    text: "Current rent: £1,500/month\nLast increase: none (eligible ✓)\n\nWhat would you like the new monthly rent to be?",
    from: "agent" as const,
    appearsAt: 65,
  },
  {
    text: "£1,600",
    from: "landlord" as const,
    appearsAt: 100,
  },
  {
    text: "Increase of £100/month (+6.7%) — within normal market range ✓\n\nSection 13 notice will be served today.\nEffective date: 14 June 2026 (2 months' notice ✓)\n\nConfirm? Reply YES to proceed.",
    from: "agent" as const,
    appearsAt: 118,
  },
  {
    text: "YES",
    from: "landlord" as const,
    appearsAt: 155,
  },
  {
    text: "✅ Section 13 Form 4A generated and sent to Priya.\n\nShe has until 14 June 2026 to refer to the First-tier Tribunal if she disagrees.",
    from: "agent" as const,
    appearsAt: 175,
  },
];

export const RentReview: React.FC = () => {
  const local = useCurrentFrame();

  const fadeIn = interpolate(local, [0, 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(local, [SCENE.RENT_REVIEW - 15, SCENE.RENT_REVIEW], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacity = Math.min(fadeIn, fadeOut);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `linear-gradient(135deg, ${COLORS.navy} 0%, #1a3d5c 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
        gap: 80,
        padding: "0 80px",
      }}
    >
      {/* Left: copy */}
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: COLORS.teal,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontFamily: "'General Sans', 'Outfit', 'Inter', sans-serif",
            marginBottom: 12,
          }}
        >
          Section 13 Rent Review
        </div>
        <div
          style={{
            fontSize: 36,
            fontWeight: 800,
            color: COLORS.white,
            fontFamily: "'Clash Display', 'Satoshi', 'Inter', sans-serif",
            lineHeight: 1.2,
            letterSpacing: "-0.02em",
            marginBottom: 20,
          }}
        >
          Legally correct
          <br />rent increases,
          <br />automatically
        </div>

        {[
          "12-month frequency limit enforced",
          "2-month notice period guaranteed",
          "Form 4A generated — prescribed form",
          "Tenant Tribunal rights included",
          "Retaliatory increase check built-in",
        ].map((item, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
              opacity: interpolate(local, [20 + i * 10, 38 + i * 10], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: COLORS.teal,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>
            </div>
            <span style={{ fontSize: 14, color: "rgba(255,255,255,0.85)", fontFamily: "'General Sans', 'Outfit', 'Inter', sans-serif" }}>
              {item}
            </span>
          </div>
        ))}

        {/* Legal badge */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(13,148,136,0.2)",
            border: `1px solid ${COLORS.teal}`,
            borderRadius: 8,
            padding: "8px 14px",
            marginTop: 8,
            opacity: interpolate(local, [60, 75], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          <span style={{ fontSize: 14 }}>⚖️</span>
          <span style={{ fontSize: 12, color: COLORS.teal, fontWeight: 600, fontFamily: "'General Sans', 'Outfit', 'Inter', sans-serif" }}>
            Renters' Rights Act 2025 compliant
          </span>
        </div>
      </div>

      {/* Right: phone */}
      <div style={{ flexShrink: 0 }}>
        <WhatsAppPhone
          messages={MESSAGES}
          title="CompliLet"
          subtitle="Rent Review"
          localFrame={local}
        />
      </div>
    </div>
  );
};
