"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { TrustBadgeRow } from "@/components/ui/Badge";
import {
  WhatsAppMockup,
  SCREENING_CONVERSATION,
} from "@/components/whatsapp/WhatsAppMockup";
import { COMPANY, TRUST_BADGES } from "@/lib/constants";

// ─── Animation helpers ────────────────────────────────────────────────────────

type Easing = [number, number, number, number];
const EASE_OUT: Easing = [0.25, 0.46, 0.45, 0.94];

function fadeUp(delay: number) {
  return {
    initial: { opacity: 0, y: 28 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.55, ease: EASE_OUT, delay },
  };
}

function fadeIn(delay: number) {
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.5, ease: "easeOut" as const, delay },
  };
}

// ─── Background style — navy + radial teal focal point + subtle dot grid ──────

const HERO_BG: React.CSSProperties = {
  background: "#0F2B46",
  backgroundImage: [
    // Warm teal glow at top-center — gives depth without being garish
    "radial-gradient(ellipse 90% 60% at 50% -10%, rgba(13,148,136,0.18) 0%, transparent 65%)",
    // Subtle dot grid at very low opacity
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Ccircle cx='18' cy='18' r='1.2' fill='%23ffffff' fill-opacity='0.04'/%3E%3C/svg%3E\")",
  ].join(", "),
};

// Decorative radial glow placed behind the phone mockup
const MOCKUP_GLOW: React.CSSProperties = {
  position: "absolute",
  inset: "-40px",
  background:
    "radial-gradient(ellipse 75% 80% at 50% 50%, rgba(37,211,102,0.12) 0%, rgba(13,148,136,0.06) 45%, transparent 70%)",
  pointerEvents: "none",
  zIndex: 0,
};

// ─── Trust badges — 3 shown in hero (most credibility-dense) ─────────────────

const HERO_BADGES = TRUST_BADGES.slice(0, 3);

// ─── Component ────────────────────────────────────────────────────────────────

export function Hero() {
  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════════
          Main hero section — navy, full-viewport-height on desktop
      ══════════════════════════════════════════════════════════════════════ */}
      <section
        id="hero"
        aria-label="Hero"
        className="relative flex flex-col overflow-hidden"
        style={HERO_BG}
      >
        {/* Inner layout container */}
        <div
          className={[
            "relative z-10",
            "flex-1 max-w-7xl mx-auto w-full",
            "px-4 sm:px-6 lg:px-8",
            // Generous padding: top accounts for sticky nav (~80px)
            "pt-28 pb-16 sm:pt-32 sm:pb-20 lg:pt-36 lg:pb-24",
            // Flex: stacked on mobile, side-by-side on desktop
            "flex flex-col lg:flex-row items-center gap-12 lg:gap-16",
          ].join(" ")}
        >
          {/* ── LEFT: Copy ──────────────────────────────────────────────── */}
          <div className="flex-1 flex flex-col items-start max-w-2xl lg:max-w-none">
            {/* Eyebrow */}
            <motion.p
              {...fadeIn(0.1)}
              className="mb-4 font-body font-semibold text-sm tracking-widest uppercase"
              style={{ color: "#0D9488" }}
            >
              No App. No Dashboard. Just WhatsApp.
            </motion.p>

            {/* H1 */}
            <motion.h1
              {...fadeUp(0.3)}
              className={[
                "font-display font-bold leading-tight",
                // 36px → 44px → 56px — Clash Display
                "text-[36px] sm:text-[44px] lg:text-[58px]",
                "text-white",
                // Tight tracking on large display text
                "tracking-[-0.02em]",
              ].join(" ")}
            >
              Stay Compliant.{" "}
              <br className="hidden sm:block" />
              Stay Letting.
            </motion.h1>

            {/* Subheading */}
            <motion.p
              {...fadeUp(0.5)}
              className="mt-6 font-body text-lg sm:text-xl leading-relaxed max-w-lg"
              style={{ color: "#E0F5F3", opacity: 0.9 }}
            >
              Screen tenants, chase references, track compliance, collect rent
              — all inside WhatsApp. Agent-grade property management for{" "}
              <strong className="font-semibold text-white">£4.99</strong>,
              not agent fees of £150/month.
            </motion.p>

            {/* CTA pair */}
            <motion.div
              {...fadeIn(0.7)}
              className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
            >
              <Button
                variant="whatsapp"
                href={COMPANY.whatsappLink}
                size="lg"
                external
                aria-label="Start using CompliLet on WhatsApp"
              >
                Start on WhatsApp →
              </Button>

              <Button
                variant="secondary"
                href="#how-it-works"
                size="lg"
                // Override teal-on-navy to cream-on-navy — better legibility
                className="!border-cream/40 !text-cream hover:!bg-cream/10 hover:!text-white hover:!border-cream/60"
              >
                See How It Works ↓
              </Button>
            </motion.div>

            {/* Trust badges */}
            <motion.div {...fadeIn(0.9)} className="mt-8">
              <TrustBadgeRow badges={HERO_BADGES} variant="navy" />
            </motion.div>
          </div>

          {/* ── RIGHT: WhatsApp phone mockup ────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: EASE_OUT, delay: 0.4 }}
            className="flex-1 flex justify-center lg:justify-end items-center w-full relative"
          >
            {/* Float + subtle 3D tilt wrapper */}
            <motion.div
              animate={{ y: [0, -12, 0] }}
              transition={{
                duration: 4.8,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 1.5,
              }}
              // Framer Motion's transform system: rotateY/rotateX applied via style
              // won't conflict with the y keyframe animation above
              style={{ rotateY: -6, rotateX: 1 }}
              className="relative"
            >
              {/* Glow ring behind the phone */}
              <div style={MOCKUP_GLOW} aria-hidden="true" />

              <div className="relative z-10">
                <WhatsAppMockup
                  messages={SCREENING_CONVERSATION}
                  animated
                  contactName="CompliLet AI"
                  contactAvatar="C"
                />
              </div>
            </motion.div>
          </motion.div>
        </div>

        {/* Decorative bottom fade — blends into the section below */}
        <div
          aria-hidden="true"
          className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none"
          style={{
            background:
              "linear-gradient(to bottom, transparent 0%, rgba(15,43,70,0.3) 100%)",
          }}
        />
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          Social proof bar — cream strip immediately below the hero
      ══════════════════════════════════════════════════════════════════════ */}
      <div
        className="bg-cream border-b border-teal-light"
        role="complementary"
        aria-label="Social proof"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-center font-body text-sm text-muted-gray"
          >
            Trusted by self-managing landlords across the UK
            <span
              className="mx-3 font-display font-bold text-teal text-base"
              aria-hidden="true"
            >
              ·
            </span>
            <span className="font-semibold text-navy">
              Screen a tenant for £4.99 — no app, no signup, just WhatsApp
            </span>
          </motion.p>
        </div>
      </div>
    </>
  );
}
