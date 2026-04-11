import Stripe from "stripe";

// ─── Stripe server client ─────────────────────────────────────────────────────
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-03-31.basil",
});

// ─── Plan → Stripe price ID mapping ──────────────────────────────────────────
export const STRIPE_PLAN_AMOUNTS_PENCE: Record<string, number> = {
  landlord_pro: 1999,
  tenancy_manager: 1499,
  portfolio: 3999,
  global_landlord: 2999,
};

// ─── Fetch MRR from active subscriptions ──────────────────────────────────────
export async function fetchMRR(): Promise<{
  mrr: number;
  breakdown: Record<string, number>;
}> {
  try {
    let hasMore = true;
    let startingAfter: string | undefined;
    let totalMrrPence = 0;
    const breakdown: Record<string, number> = {};

    while (hasMore) {
      const subs = await stripe.subscriptions.list({
        status: "active",
        limit: 100,
        starting_after: startingAfter,
        expand: ["data.items.data.price"],
      });

      for (const sub of subs.data) {
        for (const item of sub.items.data) {
          const price = item.price;
          if (price.recurring?.interval === "month") {
            const amount = (price.unit_amount ?? 0) * (item.quantity ?? 1);
            totalMrrPence += amount;
            const nickname = price.nickname ?? price.id;
            breakdown[nickname] = (breakdown[nickname] ?? 0) + amount;
          } else if (price.recurring?.interval === "year") {
            // Normalise annual to monthly
            const amount = Math.round(
              ((price.unit_amount ?? 0) * (item.quantity ?? 1)) / 12
            );
            totalMrrPence += amount;
          }
        }
      }

      hasMore = subs.has_more;
      if (hasMore && subs.data.length > 0) {
        startingAfter = subs.data[subs.data.length - 1].id;
      }
    }

    return { mrr: totalMrrPence, breakdown };
  } catch {
    return { mrr: 0, breakdown: {} };
  }
}

// ─── Pay-per-screen revenue this month ────────────────────────────────────────
export async function fetchPayPerScreenRevenue(): Promise<number> {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const charges = await stripe.charges.list({
      created: { gte: Math.floor(startOfMonth.getTime() / 1000) },
      limit: 100,
    });

    return charges.data
      .filter((c) => c.status === "succeeded")
      .reduce((sum, c) => sum + (c.amount ?? 0), 0);
  } catch {
    return 0;
  }
}

// ─── Recent transactions ──────────────────────────────────────────────────────
export async function fetchRecentTransactions(limit = 50) {
  try {
    const charges = await stripe.charges.list({ limit });
    return charges.data.map((c) => ({
      id: c.id,
      amount: c.amount,
      currency: c.currency,
      status: c.status,
      description: c.description,
      created: c.created,
      customerEmail: typeof c.billing_details?.email === "string"
        ? c.billing_details.email
        : null,
    }));
  } catch {
    return [];
  }
}

// ─── Failed payments ──────────────────────────────────────────────────────────
export async function fetchFailedPayments(limit = 20) {
  try {
    const invoices = await stripe.invoices.list({
      status: "open",
      limit,
    });
    return invoices.data.filter(
      (inv) => inv.attempt_count > 0 && !inv.paid
    );
  } catch {
    return [];
  }
}

// ─── Subscription events this month ───────────────────────────────────────────
export async function fetchSubscriptionStats() {
  try {
    const startOfMonth = Math.floor(
      new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000
    );

    const [newSubs, canceledSubs] = await Promise.all([
      stripe.subscriptions.list({
        created: { gte: startOfMonth },
        status: "active",
        limit: 100,
      }),
      stripe.subscriptions.list({
        created: { gte: startOfMonth },
        status: "canceled",
        limit: 100,
      }),
    ]);

    return {
      newCount: newSubs.data.length,
      churnCount: canceledSubs.data.length,
    };
  } catch {
    return { newCount: 0, churnCount: 0 };
  }
}
