/**
 * CompliLet — Coordinator Module
 *
 * Pure routing logic: NO Claude calls, NO LLM inference.
 *
 * The coordinator is the first stop after the webhook handler resolves the
 * sender. It determines which specialist agent should handle the current
 * message and either calls that agent directly (for shared modules) or
 * invokes it as a separate Edge Function via supabase.functions.invoke().
 *
 * Routing priority (evaluated in order):
 *   1. Landlord global commands (STATUS, CANCEL, HELP, SETTINGS, SCREEN, PRICING)
 *      — handled at any session stage, bypassing routing.
 *   2. Handoff signal — if the caller passes a pendingHandoff, the coordinator
 *      updates session.status and routes to the new stage.
 *   3. Session-status routing — the session's current status determines which
 *      specialist handles the message.
 *   4. Active-tenancy sub-routing — keyword analysis to choose between rent,
 *      maintenance, compliance, and inspection agents.
 */

import { supabase } from "./supabase.ts";
import { sendTextMessage } from "./whatsapp.ts";
import {
  SESSION_STATUS,
  SESSION_STATUS_TRANSITIONS,
  SESSION_STATUS_LABEL,
} from "./constants.ts";
import type {
  ParsedMessage,
  SessionStatus,
} from "./types.ts";
import { runPreQualifier } from "./agents/pre-qualifier.ts";
import { runDocCollector } from "./agents/doc-collector.ts";
import { runRightToRent } from "./agents/right-to-rent.ts";
import { runReferenceChaser } from "./agents/reference-chaser.ts";
import { runMoveInPack } from "./agents/move-in-pack.ts";
import { runComplianceAutopilot } from "./agents/compliance-autopilot.ts";
import { runRentMonitor } from "./agents/rent-monitor.ts";
import { runMaintenanceAgent } from "./agents/maintenance-agent.ts";
import { runInspectionAgent } from "./agents/inspection-agent.ts";
import { runRenewalAgent } from "./agents/renewal-agent.ts";
import { runNrlTaxAgent, detectOverseasLandlord } from "./agents/nrl-tax-agent.ts";
import {
  checkEscalation,
  executeEscalation,
  isSessionEscalated,
} from "./escalation.ts";
import {
  checkBillingAllowed,
  consumePaymentCredit,
  createSubscriptionCheckout,
  recordScreeningUsage,
} from "./billing.ts";
import {
  LANDLORD_PLAN,
  type LandlordPlan,
} from "./constants.ts";

// ─── Public interface ──────────────────────────────────────────────────────

export interface CoordinatorInput {
  message: ParsedMessage;
  /** Role resolved by the webhook handler */
  senderRole: "landlord" | "tenant" | "referee" | "unknown";
  /** Landlord row id (uuid) — required for landlord role */
  landlordId?: string;
  /** Active screening session id — required for tenant role */
  sessionId?: string;
  /** Reference request id — required for referee role */
  referenceRequestId?: string;
  /** Supabase Storage path if media was uploaded */
  mediaStorageUrl?: string;
  /** WhatsApp display name — used in personalised messages */
  contactName?: string;
  /**
   * If an agent completed its work and the session should advance,
   * it returns `{ handoff: newStatus }` and the caller passes it here
   * so the coordinator can update state before routing to the next stage.
   */
  pendingHandoff?: SessionStatus;
}

/**
 * Main entry point. Called by the webhook handler (and recursively by agents
 * signalling a handoff). Never throws — all errors are caught and a fallback
 * WhatsApp message is sent to the user.
 */
export async function runCoordinator(input: CoordinatorInput): Promise<void> {
  try {
    await _route(input);
  } catch (err) {
    console.error("Coordinator error:", err);
    const phone = input.message.from;
    await sendTextMessage(
      phone,
      "Sorry, something went wrong on my end. Please try again in a moment, " +
        "or type *HELP* to see what I can do.",
    ).catch(() => {});
  }
}

// ─── Internal routing ──────────────────────────────────────────────────────

async function _route(input: CoordinatorInput): Promise<void> {
  const { message, senderRole } = input;
  const phone = message.from;
  const text = (message.text ?? message.interactive?.title ?? "").trim();

  // ── 1. Handle pending handoff from an agent ────────────────────────────
  if (input.pendingHandoff && input.sessionId) {
    await advanceSession(input.sessionId, input.pendingHandoff);
    // Re-route with the updated status — no text needed, just trigger the new stage
    await _routeBySessionStatus(
      { ...input, pendingHandoff: undefined },
      input.pendingHandoff,
      phone,
    );
    return;
  }

  // ── 2. Landlord global commands ───────────────────────────────────────
  if (senderRole === "landlord" && input.landlordId) {
    // Detect overseas landlords by phone prefix (non-+44 / not starting with 44).
    // Fire-and-forget — idempotent, does nothing if detection already ran.
    if (!phone.startsWith("44")) {
      detectOverseasLandlord(input.landlordId, phone).catch((err) =>
        console.error("[coordinator] detectOverseasLandlord error:", err),
      );
    }

    const command = normaliseCommand(text);
    if (command) {
      await handleLandlordCommand(command, input);
      return;
    }
  }

  // ── 3. Referee path ───────────────────────────────────────────────────
  if (senderRole === "referee" && input.referenceRequestId) {
    await runReferenceChaser({
      message: input.message,
      sessionId: input.sessionId ?? (await getSessionForReference(input.referenceRequestId)),
      landlordId: input.landlordId ?? "",
      senderRole: "referee",
      referenceId: input.referenceRequestId,
      onHandoff: async (nextStatus, _data) => {
        await runCoordinator({ ...input, pendingHandoff: nextStatus });
      },
    });
    return;
  }

  // ── 4. Look up (or create) the active session ─────────────────────────
  const session = await resolveSession(input);
  if (!session) {
    // No session, no command — prompt the landlord to start a screening.
    await sendTextMessage(
      phone,
      "You don't have an active screening running.\n\n" +
        "Type *SCREEN* to start screening a new tenant, or *HELP* for a list of commands.",
    );
    return;
  }

  // ── 5. Halt routing if session has an open escalation ────────────────
  // A human agent has been assigned. Keep processing paused until they resolve it.
  if (input.sessionId && await isSessionEscalated(input.sessionId)) {
    await sendTextMessage(
      phone,
      "Your query has been passed to a member of our team and they are looking into it. " +
        "Please hold tight — they will reply in this same chat shortly.",
    );
    return;
  }

  // ── 6. Scan message for escalation triggers before routing ────────────
  // Catches safeguarding, legal threats, crisis signals, and explicit human
  // requests regardless of which agent would otherwise handle the message.
  if (text) {
    const escResult = checkEscalation(text, {
      sessionId:   input.sessionId,
      landlordId:  input.landlordId,
      senderPhone: phone,
      senderRole:  input.senderRole as "landlord" | "tenant" | "referee" | "unknown",
    });

    if (escResult.shouldEscalate && escResult.triggerType) {
      const escalationId = await executeEscalation({
        messageText:  text,
        triggerType:  escResult.triggerType,
        priority:     escResult.priority,
        context:      escResult.reason,
        senderPhone:  phone,
        sessionId:    input.sessionId,
        landlordId:   input.landlordId,
      });

      // Write the halt flag directly on coordinator_state so the fast-path
      // check in isSessionEscalated() resolves it on the next message.
      if (input.landlordId) {
        await supabase
          .from("coordinator_state")
          .upsert(
            {
              landlord_id:          input.landlordId,
              active_escalation_id: escalationId,
              updated_at:           new Date().toISOString(),
            },
            { onConflict: "landlord_id" },
          )
          .catch((e: unknown) =>
            console.error("[coordinator] Failed to write active_escalation_id:", e),
          );
      }
      return;
    }
  }

  // ── 7. Route based on session status ─────────────────────────────────
  await _routeBySessionStatus(input, session.status as SessionStatus, phone);
}

async function _routeBySessionStatus(
  input: CoordinatorInput,
  status: SessionStatus,
  phone: string,
): Promise<void> {
  switch (status) {
    // ── Onboarding: no session yet, landlord setup ──
    case "pre_qualifying":
      // Pre-qualifying is a tenant-facing stage.
      // If the landlord somehow messages during this stage, give a status update.
      if (input.senderRole === "landlord") {
        await sendStatusSummary(input);
        return;
      }
      // Tenant message → Pre-Qualifier agent (shared module).
      await runPreQualifier({
        message: input.message,
        sessionId: input.sessionId!,
        landlordId: input.landlordId ?? (await getLandlordForSession(input.sessionId!)),
        mediaStorageUrl: input.mediaStorageUrl,
        onHandoff: async (nextStatus, _data) => {
          await runCoordinator({
            ...input,
            pendingHandoff: nextStatus,
          });
        },
      });
      break;

    case "collecting_docs":
      if (input.senderRole === "landlord") {
        await sendStatusSummary(input);
        return;
      }
      // Tenant message → Doc Collector agent (shared module).
      await runDocCollector({
        message: input.message,
        sessionId: input.sessionId!,
        landlordId: input.landlordId ?? (await getLandlordForSession(input.sessionId!)),
        mediaStoragePath: input.mediaStorageUrl,
        onHandoff: async (nextStatus, _data) => {
          await runCoordinator({
            ...input,
            pendingHandoff: nextStatus,
          });
        },
      });
      break;

    case "right_to_rent":
      if (input.senderRole === "landlord") {
        await sendStatusSummary(input);
        return;
      }
      // Tenant message → Right to Rent agent (shared module).
      await runRightToRent({
        message: input.message,
        sessionId: input.sessionId!,
        landlordId: input.landlordId ?? (await getLandlordForSession(input.sessionId!)),
        mediaStoragePath: input.mediaStorageUrl,
        onHandoff: async (nextStatus, _data) => {
          await runCoordinator({ ...input, pendingHandoff: nextStatus });
        },
        onEscalate: async (trigger, context) => {
          await invokeEdgeFunction("escalation-handler", {
            trigger,
            context,
            sessionId: input.sessionId,
            senderPhone: input.message.from,
          });
        },
      });
      break;

    case "chasing_refs":
      // The reference-chaser proactively contacts referees, but the landlord
      // might also message during this stage asking for an update.
      if (input.senderRole === "landlord") {
        await sendStatusSummary(input);
        return;
      }
      await runReferenceChaser({
        message: input.message,
        sessionId: input.sessionId!,
        landlordId: input.landlordId ?? (await getLandlordForSession(input.sessionId!)),
        senderRole: "tenant",
        onHandoff: async (nextStatus, _data) => {
          await runCoordinator({ ...input, pendingHandoff: nextStatus });
        },
      });
      break;

    case "decision": {
      // Landlord reviews the screening report and sends YES or NO.
      if (input.senderRole !== "landlord") {
        await sendTextMessage(
          phone,
          "Your application is being reviewed by the landlord. " +
            "We'll be in touch as soon as a decision is made.",
        );
        return;
      }
      const decisionText = (input.message.text ?? "").toUpperCase().trim();
      if (decisionText === "YES" || decisionText === "APPROVE" || decisionText === "ACCEPT") {
        // Pass pendingHandoff — advanceSession is handled inside _route() so we
        // don't advance here first (that would cause a double-advance error).
        await runCoordinator({
          ...input,
          pendingHandoff: SESSION_STATUS.MOVE_IN_PACK,
        });
      } else if (decisionText === "NO" || decisionText === "REJECT" || decisionText === "DECLINE") {
        await advanceSession(input.sessionId!, SESSION_STATUS.REJECTED);
        await invokeEdgeFunction("decision-handler", { ...input, decision: "rejected" });
      } else {
        // Prompt for a clear yes/no.
        await sendTextMessage(
          phone,
          "Please reply *YES* to approve this tenant or *NO* to decline.\n\n" +
            "Type *STATUS* to review the screening report again.",
        );
      }
      break;
    }

    case "move_in_pack":
      await runMoveInPack({
        message: input.message,
        sessionId: input.sessionId!,
        landlordId: input.landlordId ?? (await getLandlordForSession(input.sessionId!)),
        onHandoff: async (nextStatus, _data) => {
          await runCoordinator({ ...input, pendingHandoff: nextStatus });
        },
      });
      break;

    case "active_tenancy":
      await routeActiveTenancy(input, phone);
      break;

    case "renewal":
      await runRenewalAgent({
        message: input.message,
        sessionId: input.sessionId,
        landlordId: input.landlordId,
        senderRole: input.senderRole,
      });
      break;

    case "abandoned":
    case "rejected": {
      const label = status === "abandoned" ? "ended" : "closed";
      await sendTextMessage(
        phone,
        `This screening has been ${label}. ` +
          "Type *SCREEN* to start a new screening, or *HELP* for more options.",
      );
      break;
    }

    default:
      await sendTextMessage(
        phone,
        "I'm not sure what to do at this stage. Type *HELP* for a list of commands.",
      );
  }
}

// ─── Active tenancy sub-routing ────────────────────────────────────────────

async function routeActiveTenancy(
  input: CoordinatorInput,
  phone: string,
): Promise<void> {
  const text = (input.message.text ?? "").toLowerCase();
  const landlordId = input.landlordId ?? "";

  // ── Check for active inspection (tenant-side) ────────────────────────
  // Route to inspection agent if the tenant has an open inspection
  // (awaiting_photos / partial). Photos and "done" replies go here even
  // without an inspection keyword in the message.
  if (input.sessionId) {
    const { data: openInspection } = await supabase
      .from("inspections")
      .select("id, status")
      .eq("tenant_phone", phone)
      .in("status", ["awaiting_photos", "partial"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (openInspection) {
      await runInspectionAgent({
        message: input.message,
        sessionId: input.sessionId,
        mediaStorageUrl: input.mediaStorageUrl,
      });
      return;
    }
  }

  // ── Check for open maintenance ticket (tenant-side) ──────────────────
  // Route to maintenance agent if the tenant has an active ticket
  // (drafting / self_fix / open / in_progress), even if the message
  // doesn't contain a maintenance keyword — it could be a status reply.
  if (input.sessionId) {
    const { data: openTicket } = await supabase
      .from("maintenance_tickets")
      .select("id, status")
      .eq("tenant_phone", phone)
      .in("status", ["drafting", "self_fix", "open", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (openTicket) {
      await runMaintenanceAgent({
        message: input.message,
        sessionId: input.sessionId,
        mediaStorageUrl: input.mediaStorageUrl,
      });
      return;
    }
  }

  // ── Check for pending NRL conversation state ────────────────────────
  // Routes overseas-landlord confirmation and NRL1 flows, plus NRL keyword queries.
  if (landlordId) {
    const { data: nrlCoordState } = await supabase
      .from("coordinator_state")
      .select("nrl_state")
      .eq("landlord_id", landlordId)
      .maybeSingle();

    const nrlStep = (nrlCoordState?.nrl_state as { step?: string } | null)?.step;
    const hasPendingNrlStep =
      nrlStep && nrlStep !== "idle" && nrlStep !== "active";
    const isNrlKeyword =
      /\b(nrl|non.?resident|overseas.?landlord|withholding.?tax|hmrc.*nrl|self.?assessment|sa100|sa105|nrl1)\b/i.test(
        text,
      );

    if (hasPendingNrlStep || isNrlKeyword) {
      await runNrlTaxAgent({
        message: input.message,
        landlordId,
        landlordPhone: phone,
      });
      return;
    }
  }

  // ── Check for pending compliance conversation state first ────────────
  // This handles replies to compliance reminders (dates, certs, "find engineer")
  // even when the message doesn't contain a compliance keyword.
  if (landlordId) {
    const { data: coordState } = await supabase
      .from("coordinator_state")
      .select("compliance_state")
      .eq("landlord_id", landlordId)
      .maybeSingle();

    const complianceStep = (coordState?.compliance_state as { step?: string } | null)?.step;
    const hasPendingComplianceStep = complianceStep && complianceStep !== "idle";

    // Route to compliance agent if we're mid-conversation OR message matches keywords.
    const isComplianceKeyword = /\b(gas\s+safety|eicr|epc|electrical|certificate|cert|smoke\s+alarm|co\s+alarm|deposit|compliance|find\s+engineer|find\s+electrician|find\s+plumber|legionella|insurance)\b/.test(text);

    if (hasPendingComplianceStep || isComplianceKeyword) {
      await runComplianceAutopilot({
        message: input.message,
        landlordId,
        mediaStorageUrl: input.mediaStorageUrl,
      });
      return;
    }

    // Route media uploads mid-compliance conversation.
    if (input.mediaStorageUrl && hasPendingComplianceStep) {
      await runComplianceAutopilot({
        message: input.message,
        landlordId,
        mediaStorageUrl: input.mediaStorageUrl,
      });
      return;
    }
  }

  // ── Keyword-based sub-routing — order matters (most specific first) ──
  if (/\b(gas leak|burst pipe|no heating|flood|fire|emergency|urgent repair|electr.{0,10}fault)\b/.test(text)) {
    await runMaintenanceAgent({
      message: input.message,
      sessionId: input.sessionId,
      landlordId: input.landlordId,
      mediaStorageUrl: input.mediaStorageUrl,
      isEmergency: true,
    });
    return;
  }
  if (/\b(rent|payment|paid|arrear|overdue|late\s+payment|missed\s+payment|confirmed|transferred|sorted)\b/.test(text)) {
    await runRentMonitor({
      senderRole: input.senderRole as "landlord" | "tenant",
      senderPhone: phone,
      messageText: text,
      landlordId: input.landlordId,
      sessionId: input.sessionId,
    });
    return;
  }
  if (/\b(repair|maintenance|broken|leak|damp|mould|mold|boiler|heating|plumbing|pest|rodent|window|door)\b/.test(text)) {
    await runMaintenanceAgent({
      message: input.message,
      sessionId: input.sessionId,
      landlordId: input.landlordId,
      mediaStorageUrl: input.mediaStorageUrl,
    });
    return;
  }
  if (/\b(inspect|inspection|photo|condition|report|quarterly)\b/.test(text)) {
    await runInspectionAgent({
      message: input.message,
      sessionId: input.sessionId,
      landlordId: input.landlordId,
      mediaStorageUrl: input.mediaStorageUrl,
    });
    return;
  }
  if (/\b(renew|renewal|extend|end\s+of\s+tenancy|moving\s+out|leave|section\s+21|evict)\b/.test(text)) {
    await runRenewalAgent({
      message: input.message,
      sessionId: input.sessionId,
      landlordId: input.landlordId,
      senderRole: input.senderRole,
    });
    return;
  }

  // Default: coordinator handles general active-tenancy queries by prompting the landlord.
  await sendTextMessage(
    phone,
    "I'm here to help with your tenancy. You can ask about:\n\n" +
      "• *RENT* — rent payments and arrears\n" +
      "• *MAINTENANCE* — report a repair\n" +
      "• *INSPECTION* — schedule or submit photos\n" +
      "• *COMPLIANCE* — certificates and deadlines\n" +
      "• *RENEWAL* — lease renewal\n" +
      "• *STATUS* — tenancy overview\n" +
      "• *HELP* — all commands",
  );
}

// ─── Landlord command handlers ─────────────────────────────────────────────

type LandlordCommand = "STATUS" | "CANCEL" | "HELP" | "SETTINGS" | "SCREEN" | "PRICING" | "SUBSCRIBE";

function normaliseCommand(text: string): LandlordCommand | null {
  const upper = text.toUpperCase().replace(/[^A-Z]/g, "");
  const map: Record<string, LandlordCommand> = {
    STATUS:          "STATUS",
    CANCEL:          "CANCEL",
    CANCELSCREENING: "CANCEL",
    HELP:            "HELP",
    SETTINGS:        "SETTINGS",
    CRITERIA:        "SETTINGS",
    SCREEN:          "SCREEN",
    SCREENING:       "SCREEN",
    PRICING:         "PRICING",
    PRICE:           "PRICING",
    PLANS:           "PRICING",
  };
  // Exact-match first
  if (map[upper]) return map[upper];
  // SUBSCRIBE prefix — matches "SUBSCRIBE LANDLORDPRO", "SUBSCRIBEPORTFOLIO", etc.
  if (upper.startsWith("SUBSCRIBE")) return "SUBSCRIBE";
  return null;
}

async function handleLandlordCommand(
  command: LandlordCommand,
  input: CoordinatorInput,
): Promise<void> {
  const phone = input.message.from;

  switch (command) {
    case "STATUS":
      await sendStatusSummary(input);
      break;

    case "CANCEL":
      await handleCancelCommand(input);
      break;

    case "HELP":
      await sendTextMessage(
        phone,
        "*CompliLet — Available Commands*\n\n" +
          "📋 *SCREEN* — Start screening a new tenant\n" +
          "📊 *STATUS* — View current screening progress\n" +
          "❌ *CANCEL* — Cancel the current screening\n" +
          "⚙️ *SETTINGS* — Update your screening criteria\n" +
          "💰 *PRICING* — View plan details and pricing\n" +
          "❓ *HELP* — Show this message\n\n" +
          "During an active tenancy you can also type:\n" +
          "*RENT* · *MAINTENANCE* · *INSPECTION* · *COMPLIANCE* · *RENEWAL*",
      );
      break;

    case "SETTINGS":
      await invokeEdgeFunction("settings-handler", input);
      break;

    case "SCREEN":
      await handleScreenCommand(input);
      break;

    case "PRICING":
      await handlePricingCommand(input);
      break;

    case "SUBSCRIBE":
      await handleSubscribeCommand(input);
      break;
  }
}

// ─── Status summary ────────────────────────────────────────────────────────

async function sendStatusSummary(input: CoordinatorInput): Promise<void> {
  const phone = input.message.from;

  if (!input.sessionId) {
    await sendTextMessage(
      phone,
      "You don't have an active screening. Type *SCREEN* to start one.",
    );
    return;
  }

  const { data: session, error } = await supabase
    .from("screening_sessions")
    .select(
      "status, tenant_phone, property_address, monthly_rent_gbp, created_at, updated_at",
    )
    .eq("id", input.sessionId)
    .single();

  if (error || !session) {
    await sendTextMessage(phone, "Couldn't load session details. Please try again.");
    return;
  }

  const statusLabel =
    SESSION_STATUS_LABEL[session.status as SessionStatus] ?? session.status;
  const started = new Date(session.created_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  await sendTextMessage(
    phone,
    `*Screening Status*\n\n` +
      `🏠 Property: ${session.property_address ?? "Not set"}\n` +
      `📱 Tenant: ${session.tenant_phone ?? "Not yet contacted"}\n` +
      `💷 Rent: ${session.monthly_rent_gbp ? `£${session.monthly_rent_gbp}/mo` : "Not set"}\n` +
      `📋 Stage: *${statusLabel}*\n` +
      `📅 Started: ${started}\n\n` +
      "Type *CANCEL* to cancel this screening.",
  );
}

// ─── SUBSCRIBE command ────────────────────────────────────────────────────

const SUBSCRIBE_PLAN_MAP: Record<string, LandlordPlan> = {
  LANDLORDPRO:     LANDLORD_PLAN.LANDLORD_PRO,
  LANDLORDPROPRO:  LANDLORD_PLAN.LANDLORD_PRO,
  TENANCYMANAGER:  LANDLORD_PLAN.TENANCY_MANAGER,
  PORTFOLIO:       LANDLORD_PLAN.PORTFOLIO,
  GLOBALLANDLORD:  LANDLORD_PLAN.GLOBAL_LANDLORD,
};

async function handleSubscribeCommand(input: CoordinatorInput): Promise<void> {
  const phone = input.message.from;
  const raw = (input.message.text ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  // Strip leading SUBSCRIBE then match the rest
  const planKey = raw.replace(/^SUBSCRIBE/, "").trim();
  const plan = SUBSCRIBE_PLAN_MAP[planKey];

  if (!plan) {
    await sendTextMessage(
      phone,
      "Please specify a plan to subscribe to. For example:\n\n" +
        "• *SUBSCRIBE LANDLORD PRO* — £19.99/month\n" +
        "• *SUBSCRIBE TENANCY MANAGER* — £14.99/month per property\n" +
        "• *SUBSCRIBE PORTFOLIO* — £39.99/month\n" +
        "• *SUBSCRIBE GLOBAL LANDLORD* — £29.99/month per property\n\n" +
        "Or type *PRICING* to see full details.",
    );
    return;
  }

  const checkoutUrl = await createSubscriptionCheckout(input.landlordId!, phone, plan);

  await sendTextMessage(
    phone,
    "Complete your subscription here:\n\n" +
      `${checkoutUrl}\n\n` +
      "Once payment is confirmed I'll send you a confirmation and your account will be upgraded immediately.",
  );
}

// ─── PRICING command ──────────────────────────────────────────────────────

async function handlePricingCommand(input: CoordinatorInput): Promise<void> {
  const phone = input.message.from;

  // Fetch current plan so we can highlight what the landlord already has.
  const { data: landlord } = await supabase
    .from("landlords")
    .select("plan")
    .eq("id", input.landlordId!)
    .maybeSingle();
  const currentPlan = (landlord?.plan ?? LANDLORD_PLAN.FREE_TRIAL) as LandlordPlan;

  const isCurrent = (plan: LandlordPlan) => currentPlan === plan ? " ✓ (current)" : "";

  await sendTextMessage(
    phone,
    "*CompliLet Pricing*\n\n" +
      `💳 *Pay-Per-Screen* — £4.99 per screening${isCurrent(LANDLORD_PLAN.PAY_PER_SCREEN)}\n` +
      `🏠 *Landlord Pro* — £19.99/month · unlimited screenings${isCurrent(LANDLORD_PLAN.LANDLORD_PRO)}\n` +
      `🔑 *Tenancy Manager* — £14.99/month per property${isCurrent(LANDLORD_PLAN.TENANCY_MANAGER)}\n` +
      `🏢 *Portfolio* — £39.99/month · unlimited properties${isCurrent(LANDLORD_PLAN.PORTFOLIO)}\n` +
      `🌍 *Global Landlord* — £29.99/month per property${isCurrent(LANDLORD_PLAN.GLOBAL_LANDLORD)}\n\n` +
      "All plans include compliance tracking, rent reminders, " +
      "and tenancy management.\n\n" +
      "To subscribe, reply with the plan name:\n" +
      "*SUBSCRIBE LANDLORD PRO* · *SUBSCRIBE PORTFOLIO*\n" +
      "*SUBSCRIBE TENANCY MANAGER* · *SUBSCRIBE GLOBAL LANDLORD*\n\n" +
      "Or type *SCREEN* to pay £4.99 for a single screening.",
  );
}

// ─── SCREEN command: start new screening ──────────────────────────────────

async function handleScreenCommand(input: CoordinatorInput): Promise<void> {
  const phone = input.message.from;

  // Check if there's already an active session.
  const existingSession = await resolveSession(input);
  if (existingSession) {
    await sendTextMessage(
      phone,
      `You already have an active screening in progress (stage: *${SESSION_STATUS_LABEL[existingSession.status as SessionStatus]}*).\n\n` +
        "Type *STATUS* to check its progress, or *CANCEL* to cancel it before starting a new one.",
    );
    return;
  }

  // ── Billing gate ──────────────────────────────────────────────────────
  const billing = await checkBillingAllowed(input.landlordId!, phone);

  if (!billing.allowed) {
    // Store the pending checkout so we know what they were trying to do.
    await supabase.from("coordinator_state").upsert(
      {
        landlord_id: input.landlordId,
        awaiting:    "payment",
        updated_at:  new Date().toISOString(),
      },
      { onConflict: "landlord_id" },
    );

    const trialMsg = billing.plan === LANDLORD_PLAN.FREE_TRIAL
      ? "Your 3 free screenings are used up. "
      : "";

    await sendTextMessage(
      phone,
      `${trialMsg}To continue screening tenants, choose an option:\n\n` +
        `💳 *Pay £4.99* for this one screening:\n${billing.checkoutUrl}\n\n` +
        "Or subscribe for unlimited screenings:\n" +
        "• *Landlord Pro* £19.99/month — reply *SUBSCRIBE LANDLORD PRO*\n" +
        "• *Portfolio* £39.99/month — reply *SUBSCRIBE PORTFOLIO*\n\n" +
        "Type *PRICING* to see all plans.",
    );
    return;
  }

  // ── Usage accounting ──────────────────────────────────────────────────
  if (billing.plan === LANDLORD_PLAN.PAY_PER_SCREEN) {
    // Consume the pre-paid credit immediately so it can't be double-spent.
    await consumePaymentCredit(input.landlordId!);
  } else if (billing.isMetered && billing.subscriptionId) {
    // Report one screening unit to Stripe for metered plans.
    await recordScreeningUsage(input.landlordId!, billing.subscriptionId).catch(
      (e: unknown) => console.error("[coordinator] recordScreeningUsage error:", e),
    );
  }

  // ── Free trial remaining notice ───────────────────────────────────────
  if (billing.plan === LANDLORD_PLAN.FREE_TRIAL && (billing.freeRemaining ?? 0) <= 1) {
    await sendTextMessage(
      phone,
      "ℹ️ This is your last free screening. After this one, you'll need to pay or subscribe.\n" +
        "Type *PRICING* to see your options.",
    );
  }

  // ── Prompt for tenant details ─────────────────────────────────────────
  await sendTextMessage(
    phone,
    "Let's screen a new tenant! 🏠\n\n" +
      "Please send me the tenant's WhatsApp number (starting with the country code, e.g. *447700123456*) " +
      "and the full property address you're renting out.",
  );

  // The landlord's next message will be handled by the onboarding flow in the
  // next webhook call — set a flag so the coordinator knows to expect it.
  await supabase.from("coordinator_state").upsert(
    {
      landlord_id: input.landlordId,
      awaiting:    "new_screening_details",
      updated_at:  new Date().toISOString(),
    },
    { onConflict: "landlord_id" },
  );
}

// ─── CANCEL command ────────────────────────────────────────────────────────

async function handleCancelCommand(input: CoordinatorInput): Promise<void> {
  const phone = input.message.from;

  if (!input.sessionId) {
    await sendTextMessage(phone, "There's no active screening to cancel.");
    return;
  }

  const { error } = await supabase
    .from("screening_sessions")
    .update({ status: SESSION_STATUS.ABANDONED, abandoned_at: new Date().toISOString() })
    .eq("id", input.sessionId);

  if (error) {
    await sendTextMessage(phone, "Couldn't cancel the screening. Please try again.");
    return;
  }

  await sendTextMessage(
    phone,
    "✅ Screening cancelled.\n\nType *SCREEN* to start a new one, or *HELP* for other options.",
  );
}

// ─── Session resolution ────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  status: string;
  landlord_id: string;
}

async function resolveSession(
  input: CoordinatorInput,
): Promise<SessionRow | null> {
  if (input.sessionId) {
    const { data } = await supabase
      .from("screening_sessions")
      .select("id, status, landlord_id")
      .eq("id", input.sessionId)
      .single();
    return data ?? null;
  }

  if (input.landlordId) {
    // Find the most recent non-terminal session for this landlord.
    const terminal = [SESSION_STATUS.ABANDONED, SESSION_STATUS.REJECTED];
    const { data } = await supabase
      .from("screening_sessions")
      .select("id, status, landlord_id")
      .eq("landlord_id", input.landlordId)
      .not("status", "in", `(${terminal.map((s) => `"${s}"`).join(",")})`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ?? null;
  }

  return null;
}

async function getLandlordForSession(sessionId: string): Promise<string> {
  const { data } = await supabase
    .from("screening_sessions")
    .select("landlord_id")
    .eq("id", sessionId)
    .single();
  return data?.landlord_id ?? "";
}

async function getSessionForReference(referenceId: string): Promise<string> {
  const { data } = await supabase
    .from("reference_requests")
    .select("session_id")
    .eq("id", referenceId)
    .single();
  return data?.session_id ?? "";
}

// ─── Session state machine ─────────────────────────────────────────────────

async function advanceSession(
  sessionId: string,
  nextStatus: SessionStatus,
): Promise<void> {
  // Fetch current status to validate the transition.
  const { data: session, error: fetchError } = await supabase
    .from("screening_sessions")
    .select("status")
    .eq("id", sessionId)
    .single();

  if (fetchError || !session) {
    throw new Error(`Could not fetch session ${sessionId}: ${fetchError?.message}`);
  }

  const currentStatus = session.status as SessionStatus;
  const allowed = SESSION_STATUS_TRANSITIONS[currentStatus];

  if (!allowed.includes(nextStatus)) {
    throw new Error(
      `Invalid session transition: ${currentStatus} → ${nextStatus}. ` +
        `Allowed: ${allowed.join(", ") || "(none)"}`,
    );
  }

  const { error } = await supabase
    .from("screening_sessions")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to update session ${sessionId}: ${error.message}`);
  }
}

// ─── Edge Function invocation ──────────────────────────────────────────────

async function invokeEdgeFunction(
  functionName: string,
  context: unknown,
): Promise<void> {
  const { error } = await supabase.functions.invoke(functionName, {
    body: context,
  });
  if (error) {
    console.error(`Failed to invoke Edge Function "${functionName}":`, error.message);
    throw error;
  }
}
