import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, SCENE } from "../brand";
import { Logo } from "../components/Logo";

export const Intro: React.FC = () => {
  const local = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({
    frame: local,
    fps,
    config: { damping: 16, stiffness: 100 },
    durationInFrames: 30,
  });

  const logoOpacity = interpolate(local, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subOpacity = interpolate(local, [40, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const subY = interpolate(local, [40, 60], [16, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Fade out at end of scene
  const sceneOpacity = interpolate(
    local,
    [SCENE.INTRO - 15, SCENE.INTRO],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

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
        opacity: sceneOpacity,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Subtle radial glow */}
      <div
        style={{
          position: "absolute",
          width: 800,
          height: 800,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${COLORS.teal}1A 0%, transparent 65%)`,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}
      />

      {/* Logo image — full variant includes wordmark + tagline */}
      <div
        style={{
          opacity: logoOpacity,
          transform: `scale(${logoScale})`,
        }}
      >
        <Logo height={260} />
      </div>

      {/* Secondary subtitle — "WhatsApp-Native AI..." fades in after the logo */}
      <div
        style={{
          opacity: subOpacity,
          transform: `translateY(${subY}px)`,
          fontSize: 18,
          color: "rgba(255,255,255,0.5)",
          fontFamily: "'General Sans', 'Outfit', 'Inter', sans-serif",
          letterSpacing: "0.04em",
          marginTop: 8,
        }}
      >
        WhatsApp-Native · AI-Powered · UK Landlords
      </div>
    </div>
  );
};
