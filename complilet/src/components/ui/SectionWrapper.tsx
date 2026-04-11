import type { ReactNode, ElementType } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SectionBackground = "navy" | "cream" | "white" | "teal-light";

interface SectionWrapperProps {
  children: ReactNode;
  background?: SectionBackground;
  /** Optional id for in-page anchor links */
  id?: string;
  /** Override section-level classes (applied to the outer Tag element) */
  className?: string;
  /** Override inner container classes */
  innerClassName?: string;
  /** HTML element to render. Defaults to "section". */
  as?: ElementType;
  /** Reduce vertical padding for compact sections (e.g. trust bar, CTA row) */
  compact?: boolean;
}

// ─── Background + foreground colour pairs ────────────────────────────────────
// Every combination passes WCAG AA contrast at 4.5:1 for body text.

const BG_CLASSES: Record<SectionBackground, string> = {
  navy: "bg-navy text-cream",
  cream: "bg-cream text-dark-text",
  white: "bg-white text-dark-text",
  "teal-light": "bg-teal-light text-dark-text",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function SectionWrapper({
  children,
  background = "cream",
  id,
  className = "",
  innerClassName = "",
  as: Tag = "section",
  compact = false,
}: SectionWrapperProps) {
  const outerClasses = [BG_CLASSES[background], className].join(" ");

  // Responsive vertical padding: 64px → 80px → 96px (compact: 40px → 56px → 64px)
  const paddingY = compact
    ? "py-10 sm:py-14 lg:py-16"
    : "py-16 sm:py-20 lg:py-24";

  const innerClasses = [
    "max-w-7xl mx-auto",
    "px-4 sm:px-6 lg:px-8",
    paddingY,
    innerClassName,
  ].join(" ");

  return (
    <Tag id={id} className={outerClasses}>
      <div className={innerClasses}>{children}</div>
    </Tag>
  );
}

// ─── Semantic shorthands ──────────────────────────────────────────────────────
// Pre-configured wrappers for the most common section backgrounds.

export function NavySection(props: Omit<SectionWrapperProps, "background">) {
  return <SectionWrapper {...props} background="navy" />;
}

export function CreamSection(props: Omit<SectionWrapperProps, "background">) {
  return <SectionWrapper {...props} background="cream" />;
}

export function TealLightSection(
  props: Omit<SectionWrapperProps, "background">
) {
  return <SectionWrapper {...props} background="teal-light" />;
}
