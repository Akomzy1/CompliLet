/**
 * CompliLet — Tenancy Check-In Agent
 *
 * Handles two distinct workflows within an active periodic tenancy:
 *
 * 1. ANNUAL CHECK-IN (landlord-facing, cron-triggered)
 *    Fires every 12 months from tenancy start_date. Asks landlord:
 *      1️⃣ Continue as-is
 *      2️⃣ Review rent → hands off to Rent Review Agent
 *      3️⃣ Concerns about tenancy → explains Section 8 grounds (general guidance only)
 *
 * 2. TENANT EXIT
 *    When a tenant messages "I'm leaving" / "giving notice" / "I want to move out":
 *    - Confirms 2-month notice period (mandatory under Renters' Rights Act 2025)
 *    - Notifies landlord
 *    - Schedules checkout inspection
 *    - Transitions session to "abandoned" when property becomes vacant
 *
 * IMPORTANT — RRA 2025: Under the Renters' Rights Act, there are NO fixed-term
 * tenancies and NO renewals. All tenancies are periodic and continue indefinitely.
 * This agent NEVER talks about "renewal" or "expiry". It is a periodic check-in only.
 *
 * Session transitions:
 *   active_tenancy → abandoned   (tenant gives notice and vacates)
 *   active_tenancy stays active  (landlord chooses to continue / rent review)
 *
 * State stored in: coordinator_state.check_in_state (JSONB)
 *
 * Called by:
 *   - coordinator.ts routeActiveTenancy() — keyword match for tenant exit
 *   - coordinator.ts routeActiveTenancy() — landlord responds to check-in WhatsApp
 *   - tenancy-check-in-cron Edge Function — initiateAnnualCheckIn() public export
 */

import { supabase } from "../supabase.ts";
import { sendTextMessage } from "../whatsapp.ts";
import type { ParsedMessage } from "../types.ts";

// ─── Public Interface ────────────────────────────────────────────────────────

export interface TenancyCheckInInput {
  message: ParsedMessage;
  sessionId?: string;
  landlordId?: string;
  tenancyId?: string;
  senderRole: "landlord" | "tenant" | "referee" | "unknown";
}

export async function runTenancyCheckIn(input: TenancyCheckInInput): Promise<void> {
  const { message, senderRole } = input;
  const phone = message.from;
  const text = (message.text ?? message.interactive?.title ?? "").trim();
  const lower = text.toLowerCase();

  try {
    const landlordId = input.landlordId ?? await resolveLandlordFromSession(input.sessionId);
    if (!landlordId) {
      await sendTextMessage(phone, "I couldn't identify your account. Please contact support.");
      return;
    }

    // Tenant exit detection — always checked first for tenant senders
    if (senderRole === "tenant") {
      await handleTenantExit(lower, phone, landlordId, input.sessionId, input.tenancyId);
      return;
    }

    // Landlord responding to check-in menu (1 / 2 / 3)
    const state = await loadCheckInState(landlordId);
    await handleLandlordResponse(state, lower, text, landlordId, input.sessionId, input.tenancyId, phone);

  } catch (err) {
    console.error("[tenancy-check-in] Error:", err);
    await sendTextMessage(phone, "Sorry, something went wrong. Please try again or type *HELP*.").catch(() => {});
  }
}

// ─── Conversation State ──────────────────────────────────────────────────────

type CheckInStep =
  | "idle"
  | "awaiting_landlord_response"  // 12-month check-in sent, waiting for 1/2/3
  | "awaiting_concern_detail"     // Landlord chose 3, asking what the concern is
  | "checkout_in_progress";       // Tenant gave notice, checkout underway

interface CheckInState {
  step: CheckInStep;
  tenancyId?: string;
  sessionId?: string;
  tenantPhone?: string;
  tenantName?: string;
  propertyAddress?: string;
  currentRent?: number;
  checkInDate?: string;        // ISO datetime when 12-month check-in was sent
  noticeGivenDate?: string;    // ISO date when tenant gave notice
  noticeEndDate?: string;      // ISO date: notice_given + 2 months
}

async function loadCheckInState(landlordId: string): Promise<CheckInState> {
  const { data } = await supabase
    .from("coordinator_state")
    .select("check_in_state")
    .eq("landlord_id", landlordId)
    .maybeSingle();
  return (data?.check_in_state as CheckInState | null) ?? { step: "idle" };
}

async function saveCheckInState(landlordId: string, state: CheckInState): Promise<void> {
  await supabase
    .from("coordinator_state")
    .upsert(
      { landlord_id: landlordId, check_in_state: state, updated_at: new Date().toISOString() },
      { onConflict: "landlord_id" },
    );
}

// ─── Landlord Response Handler ───────────────────────────────────────────────

async function handleLandlordResponse(
  state: CheckInState,
  lower: string,
  _text: string,
  landlordId: string,
  sessionId: string | undefined,
  tenancyId: string | undefined,
  phone: string,
): Promise<void> {
  if (state.step === "awaiting_landlord_response") {
    const choice1 = /^[1]$/.test(lower.trim()) || /\b(1|continue|all\s+fine|fine|ok|good)\b/.test(lower);
    const choice2 = /^[2]$/.test(lower.trim()) || /\b(2|rent|review|increase)\b/.test(lower);
    const choice3 = /^[3]$/.test(lower.trim()) || /\b(3|concern|issue|problem|worried)\b/.test(lower);

    if (choice1) {
      // Reset timer — next check-in in 12 months
      await saveCheckInState(landlordId, { step: "idle" });
      await updateNextCheckInDate(state.tenancyId ?? tenancyId, landlordId);
      await sendTextMessage(
        phone,
        `*Tenancy confirmed* ✅\n\nYour tenancy at *${state.propertyAddress ?? "your property"}* is continuing as-is.\n\n` +
          "I'll check in again in 12 months. As always, just message me for rent reminders, maintenance, compliance, or rent reviews.",
      );
      return;
    }

    if (choice2) {
      // Hand off to Rent Review Agent — set rent_review_state to trigger eligibility check
      await saveCheckInState(landlordId, { step: "idle" });
      // Import at call-site to avoid circular dependency
      const { runRentReview } = await import("./rent-review.ts");
      await runRentReview({
        landlordId,
        landlordPhone: phone,
        tenancyId: state.tenancyId ?? tenancyId,
        sessionId: state.sessionId ?? sessionId,
        initiatedByCheckIn: true,
      });
      return;
    }

    if (choice3) {
      await saveCheckInState(landlordId, { ...state, step: "awaiting_concern_detail" });
      await sendTextMessage(
        phone,
        "What's the concern? Tell me what's happening and I'll explain your options.\n\n" +
          "Common issues:\n" +
          "• Rent arrears\n" +
          "• Anti-social behaviour\n" +
          "• Property damage\n" +
          "• Tenant not in residence\n\n" +
          "Type a brief description.",
      );
      return;
    }

    // Ambiguous — re-prompt
    await sendTextMessage(
      phone,
      `*12-Month Check-In — ${state.propertyAddress ?? "Your Property"}*\n\n` +
        `How would you like to proceed?\n\n` +
        "1️⃣ Everything's fine — continue as is\n" +
        "2️⃣ I'd like to review the rent\n" +
        "3️⃣ I have concerns about the tenancy\n\n" +
        "Reply 1, 2, or 3.",
    );
    return;
  }

  if (state.step === "awaiting_concern_detail") {
    await handleConcernDetail(lower, state, landlordId, phone);
    return;
  }

  if (state.step === "checkout_in_progress") {
    const nd = state.noticeEndDate ? formatDate(state.noticeEndDate) : "as agreed";
    await sendTextMessage(
      phone,
      `*Checkout in progress*\n\n` +
        `${state.tenantName || "Your tenant"} has given notice. The tenancy ends on *${nd}*.\n\n` +
        "I'll send a checkout inspection request 14 days before the end date. " +
        "Once the property is vacant, type *SCREEN* to start a new screening.",
    );
    return;
  }

  // Idle — nothing active, show tenancy overview
  const tenancy = await resolveTenancy(landlordId);
  if (!tenancy) {
    await sendTextMessage(phone, "No active tenancy found. Type *SCREEN* to start a new screening.");
    return;
  }
  await sendTextMessage(
    phone,
    `*Active Tenancy — ${tenancy.property_address ?? "Your Property"}*\n\n` +
      `Tenant: ${tenancy.tenant_name ?? "Not set"}\n` +
      `Monthly rent: £${tenancy.monthly_rent_gbp ?? "Not set"}\n\n` +
      "Type *RENT REVIEW* to start a Section 13 rent review, or *HELP* for all options.",
  );
}

// ─── Concern Detail Handler ──────────────────────────────────────────────────

async function handleConcernDetail(
  lower: string,
  state: CheckInState,
  landlordId: string,
  phone: string,
): Promise<void> {
  const isArrears = /\b(arrear|rent|not\s+paid|late|overdue|owe)\b/.test(lower);
  const isASB = /\b(anti.?social|noise|nuisance|complaint|neighbour|abuse|harassment)\b/.test(lower);
  const isDamage = /\b(damage|broken|destroy|graffiti|hole|wall|floor)\b/.test(lower);

  let grounds = "";
  if (isArrears) {
    grounds =
      "*Ground 8 (mandatory — 2+ months arrears)*\nIf rent arrears exceed 2 months at the time of notice AND at the date of hearing, possession is mandatory. " +
      "This requires a Section 8 notice with 2 weeks' notice.\n\n" +
      "*Ground 10 (discretionary — some arrears)*\nSome rent is unpaid. Court has discretion.\n\n" +
      "*Ground 11 (discretionary — persistent late payment)*\nEven if no arrears, persistent late payment may qualify.";
  } else if (isASB) {
    grounds =
      "*Ground 14 (mandatory — anti-social behaviour)*\nTenant or occupant is causing nuisance or annoyance to neighbours or the landlord, or has been convicted of a relevant offence. " +
      "Requires 2 weeks' notice.";
  } else if (isDamage) {
    grounds =
      "*Ground 13 (discretionary — deterioration of property)*\nThe tenant or someone living in the property has caused the condition to deteriorate through waste, neglect, or default.";
  } else {
    grounds =
      "*Common grounds under the Housing Act 1988 (as amended by RRA 2025):*\n\n" +
      "• Ground 8 — 2+ months rent arrears (mandatory)\n" +
      "• Ground 13 — Damage to property (discretionary)\n" +
      "• Ground 14 — Anti-social behaviour (mandatory)\n\n" +
      "Tell me more and I can explain which grounds may apply.";
  }

  await sendTextMessage(
    phone,
    `${grounds}\n\n` +
      "⚖️ *This is general guidance only. For specific legal advice on seeking possession, please consult a solicitor or contact the NRLA (National Residential Landlords Association) on 0300 131 6400.*\n\n" +
      "CompliLet never initiates possession proceedings or drafts legal notices — these require qualified legal assistance.",
  );

  // Reset state after providing guidance
  await saveCheckInState(landlordId, { step: "idle" });
}

// ─── Tenant Exit Handler ─────────────────────────────────────────────────────

async function handleTenantExit(
  lower: string,
  tenantPhone: string,
  landlordId: string,
  sessionId: string | undefined,
  tenancyId: string | undefined,
): Promise<void> {
  const isGivingNotice =
    /\b(leaving|leave|giving\s+notice|want\s+to\s+move|moving\s+out|vacate|end\s+my\s+tenancy|notice\s+to\s+quit|i'm\s+moving)\b/.test(lower);

  if (!isGivingNotice) return; // Not a notice message — no action

  const today = new Date();
  const noticeEndDate = new Date(today);
  noticeEndDate.setMonth(noticeEndDate.getMonth() + 2);
  const noticeEndIso = noticeEndDate.toISOString().split("T")[0];
  const noticeEndFormatted = formatDate(noticeEndIso);

  // Confirm 2-month notice period to tenant
  await sendTextMessage(
    tenantPhone,
    `Thank you for letting us know. Under the Renters' Rights Act 2025, your notice period is *2 months*.\n\n` +
      `*Your tenancy will end on: ${noticeEndFormatted}*\n\n` +
      "Please make sure to:\n" +
      "• Continue paying rent until the end date\n" +
      "• Return all keys by the end date\n" +
      "• Leave the property in the same condition as move-in\n\n" +
      "I'll be in touch 14 days before the end date to arrange a final checkout inspection. " +
      "Is there anything you need from us?",
  );

  // Notify landlord
  const landlordPhone = await resolveLandlordPhone(landlordId);
  const tenancy = await resolveTenancy(landlordId);

  if (landlordPhone) {
    await sendTextMessage(
      landlordPhone,
      `*Notice Received* 📬\n\n` +
        `*${tenancy?.tenant_name ?? "Your tenant"}* at *${tenancy?.property_address ?? "your property"}* ` +
        `has given 2 months' notice.\n\n` +
        `*Tenancy end date: ${noticeEndFormatted}*\n\n` +
        "I'll schedule a checkout inspection 14 days before the end date. " +
        "Once the property is vacant, just forward your next tenant enquiry to start a new screening.",
    );
  }

  // Schedule checkout inspection
  const resolvedTenancyId = tenancyId ?? tenancy?.id;
  if (resolvedTenancyId) {
    await scheduleCheckoutInspection({
      tenancyId: resolvedTenancyId,
      landlordId,
      tenantPhone,
      tenantName: tenancy?.tenant_name ?? null,
      propertyAddress: tenancy?.property_address ?? null,
      noticeEndDate: noticeEndIso,
      bedrooms: tenancy?.bedrooms ?? 1,
    });
  }

  // Save check-in state as checkout in progress
  await saveCheckInState(landlordId, {
    step: "checkout_in_progress",
    tenancyId: resolvedTenancyId,
    sessionId,
    tenantPhone,
    tenantName: tenancy?.tenant_name ?? undefined,
    propertyAddress: tenancy?.property_address ?? undefined,
    noticeGivenDate: today.toISOString().split("T")[0],
    noticeEndDate: noticeEndIso,
  });

  // Record notice date on tenancy
  if (resolvedTenancyId) {
    await supabase
      .from("tenancies")
      .update({ notice_given_date: today.toISOString().split("T")[0], updated_at: new Date().toISOString() })
      .eq("id", resolvedTenancyId);
  }

  console.log(`[tenancy-check-in] Tenant notice received for landlord ${landlordId}, end date ${noticeEndIso}.`);
}

// ─── Checkout Inspection Scheduling ─────────────────────────────────────────

async function scheduleCheckoutInspection(params: {
  tenancyId: string;
  landlordId: string;
  tenantPhone: string;
  tenantName: string | null;
  propertyAddress: string | null;
  noticeEndDate: string;
  bedrooms: number;
}): Promise<void> {
  const { tenancyId, landlordId, tenantPhone, tenantName, propertyAddress, noticeEndDate, bedrooms } = params;

  const endDate = new Date(noticeEndDate);
  // Send photo request 14 days before end date
  const initiateAt = new Date(endDate.getTime() - 14 * 24 * 60 * 60 * 1000);

  const rooms = buildCheckoutRooms(bedrooms);

  const { error } = await supabase.from("inspections").insert({
    tenancy_id: tenancyId,
    landlord_id: landlordId,
    tenant_phone: tenantPhone,
    property_address: propertyAddress,
    tenant_name: tenantName,
    scheduled_date: noticeEndDate,
    initiated_at: initiateAt.toISOString(),
    status: "awaiting_photos",
    photos_json: {},
    rooms_required: rooms,
    reminder_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[tenancy-check-in] Failed to create checkout inspection:", error.message);
  } else {
    console.log(`[tenancy-check-in] Checkout inspection scheduled for ${noticeEndDate}.`);
  }
}

function buildCheckoutRooms(bedrooms: number): string[] {
  const rooms = ["kitchen_overview", "kitchen_worktops", "bathroom_overview", "bathroom_shower", "living_room", "bedroom_1", "hallway"];
  if (bedrooms >= 2) rooms.push("bedroom_2");
  if (bedrooms >= 3) rooms.push("bedroom_3");
  rooms.push("outdoor");
  return rooms;
}

// ─── Next Check-In Date Update ───────────────────────────────────────────────

async function updateNextCheckInDate(tenancyId: string | undefined, landlordId: string): Promise<void> {
  if (!tenancyId) return;
  const nextCheckIn = new Date();
  nextCheckIn.setMonth(nextCheckIn.getMonth() + 12);
  await supabase
    .from("tenancies")
    .update({ next_check_in_date: nextCheckIn.toISOString().split("T")[0], updated_at: new Date().toISOString() })
    .eq("id", tenancyId);
  console.log(`[tenancy-check-in] Next check-in scheduled for ${nextCheckIn.toISOString().split("T")[0]}, landlord ${landlordId}.`);
}

// ─── Public Export — called by tenancy-check-in-cron ────────────────────────

/**
 * Initiates the 12-month landlord check-in.
 * Called by the tenancy-check-in-cron when next_check_in_date is today.
 */
export async function initiateAnnualCheckIn(params: {
  landlordId: string;
  landlordPhone: string;
  tenancyId: string;
  sessionId: string;
  tenantName: string | null;
  propertyAddress: string | null;
  currentRent: number | null;
}): Promise<void> {
  const { landlordId, landlordPhone, tenancyId, sessionId, tenantName, propertyAddress, currentRent } = params;

  const rentDisplay = currentRent ? `Current rent: £${currentRent}/month` : "";

  await sendTextMessage(
    landlordPhone,
    `*12-Month Tenancy Check-In* 📅\n\n` +
      `It's been 12 months since *${tenantName || "your tenant"}* moved into *${propertyAddress ?? "your property"}*. ${rentDisplay}\n\n` +
      "How would you like to proceed?\n\n" +
      "1️⃣ Everything's fine — continue as is\n" +
      "2️⃣ I'd like to review the rent\n" +
      "3️⃣ I have concerns about the tenancy\n\n" +
      "Reply 1, 2, or 3.",
  );

  await saveCheckInState(landlordId, {
    step: "awaiting_landlord_response",
    tenancyId,
    sessionId,
    tenantName: tenantName ?? undefined,
    propertyAddress: propertyAddress ?? undefined,
    currentRent: currentRent ?? undefined,
    checkInDate: new Date().toISOString(),
  });

  console.log(`[tenancy-check-in] 12-month check-in sent for tenancy ${tenancyId}.`);
}

// ─── Context Resolution ──────────────────────────────────────────────────────

async function resolveLandlordFromSession(sessionId?: string): Promise<string | null> {
  if (!sessionId) return null;
  const { data } = await supabase.from("screening_sessions").select("landlord_id").eq("id", sessionId).single();
  return data?.landlord_id ?? null;
}

async function resolveLandlordPhone(landlordId: string): Promise<string | null> {
  const { data } = await supabase.from("landlords").select("phone").eq("id", landlordId).single();
  return data?.phone ?? null;
}

interface TenancyRow {
  id: string;
  tenant_phone: string;
  tenant_name: string | null;
  property_address: string | null;
  monthly_rent_gbp: number | null;
  bedrooms: number;
}

async function resolveTenancy(landlordId: string): Promise<TenancyRow | null> {
  const { data } = await supabase
    .from("tenancies")
    .select("id, tenant_phone, tenant_name, property_address, monthly_rent_gbp, bedrooms")
    .eq("landlord_id", landlordId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

function formatDate(isoDate?: string | null): string {
  if (!isoDate) return "not set";
  try {
    return new Date(isoDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return isoDate;
  }
}
