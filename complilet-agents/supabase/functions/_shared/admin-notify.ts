/**
 * Admin notification helper
 * Sends instant WhatsApp alerts to admin phone numbers for critical events.
 * Used by: stripe-webhook, coordinator (escalation creation), whatsapp-webhook (API errors)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN")!;
const PHONE_NUMBER_ID = Deno.env.get("PHONE_NUMBER_ID")!;

// Admin phone number(s) — comma-separated in env, E.164 without +
const ADMIN_PHONES: string[] = (Deno.env.get("ADMIN_PHONES") ?? "")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

export type AdminAlertType =
  | "urgent_escalation"
  | "payment_failure"
  | "api_error"
  | "new_landlord"
  | "high_value_churn";

interface AdminAlertPayload {
  type: AdminAlertType;
  detail: string;
  actionNeeded?: string;
  dashboardPath?: string;
}

// ─── Send WhatsApp to a phone number ─────────────────────────────────────────
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

  if (!res.ok) {
    const err = await res.text();
    console.error(`[admin-notify] WhatsApp send failed to ${to}: ${err}`);
  }
}

// ─── Main alert function ──────────────────────────────────────────────────────
export async function notifyAdmin(payload: AdminAlertPayload): Promise<void> {
  if (!ADMIN_PHONES.length) {
    console.warn("[admin-notify] ADMIN_PHONES env var is not set — skipping alert");
    return;
  }

  const dashboardUrl = Deno.env.get("ADMIN_DASHBOARD_URL") ?? "https://admin.complilet.com";
  const path = payload.dashboardPath ?? "/internal";
  const icon = {
    urgent_escalation: "🚨",
    payment_failure: "💳",
    api_error: "⚙️",
    new_landlord: "👋",
    high_value_churn: "⚠️",
  }[payload.type] ?? "ℹ️";

  const typeLabel = {
    urgent_escalation: "Urgent Escalation",
    payment_failure: "Payment Failure",
    api_error: "API Error",
    new_landlord: "New Landlord",
    high_value_churn: "High Value Churn",
  }[payload.type] ?? payload.type;

  const message = [
    `${icon} *CompliLet Alert*`,
    `Type: ${typeLabel}`,
    `Detail: ${payload.detail}`,
    payload.actionNeeded ? `Action needed: ${payload.actionNeeded}` : null,
    `Dashboard: ${dashboardUrl}${path}`,
  ]
    .filter(Boolean)
    .join("\n");

  await Promise.all(ADMIN_PHONES.map((phone) => sendWhatsApp(phone, message)));
}
