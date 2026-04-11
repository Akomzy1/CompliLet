import Link from "next/link";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Crumb {
  label: string;
  href?: string;
}

// ─── Separator ────────────────────────────────────────────────────────────────

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0 text-muted-gray/50">
      <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-8">
      <ol
        className="flex flex-wrap items-center gap-1.5 font-body text-sm text-muted-gray"
        role="list"
      >
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={crumb.label} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight />}
              {crumb.href && !isLast ? (
                <Link
                  href={crumb.href}
                  className="hover:text-teal transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-teal focus-visible:outline-offset-1 rounded-sm"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={isLast ? "text-dark-text font-medium" : undefined}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ─── BreadcrumbList JSON-LD builder ───────────────────────────────────────────

export function buildBreadcrumbSchema(crumbs: Crumb[], siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.label,
      ...(crumb.href ? { item: `${siteUrl}${crumb.href}` } : {}),
    })),
  };
}
