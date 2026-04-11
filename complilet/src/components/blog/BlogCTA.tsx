import { COMPANY } from "@/lib/constants";

// ─── WhatsApp icon ─────────────────────────────────────────────────────────────

function WAIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="shrink-0">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * WhatsApp CTA block rendered at the end of every blog post.
 * Server Component — no "use client" needed.
 */
export function BlogCTA() {
  return (
    <aside
      aria-label="Try CompliLet on WhatsApp"
      className={[
        "not-prose",                            // escape Tailwind Typography if ever enabled
        "mt-12 rounded-2xl overflow-hidden",
        "bg-navy",
      ].join(" ")}
      style={{
        backgroundImage: [
          "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(13,148,136,0.18) 0%, transparent 65%)",
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Ccircle cx='18' cy='18' r='1' fill='%23ffffff' fill-opacity='0.04'/%3E%3C/svg%3E\")",
        ].join(", "),
      }}
    >
      <div className="px-6 py-10 sm:px-10 sm:py-12 flex flex-col items-center text-center gap-4">
        <p className="font-body font-semibold text-xs tracking-widest uppercase text-teal">
          Try it free
        </p>
        <h2 className="font-display font-bold text-white text-2xl sm:text-3xl leading-tight tracking-[-0.02em] max-w-sm">
          Screen Your Next Tenant in 24 Hours
        </h2>
        <p className="font-body text-base leading-relaxed max-w-xs" style={{ color: "rgba(253,248,240,0.75)" }}>
          No app. No dashboard. Just WhatsApp — and your first 3 screenings are free.
        </p>
        <a
          href={COMPANY.whatsappLink}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Start using CompliLet on WhatsApp — free first 3 screenings"
          className={[
            "inline-flex items-center gap-2.5 mt-1",
            "bg-whatsapp-green text-white",
            "font-body font-semibold text-base",
            "px-7 py-3.5 rounded-full min-h-[52px]",
            "hover:brightness-105 transition-all duration-150 shadow-card",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal",
          ].join(" ")}
        >
          <WAIcon />
          Start on WhatsApp →
        </a>
        <p className="font-body text-xs" style={{ color: "rgba(224,245,243,0.5)" }}>
          Free for your first 3 screenings · No credit card needed
        </p>
      </div>
    </aside>
  );
}
