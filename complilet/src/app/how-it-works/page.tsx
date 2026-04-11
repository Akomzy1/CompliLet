import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { COMPANY, COMPLIANCE_FACTS, TRUST_BADGES } from "@/lib/constants";

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = buildMetadata({
  title: "How It Works — AI Tenant Screening via WhatsApp",
  description:
    "See exactly how CompliLet screens tenants, chases references, and manages compliance — all through WhatsApp. A 6-step walkthrough of the full process.",
  path: "/how-it-works",
  keywords: [
    "how tenant screening works",
    "WhatsApp tenant screening process",
    "AI property management how it works",
    "tenant referencing process UK",
    "Right to Rent check process",
    "landlord compliance process UK",
  ],
});

// ─── Shield icon ──────────────────────────────────────────────────────────────

function ShieldIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-teal shrink-0"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

// ─── WhatsApp SVG icon ────────────────────────────────────────────────────────

function WhatsAppIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

// ─── CheckCircle icon ─────────────────────────────────────────────────────────

function CheckCircleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-teal shrink-0 mt-0.5"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HowItWorksPage() {
  return (
    <main id="main-content" className="bg-cream">
      {/* ── Hero strip ──────────────────────────────────────────────────────── */}
      <div
        className="bg-navy py-16 sm:py-20 lg:py-24"
        style={{
          backgroundImage: [
            "radial-gradient(ellipse 80% 55% at 50% -5%, rgba(13,148,136,0.18) 0%, transparent 65%)",
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Ccircle cx='18' cy='18' r='1.2' fill='%23ffffff' fill-opacity='0.04'/%3E%3C/svg%3E\")",
          ].join(", "),
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="font-body font-semibold text-xs tracking-widest uppercase text-teal mb-3">
            The process
          </p>
          <h1 className="font-display font-bold text-white text-3xl sm:text-4xl lg:text-5xl leading-tight tracking-[-0.02em] mb-4">
            How CompliLet Works
          </h1>
          <p
            className="font-body text-lg leading-relaxed max-w-2xl mx-auto mb-8"
            style={{ color: "rgba(253,248,240,0.80)" }}
          >
            From the moment a tenant enquires to the day they move in — and every compliance
            deadline beyond — CompliLet handles it all inside WhatsApp.
            No app. No dashboard. No letting agent.
          </p>

          {/* Key stats row */}
          <div className="flex flex-wrap justify-center gap-6 sm:gap-12">
            {[
              { value: `${COMPLIANCE_FACTS.compliletScreeningHours}h`, label: "Screening turnaround" },
              { value: COMPLIANCE_FACTS.landlordsUsingWhatsApp, label: "of UK landlords use WhatsApp" },
              { value: "£0", label: "app downloads required" },
              { value: "6 steps", label: "from enquiry to decision" },
            ].map(({ value, label }) => (
              <div key={label} className="text-center">
                <span className="block font-display font-bold text-2xl sm:text-3xl text-white">
                  {value}
                </span>
                <span
                  className="font-body text-xs"
                  style={{ color: "rgba(224,245,243,0.65)" }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Step-by-step walkthrough (reuse section component) ──────────────── */}
      <HowItWorks />

      {/* ── What gets checked — detail strip ────────────────────────────────── */}
      <div className="bg-white border-y border-teal-light">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16">
          <div className="text-center mb-10">
            <h2 className="font-display font-bold text-navy text-2xl sm:text-3xl tracking-[-0.02em]">
              What CompliLet Checks — in Detail
            </h2>
            <p className="mt-3 font-body text-muted-gray text-base max-w-xl mx-auto leading-relaxed">
              Every screening covers the same six categories. Here is exactly what is
              checked in each, and why it matters under UK tenancy law.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                title: "Identity Verification",
                items: [
                  "Government-issued photo ID (passport or UK driving licence)",
                  "Name matching across all submitted documents",
                  "Document expiry date validation",
                  "Authenticity indicators (holograms, font, format)",
                ],
                why: "Prevents impersonation and ensures tenancy agreement enforceability.",
              },
              {
                title: "Income & Affordability",
                items: [
                  "3 most recent payslips or 3-month bank statements",
                  "Gross annual income verified against 2.5× annual rent rule",
                  "Employer name and NI number consistency check",
                  "Self-employed: accountant letter + business bank statements",
                ],
                why: "Identifies rent arrears risk before the tenancy begins — critical after Section 21 abolition.",
              },
              {
                title: "Right to Rent",
                items: [
                  "Home Office document classification (List A / List B)",
                  "Online share code check for EEA nationals and visa holders",
                  "IDSP-assisted digital check for British and Irish nationals",
                  "Timestamped compliance certificate generated per tenant",
                ],
                why: "Legally required under the Immigration Act 2014. Fine up to £3,000 per occupant if missed.",
              },
              {
                title: "Proof of Address",
                items: [
                  "Utility bill, bank statement, or HMRC letter dated within 90 days",
                  "Address matches current landlord or tenancy address",
                  "Name matches photo ID submitted",
                ],
                why: "Establishes current residence and reduces fraudulent application risk.",
              },
              {
                title: "Reference Chasing",
                items: [
                  "Previous landlord contacted via WhatsApp for structured reference",
                  "Employer contacted to verify employment status and income",
                  "Automated follow-up at 2, 4, and 7 days if no response",
                  "Verbal references not accepted — written record required",
                ],
                why: "The most predictive indicator of future tenancy conduct. Skipping this is the most common landlord mistake.",
              },
              {
                title: "Compliance Records",
                items: [
                  "Screening date, method, and result timestamped automatically",
                  "All documents archived for tenancy term + 12 months (GDPR)",
                  "List B tenants flagged for follow-up check before document expiry",
                  "PDF compliance report delivered to landlord via WhatsApp",
                ],
                why: "Provides a complete audit trail for any future dispute, court proceeding, or ombudsman review.",
              },
            ].map(({ title, items, why }) => (
              <div
                key={title}
                className="p-6 bg-cream rounded-xl border border-teal-light flex flex-col gap-4"
              >
                <div className="flex items-center gap-2">
                  <ShieldIcon />
                  <h3 className="font-display font-bold text-navy text-base">{title}</h3>
                </div>
                <ul className="flex flex-col gap-2">
                  {items.map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <CheckCircleIcon />
                      <span className="font-body text-sm text-dark-text/80 leading-relaxed">
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="font-body text-xs text-muted-gray italic border-t border-teal-light pt-3">
                  <strong className="not-italic font-semibold text-navy">Why it matters:</strong>{" "}
                  {why}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Trust badges strip ───────────────────────────────────────────────── */}
      <div className="border-b border-teal-light">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <p className="font-body text-xs font-semibold tracking-widest uppercase text-muted-gray text-center mb-6">
            Security & compliance standards
          </p>
          <div className="flex flex-wrap justify-center gap-4 sm:gap-6">
            {TRUST_BADGES.map((badge) => (
              <div
                key={badge.label}
                className="flex items-center gap-2 bg-white border border-teal-light rounded-full px-4 py-2"
              >
                <span className="font-body text-sm font-semibold text-navy">{badge.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── After move-in section ────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16 lg:py-20">
        <div className="text-center mb-10">
          <p className="font-body font-semibold text-xs tracking-widest uppercase text-teal mb-3">
            Ongoing tenancy management
          </p>
          <h2 className="font-display font-bold text-navy text-2xl sm:text-3xl tracking-[-0.02em]">
            CompliLet Stays Active After Move-In
          </h2>
          <p className="mt-3 font-body text-muted-gray text-base max-w-xl mx-auto leading-relaxed">
            Screening is just the beginning. CompliLet&apos;s tenancy management suite runs in
            the background for the entire tenancy lifecycle.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            {
              title: "Rent Reminders",
              desc: "Sent to tenants 3 days before each due date. Graduated arrears chasing if rent is late at 1, 3, and 7 days overdue.",
            },
            {
              title: "Compliance Autopilot",
              desc: "Tracks gas safety, EICR, EPC, and deposit protection expiry dates. WhatsApp alerts at 90, 60, and 30 days before each deadline.",
            },
            {
              title: "Maintenance Triage",
              desc: "Tenants report issues via WhatsApp. AI assesses urgency and photos, then notifies your designated contractors for pre-approved emergencies.",
            },
            {
              title: "Quarterly Inspections",
              desc: "Tenants submit dated photo sets quarterly. CompliLet compiles them into a condition report delivered to the landlord.",
            },
            {
              title: "Renewal Agent",
              desc: "Reminds you and the tenant 90 days before lease end. Handles renewal paperwork and updated Right to Rent follow-up for List B tenants.",
            },
            {
              title: "Overseas Support",
              desc: "Timezone-aware notifications, NRL tax guidance, and emergency contractor dispatch for landlords managing UK properties from abroad.",
            },
          ].map(({ title, desc }) => (
            <div
              key={title}
              className="p-5 bg-white rounded-xl border border-teal-light"
            >
              <p className="font-display font-bold text-navy text-sm mb-2">{title}</p>
              <p className="font-body text-muted-gray text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Bottom CTA ────────────────────────────────────────────────────────── */}
      <div
        className="py-20 sm:py-24 text-center"
        style={{
          background: "#0F2B46",
          backgroundImage: [
            "radial-gradient(ellipse 80% 55% at 50% -5%, rgba(13,148,136,0.20) 0%, transparent 65%)",
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Ccircle cx='18' cy='18' r='1.2' fill='%23ffffff' fill-opacity='0.04'/%3E%3C/svg%3E\")",
          ].join(", "),
        }}
      >
        <div className="max-w-xl mx-auto px-4 sm:px-6 flex flex-col items-center gap-5">
          <p className="font-body font-semibold text-xs tracking-widest uppercase text-teal">
            Ready to try it?
          </p>
          <h2 className="font-display font-bold text-white text-3xl sm:text-4xl tracking-[-0.02em] leading-tight">
            Screen Your First Tenant Free
          </h2>
          <p
            className="font-body text-lg leading-relaxed max-w-sm"
            style={{ color: "rgba(253,248,240,0.80)" }}
          >
            Start in under 60 seconds — forward a tenant enquiry to CompliLet
            on WhatsApp and we take it from there.
          </p>
          <a
            href={COMPANY.whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Start using CompliLet on WhatsApp"
            className="inline-flex items-center gap-2.5 bg-whatsapp-green text-white font-body font-semibold text-base px-8 py-4 rounded-full min-h-[56px] hover:brightness-105 transition-all duration-150 shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          >
            <WhatsAppIcon />
            Start on WhatsApp
          </a>
          <p
            className="font-body text-xs"
            style={{ color: "rgba(224,245,243,0.55)" }}
          >
            First 3 screenings free ·{" "}
            <Link href="/pricing" className="underline underline-offset-2 hover:opacity-75">
              View pricing
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
