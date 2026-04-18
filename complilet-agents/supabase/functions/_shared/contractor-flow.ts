/**
 * CompliLet — Contractor Flow (shared module)
 *
 * MARKETPLACE: Phase 2 feature. Currently disabled via MARKETPLACE_ENABLED flag.
 * When ready to enable, set MARKETPLACE_ENABLED = true in this file
 * and the 3-option flow will activate automatically.
 *
 * Reusable contractor selection used by BOTH the Compliance Autopilot
 * and the Maintenance Triage agents.
 *
 * When MARKETPLACE_ENABLED = false (launch):
 *   2 options: (1) I have my own contractor / (2) Already booked
 *
 * When MARKETPLACE_ENABLED = true (Phase 2):
 *   3 options: (1) Find me a [trade] / (2) I have my own / (3) Already booked
 *   With memory: (1) Re-use [contractor] / (2) Find different / (3) Already booked
 *
 * The flow:
 *
 *   1. presentContractorOptions() is called by either agent.
 *      - When MARKETPLACE_ENABLED and memory match: 3-option memory path
 *      - When MARKETPLACE_ENABLED and no memory: 3-option marketplace path
 *      - When !MARKETPLACE_ENABLED and memory: 3-option memory path (re-use is not marketplace)
 *      - When !MARKETPLACE_ENABLED and no memory: 2-option path (own / already booked)
 *      - Stores the pending choice in coordinator_state.contractor_flow_state
 *
 *   2. handleContractorFlow() is called by the coordinator on every
 *      subsequent message from a landlord that has a non-idle state.
 *      It walks through the steps:
 *
 *        awaiting_choice
 *          → "1" → marketplace lookup (Phase 2) or own contractor
 *          → "2" → ask for landlord's own contractor name + phone (or already booked)
 *          → "3" → schedule follow-up reminder for due date (Phase 2 only)
 *
 *        awaiting_own_contractor
 *          → parse name + phone
 *          → save contractor to DB with source=landlord_provided
 *          → message the contractor to coordinate
 *          → set step=awaiting_availability (waiting for contractor reply)
 *
 *        awaiting_availability  (this step is exited by an INBOUND
 *           contractor reply, handled separately via handleContractorReply)
 *
 *        awaiting_landlord_approval
 *          → landlord replies YES → confirm with contractor + notify tenant
 *          → landlord replies NO  → ask for alternative date
 *
 * Database tables used:
 *   - contractors            (source, linked_landlord_id, last_used_at)
 *   - referral_transactions  (landlord_id, tenancy_id, compliance_type,
 *                             maintenance_ticket_id, source, referred_at, completed_at)
 *   - coordinator_state      (contractor_flow_state JSONB)
 *
 * NB: This module is intentionally agnostic about WHICH agent triggered it.
 *     The `source` field on the state distinguishes compliance vs maintenance.
 */

import { supabase } from "./supabase.ts";
import { sendTextMessage } from "./whatsapp.ts";

// ─── Feature Flag ──────────────────────────────────────────────────────────
// Phase 2: Set to true to enable the "Find me a [trade]" marketplace option.
// When false, landlords see 2 options: own contractor or already booked.
export const MARKETPLACE_ENABLED = false;

// ─── Types ─────────────────────────────────────────────────────────────────

export type ContractorFlowSource = "compliance" | "maintenance";

export interface ContractorFlowState {
  step:
    | "idle"
    | "awaiting_choice"
    | "awaiting_own_contractor"
    | "awaiting_availability"
    | "awaiting_landlord_approval"
    | "confirmed";
  source: ContractorFlowSource;
  /** Trade key — e.g. "gas_safe", "electrician", "plumber" */
  trade: string;
  /** Human-readable job description — "Gas Safety Certificate", "leaking radiator" */
  job_type: string;
  /** Property address shown in messages */
  property_address: string;
  /** ISO date the work must be completed by (compliance) or "asap" (maintenance) */
  due_date?: string;
  /** Compliance-only */
  deadline_id?: string;
  compliance_type?: string;
  /** Maintenance-only */
  ticket_id?: string;
  /** Tenancy linkage */
  tenancy_id?: string;
  tenant_phone?: string;
  tenant_name?: string;
  /** Selected contractor (filled after option 1 or 2) */
  contractor_id?: string;
  contractor_name?: string;
  contractor_phone?: string;
  /** Maintenance urgency tone: "emergency" | "urgent" | "routine" */
  urgency?: "emergency" | "urgent" | "routine";
}

export interface PresentOptionsInput {
  landlordId: string;
  landlordPhone: string;
  source: ContractorFlowSource;
  trade: string;
  job_type: string;
  property_address: string;
  due_date?: string;
  deadline_id?: string;
  compliance_type?: string;
  ticket_id?: string;
  tenancy_id?: string;
  tenant_phone?: string;
  tenant_name?: string;
  urgency?: "emergency" | "urgent" | "routine";
}

// ─── Public: present the 3-option message ──────────────────────────────────

export async function presentContractorOptions(
  input: PresentOptionsInput,
): Promise<void> {
  const { landlordId, landlordPhone, source, trade, job_type, property_address,
          due_date, tenancy_id, urgency } = input;

  const tradeLabel = TRADE_LABELS[trade] ?? trade;

  // Memory lookup: has this landlord previously used a contractor for this trade at this property?
  const memory = await lookupPreviousContractor(landlordId, tenancy_id, trade);

  const dueText = due_date
    ? ` (by ${formatDate(due_date)})`
    : "";

  // Maintenance urgency banner
  const urgencyBanner =
    urgency === "emergency"
      ? `🚨 *URGENT:* ${job_type} reported. This needs immediate attention.\n\n`
      : "";

  // Context line (compliance vs maintenance)
  const contextLine = source === "compliance"
    ? `Your *${job_type}* for ${property_address} is due in ${daysUntil(due_date)} day${daysUntil(due_date) === 1 ? "" : "s"}${dueText}. How would you like to arrange this?\n\n`
    : `${input.tenant_name ?? "Your tenant"} has reported *${job_type}* at ${property_address}. This needs a ${tradeLabel}. How would you like to handle it?\n\n`;

  let message: string;

  if (memory) {
    // Memory path — offer re-using the same contractor (works regardless of MARKETPLACE_ENABLED
    // because re-using a landlord's own contractor is not a marketplace feature)
    if (MARKETPLACE_ENABLED) {
      message =
        urgencyBanner + contextLine +
        `Last time, *${memory.name}* did your ${job_type} at this property. Would you like me to:\n\n` +
        `1️⃣ Contact *${memory.name}* again\n` +
        `2️⃣ Find a different ${tradeLabel}\n` +
        `3️⃣ Already booked / arranged\n\n` +
        `Reply *1*, *2*, or *3*.`;
    } else {
      // No marketplace — 3 options with memory (re-use / use different own / already booked)
      message =
        urgencyBanner + contextLine +
        `Last time, *${memory.name}* did your ${job_type} at this property. Would you like me to:\n\n` +
        `1️⃣ Contact *${memory.name}* again\n` +
        `2️⃣ Use a different ${tradeLabel} (I'll help coordinate)\n` +
        `3️⃣ Already booked / arranged\n\n` +
        `Reply *1*, *2*, or *3*.`;
    }
  } else if (MARKETPLACE_ENABLED) {
    // Phase 2: marketplace path — 3 options including "Find me a [trade]"
    message =
      urgencyBanner + contextLine +
      `1️⃣ Find me a ${tradeLabel} (I'll recommend vetted professionals near you)\n` +
      `2️⃣ I have my own ${tradeLabel} (I'll help coordinate)\n` +
      `3️⃣ Already ${source === "compliance" ? "booked" : "arranged"} (just send me the ${source === "compliance" ? "certificate when done" : "update when fixed"})\n\n` +
      `Reply *1*, *2*, or *3*.`;
  } else {
    // Launch: no marketplace — 2 options only
    message =
      urgencyBanner + contextLine +
      `1️⃣ I have my own ${tradeLabel} (I'll help coordinate with them)\n` +
      `2️⃣ Already ${source === "compliance" ? "booked" : "arranged"} (just send me the ${source === "compliance" ? "certificate when done" : "update when fixed"})\n\n` +
      `Reply *1* or *2*.`;
  }

  // Save state
  const state: ContractorFlowState = {
    step: "awaiting_choice",
    source,
    trade,
    job_type,
    property_address,
    due_date,
    deadline_id: input.deadline_id,
    compliance_type: input.compliance_type,
    ticket_id: input.ticket_id,
    tenancy_id,
    tenant_phone: input.tenant_phone,
    tenant_name: input.tenant_name,
    urgency,
    // Pre-fill memory match so option 1 short-circuits to it
    contractor_id:    memory?.id,
    contractor_name:  memory?.name,
    contractor_phone: memory?.phone,
  };
  await saveState(landlordId, state);

  await sendTextMessage(landlordPhone, message);
}

// ─── Public: handle inbound landlord replies during the flow ────────────────

export async function handleContractorFlow(
  landlordId: string,
  landlordPhone: string,
  inboundText: string,
): Promise<void> {
  const text = inboundText.trim();
  const state = await loadState(landlordId);

  if (!state || state.step === "idle") return;

  try {
    switch (state.step) {
      case "awaiting_choice":
        await handleChoice(landlordId, landlordPhone, state, text);
        break;

      case "awaiting_own_contractor":
        await handleOwnContractorDetails(landlordId, landlordPhone, state, text);
        break;

      case "awaiting_landlord_approval":
        await handleLandlordApproval(landlordId, landlordPhone, state, text);
        break;

      default:
        // awaiting_availability is exited only by an inbound contractor reply
        await sendTextMessage(
          landlordPhone,
          `I'm still waiting on ${state.contractor_name ?? "your contractor"} to confirm availability. ` +
            `I'll let you know as soon as I hear back.`,
        );
    }
  } catch (err) {
    console.error("[contractor-flow] Error:", err);
    await sendTextMessage(
      landlordPhone,
      "Sorry, something went wrong. Please try again or type *HELP*.",
    ).catch(() => {});
  }
}

// ─── Step handlers ─────────────────────────────────────────────────────────

async function handleChoice(
  landlordId: string,
  landlordPhone: string,
  state: ContractorFlowState,
  text: string,
): Promise<void> {
  const choice = text.replace(/[^123]/g, "")[0];
  const tradeLabel = TRADE_LABELS[state.trade] ?? state.trade;
  const hasMemory = !!(state.contractor_id && state.contractor_name && state.contractor_phone);

  // ── Remap option numbers based on MARKETPLACE_ENABLED + memory state ──
  //
  // With memory (all modes):      1=re-use  2=different own  3=already booked
  // Marketplace enabled, no mem:  1=marketplace  2=own  3=already booked
  // Marketplace disabled, no mem: 1=own  2=already booked  (no 3)
  //
  // This mapping normalises all paths into: own / marketplace / re-use / booked.

  if (hasMemory) {
    // Memory path (same for both flags)
    if (choice === "1") {
      await reachOutToContractor(landlordId, landlordPhone, state, true);
      return;
    }
    if (choice === "2") {
      // Different contractor — ask for details (own contractor flow)
      await saveState(landlordId, { ...state, step: "awaiting_own_contractor", contractor_id: undefined, contractor_name: undefined, contractor_phone: undefined });
      await sendTextMessage(
        landlordPhone,
        `What's your ${tradeLabel}'s *name and WhatsApp number*?\n\n` +
          `Format: *Name, +44...*  (e.g. "Mike Smith, +447700900123")\n\n` +
          `I'll message them to coordinate a date and arrange access with ${state.tenant_name ?? "your tenant"}.`,
      );
      return;
    }
    if (choice === "3") {
      await markAlreadyBooked(landlordId, landlordPhone, state);
      return;
    }
  } else if (MARKETPLACE_ENABLED) {
    // Phase 2: marketplace enabled, no memory — 3 options
    if (choice === "1") {
      await runMarketplaceFlow(landlordId, landlordPhone, state);
      return;
    }
    if (choice === "2") {
      await saveState(landlordId, { ...state, step: "awaiting_own_contractor" });
      await sendTextMessage(
        landlordPhone,
        `What's your ${tradeLabel}'s *name and WhatsApp number*?\n\n` +
          `Format: *Name, +44...*  (e.g. "Mike Smith, +447700900123")\n\n` +
          `I'll message them to coordinate a date and arrange access with ${state.tenant_name ?? "your tenant"}.`,
      );
      return;
    }
    if (choice === "3") {
      await markAlreadyBooked(landlordId, landlordPhone, state);
      return;
    }
  } else {
    // Launch: no marketplace, no memory — 2 options (1=own, 2=already booked)
    if (choice === "1") {
      await saveState(landlordId, { ...state, step: "awaiting_own_contractor" });
      await sendTextMessage(
        landlordPhone,
        `What's your ${tradeLabel}'s *name and WhatsApp number*?\n\n` +
          `Format: *Name, +44...*  (e.g. "Mike Smith, +447700900123")\n\n` +
          `I'll message them to coordinate a date and arrange access with ${state.tenant_name ?? "your tenant"}.`,
      );
      return;
    }
    if (choice === "2") {
      await markAlreadyBooked(landlordId, landlordPhone, state);
      return;
    }
  }

  // Invalid input — reprompt
  const validOptions = (!hasMemory && !MARKETPLACE_ENABLED) ? "*1* or *2*" : "*1*, *2*, or *3*";
  await sendTextMessage(
    landlordPhone,
    `Please reply ${validOptions} to choose how to handle this.`,
  );
}

// ── Option 1A: marketplace ─────────────────────────────────────────────────

async function runMarketplaceFlow(
  landlordId: string,
  landlordPhone: string,
  state: ContractorFlowState,
): Promise<void> {
  const tradeLabel = TRADE_LABELS[state.trade] ?? state.trade;
  const postcodeArea = await getPostcodeArea(state.property_address);

  let query = supabase
    .from("contractors")
    .select("id, name, phone, rating")
    .eq("trade", state.trade)
    .eq("source", "marketplace")
    .eq("is_verified", true)
    .order("rating", { ascending: false })
    .limit(3);

  if (postcodeArea) {
    query = query.eq("postcode_area", postcodeArea);
  }

  const { data: contractors } = await query;

  if (!contractors || contractors.length === 0) {
    await sendTextMessage(
      landlordPhone,
      `I don't have any vetted ${tradeLabel}s in your area on file yet.\n\n` +
        `You can find Gas Safe registered engineers at *gassaferegister.co.uk*, ` +
        `or certified electricians via *niceic.com*.\n\n` +
        `Once you've arranged the work, reply with *3* and I'll log it.`,
    );
    // Reset to awaiting_choice so they can pick option 2 or 3 instead
    return;
  }

  // Show top 3
  const lines: string[] = [`*Top 3 ${tradeLabel}s in your area:*\n`];
  (contractors as Array<{ id: string; name: string; phone: string; rating: number }>).forEach((c, i) => {
    const stars = "★".repeat(Math.round(c.rating)) +
      "☆".repeat(5 - Math.round(c.rating));
    lines.push(`${i + 1}. *${c.name}*\n   ${stars} (${c.rating.toFixed(1)})\n   📞 ${c.phone}`);
  });
  lines.push(`\nReply with the *number* (1, 2 or 3) of your choice and I'll coordinate the booking.`);
  lines.push(`Or reply *NONE* to find your own.`);

  // Stash the candidate list in state so we can pick by number on next reply
  await saveState(landlordId, {
    ...state,
    step: "awaiting_choice",
    // Encode candidate IDs in a comma-joined field on the state (simple)
  });
  // Use a richer state field — overwrite with a marketplace_candidates list
  await supabase
    .from("coordinator_state")
    .upsert(
      {
        landlord_id: landlordId,
        contractor_flow_state: {
          ...state,
          step: "awaiting_marketplace_pick",
          marketplace_candidates: (contractors as Array<{ id: string; name: string; phone: string; rating: number }>).map((c) => ({
            id:     c.id,
            name:   c.name,
            phone:  c.phone,
            rating: c.rating,
          })),
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "landlord_id" },
    );

  await sendTextMessage(landlordPhone, lines.join("\n"));
}

// ── Option 1B: handle marketplace pick (1/2/3 from the shortlist) ──────────

async function handleMarketplacePick(
  landlordId: string,
  landlordPhone: string,
  state: ContractorFlowState & { marketplace_candidates?: Array<{ id: string; name: string; phone: string; rating: number }> },
  text: string,
): Promise<void> {
  const upper = text.trim().toUpperCase();
  if (upper === "NONE") {
    await saveState(landlordId, { ...state, step: "awaiting_choice" });
    await sendTextMessage(
      landlordPhone,
      `No problem. Reply *2* to use your own contractor or *3* if you've already booked.`,
    );
    return;
  }

  const idx = parseInt(text.trim(), 10) - 1;
  const candidates = state.marketplace_candidates ?? [];
  const pick = candidates[idx];

  if (!pick) {
    await sendTextMessage(
      landlordPhone,
      `Please reply with *1*, *2*, or *3* to pick a ${TRADE_LABELS[state.trade] ?? state.trade}, or *NONE*.`,
    );
    return;
  }

  // Log marketplace referral (will be confirmed when contractor accepts)
  const { data: referral } = await supabase
    .from("referral_transactions")
    .insert({
      landlord_id:            landlordId,
      tenancy_id:             state.tenancy_id ?? null,
      contractor_id:          pick.id,
      compliance_type:        state.compliance_type ?? null,
      compliance_deadline_id: state.deadline_id ?? null,
      maintenance_ticket_id:  state.ticket_id ?? null,
      job_type:               state.job_type,
      source:                 "marketplace",
      referred_at:            new Date().toISOString(),
      created_at:             new Date().toISOString(),
    })
    .select("id")
    .single();

  // Move state to "awaiting_availability" — outbound contractor reach-out
  const updatedState: ContractorFlowState = {
    ...state,
    contractor_id:    pick.id,
    contractor_name:  pick.name,
    contractor_phone: pick.phone,
    step:             "awaiting_availability",
  };
  await saveState(landlordId, updatedState);

  await reachOutToContractor(landlordId, landlordPhone, updatedState, false, referral?.id as string | undefined);
}

// ── Option 2: landlord-provided contractor details ─────────────────────────

async function handleOwnContractorDetails(
  landlordId: string,
  landlordPhone: string,
  state: ContractorFlowState,
  text: string,
): Promise<void> {
  // Parse "Name, +44..."
  const parts = text.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  const namePart  = parts[0] ?? "";
  const phonePart = parts.slice(1).join(" ").replace(/\s+/g, "");

  const phoneMatch = phonePart.match(/(\+?\d{10,15})/);
  const phone = phoneMatch?.[1];

  if (!namePart || !phone) {
    await sendTextMessage(
      landlordPhone,
      `I didn't catch a name and phone number. Please reply in this format:\n\n` +
        `*Name, +44...*\n\n` +
        `For example: *Mike Smith, +447700900123*`,
    );
    return;
  }

  // Normalise phone — strip leading + and any non-digits, ensure 44 prefix
  const cleanPhone = phone.replace(/^\+/, "").replace(/\D/g, "");
  const normalisedPhone = cleanPhone.startsWith("44")
    ? cleanPhone
    : cleanPhone.startsWith("0")
      ? "44" + cleanPhone.substring(1)
      : cleanPhone;

  // Save contractor with source=landlord_provided
  const postcodeArea = await getPostcodeArea(state.property_address);
  const { data: contractor, error } = await supabase
    .from("contractors")
    .insert({
      name:               namePart,
      trade:              state.trade,
      phone:              normalisedPhone,
      area:               postcodeArea,
      postcode_area:      postcodeArea,
      source:             "landlord_provided",
      linked_landlord_id: landlordId,
      is_verified:        false,
      active:             true,
      created_at:         new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !contractor) {
    console.error("[contractor-flow] Failed to save landlord contractor:", error?.message);
    await sendTextMessage(landlordPhone, "Sorry, I couldn't save that contractor. Please try again.");
    return;
  }

  // Log a no-fee referral transaction
  await supabase.from("referral_transactions").insert({
    landlord_id:            landlordId,
    tenancy_id:             state.tenancy_id ?? null,
    contractor_id:          contractor.id,
    compliance_type:        state.compliance_type ?? null,
    compliance_deadline_id: state.deadline_id ?? null,
    maintenance_ticket_id:  state.ticket_id ?? null,
    job_type:               state.job_type,
    source:                 "landlord_provided",
    fee_amount:             0,
    referred_at:            new Date().toISOString(),
    created_at:             new Date().toISOString(),
  });

  // Update state
  const updatedState: ContractorFlowState = {
    ...state,
    contractor_id:    contractor.id as string,
    contractor_name:  namePart,
    contractor_phone: normalisedPhone,
    step:             "awaiting_availability",
  };
  await saveState(landlordId, updatedState);

  // Reach out to the contractor on WhatsApp
  await reachOutToContractor(landlordId, landlordPhone, updatedState, false);
}

// ── Option 3: already booked ────────────────────────────────────────────────

async function markAlreadyBooked(
  landlordId: string,
  landlordPhone: string,
  state: ContractorFlowState,
): Promise<void> {
  const reminderText =
    state.source === "compliance"
      ? `No problem. Please send me the new ${state.job_type} certificate once you have it and I'll update your records.\n\n` +
        (state.due_date
          ? `I'll check back with you on *${formatDate(state.due_date)}* if I haven't received it by then.`
          : "")
      : `No problem. Please reply *RESOLVED* once the work is done and I'll close the ticket.`;

  await sendTextMessage(landlordPhone, reminderText);

  // Clear the state — the existing reminder/follow-up systems take over
  await clearState(landlordId);
}

// ── Reach out to the contractor via WhatsApp ────────────────────────────────

async function reachOutToContractor(
  landlordId: string,
  landlordPhone: string,
  state: ContractorFlowState,
  isMemoryReuse: boolean,
  referralId?: string,
): Promise<void> {
  if (!state.contractor_phone || !state.contractor_name) {
    await sendTextMessage(landlordPhone, "Sorry, I don't have a phone number for that contractor. Please try again.");
    return;
  }

  // Look up the landlord's display name
  const { data: landlord } = await supabase
    .from("landlords")
    .select("full_name")
    .eq("id", landlordId)
    .maybeSingle();

  const landlordName = (landlord?.full_name as string) ?? "your client";

  const dueLine = state.due_date
    ? `The certificate is due by *${formatDate(state.due_date)}*. `
    : "";

  const urgencyLine =
    state.urgency === "emergency"
      ? "🚨 This is *urgent* — please respond as soon as possible.\n\n"
      : "";

  const introLine = isMemoryReuse
    ? `Hi ${state.contractor_name}, ${landlordName} would like to book you again for a ${state.job_type}.`
    : `Hi ${state.contractor_name}, I'm CompliLet, an AI property management assistant working on behalf of ${landlordName}. They've asked me to help arrange a ${state.job_type} at ${state.property_address}.`;

  const contractorMsg =
    `${urgencyLine}${introLine}\n\n` +
    `📍 Address: ${state.property_address}\n` +
    `${dueLine}\n` +
    `Can you let me know your *available dates*? Reply with one or more dates and I'll arrange access with the tenant.`;

  await sendTextMessage(state.contractor_phone, contractorMsg);

  // Confirm to landlord
  await sendTextMessage(
    landlordPhone,
    `✅ I've messaged *${state.contractor_name}* on WhatsApp asking for their availability. ` +
      `I'll let you know as soon as they reply with a date.`,
  );

  // If we deferred logging the marketplace referral, mark it referred_at now
  if (referralId) {
    await supabase
      .from("referral_transactions")
      .update({ referred_at: new Date().toISOString() })
      .eq("id", referralId);
  }
}

// ── Landlord approval of contractor's proposed date ─────────────────────────

async function handleLandlordApproval(
  landlordId: string,
  landlordPhone: string,
  state: ContractorFlowState,
  text: string,
): Promise<void> {
  const lower = text.toLowerCase();
  const isYes = /\b(yes|approve|approved|ok|okay|go\s+ahead|confirm|confirmed|book\s+it|sounds\s+good)\b/.test(lower);
  const isNo  = /\b(no|nope|reject|decline|not\s+ok|cancel|different\s+date|another\s+date)\b/.test(lower);

  if (isYes && state.contractor_phone && state.tenant_phone) {
    // Confirm with contractor
    await sendTextMessage(
      state.contractor_phone,
      `✅ ${state.contractor_name ? state.contractor_name + ", t" : "T"}he landlord has confirmed the booking for *${state.job_type}* at ${state.property_address}. ` +
        `Please proceed as scheduled. I've notified the tenant about your visit.`,
    );

    // Notify tenant
    const tradeLabel = TRADE_LABELS[state.trade] ?? state.trade;
    await sendTextMessage(
      state.tenant_phone,
      `Hi ${state.tenant_name ?? "there"}, a ${tradeLabel} *(${state.contractor_name})* will be visiting *${state.property_address}* for the *${state.job_type}*. ` +
        `This is arranged by your landlord and is a legal requirement. Please make sure someone is home.`,
    );

    // Confirm to landlord
    await sendTextMessage(
      landlordPhone,
      `✅ Booking confirmed. I've notified ${state.contractor_name} and ${state.tenant_name ?? "your tenant"}. ` +
        `I'll follow up after the visit to make sure the certificate has been sent.`,
    );

    // Mark contractor as recently used
    if (state.contractor_id) {
      await supabase
        .from("contractors")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", state.contractor_id);
    }

    // State → confirmed (the cron / agent follow-up takes over from here)
    await saveState(landlordId, { ...state, step: "confirmed" });
    return;
  }

  if (isNo) {
    if (state.contractor_phone) {
      await sendTextMessage(
        state.contractor_phone,
        `Thanks for the update — the landlord can't make that date. Could you suggest an alternative?`,
      );
    }
    await sendTextMessage(
      landlordPhone,
      `Got it — I've asked ${state.contractor_name ?? "the contractor"} for an alternative date.`,
    );
    await saveState(landlordId, { ...state, step: "awaiting_availability" });
    return;
  }

  await sendTextMessage(
    landlordPhone,
    `Reply *YES* to approve the date, or *NO* to ask for a different date.`,
  );
}

// ─── Public: handle inbound contractor message ─────────────────────────────

/**
 * Called by the coordinator when an inbound message comes from a phone
 * matching a contractor record. Updates the relevant landlord's state and
 * forwards the contractor's reply for approval.
 */
export async function handleContractorReply(
  contractorPhone: string,
  inboundText: string,
): Promise<boolean> {
  // Find this contractor
  const { data: contractor } = await supabase
    .from("contractors")
    .select("id, name, linked_landlord_id")
    .eq("phone", contractorPhone)
    .maybeSingle();

  if (!contractor) return false;

  // Find the landlord who has this contractor in their state
  // Search coordinator_state for contractor_flow_state.contractor_id matching
  const { data: rows } = await supabase
    .from("coordinator_state")
    .select("landlord_id, contractor_flow_state")
    .filter("contractor_flow_state->>contractor_id", "eq", contractor.id);

  if (!rows || rows.length === 0) return false;

  for (const row of rows) {
    const state = row.contractor_flow_state as ContractorFlowState | null;
    if (!state || state.step !== "awaiting_availability") continue;

    const landlordId = row.landlord_id as string;
    const { data: landlord } = await supabase
      .from("landlords")
      .select("whatsapp_number")
      .eq("id", landlordId)
      .maybeSingle();

    const landlordPhone = (landlord?.whatsapp_number as string) ?? "";
    if (!landlordPhone) continue;

    // Forward the contractor's availability to the landlord for approval
    await sendTextMessage(
      landlordPhone,
      `📅 *${state.contractor_name ?? "Your contractor"} replied:*\n\n` +
        `"${inboundText}"\n\n` +
        `Reply *YES* to approve this and confirm with the contractor + tenant, ` +
        `or *NO* to ask for a different date.`,
    );

    // Acknowledge to contractor
    await sendTextMessage(
      contractorPhone,
      `Thanks — I've passed your availability to the landlord for approval. I'll be in touch as soon as they confirm.`,
    );

    // Move state forward
    await saveState(landlordId, { ...state, step: "awaiting_landlord_approval" });
    return true;
  }

  return false;
}

// ─── Public: marketplace pick handler (called from coordinator routing) ─────

export async function handleMarketplacePickFromCoordinator(
  landlordId: string,
  landlordPhone: string,
  inboundText: string,
): Promise<boolean> {
  const state = await loadState(landlordId);
  if (!state || (state as { step: string }).step !== "awaiting_marketplace_pick") return false;

  await handleMarketplacePick(
    landlordId,
    landlordPhone,
    state as ContractorFlowState & { marketplace_candidates?: Array<{ id: string; name: string; phone: string; rating: number }> },
    inboundText,
  );
  return true;
}

// ─── Memory lookup ──────────────────────────────────────────────────────────

interface ContractorMemoryRow {
  id: string;
  name: string;
  phone: string;
}

async function lookupPreviousContractor(
  landlordId: string,
  tenancyId: string | undefined,
  trade: string,
): Promise<ContractorMemoryRow | null> {
  if (!tenancyId) {
    // Fall back to "any property" memory
    const { data } = await supabase
      .from("contractors")
      .select("id, name, phone")
      .eq("trade", trade)
      .eq("linked_landlord_id", landlordId)
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    return data as ContractorMemoryRow | null;
  }

  // Property-specific memory — look for the most recent referral_transaction
  // for this landlord+tenancy+trade, then return its contractor.
  const { data: ref } = await supabase
    .from("referral_transactions")
    .select("contractor_id, contractors(id, name, phone)")
    .eq("landlord_id", landlordId)
    .eq("tenancy_id", tenancyId)
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(5);

  if (!ref || ref.length === 0) {
    // Fallback to any contractor of this trade owned by this landlord
    const { data } = await supabase
      .from("contractors")
      .select("id, name, phone")
      .eq("trade", trade)
      .eq("linked_landlord_id", landlordId)
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    return data as ContractorMemoryRow | null;
  }

  // Find the first referral whose contractor matches the trade
  for (const row of ref) {
    const c = row.contractors as { id?: string; name?: string; phone?: string; trade?: string } | null;
    if (c?.id && c.name && c.phone) {
      // We don't check trade here since we already filtered on landlord+tenancy
      // and the contractor record's trade may be the same or related.
      return { id: c.id, name: c.name, phone: c.phone };
    }
  }
  return null;
}

// ─── State persistence ─────────────────────────────────────────────────────

async function loadState(landlordId: string): Promise<ContractorFlowState | null> {
  const { data } = await supabase
    .from("coordinator_state")
    .select("contractor_flow_state")
    .eq("landlord_id", landlordId)
    .maybeSingle();

  return (data?.contractor_flow_state as ContractorFlowState | null) ?? null;
}

async function saveState(
  landlordId: string,
  state: ContractorFlowState,
): Promise<void> {
  await supabase
    .from("coordinator_state")
    .upsert(
      {
        landlord_id:            landlordId,
        contractor_flow_state:  state,
        updated_at:             new Date().toISOString(),
      },
      { onConflict: "landlord_id" },
    );
}

async function clearState(landlordId: string): Promise<void> {
  await supabase
    .from("coordinator_state")
    .upsert(
      {
        landlord_id:           landlordId,
        contractor_flow_state: { step: "idle" },
        updated_at:            new Date().toISOString(),
      },
      { onConflict: "landlord_id" },
    );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const TRADE_LABELS: Record<string, string> = {
  gas_safe:        "Gas Safe engineer",
  electrician:     "electrician",
  plumber:         "plumber",
  energy_assessor: "energy assessor",
  water_treatment: "water treatment specialist",
  general:         "contractor",
  heating:         "heating engineer",
  roofer:          "roofer",
  pest_control:    "pest control specialist",
};

function formatDate(iso: string | undefined): string {
  if (!iso) return "TBC";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

function daysUntil(iso: string | undefined): number {
  if (!iso) return 0;
  const target = new Date(iso).getTime();
  const now = Date.now();
  return Math.max(0, Math.round((target - now) / 86_400_000));
}

async function getPostcodeArea(propertyAddress: string): Promise<string | null> {
  const match = propertyAddress.match(/([A-Z]{1,2}\d{1,2}[A-Z]?)\s*\d[A-Z]{2}/i);
  return match ? match[1].toUpperCase() : null;
}
