# CompliLet — Project Instructions

## Project Overview

CompliLet is a WhatsApp-native, AI-powered tenant screening and tenancy management platform for UK self-managing landlords. The product operates entirely within WhatsApp — no app download, no dashboard login. A managed agent system orchestrates multi-step workflows: tenant pre-qualification, document collection, Right to Rent compliance, reference chasing, move-in pack generation, and ongoing tenancy management (rent reminders, compliance autopilot, maintenance triage, inspections, renewals).

## Brand Identity

- **Name**: CompliLet
- **Tagline**: "Stay Compliant. Stay Letting."
- **Secondary tagline**: "WhatsApp-Native AI Property Management for UK Landlords"
- **Voice**: Professional but approachable. Direct, no jargon. Speaks like a knowledgeable friend who happens to be a property expert.
- **Target audience**: UK self-managing landlords (1.1M), overseas landlords managing UK properties (300K+)

## Design System

### Brand Colors
- **Primary Navy**: #0F2B46 (headings, hero backgrounds, trust elements)
- **Primary Teal**: #0D9488 (CTAs, accents, active states, links)
- **Cream**: #FDF8F0 (page backgrounds, light sections)
- **Light Teal**: #E0F5F3 (card backgrounds, subtle highlights)
- **Dark Text**: #111827 (body copy)
- **Muted Gray**: #6B7280 (secondary text, captions)
- **WhatsApp Green**: #25D366 (WhatsApp CTA buttons only)
- **Alert Red**: #DC2626 (errors, urgent compliance warnings)
- **Success Green**: #16A34A (verification success, positive indicators)

### Typography
- **Display / Headings**: "Clash Display" or "Satoshi" (bold, geometric, modern authority)
- **Body**: "General Sans" or "Outfit" (clean, highly readable)
- **Monospace (data/scores)**: "JetBrains Mono"
- **WhatsApp mockup bubbles**: System font stack to maintain authenticity

### Design Principles
1. **WhatsApp-authentic**: All product demos must use realistic WhatsApp UI mockups with green bubbles, timestamps, blue ticks. Landlords must instantly recognise the interface.
2. **Trust-first**: Navy backgrounds, clean layouts, professional typography. This handles people's passports and financial data — it must feel secure.
3. **Zero-friction messaging**: Every page element should communicate "you already know how to use this."
4. **Compliance confidence**: Badges, certificates, timestamps, audit trail visuals. Landlords are scared of fines — show them protection.
5. **Mobile-first**: 70%+ of landlords will visit the site on mobile. Design accordingly.

### UI Components
- **CTA Button (primary)**: WhatsApp Green (#25D366) with WhatsApp icon, rounded corners, "Start on WhatsApp" text. Used on every section.
- **CTA Button (secondary)**: Teal outline, used for "Learn More" / "See Pricing"
- **Cards**: Cream background (#FDF8F0), subtle border, rounded-lg, gentle shadow
- **Trust badges**: Small icons with labels — "ICO Registered", "GDPR Compliant", "Bank-Grade Encryption", "Ombudsman-Ready Records"
- **Step indicators**: Numbered circles in teal with connector lines
- **WhatsApp mockup component**: Reusable component showing a phone frame with WhatsApp conversation bubbles

## Tech Stack

### Landing Page / Marketing Site
- **Framework**: Next.js 14 App Router
- **Styling**: TailwindCSS
- **Fonts**: Google Fonts (Outfit for body, Clash Display via CDN or self-hosted)
- **Animations**: Framer Motion
- **SEO**: Next.js metadata API, JSON-LD structured data, next-sitemap
- **Analytics**: Vercel Analytics + Google Search Console
- **Deployment**: Vercel
- **Domain**: complilet.ai (or similar)

### WhatsApp Agent System
- **WhatsApp API**: Meta Cloud API (free tier: 1,000 service conversations/month)
- **Webhook Handler**: Supabase Edge Functions (Deno/TypeScript)
- **Agent Orchestration**: Claude API (Sonnet 4) with managed agent patterns
- **Database**: Supabase (PostgreSQL + Auth + Storage + RLS)
- **Document Storage**: Supabase Storage (encrypted buckets per landlord)
- **PDF Generation**: Puppeteer or React-PDF
- **Payments**: Stripe (subscriptions + per-screening charges)
- **SMS/Email Fallback**: Twilio (SMS), Resend (email)

## SEO Strategy

### Target Keywords (UK-focused)
**High intent (screening)**:
- "tenant screening UK" / "how to screen tenants UK"
- "tenant screening without letting agent"
- "Right to Rent checklist 2026"
- "tenant referencing self-managing landlord"
- "Section 21 abolished tenant screening"

**High intent (management)**:
- "manage property without letting agent"
- "landlord compliance checklist 2026"
- "gas safety certificate reminder landlord"
- "manage UK property from abroad"
- "overseas landlord UK tax NRL1"

**Long-tail (blog content)**:
- "how to check Right to Rent documents 2026"
- "can I self-manage rental property from Dubai"
- "tenant screening process step by step UK"
- "what happens if landlord misses gas safety check"
- "Making Tax Digital for landlords 2026"

### GEO (Generative Engine Optimisation)
Structure content so AI assistants (ChatGPT, Gemini, Perplexity, Claude) can cite CompliLet:
- Use clear H2/H3 hierarchies with question-format headings
- Include FAQ sections with concise, direct answers
- Add JSON-LD FAQ schema on all blog posts
- Structure "How It Works" content as numbered steps (AI assistants love citing step-by-step content)
- Include comparison tables (CompliLet vs letting agents, CompliLet vs competitors)
- Publish original data/statistics when available (e.g., "average screening time with CompliLet: 24 hours vs 2 weeks manual")

### Technical SEO
- next-sitemap for auto-generated sitemap.xml
- Canonical URLs on all pages
- Open Graph + Twitter Card meta tags
- Structured data: Organization, Product, FAQ, HowTo schemas
- Core Web Vitals optimised (Vercel edge, image optimisation, font preloading)
- Mobile-first responsive design
- robots.txt allowing all crawlers

## Page Structure

### Landing Page (/)
1. Hero: Headline + subheadline + WhatsApp CTA + phone mockup showing WhatsApp conversation
2. Social proof bar: "Trusted by X landlords" (placeholder until beta)
3. How It Works: 6-step visual walkthrough with WhatsApp mockups
4. Features: Grid of key capabilities with icons
5. For Overseas Landlords: Dedicated section
6. Pricing: 5-tier pricing cards
7. Compliance & Trust: Badges + security messaging
8. FAQ: SEO-optimised with JSON-LD schema
9. Final CTA: Full-width WhatsApp CTA
10. Footer: Links, privacy policy, ICO registration, WhatsApp button

### Blog (/blog)
- MDX-powered blog with SEO-optimised posts
- Each post ends with WhatsApp CTA
- Categories: Tenant Screening, Compliance, Overseas Landlords, Renters' Rights Act

### Pricing (/pricing)
- Detailed tier comparison
- FAQ specific to pricing
- WhatsApp CTA on every tier card

### How It Works (/how-it-works)
- Detailed step-by-step with larger WhatsApp mockups
- Video walkthrough (Phase 2)

## File Structure Convention

```
complilet/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Landing page
│   │   ├── pricing/page.tsx
│   │   ├── how-it-works/page.tsx
│   │   ├── blog/
│   │   │   ├── page.tsx
│   │   │   └── [slug]/page.tsx
│   │   ├── privacy/page.tsx
│   │   ├── terms/page.tsx
│   │   └── internal/              # Admin panel (password-protected)
│   │       ├── layout.tsx         # Auth middleware
│   │       ├── page.tsx           # Dashboard home
│   │       ├── landlords/page.tsx
│   │       ├── screenings/page.tsx
│   │       ├── tenancies/page.tsx
│   │       ├── escalations/page.tsx
│   │       ├── revenue/page.tsx
│   │       ├── agents/page.tsx
│   │       └── system/page.tsx
│   ├── components/
│   │   ├── ui/                   # Reusable UI primitives
│   │   ├── layout/               # Header, Footer, Nav
│   │   ├── sections/             # Landing page sections
│   │   ├── whatsapp/             # WhatsApp mockup components
│   │   └── seo/                  # JSON-LD, meta components
│   ├── lib/
│   │   ├── constants.ts          # Brand colors, pricing, etc.
│   │   └── seo.ts                # SEO utility functions
│   └── styles/
│       └── globals.css
├── public/
│   ├── og-image.png
│   ├── favicon.ico
│   └── fonts/
├── content/
│   └── blog/                     # MDX blog posts
├── next.config.js
├── tailwind.config.ts
├── next-sitemap.config.js
└── package.json
```

## WhatsApp Agent System Structure

```
complilet-agents/
├── supabase/
│   ├── migrations/               # Database schema
│   └── functions/
│       ├── webhook-handler/      # Meta Cloud API webhook
│       ├── coordinator-agent/    # Routes messages to specialist agents
│       ├── pre-qualifier/        # Tenant screening conversation
│       ├── doc-collector/        # Document collection + validation
│       ├── right-to-rent/        # Compliance check orchestration
│       ├── reference-chaser/     # Autonomous reference follow-up
│       ├── move-in-pack/         # PDF generation + delivery
│       ├── compliance-autopilot/ # Ongoing deadline tracking
│       ├── rent-monitor/         # Rent reminders + arrears chasing
│       ├── maintenance-agent/    # Issue triage via Claude vision
│       ├── inspection-agent/     # Photo-based property checks
│       ├── renewal-agent/        # Tenancy renewal orchestration
│       ├── nrl-tax-agent/        # Overseas landlord NRL compliance
│       └── daily-admin-summary/  # Daily WhatsApp summary + instant alerts to admin
├── lib/
│   ├── whatsapp.ts               # Meta Cloud API send/receive helpers
│   ├── claude.ts                 # Claude API wrapper with agent prompts
│   ├── supabase.ts               # Database client + helpers
│   ├── pdf.ts                    # PDF generation utilities
│   └── types.ts                  # Shared TypeScript types
├── prompts/
│   ├── coordinator.md            # System prompt for coordinator agent
│   ├── pre-qualifier.md
│   ├── doc-collector.md
│   ├── right-to-rent.md
│   ├── reference-chaser.md
│   ├── move-in-pack.md
│   ├── compliance-autopilot.md
│   ├── rent-monitor.md
│   ├── maintenance-agent.md
│   ├── inspection-agent.md
│   ├── renewal-agent.md
│   └── nrl-tax-agent.md
└── package.json
```

## Development Rules

1. Always use TypeScript with strict mode
2. Use Supabase RLS (Row Level Security) for ALL database tables — landlord A must never see landlord B's data
3. Never store raw API keys in code — use Supabase secrets / Vercel environment variables
4. All WhatsApp message templates must be pre-approved by Meta before use
5. Right to Rent document classification uses deterministic decision trees, NOT LLM judgement
6. Every agent interaction must be logged to the agent_logs table for debugging and cost tracking
7. All tenant documents must be encrypted at rest in Supabase Storage
8. Auto-delete tenant documents after 12 months (GDPR data minimisation)
9. Human escalation triggers must be built into every agent from day one
10. Test with realistic UK phone numbers and document formats

## Important Context

- **AGENT_COMPLIANCE_RULES.md** must be read before writing any agent system prompt. It contains legally mandated rules for every agent including anti-discrimination enforcement, data subject rights handling, safeguarding triggers, and safety-critical hardcoded responses.
- The Renters' Rights Act takes effect 1 May 2026 — this is the primary marketing urgency
- Making Tax Digital for landlords earning £50K+ starts 6 April 2026
- Right to Rent fines are up to £3,000 per tenant for non-compliance
- Gas safety certificate fines are up to £6,000
- Average UK tenancy length is 4.5 years
- 78% of UK landlords manage manually without software
- 92% use informal communication (phone/text/WhatsApp) for tenant interactions
- CompliLet needs a DPIA (Data Protection Impact Assessment) before processing real tenant data
- ICO registration is required (£40/year via ico.org.uk)
