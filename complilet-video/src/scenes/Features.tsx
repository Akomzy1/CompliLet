import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, SCENE } from "../brand";

const FEATURES = [
  { icon: "📋", title: "Tenant Screening", desc: "Pre-qualify, collect docs, verify income, chase refs — fully automated" },
  { icon: "🪪", title: "Right to Rent", desc: "Deterministic List A/B checks. Automatic follow-up reminders for time-limited docs" },
  { icon: "📅", title: "Compliance Autopilot", desc: "Gas, EICR, EPC, deposit, smoke alarms — never miss a deadline again" },
  { icon: "🔧", title: "Maintenance Triage", desc: "AI classifies urgency, dispatches contractors, tracks resolution" },
  { icon: "💷", title: "Rent Monitoring", desc: "Due-date reminders, arrears chasing, empathetic escalation ladder" },
  { icon: "🌍", title: "NRL Tax Guidance", desc: "NRL1 support for overseas landlords managing UK properties remotely" },
];

export const Features: React.FC = () => {
  const local = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(local, [0, 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(local, [SCENE.FEATURES - 15, SCENE.FEATURES], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacity = Math.min(fadeIn, fadeOut);

  const headingY = interpolate(local, [0, 20], [24, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: COLORS.cream,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity,
        padding: "0 80px",
        gap: 40,
      }}
    >
      <div style={{ textAlign: "center", transform: `translateY(${headingY}px)` }}>
        <div
          style={{
            fontSize: 36,
            fontWeight: 800,
            color: COLORS.navy,
            fontFamily: "'Clash Display', 'Satoshi', 'Inter', sans-serif",
            letterSpacing: "-0.02em",
          }}
        >
          Everything a landlord needs
        </div>
        <div style={{ fontSize: 16, color: COLORS.muted, marginTop: 8, fontFamily: "'General Sans', 'Outfit', 'Inter', sans-serif" }}>
          One WhatsApp number. All managed by AI.
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 20,
          width: "100%",
          maxWidth: 960,
        }}
      >
        {FEATURES.map((f, i) => {
          const progress = spring({
            frame: Math.max(0, local - (i * 6 + 15)),
            fps,
            config: { damping: 18, stiffness: 130 },
            durationInFrames: 18,
          });

          return (
            <div
              key={i}
              style={{
                background: COLORS.white,
                borderRadius: 16,
                padding: "20px 22px",
                boxShadow: "0 4px 20px rgba(15,43,70,0.08)",
                transform: `translateY(${(1 - progress) * 30}px)`,
                opacity: progress,
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 10 }}>{f.icon}</div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: COLORS.navy,
                  fontFamily: "'Clash Display', 'Satoshi', 'Inter', sans-serif",
                  marginBottom: 6,
                }}
              >
                {f.title}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: COLORS.muted,
                  lineHeight: 1.5,
                  fontFamily: "'General Sans', 'Outfit', 'Inter', sans-serif",
                }}
              >
                {f.desc}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
