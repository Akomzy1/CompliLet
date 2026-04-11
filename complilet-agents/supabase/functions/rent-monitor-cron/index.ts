/**
 * CompliLet — Rent Monitor Cron
 *
 * Runs daily at 8:00 AM UTC (approx. 8 AM GMT / 9 AM BST) via pg_cron.
 * Scans all active tenancies and sends WhatsApp rent reminders at the
 * appropriate intervals relative to each tenancy's rent due date.
 *
 * Schedule logic per tenancy:
 *   −3 days  — Advance reminder to tenant (friendly, no action needed yet)
 *    0 days  — Create rent_event sentinel on the due date. No WhatsApp message.
 *   +1 day   — Gentle overdue reminder to tenant
 *   +3 days  — Firmer reminder to tenant + alert landlord
 *   +7 days  — Final reminder to tenant + landlord next steps + arrears_flag = true
 *  +14 days  — Escalation (Section 8 Ground 11 guidance) + landlord alert
 *
 * Deduplication: each rent period has a rent_events row keyed on
 * (tenancy_id, due_date). The cron only sends a message for a given
 * (tenancy, day-offset) pair once, checking for existing rows before acting.
 *
 * Schema requirement for tenancies:
 *   rent_due_day INTEGER   — day of month rent is due (1–28).
 *                            NULL → derived from start_date's day of month.
 *
 * pg_cron setup (run once in your Supabase SQL editor):
 * ─────────────────────────────────────────────────────
 *   SELECT cron.schedule(
 *     'rent-monitor-daily',
 *     '0 8 * * *',  -- 8 AM UTC daily (approx. 8 AM GMT / 9 AM BST)
 *     $$
 *     SELECT net.http_post(
 *       url      := current_setting('app.supabase_url') || '/functions/v1/rent-monitor-cron',
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
 * Deploy config: see supabase/config.toml [functions.rent-monitor-cron]
 *   verify_jwt = false
 *
 * Required environment variables (same as webhook-handler):
 *   WHATSAPP_TOKEN, PHONE_NUMBER_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { supabase } from "../_shared/supabase.ts";
import { sendTextMessage } from "../_shared/whatsapp.ts";
import { RENT_ARREARS_ESCALATION_DAYS } from "../_shared/constants.ts";

// ─── Entry point ────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  try {
    const result = await runCron();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[rent-monitor-cron] Fatal error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface CronResult {
  processed: number;
  remindersSent: number;
  eventsCreated: number;
  skipped: number;
  errors: string[];
}

interface ActiveTenancy {
  id: string;
  landlord_id: string;
  tenant_phone: string;
  tenant_name: string | null;
  property_address: string;
  monthly_rent_gbp: number;
  rent_due_day: number | null;
  start_date: string;
  landlord_phone: string;
}

// ─── Cron logic ──────────────────────────────────────────────────────────────

async function runCron(): Promise<CronResult> {
  const result: CronResult = {
    processed: 0,
    remindersSent: 0,
    eventsCreated: 0,
    skipped: 0,
    errors: [],
  };

  // Fetch all active tenancies joined with landlord phone.
  const { data: tenancies, error } = await supabase
    .from("tenancies")
    .select(
      "id, landlord_id, tenant_phone, tenant_name, property_address, " +
      "monthly_rent_gbp, rent_due_day, start_date, " +
      "landlords!inner(whatsapp_number)",
    )
    .eq("status", "active");

  if (error) {
    result.errors.push(`Fetch error: ${error.message}`);
    return result;
  }

  // Normalise the joined shape.
  const rows: ActiveTenancy[] = (tenancies ?? []).map((t) => ({
    id:               t.id as string,
    landlord_id:      t.landlord_id as string,
    tenant_phone:     t.tenant_phone as string,
    tenant_name:      t.tenant_name as string | null,
    property_address: t.property_address as string,
    monthly_rent_gbp: t.monthly_rent_gbp as number,
    rent_due_day:     t.rent_due_day as number | null,
    start_date:       t.start_date as string,
    landlord_phone:   (t.landlords as { whatsapp_number: string }).whatsapp_number,
  }));

  const today = startOfToday();

  for (const tenancy of rows) {
    result.processed++;
    try {
      const acted = await processTenancy(tenancy, today, result);
      if (!acted) result.skipped++;
    } catch (err) {
      result.errors.push(`Tenancy ${tenancy.id}: ${String(err)}`);
    }
  }

  return result;
}

// ─── Per-tenancy processing ───────────────────────────────────────────────────

async function processTenancy(
  tenancy: ActiveTenancy,
  today: Date,
  result: CronResult,
): Promise<boolean> {
  const rentDueDay = tenancy.rent_due_day ?? new Date(tenancy.start_date).getDate();
  const firstName = firstNameOf(tenancy.tenant_name ?? tenancy.tenant_phone);
  const amountFmt = `£${(tenancy.monthly_rent_gbp).toFixed(2)}`;
  let acted = false;

  // ── Advance reminder: 3 days before due date ────────────────────────
  const threeDaysAhead = addDays(today, RENT_ARREARS_ESCALATION_DAYS.REMINDER + 3);
  const expectedAdvanceDue = clampedDate(
    threeDaysAhead.getFullYear(),
    threeDaysAhead.getMonth(),
    rentDueDay,
  );

  if (isSameDay(threeDaysAhead, expectedAdvanceDue)) {
    const dueDateIso = expectedAdvanceDue.toISOString().split("T")[0];
    const alreadySent = await eventExists(tenancy.id, dueDateIso, "reminder_sent");
    if (!alreadySent) {
      const dueFmt = formatDate(expectedAdvanceDue);
      await sendTextMessage(
        tenancy.tenant_phone,
        `Hi ${firstName}, just a friendly reminder that your rent of ` +
          `*${amountFmt}* for *${tenancy.property_address}* is due on *${dueFmt}*. Thanks!`,
      );
      await insertRentEvent({
        tenancyId: tenancy.id,
        landlordId: tenancy.landlord_id,
        tenantPhone: tenancy.tenant_phone,
        dueDate: dueDateIso,
        eventType: "reminder_sent",
        amountGbp: tenancy.monthly_rent_gbp,
      });
      result.remindersSent++;
      acted = true;
    }
  }

  // ── Due date sentinel: create record, no message ────────────────────
  const expectedDue = clampedDate(
    today.getFullYear(),
    today.getMonth(),
    rentDueDay,
  );

  if (isSameDay(today, expectedDue)) {
    const dueDateIso = expectedDue.toISOString().split("T")[0];
    const alreadyCreated = await eventExists(tenancy.id, dueDateIso);
    if (!alreadyCreated) {
      await insertRentEvent({
        tenancyId: tenancy.id,
        landlordId: tenancy.landlord_id,
        tenantPhone: tenancy.tenant_phone,
        dueDate: dueDateIso,
        eventType: "due_date_created",
        amountGbp: tenancy.monthly_rent_gbp,
      });
      result.eventsCreated++;
      acted = true;
    }
  }

  // ── Overdue actions ─────────────────────────────────────────────────
  const overdueDays: Array<{ days: number; eventType: string }> = [
    { days: RENT_ARREARS_ESCALATION_DAYS.DAY_1,  eventType: "overdue_day_1"  },
    { days: RENT_ARREARS_ESCALATION_DAYS.DAY_3,  eventType: "overdue_day_3"  },
    { days: RENT_ARREARS_ESCALATION_DAYS.DAY_7,  eventType: "overdue_day_7"  },
    { days: RENT_ARREARS_ESCALATION_DAYS.DAY_14, eventType: "overdue_day_14" },
  ];

  for (const { days, eventType } of overdueDays) {
    // If today is `days` days after a due date, process that period.
    const possibleDueDate = addDays(today, -days);
    const expectedOnThatDay = clampedDate(
      possibleDueDate.getFullYear(),
      possibleDueDate.getMonth(),
      rentDueDay,
    );

    if (!isSameDay(possibleDueDate, expectedOnThatDay)) continue;

    const dueDateIso = expectedOnThatDay.toISOString().split("T")[0];

    // Skip if already paid/waived for this period.
    const isPaid = await eventExists(tenancy.id, dueDateIso, "received") ||
      await eventExists(tenancy.id, dueDateIso, "waived") ||
      await eventExists(tenancy.id, dueDateIso, "partial_payment");
    if (isPaid) continue;

    // Skip if we already sent this specific overdue event.
    const alreadySent = await eventExists(tenancy.id, dueDateIso, eventType);
    if (alreadySent) continue;

    // Send overdue messages.
    const dueFmt = formatDate(expectedOnThatDay);
    await sendOverdueMessages(tenancy, firstName, amountFmt, dueFmt, dueDateIso, days, eventType, result);
    acted = true;
  }

  return acted;
}

// ─── Overdue message dispatch ─────────────────────────────────────────────────

async function sendOverdueMessages(
  tenancy: ActiveTenancy,
  firstName: string,
  amountFmt: string,
  dueFmt: string,
  dueDateIso: string,
  daysOverdue: number,
  eventType: string,
  result: CronResult,
): Promise<void> {
  const arrears = daysOverdue >= RENT_ARREARS_ESCALATION_DAYS.DAY_7;

  // ── Tenant messages ──────────────────────────────────────────────────
  switch (daysOverdue) {
    case RENT_ARREARS_ESCALATION_DAYS.DAY_1:
      await sendTextMessage(
        tenancy.tenant_phone,
        `Hi ${firstName}, your rent of *${amountFmt}* for *${tenancy.property_address}* ` +
          `was due yesterday (${dueFmt}).\n\n` +
          "If you've already paid, please reply *PAID* and we'll confirm with your landlord. " +
          "If you're having difficulty, please let us know.",
      );
      break;

    case RENT_ARREARS_ESCALATION_DAYS.DAY_3:
      await sendTextMessage(
        tenancy.tenant_phone,
        `Hi ${firstName}, we haven't received confirmation that your rent of ` +
          `*${amountFmt}* for *${tenancy.property_address}* (due ${dueFmt}) has been paid.\n\n` +
          "Please arrange payment as soon as possible and reply *PAID* to confirm, " +
          "or contact us if you're experiencing difficulties.",
      );
      break;

    case RENT_ARREARS_ESCALATION_DAYS.DAY_7:
      await sendTextMessage(
        tenancy.tenant_phone,
        `Hi ${firstName}, your rent of *${amountFmt}* for *${tenancy.property_address}* ` +
          `is now *7 days overdue* (was due ${dueFmt}).\n\n` +
          "This is a final reminder before formal arrears proceedings may begin. " +
          "Please pay immediately and reply *PAID* to confirm, or contact us urgently " +
          "to discuss your situation.",
      );
      break;

    case RENT_ARREARS_ESCALATION_DAYS.DAY_14:
      await sendTextMessage(
        tenancy.tenant_phone,
        `Hi ${firstName}, your rent of *${amountFmt}* for *${tenancy.property_address}* ` +
          `is now *14 days overdue* (was due ${dueFmt}).\n\n` +
          "Your landlord may now begin formal arrears proceedings under the Housing Act 1988. " +
          "Please contact your landlord directly and arrange payment immediately. " +
          "Reply *PAID* once payment has been made.",
      );
      break;
  }

  // ── Landlord alerts ──────────────────────────────────────────────────
  switch (daysOverdue) {
    case RENT_ARREARS_ESCALATION_DAYS.DAY_3:
      await sendTextMessage(
        tenancy.landlord_phone,
        `*Rent alert — ${tenancy.property_address}*\n\n` +
          `${firstName} hasn't confirmed rent payment of *${amountFmt}* ` +
          `(due ${dueFmt}). It is now 3 days overdue.\n\n` +
          "I'm continuing to follow up with the tenant.",
      );
      break;

    case RENT_ARREARS_ESCALATION_DAYS.DAY_7:
      await sendTextMessage(
        tenancy.landlord_phone,
        `*Rent arrears — ${tenancy.property_address}*\n\n` +
          `${firstName}'s rent of *${amountFmt}* (due ${dueFmt}) is now *7 days overdue*.\n\n` +
          "Recommended next steps:\n" +
          `• Contact ${firstName} directly to discuss the situation\n` +
          "• If rent remains unpaid after 14 days, you may begin the formal arrears process\n" +
          "• Under the Housing Act 1988, Ground 8 applies once 2 months of rent is outstanding\n\n" +
          "Reply *CONFIRMED* once rent is received.",
      );
      break;

    case RENT_ARREARS_ESCALATION_DAYS.DAY_14:
      await sendTextMessage(
        tenancy.landlord_phone,
        `*Escalation — ${tenancy.property_address}*\n\n` +
          `${firstName}'s rent of *${amountFmt}* (due ${dueFmt}) is now *14 days overdue*.\n\n` +
          "Section 8, Ground 11 of the Housing Act 1988 may now apply (persistent late payment).\n\n" +
          "Recommended actions:\n" +
          "• Serve a formal Section 8 Notice if you wish to begin possession proceedings\n" +
          "• Seek legal advice from a property solicitor or the NRLA\n" +
          "• Contact Shelter (0808 800 4444) if you need mediation support\n\n" +
          "Reply *CONFIRMED* if rent has been received.",
      );
      break;
  }

  // ── Insert/update rent_event ─────────────────────────────────────────
  // Check if there's an existing event for this period to update.
  const { data: existing } = await supabase
    .from("rent_events")
    .select("id")
    .eq("tenancy_id", tenancy.id)
    .eq("due_date", dueDateIso)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("rent_events")
      .update({
        event_type: eventType,
        arrears_flag: arrears,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await insertRentEvent({
      tenancyId:  tenancy.id,
      landlordId: tenancy.landlord_id,
      tenantPhone: tenancy.tenant_phone,
      dueDate:    dueDateIso,
      eventType,
      amountGbp:  tenancy.monthly_rent_gbp,
      arrearsFlag: arrears,
    });
  }

  result.remindersSent++;
}

// ─── Database helpers ─────────────────────────────────────────────────────────

async function eventExists(
  tenancyId: string,
  dueDateIso: string,
  eventType?: string,
): Promise<boolean> {
  let query = supabase
    .from("rent_events")
    .select("id")
    .eq("tenancy_id", tenancyId)
    .eq("due_date", dueDateIso);

  if (eventType) {
    query = query.eq("event_type", eventType);
  }

  const { data } = await query.limit(1).maybeSingle();
  return !!data;
}

async function insertRentEvent(opts: {
  tenancyId: string;
  landlordId: string;
  tenantPhone: string;
  dueDate: string;
  eventType: string;
  amountGbp: number;
  arrearsFlag?: boolean;
}): Promise<void> {
  const now = new Date().toISOString();
  await supabase.from("rent_events").insert({
    tenancy_id:  opts.tenancyId,
    landlord_id: opts.landlordId,
    tenant_phone: opts.tenantPhone,
    due_date:    opts.dueDate,
    event_type:  opts.eventType,
    amount_gbp:  opts.amountGbp,
    arrears_flag: opts.arrearsFlag ?? false,
    created_at:  now,
  });
}

// ─── Date utilities ───────────────────────────────────────────────────────────

/** Returns midnight UTC for today. */
function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Adds N calendar days to a Date. */
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Creates a date clamped to the last day of the month if dueDay > last day. */
function clampedDate(year: number, month: number, dueDay: number): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(dueDay, lastDay)));
}

/** Compares two Dates by calendar day (UTC). */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function firstNameOf(fullName: string): string {
  return fullName.split(/\s+/)[0];
}
