import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { COMPANY } from "@/lib/constants";

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = buildMetadata({
  title: "Terms of Service",
  description:
    "CompliLet's terms of service govern your use of the CompliLet platform, AI tenant screening service, and WhatsApp-based tenancy management tools.",
  path: "/terms",
  keywords: [],
});

// ─── Last updated ─────────────────────────────────────────────────────────────

const LAST_UPDATED = "11 April 2026";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TermsPage() {
  return (
    <main id="main-content" className="bg-cream">
      {/* ── Header strip ────────────────────────────────────────────────────── */}
      <div className="bg-navy py-12 sm:py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav aria-label="Breadcrumb" className="mb-4">
            <ol className="flex items-center gap-2 text-xs font-body" style={{ color: "rgba(224,245,243,0.55)" }}>
              <li><a href="/" className="hover:opacity-80 transition-opacity">CompliLet</a></li>
              <li aria-hidden="true">›</li>
              <li style={{ color: "rgba(224,245,243,0.9)" }}>Terms of Service</li>
            </ol>
          </nav>
          <h1 className="font-display font-bold text-white text-3xl sm:text-4xl tracking-[-0.02em]">
            Terms of Service
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
            These Terms of Service (&quot;Terms&quot;) govern your access to and use of the CompliLet
            platform, website (<a href={COMPANY.website}>{COMPANY.website}</a>), and
            WhatsApp-based AI services (&quot;the Service&quot;) provided by{" "}
            <strong>{COMPANY.legalName}</strong> (&quot;CompliLet&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;).
          </p>

          <p>
            By using the Service, you agree to these Terms. If you do not agree, do not use the
            Service. These Terms are governed by the laws of England and Wales.
          </p>

          <hr />

          <h2>1. Definitions</h2>
          <ul>
            <li>
              <strong>&quot;Landlord&quot;</strong> means any individual or legal entity who uses
              CompliLet to screen tenants, manage properties, or track compliance.
            </li>
            <li>
              <strong>&quot;Tenant&quot;</strong> means any individual contacted by CompliLet as part of a
              screening process initiated by a Landlord.
            </li>
            <li>
              <strong>&quot;Screening&quot;</strong> means the AI-assisted process of collecting, verifying,
              and reporting on tenant documentation, references, and affordability.
            </li>
            <li>
              <strong>&quot;Service&quot;</strong> includes all CompliLet platform features, WhatsApp
              interactions, compliance tools, and tenancy management functions.
            </li>
            <li>
              <strong>&quot;User Content&quot;</strong> means any documents, photos, messages, or data
              submitted to CompliLet by Landlords or Tenants.
            </li>
          </ul>

          <h2>2. Eligibility</h2>
          <p>To use the Service as a Landlord, you must:</p>
          <ul>
            <li>Be at least 18 years of age</li>
            <li>Be the legal owner, leaseholder, or authorised agent of the property being managed</li>
            <li>Use the Service only for lawful purposes under UK law</li>
            <li>Have a valid WhatsApp account on the phone number registered with CompliLet</li>
          </ul>

          <h2>3. Nature of the Service</h2>
          <p>
            CompliLet is an AI-assisted property management tool — <strong>not a letting agent</strong>
            under the Estate Agents Act 1979. CompliLet does not:
          </p>
          <ul>
            <li>Act as a landlord&apos;s agent in dealings with tenants</li>
            <li>Make tenancy decisions on behalf of the landlord</li>
            <li>Provide legal advice</li>
            <li>Guarantee the accuracy of tenant-submitted documents</li>
          </ul>
          <p>
            All tenancy decisions — including whether to let to a particular tenant — remain the
            sole responsibility of the Landlord. CompliLet provides information and assistance;
            it does not replace independent legal or professional advice.
          </p>

          <h2>4. Right to Rent Checks</h2>
          <p>
            CompliLet provides Right to Rent check assistance as defined in the Immigration Act 2014
            and the Home Office Landlords&apos; Code of Practice. Important limitations:
          </p>
          <ul>
            <li>
              The Landlord remains the responsible party for carrying out legally valid Right to
              Rent checks. CompliLet provides an assistance and record-keeping service.
            </li>
            <li>
              CompliLet&apos;s Right to Rent certificates are generated based on tenant-submitted
              documents. We apply reasonable verification steps, but cannot guarantee that documents
              are genuine. Landlords who conduct checks in good faith using copies that appear genuine
              are protected under the Home Office Code of Practice.
            </li>
            <li>
              For time-limited (List B) right to rent, the Landlord is responsible for conducting
              follow-up checks before document expiry. CompliLet provides reminders but does not
              automatically conduct follow-up checks unless a relevant plan feature is active.
            </li>
          </ul>

          <h2>5. Acceptable Use</h2>
          <p>You agree not to use the Service to:</p>
          <ul>
            <li>Discriminate against tenants on protected characteristics under the Equality Act 2010</li>
            <li>Submit fraudulent, fabricated, or misleading information to CompliLet</li>
            <li>Use CompliLet&apos;s screening reports to unlawfully deny housing to eligible tenants</li>
            <li>Reverse-engineer, copy, or attempt to extract CompliLet&apos;s AI models or proprietary processes</li>
            <li>Attempt to circumvent WhatsApp&apos;s or Meta&apos;s terms of service through CompliLet</li>
            <li>Use the Service for any purpose that is unlawful under English law</li>
          </ul>

          <h2>6. Fees and Payments</h2>
          <h3>6.1 Pay-Per-Screen</h3>
          <p>
            Pay-Per-Screen screenings are charged at the rate published on our{" "}
            <a href="/pricing">pricing page</a> at the time of the screening. Payment is
            collected before or at the time the screening report is delivered.
          </p>

          <h3>6.2 Subscription Plans</h3>
          <p>
            Monthly subscription plans are billed in advance on the same date each month.
            If a billing attempt fails, we will retry for up to 7 days before suspending your
            account. All prices are in GBP and exclusive of VAT unless stated otherwise.
          </p>

          <h3>6.3 Cancellation and Refunds</h3>
          <p>
            Subscriptions may be cancelled at any time via WhatsApp. Cancellation takes effect
            at the end of the current billing period. No partial-month refunds are issued.
            Pay-per-screen charges are non-refundable once the screening report has been delivered.
          </p>

          <h3>6.4 Price Changes</h3>
          <p>
            CompliLet may change subscription prices on 30 days&apos; written notice (via WhatsApp or
            email). Continued use after the notice period constitutes acceptance of the new price.
          </p>

          <h2>7. AI Limitations and Accuracy</h2>
          <p>
            The Service uses AI to assist with tenant screening, document verification, and
            compliance tracking. You acknowledge that:
          </p>
          <ul>
            <li>AI outputs are not infallible and may contain errors</li>
            <li>Screening scores are indicative recommendations, not definitive assessments</li>
            <li>
              CompliLet cannot detect all forms of document forgery — only those that are
              reasonably apparent from digital image analysis
            </li>
            <li>
              Compliance deadline reminders are based on dates entered into the system;
              accuracy depends on the accuracy of information provided by Landlords
            </li>
          </ul>
          <p>
            The Landlord is responsible for reviewing AI outputs before making tenancy decisions.
            CompliLet is a decision-support tool, not a replacement for professional judgement.
          </p>

          <h2>8. User Content and Data</h2>
          <p>
            By submitting User Content to CompliLet, you grant us a limited, non-exclusive licence
            to process that content for the purpose of providing the Service. You represent that
            you have the right to submit any content you provide and that it does not violate any
            third party&apos;s rights.
          </p>
          <p>
            For tenant data specifically: Landlords confirm by using the Service that they have
            a lawful basis under UK GDPR to instruct CompliLet to process tenant personal data
            on their behalf.
          </p>
          <p>
            We handle all User Content in accordance with our{" "}
            <a href="/privacy">Privacy Policy</a>.
          </p>

          <h2>9. Intellectual Property</h2>
          <p>
            All CompliLet software, AI models, processes, branding, and platform content are owned
            by {COMPANY.legalName} or its licensors. Nothing in these Terms transfers ownership of
            intellectual property to you.
          </p>
          <p>
            Screening reports generated by CompliLet are licensed to the instructing Landlord for
            use in relation to the specific tenancy for which they were generated. They may not
            be resold or distributed without our consent.
          </p>

          <h2>10. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law:
          </p>
          <ul>
            <li>
              CompliLet&apos;s total aggregate liability to you in any 12-month period shall not exceed
              the greater of (a) the fees paid by you to CompliLet in that period, or (b) £500.
            </li>
            <li>
              We are not liable for indirect, consequential, special, or punitive damages including
              loss of profit, loss of tenancy income, or costs arising from regulatory fines.
            </li>
            <li>
              We are not liable for any damage arising from: (a) your failure to act on compliance
              reminders; (b) tenancy decisions made based on AI screening reports; or (c) document
              fraud that was not reasonably apparent from digital verification.
            </li>
          </ul>
          <p>
            Nothing in these Terms limits liability for death or personal injury caused by negligence,
            fraud, or fraudulent misrepresentation, or any other liability that cannot be excluded
            by law.
          </p>

          <h2>11. Indemnity</h2>
          <p>
            You agree to indemnify and hold harmless {COMPANY.legalName} and its directors, employees,
            and agents from and against any claims, liabilities, damages, or costs arising from:
            (a) your use of the Service; (b) your breach of these Terms; (c) your violation of any
            third party&apos;s rights; or (d) any tenancy decision made using CompliLet outputs.
          </p>

          <h2>12. Termination</h2>
          <p>
            CompliLet may suspend or terminate your access to the Service with immediate effect if:
          </p>
          <ul>
            <li>You breach these Terms</li>
            <li>We reasonably suspect fraudulent or unlawful use</li>
            <li>Continued provision of the Service would expose CompliLet to legal liability</li>
          </ul>
          <p>
            On termination, your right to use the Service ceases immediately. We will retain data
            in accordance with our Privacy Policy and applicable law.
          </p>

          <h2>13. Third-Party Services</h2>
          <p>
            The Service operates via WhatsApp (provided by Meta Platforms Ireland Limited). Your
            use of WhatsApp is subject to Meta&apos;s own terms of service and privacy policy. CompliLet
            is not responsible for WhatsApp&apos;s service availability or changes to its platform.
          </p>

          <h2>14. Changes to These Terms</h2>
          <p>
            We may update these Terms at any time. Material changes will be notified via WhatsApp
            or email with at least 14 days&apos; notice. Continued use of the Service after the notice
            period constitutes acceptance of the updated Terms.
          </p>

          <h2>15. Governing Law and Disputes</h2>
          <p>
            These Terms are governed by the laws of England and Wales. Any dispute arising from
            these Terms or your use of the Service shall be subject to the exclusive jurisdiction
            of the courts of England and Wales.
          </p>
          <p>
            Before commencing legal proceedings, we ask that you contact us at{" "}
            <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a> to seek resolution. We will
            use reasonable efforts to resolve disputes informally within 30 days.
          </p>

          <h2>16. Contact</h2>
          <p>For any questions about these Terms:</p>
          <ul>
            <li>Email: <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a></li>
            <li>WhatsApp: <a href={COMPANY.whatsappLink} target="_blank" rel="noopener noreferrer">{COMPANY.whatsappNumber}</a></li>
          </ul>

        </article>
      </div>
    </main>
  );
}
