import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ── Output ───────────────────────────────────────────────────────────────
  // Vercel handles deployment — no static export needed
  // output: "standalone" can be enabled for Docker

  // ── Images ───────────────────────────────────────────────────────────────
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [375, 640, 768, 1024, 1280, 1536],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
  },

  // ── Security Headers ─────────────────────────────────────────────────────
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Strict Transport Security
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Prevent MIME sniffing
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          // Prevent clickjacking
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          // Referrer policy
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // Permissions policy — disable unnecessary browser APIs
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // XSS Protection (legacy browsers)
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
        ],
      },
      // ── Font CDN CORS ─────────────────────────────────────────────────
      {
        source: "/fonts/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },

  // ── Redirects ────────────────────────────────────────────────────────────
  async redirects() {
    return [
      // Canonical trailing-slash normalisation
      {
        source: "/pricing/",
        destination: "/pricing",
        permanent: true,
      },
      {
        source: "/how-it-works/",
        destination: "/how-it-works",
        permanent: true,
      },
      {
        source: "/blog/",
        destination: "/blog",
        permanent: true,
      },
    ];
  },

  // ── Logging (reduce noise in dev) ────────────────────────────────────────
  logging: {
    fetches: {
      fullUrl: process.env.NODE_ENV === "development",
    },
  },

  // ── Experimental ─────────────────────────────────────────────────────────
  experimental: {
    // optimisticClientCache is enabled by default in Next.js 15
  },
};

export default nextConfig;
