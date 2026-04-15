/**
 * CompliLet — SignWell E-Signature Client
 *
 * Wraps the SignWell REST API v1 for creating signature requests,
 * retrieving signing URLs, and downloading completed documents.
 *
 * API base: https://www.signwell.com/api/v1
 * Auth: X-Api-Token header (SIGNWELL_API_KEY env var)
 *
 * Signing flow (sequential):
 *   1. Create document → landlord (sequence 1) → tenant (sequence 2)
 *   2. Retrieve landlord signing URL → send via WhatsApp
 *   3. Webhook fires recipient.completed when landlord signs
 *   4. Retrieve tenant signing URL → send via WhatsApp
 *   5. Webhook fires document.completed when both have signed
 *
 * Uses fetch() — safe for Deno Edge Functions.
 */

const SIGNWELL_API_BASE = "https://www.signwell.com/api/v1";

// ─── Public Types ──────────────────────────────────────────────────────────

export interface SignWellRecipient {
  id: string;
  name: string;
  email: string;
  /** 1 = signs first, 2 = signs second */
  sequence: number;
  /** The unique URL the recipient visits to sign */
  signing_url?: string;
  status?: "pending" | "viewed" | "completed" | "declined";
  signed_at?: string;
}

export interface SignWellDocument {
  id: string;
  name: string;
  status: "pending" | "out_for_signature" | "completed" | "declined" | "expired";
  created_at: string;
  completed_at?: string;
  recipients: SignWellRecipient[];
  /** URL to download the final signed PDF (only present when status === "completed") */
  completed_document_url?: string;
  metadata?: Record<string, string>;
}

export interface CreateDocumentParams {
  /** Raw PDF bytes of the unsigned agreement */
  pdfBytes: Uint8Array;
  /** Human-readable document name */
  name: string;
  landlordName: string;
  landlordEmail: string;
  tenantName: string;
  tenantEmail: string;
  /** The property address — stored in metadata for reference */
  propertyAddress: string;
  /** CompliLet session ID — stored in metadata */
  sessionId: string;
  /** Where SignWell should POST events (set to your signwell-callback function URL) */
  callbackUrl: string;
}

// ─── API Client ────────────────────────────────────────────────────────────

function apiKey(): string {
  const key = Deno.env.get("SIGNWELL_API_KEY");
  if (!key) throw new Error("SIGNWELL_API_KEY environment variable is not set");
  return key;
}

async function signwellFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${SIGNWELL_API_BASE}${path}`, {
    ...options,
    headers: {
      "X-Api-Token": apiKey(),
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SignWell API error ${res.status} on ${path}: ${body}`);
  }

  return res.json() as Promise<T>;
}

// ─── Public Functions ──────────────────────────────────────────────────────

/**
 * Uploads a PDF to SignWell and creates a signature request.
 *
 * The landlord (sequence 1) is asked to sign first.
 * After they sign, SignWell automatically notifies the tenant (sequence 2).
 *
 * Returns the created SignWell document object.
 */
export async function createSignatureRequest(
  params: CreateDocumentParams,
): Promise<SignWellDocument> {
  const {
    pdfBytes, name, landlordName, landlordEmail,
    tenantName, tenantEmail, propertyAddress, sessionId, callbackUrl,
  } = params;

  // SignWell expects file content as base64
  const base64Content = btoa(
    Array.from(pdfBytes, (b) => String.fromCharCode(b)).join(""),
  );

  const body = {
    name,
    // Deliver completed document to both parties via email automatically
    send_email: true,
    // Use embedded signing URLs (we send them via WhatsApp instead of email for signing)
    embedded: false,
    // Remind every 3 days until signed
    remind_every: 3,
    // Expire after 30 days
    expires_in: 30,
    callback_url: callbackUrl,
    metadata: {
      session_id: sessionId,
      property_address: propertyAddress,
      platform: "complilet",
    },
    recipients: [
      {
        name: landlordName,
        email: landlordEmail,
        sequence: 1,
        role: "Landlord",
      },
      {
        name: tenantName,
        email: tenantEmail,
        sequence: 2,
        role: "Tenant",
      },
    ],
    files: [
      {
        name: `${name}.pdf`,
        file_base64: base64Content,
      },
    ],
    // Place signature fields on page 4 (signature page)
    // These use percentage-based placement on the page
    fields: [
      // Landlord signature — page 4, signature area
      {
        recipient_index: 0,
        type: "signature",
        page: 4,
        x: 19.5,  // ~MARGIN+90 / A4_W as %
        y: 52.0,  // approximate Y position as %
        width: 33.0,
        height: 8.0,
        required: true,
      },
      // Landlord date
      {
        recipient_index: 0,
        type: "date",
        page: 4,
        x: 19.5,
        y: 44.0,
        width: 23.0,
        height: 4.5,
        required: true,
      },
      // Tenant signature
      {
        recipient_index: 1,
        type: "signature",
        page: 4,
        x: 19.5,
        y: 28.0,
        width: 33.0,
        height: 8.0,
        required: true,
      },
      // Tenant date
      {
        recipient_index: 1,
        type: "date",
        page: 4,
        x: 19.5,
        y: 20.0,
        width: 23.0,
        height: 4.5,
        required: true,
      },
    ],
  };

  return signwellFetch<SignWellDocument>("/documents", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Retrieves a document by ID and returns its current state,
 * including per-recipient signing URLs.
 */
export async function getDocument(documentId: string): Promise<SignWellDocument> {
  return signwellFetch<SignWellDocument>(`/documents/${documentId}`);
}

/**
 * Returns the signing URL for a specific recipient on a document.
 * Use this to retrieve the landlord URL immediately after creation,
 * and the tenant URL after the landlord has signed.
 */
export async function getSigningUrl(
  documentId: string,
  recipientEmail: string,
): Promise<string | null> {
  const doc = await getDocument(documentId);
  const recipient = doc.recipients.find((r) => r.email === recipientEmail);
  return recipient?.signing_url ?? null;
}

/**
 * Downloads the completed signed PDF as raw bytes.
 * Only works when document status === "completed".
 */
export async function downloadSignedPdf(documentId: string): Promise<Uint8Array> {
  const doc = await getDocument(documentId);

  if (!doc.completed_document_url) {
    throw new Error(
      `SignWell document ${documentId} is not completed (status: ${doc.status})`,
    );
  }

  const res = await fetch(doc.completed_document_url, {
    headers: { "X-Api-Token": apiKey() },
  });

  if (!res.ok) {
    throw new Error(
      `Failed to download signed PDF: ${res.status} ${res.statusText}`,
    );
  }

  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Cancels / voids a document (e.g. when the agreement is declined).
 */
export async function cancelDocument(documentId: string): Promise<void> {
  await signwellFetch(`/documents/${documentId}/cancel`, { method: "PUT" });
}

// ─── Webhook Payload Types ─────────────────────────────────────────────────

export interface SignWellWebhookPayload {
  event: {
    /** e.g. "document.completed", "recipient.completed", "document.declined" */
    type: string;
    created_at: string;
  };
  data: {
    document: SignWellDocument;
    /** Present on recipient.completed events */
    recipient?: SignWellRecipient;
  };
}
