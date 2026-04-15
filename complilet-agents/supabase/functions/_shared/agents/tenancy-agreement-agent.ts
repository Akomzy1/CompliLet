/**
 * CompliLet — Tenancy Agreement Agent
 *
 * Multi-turn conversational agent that guides a landlord through
 * generating and e-signing a tenancy agreement via SignWell.
 *
 * This agent is entered via coordinator_state.tenancy_agreement_state,
 * which is seeded by the Move-In Pack agent after a successful move-in.
 *
 * Conversation steps:
 *
 *   awaiting_confirmation
 *     Landlord replied YES/NO to "Would you like a tenancy agreement?"
 *     YES  → ask for landlord email
 *     NO   → clear state, done
 *
 *   awaiting_landlord_email
 *     Collect the landlord's email address for SignWell.
 *     → ask for tenant email
 *
 *   awaiting_tenant_email
 *     Collect the tenant's email address for SignWell.
 *     → ask for special terms (or skip)
 *
 *   awaiting_special_terms
 *     Landlord provides any special terms, or replies "NONE" / "SKIP".
 *     → generate PDF, upload to SignWell, send landlord signing link
 *
 *   After both sign — handled entirely by signwell-callback Edge Function.
 *
 * State shape stored in coordinator_state.tenancy_agreement_state (JSONB):
 * {
 *   step: string,
 *   tenancy_id: string,
 *   landlord_name: string,
 *   landlord_email?: string,
 *   tenant_name: string,
 *   tenant_email?: string,
 *   property_address: string,
 *   monthly_rent_gbp: number,
 *   deposit_gbp: number,
 *   start_date: string,
 *   special_terms?: string,
 * }
 */

import { supabase } from "../supabase.ts";
import { sendTextMessage } from "../whatsapp.ts";
import { generateTenancyAgreement } from "../pdf/tenancy-agreement.ts";
import { createSignatureRequest } from "../signwell.ts";

// ─── Types ─────────────────────────────────────────────────────────────────

interface AgreementState {
  step: string;
  tenancy_id: string;
  landlord_name: string;
  landlord_email?: string;
  tenant_name: string;
  tenant_email?: string;
  property_address: string;
  monthly_rent_gbp: number;
  deposit_gbp: number;
  start_date: string;
  deposit_scheme?: string;
  rent_due_day?: number;
  landlord_address?: string;
  special_terms?: string;
}

export interface TenancyAgreementInput {
  landlordId: string;
  landlordPhone: string;
  inboundText: string;
}

// ─── Entry Point ────────────────────────────────────────────────────────────

export async function runTenancyAgreementAgent(
  input: TenancyAgreementInput,
): Promise<void> {
  const { landlordId, landlordPhone, inboundText } = input;
  const text = inboundText.trim();

  // Load current state from DB
  const { data: row } = await supabase
    .from("coordinator_state")
    .select("tenancy_agreement_state")
    .eq("landlord_id", landlordId)
    .maybeSingle();

  const state = (row?.tenancy_agreement_state ?? {}) as AgreementState;

  try {
    switch (state.step) {
      case "awaiting_confirmation":
        await handleConfirmation(state, landlordId, landlordPhone, text);
        break;

      case "awaiting_landlord_email":
        await handleLandlordEmail(state, landlordId, landlordPhone, text);
        break;

      case "awaiting_tenant_email":
        await handleTenantEmail(state, landlordId, landlordPhone, text);
        break;

      case "awaiting_special_terms":
        await handleSpecialTerms(state, landlordId, landlordPhone, text);
        break;

      default:
        // Unknown step — clear state
        await clearState(landlordId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tenancy-agreement-agent] Error:", message);
    await sendTextMessage(
      landlordPhone,
      "Sorry, I hit an error generating the tenancy agreement. " +
        "Please try again or type *HELP* to contact support.",
    ).catch(() => {});
    await clearState(landlordId);
  }
}

// ─── Step Handlers ──────────────────────────────────────────────────────────

async function handleConfirmation(
  state: AgreementState,
  landlordId: string,
  landlordPhone: string,
  text: string,
): Promise<void> {
  const upper = text.toUpperCase().replace(/\s+/g, "");

  if (upper === "YES" || upper === "Y") {
    // Advance to collecting landlord email
    await saveState(landlordId, { ...state, step: "awaiting_landlord_email" });
    await sendTextMessage(
      landlordPhone,
      `📋 *Tenancy Agreement — Step 1 of 3*\n\n` +
        `Please enter *your email address* so SignWell can send you the signing link.\n\n` +
        `_Example: john@example.com_`,
    );
  } else if (upper === "NO" || upper === "N" || upper === "SKIP") {
    await clearState(landlordId);
    await sendTextMessage(
      landlordPhone,
      "No problem — I've skipped the tenancy agreement. " +
        "You can request one at any time by typing *AGREEMENT*.",
    );
  } else {
    // Reprompt
    await sendTextMessage(
      landlordPhone,
      "Please reply *YES* to generate a tenancy agreement or *NO* to skip.",
    );
  }
}

async function handleLandlordEmail(
  state: AgreementState,
  landlordId: string,
  landlordPhone: string,
  text: string,
): Promise<void> {
  if (!isValidEmail(text)) {
    await sendTextMessage(
      landlordPhone,
      "That doesn't look like a valid email address. Please try again.\n\n" +
        "_Example: john@example.com_",
    );
    return;
  }

  await saveState(landlordId, {
    ...state,
    step: "awaiting_tenant_email",
    landlord_email: text.toLowerCase(),
  });

  await sendTextMessage(
    landlordPhone,
    `✅ Got it.\n\n` +
      `📋 *Tenancy Agreement — Step 2 of 3*\n\n` +
      `Now please enter *${state.tenant_name}'s email address* ` +
      `so they can receive their signing link.\n\n` +
      `_Example: tenant@example.com_`,
  );
}

async function handleTenantEmail(
  state: AgreementState,
  landlordId: string,
  landlordPhone: string,
  text: string,
): Promise<void> {
  if (!isValidEmail(text)) {
    await sendTextMessage(
      landlordPhone,
      "That doesn't look like a valid email address. Please try again.\n\n" +
        "_Example: tenant@example.com_",
    );
    return;
  }

  await saveState(landlordId, {
    ...state,
    step: "awaiting_special_terms",
    tenant_email: text.toLowerCase(),
  });

  await sendTextMessage(
    landlordPhone,
    `✅ Got it.\n\n` +
      `📋 *Tenancy Agreement — Step 3 of 3*\n\n` +
      `Are there any special terms you'd like to add to the agreement? ` +
      `For example: "No smoking", "Landlord supplies white goods", "Pets permitted — 1 dog".\n\n` +
      `Reply *NONE* or *SKIP* if there are no special terms.`,
  );
}

async function handleSpecialTerms(
  state: AgreementState,
  landlordId: string,
  landlordPhone: string,
  text: string,
): Promise<void> {
  const upper = text.toUpperCase().replace(/\s+/g, "");
  const specialTerms =
    upper === "NONE" || upper === "SKIP" || upper === "N/A" ? undefined : text;

  await sendTextMessage(
    landlordPhone,
    `⏳ *Generating your tenancy agreement...*\n\n` +
      `This takes just a moment. I'll send you the signing link as soon as it's ready.`,
  );

  // Load full tenancy data to fill remaining fields
  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("deposit_gbp, monthly_rent_gbp, start_date, landlord_name, landlord_address")
    .eq("id", state.tenancy_id)
    .maybeSingle();

  const depositScheme = "MyDeposits"; // TODO: make configurable per landlord
  const rentDueDay = 1; // TODO: read from tenancy row if stored

  // Generate the PDF
  const pdfBytes = await generateTenancyAgreement({
    landlordName:    state.landlord_name,
    landlordAddress: (tenancy?.landlord_address as string | null) ?? "Address on file",
    landlordEmail:   state.landlord_email!,
    tenantName:      state.tenant_name,
    tenantEmail:     state.tenant_email!,
    propertyAddress: state.property_address,
    monthlyRentGbp:  (tenancy?.monthly_rent_gbp as number) ?? state.monthly_rent_gbp,
    depositGbp:      (tenancy?.deposit_gbp as number) ?? state.deposit_gbp,
    startDate:       (tenancy?.start_date as string) ?? state.start_date,
    rentDueDay,
    depositScheme,
    specialTerms,
    sessionId:   state.tenancy_id,
    generatedAt: new Date().toISOString(),
  });

  // Upload unsigned PDF to Supabase Storage for record-keeping
  const bucket = Deno.env.get("MEDIA_BUCKET") ?? "tenant-documents";
  const dateStamp = new Date().toISOString().substring(0, 10).replace(/-/g, "");
  const storagePath = `${landlordId}/${state.tenancy_id}/tenancy_agreement_unsigned_${dateStamp}.pdf`;

  await supabase.storage
    .from(bucket)
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });

  // Build SignWell callback URL
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const callbackUrl = `${supabaseUrl}/functions/v1/signwell-callback`;

  // Create the SignWell signature request
  const signwellDoc = await createSignatureRequest({
    pdfBytes,
    name: `Tenancy Agreement — ${state.property_address}`,
    landlordName:    state.landlord_name,
    landlordEmail:   state.landlord_email!,
    tenantName:      state.tenant_name,
    tenantEmail:     state.tenant_email!,
    propertyAddress: state.property_address,
    sessionId:       state.tenancy_id,
    callbackUrl,
  });

  // Store SignWell document ID on the tenancy row
  await supabase
    .from("tenancies")
    .update({
      signwell_document_id: signwellDoc.id,
      updated_at:           new Date().toISOString(),
    })
    .eq("id", state.tenancy_id);

  // Get the landlord's signing URL from the response
  const landlordRecipient = signwellDoc.recipients.find((r) => r.sequence === 1);
  const signingUrl = landlordRecipient?.signing_url;

  // Clear the state — from here the webhook takes over
  await clearState(landlordId);

  if (signingUrl) {
    await sendTextMessage(
      landlordPhone,
      `✅ *Your Tenancy Agreement is ready to sign!*\n\n` +
        `Property: *${state.property_address}*\n` +
        `Tenant: ${state.tenant_name}\n\n` +
        `Please click the link below to review and sign:\n` +
        `${signingUrl}\n\n` +
        `Once you've signed, ${state.tenant_name} will automatically receive their link. ` +
        `The fully signed agreement will be sent to both of you by email and WhatsApp.`,
    );
  } else {
    // SignWell created the document but signing URL not immediately in response
    // The send_email=true flag means SignWell will email them directly
    await sendTextMessage(
      landlordPhone,
      `✅ *Tenancy Agreement sent for e-signature!*\n\n` +
        `SignWell will send you and ${state.tenant_name} an email with signing links. ` +
        `Please check your inbox at ${state.landlord_email}.\n\n` +
        `Once both parties sign, you'll receive the completed agreement here too.`,
    );
  }
}

// ─── State Helpers ──────────────────────────────────────────────────────────

async function saveState(
  landlordId: string,
  state: AgreementState,
): Promise<void> {
  await supabase
    .from("coordinator_state")
    .upsert(
      {
        landlord_id:              landlordId,
        tenancy_agreement_state:  state,
        updated_at:               new Date().toISOString(),
      },
      { onConflict: "landlord_id" },
    );
}

async function clearState(landlordId: string): Promise<void> {
  await supabase
    .from("coordinator_state")
    .upsert(
      {
        landlord_id:             landlordId,
        tenancy_agreement_state: { step: "idle" },
        updated_at:              new Date().toISOString(),
      },
      { onConflict: "landlord_id" },
    );
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function isValidEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
}
