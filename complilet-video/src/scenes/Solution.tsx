import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, SCENE } from "../brand";
import { Logo } from "../components/Logo";

const STEPS = [
  { icon: "📋", label: "Screen tenants" },
  { icon: "🪪", label: "Right to Rent" },
  { icon: "📅", label: "Compliance" },
  { icon: "🔧", label: "Maintenance" },
  { icon: "💷", label: "Rent review" },
];

export const Solution: React.FC = () => {
  const local = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(local, [0, 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(local, [SCENE.SOLUTION - 15, SCENE.SOLUTION], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacity = Math.min(fadeIn, fadeOut);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `linear-gradient(135deg, ${COLORS.navy} 0%, #1a3d5c 100%)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity,
        gap: 40,
        padding: "0 80px",
      }}
    >
      <Logo height={90} />

      <div
        style={{
          fontSize: 40,
          fontWeight: 800,
          color: COLORS.white,
          fontFamily: "'Clash Display', 'Satoshi', 'Inter', sans-serif",
          textAlign: "center",
          lineHeight: 1.2,
          letterSpacing: "-0.02em",
        }}
      >
        Everything handled via{" "}
        <span style={{ color: COLORS.whatsapp }}>WhatsApp</span>
        <br />
        <span style={{ fontSize: 24, fontWeight: 400, color: "rgba(255,255,255,0.65)" }}>
          No app. No login. No complexity.
        </span>
      </div>

      {/* Step pills */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
        {STEPS.map((step, i) => {
          const progress = spring({
            frame: Math.max(0, local - (i * 8 + 20)),
            fps,
            config: { damping: 18, stiffness: 140 },
            durationInFrames: 15,
          });

          return (
            <div
              key={i}
              style={{
                background: "rgba(255,255,255,0.1)",
                border: `1px solid rgba(255,255,255,0.2)`,
                borderRadius: 50,
                padding: "10px 22px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                transform: `scale(${progress})`,
                opacity: progress,
              }}
            >
              <span style={{ fontSize: 20 }}>{step.icon}</span>
              <span
                style={{
                  color: COLORS.white,
                  fontSize: 15,
                  fontWeight: 500,
                  fontFamily: "'General Sans', 'Outfit', 'Inter', sans-serif",
                }}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
