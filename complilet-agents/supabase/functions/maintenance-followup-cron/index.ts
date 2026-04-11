/**
 * CompliLet — Maintenance Follow-up Cron
 *
 * Runs daily at 10:00 AM UTC via pg_cron.
 * Queries maintenance_tickets where status is 'open' or 'in_progress',
 * follow_up_sent is FALSE, and the ticket was opened approximately 48 hours ago.
 * Sends the tenant a friendly resolution check and marks follow_up_sent = true.
 *
 * Also re-checks tickets at 7 days (still open) and sends a landlord nudge
 * if no contractor has been assigned (contractor_id IS NULL).
 *
 * pg_cron setup (run once in your Supabase SQL editor):
 * ─────────────────────────────────────────────────────
 *   SELECT cron.schedule(
 *     'maintenance-followup-daily',
 *     '0 10 * * *',  -- 10 AM UTC daily
 *     $$
 *     SELECT net.http_post(
 *       url      := 'https://<project-ref>.supabase.co/functions/v1/maintenance-followup-cron',
 *       headers  := '{"Content-Type":"application/json","Authorization":"Bearer <service-role-key>"}',
 *       body     := '{}'::jsonb
 *     );
 *     $$
 *   );
 *
 * Note: verify_jwt = false in config.toml so pg_cron doesn't need a signed JWT.
 */

import { supabase } from "../_shared/supabase.ts";
import { sendTextMessage } from "../_shared/whatsapp.ts";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Send the 48-hour follow-up between 44 and 52 hours after opening. */
const FOLLOWUP_WINDOW_MIN_HOURS = 44;
const FOLLOWUP_WINDOW_MAX_HOURS = 52;

/** Flag as "stuck" and nudge landlord after this many days with no contractor. */
const STUCK_THRESHOLD_DAYS = 7;

// ─── Entry point ────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  try {
    const now = new Date();
    console.log(`[maintenance-followup-cron] Starting run at ${now.toISOString()}`);

    const results = await runFollowUpCron(now);

    console.log(
      `[maintenance-followup-cron] Done. followups=${results.followupsSent}, nudges=${results.landlordNudgesSent}`,
    );

    return new Response(
      JSON.stringify({ ok: true, ...results }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[maintenance-followup-cron] Fatal error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// ─── Core logic ─────────────────────────────────────────────────────────────

interface CronResult {
  followupsSent: number;
  landlordNudgesSent: number;
  errors: string[];
}

async function runFollowUpCron(now: Date): Promise<CronResult> {
  const result: CronResult = { followupsSent: 0, landlordNudgesSent: 0, errors: [] };

  // Fetch all open/in-progress tickets with follow_up_sent = false,
  // opened within the last 8 days (to cover both the 48h and 7-day windows).
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

  const { data: tickets, error } = await supabase
    .from("maintenance_tickets")
    .select(
      "id, tenant_phone, landlord_id, title, category, status, " +
      "contractor_id, follow_up_sent, opened_at, property_address",
    )
    .in("status", ["open", "in_progress"])
    .eq("follow_up_sent", false)
    .gte("opened_at", eightDaysAgo.toISOString())
    .order("opened_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch tickets: ${error.message}`);
  }

  if (!tickets || tickets.length === 0) {
    console.log("[maintenance-followup-cron] No tickets need follow-up today.");
    return result;
  }

  console.log(`[maintenance-followup-cron] Processing ${tickets.length} ticket(s).`);

  for (const ticket of tickets) {
    try {
      await processTicket(ticket, now, result);
    } catch (err) {
      const msg = `Ticket ${ticket.id}: ${String(err)}`;
      console.error("[maintenance-followup-cron]", msg);
      result.errors.push(msg);
    }
  }

  return result;
}

// ─── Per-ticket processing ───────────────────────────────────────────────────

interface TicketRow {
  id: string;
  tenant_phone: string;
  landlord_id: string;
  title: string;
  category: string;
  status: string;
  contractor_id: string | null;
  follow_up_sent: boolean;
  opened_at: string;
  property_address: string | null;
}

async function processTicket(
  ticket: TicketRow,
  now: Date,
  result: CronResult,
): Promise<void> {
  const openedAt = new Date(ticket.opened_at);
  const hoursOpen = (now.getTime() - openedAt.getTime()) / (1000 * 60 * 60);

  // ── 48-hour follow-up: check if tenant has resolved the issue ──────────
  if (
    hoursOpen >= FOLLOWUP_WINDOW_MIN_HOURS &&
    hoursOpen <= FOLLOWUP_WINDOW_MAX_HOURS
  ) {
    await send48HourFollowup(ticket);
    result.followupsSent++;
    return;
  }

  // ── 7-day nudge: ticket still open, no contractor assigned ─────────────
  const daysOpen = hoursOpen / 24;
  if (
    daysOpen >= STUCK_THRESHOLD_DAYS &&
    daysOpen < STUCK_THRESHOLD_DAYS + 1 && // only nudge once (on day 7)
    ticket.contractor_id === null
  ) {
    await sendLandlordStuckNudge(ticket);
    result.landlordNudgesSent++;
    // Do NOT mark follow_up_sent here — we still want the 48h follow-up
    // if it hasn't fired yet (edge case where ticket was opened in backlog).
    return;
  }

  // Outside both windows — nothing to do for this ticket today.
}

// ─── 48-hour follow-up to tenant ────────────────────────────────────────────

async function send48HourFollowup(ticket: TicketRow): Promise<void> {
  const issueLabel = ticket.title || "the issue you reported";

  await sendTextMessage(
    ticket.tenant_phone,
    `Hi! Just checking in on *${issueLabel}*.\n\n` +
      `Has this been sorted? Reply:\n\n` +
      `*YES* — if the issue has been resolved\n` +
      `*NO* — if it's still ongoing and needs attention`,
  );

  // Mark follow_up_sent so we don't ask again.
  const { error } = await supabase
    .from("maintenance_tickets")
    .update({
      follow_up_sent: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ticket.id);

  if (error) {
    throw new Error(`Failed to mark follow_up_sent for ticket ${ticket.id}: ${error.message}`);
  }

  console.log(
    `[maintenance-followup-cron] 48h follow-up sent to ${ticket.tenant_phone} for ticket ${ticket.id}.`,
  );
}

// ─── 7-day landlord nudge ────────────────────────────────────────────────────

async function sendLandlordStuckNudge(ticket: TicketRow): Promise<void> {
  // Resolve landlord phone.
  const { data: landlord, error: landlordError } = await supabase
    .from("landlords")
    .select("phone")
    .eq("id", ticket.landlord_id)
    .single();

  if (landlordError || !landlord?.phone) {
    throw new Error(`Could not resolve landlord phone for ticket ${ticket.id}`);
  }

  const address = ticket.property_address ?? "the property";
  const issueLabel = ticket.title || "a reported issue";

  await sendTextMessage(
    landlord.phone,
    `*Maintenance Update Required*\n\n` +
      `A repair at *${address}* has been open for 7 days with no contractor assigned:\n\n` +
      `*Issue:* ${issueLabel}\n\n` +
      `Please reply *MAINTENANCE* to review and assign a contractor, ` +
      `or type the contractor's name to confirm they've been booked.`,
  );

  console.log(
    `[maintenance-followup-cron] 7-day nudge sent to landlord ${ticket.landlord_id} for ticket ${ticket.id}.`,
  );
}
