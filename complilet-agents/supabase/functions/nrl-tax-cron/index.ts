/**
 * CompliLet — NRL Tax Compliance Cron
 *
 * Runs daily at 7:00 AM UTC via pg_cron.
 * Sends NRL-related reminders to all confirmed overseas landlords:
 *
 *   1. APPROVAL FOLLOW-UP — 6 weeks after NRL1 guidance is given, check if
 *      HMRC has responded. Only fires if nrl1Submitted is still false.
 *
 *   2. NRL1 EXPIRY REMINDER — 30 days before the stored nrl1ExpiryDate.
 *      One reminder per landlord per calendar year.
 *
 *   3. SELF ASSESSMENT REMINDER — 90, 30, and 7 days before the 31 January
 *      filing deadline. Deduped per landlord per threshold per tax year.
 *
 *   4. QUARTERLY PAYMENT REMINDER — 1st of January, April, July, and October.
 *      Prompts landlords to keep records and check payment-on-account dates.
 *
 * pg_cron setup (run once in your Supabase SQL editor):
 * ─────────────────────────────────────────────────────
 *   SELECT cron.schedule(
 *     'nrl-daily',
 *     '0 7 * * *',   -- 7 AM UTC daily
 *     $$
 *     SELECT net.http_post(
 *       url      := 'https://<project-ref>.supabase.co/functions/v1/nrl-tax-cron',
 *       headers  := '{"Content-Type":"application/json","Authorization":"Bearer <service-role-key>"}',
 *       body     := '{}'::jsonb
 *     );
 *     $$
 *   );
 */

import { supabase } from "../_shared/supabase.ts";
import {
  sendNrlReminder,
  logNrlEvent,
  type NrlState,
  type NrlEventType,
} from "../_shared/agents/nrl-tax-agent.ts";
import {
  NRL_WITHHOLDING_TAX_RATE,
  NRL_EXPIRY_REMINDER_DAYS,
  NRL_APPROVAL_REMINDER_WEEKS,
  NRL_SA_REMINDER_ADVANCE_DAYS,
  NRL_QUARTERLY_REMINDER_MONTHS,
  NRL_APPROVAL_WEEKS_TYPICAL,
} from "../_shared/constants.ts";

// ─── Entry Point ─────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  try {
    const now = new Date();
    console.log(`[nrl-tax-cron] Starting run at ${now.toISOString()}`);

    const approvalFollowUps  = await sendApprovalFollowUps(now);
    const expiries           = await sendExpiryReminders(now);
    const saReminders        = await sendSaReminders(now);
    const quarterlyReminders = await sendQuarterlyReminders(now);

    const result = { ok: true, approvalFollowUps, expiries, saReminders, quarterlyReminders };
    console.log("[nrl-tax-cron] Done.", result);

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[nrl-tax-cron] Fatal error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// ─── Shared: load all confirmed overseas landlords ─────────────────────────

interface OverseasLandlord {
  landlordId: string;
  landlordPhone: string;
  nrlState: NrlState;
}

async function getOverseasLandlords(): Promise<OverseasLandlord[]> {
  // Query the nrl_events table for confirmed overseas events.
  const { data: confirmedEvents, error } = await supabase
    .from("nrl_events")
    .select("landlord_id")
    .eq("event_type", "confirmed_overseas");

  if (error || !confirmedEvents || confirmedEvents.length === 0) return [];

  // Deduplicate landlord IDs.
  const landlordIds = [
    ...new Set(confirmedEvents.map((e: { landlord_id: string }) => e.landlord_id)),
  ];

  const results: OverseasLandlord[] = [];

  for (const landlordId of landlordIds) {
    try {
      // Get phone number.
      const { data: landlord } = await supabase
        .from("landlords")
        .select("phone")
        .eq("id", landlordId)
        .maybeSingle();

      if (!landlord?.phone) continue;

      // Get NRL state from coordinator_state.
      const { data: coordRow } = await supabase
        .from("coordinator_state")
        .select("nrl_state")
        .eq("landlord_id", landlordId)
        .maybeSingle();

      const nrlState = (coordRow?.nrl_state as NrlState | null) ?? { step: "idle" };

      // Skip if not confirmed overseas (state may have been reset).
      if (!nrlState.isOverseas) continue;

      results.push({ landlordId, landlordPhone: landlord.phone, nrlState });
    } catch (err) {
      console.error(`[nrl-tax-cron] Error loading landlord ${landlordId}:`, err);
    }
  }

  return results;
}

// ─── 1. Approval Follow-Up ────────────────────────────────────────────────

async function sendApprovalFollowUps(now: Date): Promise<number> {
  const landlords = await getOverseasLandlords();
  let count = 0;

  for (const { landlordId, landlordPhone, nrlState } of landlords) {
    try {
      // Only applies to landlords given guidance who have not confirmed submission.
      if (!nrlState.guidanceGivenAt || nrlState.nrl1Submitted) continue;

      const guidanceDate = new Date(nrlState.guidanceGivenAt);
      const followUpDue  = new Date(
        guidanceDate.getTime() + NRL_APPROVAL_REMINDER_WEEKS * 7 * 24 * 60 * 60 * 1000,
      );

      if (now < followUpDue) continue;

      // Deduplicate: only one approval_reminder after this guidance date.
      const { data: existing } = await supabase
        .from("nrl_events")
        .select("id")
        .eq("landlord_id", landlordId)
        .eq("event_type", "approval_reminder")
        .gte("created_at", nrlState.guidanceGivenAt)
        .limit(1)
        .maybeSingle();

      if (existing) continue;

      await sendNrlReminder(
        landlordId,
        landlordPhone,
        "approval_reminder",
        `*NRL1 Approval — ${NRL_APPROVAL_WEEKS_TYPICAL[1]}-Week Follow-Up*\n\n` +
          `It has been ${NRL_APPROVAL_REMINDER_WEEKS} weeks since you received NRL1 guidance. ` +
          "Has HMRC written to confirm your approval?\n\n" +
          "- Reply *NRL APPROVED* if you have received your approval letter\n" +
          "- Reply *NRL* to check your current status\n\n" +
          "If you have not yet submitted the form, you can download the NRL1 on GOV.UK " +
          "and post it to: HMRC, PAYE & Self Assessment, BX9 1AS.\n\n" +
          "Without approval, your agent or tenant should be withholding " +
          `${Math.round(NRL_WITHHOLDING_TAX_RATE * 100)}% tax from your rental income.`,
        { guidanceGivenAt: nrlState.guidanceGivenAt },
      );
      count++;
    } catch (err) {
      console.error(`[nrl-tax-cron] Approval follow-up error for ${landlordId}:`, err);
    }
  }

  return count;
}

// ─── 2. NRL1 Expiry Reminders ─────────────────────────────────────────────

async function sendExpiryReminders(now: Date): Promise<number> {
  const landlords = await getOverseasLandlords();
  let count = 0;

  for (const { landlordId, landlordPhone, nrlState } of landlords) {
    try {
      if (!nrlState.nrl1ExpiryDate) continue;

      const expiryDate = new Date(nrlState.nrl1ExpiryDate);
      const msUntilExpiry = expiryDate.getTime() - now.getTime();
      const daysUntilExpiry = Math.floor(msUntilExpiry / (24 * 60 * 60 * 1000));

      // Only send when within the reminder window and not yet expired.
      if (daysUntilExpiry > NRL_EXPIRY_REMINDER_DAYS || daysUntilExpiry < 0) continue;

      // One expiry reminder per landlord per calendar year.
      const yearStart = `${now.getFullYear()}-01-01`;
      const { data: existing } = await supabase
        .from("nrl_events")
        .select("id")
        .eq("landlord_id", landlordId)
        .eq("event_type", "expiry_reminder")
        .gte("created_at", yearStart)
        .limit(1)
        .maybeSingle();

      if (existing) continue;

      const expiryFormatted = expiryDate.toLocaleDateString("en-GB", {
        day: "numeric", month: "long", year: "numeric",
      });

      await sendNrlReminder(
        landlordId,
        landlordPhone,
        "expiry_reminder",
        `*NRL Approval Expiring Soon*\n\n` +
          `Your NRL approval expires on *${expiryFormatted}* ` +
          `(${daysUntilExpiry} days away).\n\n` +
          "To renew, submit a new NRL1 form to HMRC at least 6 weeks before expiry " +
          "to avoid a gap in your approval. Without valid approval, your agent or " +
          `tenant must resume withholding ${Math.round(NRL_WITHHOLDING_TAX_RATE * 100)}% tax from your rent.\n\n` +
          "Once you have your new approval letter, type *NRL EXPIRY DD/MM/YYYY* to update your records.",
        { expiryDate: nrlState.nrl1ExpiryDate, daysUntilExpiry },
      );
      count++;
    } catch (err) {
      console.error(`[nrl-tax-cron] Expiry reminder error for ${landlordId}:`, err);
    }
  }

  return count;
}

// ─── 3. Self Assessment Reminders ─────────────────────────────────────────

/**
 * UK tax year runs 6 April to 5 April.
 * Returns the ending calendar year: e.g., 1 Jan 2026 → 2026 (April 2025–April 2026).
 */
function ukTaxYearEnd(date: Date): number {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return (m > 4 || (m === 4 && d > 5)) ? y + 1 : y;
}

async function sendSaReminders(now: Date): Promise<number> {
  // SA filing deadline: 31 January after the tax year ends.
  // e.g. tax year Apr 2025–Apr 2026 → deadline 31 Jan 2027
  const taxYearEnd  = ukTaxYearEnd(now);
  const deadlineYear = taxYearEnd + 1;
  const deadline     = new Date(`${deadlineYear}-01-31T23:59:59Z`);
  const msUntilDeadline = deadline.getTime() - now.getTime();
  const daysUntilDeadline = Math.floor(msUntilDeadline / (24 * 60 * 60 * 1000));

  // Only send on exact threshold days.
  if (!NRL_SA_REMINDER_ADVANCE_DAYS.includes(
    daysUntilDeadline as typeof NRL_SA_REMINDER_ADVANCE_DAYS[number],
  )) {
    return 0;
  }

  const landlords = await getOverseasLandlords();
  let count = 0;

  for (const { landlordId, landlordPhone } of landlords) {
    try {
      // Deduplicate: one SA reminder per threshold per tax year.
      const taxYearStart = `${taxYearEnd - 1}-04-06`;
      const { data: existing } = await supabase
        .from("nrl_events")
        .select("id")
        .eq("landlord_id", landlordId)
        .eq("event_type", "sa_reminder")
        .gte("created_at", taxYearStart)
        .contains("metadata", { daysUntilDeadline })
        .limit(1)
        .maybeSingle();

      if (existing) continue;

      const urgency = daysUntilDeadline <= 7 ? "URGENT: " : "";

      await sendNrlReminder(
        landlordId,
        landlordPhone,
        "sa_reminder",
        `*${urgency}Self Assessment Filing Reminder*\n\n` +
          `Your UK Self Assessment tax return is due by *31 January ${deadlineYear}* ` +
          `(${daysUntilDeadline} days away).\n\n` +
          "As an overseas landlord you must declare your UK rental income, even if " +
          "you hold NRL approval (which only covers the withholding arrangement).\n\n" +
          "File via *tax.service.gov.uk* or through your UK accountant. " +
          "Complete the SA100 with the *UK Property (SA105)* supplementary pages.\n\n" +
          `*Tax year covered:* 6 April ${taxYearEnd - 1} to 5 April ${taxYearEnd}`,
        { daysUntilDeadline, taxYearEnd, deadlineYear },
      );
      count++;
    } catch (err) {
      console.error(`[nrl-tax-cron] SA reminder error for ${landlordId}:`, err);
    }
  }

  return count;
}

// ─── 4. Quarterly Payment Reminders ──────────────────────────────────────

async function sendQuarterlyReminders(now: Date): Promise<number> {
  const currentMonth = now.getMonth() + 1; // 1-indexed

  // Only fire on the 1st of a quarterly month.
  if (!NRL_QUARTERLY_REMINDER_MONTHS.includes(
    currentMonth as typeof NRL_QUARTERLY_REMINDER_MONTHS[number],
  )) return 0;

  if (now.getDate() !== 1) return 0;

  const landlords = await getOverseasLandlords();
  let count = 0;

  const yearMonth = `${now.getFullYear()}-${String(currentMonth).padStart(2, "0")}`;

  for (const { landlordId, landlordPhone } of landlords) {
    try {
      // One quarterly reminder per landlord per year-month.
      const { data: existing } = await supabase
        .from("nrl_events")
        .select("id")
        .eq("landlord_id", landlordId)
        .eq("event_type", "quarterly_reminder")
        .contains("metadata", { yearMonth })
        .limit(1)
        .maybeSingle();

      if (existing) continue;

      // UK payments on account: 31 January and 31 July.
      const nextPaymentDeadline = currentMonth <= 7
        ? `31 July ${now.getFullYear()}`
        : `31 January ${now.getFullYear() + 1}`;

      const quarterIndex = (NRL_QUARTERLY_REMINDER_MONTHS as readonly number[]).indexOf(currentMonth);
      const quarterLabel = ["Q1", "Q2", "Q3", "Q4"][quarterIndex] ?? "";

      await sendNrlReminder(
        landlordId,
        landlordPhone,
        "quarterly_reminder",
        `*${quarterLabel} NRL Tax Reminder*\n\n` +
          "Quarterly checklist for overseas UK landlords:\n\n" +
          "- *Record rental income* received this quarter\n" +
          "- *Record allowable expenses* (repairs, agent fees, mortgage interest rules)\n" +
          "- *Payment on account:* if you pay tax via Self Assessment, " +
          `your next deadline is *${nextPaymentDeadline}*\n` +
          "- *NRL approval:* check the expiry date on your HMRC approval letter " +
          "and renew at least 6 weeks before it lapses\n\n" +
          "Type *NRL* to view your current NRL status.",
        { yearMonth, quarter: quarterLabel },
      );
      count++;
    } catch (err) {
      console.error(`[nrl-tax-cron] Quarterly reminder error for ${landlordId}:`, err);
    }
  }

  return count;
}

// ─── Utility ──────────────────────────────────────────────────────────────

// Re-export logNrlEvent so it is importable from this module if needed.
export { logNrlEvent };
export type { NrlEventType };
