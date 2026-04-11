import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/react";
import "../styles/globals.css";
import {
  buildOrganizationSchema,
  buildWebSiteSchema,
  serializeSchema,
} from "@/lib/seo";
import { SEO_DEFAULTS, COMPANY } from "@/lib/constants";

// ─── Layout components ────────────────────────────────────────────────────────
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileStickyBar } from "@/components/layout/MobileStickyBar";

// ─── Fonts ─────────────────────────────────────────────────────────────────────
// Outfit: loaded via next/font for optimal performance + CLS prevention
const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

// Clash Display: self-hosted via Fontshare CDN (loaded in <head> below)
// CSS variable: --font-clash-display  |  Tailwind: font-display

// ─── Viewport ─────────────────────────────────────────────────────────────────
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0F2B46" },
  ],
};

// ─── Root Metadata ─────────────────────────────────────────────────────────────
export const metadata: Metadata = {
  title: {
    default: SEO_DEFAULTS.title,
    template: SEO_DEFAULTS.titleTemplate,
  },
  description: SEO_DEFAULTS.description,
  keywords: SEO_DEFAULTS.keywords.join(", "),
  authors: [{ name: COMPANY.legalName, url: COMPANY.website }],
  creator: COMPANY.name,
  publisher: COMPANY.name,
  metadataBase: new URL(SEO_DEFAULTS.siteUrl),
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: SEO_DEFAULTS.siteUrl,
  },
  openGraph: {
    type: "website",
    url: SEO_DEFAULTS.siteUrl,
    siteName: COMPANY.name,
    title: SEO_DEFAULTS.title,
    description: SEO_DEFAULTS.description,
    locale: SEO_DEFAULTS.locale,
    images: [
      {
        url: SEO_DEFAULTS.ogImage,
        alt: SEO_DEFAULTS.ogImageAlt,
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: SEO_DEFAULTS.twitterHandle,
    creator: SEO_DEFAULTS.twitterHandle,
    title: SEO_DEFAULTS.title,
    description: SEO_DEFAULTS.description,
    images: [SEO_DEFAULTS.ogImage],
  },
  verification: {
    // google: "TODO: add Google Search Console verification token",
  },
  other: {
    // Allow AI search crawlers — critical for GEO visibility
    "robots-ai": "index, follow",
  },
};

// ─── JSON-LD Schemas ──────────────────────────────────────────────────────────
// Organization and WebSite schemas appear on every page — rendered in <head>
const organizationSchema = buildOrganizationSchema();
const webSiteSchema = buildWebSiteSchema();

// ─── Root Layout ──────────────────────────────────────────────────────────────
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GB" className={`${outfit.variable} h-full`}>
      <head>
        {/* Clash Display — Fontshare CDN */}
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link
          href="https://api.fontshare.com/v2/css?f[]=clash-display@700,600,500,400&display=swap"
          rel="stylesheet"
        />
        {/* CSS variable mapping for Clash Display */}
        <style>{`
          :root {
            --font-clash-display: "Clash Display";
          }
        `}</style>

        {/* Organisation JSON-LD — on every page */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeSchema(organizationSchema) }}
        />
        {/* WebSite JSON-LD — enables sitelinks searchbox */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeSchema(webSiteSchema) }}
        />
      </head>
      <body className="font-body antialiased bg-cream text-dark-text min-h-dvh flex flex-col">
        {/* Skip to main content — keyboard / screen reader accessibility */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:bg-white focus:text-navy focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lg focus:font-semibold focus:text-sm"
        >
          Skip to main content
        </a>

        <Header />

        {/* flex-1 ensures footer stays at bottom when content is short */}
        <div className="flex-1 flex flex-col">
          {children}
        </div>

        <Footer />

        {/* Mobile sticky WhatsApp bar — shown after hero scrolls out of view */}
        <MobileStickyBar />

        <Analytics />

        {/* Google Analytics 4 — loaded only when measurement ID is configured */}
        {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga4-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}', {
                  page_path: window.location.pathname,
                });
              `}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
