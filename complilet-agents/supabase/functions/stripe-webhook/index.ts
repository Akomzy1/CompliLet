/**
 * CompliLet — Stripe Webhook Handler
 *
 * Receives and verifies events from Stripe, then updates the database
 * and notifies landlords via WhatsApp.
 *
 * verify_jwt = false — Stripe signs requests with HMAC-SHA256 via the
 * Stripe-Signature header. Verification is done inside parseStripeWebhook().
 *
 * Handled events:
 *
 *   checkout.session.completed
 *     - pay_per_screen  → add one payment credit, WhatsApp confirmation
 *     - subscribe       → activate plan on landlords row, WhatsApp confirmation
 *
 *   customer.subscription.updated
 *     → Sync landlords.plan with current Stripe subscription status
 *
 *   customer.subscription.deleted
 *     → Downgrade landlord to free_trial, WhatsApp notification
 *
 *   invoice.payment_failed
 *     → WhatsApp landlord with retry link
 *
 *   charge.dispute.created
 *     → Trigger human escalation (high priority)
 *
 * Required env vars (see _shared/billing.ts for full list):
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 */

// deno-lint-ignore-file no-explicit-any
import Stripe from "npm:stripe@17";
import {
  parseStripeWebhook,
  activatePayPerScreenCredit,
  activateSubscription,
  syncSubscriptionPlan,
  cancelSubscription,
  resolveLandlordId,
  landlordIdFromCustomer,
} from "../_shared/billing.ts";
import { sendTextMessage } from "../_shared/whatsapp.ts";
import { supabase } from "../_shared/supabase.ts";
import { executeEscalation } from "../_shared/escalation.ts";
import { PLAN_LABELS, type LandlordPlan } from "../_shared/constants.ts";
import { notifyAdmin } from "../_shared/admin-notify.ts";

// ─── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let event: Stripe.Event;
  try {
    event = await parseStripeWebhook(req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[stripe-webhook] Signature verification failed:", msg);
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.info(`[stripe-webhook] Received: ${event.type} (${event.id})`);

  try {
    await handleEvent(event);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe-webhook] Handler error for ${event.type}:`, msg);
    // Return 200 so Stripe does not retry — log internally instead
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// ─── Event router ─────────────────────────────────────────────────────────────

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;

    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;

    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;

    case "invoice.payment_failed":
      await handlePaymentFailed(event.data.object as Stripe.Invoice);
      break;

    case "charge.dispute.created":
      await handleDisputeCreated(event.data.object as Stripe.Dispute);
      break;

    default:
      console.info(`[stripe-webhook] Unhandled event type: ${event.type}`);
  }
}

// ─── checkout.session.completed ───────────────────────────────────────────────

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const meta = (session.metadata ?? {}) as Record<string, string | null>;
  const customerId = typeof session.customer === "string" ? session.customer : null;

  const landlordId = await resolveLandlordId(customerId, meta);
  if (!landlordId) {
    console.error("[stripe-webhook] checkout.session.completed — no landlord_id in metadata or customers table:", session.id);
    return;
  }

  const action = meta.action;

  if (action === "pay_per_screen") {
    await handlePayPerScreenCompleted(landlordId, customerId, session);
    return;
  }

  if (action === "subscribe") {
    const plan = (meta.plan ?? "") as LandlordPlan;
    await handleSubscribeCompleted(landlordId, customerId, plan, session);
    return;
  }

  console.warn("[stripe-webhook] checkout.session.completed — unknown action:", action);
}

async function handlePayPerScreenCompleted(
  landlordId: string,
  customerId: string | null,
  session: Stripe.Checkout.Session,
): Promise<void> {
  // Persist Stripe customer ID if this is the first payment
  if (customerId) {
    await supabase
      .from("landlords")
      .update({ stripe_customer_id: customerId })
      .eq("id", landlordId)
      .is("stripe_customer_id", null); // only update if not already set
  }

  // Add one screening credit
  await activatePayPerScreenCredit(landlordId);

  // Fetch the landlord's phone number to send confirmation
  const phone = await getLandlordPhone(landlordId);
  if (phone) {
    await sendTextMessage(
      phone,
      "✅ *Payment received — thank you!*\n\n" +
        "Your £4.99 screening credit is now active. " +
        "Type *SCREEN* to start screening your tenant.",
    );
  }

  // Alert admin about new pay-per-screen purchase (useful early on)
  await notifyAdmin({
    type: "new_landlord",
    detail: `Pay-per-screen purchase — landlord ${landlordId}`,
    dashboardPath: `/internal/landlords/${landlordId}`,
  });

  console.info(`[stripe-webhook] Pay-per-screen credit added for landlord ${landlordId} (checkout: ${session.id})`);
}

async function handleSubscribeCompleted(
  landlordId: string,
  customerId: string | null,
  plan: LandlordPlan,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription as Stripe.Subscription | null)?.id ?? "";

  if (!subscriptionId) {
    console.error("[stripe-webhook] subscribe checkout completed but no subscription ID");
    return;
  }

  await activateSubscription(
    landlordId,
    plan,
    subscriptionId,
    customerId ?? "",
  );

  const phone = await getLandlordPhone(landlordId);
  if (phone) {
    const planLabel = PLAN_LABELS[plan] ?? plan;
    await sendTextMessage(
      phone,
      `✅ *Subscription activated — welcome to ${planLabel.split(" —")[0]}!*\n\n` +
        "Your account has been upgraded and you now have unlimited screenings. " +
        "Type *SCREEN* whenever you're ready to screen a new tenant.\n\n" +
        "Type *PRICING* to see your plan details or *HELP* for all commands.",
    );
  }

  // Alert admin about new subscription
  await notifyAdmin({
    type: "new_landlord",
    detail: `New subscription: ${PLAN_LABELS[plan] ?? plan} — landlord ${landlordId}`,
    dashboardPath: `/internal/landlords/${landlordId}`,
  });

  console.info(`[stripe-webhook] Subscription ${subscriptionId} activated for landlord ${landlordId} (plan: ${plan})`);
}

// ─── customer.subscription.updated ───────────────────────────────────────────

async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
): Promise<void> {
  const meta = (subscription.metadata ?? {}) as Record<string, string | null>;
  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : null;

  const landlordId = await resolveLandlordId(customerId, meta);
  if (!landlordId) {
    console.warn("[stripe-webhook] subscription.updated — no landlord_id found for customer:", customerId);
    return;
  }

  const plan = (meta.plan ?? "") as LandlordPlan;
  if (!plan) {
    console.warn("[stripe-webhook] subscription.updated — no plan in metadata:", subscription.id);
    return;
  }

  await syncSubscriptionPlan(landlordId, plan, subscription.status);

  // Notify the landlord if subscription was paused or moved to past_due
  if (subscription.status === "past_due" || subscription.status === "unpaid") {
    const phone = await getLandlordPhone(landlordId);
    if (phone) {
      const invoiceUrl = await getRetryPaymentUrl(subscription.latest_invoice);
      await sendTextMessage(
        phone,
        "⚠️ *Action needed: payment issue on your CompliLet subscription.*\n\n" +
          "We were unable to collect your subscription payment. " +
          "Your account has been temporarily paused.\n\n" +
          (invoiceUrl ? `Retry your payment here:\n${invoiceUrl}` : "Please contact us to update your payment method."),
      );
    }
  }

  console.info(`[stripe-webhook] Subscription updated for landlord ${landlordId}: status=${subscription.status}, plan=${plan}`);
}

// ─── customer.subscription.deleted ───────────────────────────────────────────

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
): Promise<void> {
  const meta = (subscription.metadata ?? {}) as Record<string, string | null>;
  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : null;

  const landlordId = await resolveLandlordId(customerId, meta);
  if (!landlordId) {
    console.warn("[stripe-webhook] subscription.deleted — no landlord_id found:", customerId);
    return;
  }

  await cancelSubscription(landlordId);

  const phone = await getLandlordPhone(landlordId);
  if (phone) {
    await sendTextMessage(
      phone,
      "ℹ️ *Your CompliLet subscription has been cancelled.*\n\n" +
        "You can still use CompliLet on a pay-per-screen basis (£4.99 per screening).\n\n" +
        "Type *PRICING* to see all options, or *SCREEN* to pay for a single screening.",
    );
  }

  console.info(`[stripe-webhook] Subscription cancelled for landlord ${landlordId}`);
}

// ─── invoice.payment_failed ───────────────────────────────────────────────────

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === "string"
    ? invoice.customer
    : null;

  if (!customerId) return;

  const landlordId = await landlordIdFromCustomer(customerId);
  if (!landlordId) {
    console.warn("[stripe-webhook] invoice.payment_failed — no landlord for customer:", customerId);
    return;
  }

  const retryUrl = await getRetryPaymentUrl(invoice);
  const phone = await getLandlordPhone(landlordId);

  if (phone) {
    await sendTextMessage(
      phone,
      "⚠️ *Payment failed on your CompliLet subscription.*\n\n" +
        "We couldn't charge your card. Your screenings will be paused until " +
        "payment is resolved.\n\n" +
        (retryUrl
          ? `Please retry your payment:\n${retryUrl}`
          : "Please contact support to update your payment details."),
    );
  }

  // Alert admin instantly — payment failure needs prompt attention
  await notifyAdmin({
    type: "payment_failure",
    detail: `Invoice ${invoice.id} failed — landlord ${landlordId}`,
    actionNeeded: "Check Stripe and contact landlord if needed",
    dashboardPath: `/internal/revenue`,
  });

  console.info(`[stripe-webhook] Payment failed for landlord ${landlordId} (invoice: ${invoice.id})`);
}

// ─── charge.dispute.created ───────────────────────────────────────────────────

async function handleDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
  const reason = dispute.reason ?? "unknown";
  const amountGbp = (dispute.amount / 100).toFixed(2);

  console.warn(`[stripe-webhook] Dispute created: charge=${chargeId}, reason=${reason}, amount=£${amountGbp}`);

  // Resolve the landlord from the charge's customer
  let landlordId: string | null = null;
  let senderPhone = "unknown";

  if (chargeId) {
    try {
      const Stripe_sdk = await import("npm:stripe@17");
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (stripeKey) {
        const stripe = new Stripe_sdk.default(stripeKey, { apiVersion: "2024-11-20.acacia" });
        const charge = await stripe.charges.retrieve(chargeId);
        const customerId = typeof charge.customer === "string"
          ? charge.customer
          : null;
        if (customerId) {
          landlordId = await landlordIdFromCustomer(customerId);
          if (landlordId) {
            const phone = await getLandlordPhone(landlordId);
            if (phone) senderPhone = phone;
          }
        }
      }
    } catch (err: unknown) {
      console.error("[stripe-webhook] Failed to retrieve charge for dispute:", err);
    }
  }

  // Trigger a high-priority human escalation
  await executeEscalation({
    messageText: `Stripe dispute created: charge ${chargeId}, reason: ${reason}, amount: £${amountGbp}`,
    triggerType: "fraud_indicator",
    priority:    "high",
    context:     `Stripe charge dispute. Reason: ${reason}. Amount: £${amountGbp}. Charge ID: ${chargeId}. Landlord ID: ${landlordId ?? "unknown"}.`,
    senderPhone,
    landlordId:  landlordId ?? undefined,
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function getLandlordPhone(landlordId: string): Promise<string | null> {
  const { data } = await supabase
    .from("landlords")
    .select("phone")
    .eq("id", landlordId)
    .maybeSingle();
  return data?.phone ?? null;
}

/**
 * Retrieves the hosted payment URL from an invoice object or ID.
 * Used to send landlords a direct retry link.
 */
async function getRetryPaymentUrl(
  invoiceOrId: string | Stripe.Invoice | Stripe.DeletedInvoice | null | undefined,
): Promise<string | null> {
  if (!invoiceOrId) return null;

  if (typeof invoiceOrId === "string") {
    try {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) return null;
      const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });
      const invoice = await stripe.invoices.retrieve(invoiceOrId);
      return invoice.hosted_invoice_url ?? null;
    } catch {
      return null;
    }
  }

  return (invoiceOrId as Stripe.Invoice).hosted_invoice_url ?? null;
}
