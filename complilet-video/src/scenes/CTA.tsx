import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../brand";
import { Logo } from "../components/Logo";

export const CTA: React.FC = () => {
  const local = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(local, [0, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const logoScale = spring({
    frame: local,
    fps,
    config: { damping: 16, stiffness: 120 },
    durationInFrames: 20,
  });

  const headingOpacity = interpolate(local, [15, 35], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const headingY = interpolate(local, [15, 35], [20, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const btnProgress = spring({
    frame: Math.max(0, local - 30),
    fps,
    config: { damping: 18, stiffness: 140 },
    durationInFrames: 20,
  });

  const taglineOpacity = interpolate(local, [50, 70], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: COLORS.navy,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: fadeIn,
        gap: 32,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background glow */}
      <div
        style={{
          position: "absolute",
          width: 700,
          height: 700,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${COLORS.teal}20 0%, transparent 65%)`,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      />

      <div style={{ transform: `scale(${logoScale})` }}>
        <Logo height={100} />
      </div>

      <div
        style={{
          opacity: headingOpacity,
          transform: `translateY(${headingY}px)`,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 44,
            fontWeight: 800,
            color: COLORS.white,
            fontFamily: "'Clash Display', 'Satoshi', 'Inter', sans-serif",
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
          }}
        >
          The Renters' Rights Act is here.
          <br />
          <span style={{ color: COLORS.teal }}>Stay Compliant. Stay Letting.</span>
        </div>
        <div
          style={{
            fontSize: 16,
            color: "rgba(255,255,255,0.6)",
            marginTop: 12,
            fontFamily: "'General Sans', 'Outfit', 'Inter', sans-serif",
          }}
        >
          Join landlords already managing with CompliLet
        </div>
      </div>

      {/* WhatsApp CTA button */}
      <div
        style={{
          transform: `scale(${btnProgress})`,
          opacity: btnProgress,
          background: COLORS.whatsapp,
          borderRadius: 50,
          padding: "16px 40px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          boxShadow: `0 8px 32px ${COLORS.whatsapp}55`,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
        </svg>
        <span
          style={{
            color: COLORS.white,
            fontSize: 18,
            fontWeight: 700,
            fontFamily: "'General Sans', 'Outfit', 'Inter', sans-serif",
          }}
        >
          Start on WhatsApp — complilet.ai
        </span>
      </div>

      {/* Footer tagline */}
      <div
        style={{
          opacity: taglineOpacity,
          fontSize: 13,
          color: "rgba(255,255,255,0.35)",
          fontFamily: "'General Sans', 'Outfit', 'Inter', sans-serif",
          textAlign: "center",
        }}
      >
        Renters' Rights Act 2025 compliant · GDPR secure · No app required
      </div>
    </div>
  );
};
