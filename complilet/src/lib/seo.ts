import type { Metadata } from "next";
import { SEO_DEFAULTS, COMPANY } from "./constants";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface PageSeoOptions {
  title?: string;
  description?: string;
  path?: string;
  ogImage?: string;
  ogImageAlt?: string;
  noIndex?: boolean;
  keywords?: string[];
}

// ─── Metadata Builder ─────────────────────────────────────────────────────────

/**
 * Builds a Next.js Metadata object for a given page.
 * Pass `title` without the site name — the template adds it automatically.
 */
export function buildMetadata(options: PageSeoOptions = {}): Metadata {
  const {
    title,
    description = SEO_DEFAULTS.description,
    path = "",
    ogImage = SEO_DEFAULTS.ogImage,
    ogImageAlt = SEO_DEFAULTS.ogImageAlt,
    noIndex = false,
    keywords = SEO_DEFAULTS.keywords,
  } = options;

  const canonicalUrl = `${SEO_DEFAULTS.siteUrl}${path}`;

  return {
    title: title
      ? { absolute: `${title} | CompliLet` }
      : SEO_DEFAULTS.title,
    description,
    keywords: keywords.join(", "),
    authors: [{ name: COMPANY.legalName, url: COMPANY.website }],
    creator: COMPANY.name,
    publisher: COMPANY.name,
    robots: noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true, googleBot: { index: true, follow: true } },
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      type: "website",
      url: canonicalUrl,
      siteName: COMPANY.name,
      title: title ? `${title} | CompliLet` : SEO_DEFAULTS.title,
      description,
      locale: SEO_DEFAULTS.locale,
      images: [
        {
          url: `${SEO_DEFAULTS.siteUrl}${ogImage}`,
          alt: ogImageAlt,
          width: 1200,
          height: 630,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      site: SEO_DEFAULTS.twitterHandle,
      creator: SEO_DEFAULTS.twitterHandle,
      title: title ? `${title} | CompliLet` : SEO_DEFAULTS.title,
      description,
      images: [`${SEO_DEFAULTS.siteUrl}${ogImage}`],
    },
  };
}

// ─── JSON-LD Schemas ──────────────────────────────────────────────────────────

/** Organisation schema — used on every page via root layout */
export function buildOrganizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: COMPANY.name,
    legalName: COMPANY.legalName,
    url: COMPANY.website,
    logo: `${SEO_DEFAULTS.siteUrl}/logo.png`,
    description: SEO_DEFAULTS.description,
    foundingLocation: {
      "@type": "Place",
      addressCountry: "GB",
    },
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer service",
      email: COMPANY.supportEmail,
      availableLanguage: "English",
    },
    areaServed: {
      "@type": "Country",
      name: "United Kingdom",
    },
    sameAs: [
      COMPANY.social.linkedin,
      COMPANY.social.twitter,
      COMPANY.social.youtube,
    ],
  };
}

/** SoftwareApplication schema — used on homepage and pricing page */
export function buildSoftwareApplicationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: COMPANY.name,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Property Management",
    operatingSystem: "WhatsApp, iOS, Android",
    description:
      "WhatsApp-native AI tenant screening and property compliance management for UK self-managing landlords.",
    url: COMPANY.website,
    offers: [
      {
        "@type": "Offer",
        name: "Pay-Per-Screen",
        price: "4.99",
        priceCurrency: "GBP",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: "4.99",
          priceCurrency: "GBP",
          unitText: "per screening",
        },
      },
      {
        "@type": "Offer",
        name: "Landlord Pro",
        price: "19.99",
        priceCurrency: "GBP",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: "19.99",
          priceCurrency: "GBP",
          unitText: "per month",
        },
      },
    ],
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.9",
      reviewCount: "1",
      bestRating: "5",
    },
  };
}

/** Article schema — used on blog post pages */
export function buildArticleSchema(options: {
  title: string;
  description: string;
  slug: string;
  datePublished: string;
  dateModified: string;
  authorName: string;
  authorUrl?: string;
  image?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: options.title,
    description: options.description,
    url: `${SEO_DEFAULTS.siteUrl}/blog/${options.slug}`,
    datePublished: options.datePublished,
    dateModified: options.dateModified,
    image: options.image
      ? `${SEO_DEFAULTS.siteUrl}${options.image}`
      : `${SEO_DEFAULTS.siteUrl}${SEO_DEFAULTS.ogImage}`,
    author: {
      "@type": "Person",
      name: options.authorName,
      ...(options.authorUrl && { url: options.authorUrl }),
    },
    publisher: {
      "@type": "Organization",
      name: COMPANY.name,
      logo: {
        "@type": "ImageObject",
        url: `${SEO_DEFAULTS.siteUrl}/logo.png`,
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${SEO_DEFAULTS.siteUrl}/blog/${options.slug}`,
    },
  };
}

/** WebSite schema with sitelinks searchbox — used in root layout */
export function buildWebSiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: COMPANY.name,
    url: COMPANY.website,
    description: SEO_DEFAULTS.description,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${COMPANY.website}/blog?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

// ─── JSON-LD Renderer ─────────────────────────────────────────────────────────

/** Serialises a schema object to a safe JSON string for dangerouslySetInnerHTML */
export function serializeSchema(schema: object): string {
  return JSON.stringify(schema).replace(/</g, "\\u003c");
}
