/**
 * CompliLet — Konfir Webhook Callback Edge Function
 *
 * Receives Konfir's employment + income verification result after a tenant
 * has consented via the Konfir SMS link.
 *
 * Flow:
 *   1. Konfir POSTs the verification report to this endpoint
 *   2. We validate the bearer token (KONFIR_WEBHOOK_SECRET)
 *   3. handleKonfirCallback() stores the proof_of_income document record
 *   4. Session agent_state is updated to mark proof_of_income as collected
 *   5. Tenant receives next request: proof_of_address
 *   6. Landlord receives an income summary WhatsApp message
 *
 * URL: https://{project}.supabase.co/functions/v1/konfir-callback?session={sessionId}
 *
 * This function is only active when KONFIR_ENABLED=true.
 */

import { createClient } from "@supabase/supabase-js";
import { handleKonfirCallback, type KonfirReport } from "../_shared/agents/doc-collector.ts";
import { sendTextMessage } from "../_shared/whatsapp.ts";

// ─── Supabase client ──────────────────────────────────────────────────────────

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Only accept POST.
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Validate bearer token — Konfir sends this in Authorization header.
  const webhookSecret = Deno.env.get("KONFIR_WEBHOOK_SECRET");
  if (webhookSecret) {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (token !== webhookSecret) {
      console.error("konfir-callback: invalid webhook secret");
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // Extract sessionId from query string.
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session");
  if (!sessionId) {
    return new Response("Missing session query parameter", { status: 400 });
  }

  // Parse Konfir report body.
  let report: KonfirReport;
  try {
    report = await req.json() as KonfirReport;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  // ── Load session to get landlord_id and tenant phone ─────────────────────

  const { data: session, error: sessionErr } = await supabase
    .from("screening_sessions")
    .select("id, landlord_id, tenant_phone, agent_state, pre_qualifying_summary")
    .eq("id", sessionId)
    .single();

  if (sessionErr || !session) {
    console.error("konfir-callback: session not found:", sessionErr?.message);
    return new Response("Session not found", { status: 404 });
  }

  const { landlord_id: landlordId, tenant_phone: tenantPhone } = session;

  // ── Store the Konfir proof_of_income document ─────────────────────────────

  let collectedDoc;
  try {
    collectedDoc = await handleKonfirCallback(sessionId, landlordId, report);
  } catch (err) {
    console.error("konfir-callback: handleKonfirCallback failed:", err);
    return new Response("Internal error storing verification", { status: 500 });
  }

  // ── Update session agent_state ────────────────────────────────────────────

  const currentState = (session.agent_state as Record<string, unknown>) ?? {};
  const currentDocs = (currentState.documents_collected as Record<string, unknown>) ?? {};
  const updatedDocs = { ...currentDocs, proof_of_income: collectedDoc };

  const { error: updateErr } = await supabase
    .from("screening_sessions")
    .update({
      agent_state: { ...currentState, documents_collected: updatedDocs },
    })
    .eq("id", sessionId);

  if (updateErr) {
    console.error("konfir-callback: failed to update session state:", updateErr.message);
    // Non-fatal — continue so tenant still gets the next request.
  }

  // ── Notify tenant: income verified, request proof of address ─────────────

  const grossFormatted = report.gross_monthly_income
    ? `£${report.gross_monthly_income.toLocaleString("en-GB")}/month`
    : "verified";

  await sendTextMessage(
    tenantPhone,
    `✅ *Income verified* — ${grossFormatted} gross at ${report.employer_name}.\n\n` +
    "Verified directly from payroll and HMRC records via Konfir. Thank you! 👍\n\n" +
    "One last document — *proof of address*.\n\n" +
    "I need something dated in the *last 3 months*, such as:\n" +
    "• A *utility bill* (gas, electric, water, broadband)\n" +
    "• A *bank statement*\n" +
    "• A *council tax bill* (current year)",
  ).catch((err) => console.error("konfir-callback: failed to message tenant:", err));

  // ── Notify landlord with income summary ───────────────────────────────────

  const { data: landlord } = await supabase
    .from("landlords")
    .select("whatsapp_phone")
    .eq("id", landlordId)
    .single();

  if (landlord?.whatsapp_phone) {
    const employedSince = report.employment_start_date
      ? new Date(report.employment_start_date).toLocaleDateString("en-GB", {
          month: "long",
          year: "numeric",
        })
      : "date unknown";

    await sendTextMessage(
      landlord.whatsapp_phone,
      `📊 *Income verified for your applicant*\n\n` +
      `• Income: *${grossFormatted} gross* / £${report.net_monthly_income?.toLocaleString("en-GB")}/month net\n` +
      `• Employer: *${report.employer_name}*\n` +
      `• Role: ${report.job_title}\n` +
      `• Employed since: ${employedSince} (${report.tenure_months} months)\n` +
      `• Source: ${report.sources.join(", ")}\n\n` +
      (report.gaps && report.gaps.length > 0
        ? `⚠️ Employment gaps flagged: ${report.gaps.join("; ")}\n\n`
        : "") +
      `_Verified by Konfir — UK Government DIATF certified (Experian company)._`,
    ).catch((err) => console.error("konfir-callback: failed to notify landlord:", err));
  }

  // ── Log the callback ──────────────────────────────────────────────────────

  await supabase.from("agent_logs").insert({
    session_id:    sessionId,
    landlord_id:   landlordId,
    agent_type:    "screener",
    agent_subtype: "konfir_callback",
    input:         { session_id: sessionId },
    output: {
      action:              "income_verified",
      employer:            report.employer_name,
      gross_monthly:       report.gross_monthly_income,
      tenure_months:       report.tenure_months,
      verification_sources: report.sources,
    },
    created_at: new Date().toISOString(),
  }).catch((err) => console.error("konfir-callback: failed to log:", err));

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
