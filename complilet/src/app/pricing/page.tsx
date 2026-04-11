import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata, buildSoftwareApplicationSchema, serializeSchema } from "@/lib/seo";
import { Pricing } from "@/components/sections/Pricing";
import { COMPANY, COMPLIANCE_FACTS } from "@/lib/constants";

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = buildMetadata({
  title: "Pricing — From £4.99 per Screening",
  description:
    "CompliLet pricing starts at £4.99 per tenant screening. No subscription required. Full tenancy management from £14.99 per property per month. Cancel anytime.",
  path: "/pricing",
  keywords: [
    "tenant screening cost UK",
    "landlord compliance software pricing",
    "WhatsApp property management cost",
    "letting agent alternative cost",
    "self manage rental property cost",
    "tenant referencing price UK",
  ],
});

// ─── Schema ───────────────────────────────────────────────────────────────────

const softwareSchema = buildSoftwareApplicationSchema();

// ─── Static pricing FAQ entries ───────────────────────────────────────────────

const PRICING_FAQS = [
  {
    q: "Is there a free trial?",
    a: "Your first 3 tenant screenings are free — no credit card required. Start on WhatsApp and we will screen your first three tenants at no cost. After that, screenings are £4.99 each on the Pay-Per-Screen plan, or unlimited on Landlord Pro (£19.99/month).",
  },
  {
    q: "Can I cancel my subscription at any time?",
    a: "Yes. All CompliLet subscriptions are month-to-month with no minimum term. Cancel at any time by messaging CompliLet on WhatsApp and your subscription will end at the close of your current billing period. There are no cancellation fees.",
  },
  {
    q: "What does 'per property' mean on the Tenancy Manager and Global Landlord plans?",
    a: "The per-property price applies to each individual rental property under active tenancy management. For example, a landlord with 3 properties on the Tenancy Manager plan pays £14.99 × 3 = £44.97 per month. The Portfolio plan (£39.99/month flat rate) is cheaper if you have 3 or more properties.",
  },
  {
    q: "Does the price include tenant screenings?",
    a: "Pay-Per-Screen is billed at £4.99 per screening. Landlord Pro (£19.99/month) includes unlimited screenings. Tenancy Manager and Global Landlord plans include one screening per active tenancy per year; additional screenings are charged at £4.99.",
  },
  {
    q: "Is VAT included in these prices?",
    a: "Prices shown are exclusive of VAT. UK VAT (20%) will be added at checkout where applicable. If you are VAT-registered, your VAT receipt will be available from your account dashboard.",
  },
  {
    q: "How does CompliLet compare to a letting agent?",
    a: `A typical UK full-management letting agent charges 10–15% of monthly rent — that is £150–£300 per month on a £1,500/month property, or £1,800–£3,600 per year. CompliLet's Tenancy Manager plan covers the same ground for £14.99 per property per month (£179.88 per year). The saving is typically £1,600–£3,400 per property per year.`,
  },
];

// ─── WhatsApp SVG icon (inline — no extra dep) ────────────────────────────────

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

// ─── Check icon ───────────────────────────────────────────────────────────────

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
      className="shrink-0 text-teal mt-0.5"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  return (
    <>
      {/* SoftwareApplication schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeSchema(softwareSchema) }}
      />

      <main id="main-content" className="bg-cream">
        {/* ── Hero strip ────────────────────────────────────────────────────── */}
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
              Transparent pricing
            </p>
            <h1 className="font-display font-bold text-white text-3xl sm:text-4xl lg:text-5xl leading-tight tracking-[-0.02em] mb-4">
              Simple Pricing. No Surprises.
            </h1>
            <p
              className="font-body text-lg leading-relaxed max-w-2xl mx-auto mb-8"
              style={{ color: "rgba(253,248,240,0.80)" }}
            >
              Start with a pay-per-screen for £4.99 — no subscription, no commitment.
              Or choose a monthly plan when you want unlimited screenings and ongoing
              tenancy management.
            </p>

            {/* Key numbers bar */}
            <div className="flex flex-wrap justify-center gap-6 sm:gap-10">
              {[
                { label: "First screenings", value: "3 free" },
                { label: "Pay-per-screen from", value: "£4.99" },
                { label: "Tenancy management from", value: "£14.99/mo" },
                { label: "vs letting agent fees", value: "Save £1,600+/yr" },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col items-center gap-0.5">
                  <span className="font-display font-bold text-2xl sm:text-3xl text-white">
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

        {/* ── Pricing cards (reuse the section component) ───────────────────── */}
        <Pricing />

        {/* ── Cost comparison strip ─────────────────────────────────────────── */}
        <div className="bg-white border-y border-teal-light">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16">
            <div className="text-center mb-10">
              <h2 className="font-display font-bold text-navy text-2xl sm:text-3xl tracking-[-0.02em]">
                How Much Does a Letting Agent Actually Cost?
              </h2>
              <p className="mt-3 font-body text-muted-gray text-base max-w-xl mx-auto leading-relaxed">
                Compare the real annual cost of a traditional full-management letting agent
                versus CompliLet&apos;s Tenancy Manager plan on a typical UK rental.
              </p>
            </div>

            {/* Comparison table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left font-display font-semibold text-navy text-xs uppercase tracking-wider py-3 px-4 bg-teal-light/40 rounded-tl-lg">
                      Cost item
                    </th>
                    <th className="text-center font-display font-semibold text-navy text-xs uppercase tracking-wider py-3 px-4 bg-teal-light/40">
                      Traditional agent
                    </th>
                    <th className="text-center font-display font-semibold text-white text-xs uppercase tracking-wider py-3 px-4 bg-teal rounded-tr-lg">
                      CompliLet
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Monthly management fee (£1,500/mo rent)", "£150–£225/mo (10–15%)", "£14.99/mo"],
                    ["Tenant screening / referencing", "£100–£200 per tenancy", "£4.99 or included"],
                    ["Compliance reminders & certificate tracking", "Included in fee", "Included"],
                    ["Maintenance coordination", "Included in fee", "Included"],
                    ["Right to Rent check", "Included in fee", "Included"],
                    ["Rent collection reminders", "Included in fee", "Included"],
                    ["Quarterly inspection reports", "Included in fee", "Included"],
                    ["Annual cost (1 property)", "£1,800–£2,700+", "£179.88"],
                  ].map(([item, agent, complilet], i) => (
                    <tr key={item} className={i % 2 === 0 ? "bg-cream/50" : ""}>
                      <td className="py-3 px-4 font-body text-dark-text border-b border-teal-light/50">
                        {item}
                      </td>
                      <td className="py-3 px-4 font-body text-muted-gray text-center border-b border-teal-light/50">
                        {agent}
                      </td>
                      <td className="py-3 px-4 font-body font-semibold text-teal text-center border-b border-teal-light/50">
                        {complilet}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-5 font-body text-xs text-muted-gray text-center">
              Based on {COMPLIANCE_FACTS.ukSelfManagingLandlords} self-managing UK landlords and average market letting agent fees.
              Saving calculated on a £1,500/month rental property.
            </p>
          </div>
        </div>

        {/* ── What is included on all plans ─────────────────────────────────── */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16 lg:py-20">
          <h2 className="font-display font-bold text-navy text-2xl sm:text-3xl tracking-[-0.02em] text-center mb-3">
            Every Plan Includes
          </h2>
          <p className="font-body text-muted-gray text-base text-center max-w-lg mx-auto mb-10 leading-relaxed">
            No hidden add-ons. These features are standard across all CompliLet plans.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { title: "GDPR Compliance", desc: "ICO-registered. Encrypted document storage. Auto-deletion after 12 months." },
              { title: "Ombudsman-Ready Records", desc: "Every screening, check, and decision is timestamped and audit-trail-ready." },
              { title: "Human Escalation", desc: "A real CompliLet team member responds within 2 working hours on any plan." },
              { title: "WhatsApp-Native", desc: "No app download. No new account. Just your existing WhatsApp number." },
              { title: "Number Privacy", desc: "Your personal mobile number is never shared with tenants at any point." },
              { title: "Cancel Anytime", desc: "Month-to-month subscriptions with no minimum term or exit fee." },
            ].map(({ title, desc }) => (
              <div
                key={title}
                className="flex items-start gap-3 p-5 bg-white rounded-xl border border-teal-light"
              >
                <CheckIcon />
                <div>
                  <p className="font-display font-semibold text-navy text-sm mb-1">{title}</p>
                  <p className="font-body text-muted-gray text-sm leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Pricing FAQ ───────────────────────────────────────────────────── */}
        <div className="border-t border-teal-light">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16 lg:py-20">
            <h2 className="font-display font-bold text-navy text-2xl sm:text-3xl tracking-[-0.02em] text-center mb-10">
              Pricing Questions
            </h2>

            <div className="flex flex-col gap-6">
              {PRICING_FAQS.map(({ q, a }) => (
                <div key={q} className="border-b border-teal-light pb-6 last:border-b-0 last:pb-0">
                  <p className="font-display font-semibold text-navy text-base mb-2">{q}</p>
                  <p className="font-body text-dark-text/80 text-sm leading-relaxed">{a}</p>
                </div>
              ))}
            </div>

            <p className="mt-10 font-body text-muted-gray text-sm text-center">
              More questions?{" "}
              <a
                href={COMPANY.whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal font-semibold underline underline-offset-2 hover:opacity-75 transition-opacity"
              >
                Ask us on WhatsApp
              </a>{" "}
              — we typically reply within minutes.
            </p>
          </div>
        </div>

        {/* ── Bottom CTA ────────────────────────────────────────────────────── */}
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
              Get started
            </p>
            <h2 className="font-display font-bold text-white text-3xl sm:text-4xl tracking-[-0.02em] leading-tight">
              Start With 3 Free Screenings
            </h2>
            <p
              className="font-body text-lg leading-relaxed max-w-sm"
              style={{ color: "rgba(253,248,240,0.80)" }}
            >
              No card. No signup. Just message CompliLet on WhatsApp and we&apos;ll
              handle your first three tenant screenings free.
            </p>
            <a
              href={COMPANY.whatsappLink}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Start using CompliLet on WhatsApp"
              className="inline-flex items-center gap-2.5 bg-whatsapp-green text-white font-body font-semibold text-base px-8 py-4 rounded-full min-h-[56px] hover:brightness-105 transition-all duration-150 shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
            >
              <WhatsAppIcon />
              Start on WhatsApp — it&apos;s free
            </a>
            <p
              className="font-body text-xs"
              style={{ color: "rgba(224,245,243,0.55)" }}
            >
              Or{" "}
              <Link href="/how-it-works" className="underline underline-offset-2 hover:opacity-75">
                see exactly how it works
              </Link>{" "}
              first.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
