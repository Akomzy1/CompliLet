import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { COMPANY } from "@/lib/constants";

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = buildMetadata({
  title: "Privacy Policy",
  description:
    "CompliLet's privacy policy explains how we collect, use, and protect your personal data in compliance with the UK GDPR and the Data Protection Act 2018.",
  path: "/privacy",
  keywords: [],
});

// ─── Last updated ─────────────────────────────────────────────────────────────

const LAST_UPDATED = "12 April 2026";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PrivacyPage() {
  return (
    <main id="main-content" className="bg-cream">
      {/* ── Header strip ────────────────────────────────────────────────────── */}
      <div className="bg-navy py-12 sm:py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav aria-label="Breadcrumb" className="mb-4">
            <ol className="flex items-center gap-2 text-xs font-body" style={{ color: "rgba(224,245,243,0.55)" }}>
              <li><a href="/" className="hover:opacity-80 transition-opacity">CompliLet</a></li>
              <li aria-hidden="true">›</li>
              <li style={{ color: "rgba(224,245,243,0.9)" }}>Privacy Policy</li>
            </ol>
          </nav>
          <h1 className="font-display font-bold text-white text-3xl sm:text-4xl tracking-[-0.02em]">
            Privacy Policy
          </h1>
          <p className="mt-2 font-body text-sm" style={{ color: "rgba(224,245,243,0.60)" }}>
            Last updated: {LAST_UPDATED}
          </p>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16 lg:py-20">
        <article className="blog-prose">

          <p>
            This Privacy Policy explains how <strong>{COMPANY.legalName}</strong> (&quot;CompliLet&quot;,
            &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) collects, uses, stores, and protects personal data
            when you use the CompliLet platform, website (<a href={COMPANY.website}>{COMPANY.website}</a>),
            and WhatsApp-based services. We are registered with the Information Commissioner&apos;s
            Office (ICO) under UK data protection law.
          </p>

          <p>
            This policy is written in accordance with the UK General Data Protection Regulation
            (UK GDPR) and the Data Protection Act 2018. If you have any questions, contact us at{" "}
            <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>.
          </p>

          <hr />

          <h2>1. Who We Are</h2>
          <p>
            <strong>{COMPANY.legalName}</strong> is the data controller for personal data processed
            through the CompliLet platform. We are a company registered in England and Wales.
            Our registered correspondence address and data protection queries should be directed to:{" "}
            <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>.
          </p>

          <h2>2. What Personal Data We Collect</h2>
          <p>
            We collect personal data from two categories of user: <strong>landlords</strong> (who use
            CompliLet to manage their properties and screen tenants) and{" "}
            <strong>tenants</strong> (who are contacted by CompliLet as part of the screening process
            initiated by a landlord).
          </p>

          <h3>2.1 Landlords</h3>
          <ul>
            <li>WhatsApp phone number (used to identify your account and deliver reports)</li>
            <li>Name and email address (for billing, support, and account management)</li>
            <li>Property addresses (for compliance tracking and inspection scheduling)</li>
            <li>Billing information (processed by our payment provider — CompliLet does not store card details)</li>
            <li>Usage data (how you interact with the CompliLet service, for product improvement)</li>
          </ul>

          <h3>2.2 Tenants</h3>
          <ul>
            <li>Full name, date of birth, and contact details (WhatsApp number)</li>
            <li>Government-issued photo ID (passport, UK driving licence, or Biometric Residence Permit)</li>
            <li>Proof of income (payslips, bank statements, or accountant&apos;s letter)</li>
            <li>Proof of address (utility bill, bank letter, or equivalent)</li>
            <li>Immigration status documents and Home Office share codes (for Right to Rent compliance)</li>
            <li>Employment details (employer name, employment type, income level)</li>
            <li>Previous landlord details (for reference purposes)</li>
          </ul>

          <h3>2.3 Third Parties (References)</h3>
          <ul>
            <li>
              Name and WhatsApp number of previous landlords and employers contacted for references.
              These individuals are contacted only to the extent necessary to complete a reference check.
            </li>
          </ul>

          <h2>3. Legal Basis for Processing</h2>
          <p>We process personal data under the following legal bases (UK GDPR Article 6):</p>
          <ul>
            <li>
              <strong>Contract performance</strong> — processing tenant data during screening is
              necessary to perform the screening contract between CompliLet and the landlord.
            </li>
            <li>
              <strong>Legal obligation</strong> — Right to Rent checks are a legal requirement under
              the Immigration Act 2014 and must be carried out before a tenancy begins.
            </li>
            <li>
              <strong>Legitimate interests</strong> — we process landlord usage data to improve the
              CompliLet platform and to communicate service updates.
            </li>
            <li>
              <strong>Consent</strong> — where we send marketing communications to landlords, we do
              so only with explicit opt-in consent. Consent can be withdrawn at any time.
            </li>
          </ul>

          <h2>4. How We Use Your Data</h2>
          <h3>4.1 Tenant data is used to:</h3>
          <ul>
            <li>Conduct the tenant screening process on behalf of the landlord</li>
            <li>Verify identity, income, address, and immigration status</li>
            <li>Chase references from previous landlords and employers</li>
            <li>Generate a screening report and Right to Rent compliance certificate</li>
            <li>Store records in line with the landlord&apos;s legal obligation to retain Right to Rent records</li>
          </ul>

          <h3>4.2 Landlord data is used to:</h3>
          <ul>
            <li>Provide the CompliLet screening and tenancy management service</li>
            <li>Process subscription payments</li>
            <li>Send compliance reminders and tenancy management alerts</li>
            <li>Provide customer support</li>
            <li>Improve the CompliLet platform (in aggregate, anonymised form)</li>
          </ul>

          <h2>5. Data Retention</h2>
          <p>
            We retain personal data only for as long as necessary. Our retention periods are:
          </p>
          <ul>
            <li>
              <strong>Tenant screening records</strong> — retained for the duration of the tenancy
              plus 12 months, in line with the Home Office Right to Rent record-keeping requirement.
              After this period, all tenant documents and personal data are automatically and
              irreversibly deleted.
            </li>
            <li>
              <strong>Landlord account data</strong> — retained for the duration of your CompliLet
              subscription plus 7 years (UK statutory accounting requirement for billing records).
              Personal contact details are deleted within 30 days of account closure.
            </li>
            <li>
              <strong>Reference contact data</strong> (previous landlords and employers) — deleted
              within 30 days of the screening being completed or abandoned.
            </li>
          </ul>

          <h2>6. Data Security</h2>
          <p>
            CompliLet implements industry-standard security measures to protect all personal data:
          </p>
          <ul>
            <li>AES-256 encryption for all data at rest</li>
            <li>TLS 1.3 encryption for all data in transit</li>
            <li>Access-controlled, UK-based cloud infrastructure (no data stored outside the UK/EEA)</li>
            <li>Role-based access controls — CompliLet staff access only the minimum data needed to provide support</li>
            <li>Automated deletion protocols for data past its retention period</li>
            <li>Annual penetration testing and security review</li>
          </ul>

          <h2>7. Data Sharing</h2>
          <p>
            CompliLet does not sell personal data. We share data only in the following circumstances:
          </p>
          <ul>
            <li>
              <strong>With the instructing landlord</strong> — screening reports, Right to Rent
              certificates, and documents collected are shared with the landlord who initiated the
              screening. The landlord is responsible for storing and handling this data in compliance
              with UK GDPR.
            </li>
            <li>
              <strong>With payment processors</strong> — Stripe processes payment card data on our
              behalf. CompliLet does not store or access full card details.
            </li>
            <li>
              <strong>With cloud infrastructure providers</strong> — Supabase (database) and
              Vercel (hosting), both operating under UK/EEA-compliant data processing agreements.
            </li>
            <li>
              <strong>With Konfir (part of Experian)</strong> — when a tenant&apos;s employment
              and income is verified via the Konfir API, the tenant&apos;s name and phone number
              are shared with Konfir solely for the purpose of conducting the verification. Konfir
              is UK Government DIATF certified, ICO registered, ISO 27001 certified, and operates
              under a UK GDPR-compliant data processing agreement. Tenant consent is obtained
              directly by Konfir via SMS before any employment or income data is retrieved.
            </li>
            <li>
              <strong>With the Home Office</strong> — if a tenant&apos;s Right to Rent expires and they
              cannot demonstrate a renewed right to rent, the landlord (not CompliLet) is legally
              required to report this to the Home Office under the Immigration Act 2014.
            </li>
            <li>
              <strong>When required by law</strong> — we may disclose data to law enforcement or
              regulatory authorities where required by a valid legal order.
            </li>
          </ul>

          <h2>8. Your Rights Under UK GDPR</h2>
          <p>You have the following rights regarding your personal data:</p>
          <ul>
            <li><strong>Right of access</strong> — request a copy of the personal data we hold about you.</li>
            <li><strong>Right to rectification</strong> — request correction of inaccurate data.</li>
            <li><strong>Right to erasure</strong> — request deletion of your data, subject to legal retention requirements.</li>
            <li><strong>Right to restrict processing</strong> — request that we limit how we use your data.</li>
            <li><strong>Right to data portability</strong> — request your data in a machine-readable format.</li>
            <li><strong>Right to object</strong> — object to processing based on legitimate interests or for marketing.</li>
            <li><strong>Right to withdraw consent</strong> — where processing is based on consent, you may withdraw it at any time.</li>
          </ul>
          <p>
            To exercise any of these rights, contact us at{" "}
            <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a> or message us on WhatsApp.
            We will respond within 30 days. If you are dissatisfied with our response, you may
            lodge a complaint with the Information Commissioner&apos;s Office (ICO) at{" "}
            <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer">ico.org.uk</a>.
          </p>

          <h2>9. Cookies and Website Data</h2>
          <p>
            The CompliLet website ({COMPANY.website}) uses the following categories of cookies:
          </p>
          <ul>
            <li>
              <strong>Strictly necessary cookies</strong> — required for the site to function.
              These cannot be disabled.
            </li>
            <li>
              <strong>Analytics cookies</strong> — we use Vercel Analytics to understand aggregate
              site usage (no personally identifiable data is collected; IP addresses are anonymised).
            </li>
          </ul>
          <p>
            We do not use advertising cookies, social media tracking cookies, or third-party
            retargeting cookies. You may disable analytics cookies in your browser settings
            without affecting site functionality.
          </p>

          <h2>10. Tenant Data and Landlord Responsibility</h2>
          <p>
            CompliLet processes tenant data as a <strong>data processor</strong> on behalf of the
            instructing landlord, who is the <strong>data controller</strong> for that tenant&apos;s data.
            Landlords are responsible for:
          </p>
          <ul>
            <li>Informing tenants that their data will be processed by CompliLet on their behalf</li>
            <li>Handling Right to Rent records in line with the Home Office Code of Practice</li>
            <li>Complying with UK GDPR in their own use of data provided in screening reports</li>
          </ul>
          <p>
            CompliLet&apos;s Data Processing Agreement (available on request) governs this
            controller-processor relationship.
          </p>

          <h2>11. International Transfers</h2>
          <p>
            All personal data processed by CompliLet is stored in UK or EEA-based infrastructure.
            We do not transfer personal data to countries outside the UK or EEA. Our sub-processors
            (Supabase, Vercel, Stripe, Konfir) operate under UK GDPR-compliant data processing
            agreements. Konfir is headquartered in the UK and processes all verification data
            within UK/EEA infrastructure.
          </p>

          <h2>12. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. When we make material changes, we
            will notify landlords via WhatsApp or email and update the &quot;Last updated&quot; date above.
            Continued use of the CompliLet service after notification constitutes acceptance of the
            updated policy.
          </p>

          <h2>13. Contact Us</h2>
          <p>
            For any privacy-related questions, data subject requests, or concerns:
          </p>
          <ul>
            <li>Email: <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a></li>
            <li>WhatsApp: <a href={COMPANY.whatsappLink} target="_blank" rel="noopener noreferrer">{COMPANY.whatsappNumber}</a></li>
          </ul>
          <p>
            For complaints not resolved to your satisfaction:{" "}
            <a href="https://ico.org.uk/make-a-complaint" target="_blank" rel="noopener noreferrer">
              ico.org.uk/make-a-complaint
            </a>
          </p>

        </article>
      </div>
    </main>
  );
}
