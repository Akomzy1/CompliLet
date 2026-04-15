import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, SCENE } from "../brand";
import { WhatsAppPhone } from "../components/WhatsAppPhone";

const MESSAGES = [
  {
    text: "Hi! I'm CompliLet — AI property management for your landlord. I'll help complete your application for 14 Maple Street.\n\nThis conversation uses AI. You have the right to request a human review at any time. Type 'speak to someone' to do so.",
    from: "agent" as const,
    appearsAt: 5,
  },
  {
    text: "Could you tell me your full name and current employment status?",
    from: "agent" as const,
    appearsAt: 25,
  },
  {
    text: "Hi! I'm Priya Sharma, I work full-time as a software engineer at Barclays.",
    from: "tenant" as const,
    appearsAt: 50,
  },
  {
    text: "Great, Priya! Your gross salary needs to be at least £45,000/yr to meet the affordability threshold (2.5× annual rent of £18,000).\n\nCould you send your 3 most recent payslips? 📎",
    from: "agent" as const,
    appearsAt: 75,
  },
  {
    text: "[3 payslips sent]",
    from: "tenant" as const,
    appearsAt: 120,
    isStatus: false,
  },
  {
    text: "✅ Payslips verified — gross income £62,000/yr.\n\nAffordability: PASS ✓\n\nNext: Right to Rent check. Please send a photo of your passport.",
    from: "agent" as const,
    appearsAt: 145,
  },
  {
    text: "[Passport photo sent]",
    from: "tenant" as const,
    appearsAt: 175,
  },
  {
    text: "✅ Right to Rent: PASS\nList A — unlimited right to rent in England.\n\nGenerating your screening report...",
    from: "agent" as const,
    appearsAt: 200,
  },
];

export const Screening: React.FC = () => {
  const local = useCurrentFrame();

  const fadeIn = interpolate(local, [0, 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(local, [SCENE.SCREENING - 15, SCENE.SCREENING], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacity = Math.min(fadeIn, fadeOut);

  const labelY = interpolate(local, [0, 20], [20, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: COLORS.lightTeal,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
        gap: 80,
        padding: "0 80px",
      }}
    >
      {/* Left: copy */}
      <div style={{ flex: 1, transform: `translateY(${labelY}px)` }}>
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
          Step 1 — Tenant Screening
        </div>
        <div
          style={{
            fontSize: 36,
            fontWeight: 800,
            color: COLORS.navy,
            fontFamily: "'Clash Display', 'Satoshi', 'Inter', sans-serif",
            lineHeight: 1.2,
            letterSpacing: "-0.02em",
            marginBottom: 20,
          }}
        >
          Screen tenants
          <br />in 24 hours,
          <br />not 2 weeks
        </div>
        {[
          "Income & affordability verification",
          "Document collection & AI validation",
          "Right to Rent check (deterministic)",
          "Reference chasing — automated",
          "Scored PDF report to landlord",
        ].map((item, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
              opacity: interpolate(local, [20 + i * 10, 35 + i * 10], [0, 1], {
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
            <span style={{ fontSize: 14, color: COLORS.dark, fontFamily: "'General Sans', 'Outfit', 'Inter', sans-serif" }}>
              {item}
            </span>
          </div>
        ))}
      </div>

      {/* Right: phone */}
      <div style={{ flexShrink: 0 }}>
        <WhatsAppPhone messages={MESSAGES} title="CompliLet" subtitle="Tenant Screening" localFrame={local} />
      </div>
    </div>
  );
};
