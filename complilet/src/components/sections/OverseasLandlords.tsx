"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { COMPANY } from "@/lib/constants";

// ─── Animation helpers ────────────────────────────────────────────────────────

type Bezier = [number, number, number, number];
const EASE_OUT: Bezier = [0.25, 0.46, 0.45, 0.94];

function fadeUp(delay = 0) {
  return {
    initial: { opacity: 0, y: 28 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-60px" } as const,
    transition: { duration: 0.55, ease: EASE_OUT, delay },
  };
}

// ─── Icons — inline SVGs on navy background (white/cream stroke) ──────────────

function IconClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconPassport() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <circle cx="12" cy="11" r="3" />
      <path d="M8 18h8M8 15h2M14 15h2" />
    </svg>
  );
}

function IconCamera() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function IconKey() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6" />
      <path d="M15.5 7.5l3 3L22 7l-3-3" />
    </svg>
  );
}

function IconPound() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.5 16.5h5M9.5 13h4.5M11 13V9.5a2.5 2.5 0 015 0" />
    </svg>
  );
}

// ─── Pain-point items ─────────────────────────────────────────────────────────

interface PainPoint {
  icon: React.FC;
  heading: string;
  body: string;
}

const PAIN_POINTS: PainPoint[] = [
  {
    icon: IconClock,
    heading: "2am Emergency? Handled.",
    body: "Maintenance triage responds instantly, regardless of your timezone. You get a full summary when you wake up.",
  },
  {
    icon: IconPassport,
    heading: "NRL Tax Sorted.",
    body: "Guidance on NRL1 applications, quarterly filing reminders, and self-assessment deadline alerts.",
  },
  {
    icon: IconCamera,
    heading: "Inspections Without Flying Back.",
    body: "Tenants photograph each room. AI compares against inventory. Condition report delivered on WhatsApp.",
  },
  {
    icon: IconKey,
    heading: "No-Contact Key Handover.",
    body: "Smart lock codes, key safes, or a local inspector — we coordinate everything via WhatsApp.",
  },
  {
    icon: IconPound,
    heading: "Save 80–90%.",
    body: "Letting agents charge 10–15% of rent. CompliLet costs £29.99/month regardless of your rent level.",
  },
];

// ─── World map SVG ────────────────────────────────────────────────────────────
// ViewBox: 600 × 320
// Simplified continent shapes at low opacity — decorative, not geographic.
// Cities: London → New York, Dubai, Hong Kong, Singapore, Sydney

// City pin positions (cx, cy on the 600×320 viewBox)
const CITIES = {
  london:    { cx: 252, cy: 95,  label: "London 🏠",    anchor: "middle",  dy: -10 },
  newYork:   { cx: 105, cy: 120, label: "New York",     anchor: "middle",  dy: -10 },
  dubai:     { cx: 345, cy: 130, label: "Dubai",        anchor: "start",   dy: -10 },
  hongKong:  { cx: 455, cy: 145, label: "Hong Kong",    anchor: "middle",  dy: -10 },
  singapore: { cx: 450, cy: 185, label: "Singapore",    anchor: "middle",  dy:  14 },
  sydney:    { cx: 490, cy: 268, label: "Sydney",       anchor: "middle",  dy:  14 },
} as const;

// Arc paths (quadratic bezier, arching slightly above the direct line for visual elegance)
const CONNECTION_PATHS = [
  {
    id: "ny",
    d: `M ${CITIES.london.cx},${CITIES.london.cy} Q 178,48 ${CITIES.newYork.cx},${CITIES.newYork.cy}`,
    delay: 0.3,
  },
  {
    id: "dubai",
    d: `M ${CITIES.london.cx},${CITIES.london.cy} Q 298,62 ${CITIES.dubai.cx},${CITIES.dubai.cy}`,
    delay: 0.6,
  },
  {
    id: "hk",
    d: `M ${CITIES.london.cx},${CITIES.london.cy} Q 355,28 ${CITIES.hongKong.cx},${CITIES.hongKong.cy}`,
    delay: 0.9,
  },
  {
    id: "sg",
    d: `M ${CITIES.london.cx},${CITIES.london.cy} Q 360,32 ${CITIES.singapore.cx},${CITIES.singapore.cy}`,
    delay: 1.1,
  },
  {
    id: "syd",
    d: `M ${CITIES.london.cx},${CITIES.london.cy} Q 380,18 ${CITIES.sydney.cx},${CITIES.sydney.cy}`,
    delay: 1.3,
  },
];

// Very simplified continent fills — outline only, very low opacity
const CONTINENTS = `
  M 60,75 L 125,58 L 170,68 L 192,95 L 200,130 L 188,160
  L 162,178 L 132,182 L 108,168 L 75,148 L 58,118 Z

  M 118,182 L 158,182 L 172,210 L 168,258 L 148,280
  L 122,262 L 112,228 Z

  M 234,65 L 278,55 L 308,62 L 318,78 L 300,94
  L 268,98 L 245,92 L 235,78 Z

  M 250,98 L 308,94 L 330,118 L 340,158 L 330,198
  L 302,218 L 268,212 L 252,188 L 246,152 L 250,118 Z

  M 308,62 L 408,58 L 465,75 L 490,98 L 495,128
  L 468,148 L 430,152 L 388,140 L 348,120 L 328,95 Z

  M 430,152 L 480,155 L 495,180 L 488,205
  L 460,210 L 436,194 L 428,172 Z

  M 456,248 L 518,242 L 538,258 L 534,290
  L 508,305 L 470,298 L 450,274 Z
`;

function WorldMap() {
  return (
    <div className="w-full" aria-hidden="true">
      <svg
        viewBox="0 0 600 320"
        className="w-full h-auto"
        role="img"
        aria-label="World map showing CompliLet coverage from London to major overseas cities"
      >
        {/* ── Lat/long grid (very subtle) ───────────────────────────────── */}
        <defs>
          <pattern id="grid" width="60" height="40" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="600" height="320" fill="url(#grid)" />

        {/* ── Continent fills ───────────────────────────────────────────── */}
        <path
          d={CONTINENTS}
          fillRule="evenodd"
          fill="rgba(255,255,255,0.07)"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />

        {/* ── Animated connection arcs ──────────────────────────────────── */}
        {CONNECTION_PATHS.map((arc) => (
          <motion.path
            key={arc.id}
            d={arc.d}
            fill="none"
            stroke="#25D366"
            strokeWidth="1.6"
            strokeDasharray="5 4"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            whileInView={{ pathLength: 1, opacity: 0.85 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{
              pathLength: { duration: 1.4, ease: "easeInOut", delay: arc.delay },
              opacity: { duration: 0.3, delay: arc.delay },
            }}
          />
        ))}

        {/* ── Destination city dots (appear after their arc) ────────────── */}
        {/* Map arc IDs → CITIES keys to avoid cross-type comparisons */}
        {CONNECTION_PATHS.map((arc) => {
          const ARC_TO_CITY: Record<string, keyof typeof CITIES> = {
            ny: "newYork",
            dubai: "dubai",
            hk: "hongKong",
            sg: "singapore",
            syd: "sydney",
          };
          const city = CITIES[ARC_TO_CITY[arc.id]];
          return (
            <motion.g
              key={`pin-${arc.id}`}
              initial={{ opacity: 0, scale: 0 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: arc.delay + 1.3, type: "spring", stiffness: 400 }}
            >
              <circle cx={city.cx} cy={city.cy} r="5" fill="#25D366" fillOpacity="0.25" />
              <circle cx={city.cx} cy={city.cy} r="3" fill="#25D366" />
              <text
                x={city.cx}
                y={city.cy + city.dy}
                textAnchor={city.anchor}
                fill="rgba(255,255,255,0.75)"
                fontSize="9"
                fontFamily="-apple-system, sans-serif"
                letterSpacing="0.3"
              >
                {city.label.replace(" 🏠", "")}
              </text>
            </motion.g>
          );
        })}

        {/* ── London pin — pulsing source ───────────────────────────────── */}
        <motion.circle
          cx={CITIES.london.cx}
          cy={CITIES.london.cy}
          r="10"
          fill="#25D366"
          fillOpacity="0"
          stroke="#25D366"
          strokeWidth="1.5"
          strokeOpacity="0.4"
          initial={{ scale: 1 }}
          animate={{ scale: [1, 1.8, 1] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut", delay: 2 }}
        />
        <circle cx={CITIES.london.cx} cy={CITIES.london.cy} r="5.5" fill="#25D366" fillOpacity="0.3" />
        <circle cx={CITIES.london.cx} cy={CITIES.london.cy} r="3.5" fill="#25D366" />
        {/* House pin marker above London dot */}
        <text
          x={CITIES.london.cx}
          y={CITIES.london.cy - 12}
          textAnchor="middle"
          fill="white"
          fontSize="10"
          fontFamily="-apple-system, sans-serif"
          fontWeight="600"
          letterSpacing="0.3"
        >
          Your UK property
        </text>

        {/* ── WhatsApp icon watermark (bottom-right corner) ─────────────── */}
        <text
          x="574"
          y="314"
          textAnchor="end"
          fill="rgba(255,255,255,0.18)"
          fontSize="9"
          fontFamily="-apple-system, sans-serif"
        >
          Managed via WhatsApp
        </text>
      </svg>
    </div>
  );
}

// ─── Pain point row ───────────────────────────────────────────────────────────

function PainPointRow({
  item,
  delay,
}: {
  item: PainPoint;
  delay: number;
}) {
  const Icon = item.icon;

  return (
    <motion.div
      {...fadeUp(delay)}
      className="flex items-start gap-4"
    >
      {/* Icon circle */}
      <div
        className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-teal"
        style={{ background: "rgba(13,148,136,0.18)", border: "1px solid rgba(13,148,136,0.3)" }}
      >
        <span className="w-5 h-5 flex items-center justify-center">
          <Icon />
        </span>
      </div>

      {/* Text */}
      <div>
        <p className="font-display font-semibold text-base text-white leading-snug mb-0.5">
          {item.heading}
        </p>
        <p className="font-body text-sm leading-relaxed" style={{ color: "rgba(253,248,240,0.7)" }}>
          {item.body}
        </p>
      </div>
    </motion.div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OverseasLandlords() {
  return (
    <section
      id="overseas"
      aria-labelledby="overseas-heading"
      className="bg-navy overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 lg:py-24">

        {/* ── Section header ──────────────────────────────────────────────── */}
        <motion.div {...fadeUp(0)} className="mb-14 lg:mb-16">
          {/* Eyebrow */}
          <p className="font-body font-semibold text-sm tracking-widest uppercase text-teal mb-3">
            For overseas landlords
          </p>
          <h2
            id="overseas-heading"
            className="font-display font-bold text-3xl sm:text-4xl lg:text-5xl text-white leading-tight tracking-[-0.02em] max-w-2xl"
          >
            Managing UK Property<br className="hidden sm:block" /> from Abroad?
          </h2>
          <p className="mt-4 font-body text-lg max-w-xl leading-relaxed" style={{ color: "rgba(224,245,243,0.8)" }}>
            You don&apos;t need a letting agent charging 12%. CompliLet gives you
            24/7 AI property management for{" "}
            <strong className="text-white font-semibold">£29.99/month</strong>.
          </p>
        </motion.div>

        {/* ── Two-column layout ────────────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row gap-12 lg:gap-16 items-start">

          {/* ── LEFT: Pain points ──────────────────────────────────────── */}
          <div className="flex-1 flex flex-col gap-7">
            {PAIN_POINTS.map((item, i) => (
              <PainPointRow key={item.heading} item={item} delay={0.1 + i * 0.1} />
            ))}
          </div>

          {/* ── RIGHT: World map ────────────────────────────────────────── */}
          <div className="flex-1 w-full">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.65, ease: EASE_OUT, delay: 0.2 }}
              className={[
                "relative rounded-2xl overflow-hidden",
                "p-4 sm:p-6",
              ].join(" ")}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {/* Map legend */}
              <div className="flex items-center gap-4 mb-4">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0 border-t-2 border-dashed border-[#25D366] inline-block" style={{ width: 18 }} />
                  <span className="font-body text-xs" style={{ color: "rgba(253,248,240,0.55)" }}>
                    Managed remotely via WhatsApp
                  </span>
                </div>
              </div>

              <WorldMap />
            </motion.div>
          </div>
        </div>

        {/* ── CTA ─────────────────────────────────────────────────────────── */}
        <motion.div
          {...fadeUp(0.3)}
          className="mt-16 flex flex-col items-center text-center gap-5"
        >
          {/* Social proof line */}
          <p className="font-body text-sm" style={{ color: "rgba(224,245,243,0.65)" }}>
            Join{" "}
            <span className="font-semibold text-white">100+ overseas landlords</span>{" "}
            managing smarter
          </p>

          {/* Divider */}
          <div className="w-16 h-px" style={{ background: "rgba(13,148,136,0.4)" }} />

          <Button
            variant="whatsapp"
            href={COMPANY.whatsappLink}
            size="lg"
            external
            aria-label="Start managing your UK property on WhatsApp"
          >
            Start on WhatsApp →
          </Button>

          <p className="font-body text-sm" style={{ color: "rgba(224,245,243,0.5)" }}>
            £29.99/month per property · Cancel anytime
          </p>
        </motion.div>
      </div>
    </section>
  );
}
