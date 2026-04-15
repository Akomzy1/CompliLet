/// <reference lib="deno.ns" />
/**
 * CompliLet — Move-In Pack Agent
 *
 * Runs exactly once when the landlord approves a tenant (session advances to
 * "move_in_pack"). Not conversational — it compiles all screening data,
 * generates a PDF move-in pack, distributes it to both parties, creates the
 * tenancy record, seeds compliance deadlines, then offers to generate a
 * tenancy agreement for e-signature via SignWell.
 *
 * Flow:
 *   1.  Load session + landlord + references + RTR check data.
 *   2.  Calculate tenancy start date, deposit amount (5 weeks).
 *   3.  Generate multi-page move-in pack PDF via pdf.ts.
 *   4.  Upload PDF to Supabase Storage.
 *   5.  Send PDF to landlord and tenant via WhatsApp (signed URL).
 *   6.  INSERT into tenancies table.
 *   7.  INSERT compliance_deadlines (gas, EICR, EPC, deposit protection).
 *   8.  Ask landlord if they want a tenancy agreement generated.
 *   9.  Collect landlord email + tenant email + special terms.
 *   10. Generate tenancy agreement PDF (solicitor-grade, RRA 2025 compliant).
 *   11. Upload to SignWell → send landlord signing URL.
 *   12. After landlord signs → webhook sends tenant URL (signwell-callback).
 *   13. After both sign → webhook stores signed PDF + notifies both parties.
 *   14. Call onHandoff("active_tenancy") → coordinator advances the session.
 *
 * Called by: coordinator.ts (shared module — not a separate Edge Function)
 */

import { supabase } from "../supabase.ts";
import { sendTextMessage, sendDocument } from "../whatsapp.ts";
import { generateMoveInPack, formatDate } from "../pdf.ts";
import {
  DEPOSIT_PROTECTION_DEADLINE_DAYS,
  COMPLIANCE_VALIDITY_DAYS,
  SESSION_STATUS,
} from "../constants.ts";
import type { ParsedMessage, SessionStatus } from "../types.ts";

// ─── Public interface ──────────────────────────────────────────────────────

export interface MoveInPackInput {
  /** Triggering message (landlord YES) — used only for the sender phone. */
  message: ParsedMessage;
  sessionId: string;
  landlordId: string;
  onHandoff: (nextStatus: SessionStatus, data: Record<string, unknown>) => Promise<void>;
}

// ─── Entry point ───────────────────────────────────────────────────────────

export async function runMoveInPack(input: MoveInPackInput): Promise<void> {
  const { message, sessionId, landlordId, onHandoff } = input;
  const landlordPhone = message.from;

  try {
    // ── 1. Load all source data ──────────────────────────────────────────
    const data = await loadScreeningData(sessionId, landlordId);
    if (!data) {
      await sendTextMessage(
        landlordPhone,
        "Sorry, I couldn't load the screening data to generate your move-in pack. " +
          "Please contact support.",
      );
      return;
    }

    // ── 2. Acknowledge immediately — PDF generation takes a moment ────────
    await sendTextMessage(
      landlordPhone,
      "✅ *Application approved!* Generating the move-in pack now — " +
        "I'll send it to you and the tenant in just a moment...",
    );

    // ── 3. Calculate financials ───────────────────────────────────────────
    const startDate   = tenancyStartDate();
    const depositGbp  = fiveWeeksDeposit(data.monthlyRentGbp);
    const now         = new Date().toISOString();

    // ── 4. Generate PDF ───────────────────────────────────────────────────
    const pdfBytes = await generateMoveInPack({
      generatedAt:          now,
      tenantName:           data.tenantName,
      tenantPhone:          data.tenantPhone,
      landlordName:         data.landlordName,
      propertyAddress:      data.propertyAddress,
      monthlyRentGbp:       data.monthlyRentGbp,
      depositGbp,
      tenancyStartDate:     startDate,
      tenancyDurationMonths: 12,
      screeningScore:       data.screeningScore,
      screeningDecision:    data.screeningDecision,
      rtrClassification:    data.rtrClassification,
      rtrFollowUpDate:      data.rtrFollowUpDate,
      rtrCertificateRef:    data.rtrCertificateRef,
      references:           data.references,
      lastGasSafetyDate:    data.lastGasSafetyDate,
      lastEicrDate:         data.lastEicrDate,
      epcRating:            data.epcRating,
      epcExpiryDate:        data.epcExpiryDate,
    });

    // ── 5. Upload to Supabase Storage ──────────────────────────────────────
    const dateStamp  = startDate.replace(/-/g, "");
    const storagePath = `${landlordId}/${sessionId}/move_in_pack_${dateStamp}.pdf`;
    const bucket      = Deno.env.get("MEDIA_BUCKET") ?? "tenant-documents";

    const { error: uploadErr } = await supabase.storage
      .from(bucket)
      .upload(storagePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      console.error("[move-in-pack] PDF upload failed:", uploadErr.message);
    }

    // Get a 365-day signed URL (long enough to be stored in tenant records).
    const { data: signedUrlData } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365);

    const pdfUrl = signedUrlData?.signedUrl ?? null;

    // ── 6. Send PDF to landlord ────────────────────────────────────────────
    if (pdfUrl) {
      await sendDocument(
        landlordPhone,
        pdfUrl,
        `CompliLet_Move_In_Pack_${dateStamp}.pdf`,
        `🏠 *Move-In Pack — ${data.propertyAddress}*\n\n` +
          `Here's everything you need for ${data.tenantName}'s move-in on ${formatDate(startDate)}.\n\n` +
          `Please complete the inventory checklist at key handover and keep a copy.`,
      );
    } else {
      await sendTextMessage(
        landlordPhone,
        `🏠 *Move-In Pack ready for ${data.tenantName}!*\n\n` +
          `The PDF has been generated and stored. Please contact support to retrieve it.`,
      );
    }

    // Send PDF to tenant.
    if (pdfUrl && data.tenantPhone) {
      await sendDocument(
        data.tenantPhone,
        pdfUrl,
        `CompliLet_Move_In_Pack_${dateStamp}.pdf`,
        `🎉 *Congratulations, ${data.tenantName}!* Your application has been approved.\n\n` +
          `Here is your move-in pack for *${data.propertyAddress}*.\n\n` +
          `Your tenancy starts on *${formatDate(startDate)}*. Please review the inventory ` +
          `checklist with your landlord at key handover and keep a copy of this document.`,
      );
    }

    // ── 7. Create tenancy record ───────────────────────────────────────────
    const { data: tenancy, error: tenancyErr } = await supabase
      .from("tenancies")
      .insert({
        session_id:        sessionId,
        landlord_id:       landlordId,
        tenant_phone:      data.tenantPhone,
        tenant_name:       data.tenantName,
        property_address:  data.propertyAddress,
        monthly_rent_gbp:  data.monthlyRentGbp,
        deposit_gbp:       depositGbp,
        start_date:        startDate,
        status:            "active",
        move_in_pack_url:  pdfUrl ?? null,
        screening_score:   data.screeningScore,
        created_at:        now,
        updated_at:        now,
      })
      .select("id")
      .single();

    if (tenancyErr) {
      console.error("[move-in-pack] Failed to create tenancy:", tenancyErr.message);
    }

    const tenancyId = tenancy?.id as string | undefined;

    // ── 8. Seed compliance deadlines ──────────────────────────────────────
    if (tenancyId) {
      await seedComplianceDeadlines(tenancyId, landlordId, data.propertyAddress, startDate, data);
    }

    // ── 9. Congratulations message to landlord ────────────────────────────
    await sendTextMessage(
      landlordPhone,
      `🎊 *Congratulations!* ${data.tenantName} is all set to move in on ` +
        `*${formatDate(startDate)}*.\n\n` +
        `CompliLet will now manage your ongoing compliance, rent reminders, ` +
        `and maintenance for this property.\n\n` +
        `A few things to action:\n` +
        `• Complete the inventory checklist at key handover\n` +
        `• Protect the deposit (£${depositGbp.toFixed(2)}) by *${formatDate(addDays(startDate, DEPOSIT_PROTECTION_DEADLINE_DAYS))}*\n` +
        `• Register utilities in the tenant's name\n\n` +
        `I'll send reminders for all compliance deadlines. Type *STATUS* at any time for an overview.`,
    );

    // ── 10. Pay-Per-Screen upsell ─────────────────────────────────────────
    if (data.landlordPlan === "pay_per_screen") {
      await sendTextMessage(
        landlordPhone,
        "✅ Screening complete! Note: income was verified from payslip photos.\n\n" +
        "With *Landlord Pro* (£19.99/month), your tenants' income and employment are verified " +
        "directly from HMRC, payroll, and bank records via Konfir — impossible to fake. " +
        "Reply *upgrade* to switch to Pro.",
      ).catch(() => {}); // Non-fatal — don't let upsell block session advance
    }

    // ── 11. Offer tenancy agreement generation ────────────────────────────
    if (tenancyId) {
      // Seed agreement state so the coordinator knows to enter the agreement flow
      await supabase
        .from("coordinator_state")
        .upsert(
          {
            landlord_id: landlordId,
            tenancy_agreement_state: {
              step: "awaiting_confirmation",
              tenancy_id: tenancyId,
              landlord_name: data.landlordName,
              tenant_name: data.tenantName,
              property_address: data.propertyAddress,
              monthly_rent_gbp: data.monthlyRentGbp,
              deposit_gbp: depositGbp,
              start_date: startDate,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "landlord_id" },
        );

      await sendTextMessage(
        landlordPhone,
        `📋 *Would you like a Tenancy Agreement?*\n\n` +
        `I can generate a solicitor-grade Assured Shorthold Tenancy Agreement (RRA 2025 compliant) ` +
        `for *${data.propertyAddress}* and send it to both you and ${data.tenantName} for e-signature.\n\n` +
        `Both parties sign digitally — no printing required.\n\n` +
        `Reply *YES* to generate the agreement, or *NO* to skip.`,
      );
    }

    // ── 12. Advance session ───────────────────────────────────────────────
    await onHandoff(SESSION_STATUS.ACTIVE_TENANCY, { tenancyId: tenancyId ?? null });

  } catch (err) {
    console.error("[move-in-pack] Fatal error:", err);
    await sendTextMessage(
      landlordPhone,
      "Something went wrong generating the move-in pack. Our team has been notified. " +
        "Please try again or contact support.",
    ).catch(() => {});
  }
}

// ─── Data loader ───────────────────────────────────────────────────────────

interface ScreeningData {
  tenantName:        string;
  tenantPhone:       string;
  landlordName:      string;
  landlordPlan:      string | null;
  propertyAddress:   string;
  monthlyRentGbp:    number;
  screeningScore:    number;
  screeningDecision: "recommended" | "conditional" | "not_recommended";
  rtrClassification?: string;
  rtrFollowUpDate?:  string;
  rtrCertificateRef?: string;
  references: Array<{
    type: "previous_landlord" | "employer";
    refereeName: string;
    outcome: string;
    summary: string;
  }>;
  // Compliance baseline.
  lastGasSafetyDate?: string;
  lastEicrDate?:      string;
  epcRating?:         string;
  epcExpiryDate?:     string;
}

async function loadScreeningData(
  sessionId: string,
  landlordId: string,
): Promise<ScreeningData | null> {
  // Session.
  const { data: session, error: sessionErr } = await supabase
    .from("screening_sessions")
    .select(
      "tenant_phone, property_address, monthly_rent_gbp, " +
      "pre_qualifying_summary, agent_state",
    )
    .eq("id", sessionId)
    .single();

  if (sessionErr || !session) {
    console.error("[move-in-pack] Session load failed:", sessionErr?.message);
    return null;
  }

  const preQual = (session.pre_qualifying_summary ?? {}) as Record<string, unknown>;
  const agentState = (session.agent_state ?? {}) as Record<string, unknown>;

  // Landlord.
  const { data: landlord } = await supabase
    .from("landlords")
    .select("full_name, whatsapp_number, plan")
    .eq("id", landlordId)
    .single();

  // Right to Rent check.
  const { data: rtrCheck } = await supabase
    .from("right_to_rent_checks")
    .select("classification, follow_up_date, certificate_ref")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // References.
  const { data: refs } = await supabase
    .from("reference_requests")
    .select("type, referee_name, outcome, summary")
    .eq("session_id", sessionId)
    .in("status", ["responded", "unresponsive"]);

  // Property compliance baseline (if prior records exist).
  const { data: complianceRecs } = await supabase
    .from("compliance_records")
    .select("type, certificate_date, expiry_date, epc_rating")
    .eq("property_address", session.property_address as string)
    .order("created_at", { ascending: false })
    .limit(10);

  type ComplianceRec = { type: string; certificate_date: string | null; expiry_date: string | null; epc_rating: string | null };
  const lastGas  = (complianceRecs as ComplianceRec[] | null)?.find((r) => r.type === "gas_safety");
  const lastEicr = (complianceRecs as ComplianceRec[] | null)?.find((r) => r.type === "eicr");
  const lastEpc  = (complianceRecs as ComplianceRec[] | null)?.find((r) => r.type === "epc");

  // Screening score (stored in agent_state by pre-qualifier).
  const score = ((agentState.pre_qualifying as Record<string, unknown>)?.score as number) ?? 7;
  const decisionRaw = score >= 7 ? "recommended" : score >= 5 ? "conditional" : "not_recommended";

  return {
    tenantName:        (preQual.name as string) ?? session.tenant_phone as string,
    tenantPhone:       session.tenant_phone as string,
    landlordName:      landlord?.full_name as string ?? "Landlord",
    landlordPlan:      (landlord as { plan?: string } | null)?.plan ?? null,
    propertyAddress:   session.property_address as string,
    monthlyRentGbp:    (session.monthly_rent_gbp as number) ?? 0,
    screeningScore:    score,
    screeningDecision: decisionRaw,
    rtrClassification: rtrCheck?.classification as string | undefined,
    rtrFollowUpDate:   rtrCheck?.follow_up_date as string | undefined,
    rtrCertificateRef: rtrCheck?.certificate_ref as string | undefined,
    references: (refs as Array<{ type: string; referee_name: string | null; outcome: string | null; summary: string | null }> ?? []).map((r) => ({
      type:        r.type as "previous_landlord" | "employer",
      refereeName: r.referee_name ?? "Unknown",
      outcome:     r.outcome ?? "neutral",
      summary:     r.summary ?? "",
    })),
    lastGasSafetyDate: lastGas?.certificate_date as string | undefined,
    lastEicrDate:      lastEicr?.certificate_date as string | undefined,
    epcRating:         lastEpc?.epc_rating as string | undefined,
    epcExpiryDate:     lastEpc?.expiry_date as string | undefined,
  };
}

// ─── Compliance deadline seeding ───────────────────────────────────────────

async function seedComplianceDeadlines(
  tenancyId: string,
  landlordId: string,
  propertyAddress: string,
  startDate: string,
  data: ScreeningData,
): Promise<void> {
  const now = new Date().toISOString();

  // Build deadline entries — only insert if we don't already have a future deadline.
  const deadlines: Array<{
    tenancy_id:       string;
    landlord_id:      string;
    property_address: string;
    type:             string;
    due_date:         string;
    status:           string;
    created_at:       string;
  }> = [];

  // Gas Safety — annual. Use existing cert date if available; otherwise due in 12 months.
  const gasDue = data.lastGasSafetyDate
    ? addDays(data.lastGasSafetyDate, COMPLIANCE_VALIDITY_DAYS.gas_safety!)
    : addDays(startDate, COMPLIANCE_VALIDITY_DAYS.gas_safety!);
  deadlines.push({
    tenancy_id:       tenancyId,
    landlord_id:      landlordId,
    property_address: propertyAddress,
    type:             "gas_safety",
    due_date:         gasDue,
    status:           "upcoming",
    created_at:       now,
  });

  // EICR — every 5 years.
  const eicrDue = data.lastEicrDate
    ? addDays(data.lastEicrDate, COMPLIANCE_VALIDITY_DAYS.eicr!)
    : addDays(startDate, COMPLIANCE_VALIDITY_DAYS.eicr!);
  deadlines.push({
    tenancy_id:       tenancyId,
    landlord_id:      landlordId,
    property_address: propertyAddress,
    type:             "eicr",
    due_date:         eicrDue,
    status:           "upcoming",
    created_at:       now,
  });

  // EPC — 10 years (only if we have an expiry date).
  if (data.epcExpiryDate) {
    deadlines.push({
      tenancy_id:       tenancyId,
      landlord_id:      landlordId,
      property_address: propertyAddress,
      type:             "epc",
      due_date:         data.epcExpiryDate,
      status:           "upcoming",
      created_at:       now,
    });
  }

  // Deposit protection — 30 days from move-in.
  deadlines.push({
    tenancy_id:       tenancyId,
    landlord_id:      landlordId,
    property_address: propertyAddress,
    type:             "deposit_protection",
    due_date:         addDays(startDate, DEPOSIT_PROTECTION_DEADLINE_DAYS),
    status:           "upcoming",
    created_at:       now,
  });

  // Prescribed information — same deadline as deposit protection.
  deadlines.push({
    tenancy_id:       tenancyId,
    landlord_id:      landlordId,
    property_address: propertyAddress,
    type:             "deposit_prescribed_info",
    due_date:         addDays(startDate, DEPOSIT_PROTECTION_DEADLINE_DAYS),
    status:           "upcoming",
    created_at:       now,
  });

  // How to Rent guide — must be served at tenancy start (due today).
  deadlines.push({
    tenancy_id:       tenancyId,
    landlord_id:      landlordId,
    property_address: propertyAddress,
    type:             "how_to_rent_guide",
    due_date:         startDate,
    status:           "upcoming",
    created_at:       now,
  });

  const { error } = await supabase
    .from("compliance_deadlines")
    .insert(deadlines);

  if (error) {
    console.error("[move-in-pack] Compliance deadline insert failed:", error.message);
  }
}

// ─── Utility ───────────────────────────────────────────────────────────────

/** Returns the first day of next month as an ISO date string. */
function tenancyStartDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 1);
  return d.toISOString().substring(0, 10);
}

/** Statutory deposit cap: 5 weeks' rent (Tenant Fees Act 2019). */
function fiveWeeksDeposit(monthlyRent: number): number {
  return Math.round((monthlyRent * 12 / 52) * 5 * 100) / 100;
}

/** Adds `days` to an ISO date string. Returns ISO date string. */
function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().substring(0, 10);
}
