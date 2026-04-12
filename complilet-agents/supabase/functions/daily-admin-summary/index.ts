/**
 * daily-admin-summary Edge Function
 *
 * Runs daily at 8 PM UK time via pg_cron.
 * Queries platform stats and sends a WhatsApp summary to admin phone(s).
 *
 * Can also be triggered via POST for testing:
 *   curl -X POST https://PROJECT.supabase.co/functions/v1/daily-admin-summary \
 *     -H "Authorization: Bearer SERVICE_ROLE_KEY"
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { format } from "https://esm.sh/date-fns@4";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN")!;
const PHONE_NUMBER_ID = Deno.env.get("PHONE_NUMBER_ID")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

const ADMIN_PHONES: string[] = (Deno.env.get("ADMIN_PHONES") ?? "")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

// ─── WhatsApp send ────────────────────────────────────────────────────────────
async function sendWhatsApp(to: string, body: string): Promise<void> {
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    }
  );
  if (!res.ok) console.error("[daily-summary] WhatsApp send failed:", await res.text());
}

// ─── Stripe MRR helper ────────────────────────────────────────────────────────
async function getMRR(): Promise<number> {
  if (!STRIPE_SECRET_KEY) return 0;
  try {
    const res = await fetch("https://api.stripe.com/v1/subscriptions?status=active&limit=100", {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });
    const data = await res.json();
    let mrr = 0;
    for (const sub of data.data ?? []) {
      for (const item of sub.items?.data ?? []) {
        if (item.price?.recurring?.interval === "month") {
          mrr += (item.price.unit_amount ?? 0) * (item.quantity ?? 1);
        }
      }
    }
    return mrr;
  } catch {
    return 0;
  }
}

// ─── Revenue today ────────────────────────────────────────────────────────────
async function getRevenueToday(): Promise<number> {
  if (!STRIPE_SECRET_KEY) return 0;
  try {
    const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const res = await fetch(
      `https://api.stripe.com/v1/charges?created[gte]=${startOfDay}&limit=100`,
      { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } }
    );
    const data = await res.json();
    return (data.data ?? [])
      .filter((c: { status: string; amount: number }) => c.status === "succeeded")
      .reduce((sum: number, c: { amount: number }) => sum + c.amount, 0);
  } catch {
    return 0;
  }
}

// ─── Main summary builder ─────────────────────────────────────────────────────
async function buildSummary(): Promise<{ short: string; detail: string }> {
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: totalLandlords },
    { count: newLandlordsToday },
    { count: screeningsCompletedToday },
    { count: screeningsInProgress },
    { count: activeTenancies },
    { data: openEscalations },
    { count: arrearsCount },
    { count: overdueCompliance },
    { count: agentCallsToday },
    agentCostToday,
    mrrPence,
    revenueToday,
  ] = await Promise.all([
    supabase.from("landlords").select("*", { count: "exact", head: true }),
    supabase.from("landlords").select("*", { count: "exact", head: true }).gte("created_at", startOfDay),
    supabase.from("screening_sessions").select("*", { count: "exact", head: true }).eq("status", "completed").gte("created_at", startOfDay),
    supabase.from("screening_sessions").select("*", { count: "exact", head: true }).not("status", "in", "(completed,cancelled)"),
    supabase.from("tenancies").select("*", { count: "exact", head: true }).eq("status", "active").catch(() => ({ count: 0 })),
    supabase.from("escalations").select("priority, status").in("status", ["open", "in_progress"]),
    supabase.from("tenancies").select("*", { count: "exact", head: true }).in("rent_status", ["overdue", "arrears"]).catch(() => ({ count: 0 })),
    supabase.from("compliance_deadlines").select("*", { count: "exact", head: true }).lt("due_date", today.toISOString()).eq("status", "pending").catch(() => ({ count: 0 })),
    supabase.from("agent_logs").select("*", { count: "exact", head: true }).gte("created_at", startOfDay),
    supabase.from("agent_logs").select("cost_estimate").gte("created_at", startOfDay).then((r) => {
      return (r.data ?? []).reduce((s, l) => s + (l.cost_estimate ?? 0), 0);
    }).catch(() => 0),
    getMRR(),
    getRevenueToday(),
  ]);

  const urgentCount = (openEscalations ?? []).filter((e) => e.priority === "urgent").length;
  const openCount = (openEscalations ?? []).length;

  const dateStr = format(today, "d MMM yyyy");
  const mrrFormatted = `£${(mrrPence / 100).toFixed(0)}`;
  const revFormatted = revenueToday > 0 ? `£${(revenueToday / 100).toFixed(2)}` : "£0.00";
  const costFormatted = `$${agentCostToday.toFixed(2)}`;

  const needsAttention: string[] = [];
  if (openCount > 0)
    needsAttention.push(`${openCount} open escalation${openCount !== 1 ? "s" : ""}${urgentCount > 0 ? ` (${urgentCount} urgent)` : ""}`);
  if ((arrearsCount ?? 0) > 0)
    needsAttention.push(`${arrearsCount} tenant${(arrearsCount ?? 0) !== 1 ? "s" : ""} in arrears`);
  if ((overdueCompliance ?? 0) > 0)
    needsAttention.push(`${overdueCompliance} compliance deadline${(overdueCompliance ?? 0) !== 1 ? "s" : ""} overdue`);

  // ── Short message ─────────────────────────────────────────────────────────────
  const short = [
    `📊 *CompliLet Daily Summary — ${dateStr}*`,
    "",
    `👥 Landlords: ${totalLandlords ?? 0} (+${newLandlordsToday ?? 0} today)`,
    `🔍 Screenings: ${screeningsCompletedToday ?? 0} completed, ${screeningsInProgress ?? 0} in progress`,
    `🏠 Active tenancies: ${activeTenancies ?? 0}`,
    `💷 Revenue today: ${revFormatted}`,
    `📈 MRR: ${mrrFormatted}`,
    "",
    needsAttention.length > 0
      ? `⚠️ *Needs attention:*\n${needsAttention.map((i) => `- ${i}`).join("\n")}`
      : "✅ Nothing needs attention",
    "",
    `🤖 Agent costs today: ${costFormatted} (${agentCallsToday ?? 0} API calls)`,
    "",
    `Reply *detail* for full breakdown.`,
  ].join("\n");

  // ── Detailed message (on request) ─────────────────────────────────────────────
  const detail = [
    `📊 *CompliLet Detail — ${dateStr}*`,
    "",
    `*Platform*`,
    `- Total landlords: ${totalLandlords ?? 0} (+${newLandlordsToday ?? 0} today)`,
    `- Screenings today: ${screeningsCompletedToday ?? 0} completed`,
    `- In-progress screenings: ${screeningsInProgress ?? 0}`,
    `- Active tenancies: ${activeTenancies ?? 0}`,
    "",
    `*Revenue*`,
    `- Revenue today: ${revFormatted}`,
    `- Current MRR: ${mrrFormatted}`,
    "",
    `*Compliance*`,
    `- Open escalations: ${openCount}${urgentCount > 0 ? ` (${urgentCount} urgent!)` : ""}`,
    `- Tenants in arrears: ${arrearsCount ?? 0}`,
    `- Overdue compliance: ${overdueCompliance ?? 0}`,
    "",
    `*AI Agents*`,
    `- API calls today: ${agentCallsToday ?? 0}`,
    `- Cost today: ${costFormatted}`,
    "",
    `View dashboard: ${Deno.env.get("ADMIN_DASHBOARD_URL") ?? "https://admin.complilet.com"}/internal`,
  ].join("\n");

  return { short, detail };
}

// ─── Entry point ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // Allow OPTIONS for CORS (though this function is internal)
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  try {
    if (!ADMIN_PHONES.length) {
      return new Response(
        JSON.stringify({ error: "ADMIN_PHONES not configured" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const { short } = await buildSummary();

    // Send to all admin phones
    await Promise.all(ADMIN_PHONES.map((phone) => sendWhatsApp(phone, short)));

    console.log(`[daily-admin-summary] Sent to ${ADMIN_PHONES.length} admin phone(s)`);

    return new Response(JSON.stringify({ ok: true, sentTo: ADMIN_PHONES.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[daily-admin-summary] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
