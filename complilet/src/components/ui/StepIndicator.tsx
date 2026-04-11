"use client";

import { motion } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StepIndicatorProps {
  step: number;
  label: string;
  description?: string;
  /**
   * When true, this is the first step in the row — left connector line is hidden.
   * @default false
   */
  isFirst?: boolean;
  /**
   * When true, this is the last step in the row — right connector line is hidden.
   * @default false
   */
  isLast?: boolean;
  /** Highlight this step as the current/active one */
  isActive?: boolean;
  className?: string;
  /**
   * Controls animation reveal delay (stagger offset in seconds).
   * Parent should pass `index * 0.08` for a staggered entrance.
   */
  delay?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────
//
// Layout strategy: the step takes up flex-1 so adjacent steps naturally fill
// equal horizontal space. Each step renders:
//   [left line] — [circle] — [right line]
//   (hidden on isFirst)         (hidden on isLast)
//
// On mobile the connector lines are hidden; steps stack vertically with a
// vertical dashed line instead (rendered via ::before on the wrapper).

export function StepIndicator({
  step,
  label,
  description,
  isFirst = false,
  isLast = false,
  isActive = false,
  className = "",
  delay = 0,
}: StepIndicatorProps) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      {/* ── Horizontal connector row (circle + flanking lines) ───────── */}
      <div className="w-full flex items-center">
        {/* Left connector line — hidden for first step and on mobile */}
        <div
          aria-hidden="true"
          className={[
            "hidden sm:block flex-1 h-px",
            isFirst ? "invisible" : "bg-teal-light",
          ].join(" ")}
        />

        {/* Step circle */}
        <motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{
            type: "spring",
            stiffness: 380,
            damping: 22,
            delay,
          }}
          className={[
            // Size — 48×48 meets 44px touch-target minimum
            "w-12 h-12 rounded-full shrink-0",
            "flex items-center justify-center",
            "font-display font-bold text-xl select-none",
            // Active / default colour
            isActive
              ? "bg-teal text-white ring-4 ring-teal-light shadow-trust"
              : "bg-teal text-white shadow-card",
          ].join(" ")}
          aria-label={`Step ${step}: ${label}`}
        >
          {step}
        </motion.div>

        {/* Right connector line — hidden for last step and on mobile */}
        <div
          aria-hidden="true"
          className={[
            "hidden sm:block flex-1 h-px",
            isLast ? "invisible" : "bg-teal-light",
          ].join(" ")}
        />
      </div>

      {/* ── Label + description ──────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.35, ease: "easeOut", delay: delay + 0.08 }}
        className="mt-4 flex flex-col items-center text-center px-2"
      >
        <p
          className={[
            "font-display font-semibold text-sm leading-snug",
            isActive ? "text-teal" : "text-navy",
          ].join(" ")}
        >
          {label}
        </p>

        {description && (
          <p className="mt-1.5 font-body text-xs text-muted-gray leading-relaxed max-w-[9rem]">
            {description}
          </p>
        )}
      </motion.div>
    </div>
  );
}

// ─── Step row container ───────────────────────────────────────────────────────
// Wraps a set of StepIndicators in the correct flex layout with stagger delays.

interface StepRowProps {
  steps: Array<{
    label: string;
    description?: string;
  }>;
  /** Index of the currently active step (0-based). -1 = none active. */
  activeStep?: number;
  className?: string;
}

export function StepRow({
  steps,
  activeStep = -1,
  className = "",
}: StepRowProps) {
  return (
    <div
      className={[
        // Mobile: vertical stack; Desktop: horizontal flex
        "flex flex-col sm:flex-row sm:items-start",
        "gap-8 sm:gap-0",
        className,
      ].join(" ")}
    >
      {steps.map((s, i) => (
        <StepIndicator
          key={s.label}
          step={i + 1}
          label={s.label}
          description={s.description}
          isFirst={i === 0}
          isLast={i === steps.length - 1}
          isActive={i === activeStep}
          delay={i * 0.07}
          className="flex-1"
        />
      ))}
    </div>
  );
}
