/**
 * Organization JSON-LD schema component.
 *
 * Renders the Organization schema defined in @/lib/seo into a server-side
 * <script> tag. Must be used in a Server Component or layout so the JSON-LD
 * appears in the initial HTML — not JS-injected (which AI crawlers skip).
 *
 * The root layout.tsx already injects this schema globally. This component
 * exists for pages that need to override or extend it (e.g., an About page
 * with richer Organization data), or for use in testing/storybook.
 *
 * @example
 * // In src/app/layout.tsx (already done — see root layout):
 * <OrganizationSchema />
 *
 * // Or in a specific page that wants to re-emit it independently:
 * <OrganizationSchema />
 */

import { buildOrganizationSchema, serializeSchema } from "@/lib/seo";

export function OrganizationSchema() {
  const schema = buildOrganizationSchema();

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeSchema(schema) }}
    />
  );
}
