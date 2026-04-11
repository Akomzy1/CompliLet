/**
 * CompliLet — Reference Chaser Cron
 *
 * Runs hourly via Supabase pg_cron to drive the follow-up schedule for
 * outstanding reference requests.
 *
 * Actions per run:
 *   1. Find all reference_requests in "awaiting_response" status.
 *   2. For each, check whether a follow-up is due (based on follow_up_count
 *      and REFERENCE_FOLLOW_UP_DAYS thresholds from last_contact_at).
 *   3. Send the appropriate follow-up WhatsApp message.
 *   4. If follow_up_count >= REFERENCE_MAX_FOLLOW_UPS and still no response,
 *      mark the reference as "unresponsive".
 *   5. For any session where ALL reference_requests are now in a terminal state
 *      (responded | unresponsive | skipped), advance the session to "decision"
 *      and notify the landlord.
 *
 * pg_cron setup (run once in your Supabase SQL editor):
 * ─────────────────────────────────────────────────────
 *   SELECT cron.schedule(
 *     'ref-chaser-followup',
 *     '0 * * * *',  -- every hour at :00
 *     $$
 *     SELECT net.http_post(
 *       url      := current_setting('app.supabase_url') || '/functions/v1/ref-chaser-cron',
 *       headers  := jsonb_build_object(
 *                    'Content-Type', 'application/json',
 *                    'Authorization', 'Bearer ' || current_setting('app.service_role_key')
 *                   ),
 *       body     := '{}'::jsonb
 *     ) AS request_id;
 *     $$
 *   );
 *
 * Required Postgres settings (set via Supabase Dashboard → Database → Settings):
 *   app.supabase_url        = 'https://xxx.supabase.co'
 *   app.service_role_key    = 'eyJ...'
 *
 * Deploy config: see supabase/config.toml [functions.ref-chaser-cron]
 *   verify_jwt = false
 *
 * Required environment variables (same as webhook-handler):
 *   WHATSAPP_TOKEN, PHONE_NUMBER_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { supabase } from "../_shared/supabase.ts";
import { sendTextMessage } from "../_shared/whatsapp.ts";
import {
  REFERENCE_MAX_FOLLOW_UPS,
  REFERENCE_FOLLOW_UP_DAYS,
} from "../_shared/constants.ts";
import {
  sendFollowUp,
  markUnresponsive,
  checkAndAdvanceIfComplete,
} from "../_shared/agents/reference-chaser.ts";

// ─── Entry point ────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  try {
    const result = await runCron();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[ref-chaser-cron] Fatal error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// ─── Cron logic ─────────────────────────────────────────────────────────────

interface CronResult {
  processed: number;
  followUpsSent: number;
  markedUnresponsive: number;
  sessionsAdvanced: number;
  errors: string[];
}

async function runCron(): Promise<CronResult> {
  const result: CronResult = {
    processed: 0,
    followUpsSent: 0,
    markedUnresponsive: 0,
    sessionsAdvanced: 0,
    errors: [],
  };

  // ── 1. Fetch all references still awaiting a response ──
  const { data: pending, error: fetchErr } = await supabase
    .from("reference_requests")
    .select("id, session_id, landlord_id, follow_up_count, last_contact_at")
    .eq("status", "awaiting_response")
    .eq("responded", false);

  if (fetchErr) {
    result.errors.push(`Fetch error: ${fetchErr.message}`);
    return result;
  }

  const now = Date.now();

  for (const ref of pending ?? []) {
    result.processed++;
    try {
      const lastContact = new Date(ref.last_contact_at as string).getTime();
      const daysSinceContact = (now - lastContact) / (1000 * 60 * 60 * 24);
      const followUpCount = ref.follow_up_count as number;

      if (followUpCount >= REFERENCE_MAX_FOLLOW_UPS) {
        // All follow-ups exhausted — mark unresponsive.
        await markUnresponsive(ref.id as string);
        result.markedUnresponsive++;
        // Check if this completes the session.
        await maybeAdvanceSession(
          ref.session_id as string,
          ref.landlord_id as string,
          result,
        );
        continue;
      }

      // Check if the next follow-up threshold has been crossed.
      const thresholdDays = REFERENCE_FOLLOW_UP_DAYS[followUpCount]; // cumulative days
      if (daysSinceContact >= thresholdDays) {
        const nextFollowUp = (followUpCount + 1) as 1 | 2 | 3;
        await sendFollowUp(ref.id as string, nextFollowUp);
        result.followUpsSent++;
      }
    } catch (err) {
      result.errors.push(`Ref ${ref.id}: ${String(err)}`);
    }
  }

  return result;
}

// ─── Session advancement ────────────────────────────────────────────────────

async function maybeAdvanceSession(
  sessionId: string,
  landlordId: string,
  result: CronResult,
): Promise<void> {
  // Build a minimal onHandoff callback for use in the shared module.
  await checkAndAdvanceIfComplete(
    sessionId,
    landlordId,
    async (nextStatus, data) => {
      // Directly advance the session status (trusted internal transition).
      await supabase
        .from("screening_sessions")
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq("id", sessionId);

      // Log for traceability.
      await supabase.from("agent_logs").insert({
        session_id: sessionId,
        agent_type: "reference_chaser_cron",
        event: "handoff",
        data: { next_status: nextStatus, summary: data.referenceSummary },
        created_at: new Date().toISOString(),
      }).then(() => {}).catch(() => {});

      result.sessionsAdvanced++;

      // Notify landlord that the full report is being compiled.
      const { data: landlord } = await supabase
        .from("landlords")
        .select("whatsapp_number")
        .eq("id", landlordId)
        .single();

      if (landlord?.whatsapp_number) {
        await sendTextMessage(
          landlord.whatsapp_number as string,
          "📋 *All reference checks are complete.*\n\n" +
            "I'm now preparing your tenant's full screening report. " +
            "I'll send it to you within the next few minutes.\n\n" +
            "Reply *YES* to approve or *NO* to decline once you've reviewed it.",
        );
      }
    },
  );
}
