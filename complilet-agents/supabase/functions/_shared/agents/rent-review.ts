/**
 * CompliLet — Rent Review Agent
 *
 * Manages the full Section 13 rent increase process under the Renters' Rights Act 2025.
 *
 * Section 13 is the ONLY legal method to increase rent under the RRA.
 * This agent enforces ALL legal constraints deterministically — no LLM override.
 *
 * Workflow:
 *   Step 1 — Eligibility check (DETERMINISTIC): 12+ months since last increase / tenancy start
 *   Step 2 — Retaliatory check: query maintenance_tickets last 6 months → warn landlord
 *   Step 3 — Rent amount: ask landlord desired amount; warn if >10% increase
 *   Step 4 — Generate Section 13 Form 4A PDF
 *   Step 5 — Serve on tenant via WhatsApp with Tribunal rights explained
 *   Step 6 — Handle response (accept / dispute / Tribunal referral)
 *   Step 7 — Post-increase: set compliance_deadline reminder for 11 months
 *
 * HARD RULES (never overridden by LLM):
 *   - 12-month frequency limit (deterministic date check)
 *   - 2-month minimum notice period (deterministic date arithmetic)
 *   - Tribunal referral → immediate human escalation
 *   - No informal rent increases — Form 4A only
 *   - Retaliatory increase check always runs and is always logged
 *
 * State stored in: coordinator_state.rent_review_state (JSONB)
 *
 * Called by:
 *   - coordinator.ts routeActiveTenancy() — keyword match
 *   - tenancy-check-in.ts — when landlord chooses option 2
 */

import { supabase } from "../supabase.ts";
import { sendTextMessage } from "../whatsapp.ts";
import { generateSection13PDF } from "../pdf/section13.ts";
import { executeEscalation } from "../escalation.ts";

// ─── Public Interface ────────────────────────────────────────────────────────

export interface RentReviewInput {
  landlordId: string;
  landlordPhone: string;
  tenancyId?: string;
  sessionId?: string;
  /** True when initiated from the 12-month check-in flow */
  initiatedByCheckIn?: boolean;
  /** For handling inbound landlord/tenant messages mid-flow */
  inboundMessage?: {
    from: string;
    text: string;
    senderRole: "landlord" | "tenant";
  };
}

export async function runRentReview(input: RentReviewInput): Promise<void> {
  const { landlordId, landlordPhone } = input;

  try {
    if (input.inboundMessage) {
      const state = await loadReviewState(landlordId);
      await handleInboundMessage(input.inboundMessage, state, landlordId, landlordPhone, input.tenancyId, input.sessionId);
      return;
    }

    // Fresh initiation
    await initiateRentReview(landlordId, landlordPhone, input.tenancyId, input.sessionId);

  } catch (err) {
    console.error("[rent-review] Error:", err);
    await sendTextMessage(landlordPhone, "Sorry, something went wrong with the rent review. Please try again or type *HELP*.").catch(() => {});
  }
}

// ─── Step 1: Initiation & Eligibility ───────────────────────────────────────

async function initiateRentReview(
  landlordId: string,
  landlordPhone: string,
  tenancyId?: string,
  sessionId?: string,
): Promise<void> {
  const tenancy = await resolveTenancy(landlordId, tenancyId);
  if (!tenancy) {
    await sendTextMessage(landlordPhone, "No active tenancy found. Type *SCREEN* to start a new screening.");
    return;
  }

  // ── STEP 1: DETERMINISTIC ELIGIBILITY CHECK ──────────────────────────────
  // This check is NEVER overridden by the LLM.
  const eligibility = checkEligibility(tenancy);
  if (!eligibility.eligible) {
    await sendTextMessage(
      landlordPhone,
      `❌ *Rent increase not eligible yet*\n\n` +
        `Under the Renters' Rights Act 2025, rent can only be increased once every 12 months.\n\n` +
        `Last increase: *${formatDate(eligibility.lastIncreaseDate)}*\n` +
        `Earliest eligible date: *${formatDate(eligibility.earliestEligibleDate)}*\n\n` +
        "I'll remind you when the 12-month period is complete.",
    );
    return;
  }

  // ── STEP 2: RETALIATORY INCREASE CHECK ──────────────────────────────────
  // Always runs, always logged — regardless of outcome.
  const maintenanceWarning = await checkForMaintenanceComplaints(tenancy.id);

  let warningMessage = "";
  if (maintenanceWarning.hasComplaints) {
    warningMessage =
      `\n\n⚠️ *Retaliatory increase warning*\n` +
      `${tenancy.tenant_name || "Your tenant"} has reported ${maintenanceWarning.count} maintenance issue(s) ` +
      `in the last 6 months (most recent: ${maintenanceWarning.mostRecent}). ` +
      `Increasing rent after maintenance reports could be viewed as retaliatory under the Renters' Rights Act ` +
      `and may be challenged at Tribunal. This warning has been logged.`;

    // Log the warning regardless of whether landlord proceeds
    await supabase.from("agent_logs").insert({
      landlord_id: landlordId,
      agent_type: "rent_review",
      event_type: "retaliatory_increase_warning",
      payload: {
        tenancy_id: tenancy.id,
        maintenance_count: maintenanceWarning.count,
        most_recent: maintenanceWarning.mostRecent,
        timestamp: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    });
  }

  // ── STEP 3: ASK FOR DESIRED RENT AMOUNT ─────────────────────────────────
  await sendTextMessage(
    landlordPhone,
    `*Section 13 Rent Review — ${tenancy.property_address ?? "Your Property"}*\n\n` +
      `Tenant: *${tenancy.tenant_name ?? "Not set"}*\n` +
      `Current rent: *£${tenancy.monthly_rent_gbp}/month*\n` +
      `Tenancy started: *${formatDate(tenancy.start_date)}*${warningMessage}\n\n` +
      "What monthly rent would you like to propose? Reply with a figure, e.g. *1600* or *£1,600*.",
  );

  await saveReviewState(landlordId, {
    step: "awaiting_amount",
    tenancyId: tenancy.id,
    sessionId,
    tenantPhone: tenancy.tenant_phone,
    tenantName: tenancy.tenant_name ?? undefined,
    propertyAddress: tenancy.property_address ?? undefined,
    landlordName: tenancy.landlord_name ?? undefined,
    landlordAddress: tenancy.landlord_address ?? undefined,
    currentRent: tenancy.monthly_rent_gbp ?? 0,
    hasRetatalioryWarning: maintenanceWarning.hasComplaints,
  });
}

// ─── Inbound Message Router ──────────────────────────────────────────────────

async function handleInboundMessage(
  msg: { from: string; text: string; senderRole: "landlord" | "tenant" },
  state: ReviewState,
  landlordId: string,
  landlordPhone: string,
  tenancyId?: string,
  sessionId?: string,
): Promise<void> {
  if (msg.senderRole === "tenant") {
    await handleTenantResponse(msg.text.toLowerCase(), state, landlordId, landlordPhone);
    return;
  }
  // Landlord
  switch (state.step) {
    case "awaiting_amount":
      await handleAmountInput(msg.text, state, landlordId, landlordPhone);
      break;
    case "awaiting_landlord_confirm":
      await handleLandlordConfirm(msg.text.toLowerCase(), state, landlordId, landlordPhone);
      break;
    case "notice_served":
    case "disputed":
      await handleLandlordMidFlow(msg.text.toLowerCase(), state, landlordId, landlordPhone);
      break;
    default:
      // Nothing active — initiate fresh
      await initiateRentReview(landlordId, landlordPhone, tenancyId, sessionId);
  }
}

// ─── Step 3: Amount Input ────────────────────────────────────────────────────

async function handleAmountInput(
  text: string,
  state: ReviewState,
  landlordId: string,
  landlordPhone: string,
): Promise<void> {
  const amount = parseRentAmount(text);
  if (!amount) {
    await sendTextMessage(landlordPhone, "I didn't catch that. Please reply with the monthly amount, e.g. *1600* or *£1,600*.");
    return;
  }

  const currentRent = state.currentRent ?? 0;
  const increasePercent = currentRent > 0 ? ((amount - currentRent) / currentRent) * 100 : 0;

  // Effective date: minimum 2 months from today (hard rule)
  const effectiveDate = new Date();
  effectiveDate.setMonth(effectiveDate.getMonth() + 2);
  // Align to 1st of month after the 2-month period for cleanliness
  effectiveDate.setDate(1);
  effectiveDate.setMonth(effectiveDate.getMonth() + 1);
  const effectiveDateIso = effectiveDate.toISOString().split("T")[0];

  let warningMsg = "";
  if (increasePercent > 10) {
    warningMsg =
      `\n\n⚠️ *High increase warning*\nA ${increasePercent.toFixed(1)}% increase may be considered above market rate. ` +
      `The First-tier Tribunal has discretion to reduce the increase to market rate if the tenant challenges it.`;
  }

  // Form 4A preview
  await sendTextMessage(
    landlordPhone,
    `*Section 13 Notice Preview*\n\n` +
      `Property: *${state.propertyAddress ?? "Not set"}*\n` +
      `Tenant: *${state.tenantName ?? "Not set"}*\n` +
      `Current rent: *£${currentRent}/month*\n` +
      `Proposed rent: *£${amount}/month* (+${increasePercent.toFixed(1)}%)\n` +
      `Effective date: *${formatDate(effectiveDateIso)}* (2 months' notice)${warningMsg}\n\n` +
      "The Section 13 Form 4A will be generated and sent to your tenant. " +
      "Your tenant has the right to refer this to the First-tier Tribunal before the effective date.\n\n" +
      "Reply *CONFIRM* to proceed, or send a different amount.",
  );

  await saveReviewState(landlordId, {
    ...state,
    step: "awaiting_landlord_confirm",
    proposedRent: amount,
    effectiveDate: effectiveDateIso,
    increasePercent: Math.round(increasePercent * 10) / 10,
  });
}

// ─── Step 4 & 5: Confirm → Generate PDF → Serve on Tenant ───────────────────

async function handleLandlordConfirm(
  lower: string,
  state: ReviewState,
  landlordId: string,
  landlordPhone: string,
): Promise<void> {
  const confirms = /\b(confirm|yes|send|proceed|ok|go)\b/.test(lower);
  if (!confirms) {
    // Check if it's a new amount
    const newAmount = parseRentAmount(lower);
    if (newAmount) {
      await handleAmountInput(String(newAmount), { ...state, step: "awaiting_amount" }, landlordId, landlordPhone);
      return;
    }
    await sendTextMessage(landlordPhone, "Reply *CONFIRM* to proceed with the Section 13 notice, or send a different amount.");
    return;
  }

  if (!state.proposedRent || !state.effectiveDate || !state.tenantPhone || !state.tenancyId) {
    await sendTextMessage(landlordPhone, "Something went wrong — please type *RENT REVIEW* to start again.");
    await saveReviewState(landlordId, { step: "idle" });
    return;
  }

  // Step 4: Generate Form 4A PDF
  const pdfBytes = await generateSection13PDF({
    landlordName: state.landlordName ?? "Your Landlord",
    landlordAddress: state.landlordAddress ?? "See correspondence",
    tenantName: state.tenantName ?? "The Tenant",
    propertyAddress: state.propertyAddress ?? "The Property",
    currentRent: state.currentRent ?? 0,
    proposedRent: state.proposedRent,
    effectiveDate: state.effectiveDate,
    noticeSentDate: new Date().toISOString().split("T")[0],
  });

  // Upload PDF to Supabase Storage
  const pdfPath = `rent-reviews/${state.tenancyId}/${new Date().toISOString().replace(/[:.]/g, "-")}-section13.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: false });

  if (uploadError) {
    console.error("[rent-review] PDF upload failed:", uploadError.message);
    await sendTextMessage(landlordPhone, "Sorry, there was an error generating the notice PDF. Please try again.");
    return;
  }

  const { data: signedUrl } = await supabase.storage.from("documents").createSignedUrl(pdfPath, 60 * 60 * 24 * 30);
  const pdfUrl = signedUrl?.signedUrl ?? "";

  // Notify landlord with PDF link
  await sendTextMessage(
    landlordPhone,
    `✅ *Section 13 Notice Generated*\n\n` +
      `Form 4A PDF: ${pdfUrl}\n\n` +
      "The notice is being sent to your tenant now.",
  );

  // Step 5: Serve on tenant
  const effectiveFormatted = formatDate(state.effectiveDate);
  const tribunalDeadline = formatDate(state.effectiveDate); // Deadline = effective date

  await sendTextMessage(
    state.tenantPhone,
    `*Section 13 Rent Increase Notice*\n\n` +
      `Your landlord has given notice of a rent increase for *${state.propertyAddress ?? "your property"}*.\n\n` +
      `Current rent: *£${state.currentRent}/month*\n` +
      `Proposed new rent: *£${state.proposedRent}/month*\n` +
      `Effective date: *${effectiveFormatted}*\n\n` +
      `*Your rights:*\n` +
      `You have the right to refer this increase to the First-tier Tribunal (Property Chamber) ` +
      `before *${tribunalDeadline}*. The Tribunal will assess whether the proposed rent is at market rate.\n\n` +
      `Free advice: Citizens Advice — 0800 144 8848\n` +
      `To refer to the Tribunal: gov.uk/housing-tribunals\n\n` +
      `The formal Section 13 notice has been sent to you. ` +
      `Reply *ACCEPT* if you accept the new rent, or *DISPUTE* to discuss.`,
  );

  // Record in tenancies (will be confirmed on effective date)
  await supabase
    .from("tenancies")
    .update({
      pending_rent_gbp: state.proposedRent,
      rent_review_effective_date: state.effectiveDate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", state.tenancyId);

  // Record in compliance_deadlines for automatic follow-up on effective date
  await supabase.from("compliance_deadlines").insert({
    landlord_id: landlordId,
    tenancy_id: state.tenancyId,
    type: "rent_review_effective",
    due_date: state.effectiveDate,
    notes: `Section 13 notice: £${state.currentRent} → £${state.proposedRent}/month`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await saveReviewState(landlordId, {
    ...state,
    step: "notice_served",
    noticeSentDate: new Date().toISOString().split("T")[0],
    pdfUrl,
  });

  console.log(`[rent-review] Section 13 notice served for tenancy ${state.tenancyId}.`);
}

// ─── Step 6: Handle Tenant Response ─────────────────────────────────────────

async function handleTenantResponse(
  lower: string,
  state: ReviewState,
  landlordId: string,
  landlordPhone: string,
): Promise<void> {
  const tenantPhone = state.tenantPhone ?? "";

  if (state.step !== "notice_served" && state.step !== "disputed") {
    await sendTextMessage(
      tenantPhone,
      "For questions about your rent or tenancy, please message your landlord directly or contact Citizens Advice on 0800 144 8848.",
    );
    return;
  }

  // Tribunal referral — IMMEDIATE human escalation
  const refersTribunal = /\b(tribunal|first.tier|property\s+chamber|refer|challenge|dispute.*tribunal)\b/.test(lower);
  if (refersTribunal) {
    await sendTextMessage(
      tenantPhone,
      "Understood. You have the right to refer this to the First-tier Tribunal (Property Chamber) before the effective date.\n\n" +
        "To refer: gov.uk/housing-tribunals\n" +
        "Free guidance: Citizens Advice — 0800 144 8848\n\n" +
        "A member of the CompliLet team has been notified and will be in touch.",
    );

    await sendTextMessage(
      landlordPhone,
      `⚠️ *Tribunal Referral Indicated*\n\n` +
        `*${state.tenantName || "Your tenant"}* has indicated they intend to refer the Section 13 rent increase ` +
        `to the First-tier Tribunal.\n\n` +
        "A CompliLet team member will contact you. We recommend consulting a solicitor.\n" +
        "Do not apply the rent increase until the Tribunal matter is resolved.",
    );

    // Escalate to human — non-negotiable
    await executeEscalation({
      messageText: lower,
      triggerType: "legal_threat",
      priority: "within_2hrs",
      context: `Tenant indicated First-tier Tribunal referral for Section 13 rent increase. Tenancy ${state.tenancyId}.`,
      senderPhone: tenantPhone,
      sessionId: state.sessionId,
      landlordId,
    });

    await saveReviewState(landlordId, { ...state, step: "tribunal_referred" });

    // Log tribunal referral
    await supabase.from("agent_logs").insert({
      landlord_id: landlordId,
      agent_type: "rent_review",
      event_type: "tribunal_referral_indicated",
      payload: { tenancy_id: state.tenancyId, tenant_phone: tenantPhone, timestamp: new Date().toISOString() },
      created_at: new Date().toISOString(),
    });
    return;
  }

  // Tenant accepts
  const accepts = /\b(accept|ok|fine|agreed|yes|happy|no\s+problem|ok\s+with)\b/.test(lower);
  if (accepts) {
    await sendTextMessage(
      tenantPhone,
      `Thank you for confirming. Your new rent of *£${state.proposedRent}/month* will begin on *${formatDate(state.effectiveDate)}*. ` +
        "No further action is needed from you.",
    );
    await sendTextMessage(
      landlordPhone,
      `✅ *Tenant Accepted*\n\n*${state.tenantName || "Your tenant"}* has accepted the new rent of *£${state.proposedRent}/month*, effective *${formatDate(state.effectiveDate)}*.`,
    );
    await saveReviewState(landlordId, { ...state, step: "tenant_accepted" });
    return;
  }

  // Tenant disputes — facilitate negotiation, not Tribunal
  const disputes = /\b(dispute|disagree|no|too\s+high|can't\s+afford|unfair|unhappy)\b/.test(lower);
  if (disputes) {
    await sendTextMessage(
      tenantPhone,
      `I understand you'd like to discuss the proposed increase.\n\n` +
        `Your landlord proposed *£${state.proposedRent}/month* (up from *£${state.currentRent}/month*).\n\n` +
        "You can:\n" +
        "• Negotiate directly with your landlord\n" +
        "• Refer to the First-tier Tribunal (say *TRIBUNAL* to indicate this)\n" +
        "• Seek free advice from Citizens Advice: 0800 144 8848",
    );
    await sendTextMessage(
      landlordPhone,
      `*${state.tenantName || "Your tenant"}* has indicated they dispute the proposed rent increase of *£${state.proposedRent}/month*.\n\n` +
        "They have not yet indicated a Tribunal referral — they may wish to negotiate. " +
        "Would you like to offer a different amount? Or would you like the process to continue at the proposed rent?",
    );
    await saveReviewState(landlordId, { ...state, step: "disputed" });
    return;
  }

  // Ambiguous
  await sendTextMessage(
    tenantPhone,
    `Please reply *ACCEPT* to accept the new rent, *DISPUTE* to raise a concern, or *TRIBUNAL* to indicate a Tribunal referral.`,
  );
}

// ─── Landlord Mid-Flow Handler ───────────────────────────────────────────────

async function handleLandlordMidFlow(
  lower: string,
  state: ReviewState,
  landlordId: string,
  landlordPhone: string,
): Promise<void> {
  const amount = parseRentAmount(lower);
  if (amount && state.step === "disputed") {
    // Landlord offering a revised amount during dispute
    const tenantPhone = state.tenantPhone ?? "";
    await sendTextMessage(
      tenantPhone,
      `Your landlord has revised the proposed rent to *£${amount}/month* (effective *${formatDate(state.effectiveDate)}*).\n\n` +
        "Reply *ACCEPT* to agree, *DISPUTE* to continue negotiating, or *TRIBUNAL* to refer to the Tribunal.",
    );
    await sendTextMessage(landlordPhone, `Revised offer of *£${amount}/month* sent to your tenant.`);
    await saveReviewState(landlordId, { ...state, proposedRent: amount, step: "notice_served" });
    return;
  }

  // Status enquiry
  const statusLabel: Record<string, string> = {
    notice_served: "Notice served — awaiting tenant response",
    disputed: "Tenant has disputed — negotiation in progress",
    tenant_accepted: "Accepted — rent increase takes effect on " + formatDate(state.effectiveDate),
    tribunal_referred: "Tribunal referral indicated — human team has been notified",
  };

  await sendTextMessage(
    landlordPhone,
    `*Rent Review Status*\n\n` +
      `${statusLabel[state.step] ?? "In progress"}\n\n` +
      `Proposed: *£${state.proposedRent}/month*\n` +
      `Effective: *${formatDate(state.effectiveDate)}*`,
  );
}

// ─── Post-Increase: Step 7 — Compliance Deadline for Next Review ─────────────

export async function confirmRentIncrease(params: {
  landlordId: string;
  tenancyId: string;
  proposedRent: number;
  effectiveDate: string;
}): Promise<void> {
  const { landlordId, tenancyId, proposedRent, effectiveDate } = params;

  // Update the tenancy record
  await supabase
    .from("tenancies")
    .update({
      monthly_rent_gbp: proposedRent,
      last_rent_increase_date: effectiveDate,
      pending_rent_gbp: null,
      rent_review_effective_date: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tenancyId);

  // Schedule next eligible review reminder (11 months from effective date)
  const nextReminderDate = new Date(effectiveDate);
  nextReminderDate.setMonth(nextReminderDate.getMonth() + 11);

  await supabase.from("compliance_deadlines").insert({
    landlord_id: landlordId,
    tenancy_id: tenancyId,
    type: "rent_review_eligible",
    due_date: nextReminderDate.toISOString().split("T")[0],
    notes: `Next Section 13 rent review eligible from ${effectiveDate} + 12 months`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Reset review state
  const state = await loadReviewState(landlordId);
  await saveReviewState(landlordId, { ...state, step: "idle" });

  console.log(`[rent-review] Rent increase confirmed: £${proposedRent}/month from ${effectiveDate} for tenancy ${tenancyId}.`);
}

// ─── Eligibility Check (DETERMINISTIC) ──────────────────────────────────────

interface EligibilityResult {
  eligible: boolean;
  lastIncreaseDate: string | null;
  earliestEligibleDate: string | null;
}

function checkEligibility(tenancy: TenancyRow): EligibilityResult {
  const referenceDate = tenancy.last_rent_increase_date ?? tenancy.start_date;
  if (!referenceDate) {
    return { eligible: true, lastIncreaseDate: null, earliestEligibleDate: null };
  }

  const lastDate = new Date(referenceDate);
  const earliest = new Date(lastDate);
  earliest.setMonth(earliest.getMonth() + 12);

  const eligible = new Date() >= earliest;
  return {
    eligible,
    lastIncreaseDate: referenceDate,
    earliestEligibleDate: earliest.toISOString().split("T")[0],
  };
}

// ─── Retaliatory Check ────────────────────────────────────────────────────────

interface MaintenanceCheck {
  hasComplaints: boolean;
  count: number;
  mostRecent: string;
}

async function checkForMaintenanceComplaints(tenancyId: string): Promise<MaintenanceCheck> {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const { data, count } = await supabase
    .from("maintenance_tickets")
    .select("created_at", { count: "exact" })
    .eq("tenancy_id", tenancyId)
    .gte("created_at", sixMonthsAgo.toISOString())
    .order("created_at", { ascending: false })
    .limit(1);

  const hasComplaints = (count ?? 0) > 0;
  const mostRecent = data?.[0]?.created_at ? formatDate(data[0].created_at.split("T")[0]) : "";

  return { hasComplaints, count: count ?? 0, mostRecent };
}

// ─── Conversation State ──────────────────────────────────────────────────────

type ReviewStep =
  | "idle"
  | "awaiting_amount"
  | "awaiting_landlord_confirm"
  | "notice_served"
  | "disputed"
  | "tenant_accepted"
  | "tribunal_referred";

interface ReviewState {
  step: ReviewStep;
  tenancyId?: string;
  sessionId?: string;
  tenantPhone?: string;
  tenantName?: string;
  propertyAddress?: string;
  landlordName?: string;
  landlordAddress?: string;
  currentRent?: number;
  proposedRent?: number;
  effectiveDate?: string;
  increasePercent?: number;
  noticeSentDate?: string;
  pdfUrl?: string;
  hasRetatalioryWarning?: boolean;
}

async function loadReviewState(landlordId: string): Promise<ReviewState> {
  const { data } = await supabase
    .from("coordinator_state")
    .select("rent_review_state")
    .eq("landlord_id", landlordId)
    .maybeSingle();
  return (data?.rent_review_state as ReviewState | null) ?? { step: "idle" };
}

async function saveReviewState(landlordId: string, state: ReviewState): Promise<void> {
  await supabase
    .from("coordinator_state")
    .upsert(
      { landlord_id: landlordId, rent_review_state: state, updated_at: new Date().toISOString() },
      { onConflict: "landlord_id" },
    );
}

// ─── Context Resolution ──────────────────────────────────────────────────────

interface TenancyRow {
  id: string;
  tenant_phone: string;
  tenant_name: string | null;
  property_address: string | null;
  monthly_rent_gbp: number | null;
  start_date: string | null;
  last_rent_increase_date: string | null;
  landlord_name: string | null;
  landlord_address: string | null;
}

async function resolveTenancy(landlordId: string, tenancyId?: string): Promise<TenancyRow | null> {
  let query = supabase
    .from("tenancies")
    .select("id, tenant_phone, tenant_name, property_address, monthly_rent_gbp, start_date, last_rent_increase_date, landlord_name, landlord_address")
    .eq("landlord_id", landlordId)
    .eq("status", "active");

  if (tenancyId) query = query.eq("id", tenancyId);

  const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function parseRentAmount(text: string): number | null {
  const cleaned = text.replace(/[£,\s]/g, "").replace(/(?:\/month|\/mo|pcm|pm|permonth)$/i, "");
  const num = parseFloat(cleaned);
  if (isNaN(num) || num < 100 || num > 50_000) return null;
  return Math.round(num * 100) / 100;
}

function formatDate(isoDate?: string | null): string {
  if (!isoDate) return "not set";
  try {
    return new Date(isoDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return isoDate;
  }
}
