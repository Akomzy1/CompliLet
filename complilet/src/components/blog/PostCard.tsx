import Link from "next/link";
import type { PostMeta } from "@/lib/blog";
import { getCategoryLabel } from "@/lib/blog";

// ─── Category colour pills ─────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<string, string> = {
  "tenant-screening":  "bg-teal-light text-teal",
  "compliance":        "bg-navy/8 text-navy",
  "overseas-landlords":"bg-amber-50 text-amber-700",
  "renters-rights-act":"bg-red-50 text-alert-red",
};

function CategoryPill({ category }: { category: string }) {
  const style = CATEGORY_STYLES[category] ?? "bg-teal-light text-teal";
  return (
    <span
      className={[
        "inline-block px-2.5 py-0.5 rounded-full",
        "font-body font-semibold text-xs tracking-wide uppercase",
        style,
      ].join(" ")}
    >
      {getCategoryLabel(category)}
    </span>
  );
}

// ─── Date formatter ───────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PostCard({ post }: { post: PostMeta }) {
  const { slug, frontmatter, readTime, excerpt } = post;

  return (
    <article
      className={[
        "group flex flex-col",
        "bg-white rounded-2xl border border-teal-light",
        "shadow-card hover:shadow-card-hover",
        "transition-shadow duration-200",
        "overflow-hidden",
      ].join(" ")}
    >
      {/* Top accent line */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-teal/30 to-transparent" />

      <div className="flex flex-col gap-3 p-6 flex-1">
        {/* Category + read time */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CategoryPill category={frontmatter.category} />
          <span className="font-body text-xs text-muted-gray whitespace-nowrap">
            {readTime} min read
          </span>
        </div>

        {/* Title */}
        <h2 className="font-display font-bold text-lg sm:text-xl text-navy leading-snug tracking-[-0.02em] group-hover:text-teal transition-colors duration-150">
          <Link
            href={`/blog/${slug}`}
            className="focus-visible:outline-2 focus-visible:outline-teal focus-visible:outline-offset-2 rounded-sm"
          >
            {frontmatter.title}
          </Link>
        </h2>

        {/* Excerpt */}
        <p className="font-body text-sm text-muted-gray leading-relaxed flex-1">
          {excerpt}
        </p>

        {/* Footer: date + read link */}
        <div className="flex items-center justify-between gap-4 pt-3 border-t border-teal-light/60 mt-auto">
          <time
            dateTime={frontmatter.date}
            className="font-body text-xs text-muted-gray"
          >
            {formatDate(frontmatter.date)}
          </time>
          <Link
            href={`/blog/${slug}`}
            className={[
              "font-body font-semibold text-xs text-teal",
              "hover:underline underline-offset-2",
              "focus-visible:outline-2 focus-visible:outline-teal focus-visible:outline-offset-2 rounded-sm",
              "flex items-center gap-1 shrink-0",
            ].join(" ")}
            aria-label={`Read ${frontmatter.title}`}
          >
            Read article
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2 6h8M6 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </div>
    </article>
  );
}
