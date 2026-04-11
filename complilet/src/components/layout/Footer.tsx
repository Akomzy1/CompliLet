import Link from "next/link";
import { COMPANY } from "@/lib/constants";

// ─── Social icons ─────────────────────────────────────────────────────────────

function TwitterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function YouTubeIcon() {
  return (
    <svg width="20" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23.495 6.205a3.007 3.007 0 00-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 00.527 6.205a31.247 31.247 0 00-.522 5.805 31.247 31.247 0 00.522 5.783 3.007 3.007 0 002.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 002.088-2.088 31.247 31.247 0 00.5-5.783 31.247 31.247 0 00-.5-5.805zM9.609 15.601V8.408l6.264 3.602z" />
    </svg>
  );
}

// ─── Footer column data ───────────────────────────────────────────────────────

const COL_PRODUCT = [
  { label: "How It Works",           href: "/#how-it-works" },
  { label: "Features",               href: "/#features" },
  { label: "Pricing",                href: "/#pricing" },
  { label: "For Overseas Landlords", href: "/#overseas" },
  { label: "FAQ",                    href: "/#faq" },
];

const COL_RESOURCES = [
  { label: "Blog",                      href: "/blog" },
  { label: "Compliance Guide",          href: "/blog/landlord-compliance-guide-uk" },
  { label: "Right to Rent Checklist",   href: "/blog/right-to-rent-checklist-2026" },
  { label: "Overseas Landlord Guide",   href: "/blog/manage-uk-property-from-abroad" },
  { label: "Renters' Rights Act 2026",  href: "/blog/renters-rights-act-2026" },
];

const COL_LEGAL = [
  { label: "Privacy Policy",    href: "/privacy" },
  { label: "Terms of Service",  href: "/terms" },
  { label: "Cookie Policy",     href: "/cookies" },
  { label: "ICO Registration",  href: "https://ico.org.uk", external: true },
  { label: "GDPR Compliance",   href: "/privacy#gdpr" },
];

// ─── Reusable link list ───────────────────────────────────────────────────────

function FooterLinkList({
  heading,
  links,
}: {
  heading: string;
  links: Array<{ label: string; href: string; external?: boolean }>;
}) {
  return (
    <div>
      <p className="font-display font-semibold text-sm text-navy mb-4 tracking-wide">
        {heading}
      </p>
      <ul className="flex flex-col gap-2.5" role="list">
        {links.map((link) => (
          <li key={link.label}>
            {link.external ? (
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-body text-sm text-muted-gray hover:text-teal transition-colors duration-150"
              >
                {link.label}
              </a>
            ) : (
              <Link
                href={link.href}
                className="font-body text-sm text-muted-gray hover:text-teal transition-colors duration-150"
              >
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Footer() {
  return (
    <footer className="bg-cream border-t border-teal-light" role="contentinfo">
      {/* ── Main grid ───────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-10 sm:pt-16 sm:pb-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-8">

          {/* ── Col 1: Brand ──────────────────────────────────────────── */}
          <div className="sm:col-span-2 lg:col-span-1">
            {/* Logo */}
            <Link
              href="/"
              className="inline-flex items-center gap-0.5 mb-4"
              aria-label="CompliLet — home"
            >
              <span className="font-display font-bold text-xl text-navy">
                CompliLet
              </span>
              <span
                className="w-1.5 h-1.5 rounded-full bg-teal mb-0.5 ml-0.5"
                aria-hidden="true"
              />
            </Link>

            {/* Tagline */}
            <p className="font-body text-sm text-muted-gray leading-relaxed max-w-[220px]">
              {COMPANY.secondaryTagline}
            </p>

            {/* Social icons */}
            <div className="flex items-center gap-3 mt-5">
              <a
                href={COMPANY.social.twitter}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="CompliLet on X (Twitter)"
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-gray hover:text-teal hover:bg-teal-light transition-colors duration-150"
              >
                <TwitterIcon />
              </a>
              <a
                href={COMPANY.social.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="CompliLet on LinkedIn"
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-gray hover:text-teal hover:bg-teal-light transition-colors duration-150"
              >
                <LinkedInIcon />
              </a>
              <a
                href={COMPANY.social.youtube}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="CompliLet on YouTube"
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-gray hover:text-teal hover:bg-teal-light transition-colors duration-150"
              >
                <YouTubeIcon />
              </a>
            </div>

            {/* WhatsApp CTA */}
            <a
              href={COMPANY.whatsappLink}
              target="_blank"
              rel="noopener noreferrer"
              className={[
                "inline-flex items-center gap-2 mt-6",
                "bg-whatsapp-green text-white",
                "font-body font-semibold text-sm",
                "px-4 py-2.5 rounded-full",
                "hover:brightness-105 transition-all duration-150",
                "shadow-card",
              ].join(" ")}
              aria-label="Start using CompliLet on WhatsApp"
            >
              {/* WhatsApp icon */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Start on WhatsApp
            </a>
          </div>

          {/* ── Col 2: Product ────────────────────────────────────────── */}
          <FooterLinkList heading="Product" links={COL_PRODUCT} />

          {/* ── Col 3: Resources ──────────────────────────────────────── */}
          <FooterLinkList heading="Resources" links={COL_RESOURCES} />

          {/* ── Col 4: Legal ──────────────────────────────────────────── */}
          <FooterLinkList heading="Legal" links={COL_LEGAL} />
        </div>
      </div>

      {/* ── Bottom bar ──────────────────────────────────────────────────── */}
      <div className="border-t border-teal-light">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="font-body text-xs text-muted-gray text-center sm:text-left">
            © 2026 AkomzyAi Consulting Ltd. All rights reserved.
          </p>
          <p className="font-body text-xs text-muted-gray flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#25D366" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            Powered by WhatsApp Business API
          </p>
        </div>
      </div>
    </footer>
  );
}
