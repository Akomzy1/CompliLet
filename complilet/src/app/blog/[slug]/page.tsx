import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { compileMDX } from "next-mdx-remote/rsc";
import { getPostBySlug, getPostSlugs, getCategoryLabel } from "@/lib/blog";
import { buildArticleSchema, serializeSchema } from "@/lib/seo";
import { SEO_DEFAULTS, COMPANY } from "@/lib/constants";
import { Breadcrumb, buildBreadcrumbSchema } from "@/components/blog/Breadcrumb";
import { BlogCTA } from "@/components/blog/BlogCTA";
import type { PostFrontmatter } from "@/lib/blog";

// ─── Custom MDX components ────────────────────────────────────────────────────

function Callout({
  type = "info",
  children,
}: {
  type?: "info" | "warning" | "tip";
  children: React.ReactNode;
}) {
  const STYLES = {
    info:    { wrapper: "bg-teal-light/60 border-teal",       icon: "ℹ️" },
    warning: { wrapper: "bg-red-50 border-alert-red",          icon: "⚠️" },
    tip:     { wrapper: "bg-cream border-teal-light",          icon: "💡" },
  };
  const s = STYLES[type];
  return (
    <div className={`border-l-4 rounded-r-xl p-4 my-6 ${s.wrapper}`}>
      <div className="flex gap-3 items-start">
        <span className="mt-0.5 text-base shrink-0">{s.icon}</span>
        <div className="font-body text-sm text-dark-text leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

const MDX_COMPONENTS = { Callout };

// ─── Static params ────────────────────────────────────────────────────────────

export async function generateStaticParams() {
  return getPostSlugs().map((slug) => ({ slug }));
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  let post;
  try {
    post = getPostBySlug(slug);
  } catch {
    return {};
  }

  const { frontmatter } = post;
  const canonicalUrl = `${SEO_DEFAULTS.siteUrl}/blog/${slug}`;

  return {
    title: { absolute: `${frontmatter.title} | CompliLet` },
    description: frontmatter.description,
    keywords: frontmatter.keywords.join(", "),
    authors: [{ name: frontmatter.author, url: frontmatter.authorUrl ?? COMPANY.website }],
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: "article",
      url: canonicalUrl,
      siteName: COMPANY.name,
      title: `${frontmatter.title} | CompliLet`,
      description: frontmatter.description,
      locale: SEO_DEFAULTS.locale,
      publishedTime: frontmatter.date,
      modifiedTime: frontmatter.lastModified,
      authors: [frontmatter.author],
      images: [
        {
          url: `${SEO_DEFAULTS.siteUrl}${SEO_DEFAULTS.ogImage}`,
          alt: frontmatter.title,
          width: 1200,
          height: 630,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      site: SEO_DEFAULTS.twitterHandle,
      creator: SEO_DEFAULTS.twitterHandle,
      title: `${frontmatter.title} | CompliLet`,
      description: frontmatter.description,
      images: [`${SEO_DEFAULTS.siteUrl}${SEO_DEFAULTS.ogImage}`],
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function buildFAQSchema(faqs: PostFrontmatter["faqs"]) {
  if (!faqs || faqs.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let post;
  try {
    post = getPostBySlug(slug);
  } catch {
    notFound();
  }

  const { frontmatter, content, readTime } = post;

  // Compile MDX on the server
  const { content: mdxContent } = await compileMDX<PostFrontmatter>({
    source: content,
    components: MDX_COMPONENTS,
    options: { parseFrontmatter: false },
  });

  // Build schemas
  const articleSchema = buildArticleSchema({
    title: frontmatter.title,
    description: frontmatter.description,
    slug,
    datePublished: frontmatter.date,
    dateModified: frontmatter.lastModified,
    authorName: frontmatter.author,
    authorUrl: frontmatter.authorUrl,
  });

  const faqSchema = buildFAQSchema(frontmatter.faqs);

  const breadcrumbSchema = buildBreadcrumbSchema(
    [
      { label: "Home", href: "/" },
      { label: "Blog", href: "/blog" },
      { label: frontmatter.title },
    ],
    SEO_DEFAULTS.siteUrl,
  );

  return (
    <>
      {/* ── JSON-LD Schemas ──────────────────────────────────────────────── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeSchema(articleSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeSchema(breadcrumbSchema) }}
      />
      {faqSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeSchema(faqSchema) }}
        />
      )}

      <main id="main-content" className="bg-cream">
        {/* ── Article header ───────────────────────────────────────────── */}
        <header className="bg-white border-b border-teal-light">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-8">
            <Breadcrumb
              crumbs={[
                { label: "Home", href: "/" },
                { label: "Blog", href: "/blog" },
                { label: frontmatter.title },
              ]}
            />

            {/* Category pill */}
            <span className="inline-block px-2.5 py-0.5 rounded-full bg-teal-light text-teal font-body font-semibold text-xs tracking-wide uppercase mb-4">
              {getCategoryLabel(frontmatter.category)}
            </span>

            <h1 className="font-display font-bold text-navy text-2xl sm:text-3xl lg:text-4xl leading-tight tracking-[-0.02em] mb-5">
              {frontmatter.title}
            </h1>

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-body text-sm text-muted-gray">
              <span>{frontmatter.author}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={frontmatter.date}>{formatDate(frontmatter.date)}</time>
              <span aria-hidden="true">·</span>
              <span>{readTime} min read</span>
              {frontmatter.lastModified !== frontmatter.date && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Updated <time dateTime={frontmatter.lastModified}>{formatDate(frontmatter.lastModified)}</time></span>
                </>
              )}
            </div>
          </div>
        </header>

        {/* ── Article body ─────────────────────────────────────────────── */}
        <article
          className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12 blog-prose"
          aria-labelledby="article-heading"
        >
          {mdxContent}

          {/* ── WhatsApp CTA ──────────────────────────────────────────── */}
          <BlogCTA />
        </article>

        {/* ── Back to blog ─────────────────────────────────────────────── */}
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pb-14 sm:pb-16">
          <a
            href="/blog"
            className="inline-flex items-center gap-2 font-body font-semibold text-sm text-teal hover:underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-teal rounded-sm"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to Blog
          </a>
        </div>
      </main>
    </>
  );
}
