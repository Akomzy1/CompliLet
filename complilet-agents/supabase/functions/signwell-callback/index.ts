/**
 * CompliLet — SignWell Webhook Handler
 *
 * Receives POST events from SignWell when tenancy agreements are signed.
 *
 * verify_jwt = false — SignWell does not use Supabase JWT auth.
 * Request authenticity is verified by checking a shared secret in the
 * X-SignWell-Secret header (set in SignWell dashboard → Webhook → Secret).
 *
 * Handled events:
 *
 *   recipient.completed
 *     → When the LANDLORD signs (sequence 1):
 *         Retrieve the TENANT signing URL and send via WhatsApp.
 *     → When the TENANT signs (sequence 2):
 *         Handled by document.completed — ignore here.
 *
 *   document.completed
 *     → Both parties have signed.
 *         1. Download signed PDF from SignWell.
 *         2. Upload to Supabase Storage (replaces the unsigned copy).
 *         3. Update tenancies record: agreement_url, agreement_signed_at.
 *         4. Send WhatsApp message to landlord + tenant with signed PDF link.
 *
 *   document.declined
 *     → One party declined.
 *         1. Notify the other party via WhatsApp.
 *         2. Create an escalation for human review.
 *         3. Cancel the SignWell document.
 *
 * Required env vars:
 *   SIGNWELL_API_KEY         — SignWell API token
 *   SIGNWELL_WEBHOOK_SECRET  — Shared secret set in SignWell dashboard
 *   MEDIA_BUCKET             — Supabase Storage bucket name (default: tenant-documents)
 */

import { supabase } from "../_shared/supabase.ts";
import { sendTextMessage, sendDocument } from "../_shared/whatsapp.ts";
import { notifyAdmin } from "../_shared/admin-notify.ts";
import {
  getDocument,
  downloadSignedPdf,
  cancelDocument,
  type SignWellWebhookPayload,
} from "../_shared/signwell.ts";

// ─── Supabase Edge Function entry point ───────────────────────────────────

Deno.serve(async (req: Request) => {
  // ── CORS pre-flight ────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-SignWell-Secret",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // ── Webhook authentication ─────────────────────────────────────────────
  const webhookSecret = Deno.env.get("SIGNWELL_WEBHOOK_SECRET");
  if (webhookSecret) {
    const incomingSecret = req.headers.get("X-SignWell-Secret");
    if (incomingSecret !== webhookSecret) {
      console.warn("[signwell-callback] Invalid webhook secret");
      return new Response("Unauthorised", { status: 401 });
    }
  }

  // ── Parse payload ──────────────────────────────────────────────────────
  let payload: SignWellWebhookPayload;
  try {
    payload = await req.json() as SignWellWebhookPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const eventType = payload.event?.type;
  const document  = payload.data?.document;

  if (!eventType || !document) {
    return new Response("Missing event type or document", { status: 400 });
  }

  console.log(`[signwell-callback] Event: ${eventType}, document: ${document.id}`);

  try {
    switch (eventType) {
      case "recipient.completed":
        await handleRecipientCompleted(payload);
        break;

      case "document.completed":
        await handleDocumentCompleted(payload);
        break;

      case "document.declined":
        await handleDocumentDeclined(payload);
        break;

      default:
        // Acknowledge unknown events without error
        console.log(`[signwell-callback] Unhandled event type: ${eventType}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[signwell-callback] Error handling ${eventType}:`, message);
    // Return 200 so SignWell doesn't retry — we log and alert instead
    await notifyAdmin(
      `SignWell webhook error (${eventType}): ${message}`,
      "high",
    ).catch(() => {});
  }

  return new Response("OK", { status: 200 });
});

// ─── Event Handlers ────────────────────────────────────────────────────────

/**
 * Fired when an individual recipient completes signing.
 * We care about sequence 1 (landlord) completing — then we send the tenant their link.
 */
async function handleRecipientCompleted(
  payload: SignWellWebhookPayload,
): Promise<void> {
  const { document, recipient } = payload.data;
  if (!recipient) return;

  // Only act when the LANDLORD (sequence 1) has signed
  if (recipient.sequence !== 1) return;

  console.log(`[signwell-callback] Landlord signed document ${document.id}`);

  // Look up the tenancy so we know who the tenant is
  const tenancy = await loadTenancyBySignwellId(document.id);
  if (!tenancy) {
    console.error(`[signwell-callback] No tenancy found for SignWell doc ${document.id}`);
    return;
  }

  // Get fresh document from SignWell to retrieve tenant signing URL
  const freshDoc = await getDocument(document.id);
  const tenantRecipient = freshDoc.recipients.find((r) => r.sequence === 2);
  const tenantSigningUrl = tenantRecipient?.signing_url;

  if (!tenantSigningUrl) {
    console.error(`[signwell-callback] No tenant signing URL for document ${document.id}`);
    return;
  }

  // Notify landlord that they've signed and tenant has been sent the link
  await sendTextMessage(
    tenancy.landlord_phone,
    `✅ *You've signed the tenancy agreement!*\n\n` +
    `I've now sent ${tenancy.tenant_name} their link to sign. ` +
    `You'll receive the fully signed agreement as soon as they complete it.\n\n` +
    `_Property: ${tenancy.property_address}_`,
  ).catch(() => {});

  // Send tenant their signing link via WhatsApp
  await sendTextMessage(
    tenancy.tenant_phone,
    `📋 *Please sign your Tenancy Agreement*\n\n` +
    `Your landlord has signed the tenancy agreement for *${tenancy.property_address}*.\n\n` +
    `Please click the link below to review and sign:\n` +
    `${tenantSigningUrl}\n\n` +
    `This link is secure and unique to you. The agreement will be complete once you sign. ` +
    `If you have any questions, please reply here.`,
  ).catch(() => {});
}

/**
 * Fired when ALL recipients have signed — the document is fully executed.
 */
async function handleDocumentCompleted(
  payload: SignWellWebhookPayload,
): Promise<void> {
  const { document } = payload.data;

  console.log(`[signwell-callback] Document completed: ${document.id}`);

  const tenancy = await loadTenancyBySignwellId(document.id);
  if (!tenancy) {
    console.error(`[signwell-callback] No tenancy found for SignWell doc ${document.id}`);
    return;
  }

  // 1. Download signed PDF
  const signedPdfBytes = await downloadSignedPdf(document.id);

  // 2. Upload to Supabase Storage
  const bucket = Deno.env.get("MEDIA_BUCKET") ?? "tenant-documents";
  const now = new Date().toISOString();
  const dateStamp = now.substring(0, 10).replace(/-/g, "");
  const storagePath = `${tenancy.landlord_id}/${tenancy.id}/tenancy_agreement_signed_${dateStamp}.pdf`;

  const { error: uploadErr } = await supabase.storage
    .from(bucket)
    .upload(storagePath, signedPdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadErr) {
    console.error("[signwell-callback] Storage upload failed:", uploadErr.message);
    throw new Error(`Storage upload failed: ${uploadErr.message}`);
  }

  // 3. Generate a long-lived signed URL
  const { data: signedUrlData } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365 * 5); // 5 years

  const agreementUrl = signedUrlData?.signedUrl ?? null;

  // 4. Update tenancy record
  const { error: updateErr } = await supabase
    .from("tenancies")
    .update({
      agreement_url:       agreementUrl,
      agreement_signed_at: now,
      updated_at:          now,
    })
    .eq("id", tenancy.id);

  if (updateErr) {
    console.error("[signwell-callback] Tenancy update failed:", updateErr.message);
  }

  // 5. Send signed PDF to both parties via WhatsApp
  const fileName = `CompliLet_Tenancy_Agreement_Signed_${dateStamp}.pdf`;
  const landlordMsg =
    `🎉 *Tenancy Agreement fully signed!*\n\n` +
    `Both you and ${tenancy.tenant_name} have signed the tenancy agreement for ` +
    `*${tenancy.property_address}*.\n\n` +
    `The signed agreement is attached. Please keep it safe — you'll need it for the duration of the tenancy.\n\n` +
    `_CompliLet will continue managing compliance, rent, and maintenance for this property._`;

  const tenantMsg =
    `✅ *Your tenancy agreement is signed!*\n\n` +
    `Both you and your landlord have signed the tenancy agreement for ` +
    `*${tenancy.property_address}*.\n\n` +
    `The signed agreement is attached. Please keep it in a safe place — you may need it if any disputes arise.\n\n` +
    `_Welcome to your new home! Your tenancy starts on ${formatDate(tenancy.start_date)}._`;

  if (agreementUrl) {
    await Promise.allSettled([
      sendDocument(tenancy.landlord_phone, agreementUrl, fileName, landlordMsg),
      sendDocument(tenancy.tenant_phone, agreementUrl, fileName, tenantMsg),
    ]);
  } else {
    await Promise.allSettled([
      sendTextMessage(tenancy.landlord_phone, landlordMsg),
      sendTextMessage(tenancy.tenant_phone, tenantMsg),
    ]);
  }

  console.log(`[signwell-callback] Agreement completed and distributed for tenancy ${tenancy.id}`);
}

/**
 * Fired when a recipient declines to sign the document.
 */
async function handleDocumentDeclined(
  payload: SignWellWebhookPayload,
): Promise<void> {
  const { document, recipient } = payload.data;

  console.log(`[signwell-callback] Document declined: ${document.id}`);

  const tenancy = await loadTenancyBySignwellId(document.id);
  if (!tenancy) return;

  const declinerName = recipient?.name ?? "One party";
  const declinerSeq  = recipient?.sequence ?? 0;

  // Notify the OTHER party
  if (declinerSeq === 1) {
    // Landlord declined → notify tenant
    await sendTextMessage(
      tenancy.tenant_phone,
      `⚠️ *Tenancy agreement update*\n\n` +
      `The landlord has declined to sign the tenancy agreement for *${tenancy.property_address}*. ` +
      `A member of our team will be in touch to assist. Please reply here if you have questions.`,
    ).catch(() => {});
  } else {
    // Tenant declined → notify landlord
    await sendTextMessage(
      tenancy.landlord_phone,
      `⚠️ *Tenancy agreement declined*\n\n` +
      `${tenancy.tenant_name} has declined to sign the tenancy agreement for *${tenancy.property_address}*. ` +
      `A member of our team will be in touch. Reply *HELP* if you need immediate assistance.`,
    ).catch(() => {});
  }

  // Escalate to human for follow-up
  await notifyAdmin(
    `Tenancy agreement declined by ${declinerName} (sequence ${declinerSeq}) ` +
    `for tenancy ${tenancy.id} at ${tenancy.property_address}. ` +
    `SignWell document: ${document.id}`,
    "high",
  ).catch(() => {});

  // Cancel the document on SignWell
  await cancelDocument(document.id).catch((err) => {
    console.error("[signwell-callback] Failed to cancel SignWell doc:", err.message);
  });
}

// ─── Database Helpers ──────────────────────────────────────────────────────

interface TenancyRow {
  id: string;
  landlord_id: string;
  landlord_phone: string;
  tenant_phone: string;
  tenant_name: string;
  property_address: string;
  start_date: string;
}

async function loadTenancyBySignwellId(
  signwellDocumentId: string,
): Promise<TenancyRow | null> {
  const { data, error } = await supabase
    .from("tenancies")
    .select(`
      id,
      landlord_id,
      tenant_phone,
      tenant_name,
      property_address,
      start_date,
      landlords!inner(whatsapp_number)
    `)
    .eq("signwell_document_id", signwellDocumentId)
    .maybeSingle();

  if (error) {
    console.error("[signwell-callback] DB lookup failed:", error.message);
    return null;
  }
  if (!data) return null;

  return {
    id:               data.id as string,
    landlord_id:      data.landlord_id as string,
    landlord_phone:   (data.landlords as { whatsapp_number: string }).whatsapp_number,
    tenant_phone:     data.tenant_phone as string,
    tenant_name:      data.tenant_name as string,
    property_address: data.property_address as string,
    start_date:       data.start_date as string,
  };
}

// ─── Utilities ─────────────────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    });
  } catch {
    return isoDate;
  }
}
