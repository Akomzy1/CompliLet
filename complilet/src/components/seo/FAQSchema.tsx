/**
 * FAQPage JSON-LD schema component.
 *
 * NOTE ON GOOGLE RICH RESULTS:
 * Google restricted FAQPage rich results to government and healthcare
 * authority sites in August 2023. This schema will NOT trigger FAQ rich
 * results in Google SERPs for a commercial site.
 *
 * WHY INCLUDE IT ANYWAY:
 *  1. Bing and Yandex still use FAQPage schema for rich snippets.
 *  2. AI crawlers (ChatGPT, Perplexity, Claude) parse structured data
 *     to identify Q&A content — this improves GEO citability.
 *  3. Future-proofing: Google policy may relax for certain categories.
 *  4. The structured data helps Google understand page content even
 *     without producing a rich result.
 *
 * IMPORTANT: This component must be used in a Server Component or
 * Next.js page/layout, never client-side, to ensure JSON-LD is in the
 * initial HTML response (not JS-injected — which AI crawlers skip).
 */

import { FAQS } from "@/lib/faq-data";
import { serializeSchema } from "@/lib/seo";

// ─── Schema builder ───────────────────────────────────────────────────────────

function buildFAQSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Renders FAQPage JSON-LD into a `<script>` tag.
 * Place this inside a `<head>` or directly in a page Server Component.
 *
 * @example
 * // In a Next.js page or layout (Server Component):
 * import { FAQSchema } from "@/components/seo/FAQSchema";
 *
 * export default function Page() {
 *   return (
 *     <>
 *       <FAQSchema />
 *       <FAQ />
 *     </>
 *   );
 * }
 */
export function FAQSchema() {
  const schema = buildFAQSchema();

  return (
    <script
      type="application/ld+json"
      // serializeSchema escapes < to prevent XSS via </script> injection
      dangerouslySetInnerHTML={{ __html: serializeSchema(schema) }}
    />
  );
}
