/**
 * WhatsApp Business API integration for CompliLet.
 *
 * Wraps the Meta Cloud API (Graph API v20.0).
 * Designed for the Deno / Supabase Edge Functions runtime — uses:
 *   - fetch() for all HTTP calls (available natively in Deno)
 *   - Web Crypto API for HMAC-SHA256 signature verification
 *   - node:crypto (Deno polyfill) for synchronous HMAC in verifyWebhookSignature
 *
 * Environment variables required:
 *   WHATSAPP_TOKEN       — Meta System User access token
 *   PHONE_NUMBER_ID      — WhatsApp Business phone number ID
 *   WHATSAPP_APP_SECRET  — App secret from Meta App Dashboard (for webhook verification)
 */

import { createHmac } from "node:crypto";

import {
  type ParsedMessage,
  type WebhookPayload,
  type WhatsAppResponse,
  WhatsAppApiError,
} from "./types.ts";
import {
  WHATSAPP_API_BASE,
  ACCEPTED_DOCUMENT_MIME_TYPES,
} from "./constants.ts";

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Reads required environment variables at call time (not module load time)
 * so that unit tests can inject them between calls.
 */
function getEnv(): { token: string; phoneNumberId: string } {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneNumberId = Deno.env.get("PHONE_NUMBER_ID");

  if (!token) throw new Error("WHATSAPP_TOKEN environment variable is not set");
  if (!phoneNumberId) {
    throw new Error("PHONE_NUMBER_ID environment variable is not set");
  }

  return { token, phoneNumberId };
}

/**
 * Thin fetch wrapper for all outbound Meta API calls.
 * Handles auth headers, JSON serialisation, and error body parsing.
 */
async function callApi(
  url: string,
  options: RequestInit = {},
): Promise<WhatsAppResponse> {
  const { token } = getEnv();

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  // Meta returns errors as JSON bodies even on 4xx/5xx
  const body = await response.json() as WhatsAppResponse;

  if (!response.ok || body.error) {
    const err = body.error ?? {
      message: `HTTP ${response.status} from Meta API`,
      type: "HttpError",
      code: response.status,
    };
    throw new WhatsAppApiError(
      err.message,
      err.code,
      err.type,
      err.error_subcode,
      err.fbtrace_id,
    );
  }

  return body;
}

// ─── 1. sendTextMessage ────────────────────────────────────────────────────────

/**
 * Sends a plain-text WhatsApp message to a recipient.
 *
 * @param to   - Recipient phone number in E.164 format without leading +
 *               Example: "447700000000" (UK mobile)
 * @param text - Message body. Maximum 4,096 characters.
 *               Supports WhatsApp formatting: *bold*, _italic_, ~strikethrough~, ```monospace```
 *
 * @throws WhatsAppApiError if Meta rejects the request
 */
export async function sendTextMessage(
  to: string,
  text: string,
): Promise<WhatsAppResponse> {
  const { phoneNumberId } = getEnv();

  return callApi(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        preview_url: false,
        body: text,
      },
    }),
  });
}

// ─── 2. sendDocument ──────────────────────────────────────────────────────────

/**
 * Sends a PDF document (or other file) to a recipient via a hosted URL.
 * Used for: compliance certificates, screening reports, tenancy agreements,
 * move-in packs, and inspection reports.
 *
 * The URL must be publicly accessible by Meta's servers and return the file
 * with the correct Content-Type header. Use Supabase Storage signed URLs
 * (valid for at least 60 seconds).
 *
 * @param to          - Recipient phone number (E.164 without +)
 * @param documentUrl - Publicly accessible URL to the document
 * @param filename    - Filename shown to the recipient (e.g. "Screening-Report-James-Carter.pdf")
 * @param caption     - Optional short description shown above the document
 *
 * @throws WhatsAppApiError if Meta rejects the request
 */
export async function sendDocument(
  to: string,
  documentUrl: string,
  filename: string,
  caption?: string,
): Promise<WhatsAppResponse> {
  const { phoneNumberId } = getEnv();

  return callApi(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "document",
      document: {
        link: documentUrl,
        filename,
        ...(caption !== undefined && { caption }),
      },
    }),
  });
}

// ─── 3. sendImage ─────────────────────────────────────────────────────────────

/**
 * Sends an image to a recipient via a hosted URL.
 * Used for: inspection photo acknowledgements, property photos in move-in packs.
 *
 * Supported formats: JPEG, PNG, WebP, HEIC/HEIF (Meta converts automatically).
 * Maximum file size: 5 MB.
 *
 * @param to       - Recipient phone number (E.164 without +)
 * @param imageUrl - Publicly accessible URL to the image
 * @param caption  - Optional caption shown below the image
 *
 * @throws WhatsAppApiError if Meta rejects the request
 */
export async function sendImage(
  to: string,
  imageUrl: string,
  caption?: string,
): Promise<WhatsAppResponse> {
  const { phoneNumberId } = getEnv();

  return callApi(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "image",
      image: {
        link: imageUrl,
        ...(caption !== undefined && { caption }),
      },
    }),
  });
}

// ─── 4. markAsRead ────────────────────────────────────────────────────────────

/**
 * Marks an incoming message as read.
 * This triggers the blue double-tick (✓✓) in the sender's WhatsApp app,
 * confirming that CompliLet has processed the message.
 *
 * Call this immediately after successfully processing any incoming message
 * to provide immediate feedback to the user.
 *
 * @param messageId - WhatsApp message ID of the message to mark read (wamid.xxx)
 *
 * @throws WhatsAppApiError if Meta rejects the request
 */
export async function markAsRead(messageId: string): Promise<void> {
  const { phoneNumberId } = getEnv();

  await callApi(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  });
}

// ─── 5. downloadMedia ─────────────────────────────────────────────────────────

/**
 * Downloads media (photos of documents, audio, video) sent by a WhatsApp user.
 *
 * Two-step process per the Meta Cloud API:
 *   1. GET /{media_id} → returns the media metadata including a time-limited URL
 *   2. GET {url} → returns the raw binary file
 *
 * The returned Uint8Array can be passed directly to Supabase Storage:
 *
 * ```typescript
 * const data = await downloadMedia(mediaId);
 * const { data: upload } = await supabase.storage
 *   .from("tenant-documents")
 *   .upload(`${sessionId}/${filename}`, data, { contentType: mimeType });
 * ```
 *
 * @param mediaId - The media ID from the webhook payload (message.image.id, etc.)
 * @returns Uint8Array of the raw file bytes
 *
 * @throws WhatsAppApiError if Meta rejects the metadata request
 * @throws Error if the media download URL request fails
 */
export async function downloadMedia(mediaId: string): Promise<Uint8Array> {
  const { token } = getEnv();

  // Step 1: Resolve the media ID to a download URL + metadata
  const metaResponse = await fetch(`${WHATSAPP_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!metaResponse.ok) {
    const errorBody = await metaResponse.json().catch(() => ({})) as {
      error?: { message: string; type: string; code: number; fbtrace_id?: string };
    };
    const err = errorBody.error ?? {
      message: `HTTP ${metaResponse.status} fetching media metadata`,
      type: "HttpError",
      code: metaResponse.status,
    };
    throw new WhatsAppApiError(err.message, err.code, err.type, undefined, err.fbtrace_id);
  }

  const metadata = await metaResponse.json() as {
    url: string;
    mime_type: string;
    sha256: string;
    file_size: number;
    id: string;
    messaging_product: string;
  };

  // Step 2: Download the actual file from the resolved URL
  // The URL is pre-signed and expires quickly — download immediately
  const mediaResponse = await fetch(metadata.url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!mediaResponse.ok) {
    throw new Error(
      `Failed to download media from resolved URL: HTTP ${mediaResponse.status}`,
    );
  }

  const buffer = await mediaResponse.arrayBuffer();
  return new Uint8Array(buffer);
}

// ─── 6. parseWebhookPayload ───────────────────────────────────────────────────

/**
 * Normalises a raw Meta webhook POST body into a typed ParsedMessage.
 *
 * Meta's webhook schema nests message events four levels deep:
 * entry[0].changes[0].value.messages[0]
 *
 * This function flattens that structure and handles all message types
 * CompliLet processes: text, image, document, audio, interactive button
 * replies, and delivery/read status updates.
 *
 * Edge cases handled:
 * - Missing contacts array (status-only webhooks)
 * - Multiple messages in one webhook (batch delivery) — returns first
 * - Unknown message types → type: "unknown" (never throw)
 * - Status-only webhooks (no messages array) → type: "status_update"
 *
 * @param body - Parsed JSON body of the Meta webhook POST request
 * @returns     Normalised ParsedMessage ready for coordinator routing
 */
export function parseWebhookPayload(body: WebhookPayload): ParsedMessage {
  // Defensive — handle completely malformed payloads
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  if (!value) {
    return {
      type: "unknown",
      from: "",
      messageId: "",
      timestamp: Date.now() / 1_000,
    };
  }

  const phoneNumberId = value.metadata?.phone_number_id;

  // ── Status update (sent / delivered / read / failed) ──────────────────────
  if (value.statuses?.length && !value.messages?.length) {
    const status = value.statuses[0];
    return {
      type: "status_update",
      from: status.recipient_id ?? "",
      messageId: `status:${status.id}`,
      timestamp: parseInt(status.timestamp, 10),
      phoneNumberId,
      statusUpdate: {
        status: status.status,
        messageId: status.id,
        recipientId: status.recipient_id,
        timestamp: parseInt(status.timestamp, 10),
        errors: status.errors,
      },
    };
  }

  // ── Incoming message ──────────────────────────────────────────────────────
  const message = value.messages?.[0];
  if (!message) {
    return {
      type: "unknown",
      from: "",
      messageId: "",
      timestamp: Date.now() / 1_000,
      phoneNumberId,
    };
  }

  const contactName = value.contacts?.[0]?.profile?.name;
  const base = {
    from: message.from,
    messageId: message.id,
    timestamp: parseInt(message.timestamp, 10),
    contactName,
    phoneNumberId,
  };

  switch (message.type) {
    case "text":
      return {
        ...base,
        type: "text",
        text: message.text?.body ?? "",
      };

    case "image":
      return {
        ...base,
        type: "image",
        media: {
          id: message.image!.id,
          mimeType: message.image!.mime_type,
          caption: message.image!.caption,
          sha256: message.image!.sha256,
        },
      };

    case "document":
      return {
        ...base,
        type: "document",
        media: {
          id: message.document!.id,
          mimeType: message.document!.mime_type,
          filename: message.document!.filename,
          caption: message.document!.caption,
          sha256: message.document!.sha256,
        },
      };

    case "audio":
      return {
        ...base,
        type: "audio",
        media: {
          id: message.audio!.id,
          mimeType: message.audio!.mime_type,
        },
      };

    case "video":
      return {
        ...base,
        type: "video",
        media: {
          id: message.video!.id,
          mimeType: message.video!.mime_type,
          caption: message.video!.caption,
          sha256: message.video!.sha256,
        },
      };

    case "sticker":
      return {
        ...base,
        type: "sticker",
        media: {
          id: message.sticker!.id,
          mimeType: message.sticker!.mime_type,
        },
      };

    case "interactive": {
      const interactive = message.interactive!;
      if (interactive.type === "button_reply") {
        return {
          ...base,
          type: "interactive",
          // Surface the button reply text as plain text for easy handling
          text: interactive.button_reply?.title ?? "",
          interactive: {
            type: "button_reply",
            id: interactive.button_reply?.id ?? "",
            title: interactive.button_reply?.title ?? "",
          },
        };
      }
      if (interactive.type === "list_reply") {
        return {
          ...base,
          type: "interactive",
          text: interactive.list_reply?.title ?? "",
          interactive: {
            type: "list_reply",
            id: interactive.list_reply?.id ?? "",
            title: interactive.list_reply?.title ?? "",
            description: interactive.list_reply?.description,
          },
        };
      }
      return { ...base, type: "interactive" };
    }

    case "location":
      return { ...base, type: "location" };

    default:
      return { ...base, type: "unknown" };
  }
}

// ─── 7. verifyWebhookSignature ────────────────────────────────────────────────

/**
 * Verifies that a webhook request originated from Meta by checking the
 * X-Hub-Signature-256 header.
 *
 * Meta computes: HMAC-SHA256(rawRequestBody, APP_SECRET)
 * and sends it as: "sha256=<hex_digest>"
 *
 * This function uses a constant-time comparison to prevent timing attacks.
 *
 * IMPORTANT: Pass the RAW request body string (before JSON.parse), not the
 * parsed object. Any difference in serialisation will cause verification to fail.
 *
 * @param rawBody   - Raw UTF-8 string of the POST request body
 * @param signature - Value of the X-Hub-Signature-256 header
 * @returns          true if signature is valid, false otherwise
 *
 * @example
 * ```typescript
 * const rawBody = await req.text();
 * const sig = req.headers.get("X-Hub-Signature-256") ?? "";
 * if (!verifyWebhookSignature(rawBody, sig)) {
 *   return new Response("Forbidden", { status: 403 });
 * }
 * ```
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
): boolean {
  const secret = Deno.env.get("WHATSAPP_APP_SECRET");

  if (!secret) {
    console.error("[whatsapp] WHATSAPP_APP_SECRET is not set — cannot verify signatures");
    return false;
  }

  if (!signature.startsWith("sha256=")) {
    return false;
  }

  // Compute expected HMAC using node:crypto (synchronous, available in Deno v2)
  const expected = "sha256=" + createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  // Constant-time string comparison to prevent timing side-channel attacks
  if (expected.length !== signature.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }

  return mismatch === 0;
}

// ─── Webhook verification GET handler ─────────────────────────────────────────

/**
 * Handles Meta's webhook verification challenge (HTTP GET).
 * Call this from the webhook Edge Function's GET handler.
 *
 * Meta sends: ?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=CHALLENGE
 * We respond with the challenge value to confirm ownership of the endpoint.
 *
 * @param url - The incoming request URL (used to extract query params)
 * @returns    The challenge string if verification passes, null otherwise
 */
export function verifyWebhookChallenge(url: URL): string | null {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expectedToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN");

  if (mode === "subscribe" && token === expectedToken && challenge) {
    return challenge;
  }

  return null;
}

// ─── Utility: isDocumentSupported ─────────────────────────────────────────────

/**
 * Returns true if a MIME type is in CompliLet's accepted document list.
 * Used during document collection to validate uploads before downloading.
 */
export function isDocumentSupported(mimeType: string): boolean {
  return (ACCEPTED_DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType);
}

// ─── Utility: formatPhoneForWhatsApp ──────────────────────────────────────────

/**
 * Normalises a UK or international phone number to the E.164 format
 * WhatsApp requires (digits only, no +, no spaces).
 *
 * Examples:
 *   "+44 7700 000000"  → "447700000000"
 *   "07700 000000"     → "447700000000"
 *   "447700000000"     → "447700000000"
 *
 * Only handles UK numbers. For international numbers, pass pre-normalised.
 */
export function formatPhoneForWhatsApp(phone: string): string {
  // Strip all non-digit characters
  const digits = phone.replace(/\D/g, "");

  // UK local format: 07xxx → 447xxx
  if (digits.startsWith("07") && digits.length === 11) {
    return "44" + digits.slice(1);
  }

  // Already in E.164 without + prefix
  return digits;
}
