/**
 * CompliLet — WhatsApp Webhook Handler
 *
 * Handles all inbound traffic from Meta's Cloud API:
 *   GET  /webhook-handler  — Meta hub challenge-response verification
 *   POST /webhook-handler  — Inbound messages, media, status updates
 *
 * Routing:
 *   Unknown sender  → onboard as new landlord (welcome message + create record)
 *                     then pass to coordinator as a fresh landlord
 *   Landlord        → coordinator (shared module, direct call)
 *   Tenant          → coordinator (shared module, direct call)
 *   Referee         → coordinator (shared module, direct call)
 *
 * Escalation triggers are checked BEFORE routing. If matched the message is
 * logged to the escalations table and forwarded to the escalation-handler
 * Edge Function (fire-and-forget). Immediate urgency also gets an ack.
 *
 * Deploy config (supabase/config.toml):
 *   [functions.webhook-handler]
 *   verify_jwt = false
 *
 * Required environment variables:
 *   WHATSAPP_TOKEN            — Meta permanent system user token
 *   PHONE_NUMBER_ID           — WhatsApp Business phone number ID
 *   WHATSAPP_VERIFY_TOKEN     — Hub verify token set in Meta App Dashboard
 *   WHATSAPP_APP_SECRET       — Meta App Secret for HMAC signature verification
 *   SUPABASE_URL              — Project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Service role key
 *   ANTHROPIC_API_KEY         — Claude API key (used by downstream agent functions)
 *   MEDIA_BUCKET              — Supabase Storage bucket name for tenant documents
 */

import {
  parseWebhookPayload,
  verifyWebhookChallenge,
  verifyWebhookSignature,
  markAsRead,
  sendTextMessage,
  downloadMedia,
  formatPhoneForWhatsApp,
} from "../_shared/whatsapp.ts";
import { ESCALATION_TRIGGER_PATTERNS } from "../_shared/constants.ts";
import type { ParsedMessage, EscalationTrigger } from "../_shared/types.ts";
import { supabase } from "../_shared/supabase.ts";
import { runCoordinator } from "../_shared/coordinator.ts";

// ─── Local types ────────────────────────────────────────────────────────────

type SenderRole = "landlord" | "tenant" | "referee" | "unknown";

interface SenderContext {
  role: SenderRole;
  phone: string;
  /** Landlord row id (uuid) — present when role is "landlord" */
  landlordId?: string;
  /** Active screening session id — present when role is "tenant" */
  sessionId?: string;
  /** Reference request id — present when role is "referee" */
  referenceRequestId?: string;
  /** WhatsApp display name — for display only, not verified */
  contactName?: string;
}

/**
 * Urgency values mirror the ESCALATION_TRIGGER_PATTERNS entries in constants.ts.
 * Must match exactly — TypeScript will error if they drift.
 */
interface EscalationMatch {
  trigger: EscalationTrigger;
  urgency: "immediate" | "within_2hrs" | "same_day";
  reason: string;
}

// ─── Entry point ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  // ── GET: Meta hub verification ─────────────────────────────────────────
  if (req.method === "GET") {
    const challenge = verifyWebhookChallenge(url);
    if (challenge) {
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // ── POST: Inbound webhook ──────────────────────────────────────────────
  if (req.method === "POST") {
    const rawBody = await req.text();

    // Verify HMAC-SHA256 signature from Meta before touching the body.
    const signature = req.headers.get("x-hub-signature-256") ?? "";
    if (!verifyWebhookSignature(rawBody, signature)) {
      console.warn("Webhook signature verification failed");
      return new Response("Unauthorized", { status: 401 });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.error("Failed to parse webhook JSON body");
      return new Response("Bad Request", { status: 400 });
    }

    // Meta expects HTTP 200 within ~20 seconds — respond immediately and
    // process asynchronously to avoid timeout on slow AI calls.
    processWebhook(body).catch((err) => {
      console.error("Unhandled error in processWebhook:", err);
    });

    return new Response("OK", { status: 200 });
  }

  return new Response("Method Not Allowed", { status: 405 });
});

// ─── Core processing ────────────────────────────────────────────────────────

async function processWebhook(body: unknown): Promise<void> {
  const message = parseWebhookPayload(
    body as Parameters<typeof parseWebhookPayload>[0],
  );

  // Ignore status-only events (delivery/read receipts) and empty unknowns.
  if (message.type === "status_update") return;
  if (message.type === "unknown" && !message.text) return;

  const phone = message.from;

  // Mark message as read (blue ticks) — non-blocking.
  markAsRead(message.messageId).catch((err) =>
    console.warn(`markAsRead failed for ${message.messageId}:`, err),
  );

  // Log to messages table (non-fatal if it fails).
  await logInboundMessage(message);

  // Identify the sender role.
  const sender = await identifySender(phone, message.contactName);

  // Check escalation triggers BEFORE routing.
  const textToScan = message.text ?? message.interactive?.title ?? "";
  const escalation = textToScan ? detectEscalation(textToScan) : null;

  // Upload media to Supabase Storage if present.
  let mediaStorageUrl: string | undefined;
  if (message.media?.id) {
    mediaStorageUrl = await handleMediaUpload(message, phone).catch((err) => {
      console.error("Media upload failed:", err);
      return undefined;
    });
  }

  // ── Escalation path ──────────────────────────────────────────────────
  if (escalation) {
    await routeToEscalation(escalation, sender, message);
    return;
  }

  // ── Unknown sender — onboard as landlord, then fall through to coordinator
  if (sender.role === "unknown") {
    const landlordId = await onboardNewLandlord(sender, message);
    if (landlordId) {
      await runCoordinator({
        message,
        senderRole: "landlord",
        landlordId,
        mediaStorageUrl,
        contactName: sender.contactName,
      });
    }
    return;
  }

  // ── All known senders route through the coordinator ───────────────────
  await runCoordinator({
    message,
    senderRole: sender.role,
    landlordId: sender.landlordId,
    sessionId: sender.sessionId,
    referenceRequestId: sender.referenceRequestId,
    mediaStorageUrl,
    contactName: sender.contactName,
  });
}

// ─── Sender identification ──────────────────────────────────────────────────

async function identifySender(
  phone: string,
  contactName?: string,
): Promise<SenderContext> {
  // 1. Landlords table.
  const { data: landlord } = await supabase
    .from("landlords")
    .select("id")
    .eq("whatsapp_number", phone)
    .eq("is_active", true)
    .maybeSingle();

  if (landlord) {
    return { role: "landlord", phone, landlordId: landlord.id, contactName };
  }

  // 2. Active tenant screening sessions (non-terminal statuses).
  const terminalStatuses = ["abandoned", "rejected"];
  const { data: session } = await supabase
    .from("screening_sessions")
    .select("id")
    .eq("tenant_phone", phone)
    .not("status", "in", `(${terminalStatuses.map((s) => `"${s}"`).join(",")})`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (session) {
    return { role: "tenant", phone, sessionId: session.id, contactName };
  }

  // 3. Outstanding reference requests.
  const { data: refRequest } = await supabase
    .from("reference_requests")
    .select("id")
    .eq("contact_phone", phone)
    .eq("responded", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (refRequest) {
    return {
      role: "referee",
      phone,
      referenceRequestId: refRequest.id,
      contactName,
    };
  }

  return { role: "unknown", phone, contactName };
}

// ─── Escalation detection ───────────────────────────────────────────────────

function detectEscalation(text: string): EscalationMatch | null {
  for (const entry of ESCALATION_TRIGGER_PATTERNS) {
    if (entry.pattern.test(text)) {
      return {
        trigger: entry.trigger,
        urgency: entry.urgency,
        reason: entry.reason,
      };
    }
  }
  return null;
}

async function routeToEscalation(
  escalation: EscalationMatch,
  sender: SenderContext,
  message: ParsedMessage,
): Promise<void> {
  console.warn(
    `Escalation: ${escalation.trigger} (${escalation.urgency}) from ${sender.phone}`,
  );

  // Log to escalations table.
  await supabase.from("escalations").insert({
    trigger: escalation.trigger,
    urgency: escalation.urgency,
    reason: escalation.reason,
    sender_phone: sender.phone,
    sender_role: sender.role,
    message_text: message.text ?? null,
    whatsapp_message_id: message.messageId,
  });

  // Invoke escalation-handler Edge Function (fire-and-forget).
  supabase.functions
    .invoke("escalation-handler", {
      body: { escalation, sender, message },
    })
    .catch((err: unknown) => console.error("escalation-handler invoke failed:", err));

  // Send immediate ack for life-safety escalations.
  if (escalation.urgency === "immediate") {
    await sendTextMessage(
      sender.phone,
      "I've flagged your message as urgent and a member of our team will " +
        "contact you shortly. If you're in immediate danger, please call 999.",
    ).catch((err) =>
      console.error("Failed to send escalation ack:", err),
    );
  }
}

// ─── Media upload ───────────────────────────────────────────────────────────

async function handleMediaUpload(
  message: ParsedMessage,
  phone: string,
): Promise<string | undefined> {
  if (!message.media?.id) return undefined;

  const bucket = Deno.env.get("MEDIA_BUCKET") ?? "tenant-documents";
  const bytes = await downloadMedia(message.media.id);
  const ext = mimeToExtension(message.media.mimeType ?? "application/octet-stream");
  const storagePath = `${phone}/${message.messageId}.${ext}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, bytes, {
      contentType: message.media.mimeType ?? "application/octet-stream",
      upsert: false,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  return storagePath;
}

function mimeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "video/mp4": "mp4",
  };
  return map[mimeType] ?? "bin";
}

// ─── Database logging ───────────────────────────────────────────────────────

async function logInboundMessage(message: ParsedMessage): Promise<void> {
  const { error } = await supabase.from("messages").insert({
    whatsapp_message_id: message.messageId,
    direction: "inbound",
    from_phone: message.from,
    type: message.type,
    text: message.text ?? null,
    media_id: message.media?.id ?? null,
    media_mime_type: message.media?.mimeType ?? null,
    received_at: new Date(message.timestamp * 1000).toISOString(),
    raw_payload: message,
  });

  if (error) {
    console.error("Failed to log inbound message:", error.message);
  }
}

// ─── New landlord onboarding ────────────────────────────────────────────────

/**
 * Creates a landlord record for a first-time sender and sends the welcome
 * message. Returns the new landlord's uuid on success, undefined on failure
 * (so the caller can decide whether to proceed or silently drop).
 */
async function onboardNewLandlord(
  sender: SenderContext,
  message: ParsedMessage,
): Promise<string | undefined> {
  const phone = sender.phone;

  const { data: newLandlord, error } = await supabase
    .from("landlords")
    .insert({
      whatsapp_number: phone,
      display_name: sender.contactName ?? null,
      is_active: true,
      onboarding_complete: false,
      plan: "pay_per_screen",
    })
    .select("id")
    .single();

  if (error) {
    // A unique-constraint failure means the row already exists (race or retry).
    // Fetch and return the existing id so the coordinator can still run.
    if (error.code === "23505") {
      const { data: existing } = await supabase
        .from("landlords")
        .select("id")
        .eq("whatsapp_number", phone)
        .single();
      return existing?.id;
    }
    console.error("Failed to create landlord record:", error.message);
    return undefined;
  }

  // Log onboarding event.
  await supabase.from("onboarding_events").insert({
    landlord_id: newLandlord.id,
    phone,
    event: "first_contact",
    first_message_text: message.text ?? null,
  });

  // Send welcome message.
  const waPhone = formatPhoneForWhatsApp(phone);
  await sendTextMessage(
    waPhone,
    `Hi${sender.contactName ? ` ${sender.contactName}` : ""}! 👋 ` +
      `I'm CompliLet — your AI-powered property compliance assistant.\n\n` +
      `I help UK landlords screen tenants, stay on top of legal deadlines, ` +
      `and manage tenancies — all through WhatsApp.\n\n` +
      `To get started, reply with:\n` +
      `• *SCREEN* — to screen a new tenant\n` +
      `• *PRICING* — to see our plans\n` +
      `• *HELP* — for a full list of commands\n\n` +
      `No app. No login. Just WhatsApp.`,
  ).catch((err) => console.error("Failed to send welcome message:", err));

  return newLandlord.id;
}
