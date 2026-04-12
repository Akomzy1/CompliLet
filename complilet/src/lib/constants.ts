// ─── Company Info ─────────────────────────────────────────────────────────────

export const COMPANY = {
  name: "CompliLet",
  tagline: "Stay Compliant. Stay Letting.",
  secondaryTagline: "WhatsApp-Native AI Property Management for UK Landlords",
  email: "hello@complilet.com",
  supportEmail: "support@complilet.com",
  website: "https://complilet.com",
  domain: "complilet.com",
  /** TODO: Replace with real WhatsApp Business number before launch */
  whatsappLink: "https://wa.me/447700000000?text=Hi%2C%20I%27d%20like%20to%20get%20started%20with%20CompliLet",
  whatsappNumber: "+44 7700 000000",
  social: {
    linkedin: "https://linkedin.com/company/complilet",
    twitter: "https://twitter.com/complilet",
    youtube: "https://youtube.com/@complilet",
  },
  legalName: "CompliLet Ltd",
  registeredCountry: "England and Wales",
} as const;

// ─── Brand Colours ─────────────────────────────────────────────────────────────

export const BRAND_COLORS = {
  navy: "#0F2B46",
  teal: "#0D9488",
  tealLight: "#E0F5F3",
  cream: "#FDF8F0",
  whatsappGreen: "#25D366",
  darkText: "#111827",
  mutedGray: "#6B7280",
  alertRed: "#DC2626",
  successGreen: "#16A34A",
} as const;

// ─── Pricing Tiers ─────────────────────────────────────────────────────────────

export type BillingInterval = "per-screening" | "monthly" | "per-property-monthly";

export interface PricingFeature {
  text: string;
  included: boolean;
}

export interface PricingTier {
  id: string;
  name: string;
  price: number;
  currency: "GBP";
  interval: BillingInterval;
  intervalLabel: string;
  description: string;
  badge?: string;
  highlighted?: boolean;
  features: PricingFeature[];
  cta: string;
  ctaLink: string;
}

export const PRICING_TIERS: PricingTier[] = [
  {
    id: "pay-per-screen",
    name: "Pay-Per-Screen",
    price: 4.99,
    currency: "GBP",
    interval: "per-screening",
    intervalLabel: "per screening",
    description: "For landlords who screen occasionally. No subscription needed.",
    features: [
      { text: "Full AI tenant screening conversation", included: true },
      { text: "Right to Rent document check", included: true },
      { text: "Basic screening report", included: true },
      { text: "WhatsApp-native — no app needed", included: true },
      { text: "Reference chasing", included: false },
      { text: "Move-in pack generation", included: false },
      { text: "Compliance autopilot", included: false },
    ],
    cta: "Start on WhatsApp",
    ctaLink: COMPANY.whatsappLink,
  },
  {
    id: "landlord-pro",
    name: "Landlord Pro",
    price: 19.99,
    currency: "GBP",
    interval: "monthly",
    intervalLabel: "per month",
    description: "Unlimited screenings + priority response for up to 3 properties.",
    features: [
      { text: "Everything in Pay-Per-Screen", included: true },
      { text: "Unlimited screenings", included: true },
      { text: "Priority agent response", included: true },
      { text: "Custom screening criteria", included: true },
      { text: "Document archive (12 months)", included: true },
      { text: "Compliance dashboard", included: true },
      { text: "Post-move-in management suite", included: false },
    ],
    cta: "Start Free Trial",
    ctaLink: COMPANY.whatsappLink,
  },
  {
    id: "tenancy-manager",
    name: "Tenancy Manager",
    price: 14.99,
    currency: "GBP",
    interval: "per-property-monthly",
    intervalLabel: "per property / month",
    description: "Full lifecycle management per property — from screening to renewal.",
    badge: "Most Popular",
    highlighted: true,
    features: [
      { text: "Post-move-in management suite", included: true },
      { text: "Compliance autopilot", included: true },
      { text: "Rent reminders + arrears chasing", included: true },
      { text: "Maintenance triage (AI)", included: true },
      { text: "Quarterly inspection reports", included: true },
      { text: "Activates after screening", included: true },
      { text: "Multi-property dashboard", included: false },
    ],
    cta: "Start on WhatsApp",
    ctaLink: COMPANY.whatsappLink,
  },
  {
    id: "portfolio",
    name: "Portfolio",
    price: 39.99,
    currency: "GBP",
    interval: "monthly",
    intervalLabel: "per month",
    description: "Flat-rate management for landlords with up to 10 properties.",
    features: [
      { text: "Up to 10 properties", included: true },
      { text: "All Tenancy Manager features", included: true },
      { text: "Renewal agent", included: true },
      { text: "Priority WhatsApp support", included: true },
      { text: "Compliance reporting dashboard", included: true },
      { text: "Contractor marketplace access", included: true },
      { text: "Overseas landlord NRL support", included: false },
    ],
    cta: "Start on WhatsApp",
    ctaLink: COMPANY.whatsappLink,
  },
  {
    id: "global-landlord",
    name: "Global Landlord",
    price: 29.99,
    currency: "GBP",
    interval: "per-property-monthly",
    intervalLabel: "per property / month",
    description: "Built for overseas landlords managing UK properties remotely.",
    badge: "Overseas",
    features: [
      { text: "All Tenancy Manager features", included: true },
      { text: "NRL tax agent (HMRC NRL1 compliance)", included: true },
      { text: "Timezone-aware 24/7 agent coverage", included: true },
      { text: "Document storage (GDPR-compliant)", included: true },
      { text: "Overseas bank transfer guidance", included: true },
      { text: "Renewal agent", included: true },
      { text: "Contractor marketplace access", included: true },
    ],
    cta: "Start on WhatsApp",
    ctaLink: COMPANY.whatsappLink,
  },
];

// ─── Navigation ────────────────────────────────────────────────────────────────

export const NAV_LINKS = [
  { label: "How It Works", href: "/how-it-works" },
  { label: "Pricing", href: "/pricing" },
  { label: "Blog", href: "/blog" },
  { label: "For Overseas Landlords", href: "/#overseas" },
] as const;

// ─── UK Compliance Facts (used in copy & GEO-optimised content) ───────────────

export const COMPLIANCE_FACTS = {
  rightToRentFine: "£3,000",
  gasSafetyFine: "£6,000",
  rentersRightsActDate: "1 May 2026",
  avgManualScreeningDays: 14,
  compliletScreeningHours: 24,
  ukSelfManagingLandlords: "1.1 million",
  overseasLandlords: "300,000+",
  landlordsManagedManually: "78%",
  landlordsUsingWhatsApp: "92%",
  avgTenancyYears: 4.5,
  depositProtectionDeadlineDays: 30,
} as const;

// ─── SEO Defaults ─────────────────────────────────────────────────────────────

export const SEO_DEFAULTS = {
  title: "CompliLet — Stay Compliant. Stay Letting.",
  titleTemplate: "%s | CompliLet",
  description:
    "AI-powered WhatsApp tenant screening and compliance management for UK self-managing landlords. Screen tenants, chase references, stay Right to Rent compliant — all from WhatsApp. No app download needed.",
  keywords: [
    "tenant screening UK",
    "tenant screening without letting agent",
    "Right to Rent checklist 2026",
    "self-managing landlord UK",
    "landlord compliance checklist 2026",
    "manage UK property from abroad",
    "overseas landlord UK",
    "WhatsApp property management",
    "tenant referencing UK",
  ],
  ogImage: "/og-image.png",
  ogImageAlt: "CompliLet — WhatsApp-Native AI Tenant Screening for UK Landlords",
  twitterHandle: "@complilet",
  locale: "en_GB",
  siteUrl: "https://complilet.com",
} as const;

// ─── Trust Badges ──────────────────────────────────────────────────────────────

export const TRUST_BADGES = [
  { label: "ICO Registered", icon: "shield" },
  { label: "GDPR Compliant", icon: "lock" },
  { label: "Bank-Grade Encryption", icon: "key" },
  { label: "Ombudsman-Ready Records", icon: "file-check" },
  { label: "Right to Rent Verified", icon: "badge-check" },
] as const;

// ─── Compliance Deadlines (for agents and marketing copy) ─────────────────────

export const COMPLIANCE_DEADLINES = {
  gasInspectionMonths: 12,
  epcValidYears: 10,
  electricalInspectionYears: 5,
  depositProtectionDays: 30,
  depositPrescribedInfoDays: 30,
  section21NoticeWeeks: 2,
} as const;
