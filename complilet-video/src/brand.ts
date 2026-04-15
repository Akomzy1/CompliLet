// CompliLet brand constants — mirrors CompliLet_claude.md

export const COLORS = {
  navy:        "#0F2B46",
  teal:        "#0D9488",
  cream:       "#FDF8F0",
  lightTeal:   "#E0F5F3",
  dark:        "#111827",
  muted:       "#6B7280",
  whatsapp:    "#25D366",
  alertRed:    "#DC2626",
  successGreen:"#16A34A",
  white:       "#FFFFFF",
  // WhatsApp UI
  waBubbleOut: "#DCF8C6",  // outgoing (landlord/agent)
  waBubbleIn:  "#FFFFFF",  // incoming (tenant)
  waBg:        "#ECE5DD",  // WhatsApp chat background
  waHeader:    "#075E54",  // WhatsApp header
} as const;

export const FONTS = {
  display: "'Clash Display', 'Satoshi', 'Inter', sans-serif",
  body:    "'General Sans', 'Outfit', 'Inter', sans-serif",
  mono:    "'JetBrains Mono', monospace",
} as const;

export const FPS = 30;

// Scene durations in frames
export const SCENE = {
  INTRO:       4 * FPS,   // 4s  — logo + tagline
  PROBLEM:     5 * FPS,   // 5s  — stats / pain point
  SOLUTION:    4 * FPS,   // 4s  — "all via WhatsApp"
  SCREENING:   10 * FPS,  // 10s — animated screening conversation
  COMPLIANCE:  8 * FPS,   // 8s  — compliance autopilot
  RENT_REVIEW: 8 * FPS,   // 8s  — Section 13 rent review
  FEATURES:    6 * FPS,   // 6s  — feature grid
  CTA:         5 * FPS,   // 5s  — call to action
} as const;

export const TOTAL_FRAMES =
  SCENE.INTRO +
  SCENE.PROBLEM +
  SCENE.SOLUTION +
  SCENE.SCREENING +
  SCENE.COMPLIANCE +
  SCENE.RENT_REVIEW +
  SCENE.FEATURES +
  SCENE.CTA;

// Cumulative start frames for each scene
export const START = {
  INTRO:       0,
  PROBLEM:     SCENE.INTRO,
  SOLUTION:    SCENE.INTRO + SCENE.PROBLEM,
  SCREENING:   SCENE.INTRO + SCENE.PROBLEM + SCENE.SOLUTION,
  COMPLIANCE:  SCENE.INTRO + SCENE.PROBLEM + SCENE.SOLUTION + SCENE.SCREENING,
  RENT_REVIEW: SCENE.INTRO + SCENE.PROBLEM + SCENE.SOLUTION + SCENE.SCREENING + SCENE.COMPLIANCE,
  FEATURES:    SCENE.INTRO + SCENE.PROBLEM + SCENE.SOLUTION + SCENE.SCREENING + SCENE.COMPLIANCE + SCENE.RENT_REVIEW,
  CTA:         SCENE.INTRO + SCENE.PROBLEM + SCENE.SOLUTION + SCENE.SCREENING + SCENE.COMPLIANCE + SCENE.RENT_REVIEW + SCENE.FEATURES,
} as const;
