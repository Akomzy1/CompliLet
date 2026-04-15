import React from "react";
import { interpolate, useCurrentFrame, spring, useVideoConfig } from "remotion";
import { COLORS } from "../brand";

interface Message {
  text: string;
  from: "agent" | "tenant" | "landlord";
  /** Frame at which this bubble appears */
  appearsAt: number;
  isStatus?: boolean; // grey system message
}

interface WhatsAppPhoneProps {
  messages: Message[];
  title?: string;
  subtitle?: string;
  /** Local frame (0 = scene start) */
  localFrame: number;
}

export const WhatsAppPhone: React.FC<WhatsAppPhoneProps> = ({
  messages,
  title = "CompliLet",
  subtitle = "AI Property Management",
  localFrame,
}) => {
  const { fps } = useVideoConfig();

  const phoneScale = spring({
    frame: localFrame,
    fps,
    config: { damping: 18, stiffness: 120 },
    durationInFrames: 20,
  });

  return (
    <div
      style={{
        transform: `scale(${phoneScale})`,
        width: 320,
        borderRadius: 36,
        overflow: "hidden",
        boxShadow: "0 32px 80px rgba(0,0,0,0.45)",
        fontFamily: "'Segoe UI', Arial, sans-serif",
        background: "#fff",
        border: "8px solid #1a1a1a",
        position: "relative",
      }}
    >
      {/* Notch */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: 100,
          height: 24,
          background: "#1a1a1a",
          borderRadius: "0 0 16px 16px",
          zIndex: 10,
        }}
      />

      {/* WhatsApp header */}
      <div
        style={{
          background: COLORS.waHeader,
          padding: "32px 14px 10px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: COLORS.teal,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontSize: 16,
            fontWeight: 700,
            color: "#fff",
          }}
        >
          CL
        </div>
        <div>
          <div style={{ color: "#fff", fontWeight: 600, fontSize: 14, lineHeight: 1.2 }}>
            {title}
          </div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>{subtitle}</div>
        </div>
      </div>

      {/* Chat area */}
      <div
        style={{
          background: COLORS.waBg,
          minHeight: 380,
          padding: "10px 10px 70px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {messages.map((msg, i) => {
          const visible = localFrame >= msg.appearsAt;
          if (!visible) return null;

          const bubbleProgress = spring({
            frame: Math.max(0, localFrame - msg.appearsAt),
            fps,
            config: { damping: 20, stiffness: 180 },
            durationInFrames: 12,
          });

          if (msg.isStatus) {
            return (
              <div
                key={i}
                style={{
                  alignSelf: "center",
                  background: "rgba(0,0,0,0.12)",
                  color: "#555",
                  fontSize: 10,
                  padding: "3px 10px",
                  borderRadius: 8,
                  opacity: bubbleProgress,
                }}
              >
                {msg.text}
              </div>
            );
          }

          const isOut = msg.from === "agent" || msg.from === "landlord";

          return (
            <div
              key={i}
              style={{
                alignSelf: isOut ? "flex-end" : "flex-start",
                transform: `scale(${bubbleProgress})`,
                transformOrigin: isOut ? "right center" : "left center",
                maxWidth: "82%",
              }}
            >
              <div
                style={{
                  background: isOut ? COLORS.waBubbleOut : COLORS.waBubbleIn,
                  borderRadius: isOut
                    ? "12px 2px 12px 12px"
                    : "2px 12px 12px 12px",
                  padding: "7px 10px 4px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
                }}
              >
                {!isOut && (
                  <div style={{ fontSize: 10, color: COLORS.teal, fontWeight: 600, marginBottom: 2 }}>
                    {msg.from === "tenant" ? "Tenant" : "Referee"}
                  </div>
                )}
                <div style={{ fontSize: 12, color: "#111", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  {msg.text}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "#999",
                    textAlign: "right",
                    marginTop: 2,
                  }}
                >
                  {isOut ? "✓✓ " : ""}
                  {new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
