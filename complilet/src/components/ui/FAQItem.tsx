"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ReactNode } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FAQItemProps {
  question: string;
  /** Can be a string or rich JSX (links, bold text, etc.) */
  answer: ReactNode;
  /** Uncontrolled default open state */
  defaultOpen?: boolean;
  /** Controlled open state — pair with onToggle */
  isOpen?: boolean;
  onToggle?: () => void;
  /** Visual style for different section backgrounds */
  variant?: "light" | "dark";
  className?: string;
  /** Unique ID for aria-controls / aria-labelledby */
  id?: string;
}

// ─── Chevron icon ─────────────────────────────────────────────────────────────

function ChevronDown() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ─── Animation variants ───────────────────────────────────────────────────────

// Cubic bezier values must be typed as a 4-tuple for Framer Motion's Easing type
type Bezier = [number, number, number, number];

const EASE_OUT: Bezier = [0.25, 0.46, 0.45, 0.94];
const EASE_IN: Bezier = [0.55, 0.055, 0.675, 0.19];

const ANSWER_VARIANTS = {
  open: {
    height: "auto" as const,
    opacity: 1,
    transition: { duration: 0.3, ease: EASE_OUT },
  },
  closed: {
    height: 0,
    opacity: 0,
    transition: { duration: 0.22, ease: EASE_IN },
  },
};

const CHEVRON_VARIANTS = {
  open: { rotate: 180, transition: { duration: 0.25, ease: "easeOut" as const } },
  closed: { rotate: 0, transition: { duration: 0.25, ease: "easeIn" as const } },
};

// ─── Component ────────────────────────────────────────────────────────────────

export function FAQItem({
  question,
  answer,
  defaultOpen = false,
  isOpen: isOpenProp,
  onToggle,
  variant = "light",
  className = "",
  id,
}: FAQItemProps) {
  const [isOpenInternal, setIsOpenInternal] = useState(defaultOpen);

  // Support both controlled and uncontrolled usage
  const isControlled = isOpenProp !== undefined;
  const isOpen = isControlled ? isOpenProp : isOpenInternal;

  function handleToggle() {
    if (isControlled) {
      onToggle?.();
    } else {
      setIsOpenInternal((v) => !v);
    }
  }

  // IDs for accessibility
  const questionId = id ? `faq-question-${id}` : undefined;
  const answerId = id ? `faq-answer-${id}` : undefined;

  // Colour variants
  const questionColour =
    variant === "dark" ? "text-cream" : "text-navy";
  const answerColour =
    variant === "dark" ? "text-cream/75" : "text-dark-text/80";
  const borderColour =
    variant === "dark" ? "border-cream/10" : "border-teal-light";
  const chevronColour =
    isOpen
      ? "text-teal"
      : variant === "dark"
      ? "text-cream/50"
      : "text-muted-gray";

  return (
    <div className={`border-b ${borderColour} last:border-none ${className}`}>
      {/* ── Question button ────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-controls={answerId}
        id={questionId}
        className={[
          "w-full flex items-center justify-between",
          "py-5 text-left",
          "cursor-pointer",
          // Hover: subtle bg highlight
          "rounded-sm",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal",
          "transition-opacity duration-150 hover:opacity-80",
          // Ensure touch target height ≥ 44px (py-5 = 20px × 2 + content = ≥44px)
        ].join(" ")}
      >
        <span
          id={questionId}
          className={[
            "font-display font-semibold text-base leading-snug",
            "pr-8 sm:pr-12",
            questionColour,
          ].join(" ")}
        >
          {question}
        </span>

        {/* Animated chevron */}
        <motion.span
          variants={CHEVRON_VARIANTS}
          animate={isOpen ? "open" : "closed"}
          className={`shrink-0 ${chevronColour}`}
        >
          <ChevronDown />
        </motion.span>
      </button>

      {/* ── Animated answer panel ─────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="answer"
            id={answerId}
            role="region"
            aria-labelledby={questionId}
            initial="closed"
            animate="open"
            exit="closed"
            variants={ANSWER_VARIANTS}
            className="overflow-hidden"
          >
            <div
              className={[
                "pb-5 pr-8 sm:pr-12",
                "font-body text-sm leading-relaxed",
                answerColour,
              ].join(" ")}
            >
              {answer}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── FAQ Group — manages open state across an accordion ──────────────────────
// Default behaviour: only one item open at a time (accordion mode).
// Set `allowMultiple` to let multiple items stay open.

interface FAQGroupProps {
  items: Array<{
    id: string;
    question: string;
    answer: ReactNode;
  }>;
  allowMultiple?: boolean;
  variant?: "light" | "dark";
  className?: string;
}

export function FAQGroup({
  items,
  allowMultiple = false,
  variant = "light",
  className = "",
}: FAQGroupProps) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (!allowMultiple) next.clear();
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className={className}>
      {items.map((item) => (
        <FAQItem
          key={item.id}
          id={item.id}
          question={item.question}
          answer={item.answer}
          isOpen={openIds.has(item.id)}
          onToggle={() => toggle(item.id)}
          variant={variant}
        />
      ))}
    </div>
  );
}
