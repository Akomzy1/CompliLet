"use client";

import { useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WhatsAppMessage {
  id: string;
  /** "out" = landlord/agent (right, green bubble); "in" = tenant (left, white bubble) */
  direction: "out" | "in";
  text: string;
  time: string;
  /** Tick state — only relevant for outgoing messages */
  status?: "sent" | "delivered" | "read";
}

interface WhatsAppMockupProps {
  messages: WhatsAppMessage[];
  /** Name shown in the WhatsApp header */
  contactName?: string;
  /** Emoji or initials to use as avatar placeholder */
  contactAvatar?: string;
  /** When true, messages animate in one-at-a-time on scroll into view */
  animated?: boolean;
  className?: string;
}

// ─── Authentic WhatsApp colour palette ───────────────────────────────────────

const WA = {
  header: "#075E54",
  headerDark: "#054D44",
  outgoing: "#DCF8C6",
  incoming: "#FFFFFF",
  chatBg: "#E5DDD5",
  readTick: "#53BDEB",
  grayTick: "#92A4AC",
  timestamp: "#667781",
  messageText: "#111B21",
  metaText: "#667781",
  inputBg: "#FFFFFF",
  inputBorder: "#E9EDEF",
  emojiBar: "#F0F2F5",
} as const;

// ─── Tick icons ───────────────────────────────────────────────────────────────

function SingleTick({ color }: { color: string }) {
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" aria-hidden="true">
      <path
        d="M1.5 5.5L5.5 9.5L14.5 1.5"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function DoubleTick({ color }: { color: string }) {
  return (
    <svg width="18" height="11" viewBox="0 0 18 11" aria-hidden="true">
      {/* First tick (slightly left) */}
      <path
        d="M1 5.5L4.5 9L10.5 2"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Second tick (offset right) */}
      <path
        d="M6 5.5L9.5 9L15.5 2"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function TickIcon({ status }: { status?: "sent" | "delivered" | "read" }) {
  if (!status) return null;
  if (status === "sent") return <SingleTick color={WA.grayTick} />;
  if (status === "delivered") return <DoubleTick color={WA.grayTick} />;
  return <DoubleTick color={WA.readTick} />;
}

// ─── Typing indicator (3 bouncing dots) ──────────────────────────────────────

function TypingIndicator() {
  return (
    <div
      className="self-start flex items-end gap-1 mb-1"
      aria-label="Contact is typing"
      aria-live="polite"
    >
      {/* Incoming tail */}
      <svg
        width="8"
        height="13"
        viewBox="0 0 8 13"
        className="shrink-0 mb-0.5"
        aria-hidden="true"
      >
        <path d="M8 0 L0 0 L8 13 Z" fill={WA.incoming} />
      </svg>
      <div
        className="flex items-center gap-1 px-4 py-3 rounded-b-2xl rounded-tr-2xl"
        style={{ background: WA.incoming, minWidth: 60 }}
      >
        <span className="typing-dot w-2 h-2 rounded-full bg-[#92A4AC]" style={{ animationDelay: "0ms" }} />
        <span className="typing-dot w-2 h-2 rounded-full bg-[#92A4AC]" style={{ animationDelay: "160ms" }} />
        <span className="typing-dot w-2 h-2 rounded-full bg-[#92A4AC]" style={{ animationDelay: "320ms" }} />
      </div>
    </div>
  );
}

// ─── Single message bubble ────────────────────────────────────────────────────

function MessageBubble({ message }: { message: WhatsAppMessage }) {
  const isOut = message.direction === "out";

  return (
    <div className={`flex items-end gap-0 mb-1 ${isOut ? "flex-row-reverse" : "flex-row"}`}>
      {/* SVG tail */}
      {isOut ? (
        <svg
          width="8"
          height="13"
          viewBox="0 0 8 13"
          className="shrink-0 mb-0.5"
          aria-hidden="true"
        >
          <path d="M0 0 L8 0 L0 13 Z" fill={WA.outgoing} />
        </svg>
      ) : (
        <svg
          width="8"
          height="13"
          viewBox="0 0 8 13"
          className="shrink-0 mb-0.5"
          aria-hidden="true"
        >
          <path d="M8 0 L0 0 L8 13 Z" fill={WA.incoming} />
        </svg>
      )}

      {/* Bubble */}
      <div
        className={[
          "relative max-w-[80%] px-3 py-2",
          isOut ? "rounded-b-2xl rounded-tl-2xl" : "rounded-b-2xl rounded-tr-2xl",
        ].join(" ")}
        style={{
          background: isOut ? WA.outgoing : WA.incoming,
          boxShadow: "0 1px 2px rgba(0,0,0,0.13)",
        }}
      >
        <p
          className="text-sm leading-snug whitespace-pre-wrap break-words"
          style={{ color: WA.messageText }}
        >
          {message.text}
        </p>

        {/* Timestamp + ticks row */}
        <div className="flex items-center justify-end gap-1 mt-0.5 -mb-0.5">
          <span className="text-[10px] leading-none" style={{ color: WA.timestamp }}>
            {message.time}
          </span>
          {isOut && <TickIcon status={message.status} />}
        </div>
      </div>
    </div>
  );
}

// ─── WhatsApp Header ──────────────────────────────────────────────────────────

function WAHeader({ name, avatar }: { name: string; avatar: string }) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 shrink-0"
      style={{ background: WA.header }}
    >
      {/* Back arrow */}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {/* Avatar */}
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-base font-bold"
        style={{ background: "#DFE5E7", color: WA.header }}
        aria-hidden="true"
      >
        {avatar}
      </div>

      {/* Name + status */}
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-semibold leading-tight truncate">{name}</p>
        <p className="text-white/70 text-xs leading-tight">online</p>
      </div>

      {/* Action icons */}
      <div className="flex items-center gap-4">
        {/* Video call */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M15 10l4.553-2.277A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {/* Phone call */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8a19.79 19.79 0 01-3.07-8.68A2 2 0 012 .99h3a2 2 0 012 1.72c.127.96.36 1.9.7 2.81a2 2 0 01-.45 2.11l-1.27 1.27a16 16 0 006.29 6.29l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.573 2.81.7a2 2 0 011.72 2.02z" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {/* Three-dot menu */}
        <svg width="4" height="18" viewBox="0 0 4 18" fill="white" aria-hidden="true">
          <circle cx="2" cy="2" r="1.5" />
          <circle cx="2" cy="9" r="1.5" />
          <circle cx="2" cy="16" r="1.5" />
        </svg>
      </div>
    </div>
  );
}

// ─── WhatsApp Input Bar ───────────────────────────────────────────────────────

function WAInputBar() {
  return (
    <div
      className="shrink-0 flex items-center gap-2 px-2 py-2"
      style={{ background: WA.emojiBar }}
    >
      {/* Text input */}
      <div
        className="flex-1 flex items-center gap-2 px-4 py-2 rounded-full text-xs"
        style={{ background: WA.inputBg, border: `1px solid ${WA.inputBorder}`, color: WA.timestamp }}
      >
        {/* Emoji icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="#92A4AC" strokeWidth="1.8" />
          <path d="M8 13s1.5 2 4 2 4-2 4-2" stroke="#92A4AC" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="9" cy="10" r="1" fill="#92A4AC" />
          <circle cx="15" cy="10" r="1" fill="#92A4AC" />
        </svg>
        <span>Type a message</span>
        {/* Attachment icon */}
        <svg className="ml-auto" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="#92A4AC" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Mic / Send button */}
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
        style={{ background: WA.header }}
        aria-hidden="true"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M12 2a3 3 0 013 3v7a3 3 0 01-6 0V5a3 3 0 013-3z" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v3M8 22h8" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

// ─── Chat wallpaper (subtle cross/plus SVG pattern) ──────────────────────────

const WALLPAPER_STYLE: React.CSSProperties = {
  backgroundColor: WA.chatBg,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M10 0h4v4h4v4h4v4h-4v4h-4v4h-4v-4H6v-4H2v-4h4V4h4V0z' fill='%23b8a99a' fill-opacity='0.18'/%3E%3C/svg%3E")`,
};

// ─── Main Component ───────────────────────────────────────────────────────────

export function WhatsAppMockup({
  messages,
  contactName = "CompliLet AI",
  contactAvatar = "C",
  animated = true,
  className = "",
}: WhatsAppMockupProps) {
  const [visibleCount, setVisibleCount] = useState(animated ? 0 : messages.length);
  const [showTyping, setShowTyping] = useState(false);
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const animatingRef = useRef(false);

  // ── IntersectionObserver: start animation on first scroll into view ──────
  useEffect(() => {
    if (!animated) return;
    const el = containerRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !inView) {
          setInView(true);
        }
      },
      { threshold: 0.3 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [animated, inView]);

  // ── Message reveal sequence ───────────────────────────────────────────────
  useEffect(() => {
    if (!inView || !animated) return;
    if (animatingRef.current) return;
    if (visibleCount >= messages.length) return;

    animatingRef.current = true;

    const reveal = (index: number) => {
      if (index >= messages.length) {
        animatingRef.current = false;
        return;
      }

      const msg = messages[index];
      const isAgentMessage = msg.direction === "in"; // incoming = tenant/agent reply
      const initialDelay = index === 0 ? 600 : 0;

      setTimeout(() => {
        if (isAgentMessage) {
          // Show typing indicator first
          setShowTyping(true);
          setTimeout(() => {
            setShowTyping(false);
            setVisibleCount(index + 1);
            // Schedule next message
            setTimeout(() => reveal(index + 1), 400);
          }, 1400);
        } else {
          setVisibleCount(index + 1);
          setTimeout(() => reveal(index + 1), 500);
        }
      }, initialDelay);
    };

    reveal(visibleCount);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView]);

  // ── Auto-scroll chat body to bottom as messages appear ───────────────────
  useEffect(() => {
    const el = chatBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleCount, showTyping]);

  const visibleMessages = messages.slice(0, visibleCount);

  // ─── Rendered chat screen (shared by phone frame and mobile-only view) ───
  const ChatScreen = (
    <div className="flex flex-col" style={{ height: "100%" }}>
      {/* Header */}
      <WAHeader name={contactName} avatar={contactAvatar} />

      {/* Chat body */}
      <div
        ref={chatBodyRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 flex flex-col justify-end"
        style={WALLPAPER_STYLE}
        role="log"
        aria-label="WhatsApp conversation"
        aria-live="polite"
      >
        <div className="flex flex-col gap-0.5">
          {visibleMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {showTyping && <TypingIndicator />}
        </div>
      </div>

      {/* Input bar */}
      <WAInputBar />
    </div>
  );

  return (
    <div ref={containerRef} className={className} aria-label="WhatsApp conversation mockup">
      {/* ── Desktop: full iPhone frame ─────────────────────────────────── */}
      <div
        className="hidden md:block mx-auto"
        style={{ width: 320 }}
        aria-hidden="false"
      >
        {/* Phone outer shell */}
        <div
          style={{
            background: "linear-gradient(145deg, #2a2a2a 0%, #1a1a1a 40%, #111 100%)",
            borderRadius: 48,
            padding: "10px 10px 14px 10px",
            boxShadow:
              "0 40px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08), inset 0 0 0 1px rgba(255,255,255,0.04)",
            position: "relative",
          }}
        >
          {/* Side buttons — volume up/down */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: -3,
              top: 110,
              width: 3,
              height: 32,
              background: "#2a2a2a",
              borderRadius: "3px 0 0 3px",
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: -3,
              top: 152,
              width: 3,
              height: 32,
              background: "#2a2a2a",
              borderRadius: "3px 0 0 3px",
            }}
          />
          {/* Side button — power */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              right: -3,
              top: 130,
              width: 3,
              height: 48,
              background: "#2a2a2a",
              borderRadius: "0 3px 3px 0",
            }}
          />

          {/* Screen */}
          <div
            style={{
              borderRadius: 38,
              overflow: "hidden",
              height: 640,
              background: "#000",
              position: "relative",
            }}
          >
            {/* Dynamic Island */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 10,
                left: "50%",
                transform: "translateX(-50%)",
                width: 118,
                height: 34,
                background: "#000",
                borderRadius: 20,
                zIndex: 10,
              }}
            />

            {/* Status bar spacer (underneath Dynamic Island) */}
            <div style={{ height: 54, background: WA.header, flexShrink: 0 }} />

            {/* WhatsApp content fills the remaining screen space */}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
              {ChatScreen}
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile: chat view only (no phone chrome) ──────────────────── */}
      <div
        className="md:hidden rounded-2xl overflow-hidden"
        style={{
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          height: 480,
        }}
      >
        {ChatScreen}
      </div>
    </div>
  );
}

// ─── Example conversation data ────────────────────────────────────────────────
// A realistic 9-message tenant screening exchange showing CompliLet's AI
// guiding a tenant through a Right to Rent + affordability check.

export const SCREENING_CONVERSATION: WhatsAppMessage[] = [
  {
    id: "1",
    direction: "out",
    text: "Hi! I'm CompliLet AI 👋 I've been asked by your prospective landlord to complete a quick tenant screening. It takes around 3 minutes. Ready to start?",
    time: "10:02",
    status: "read",
  },
  {
    id: "2",
    direction: "in",
    text: "Yes, ready!",
    time: "10:03",
  },
  {
    id: "3",
    direction: "out",
    text: "Great! First, Right to Rent. Are you a British/Irish citizen, or do you have a valid visa/share code? 🇬🇧",
    time: "10:03",
    status: "read",
  },
  {
    id: "4",
    direction: "in",
    text: "British citizen — I have a passport.",
    time: "10:04",
  },
  {
    id: "5",
    direction: "out",
    text: "✅ Noted. For affordability — what is your annual gross income? (e.g. £32,000) The property rent is £1,200/month.",
    time: "10:04",
    status: "read",
  },
  {
    id: "6",
    direction: "in",
    text: "£38,500 per year — I can send payslips if needed.",
    time: "10:05",
  },
  {
    id: "7",
    direction: "out",
    text: "✅ Income verified (ratio: 2.67×). Finally, any CCJs or IVAs in the last 3 years?",
    time: "10:05",
    status: "read",
  },
  {
    id: "8",
    direction: "in",
    text: "No, clean credit history.",
    time: "10:06",
  },
  {
    id: "9",
    direction: "out",
    text: "All done! 🎉 Your screening report has been sent to the landlord. You should hear back within 24 hours. Good luck! 🏠",
    time: "10:06",
    status: "delivered",
  },
];
