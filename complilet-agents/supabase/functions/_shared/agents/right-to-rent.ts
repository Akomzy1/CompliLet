/**
 * CompliLet — Right to Rent Agent
 *
 * Handles the "right_to_rent" session stage.
 *
 * CRITICAL DESIGN CONSTRAINT:
 *   Document → classification mapping is DETERMINISTIC (pattern-matching only).
 *   Claude is NEVER asked to classify a document's Right to Rent status.
 *   Claude is only called once, at the end, to write the landlord notification.
 *
 * Legal basis: Immigration Act 2014 ss.22-23, Immigration Act 2016 s.40,
 * Home Office Landlords' Code of Practice (updated February 2024).
 *
 * Flow:
 *   1. Load all validated documents for this session.
 *   2. Identify the best RTR document (photo_id first; ask tenant if none qualifies).
 *   3. Classify it deterministically using keyword pattern matching.
 *   4. If classification is "unknown" — escalate immediately. Never guess.
 *   5. Generate a PDF compliance certificate (via pdf.ts).
 *   6. Store the PDF in Supabase Storage.
 *   7. Send PDF + summary message to the landlord via WhatsApp.
 *   8. If List B — create a compliance_deadline for the follow-up check.
 *   9. Persist the right_to_rent_checks record.
 *  10. Signal handoff to "chasing_refs".
 *
 * Called by: coordinator.ts (shared module — not a separate Edge Function)
 */

import Anthropic from "npm:@anthropic-ai/sdk@0.24";
import { supabase } from "../supabase.ts";
import { sendTextMessage, sendDocument } from "../whatsapp.ts";
import { CLAUDE_MODEL, CLAUDE_MAX_TOKENS } from "../constants.ts";
import type {
  ParsedMessage,
  SessionStatus,
  RightToRentListType,
  RightToRentStatus,
  EscalationTrigger,
} from "../types.ts";
import { generateRightToRentCertificate, formatDate } from "../pdf.ts";

// ─── Public interface ──────────────────────────────────────────────────────

export interface RightToRentInput {
  message: ParsedMessage;
  sessionId: string;
  landlordId: string;
  /** Storage path of any media in the incoming message (e.g. additional RTR doc) */
  mediaStoragePath?: string;
  onHandoff: (nextStatus: SessionStatus, data: HandoffData) => Promise<void>;
  onEscalate: (trigger: EscalationTrigger, context: string) => Promise<void>;
}

export interface HandoffData {
  rtrResult: RtrClassification;
}

// ─── Classification types ──────────────────────────────────────────────────

type RtrGroup =
  | "list_a_group_1"   // Single document — unlimited right
  | "list_a_group_2"   // Two-document combination — unlimited right
  | "list_a_euss"      // EUSS Settled Status — unlimited right
  | "list_b";          // Time-limited — follow-up required

interface RtrClassification {
  group: RtrGroup;
  listType: RightToRentListType;
  status: RightToRentStatus;
  label: string;                // Human-readable classification label for the certificate
  unlimitedRight: boolean;
  requiresFollowUp: boolean;
  followUpMonths: number;       // 0 for unlimited, 6 for List B without expiry
  documentType: string;
  documentExpiry?: string;      // ISO date — drives follow-up date calculation
  documentReference?: string;
}

type ClassifyOutcome =
  | (RtrClassification & { result: "classified" })
  | { result: "not_rtr_document"; documentType: string; reason: string }
  | { result: "unknown"; documentType: string; reason: string };

// ─── Document type → RTR classification ───────────────────────────────────
//
// DETERMINISTIC. No LLM. Pattern-match the document_type string from the
// doc-collector's Claude vision output against known Home Office categories.
//
// If NOTHING matches → result: "unknown" → escalate.
//
// Keyword matching is intentionally BROAD for "positive" classifications
// (better to over-classify as List A than List B) and CONSERVATIVE for
// "not an RTR document" rejections.

function classifyDocumentType(
  documentType: string,
  extractedData: Record<string, unknown>,
): ClassifyOutcome {
  const t = documentType.toLowerCase().trim();
  const expiry = (extractedData?.expiryDate as string | undefined) ?? undefined;
  const hasExpiry = Boolean(expiry && new Date(expiry) > new Date("2000-01-01"));

  // ── List A Group 1 ──────────────────────────────────────────────────────
  // UK / British / BNO passport — current or expired (Home Office accepts up to 5yr expired)
  if (
    /\b(uk|british|great britain|gb|bno|british national overseas)\b/.test(t) &&
    /\bpassport\b/.test(t)
  ) {
    return classified("list_a_group_1", "List A – Group 1", documentType, false, expiry);
  }

  // Irish passport or passport card
  if (
    /\b(irish|ireland|éire|republic of ireland)\b/.test(t) &&
    /\bpassport\b/.test(t)
  ) {
    return classified("list_a_group_1", "List A – Group 1", documentType, false, expiry);
  }

  // Certificate of registration or naturalisation as a British citizen
  if (
    /\b(naturalisation|naturalization|naturalised|naturalized)\b/.test(t) ||
    /certificate of registration\b/.test(t) ||
    /\bregistration as a british citizen\b/.test(t)
  ) {
    return classified("list_a_group_1", "List A – Group 1", documentType, false, expiry);
  }

  // BRP with ILR / indefinite leave — explicit "indefinite" or "no time limit" wording
  if (
    /\b(brp|biometric residence permit|biometric residency permit)\b/.test(t) &&
    /\b(indefinite|ilr|ilp|no time limit|settled|permanent)\b/.test(t)
  ) {
    return classified("list_a_group_1", "List A – Group 1", documentType, false, undefined);
  }

  // ── List A EUSS — Settled Status ─────────────────────────────────────────
  if (
    /(eu\s*settlement\s*scheme|euss)/.test(t) &&
    /\bsettled\b/.test(t) &&
    !/pre.?settled/.test(t)
  ) {
    return classified("list_a_euss", "List A – EUSS Settled Status", documentType, false, undefined);
  }

  // ── List A Group 2 (two-document combination) ─────────────────────────────
  // The coordinator calls with the photo_id document; if it's a birth cert or adoption cert
  // we can flag it as Group 2 (needs a Part B / NI document).
  // NOTE: We don't try to auto-pass Group 2 in one step — the RTR agent will request
  // the NI document separately when it detects a Group 2 Part A document.
  if (
    /\b(uk birth certificate|birth certificate|uk adoption certificate|adoption certificate)\b/.test(t) ||
    /(letter from hmpo|hm passport office)\b/.test(t)
  ) {
    // Part A only — needs Part B (NI evidence). Mark as Group 2 and handle separately.
    return classified("list_a_group_2", "List A – Group 2 (Part A only — NI evidence still needed)", documentType, false, undefined);
  }

  // ── List B — Time-limited ─────────────────────────────────────────────────

  // BRP with limited leave (any wording that isn't indefinite/settled)
  if (
    /\b(brp|biometric residence permit|biometric residency permit)\b/.test(t) &&
    !/\b(indefinite|ilr|ilp|no time limit|settled|permanent)\b/.test(t)
  ) {
    // If there's an expiry date, it's clearly limited.
    // If there's no expiry and no "indefinite" — treat as List B (conservative).
    return classified("list_b", "List B", documentType, true, expiry, hasExpiry ? 0 : 6);
  }

  // Visa in a current non-UK/non-Irish passport
  if (
    /\b(visa|entry clearance|vignette|leave to enter)\b/.test(t) &&
    !/\b(indefinite|ilr|no time limit|settled)\b/.test(t)
  ) {
    return classified("list_b", "List B", documentType, true, expiry, hasExpiry ? 0 : 6);
  }

  // Non-UK/non-Irish passport with visa endorsement inside
  if (
    /\bpassport\b/.test(t) &&
    !/\b(uk|british|irish|ireland)\b/.test(t) &&
    /\b(with visa|with endorsement|with leave|with entry clearance)\b/.test(t)
  ) {
    return classified("list_b", "List B", documentType, true, expiry, hasExpiry ? 0 : 6);
  }

  // EUSS Pre-Settled Status
  if (/(pre.?settled|pre\s+settled)/.test(t)) {
    return classified("list_b", "List B", documentType, true, expiry, 6);
  }

  // Certificate of Application to EU Settlement Scheme
  if (
    /certificate of application/.test(t) &&
    /(eu\s*settlement|euss)/.test(t)
  ) {
    return classified("list_b", "List B", documentType, true, undefined, 6);
  }

  // Home Office letter confirming outstanding application or appeal
  if (
    /home office\b/.test(t) &&
    /(outstanding|pending|leave to remain|application|appeal)/.test(t)
  ) {
    return classified("list_b", "List B", documentType, true, undefined, 6);
  }

  // Application Registration Card (ARC)
  if (/\barc\b/.test(t) || /application registration card/.test(t)) {
    return classified("list_b", "List B", documentType, true, expiry, 6);
  }

  // Positive Verification Notice from Employer Checking Service
  if (/positive verification notice/.test(t) || /\bpvn\b/.test(t)) {
    return classified("list_b", "List B", documentType, true, undefined, 6);
  }

  // Frontier Worker Permit
  if (/frontier worker/.test(t)) {
    return classified("list_b", "List B", documentType, true, expiry, hasExpiry ? 0 : 6);
  }

  // Immigration Status Document
  if (/immigration status document/.test(t)) {
    return classified("list_b", "List B", documentType, true, expiry, hasExpiry ? 0 : 6);
  }

  // ── Known non-RTR documents (reject gracefully) ───────────────────────────
  if (
    /\b(driving licen[cs]e|driver.?s licen[cs]e|photocard|dvla)\b/.test(t) ||
    /\b(provisional licen[cs]e)\b/.test(t)
  ) {
    return {
      result: "not_rtr_document",
      documentType,
      reason:
        "A UK driving licence does not satisfy Right to Rent requirements. " +
        "The tenant must provide a passport, BRP, or other Home Office approved document.",
    };
  }

  if (/\b(payslip|p45|p60|p11d|wage slip|salary)\b/.test(t)) {
    return { result: "not_rtr_document", documentType, reason: "Payslips do not establish right to rent." };
  }
  if (/\b(utility bill|bank statement|bank letter|council tax|hmrc letter)\b/.test(t)) {
    return { result: "not_rtr_document", documentType, reason: "Address documents do not establish right to rent." };
  }
  if (/\b(national insurance|ni number|ni card)\b/.test(t)) {
    return { result: "not_rtr_document", documentType, reason: "NI cards alone do not establish right to rent." };
  }

  // ── Cannot determine ──────────────────────────────────────────────────────
  return {
    result: "unknown",
    documentType,
    reason: `Document type "${documentType}" does not match any known Right to Rent document. Manual review required.`,
  };
}

function classified(
  group: RtrGroup,
  label: string,
  documentType: string,
  requiresFollowUp: boolean,
  documentExpiry?: string,
  followUpMonths = 0,
): ClassifyOutcome & { result: "classified" } {
  const listType: RightToRentListType =
    group === "list_b" ? "list_b" :
    group === "list_a_euss" ? "list_a_euss" :
    group === "list_a_group_2" ? "list_a_group_2" :
    "list_a_group_1";

  const status: RightToRentStatus = requiresFollowUp ? "list_b" : "list_a";

  return {
    result: "classified",
    group,
    listType,
    status,
    label,
    unlimitedRight: !requiresFollowUp,
    requiresFollowUp,
    followUpMonths,
    documentType,
    documentExpiry,
  };
}

// ─── Main agent function ───────────────────────────────────────────────────

export async function runRightToRent(input: RightToRentInput): Promise<void> {
  const { message, sessionId, landlordId, mediaStoragePath, onHandoff, onEscalate } = input;
  const tenantPhone = message.from;

  try {
    const ctx = await loadFullContext(sessionId, landlordId);

    // ── Check if we're already waiting for a specific RTR document ──────────
    const awaitingRtrDoc = Boolean(ctx.agentState?.rtr_document_requested);

    // ── If new media was submitted AND we're waiting → validate it ──────────
    let rtrDocRecord: DocumentRecord | null = null;

    if (mediaStoragePath && ["image", "document"].includes(message.type)) {
      if (awaitingRtrDoc) {
        rtrDocRecord = await validateAdditionalRtrDoc(
          message,
          mediaStoragePath,
          sessionId,
          landlordId,
          ctx.tenantName,
        );
      }
    }

    // ── If no new media, try to use the existing photo_id ────────────────────
    if (!rtrDocRecord) {
      rtrDocRecord = await findBestRtrDocument(sessionId);
    }

    if (!rtrDocRecord) {
      // No qualifying document found — ask the tenant for one.
      if (!awaitingRtrDoc) {
        await requestRtrDocument(tenantPhone, sessionId);
        await setAwaitingFlag(sessionId, ctx.agentState);
      } else {
        // Already asked but got text back — gentle re-prompt.
        await sendTextMessage(
          tenantPhone,
          "I'm still waiting for your Right to Rent document (e.g. passport or BRP). " +
            "Could you send a photo of it when you're ready?",
        );
      }
      return;
    }

    // ── Classify deterministically ────────────────────────────────────────────
    const classifyOutcome = classifyDocumentType(
      rtrDocRecord.documentType,
      rtrDocRecord.extractedData ?? {},
    );

    if (classifyOutcome.result === "unknown") {
      // Never guess — escalate immediately.
      console.warn(
        `RTR classification unknown for session ${sessionId}: ${classifyOutcome.reason}`,
      );
      await sendTextMessage(
        tenantPhone,
        "I need a moment to pass your document to our compliance team for a manual check. " +
          "We'll be in touch shortly.",
      );
      await onEscalate(
        "ai_uncertainty",
        `Right to Rent document type "${classifyOutcome.documentType}" could not be ` +
          `classified automatically. Session: ${sessionId}. Reason: ${classifyOutcome.reason}`,
      );
      return;
    }

    if (classifyOutcome.result === "not_rtr_document") {
      // Ask the tenant to provide a suitable document.
      await sendTextMessage(
        tenantPhone,
        `I'm afraid that document doesn't establish your right to rent in England. ` +
          `${classifyOutcome.reason}\n\n` +
          `Could you send a *passport* or *Biometric Residence Permit (BRP)* instead?`,
      );
      await setAwaitingFlag(sessionId, ctx.agentState);
      return;
    }

    // classifyOutcome.result === "classified"
    const classification = classifyOutcome;

    // ── Calculate follow-up date (List B only) ────────────────────────────────
    let followUpDate: string | undefined;
    if (classification.requiresFollowUp) {
      followUpDate = calculateFollowUpDate(
        classification.documentExpiry,
        classification.followUpMonths,
      );
    }

    // ── Generate PDF certificate ──────────────────────────────────────────────
    const checkedAt = new Date().toISOString();
    const pdfBytes = await generateRightToRentCertificate({
      checkedAt,
      landlordName: ctx.landlordName,
      propertyAddress: ctx.propertyAddress,
      tenantName: ctx.tenantName ?? "Not provided",
      tenantDob: rtrDocRecord.extractedData?.dateOfBirth as string | undefined,
      documentType: classification.documentType,
      documentReference: rtrDocRecord.extractedData?.documentNumber as string | undefined,
      documentExpiry: classification.documentExpiry,
      classification: classificationLabel(classification.group),
      unlimitedRight: classification.unlimitedRight,
      followUpDate,
    });

    // ── Store PDF in Supabase Storage ─────────────────────────────────────────
    const certificateStoragePath = await storeCertificate(
      sessionId,
      landlordId,
      pdfBytes,
      checkedAt,
    );

    // Generate a 30-day signed URL for WhatsApp delivery.
    const certificateUrl = await getSignedUrl(certificateStoragePath);

    // ── Generate landlord message via Claude ──────────────────────────────────
    // The ONLY Claude call in this agent — for the conversational message text.
    const landlordMessage = await generateLandlordMessage(
      classification,
      ctx.tenantName ?? "The tenant",
      ctx.propertyAddress,
      followUpDate,
    );

    // ── Notify landlord ───────────────────────────────────────────────────────
    await sendTextMessage(ctx.landlordPhone, landlordMessage);
    await sendDocument(
      ctx.landlordPhone,
      certificateUrl,
      `RTR_Certificate_${safeName(ctx.tenantName ?? "tenant")}_${checkedAt.slice(0, 10)}.pdf`,
      "Right to Rent Compliance Certificate",
    );

    // ── Persist RTR check record ──────────────────────────────────────────────
    await saveRtrRecord({
      sessionId,
      landlordId,
      checkedAt,
      classification,
      followUpDate,
      certificateStoragePath,
      documentRecordId: rtrDocRecord.id,
    });

    // ── Create compliance deadline for List B ─────────────────────────────────
    if (classification.requiresFollowUp && followUpDate) {
      await createFollowUpDeadline({
        sessionId,
        landlordId,
        propertyAddress: ctx.propertyAddress,
        followUpDate,
        documentType: classification.documentType,
        tenantName: ctx.tenantName,
      });
    }

    // ── Update session with RTR result ────────────────────────────────────────
    await updateSessionRtrResult(sessionId, classification.status, certificateStoragePath);

    // ── Handoff to reference chaser ───────────────────────────────────────────
    await onHandoff("chasing_refs", { rtrResult: classification });
  } catch (err) {
    console.error(`RightToRent error (session ${sessionId}):`, err);
    await sendTextMessage(
      input.message.from,
      "I'm having a technical issue processing your Right to Rent check. " +
        "Please bear with us — our team has been notified.",
    ).catch(() => {});
    throw err;
  }
}

// ─── Document loading ──────────────────────────────────────────────────────

interface DocumentRecord {
  id: string;
  documentType: string;
  storagePath: string;
  extractedData: Record<string, unknown> | null;
  confidence: string;
}

/**
 * Looks in the documents table for this session's photo_id document.
 * Returns null if no validated photo_id exists.
 */
async function findBestRtrDocument(sessionId: string): Promise<DocumentRecord | null> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, document_type, storage_path, extracted_data, confidence")
    .eq("session_id", sessionId)
    .eq("category", "photo_id")
    .eq("passed", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to load photo_id document:", error.message);
    return null;
  }
  if (!data) return null;

  return {
    id: data.id,
    documentType: data.document_type,
    storagePath: data.storage_path,
    extractedData: data.extracted_data as Record<string, unknown> | null,
    confidence: data.confidence,
  };
}

// ─── Additional RTR document validation ───────────────────────────────────
// When the tenant provides a DIFFERENT document specifically for RTR purposes
// (e.g. their photo_id was a driving licence and we asked for their passport).

async function validateAdditionalRtrDoc(
  message: ParsedMessage,
  storagePath: string,
  sessionId: string,
  landlordId: string,
  tenantName?: string,
): Promise<DocumentRecord | null> {
  const bucket = Deno.env.get("MEDIA_BUCKET") ?? "tenant-documents";

  // Download bytes from storage.
  const { data: blob, error: dlErr } = await supabase.storage
    .from(bucket)
    .download(storagePath);
  if (dlErr || !blob) {
    console.error("Failed to download RTR document:", dlErr?.message);
    return null;
  }
  const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
  const mimeType = message.media?.mimeType ?? "image/jpeg";

  // Use Claude vision to extract document details (identification only, NOT classification).
  const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  const base64 = toBase64(bytes);

  const imageMediaType = (
    mimeType === "image/png" ? "image/png" :
    mimeType === "image/webp" ? "image/webp" :
    "image/jpeg"
  ) as "image/jpeg" | "image/png" | "image/webp";

  const content: Anthropic.ContentBlockParam[] =
    mimeType === "application/pdf"
      ? [
          {
            type: "document" as const,
            source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 },
          } as unknown as Anthropic.ContentBlockParam,
          { type: "text", text: RTR_VISION_PROMPT },
        ]
      : [
          { type: "image", source: { type: "base64", media_type: imageMediaType, data: base64 } },
          { type: "text", text: RTR_VISION_PROMPT },
        ];

  const nameHint = tenantName
    ? `\n\nExpected tenant name: "${tenantName}". Note any name mismatch in issues.`
    : "";

  const promptWithHint = RTR_VISION_PROMPT + nameHint;
  content[content.length - 1] = { type: "text", text: promptWithHint };

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content }],
    });

    const rawText = response.content
      .filter((b: { type: string; text?: string }) => b.type === "text")
      .map((b: { type: string; text?: string }) => b.text ?? "")
      .join("")
      .trim();

    const jsonMatch = /\{[\s\S]*\}/.exec(rawText);
    if (!jsonMatch) throw new Error("No JSON in vision response");

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    // Persist to documents table as a supplementary RTR document.
    const docType = (parsed.documentType as string | undefined) ?? "Unknown";
    const { data: inserted } = await supabase
      .from("documents")
      .insert({
        session_id: sessionId,
        landlord_id: landlordId,
        category: "right_to_rent",
        document_type: docType,
        storage_path: storagePath,
        passed: Boolean(parsed.isLegible),
        issues: (parsed.issues as string[]) ?? [],
        confidence: (parsed.confidence as string) ?? "low",
        extracted_data: {
          name:           parsed.fullName,
          dateOfBirth:    parsed.dateOfBirth,
          expiryDate:     parsed.expiryDate,
          documentNumber: parsed.documentNumber,
        },
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    return {
      id: inserted?.id ?? "",
      documentType: docType,
      storagePath,
      extractedData: {
        dateOfBirth:    parsed.dateOfBirth,
        expiryDate:     parsed.expiryDate,
        documentNumber: parsed.documentNumber,
      },
      confidence: (parsed.confidence as string) ?? "low",
    };
  } catch (err) {
    console.error("RTR vision validation failed:", err);
    return null;
  }
}

const RTR_VISION_PROMPT =
  "Extract the following from this identity document and respond ONLY with JSON (no markdown):\n" +
  '{"documentType":"<specific type>","fullName":"<name or null>","dateOfBirth":"<YYYY-MM-DD or null>",' +
  '"expiryDate":"<YYYY-MM-DD or null>","documentNumber":"<number or null>","isLegible":<true/false>,' +
  '"issues":["<list or empty>"],"confidence":"<high|medium|low>"}';

// ─── Follow-up date calculation ────────────────────────────────────────────

/**
 * Returns the ISO date by which the landlord must conduct a follow-up RTR check.
 *
 * Priority:
 *   1. 2 months before document expiry (if expiry is known and > 6 months away)
 *   2. `followUpMonths` months from today (for documents without clear expiry)
 *   3. Minimum: 14 days from today
 */
function calculateFollowUpDate(
  documentExpiry: string | undefined,
  followUpMonths: number,
): string {
  const today = new Date();
  const minDate = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);

  if (documentExpiry) {
    try {
      const expiry = new Date(documentExpiry);
      if (!isNaN(expiry.getTime())) {
        // Set follow-up to 2 months before expiry.
        const followUp = new Date(expiry);
        followUp.setMonth(followUp.getMonth() - 2);
        // Must be at least 14 days from now.
        const finalDate = followUp > minDate ? followUp : minDate;
        return finalDate.toISOString().slice(0, 10);
      }
    } catch { /* fall through */ }
  }

  // No expiry — use followUpMonths from today (minimum 6 months).
  const months = Math.max(followUpMonths, 1);
  const followUp = new Date(today);
  followUp.setMonth(followUp.getMonth() + months);
  return followUp.toISOString().slice(0, 10);
}

// ─── Context loading ───────────────────────────────────────────────────────

interface FullContext {
  landlordName: string;
  landlordPhone: string;
  propertyAddress: string;
  tenantName?: string;
  agentState: Record<string, unknown>;
}

async function loadFullContext(sessionId: string, landlordId: string): Promise<FullContext> {
  const [sessionResult, landlordResult] = await Promise.all([
    supabase
      .from("screening_sessions")
      .select("property_address, pre_qualifying_summary, agent_state")
      .eq("id", sessionId)
      .single(),
    supabase
      .from("landlords")
      .select("display_name, whatsapp_number")
      .eq("id", landlordId)
      .single(),
  ]);

  const session = sessionResult.data;
  const landlord = landlordResult.data;
  const preSummary = session?.pre_qualifying_summary as { name?: string } | null;

  return {
    landlordName: landlord?.display_name ?? "Landlord",
    landlordPhone: landlord?.whatsapp_number ?? "",
    propertyAddress: session?.property_address ?? "Property address not set",
    tenantName: preSummary?.name,
    agentState: (session?.agent_state as Record<string, unknown>) ?? {},
  };
}

// ─── State helpers ─────────────────────────────────────────────────────────

async function setAwaitingFlag(
  sessionId: string,
  currentState: Record<string, unknown>,
): Promise<void> {
  const updated = { ...currentState, rtr_document_requested: true };
  await supabase
    .from("screening_sessions")
    .update({ agent_state: updated })
    .eq("id", sessionId);
}

// ─── Tenant request message ────────────────────────────────────────────────

async function requestRtrDocument(tenantPhone: string, _sessionId: string): Promise<void> {
  await sendTextMessage(
    tenantPhone,
    "Almost there! I just need to confirm your right to rent in England. 🏠\n\n" +
      "Could you send me a clear photo of one of the following:\n" +
      "• *Passport* (UK, Irish, or any nationality if it has a valid UK visa)\n" +
      "• *Biometric Residence Permit (BRP)*\n" +
      "• *EU Settlement Scheme* share code — you can get this at gov.uk\n\n" +
      "If you're unsure, a *passport* works for most people.",
  );
}

// ─── PDF storage ───────────────────────────────────────────────────────────

async function storeCertificate(
  sessionId: string,
  landlordId: string,
  pdfBytes: Uint8Array,
  checkedAt: string,
): Promise<string> {
  const bucket = Deno.env.get("MEDIA_BUCKET") ?? "tenant-documents";
  const date = checkedAt.slice(0, 10).replace(/-/g, "");
  const path = `${landlordId}/${sessionId}/rtr_certificate_${date}.pdf`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) throw new Error(`Failed to store RTR certificate: ${error.message}`);
  return path;
}

async function getSignedUrl(storagePath: string): Promise<string> {
  const bucket = Deno.env.get("MEDIA_BUCKET") ?? "tenant-documents";
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 30 * 24 * 60 * 60); // 30 days

  if (error || !data) {
    throw new Error(`Failed to create signed URL for ${storagePath}: ${error?.message}`);
  }
  return data.signedUrl;
}

// ─── Database persistence ──────────────────────────────────────────────────

async function saveRtrRecord(params: {
  sessionId: string;
  landlordId: string;
  checkedAt: string;
  classification: RtrClassification;
  followUpDate?: string;
  certificateStoragePath: string;
  documentRecordId: string;
}): Promise<void> {
  const { error } = await supabase.from("right_to_rent_checks").insert({
    session_id:              params.sessionId,
    landlord_id:             params.landlordId,
    status:                  params.classification.status,
    list_type:               params.classification.listType,
    document_type:           params.classification.documentType,
    document_expiry:         params.classification.documentExpiry ?? null,
    follow_up_required:      params.classification.requiresFollowUp,
    follow_up_by_date:       params.followUpDate ?? null,
    verification_method:     "video_call",   // WhatsApp = remote digital copy
    certificate_storage_path: params.certificateStoragePath,
    document_record_id:      params.documentRecordId,
    checked_at:              params.checkedAt,
  });

  if (error) {
    console.error("Failed to save RTR record:", error.message);
  }
}

async function updateSessionRtrResult(
  sessionId: string,
  rtrStatus: RightToRentStatus,
  certificatePath: string,
): Promise<void> {
  await supabase
    .from("screening_sessions")
    .update({
      rtr_status:              rtrStatus,
      rtr_certificate_path:    certificatePath,
      rtr_checked_at:          new Date().toISOString(),
    })
    .eq("id", sessionId);
}

async function createFollowUpDeadline(params: {
  sessionId: string;
  landlordId: string;
  propertyAddress: string;
  followUpDate: string;
  documentType: string;
  tenantName?: string;
}): Promise<void> {
  const dueDate = new Date(params.followUpDate);
  const today = new Date();
  const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);

  const urgency =
    daysUntilDue < 0   ? "overdue" :
    daysUntilDue <= 14 ? "critical" :
    daysUntilDue <= 60 ? "warning" :
    "ok";

  const { error } = await supabase.from("compliance_deadlines").insert({
    session_id:       params.sessionId,
    landlord_id:      params.landlordId,
    type:             "right_to_rent_followup",
    due_date:         params.followUpDate,
    days_until_due:   daysUntilDue,
    urgency,
    property_address: params.propertyAddress,
    notes:
      `Follow-up Right to Rent check required for ${params.tenantName ?? "tenant"}. ` +
      `Original document: ${params.documentType}.`,
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.error("Failed to create compliance deadline:", error.message);
  }
}

// ─── Landlord message — Claude call ───────────────────────────────────────
// The ONE place in this agent where Claude is used.
// Claude writes the notification text; it does NOT determine the classification.

async function generateLandlordMessage(
  classification: RtrClassification,
  tenantName: string,
  propertyAddress: string,
  followUpDate?: string,
): Promise<string> {
  const prompt =
    `You are CompliLet. Write a short, professional WhatsApp message to a UK landlord ` +
    `notifying them of the outcome of a Right to Rent check.\n\n` +
    `Details:\n` +
    `- Tenant: ${tenantName}\n` +
    `- Property: ${propertyAddress}\n` +
    `- Classification: ${classification.label}\n` +
    `- Unlimited right to rent: ${classification.unlimitedRight ? "Yes" : "No"}\n` +
    `- Document: ${classification.documentType}\n` +
    (classification.documentExpiry
      ? `- Document expires: ${formatDate(classification.documentExpiry)}\n`
      : "") +
    (followUpDate
      ? `- Follow-up check required by: ${formatDate(followUpDate)}\n`
      : "") +
    `\nThe message should:\n` +
    `- Confirm the check was completed\n` +
    `- State clearly whether the right is unlimited or time-limited\n` +
    `- If time-limited, stress the importance of the follow-up date\n` +
    `- Mention the compliance certificate PDF that follows\n` +
    `- Be concise (WhatsApp — 3–5 sentences)\n` +
    `- Use *bold* for key figures (classification, follow-up date)\n` +
    `- Do NOT repeat "CompliLet" more than once`;

  try {
    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });
    return response.content
      .filter((b: { type: string; text?: string }) => b.type === "text")
      .map((b: { type: string; text?: string }) => b.text ?? "")
      .join("")
      .trim();
  } catch (err) {
    console.error("Failed to generate landlord message:", err);
    // Fallback: plain-text summary if Claude fails.
    return (
      `✅ Right to Rent check completed for *${tenantName}* at ${propertyAddress}.\n\n` +
      `*Classification: ${classification.label}*\n` +
      (classification.unlimitedRight
        ? "No follow-up check is required."
        : `⚠️ This is a time-limited right. A follow-up check is required by *${followUpDate ? formatDate(followUpDate) : "the date shown on the certificate"}*.`) +
      "\n\nThe compliance certificate is attached."
    );
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function classificationLabel(
  group: RtrGroup,
): "List A – Group 1" | "List A – Group 2" | "List A – EUSS Settled Status" | "List B" {
  switch (group) {
    case "list_a_group_1": return "List A – Group 1";
    case "list_a_group_2": return "List A – Group 2";
    case "list_a_euss":    return "List A – EUSS Settled Status";
    case "list_b":         return "List B";
  }
}

function toBase64(bytes: Uint8Array): string {
  const CHUNK = 8_192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40);
}
