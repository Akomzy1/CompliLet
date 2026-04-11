/**
 * CompliLet — Human Escalation Module
 *
 * Shared module used by ALL agents. Provides three public operations:
 *
 *   checkEscalation  — pure, synchronous: scans a message string for trigger
 *                      patterns and returns a structured result with no side-effects.
 *
 *   executeEscalation — async: notifies the user, creates the escalation record,
 *                       alerts the human handler via WhatsApp, and halts agent
 *                       processing for the session by writing active_escalation_id
 *                       to coordinator_state.
 *
 *   resolveEscalation — async: marks the escalation resolved, clears the halt
 *                       flag, logs the resolution for prompt improvement.
 *
 * Additionally exports:
 *   isSessionEscalated   — fast DB check used by the coordinator to skip routing
 *                          when a session has an open escalation.
 *   checkAndEscalate     — convenience wrapper: check + execute if needed.
 *                          Returns true if escalation was triggered.
 *
 * Required environment variables:
 *   ESCALATION_URGENT_PHONE — E.164 number for immediate safeguarding/crisis alerts
 *                             (founder's personal WhatsApp, without leading +)
 *   ESCALATION_HIGH_PHONE   — E.164 number for high-priority regulatory/complaint
 *                             alerts (can be same as ESCALATION_URGENT_PHONE)
 *   ESCALATION_DASHBOARD_URL — Base URL of the internal dashboard, included in
 *                              alert messages as a deep-link
 *
 * Database tables required (schema below):
 * ─────────────────────────────────────────
 *   escalations (
 *     id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     session_id          UUID REFERENCES screening_sessions(id),
 *     tenancy_id          UUID REFERENCES tenancies(id),
 *     landlord_id         UUID REFERENCES landlords(id),
 *     sender_phone        TEXT NOT NULL,
 *     trigger_type        TEXT NOT NULL,
 *     priority            TEXT NOT NULL,         -- 'urgent' | 'high' | 'normal'
 *     status              TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'in_progress' | 'resolved'
 *     context             TEXT,
 *     message_text        TEXT,
 *     handler_notified    BOOLEAN DEFAULT FALSE,
 *     handler_notified_at TIMESTAMPTZ,
 *     resolution          TEXT,
 *     resolved_by         TEXT,
 *     resolved_at         TIMESTAMPTZ,
 *     created_at          TIMESTAMPTZ DEFAULT now(),
 *     updated_at          TIMESTAMPTZ DEFAULT now()
 *   );
 *
 *   coordinator_state also requires an active_escalation_id UUID column.
 */

import { supabase } from "./supabase.ts";
import { sendTextMessage } from "./whatsapp.ts";
import { ESCALATION_TRIGGER_PATTERNS } from "./constants.ts";
import type { EscalationTrigger } from "./types.ts";

// ─── Types ─────────────────────────────────────────────────────────────────

/** Context passed to checkEscalation alongside the raw message text. */
export interface SessionContext {
  /** Screening session UUID — used to look up and halt session processing. */
  sessionId?: string;
  /** Active tenancy UUID — used when escalation occurs outside screening. */
  tenancyId?: string;
  /** Landlord UUID — used to fetch property context for the alert message. */
  landlordId?: string;
  /** Phone number of the person who sent the triggering message. */
  senderPhone: string;
  /** Role of the sender (for alert context). */
  senderRole: "landlord" | "tenant" | "referee" | "unknown";
  /**
   * How many times document validation has already failed in this session.
   * Triggers escalation if >= DOCUMENT_FAILURE_ESCALATION_THRESHOLD (3).
   */
  documentFailureCount?: number;
  /**
   * Set to true if the calling agent's Claude response included a low-confidence
   * signal (e.g. "I'm not sure", "you should speak to a professional").
   */
  agentUncertain?: boolean;
}

/** Result of checkEscalation — never throws. */
export interface EscalationResult {
  shouldEscalate: boolean;
  /** null when shouldEscalate is false. */
  triggerType: EscalationTrigger | null;
  priority: "urgent" | "high" | "normal";
  /** Human-readable reason — useful for logging and alert context. */
  reason: string;
}

/** Full context required to create and dispatch an escalation. */
export interface ExecuteEscalationParams {
  /** Raw text of the triggering message — stored for human agent context. */
  messageText: string;
  /** The trigger that caused the escalation. */
  triggerType: EscalationTrigger;
  priority: "urgent" | "high" | "normal";
  /** Brief summary (1–2 sentences) describing why escalation was triggered. */
  context: string;
  senderPhone: string;
  sessionId?: string;
  tenancyId?: string;
  landlordId?: string;
}

// ─── Priority Table ─────────────────────────────────────────────────────────

/**
 * Maps EscalationTrigger values to the three-tier priority system.
 * Drives both the WhatsApp alert path and the dashboard sort order.
 */
const TRIGGER_PRIORITY: Record<EscalationTrigger, "urgent" | "high" | "normal"> = {
  safeguarding_concern:    "urgent",
  mental_health_crisis:    "urgent",
  immigration_enforcement: "urgent",
  legal_threat:            "high",
  fraud_indicator:         "high",
  complaint:               "high",
  explicit_human_request:  "high",
  no_right_to_rent:        "high",
  emergency_maintenance:   "high",
  rent_arrears_severe:     "high",
  ai_uncertainty:          "normal",
};

/** Document validation failures at or above this count trigger escalation. */
const DOCUMENT_FAILURE_ESCALATION_THRESHOLD = 3;

/**
 * Claude response phrases that indicate agent uncertainty.
 * The calling agent can either pass `agentUncertain: true` via context,
 * or the text can be scanned for these phrases by passing the Claude
 * response body as the `message` argument to checkEscalation.
 */
const AGENT_UNCERTAINTY_PHRASES = [
  /\bi(?:'m|\s+am)\s+not\s+(?:sure|certain|confident)\b/i,
  /\byou\s+(?:should|must|need\s+to)\s+speak\s+(?:to|with)\s+(?:a|an)?\s*(?:qualified|professional|specialist|solicitor|accountant|adviser|advisor)\b/i,
  /\bI\s+(?:can't|cannot|am\s+unable\s+to)\s+(?:advise|help|assist|answer)\s+(?:on|with|about)\s+(?:this|that)\b/i,
  /\bthis\s+(?:is|goes)\s+beyond\s+(?:my|the\s+scope\s+of)\b/i,
  /\bplease\s+(?:consult|seek|contact)\s+(?:a|an|your)?\s*(?:legal|professional|qualified|tax)\b/i,
];

// ─── 1. checkEscalation ────────────────────────────────────────────────────

/**
 * Scans a message string for escalation trigger patterns.
 * Pure function — no I/O, no side effects.
 *
 * Priority resolution: first matched pattern wins (patterns are ordered
 * highest-priority first in ESCALATION_TRIGGER_PATTERNS).
 *
 * @param message - Raw message text from the user (or Claude response body
 *                  when checking for agent uncertainty).
 * @param context - Optional session context for non-text triggers
 *                  (document failure count, agent uncertainty flag).
 */
export function checkEscalation(
  message: string,
  context?: SessionContext,
): EscalationResult {
  const noEscalation: EscalationResult = {
    shouldEscalate: false,
    triggerType: null,
    priority: "normal",
    reason: "",
  };

  // ── 1a. Scan ESCALATION_TRIGGER_PATTERNS (from constants.ts) ─────────────
  for (const entry of ESCALATION_TRIGGER_PATTERNS) {
    if (entry.pattern.test(message)) {
      const priority = urgencyToPriority(entry.urgency);
      return {
        shouldEscalate: true,
        triggerType: entry.trigger,
        priority,
        reason: entry.reason,
      };
    }
  }

  // ── 1b. Check for agent uncertainty phrases in the message ────────────────
  for (const pattern of AGENT_UNCERTAINTY_PHRASES) {
    if (pattern.test(message)) {
      return {
        shouldEscalate: true,
        triggerType: "ai_uncertainty",
        priority: "normal",
        reason: "Agent response indicated uncertainty or suggested professional advice",
      };
    }
  }

  // ── 1c. Context-based checks ──────────────────────────────────────────────
  if (context?.agentUncertain) {
    return {
      shouldEscalate: true,
      triggerType: "ai_uncertainty",
      priority: "normal",
      reason: "Agent flagged low confidence in its response",
    };
  }

  if (
    context?.documentFailureCount !== undefined &&
    context.documentFailureCount >= DOCUMENT_FAILURE_ESCALATION_THRESHOLD
  ) {
    return {
      shouldEscalate: true,
      triggerType: "ai_uncertainty",
      priority: "normal",
      reason: `Document validation failed ${context.documentFailureCount} times — human review required`,
    };
  }

  return noEscalation;
}

// ─── 2. executeEscalation ──────────────────────────────────────────────────

/**
 * Executes the full escalation sequence:
 *   1. Sends a reassuring "connecting you with a human" message to the user.
 *   2. Creates an escalation record in the escalations table.
 *   3. Writes active_escalation_id to coordinator_state to halt agent processing.
 *   4. Sends a WhatsApp alert to the human handler (priority-dependent routing).
 *
 * @returns The UUID of the created escalation record.
 */
export async function executeEscalation(
  params: ExecuteEscalationParams,
): Promise<string> {
  const {
    messageText,
    triggerType,
    priority,
    context,
    senderPhone,
    sessionId,
    tenancyId,
    landlordId,
  } = params;

  const now = new Date().toISOString();

  // ── Step 1: Immediately reassure the user ─────────────────────────────────
  await sendTextMessage(
    senderPhone,
    "I'm connecting you with a member of our team who can help with this. " +
      "They'll reply in this same WhatsApp chat shortly.",
  ).catch((err) =>
    console.error("[escalation] Failed to send user reassurance message:", err),
  );

  // ── Step 2: Create the escalation record ─────────────────────────────────
  const { data: escalation, error: insertError } = await supabase
    .from("escalations")
    .insert({
      session_id:   sessionId  ?? null,
      tenancy_id:   tenancyId  ?? null,
      landlord_id:  landlordId ?? null,
      sender_phone: senderPhone,
      trigger_type: triggerType,
      priority,
      status:       "open",
      context,
      message_text: messageText,
      handler_notified: false,
      created_at:   now,
      updated_at:   now,
    })
    .select("id")
    .single();

  if (insertError || !escalation) {
    console.error("[escalation] Failed to create escalation record:", insertError?.message);
    // Don't throw — the user message was already sent. Log and continue.
    return "unknown";
  }

  const escalationId: string = escalation.id;

  // ── Step 3: Halt agent processing for this session ────────────────────────
  // The coordinator reads active_escalation_id before routing each message.
  // While it is set, all messages receive the "hold tight" reply.
  if (sessionId) {
    await supabase
      .from("coordinator_state")
      .upsert(
        {
          // coordinator_state is keyed by landlord_id; session→landlord lookup
          // is not done here to keep this function self-contained. The coordinator
          // also sets active_escalation_id directly after calling this function.
          active_escalation_id: escalationId,
          updated_at: now,
        },
        // Use session_id as the conflict key if a session-keyed variant exists,
        // otherwise the coordinator sets this after the call.
      )
      .match({ session_id: sessionId })
      .catch((err) =>
        console.error("[escalation] Failed to set active_escalation_id on session:", err),
      );
  }

  // ── Step 4: Alert the human handler ──────────────────────────────────────
  const handlerNotified = await alertHandler(escalationId, params, now);

  if (handlerNotified) {
    await supabase
      .from("escalations")
      .update({ handler_notified: true, handler_notified_at: new Date().toISOString() })
      .eq("id", escalationId);
  }

  console.log(
    `[escalation] Created escalation ${escalationId} ` +
      `(${priority} / ${triggerType}) for ${senderPhone}`,
  );

  return escalationId;
}

// ─── 3. resolveEscalation ──────────────────────────────────────────────────

/**
 * Marks an escalation as resolved and clears the session halt flag.
 * Called from the escalation-dashboard PATCH endpoint or directly by a
 * human agent responding via the dashboard.
 *
 * @param escalationId - UUID of the escalation to resolve.
 * @param resolution   - Summary of how the issue was resolved (stored for
 *                       prompt improvement and audit).
 * @param resolvedBy   - Identifier of the human who resolved it (name or email).
 */
export async function resolveEscalation(
  escalationId: string,
  resolution: string,
  resolvedBy?: string,
): Promise<void> {
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("escalations")
    .update({
      status:      "resolved",
      resolution,
      resolved_by: resolvedBy ?? "unknown",
      resolved_at: now,
      updated_at:  now,
    })
    .eq("id", escalationId);

  if (error) {
    throw new Error(`Failed to resolve escalation ${escalationId}: ${error.message}`);
  }

  // Clear the halt flag from coordinator_state — find by active_escalation_id.
  await supabase
    .from("coordinator_state")
    .update({ active_escalation_id: null, updated_at: now })
    .eq("active_escalation_id", escalationId)
    .catch((err) =>
      console.error("[escalation] Failed to clear active_escalation_id:", err),
    );

  console.log(`[escalation] Resolved escalation ${escalationId} by ${resolvedBy ?? "unknown"}`);
}

// ─── 4. isSessionEscalated ─────────────────────────────────────────────────

/**
 * Returns true if the session has an open (non-resolved) escalation.
 * Called by the coordinator before routing each message.
 *
 * Fast path: checks the coordinator_state.active_escalation_id column first.
 * Falls back to a direct escalations table query if the state row is missing.
 */
export async function isSessionEscalated(sessionId: string): Promise<boolean> {
  // Fast path via coordinator_state.
  const { data: stateRow } = await supabase
    .from("coordinator_state")
    .select("active_escalation_id")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (stateRow?.active_escalation_id) return true;

  // Fallback: direct query on escalations table.
  const { data: openEscalation } = await supabase
    .from("escalations")
    .select("id")
    .eq("session_id", sessionId)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  return !!openEscalation;
}

// ─── 5. checkAndEscalate ──────────────────────────────────────────────────

/**
 * Convenience wrapper: runs checkEscalation and, if triggered, calls
 * executeEscalation with the appropriate parameters.
 *
 * Returns true if escalation was triggered (caller should halt processing).
 * Returns false if no escalation — caller proceeds normally.
 *
 * Usage in agents:
 * ```typescript
 * if (await checkAndEscalate(messageText, context, params)) return;
 * // ... normal processing ...
 * ```
 */
export async function checkAndEscalate(
  message: string,
  context: SessionContext,
  extra: { messageText?: string; propertyAddress?: string } = {},
): Promise<boolean> {
  const result = checkEscalation(message, context);
  if (!result.shouldEscalate || !result.triggerType) return false;

  await executeEscalation({
    messageText:  extra.messageText ?? message,
    triggerType:  result.triggerType,
    priority:     result.priority,
    context:      result.reason,
    senderPhone:  context.senderPhone,
    sessionId:    context.sessionId,
    tenancyId:    context.tenancyId,
    landlordId:   context.landlordId,
  });

  return true;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function urgencyToPriority(
  urgency: "immediate" | "within_2hrs" | "same_day",
): "urgent" | "high" | "normal" {
  switch (urgency) {
    case "immediate":   return "urgent";
    case "within_2hrs": return "high";
    case "same_day":    return "normal";
  }
}

/**
 * Sends the WhatsApp alert to the correct human handler number based on priority.
 * Returns true if the message was sent without error.
 */
async function alertHandler(
  escalationId: string,
  params: ExecuteEscalationParams,
  _createdAt: string,
): Promise<boolean> {
  const urgentPhone  = Deno.env.get("ESCALATION_URGENT_PHONE");
  const highPhone    = Deno.env.get("ESCALATION_HIGH_PHONE") ?? urgentPhone;
  const dashboardUrl = Deno.env.get("ESCALATION_DASHBOARD_URL") ?? "https://app.complilet.co.uk/escalations";

  const handlerPhone =
    params.priority === "urgent" ? urgentPhone :
    params.priority === "high"   ? highPhone :
    null; // Normal priority: queued only, no WhatsApp push

  if (!handlerPhone) {
    // Normal priority or no handler phone configured — already in the queue.
    if (params.priority === "normal") {
      console.log(`[escalation] ${escalationId} queued (normal priority — no push alert).`);
    } else {
      console.warn(
        `[escalation] No handler phone configured for priority "${params.priority}". ` +
          "Set ESCALATION_URGENT_PHONE / ESCALATION_HIGH_PHONE env vars.",
      );
    }
    return false;
  }

  const priorityLabel =
    params.priority === "urgent" ? "URGENT" :
    params.priority === "high"   ? "HIGH PRIORITY" :
    "NORMAL";

  const triggerLabel = TRIGGER_LABELS[params.triggerType] ?? params.triggerType;

  const alertBody =
    `*[CompliLet ${priorityLabel}] ${triggerLabel}*\n\n` +
    `From: ${params.senderPhone}\n` +
    (params.sessionId  ? `Session: ${params.sessionId}\n`  : "") +
    (params.tenancyId  ? `Tenancy: ${params.tenancyId}\n`  : "") +
    (params.landlordId ? `Landlord: ${params.landlordId}\n` : "") +
    `\nMessage: "${truncate(params.messageText, 200)}"\n` +
    `\nReason: ${params.context}\n` +
    `\nView & resolve: ${dashboardUrl}/${escalationId}`;

  try {
    await sendTextMessage(handlerPhone, alertBody);
    console.log(
      `[escalation] Alert sent to handler (${handlerPhone}) for escalation ${escalationId}`,
    );
    return true;
  } catch (err) {
    console.error("[escalation] Failed to send handler alert:", err);
    return false;
  }
}

/** Human-readable trigger label for alert messages. */
const TRIGGER_LABELS: Partial<Record<EscalationTrigger, string>> = {
  safeguarding_concern:    "Safeguarding Concern",
  mental_health_crisis:    "Mental Health Crisis",
  immigration_enforcement: "Immigration Enforcement",
  legal_threat:            "Legal Threat",
  fraud_indicator:         "Fraud Indicator",
  complaint:               "Formal Complaint",
  explicit_human_request:  "Human Agent Requested",
  no_right_to_rent:        "No Right to Rent",
  emergency_maintenance:   "Emergency Maintenance",
  rent_arrears_severe:     "Severe Rent Arrears",
  ai_uncertainty:          "Agent Uncertainty",
};

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

// Re-export the priority map for use by the dashboard and other consumers.
export { TRIGGER_PRIORITY };
