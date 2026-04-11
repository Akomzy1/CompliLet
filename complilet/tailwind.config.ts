import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: "#0F2B46",
        teal: {
          DEFAULT: "#0D9488",
          light: "#E0F5F3",
        },
        cream: "#FDF8F0",
        "whatsapp-green": "#25D366",
        "dark-text": "#111827",
        "muted-gray": "#6B7280",
        "alert-red": "#DC2626",
        "success-green": "#16A34A",
      },
      fontFamily: {
        display: ["var(--font-clash-display)", "sans-serif"],
        body: ["var(--font-outfit)", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      backgroundImage: {
        "gradient-navy": "linear-gradient(135deg, #0F2B46 0%, #163d5e 100%)",
        "gradient-teal": "linear-gradient(135deg, #0D9488 0%, #0f766e 100%)",
      },
      boxShadow: {
        trust: "0 4px 24px rgba(15, 43, 70, 0.12)",
        card: "0 2px 12px rgba(15, 43, 70, 0.08)",
        "card-hover": "0 8px 32px rgba(15, 43, 70, 0.16)",
      },
      animation: {
        "typing-dot": "typingDot 1.2s ease-in-out infinite",
        "fade-up": "fadeUp 0.5s ease-out forwards",
        "fade-in": "fadeIn 0.4s ease-out forwards",
      },
      keyframes: {
        typingDot: {
          "0%, 60%, 100%": { transform: "translateY(0)", opacity: "0.4" },
          "30%": { transform: "translateY(-6px)", opacity: "1" },
        },
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      maxWidth: {
        "8xl": "88rem",
      },
    },
  },
  plugins: [],
};

export default config;
