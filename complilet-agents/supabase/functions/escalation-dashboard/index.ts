/**
 * CompliLet — Escalation Dashboard API
 *
 * Internal REST endpoint consumed by the Next.js dashboard (Prompt 28).
 * Requires a valid service-role or authenticated JWT (verify_jwt = true).
 *
 * Routes:
 *
 *   GET  /escalation-dashboard
 *     Query params:
 *       status  — "open" (default) | "resolved" | "in_progress" | "all"
 *       priority — "urgent" | "high" | "normal" (optional filter)
 *       limit   — max rows to return, default 100
 *       offset  — pagination offset, default 0
 *
 *     Response 200:
 *       {
 *         escalations: EscalationRow[],  // sorted: urgent → high → normal, then oldest first
 *         counts: { total, open, urgent, high, normal, resolved }
 *       }
 *
 *   PATCH /escalation-dashboard
 *     Body: { id: string, resolution: string, resolved_by?: string }
 *     Marks the escalation resolved, clears the session halt flag, and returns
 *     the updated row.
 *
 *     Response 200: { ok: true, escalation: EscalationRow }
 *
 *   PUT /escalation-dashboard
 *     Body: { id: string, status: "in_progress" }
 *     Transitions an open escalation to "in_progress" (human has picked it up).
 *
 *     Response 200: { ok: true }
 *
 * CORS: Allows the internal dashboard origin. Set DASHBOARD_ORIGIN env var
 * (default: https://app.complilet.co.uk).
 */

import { supabase } from "../_shared/supabase.ts";
import { resolveEscalation } from "../_shared/escalation.ts";

// ─── Types ─────────────────────────────────────────────────────────────────

interface EscalationRow {
  id: string;
  session_id:          string | null;
  tenancy_id:          string | null;
  landlord_id:         string | null;
  sender_phone:        string;
  trigger_type:        string;
  priority:            "urgent" | "high" | "normal";
  status:              "open" | "in_progress" | "resolved";
  context:             string | null;
  message_text:        string | null;
  handler_notified:    boolean;
  handler_notified_at: string | null;
  resolution:          string | null;
  resolved_by:         string | null;
  resolved_at:         string | null;
  created_at:          string;
  updated_at:          string;
  // Joined / computed
  landlord_name?:      string | null;
  property_address?:   string | null;
  tenant_phone?:       string | null;
}

// Priority sort weight — lower = higher priority.
const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 0,
  high:   1,
  normal: 2,
};

// ─── CORS helper ───────────────────────────────────────────────────────────

function corsHeaders(req: Request): Record<string, string> {
  const allowedOrigin =
    Deno.env.get("DASHBOARD_ORIGIN") ?? "https://app.complilet.co.uk";

  const origin = req.headers.get("Origin") ?? "";
  const effectiveOrigin =
    origin === allowedOrigin || origin.startsWith("http://localhost")
      ? origin
      : allowedOrigin;

  return {
    "Access-Control-Allow-Origin":  effectiveOrigin,
    "Access-Control-Allow-Methods": "GET, PATCH, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age":       "86400",
  };
}

function jsonResponse(
  data: unknown,
  status = 200,
  req: Request,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(req),
    },
  });
}

function errorResponse(message: string, status: number, req: Request): Response {
  return jsonResponse({ ok: false, error: message }, status, req);
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  try {
    switch (req.method) {
      case "GET":   return await handleGet(req);
      case "PATCH": return await handlePatch(req);
      case "PUT":   return await handlePut(req);
      default:
        return errorResponse("Method not allowed", 405, req);
    }
  } catch (err) {
    console.error("[escalation-dashboard] Unhandled error:", err);
    return errorResponse("Internal server error", 500, req);
  }
});

// ─── GET: list escalations ─────────────────────────────────────────────────

async function handleGet(req: Request): Promise<Response> {
  const url      = new URL(req.url);
  const status   = url.searchParams.get("status")   ?? "open";
  const priority = url.searchParams.get("priority");
  const limit    = Math.min(parseInt(url.searchParams.get("limit")  ?? "100", 10), 500);
  const offset   = Math.max(parseInt(url.searchParams.get("offset") ?? "0",   10), 0);

  // ── Fetch escalation rows ─────────────────────────────────────────────────
  let query = supabase
    .from("escalations")
    .select(
      `id, session_id, tenancy_id, landlord_id,
       sender_phone, trigger_type, priority, status,
       context, message_text,
       handler_notified, handler_notified_at,
       resolution, resolved_by, resolved_at,
       created_at, updated_at`,
    );

  if (status !== "all") {
    query = query.eq("status", status);
  }

  if (priority) {
    query = query.eq("priority", priority);
  }

  const { data: rows, error } = await query
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[escalation-dashboard] Query error:", error.message);
    return errorResponse("Failed to fetch escalations", 500, req);
  }

  const escalations: EscalationRow[] = (rows ?? []) as EscalationRow[];

  // ── Enrich with landlord / tenancy context ────────────────────────────────
  await enrichEscalations(escalations);

  // ── Sort: urgent first, then high, then normal; ties broken by created_at ─
  escalations.sort((a, b) => {
    const pw = (PRIORITY_WEIGHT[a.priority] ?? 99) - (PRIORITY_WEIGHT[b.priority] ?? 99);
    if (pw !== 0) return pw;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  // ── Compute aggregate counts ──────────────────────────────────────────────
  const counts = await fetchCounts();

  return jsonResponse({ escalations, counts }, 200, req);
}

/** Mutates `escalations` in-place, adding landlord_name, property_address, tenant_phone. */
async function enrichEscalations(escalations: EscalationRow[]): Promise<void> {
  const landlordIds = [...new Set(escalations.map((e) => e.landlord_id).filter(Boolean))];
  const sessionIds  = [...new Set(escalations.map((e) => e.session_id).filter(Boolean))];

  // Batch fetch landlords.
  const landlordMap = new Map<string, { name?: string }>();
  if (landlordIds.length > 0) {
    const { data: landlords } = await supabase
      .from("landlords")
      .select("id, name")
      .in("id", landlordIds as string[]);
    for (const l of landlords ?? []) {
      landlordMap.set(l.id, { name: l.name });
    }
  }

  // Batch fetch sessions for property address and tenant phone.
  const sessionMap = new Map<string, { property_address?: string; tenant_phone?: string }>();
  if (sessionIds.length > 0) {
    const { data: sessions } = await supabase
      .from("screening_sessions")
      .select("id, property_address, tenant_phone")
      .in("id", sessionIds as string[]);
    for (const s of sessions ?? []) {
      sessionMap.set(s.id, {
        property_address: s.property_address,
        tenant_phone:     s.tenant_phone,
      });
    }
  }

  // Merge.
  for (const esc of escalations) {
    if (esc.landlord_id) {
      esc.landlord_name = landlordMap.get(esc.landlord_id)?.name ?? null;
    }
    if (esc.session_id) {
      const sess = sessionMap.get(esc.session_id);
      esc.property_address = sess?.property_address ?? null;
      esc.tenant_phone     = sess?.tenant_phone     ?? null;
    }
  }
}

async function fetchCounts(): Promise<{
  total: number;
  open: number;
  in_progress: number;
  resolved: number;
  urgent: number;
  high: number;
  normal: number;
}> {
  const { data } = await supabase
    .from("escalations")
    .select("status, priority");

  const rows = data ?? [];
  return {
    total:       rows.length,
    open:        rows.filter((r: { status: string }) => r.status === "open").length,
    in_progress: rows.filter((r: { status: string }) => r.status === "in_progress").length,
    resolved:    rows.filter((r: { status: string }) => r.status === "resolved").length,
    urgent:      rows.filter((r: { priority: string }) => r.priority === "urgent").length,
    high:        rows.filter((r: { priority: string }) => r.priority === "high").length,
    normal:      rows.filter((r: { priority: string }) => r.priority === "normal").length,
  };
}

// ─── PATCH: resolve an escalation ─────────────────────────────────────────

async function handlePatch(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400, req);
  }

  const { id, resolution, resolved_by } = body as {
    id?: string;
    resolution?: string;
    resolved_by?: string;
  };

  if (!id || typeof id !== "string") {
    return errorResponse("Missing required field: id", 400, req);
  }
  if (!resolution || typeof resolution !== "string") {
    return errorResponse("Missing required field: resolution", 400, req);
  }

  // Verify the escalation exists and is not already resolved.
  const { data: existing, error: fetchError } = await supabase
    .from("escalations")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();

  if (fetchError || !existing) {
    return errorResponse(`Escalation ${id} not found`, 404, req);
  }
  if (existing.status === "resolved") {
    return errorResponse(`Escalation ${id} is already resolved`, 409, req);
  }

  await resolveEscalation(id, resolution, resolved_by);

  // Return the updated row.
  const { data: updated } = await supabase
    .from("escalations")
    .select("*")
    .eq("id", id)
    .single();

  return jsonResponse({ ok: true, escalation: updated }, 200, req);
}

// ─── PUT: transition to in_progress ───────────────────────────────────────

async function handlePut(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400, req);
  }

  const { id, status } = body as { id?: string; status?: string };

  if (!id || typeof id !== "string") {
    return errorResponse("Missing required field: id", 400, req);
  }
  if (status !== "in_progress") {
    return errorResponse('Only status "in_progress" is valid for PUT', 400, req);
  }

  const { error } = await supabase
    .from("escalations")
    .update({ status: "in_progress", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open"); // Guard: only transition from open → in_progress

  if (error) {
    return errorResponse(`Failed to update escalation: ${error.message}`, 500, req);
  }

  return jsonResponse({ ok: true }, 200, req);
}
