"use client";

import { motion } from "framer-motion";
import { PricingCard } from "@/components/ui/PricingCard";
import { PRICING_TIERS } from "@/lib/constants";

// ─── Animation ────────────────────────────────────────────────────────────────

type Bezier = [number, number, number, number];
const EASE_OUT: Bezier = [0.25, 0.46, 0.45, 0.94];

// ─── Universal inclusions strip ───────────────────────────────────────────────

const UNIVERSAL_INCLUDES = [
  "GDPR compliance",
  "Encrypted document storage",
  "Ombudsman-ready audit trail",
  "Human escalation support",
];

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-teal"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Pricing() {
  return (
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className="bg-cream"
    >
      {/* ── Section header ───────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-20 lg:pt-24 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.55, ease: EASE_OUT }}
          className="text-center"
        >
          <p className="font-body font-semibold text-sm tracking-widest uppercase text-teal mb-3">
            Pricing
          </p>
          <h2
            id="pricing-heading"
            className="font-display font-bold text-3xl sm:text-4xl lg:text-5xl text-navy leading-tight tracking-[-0.02em]"
          >
            Simple, Transparent Pricing
          </h2>
          <p className="mt-4 font-body text-lg text-muted-gray max-w-md mx-auto leading-relaxed">
            No hidden fees. No contracts. Cancel anytime.
          </p>
        </motion.div>
      </div>

      {/* ── Card grid — desktop ───────────────────────────────────────────── */}
      {/*
        Hidden on xs (< sm). We use a snap-scroll row for xs instead.
        The grid uses the existing PricingGrid layout logic but with
        motion stagger applied per card so scroll-triggering works.
      */}
      <div className="hidden sm:block max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div
          className={[
            "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
            "gap-6 lg:gap-8",
            // Extra top padding so the "Most Popular" chip clears the grid edge
            "pt-8",
            "pb-10 sm:pb-12",
          ].join(" ")}
        >
          {PRICING_TIERS.map((tier, i) => (
            <motion.div
              key={tier.id}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.45, ease: EASE_OUT, delay: i * 0.07 }}
            >
              <PricingCard {...tier} />
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── Card row — mobile horizontal snap scroll ─────────────────────── */}
      {/*
        Visible only on xs (< sm). Cards are 280px wide with 16px gap,
        padded so the first card aligns with the page margin and the
        overflow hint shows the next card.
      */}
      <div
        className={[
          "sm:hidden",
          "flex gap-4 overflow-x-auto",
          "snap-x snap-mandatory",
          // Side padding: first card starts at 16px (page margin), last card
          // gets trailing space so it can fully snap into view
          "px-4",
          // Scrollbar hidden for cleaner look
          "scrollbar-none",
          "[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
          "py-8", // space for "Most Popular" chip top + card shadow bottom
        ].join(" ")}
        role="list"
        aria-label="Pricing tiers"
      >
        {PRICING_TIERS.map((tier) => (
          <div
            key={tier.id}
            className="snap-center shrink-0 w-[280px]"
            role="listitem"
          >
            <PricingCard {...tier} />
          </div>
        ))}
        {/* Trailing spacer so the last card fully snaps */}
        <div className="shrink-0 w-4" aria-hidden="true" />
      </div>

      {/* ── Universal inclusions strip ────────────────────────────────────── */}
      <div className="border-t border-teal-light">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.5, ease: EASE_OUT }}
            className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6"
          >
            {/* Label */}
            <p className="font-display font-semibold text-sm text-navy whitespace-nowrap shrink-0">
              All plans include:
            </p>

            {/* Divider — desktop only */}
            <div
              className="hidden sm:block self-stretch w-px bg-teal-light shrink-0"
              aria-hidden="true"
            />

            {/* Items */}
            <ul className="flex flex-wrap gap-x-6 gap-y-2" role="list">
              {UNIVERSAL_INCLUDES.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-1.5 font-body text-sm text-dark-text/80"
                >
                  <CheckIcon />
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
