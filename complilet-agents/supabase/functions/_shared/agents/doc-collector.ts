/**
 * CompliLet — Document Collector Agent
 *
 * Handles the "collecting_docs" session stage.
 *
 * Responsibilities:
 *   - Guides the tenant through sending 3 required documents via WhatsApp
 *   - Validates each document using Claude vision (identity + freshness + legibility)
 *   - Stores validated documents in Supabase Storage and the documents table
 *   - Tracks collection progress in session.agent_state.documents_collected
 *   - Signals handoff to "right_to_rent" when all 3 are collected and valid
 *
 * Two Claude calls per interaction:
 *   1. Vision validation — targeted JSON extraction from the document image/PDF
 *   2. Conversational response — friendly tenant-facing message (system prompt)
 *
 * Called by: coordinator.ts (shared module — not a separate Edge Function)
 */

import Anthropic from "npm:@anthropic-ai/sdk@0.24";
import { supabase } from "../supabase.ts";
import { sendTextMessage } from "../whatsapp.ts";
import { MODELS, CLAUDE_MAX_TOKENS } from "../constants.ts";
import type {
  ParsedMessage,
  SessionStatus,
  DocumentCategory,
} from "../types.ts";

// ─── Konfir feature flag ───────────────────────────────────────────────────
// Phase 1 (default): Claude vision validates payslip photos sent via WhatsApp.
// Phase 2 (Konfir):  Set KONFIR_ENABLED=true to switch to API-based verification.
//                    Konfir contacts the tenant by SMS, pulls employment + income
//                    data directly from HMRC, payroll systems, and Open Banking,
//                    then posts results to the /konfir-callback Edge Function.

export function isKonfirEnabled(): boolean {
  return Deno.env.get("KONFIR_ENABLED") === "true";
}

/** Plans that include Konfir income verification (Landlord Pro and above). */
const KONFIR_ELIGIBLE_PLANS = ["pro", "tenancy_manager", "portfolio", "global_landlord"] as const;

export function isKonfirEligiblePlan(plan: string | null | undefined): boolean {
  if (!plan) return false;
  return (KONFIR_ELIGIBLE_PLANS as readonly string[]).includes(plan);
}

/**
 * Returns true when both the global KONFIR_ENABLED flag is set AND the
 * landlord's plan qualifies (Pro and above). Pay-Per-Screen always uses Phase 1.
 */
export async function shouldUseKonfir(landlordId: string): Promise<boolean> {
  if (!isKonfirEnabled()) return false;
  const { data } = await supabase.from("landlords").select("plan").eq("id", landlordId).single();
  return isKonfirEligiblePlan((data as { plan?: string } | null)?.plan);
}

// ─── Public interface ──────────────────────────────────────────────────────

export interface DocCollectorInput {
  message: ParsedMessage;
  sessionId: string;
  landlordId: string;
  /** Supabase Storage path of the uploaded media (set by webhook handler) */
  mediaStoragePath?: string;
  onHandoff: (nextStatus: SessionStatus, data: HandoffData) => Promise<void>;
}

export interface HandoffData {
  documentsCollected: CollectedDocuments;
}

// ─── Document state ────────────────────────────────────────────────────────

/** Maps document category to the order they are requested */
const REQUIRED_DOCS: DocumentCategory[] = [
  "photo_id",
  "proof_of_income",
  "proof_of_address",
];

const DOC_LABELS: Record<DocumentCategory, string> = {
  photo_id: "Photo ID",
  proof_of_income: "Proof of Income",
  proof_of_address: "Proof of Address",
  right_to_rent: "Right to Rent document",
  other: "Additional document",
};

/** Human-readable request prompts sent when asking for each document */
const DOC_REQUEST_MESSAGES: Record<DocumentCategory, string> = {
  photo_id:
    "To start, could you send me a clear photo of your *photo ID*? " +
    "I can accept a *passport*, *UK driving licence*, or *Biometric Residence Permit (BRP)*.\n\n" +
    "📷 Tips: lay it flat, make sure all four corners are visible, and avoid glare.",

  proof_of_income:
    "Great, that's your ID sorted! 👍\n\n" +
    "Next I need *proof of income*. Could you send me one of:\n" +
    "• A *payslip* from within the last 3 months\n" +
    "• 3 months of *bank statements* showing your salary\n" +
    "• An *accountant's letter* if you're self-employed",

  proof_of_address:
    "Almost done! One last document — *proof of address*.\n\n" +
    "I need something dated in the *last 3 months*, such as:\n" +
    "• A *utility bill* (gas, electric, water, broadband)\n" +
    "• A *bank statement*\n" +
    "• A *council tax bill* (current year)",

  right_to_rent: "Could you send your right to rent documentation?",
  other: "Could you send the additional document?",
};

export interface CollectedDoc {
  category: DocumentCategory;
  storagePath: string;
  documentType: string;
  extractedName?: string;
  extractedDob?: string;
  extractedExpiry?: string;
  extractedDocNumber?: string;
  extractedAddress?: string;
  extractedEmployer?: string;
  extractedGrossIncome?: number;
  issueDate?: string;
  validatedAt: string;
  confidence: "high" | "medium" | "low";
}

export type CollectedDocuments = Partial<Record<DocumentCategory, CollectedDoc>>;

// ─── Validation types ──────────────────────────────────────────────────────

interface ValidationResult {
  isValid: boolean;
  category: DocumentCategory | "unknown";
  documentType: string;
  fullName?: string;
  dateOfBirth?: string;
  expiryDate?: string;
  issueDate?: string;
  documentNumber?: string;
  address?: string;
  employerName?: string;
  grossIncome?: number;
  netIncome?: number;
  payPeriodStart?: string;
  payPeriodEnd?: string;
  isExpired: boolean;
  isLegible: boolean;
  isWithinThreeMonths?: boolean;  // for payslips, bills
  isCurrentYear?: boolean;        // for council tax
  confidence: "high" | "medium" | "low";
  issues: string[];
  rejectionMessage?: string;      // Claude-generated tenant-facing text
}

// ─── Main entry point ──────────────────────────────────────────────────────

export async function runDocCollector(input: DocCollectorInput): Promise<void> {
  const { message, sessionId, landlordId, mediaStoragePath, onHandoff } = input;
  const tenantPhone = message.from;

  try {
    // Load current collection state.
    const { collected, tenantName } = await loadState(sessionId);
    const nextRequired = getNextRequired(collected);

    // ── Media message: validate document ──────────────────────────────────
    if (isMediaMessage(message) && mediaStoragePath) {
      await handleDocumentSubmission({
        message,
        sessionId,
        landlordId,
        tenantPhone,
        tenantName,
        mediaStoragePath,
        collected,
        nextRequired,
        onHandoff,
      });
      return;
    }

    // ── Text/interactive message: conversational response ────────────────
    await handleTextMessage({
      message,
      sessionId,
      landlordId,
      tenantPhone,
      tenantName,
      collected,
      nextRequired,
    });
  } catch (err) {
    console.error(`DocCollector error (session ${sessionId}):`, err);
    await sendTextMessage(
      tenantPhone,
      "I'm having a technical issue. Please send your document again in a moment.",
    ).catch(() => {});
    throw err;
  }
}

// ─── Document submission handler ───────────────────────────────────────────

interface SubmissionContext {
  message: ParsedMessage;
  sessionId: string;
  landlordId: string;
  tenantPhone: string;
  tenantName?: string;
  mediaStoragePath: string;
  collected: CollectedDocuments;
  nextRequired: DocumentCategory | null;
  onHandoff: DocCollectorInput["onHandoff"];
}

async function handleDocumentSubmission(ctx: SubmissionContext): Promise<void> {
  const {
    message,
    sessionId,
    landlordId,
    tenantPhone,
    tenantName,
    mediaStoragePath,
    collected,
    nextRequired,
    onHandoff,
  } = ctx;

  // Tell the tenant we're checking.
  await sendTextMessage(
    tenantPhone,
    "Got it, one moment while I check it... 🔍",
  );

  // Download bytes from Supabase Storage for Claude vision.
  const bucket = Deno.env.get("MEDIA_BUCKET") ?? "tenant-documents";
  const bytes = await downloadFromStorage(bucket, mediaStoragePath);
  const mimeType = message.media?.mimeType ?? "image/jpeg";

  // Validate with Claude vision.
  const validation = await validateDocument(bytes, mimeType, tenantName);

  if (!validation.isValid || validation.category === "unknown") {
    // Send rejection message and re-ask for the correct document.
    const rejectionText =
      validation.rejectionMessage ??
      buildRejectionMessage(validation, nextRequired);

    await sendTextMessage(tenantPhone, rejectionText);

    // Log the failed attempt.
    await logAgentInteraction({
      sessionId,
      landlordId,
      tenantPhone,
      action: "document_rejected",
      details: validation,
    });
    return;
  }

  // Determine the canonical category this document belongs to.
  // If Claude identified it as a category we've already collected, treat it as
  // the next required category (tenant may have sent the wrong thing or we
  // detected the previous category again — ask them to send the right one).
  const docCategory = resolveCategory(
    validation.category as DocumentCategory,
    nextRequired,
    collected,
  );

  if (!docCategory) {
    await sendTextMessage(
      tenantPhone,
      "I think that might be a duplicate. " +
        nextRequired
        ? `I still need your ${DOC_LABELS[nextRequired!]} — could you send that instead?`
        : "All documents are already collected!",
    );
    return;
  }

  // Persist the document record.
  const collectedDoc = await persistDocument({
    sessionId,
    landlordId,
    category: docCategory,
    storagePath: mediaStoragePath,
    validation,
  });

  // Update session.agent_state.
  const updatedCollected = { ...collected, [docCategory]: collectedDoc };
  await updateDocumentState(sessionId, updatedCollected);

  // Log success.
  await logAgentInteraction({
    sessionId,
    landlordId,
    tenantPhone,
    action: "document_accepted",
    details: { category: docCategory, documentType: validation.documentType },
  });

  // Check if all required documents are now collected.
  const allDone = REQUIRED_DOCS.every((cat) => updatedCollected[cat]);

  if (allDone) {
    // Conversational sign-off message.
    await sendTextMessage(
      tenantPhone,
      "✅ All documents received and verified!\n\n" +
        "I'll now move on to checking your right to rent in the UK. " +
        "I'll be in touch shortly.",
    );

    // Signal handoff to right_to_rent.
    await onHandoff("right_to_rent", { documentsCollected: updatedCollected });
    return;
  }

  // Ask for the next required document.
  const nextAfterThis = getNextRequired(updatedCollected);
  if (nextAfterThis) {
    const confirmText = buildConfirmationMessage(docCategory, validation);
    await sendTextMessage(tenantPhone, confirmText);

    // Phase 2: Konfir handles income verification for Pro and above.
    // Pay-Per-Screen always uses Phase 1 (payslip photo + Claude vision).
    if (nextAfterThis === "proof_of_income" && await shouldUseKonfir(landlordId)) {
      await initiateKonfirVerification(tenantPhone, tenantName ?? "Tenant", sessionId);
    } else {
      // Phase 1: ask tenant to photograph their document.
      await sendTextMessage(tenantPhone, DOC_REQUEST_MESSAGES[nextAfterThis]);
    }
  }
}

// ─── Text message handler ──────────────────────────────────────────────────

interface TextContext {
  message: ParsedMessage;
  sessionId: string;
  landlordId: string;
  tenantPhone: string;
  tenantName?: string;
  collected: CollectedDocuments;
  nextRequired: DocumentCategory | null;
}

async function handleTextMessage(ctx: TextContext): Promise<void> {
  const {
    message,
    sessionId,
    landlordId,
    tenantPhone,
    tenantName,
    collected,
    nextRequired,
  } = ctx;

  // Load conversation history.
  const history = await loadConversationHistory(sessionId, tenantPhone);

  // Build system prompt with state context injected.
  const systemPrompt = await buildSystemPrompt({
    collected,
    tenantName,
    nextRequired,
    landlordId,
  });

  const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

  const currentMessage = message.text ?? message.interactive?.title ?? "[No text]";

  const response = await anthropic.messages.create({
    model: MODELS.ACCURATE,
    max_tokens: CLAUDE_MAX_TOKENS,
    system: systemPrompt,
    messages: [
      ...history,
      { role: "user", content: currentMessage },
    ],
  });

  const replyText = (response.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();

  if (replyText) {
    await sendTextMessage(tenantPhone, replyText);
  }
}

// ─── Claude vision validation ──────────────────────────────────────────────

const VALIDATION_PROMPT = `You are validating a document submitted for a UK rental application.
Analyse the document carefully and respond ONLY with a JSON object (no markdown, no explanation).

Required JSON fields:
{
  "documentType": "<specific type, e.g. 'UK Passport', 'PAYE Payslip', 'Utility Bill'>",
  "category": "<one of: photo_id | proof_of_income | proof_of_address | unknown>",
  "fullName": "<name exactly as shown, or null>",
  "dateOfBirth": "<YYYY-MM-DD or null>",
  "expiryDate": "<YYYY-MM-DD or null>",
  "issueDate": "<YYYY-MM-DD or null>",
  "documentNumber": "<document/reference number or null>",
  "address": "<full address shown on document or null>",
  "employerName": "<employer name for payslips or null>",
  "grossIncome": <monthly gross in GBP as number, or null>,
  "netIncome": <monthly net in GBP as number, or null>,
  "payPeriodStart": "<YYYY-MM-DD or null>",
  "payPeriodEnd": "<YYYY-MM-DD or null>",
  "isExpired": <true if expiry date is in the past, else false>,
  "isLegible": <true if the document is clearly readable, false if blurry/cropped/obstructed>,
  "isWithinThreeMonths": <true/false for payslips and bills, null for ID documents>,
  "isCurrentYear": <true/false for council tax bills, null otherwise>,
  "confidence": "<high | medium | low>",
  "issues": ["<list of specific problems found, or empty array if none>"],
  "isValid": <true if the document passes all checks for its type, false otherwise>
}

Validation rules:
- photo_id: must be legible, not expired, show full name and date of birth
- proof_of_income (payslip): must be legible, within last 3 months, show employer name and gross income
- proof_of_income (bank statements): must show salary credits in last 3 months
- proof_of_income (accountant letter/SA302): must be legible, show annual income
- proof_of_address (utility/bank bill): must be legible, dated within last 3 months, show full address
- proof_of_address (council tax): must be legible, current year (April to March), show full address
- Any document: blurry, cropped, or obstructed = isLegible: false, isValid: false

If you cannot determine the category, set category to "unknown" and isValid to false.
If the image is not a document (e.g. a selfie, random photo), set category to "unknown".`;

async function validateDocument(
  bytes: Uint8Array,
  mimeType: string,
  tenantName?: string,
): Promise<ValidationResult> {
  const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

  const promptWithContext = tenantName
    ? `${VALIDATION_PROMPT}\n\nExpected tenant name (from pre-qualification): "${tenantName}". Note in issues if the name on the document does not match.`
    : VALIDATION_PROMPT;

  // Build the content array based on MIME type.
  const content: Anthropic.ContentBlockParam[] = [];

  if (mimeType === "application/pdf") {
    // Claude supports PDFs as document content blocks.
    content.push({
      type: "document" as const,
      source: {
        type: "base64" as const,
        media_type: "application/pdf" as const,
        data: toBase64(bytes),
      },
    } as unknown as Anthropic.ContentBlockParam);
  } else {
    // Image content block.
    const imageMediaType = (
      mimeType === "image/png"   ? "image/png"  :
      mimeType === "image/gif"   ? "image/gif"  :
      mimeType === "image/webp"  ? "image/webp" :
      "image/jpeg"
    ) as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imageMediaType,
        data: toBase64(bytes),
      },
    });
  }

  content.push({ type: "text", text: promptWithContext });

  let rawJson = "";
  try {
    const response = await anthropic.messages.create({
      model: MODELS.ACCURATE,
      max_tokens: 1024,
      messages: [{ role: "user", content }],
    });

    rawJson = (response.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();

    // Strip any accidental markdown fences.
    const jsonMatch = /\{[\s\S]*\}/.exec(rawJson);
    if (!jsonMatch) throw new Error("No JSON object found in validation response");
    rawJson = jsonMatch[0];

    const parsed = JSON.parse(rawJson) as Partial<ValidationResult>;

    // Normalise and fill defaults.
    return {
      isValid:             parsed.isValid             ?? false,
      category:            parsed.category            ?? "unknown",
      documentType:        parsed.documentType        ?? "Unknown document",
      fullName:            parsed.fullName            ?? undefined,
      dateOfBirth:         parsed.dateOfBirth         ?? undefined,
      expiryDate:          parsed.expiryDate          ?? undefined,
      issueDate:           parsed.issueDate           ?? undefined,
      documentNumber:      parsed.documentNumber      ?? undefined,
      address:             parsed.address             ?? undefined,
      employerName:        parsed.employerName        ?? undefined,
      grossIncome:         parsed.grossIncome         ?? undefined,
      netIncome:           parsed.netIncome           ?? undefined,
      payPeriodStart:      parsed.payPeriodStart      ?? undefined,
      payPeriodEnd:        parsed.payPeriodEnd        ?? undefined,
      isExpired:           parsed.isExpired           ?? false,
      isLegible:           parsed.isLegible           ?? true,
      isWithinThreeMonths: parsed.isWithinThreeMonths ?? undefined,
      isCurrentYear:       parsed.isCurrentYear       ?? undefined,
      confidence:          parsed.confidence          ?? "low",
      issues:              Array.isArray(parsed.issues) ? parsed.issues : [],
    };
  } catch (err) {
    console.error("Document validation parse error:", err, "rawJson:", rawJson);
    // Return a safe failure so the tenant gets an informative message.
    return {
      isValid: false,
      category: "unknown",
      documentType: "Unknown",
      isExpired: false,
      isLegible: false,
      confidence: "low",
      issues: ["Document could not be read — please send a clearer photo"],
      rejectionMessage:
        "I wasn't able to read that document clearly. Could you try again with a clearer photo? " +
        "Make sure the document is flat, well-lit, and all text is visible.",
    };
  }
}

// ─── State management ──────────────────────────────────────────────────────

interface SessionState {
  collected: CollectedDocuments;
  tenantName?: string;
}

async function loadState(sessionId: string): Promise<SessionState> {
  const { data, error } = await supabase
    .from("screening_sessions")
    .select("agent_state, pre_qualifying_summary")
    .eq("id", sessionId)
    .single();

  if (error) {
    console.error("Failed to load session state:", error.message);
    return { collected: {} };
  }

  const agentState = data?.agent_state as Record<string, unknown> | null;
  const preSummary = data?.pre_qualifying_summary as { name?: string } | null;

  return {
    collected: (agentState?.documents_collected as CollectedDocuments) ?? {},
    tenantName: preSummary?.name,
  };
}

async function updateDocumentState(
  sessionId: string,
  documents: CollectedDocuments,
): Promise<void> {
  // Load current agent_state to merge (avoid overwriting other keys).
  const { data } = await supabase
    .from("screening_sessions")
    .select("agent_state")
    .eq("id", sessionId)
    .single();

  const current = (data?.agent_state as Record<string, unknown>) ?? {};
  const updated = { ...current, documents_collected: documents };

  const { error } = await supabase
    .from("screening_sessions")
    .update({ agent_state: updated })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to update document state: ${error.message}`);
  }
}

// ─── Document persistence ──────────────────────────────────────────────────

async function persistDocument(params: {
  sessionId: string;
  landlordId: string;
  category: DocumentCategory;
  storagePath: string;
  validation: ValidationResult;
}): Promise<CollectedDoc> {
  const { sessionId, landlordId, category, storagePath, validation } = params;

  const { error } = await supabase.from("documents").insert({
    session_id: sessionId,
    landlord_id: landlordId,
    category,
    document_type: validation.documentType,
    storage_path: storagePath,
    passed: validation.isValid,
    issues: validation.issues,
    confidence: validation.confidence,
    extracted_data: {
      name:                   validation.fullName,
      dateOfBirth:            validation.dateOfBirth,
      expiryDate:             validation.expiryDate,
      issueDate:              validation.issueDate,
      documentNumber:         validation.documentNumber,
      address:                validation.address,
      employerName:           validation.employerName,
      grossIncome:            validation.grossIncome,
      netIncome:              validation.netIncome,
      payPeriodStart:         validation.payPeriodStart,
      payPeriodEnd:           validation.payPeriodEnd,
    },
    created_at: new Date().toISOString(),
  });

  if (error) {
    // Non-fatal — continue even if the DB write fails.
    console.error("Failed to persist document record:", error.message);
  }

  return {
    category,
    storagePath,
    documentType: validation.documentType,
    extractedName: validation.fullName,
    extractedDob: validation.dateOfBirth,
    extractedExpiry: validation.expiryDate,
    extractedDocNumber: validation.documentNumber,
    extractedAddress: validation.address,
    extractedEmployer: validation.employerName,
    extractedGrossIncome: validation.grossIncome,
    issueDate: validation.issueDate,
    validatedAt: new Date().toISOString(),
    confidence: validation.confidence,
  };
}

// ─── Conversation history ──────────────────────────────────────────────────

async function loadConversationHistory(
  sessionId: string,
  tenantPhone: string,
): Promise<Anthropic.MessageParam[]> {
  const { data: rows } = await supabase
    .from("messages")
    .select("direction, text")
    .eq("session_id", sessionId)
    .or(`from_phone.eq.${tenantPhone},to_phone.eq.${tenantPhone}`)
    .not("text", "is", null)
    .order("received_at", { ascending: true })
    .limit(40); // Smaller cap — doc collection is shorter than pre-qualifying

  if (!rows || rows.length === 0) return [];

  const history: Anthropic.MessageParam[] = [];

  for (const row of rows) {
    const role: "user" | "assistant" = row.direction === "inbound" ? "user" : "assistant";
    const content = row.text?.trim();
    if (!content) continue;

    const last = history[history.length - 1];
    if (last && last.role === role && typeof last.content === "string") {
      last.content += `\n\n${content}`;
    } else {
      history.push({ role, content });
    }
  }

  // Claude requires messages array to start with a user turn.
  while (history.length > 0 && history[0].role !== "user") {
    history.shift();
  }

  return history;
}

// ─── System prompt builder ─────────────────────────────────────────────────

async function buildSystemPrompt(ctx: {
  collected: CollectedDocuments;
  tenantName?: string;
  nextRequired: DocumentCategory | null;
  landlordId?: string;
}): Promise<string> {
  const promptPath = new URL("../prompts/doc-collector.md", import.meta.url);
  const basePrompt = await Deno.readTextFile(promptPath);

  const collectedSummary = REQUIRED_DOCS.map((cat) => {
    const doc = ctx.collected[cat];
    return doc
      ? `- ${DOC_LABELS[cat]}: ✅ Collected (${doc.documentType})`
      : `- ${DOC_LABELS[cat]}: ⏳ Still needed`;
  }).join("\n");

  const useKonfir = ctx.landlordId ? await shouldUseKonfir(ctx.landlordId) : false;
  const konfirLine = useKonfir && ctx.nextRequired === "proof_of_income"
    ? "**Income verification method**: Konfir API (Phase 2) — a Konfir SMS has been sent to the tenant. Do NOT ask for a payslip photo. Tell the tenant to check their SMS and follow the Konfir link."
    : useKonfir
    ? "**Income verification method**: Konfir API (Phase 2) — income will be verified automatically via Konfir SMS when the time comes. Do NOT ask for a payslip photo."
    : "**Income verification method**: Phase 1 — ask tenant to send a payslip photo or bank statement via WhatsApp.";

  const contextBlock = [
    "## Current Session State (do not share with tenant)\n",
    `**Tenant name from pre-qualification**: ${ctx.tenantName ?? "Not yet known"}`,
    `**Next required document**: ${ctx.nextRequired ? DOC_LABELS[ctx.nextRequired] : "All documents collected!"}`,
    konfirLine,
    "\n**Document collection progress**:",
    collectedSummary,
    "",
  ].join("\n");

  return `${contextBlock}\n---\n\n${basePrompt}`;
}

// ─── Routing helpers ───────────────────────────────────────────────────────

function getNextRequired(collected: CollectedDocuments): DocumentCategory | null {
  return REQUIRED_DOCS.find((cat) => !collected[cat]) ?? null;
}

function isMediaMessage(message: ParsedMessage): boolean {
  return ["image", "document", "video"].includes(message.type);
}

/**
 * Maps Claude's identified category to the canonical next category.
 * If Claude identified a category that's already collected, we fall back to
 * nextRequired (the tenant probably sent the wrong thing or re-sent).
 */
function resolveCategory(
  identified: DocumentCategory,
  nextRequired: DocumentCategory | null,
  collected: CollectedDocuments,
): DocumentCategory | null {
  // If the identified category is valid and not yet collected, use it.
  if (REQUIRED_DOCS.includes(identified) && !collected[identified]) {
    return identified;
  }

  // Otherwise fall back to whatever we're currently expecting.
  return nextRequired;
}

// ─── Message builders ──────────────────────────────────────────────────────

function buildConfirmationMessage(
  category: DocumentCategory,
  validation: ValidationResult,
): string {
  switch (category) {
    case "photo_id":
      return (
        `✅ *${validation.documentType}* received and verified` +
        (validation.fullName ? ` for *${validation.fullName}*` : "") +
        "."
      );
    case "proof_of_income":
      return (
        `✅ *${validation.documentType}* verified` +
        (validation.employerName ? ` from *${validation.employerName}*` : "") +
        (validation.grossIncome ? ` — gross income £${validation.grossIncome.toLocaleString("en-GB")}/mo` : "") +
        "."
      );
    case "proof_of_address":
      return `✅ *${validation.documentType}* verified.`;
    default:
      return `✅ *${validation.documentType}* received and verified.`;
  }
}

function buildRejectionMessage(
  validation: ValidationResult,
  nextRequired: DocumentCategory | null,
): string {
  const docLabel = nextRequired ? DOC_LABELS[nextRequired] : "this document";

  if (!validation.isLegible) {
    return (
      `I'm having trouble reading that — the image may be blurry or the text is obscured. 📸\n\n` +
      `Could you resend your *${docLabel}*? Try:\n` +
      `• Laying it flat on a light surface\n` +
      `• Making sure the whole document is in frame\n` +
      `• Avoiding direct light or shadow`
    );
  }

  if (validation.isExpired) {
    return (
      `That document appears to have expired ` +
      (validation.expiryDate
        ? `on *${formatDate(validation.expiryDate)}*`
        : "recently") +
      `. Could you send a current one instead?`
    );
  }

  if (validation.isWithinThreeMonths === false) {
    return (
      `That document is more than 3 months old, so I can't accept it for this application.\n\n` +
      `Could you send a more recent one — ideally from the last 3 months?`
    );
  }

  if (validation.category === "unknown") {
    const expected = nextRequired ? `a *${DOC_LABELS[nextRequired]}*` : "the correct document";
    return (
      `I wasn't quite sure what that was. At this stage I need ${expected}.\n\n` +
      (nextRequired ? DOC_REQUEST_MESSAGES[nextRequired] : "")
    );
  }

  if (validation.issues.length > 0) {
    const issueList = validation.issues.map((i) => `• ${i}`).join("\n");
    return `There's an issue with that document:\n\n${issueList}\n\nCould you try again?`;
  }

  return `I couldn't verify that document. Could you try sending it again? If you're having trouble, reply *HELP*.`;
}

// ─── Konfir API — Phase 2 income verification ─────────────────────────────
//
// When KONFIR_ENABLED=true, instead of asking the tenant to send a payslip photo
// we call the Konfir API which sends the tenant an SMS. The tenant consents in
// ~30 seconds and Konfir pulls employment + income data directly from HMRC,
// payroll systems, and Open Banking. Results arrive via the konfir-callback
// Edge Function which calls handleKonfirCallback() below.
//
// Phase 1 (payslip + Claude vision) remains the default and is unaffected.

const KONFIR_API_URL = "https://api.konfir.com/v1/verifications";

export async function initiateKonfirVerification(
  tenantPhone: string,
  tenantName: string,
  sessionId: string,
): Promise<void> {
  const konfirApiKey = Deno.env.get("KONFIR_API_KEY");
  if (!konfirApiKey) {
    throw new Error("KONFIR_API_KEY is not set — cannot initiate Konfir verification");
  }

  const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const webhookUrl = `${baseUrl}/functions/v1/konfir-callback?session=${sessionId}`;

  const response = await fetch(KONFIR_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${konfirApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      candidate: { name: tenantName, phone: tenantPhone },
      checks: ["employment", "income"],
      webhook_url: webhookUrl,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Konfir API error ${response.status}: ${body}`);
  }

  // Tell the tenant to expect the Konfir SMS.
  await sendTextMessage(
    tenantPhone,
    "You'll receive an SMS from *Konfir* shortly to verify your employment and income. " +
    "Just follow the link and give consent — it takes about 30 seconds. No documents needed. 📲\n\n" +
    "_Konfir is a UK Government certified employment verification service (part of Experian). " +
    "Your data is used only for this tenancy application._",
  );
}

/**
 * Called by the konfir-callback Edge Function when Konfir posts verification results.
 * Stores a proof_of_income document record and returns the CollectedDoc for state update.
 */
export async function handleKonfirCallback(
  sessionId: string,
  landlordId: string,
  report: KonfirReport,
): Promise<CollectedDoc> {
  const validationNotes = {
    employer:              report.employer_name,
    job_title:             report.job_title,
    tenure_months:         report.tenure_months,
    gross_monthly_income:  report.gross_monthly_income,
    net_monthly_income:    report.net_monthly_income,
    employment_start_date: report.employment_start_date,
    gaps_flagged:          report.gaps ?? [],
    verification_sources:  report.sources,
  };

  const { error } = await supabase.from("documents").insert({
    session_id:       sessionId,
    landlord_id:      landlordId,
    category:         "proof_of_income" as DocumentCategory,
    document_type:    "konfir_verification",
    storage_path:     null,
    passed:           true,
    issues:           [],
    confidence:       "high",
    extracted_data: {
      employerName: report.employer_name,
      grossIncome:  report.gross_monthly_income,
      netIncome:    report.net_monthly_income,
      konfirNotes:  validationNotes,
    },
    validation_notes: JSON.stringify(validationNotes),
    created_at:       new Date().toISOString(),
  });

  if (error) {
    console.error("handleKonfirCallback: failed to persist document:", error.message);
  }

  return {
    category:             "proof_of_income",
    storagePath:          "",
    documentType:         "konfir_verification",
    extractedEmployer:    report.employer_name,
    extractedGrossIncome: report.gross_monthly_income,
    validatedAt:          new Date().toISOString(),
    confidence:           "high",
  };
}

/** Shape of the Konfir verification report posted to our webhook. */
export interface KonfirReport {
  employer_name:         string;
  job_title:             string;
  tenure_months:         number;
  gross_monthly_income:  number;
  net_monthly_income:    number;
  employment_start_date: string;
  gaps?:                 string[];
  sources:               string[];   // e.g. ["hmrc", "payroll", "open_banking"]
}

// ─── Agent logging ─────────────────────────────────────────────────────────

async function logAgentInteraction(params: {
  sessionId: string;
  landlordId: string;
  tenantPhone: string;
  action: string;
  details: unknown;
}): Promise<void> {
  const { error } = await supabase.from("agent_logs").insert({
    session_id: params.sessionId,
    landlord_id: params.landlordId,
    agent_type: "screener",
    agent_subtype: "doc_collector",
    input: { phone: params.tenantPhone },
    output: { action: params.action, details: params.details },
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.error("Failed to log agent interaction:", error.message);
  }
}

// ─── Utilities ─────────────────────────────────────────────────────────────

/**
 * Safe base64 encoder for large Uint8Arrays.
 * Processes in 8 KB chunks to avoid call-stack overflow on large files.
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 8_192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function downloadFromStorage(
  bucket: string,
  storagePath: string,
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .download(storagePath);

  if (error || !data) {
    throw new Error(`Failed to download ${storagePath}: ${error?.message ?? "no data"}`);
  }

  return new Uint8Array(await (data as Blob).arrayBuffer());
}

function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return isoDate;
  }
}
