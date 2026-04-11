import type { ReactNode } from "react";

// ─── Inline SVG icon set ──────────────────────────────────────────────────────
// Heroicons-style, 16×16 viewport, stroke-only, 1.5px stroke width.
// Kept inline to avoid an external icon library dependency at this stage.

const ICONS: Record<string, ReactNode> = {
  shield: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  ),
  lock: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  key: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6" />
      <path d="M15.5 7.5l3 3L22 7l-3-3" />
    </svg>
  ),
  "file-check": (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <polyline points="9 15 11 17 15 13" />
    </svg>
  ),
  "badge-check": (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2L3.5 8.5v7L12 22l8.5-6.5v-7L12 2z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  ),
  // Fallback — simple circle with checkmark
  check: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  ),
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type BadgeVariant = "subtle" | "solid" | "navy";

interface BadgeProps {
  label: string;
  /** Icon key from ICONS map, or any string (falls back to "check") */
  icon?: string;
  variant?: BadgeVariant;
  className?: string;
}

// ─── Variant styles ───────────────────────────────────────────────────────────

const VARIANTS: Record<BadgeVariant, string> = {
  // Used in the trust bar — cream bg, teal icon, muted label text
  subtle:
    "bg-white border border-teal-light text-muted-gray [&_svg]:text-teal",
  // Stronger version for pricing badge chips
  solid:
    "bg-teal-light border border-teal/20 text-teal [&_svg]:text-teal",
  // For navy backgrounds — inverse colour
  navy:
    "bg-navy/40 border border-cream/20 text-cream [&_svg]:text-teal",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function Badge({
  label,
  icon = "check",
  variant = "subtle",
  className = "",
}: BadgeProps) {
  const resolvedIcon = ICONS[icon] ?? ICONS.check;

  return (
    <div
      className={[
        // Layout
        "inline-flex items-center gap-2",
        // Sizing — icon is 16px, label is xs
        "pl-2.5 pr-3.5 py-1.5",
        // Shape
        "rounded-full",
        // Typography
        "font-body text-xs font-medium tracking-wide whitespace-nowrap",
        // Variant
        VARIANTS[variant],
        className,
      ].join(" ")}
    >
      {/* Icon wrapper — fixed 16×16 */}
      <span className="w-4 h-4 shrink-0 flex items-center justify-center">
        {resolvedIcon}
      </span>

      {label}
    </div>
  );
}

// ─── Convenience: renders a row of trust badges from the constants array ──────

interface TrustBadgeRowProps {
  badges: ReadonlyArray<{ label: string; icon: string }>;
  variant?: BadgeVariant;
  className?: string;
}

export function TrustBadgeRow({
  badges,
  variant = "subtle",
  className = "",
}: TrustBadgeRowProps) {
  return (
    <div
      className={[
        "flex flex-wrap items-center justify-center gap-2 sm:gap-3",
        className,
      ].join(" ")}
    >
      {badges.map((b) => (
        <Badge key={b.label} label={b.label} icon={b.icon} variant={variant} />
      ))}
    </div>
  );
}
