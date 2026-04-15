import React from "react";
import { spring, useVideoConfig } from "remotion";
import { COLORS } from "../brand";

interface StatCardProps {
  stat: string;
  label: string;
  localFrame: number;
  delay?: number;
}

export const StatCard: React.FC<StatCardProps> = ({ stat, label, localFrame, delay = 0 }) => {
  const { fps } = useVideoConfig();
  const progress = spring({
    frame: Math.max(0, localFrame - delay),
    fps,
    config: { damping: 18, stiffness: 100 },
    durationInFrames: 20,
  });

  return (
    <div
      style={{
        background: COLORS.white,
        borderRadius: 20,
        padding: "28px 32px",
        transform: `translateY(${(1 - progress) * 40}px)`,
        opacity: progress,
        textAlign: "center",
        boxShadow: "0 8px 32px rgba(15,43,70,0.12)",
        minWidth: 220,
      }}
    >
      <div
        style={{
          fontSize: 52,
          fontWeight: 800,
          color: COLORS.teal,
          fontFamily: "'Clash Display', 'Satoshi', 'Inter', sans-serif",
          lineHeight: 1,
        }}
      >
        {stat}
      </div>
      <div
        style={{
          fontSize: 15,
          color: COLORS.muted,
          marginTop: 8,
          lineHeight: 1.4,
          fontFamily: "'General Sans', 'Outfit', 'Inter', sans-serif",
          maxWidth: 180,
          margin: "8px auto 0",
        }}
      >
        {label}
      </div>
    </div>
  );
};
