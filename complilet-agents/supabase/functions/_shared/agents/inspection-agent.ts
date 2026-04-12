/**
 * CompliLet — Inspection Agent
 *
 * Manages quarterly photo-based property inspections.
 *
 * Two entry points:
 *   1. inspection-cron — creates inspection record and sends initial request to tenant
 *   2. runInspectionAgent() — handles all inbound WhatsApp messages during inspection
 *
 * Flow:
 *   [CRON]  Find tenancies due → create inspections row → WhatsApp tenant
 *   [AGENT] Photo arrives → assign to room → confirm → check completion
 *           All done (or "done" text) → Claude vision analysis → PDF report → landlord
 *   [AGENT] Landlord reply → raise with tenant / create maintenance ticket
 *
 * State is stored in inspections.status and inspections.photos_json.
 * No separate JSONB state — the row itself IS the state machine.
 *
 * Status machine:
 *   awaiting_photos  — created, nothing received yet
 *   partial          — some photos received, more expected
 *   analyzing        — all required rooms done, analysis in progress
 *   completed        — report generated and sent to landlord
 *   overdue          — deadline passed, not all photos received
 *
 * Database assumptions:
 *   inspections (
 *     id UUID,  tenancy_id UUID,  landlord_id UUID,
 *     tenant_phone TEXT,  property_address TEXT,  tenant_name TEXT,
 *     scheduled_date DATE,  initiated_at TIMESTAMPTZ,
 *     status TEXT,   -- awaiting_photos | partial | analyzing | completed | overdue
 *     photos_json JSONB DEFAULT '{}',      -- { room_key: storage_path }
 *     rooms_required TEXT[] NOT NULL,      -- ordered required room keys
 *     reminder_count INTEGER DEFAULT 0,
 *     last_reminder_at TIMESTAMPTZ,
 *     ai_analysis_json JSONB,              -- per-room Claude analysis
 *     overall_condition TEXT,              -- excellent | good | fair | poor
 *     flagged_issues TEXT[],
 *     report_storage_path TEXT,
 *     report_url TEXT,
 *     landlord_notified_at TIMESTAMPTZ,
 *     completed_at TIMESTAMPTZ,
 *     created_at TIMESTAMPTZ,  updated_at TIMESTAMPTZ
 *   )
 *
 *   tenancies (
 *     id UUID,  landlord_id UUID,  tenant_phone TEXT,  tenant_name TEXT,
 *     property_address TEXT,  start_date DATE,  bedrooms INTEGER,
 *     last_inspection_completed_at TIMESTAMPTZ,  status TEXT
 *   )
 *
 *   Storage paths:
 *     Current:  {landlord_id}/{tenancy_id}/inspections/{inspection_id}/{room_key}
 *     Move-in:  {landlord_id}/{tenancy_id}/move-in/                (inventory photos)
 *
 * Called by: coordinator.ts → routeActiveTenancy (inspection keyword or tenant photo)
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  PDFDocument,
  StandardFonts,
  rgb,
} from "npm:pdf-lib@1.17.1";
import { supabase } from "../supabase.ts";
import { sendTextMessage, sendDocument } from "../whatsapp.ts";
import {
  CLAUDE_MODEL,
  CLAUDE_MAX_TOKENS,
} from "../constants.ts";
import type { ParsedMessage } from "../types.ts";

// ─── Room Definitions ────────────────────────────────────────────────────────

export interface RoomDef {
  key: string;
  label: string;
  optional?: boolean;
}

export const REQUIRED_ROOMS: RoomDef[] = [
  { key: "kitchen_overview",  label: "Kitchen (from doorway)" },
  { key: "kitchen_worktops",  label: "Kitchen worktops and under sink" },
  { key: "bathroom_overview", label: "Bathroom (wide shot)" },
  { key: "bathroom_shower",   label: "Bathroom - shower/bath area" },
  { key: "living_room",       label: "Living room" },
  { key: "bedroom_1",         label: "Bedroom 1" },
  { key: "hallway",           label: "Hallway" },
];

const OPTIONAL_ROOMS: RoomDef[] = [
  { key: "bedroom_2", label: "Bedroom 2 (if applicable)", optional: true },
  { key: "bedroom_3", label: "Bedroom 3 (if applicable)", optional: true },
  { key: "outdoor",   label: "Outdoor areas (if applicable)", optional: true },
];

/** Ordered full list (required first, optional last) */
export const ALL_ROOMS: RoomDef[] = [...REQUIRED_ROOMS, ...OPTIONAL_ROOMS];

/** Generate a numbered initial request message listing all rooms */
export function buildRoomRequestMessage(tenantName: string, address: string): string {
  const rooms = ALL_ROOMS
    .map((r, i) => `${i + 1}. ${r.label}`)
    .join("\n");
  return (
    `Hi ${tenantName || "there"}! It's time for your quarterly property check at *${address}*.\n\n` +
    `This is routine and helps keep everything in good shape. ` +
    `Could you send photos of the following rooms? Just one wide-angle shot of each:\n\n` +
    `${rooms}\n\n` +
    `Take your time - you have 7 days to send them all. ` +
    `I'll keep track as they come in and let you know which ones I've received.`
  );
}

// ─── Public Interface ────────────────────────────────────────────────────────

export interface InspectionAgentInput {
  message: ParsedMessage;
  sessionId?: string;
  landlordId?: string;
  mediaStorageUrl?: string;
}

export async function runInspectionAgent(
  input: InspectionAgentInput,
): Promise<void> {
  const { message, sessionId, landlordId, mediaStorageUrl } = input;
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

    // ── Landlord reply after inspection report ──────────────────────────
    if (landlordId && !sessionId) {
      await handleLandlordReply(ctx, phone, lower, landlordId);
      return;
    }

    // ── Find active (non-completed) inspection for this tenancy ─────────
    const inspection = await getActiveInspection(ctx.tenancyId);

    if (!inspection) {
      await sendTextMessage(
        phone,
        "There's no active inspection scheduled right now. " +
          "Your next quarterly check will be arranged by your landlord. " +
          "Type *HELP* if you need anything else.",
      );
      return;
    }

    // ── Incoming photo from tenant ───────────────────────────────────────
    if (mediaStorageUrl) {
      await handlePhoto(inspection, ctx, phone, mediaStorageUrl, text);
      return;
    }

    // ── Text message ─────────────────────────────────────────────────────
    await handleText(inspection, phone, lower);

  } catch (err) {
    console.error("[inspection-agent] Error:", err);
    await sendTextMessage(
      phone,
      "Sorry, something went wrong. Please try again or contact your landlord directly.",
    ).catch(() => {});
  }
}

// ─── Context Resolution ──────────────────────────────────────────────────────

interface TenancyContext {
  tenancyId: string;
  landlordId: string;
  landlordPhone: string;
  tenantPhone: string;
  tenantName: string;
  propertyAddress: string;
  bedrooms: number;
}

async function resolveTenantContext(sessionId: string): Promise<TenancyContext | null> {
  const { data } = await supabase
    .from("screening_sessions")
    .select(`
      tenancy_id,
      landlord_id,
      tenant_phone,
      tenant_name,
      property_address,
      tenancies ( bedrooms ),
      landlords ( phone )
    `)
    .eq("id", sessionId)
    .maybeSingle();

  if (!data?.tenancy_id) return null;

  return {
    tenancyId: data.tenancy_id,
    landlordId: data.landlord_id,
    landlordPhone: (data.landlords as { phone: string } | null)?.phone ?? "",
    tenantPhone: data.tenant_phone,
    tenantName: data.tenant_name ?? "",
    propertyAddress: data.property_address ?? "",
    bedrooms: (data.tenancies as { bedrooms: number } | null)?.bedrooms ?? 1,
  };
}

async function resolveLandlordContext(landlordId: string): Promise<TenancyContext | null> {
  const { data: tenancy } = await supabase
    .from("tenancies")
    .select(`
      id, landlord_id, tenant_phone, tenant_name, property_address, bedrooms,
      landlords ( phone )
    `)
    .eq("landlord_id", landlordId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tenancy) return null;

  return {
    tenancyId: tenancy.id,
    landlordId: tenancy.landlord_id,
    landlordPhone: (tenancy.landlords as { phone: string } | null)?.phone ?? "",
    tenantPhone: tenancy.tenant_phone,
    tenantName: tenancy.tenant_name ?? "",
    propertyAddress: tenancy.property_address ?? "",
    bedrooms: tenancy.bedrooms ?? 1,
  };
}

// ─── Active Inspection Lookup ────────────────────────────────────────────────

interface InspectionRow {
  id: string;
  tenancy_id: string;
  landlord_id: string;
  tenant_phone: string;
  property_address: string | null;
  tenant_name: string | null;
  status: string;
  photos_json: Record<string, string>;
  rooms_required: string[];
  reminder_count: number;
  ai_analysis_json: Record<string, unknown> | null;
  overall_condition: string | null;
  flagged_issues: string[] | null;
}

async function getActiveInspection(tenancyId: string): Promise<InspectionRow | null> {
  const { data } = await supabase
    .from("inspections")
    .select(
      "id, tenancy_id, landlord_id, tenant_phone, property_address, tenant_name, " +
      "status, photos_json, rooms_required, reminder_count, " +
      "ai_analysis_json, overall_condition, flagged_issues",
    )
    .eq("tenancy_id", tenancyId)
    .in("status", ["awaiting_photos", "partial", "analyzing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

// ─── Photo Handling ──────────────────────────────────────────────────────────

async function handlePhoto(
  inspection: InspectionRow,
  ctx: TenancyContext,
  phone: string,
  storagePath: string,
  caption: string,
): Promise<void> {
  const existing = inspection.photos_json ?? {};

  // Determine which room this photo belongs to.
  const roomKey = resolveRoomKey(caption, existing, inspection.rooms_required);

  if (!roomKey) {
    await sendTextMessage(
      phone,
      "Got a photo! Just to confirm — which room is this? " +
        "Reply with one of: kitchen, bathroom, shower, living room, bedroom, hallway, outdoor.",
    );
    return;
  }

  // Store the photo in the canonical location.
  const canonicalPath =
    `${ctx.landlordId}/${ctx.tenancyId}/inspections/${inspection.id}/${roomKey}`;

  // The photo was already uploaded to storagePath by webhook-handler.
  // Move it to the canonical inspection path.
  await supabase.storage
    .from("tenant-documents")
    .copy(storagePath, canonicalPath);

  // Update photos_json.
  const updatedPhotos = { ...existing, [roomKey]: canonicalPath };
  const roomDef = ALL_ROOMS.find((r) => r.key === roomKey);
  const roomLabel = roomDef?.label ?? roomKey;

  // Calculate progress.
  const requiredDone = inspection.rooms_required.filter((k) => updatedPhotos[k]).length;
  const requiredTotal = inspection.rooms_required.length;
  const remaining = inspection.rooms_required.filter((k) => !updatedPhotos[k]);

  const newStatus = requiredDone >= requiredTotal ? "analyzing" : "partial";

  await supabase
    .from("inspections")
    .update({
      photos_json: updatedPhotos,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", inspection.id);

  if (requiredDone >= requiredTotal) {
    // All required rooms photographed.
    await sendTextMessage(
      phone,
      `Got it - *${roomLabel}* received!\n\n` +
        "That's all the photos I need. Great job! " +
        "I'm now analysing the photos and generating an inspection report for your landlord. " +
        "This takes a couple of minutes - you don't need to do anything else.",
    );

    // Run analysis and generate PDF in the background.
    const updatedInspection: InspectionRow = { ...inspection, photos_json: updatedPhotos };
    await triggerAnalysisAndReport(updatedInspection, ctx).catch((err) => {
      console.error("[inspection-agent] Analysis failed:", err);
    });

  } else {
    // More rooms still needed.
    const nextRoomLabels = remaining
      .slice(0, 3)
      .map((k) => ALL_ROOMS.find((r) => r.key === k)?.label ?? k)
      .join(", ");

    await sendTextMessage(
      phone,
      `Got it - *${roomLabel}* received! (${requiredDone}/${requiredTotal} rooms done)\n\n` +
        `Still need: ${nextRoomLabels}` +
        (remaining.length > 3 ? ` and ${remaining.length - 3} more.` : "."),
    );
  }
}

/**
 * Determine the room key for an incoming photo.
 * Checks caption keywords first, then assigns to the next unfilled required room.
 */
function resolveRoomKey(
  caption: string,
  existing: Record<string, string>,
  roomsRequired: string[],
): string | null {
  const lower = caption.toLowerCase();

  // Caption keyword matching.
  const keywordMap: Array<[RegExp, string]> = [
    [/kitchen.*worktop|worktop|under.sink|sink\s+area/i, "kitchen_worktops"],
    [/kitchen|cooker|hob|oven/i, "kitchen_overview"],
    [/shower|bath\s+area|bath\s+room.*shower/i, "bathroom_shower"],
    [/bath\s*room|bathroom/i, "bathroom_overview"],
    [/living|lounge|reception|sitting/i, "living_room"],
    [/bedroom\s*3|bed\s*3|room\s*3/i, "bedroom_3"],
    [/bedroom\s*2|bed\s*2|room\s*2/i, "bedroom_2"],
    [/bedroom|bed\s*room|master/i, "bedroom_1"],
    [/hall|corridor|landing|entrance/i, "hallway"],
    [/garden|outdoor|outside|yard|patio/i, "outdoor"],
  ];

  if (lower.length > 0) {
    for (const [pattern, key] of keywordMap) {
      if (pattern.test(lower) && !existing[key]) {
        return key;
      }
    }
  }

  // No keyword match — assign to next unfilled required room.
  for (const key of roomsRequired) {
    if (!existing[key]) return key;
  }

  // All required rooms filled — assign to next optional room.
  for (const room of OPTIONAL_ROOMS) {
    if (!existing[room.key]) return room.key;
  }

  return null;
}

// ─── Text Handling ───────────────────────────────────────────────────────────

async function handleText(
  inspection: InspectionRow,
  phone: string,
  lower: string,
): Promise<void> {
  const existing = inspection.photos_json ?? {};
  const requiredDone = inspection.rooms_required.filter((k) => existing[k]).length;
  const requiredTotal = inspection.rooms_required.length;

  // "Done" / "all sent" trigger early analysis (with whatever photos are available).
  if (/\b(done|finished|all\s+sent|that'?s?\s+all|complete|sent\s+them?\s+all)\b/.test(lower)) {
    if (requiredDone === 0) {
      await sendTextMessage(
        phone,
        "I haven't received any photos yet! " +
          "Please send a wide-angle shot of each room when you're ready.",
      );
      return;
    }

    await sendTextMessage(
      phone,
      `Thanks! I've received ${requiredDone} room photo(s). Generating the inspection report now...`,
    );

    await supabase
      .from("inspections")
      .update({ status: "analyzing", updated_at: new Date().toISOString() })
      .eq("id", inspection.id);

    // Resolve context from inspection row for the report.
    const ctx = await resolveLandlordContext(inspection.landlord_id);
    if (ctx) {
      await triggerAnalysisAndReport(inspection, ctx).catch((err) => {
        console.error("[inspection-agent] Analysis failed:", err);
      });
    }
    return;
  }

  // Status request.
  if (/\b(status|progress|which|what|how\s+many|remaining)\b/.test(lower)) {
    const remaining = inspection.rooms_required
      .filter((k) => !existing[k])
      .map((k) => ALL_ROOMS.find((r) => r.key === k)?.label ?? k);

    if (requiredDone >= requiredTotal) {
      await sendTextMessage(phone, "All required photos received! I'm preparing your report.");
    } else {
      await sendTextMessage(
        phone,
        `*Inspection Progress* (${requiredDone}/${requiredTotal} rooms)\n\n` +
          `Still needed:\n${remaining.map((r) => `• ${r}`).join("\n")}\n\n` +
          "Send a photo of each room when you're ready.",
      );
    }
    return;
  }

  // Help / confusion.
  await sendTextMessage(
    phone,
    `*Quarterly Inspection - ${inspection.property_address ?? "your property"}*\n\n` +
      `I need one wide-angle photo of each room.\n\n` +
      `Progress: ${requiredDone}/${requiredTotal} rooms received.\n\n` +
      "Just send the photos one at a time. Include the room name in your caption " +
      "(e.g. 'kitchen', 'bathroom') if possible.\n\n" +
      "Type *STATUS* to see which rooms are still needed.",
  );
}

// ─── Landlord Reply Handling ─────────────────────────────────────────────────

async function handleLandlordReply(
  ctx: TenancyContext,
  phone: string,
  lower: string,
  landlordId: string,
): Promise<void> {
  // Find the most recently completed inspection.
  const { data: inspection } = await supabase
    .from("inspections")
    .select("id, flagged_issues, property_address, tenancy_id")
    .eq("landlord_id", landlordId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!inspection) {
    await sendTextMessage(
      phone,
      "No recent inspection report found. Type *COMPLIANCE* or *MAINTENANCE* for other queries.",
    );
    return;
  }

  if (/\b(raise|message|tell|inform|tenant|contact)\b/.test(lower)) {
    // Landlord wants to raise issues with tenant.
    const issues = inspection.flagged_issues ?? [];
    if (issues.length === 0) {
      await sendTextMessage(phone, "There are no flagged issues to raise with the tenant.");
      return;
    }

    const issueList = issues.map((issue) => `- ${issue}`).join("\n");
    await sendTextMessage(
      ctx.tenantPhone,
      `Hi ${ctx.tenantName || "there"}, your landlord has noted the following following from the quarterly inspection:\n\n${issueList}\n\nPlease get in touch with your landlord to discuss.`,
    );
    await sendTextMessage(
      phone,
      "Done - I've sent the flagged issues to the tenant.",
    );
    return;
  }

  if (/\b(maintenance|repair|fix|book|contractor)\b/.test(lower)) {
    await sendTextMessage(
      phone,
      "To raise a maintenance ticket for any inspection issues, " +
        "type *MAINTENANCE* followed by the issue description. " +
        "For example: 'MAINTENANCE damp patch on bathroom ceiling'.",
    );
    return;
  }

  // Default response after report.
  const issueCount = inspection.flagged_issues?.length ?? 0;
  await sendTextMessage(
    phone,
    "What would you like to do with the inspection report?\n\n" +
      (issueCount > 0
        ? `*${issueCount} issue(s) were flagged.*\n\n` +
          "• Reply *RAISE* to message the tenant about the issues\n" +
          "• Reply *MAINTENANCE* to book a repair\n"
        : "") +
      "• Type *COMPLIANCE* to check compliance certificates\n" +
      "• Type *HELP* for all options",
  );
}

// ─── Analysis and Report ─────────────────────────────────────────────────────

async function triggerAnalysisAndReport(
  inspection: InspectionRow,
  ctx: TenancyContext,
): Promise<void> {
  try {
    // Step 1: Get signed URLs for all current inspection photos.
    const photos = inspection.photos_json ?? {};
    const signedUrls: Record<string, string> = {};

    for (const [roomKey, storagePath] of Object.entries(photos)) {
      const { data } = await supabase.storage
        .from("tenant-documents")
        .createSignedUrl(storagePath, 3600); // 1 hour
      if (data?.signedUrl) {
        signedUrls[roomKey] = data.signedUrl;
      }
    }

    // Step 2: Get move-in inventory photos (if available).
    const moveInUrls: Record<string, string> = await getMoveInPhotos(ctx);

    // Step 3: Claude vision analysis.
    const analysis = await analyseWithClaude(
      inspection,
      signedUrls,
      moveInUrls,
      ctx.propertyAddress,
    );

    // Step 4: Generate PDF report.
    const pdfBytes = await generateInspectionPdf(
      inspection,
      analysis,
      signedUrls,
      moveInUrls,
      ctx,
    );

    // Step 5: Upload PDF to Storage.
    const reportDate = new Date().toISOString().split("T")[0];
    const pdfPath = `${ctx.landlordId}/${ctx.tenancyId}/inspections/${inspection.id}/report-${reportDate}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from("tenant-documents")
      .upload(pdfPath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) throw new Error(`PDF upload failed: ${uploadError.message}`);

    // Step 6: Create signed URL for PDF (valid 365 days for landlord records).
    const { data: reportSigned } = await supabase.storage
      .from("tenant-documents")
      .createSignedUrl(pdfPath, 365 * 24 * 3600);

    const reportUrl = reportSigned?.signedUrl ?? "";

    // Step 7: Save analysis and report URL to DB.
    const overall = analysis.overall_condition ?? "fair";
    const flaggedIssues = analysis.flagged_issues ?? [];

    await supabase
      .from("inspections")
      .update({
        status: "completed",
        ai_analysis_json: analysis.rooms ?? {},
        overall_condition: overall,
        flagged_issues: flaggedIssues,
        report_storage_path: pdfPath,
        report_url: reportUrl,
        landlord_notified_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", inspection.id);

    // Step 8: Update tenancy last_inspection_completed_at.
    await supabase
      .from("tenancies")
      .update({ last_inspection_completed_at: new Date().toISOString() })
      .eq("id", ctx.tenancyId);

    // Step 9: Notify landlord.
    await notifyLandlord(
      ctx.landlordPhone,
      ctx.propertyAddress,
      overall,
      flaggedIssues,
      reportUrl,
      reportDate,
    );

  } catch (err) {
    console.error("[inspection-agent] triggerAnalysisAndReport failed:", err);
    // Reset to partial so we don't leave it stuck in 'analyzing'.
    await supabase
      .from("inspections")
      .update({ status: "partial", updated_at: new Date().toISOString() })
      .eq("id", inspection.id);
    throw err;
  }
}

// ─── Move-In Photo Lookup ────────────────────────────────────────────────────

async function getMoveInPhotos(ctx: TenancyContext): Promise<Record<string, string>> {
  const folder = `${ctx.landlordId}/${ctx.tenancyId}/move-in`;

  const { data: files } = await supabase.storage
    .from("tenant-documents")
    .list(folder);

  if (!files || files.length === 0) return {};

  const result: Record<string, string> = {};
  for (const file of files) {
    const { data } = await supabase.storage
      .from("tenant-documents")
      .createSignedUrl(`${folder}/${file.name}`, 3600);
    if (data?.signedUrl) {
      // Key by filename stem — e.g. "kitchen_overview.jpg" → "kitchen_overview"
      const stem = file.name.replace(/\.[^.]+$/, "");
      result[stem] = data.signedUrl;
    }
  }
  return result;
}

// ─── Claude Vision Analysis ──────────────────────────────────────────────────

interface RoomAnalysis {
  condition: "excellent" | "good" | "fair" | "poor";
  notes: string;
  issues: string[];
  changed: boolean;
}

interface ClaudeInspectionAnalysis {
  rooms: Record<string, RoomAnalysis>;
  overall_condition: "excellent" | "good" | "fair" | "poor";
  flagged_issues: string[];
  summary: string;
}

const INSPECTION_SYSTEM_PROMPT = `
You are a property condition analyst for a UK residential lettings agency.

You will receive inspection photos of a rental property, organised by room.
If move-in comparison photos are provided, they are labelled with "(Move-in)" in the caption.

For each room photo, assess:
1. General condition: excellent / good / fair / poor
2. Specific observations: cleanliness, visible damage, stains, mould, marks, wear
3. Any issues that require landlord attention
4. If a move-in comparison photo is provided: note any significant changes

RULES:
- Be objective and factual. Do not comment on decor preferences or personal belongings.
- Only flag issues that are property-condition concerns (damage, damp, mould, hazards).
- "changed: true" only if there is a clearly visible material difference from move-in.
- "poor" condition reserved for visible damage, extensive staining, or safety concerns.

Return ONLY valid JSON with no additional text or markdown:
{
  "rooms": {
    "room_key": {
      "condition": "good",
      "notes": "Describe what you see...",
      "issues": ["Issue 1 if any"],
      "changed": false
    }
  },
  "overall_condition": "good",
  "flagged_issues": ["Any significant issues requiring landlord attention"],
  "summary": "Overall narrative summary in 2-3 sentences."
}
`.trim();

async function analyseWithClaude(
  inspection: InspectionRow,
  signedUrls: Record<string, string>,
  moveInUrls: Record<string, string>,
  propertyAddress: string,
): Promise<ClaudeInspectionAnalysis> {
  const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

  // Build image content blocks — current photos + move-in comparisons where available.
  // deno-lint-ignore no-explicit-any
  const imageBlocks: any[] = [];

  for (const room of ALL_ROOMS) {
    const currentUrl = signedUrls[room.key];
    const moveInUrl = moveInUrls[room.key];

    if (currentUrl) {
      imageBlocks.push({
        type: "image",
        source: { type: "url", url: currentUrl },
      });
      imageBlocks.push({
        type: "text",
        text: `Room: ${room.key} (${room.label}) - Current inspection`,
      });

      if (moveInUrl) {
        imageBlocks.push({
          type: "image",
          source: { type: "url", url: moveInUrl },
        });
        imageBlocks.push({
          type: "text",
          text: `Room: ${room.key} (${room.label}) - Move-in comparison`,
        });
      }
    }
  }

  if (imageBlocks.length === 0) {
    return {
      rooms: {},
      overall_condition: "fair",
      flagged_issues: [],
      summary: "No photos were available for analysis.",
    };
  }

  imageBlocks.push({
    type: "text",
    text: `Property: ${propertyAddress}. Inspect date: ${new Date().toLocaleDateString("en-GB")}. Return JSON analysis only.`,
  });

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS * 2, // inspection reports need more tokens
    system: INSPECTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: imageBlocks }],
  });

  const raw = response.content.find((b) => b.type === "text")?.text ?? "{}";

  // Strip any markdown fences if Claude wraps it.
  const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  try {
    return JSON.parse(jsonText) as ClaudeInspectionAnalysis;
  } catch {
    console.warn("[inspection-agent] Claude JSON parse failed, using defaults. Raw:", raw.slice(0, 200));
    return {
      rooms: {},
      overall_condition: "fair",
      flagged_issues: ["Analysis could not be completed automatically - manual review required."],
      summary: "Automatic analysis failed. Please review photos manually.",
    };
  }
}

// ─── PDF Report Generation ───────────────────────────────────────────────────

const A4_W  = 595.28;
const A4_H  = 841.89;
const MRG   = 48;
const CW    = A4_W - MRG * 2;

const NAVY  = rgb(0.082, 0.180, 0.298);
const TEAL  = rgb(0.118, 0.557, 0.514);
const DARK  = rgb(0.102, 0.102, 0.118);
const MID   = rgb(0.376, 0.376, 0.396);
const LIGHT = rgb(0.820, 0.820, 0.835);
const WHITE = rgb(1, 1, 1);
const AMBER = rgb(0.796, 0.502, 0.078);
const GREEN = rgb(0.118, 0.557, 0.298);
const RED   = rgb(0.796, 0.114, 0.114);

function conditionColour(c: string) {
  switch (c) {
    case "excellent": return GREEN;
    case "good":      return TEAL;
    case "fair":      return AMBER;
    case "poor":      return RED;
    default:          return MID;
  }
}

async function generateInspectionPdf(
  inspection: InspectionRow,
  analysis: ClaudeInspectionAnalysis,
  signedUrls: Record<string, string>,
  moveInUrls: Record<string, string>,
  ctx: TenancyContext,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const reportDate = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  // ── Cover page ────────────────────────────────────────────────────────
  let page = doc.addPage([A4_W, A4_H]);
  let y = A4_H;

  // Header band.
  page.drawRectangle({ x: 0, y: A4_H - 100, width: A4_W, height: 100, color: NAVY });
  page.drawText("CompliLet", { x: MRG, y: A4_H - 38, size: 22, font: bold, color: WHITE });
  page.drawText("PROPERTY INSPECTION REPORT", { x: MRG, y: A4_H - 60, size: 11, font: bold, color: TEAL, characterSpacing: 0.6 });
  page.drawText(reportDate, { x: MRG, y: A4_H - 80, size: 9, font: regular, color: WHITE });

  y = A4_H - 130;

  // Condition badge.
  const overall = analysis.overall_condition ?? "fair";
  const condLabel = overall.toUpperCase();
  const badgeColour = conditionColour(overall);
  page.drawRectangle({ x: MRG - 4, y: y - 28, width: 160, height: 32, color: badgeColour, borderColor: badgeColour, borderWidth: 1 });
  page.drawText(`OVERALL: ${condLabel}`, { x: MRG + 4, y: y - 14, size: 10, font: bold, color: WHITE });
  y -= 50;

  // Property details table.
  const details: Array<[string, string]> = [
    ["Property",    ctx.propertyAddress || "Not recorded"],
    ["Tenant",      ctx.tenantName || "Not recorded"],
    ["Landlord ID", ctx.landlordId.slice(0, 8) + "..."],
    ["Inspection",  reportDate],
    ["Photos",      `${Object.keys(signedUrls).length} rooms documented`],
  ];

  for (const [label, value] of details) {
    page.drawText(label + ":", { x: MRG, y, size: 9, font: bold, color: MID });
    page.drawText(value, { x: MRG + 110, y, size: 9, font: regular, color: DARK });
    y -= 16;
  }
  y -= 12;

  // Flagged issues section on cover.
  const issues = analysis.flagged_issues ?? [];
  if (issues.length > 0) {
    page.drawRectangle({ x: MRG - 4, y: y - (issues.length * 16) - 24, width: CW + 8, height: issues.length * 16 + 32, color: rgb(0.996, 0.957, 0.867), borderColor: AMBER, borderWidth: 1 });
    page.drawText("(!) FLAGGED ISSUES REQUIRING ATTENTION", { x: MRG + 4, y: y - 10, size: 8.5, font: bold, color: AMBER });
    y -= 26;
    for (const issue of issues) {
      const truncated = issue.length > 90 ? issue.slice(0, 87) + "..." : issue;
      page.drawText(`- ${truncated}`, { x: MRG + 8, y, size: 8.5, font: regular, color: DARK });
      y -= 14;
    }
    y -= 8;
  }

  // Summary.
  y -= 4;
  page.drawText("INSPECTION SUMMARY", { x: MRG, y, size: 8, font: bold, color: TEAL, characterSpacing: 0.8 });
  y -= 14;
  const summaryText = analysis.summary ?? "No summary available.";
  const words = summaryText.split(" ");
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (regular.widthOfTextAtSize(candidate, 9) > CW) {
      page.drawText(line, { x: MRG, y, size: 9, font: regular, color: DARK });
      y -= 13;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) { page.drawText(line, { x: MRG, y, size: 9, font: regular, color: DARK }); y -= 13; }

  // ── Per-room pages ────────────────────────────────────────────────────
  for (const room of ALL_ROOMS) {
    const currentUrl = signedUrls[room.key];
    if (!currentUrl) continue; // Skip rooms with no photo.

    const roomAnalysis = analysis.rooms?.[room.key];
    const moveInUrl = moveInUrls[room.key];

    page = doc.addPage([A4_W, A4_H]);
    y = A4_H;

    // Room header.
    const roomCondition = roomAnalysis?.condition ?? "fair";
    page.drawRectangle({ x: 0, y: A4_H - 60, width: A4_W, height: 60, color: NAVY });
    page.drawText(room.label, { x: MRG, y: A4_H - 26, size: 14, font: bold, color: WHITE });
    page.drawText("Condition:", { x: MRG, y: A4_H - 44, size: 9, font: regular, color: LIGHT });
    page.drawText(roomCondition.toUpperCase(), {
      x: MRG + 60,
      y: A4_H - 44,
      size: 9,
      font: bold,
      color: conditionColour(roomCondition),
    });
    y = A4_H - 80;

    // Embed current photo.
    const imgHeight = moveInUrl ? 200 : 280;
    const imgWidth  = CW;

    try {
      const imgBytes = await fetchImageBytes(currentUrl);
      const embedded = await tryEmbedImage(doc, imgBytes, currentUrl);
      if (embedded) {
        const scaleFactor = Math.min(imgWidth / embedded.width, imgHeight / embedded.height);
        const drawW = embedded.width * scaleFactor;
        const drawH = embedded.height * scaleFactor;
        page.drawImage(embedded, { x: MRG, y: y - drawH, width: drawW, height: drawH });
        y -= drawH + 8;
      }
    } catch (err) {
      page.drawText("(Photo unavailable)", { x: MRG, y: y - 20, size: 9, font: regular, color: MID });
      y -= 30;
      console.warn(`[inspection-agent] Could not embed photo for ${room.key}:`, err);
    }

    // Side-by-side move-in comparison.
    if (moveInUrl) {
      page.drawText("Move-in comparison:", { x: MRG, y, size: 8, font: bold, color: MID });
      y -= 14;
      try {
        const moveInBytes = await fetchImageBytes(moveInUrl);
        const embedded = await tryEmbedImage(doc, moveInBytes, moveInUrl);
        if (embedded) {
          const scaleFactor = Math.min(200 / embedded.width, 150 / embedded.height);
          const drawW = embedded.width * scaleFactor;
          const drawH = embedded.height * scaleFactor;
          page.drawImage(embedded, { x: MRG, y: y - drawH, width: drawW, height: drawH });
          if (roomAnalysis?.changed) {
            page.drawText("(!) Changes noted vs move-in", { x: MRG + drawW + 12, y: y - 20, size: 8.5, font: bold, color: AMBER });
          }
          y -= drawH + 8;
        }
      } catch {
        page.drawText("(Move-in photo unavailable)", { x: MRG, y, size: 9, font: regular, color: MID });
        y -= 14;
      }
    }

    // Condition notes.
    y -= 4;
    page.drawText("CONDITION NOTES", { x: MRG, y, size: 8, font: bold, color: TEAL, characterSpacing: 0.6 });
    y -= 14;
    const notes = roomAnalysis?.notes ?? "No notes recorded for this room.";
    const noteWords = notes.split(" ");
    let noteLine = "";
    for (const word of noteWords) {
      const candidate = noteLine ? `${noteLine} ${word}` : word;
      if (regular.widthOfTextAtSize(candidate, 9) > CW) {
        page.drawText(noteLine, { x: MRG, y, size: 9, font: regular, color: DARK });
        y -= 13;
        noteLine = word;
      } else {
        noteLine = candidate;
      }
    }
    if (noteLine) { page.drawText(noteLine, { x: MRG, y, size: 9, font: regular, color: DARK }); y -= 13; }

    // Room issues.
    const roomIssues = roomAnalysis?.issues ?? [];
    if (roomIssues.length > 0) {
      y -= 8;
      page.drawText("Issues:", { x: MRG, y, size: 8.5, font: bold, color: RED });
      y -= 13;
      for (const issue of roomIssues) {
        page.drawText(`- ${issue}`, { x: MRG + 8, y, size: 8.5, font: regular, color: DARK });
        y -= 13;
      }
    }
  }

  // ── Footer page: overall summary ──────────────────────────────────────
  page = doc.addPage([A4_W, A4_H]);
  y = A4_H;
  page.drawRectangle({ x: 0, y: A4_H - 60, width: A4_W, height: 60, color: NAVY });
  page.drawText("Inspection Summary", { x: MRG, y: A4_H - 26, size: 14, font: bold, color: WHITE });
  page.drawText(reportDate, { x: MRG, y: A4_H - 44, size: 9, font: regular, color: LIGHT });
  y = A4_H - 80;

  // Condition table.
  page.drawText("ROOM-BY-ROOM CONDITION", { x: MRG, y, size: 8, font: bold, color: TEAL, characterSpacing: 0.8 });
  y -= 16;

  for (const room of ALL_ROOMS) {
    const currentUrl = signedUrls[room.key];
    if (!currentUrl) continue;
    const roomAnalysis = analysis.rooms?.[room.key];
    const cond = roomAnalysis?.condition ?? "-";

    page.drawText(room.label, { x: MRG, y, size: 9, font: regular, color: DARK });
    page.drawText(cond.toUpperCase(), { x: MRG + 280, y, size: 9, font: bold, color: conditionColour(cond) });
    const dotEnd = MRG + 278;
    const dotStart = MRG + regular.widthOfTextAtSize(room.label, 9) + 4;
    page.drawLine({ start: { x: dotStart, y: y + 2 }, end: { x: dotEnd, y: y + 2 }, thickness: 0.5, color: LIGHT });
    y -= 14;
  }

  y -= 16;

  // Flagged issues full list.
  if (issues.length > 0) {
    page.drawText("FLAGGED ISSUES", { x: MRG, y, size: 8, font: bold, color: RED, characterSpacing: 0.8 });
    y -= 14;
    for (const issue of issues) {
      page.drawText(`(!) ${issue}`, { x: MRG, y, size: 9, font: regular, color: DARK });
      y -= 14;
    }
    y -= 8;
  }

  // Footer.
  page.drawText("Generated by CompliLet | complilet.com", {
    x: MRG,
    y: 30,
    size: 7.5,
    font: regular,
    color: MID,
  });
  page.drawLine({ start: { x: MRG, y: 42 }, end: { x: A4_W - MRG, y: 42 }, thickness: 0.5, color: LIGHT });

  return doc.save();
}

// ─── Image Utilities ─────────────────────────────────────────────────────────

async function fetchImageBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Image fetch failed: HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

// deno-lint-ignore no-explicit-any
async function tryEmbedImage(doc: PDFDocument, bytes: Uint8Array, urlHint: string): Promise<any | null> {
  // Detect format from URL hint or magic bytes.
  const isJpeg = urlHint.toLowerCase().includes(".jpg") ||
    urlHint.toLowerCase().includes(".jpeg") ||
    (bytes[0] === 0xFF && bytes[1] === 0xD8);
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;

  try {
    if (isPng) return await doc.embedPng(bytes);
    if (isJpeg) return await doc.embedJpg(bytes);
    // Try JPEG first as most phone photos are JPEG.
    return await doc.embedJpg(bytes);
  } catch {
    try { return await doc.embedPng(bytes); } catch { return null; }
  }
}

// ─── Landlord Notification ───────────────────────────────────────────────────

async function notifyLandlord(
  landlordPhone: string,
  propertyAddress: string,
  overall: string,
  flaggedIssues: string[],
  reportUrl: string,
  reportDate: string,
): Promise<void> {
  if (!landlordPhone) return;

  const issueNote = flaggedIssues.length > 0
    ? `\n\n*(!) ${flaggedIssues.length} issue(s) flagged:*\n` +
      flaggedIssues.slice(0, 3).map((i) => `- ${i}`).join("\n") +
      (flaggedIssues.length > 3 ? `\n- ...and ${flaggedIssues.length - 3} more (see report)` : "")
    : "\n\nNo issues flagged - property in good order.";

  await sendTextMessage(
    landlordPhone,
    `*Quarterly Inspection Complete*\n\n` +
      `Property: ${propertyAddress}\n` +
      `Date: ${reportDate}\n` +
      `Overall condition: *${overall.toUpperCase()}*` +
      `${issueNote}\n\n` +
      "The full inspection report with photos is attached below.",
  );

  if (reportUrl) {
    const filename = `Inspection-Report-${reportDate.replace(/\//g, "-")}.pdf`;
    await sendDocument(landlordPhone, reportUrl, filename, `Inspection report for ${propertyAddress}`);
  }

  // Prompt action if issues found.
  if (flaggedIssues.length > 0) {
    await sendTextMessage(
      landlordPhone,
      "What would you like to do?\n\n" +
        "• Reply *RAISE* to message the tenant about the issues\n" +
        "• Reply *MAINTENANCE* to book a repair\n" +
        "• Reply *OK* to acknowledge and take no further action",
    );
  }
}
