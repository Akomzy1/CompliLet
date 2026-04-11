/**
 * Blog utilities — server-only (reads from filesystem via Node.js `fs`).
 * Import only in Server Components or in `generateStaticParams` / `generateMetadata`.
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PostFaq {
  question: string;
  answer: string;
}

export interface PostFrontmatter {
  title: string;
  description: string;
  date: string;
  lastModified: string;
  author: string;
  authorUrl?: string;
  keywords: string[];
  /** Slug of category — e.g. "tenant-screening", "compliance", "overseas-landlords" */
  category: string;
  faqs?: PostFaq[];
}

export interface PostMeta {
  slug: string;
  frontmatter: PostFrontmatter;
  readTime: number;
  /** First ~200 chars of body text, stripped of MDX syntax */
  excerpt: string;
}

export interface PostData extends PostMeta {
  /** Raw MDX body without frontmatter */
  content: string;
}

// ─── Paths ─────────────────────────────────────────────────────────────────────

const POSTS_DIR = path.join(process.cwd(), "content", "blog");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns reading time in minutes (200 wpm average). */
function calcReadTime(content: string): number {
  const wordCount = content.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(wordCount / 200));
}

/** Strips MDX/Markdown syntax and returns a plain-text excerpt. */
function makeExcerpt(content: string, maxChars = 200): string {
  const cleaned = content
    .replace(/^---[\s\S]*?---/m, "")          // remove frontmatter if any
    .replace(/^#+\s+.*$/gm, "")               // remove headings
    .replace(/\*\*|__|\*|_|~~|`/g, "")        // remove emphasis/code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")  // strip links to label
    .replace(/<[^>]+>/g, "")                  // remove HTML/JSX tags
    .replace(/\n+/g, " ")                     // collapse newlines
    .trim();
  return cleaned.length > maxChars
    ? cleaned.slice(0, maxChars).replace(/\s\S*$/, "") + "…"
    : cleaned;
}

// ─── Readers ──────────────────────────────────────────────────────────────────

export function getPostSlugs(): string[] {
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs
    .readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => f.replace(/\.mdx$/, ""));
}

export function getPostBySlug(slug: string): PostData {
  const filePath = path.join(POSTS_DIR, `${slug}.mdx`);
  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);
  const frontmatter = data as PostFrontmatter;
  const readTime = calcReadTime(content);
  const excerpt = makeExcerpt(content);
  return { slug, frontmatter, readTime, excerpt, content };
}

export function getAllPosts(): PostMeta[] {
  return getPostSlugs()
    .map((slug) => {
      const { frontmatter, readTime, excerpt } = getPostBySlug(slug);
      return { slug, frontmatter, readTime, excerpt };
    })
    .sort(
      (a, b) =>
        new Date(b.frontmatter.date).getTime() -
        new Date(a.frontmatter.date).getTime(),
    );
}

// ─── Category labels ──────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<string, string> = {
  "tenant-screening": "Tenant Screening",
  "compliance": "Compliance",
  "overseas-landlords": "Overseas Landlords",
  "renters-rights-act": "Renters' Rights Act",
};

export function getCategoryLabel(slug: string): string {
  return CATEGORY_LABELS[slug] ?? slug;
}
