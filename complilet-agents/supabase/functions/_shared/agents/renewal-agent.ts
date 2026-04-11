/**
 * CompliLet — Renewal Agent
 *
 * Manages lease renewal and end-of-tenancy for active tenancies.
 *
 * Triggered by:
 *   1. renewal-cron — fires 60 days before tenancy end_date, transitions the
 *      session to "renewal" status, and sends the landlord their decision notice.
 *   2. coordinator.ts case "renewal" — any inbound message when session is in
 *      "renewal" status (both landlord and tenant are routed here).
 *   3. coordinator.ts keyword match — "renew", "renewal", "extend",
 *      "end of tenancy", "moving out", etc. while in "active_tenancy" status.
 *
 * Conversation state is stored in coordinator_state.renewal_state (JSONB),
 * keyed by landlord_id. The step field drives which handler runs next.
 *
 * State machine (coordinator_state.renewal_state.step):
 *   idle                       — no active renewal cycle
 *   awaiting_landlord_decision — 60-day notice sent, waiting for "1" (renew) or "2" (leave)
 *   awaiting_rent_amount       — landlord chose renew, waiting for a rent figure
 *   awaiting_tenant_response   — offer sent to tenant, waiting for YES or NO
 *   checkout_scheduled         — landlord chose "let leave" or tenant declined;
 *                                tenancy is winding down. End-date transition handled by cron.
 *
 * Session transitions (screening_sessions.status):
 *   active_tenancy → renewal           (cron, 60 days before end_date)
 *   renewal → active_tenancy           (tenant says YES to renewal)
 *   renewal → abandoned                (tenancy ends — end_date passed, no renewal)
 *
 * Database assumptions:
 *   tenancies (
 *     id UUID, landlord_id UUID, tenant_phone TEXT, tenant_name TEXT,
 *     property_address TEXT, monthly_rent_gbp NUMERIC(10,2),
 *     start_date DATE, end_date DATE, status TEXT
 *   )
 *   coordinator_state (
 *     landlord_id UUID PRIMARY KEY,
 *     renewal_state JSONB,         -- RenewalConversationState
 *     compliance_state JSONB,
 *     awaiting TEXT,
 *     updated_at TIMESTAMPTZ
 *   )
 *
 * Called by: coordinator.ts
 */

import { supabase } from "../supabase.ts";
import { sendTextMessage } from "../whatsapp.ts";
import { RENEWAL_DEFAULT_PERIOD_MONTHS } from "../constants.ts";
import type { ParsedMessage } from "../types.ts";

// ─── Public Interface ────────────────────────────────────────────────────────

export interface RenewalAgentInput {
  message: ParsedMessage;
  sessionId?: string;
  landlordId?: string;
  senderRole: "landlord" | "tenant" | "referee" | "unknown";
}

export async function runRenewalAgent(input: RenewalAgentInput): Promise<void> {
  const { message, senderRole } = input;
  const phone = message.from;
  const text = (message.text ?? message.interactive?.title ?? "").trim();
  const lower = text.toLowerCase();

  try {
    // ── Resolve landlord ID and session ID ──────────────────────────────
    const landlordId =
      input.landlordId ?? await resolveLandlordFromSession(input.sessionId);

    if (!landlordId) {
      await sendTextMessage(
        phone,
        "I couldn't identify your account. Please contact support.",
      );
      return;
    }

    const sessionId =
      input.sessionId ?? await resolveSessionForLandlord(landlordId);

    // ── Load conversation state ─────────────────────────────────────────
    const state = await loadRenewalState(landlordId);

    // ── Tenant path ─────────────────────────────────────────────────────
    if (senderRole === "tenant") {
      await handleTenantMessage(state, lower, landlordId, sessionId, phone);
      return;
    }

    // ── Landlord path ───────────────────────────────────────────────────
    await handleLandlordMessage(state, lower, text, landlordId, sessionId, phone);

  } catch (err) {
    console.error("[renewal-agent] Error:", err);
    await sendTextMessage(
      phone,
      "Sorry, something went wrong. Please try again or type *HELP*.",
    ).catch(() => {});
  }
}

// ─── Conversation State ──────────────────────────────────────────────────────

type RenewalStep =
  | "idle"
  | "awaiting_landlord_decision"
  | "awaiting_rent_amount"
  | "awaiting_tenant_response"
  | "checkout_scheduled";

interface RenewalConversationState {
  step: RenewalStep;
  tenancyId?: string;
  sessionId?: string;
  tenantPhone?: string;
  tenantName?: string;
  propertyAddress?: string;
  currentRent?: number;
  proposedRent?: number;
  endDate?: string;       // ISO date of current end_date
  newEndDate?: string;    // ISO date proposed for renewal
}

async function loadRenewalState(landlordId: string): Promise<RenewalConversationState> {
  const { data } = await supabase
    .from("coordinator_state")
    .select("renewal_state")
    .eq("landlord_id", landlordId)
    .maybeSingle();

  const raw = data?.renewal_state as RenewalConversationState | null;
  return raw ?? { step: "idle" };
}

async function saveRenewalState(
  landlordId: string,
  state: RenewalConversationState,
): Promise<void> {
  await supabase
    .from("coordinator_state")
    .upsert({
      landlord_id: landlordId,
      renewal_state: state,
      updated_at: new Date().toISOString(),
    }, { onConflict: "landlord_id" });
}

// ─── Landlord Message Routing ────────────────────────────────────────────────

async function handleLandlordMessage(
  state: RenewalConversationState,
  lower: string,
  text: string,
  landlordId: string,
  sessionId: string | null,
  phone: string,
): Promise<void> {
  switch (state.step) {
    case "idle":
      await handleIdleState(landlordId, sessionId, phone);
      break;

    case "awaiting_landlord_decision":
      await handleLandlordDecision(state, lower, landlordId, sessionId, phone);
      break;

    case "awaiting_rent_amount":
      await handleRentAmount(state, text, landlordId, sessionId, phone);
      break;

    case "awaiting_tenant_response":
      // Landlord messaged while waiting for tenant — show status.
      await sendTextMessage(
        phone,
        `Waiting for *${state.tenantName || "your tenant"}* to respond to the renewal offer ` +
          `of *£${state.proposedRent}/month*.\n\n` +
          "I'll let you know as soon as they reply.",
      );
      break;

    case "checkout_scheduled":
      await handleCheckoutStatus(state, phone);
      break;

    default:
      await handleIdleState(landlordId, sessionId, phone);
  }
}

// ─── Idle State ──────────────────────────────────────────────────────────────

async function handleIdleState(
  landlordId: string,
  sessionId: string | null,
  phone: string,
): Promise<void> {
  // Load the tenancy to show end date info.
  const tenancy = await resolveTenancy(landlordId);
  if (!tenancy) {
    await sendTextMessage(
      phone,
      "No active tenancy found. Type *SCREEN* to start a new tenant screening.",
    );
    return;
  }

  const endDate = tenancy.end_date ? formatDate(tenancy.end_date) : "not set";
  const daysUntil = tenancy.end_date
    ? Math.ceil((new Date(tenancy.end_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;

  const daysMsg = daysUntil === null
    ? ""
    : daysUntil > 0
      ? ` (${daysUntil} days away)`
      : " (end date has passed)";

  await sendTextMessage(
    phone,
    `*Tenancy at ${tenancy.property_address ?? "your property"}*\n\n` +
      `Tenant: ${tenancy.tenant_name ?? "Not set"}\n` +
      `Monthly rent: £${tenancy.monthly_rent_gbp ?? "Not set"}\n` +
      `End date: ${endDate}${daysMsg}\n\n` +
      (daysUntil !== null && daysUntil <= 60
        ? "Your tenancy is ending soon. Would you like to renew?\n\n" +
          "Reply *1* to renew the tenancy\n" +
          "Reply *2* to let the tenant leave"
        : "I'll send you a renewal reminder 60 days before the end date."),
  );

  // If end_date is within 60 days and we haven't sent a notice yet, initiate now.
  if (daysUntil !== null && daysUntil <= 60 && daysUntil > 0) {
    const newState: RenewalConversationState = {
      step: "awaiting_landlord_decision",
      tenancyId: tenancy.id,
      sessionId: sessionId ?? undefined,
      tenantPhone: tenancy.tenant_phone,
      tenantName: tenancy.tenant_name ?? undefined,
      propertyAddress: tenancy.property_address ?? undefined,
      currentRent: tenancy.monthly_rent_gbp ?? undefined,
      endDate: tenancy.end_date ?? undefined,
    };
    await saveRenewalState(landlordId, newState);

    // Transition session to "renewal" if still in active_tenancy.
    if (sessionId) {
      await supabase
        .from("screening_sessions")
        .update({ status: "renewal", updated_at: new Date().toISOString() })
        .eq("id", sessionId)
        .eq("status", "active_tenancy"); // Only advance if currently active — idempotent.
    }
  }
}

// ─── Landlord Decision (Renew vs Leave) ─────────────────────────────────────

async function handleLandlordDecision(
  state: RenewalConversationState,
  lower: string,
  landlordId: string,
  sessionId: string | null,
  phone: string,
): Promise<void> {
  const wantsRenew =
    /^[1y]$/.test(lower.trim()) ||
    /\b(1|renew|yes|extend|keep|continue|stay)\b/.test(lower);

  const wantsLeave =
    /^2$/.test(lower.trim()) ||
    /\b(2|leave|go|no|end|vacate|let\s+(?:them\s+)?leave|not\s+renew|let\s+go)\b/.test(lower);

  if (wantsRenew) {
    const currentRentDisplay = state.currentRent
      ? `Current rent is *£${state.currentRent}/month*.`
      : "";
    await sendTextMessage(
      phone,
      `Great - let's renew *${state.tenantName || "the tenancy"}* at ${state.propertyAddress ?? "your property"}.\n\n` +
        `${currentRentDisplay}\n\n` +
        "What rent would you like for the new period? " +
        "Reply with the monthly amount, e.g. *1500* or *£1,500*.",
    );
    await saveRenewalState(landlordId, { ...state, step: "awaiting_rent_amount" });
    return;
  }

  if (wantsLeave) {
    await initiateCheckout(state, landlordId, sessionId, phone, "landlord_decision");
    return;
  }

  // Ambiguous — re-prompt.
  await sendTextMessage(
    phone,
    `${state.tenantName || "Your tenant"}'s tenancy at *${state.propertyAddress ?? "your property"}* ` +
      `ends on *${formatDate(state.endDate)}*.\n\n` +
      "Would you like to:\n\n" +
      "*1* — Renew the tenancy\n" +
      "*2* — Let the tenant leave\n\n" +
      "Reply with 1 or 2.",
  );
}

// ─── Rent Amount ─────────────────────────────────────────────────────────────

async function handleRentAmount(
  state: RenewalConversationState,
  text: string,
  landlordId: string,
  sessionId: string | null,
  phone: string,
): Promise<void> {
  const amount = parseRentAmount(text);

  if (!amount) {
    await sendTextMessage(
      phone,
      "I didn't catch that. Please reply with just the monthly amount, e.g. *1500* or *£1,500*.",
    );
    return;
  }

  // Calculate new end date (current end_date + 12 months).
  const currentEnd = state.endDate ? new Date(state.endDate) : new Date();
  const newEnd = new Date(currentEnd);
  newEnd.setMonth(newEnd.getMonth() + RENEWAL_DEFAULT_PERIOD_MONTHS);

  const newEndDate = newEnd.toISOString().split("T")[0];
  const formattedNewEnd = formatDate(newEndDate);
  const formattedCurrentRent = state.currentRent ? `£${state.currentRent}/month` : "the previous amount";

  // Confirm with landlord before sending to tenant.
  await sendTextMessage(
    phone,
    `Got it - *£${amount}/month* (was ${formattedCurrentRent}).\n\n` +
      `New tenancy period: up to *${formattedNewEnd}* (${RENEWAL_DEFAULT_PERIOD_MONTHS} months).\n\n` +
      "Shall I send this offer to your tenant? Reply *YES* to confirm or tell me a different amount.",
  );

  await saveRenewalState(landlordId, {
    ...state,
    step: "awaiting_rent_amount",
    proposedRent: amount,
    newEndDate,
  });

  // Check for immediate confirmation in the same message.
  if (/\b(yes|yeah|confirm|send|ok|go ahead)\b/.test(text.toLowerCase())) {
    await sendRenewalOfferToTenant(
      { ...state, proposedRent: amount, newEndDate },
      landlordId,
      sessionId,
      phone,
    );
  }
}

// ─── Send Offer to Tenant ────────────────────────────────────────────────────

async function sendRenewalOfferToTenant(
  state: RenewalConversationState,
  landlordId: string,
  sessionId: string | null,
  landlordPhone: string,
): Promise<void> {
  if (!state.tenantPhone || !state.proposedRent) return;

  const formattedEnd = formatDate(state.newEndDate ?? state.endDate);

  await sendTextMessage(
    state.tenantPhone,
    `Hi ${state.tenantName || "there"}, your landlord would like to renew your tenancy at ` +
      `*${state.propertyAddress ?? "your property"}*.\n\n` +
      `The rent for the new period would be *£${state.proposedRent}/month* ` +
      `(up to ${formattedEnd}).\n\n` +
      "Would you like to continue? Reply *YES* or *NO*.",
  );

  await sendTextMessage(
    landlordPhone,
    `Renewal offer sent to *${state.tenantName || "your tenant"}*. ` +
      "I'll let you know when they respond.",
  );

  await saveRenewalState(landlordId, { ...state, step: "awaiting_tenant_response" });

  // Session should already be in "renewal" — ensure it is.
  if (sessionId) {
    await supabase
      .from("screening_sessions")
      .update({ status: "renewal", updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .in("status", ["active_tenancy", "renewal"]);
  }
}

// ─── Tenant Message Routing ──────────────────────────────────────────────────

async function handleTenantMessage(
  state: RenewalConversationState,
  lower: string,
  landlordId: string,
  sessionId: string | null,
  tenantPhone: string,
): Promise<void> {
  if (state.step !== "awaiting_tenant_response") {
    // No active offer — general acknowledgement.
    await sendTextMessage(
      tenantPhone,
      "Your landlord will be in touch about your tenancy before the end date. " +
        "Type *HELP* for other options.",
    );
    return;
  }

  const acceptsRenewal =
    /\b(yes|yeah|yep|ok|okay|sure|agreed|renew|continue|sounds good|happy)\b/.test(lower);
  const declinesRenewal =
    /\b(no|nope|nah|decline|not renew|leave|moving out|vacate|moving)\b/.test(lower);

  if (acceptsRenewal) {
    await confirmRenewal(state, landlordId, sessionId, tenantPhone);
    return;
  }

  if (declinesRenewal) {
    await initiateCheckout(state, landlordId, sessionId, tenantPhone, "tenant_declined");
    return;
  }

  // Ambiguous response.
  await sendTextMessage(
    tenantPhone,
    "Sorry, I didn't catch that. Would you like to renew your tenancy at " +
      `*£${state.proposedRent}/month*?\n\nPlease reply *YES* or *NO*.`,
  );
}

// ─── Confirm Renewal ─────────────────────────────────────────────────────────

async function confirmRenewal(
  state: RenewalConversationState,
  landlordId: string,
  sessionId: string | null,
  tenantPhone: string,
): Promise<void> {
  const newEndDate = state.newEndDate;
  const proposedRent = state.proposedRent;
  const formattedEnd = formatDate(newEndDate);

  // Update tenancy record.
  if (state.tenancyId) {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (newEndDate) updates.end_date = newEndDate;
    if (proposedRent) updates.monthly_rent_gbp = proposedRent;

    await supabase
      .from("tenancies")
      .update(updates)
      .eq("id", state.tenancyId);
  }

  // Transition session back to active_tenancy.
  if (sessionId) {
    await supabase
      .from("screening_sessions")
      .update({ status: "active_tenancy", updated_at: new Date().toISOString() })
      .eq("id", sessionId);
  }

  // Notify tenant.
  await sendTextMessage(
    tenantPhone,
    `Brilliant! Your tenancy at *${state.propertyAddress ?? "your property"}* has been renewed.\n\n` +
      `New rent: *£${proposedRent}/month*\n` +
      `Renewed until: *${formattedEnd}*\n\n` +
      "Your landlord will be in touch if there's any paperwork to sign. " +
      "Enjoy your home!",
  );

  // Notify landlord.
  const landlordPhone = await resolveLandlordPhone(landlordId);
  if (landlordPhone) {
    await sendTextMessage(
      landlordPhone,
      `*Tenancy Renewed*\n\n` +
        `${state.tenantName || "Your tenant"} has agreed to renew at ` +
        `*${state.propertyAddress ?? "your property"}*.\n\n` +
        `New rent: *£${proposedRent}/month*\n` +
        `Until: *${formattedEnd}*\n\n` +
        "The tenancy is now active again. You'll receive compliance and rent reminders as usual.",
    );
  }

  // Reset renewal state.
  await saveRenewalState(landlordId, { step: "idle" });

  console.log(`[renewal-agent] Tenancy renewed for landlord ${landlordId}.`);
}

// ─── Initiate Checkout (Landlord leaves / Tenant declines) ───────────────────

async function initiateCheckout(
  state: RenewalConversationState,
  landlordId: string,
  _sessionId: string | null,
  initiatorPhone: string,
  reason: "landlord_decision" | "tenant_declined",
): Promise<void> {
  const tenantPhone = state.tenantPhone ?? "";
  const landlordPhone = reason === "tenant_declined"
    ? await resolveLandlordPhone(landlordId) ?? ""
    : initiatorPhone;
  const tenantMessagePhone = reason === "landlord_decision" ? tenantPhone : initiatorPhone;

  const endDateFormatted = formatDate(state.endDate);

  // Message the tenant.
  if (tenantMessagePhone) {
    await sendTextMessage(
      tenantMessagePhone,
      `Hi ${state.tenantName || "there"}, just a reminder that your tenancy at ` +
        `*${state.propertyAddress ?? "your property"}* ends on *${endDateFormatted}*.\n\n` +
        "Please arrange to return your keys by that date.\n\n" +
        "We'll be in touch closer to your move-out date to arrange a final inspection. " +
        "Is there anything you need help with in the meantime?",
    );
  }

  // Message the landlord.
  if (landlordPhone && landlordPhone !== tenantMessagePhone) {
    const reasonText = reason === "tenant_declined"
      ? `Your tenant *${state.tenantName || ""}* has declined the renewal offer.`
      : "Understood - the tenancy will end as planned.";

    await sendTextMessage(
      landlordPhone,
      `${reasonText}\n\n` +
        `The tenancy at *${state.propertyAddress ?? "your property"}* ends on *${endDateFormatted}*.\n\n` +
        "I'll send the tenant a checkout inspection request 14 days before the end date. " +
        "You'll receive the final inspection report before they leave.",
    );
  }

  // Schedule checkout inspection (to be initiated 14 days before end_date).
  // The renewal-cron will trigger the actual WhatsApp when the time comes.
  if (state.tenancyId && state.endDate) {
    await scheduleCheckoutInspection(state, landlordId);
  }

  // Update renewal state to checkout_scheduled.
  await saveRenewalState(landlordId, {
    ...state,
    step: "checkout_scheduled",
  });

  console.log(`[renewal-agent] Checkout initiated for landlord ${landlordId}, reason: ${reason}.`);
}

// ─── Checkout Status ─────────────────────────────────────────────────────────

async function handleCheckoutStatus(
  state: RenewalConversationState,
  phone: string,
): Promise<void> {
  const endDateFormatted = formatDate(state.endDate);
  await sendTextMessage(
    phone,
    `*Checkout in Progress*\n\n` +
      `Tenancy at *${state.propertyAddress ?? "your property"}* ends on *${endDateFormatted}*.\n\n` +
      "A final inspection has been scheduled. " +
      "You'll receive the inspection report before the keys are returned.\n\n" +
      "Type *INSPECTION* to check the inspection status, " +
      "or *HELP* for other options.",
  );
}

// ─── Checkout Inspection Scheduling ─────────────────────────────────────────

async function scheduleCheckoutInspection(
  state: RenewalConversationState,
  landlordId: string,
): Promise<void> {
  if (!state.tenancyId || !state.endDate) return;

  // Create an inspection record pre-scheduled for checkout.
  // initiated_at is set to (end_date - 14 days) so the inspection cron will
  // send the photo request when that date arrives.
  const endDate = new Date(state.endDate);
  const initiateAt = new Date(endDate.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Build required rooms from tenancy bedrooms.
  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("bedrooms")
    .eq("id", state.tenancyId)
    .single();

  const bedrooms = tenancy?.bedrooms ?? 1;
  const roomsRequired = buildCheckoutRooms(bedrooms);

  const { error } = await supabase
    .from("inspections")
    .insert({
      tenancy_id: state.tenancyId,
      landlord_id: landlordId,
      tenant_phone: state.tenantPhone,
      property_address: state.propertyAddress,
      tenant_name: state.tenantName,
      scheduled_date: state.endDate,
      initiated_at: initiateAt.toISOString(),
      status: "awaiting_photos",
      photos_json: {},
      rooms_required: roomsRequired,
      reminder_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

  if (error) {
    console.error("[renewal-agent] Failed to create checkout inspection:", error.message);
  } else {
    console.log(`[renewal-agent] Checkout inspection scheduled for ${state.endDate}.`);
  }
}

/** Checkout inspections cover all rooms including outdoor */
function buildCheckoutRooms(bedrooms: number): string[] {
  const base = [
    "kitchen_overview", "kitchen_worktops",
    "bathroom_overview", "bathroom_shower",
    "living_room", "bedroom_1", "hallway",
  ];
  if (bedrooms >= 2) base.push("bedroom_2");
  if (bedrooms >= 3) base.push("bedroom_3");
  base.push("outdoor");
  return base;
}

// ─── Context Resolution Helpers ──────────────────────────────────────────────

async function resolveLandlordFromSession(sessionId?: string): Promise<string | null> {
  if (!sessionId) return null;
  const { data } = await supabase
    .from("screening_sessions")
    .select("landlord_id")
    .eq("id", sessionId)
    .single();
  return data?.landlord_id ?? null;
}

async function resolveSessionForLandlord(landlordId: string): Promise<string | null> {
  const terminal = ["abandoned", "rejected"];
  const { data } = await supabase
    .from("screening_sessions")
    .select("id")
    .eq("landlord_id", landlordId)
    .not("status", "in", `(${terminal.map((s) => `"${s}"`).join(",")})`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function resolveLandlordPhone(landlordId: string): Promise<string | null> {
  const { data } = await supabase
    .from("landlords")
    .select("phone")
    .eq("id", landlordId)
    .single();
  return data?.phone ?? null;
}

interface TenancyRow {
  id: string;
  tenant_phone: string;
  tenant_name: string | null;
  property_address: string | null;
  monthly_rent_gbp: number | null;
  start_date: string | null;
  end_date: string | null;
}

async function resolveTenancy(landlordId: string): Promise<TenancyRow | null> {
  const { data } = await supabase
    .from("tenancies")
    .select("id, tenant_phone, tenant_name, property_address, monthly_rent_gbp, start_date, end_date")
    .eq("landlord_id", landlordId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

// ─── Utility Functions ───────────────────────────────────────────────────────

function parseRentAmount(text: string): number | null {
  // Strip £, commas, spaces, and trailing "/month", "pcm", "pm", "per month" variants.
  const cleaned = text
    .replace(/[£,\s]/g, "")
    .replace(/(?:\/month|\/mo|pcm|pm|permonth)$/i, "");
  const num = parseFloat(cleaned);
  if (isNaN(num) || num < 100 || num > 50_000) return null;
  return Math.round(num * 100) / 100; // Round to 2 dp
}

function formatDate(isoDate?: string | null): string {
  if (!isoDate) return "not set";
  try {
    return new Date(isoDate).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return isoDate;
  }
}

// ─── Public Helpers (used by renewal-cron) ───────────────────────────────────

/**
 * Called by renewal-cron to initiate the 60-day landlord notice.
 * Creates the renewal state and sends the initial WhatsApp.
 */
export async function initiateRenewalNotice(params: {
  landlordId: string;
  landlordPhone: string;
  tenancyId: string;
  sessionId: string;
  tenantName: string | null;
  tenantPhone: string;
  propertyAddress: string | null;
  currentRent: number | null;
  endDate: string;
}): Promise<void> {
  const {
    landlordId, landlordPhone, tenancyId, sessionId,
    tenantName, tenantPhone, propertyAddress, currentRent, endDate,
  } = params;

  const endFormatted = formatDate(endDate);
  const daysAway = Math.ceil(
    (new Date(endDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
  );

  await sendTextMessage(
    landlordPhone,
    `*Tenancy Renewal Notice*\n\n` +
      `*${tenantName || "Your tenant"}*'s tenancy at *${propertyAddress ?? "your property"}* ` +
      `ends on *${endFormatted}* - that's ${daysAway} days away.\n\n` +
      "Would you like to:\n\n" +
      "*1* - Renew the tenancy\n" +
      "*2* - Let the tenant leave",
  );

  // Transition session from active_tenancy → renewal.
  await supabase
    .from("screening_sessions")
    .update({ status: "renewal", updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("status", "active_tenancy");

  // Save renewal state.
  await saveRenewalState(landlordId, {
    step: "awaiting_landlord_decision",
    tenancyId,
    sessionId,
    tenantPhone,
    tenantName: tenantName ?? undefined,
    propertyAddress: propertyAddress ?? undefined,
    currentRent: currentRent ?? undefined,
    endDate,
  });

  console.log(`[renewal-agent] 60-day notice sent for tenancy ${tenancyId}.`);
}

/**
 * Called by renewal-cron to close out an expired tenancy (end_date passed).
 * Transitions session to abandoned and notifies landlord.
 */
export async function closeExpiredTenancy(params: {
  landlordId: string;
  landlordPhone: string;
  sessionId: string;
  propertyAddress: string | null;
  tenantName: string | null;
}): Promise<void> {
  const { landlordId, landlordPhone, sessionId, propertyAddress, tenantName } = params;

  // Transition session to abandoned (tenancy has ended).
  await supabase
    .from("screening_sessions")
    .update({ status: "abandoned", updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .in("status", ["renewal", "active_tenancy"]);

  // Update tenancy status to inactive.
  await supabase
    .from("tenancies")
    .update({ status: "inactive", updated_at: new Date().toISOString() })
    .eq("landlord_id", landlordId)
    .eq("status", "active");

  // Notify landlord.
  if (landlordPhone) {
    await sendTextMessage(
      landlordPhone,
      `*Tenancy Ended*\n\n` +
        `The property at *${propertyAddress ?? "your property"}* is now vacant` +
        (tenantName ? ` - ${tenantName} has moved out.` : ".") + "\n\n" +
        "Forward your next tenant enquiry to start a new screening, " +
        "or type *SCREEN* to begin the process.",
    );
  }

  // Reset renewal state.
  await saveRenewalState(landlordId, { step: "idle" });

  console.log(`[renewal-agent] Tenancy closed for landlord ${landlordId}.`);
}
