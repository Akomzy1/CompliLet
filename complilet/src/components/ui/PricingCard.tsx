"use client";

import { motion } from "framer-motion";
import { Button } from "./Button";
import type { PricingFeature } from "@/lib/constants";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PricingCardProps {
  id: string;
  name: string;
  price: number;
  currency?: "GBP" | "USD" | "EUR";
  intervalLabel: string;
  description: string;
  features: PricingFeature[];
  cta: string;
  ctaLink: string;
  /** Optional badge text above the name ("Most Popular", "Overseas") */
  badge?: string;
  /** When true: teal border, elevated shadow, prominent styling */
  highlighted?: boolean;
  className?: string;
  /** Stagger entrance delay (seconds) — passed from parent grid */
  delay?: number;
}

// ─── Currency symbols ─────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "£",
  USD: "$",
  EUR: "€",
};

// ─── Feature check / cross icons ─────────────────────────────────────────────

function IncludedIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0 mt-0.5"
    >
      <circle cx="12" cy="12" r="10" fill="#0D9488" fillOpacity="0.12" />
      <polyline
        points="8 12 11 15 16 9"
        stroke="#0D9488"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExcludedIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0 mt-0.5"
    >
      <circle cx="12" cy="12" r="10" fill="#6B7280" fillOpacity="0.10" />
      <line
        x1="15"
        y1="9"
        x2="9"
        y2="15"
        stroke="#6B7280"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="9"
        y1="9"
        x2="15"
        y2="15"
        stroke="#6B7280"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PricingCard({
  name,
  price,
  currency = "GBP",
  intervalLabel,
  description,
  features,
  cta,
  ctaLink,
  badge,
  highlighted = false,
  className = "",
  delay = 0,
}: PricingCardProps) {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.42, ease: "easeOut", delay }}
      // Subtle lift on hover
      whileHover={
        highlighted
          ? { y: -4, transition: { type: "spring", stiffness: 340, damping: 22 } }
          : { y: -3, transition: { type: "spring", stiffness: 340, damping: 22 } }
      }
      className={[
        // Shape
        "relative flex flex-col rounded-2xl",
        // Padding — a little extra on highlighted cards
        highlighted ? "p-7 sm:p-8" : "p-6 sm:p-7",
        // Border + shadow
        highlighted
          ? "border-2 border-teal shadow-trust bg-white"
          : "border border-teal-light shadow-card bg-cream",
        className,
      ].join(" ")}
    >
      {/* ── "Most Popular" chip — sits above the card top edge ────────── */}
      {highlighted && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 pointer-events-none">
          <span className="inline-block bg-teal text-white text-xs font-display font-semibold px-4 py-1.5 rounded-full shadow-card tracking-wide whitespace-nowrap">
            Most Popular
          </span>
        </div>
      )}

      {/* ── Non-highlighted badge (e.g. "Overseas") ──────────────────── */}
      {badge && !highlighted && (
        <span className="self-start mb-3 inline-block bg-teal-light text-teal text-xs font-display font-semibold px-3 py-1 rounded-full">
          {badge}
        </span>
      )}

      {/* ── Tier name ─────────────────────────────────────────────────── */}
      <h3
        className={[
          "font-display font-bold text-xl leading-tight",
          highlighted ? "text-teal mt-2" : "text-navy",
        ].join(" ")}
      >
        {name}
      </h3>

      {/* ── Price ─────────────────────────────────────────────────────── */}
      <div className="mt-4 flex items-end gap-1.5">
        <span className="font-display font-bold text-4xl text-navy leading-none">
          {symbol}
          {price.toFixed(2).replace(".00", "")}
        </span>
        <span className="font-body text-muted-gray text-sm leading-tight mb-0.5">
          {intervalLabel}
        </span>
      </div>

      {/* ── Description ───────────────────────────────────────────────── */}
      <p className="mt-3 font-body text-sm text-muted-gray leading-relaxed">
        {description}
      </p>

      {/* ── Feature list ──────────────────────────────────────────────── */}
      <ul className="mt-6 flex flex-col gap-3 flex-1" role="list">
        {features.map((feature) => (
          <li
            key={feature.text}
            className="flex items-start gap-3"
          >
            {feature.included ? <IncludedIcon /> : <ExcludedIcon />}
            <span
              className={[
                "font-body text-sm leading-snug",
                feature.included ? "text-dark-text" : "text-muted-gray",
              ].join(" ")}
            >
              {feature.text}
            </span>
          </li>
        ))}
      </ul>

      {/* ── CTA ───────────────────────────────────────────────────────── */}
      <div className="mt-8">
        <Button
          variant="whatsapp"
          href={ctaLink}
          size={highlighted ? "lg" : "md"}
          className="w-full justify-center"
        >
          {cta}
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Pricing grid ─────────────────────────────────────────────────────────────
// Convenience wrapper that renders the full 5-tier grid with correct layout.

import type { PricingTier } from "@/lib/constants";

interface PricingGridProps {
  tiers: PricingTier[];
  className?: string;
}

export function PricingGrid({ tiers, className = "" }: PricingGridProps) {
  return (
    <div
      className={[
        // 1 col → 2 col → 3 col responsive grid
        "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8",
        // On large screens, the highlighted card gets extra top margin
        // so the "Most Popular" chip clears the grid's top edge
        "pt-6",
        className,
      ].join(" ")}
    >
      {tiers.map((tier, i) => (
        <PricingCard
          key={tier.id}
          {...tier}
          delay={i * 0.07}
        />
      ))}
    </div>
  );
}
