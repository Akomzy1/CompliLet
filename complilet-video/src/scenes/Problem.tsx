import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, SCENE } from "../brand";
import { StatCard } from "../components/StatCard";

export const Problem: React.FC = () => {
  const local = useCurrentFrame();

  const fadeIn = interpolate(local, [0, 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(local, [SCENE.PROBLEM - 15, SCENE.PROBLEM], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacity = Math.min(fadeIn, fadeOut);

  const headingY = interpolate(local, [0, 20], [30, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

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
        gap: 48,
      }}
    >
      <div
        style={{
          transform: `translateY(${headingY}px)`,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: COLORS.teal,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontFamily: "'General Sans', 'Outfit', 'Inter', sans-serif",
            marginBottom: 12,
          }}
        >
          The Problem
        </div>
        <div
          style={{
            fontSize: 38,
            fontWeight: 800,
            color: COLORS.navy,
            fontFamily: "'Clash Display', 'Satoshi', 'Inter', sans-serif",
            lineHeight: 1.2,
            letterSpacing: "-0.02em",
          }}
        >
          Managing rentals manually
          <br />is complex, risky, and time-consuming
        </div>
      </div>

      <div style={{ display: "flex", gap: 24 }}>
        <StatCard stat="78%" label="of UK landlords manage properties manually without software" localFrame={local} delay={15} />
        <StatCard stat="1.1M" label="self-managing landlords facing the Renters' Rights Act 2025" localFrame={local} delay={25} />
        <StatCard stat="£6,000" label="fine for missing a gas safety certificate" localFrame={local} delay={35} />
      </div>
    </div>
  );
};
