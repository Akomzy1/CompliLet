"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { COMPANY } from "@/lib/constants";

// ─── Animation ────────────────────────────────────────────────────────────────

type Bezier = [number, number, number, number];
const EASE_OUT: Bezier = [0.25, 0.46, 0.45, 0.94];

const SPRING = {
  type: "spring" as const,
  stiffness: 340,
  damping: 26,
};

// ─── Inline SVG icons — Heroicons-style, 24×24, stroke-based ─────────────────
// Kept inline to avoid adding a dependency for 9 icons.

function IconClipboardCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 14l2 2 4-4" />
    </svg>
  );
}

function IconShieldCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

function IconFileCertificate() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <circle cx="12" cy="14" r="3" />
      <path d="M9.5 17.5L9 21l3-1.5L15 21l-.5-3.5" />
    </svg>
  );
}

function IconMessageAuto() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      <path d="M8 10h.01M12 10h.01M16 10h.01" />
      <path d="M16 14.5a2 2 0 100-4 2 2 0 000 4z" fill="currentColor" stroke="none" fillOpacity="0.25" />
      <path d="M14.5 13l-1 2.5" />
    </svg>
  );
}

function IconCalendarAlert() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="12" y1="14" x2="12" y2="16" />
      <circle cx="12" cy="18.5" r="0.5" fill="currentColor" />
    </svg>
  );
}

function IconCurrencyPound() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M9 16h6M9 12h5M10.5 12V9.5a2.5 2.5 0 015 0" />
    </svg>
  );
}

function IconWrenchAI() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
      <circle cx="18" cy="5" r="1.5" fill="currentColor" stroke="none" fillOpacity="0.3" />
    </svg>
  );
}

function IconCameraRoom() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
      <circle cx="12" cy="13" r="2" fill="currentColor" stroke="none" fillOpacity="0.2" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  );
}

// ─── Feature data ─────────────────────────────────────────────────────────────

interface Feature {
  id: string;
  icon: React.FC;
  title: string;
  description: string;
  /** Optional tag for emphasis */
  tag?: string;
}

const FEATURES: Feature[] = [
  {
    id: "pre-qual",
    icon: IconClipboardCheck,
    title: "Tenant Pre-Qualification",
    description:
      "AI-powered screening scores tenants against your criteria. Income, employment, references — all collected via WhatsApp conversation.",
  },
  {
    id: "doc-verify",
    icon: IconShieldCheck,
    title: "Document Verification",
    description:
      "ID and address verified via WhatsApp photo. Employment and income verified directly from HMRC, payroll, and bank records via Konfir — no payslip upload needed.",
  },
  {
    id: "right-to-rent",
    icon: IconFileCertificate,
    title: "Right to Rent Compliance",
    description:
      "Automated Home Office document classification. Timestamped compliance certificate delivered as PDF. Audit-trail ready.",
    tag: "Legally required",
  },
  {
    id: "ref-chasing",
    icon: IconMessageAuto,
    title: "Autonomous Reference Chasing",
    description:
      "We contact previous landlords and employers via WhatsApp. Automated follow-ups until they respond. You never chase anyone.",
  },
  {
    id: "compliance",
    icon: IconCalendarAlert,
    title: "Compliance Autopilot",
    description:
      "Gas safety, EICR, EPC, deposit protection — every deadline tracked. Reminders at 90, 30, 14, 7, and 1 day with contractor recommendations.",
    tag: "Avoid £6,000 fines",
  },
  {
    id: "rent",
    icon: IconCurrencyPound,
    title: "Rent Collection & Arrears",
    description:
      "Polite tenant reminders 3 days before rent is due. Graduated arrears chasing. Landlord alerts with recommended next steps.",
  },
  {
    id: "maintenance",
    icon: IconWrenchAI,
    title: "Maintenance Triage",
    description:
      "Tenant sends a photo of a problem. AI diagnoses, sends self-fix guides for simple issues, escalates with contractor recommendation for serious ones.",
  },
  {
    id: "inspections",
    icon: IconCameraRoom,
    title: "Property Inspections",
    description:
      "Remote photo-based quarterly inspections. Tenant uploads room-by-room photos. AI compares against move-in inventory. Condition report PDF generated.",
  },
  {
    id: "overseas",
    icon: IconGlobe,
    title: "Overseas Landlord Support",
    description:
      "Timezone-aware notifications. NRL tax compliance guidance. 24/7 first response. Smart lock integration. Manage from anywhere.",
    tag: "For overseas landlords",
  },
];

// ─── Feature card ─────────────────────────────────────────────────────────────

function FeatureCard({
  feature,
  delay,
}: {
  feature: Feature;
  delay: number;
}) {
  const Icon = feature.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: EASE_OUT, delay }}
      whileHover={{ y: -5, transition: SPRING }}
      className={[
        // Shape + colour
        "relative flex flex-col gap-4",
        "bg-cream rounded-2xl",
        "border border-teal-light",
        "p-6 sm:p-7",
        // Shadow
        "shadow-card hover:shadow-card-hover",
        "transition-shadow duration-200",
        // Smooth cursor
        "cursor-default",
      ].join(" ")}
    >
      {/* Optional tag chip */}
      {feature.tag && (
        <span className="self-start inline-block bg-teal-light text-teal text-[11px] font-display font-semibold px-2.5 py-0.5 rounded-full tracking-wide leading-tight">
          {feature.tag}
        </span>
      )}

      {/* Icon container */}
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-teal"
        style={{ background: "#E0F5F3" }}
        aria-hidden="true"
      >
        <span className="w-6 h-6 flex items-center justify-center">
          <Icon />
        </span>
      </div>

      {/* Text */}
      <div className="flex flex-col gap-2">
        <h3 className="font-display font-bold text-lg text-navy leading-snug">
          {feature.title}
        </h3>
        <p className="font-body text-sm leading-relaxed text-muted-gray">
          {feature.description}
        </p>
      </div>

      {/* Subtle top-left corner accent line */}
      <div
        aria-hidden="true"
        className="absolute top-0 left-6 right-6 h-px rounded-full"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(13,148,136,0.25), transparent)",
        }}
      />
    </motion.div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Features() {
  return (
    <section
      id="features"
      aria-labelledby="features-heading"
      className="bg-white"
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-20 lg:pt-24 pb-12">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.55, ease: EASE_OUT }}
          className="text-center max-w-3xl mx-auto"
        >
          <p className="font-body font-semibold text-sm tracking-widest uppercase text-teal mb-3">
            Features
          </p>
          <h2
            id="features-heading"
            className="font-display font-bold text-3xl sm:text-4xl lg:text-5xl text-navy leading-tight tracking-[-0.02em]"
          >
            Everything a Letting Agent Does.{" "}
            <br className="hidden sm:block" />
            For a Fraction of the Price.
          </h2>
          <p className="mt-5 font-body text-lg text-muted-gray leading-relaxed">
            CompliLet handles the full tenant lifecycle — screening, compliance,
            rent, maintenance — all inside WhatsApp.
          </p>
        </motion.div>
      </div>

      {/* ── Feature grid ────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 sm:pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6">
          {FEATURES.map((feature, index) => (
            <FeatureCard
              key={feature.id}
              feature={feature}
              // Stagger across columns: row-aware delay
              delay={Math.floor(index / 3) * 0.08 + (index % 3) * 0.06}
            />
          ))}
        </div>
      </div>

      {/* ── Comparison callout strip ─────────────────────────────────────── */}
      <div className="border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16 lg:py-20">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.55, ease: EASE_OUT }}
            className="flex flex-col items-center text-center gap-6"
          >
            {/* Comparison pill */}
            <div className="inline-flex items-center gap-3 flex-wrap justify-center">
              {/* Agent cost chip */}
              <span
                className={[
                  "inline-flex items-center gap-1.5",
                  "bg-red-50 border border-red-200 text-red-700",
                  "font-body font-semibold text-sm px-4 py-2 rounded-full",
                  "whitespace-nowrap",
                ].join(" ")}
              >
                {/* X icon */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                Letting agent: £150–£300/month
              </span>

              <span className="font-body text-muted-gray text-sm font-medium hidden sm:inline">
                vs
              </span>

              {/* CompliLet cost chip */}
              <span
                className={[
                  "inline-flex items-center gap-1.5",
                  "bg-teal-light border border-teal/20 text-teal",
                  "font-body font-semibold text-sm px-4 py-2 rounded-full",
                  "whitespace-nowrap",
                ].join(" ")}
              >
                {/* Check icon */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                CompliLet: from £4.99 per screening
              </span>
            </div>

            {/* Headline */}
            <p className="font-display font-bold text-2xl sm:text-3xl text-navy leading-tight tracking-[-0.02em] max-w-lg">
              A letting agent charges £150–£300/month.
              <br />
              <span className="text-teal">CompliLet starts at £4.99.</span>
            </p>

            <p className="font-body text-muted-gray max-w-sm leading-relaxed">
              No monthly fee to get started. Pay per screening, or upgrade when
              you're ready.
            </p>

            <Button
              variant="whatsapp"
              href={COMPANY.whatsappLink}
              size="lg"
              external
              aria-label="Start using CompliLet on WhatsApp"
            >
              Start on WhatsApp →
            </Button>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
