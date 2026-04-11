/**
 * CompliLet — Inspection Cron
 *
 * Runs daily at 9:00 AM UTC via pg_cron.
 * Has two responsibilities:
 *
 *   1. SCHEDULE new inspections — find active tenancies where
 *      (now - last_inspection_completed_at) >= 91 days (quarterly)
 *      and no open inspection already exists. Create an inspections row
 *      and send the initial photo-request WhatsApp to the tenant.
 *
 *   2. SEND REMINDERS — find inspections in status 'awaiting_photos' or
 *      'partial' where initiated_at was 3 or 6 days ago and reminder_count
 *      is below the threshold. Nudge the tenant with remaining room list.
 *
 * pg_cron setup (run once in your Supabase SQL editor):
 * ─────────────────────────────────────────────────────
 *   SELECT cron.schedule(
 *     'inspection-daily',
 *     '0 9 * * *',   -- 9 AM UTC daily
 *     $$
 *     SELECT net.http_post(
 *       url      := 'https://<project-ref>.supabase.co/functions/v1/inspection-cron',
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
  INSPECTION_INTERVAL_DAYS,
  INSPECTION_PHOTO_DEADLINE_DAYS,
  INSPECTION_REMINDER_DAYS,
} from "../_shared/constants.ts";
import {
  REQUIRED_ROOMS,
  OPTIONAL_ROOMS,
  buildRoomRequestMessage,
} from "../_shared/agents/inspection-agent.ts";

// ─── Entry Point ─────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  try {
    const now = new Date();
    console.log(`[inspection-cron] Starting run at ${now.toISOString()}`);

    const scheduled  = await scheduleNewInspections(now);
    const reminders  = await sendReminders(now);
    const overdue    = await markOverdueInspections(now);

    const result = { ok: true, scheduled, reminders, overdue };
    console.log("[inspection-cron] Done.", result);

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[inspection-cron] Fatal error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// ─── 1. Schedule New Inspections ─────────────────────────────────────────────

async function scheduleNewInspections(now: Date): Promise<number> {
  // Threshold: tenancies where last inspection (or start_date) is >= INSPECTION_INTERVAL_DAYS old.
  const cutoff = new Date(now.getTime() - INSPECTION_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

  // Find eligible tenancies: active, with no open inspection, and past the quarterly window.
  const { data: tenancies, error } = await supabase
    .from("tenancies")
    .select("id, landlord_id, tenant_phone, tenant_name, property_address, bedrooms, start_date, last_inspection_completed_at")
    .eq("status", "active")
    .or(
      `last_inspection_completed_at.is.null,last_inspection_completed_at.lte.${cutoff.toISOString()}`,
    );

  if (error) {
    console.error("[inspection-cron] Failed to fetch tenancies:", error.message);
    return 0;
  }
  if (!tenancies || tenancies.length === 0) return 0;

  let count = 0;

  for (const tenancy of tenancies) {
    try {
      // Check that start_date is also past the interval (avoid scheduling too early for new tenancies).
      const startDate = tenancy.start_date ? new Date(tenancy.start_date) : null;
      if (startDate && now.getTime() - startDate.getTime() < INSPECTION_INTERVAL_DAYS * 24 * 60 * 60 * 1000) {
        continue; // Tenancy is too new for first inspection.
      }

      // Check for already-open inspection.
      const { count: openCount } = await supabase
        .from("inspections")
        .select("id", { count: "exact", head: true })
        .eq("tenancy_id", tenancy.id)
        .in("status", ["awaiting_photos", "partial", "analyzing"]);

      if (openCount && openCount > 0) continue; // Already in progress.

      // Build rooms_required based on bedroom count.
      const bedrooms = tenancy.bedrooms ?? 1;
      const roomsRequired = buildRoomsRequired(bedrooms);

      // Create inspection record.
      const { data: inspection, error: insertError } = await supabase
        .from("inspections")
        .insert({
          tenancy_id: tenancy.id,
          landlord_id: tenancy.landlord_id,
          tenant_phone: tenancy.tenant_phone,
          property_address: tenancy.property_address,
          tenant_name: tenancy.tenant_name,
          scheduled_date: now.toISOString().split("T")[0],
          initiated_at: now.toISOString(),
          status: "awaiting_photos",
          photos_json: {},
          rooms_required: roomsRequired,
          reminder_count: 0,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .select("id")
        .single();

      if (insertError || !inspection) {
        console.error(`[inspection-cron] Failed to create inspection for tenancy ${tenancy.id}:`, insertError?.message);
        continue;
      }

      // Send WhatsApp to tenant.
      await sendTextMessage(
        tenancy.tenant_phone,
        buildRoomRequestMessage(tenancy.tenant_name ?? "", tenancy.property_address ?? "your property"),
      );

      console.log(`[inspection-cron] Scheduled inspection ${inspection.id} for tenancy ${tenancy.id}.`);
      count++;
    } catch (err) {
      console.error(`[inspection-cron] Error processing tenancy ${tenancy.id}:`, err);
    }
  }

  return count;
}

/** Build ordered list of required room keys based on bedroom count */
function buildRoomsRequired(bedrooms: number): string[] {
  const base = REQUIRED_ROOMS.map((r) => r.key);
  // Add extra bedrooms (bedroom_2, bedroom_3) for multi-bedroom properties.
  if (bedrooms >= 2) base.push("bedroom_2");
  if (bedrooms >= 3) base.push("bedroom_3");
  // Outdoor is always optional, not in required.
  return base;
}

// ─── 2. Send Reminders ────────────────────────────────────────────────────────

async function sendReminders(now: Date): Promise<number> {
  let count = 0;

  for (const daysAgo of INSPECTION_REMINDER_DAYS) {
    // Find inspections initiated exactly `daysAgo` days ago (within a 25-hour window).
    const windowStart = new Date(now.getTime() - (daysAgo * 24 + 1) * 60 * 60 * 1000);
    const windowEnd   = new Date(now.getTime() - (daysAgo * 24 - 1) * 60 * 60 * 1000);

    const { data: inspections, error } = await supabase
      .from("inspections")
      .select("id, tenant_phone, property_address, photos_json, rooms_required, reminder_count")
      .in("status", ["awaiting_photos", "partial"])
      .gte("initiated_at", windowStart.toISOString())
      .lte("initiated_at", windowEnd.toISOString());

    if (error) {
      console.error(`[inspection-cron] Reminder query failed (day ${daysAgo}):`, error.message);
      continue;
    }
    if (!inspections) continue;

    for (const inspection of inspections) {
      try {
        const existing = (inspection.photos_json ?? {}) as Record<string, string>;
        const requiredDone = (inspection.rooms_required as string[]).filter((k) => existing[k]).length;
        const requiredTotal = (inspection.rooms_required as string[]).length;
        const remaining = (inspection.rooms_required as string[])
          .filter((k) => !existing[k]);

        if (requiredDone >= requiredTotal) continue; // Already complete.

        const daysLeft = INSPECTION_PHOTO_DEADLINE_DAYS - daysAgo;

        // Build remaining rooms label list.
        const allRooms = [...REQUIRED_ROOMS, ...OPTIONAL_ROOMS];
        const remainingLabels = remaining
          .map((k) => allRooms.find((r) => r.key === k)?.label ?? k)
          .map((label, i) => `${i + 1}. ${label}`)
          .join("\n");

        await sendTextMessage(
          inspection.tenant_phone,
          `Just a reminder about the quarterly inspection at *${inspection.property_address ?? "your property"}*.\n\n` +
            `I still need photos of:\n${remainingLabels}\n\n` +
            `You have ${daysLeft} day${daysLeft !== 1 ? "s" : ""} left to send them. ` +
            `Type *STATUS* to see your progress.`,
        );

        await supabase
          .from("inspections")
          .update({
            reminder_count: (inspection.reminder_count ?? 0) + 1,
            last_reminder_at: now.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq("id", inspection.id);

        console.log(`[inspection-cron] Day-${daysAgo} reminder sent for inspection ${inspection.id}.`);
        count++;
      } catch (err) {
        console.error(`[inspection-cron] Reminder failed for inspection ${inspection.id}:`, err);
      }
    }
  }

  return count;
}

// ─── 3. Mark Overdue Inspections ─────────────────────────────────────────────

async function markOverdueInspections(now: Date): Promise<number> {
  const deadlineCutoff = new Date(
    now.getTime() - INSPECTION_PHOTO_DEADLINE_DAYS * 24 * 60 * 60 * 1000,
  );

  const { data: overdueInspections, error } = await supabase
    .from("inspections")
    .select("id, tenant_phone, property_address, landlord_id, photos_json, rooms_required")
    .in("status", ["awaiting_photos", "partial"])
    .lte("initiated_at", deadlineCutoff.toISOString());

  if (error || !overdueInspections) return 0;

  let count = 0;

  for (const inspection of overdueInspections) {
    try {
      await supabase
        .from("inspections")
        .update({ status: "overdue", updated_at: now.toISOString() })
        .eq("id", inspection.id);

      // Alert landlord about incomplete inspection.
      const { data: landlord } = await supabase
        .from("landlords")
        .select("phone")
        .eq("id", inspection.landlord_id)
        .single();

      if (landlord?.phone) {
        const existing = (inspection.photos_json ?? {}) as Record<string, string>;
        const requiredDone = (inspection.rooms_required as string[]).filter((k) => existing[k]).length;
        const requiredTotal = (inspection.rooms_required as string[]).length;

        await sendTextMessage(
          landlord.phone,
          `*Inspection Overdue*\n\n` +
            `The quarterly inspection at *${inspection.property_address ?? "your property"}* ` +
            `has passed its 7-day deadline.\n\n` +
            `Your tenant submitted ${requiredDone}/${requiredTotal} room photos.\n\n` +
            `You may want to contact the tenant directly or reschedule. ` +
            `Type *MAINTENANCE* if you need to arrange access.`,
        );
      }

      console.log(`[inspection-cron] Marked inspection ${inspection.id} as overdue.`);
      count++;
    } catch (err) {
      console.error(`[inspection-cron] Failed to mark overdue inspection ${inspection.id}:`, err);
    }
  }

  return count;
}
