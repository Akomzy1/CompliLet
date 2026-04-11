/**
 * CompliLet — Compliance Autopilot Cron
 *
 * Runs daily at 9:00 AM UTC (≈ 9 AM GMT / 10 AM BST) via pg_cron.
 * Scans all pending compliance deadlines and sends WhatsApp reminders to
 * landlords at the appropriate intervals.
 *
 * Reminder schedule:
 *   90 days  — advance heads-up, no action needed yet
 *   30 days  — reminder, offer contractor recommendation
 *   14 days  — urgent, cite fine amount, offer contractor
 *    7 days  — urgent, immediate action required
 *    1 day   — final reminder, please confirm arranged
 *   overdue  — overdue notice (resent every 7 days until resolved)
 *
 * Deduplication: each deadline row stores `last_reminder_threshold` (the
 * threshold most recently notified) and `last_reminder_sent_at`. The cron
 * only sends a message when the applicable threshold has changed (i.e., a
 * new, closer threshold has been crossed since the last send).
 *
 * pg_cron setup (run once in your Supabase SQL editor):
 * ─────────────────────────────────────────────────────
 *   SELECT cron.schedule(
 *     'compliance-autopilot-daily',
 *     '0 9 * * *',  -- 9 AM UTC every day (approx. 9 AM GMT / 10 AM BST)
 *     $$
 *     SELECT net.http_post(
 *       url      := current_setting('app.supabase_url') || '/functions/v1/compliance-autopilot-cron',
 *       headers  := jsonb_build_object(
 *                    'Content-Type', 'application/json',
 *                    'Authorization', 'Bearer ' || current_setting('app.service_role_key')
 *                   ),
 *       body     := '{}'::jsonb
 *     ) AS request_id;
 *     $$
 *   );
 *
 * Required Postgres settings (set via Supabase Dashboard → Database → Settings):
 *   app.supabase_url        = 'https://xxx.supabase.co'
 *   app.service_role_key    = 'eyJ...'
 *
 * Required schema additions to compliance_deadlines:
 *   ALTER TABLE compliance_deadlines
 *     ADD COLUMN IF NOT EXISTS last_reminder_sent_at   TIMESTAMPTZ,
 *     ADD COLUMN IF NOT EXISTS last_reminder_threshold INTEGER,
 *     ADD COLUMN IF NOT EXISTS certificate_storage_path TEXT;
 *
 * Deploy config: see supabase/config.toml [functions.compliance-autopilot-cron]
 *   verify_jwt = false
 *
 * Required environment variables (same as webhook-handler):
 *   WHATSAPP_TOKEN, PHONE_NUMBER_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { supabase } from "../_shared/supabase.ts";
import { sendTextMessage } from "../_shared/whatsapp.ts";
import {
  COMPLIANCE_AUTOPILOT_THRESHOLDS,
  COMPLIANCE_AUTOPILOT_OVERDUE_RESEND_DAYS,
  COMPLIANCE_FINES_GBP,
} from "../_shared/constants.ts";
import {
  complianceTypeLabel,
  contractorTradeForType,
} from "../_shared/agents/compliance-autopilot.ts";
import type { ComplianceType } from "../_shared/types.ts";

// ─── Entry point ────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  try {
    const result = await runCron();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[compliance-autopilot-cron] Fatal error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// ─── Types ──────────────────────────────────────────────────────────────────

interface CronResult {
  processed: number;
  remindersSent: number;
  skipped: number;
  errors: string[];
}

interface DeadlineRow {
  id: string;
  landlord_id: string;
  tenancy_id: string | null;
  type: string;
  due_date: string;
  last_reminder_sent_at: string | null;
  last_reminder_threshold: number | null;
}

interface LandlordRow {
  whatsapp_number: string;
}

interface TenancyRow {
  session_id: string | null;
}

interface SessionRow {
  property_address: string | null;
}

// ─── Cron logic ─────────────────────────────────────────────────────────────

async function runCron(): Promise<CronResult> {
  const result: CronResult = {
    processed: 0,
    remindersSent: 0,
    skipped: 0,
    errors: [],
  };

  // Fetch all pending deadlines along with landlord phone.
  const { data: deadlines, error } = await supabase
    .from("compliance_deadlines")
    .select(
      "id, landlord_id, tenancy_id, type, due_date, last_reminder_sent_at, last_reminder_threshold",
    )
    .eq("status", "pending")
    .order("due_date", { ascending: true });

  if (error) {
    result.errors.push(`Fetch error: ${error.message}`);
    return result;
  }

  const now = new Date();

  for (const row of (deadlines ?? []) as DeadlineRow[]) {
    result.processed++;
    try {
      const sent = await processDeadline(row, now, result);
      if (sent) result.remindersSent++;
      else result.skipped++;
    } catch (err) {
      result.errors.push(`Deadline ${row.id}: ${String(err)}`);
    }
  }

  return result;
}

// ─── Per-deadline processing ─────────────────────────────────────────────────

async function processDeadline(
  row: DeadlineRow,
  now: Date,
  result: CronResult,
): Promise<boolean> {
  const dueDate = new Date(row.due_date);
  const daysUntil = Math.round((dueDate.getTime() - now.getTime()) / 86_400_000);
  const complianceType = row.type as ComplianceType;

  // ── Overdue handling ───────────────────────────────────────────────────
  if (daysUntil < 0) {
    // Only resend every COMPLIANCE_AUTOPILOT_OVERDUE_RESEND_DAYS days.
    if (row.last_reminder_threshold === -1 && row.last_reminder_sent_at) {
      const daysSinceLastSend = Math.round(
        (now.getTime() - new Date(row.last_reminder_sent_at).getTime()) / 86_400_000,
      );
      if (daysSinceLastSend < COMPLIANCE_AUTOPILOT_OVERDUE_RESEND_DAYS) {
        return false; // Too soon to resend overdue notice.
      }
    }

    const landlordPhone = await getLandlordPhone(row.landlord_id);
    if (!landlordPhone) {
      result.errors.push(`No phone for landlord ${row.landlord_id}`);
      return false;
    }

    const address = await getPropertyAddress(row.tenancy_id);
    const label = complianceTypeLabel(complianceType);
    const dueFmt = dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

    await sendTextMessage(
      landlordPhone,
      `Your *${label}* for ${address} is now *OVERDUE* (was due ${dueFmt}).\n\n` +
        "This may result in legal penalties.\n\n" +
        "Please arrange this immediately and reply with the new certificate date once done.",
    );

    await markReminderSent(row.id, -1);
    return true;
  }

  // ── Threshold-based reminders ──────────────────────────────────────────
  // Find the applicable threshold: smallest T in THRESHOLDS where daysUntil <= T.
  const applicableThreshold = COMPLIANCE_AUTOPILOT_THRESHOLDS.find(
    (t) => daysUntil <= t,
  ) ?? null;

  if (applicableThreshold === null) {
    return false; // More than 90 days away — no reminder yet.
  }

  // Check if we already sent at this threshold (or a closer one).
  const lastThreshold = row.last_reminder_threshold;
  if (lastThreshold !== null && lastThreshold <= applicableThreshold) {
    return false; // Already notified at this threshold or closer.
  }

  // Need to send a reminder at this threshold.
  const landlordPhone = await getLandlordPhone(row.landlord_id);
  if (!landlordPhone) {
    result.errors.push(`No phone for landlord ${row.landlord_id}`);
    return false;
  }

  const address = await getPropertyAddress(row.tenancy_id);
  const message = buildReminderMessage(complianceType, address, dueDate, daysUntil, applicableThreshold);

  await sendTextMessage(landlordPhone, message);
  await markReminderSent(row.id, applicableThreshold);

  return true;
}

// ─── Message builder ─────────────────────────────────────────────────────────

function buildReminderMessage(
  type: ComplianceType,
  address: string,
  dueDate: Date,
  daysUntil: number,
  threshold: number,
): string {
  const label = complianceTypeLabel(type);
  const dueFmt = dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const fine = COMPLIANCE_FINES_GBP[type];
  const trade = contractorTradeForType(type);
  const findContractorSuffix = trade
    ? ` Reply *find ${trade === "gas_safe" ? "gas engineer" : trade}* and I'll connect you with a vetted local professional.`
    : "";

  switch (threshold) {
    case 90:
      return (
        `Heads up: Your *${label}* for ${address} is due in 3 months ` +
        `(${dueFmt}). No action needed yet — just a forward-plan reminder.`
      );

    case 30:
      return (
        `Reminder: Your *${label}* for ${address} is due in 30 days ` +
        `(${dueFmt}). Would you like me to recommend a local ${
          trade ? TRADE_DISPLAY[trade] ?? "contractor" : "professional"
        }?\n\n` +
        (findContractorSuffix ? "Reply *find engineer* to get recommendations." : "")
      ).trim();

    case 14:
      return (
        `Your *${label}* for ${address} is due in 2 weeks (${dueFmt}).\n\n` +
        (fine ? `Non-compliance fines are ${fine}.\n\n` : "") +
        `Please arrange this now.${findContractorSuffix}`
      );

    case 7:
      return (
        `Urgent: Your *${label}* for ${address} is due in 7 days ` +
        `(${dueFmt}).\n\n` +
        `Please arrange this immediately.${findContractorSuffix}`
      );

    case 1:
      return (
        `FINAL REMINDER: Your *${label}* for ${address} is due *TOMORROW* (${dueFmt}).\n\n` +
        "Please confirm you have this arranged — reply with the engineer's name or booking reference."
      );

    default:
      return `Reminder: Your *${label}* for ${address} is due on ${dueFmt} (${daysUntil} days).`;
  }
}

const TRADE_DISPLAY: Record<string, string> = {
  gas_safe:        "Gas Safe engineer",
  electrician:     "electrician",
  plumber:         "plumber",
  energy_assessor: "energy assessor",
  water_treatment: "water treatment specialist",
};

// ─── Database helpers ─────────────────────────────────────────────────────────

async function getLandlordPhone(landlordId: string): Promise<string | null> {
  const { data } = await supabase
    .from("landlords")
    .select("whatsapp_number")
    .eq("id", landlordId)
    .single() as { data: LandlordRow | null };

  return data?.whatsapp_number ?? null;
}

async function getPropertyAddress(tenancyId: string | null): Promise<string> {
  if (!tenancyId) return "your property";

  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("session_id")
    .eq("id", tenancyId)
    .maybeSingle() as { data: TenancyRow | null };

  if (!tenancy?.session_id) return "your property";

  const { data: session } = await supabase
    .from("screening_sessions")
    .select("property_address")
    .eq("id", tenancy.session_id)
    .maybeSingle() as { data: SessionRow | null };

  return session?.property_address ?? "your property";
}

async function markReminderSent(deadlineId: string, threshold: number): Promise<void> {
  await supabase
    .from("compliance_deadlines")
    .update({
      last_reminder_sent_at: new Date().toISOString(),
      last_reminder_threshold: threshold,
      updated_at: new Date().toISOString(),
    })
    .eq("id", deadlineId);
}
