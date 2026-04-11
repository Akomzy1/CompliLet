/**
 * CompliLet — Billing Module
 *
 * Handles all Stripe interactions:
 *   - Checking whether a landlord is allowed to run a screening
 *     (free trial, subscription, or pay-per-screen credit)
 *   - Creating Stripe Checkout sessions (one-time + subscription)
 *   - Creating or retrieving Stripe Customers
 *   - Recording metered usage for Tenancy Manager / Global Landlord plans
 *   - Activating / crediting after successful payment
 *
 * Required environment variables:
 *   STRIPE_SECRET_KEY          — sk_live_… or sk_test_…
 *   STRIPE_WEBHOOK_SECRET      — whsec_… (for verifying webhook events)
 *   STRIPE_PRICE_PAY_PER_SCREEN  — price_… (one-time, £4.99)
 *   STRIPE_PRICE_LANDLORD_PRO    — price_… (recurring monthly, £19.99)
 *   STRIPE_PRICE_TENANCY_MANAGER — price_… (recurring monthly metered, £14.99)
 *   STRIPE_PRICE_PORTFOLIO       — price_… (recurring monthly, £39.99)
 *   STRIPE_PRICE_GLOBAL_LANDLORD — price_… (recurring monthly metered, £29.99)
 *   STRIPE_SUCCESS_URL           — URL Stripe redirects to after payment (e.g. https://app.complilet.co.uk/payment/success)
 *   STRIPE_CANCEL_URL            — URL Stripe redirects to on cancel
 *
 * Database columns required on `landlords`:
 *   stripe_customer_id   TEXT
 *   stripe_subscription_id TEXT
 *   plan                 TEXT (default 'free_trial')
 *
 * Database column required on `coordinator_state`:
 *   payment_credits      INT (default 0)  — consumed one at a time for pay_per_screen
 *   pending_checkout_id  TEXT             — Stripe Checkout session ID awaiting payment
 */

// deno-lint-ignore-file no-explicit-any
import Stripe from "npm:stripe@17";
import { supabase } from "./supabase.ts";
import {
  FREE_TRIAL_SCREENING_LIMIT,
  LANDLORD_PLAN,
  SUBSCRIPTION_PLANS,
  METERED_PLANS,
  type LandlordPlan,
} from "./constants.ts";

// ─── Stripe client ────────────────────────────────────────────────────────────

function getStripe(): Stripe {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: "2024-11-20.acacia" });
}

// ─── Price ID helpers ─────────────────────────────────────────────────────────

function priceId(plan: LandlordPlan): string {
  const envMap: Partial<Record<LandlordPlan, string>> = {
    pay_per_screen:  Deno.env.get("STRIPE_PRICE_PAY_PER_SCREEN"),
    landlord_pro:    Deno.env.get("STRIPE_PRICE_LANDLORD_PRO"),
    tenancy_manager: Deno.env.get("STRIPE_PRICE_TENANCY_MANAGER"),
    portfolio:       Deno.env.get("STRIPE_PRICE_PORTFOLIO"),
    global_landlord: Deno.env.get("STRIPE_PRICE_GLOBAL_LANDLORD"),
  };
  const id = envMap[plan];
  if (!id) throw new Error(`STRIPE_PRICE env var not set for plan: ${plan}`);
  return id;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface BillingCheckResult {
  /** Whether the landlord may proceed with a new screening */
  allowed: boolean;
  plan: LandlordPlan;
  reason?: string;
  /** Checkout URL to send the landlord when allowed === false */
  checkoutUrl?: string;
  /** Whether usage should be metered (Stripe usage record needed on screening start) */
  isMetered: boolean;
  subscriptionId?: string;
  /** How many free screenings remain (only for free_trial plan) */
  freeRemaining?: number;
}

// ─── Core billing check ───────────────────────────────────────────────────────

/**
 * Determines whether a landlord is permitted to run a new screening.
 *
 * Precedence:
 *   1. Active subscription plan → always allowed (metered plans also allowed)
 *   2. Pay-per-screen credit in coordinator_state → consume and allow
 *   3. Free trial with remaining slots → allow
 *   4. Otherwise → denied; returns a Checkout URL
 */
export async function checkBillingAllowed(
  landlordId: string,
  landlordPhone: string,
): Promise<BillingCheckResult> {
  // Fetch landlord row
  const { data: landlord, error } = await supabase
    .from("landlords")
    .select("plan, stripe_customer_id, stripe_subscription_id")
    .eq("id", landlordId)
    .maybeSingle();

  if (error || !landlord) {
    console.error("[billing] Failed to fetch landlord:", error?.message);
    // Fail open — don't block if we can't read the row
    return { allowed: true, plan: LANDLORD_PLAN.FREE_TRIAL, isMetered: false };
  }

  const plan = (landlord.plan ?? LANDLORD_PLAN.FREE_TRIAL) as LandlordPlan;

  // ── 1. Active subscription ──────────────────────────────────────────────
  if (SUBSCRIPTION_PLANS.has(plan)) {
    return {
      allowed: true,
      plan,
      isMetered: METERED_PLANS.has(plan),
      subscriptionId: landlord.stripe_subscription_id ?? undefined,
    };
  }

  // ── 2. Pay-per-screen credit ────────────────────────────────────────────
  const { data: coordState } = await supabase
    .from("coordinator_state")
    .select("payment_credits")
    .eq("landlord_id", landlordId)
    .maybeSingle();

  const credits = (coordState?.payment_credits as number | null) ?? 0;
  if (credits > 0) {
    return { allowed: true, plan: LANDLORD_PLAN.PAY_PER_SCREEN, isMetered: false };
  }

  // ── 3. Free trial ───────────────────────────────────────────────────────
  if (plan === LANDLORD_PLAN.FREE_TRIAL) {
    const { count } = await supabase
      .from("screening_sessions")
      .select("id", { count: "exact", head: true })
      .eq("landlord_id", landlordId);

    const used = count ?? 0;
    const remaining = Math.max(0, FREE_TRIAL_SCREENING_LIMIT - used);

    if (remaining > 0) {
      return {
        allowed: true,
        plan: LANDLORD_PLAN.FREE_TRIAL,
        isMetered: false,
        freeRemaining: remaining,
      };
    }
  }

  // ── 4. Denied — generate payment options ───────────────────────────────
  const checkoutUrl = await createPayPerScreenCheckout(landlordId, landlordPhone);
  return {
    allowed: false,
    plan,
    reason: "free_trial_exhausted",
    checkoutUrl,
    isMetered: false,
  };
}

/**
 * Consumes one pay-per-screen credit after a screening has been started.
 * Call this immediately after the billing check passes with plan === pay_per_screen.
 */
export async function consumePaymentCredit(landlordId: string): Promise<void> {
  await supabase.rpc("decrement_payment_credits", { p_landlord_id: landlordId });
}

// ─── Stripe Customer ──────────────────────────────────────────────────────────

/**
 * Returns the existing Stripe customer for this landlord, or creates one.
 * The customer ID is persisted to `landlords.stripe_customer_id`.
 */
export async function getOrCreateStripeCustomer(
  landlordId: string,
  phone: string,
): Promise<string> {
  const stripe = getStripe();

  // Check if we already have a customer ID stored
  const { data: row } = await supabase
    .from("landlords")
    .select("stripe_customer_id, name")
    .eq("id", landlordId)
    .maybeSingle();

  if (row?.stripe_customer_id) return row.stripe_customer_id;

  // Create a new Stripe customer
  const customer = await stripe.customers.create({
    phone: `+${phone}`,
    name: row?.name ?? undefined,
    metadata: { landlord_id: landlordId },
  });

  // Persist the customer ID
  await supabase
    .from("landlords")
    .update({ stripe_customer_id: customer.id })
    .eq("id", landlordId);

  return customer.id;
}

// ─── Checkout session creators ────────────────────────────────────────────────

/**
 * Creates a Stripe Checkout session for a one-time £4.99 pay-per-screen payment.
 * Returns the hosted checkout URL.
 *
 * On `checkout.session.completed`, the webhook adds a credit to
 * `coordinator_state.payment_credits` and notifies the landlord via WhatsApp.
 */
export async function createPayPerScreenCheckout(
  landlordId: string,
  phone: string,
): Promise<string> {
  const stripe = getStripe();
  const customerId = await getOrCreateStripeCustomer(landlordId, phone);

  const successUrl =
    Deno.env.get("STRIPE_SUCCESS_URL") ??
    "https://app.complilet.co.uk/payment/success";
  const cancelUrl =
    Deno.env.get("STRIPE_CANCEL_URL") ??
    "https://app.complilet.co.uk/payment/cancel";

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    line_items: [{ price: priceId(LANDLORD_PLAN.PAY_PER_SCREEN), quantity: 1 }],
    success_url: successUrl,
    cancel_url:  cancelUrl,
    metadata: {
      landlord_id: landlordId,
      action:      "pay_per_screen",
    },
    payment_intent_data: {
      metadata: { landlord_id: landlordId, action: "pay_per_screen" },
    },
  });

  // Store pending checkout ID so we can associate the webhook event
  await supabase.from("coordinator_state").upsert(
    {
      landlord_id:         landlordId,
      pending_checkout_id: session.id,
      updated_at:          new Date().toISOString(),
    },
    { onConflict: "landlord_id" },
  );

  return session.url!;
}

/**
 * Creates a Stripe Checkout session for a subscription plan.
 * Returns the hosted checkout URL.
 *
 * On `checkout.session.completed`, the webhook updates `landlords.plan`
 * and `landlords.stripe_subscription_id`.
 */
export async function createSubscriptionCheckout(
  landlordId: string,
  phone: string,
  plan: LandlordPlan,
): Promise<string> {
  if (!SUBSCRIPTION_PLANS.has(plan)) {
    throw new Error(`${plan} is not a subscription plan`);
  }

  const stripe = getStripe();
  const customerId = await getOrCreateStripeCustomer(landlordId, phone);

  const successUrl =
    Deno.env.get("STRIPE_SUCCESS_URL") ??
    "https://app.complilet.co.uk/payment/success";
  const cancelUrl =
    Deno.env.get("STRIPE_CANCEL_URL") ??
    "https://app.complilet.co.uk/payment/cancel";

  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = METERED_PLANS.has(plan)
    ? { price: priceId(plan) }                        // metered: no quantity
    : { price: priceId(plan), quantity: 1 };

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [lineItem],
    success_url: successUrl,
    cancel_url:  cancelUrl,
    subscription_data: {
      metadata: { landlord_id: landlordId, plan },
    },
    metadata: {
      landlord_id: landlordId,
      action:      "subscribe",
      plan,
    },
  });

  await supabase.from("coordinator_state").upsert(
    {
      landlord_id:         landlordId,
      pending_checkout_id: session.id,
      updated_at:          new Date().toISOString(),
    },
    { onConflict: "landlord_id" },
  );

  return session.url!;
}

// ─── Metered usage recording ──────────────────────────────────────────────────

/**
 * Reports one unit of screening usage to Stripe for metered billing plans.
 * Called when a screening is started on Tenancy Manager or Global Landlord plans.
 */
export async function recordScreeningUsage(
  landlordId: string,
  subscriptionId: string,
): Promise<void> {
  const stripe = getStripe();

  // Fetch the subscription to get the subscription item ID for metered pricing
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const item = subscription.items.data[0];
  if (!item) {
    console.error("[billing] No subscription item found for", subscriptionId);
    return;
  }

  await stripe.subscriptionItems.createUsageRecord(item.id, {
    quantity: 1,
    timestamp: Math.floor(Date.now() / 1000),
    action: "increment",
  });

  console.info(`[billing] Recorded 1 screening usage for landlord ${landlordId}`);
}

// ─── Post-payment activation helpers ─────────────────────────────────────────

/**
 * Called by the webhook handler after `checkout.session.completed` for
 * pay-per-screen payments. Adds one credit and clears the pending checkout ID.
 */
export async function activatePayPerScreenCredit(landlordId: string): Promise<void> {
  await supabase.rpc("increment_payment_credits", { p_landlord_id: landlordId });
  await supabase
    .from("coordinator_state")
    .update({ pending_checkout_id: null, updated_at: new Date().toISOString() })
    .eq("landlord_id", landlordId);
}

/**
 * Called by the webhook handler after `checkout.session.completed` for
 * subscription purchases. Updates `landlords.plan` and `stripe_subscription_id`.
 */
export async function activateSubscription(
  landlordId: string,
  plan: LandlordPlan,
  stripeSubscriptionId: string,
  stripeCustomerId: string,
): Promise<void> {
  await supabase
    .from("landlords")
    .update({
      plan,
      stripe_subscription_id: stripeSubscriptionId,
      stripe_customer_id:     stripeCustomerId,
    })
    .eq("id", landlordId);

  await supabase
    .from("coordinator_state")
    .update({ pending_checkout_id: null, updated_at: new Date().toISOString() })
    .eq("landlord_id", landlordId);
}

/**
 * Called by the webhook handler on `customer.subscription.updated`.
 * Syncs the plan field from the Stripe subscription metadata.
 */
export async function syncSubscriptionPlan(
  landlordId: string,
  plan: LandlordPlan,
  status: string,
): Promise<void> {
  const activePlan = (status === "active" || status === "trialing")
    ? plan
    : LANDLORD_PLAN.FREE_TRIAL; // downgrade to free if paused/unpaid

  await supabase
    .from("landlords")
    .update({ plan: activePlan })
    .eq("id", landlordId);
}

/**
 * Called by the webhook handler on `customer.subscription.deleted`.
 * Immediately downgrades the landlord to free_trial.
 */
export async function cancelSubscription(landlordId: string): Promise<void> {
  await supabase
    .from("landlords")
    .update({ plan: LANDLORD_PLAN.FREE_TRIAL, stripe_subscription_id: null })
    .eq("id", landlordId);
}

// ─── Landlord ID lookup from Stripe customer ──────────────────────────────────

/**
 * Resolves a landlord_id from a Stripe customer ID.
 * Returns null if not found.
 */
export async function landlordIdFromCustomer(
  stripeCustomerId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("landlords")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Resolves a landlord_id from a Stripe customer ID, falling back to
 * metadata on the event object.
 */
export async function resolveLandlordId(
  stripeCustomerId: string | null,
  metadata: Record<string, string | null>,
): Promise<string | null> {
  if (metadata.landlord_id) return metadata.landlord_id;
  if (stripeCustomerId) return landlordIdFromCustomer(stripeCustomerId);
  return null;
}

// ─── Stripe webhook verification ─────────────────────────────────────────────

/**
 * Parses and verifies a Stripe webhook request.
 * Returns the verified event or throws on signature mismatch.
 */
export async function parseStripeWebhook(req: Request): Promise<Stripe.Event> {
  const stripe = getStripe();
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");

  const body = await req.text();
  const sig  = req.headers.get("stripe-signature") ?? "";

  return stripe.webhooks.constructEvent(body, sig, secret);
}
