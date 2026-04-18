/**
 * CompliLet — Reference Chaser Agent
 *
 * Handles the "chasing_refs" session stage.
 *
 * Two distinct entry paths:
 *   1. Tenant message  — collects referee contact details + explicit consent,
 *      then sends initial outreach to each referee via WhatsApp.
 *   2. Referee message — parsed by Claude into structured data, stored in the
 *      reference_requests table, landlord notified.
 *
 * Follow-up scheduling is handled by the ref-chaser-cron Edge Function which
 * runs hourly via pg_cron and checks for stale reference_requests records.
 *
 * Table: reference_requests
 *   id, session_id, landlord_id, type, referee_name, contact_phone,
 *   company_name, status, follow_up_count, initial_contact_at,
 *   last_contact_at, responded, response_received_at, raw_response,
 *   outcome, summary, paid_on_time, good_condition, would_rent_again,
 *   employment_confirmed, income_confirmed, flags, created_at, updated_at
 *
 * Called by: coordinator.ts (shared module — not a separate Edge Function)
 */

import Anthropic from "npm:@anthropic-ai/sdk@0.24";
import { supabase } from "../supabase.ts";
import { sendTextMessage } from "../whatsapp.ts";
import { MODELS, REFERENCE_MAX_FOLLOW_UPS } from "../constants.ts";
import type { ParsedMessage, SessionStatus } from "../types.ts";

// ─── Public interface ──────────────────────────────────────────────────────

export interface RefChaserInput {
  message: ParsedMessage;
  sessionId: string;
  landlordId: string;
  /** "tenant" when collecting details; "referee" when a referee replies */
  senderRole: "tenant" | "referee";
  /** reference_requests.id — present only when senderRole === "referee" */
  referenceId?: string;
  onHandoff: (nextStatus: SessionStatus, data: HandoffData) => Promise<void>;
}

export interface HandoffData {
  referenceSummary: string;
  referenceIds: string[];
}

// ─── Agent state (stored in screening_sessions.agent_state.refs) ────────────

type CollectionStep =
  | "start"
  | "landlord_name"
  | "landlord_phone"
  | "employer_name"
  | "employer_phone"
  | "consent"
  | "awaiting_refs"
  | "complete";

interface RefereeState {
  name?: string;
  company?: string;   // employer only
  phone?: string;
  status: "pending" | "sent" | "responded" | "unresponsive" | "skipped";
  refId?: string;     // reference_requests.id
}

interface RefsAgentState {
  step: CollectionStep;
  landlord: RefereeState;
  employer: RefereeState;
}

function defaultState(): RefsAgentState {
  return {
    step: "start",
    landlord: { status: "pending" },
    employer: { status: "pending" },
  };
}

// ─── Entry point ───────────────────────────────────────────────────────────

/**
 * Main entry point. Called by the coordinator for both tenant and referee messages.
 */
export async function runReferenceChaser(input: RefChaserInput): Promise<void> {
  const { message, sessionId, landlordId, senderRole, referenceId, onHandoff } = input;

  try {
    if (senderRole === "referee" && referenceId) {
      await handleRefereeMessage(message, referenceId, sessionId, landlordId, onHandoff);
    } else {
      await handleTenantMessage(message, sessionId, landlordId, onHandoff);
    }
  } catch (err) {
    console.error("[reference-chaser] Unhandled error:", err);
    await sendTextMessage(
      message.from,
      "Sorry, I hit a snag. Please try again in a moment.",
    ).catch(() => {});
  }
}

// ─── Tenant message handling ───────────────────────────────────────────────

async function handleTenantMessage(
  message: ParsedMessage,
  sessionId: string,
  landlordId: string,
  onHandoff: (nextStatus: SessionStatus, data: HandoffData) => Promise<void>,
): Promise<void> {
  const tenantPhone = message.from;
  const text = (message.text ?? "").trim();

  // Load session for tenant name + current state.
  const { data: session } = await supabase
    .from("screening_sessions")
    .select("agent_state, pre_qualifying_summary, landlord_id")
    .eq("id", sessionId)
    .single();

  if (!session) {
    await sendTextMessage(tenantPhone, "I'm having trouble loading your session. Please try again.");
    return;
  }

  const tenantName: string =
    (session.pre_qualifying_summary as Record<string, unknown>)?.name as string | undefined
    ?? "the tenant";

  const state: RefsAgentState = (
    (session.agent_state as Record<string, unknown>)?.refs as RefsAgentState | undefined
  ) ?? defaultState();

  // Dispatch based on current step.
  switch (state.step) {
    case "start":
      await stepStart(sessionId, tenantPhone, state);
      break;

    case "landlord_name":
      await stepLandlordName(text, sessionId, tenantPhone, state);
      break;

    case "landlord_phone":
      await stepLandlordPhone(text, sessionId, tenantPhone, state);
      break;

    case "employer_name":
      await stepEmployerName(text, sessionId, tenantPhone, state);
      break;

    case "employer_phone":
      await stepEmployerPhone(text, sessionId, tenantPhone, state);
      break;

    case "consent":
      await stepConsent(text, sessionId, tenantPhone, tenantName, landlordId, state, onHandoff);
      break;

    case "awaiting_refs":
      // Refs are being chased. Tenant is just checking in.
      await sendTextMessage(
        tenantPhone,
        "I've sent reference requests and I'm waiting for replies. " +
          "I'll let you know as soon as I hear back from your referees. " +
          "This typically takes 2–3 days.",
      );
      break;

    case "complete":
      await sendTextMessage(
        tenantPhone,
        "All reference checks are complete. The landlord is reviewing your application now. " +
          "You'll hear back soon!",
      );
      break;
  }
}

// ─── Step handlers ─────────────────────────────────────────────────────────

async function stepStart(
  sessionId: string,
  tenantPhone: string,
  state: RefsAgentState,
): Promise<void> {
  const nextState: RefsAgentState = { ...state, step: "landlord_name" };
  await saveRefsState(sessionId, nextState);
  await sendTextMessage(
    tenantPhone,
    "You're almost there! 🎉 The last step is to check a couple of references.\n\n" +
      "I need to contact:\n" +
      "• Your *previous landlord* (or most recent one)\n" +
      "• Your *current employer* (or most recent)\n\n" +
      "They'll each get a short WhatsApp message with a few simple questions. " +
      "It only takes them a couple of minutes to respond.\n\n" +
      "First — what is the *full name* of your previous landlord?",
  );
}

async function stepLandlordName(
  text: string,
  sessionId: string,
  tenantPhone: string,
  state: RefsAgentState,
): Promise<void> {
  if (!text || text.length < 2) {
    await sendTextMessage(tenantPhone, "Could you send me their full name? Just type it and hit send.");
    return;
  }

  // Handle skip.
  if (isSkip(text)) {
    const nextState: RefsAgentState = {
      ...state,
      step: "employer_name",
      landlord: { ...state.landlord, status: "skipped" },
    };
    await saveRefsState(sessionId, nextState);
    await sendTextMessage(
      tenantPhone,
      "No problem — I'll skip the landlord reference.\n\n" +
        "What is the name of your *current or most recent employer* (the company name)?",
    );
    return;
  }

  const nextState: RefsAgentState = {
    ...state,
    step: "landlord_phone",
    landlord: { ...state.landlord, name: text },
  };
  await saveRefsState(sessionId, nextState);
  await sendTextMessage(
    tenantPhone,
    `Got it — *${text}*.\n\n` +
      "What's their WhatsApp or mobile number? " +
      "(Please include the country code, e.g. *447700123456*)",
  );
}

async function stepLandlordPhone(
  text: string,
  sessionId: string,
  tenantPhone: string,
  state: RefsAgentState,
): Promise<void> {
  if (isSkip(text)) {
    const nextState: RefsAgentState = {
      ...state,
      step: "employer_name",
      landlord: { ...state.landlord, status: "skipped" },
    };
    await saveRefsState(sessionId, nextState);
    await sendTextMessage(
      tenantPhone,
      "No problem — I'll skip the landlord reference.\n\n" +
        "What is the name of your *current or most recent employer* (the company name)?",
    );
    return;
  }

  const phone = parsePhone(text);
  if (!phone) {
    await sendTextMessage(
      tenantPhone,
      "I couldn't read that as a phone number. " +
        "Please send it with the country code — e.g. *447700123456* for a UK number.",
    );
    return;
  }

  const nextState: RefsAgentState = {
    ...state,
    step: "employer_name",
    landlord: { ...state.landlord, phone },
  };
  await saveRefsState(sessionId, nextState);
  await sendTextMessage(
    tenantPhone,
    "Perfect! 👍\n\n" +
      "Now — what is the name of your *current or most recent employer* (the company name)?",
  );
}

async function stepEmployerName(
  text: string,
  sessionId: string,
  tenantPhone: string,
  state: RefsAgentState,
): Promise<void> {
  if (isSkip(text)) {
    // Both refs skipped — go straight to consent (skip message different).
    if (state.landlord.status === "skipped") {
      const nextState: RefsAgentState = {
        ...state,
        step: "consent",
        employer: { ...state.employer, status: "skipped" },
      };
      await saveRefsState(sessionId, nextState);
      await sendTextMessage(
        tenantPhone,
        "Understood — I'll note that no references were provided.\n\n" +
          "Just to confirm: do you give CompliLet permission to contact " +
          "any referees you may provide in the future on your behalf? " +
          "Please reply *YES* or *NO*.",
      );
      return;
    }
    const nextState: RefsAgentState = {
      ...state,
      step: "consent",
      employer: { ...state.employer, status: "skipped" },
    };
    await saveRefsState(sessionId, nextState);
    await requestConsent(tenantPhone, state.landlord.name!, null);
    return;
  }

  const nextState: RefsAgentState = {
    ...state,
    step: "employer_phone",
    employer: { ...state.employer, company: text },
  };
  await saveRefsState(sessionId, nextState);
  await sendTextMessage(
    tenantPhone,
    `Got it — *${text}*.\n\n` +
      "What's the best WhatsApp or mobile number for your HR department or direct manager? " +
      "(Include the country code, e.g. *447700123456*)",
  );
}

async function stepEmployerPhone(
  text: string,
  sessionId: string,
  tenantPhone: string,
  state: RefsAgentState,
): Promise<void> {
  if (isSkip(text)) {
    const nextState: RefsAgentState = {
      ...state,
      step: "consent",
      employer: { ...state.employer, status: "skipped" },
    };
    await saveRefsState(sessionId, nextState);
    await requestConsent(tenantPhone, state.landlord.name ?? null, null);
    return;
  }

  const phone = parsePhone(text);
  if (!phone) {
    await sendTextMessage(
      tenantPhone,
      "I couldn't read that as a phone number. " +
        "Please send it with the country code — e.g. *447700123456*.",
    );
    return;
  }

  const nextState: RefsAgentState = {
    ...state,
    step: "consent",
    employer: { ...state.employer, phone },
  };
  await saveRefsState(sessionId, nextState);
  await requestConsent(tenantPhone, state.landlord.name ?? null, state.employer.company ?? null);
}

async function requestConsent(
  tenantPhone: string,
  landlordName: string | null,
  employerCompany: string | null,
): Promise<void> {
  const contacts: string[] = [];
  if (landlordName) contacts.push(`*${landlordName}* (previous landlord)`);
  if (employerCompany) contacts.push(`*${employerCompany}* (employer)`);

  const contactList =
    contacts.length > 0
      ? contacts.join(" and ")
      : "the contact(s) you've provided";

  await sendTextMessage(
    tenantPhone,
    `Almost done! 🏁\n\n` +
      `Do you give CompliLet permission to contact ${contactList} ` +
      `on your behalf to request a reference for this tenancy application?\n\n` +
      `Please reply *YES* to confirm, or *NO* to cancel.`,
  );
}

async function stepConsent(
  text: string,
  sessionId: string,
  tenantPhone: string,
  tenantName: string,
  landlordId: string,
  state: RefsAgentState,
  onHandoff: (nextStatus: SessionStatus, data: HandoffData) => Promise<void>,
): Promise<void> {
  if (isAffirmative(text)) {
    // Consent granted — create reference records and send initial messages.
    await sendTextMessage(
      tenantPhone,
      "Thank you for confirming! ✅\n\n" +
        "I'm sending reference requests now. " +
        "Once I've heard back, I'll let you and the landlord know.",
    );
    await initiateRefereeContacts(sessionId, landlordId, tenantName, state, onHandoff);
  } else if (isNegative(text)) {
    await sendTextMessage(
      tenantPhone,
      "No problem — I'll note that reference checks were declined. " +
        "The landlord will be informed and may still choose to proceed.",
    );
    // Mark both as skipped and advance to decision.
    const nextState: RefsAgentState = {
      step: "complete",
      landlord: { ...state.landlord, status: "skipped" },
      employer: { ...state.employer, status: "skipped" },
    };
    await saveRefsState(sessionId, nextState);
    await onHandoff("decision", {
      referenceSummary: "Tenant declined to provide reference contacts.",
      referenceIds: [],
    });
  } else {
    await sendTextMessage(
      tenantPhone,
      "Please reply *YES* to give permission or *NO* to decline.",
    );
  }
}

// ─── Referee contact initiation ────────────────────────────────────────────

async function initiateRefereeContacts(
  sessionId: string,
  landlordId: string,
  tenantName: string,
  state: RefsAgentState,
  onHandoff: (nextStatus: SessionStatus, data: HandoffData) => Promise<void>,
): Promise<void> {
  const updatedState: RefsAgentState = { ...state, step: "awaiting_refs" };
  const now = new Date().toISOString();
  const refIds: string[] = [];

  // ── Previous landlord ──
  if (state.landlord.status === "pending" && state.landlord.name && state.landlord.phone) {
    const refId = await createReferenceRecord(
      sessionId,
      landlordId,
      "previous_landlord",
      state.landlord.name,
      state.landlord.phone,
    );
    if (refId) {
      await sendLandlordReferenceRequest(state.landlord.phone, state.landlord.name, tenantName);
      updatedState.landlord = { ...updatedState.landlord, status: "sent", refId };
      refIds.push(refId);
      // Log initial contact.
      await supabase
        .from("reference_requests")
        .update({ status: "awaiting_response", initial_contact_at: now, last_contact_at: now })
        .eq("id", refId);
    }
  }

  // ── Employer ──
  if (state.employer.status === "pending" && state.employer.phone) {
    const refId = await createReferenceRecord(
      sessionId,
      landlordId,
      "employer",
      state.employer.company ?? "Employer",
      state.employer.phone,
      state.employer.company,
    );
    if (refId) {
      await sendEmployerReferenceRequest(
        state.employer.phone,
        state.employer.company ?? "HR",
        tenantName,
        state.employer.company ?? "the company",
      );
      updatedState.employer = { ...updatedState.employer, status: "sent", refId };
      refIds.push(refId);
      await supabase
        .from("reference_requests")
        .update({ status: "awaiting_response", initial_contact_at: now, last_contact_at: now })
        .eq("id", refId);
    }
  }

  await saveRefsState(sessionId, updatedState);

  // If nothing was sent (all skipped), advance immediately.
  if (refIds.length === 0) {
    await advanceToDecision(sessionId, landlordId, [], onHandoff);
  }
}

async function createReferenceRecord(
  sessionId: string,
  landlordId: string,
  type: "previous_landlord" | "employer",
  refereeName: string,
  contactPhone: string,
  companyName?: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("reference_requests")
    .insert({
      session_id: sessionId,
      landlord_id: landlordId,
      type,
      referee_name: refereeName,
      contact_phone: contactPhone,
      company_name: companyName ?? null,
      status: "pending_contact",
      responded: false,
      follow_up_count: 0,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[reference-chaser] Failed to create reference record:", error?.message);
    return null;
  }
  return data.id as string;
}

// ─── Outbound reference request messages ──────────────────────────────────

async function sendLandlordReferenceRequest(
  phone: string,
  refereeName: string,
  tenantName: string,
): Promise<void> {
  const firstName = refereeName.split(" ")[0];
  await sendTextMessage(
    phone,
    `Hi ${firstName}, I'm *CompliLet*, a tenant screening service.\n\n` +
      `*${tenantName}* has applied to rent a property and listed you as their ` +
      `previous landlord. Could you answer a few quick questions?\n\n` +
      `1️⃣ How long did they rent from you?\n` +
      `2️⃣ Did they pay rent on time?\n` +
      `3️⃣ Were there any issues with the property condition?\n` +
      `4️⃣ Would you rent to them again?\n\n` +
      `No pressure — a few words for each is fine. Thank you! 🙏`,
  );
}

async function sendEmployerReferenceRequest(
  phone: string,
  contactName: string,
  tenantName: string,
  companyName: string,
): Promise<void> {
  const firstName = contactName.split(" ")[0];
  await sendTextMessage(
    phone,
    `Hi ${firstName}, I'm *CompliLet*, a tenant screening service.\n\n` +
      `*${tenantName}* has applied to rent a property and listed you as their employer. ` +
      `Could you please confirm:\n\n` +
      `1️⃣ Is *${tenantName}* currently employed at *${companyName}*?\n` +
      `2️⃣ What is their role?\n` +
      `3️⃣ How long have they been employed?\n\n` +
      `Thank you! 🙏`,
  );
}

// ─── Follow-up messages (called by cron) ──────────────────────────────────

/** Exported: called by the ref-chaser-cron Edge Function */
export async function sendFollowUp(
  referenceId: string,
  followUpNumber: 1 | 2 | 3,
): Promise<void> {
  const { data: ref } = await supabase
    .from("reference_requests")
    .select("referee_name, contact_phone, type")
    .eq("id", referenceId)
    .single();

  if (!ref) return;

  const firstName = (ref.referee_name as string).split(" ")[0];

  const messages: Record<1 | 2 | 3, string> = {
    1:
      `Hi ${firstName}, just a friendly follow-up from *CompliLet*. ` +
      `We sent a reference request a couple of days ago for a tenant screening. ` +
      `If you have 2 minutes, we'd really appreciate your response! 🙏`,
    2:
      `Hi ${firstName}, *CompliLet* again — we're still waiting on a reference. ` +
      `Just a few words about your experience with the tenant would be great. ` +
      `No response needed if you'd prefer not to — just let us know.`,
    3:
      `Hi ${firstName}, this is our final message from *CompliLet* ` +
      `regarding the reference request. ` +
      `If we don't hear back within the next day or two, we'll note the reference ` +
      `as unavailable and proceed with the application. Thank you for your time!`,
  };

  await sendTextMessage(ref.contact_phone as string, messages[followUpNumber]);
  await supabase
    .from("reference_requests")
    .update({
      follow_up_count: followUpNumber,
      last_contact_at: new Date().toISOString(),
    })
    .eq("id", referenceId);
}

/** Exported: called by cron to mark a reference as unresponsive */
export async function markUnresponsive(referenceId: string): Promise<void> {
  await supabase
    .from("reference_requests")
    .update({
      status: "unresponsive",
      responded: false,
      outcome: "unreachable",
      updated_at: new Date().toISOString(),
    })
    .eq("id", referenceId);
}

// ─── Referee response handling ─────────────────────────────────────────────

async function handleRefereeMessage(
  message: ParsedMessage,
  referenceId: string,
  sessionId: string,
  landlordId: string,
  onHandoff: (nextStatus: SessionStatus, data: HandoffData) => Promise<void>,
): Promise<void> {
  const refereePhone = message.from;
  const responseText = message.text ?? "";

  // Load the reference record.
  const { data: ref } = await supabase
    .from("reference_requests")
    .select("type, referee_name, company_name, session_id, landlord_id")
    .eq("id", referenceId)
    .single();

  if (!ref) {
    console.error("[reference-chaser] Reference record not found:", referenceId);
    return;
  }

  // Load tenant name for context.
  const { data: session } = await supabase
    .from("screening_sessions")
    .select("pre_qualifying_summary, landlord_id")
    .eq("id", ref.session_id ?? sessionId)
    .single();

  const tenantName: string =
    (session?.pre_qualifying_summary as Record<string, unknown>)?.name as string | undefined
    ?? "the tenant";

  // Parse the response with Claude.
  const parsed = await parseRefereeResponse(
    ref.type as "previous_landlord" | "employer",
    responseText,
    tenantName,
    ref.company_name as string | undefined,
  );

  // Persist the response.
  const now = new Date().toISOString();
  await supabase
    .from("reference_requests")
    .update({
      status: "responded",
      responded: true,
      response_received_at: now,
      raw_response: responseText,
      outcome: parsed.outcome ?? null,
      summary: parsed.summary ?? null,
      ...(ref.type === "previous_landlord"
        ? {
            paid_on_time: parsed.paid_on_time ?? null,
            good_condition: parsed.property_condition === "good" ? true
              : parsed.property_condition === "poor" ? false : null,
            would_rent_again: parsed.would_rent_again ?? null,
          }
        : {
            employment_confirmed: parsed.employment_confirmed ?? null,
            income_confirmed: parsed.income_confirmed ?? null,
          }),
      flags: parsed.flags ?? [],
      updated_at: now,
    })
    .eq("id", referenceId);

  // Acknowledge the referee.
  const firstName = (ref.referee_name as string).split(" ")[0];
  await sendTextMessage(
    refereePhone,
    `Thank you so much, ${firstName}! 🙏 We really appreciate you taking the time to respond. ` +
      `Your reference has been recorded.`,
  );

  // Notify the landlord.
  const resolvedLandlordId = (ref.landlord_id ?? landlordId) as string;
  await notifyLandlordOfResponse(resolvedLandlordId, tenantName, ref.referee_name as string, parsed);

  // Update agent_state to reflect the response.
  await markRefereeResponded(ref.session_id ?? sessionId, referenceId, ref.type as string);

  // Check if all refs are complete for this session.
  await checkAndAdvanceIfComplete(
    ref.session_id ?? sessionId,
    resolvedLandlordId,
    onHandoff,
  );
}

async function notifyLandlordOfResponse(
  landlordId: string,
  tenantName: string,
  refereeName: string,
  parsed: ParsedRefereeResponse,
): Promise<void> {
  const { data: landlord } = await supabase
    .from("landlords")
    .select("whatsapp_number")
    .eq("id", landlordId)
    .single();

  if (!landlord?.whatsapp_number) return;

  const flags = parsed.flags?.length
    ? `\n\n⚠️ *Note:* ${parsed.flags.join(". ")}`
    : "";

  const outcomeEmoji = { positive: "✅", neutral: "ℹ️", negative: "⚠️", refused: "🚫" }[parsed.outcome ?? "neutral"] ?? "ℹ️";

  await sendTextMessage(
    landlord.whatsapp_number as string,
    `${outcomeEmoji} *Reference received* for *${tenantName}*\n\n` +
      `Referee: ${refereeName}\n` +
      `${parsed.summary ?? "No summary available."}` +
      flags,
  );
}

async function markRefereeResponded(
  sessionId: string,
  referenceId: string,
  refType: string,
): Promise<void> {
  const { data: session } = await supabase
    .from("screening_sessions")
    .select("agent_state")
    .eq("id", sessionId)
    .single();

  if (!session) return;

  const agentState = (session.agent_state ?? {}) as Record<string, unknown>;
  const state = (agentState.refs ?? defaultState()) as RefsAgentState;

  const updatedState: RefsAgentState = { ...state };
  if (refType === "previous_landlord" && state.landlord.refId === referenceId) {
    updatedState.landlord = { ...state.landlord, status: "responded" };
  } else if (refType === "employer" && state.employer.refId === referenceId) {
    updatedState.employer = { ...state.employer, status: "responded" };
  }

  await saveRefsState(sessionId, updatedState);
}

// ─── Completion check ──────────────────────────────────────────────────────

/**
 * Checks whether all reference_requests for this session are in a terminal state
 * (responded | unresponsive | skipped). If so, compiles a summary and hands off
 * to the "decision" stage.
 *
 * Exported for use by the ref-chaser-cron Edge Function.
 */
export async function checkAndAdvanceIfComplete(
  sessionId: string,
  landlordId: string,
  onHandoff: (nextStatus: SessionStatus, data: HandoffData) => Promise<void>,
): Promise<void> {
  const { data: refs } = await supabase
    .from("reference_requests")
    .select("id, status, type, outcome, summary, flags")
    .eq("session_id", sessionId);

  if (!refs || refs.length === 0) {
    // No references were created (all skipped before any were sent).
    await advanceToDecision(sessionId, landlordId, [], onHandoff);
    return;
  }

  const terminal = ["responded", "unresponsive", "skipped"];
  const allDone = refs.every((r) => terminal.includes(r.status as string));

  if (!allDone) return; // Still waiting.

  await advanceToDecision(
    sessionId,
    landlordId,
    refs.map((r) => r.id as string),
    onHandoff,
  );
}

async function advanceToDecision(
  sessionId: string,
  landlordId: string,
  referenceIds: string[],
  onHandoff: (nextStatus: SessionStatus, data: HandoffData) => Promise<void>,
): Promise<void> {
  const summary = await compileFinalSummary(sessionId, referenceIds);

  // Update session state to complete.
  const { data: session } = await supabase
    .from("screening_sessions")
    .select("agent_state")
    .eq("id", sessionId)
    .single();

  const agentState = (session?.agent_state ?? {}) as Record<string, unknown>;
  const refs = (agentState.refs ?? defaultState()) as RefsAgentState;
  await saveRefsState(sessionId, { ...refs, step: "complete" });

  // Notify landlord that all refs are in.
  const { data: landlord } = await supabase
    .from("landlords")
    .select("whatsapp_number")
    .eq("id", landlordId)
    .single();

  if (landlord?.whatsapp_number) {
    await sendTextMessage(
      landlord.whatsapp_number as string,
      "📋 *Reference checks complete!*\n\n" +
        "All reference requests have been resolved. I'm now compiling the full " +
        "screening report and will send it to you shortly.",
    );
  }

  await onHandoff("decision", { referenceSummary: summary, referenceIds });
}

async function compileFinalSummary(sessionId: string, refIds: string[]): Promise<string> {
  if (refIds.length === 0) return "No references obtained.";

  const { data: refs } = await supabase
    .from("reference_requests")
    .select("type, referee_name, outcome, summary, flags, paid_on_time, would_rent_again, employment_confirmed")
    .in("id", refIds);

  if (!refs?.length) return "No reference data available.";

  const lines: string[] = [];
  for (const ref of refs) {
    const label = ref.type === "previous_landlord" ? "Previous Landlord" : "Employer";
    const outcome = ref.outcome ?? "no response";
    const flags = (ref.flags as string[] | null)?.length
      ? ` Flags: ${(ref.flags as string[]).join("; ")}.`
      : "";
    lines.push(
      `${label} (${ref.referee_name}): ${outcome}. ${ref.summary ?? ""}${flags}`,
    );
  }
  return lines.join("\n");
}

// ─── Claude: referee response parser ──────────────────────────────────────

interface ParsedRefereeResponse {
  responded: boolean;
  outcome: "positive" | "neutral" | "negative" | "refused" | null;
  summary: string | null;
  flags: string[];
  // previous_landlord
  paid_on_time?: boolean | null;
  property_condition?: "good" | "fair" | "poor" | null;
  would_rent_again?: boolean | null;
  // employer
  employment_confirmed?: boolean | null;
  income_confirmed?: boolean | null;
}

async function parseRefereeResponse(
  refType: "previous_landlord" | "employer",
  responseText: string,
  tenantName: string,
  companyName?: string,
): Promise<ParsedRefereeResponse> {
  if (!responseText.trim()) {
    return { responded: false, outcome: null, summary: null, flags: [] };
  }

  const systemPrompt = await loadSystemPrompt();
  const userPrompt =
    `Reference type: ${refType === "previous_landlord" ? "previous landlord" : "employer"}\n` +
    `Tenant name: ${tenantName}\n` +
    (companyName ? `Company: ${companyName}\n` : "") +
    `\nReferee's message:\n${responseText}`;

  try {
    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
    const response = await anthropic.messages.create({
      model: MODELS.FAST,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const rawText = (response.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();

    const jsonMatch = /\{[\s\S]*\}/.exec(rawText);
    if (!jsonMatch) throw new Error("No JSON in response");

    return JSON.parse(jsonMatch[0]) as ParsedRefereeResponse;
  } catch (err) {
    console.error("[reference-chaser] Failed to parse referee response:", err);
    // Fallback: treat as neutral responded.
    return {
      responded: true,
      outcome: "neutral",
      summary: `Referee responded but response could not be parsed automatically. Raw: "${responseText.substring(0, 200)}"`,
      flags: [],
    };
  }
}

// ─── State management ──────────────────────────────────────────────────────

async function loadRefsState(sessionId: string): Promise<RefsAgentState> {
  const { data } = await supabase
    .from("screening_sessions")
    .select("agent_state")
    .eq("id", sessionId)
    .single();

  return (
    ((data?.agent_state as Record<string, unknown>)?.refs as RefsAgentState | undefined)
    ?? defaultState()
  );
}

async function saveRefsState(sessionId: string, state: RefsAgentState): Promise<void> {
  // Merge into existing agent_state rather than overwriting.
  const { data } = await supabase
    .from("screening_sessions")
    .select("agent_state")
    .eq("id", sessionId)
    .single();

  const existing = (data?.agent_state ?? {}) as Record<string, unknown>;
  await supabase
    .from("screening_sessions")
    .update({
      agent_state: { ...existing, refs: state },
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
}

// ─── System prompt loader ──────────────────────────────────────────────────

let _systemPrompt: string | null = null;

async function loadSystemPrompt(): Promise<string> {
  if (_systemPrompt) return _systemPrompt;
  try {
    _systemPrompt = await Deno.readTextFile(
      new URL("../prompts/reference-chaser.md", import.meta.url),
    );
  } catch {
    _systemPrompt = "Extract structured reference data as JSON from the referee's message.";
  }
  return _systemPrompt;
}

// ─── Utility ───────────────────────────────────────────────────────────────

/**
 * Parses a UK or international phone number from free text.
 * Returns E.164 format without leading + (e.g. "447700123456").
 */
function parsePhone(text: string): string | null {
  // Strip common formatting.
  const cleaned = text.replace(/[\s\-().]/g, "");

  // E.164 / international with +.
  const international = /^\+?(\d{10,15})$/.exec(cleaned);
  if (international) {
    const digits = international[1];
    // UK numbers starting with 07 → prefix with 44.
    if (/^07\d{9}$/.test(digits)) return `44${digits.slice(1)}`;
    return digits;
  }

  // UK 07xxx format (with spaces/dashes already stripped).
  if (/^07\d{9}$/.test(cleaned)) return `44${cleaned.slice(1)}`;

  return null;
}

function isAffirmative(text: string): boolean {
  return /\b(yes|yeah|yep|yup|sure|ok|okay|confirm|agree|consent|agreed|go\s+ahead|do\s+it)\b/i.test(text);
}

function isNegative(text: string): boolean {
  return /\b(no|nope|nah|cancel|stop|refuse|don'?t|do\s+not|disagree|decline)\b/i.test(text);
}

function isSkip(text: string): boolean {
  return /\b(skip|n\/?a|none|don'?t\s+have|no\s+(landlord|employer)|not\s+applicable|rather\s+not)\b/i.test(text);
}

// Re-export for coordinator wiring.
export type { RefChaserInput as default };
