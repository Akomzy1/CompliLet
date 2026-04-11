/**
 * CompliLet — Rent Monitor Agent
 *
 * Handles inbound WhatsApp messages from tenants and landlords related to
 * rent payment, arrears, and payment confirmation.
 *
 * Paired with rent-monitor-cron which proactively sends reminders on schedule.
 *
 * Supported flows:
 *   1. Tenant confirms payment ("I've paid", "transferred it") → mark received,
 *      notify landlord, update rent_event.
 *   2. Landlord confirms payment received → mark received, notify tenant.
 *   3. RENT keyword (or general query) → show current rent status and history.
 *   4. Landlord waives rent → mark event as "waived".
 *
 * Database assumptions for tenancies table:
 *   rent_due_day INTEGER — day of month rent is due (1–28).
 *                          If NULL, derived from start_date's day of month.
 *
 * Database assumptions for rent_events table:
 *   id UUID, tenancy_id UUID, landlord_id UUID, tenant_phone TEXT,
 *   due_date DATE, event_type TEXT, amount_gbp NUMERIC, arrears_flag BOOLEAN,
 *   confirmed_at TIMESTAMPTZ, confirmed_by TEXT, notes TEXT, created_at TIMESTAMPTZ
 *
 * Called by: coordinator.ts → routeActiveTenancy (rent keyword / pending rent state)
 */

import { supabase } from "../supabase.ts";
import { sendTextMessage } from "../whatsapp.ts";

// ─── Public Interface ───────────────────────────────────────────────────────

export interface RentMonitorInput {
  senderRole: "landlord" | "tenant";
  senderPhone: string;
  messageText: string;
  /** Present when senderRole === "landlord" */
  landlordId?: string;
  /** Present when senderRole === "tenant" — used to resolve tenancy */
  sessionId?: string;
}

export async function runRentMonitor(input: RentMonitorInput): Promise<void> {
  const { senderRole, senderPhone, messageText, landlordId, sessionId } = input;
  const lower = messageText.toLowerCase().trim();

  try {
    // ── Resolve tenancy ──────────────────────────────────────────────────
    const tenancy = senderRole === "tenant"
      ? await resolveTenancyForTenant(sessionId)
      : await resolveTenancyForLandlord(landlordId);

    if (!tenancy) {
      await sendTextMessage(
        senderPhone,
        "I couldn't find an active tenancy linked to your account. " +
          "Type *HELP* for a list of commands.",
      );
      return;
    }

    // ── Payment confirmation from tenant ─────────────────────────────────
    if (senderRole === "tenant" && isPaymentConfirmation(lower)) {
      await handleTenantPaymentConfirmation(tenancy, senderPhone);
      return;
    }

    // ── Payment confirmation from landlord ───────────────────────────────
    if (senderRole === "landlord" && isPaymentConfirmation(lower)) {
      await handleLandlordPaymentConfirmation(tenancy, senderPhone);
      return;
    }

    // ── Waiver from landlord ─────────────────────────────────────────────
    if (senderRole === "landlord" && /\b(waive|waived|waving|not\s+charging|no\s+rent\s+this\s+month|gift|free\s+month)\b/.test(lower)) {
      await handleRentWaiver(tenancy, senderPhone);
      return;
    }

    // ── Arrears query from landlord ──────────────────────────────────────
    if (senderRole === "landlord" && /\b(arrear|overdue|late|unpaid|outstanding|owed|behind)\b/.test(lower)) {
      await showArrearsStatus(tenancy, senderPhone);
      return;
    }

    // ── Default: show rent status ────────────────────────────────────────
    await showRentStatus(tenancy, senderPhone, senderRole);

  } catch (err) {
    console.error("[rent-monitor] Error:", err);
    await sendTextMessage(
      senderPhone,
      "Sorry, something went wrong checking your rent status. Please try again or type *HELP*.",
    ).catch(() => {});
  }
}

// ─── Payment confirmation — tenant ───────────────────────────────────────────

async function handleTenantPaymentConfirmation(
  tenancy: TenancyRow,
  tenantPhone: string,
): Promise<void> {
  const unpaidEvent = await getMostRecentUnpaidEvent(tenancy.id);

  if (!unpaidEvent) {
    await sendTextMessage(
      tenantPhone,
      "Thanks for letting us know! I don't have an outstanding rent reminder on file right now. " +
        "Your landlord will be notified once the payment clears.",
    );
    return;
  }

  // Mark as received.
  await supabase
    .from("rent_events")
    .update({
      event_type: "received",
      confirmed_at: new Date().toISOString(),
      confirmed_by: "tenant",
      arrears_flag: false,
    })
    .eq("id", unpaidEvent.id);

  const dueFmt = formatDueDate(unpaidEvent.due_date);
  await sendTextMessage(
    tenantPhone,
    `Got it — I've noted that your rent of *£${tenancy.monthly_rent_gbp.toFixed(2)}* ` +
      `(due ${dueFmt}) has been paid. Your landlord will be notified. Thank you!`,
  );

  // Notify landlord.
  const landlordPhone = await getLandlordPhone(tenancy.landlord_id);
  if (landlordPhone) {
    const firstName = firstNameOf(tenancy.tenant_name ?? tenantPhone);
    await sendTextMessage(
      landlordPhone,
      `*Rent confirmation:* ${firstName} has confirmed payment of ` +
        `*£${tenancy.monthly_rent_gbp.toFixed(2)}* for *${tenancy.property_address}* ` +
        `(due ${dueFmt}).\n\n` +
        "Reply *CONFIRMED* once the payment has cleared in your account.",
    );
  }
}

// ─── Payment confirmation — landlord ─────────────────────────────────────────

async function handleLandlordPaymentConfirmation(
  tenancy: TenancyRow,
  landlordPhone: string,
): Promise<void> {
  const unpaidEvent = await getMostRecentUnpaidEvent(tenancy.id);

  if (!unpaidEvent) {
    await sendTextMessage(
      landlordPhone,
      "Thanks — I don't have a pending rent reminder on file right now. " +
        "All payments appear to be up to date.",
    );
    return;
  }

  // Mark as received by landlord.
  await supabase
    .from("rent_events")
    .update({
      event_type: "received",
      confirmed_at: new Date().toISOString(),
      confirmed_by: "landlord",
      arrears_flag: false,
    })
    .eq("id", unpaidEvent.id);

  const dueFmt = formatDueDate(unpaidEvent.due_date);
  await sendTextMessage(
    landlordPhone,
    `Logged — rent of *£${tenancy.monthly_rent_gbp.toFixed(2)}* ` +
      `for *${tenancy.property_address}* (due ${dueFmt}) marked as received.`,
  );

  // Notify tenant that their payment is confirmed.
  if (tenancy.tenant_phone) {
    const firstName = firstNameOf(tenancy.tenant_name ?? tenancy.tenant_phone);
    await sendTextMessage(
      tenancy.tenant_phone,
      `Hi ${firstName}, your rent payment for ${tenancy.property_address} ` +
        `(due ${dueFmt}) has been confirmed by your landlord. Thank you!`,
    );
  }
}

// ─── Rent waiver ──────────────────────────────────────────────────────────────

async function handleRentWaiver(
  tenancy: TenancyRow,
  landlordPhone: string,
): Promise<void> {
  const unpaidEvent = await getMostRecentUnpaidEvent(tenancy.id);
  const now = new Date();
  const currentDueDate = computeCurrentDueDate(tenancy.rentDueDay, now);
  const dueFmt = formatDueDate(currentDueDate.toISOString().split("T")[0]);

  if (unpaidEvent) {
    await supabase
      .from("rent_events")
      .update({
        event_type: "waived",
        confirmed_at: now.toISOString(),
        confirmed_by: "landlord",
        arrears_flag: false,
        notes: "Landlord waived this month's rent",
      })
      .eq("id", unpaidEvent.id);
  } else {
    // Create a waived event for the current period.
    await supabase.from("rent_events").insert({
      tenancy_id: tenancy.id,
      landlord_id: tenancy.landlord_id,
      tenant_phone: tenancy.tenant_phone,
      due_date: currentDueDate.toISOString().split("T")[0],
      event_type: "waived",
      amount_gbp: tenancy.monthly_rent_gbp,
      confirmed_at: now.toISOString(),
      confirmed_by: "landlord",
      arrears_flag: false,
      notes: "Landlord waived this month's rent",
      created_at: now.toISOString(),
    });
  }

  await sendTextMessage(
    landlordPhone,
    `Noted — rent for *${tenancy.property_address}* (${dueFmt}) has been waived and logged.`,
  );

  // Notify tenant.
  if (tenancy.tenant_phone) {
    const firstName = firstNameOf(tenancy.tenant_name ?? tenancy.tenant_phone);
    await sendTextMessage(
      tenancy.tenant_phone,
      `Hi ${firstName}, your landlord has confirmed that rent for ${tenancy.property_address} ` +
        `(${dueFmt}) has been waived. No payment is required for this period.`,
    );
  }
}

// ─── Status views ─────────────────────────────────────────────────────────────

async function showRentStatus(
  tenancy: TenancyRow,
  phone: string,
  role: "landlord" | "tenant",
): Promise<void> {
  const { data: recent } = await supabase
    .from("rent_events")
    .select("due_date, event_type, amount_gbp, confirmed_at, arrears_flag")
    .eq("tenancy_id", tenancy.id)
    .order("due_date", { ascending: false })
    .limit(4);

  const lines: string[] = [
    `*Rent — ${tenancy.property_address}*\n`,
    `Monthly rent: *£${tenancy.monthly_rent_gbp.toFixed(2)}*`,
    `Due day: *${tenancy.rentDueDay}${ordinal(tenancy.rentDueDay)} of each month*\n`,
  ];

  if (!recent || recent.length === 0) {
    lines.push("No rent events on record yet.");
  } else {
    lines.push("Recent history:");
    for (const e of recent) {
      const type = e.event_type as string;
      const dueFmt = formatDueDate(e.due_date as string);
      const status = eventTypeLabel(type);
      const confirmedSuffix = e.confirmed_at ? ` (confirmed)` : "";
      lines.push(`• ${dueFmt}: ${status}${confirmedSuffix}`);
    }
  }

  if (role === "tenant") {
    lines.push("\nReply *PAID* to confirm your most recent rent payment.");
  } else {
    lines.push("\nReply *CONFIRMED* to mark rent as received, or *WAIVE* to waive this month's rent.");
  }

  await sendTextMessage(phone, lines.join("\n"));
}

async function showArrearsStatus(
  tenancy: TenancyRow,
  landlordPhone: string,
): Promise<void> {
  const { data: overdue } = await supabase
    .from("rent_events")
    .select("due_date, event_type, amount_gbp, arrears_flag, created_at")
    .eq("tenancy_id", tenancy.id)
    .eq("arrears_flag", true)
    .is("confirmed_at", null)
    .order("due_date", { ascending: false })
    .limit(6);

  if (!overdue || overdue.length === 0) {
    await sendTextMessage(
      landlordPhone,
      `No current arrears on record for *${tenancy.property_address}*. All payments appear up to date.`,
    );
    return;
  }

  const totalOwed = overdue.reduce((sum, e) => sum + ((e.amount_gbp as number) ?? 0), 0);
  const firstName = firstNameOf(tenancy.tenant_name ?? tenancy.tenant_phone);

  const lines: string[] = [
    `*Arrears — ${tenancy.property_address}*\n`,
    `Tenant: ${firstName}`,
    `Outstanding periods:\n`,
  ];

  for (const e of overdue) {
    lines.push(`• ${formatDueDate(e.due_date as string)}: £${((e.amount_gbp as number) ?? tenancy.monthly_rent_gbp).toFixed(2)}`);
  }

  lines.push(`\nEstimated total outstanding: *£${totalOwed.toFixed(2)}*`);
  lines.push("\nType *find solicitor* for legal advice, or contact the tenant directly to resolve.");

  await sendTextMessage(landlordPhone, lines.join("\n"));
}

// ─── Tenancy resolution ───────────────────────────────────────────────────────

interface TenancyRow {
  id: string;
  landlord_id: string;
  tenant_phone: string;
  tenant_name: string | null;
  property_address: string;
  monthly_rent_gbp: number;
  rentDueDay: number;
  start_date: string;
}

async function resolveTenancyForTenant(
  sessionId?: string,
): Promise<TenancyRow | null> {
  if (!sessionId) return null;

  const { data } = await supabase
    .from("tenancies")
    .select(
      "id, landlord_id, tenant_phone, tenant_name, property_address, " +
      "monthly_rent_gbp, rent_due_day, start_date",
    )
    .eq("session_id", sessionId)
    .eq("status", "active")
    .maybeSingle();

  if (!data) return null;
  return mapTenancyRow(data);
}

async function resolveTenancyForLandlord(
  landlordId?: string,
): Promise<TenancyRow | null> {
  if (!landlordId) return null;

  const { data } = await supabase
    .from("tenancies")
    .select(
      "id, landlord_id, tenant_phone, tenant_name, property_address, " +
      "monthly_rent_gbp, rent_due_day, start_date",
    )
    .eq("landlord_id", landlordId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return mapTenancyRow(data);
}

function mapTenancyRow(data: Record<string, unknown>): TenancyRow {
  // rent_due_day defaults to the day of start_date if not set.
  const startDate = data.start_date as string;
  const rentDueDay =
    (data.rent_due_day as number | null) ??
    new Date(startDate).getDate();

  return {
    id: data.id as string,
    landlord_id: data.landlord_id as string,
    tenant_phone: data.tenant_phone as string,
    tenant_name: data.tenant_name as string | null,
    property_address: data.property_address as string,
    monthly_rent_gbp: data.monthly_rent_gbp as number,
    rentDueDay,
    start_date: startDate,
  };
}

// ─── Rent event helpers ───────────────────────────────────────────────────────

interface RentEventRow {
  id: string;
  due_date: string;
  event_type: string;
  amount_gbp: number | null;
  confirmed_at: string | null;
  arrears_flag: boolean;
}

async function getMostRecentUnpaidEvent(
  tenancyId: string,
): Promise<RentEventRow | null> {
  const { data } = await supabase
    .from("rent_events")
    .select("id, due_date, event_type, amount_gbp, confirmed_at, arrears_flag")
    .eq("tenancy_id", tenancyId)
    .is("confirmed_at", null)
    .not("event_type", "in", '("received","waived","partial_payment")')
    .order("due_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as RentEventRow | null;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function isPaymentConfirmation(lower: string): boolean {
  return /\b(paid|payment|transferred|sent|done|confirmed|sorted|all\s+good|cleared|completed|banked|deposited|i\s+have\s+paid|just\s+paid|have\s+paid)\b/.test(lower);
}

/** Computes the most recent past (or today's) occurrence of rentDueDay. */
function computeCurrentDueDate(rentDueDay: number, today: Date): Date {
  const year = today.getFullYear();
  const month = today.getMonth();
  const thisMonthDue = clampedDate(year, month, rentDueDay);

  if (today >= thisMonthDue) return thisMonthDue;

  // Today is before this month's due date — previous period is last month.
  return clampedDate(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1, rentDueDay);
}

/** Date constructor that clamps the day to the last day of the month. */
function clampedDate(year: number, month: number, day: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

async function getLandlordPhone(landlordId: string): Promise<string | null> {
  const { data } = await supabase
    .from("landlords")
    .select("whatsapp_number")
    .eq("id", landlordId)
    .maybeSingle();
  return (data?.whatsapp_number as string | null) ?? null;
}

function firstNameOf(fullName: string): string {
  return fullName.split(/\s+/)[0];
}

function formatDueDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}

function eventTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    due_date_created: "Pending",
    reminder_sent:    "Reminder sent",
    received:         "Paid",
    overdue_day_1:    "1 day overdue",
    overdue_day_3:    "3 days overdue",
    overdue_day_7:    "7 days overdue — arrears",
    overdue_day_14:   "14 days overdue — escalated",
    partial_payment:  "Partial payment",
    waived:           "Waived",
  };
  return labels[type] ?? type;
}
