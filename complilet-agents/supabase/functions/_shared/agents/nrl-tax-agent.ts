/**
 * CompliLet — NRL Tax Compliance Agent
 *
 * Manages the Non-Resident Landlord (NRL) scheme lifecycle for overseas landlords.
 *
 * Responsibilities:
 *   1. Detect overseas landlords from non-+44 phone prefixes during onboarding.
 *   2. Explain the NRL scheme and the 20% withholding tax risk.
 *   3. Guide landlords through the NRL1 form submission process.
 *   4. Send ongoing reminders via the nrl-tax-cron:
 *        - 6-week approval follow-up
 *        - 30-day NRL1 expiry warning
 *        - Annual Self Assessment reminder (31 January deadline)
 *        - Quarterly payment-on-account prompts (January, April, July, October)
 *
 * State is persisted in coordinator_state.nrl_state (JSONB, keyed by landlord_id).
 * All events are logged to the nrl_events table for deduplication and audit.
 *
 * IMPORTANT: All messages include a regulatory caveat. CompliLet is not a tax adviser.
 * NRL scheme references are accurate as of April 2026 (HMRC INTM350000 series).
 */

import { supabase } from "../supabase.ts";
import { sendTextMessage } from "../whatsapp.ts";
import {
  NRL_WITHHOLDING_TAX_RATE,
  NRL_APPROVAL_WEEKS_TYPICAL,
  NRL_EXPIRY_REMINDER_DAYS,
  NRL_APPROVAL_REMINDER_WEEKS,
} from "../constants.ts";
import type { ParsedMessage } from "../types.ts";

// ─── Types ─────────────────────────────────────────────────────────────────

export type NrlStep =
  | "idle"                       // NRL flow not yet started
  | "awaiting_overseas_confirm"  // Waiting for YES/NO: "are you overseas?"
  | "awaiting_nrl1_interest"     // Waiting for YES/NO: "want NRL1 guidance?"
  | "awaiting_nrl1_submitted"    // Waiting for YES/NO: "have you submitted your NRL1?"
  | "awaiting_expiry_date"       // Waiting for DD/MM/YYYY: approval expiry date
  | "active";                    // Overseas confirmed, reminders running

export interface NrlState {
  step: NrlStep;
  isOverseas?: boolean;
  nrl1Interested?: boolean;
  nrl1Submitted?: boolean;
  nrl1SubmittedDate?: string;   // ISO date YYYY-MM-DD
  nrl1ExpiryDate?: string;      // ISO date YYYY-MM-DD — from approval letter
  guidanceGivenAt?: string;     // ISO timestamp — anchor for 6-week follow-up
}

export interface NrlAgentInput {
  message: ParsedMessage;
  landlordId: string;
  landlordPhone: string;
}

export type NrlEventType =
  | "nrl_detected"
  | "confirmed_overseas"
  | "confirmed_uk_resident"
  | "nrl1_guidance"
  | "nrl1_submitted"
  | "approval_reminder"
  | "expiry_reminder"
  | "sa_reminder"
  | "quarterly_reminder";

// ─── Regulatory Caveat ─────────────────────────────────────────────────────

const CAVEAT =
  "\n\n_General guidance only — not tax advice. Please consult a qualified " +
  "UK tax adviser for advice specific to your situation._";

// ─── State Helpers ─────────────────────────────────────────────────────────

async function loadNrlState(landlordId: string): Promise<NrlState> {
  const { data } = await supabase
    .from("coordinator_state")
    .select("nrl_state")
    .eq("landlord_id", landlordId)
    .maybeSingle();
  return ((data?.nrl_state as NrlState | null) ?? { step: "idle" });
}

async function saveNrlState(landlordId: string, patch: Partial<NrlState>): Promise<void> {
  const current = await loadNrlState(landlordId);
  const updated: NrlState = { ...current, ...patch };
  const { error } = await supabase
    .from("coordinator_state")
    .upsert(
      { landlord_id: landlordId, nrl_state: updated, updated_at: new Date().toISOString() },
      { onConflict: "landlord_id" },
    );
  if (error) {
    console.error("[nrl-tax-agent] saveNrlState error:", error.message);
  }
}

export async function logNrlEvent(
  landlordId: string,
  eventType: NrlEventType,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase.from("nrl_events").insert({
    landlord_id: landlordId,
    event_type: eventType,
    metadata,
    created_at: new Date().toISOString(),
  });
  if (error) {
    console.error(`[nrl-tax-agent] logNrlEvent(${eventType}) error:`, error.message);
  }
}

// ─── Public Entry Points ────────────────────────────────────────────────────

/**
 * Called by the coordinator when a landlord's phone has a non-+44 prefix.
 * Idempotent — safe to call on every message; deduplicates via nrl_events.
 */
export async function detectOverseasLandlord(
  landlordId: string,
  landlordPhone: string,
): Promise<void> {
  // Only trigger once per landlord.
  const { data: existing } = await supabase
    .from("nrl_events")
    .select("id")
    .eq("landlord_id", landlordId)
    .eq("event_type", "nrl_detected")
    .limit(1)
    .maybeSingle();

  if (existing) return;

  const current = await loadNrlState(landlordId);
  if (current.step !== "idle") return;

  await saveNrlState(landlordId, { step: "awaiting_overseas_confirm" });
  await logNrlEvent(landlordId, "nrl_detected", { phone: landlordPhone });

  await sendTextMessage(
    landlordPhone,
    "We noticed your number has a non-UK prefix. " +
      "*Are you mainly resident outside the UK?* (Reply *YES* or *NO*)\n\n" +
      "This matters because if you are, HMRC's Non-Resident Landlord (NRL) scheme " +
      "may affect how your UK rental income is taxed." + CAVEAT,
  );
}

/**
 * Main inbound message handler for the NRL agent.
 * Called by the coordinator when a landlord has a pending NRL conversation
 * or sends an NRL-related keyword.
 */
export async function runNrlTaxAgent(input: NrlAgentInput): Promise<void> {
  const { message, landlordId, landlordPhone } = input;
  const text = (message.text ?? "").trim();

  const state = await loadNrlState(landlordId);

  switch (state.step) {
    case "awaiting_overseas_confirm":
      await handleOverseasConfirm(text, landlordId, landlordPhone);
      return;
    case "awaiting_nrl1_interest":
      await handleNrl1Interest(text, landlordId, landlordPhone);
      return;
    case "awaiting_nrl1_submitted":
      await handleNrl1Submitted(text, landlordId, landlordPhone);
      return;
    case "awaiting_expiry_date":
      await handleExpiryDate(text, landlordId, landlordPhone);
      return;
    case "active":
    case "idle":
    default:
      await handleActiveNrlQuery(text, landlordId, landlordPhone);
      return;
  }
}

/**
 * Sends an NRL reminder message. Called by the nrl-tax-cron.
 */
export async function sendNrlReminder(
  landlordId: string,
  landlordPhone: string,
  eventType: NrlEventType,
  body: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await sendTextMessage(landlordPhone, body + CAVEAT);
  await logNrlEvent(landlordId, eventType, metadata);
}

// ─── Step Handlers ─────────────────────────────────────────────────────────

async function handleOverseasConfirm(
  text: string,
  landlordId: string,
  landlordPhone: string,
): Promise<void> {
  const isYes = /^y(es)?$/i.test(text);
  const isNo  = /^n(o)?$/i.test(text);

  if (isNo) {
    await saveNrlState(landlordId, { step: "idle", isOverseas: false });
    await logNrlEvent(landlordId, "confirmed_uk_resident");
    await sendTextMessage(
      landlordPhone,
      "Thanks for confirming. As a UK-resident landlord, standard UK income tax " +
        "rules apply to your rental income and no NRL registration is needed." + CAVEAT,
    );
    return;
  }

  if (!isYes) {
    await sendTextMessage(
      landlordPhone,
      "Please reply *YES* if you are mainly resident outside the UK, or *NO* if you live in the UK.",
    );
    return;
  }

  // Overseas confirmed — explain the NRL scheme.
  await saveNrlState(landlordId, { step: "awaiting_nrl1_interest", isOverseas: true });
  await logNrlEvent(landlordId, "confirmed_overseas");

  await sendTextMessage(
    landlordPhone,
    "*NRL (Non-Resident Landlord) Scheme Overview*\n\n" +
      "As an overseas landlord, HMRC's NRL scheme affects how your rental income is paid:\n\n" +
      `*Without NRL approval:* Your letting agent (or tenant, if no agent) must deduct ` +
      `*${Math.round(NRL_WITHHOLDING_TAX_RATE * 100)}% basic-rate tax* from your rent before paying you.\n\n` +
      "*With NRL approval:* HMRC allows you to receive rent gross and pay your tax " +
      "directly via UK Self Assessment.\n\n" +
      "The approval form is the *NRL1* (for individuals). You submit it to HMRC and they " +
      "write to your agent/tenant confirming you may receive rent without deduction.\n\n" +
      `Processing typically takes *${NRL_APPROVAL_WEEKS_TYPICAL[0]}–${NRL_APPROVAL_WEEKS_TYPICAL[1]} weeks*.\n\n` +
      "*Would you like me to walk you through how to apply?* (Reply *YES* or *NO*)" + CAVEAT,
  );
}

async function handleNrl1Interest(
  text: string,
  landlordId: string,
  landlordPhone: string,
): Promise<void> {
  const isYes = /^y(es)?$/i.test(text);
  const isNo  = /^n(o)?$/i.test(text);

  if (isNo) {
    await saveNrlState(landlordId, { step: "active", nrl1Interested: false });
    await sendTextMessage(
      landlordPhone,
      "Understood. Without NRL approval, please ensure your letting agent or tenant " +
        `is withholding ${Math.round(NRL_WITHHOLDING_TAX_RATE * 100)}% from your rent and paying it to HMRC.\n\n` +
        "I will send you annual Self Assessment reminders (31 January deadline each year) " +
        "and quarterly prompts to keep your records up to date.\n\n" +
        "If you change your mind and want NRL1 guidance, just type *NRL*." + CAVEAT,
    );
    return;
  }

  if (!isYes) {
    await sendTextMessage(
      landlordPhone,
      "Please reply *YES* to receive NRL1 guidance, or *NO* to skip.",
    );
    return;
  }

  // Provide detailed NRL1 guidance.
  await saveNrlState(landlordId, {
    step: "awaiting_nrl1_submitted",
    nrl1Interested: true,
    guidanceGivenAt: new Date().toISOString(),
  });
  await logNrlEvent(landlordId, "nrl1_guidance");

  await sendTextMessage(
    landlordPhone,
    "*How to Apply for NRL Approval (NRL1 Form)*\n\n" +
      "*Step 1 — Download the form*\n" +
      "Search \"HMRC NRL1\" on GOV.UK. The form is titled " +
      "*NRL1 — Application to receive UK rental income without deduction of UK Income Tax*.\n\n" +
      "*Step 2 — Complete the form*\n" +
      "You will need: your National Insurance number (or Unique Taxpayer Reference), " +
      "UK property address, your overseas address, and your letting agent's details (if applicable).\n\n" +
      "*Step 3 — Submit to HMRC*\n" +
      "Post to: *HMRC, PAYE & Self Assessment, BX9 1AS, United Kingdom*. " +
      "There is no fee.\n\n" +
      "*Step 4 — Await confirmation*\n" +
      `HMRC writes to you and your agent/tenant within ` +
      `*${NRL_APPROVAL_WEEKS_TYPICAL[0]}–${NRL_APPROVAL_WEEKS_TYPICAL[1]} weeks*. ` +
      "Keep a copy of your submitted form.\n\n" +
      "*Step 5 — File Self Assessment annually*\n" +
      "Once approved you still declare your rental income each year (SA100 + SA105). " +
      "Deadline: *31 January* after the end of the tax year.\n\n" +
      "*Have you already submitted your NRL1 form?* (Reply *YES* or *NO*)" + CAVEAT,
  );
}

async function handleNrl1Submitted(
  text: string,
  landlordId: string,
  landlordPhone: string,
): Promise<void> {
  const isYes = /^y(es)?$/i.test(text);
  const isNo  = /^n(o)?$/i.test(text);

  if (isNo) {
    // Not yet submitted — acknowledge and set a follow-up reminder.
    await saveNrlState(landlordId, { step: "active", nrl1Submitted: false });
    await sendTextMessage(
      landlordPhone,
      "No problem. When you are ready, post the completed NRL1 form to HMRC " +
        "(PAYE & Self Assessment, BX9 1AS).\n\n" +
        `I will check back in *${NRL_APPROVAL_REMINDER_WEEKS} weeks* to see if HMRC has responded.\n\n` +
        "In the meantime, please make sure your letting agent or tenant knows they " +
        `must withhold ${Math.round(NRL_WITHHOLDING_TAX_RATE * 100)}% tax from your rent until approval is confirmed.\n\n` +
        "Once approved, reply *NRL APPROVED* and I will update your records." + CAVEAT,
    );
    return;
  }

  if (!isYes) {
    await sendTextMessage(
      landlordPhone,
      "Please reply *YES* if you have already submitted your NRL1, or *NO* if not yet.",
    );
    return;
  }

  // Submitted — record date and ask for approval expiry date.
  const today = new Date().toISOString().split("T")[0];
  await saveNrlState(landlordId, {
    step: "awaiting_expiry_date",
    nrl1Submitted: true,
    nrl1SubmittedDate: today,
  });
  await logNrlEvent(landlordId, "nrl1_submitted", { submittedDate: today });

  const followUpDate = addWeeks(new Date(), NRL_APPROVAL_REMINDER_WEEKS);
  const followUpStr = followUpDate.toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  await sendTextMessage(
    landlordPhone,
    "NRL1 submission noted. I will follow up on *" + followUpStr + "* " +
      "to check whether HMRC has responded.\n\n" +
      "If you have already received your *HMRC approval letter* and know your " +
      "*approval expiry date*, please send it now (format: *DD/MM/YYYY*) so I can " +
      "remind you to renew before it lapses.\n\n" +
      "Or reply *SKIP* if you do not have it to hand." + CAVEAT,
  );
}

async function handleExpiryDate(
  text: string,
  landlordId: string,
  landlordPhone: string,
): Promise<void> {
  if (/^skip$/i.test(text)) {
    await saveNrlState(landlordId, { step: "active" });
    await sendTextMessage(
      landlordPhone,
      "No problem. When you receive your approval letter, type " +
        "*NRL EXPIRY DD/MM/YYYY* (e.g. *NRL EXPIRY 31/01/2027*) and I will " +
        `set a reminder ${NRL_EXPIRY_REMINDER_DAYS} days before it expires.\n\n` +
        "I will also send you annual Self Assessment reminders and quarterly prompts." + CAVEAT,
    );
    return;
  }

  const parsed = parseUkDate(text);
  if (!parsed) {
    await sendTextMessage(
      landlordPhone,
      "I could not read that date. Please use the format *DD/MM/YYYY* " +
        "(e.g. *31/01/2027*), or reply *SKIP* to set this up later.",
    );
    return;
  }

  await saveNrlState(landlordId, { step: "active", nrl1ExpiryDate: parsed });

  const expiryFormatted = formatUkDate(parsed);
  const reminderDate = addDays(new Date(parsed), -NRL_EXPIRY_REMINDER_DAYS);
  const reminderStr = reminderDate.toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  await sendTextMessage(
    landlordPhone,
    `NRL approval expiry *${expiryFormatted}* saved.\n\n` +
      `I will remind you to renew on *${reminderStr}* ` +
      `(${NRL_EXPIRY_REMINDER_DAYS} days before expiry).\n\n` +
      "I will also send you:\n" +
      "- Annual Self Assessment filing reminders (31 January each year)\n" +
      "- Quarterly payment-on-account prompts\n\n" +
      "You're all set. Type *NRL* at any time for a status summary." + CAVEAT,
  );
}

async function handleActiveNrlQuery(
  text: string,
  landlordId: string,
  landlordPhone: string,
): Promise<void> {
  // Handle "NRL EXPIRY DD/MM/YYYY" command.
  const expiryMatch = /nrl\s+expiry\s+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text);
  if (expiryMatch) {
    const parsed = parseUkDate(expiryMatch[1]);
    if (parsed) {
      await saveNrlState(landlordId, { nrl1ExpiryDate: parsed, step: "active" });
      await sendTextMessage(
        landlordPhone,
        `NRL approval expiry set to *${formatUkDate(parsed)}*. ` +
          `I will remind you ${NRL_EXPIRY_REMINDER_DAYS} days before it expires.` + CAVEAT,
      );
    } else {
      await sendTextMessage(
        landlordPhone,
        "Could not read that date. Please use format *NRL EXPIRY DD/MM/YYYY*.",
      );
    }
    return;
  }

  // Handle "NRL APPROVED" command — landlord received their approval letter.
  if (/nrl\s+approved/i.test(text)) {
    await saveNrlState(landlordId, {
      step: "awaiting_expiry_date",
      nrl1Submitted: true,
      nrl1SubmittedDate: new Date().toISOString().split("T")[0],
    });
    await sendTextMessage(
      landlordPhone,
      "Congratulations on your NRL approval! Please send me your *approval expiry date* " +
        "(format: *DD/MM/YYYY*) so I can remind you to renew in good time.\n\n" +
        "Or reply *SKIP* to set this up later." + CAVEAT,
    );
    return;
  }

  // General NRL status query.
  const state = await loadNrlState(landlordId);
  const lines: string[] = ["*Your NRL Status*\n"];

  if (state.isOverseas) {
    lines.push("- Residency: Overseas landlord");

    if (state.nrl1ExpiryDate) {
      lines.push(`- NRL1 approval expiry: ${formatUkDate(state.nrl1ExpiryDate)}`);
    } else if (state.nrl1Submitted) {
      lines.push("- NRL1: Submitted (awaiting or received approval)");
    } else if (state.nrl1Interested === false) {
      lines.push(
        `- NRL1: Not applied (${Math.round(NRL_WITHHOLDING_TAX_RATE * 100)}% withholding may apply)`,
      );
    } else {
      lines.push("- NRL1: Not yet submitted");
    }

    lines.push(
      "\n*Commands*\n" +
        "- *NRL APPROVED* — log your HMRC approval\n" +
        "- *NRL EXPIRY DD/MM/YYYY* — save your approval expiry date",
    );
  } else {
    lines.push(
      "No NRL obligations recorded. If you believe this is incorrect, " +
        "please contact your CompliLet agent.",
    );
  }

  lines.push(CAVEAT);
  await sendTextMessage(landlordPhone, lines.join("\n"));
}

// ─── Utility Helpers ────────────────────────────────────────────────────────

/** Parses D/M/YYYY or DD/MM/YYYY → ISO YYYY-MM-DD. Returns null on failure. */
function parseUkDate(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  if (isNaN(new Date(iso).getTime())) return null;
  return iso;
}

function formatUkDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    });
  } catch {
    return isoDate;
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}
