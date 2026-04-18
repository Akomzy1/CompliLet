// MARKETPLACE: Phase 2 feature. Currently disabled via MARKETPLACE_ENABLED flag.
// When ready to enable, set MARKETPLACE_ENABLED = true in contractor-flow.ts
// and the 3-option flow will activate automatically.

/**
 * CompliLet — Maintenance Triage Agent
 *
 * Handles maintenance reports from tenants in active tenancies. Uses Claude
 * vision (when photos are available) to classify severity and route the issue
 * to either a self-fix guide or landlord escalation.
 *
 * Flow:
 *   1. Tenant sends maintenance keyword or photo → initial intake
 *   2. EMERGENCY keywords → immediate safety response, no vision needed
 *   3. Description + optional photo → Claude vision analysis → structured JSON
 *   4. LOW/MEDIUM + self-fixable → send step-by-step guide, await result
 *   5. HIGH/EMERGENCY or self-fix failed → create ticket, find contractor,
 *      alert landlord with AI summary + photos
 *   6. Follow-up at 48h (via maintenance-followup-cron)
 *
 * State is stored in maintenance_tickets.status (the ticket IS the state):
 *   drafting          — intake in progress, collecting description/photos
 *   self_fix          — self-fix instructions sent, awaiting tenant feedback
 *   open              — escalated to landlord, awaiting contractor
 *   in_progress       — contractor assigned
 *   resolved          — tenant confirmed resolution
 *   closed            — manually closed
 *
 * SAFETY RULES (enforced in system prompt AND in code):
 *   - Gas smell/leak: NEVER wait for photos. Send 0800 111 999 immediately.
 *   - Immediate danger to life: advise 999. Never diagnose electrical faults.
 *   - Carbon monoxide: advise leaving property + calling 0800 111 999.
 *
 * Database assumptions:
 *   maintenance_tickets (
 *     id UUID, tenancy_id UUID, landlord_id UUID, tenant_phone TEXT,
 *     property_address TEXT, category TEXT, severity TEXT, title TEXT,
 *     description TEXT, ai_summary TEXT, photos_storage_paths TEXT[],
 *     self_fix_attempted BOOLEAN, contractor_id UUID, contractor_name TEXT,
 *     status TEXT,   -- drafting | self_fix | open | in_progress | resolved | closed
 *     follow_up_sent BOOLEAN, opened_at TIMESTAMPTZ,
 *     resolved_at TIMESTAMPTZ, resolution_notes TEXT,
 *     created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
 *   )
 *
 * Called by: coordinator.ts → routeActiveTenancy
 */

import Anthropic from "npm:@anthropic-ai/sdk@0.24";
import { supabase } from "../supabase.ts";
import { sendTextMessage } from "../whatsapp.ts";
import {
  MODELS,
  CLAUDE_MAX_TOKENS,
  MAINTENANCE_AUTO_AUTHORISE_LIMIT_GBP,
  EMERGENCY_MAINTENANCE_KEYWORDS,
} from "../constants.ts";
import type { ParsedMessage, MaintenanceCategory, MaintenanceUrgency } from "../types.ts";
import { presentContractorOptions } from "../contractor-flow.ts";

// ─── Public Interface ───────────────────────────────────────────────────────

export interface MaintenanceAgentInput {
  message: ParsedMessage;
  /** Tenant's screening session — used to resolve tenancy + landlord */
  sessionId?: string;
  /** Landlord id — present when landlord messages about maintenance */
  landlordId?: string;
  /** Storage path of uploaded photo (already uploaded by webhook-handler) */
  mediaStorageUrl?: string;
  /** Set by coordinator when pre-classified emergency keywords are detected */
  isEmergency?: boolean;
}

export async function runMaintenanceAgent(
  input: MaintenanceAgentInput,
): Promise<void> {
  const { message, sessionId, landlordId, mediaStorageUrl, isEmergency } = input;
  const phone = message.from;
  const text = (message.text ?? message.interactive?.title ?? "").trim();
  const lower = text.toLowerCase();

  try {
    // ── Resolve context ─────────────────────────────────────────────────
    const ctx = sessionId
      ? await resolveTenantContext(sessionId)
      : landlordId
        ? await resolveLandlordContext(landlordId)
        : null;

    if (!ctx) {
      await sendTextMessage(
        phone,
        "I couldn't find an active tenancy for your account. " +
          "Please contact your landlord directly.",
      );
      return;
    }

    // ── Landlord update path ────────────────────────────────────────────
    if (input.landlordId && !sessionId) {
      await handleLandlordUpdate(ctx, lower, phone);
      return;
    }

    // ── Emergency: gas / CO / fire — immediate safety, no photos needed ─
    const hasGasKeyword = /\b(gas\s*(leak|smell|fumes?)|smell\s*(of\s*)?gas|gas\s*emergency)\b/i.test(text);
    const hasCOKeyword = /\b(carbon\s*monoxide|co\s*alarm|co\s*detector)\b/i.test(text);
    const hasFireKeyword = /\b(fire|flames?|smoke|burning|ablaze)\b/i.test(text);

    if (hasGasKeyword || hasCOKeyword || isEmergency && (hasGasKeyword || hasCOKeyword)) {
      await handleGasOrCOEmergency(ctx, phone, hasGasKeyword, hasCOKeyword);
      return;
    }

    if (hasFireKeyword && isEmergency) {
      await handleFireEmergency(ctx, phone);
      return;
    }

    // ── Find open (non-terminal) ticket for this tenant ──────────────────
    const openTicket = await getOpenTicket(phone);

    // ── Route by state ──────────────────────────────────────────────────
    if (!openTicket) {
      // New report — intake
      await handleNewReport(ctx, phone, text, mediaStorageUrl);
      return;
    }

    switch (openTicket.status) {
      case "drafting":
        await handleDraftingState(ctx, openTicket, phone, text, mediaStorageUrl);
        break;

      case "self_fix":
        await handleSelfFixFeedback(ctx, openTicket, phone, lower);
        break;

      case "open":
      case "in_progress":
        await handleOpenTicketUpdate(openTicket, phone, lower);
        break;

      default:
        await handleNewReport(ctx, phone, text, mediaStorageUrl);
    }

  } catch (err) {
    console.error("[maintenance-agent] Error:", err);
    await sendTextMessage(
      phone,
      "Sorry, I had a problem processing your maintenance report. " +
        "Please try again, or contact your landlord directly for urgent issues.",
    ).catch(() => {});
  }
}

// ─── Emergency handlers ───────────────────────────────────────────────────────

async function handleGasOrCOEmergency(
  ctx: TenantContext,
  phone: string,
  isGas: boolean,
  isCO: boolean,
): Promise<void> {
  const emergency = isGas ? "gas leak" : "carbon monoxide alarm";

  await sendTextMessage(
    phone,
    `EMERGENCY — ${isGas ? "Suspected Gas Leak" : "Carbon Monoxide Alert"}\n\n` +
      `If you can smell gas or your CO alarm is sounding:\n\n` +
      `1. DO NOT turn any electrical switches on or off\n` +
      `2. DO NOT use lighters, matches, or any naked flame\n` +
      `3. Open windows and doors immediately\n` +
      `4. Leave the property NOW\n` +
      `5. Call the National Gas Emergency Service: *0800 111 999* (free, 24/7)\n` +
      `6. Do not re-enter until the engineer says it is safe\n\n` +
      `Your landlord is being notified immediately.`,
  );

  // Alert landlord at once.
  await sendTextMessage(
    ctx.landlordPhone,
    `EMERGENCY — ${ctx.propertyAddress}\n\n` +
      `${ctx.tenantName} has reported a possible ${emergency} at your property.\n\n` +
      `National Gas Emergency (24/7): *0800 111 999*\n\n` +
      `Please contact your tenant immediately and do NOT enter the property until ` +
      `an engineer has confirmed it is safe.`,
  );

  await openEmergencyTicket(ctx, phone, emergency, "emergency");
}

async function handleFireEmergency(ctx: TenantContext, phone: string): Promise<void> {
  await sendTextMessage(
    phone,
    `FIRE EMERGENCY\n\n` +
      `If there is an active fire:\n\n` +
      `1. Leave the property immediately — do not collect belongings\n` +
      `2. Call 999 now\n` +
      `3. Do not re-enter under any circumstances\n\n` +
      `Your landlord is being notified.`,
  );

  await sendTextMessage(
    ctx.landlordPhone,
    `EMERGENCY — ${ctx.propertyAddress}\n\n` +
      `${ctx.tenantName} has reported a fire at your property. ` +
      `Emergency services have been advised. Please do NOT enter until 999 confirms it is safe.`,
  );

  await openEmergencyTicket(ctx, phone, "fire / smoke", "emergency");
}

// ─── Intake ───────────────────────────────────────────────────────────────────

async function handleNewReport(
  ctx: TenantContext,
  phone: string,
  text: string,
  mediaStorageUrl?: string,
): Promise<void> {
  const firstName = firstNameOf(ctx.tenantName ?? phone);

  // If they've included a photo AND text description, go straight to analysis.
  if (mediaStorageUrl && text.length > 10) {
    const ticket = await createDraftTicket(ctx, phone, text, [mediaStorageUrl]);
    await analyseAndRespond(ctx, ticket, phone, text, mediaStorageUrl);
    return;
  }

  // If photo only, store it and ask for description.
  if (mediaStorageUrl && !text) {
    const ticket = await createDraftTicket(ctx, phone, "", [mediaStorageUrl]);
    await supabase
      .from("maintenance_tickets")
      .update({ photos_storage_paths: [mediaStorageUrl], updated_at: now() })
      .eq("id", ticket.id);
    await sendTextMessage(
      phone,
      `Thanks for the photo, ${firstName}. Can you describe the problem in a few words? ` +
        `For example: "the boiler isn't heating water" or "there's a damp patch on the ceiling."`,
    );
    return;
  }

  // Text description only — create drafting ticket and ask for photo.
  const ticket = await createDraftTicket(ctx, phone, text, []);
  await sendTextMessage(
    phone,
    `Thanks ${firstName} — I've logged your report about: *"${truncate(text, 80)}"*\n\n` +
      `To help me assess the issue, please send a photo if you can. ` +
      `If it's not possible to photograph, reply *NOPHOTO* and I'll do my best without one.`,
  );

  void ticket; // suppress unused warning — ticket created for state tracking
}

// ─── Drafting state ───────────────────────────────────────────────────────────

async function handleDraftingState(
  ctx: TenantContext,
  ticket: TicketRow,
  phone: string,
  text: string,
  mediaStorageUrl?: string,
): Promise<void> {
  // New photo arrived.
  if (mediaStorageUrl) {
    const paths = [...((ticket.photos_storage_paths as string[]) ?? []), mediaStorageUrl];
    await supabase
      .from("maintenance_tickets")
      .update({ photos_storage_paths: paths, updated_at: now() })
      .eq("id", ticket.id);

    const description = (ticket.description as string | null) ?? text;
    await analyseAndRespond(ctx, ticket, phone, description, mediaStorageUrl);
    return;
  }

  // "NOPHOTO" — proceed with text only.
  if (/\bnophoto\b/i.test(text)) {
    const description = (ticket.description as string | null) ?? "";
    await analyseAndRespond(ctx, ticket, phone, description, undefined);
    return;
  }

  // Additional text description.
  if (text.length > 3) {
    const combinedDescription = [ticket.description as string, text]
      .filter(Boolean)
      .join(" — ");
    await supabase
      .from("maintenance_tickets")
      .update({ description: combinedDescription, updated_at: now() })
      .eq("id", ticket.id);
    await sendTextMessage(
      phone,
      "Got it — could you also send a photo so I can assess the issue properly? " +
        "If you can't take one, reply *NOPHOTO*.",
    );
  }
}

// ─── Claude vision analysis ───────────────────────────────────────────────────

async function analyseAndRespond(
  ctx: TenantContext,
  ticket: TicketRow,
  phone: string,
  description: string,
  mediaStoragePath?: string,
): Promise<void> {
  await sendTextMessage(phone, "Analysing your report — one moment...");

  // Get a short-lived signed URL for Claude to fetch the image.
  let imageUrl: string | undefined;
  if (mediaStoragePath) {
    const bucket = Deno.env.get("MEDIA_BUCKET") ?? "tenant-documents";
    const { data: signed } = await supabase.storage
      .from(bucket)
      .createSignedUrl(mediaStoragePath, 300); // 5-minute window
    imageUrl = signed?.signedUrl;
  }

  const analysis = await callClaudeAnalysis(description, imageUrl);

  // Store analysis on the ticket.
  await supabase
    .from("maintenance_tickets")
    .update({
      category: analysis.category,
      severity: analysis.severity,
      title: analysis.title,
      ai_summary: analysis.summary,
      updated_at: now(),
    })
    .eq("id", ticket.id);

  const updatedTicket = { ...ticket, ...analysis } as TicketRow;

  // Route based on severity and self-fix possibility.
  const canSelfFix = analysis.selfFixPossible &&
    (analysis.severity === "low" || analysis.severity === "medium");

  if (canSelfFix && analysis.selfFixInstructions.length > 0) {
    await sendSelfFixGuide(updatedTicket, phone, analysis);
  } else {
    await escalateToLandlord(ctx, updatedTicket, phone, analysis);
  }
}

// ─── Self-fix ─────────────────────────────────────────────────────────────────

async function sendSelfFixGuide(
  ticket: TicketRow,
  phone: string,
  analysis: ClaudeAnalysis,
): Promise<void> {
  const steps = analysis.selfFixInstructions
    .map((step, i) => `${i + 1}. ${step}`)
    .join("\n");

  await sendTextMessage(
    phone,
    `*${analysis.title}*\n\n` +
      `This is often fixable without a contractor. Here's what to try:\n\n` +
      `${steps}\n\n` +
      (analysis.safetyWarning ? `Note: ${analysis.safetyWarning}\n\n` : "") +
      `Did that fix it? Reply *YES* if resolved, or *NO* if the problem persists and I'll escalate to your landlord.`,
  );

  await supabase
    .from("maintenance_tickets")
    .update({ status: "self_fix", self_fix_attempted: true, updated_at: now() })
    .eq("id", ticket.id);
}

// ─── Self-fix feedback ────────────────────────────────────────────────────────

async function handleSelfFixFeedback(
  ctx: TenantContext,
  ticket: TicketRow,
  phone: string,
  lower: string,
): Promise<void> {
  const isResolved = /\b(yes|yeah|yep|fixed|working|sorted|all\s+good|resolved|done|it\s+worked)\b/.test(lower);
  const isNotResolved = /\b(no|nope|still|not\s+fixed|didn'?t\s+work|still\s+broken|persists|same\s+issue|worse)\b/.test(lower);

  if (isResolved) {
    await supabase
      .from("maintenance_tickets")
      .update({
        status: "resolved",
        resolved_at: now(),
        resolution_notes: "Tenant resolved via self-fix guide",
        updated_at: now(),
      })
      .eq("id", ticket.id);

    await sendTextMessage(
      phone,
      "Great — glad that sorted it! I've closed the ticket. " +
        "If the issue comes back, just send me another message.",
    );
    return;
  }

  if (isNotResolved) {
    // Escalate to landlord.
    const analysis: ClaudeAnalysis = {
      category: ticket.category as MaintenanceCategory ?? "other",
      severity: ticket.severity as MaintenanceUrgency ?? "medium",
      title: ticket.title as string ?? "Maintenance issue",
      summary: ticket.ai_summary as string ?? ticket.description as string ?? "",
      selfFixPossible: true,
      selfFixInstructions: [],
      requiresContractor: true,
      contractorType: null,
      safetyWarning: null,
    };
    await escalateToLandlord(ctx, ticket, phone, analysis, true);
    return;
  }

  // Ambiguous — prompt.
  await sendTextMessage(
    phone,
    `Did the self-fix work for your *${ticket.title ?? "issue"}*?\n\n` +
      "Reply *YES* if it's resolved, or *NO* if you still need help.",
  );
}

// ─── Landlord escalation ──────────────────────────────────────────────────────

async function escalateToLandlord(
  ctx: TenantContext,
  ticket: TicketRow,
  tenantPhone: string,
  analysis: ClaudeAnalysis,
  selfFixFailed = false,
): Promise<void> {
  const isEmergency = (analysis.severity as string) === "emergency";
  const isHigh = (analysis.severity as string) === "high";

  // Build landlord alert message — context summary first.
  const urgencyEmoji = isEmergency ? "🚨 EMERGENCY" : isHigh ? "⚠️ Urgent" : "📋 New";
  const selfFixNote = selfFixFailed
    ? "The tenant attempted a self-fix but it did not resolve the issue.\n\n"
    : "";

  let landlordMsg =
    `*${urgencyEmoji} Maintenance Report — ${ctx.propertyAddress}*\n\n` +
    `*Tenant:* ${ctx.tenantName}\n` +
    `*Issue:* ${analysis.title}\n` +
    `*Severity:* ${(analysis.severity as string).toUpperCase()}\n\n` +
    `*Summary:* ${analysis.summary}\n\n` +
    selfFixNote;

  if (isEmergency && analysis.safetyWarning) {
    landlordMsg += `SAFETY: ${analysis.safetyWarning}\n\n`;
    landlordMsg += "Please respond to your tenant immediately.";
  }

  // Send the context summary first so the landlord knows what's happening.
  await sendTextMessage(ctx.landlordPhone, landlordMsg);

  // Confirm to tenant.
  const tenantMsg = isEmergency
    ? `I've urgently alerted your landlord about the *${analysis.title}* at ${ctx.propertyAddress}. ` +
      (analysis.safetyWarning ? `\n\nSafety note: ${analysis.safetyWarning}` : "")
    : `I've notified your landlord about the *${analysis.title}* at ${ctx.propertyAddress}. ` +
      `They'll be in touch to arrange a repair. I'll follow up with you in 48 hours.`;
  await sendTextMessage(tenantPhone, tenantMsg);

  // Update ticket to open.
  await supabase
    .from("maintenance_tickets")
    .update({
      status: "open",
      opened_at: now(),
      updated_at: now(),
    })
    .eq("id", ticket.id);

  // Now offer the 3-option contractor flow if a tradesperson is needed.
  if (analysis.requiresContractor && analysis.contractorType) {
    const urgency: "emergency" | "urgent" | "routine" =
      isEmergency ? "emergency" : isHigh ? "urgent" : "routine";

    await presentContractorOptions({
      landlordId:       ctx.landlordId,
      landlordPhone:    ctx.landlordPhone,
      source:           "maintenance",
      trade:            analysis.contractorType,
      job_type:         analysis.title,
      property_address: ctx.propertyAddress,
      ticket_id:        ticket.id,
      tenancy_id:       ctx.tenancyId,
      tenant_phone:     tenantPhone,
      tenant_name:      ctx.tenantName ?? undefined,
      urgency,
    });
  }
}

// ─── Landlord update ─────────────────────────────────────────────────────────

async function handleLandlordUpdate(
  ctx: LandlordContext,
  lower: string,
  phone: string,
): Promise<void> {
  // Find the most recent open ticket for this landlord.
  const { data: ticket } = await supabase
    .from("maintenance_tickets")
    .select("id, title, tenant_phone, status")
    .eq("landlord_id", ctx.landlordId)
    .in("status", ["open", "in_progress"])
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!ticket) {
    await sendTextMessage(phone, "You have no open maintenance tickets at the moment.");
    return;
  }

  // Landlord confirms contractor arranged.
  const hasContractorUpdate = /\b(booked|arranged|called|contacted|sent|engineer|contractor|plumber|electrician|someone)\b/.test(lower);
  if (hasContractorUpdate) {
    await supabase
      .from("maintenance_tickets")
      .update({ status: "in_progress", updated_at: now() })
      .eq("id", ticket.id);

    await sendTextMessage(
      phone,
      `Logged — I'll let ${firstNameOf(ticket.tenant_phone as string)} know a contractor has been arranged ` +
        `for the *${ticket.title ?? "maintenance issue"}* and I'll follow up in 48 hours.`,
    );

    // Notify tenant.
    if (ticket.tenant_phone) {
      await sendTextMessage(
        ticket.tenant_phone as string,
        `Your landlord has arranged a contractor to fix the *${ticket.title ?? "issue"}*. ` +
          "They'll be in touch to arrange access. I'll follow up in 48 hours to check progress.",
      );
    }
    return;
  }

  // Landlord marks as resolved.
  if (/\b(resolved|fixed|done|sorted|completed|finished|closed)\b/.test(lower)) {
    await supabase
      .from("maintenance_tickets")
      .update({
        status: "resolved",
        resolved_at: now(),
        resolution_notes: "Marked resolved by landlord",
        updated_at: now(),
      })
      .eq("id", ticket.id);

    await sendTextMessage(phone, `Ticket closed — *${ticket.title ?? "maintenance issue"}* marked as resolved.`);

    if (ticket.tenant_phone) {
      await sendTextMessage(
        ticket.tenant_phone as string,
        `Your landlord has confirmed that the *${ticket.title ?? "maintenance issue"}* at your property ` +
          "has been resolved. Please let us know if the problem persists.",
      );
    }
    return;
  }

  // Default: show open tickets.
  await sendTextMessage(
    phone,
    `Open maintenance ticket: *${ticket.title ?? "Issue"}*\n\n` +
      "Reply *BOOKED* when you've arranged a contractor, or *RESOLVED* when the issue is fixed.",
  );
}

// ─── Open ticket update from tenant ──────────────────────────────────────────

async function handleOpenTicketUpdate(
  ticket: TicketRow,
  phone: string,
  lower: string,
): Promise<void> {
  if (/\b(yes|resolved|fixed|sorted|done|working|all\s+good)\b/.test(lower)) {
    await supabase
      .from("maintenance_tickets")
      .update({
        status: "resolved",
        resolved_at: now(),
        resolution_notes: "Tenant confirmed resolution",
        follow_up_sent: true,
        updated_at: now(),
      })
      .eq("id", ticket.id);

    await sendTextMessage(
      phone,
      `Great — I've closed the ticket for *${ticket.title ?? "your issue"}*. ` +
        "Thanks for confirming! If anything else comes up, just message me.",
    );
    return;
  }

  if (/\b(no|not\s+yet|still|waiting|nothing|no\s+update|no\s+one\s+came)\b/.test(lower)) {
    await sendTextMessage(
      phone,
      `I understand — your landlord has been chasing up the *${ticket.title ?? "issue"}*. ` +
        "I'll send them a reminder. If this is now urgent, reply *URGENT*.",
    );
    // Would trigger a landlord reminder here — out of scope for this turn.
    return;
  }

  if (/\burgent\b/.test(lower)) {
    await sendTextMessage(
      phone,
      "I've flagged this as urgent. Your landlord has been alerted. " +
        "If this is a safety emergency, please call 999 or the National Gas Emergency Service on 0800 111 999.",
    );
    return;
  }

  await sendTextMessage(
    phone,
    `Your maintenance ticket (*${ticket.title ?? "issue"}*) is currently with your landlord.\n\n` +
      "Reply *YES* when the issue has been resolved, or *URGENT* if it has become an emergency.",
  );
}

// ─── Claude vision analysis ───────────────────────────────────────────────────

const MAINTENANCE_SYSTEM_PROMPT = `
You are a property maintenance assessment assistant for CompliLet, a UK letting management service.

Analyse the tenant's description and any attached photo to produce a structured JSON assessment.

CRITICAL SAFETY RULES:
- NEVER attempt to diagnose gas issues. If gas smell, leak or CO is mentioned, immediately classify as "emergency" and include safetyWarning with: "Leave the property immediately. Call National Gas Emergency Service: 0800 111 999 (free, 24/7). Do not re-enter until an engineer confirms it is safe."
- If there is immediate danger to life (structural collapse, fire, serious flooding), classify as "emergency" and safetyWarning must include "Call 999 immediately."
- NEVER advise a tenant to attempt any electrical work themselves.
- If electrical safety is in doubt, always classify as "high" minimum and requiresContractor = true.

Self-fix guidance:
- Only suggest self-fix for genuinely low-risk issues: low boiler pressure, tripped RCD/fuse, blocked sink/drain, dripping tap (cold water only), squeaking door hinge, running toilet cistern.
- Steps must be practical, step-by-step, and safe for a non-technical tenant.
- Do NOT suggest self-fix if the issue could mask a deeper problem (e.g. recurring damp, persistent boiler issues, any smell of gas or burning).

Severity classification:
- low: cosmetic only, no functional impact (scratched surface, cracked tile, stiff door handle)
- medium: functional impact but not a safety risk (dripping tap, no hot water for <24h, broken window latch, damp patch <30cm)
- high: significant impact or minor safety risk (no heating in winter, blocked toilet, roof leak, large damp area, pest infestation, persistent electrical fault)
- emergency: immediate danger to life or property (gas leak, CO alarm, severe flooding, structural danger, fire, no heating when temperature <5°C outside)

Return ONLY valid JSON matching this exact schema — no markdown, no explanation:
{
  "category": "plumbing" | "heating" | "electrical" | "structural" | "appliance" | "pest" | "security" | "damp_mould" | "other",
  "severity": "low" | "medium" | "high" | "emergency",
  "title": "<concise 3-7 word title>",
  "summary": "<2-3 sentence professional summary for landlord>",
  "selfFixPossible": true | false,
  "selfFixInstructions": ["<step 1>", "<step 2>", ...],
  "requiresContractor": true | false,
  "contractorType": "gas_safe" | "electrician" | "plumber" | "general" | null,
  "safetyWarning": "<safety instructions if applicable>" | null
}
`.trim();

interface ClaudeAnalysis {
  category: MaintenanceCategory;
  severity: MaintenanceUrgency;
  title: string;
  summary: string;
  selfFixPossible: boolean;
  selfFixInstructions: string[];
  requiresContractor: boolean;
  contractorType: string | null;
  safetyWarning: string | null;
}

async function callClaudeAnalysis(
  description: string,
  imageUrl?: string,
): Promise<ClaudeAnalysis> {
  const anthropic = new Anthropic({
    apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
  });

  // Build the content array — conditionally include image.
  type ContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "url"; url: string } };

  const content: ContentBlock[] = [];

  if (imageUrl) {
    content.push({
      type: "image",
      source: { type: "url", url: imageUrl },
    });
  }

  content.push({
    type: "text",
    text: description
      ? `Tenant's description: "${description}"\n\nPlease analyse this maintenance issue and return the JSON assessment.`
      : "Please analyse this maintenance issue from the photo and return the JSON assessment.",
  });

  let rawText = "";
  try {
    const response = await anthropic.messages.create({
      model: MODELS.FAST,
      max_tokens: CLAUDE_MAX_TOKENS,
      system: MAINTENANCE_SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    rawText = (response.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();

    // Strip markdown code fences if present.
    rawText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    return JSON.parse(rawText) as ClaudeAnalysis;
  } catch (err) {
    console.error("[maintenance-agent] Claude analysis failed:", err, "raw:", rawText);
    // Safe fallback — treat as medium plumbing issue requiring contractor.
    return {
      category: "other",
      severity: "medium",
      title: "Maintenance issue reported",
      summary: description
        ? `Tenant reports: "${truncate(description, 200)}"`
        : "Tenant has reported a maintenance issue. Photo analysis was not available.",
      selfFixPossible: false,
      selfFixInstructions: [],
      requiresContractor: true,
      contractorType: "general",
      safetyWarning: null,
    };
  }
}

// ─── Database helpers ─────────────────────────────────────────────────────────

interface TicketRow {
  id: string;
  status: string;
  title: string | null;
  description: string | null;
  ai_summary: string | null;
  category: string | null;
  severity: string | null;
  photos_storage_paths: string[] | null;
  self_fix_attempted: boolean;
  tenant_phone: string;
  contractor_id: string | null;
  contractor_name: string | null;
  follow_up_sent: boolean;
  opened_at: string | null;
}

interface TenantContext {
  tenancyId: string;
  landlordId: string;
  landlordPhone: string;
  tenantName: string | null;
  propertyAddress: string;
}

interface LandlordContext {
  landlordId: string;
  propertyAddress?: string;
}

async function resolveTenantContext(sessionId: string): Promise<TenantContext | null> {
  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("id, landlord_id, tenant_name, property_address")
    .eq("session_id", sessionId)
    .eq("status", "active")
    .maybeSingle();

  if (!tenancy) return null;

  const { data: landlord } = await supabase
    .from("landlords")
    .select("whatsapp_number")
    .eq("id", tenancy.landlord_id)
    .maybeSingle();

  return {
    tenancyId:       tenancy.id as string,
    landlordId:      tenancy.landlord_id as string,
    landlordPhone:   landlord?.whatsapp_number as string ?? "",
    tenantName:      tenancy.tenant_name as string | null,
    propertyAddress: tenancy.property_address as string,
  };
}

async function resolveLandlordContext(landlordId: string): Promise<LandlordContext> {
  return { landlordId };
}

async function getOpenTicket(tenantPhone: string): Promise<TicketRow | null> {
  const { data } = await supabase
    .from("maintenance_tickets")
    .select(
      "id, status, title, description, ai_summary, category, severity, " +
      "photos_storage_paths, self_fix_attempted, tenant_phone, " +
      "contractor_id, contractor_name, follow_up_sent, opened_at",
    )
    .eq("tenant_phone", tenantPhone)
    .not("status", "in", '("resolved","closed")')
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as TicketRow | null;
}

async function createDraftTicket(
  ctx: TenantContext,
  tenantPhone: string,
  description: string,
  photoStoragePaths: string[],
): Promise<TicketRow> {
  const { data, error } = await supabase
    .from("maintenance_tickets")
    .insert({
      tenancy_id:           ctx.tenancyId,
      landlord_id:          ctx.landlordId,
      tenant_phone:         tenantPhone,
      property_address:     ctx.propertyAddress,
      description,
      photos_storage_paths: photoStoragePaths,
      status:               "drafting",
      self_fix_attempted:   false,
      follow_up_sent:       false,
      created_at:           now(),
      updated_at:           now(),
    })
    .select("id, status, title, description, ai_summary, category, severity, " +
      "photos_storage_paths, self_fix_attempted, tenant_phone, " +
      "contractor_id, contractor_name, follow_up_sent, opened_at")
    .single();

  if (error) throw new Error(`Failed to create maintenance ticket: ${error.message}`);
  return data as TicketRow;
}

async function openEmergencyTicket(
  ctx: TenantContext,
  tenantPhone: string,
  title: string,
  severity: MaintenanceUrgency,
): Promise<void> {
  await supabase.from("maintenance_tickets").insert({
    tenancy_id:       ctx.tenancyId,
    landlord_id:      ctx.landlordId,
    tenant_phone:     tenantPhone,
    property_address: ctx.propertyAddress,
    title,
    severity,
    category:         severity === "emergency" && title.includes("gas") ? "heating" : "other",
    status:           "open",
    opened_at:        now(),
    follow_up_sent:   false,
    self_fix_attempted: false,
    created_at:       now(),
    updated_at:       now(),
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function firstNameOf(name: string): string {
  return name.split(/\s+/)[0];
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

function now(): string {
  return new Date().toISOString();
}
