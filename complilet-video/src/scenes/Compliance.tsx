import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, SCENE } from "../brand";
import { WhatsAppPhone } from "../components/WhatsAppPhone";

const MESSAGES = [
  {
    text: "⚠️ Gas Safety Certificate — 30 days until expiry\n\n14 Maple Street\nExpiry: 14 May 2026\n\nFine for missing this: up to £6,000 + potential prosecution.\n\nWould you like me to find a Gas Safe engineer nearby?",
    from: "agent" as const,
    appearsAt: 10,
  },
  {
    text: "Yes please find one",
    from: "landlord" as const,
    appearsAt: 50,
  },
  {
    text: "Found 3 Gas Safe engineers near LS1:\n\n1️⃣ AJ Gas Services — 4.9★ — available tomorrow\n2️⃣ Leeds Heating Co — 4.8★ — available Thu\n3️⃣ SafeFlame Ltd — 4.7★ — available Fri\n\nReply 1, 2, or 3 to book.",
    from: "agent" as const,
    appearsAt: 75,
  },
  {
    text: "1",
    from: "landlord" as const,
    appearsAt: 110,
  },
  {
    text: "✅ AJ Gas Services booked for tomorrow 10am.\n\nI'll remind the tenant and send you the certificate when complete.",
    from: "agent" as const,
    appearsAt: 130,
  },
];

const CERTS = [
  { label: "Gas Safety", status: "warning", days: "30 days" },
  { label: "EICR", status: "ok", days: "2 years" },
  { label: "EPC Band D", status: "ok", days: "8 years" },
  { label: "Deposit Protected", status: "ok", days: "✓ Protected" },
  { label: "Smoke Alarms", status: "ok", days: "✓ Checked" },
];

export const Compliance: React.FC = () => {
  const local = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(local, [0, 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(local, [SCENE.COMPLIANCE - 15, SCENE.COMPLIANCE], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacity = Math.min(fadeIn, fadeOut);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: COLORS.cream,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
        gap: 80,
        padding: "0 80px",
      }}
    >
      {/* Left: phone */}
      <div style={{ flexShrink: 0 }}>
        <WhatsAppPhone messages={MESSAGES} title="CompliLet" subtitle="Compliance Autopilot" localFrame={local} />
      </div>

      {/* Right: copy + cert dashboard */}
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
          Compliance Autopilot
        </div>
        <div
          style={{
            fontSize: 36,
            fontWeight: 800,
            color: COLORS.navy,
            fontFamily: "'Clash Display', 'Satoshi', 'Inter', sans-serif",
            lineHeight: 1.2,
            letterSpacing: "-0.02em",
            marginBottom: 24,
          }}
        >
          Never miss a
          <br />certificate deadline
        </div>

        {/* Mini compliance dashboard */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {CERTS.map((cert, i) => {
            const progress = spring({
              frame: Math.max(0, local - (i * 8 + 15)),
              fps,
              config: { damping: 18, stiffness: 140 },
              durationInFrames: 15,
            });

            const isWarning = cert.status === "warning";

            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: isWarning ? "#FEF3C7" : COLORS.white,
                  border: `1px solid ${isWarning ? "#F59E0B" : "#E5E7EB"}`,
                  borderRadius: 12,
                  padding: "10px 16px",
                  transform: `translateX(${(1 - progress) * 30}px)`,
                  opacity: progress,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: isWarning ? "#F59E0B" : COLORS.successGreen,
                    }}
                  />
                  <span style={{ fontSize: 14, fontWeight: 500, color: COLORS.dark, fontFamily: "'General Sans', 'Outfit', 'Inter', sans-serif" }}>
                    {cert.label}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: isWarning ? "#B45309" : COLORS.muted, fontWeight: isWarning ? 600 : 400 }}>
                  {cert.days}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
