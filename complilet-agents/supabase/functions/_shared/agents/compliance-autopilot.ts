/**
 * CompliLet — Compliance Autopilot Agent
 *
 * Handles inbound WhatsApp messages from landlords in response to compliance
 * reminders sent by the compliance-autopilot-cron Edge Function.
 *
 * Supported flows:
 *   1. Compliance dashboard — landlord types "COMPLIANCE" → list all deadlines
 *   2. Find contractor — "find engineer / plumber / electrician" → recommend vetted locals
 *   3. Date confirmation — landlord provides a renewal/completion date → update deadline
 *   4. Certificate upload — landlord sends photo/PDF → store in Storage, mark complete
 *   5. Contractor referral confirmation — landlord confirms they used a recommended contractor
 *
 * State is persisted in coordinator_state.compliance_state (JSONB) so the agent
 * can remember what it is waiting for across multiple WhatsApp turns.
 *
 * Database assumptions (add these columns to compliance_deadlines if not present):
 *   last_reminder_sent_at  TIMESTAMPTZ   — when the most recent reminder was sent
 *   last_reminder_threshold INTEGER       — the threshold (90/30/14/7/1/−1) last used
 *   certificate_storage_path TEXT         — Storage path of the uploaded certificate
 *
 * Contractor lookup assumes a `contractors` table:
 *   id UUID, name TEXT, trade TEXT, postcode_area TEXT,
 *   phone TEXT, rating NUMERIC(2,1), is_verified BOOLEAN
 *
 * Referral tracking assumes a `referral_transactions` table:
 *   id UUID, landlord_id UUID, contractor_id UUID, tenancy_id UUID,
 *   compliance_type TEXT, compliance_deadline_id UUID,
 *   referred_at TIMESTAMPTZ, confirmed_at TIMESTAMPTZ, created_at TIMESTAMPTZ
 */

import { supabase } from "../supabase.ts";
import { sendTextMessage } from "../whatsapp.ts";
import { COMPLIANCE_VALIDITY_DAYS } from "../constants.ts";
import type { ParsedMessage, ComplianceType } from "../types.ts";
import { presentContractorOptions } from "../contractor-flow.ts";

// ─── Public Interface ───────────────────────────────────────────────────────

export interface ComplianceAutopilotInput {
  message: ParsedMessage;
  landlordId: string;
  /** Resolved by coordinator from active tenancy if not passed directly */
  tenancyId?: string;
  /** Pre-uploaded Storage URL if landlord sent a document/image */
  mediaStorageUrl?: string;
}

export async function runComplianceAutopilot(
  input: ComplianceAutopilotInput,
): Promise<void> {
  const { message, landlordId, tenancyId: rawTenancyId, mediaStorageUrl } = input;
  const phone = message.from;
  const text = (message.text ?? message.interactive?.title ?? "").trim();
  const lower = text.toLowerCase();

  try {
    // ── 1. Resolve tenancy ───────────────────────────────────────────────
    const tenancyId = rawTenancyId ?? await resolveTenancy(landlordId);

    // ── 2. Load current conversation state ──────────────────────────────
    const state = await loadComplianceState(landlordId);

    // ── 3. Certificate upload handling (highest priority) ───────────────
    if (mediaStorageUrl && (
      state.step === "awaiting_certificate" ||
      state.step === "awaiting_confirmation"
    )) {
      if (state.deadlineId && state.complianceType) {
        await storeCertificate({
          deadlineId: state.deadlineId,
          complianceType: state.complianceType as ComplianceType,
          mediaStorageUrl,
          landlordId,
          tenancyId,
          phone,
        });
        await saveComplianceState(landlordId, { step: "idle" });
        return;
      }
    }

    // ── 4. "Find contractor" intent ──────────────────────────────────────
    const contractorIntent = detectContractorIntent(lower);
    if (contractorIntent) {
      const trade = contractorIntent !== "unknown"
        ? contractorIntent
        : (state.complianceType
          ? contractorTradeForType(state.complianceType as ComplianceType)
          : null);
      await findContractors({ landlordId, phone, trade, tenancyId, complianceType: state.complianceType as ComplianceType | undefined });
      return;
    }

    // ── 5. Awaiting contractor referral confirmation ──────────────────────
    if (state.step === "awaiting_contractor_confirm" && state.contractorReferralId) {
      if (/\b(yes|yeah|yep|confirmed?|used|called|booked|great)\b/.test(lower)) {
        await confirmContractorReferral(state.contractorReferralId, phone);
        await saveComplianceState(landlordId, { step: "idle" });
        return;
      }
      if (/\b(no|didn't|did\s+not|not\s+yet|haven't|cancel)\b/.test(lower)) {
        await sendTextMessage(phone, "No problem. Let me know if you need help finding a contractor, or reply with the new certificate date when you have it arranged.");
        await saveComplianceState(landlordId, { step: "idle" });
        return;
      }
    }

    // ── 6. Awaiting date confirmation ────────────────────────────────────
    if (state.step === "awaiting_confirmation" || state.step === "awaiting_certificate") {
      const parsedDate = parseDateFromText(text);
      if (parsedDate && state.deadlineId && state.complianceType) {
        await updateDeadlineAndAskForCert({
          deadlineId: state.deadlineId,
          complianceType: state.complianceType as ComplianceType,
          newDate: parsedDate,
          phone,
          landlordId,
        });
        await saveComplianceState(landlordId, {
          step: "awaiting_certificate",
          deadlineId: state.deadlineId,
          complianceType: state.complianceType,
          newDueDate: parsedDate.toISOString().split("T")[0],
        });
        return;
      }
    }

    // ── 7. Default: show compliance dashboard ────────────────────────────
    await showComplianceDashboard(landlordId, phone, tenancyId);

  } catch (err) {
    console.error("[compliance-autopilot] Error:", err);
    await sendTextMessage(
      phone,
      "Sorry, something went wrong checking your compliance. Please try again or type *HELP*.",
    ).catch(() => {});
  }
}

// ─── Compliance Dashboard ────────────────────────────────────────────────────

async function showComplianceDashboard(
  landlordId: string,
  phone: string,
  tenancyId?: string,
): Promise<void> {
  let query = supabase
    .from("compliance_deadlines")
    .select("id, type, due_date, status")
    .eq("landlord_id", landlordId)
    .in("status", ["pending", "overdue"])
    .order("due_date", { ascending: true });

  if (tenancyId) {
    query = query.eq("tenancy_id", tenancyId);
  }

  const { data: deadlines, error } = await query;

  if (error || !deadlines || deadlines.length === 0) {
    await sendTextMessage(
      phone,
      "You have no pending compliance deadlines. All up to date!",
    );
    return;
  }

  const now = new Date();
  const lines: string[] = ["*Compliance Deadlines*\n"];

  for (const d of deadlines) {
    const dueDate = new Date(d.due_date as string);
    const daysUntil = Math.round((dueDate.getTime() - now.getTime()) / 86_400_000);
    const label = complianceTypeLabel(d.type as ComplianceType);
    const dueFmt = dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

    let status: string;
    if (daysUntil < 0) {
      status = `OVERDUE by ${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? "" : "s"}`;
    } else if (daysUntil === 0) {
      status = "DUE TODAY";
    } else if (daysUntil <= 14) {
      status = `Due in ${daysUntil} days (${dueFmt})`;
    } else {
      status = `Due ${dueFmt}`;
    }

    lines.push(`• *${label}*\n  ${status}`);
  }

  lines.push("\nType *find engineer* to get local contractor recommendations.");

  await sendTextMessage(phone, lines.join("\n"));
}

// ─── Find Contractor ─────────────────────────────────────────────────────────

async function findContractors(opts: {
  landlordId: string;
  phone: string;
  trade: string | null;
  tenancyId?: string;
  complianceType?: ComplianceType;
}): Promise<void> {
  const { landlordId, phone, trade, tenancyId, complianceType } = opts;

  const tradeLabel = trade
    ? TRADE_LABELS[trade] ?? "contractor"
    : "contractor";

  if (!trade) {
    await sendTextMessage(
      phone,
      "What type of contractor do you need?\n\n" +
        "Reply with one of:\n" +
        "• *find gas engineer*\n" +
        "• *find electrician*\n" +
        "• *find plumber*\n" +
        "• *find energy assessor*",
    );
    return;
  }

  // Get property postcode for area matching.
  const postcodeArea = tenancyId
    ? await getPropertyPostcodeArea(tenancyId)
    : null;

  // Build contractor query.
  let contractorQuery = supabase
    .from("contractors")
    .select("id, name, trade, phone, rating")
    .eq("trade", trade)
    .eq("is_verified", true)
    .order("rating", { ascending: false })
    .limit(4);

  if (postcodeArea) {
    contractorQuery = contractorQuery.eq("postcode_area", postcodeArea);
  }

  const { data: contractors } = await contractorQuery;

  if (!contractors || contractors.length === 0) {
    await sendTextMessage(
      phone,
      `I don't have any vetted ${tradeLabel}s in your area on file yet.\n\n` +
        "You can find Gas Safe registered engineers at *gassaferegister.co.uk*, " +
        "or certified electricians via *napit.org.uk* or *niceic.com*.\n\n" +
        "Once you've arranged the work, reply with the completion date and I'll update your records.",
    );
    return;
  }

  const lines: string[] = [`*Recommended ${tradeLabel}s in your area:*\n`];
  for (const c of contractors) {
    const stars = "★".repeat(Math.round(c.rating as number)) +
      "☆".repeat(5 - Math.round(c.rating as number));
    lines.push(`• *${c.name}*\n  ${stars} (${(c.rating as number).toFixed(1)})\n  📞 ${c.phone}`);
  }
  lines.push("\nReply *YES* once you've used one of these and I'll log the referral.");

  // Log the referral_transaction as pending.
  let referralId: string | undefined;
  if (complianceType) {
    const { data: mostRecentDeadline } = await supabase
      .from("compliance_deadlines")
      .select("id")
      .eq("landlord_id", landlordId)
      .eq("type", complianceType)
      .in("status", ["pending", "overdue"])
      .order("due_date", { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: referral } = await supabase
      .from("referral_transactions")
      .insert({
        landlord_id: landlordId,
        tenancy_id: tenancyId ?? null,
        compliance_type: complianceType,
        compliance_deadline_id: mostRecentDeadline?.id ?? null,
        referred_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    referralId = referral?.id as string | undefined;
  }

  await sendTextMessage(phone, lines.join("\n"));

  // Update state to track pending contractor confirmation.
  const currentState = await loadComplianceState(landlordId);
  await saveComplianceState(landlordId, {
    ...currentState,
    step: "awaiting_contractor_confirm",
    contractorReferralId: referralId,
  });
}

// ─── Date Confirmation ───────────────────────────────────────────────────────

async function updateDeadlineAndAskForCert(opts: {
  deadlineId: string;
  complianceType: ComplianceType;
  newDate: Date;
  phone: string;
  landlordId: string;
}): Promise<void> {
  const { deadlineId, complianceType, newDate, phone } = opts;

  const newDateIso = newDate.toISOString().split("T")[0];
  const validityDays = COMPLIANCE_VALIDITY_DAYS[complianceType];

  // If the date is in the past or today it's a completion date → recalculate next due.
  const isCompletionDate = newDate <= new Date();
  const nextDueIso = isCompletionDate && validityDays
    ? addDays(newDateIso, validityDays)
    : newDateIso;

  const updates: Record<string, string> = {
    due_date: nextDueIso,
    status: isCompletionDate ? "pending" : "pending",
    updated_at: new Date().toISOString(),
  };
  if (isCompletionDate) {
    updates.last_completed = newDateIso;
  }

  await supabase
    .from("compliance_deadlines")
    .update(updates)
    .eq("id", deadlineId);

  const label = complianceTypeLabel(complianceType);
  const nextDueFmt = new Date(nextDueIso).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  const msg = isCompletionDate
    ? `Got it — I've recorded your *${label}* as completed on ${newDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.\n\n` +
      `Your next renewal is due on *${nextDueFmt}*.\n\n` +
      "Please send me a photo or PDF of the certificate for your records."
    : `Great — I've updated your *${label}* due date to *${nextDueFmt}*.\n\n` +
      "Once you have the certificate, please send me a photo or PDF for your records.";

  await sendTextMessage(phone, msg);
}

// ─── Certificate Storage ──────────────────────────────────────────────────────

async function storeCertificate(opts: {
  deadlineId: string;
  complianceType: ComplianceType;
  mediaStorageUrl: string;
  landlordId: string;
  tenancyId?: string;
  phone: string;
}): Promise<void> {
  const { deadlineId, complianceType, mediaStorageUrl, landlordId, tenancyId, phone } = opts;
  const today = new Date().toISOString().split("T")[0];
  const label = complianceTypeLabel(complianceType);

  // Derive a storage path from the incoming URL (already uploaded by webhook-handler).
  // Format: certificates/{landlordId}/{tenancyId}/{type}_{date}.ext
  const storagePath = `certificates/${landlordId}/${tenancyId ?? "unknown"}/${complianceType}_${today}`;

  const validityDays = COMPLIANCE_VALIDITY_DAYS[complianceType];
  const nextDueIso = validityDays ? addDays(today, validityDays) : null;

  const updates: Record<string, string | null> = {
    last_completed: today,
    certificate_storage_path: storagePath,
    updated_at: new Date().toISOString(),
  };
  if (nextDueIso) {
    updates.due_date = nextDueIso;
    updates.status = "pending";
  } else {
    updates.status = "completed";
  }

  await supabase
    .from("compliance_deadlines")
    .update(updates)
    .eq("id", deadlineId);

  const nextMsg = nextDueIso
    ? `Your next *${label}* will be due on *${new Date(nextDueIso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}* — I'll remind you in advance.`
    : "";

  await sendTextMessage(
    phone,
    `Your *${label}* certificate has been saved. ` +
      (nextMsg ? nextMsg + "\n\n" : "") +
      "Your compliance records are up to date.",
  );
}

// ─── Contractor Referral Confirmation ────────────────────────────────────────

async function confirmContractorReferral(
  referralId: string,
  phone: string,
): Promise<void> {
  await supabase
    .from("referral_transactions")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("id", referralId);

  await sendTextMessage(
    phone,
    "Brilliant — referral logged. Once the work is done, reply with the completion date and send me the certificate.",
  );
}

// ─── State Persistence ────────────────────────────────────────────────────────

interface ComplianceAgentState {
  step: "idle" | "awaiting_confirmation" | "awaiting_certificate" | "awaiting_contractor_confirm";
  deadlineId?: string;
  complianceType?: string;
  newDueDate?: string;
  contractorReferralId?: string;
}

async function loadComplianceState(landlordId: string): Promise<ComplianceAgentState> {
  const { data } = await supabase
    .from("coordinator_state")
    .select("compliance_state")
    .eq("landlord_id", landlordId)
    .maybeSingle();

  return (data?.compliance_state as ComplianceAgentState | null) ?? { step: "idle" };
}

async function saveComplianceState(
  landlordId: string,
  state: ComplianceAgentState,
): Promise<void> {
  await supabase
    .from("coordinator_state")
    .upsert({
      landlord_id: landlordId,
      compliance_state: state,
      updated_at: new Date().toISOString(),
    });
}

// ─── Cron-facing reminder with 3-option contractor flow ─────────────────────

/**
 * Sends a compliance reminder for the given deadline using the 3-option
 * contractor flow (presentContractorOptions). Called by the
 * compliance-autopilot-cron at 30/14/7 day thresholds.
 *
 * The message includes:
 *   1️⃣ Find me a [trade]  (or "Re-use [previous contractor]" if memory match)
 *   2️⃣ I have my own [trade]
 *   3️⃣ Already booked
 */
export async function sendComplianceReminderWithOptions(
  deadlineId: string,
): Promise<void> {
  // Load the deadline + landlord + property + tenant context
  const { data: deadline } = await supabase
    .from("compliance_deadlines")
    .select("id, landlord_id, tenancy_id, property_address, type, due_date")
    .eq("id", deadlineId)
    .maybeSingle();

  if (!deadline) {
    console.error(`[compliance-autopilot] Deadline ${deadlineId} not found`);
    return;
  }

  const trade = contractorTradeForType(deadline.type as ComplianceType);
  if (!trade) {
    // Compliance types like deposit_protection that don't need a contractor
    // fall through to the original reminder sender — caller handles those.
    return;
  }

  const { data: landlord } = await supabase
    .from("landlords")
    .select("whatsapp_number")
    .eq("id", deadline.landlord_id)
    .maybeSingle();

  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("tenant_phone, tenant_name")
    .eq("id", deadline.tenancy_id)
    .maybeSingle();

  const landlordPhone = landlord?.whatsapp_number as string | undefined;
  if (!landlordPhone) {
    console.error(`[compliance-autopilot] No landlord phone for deadline ${deadlineId}`);
    return;
  }

  await presentContractorOptions({
    landlordId:       deadline.landlord_id as string,
    landlordPhone,
    source:           "compliance",
    trade,
    job_type:         complianceTypeLabel(deadline.type as ComplianceType),
    property_address: deadline.property_address as string,
    due_date:         deadline.due_date as string,
    deadline_id:      deadline.id as string,
    compliance_type:  deadline.type as string,
    tenancy_id:       deadline.tenancy_id as string | undefined,
    tenant_phone:     tenancy?.tenant_phone as string | undefined,
    tenant_name:      tenancy?.tenant_name as string | undefined,
  });
}

// ─── Exported Helpers (used by cron) ─────────────────────────────────────────

/**
 * Human-readable label for each compliance type.
 * Used in WhatsApp reminder messages and the compliance dashboard.
 */
export function complianceTypeLabel(type: ComplianceType): string {
  const labels: Record<ComplianceType, string> = {
    gas_safety:                "Gas Safety Certificate",
    eicr:                      "EICR (Electrical Inspection)",
    epc:                       "EPC (Energy Performance Certificate)",
    deposit_protection:        "Deposit Protection",
    deposit_prescribed_info:   "Deposit Prescribed Information",
    smoke_co_alarms:           "Smoke & CO Alarm Check",
    right_to_rent_followup:    "Right to Rent Follow-Up",
    how_to_rent_guide:         "How to Rent Guide",
    energy_info_regs:          "Energy Information Regulations",
    landlord_insurance:        "Landlord Insurance",
    legionella_risk_assessment: "Legionella Risk Assessment",
  };
  return labels[type] ?? type;
}

/**
 * Contractor trade to query when a landlord asks for help with a given compliance type.
 * Returns null for types that don't require a contractor (e.g., deposit protection).
 */
export function contractorTradeForType(type: ComplianceType): string | null {
  const trades: Partial<Record<ComplianceType, string>> = {
    gas_safety:                "gas_safe",
    eicr:                      "electrician",
    smoke_co_alarms:           "electrician",
    epc:                       "energy_assessor",
    legionella_risk_assessment: "water_treatment",
  };
  return trades[type] ?? null;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

const TRADE_LABELS: Record<string, string> = {
  gas_safe:       "Gas Safe engineer",
  electrician:    "electrician",
  plumber:        "plumber",
  energy_assessor: "energy assessor",
  water_treatment: "water treatment specialist",
  general:        "contractor",
};

/** Detect contractor intent from message text. Returns trade or null. */
function detectContractorIntent(lower: string): string | "unknown" | null {
  if (!/\b(find|get|need|book|recommend|suggest|contact|know\s+any)\b/.test(lower) &&
      !/\b(engineer|plumber|electrician|assessor|contractor|tradesperson)\b/.test(lower)) {
    return null;
  }

  if (/\b(gas|gas\s+safe|gas\s+safety)\b/.test(lower)) return "gas_safe";
  if (/\b(electric(?:ian)?|eicr|electrical|wiring)\b/.test(lower)) return "electrician";
  if (/\b(plumb(?:er|ing)?|water|leak)\b/.test(lower)) return "plumber";
  if (/\b(energy\s+assessor?|epc)\b/.test(lower)) return "energy_assessor";
  if (/\b(legionella|water\s+treatment)\b/.test(lower)) return "water_treatment";

  // Generic "find engineer/contractor" without specifying trade.
  if (/\b(engineer|contractor|tradesperson|someone|local|help)\b/.test(lower)) return "unknown";
  return null;
}

/**
 * Parses a date from free-text landlord replies.
 * Handles common UK date formats and relative expressions.
 * Returns null if no date can be confidently parsed.
 */
function parseDateFromText(text: string): Date | null {
  const lower = text.toLowerCase().trim();

  // Completion indicators without a specific date → today.
  if (/\b(done|completed|sorted|just\s+done|had\s+it(?:\s+done)?|all\s+good|finished|booked)\b/.test(lower) &&
      !/\b(for|on|date|when)\b/.test(lower)) {
    return new Date();
  }

  // Relative: tomorrow.
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }

  // Relative: next week.
  if (/\bnext\s+week\b/.test(lower)) {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY.
  const dmy = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10) - 1;
    const yearRaw = dmy[3];
    const year = yearRaw.length === 2 ? 2000 + parseInt(yearRaw, 10) : parseInt(yearRaw, 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  // ISO: YYYY-MM-DD.
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(iso[0]);
    if (!isNaN(d.getTime())) return d;
  }

  // "15 May 2026" / "15th May" / "15th of May 2026".
  const MONTH_MAP: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const textDate = text.match(
    /(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?/i,
  );
  if (textDate) {
    const day = parseInt(textDate[1], 10);
    const monthKey = textDate[2].toLowerCase().slice(0, 3);
    const month = MONTH_MAP[monthKey];
    const year = textDate[3] ? parseInt(textDate[3], 10) : new Date().getFullYear();
    const d = new Date(year, month, day);
    // If no year given and the date is in the past, assume next year.
    if (!textDate[3] && d < new Date()) {
      d.setFullYear(d.getFullYear() + 1);
    }
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

/** Returns the first 2-3 characters of a property postcode for contractor area matching. */
async function getPropertyPostcodeArea(tenancyId: string): Promise<string | null> {
  const { data } = await supabase
    .from("tenancies")
    .select("postcode, session_id")
    .eq("id", tenancyId)
    .maybeSingle();

  if (data?.postcode) {
    // Outward code is everything before the last 3 chars (e.g., "SW1A 2AA" → "SW1A").
    return (data.postcode as string).trim().split(" ")[0] ?? null;
  }

  // Fall back to screening_sessions.property_address.
  if (data?.session_id) {
    const { data: session } = await supabase
      .from("screening_sessions")
      .select("property_address")
      .eq("id", data.session_id)
      .maybeSingle();

    if (session?.property_address) {
      // Attempt to extract postcode from the address string.
      const match = (session.property_address as string).match(
        /([A-Z]{1,2}\d{1,2}[A-Z]?)\s*\d[A-Z]{2}/i,
      );
      return match ? match[1] : null;
    }
  }

  return null;
}

/** Resolve the most recent active tenancy for a landlord. */
async function resolveTenancy(landlordId: string): Promise<string | undefined> {
  const { data } = await supabase
    .from("tenancies")
    .select("id")
    .eq("landlord_id", landlordId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.id as string | undefined;
}

/** ISO date arithmetic — add N days to an ISO date string. */
function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}
