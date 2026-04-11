# CompliLet — Deployment & Go-Live Checklist

Work top-to-bottom. Items marked `[BLOCKING]` must complete before later steps can start.
Estimated total first-time setup: **3–5 hours**.

---

## Phase 1 — Accounts & Access

- [ ] **Supabase project** — supabase.com `[BLOCKING for Phase 2 + 3]`
  - Plan: **Pro** (required for pg_cron, custom domains, >500 MB storage)
  - Region: `eu-west-2` (London)
  - Note your **Project Ref** (8-character ID in the dashboard URL)
  - Note your **Project URL**: `https://YOUR_REF.supabase.co`

- [ ] **Meta Business Manager** — business.facebook.com `[BLOCKING for Phase 4]`
  - Create a Business Manager account (or use existing)
  - Verify business email and domain
  - Add a payment method (required for WhatsApp API)

- [ ] **Stripe account** — dashboard.stripe.com `[BLOCKING for Phase 5]`
  - Default currency: **GBP**
  - Complete business verification before going live
  - Enable "Adaptive Acceptance" in payment settings

- [ ] **Vercel account** — vercel.com `[BLOCKING for Phase 6 + 7]`
  - Connect your GitHub organisation

- [ ] **Anthropic API key** — console.anthropic.com `[BLOCKING for Phase 3]`
  - Usage tier: Tier 2+ recommended for production load
  - Set a monthly spend limit

---

## Phase 2 — Supabase Database

### 2a. Run all migrations

```bash
cd complilet-agents
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Migrations applied in order:

| File | Contents |
|------|----------|
| `20260411000000_initial_schema.sql` | All 17 core tables, RLS policies, indexes, triggers |
| `20260412000000_billing_columns.sql` | Stripe billing columns, escalations table, billing RPCs |
| `20260412000001_cron_jobs.sql` | pg_cron: 7 scheduled jobs, `call_edge_function()` helper |
| `20260412000002_admin_summary_cron.sql` | Daily admin summary cron, `get_cron_job_status()` RPC |
| `20260412000003_schema_completion.sql` | `coordinator_state`, `admin_users`, extra columns |

- [ ] `supabase db diff` shows no pending changes
- [ ] All tables visible in Supabase dashboard → Table Editor:
  `landlords`, `properties`, `tenancies`, `screening_sessions`, `documents`,
  `references`, `compliance_records`, `compliance_deadlines`, `messages`,
  `agent_logs`, `escalations`, `maintenance_tickets`, `inspections`,
  `rent_events`, `referral_transactions`, `contractors`, `nrl_events`,
  `coordinator_state`, `admin_users`

### 2b. Verify RLS

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

All tables should show `rowsecurity = true`.

- [ ] RLS enabled on all tables

### 2c. Configure Vault secrets for pg_cron

In Supabase dashboard → Database → Vault → Secrets, add:

| Secret name | Value |
|-------------|-------|
| `supabase_edge_functions_url` | `https://YOUR_REF.supabase.co/functions/v1` |
| `service_role_key` | (Project Settings → API → service_role key) |

- [ ] Both vault secrets added

### 2d. Verify cron jobs

```sql
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
```

Expected: **8 rows**, all `active = true`:

| Job name | Schedule |
|----------|----------|
| `complilet_compliance_autopilot` | `0 9 * * *` (09:00 UTC daily) |
| `complilet_daily_admin_summary` | `0 20 * * *` (20:00 UTC daily) |
| `complilet_inspection` | `30 9 * * *` (09:30 UTC daily) |
| `complilet_maintenance_followup` | `0 10 * * *` (10:00 UTC daily) |
| `complilet_nrl_tax` | `0 7 * * *` (07:00 UTC daily) |
| `complilet_ref_chaser` | `0 7,13,19,01 * * *` (4× daily) |
| `complilet_renewal` | `15 8 * * *` (08:15 UTC daily) |
| `complilet_rent_monitor` | `0 8 * * *` (08:00 UTC daily) |

- [ ] All 8 cron jobs active

### 2e. Configure Supabase Auth redirect URLs

In Supabase dashboard → Authentication → URL Configuration:

- Site URL: `https://admin.complilet.co.uk`
- Additional redirect URLs:
  - `https://admin.complilet.co.uk/auth/callback`
  - `http://localhost:3001/auth/callback` (local dev only)

- [ ] Auth URLs configured

---

## Phase 3 — Supabase Edge Functions

### 3a. Set all secrets

```bash
supabase secrets set \
  WHATSAPP_TOKEN="EAAxxxxxxxxxxxxxxx" \
  PHONE_NUMBER_ID="1234567890123456" \
  WHATSAPP_APP_SECRET="your_app_secret" \
  WHATSAPP_VERIFY_TOKEN="complilet-webhook-verify-token-REPLACE" \
  ANTHROPIC_API_KEY="sk-ant-api03-..." \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  STRIPE_PRICE_PAY_PER_SCREEN="price_..." \
  STRIPE_PRICE_LANDLORD_PRO="price_..." \
  STRIPE_PRICE_TENANCY_MANAGER="price_..." \
  STRIPE_PRICE_PORTFOLIO="price_..." \
  STRIPE_PRICE_GLOBAL_LANDLORD="price_..." \
  STRIPE_SUCCESS_URL="https://complilet.co.uk/payment/success" \
  STRIPE_CANCEL_URL="https://complilet.co.uk/payment/cancel" \
  DASHBOARD_ORIGIN="https://complilet.co.uk" \
  ESCALATION_URGENT_PHONE="447700000000" \
  ESCALATION_HIGH_PHONE="447700000001" \
  ADMIN_PHONES="447700000002" \
  ADMIN_DASHBOARD_URL="https://admin.complilet.co.uk" \
  --project-ref YOUR_PROJECT_REF
```

- [ ] All secrets set — verify with `supabase secrets list`

### 3b. Deploy all Edge Functions

```bash
supabase functions deploy --project-ref YOUR_PROJECT_REF
```

Confirm each function is listed in the dashboard:

- [ ] `webhook-handler` — main WhatsApp entry point (`verify_jwt = false`)
- [ ] `stripe-webhook` — Stripe payment events (`verify_jwt = false`)
- [ ] `escalation-dashboard` — internal dashboard API (`verify_jwt = true`)
- [ ] `daily-admin-summary` — WhatsApp summary to admin phones
- [ ] `compliance-autopilot-cron`
- [ ] `rent-monitor-cron`
- [ ] `ref-chaser-cron`
- [ ] `inspection-cron`
- [ ] `renewal-cron`
- [ ] `maintenance-followup-cron`
- [ ] `nrl-tax-cron`

### 3c. Smoke-test webhook handler

```bash
curl -X GET \
  "https://YOUR_REF.supabase.co/functions/v1/webhook-handler\
?hub.mode=subscribe\
&hub.verify_token=complilet-webhook-verify-token-REPLACE\
&hub.challenge=test123"
```

Expected response body: `test123`

- [ ] Webhook verification returns challenge correctly

---

## Phase 4 — WhatsApp Business API

### 4a. Create WhatsApp Business Account

1. Meta Business Manager → Business Settings → Accounts → WhatsApp Accounts
2. Click **Add** → **Create a WhatsApp Business Account**
3. Note the **WABA ID** (16-digit number)

- [ ] WABA created — note WABA ID

### 4b. Register phone number

1. WhatsApp Accounts → {your account} → Phone Numbers → **Add phone number**
2. Verify via SMS or voice call
3. Note the **Phone Number ID** (different from the actual number)
4. Update `PHONE_NUMBER_ID` in Supabase secrets

- [ ] Phone number registered and verified
- [ ] `PHONE_NUMBER_ID` secret updated

### 4c. Create Meta App

1. developers.facebook.com → My Apps → **Create App** → type: **Business**
2. Add product: **WhatsApp**
3. Copy **App Secret** → update `WHATSAPP_APP_SECRET` in Supabase
4. Copy **App ID** (needed for webhook config)

- [ ] Meta App created
- [ ] `WHATSAPP_APP_SECRET` updated

### 4d. Configure webhook

In Meta App Dashboard → WhatsApp → Configuration → Webhooks:

1. **Callback URL**: `https://YOUR_REF.supabase.co/functions/v1/webhook-handler`
2. **Verify token**: matches `WHATSAPP_VERIFY_TOKEN` (the value you set in 3a)
3. Click **Verify and Save**
4. Subscribe to webhook fields:
   - [x] `messages`
   - [x] `message_deliveries`
   - [x] `message_reads`
   - [x] `messaging_postbacks`

- [ ] Webhook URL verified successfully
- [ ] All 4 fields subscribed

### 4e. Generate System User access token

1. Business Manager → System Users → **Add**
2. Role: **Admin**
3. Assign assets: WhatsApp Business Account → your WABA
4. Generate token → Permissions: `whatsapp_business_messaging`, `whatsapp_business_management`
5. Token expiration: **Never** (System User tokens don't expire)
6. Update `WHATSAPP_TOKEN` in Supabase secrets

- [ ] System User created with Admin role
- [ ] Permanent token generated and added to Supabase secrets

### 4f. Submit message templates

Templates are in `complilet-agents/whatsapp-templates/`. Each is a UTILITY category template.

```bash
cd complilet-agents

export WABA_ID="your_16_digit_waba_id"
export META_ACCESS_TOKEN="your_system_user_token"

chmod +x whatsapp-templates/submit-templates.sh
./whatsapp-templates/submit-templates.sh
```

Templates are defined in `complilet-agents/whatsapp-templates/templates.json`:

| Template | Purpose | Key variables |
|----------|---------|-----------|
| `screening_invitation` | Invite tenant to start screening | `{{1}}` landlord name, `{{2}}` property address |
| `document_request` | Request a specific document | `{{1}}` document type |
| `reference_request` | Contact a referee | `{{1}}` tenant name, `{{2}}` reference type |
| `rent_reminder` | Rent due reminder | `{{1}}` tenant name, `{{2}}` amount, `{{3}}` address, `{{4}}` due date |
| `compliance_alert` | Certificate expiry warning | `{{1}}` cert type, `{{2}}` address, `{{3}}` due date, `{{4}}` fine amount |
| `screening_complete` | Screening report ready for landlord | `{{1}}` tenant name, `{{2}}` address, `{{3}}` score, `{{4}}` recommendation |
| `payment_request` | Pay-per-screen checkout link | `{{1}}` tenant name, `{{2}}` address, `{{3}}` amount |
| `inspection_request` | Quarterly inspection photo request | `{{1}}` tenant name, `{{2}}` address, `{{3}}` deadline date |

Preview what will be submitted without making API calls:

```bash
./whatsapp-templates/submit-templates.sh --dry-run
```

Check approval status after submission (24–48 hours):

```bash
./whatsapp-templates/submit-templates.sh --status
```

Or in Meta Business Manager: business.facebook.com/wa/manage/message-templates/

- [ ] All 8 templates submitted (status: PENDING)
- [ ] After 24–48 hours: all 8 templates status = **APPROVED**

**All 8 templates must be APPROVED before go-live. Do not proceed to Phase 11 until approved.**

### 4g. End-to-end WhatsApp test

Send a message from a personal WhatsApp number to the business number.

- [ ] Inbound message appears in Supabase `messages` table
- [ ] Auto-reply received on the personal phone within 5 seconds

---

## Phase 5 — Stripe

### 5a. Create products and prices

In Stripe Dashboard → Products → **Add product**:

| Product name | Type | Price | Billing |
|---|---|---|---|
| Pay-Per-Screen | One-time | £4.99 | — |
| Landlord Pro | Recurring | £19.99/month | Monthly |
| Tenancy Manager | Recurring | £14.99/month | Monthly |
| Portfolio | Recurring | £39.99/month | Monthly |
| Global Landlord | Recurring | £29.99/month | Monthly |

Copy each `price_...` ID → update Supabase secrets (`STRIPE_PRICE_*`).

- [ ] All 5 products created in **test mode**
- [ ] All 5 price IDs added to Supabase secrets

### 5b. Create webhook endpoint

Stripe Dashboard → Developers → Webhooks → **Add endpoint**:

- **URL**: `https://YOUR_REF.supabase.co/functions/v1/stripe-webhook`
- **Events**:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
  - `charge.dispute.created`

Copy **Signing Secret** (`whsec_...`) → update `STRIPE_WEBHOOK_SECRET` in Supabase.

- [ ] Webhook endpoint created
- [ ] `STRIPE_WEBHOOK_SECRET` updated

### 5c. Test payment flow

Using Stripe test card `4242 4242 4242 4242`:

1. Send `SCREEN` from test WhatsApp → receive Checkout link
2. Complete payment in test mode
3. Check Stripe → Developers → Webhooks → Recent events: `checkout.session.completed` = Delivered
4. Verify `coordinator_state.payment_credits` incremented in Supabase
5. Confirm WhatsApp message received

- [ ] Test payment completes end-to-end
- [ ] Credit added to `coordinator_state`
- [ ] Confirmation message received via WhatsApp

### 5d. Switch to live mode

1. Toggle Stripe Dashboard from **Test** to **Live**
2. Create live products + prices (repeat 5a)
3. Create live webhook endpoint (repeat 5b)
4. Update all `STRIPE_*` Supabase secrets with live values

- [ ] All Stripe secrets updated to live values (`sk_live_...`)

---

## Phase 6 — Landing Page (complilet)

### 6a. Import to Vercel

1. vercel.com → New Project → Import from GitHub
2. Root directory: `./complilet`
3. Framework: **Next.js** (auto-detected)

- [ ] Project imported

### 6b. Set environment variables

In Vercel → Project → Settings → Environment Variables:

| Variable | Environment | Value |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Production | `https://complilet.co.uk` |
| `NEXT_PUBLIC_SUPABASE_URL` | All | `https://YOUR_REF.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All | `eyJ...` (anon key) |
| `SUPABASE_SERVICE_ROLE_KEY` | All | `eyJ...` (service role) |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Production | `G-XXXXXXXXXX` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Production | `pk_live_...` |

- [ ] All environment variables set

### 6c. Add custom domain

1. Vercel → Project → Settings → Domains → **Add**
2. Add `complilet.co.uk` and `www.complilet.co.uk`
3. Add DNS records at your registrar (Vercel provides the exact records)
4. Wait for SSL certificate (usually < 5 minutes)

- [ ] `complilet.co.uk` resolves and shows the site
- [ ] `www.complilet.co.uk` redirects to `complilet.co.uk`
- [ ] SSL certificate active

### 6d. Deploy

```bash
cd complilet
vercel --prod
```

- [ ] Production build succeeds (no build errors)
- [ ] Site loads at `https://complilet.co.uk`

### 6e. Sitemap and robots.txt

The `postbuild` script runs `next-sitemap` automatically on every deploy.

- [ ] `https://complilet.co.uk/sitemap.xml` returns valid XML
- [ ] `https://complilet.co.uk/robots.txt` is present and correct
- [ ] No `/internal` or `/api` paths in the sitemap

---

## Phase 7 — Admin Panel (complilet-admin)

### 7a. Import to Vercel

1. vercel.com → New Project → Import from GitHub
2. Root directory: `./complilet-admin`
3. Framework: **Next.js** (auto-detected)

- [ ] Project imported

### 7b. Set environment variables

In Vercel → Project → Settings → Environment Variables:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://YOUR_REF.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` (anon key) |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` (service role — server-side only) |
| `ADMIN_EMAIL_ALLOWLIST` | `admin@complilet.co.uk` (comma-separated for multiple admins) |
| `STRIPE_SECRET_KEY` | `sk_live_...` |
| `NEXT_PUBLIC_ADMIN_URL` | `https://admin.complilet.co.uk` |

- [ ] All environment variables set

### 7c. Add custom domain

1. Vercel → Project → Settings → Domains → **Add** → `admin.complilet.co.uk`
2. Add DNS record at registrar
3. Wait for SSL certificate

- [ ] `admin.complilet.co.uk` resolves
- [ ] SSL certificate active

### 7d. Deploy and verify

```bash
cd complilet-admin
vercel --prod
```

- [ ] Login page loads at `https://admin.complilet.co.uk/login`
- [ ] Sign in with an allowlisted email → redirects to `/internal`
- [ ] Non-allowlisted email is rejected with "Access denied" message
- [ ] Dashboard page shows (numbers may all be zero at this point)

---

## Phase 8 — Google Search Console & Analytics

### 8a. Google Search Console

1. search.google.com/search-console → **Add property** → Domain type → `complilet.co.uk`
2. Verify ownership via DNS TXT record at your registrar
3. After verified: Sitemaps → Submit `https://complilet.co.uk/sitemap.xml`
4. Request indexing on the homepage

- [ ] Domain property created and verified
- [ ] Sitemap submitted
- [ ] No critical coverage errors in the Index report

### 8b. Google Analytics 4

1. analytics.google.com → Create property → `CompliLet`
2. Industry: Finance / Business & Industrial Markets
3. Note the **Measurement ID** (`G-XXXXXXXXXX`)
4. Update `NEXT_PUBLIC_GA_MEASUREMENT_ID` in Vercel env → redeploy

Verify:
- Open `https://complilet.co.uk` in an incognito window
- GA4 → Reports → Realtime → confirm 1 active user

- [ ] GA4 property created
- [ ] Measurement ID in Vercel and tracking confirmed live

### 8c. Vercel Analytics

In Vercel Dashboard → Analytics → **Enable**

- [ ] Vercel Analytics enabled

---

## Phase 9 — Open Graph Images

Required for social sharing previews (WhatsApp link previews, LinkedIn, Twitter/X).

### Required images

| Page | Size | Path |
|------|------|------|
| Homepage (default) | 1200 × 630 px | `public/images/og-default.png` |
| Pricing | 1200 × 630 px | `public/images/og-pricing.png` |
| How It Works | 1200 × 630 px | `public/images/og-how-it-works.png` |
| Blog index | 1200 × 630 px | `public/images/og-blog.png` |

### Design guidelines

- Navy background (`#1B2B5E`) or dark-teal gradient matching brand
- CompliLet logo (white) top-left
- Page headline in white, 48–64px
- Subtitle in cream/light-grey
- UK property / WhatsApp visual motif bottom-right

### Verify

Use [Open Graph Debugger](https://developers.facebook.com/tools/debug/) on each URL:

- [ ] `og:image` tag present on all key pages
- [ ] OG images load correctly in the debugger
- [ ] WhatsApp link preview shows correct thumbnail

---

## Phase 10 — Final Pre-Launch Checks

### Security

- [ ] No `.env` or `.env.local` files committed to git
- [ ] `SUPABASE_SERVICE_ROLE_KEY` not in browser bundle:
  ```bash
  grep -r "SERVICE_ROLE" complilet/.next/static/ 2>/dev/null | wc -l
  # Must return 0
  ```
- [ ] Stripe test-mode secrets replaced with live secrets everywhere
- [ ] Admin panel `ADMIN_EMAIL_ALLOWLIST` contains only real admin emails
- [ ] All Supabase RLS policies reviewed (run `supabase db diff` — should be empty)

### Legal (required before collecting payments)

- [ ] Privacy Policy live at `https://complilet.co.uk/privacy`
- [ ] Terms of Service live at `https://complilet.co.uk/terms`
- [ ] Cookie/consent banner present for GA4
- [ ] ICO registration completed (required for processing personal data in UK)
- [ ] Stripe Checkout shows correct business name and logo

### Performance

```bash
npx lighthouse https://complilet.co.uk --output=html --output-path=./lighthouse.html
open lighthouse.html
```

Minimum before launch:

- [ ] Performance: ≥ 90
- [ ] Accessibility: ≥ 95
- [ ] Best Practices: ≥ 95
- [ ] SEO: ≥ 95

### WhatsApp template approval

- [ ] All 6 templates status = **APPROVED** (run `./submit-templates.sh --status`)

---

## Phase 11 — Go Live

- [ ] Business number shared publicly (website, business cards, social)
- [ ] Stripe switched to live mode with live secrets
- [ ] First real landlord account created via WhatsApp
- [ ] First end-to-end screening completed manually (watch Supabase logs in real-time)
- [ ] Admin panel shows first landlord at `https://admin.complilet.co.uk/internal/landlords`
- [ ] First daily admin summary received at 8 PM UK time

---

## Rollback Plan

If a critical issue is found after go-live:

1. **Vercel rollback**: Deployments → previous deployment → **Promote to Production**
2. **Edge Function rollback**: `supabase functions deploy {name} --project-ref REF` from previous git commit
3. **Database rollback**: Supabase → Database → Backups → Point-in-time restore (Pro plan)

---

## Post-Launch Monitoring Schedule

| Frequency | Action |
|-----------|--------|
| Daily (automated) | Admin daily summary WhatsApp at 8 PM |
| Daily | Check Supabase Edge Function error logs for exceptions |
| Daily | Check Stripe → Webhooks → Recent events for delivery failures |
| Weekly | Review escalations at `admin.complilet.co.uk/internal/escalations` |
| Weekly | Check GSC for crawl/index errors |
| Monthly | Review GA4 and Vercel Analytics for user trends |
| Monthly | Check WhatsApp template performance in Meta Business Manager |
| Quarterly | Review Stripe churn and failed payment rates |
| Annually | Renew Meta System User token if not set to never-expire |

---

## Local Development Quick Start

```bash
# 1. Clone and install
git clone https://github.com/YOUR_ORG/complilet
cd complilet-agents && npm install   # edge function deps (optional)
cd ../complilet && npm install
cd ../complilet-admin && npm install

# 2. Start Supabase locally
cd complilet-agents
supabase start          # starts Postgres, Studio, Edge Runtime at localhost
supabase db reset       # applies all migrations + seed data

# 3. Copy env files
cp complilet/.env.example complilet/.env.local
cp complilet-admin/.env.example complilet-admin/.env.local
# Fill in values from `supabase status` output

# 4. Start dev servers
cd complilet && npm run dev          # http://localhost:3000
cd complilet-admin && npm run dev    # http://localhost:3001

# 5. Supabase Studio (DB browser)
# http://localhost:54323
```
