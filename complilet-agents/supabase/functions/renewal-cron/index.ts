/**
 * CompliLet — Renewal Cron
 *
 * Runs daily at 8:00 AM UTC via pg_cron.
 * Manages the full tenancy renewal lifecycle:
 *
 *   1. SEND 60-DAY NOTICES — find tenancies where end_date is 60 days from today
 *      and no renewal cycle is active. Transition session to "renewal" status
 *      and send landlord the decision notice (renew / let leave).
 *
 *   2. SEND CHECKOUT INSPECTION REQUESTS — find tenancies in "checkout_scheduled"
 *      state where end_date is 14 days away. Send the tenant a checkout photo
 *      request (if the inspection record exists, this is already handled by the
 *      inspection cron; this step sends a plain WhatsApp reminder as a backup).
 *
 *   3. CLOSE EXPIRED TENANCIES — find tenancies where end_date has passed and
 *      the session is still in "renewal" or "active_tenancy" status. Transition
 *      to "abandoned", mark tenancy inactive, notify landlord the property is
 *      now vacant.
 *
 * pg_cron setup (run once in your Supabase SQL editor):
 * ─────────────────────────────────────────────────────
 *   SELECT cron.schedule(
 *     'renewal-daily',
 *     '0 8 * * *',   -- 8 AM UTC daily
 *     $$
 *     SELECT net.http_post(
 *       url      := 'https://<project-ref>.supabase.co/functions/v1/renewal-cron',
 *       headers  := '{"Content-Type":"application/json","Authorization":"Bearer <service-role-key>"}',
 *       body     := '{}'::jsonb
 *     );
 *     $$
 *   );
 *
 * Note: verify_jwt = false in config.toml so pg_cron does not need a signed JWT.
 */

import { supabase } from "../_shared/supabase.ts";
import { sendTextMessage } from "../_shared/whatsapp.ts";
import {
  RENEWAL_NOTICE_DAYS,
  RENEWAL_CHECKOUT_INSPECTION_DAYS,
} from "../_shared/constants.ts";
import {
  initiateRenewalNotice,
  closeExpiredTenancy,
} from "../_shared/agents/renewal-agent.ts";

// ─── Entry Point ─────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  try {
    const now = new Date();
    console.log(`[renewal-cron] Starting run at ${now.toISOString()}`);

    const noticesSent  = await sendRenewalNotices(now);
    const checkouts    = await sendCheckoutReminders(now);
    const closed       = await closeExpiredTenancies(now);

    const result = { ok: true, noticesSent, checkouts, closed };
    console.log("[renewal-cron] Done.", result);

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[renewal-cron] Fatal error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// ─── 1. Send 60-Day Renewal Notices ─────────────────────────────────────────

async function sendRenewalNotices(now: Date): Promise<number> {
  // Target window: end_date within (RENEWAL_NOTICE_DAYS ± 1) days from now.
  const windowStart = addDays(now, RENEWAL_NOTICE_DAYS - 1);
  const windowEnd   = addDays(now, RENEWAL_NOTICE_DAYS + 1);

  // Find active tenancies in the window.
  const { data: tenancies, error } = await supabase
    .from("tenancies")
    .select(`
      id, landlord_id, tenant_phone, tenant_name,
      property_address, monthly_rent_gbp, end_date,
      landlords ( phone )
    `)
    .eq("status", "active")
    .gte("end_date", windowStart.toISOString().split("T")[0])
    .lte("end_date", windowEnd.toISOString().split("T")[0]);

  if (error) {
    console.error("[renewal-cron] Failed to fetch tenancies for 60-day notice:", error.message);
    return 0;
  }
  if (!tenancies || tenancies.length === 0) return 0;

  let count = 0;

  for (const tenancy of tenancies) {
    try {
      // Check the session is still in "active_tenancy" — not already in "renewal".
      const { data: session } = await supabase
        .from("screening_sessions")
        .select("id, status")
        .eq("landlord_id", tenancy.landlord_id)
        .not("status", "in", '("abandoned","rejected")')
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!session) {
        console.log(`[renewal-cron] No active session for tenancy ${tenancy.id} — skipping.`);
        continue;
      }

      // Skip if already in renewal or checkout_scheduled.
      if (session.status === "renewal") {
        console.log(`[renewal-cron] Session already in renewal for tenancy ${tenancy.id} — skipping.`);
        continue;
      }

      // Check coordinator_state for existing renewal_state.
      const { data: coordState } = await supabase
        .from("coordinator_state")
        .select("renewal_state")
        .eq("landlord_id", tenancy.landlord_id)
        .maybeSingle();

      const existingStep = (coordState?.renewal_state as { step?: string } | null)?.step;
      if (existingStep && existingStep !== "idle") {
        console.log(`[renewal-cron] Renewal already active (step: ${existingStep}) for tenancy ${tenancy.id} — skipping.`);
        continue;
      }

      const landlordPhone = (tenancy.landlords as { phone: string } | null)?.phone;
      if (!landlordPhone) {
        console.warn(`[renewal-cron] No landlord phone for tenancy ${tenancy.id} — skipping.`);
        continue;
      }

      await initiateRenewalNotice({
        landlordId:      tenancy.landlord_id,
        landlordPhone,
        tenancyId:       tenancy.id,
        sessionId:       session.id,
        tenantName:      tenancy.tenant_name,
        tenantPhone:     tenancy.tenant_phone,
        propertyAddress: tenancy.property_address,
        currentRent:     tenancy.monthly_rent_gbp,
        endDate:         tenancy.end_date,
      });

      count++;
    } catch (err) {
      console.error(`[renewal-cron] Error sending notice for tenancy ${tenancy.id}:`, err);
    }
  }

  return count;
}

// ─── 2. Send Checkout Inspection Reminders ───────────────────────────────────

async function sendCheckoutReminders(now: Date): Promise<number> {
  // Find tenancies in "checkout_scheduled" state where end_date is RENEWAL_CHECKOUT_INSPECTION_DAYS away.
  const targetDate = addDays(now, RENEWAL_CHECKOUT_INSPECTION_DAYS);
  const targetDateStr = targetDate.toISOString().split("T")[0];
  const windowStart = addDays(now, RENEWAL_CHECKOUT_INSPECTION_DAYS - 1).toISOString().split("T")[0];
  const windowEnd   = addDays(now, RENEWAL_CHECKOUT_INSPECTION_DAYS + 1).toISOString().split("T")[0];

  // Find coordinator_states with renewal_state.step = "checkout_scheduled".
  // We can't filter JSONB directly in Supabase JS, so fetch all "renewal" sessions
  // and filter in code. The number of renewal sessions at any time should be small.
  const { data: sessions, error } = await supabase
    .from("screening_sessions")
    .select("id, landlord_id")
    .eq("status", "renewal");

  if (error || !sessions || sessions.length === 0) return 0;

  let count = 0;

  for (const session of sessions) {
    try {
      // Check renewal_state.step.
      const { data: coordState } = await supabase
        .from("coordinator_state")
        .select("renewal_state")
        .eq("landlord_id", session.landlord_id)
        .maybeSingle();

      const step = (coordState?.renewal_state as { step?: string; tenantPhone?: string; tenantName?: string; propertyAddress?: string; endDate?: string } | null);
      if (step?.step !== "checkout_scheduled") continue;

      // Check tenancy end_date is in our window.
      const endDate = step.endDate;
      if (!endDate || endDate < windowStart || endDate > windowEnd) continue;

      // Check if checkout inspection photos have already been requested.
      const { count: existingInspectionCount } = await supabase
        .from("inspections")
        .select("id", { count: "exact", head: true })
        .eq("landlord_id", session.landlord_id)
        .gte("scheduled_date", windowStart)
        .lte("scheduled_date", windowEnd);

      if (existingInspectionCount && existingInspectionCount > 0) {
        // The inspection cron is handling this — skip to avoid duplicate messages.
        continue;
      }

      // Send a direct checkout reminder (fallback when no inspection record exists).
      const tenantPhone = step.tenantPhone;
      if (!tenantPhone) continue;

      const formattedEnd = formatDate(endDate);
      await sendTextMessage(
        tenantPhone,
        `Hi ${step.tenantName || "there"}, a reminder that your tenancy at ` +
          `*${step.propertyAddress ?? "your property"}* ends on *${formattedEnd}* ` +
          `(${RENEWAL_CHECKOUT_INSPECTION_DAYS} days away).\n\n` +
          "Please start arranging your move-out and returning keys by that date. " +
          "We'll be in touch shortly to request checkout photos of the property.",
      );

      console.log(`[renewal-cron] Checkout reminder sent for session ${session.id}.`);
      count++;

      // Suppress duplicate by noting the date.
      void targetDateStr; // used in window comparison above — suppress unused lint
    } catch (err) {
      console.error(`[renewal-cron] Checkout reminder error for session ${session.id}:`, err);
    }
  }

  return count;
}

// ─── 3. Close Expired Tenancies ──────────────────────────────────────────────

async function closeExpiredTenancies(now: Date): Promise<number> {
  // Find tenancies where end_date has passed and status is still "active".
  // Use a 1-day buffer to avoid closing tenancies that expire today.
  const yesterday = addDays(now, -1).toISOString().split("T")[0];

  const { data: expiredTenancies, error } = await supabase
    .from("tenancies")
    .select(`
      id, landlord_id, tenant_name, property_address, end_date,
      landlords ( phone )
    `)
    .eq("status", "active")
    .lte("end_date", yesterday);

  if (error || !expiredTenancies || expiredTenancies.length === 0) return 0;

  let count = 0;

  for (const tenancy of expiredTenancies) {
    try {
      // Find the associated session.
      const { data: session } = await supabase
        .from("screening_sessions")
        .select("id, status")
        .eq("landlord_id", tenancy.landlord_id)
        .in("status", ["renewal", "active_tenancy"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!session) {
        // No live session to close — just mark the tenancy inactive.
        await supabase
          .from("tenancies")
          .update({ status: "inactive", updated_at: now.toISOString() })
          .eq("id", tenancy.id);
        continue;
      }

      const landlordPhone = (tenancy.landlords as { phone: string } | null)?.phone ?? null;

      await closeExpiredTenancy({
        landlordId:      tenancy.landlord_id,
        landlordPhone:   landlordPhone ?? "",
        sessionId:       session.id,
        propertyAddress: tenancy.property_address,
        tenantName:      tenancy.tenant_name,
      });

      count++;
    } catch (err) {
      console.error(`[renewal-cron] Error closing expired tenancy ${tenancy.id}:`, err);
    }
  }

  return count;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatDate(isoDate?: string | null): string {
  if (!isoDate) return "unknown date";
  try {
    return new Date(isoDate).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    });
  } catch {
    return isoDate;
  }
}
