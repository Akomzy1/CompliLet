/**
 * SoftwareApplication (Product) JSON-LD schema component.
 *
 * Renders the SoftwareApplication schema defined in @/lib/seo. Include this
 * on the homepage and pricing page to help Google, Bing, and AI search
 * engines understand CompliLet's offering, pricing, and application category.
 *
 * Schema type: SoftwareApplication (not deprecated as of 2026)
 * Key signals for AI citation:
 *  - applicationCategory: "BusinessApplication"
 *  - offers: pricing tiers with GBP amounts
 *  - operatingSystem: "WhatsApp" — communicates no-app proposition
 *
 * Must be a Server Component (no "use client") to ensure JSON-LD is in the
 * initial HTML response. AI crawlers do not execute JavaScript.
 *
 * @example
 * // src/app/page.tsx (homepage):
 * import { ProductSchema } from "@/components/seo/ProductSchema";
 *
 * export default function HomePage() {
 *   return (
 *     <>
 *       <ProductSchema />
 *       <Hero />
 *       ...
 *     </>
 *   );
 * }
 */

import { buildSoftwareApplicationSchema, serializeSchema } from "@/lib/seo";

export function ProductSchema() {
  const schema = buildSoftwareApplicationSchema();

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeSchema(schema) }}
    />
  );
}
