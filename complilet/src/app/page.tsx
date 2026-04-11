import type { Metadata } from "next";
import { SEO_DEFAULTS } from "@/lib/constants";

// ─── Sections ─────────────────────────────────────────────────────────────────
import { Hero } from "@/components/sections/Hero";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Features } from "@/components/sections/Features";
import { OverseasLandlords } from "@/components/sections/OverseasLandlords";
import { Pricing } from "@/components/sections/Pricing";
import { FAQ } from "@/components/sections/FAQ";
import { FinalCTA } from "@/components/sections/FinalCTA";

// ─── SEO schemas ──────────────────────────────────────────────────────────────
import { ProductSchema } from "@/components/seo/ProductSchema";
import { FAQSchema } from "@/components/seo/FAQSchema";

// ─── Page metadata ────────────────────────────────────────────────────────────
export const metadata: Metadata = {
  title: SEO_DEFAULTS.title,
  description: SEO_DEFAULTS.description,
  alternates: {
    canonical: SEO_DEFAULTS.siteUrl,
  },
};

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function HomePage() {
  return (
    <>
      {/* SoftwareApplication schema — homepage only */}
      <ProductSchema />

      {/* FAQPage schema — AI crawlers + Bing rich results */}
      <FAQSchema />

      <main id="main-content">
        {/* 1. Hero + social proof bar (social proof is rendered inside Hero) */}
        <Hero />

        {/* 2. How It Works — 6-step WhatsApp walkthrough */}
        <HowItWorks />

        {/* 3. Features — capability grid */}
        <Features />

        {/* 4. Overseas Landlords — dedicated section with world map */}
        <OverseasLandlords />

        {/* 5. Pricing — 5-tier cards */}
        <Pricing />

        {/* 6. FAQ — GEO-optimised Q&A */}
        <FAQ />

        {/* 7. Final CTA */}
        <FinalCTA />
      </main>
    </>
  );
}
