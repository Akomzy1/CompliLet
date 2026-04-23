/**
 * CompliLet — Existing Tenancy Onboarding Agent
 *
 * Multi-turn agent that collects details of an already-active tenancy from the
 * landlord, creates property/tenancy/compliance records, messages the tenant
 * for confirmation, and runs an immediate compliance audit.
 *
 * Entry point: coordinator.ts routes here when `awaiting === "existing_tenancy_onboarding"`.
 *
 * State: `coordinator_state.existing_tenancy_state` JSONB
 *
 * Plan gating: available on landlord_pro, tenancy_manager, portfolio,
 * global_landlord. Blocked on free_trial and pay_per_screen.
 *
 * Steps:
 *   awaiting_property_address → awaiting_postcode → awaiting_tenant_name →
 *   awaiting_tenant_phone → awaiting_start_date → awaiting_rent_amount →
 *   awaiting_rent_due_day → awaiting_deposit_amount → awaiting_deposit_scheme →
 *   awaiting_deposit_reference → awaiting_gas_cert → awaiting_eicr →
 *   awaiting_epc → awaiting_agreement_choice → awaiting_agreement_upload →
 *   awaiting_htr_ris_status → complete
 *
 * Tenant-side confirmation lives on the tenancy row itself
 * (tenant_confirmation_state JSONB) and is handled by
 * `handleTenantConfirmationReply()`.
 */

import Anthropic from "npm:@anthropic-ai/sdk@0.24";
import { supabase } from "../supabase.ts";
import { sendTextMessage } from "../whatsapp.ts";
import { downloadMedia } from "../whatsapp.ts";
import { MODELS } from "../constants.ts";
import { LANDLORD_PLAN, SUBSCRIPTION_PLANS } from "../constants.ts";
import type { ParsedMessage } from "../types.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

type Step =
  | "awaiting_property_address"
  | "awaiting_postcode"
  | "awaiting_tenant_name"
  | "awaiting_tenant_phone"
  | "awaiting_start_date"
  | "awaiting_rent_amount"
  | "awaiting_rent_due_day"
  | "awaiting_deposit_amount"
  | "awaiting_deposit_scheme"
  | "awaiting_deposit_reference"
  | "awaiting_gas_cert"
  | "awaiting_eicr"
  | "awaiting_epc"
  | "awaiting_agreement_choice"
  | "awaiting_agreement_upload"
  | "awaiting_htr_ris_status"
  | "awaiting_audit_action"
  | "complete";

interface OnboardingState {
  step: Step;
  property_address?: string;
  postcode?: string;
  tenant_name?: string;
  tenant_phone?: string;
  start_date?: string;        // YYYY-MM-DD
  rent_amount?: number;
  rent_due_day?: number;
  deposit_amount?: number;
  deposit_scheme?: "tds" | "dps" | "mydeposits" | "unprotected";
  deposit_reference?: string;
  gas_cert_url?: string;
  gas_cert_expiry?: string;   // YYYY-MM-DD, null if none
  eicr_url?: string;
  eicr_expiry?: string;
  epc_url?: string;
  epc_expiry?: string;
  agreement_choice?: 1 | 2 | 3;
  agreement_url?: string;
  htr_served?: boolean;
  ris_served?: boolean;
  // Populated after persistence:
  property_id?: string;
  tenancy_id?: string;
}

export interface OnboardingInput {
  message: ParsedMessage;
  landlordId: string;
  mediaStorageUrl?: string;
}

// ─── Plan gating ─────────────────────────────────────────────────────────────

/** Returns true if the landlord's plan includes existing tenancy onboarding. */
export async function canUseExistingTenancyOnboarding(
  landlordId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("landlords")
    .select("plan")
    .eq("id", landlordId)
    .maybeSingle();

  const plan = (data as { plan?: string } | null)?.plan;
  if (!plan) return false;
  return SUBSCRIPTION_PLANS.has(plan as typeof LANDLORD_PLAN[keyof typeof LANDLORD_PLAN]);
}

// ─── Entry: start the flow ───────────────────────────────────────────────────

/** Called from coordinator when landlord chooses "2" on the entry menu. */
export async function startExistingTenancyOnboarding(
  landlordId: string,
  landlordPhone: string,
): Promise<void> {
  const allowed = await canUseExistingTenancyOnboarding(landlordId);
  if (!allowed) {
    await sendTextMessage(
      landlordPhone,
      "Existing tenancy onboarding is included in *Landlord Pro* (£19.99/month) " +
        "and above. Pay-Per-Screen covers new tenant screening only.\n\n" +
        "Type *PRICING* to see plans, or *SUBSCRIBE LANDLORD PRO* to upgrade now.",
    );
    return;
  }

  await saveState(landlordId, { step: "awaiting_property_address" });
  await setAwaitingFlag(landlordId, "existing_tenancy_onboarding");

  await sendTextMessage(
    landlordPhone,
    "Let's onboard your existing tenancy. 🏠\n\n" +
      "First — *full property address* including postcode:",
  );
}

// ─── Main step handler ──────────────────────────────────────────────────────

/** Called from coordinator when inbound message arrives and awaiting flag matches. */
export async function handleExistingTenancyOnboarding(
  input: OnboardingInput,
): Promise<void> {
  const { landlordId, message } = input;
  const phone = message.from;
  const text = (message.text ?? "").trim();

  const state = await loadState(landlordId);
  if (!state) {
    // Shouldn't happen — recover by restarting.
    await startExistingTenancyOnboarding(landlordId, phone);
    return;
  }

  try {
    switch (state.step) {
      case "awaiting_property_address":
        await stepPropertyAddress(landlordId, phone, state, text);
        break;
      case "awaiting_postcode":
        await stepPostcode(landlordId, phone, state, text);
        break;
      case "awaiting_tenant_name":
        await stepTenantName(landlordId, phone, state, text);
        break;
      case "awaiting_tenant_phone":
        await stepTenantPhone(landlordId, phone, state, text);
        break;
      case "awaiting_start_date":
        await stepStartDate(landlordId, phone, state, text);
        break;
      case "awaiting_rent_amount":
        await stepRentAmount(landlordId, phone, state, text);
        break;
      case "awaiting_rent_due_day":
        await stepRentDueDay(landlordId, phone, state, text);
        break;
      case "awaiting_deposit_amount":
        await stepDepositAmount(landlordId, phone, state, text);
        break;
      case "awaiting_deposit_scheme":
        await stepDepositScheme(landlordId, phone, state, text);
        break;
      case "awaiting_deposit_reference":
        await stepDepositReference(landlordId, phone, state, text);
        break;
      case "awaiting_gas_cert":
        await stepCertificate(landlordId, phone, state, message, "gas_safety", input.mediaStorageUrl);
        break;
      case "awaiting_eicr":
        await stepCertificate(landlordId, phone, state, message, "eicr", input.mediaStorageUrl);
        break;
      case "awaiting_epc":
        await stepCertificate(landlordId, phone, state, message, "epc", input.mediaStorageUrl);
        break;
      case "awaiting_agreement_choice":
        await stepAgreementChoice(landlordId, phone, state, text);
        break;
      case "awaiting_agreement_upload":
        await stepAgreementUpload(landlordId, phone, state, message, input.mediaStorageUrl);
        break;
      case "awaiting_htr_ris_status":
        await stepHtrRisStatus(landlordId, phone, state, text);
        break;
      case "awaiting_audit_action":
        await stepAuditAction(landlordId, phone, state, text);
        break;
      default:
        await sendTextMessage(phone, "Onboarding is already complete for this tenancy.");
        await clearAwaitingFlag(landlordId);
    }
  } catch (err) {
    console.error("[existing-tenancy-onboarding] error:", err);
    await sendTextMessage(
      phone,
      "Something went wrong — please try that step again, or type *CANCEL* to abandon onboarding.",
    );
  }
}

// ─── Step implementations ───────────────────────────────────────────────────

async function stepPropertyAddress(
  landlordId: string,
  phone: string,
  state: OnboardingState,
  text: string,
): Promise<void> {
  if (text.length < 8) {
    await sendTextMessage(phone, "Please send the *full* property address including postcode.");
    return;
  }
  const postcode = extractPostcode(text);
  const next: Partial<OnboardingState> = { property_address: text };
  if (postcode) {
    next.postcode = postcode;
    next.step = "awaiting_tenant_name";
    await saveState(landlordId, { ...state, ...next });
    await sendTextMessage(phone, "Tenant's *full name*:");
  } else {
    next.step = "awaiting_postcode";
    await saveState(landlordId, { ...state, ...next });
    await sendTextMessage(phone, "I couldn't spot a postcode. Please reply with just the postcode:");
  }
}

async function stepPostcode(
  landlordId: string,
  phone: string,
  state: OnboardingState,
  text: string,
): Promise<void> {
  const postcode = extractPostcode(text);
  if (!postcode) {
    await sendTextMessage(phone, "That doesn't look like a UK postcode. Try again, e.g. *SW1A 1AA*.");
    return;
  }
  await saveState(landlordId, { ...state, postcode, step: "awaiting_tenant_name" });
  await sendTextMessage(phone, "Tenant's *full name*:");
}

async function stepTenantName(
  landlordId: string,
  phone: string,
  state: OnboardingState,
  text: string,
): Promise<void> {
  if (text.length < 2) {
    await sendTextMessage(phone, "Please send the tenant's full name.");
    return;
  }
  await saveState(landlordId, { ...state, tenant_name: text, step: "awaiting_tenant_phone" });
  await sendTextMessage(
    phone,
    "Tenant's *WhatsApp number* (with country code, e.g. *+447700900123*):",
  );
}

async function stepTenantPhone(
  landlordId: string,
  phone: string,
  state: OnboardingState,
  text: string,
): Promise<void> {
  const normalised = normalisePhone(text);
  if (!normalised) {
    await sendTextMessage(
      phone,
      "That doesn't look like a valid number. Include the country code, e.g. *+447700900123*.",
    );
    return;
  }
  if (normalised === phone) {
    await sendTextMessage(phone, "The tenant's number can't be the same as yours. Please send the tenant's WhatsApp number.");
    return;
  }
  await saveState(landlordId, { ...state, tenant_phone: normalised, step: "awaiting_start_date" });
  await sendTextMessage(
    phone,
    "*Tenancy start date* (when did they move in?) — format *DD/MM/YYYY*:",
  );
}

async function stepStartDate(
  landlordId: string,
  phone: string,
  state: OnboardingState,
  text: string,
): Promise<void> {
  const iso = parseDateToIso(text);
  if (!iso) {
    await sendTextMessage(phone, "Couldn't read that date. Please use *DD/MM/YYYY*, e.g. *14/03/2024*.");
    return;
  }
  const startDate = new Date(iso);
  if (startDate > new Date()) {
    await sendTextMessage(
      phone,
      "That start date is in the future. For existing tenancies the start date should be in the past. Please try again.",
    );
    return;
  }
  await saveState(landlordId, { ...state, start_date: iso, step: "awaiting_rent_amount" });
  await sendTextMessage(phone, "*Current monthly rent* (in £) — just the number:");
}

async function stepRentAmount(
  landlordId: string,
  phone: string,
  state: OnboardingState,
  text: string,
): Promise<void> {
  const amount = parseMoney(text);
  if (!amount || amount <= 0 || amount > 50000) {
    await sendTextMessage(phone, "Please send the monthly rent as a number, e.g. *1850*.");
    return;
  }
  await saveState(landlordId, { ...state, rent_amount: amount, step: "awaiting_rent_due_day" });
  await sendTextMessage(phone, "*Day of the month* rent is due (1–28):");
}

async function stepRentDueDay(
  landlordId: string,
  phone: string,
  state: OnboardingState,
  text: string,
): Promise<void> {
  const day = parseInt(text.replace(/\D/g, ""), 10);
  if (!Number.isFinite(day) || day < 1 || day > 28) {
    await sendTextMessage(phone, "Pick a day between *1 and 28* (to avoid short-month issues).");
    return;
  }
  await saveState(landlordId, { ...state, rent_due_day: day, step: "awaiting_deposit_amount" });
  await sendTextMessage(phone, "*Deposit amount* held (in £) — or reply *0* if none:");
}

async function stepDepositAmount(
  landlordId: string,
  phone: string,
  state: OnboardingState,
  text: string,
): Promise<void> {
  const amount = parseMoney(text);
  if (amount === null || amount < 0) {
    await sendTextMessage(phone, "Please send the deposit amount as a number, e.g. *1850* (or *0* if none).");
    return;
  }

  // 5-week cap warning (Tenant Fees Act 2019) — annual rent < £50k
  const weeklyRent = (state.rent_amount ?? 0) * 12 / 52;
  const fiveWeekCap = weeklyRent * 5;
  const annualRent = (state.rent_amount ?? 0) * 12;
  if (annualRent < 50000 && amount > fiveWeekCap) {
    await sendTextMessage(
      phone,
      `⚠️ That deposit (£${amount}) exceeds the 5-week cap of £${fiveWeekCap.toFixed(2)} ` +
        "under the Tenant Fees Act 2019. I'll record it but this is a compliance issue you should review.",
    );
  }

  if (amount === 0) {
    // No deposit — skip scheme/reference
    await saveState(landlordId, {
      ...state,
      deposit_amount: 0,
      deposit_scheme: undefined,
      step: "awaiting_gas_cert",
    });
    await promptGasCert(phone);
    return;
  }

  await saveState(landlordId, { ...state, deposit_amount: amount, step: "awaiting_deposit_scheme" });
  await sendTextMessage(
    phone,
    "Which scheme is the deposit protected with?\n\n" +
      "1️⃣ *TDS* (Tenancy Deposit Scheme)\n" +
      "2️⃣ *DPS* (Deposit Protection Service)\n" +
      "3️⃣ *MyDeposits*\n" +
      "4️⃣ *Not protected / not sure*\n\n" +
      "Reply *1*, *2*, *3*, or *4*.",
  );
}

async function stepDepositScheme(
  landlordId: string,
  phone: string,
  state: OnboardingState,
  text: string,
): Promise<void> {
  const choice = text.trim().charAt(0);
  const schemeMap: Record<string, OnboardingState["deposit_scheme"]> = {
    "1": "tds",
    "2": "dps",
    "3": "mydeposits",
    "4": "unprotected",
  };
  const scheme = schemeMap[choice];
  if (!scheme) {
    await sendTextMessage(phone, "Please reply *1*, *2*, *3*, or *4*.");
    return;
  }
  if (scheme === "unprotected") {
    // Skip reference, move straight to certificates.
    await saveState(landlordId, {
      ...state,
      deposit_scheme: "unprotected",
      step: "awaiting_gas_cert",
    });
    await promptGasCert(phone);
    return;
  }
  await saveState(landlordId, { ...state, deposit_scheme: scheme, step: "awaiting_deposit_reference" });
  await sendTextMessage(phone, "Deposit *scheme reference number* (or reply *unknown* if you don't have it):");
}

async function stepDepositReference(
  landlordId: string,
  phone: string,
  state: OnboardingState,
  text: string,
): Promise<void> {
  const ref = text.trim().toLowerCase() === "unknown" ? undefined : text.trim();
  await saveState(landlordId, { ...state, deposit_reference: ref, step: "awaiting_gas_cert" });
  await promptGasCert(phone);
}

async function promptGasCert(phone: string): Promise<void> {
  await sendTextMessage(
    phone,
    "Now the compliance certificates — I'll ask for one at a time.\n\n" +
      "📄 *Gas safety certificate* — send a photo or PDF, or reply *none* if not applicable.",
  );
}

async function stepCertificate(
  landlordId: string,
  phone: string,
  state: OnboardingState,
  message: ParsedMessage,
  certType: "gas_safety" | "eicr" | "epc",
  mediaStorageUrl: string | undefined,
): Promise<void> {
  const text = (message.text ?? "").trim().toLowerCase();

  if (text === "none" || text === "n/a" || text === "na") {
    const next = { ...state } as OnboardingState;
    if (certType === "gas_safety") {
      next.step = "awaiting_eicr";
      await saveState(landlordId, next);
      await sendTextMessage(phone, "📄 *EICR* (Electrical Installation Condition Report) — photo, PDF, or *none*:");
      return;
    }
    if (certType === "eicr") {
      next.step = "awaiting_epc";
      await saveState(landlordId, next);
      await sendTextMessage(phone, "📄 *EPC* (Energy Performance Certificate) — photo, PDF, or *none*:");
      return;
    }
    // epc "none" → agreement
    next.step = "awaiting_agreement_choice";
    await saveState(landlordId, next);
    await promptAgreementChoice(phone);
    return;
  }

  if (!message.media || !mediaStorageUrl) {
    await sendTextMessage(phone, "Please send a photo or PDF of the certificate, or reply *none*.");
    return;
  }

  // Upload to storage and extract expiry via Claude vision.
  const storagePath = await uploadCertificate(
    landlordId,
    message.media.mediaId,
    message.media.mimeType ?? "application/octet-stream",
    certType,
  );
  const expiry = await extractCertificateExpiry(storagePath, message.media.mimeType ?? "", certType);

  const updated: OnboardingState = { ...state };
  if (certType === "gas_safety") {
    updated.gas_cert_url = storagePath;
    updated.gas_cert_expiry = expiry;
    updated.step = "awaiting_eicr";
  } else if (certType === "eicr") {
    updated.eicr_url = storagePath;
    updated.eicr_expiry = expiry;
    updated.step = "awaiting_epc";
  } else {
    updated.epc_url = storagePath;
    updated.epc_expiry = expiry;
    updated.step = "awaiting_agreement_choice";
  }
  await saveState(landlordId, updated);

  if (expiry) {
    const humanDate = formatDateUk(expiry);
    const isExpired = new Date(expiry) < new Date();
    await sendTextMessage(
      phone,
      isExpired
        ? `⚠️ Got it — but this ${certLabel(certType)} *expired on ${humanDate}*. I'll flag this as a critical gap.`
        : `✅ Got it — ${certLabel(certType)} valid until *${humanDate}*.`,
    );
  } else {
    await sendTextMessage(
      phone,
      `Got it — I couldn't read the expiry date automatically, so I'll flag this for review.`,
    );
  }

  // Advance to next prompt.
  if (certType === "gas_safety") {
    await sendTextMessage(phone, "📄 *EICR* (Electrical Installation Condition Report) — photo, PDF, or *none*:");
  } else if (certType === "eicr") {
    await sendTextMessage(phone, "📄 *EPC* (Energy Performance Certificate) — photo, PDF, or *none*:");
  } else {
    await promptAgreementChoice(phone);
  }
}

async function promptAgreementChoice(phone: string): Promise<void> {
  await sendTextMessage(
    phone,
    "Do you have a *written tenancy agreement* for this tenant?\n\n" +
      "1️⃣ Yes — I'll send you a copy\n" +
      "2️⃣ Yes, but I don't have a digital copy\n" +
      "3️⃣ No written agreement\n\n" +
      "Reply *1*, *2*, or *3*.",
  );
}

async function stepAgreementChoice(
  landlordId: string,
  phone: string,
  state: OnboardingState,
  text: string,
): Promise<void> {
  const choice = parseInt(text.trim().charAt(0), 10);
  if (choice !== 1 && choice !== 2 && choice !== 3) {
    await sendTextMessage(phone, "Please reply *1*, *2*, or *3*.");
    return;
  }

  if (choice === 1) {
    await saveState(landlordId, { ...state, agreement_choice: 1, step: "awaiting_agreement_upload" });
    await sendTextMessage(phone, "Send the *tenancy agreement* as a PDF or photo:");
    return;
  }

  await saveState(landlordId, {
    ...state,
    agreement_choice: choice as 2 | 3,
    step: "awaiting_htr_ris_status",
  });
  await promptHtrRisStatus(phone);
}

async function stepAgreementUpload(
  landlordId: string,
  phone: string,
  state: OnboardingState,
  message: ParsedMessage,
  mediaStorageUrl: string | undefined,
): Promise<void> {
  if (!message.media || !mediaStorageUrl) {
    await sendTextMessage(phone, "Please send the tenancy agreement as a PDF or photo.");
    return;
  }
  const storagePath = await uploadAgreement(
    landlordId,
    message.media.mediaId,
    message.media.mimeType ?? "application/pdf",
  );
  await saveState(landlordId, {
    ...state,
    agreement_url: storagePath,
    step: "awaiting_htr_ris_status",
  });
  await sendTextMessage(phone, "✅ Agreement saved.");
  await promptHtrRisStatus(phone);
}

async function promptHtrRisStatus(phone: string): Promise<void> {
  await sendTextMessage(
    phone,
    "Have you provided your tenant with:\n\n" +
      "• The *How to Rent* guide (required at start of tenancy)\n" +
      "• The *Renters' Rights Act Information Sheet* (required by 31 May 2026)\n\n" +
      "Reply *both*, *how to rent only*, *information sheet only*, or *neither*.",
  );
}

async function stepHtrRisStatus(
  landlordId: string,
  phone: string,
  state: OnboardingState,
  text: string,
): Promise<void> {
  const t = text.toLowerCase().trim();
  let htr = false;
  let ris = false;
  if (t === "both") { htr = true; ris = true; }
  else if (t.startsWith("how to rent")) { htr = true; }
  else if (t.startsWith("information sheet") || t === "info sheet" || t === "ris") { ris = true; }
  else if (t === "neither" || t === "none") { /* both false */ }
  else {
    await sendTextMessage(phone, "Reply *both*, *how to rent only*, *information sheet only*, or *neither*.");
    return;
  }

  const updated: OnboardingState = {
    ...state,
    htr_served: htr,
    ris_served: ris,
    step: "complete",
  };

  // Persist everything now.
  const { propertyId, tenancyId, alertsCreated } = await persistOnboarding(landlordId, updated);
  updated.property_id = propertyId;
  updated.tenancy_id = tenancyId;
  await saveState(landlordId, updated);

  await sendTextMessage(
    phone,
    `✅ Onboarding captured. I'm now messaging *${state.tenant_name}* on WhatsApp to confirm the details.\n\n` +
      (alertsCreated > 0
        ? `I've flagged *${alertsCreated}* compliance gap${alertsCreated === 1 ? "" : "s"} — you'll see the full report in a moment.`
        : "Everything looks compliant — I'll confirm once the tenant replies."),
  );

  // Message the tenant for confirmation.
  await sendTenantConfirmationRequest(tenancyId);

  // Send the landlord the compliance audit report.
  await sendComplianceAuditReport(landlordId, phone, tenancyId);

  // Section 13 eligibility check.
  await checkSection13Eligibility(landlordId, phone, updated);

  // Move to audit action state.
  await saveState(landlordId, { ...updated, step: "awaiting_audit_action" });
}

async function stepAuditAction(
  landlordId: string,
  phone: string,
  state: OnboardingState,
  text: string,
): Promise<void> {
  const choice = text.trim().charAt(0);
  switch (choice) {
    case "1":
      await sendTextMessage(
        phone,
        "Great — I'll work through the gaps one at a time. This feature is coming in a follow-up release; " +
          "for now you can address each item via normal commands (*COMPLIANCE*, *TENANCY AGREEMENT*, etc.).",
      );
      await clearAwaitingFlag(landlordId);
      await saveState(landlordId, { ...state, step: "complete" });
      break;
    case "2":
      await sendAuditDetailExpanded(landlordId, phone);
      // Stay in awaiting_audit_action so user can then pick 1 or 3.
      break;
    case "3":
      await sendTextMessage(
        phone,
        "Okay — I'll remind you about the open items in *7 days*, *14 days*, and *30 days*. " +
          "You can address them anytime by typing *COMPLIANCE*.",
      );
      await scheduleAlertReminders(landlordId, state.tenancy_id!);
      await clearAwaitingFlag(landlordId);
      await saveState(landlordId, { ...state, step: "complete" });
      break;
    default:
      await sendTextMessage(phone, "Reply *1*, *2*, or *3*.");
  }
}

// ─── Claude vision: certificate expiry extraction ───────────────────────────

async function extractCertificateExpiry(
  storagePath: string,
  mimeType: string,
  certType: "gas_safety" | "eicr" | "epc",
): Promise<string | undefined> {
  try {
    const bucket = Deno.env.get("MEDIA_BUCKET") ?? "tenant-documents";
    const { data, error } = await supabase.storage.from(bucket).download(storagePath);
    if (error || !data) {
      console.error("[existing-tenancy] couldn't read cert for vision:", error?.message);
      return undefined;
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

    const prompt =
      `This is a UK ${certLabel(certType)}. Extract the *expiry date* (when the certificate stops being valid).\n\n` +
      `Respond with JSON only: {"expiryDate": "YYYY-MM-DD"} or {"expiryDate": null} if you cannot determine it. ` +
      `For EPCs, use the "valid until" date (10 years from issue). ` +
      `For gas safety, use "next inspection due" (12 months from inspection date). ` +
      `For EICR, use "next inspection due" (5 years from inspection date).`;

    const content: Anthropic.ContentBlockParam[] = [];
    if (mimeType === "application/pdf") {
      content.push({
        type: "document" as const,
        source: {
          type: "base64" as const,
          media_type: "application/pdf" as const,
          data: toBase64(bytes),
        },
      } as unknown as Anthropic.ContentBlockParam);
    } else {
      const imageMediaType = (
        mimeType.startsWith("image/") ? mimeType : "image/jpeg"
      ) as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      content.push({
        type: "image",
        source: { type: "base64", media_type: imageMediaType, data: toBase64(bytes) },
      });
    }
    content.push({ type: "text", text: prompt });

    const response = await anthropic.messages.create({
      model: MODELS.ACCURATE,
      max_tokens: 200,
      messages: [{ role: "user", content }],
    });

    const raw = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("")
      .trim();
    const match = /\{[\s\S]*\}/.exec(raw);
    if (!match) return undefined;
    const parsed = JSON.parse(match[0]) as { expiryDate: string | null };
    if (!parsed.expiryDate) return undefined;
    // Validate YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.expiryDate)) return undefined;
    return parsed.expiryDate;
  } catch (err) {
    console.error("[existing-tenancy] vision extraction failed:", err);
    return undefined;
  }
}

// ─── Persistence: property, tenancy, deadlines, alerts ──────────────────────

async function persistOnboarding(
  landlordId: string,
  state: OnboardingState,
): Promise<{ propertyId: string; tenancyId: string; alertsCreated: number }> {
  // 1. Find or create property.
  const { data: existingProp } = await supabase
    .from("properties")
    .select("id")
    .eq("landlord_id", landlordId)
    .eq("address", state.property_address!)
    .maybeSingle();

  let propertyId: string;
  if (existingProp?.id) {
    propertyId = existingProp.id as string;
  } else {
    const { data: newProp, error } = await supabase
      .from("properties")
      .insert({
        landlord_id: landlordId,
        address: state.property_address!,
        postcode: state.postcode ?? null,
        rent_amount: state.rent_amount ?? null,
        epc_expiry: state.epc_expiry ?? null,
      })
      .select("id")
      .single();
    if (error || !newProp) throw new Error(`property insert failed: ${error?.message}`);
    propertyId = newProp.id as string;
  }

  // 2. Create tenancy.
  const { data: tenancy, error: tenancyErr } = await supabase
    .from("tenancies")
    .insert({
      property_id: propertyId,
      tenant_phone: state.tenant_phone!,
      tenant_name: state.tenant_name ?? null,
      start_date: state.start_date!,
      rent_amount: state.rent_amount!,
      rent_due_day: state.rent_due_day!,
      status: "active",
      onboarding_type: "existing",
      deposit_amount: state.deposit_amount ?? null,
      deposit_scheme: state.deposit_scheme ?? null,
      deposit_reference: state.deposit_reference ?? null,
      agreement_url: state.agreement_url ?? null,
    })
    .select("id")
    .single();
  if (tenancyErr || !tenancy) throw new Error(`tenancy insert failed: ${tenancyErr?.message}`);
  const tenancyId = tenancy.id as string;

  // 3. Create compliance_deadlines for each cert with an expiry.
  const deadlineRows: Array<Record<string, unknown>> = [];
  if (state.gas_cert_expiry) {
    deadlineRows.push({
      property_id: propertyId,
      type: "gas_safety",
      due_date: state.gas_cert_expiry,
      last_completed: null,
      certificate_url: state.gas_cert_url ?? null,
      status: new Date(state.gas_cert_expiry) < new Date() ? "overdue" : "pending",
    });
  }
  if (state.eicr_expiry) {
    deadlineRows.push({
      property_id: propertyId,
      type: "eicr",
      due_date: state.eicr_expiry,
      last_completed: null,
      certificate_url: state.eicr_url ?? null,
      status: new Date(state.eicr_expiry) < new Date() ? "overdue" : "pending",
    });
  }
  if (state.epc_expiry) {
    deadlineRows.push({
      property_id: propertyId,
      type: "epc",
      due_date: state.epc_expiry,
      last_completed: null,
      certificate_url: state.epc_url ?? null,
      status: new Date(state.epc_expiry) < new Date() ? "overdue" : "pending",
    });
  }
  if (deadlineRows.length > 0) {
    await supabase.from("compliance_deadlines").insert(deadlineRows);
  }

  // 4. Create compliance_alerts for each gap.
  const alerts: Array<Record<string, unknown>> = [];
  const mkAlert = (type: string, severity: string, description: string) => ({
    tenancy_id: tenancyId,
    property_id: propertyId,
    landlord_id: landlordId,
    alert_type: type,
    severity,
    description,
  });

  if (state.deposit_scheme === "unprotected" && (state.deposit_amount ?? 0) > 0) {
    alerts.push(mkAlert(
      "unprotected_deposit",
      "critical",
      `Deposit of £${state.deposit_amount} is not protected. Under the Housing Act 2004 this can expose the landlord to a penalty of up to 3x the deposit and bar Section 21 notices.`,
    ));
  }
  if (!state.gas_cert_expiry) {
    alerts.push(mkAlert("missing_gas_cert", "high", "No current gas safety certificate on file."));
  } else if (new Date(state.gas_cert_expiry) < new Date()) {
    alerts.push(mkAlert("expired_gas_cert", "critical", `Gas safety certificate expired on ${formatDateUk(state.gas_cert_expiry)}.`));
  }
  if (!state.eicr_expiry) {
    alerts.push(mkAlert("missing_eicr", "high", "No current EICR on file."));
  } else if (new Date(state.eicr_expiry) < new Date()) {
    alerts.push(mkAlert("expired_eicr", "critical", `EICR expired on ${formatDateUk(state.eicr_expiry)}.`));
  }
  if (!state.epc_expiry) {
    alerts.push(mkAlert("missing_epc", "medium", "No current EPC on file."));
  } else if (new Date(state.epc_expiry) < new Date()) {
    alerts.push(mkAlert("expired_epc", "high", `EPC expired on ${formatDateUk(state.epc_expiry)}.`));
  }
  if (state.agreement_choice === 2) {
    alerts.push(mkAlert(
      "missing_agreement_digital",
      "medium",
      "Written agreement exists but no digital copy on file — hard to serve electronically.",
    ));
  }
  if (state.agreement_choice === 3) {
    alerts.push(mkAlert(
      "no_written_agreement",
      "high",
      "No written tenancy agreement. From 1 May 2026, the Renters' Rights Act requires mandatory written information to be provided.",
    ));
  }
  if (!state.htr_served) {
    alerts.push(mkAlert(
      "missing_how_to_rent_guide",
      "high",
      "How to Rent guide was not served at the start of the tenancy. This prevents serving a valid Section 21 notice.",
    ));
  }
  if (!state.ris_served) {
    alerts.push(mkAlert(
      "missing_rra_information_sheet",
      "medium",
      "Renters' Rights Act Information Sheet not served. Required by 31 May 2026.",
    ));
  }

  if (alerts.length > 0) {
    await supabase.from("compliance_alerts").insert(alerts);
  }

  return { propertyId, tenancyId, alertsCreated: alerts.length };
}

// ─── Tenant confirmation message ────────────────────────────────────────────

async function sendTenantConfirmationRequest(tenancyId: string): Promise<void> {
  const { data: tenancy } = await supabase
    .from("tenancies")
    .select(`
      tenant_phone,
      tenant_name,
      start_date,
      rent_amount,
      rent_due_day,
      deposit_amount,
      deposit_scheme,
      deposit_reference,
      properties ( address, landlord_id, landlords ( name ) )
    `)
    .eq("id", tenancyId)
    .single();

  if (!tenancy) return;

  const t = tenancy as unknown as {
    tenant_phone: string;
    tenant_name: string;
    start_date: string;
    rent_amount: number;
    rent_due_day: number;
    deposit_amount: number | null;
    deposit_scheme: string | null;
    deposit_reference: string | null;
    properties: { address: string; landlords: { name: string } };
  };

  const landlordName = t.properties.landlords.name ?? "your landlord";
  const schemeLabel = t.deposit_scheme
    ? ({ tds: "TDS", dps: "DPS", mydeposits: "MyDeposits", unprotected: "not protected" }[t.deposit_scheme] ?? t.deposit_scheme)
    : null;

  const depositLine = t.deposit_amount && schemeLabel
    ? `Deposit: £${t.deposit_amount} protected with ${schemeLabel}${t.deposit_reference ? ` (ref: ${t.deposit_reference})` : ""}\n`
    : "";

  // Seed confirmation state on the tenancy row.
  await supabase.from("tenancies").update({
    tenant_confirmation_state: { step: "awaiting_confirmation", sent_at: new Date().toISOString() },
  }).eq("id", tenancyId);

  await sendTextMessage(
    t.tenant_phone,
    `Hi ${t.tenant_name}, this is *CompliLet*. Your landlord ${landlordName} has started using our service ` +
      `to manage your tenancy at ${t.properties.address}.\n\n` +
      "CompliLet is a WhatsApp-based platform that helps with:\n" +
      "✓ Reporting repairs (with photos, tracked automatically)\n" +
      "✓ Rent reminders if needed\n" +
      "✓ Deposit protection proof anytime you ask\n" +
      "✓ Tenancy agreement access\n" +
      "✓ Contact with your landlord through one consistent number\n\n" +
      "Your landlord has provided these details — can you confirm they're correct?\n\n" +
      `Property: ${t.properties.address}\n` +
      `Tenancy started: ${formatDateUk(t.start_date)}\n` +
      `Monthly rent: £${t.rent_amount} due on the ${ordinal(t.rent_due_day)} of each month\n` +
      depositLine +
      "\nReply *yes* to confirm, or *correction* if something's wrong.",
  );
}

/** Called from coordinator when a tenant replies during the confirmation stage. */
export async function handleTenantConfirmationReply(
  tenantPhone: string,
  messageText: string,
): Promise<boolean> {
  // Find an unconfirmed tenancy for this phone.
  const { data: tenancies } = await supabase
    .from("tenancies")
    .select("id, tenant_confirmation_state, property_id, properties ( address, landlord_id, landlords ( phone, name ) )")
    .eq("tenant_phone", tenantPhone)
    .is("tenant_confirmed_at", null)
    .eq("onboarding_type", "existing")
    .order("created_at", { ascending: false })
    .limit(1);

  if (!tenancies || tenancies.length === 0) return false;

  const row = tenancies[0] as unknown as {
    id: string;
    tenant_confirmation_state: { step: string } | null;
    property_id: string;
    properties: { address: string; landlord_id: string; landlords: { phone: string; name: string } };
  };

  const text = messageText.trim().toLowerCase();
  const state = row.tenant_confirmation_state ?? { step: "awaiting_confirmation" };

  if (state.step === "awaiting_confirmation") {
    if (text === "yes" || text === "confirm" || text === "correct" || text === "y") {
      await supabase.from("tenancies").update({
        tenant_confirmed_at: new Date().toISOString(),
        tenant_confirmation_state: null,
      }).eq("id", row.id);

      await sendTextMessage(
        tenantPhone,
        `Thanks for confirming. You're now set up on CompliLet. Save this number as ` +
          `*CompliLet – ${row.properties.landlords.name}* in your contacts.\n\n` +
          "Things you can do anytime:\n" +
          "• Report a repair: describe the issue or send a photo\n" +
          "• Request your tenancy agreement: type *send tenancy agreement*\n" +
          "• Check your deposit: type *deposit status*\n" +
          "• Ask about your rights: type *my rights*\n\n" +
          "I'll remind you about rent due dates, send you important notices from your landlord, " +
          "and help coordinate any maintenance visits.",
      );

      // Notify landlord.
      await sendTextMessage(
        row.properties.landlords.phone,
        `✅ Your tenant confirmed the tenancy details for *${row.properties.address}*. ` +
          "They're now active on CompliLet.",
      );
      return true;
    }
    if (text === "correction" || text === "wrong" || text === "incorrect") {
      await supabase.from("tenancies").update({
        tenant_confirmation_state: { step: "awaiting_correction_detail", sent_at: new Date().toISOString() },
      }).eq("id", row.id);
      await sendTextMessage(
        tenantPhone,
        "What's incorrect? Send a short note (e.g. *rent is actually £1,900* or *I moved in 1 March 2024*) " +
          "and I'll pass it to your landlord.",
      );
      return true;
    }
    // Didn't understand — re-prompt.
    await sendTextMessage(tenantPhone, "Please reply *yes* to confirm, or *correction* if something's wrong.");
    return true;
  }

  if (state.step === "awaiting_correction_detail") {
    // Forward to landlord for approval.
    await supabase.from("tenancies").update({
      tenant_confirmation_state: { step: "awaiting_landlord_resolution", correction: messageText, sent_at: new Date().toISOString() },
    }).eq("id", row.id);

    await sendTextMessage(
      row.properties.landlords.phone,
      `⚠️ *Tenant correction for ${row.properties.address}*\n\n` +
        `Your tenant says:\n"${messageText}"\n\n` +
        `Reply *ACCEPT* to update the record, or *REJECT* to keep the current details.`,
    );

    await sendTextMessage(
      tenantPhone,
      "Thanks — I've passed that on to your landlord. I'll confirm once they respond.",
    );
    return true;
  }

  // awaiting_landlord_resolution: tenant shouldn't reply here, but acknowledge.
  await sendTextMessage(
    tenantPhone,
    "I've already passed your correction to your landlord — waiting on their response.",
  );
  return true;
}

// ─── Compliance audit report ────────────────────────────────────────────────

async function sendComplianceAuditReport(
  landlordId: string,
  landlordPhone: string,
  tenancyId: string,
): Promise<void> {
  const { data: t } = await supabase
    .from("tenancies")
    .select(`
      deposit_scheme,
      deposit_amount,
      agreement_url,
      properties ( address )
    `)
    .eq("id", tenancyId)
    .single();

  const { data: alerts } = await supabase
    .from("compliance_alerts")
    .select("alert_type, severity, description")
    .eq("tenancy_id", tenancyId)
    .eq("resolved", false);

  const alertsList = (alerts ?? []) as Array<{ alert_type: string; severity: string; description: string }>;
  const alertTypes = new Set(alertsList.map((a) => a.alert_type));

  const check = (ok: boolean) => (ok ? "✅" : "❌");

  const depositOk = (t as unknown as { deposit_scheme?: string } | null)?.deposit_scheme &&
    (t as unknown as { deposit_scheme?: string }).deposit_scheme !== "unprotected";
  const gasOk = !alertTypes.has("missing_gas_cert") && !alertTypes.has("expired_gas_cert");
  const eicrOk = !alertTypes.has("missing_eicr") && !alertTypes.has("expired_eicr");
  const epcOk = !alertTypes.has("missing_epc") && !alertTypes.has("expired_epc");
  const agreementOk = !alertTypes.has("no_written_agreement") && !alertTypes.has("missing_agreement_digital");
  const htrOk = !alertTypes.has("missing_how_to_rent_guide");
  const risOk = !alertTypes.has("missing_rra_information_sheet");

  const address = (t as unknown as { properties?: { address?: string } } | null)?.properties?.address ?? "the property";

  const summary = alertsList.length === 0
    ? "🎉 All compliance checks passed."
    : `You have *${alertsList.length}* compliance item${alertsList.length === 1 ? "" : "s"} that need${alertsList.length === 1 ? "s" : ""} attention.`;

  await sendTextMessage(
    landlordPhone,
    `*Compliance check — ${address}*\n\n` +
      `${check(!!depositOk)} Deposit protected\n` +
      `${check(gasOk)} Gas safety certificate current\n` +
      `${check(eicrOk)} EICR current\n` +
      `${check(epcOk)} EPC current\n` +
      `${check(agreementOk)} Tenancy agreement on file\n` +
      `${check(htrOk)} How to Rent guide served\n` +
      `${check(risOk)} Renters' Rights Act Information Sheet served (required by 31 May 2026)\n` +
      `☑️ Landlord insurance — please confirm in a follow-up\n\n` +
      `${summary}\n\n` +
      "Would you like to:\n" +
      "1️⃣ Address the missing items now\n" +
      "2️⃣ See more detail on what each item means\n" +
      "3️⃣ Address them later (I'll remind you)\n\n" +
      "Reply *1*, *2*, or *3*.",
  );
}

async function sendAuditDetailExpanded(landlordId: string, landlordPhone: string): Promise<void> {
  const { data: state } = await supabase
    .from("coordinator_state")
    .select("existing_tenancy_state")
    .eq("landlord_id", landlordId)
    .maybeSingle();
  const tenancyId = (state?.existing_tenancy_state as OnboardingState | null)?.tenancy_id;
  if (!tenancyId) return;

  const { data: alerts } = await supabase
    .from("compliance_alerts")
    .select("alert_type, severity, description")
    .eq("tenancy_id", tenancyId)
    .eq("resolved", false);

  if (!alerts || alerts.length === 0) {
    await sendTextMessage(landlordPhone, "No outstanding items. 🎉");
    return;
  }

  const lines = (alerts as Array<{ alert_type: string; severity: string; description: string }>).map((a) => {
    const fineNote = FINE_AMOUNTS[a.alert_type];
    return `*${a.alert_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}* _(${a.severity})_\n${a.description}${fineNote ? `\nPotential fine: ${fineNote}` : ""}`;
  });

  await sendTextMessage(
    landlordPhone,
    `*Detail on open compliance items*\n\n${lines.join("\n\n")}\n\n` +
      "Reply *1* to start addressing them, or *3* to deal with them later.",
  );
}

const FINE_AMOUNTS: Record<string, string> = {
  unprotected_deposit: "up to 3× the deposit value plus bar on Section 21",
  missing_gas_cert: "unlimited fine + 6 months in prison (Gas Safety Regulations 1998)",
  expired_gas_cert: "unlimited fine + 6 months in prison (Gas Safety Regulations 1998)",
  missing_eicr: "up to £30,000 (Electrical Safety Standards Regs 2020)",
  expired_eicr: "up to £30,000 (Electrical Safety Standards Regs 2020)",
  missing_epc: "up to £5,000 (MEES Regulations)",
  expired_epc: "up to £5,000 (MEES Regulations)",
  missing_how_to_rent_guide: "blocks valid Section 21 notices",
  no_written_agreement: "non-compliance with Renters' Rights Act 2025",
  missing_rra_information_sheet: "breach of Renters' Rights Act 2025 (by 31 May 2026)",
};

// ─── Section 13 eligibility check ───────────────────────────────────────────

async function checkSection13Eligibility(
  landlordId: string,
  landlordPhone: string,
  state: OnboardingState,
): Promise<void> {
  if (!state.start_date) return;
  const startDate = new Date(state.start_date);
  const monthsSince = (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
  if (monthsSince < 12) return;

  await sendTextMessage(
    landlordPhone,
    `📈 *Section 13 note*\n\n` +
      `${state.tenant_name ?? "Your tenant"} has been at ${state.property_address} for *${Math.floor(monthsSince)} months*. ` +
      "Under Section 13 of the Housing Act 1988 (as amended by the Renters' Rights Act), you can issue a rent " +
      "increase once every 12 months with 2 months' notice.\n\n" +
      "Type *RENT REVIEW* anytime and I'll check local market rents and help you prepare a Section 13 notice.",
  );

  // Also remind landlord that rent monitoring will activate from next due date.
  const nextDueDate = computeNextRentDue(state.rent_due_day ?? 1);
  await sendTextMessage(
    landlordPhone,
    `💷 Rent monitoring will activate from the next rent due date (*${formatDateUk(nextDueDate)}*). ` +
      "I'll check with you each month whether rent has arrived and escalate any arrears if they occur.",
  );
}

// ─── Reminders scheduling ───────────────────────────────────────────────────

async function scheduleAlertReminders(landlordId: string, tenancyId: string): Promise<void> {
  // Compliance reminders run on a cron; here we just ensure the alerts carry
  // the right tenancy_id so the cron picks them up. No additional scheduling
  // is needed — the alert rows themselves are the source of truth.
  // If a bespoke reminder schedule is needed later, insert rows here.
  const _ = { landlordId, tenancyId };
}

// ─── Helpers: state persistence ─────────────────────────────────────────────

async function loadState(landlordId: string): Promise<OnboardingState | null> {
  const { data } = await supabase
    .from("coordinator_state")
    .select("existing_tenancy_state")
    .eq("landlord_id", landlordId)
    .maybeSingle();
  return (data?.existing_tenancy_state as OnboardingState | undefined) ?? null;
}

async function saveState(landlordId: string, state: OnboardingState): Promise<void> {
  await supabase.from("coordinator_state").upsert(
    {
      landlord_id: landlordId,
      existing_tenancy_state: state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "landlord_id" },
  );
}

async function setAwaitingFlag(landlordId: string, flag: string): Promise<void> {
  await supabase.from("coordinator_state").upsert(
    {
      landlord_id: landlordId,
      awaiting: flag,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "landlord_id" },
  );
}

async function clearAwaitingFlag(landlordId: string): Promise<void> {
  await supabase.from("coordinator_state").update({
    awaiting: null,
    updated_at: new Date().toISOString(),
  }).eq("landlord_id", landlordId);
}

// ─── Helpers: upload media ──────────────────────────────────────────────────

async function uploadCertificate(
  landlordId: string,
  mediaId: string,
  mimeType: string,
  certType: string,
): Promise<string> {
  const bucket = Deno.env.get("MEDIA_BUCKET") ?? "tenant-documents";
  const ext = extFromMime(mimeType);
  const path = `${landlordId}/existing-tenancy/${certType}-${Date.now()}.${ext}`;
  const bytes = await downloadMedia(mediaId);
  await supabase.storage.from(bucket).upload(path, bytes, { contentType: mimeType, upsert: true });
  return path;
}

async function uploadAgreement(
  landlordId: string,
  mediaId: string,
  mimeType: string,
): Promise<string> {
  const bucket = Deno.env.get("MEDIA_BUCKET") ?? "tenant-documents";
  const ext = extFromMime(mimeType);
  const path = `${landlordId}/existing-tenancy/agreement-${Date.now()}.${ext}`;
  const bytes = await downloadMedia(mediaId);
  await supabase.storage.from(bucket).upload(path, bytes, { contentType: mimeType, upsert: true });
  return path;
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

function extractPostcode(text: string): string | undefined {
  const m = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i.exec(text);
  return m ? m[1].toUpperCase().replace(/\s+/, " ") : undefined;
}

function normalisePhone(raw: string): string | undefined {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+") && digits.length >= 10 && digits.length <= 16) return digits;
  if (digits.startsWith("00") && digits.length >= 12) return "+" + digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) return "+44" + digits.slice(1);
  if (digits.length >= 10 && digits.length <= 15) return "+" + digits;
  return undefined;
}

function parseDateToIso(text: string): string | undefined {
  // DD/MM/YYYY or DD-MM-YYYY
  const m = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/.exec(text.trim());
  if (!m) return undefined;
  let [_, dd, mm, yy] = m;
  if (yy.length === 2) yy = "20" + yy;
  const day = parseInt(dd, 10);
  const month = parseInt(mm, 10);
  const year = parseInt(yy, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2100) return undefined;
  const iso = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  // Validate it's a real date.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return iso;
}

function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[£,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100) / 100;
}

function formatDateUk(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function certLabel(certType: "gas_safety" | "eicr" | "epc"): string {
  return { gas_safety: "gas safety certificate", eicr: "EICR", epc: "EPC" }[certType];
}

function extFromMime(mime: string): string {
  if (mime.startsWith("image/jpeg")) return "jpg";
  if (mime.startsWith("image/png")) return "png";
  if (mime.startsWith("image/webp")) return "webp";
  if (mime.startsWith("image/heic") || mime.startsWith("image/heif")) return "heic";
  if (mime === "application/pdf") return "pdf";
  return "bin";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function computeNextRentDue(rentDueDay: number): string {
  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  if (now.getUTCDate() >= rentDueDay) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  const d = new Date(Date.UTC(year, month, rentDueDay));
  return d.toISOString().slice(0, 10);
}
