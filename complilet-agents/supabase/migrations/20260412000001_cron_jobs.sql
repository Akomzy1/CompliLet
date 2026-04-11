-- ============================================================================
-- CompliLet — pg_cron Job Definitions
-- Migration: 20260412000001_cron_jobs.sql
--
-- All cron jobs call Supabase Edge Functions via net.http_post().
-- The jobs use a service-role Bearer token stored in vault.secrets.
--
-- Prerequisites:
--   1. pg_cron extension enabled (Supabase Pro/Team plan)
--   2. pg_net extension enabled (HTTP calls from PostgreSQL)
--   3. supabase_edge_functions_url secret set in vault
--   4. service_role_key secret set in vault
--
-- To verify after applying:
--   SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;
-- ============================================================================

-- ── Enable required extensions ─────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Convenience function: call an Edge Function ───────────────────────────────
-- Wraps net.http_post() with the correct headers, retrieved from vault.

CREATE OR REPLACE FUNCTION call_edge_function(function_name TEXT, body JSONB DEFAULT '{}')
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url        TEXT;
  v_token      TEXT;
  v_request_id BIGINT;
BEGIN
  -- Read base URL and service-role key from vault
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_edge_functions_url';

  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key';

  IF v_url IS NULL THEN
    RAISE EXCEPTION 'vault secret supabase_edge_functions_url is not set';
  END IF;
  IF v_token IS NULL THEN
    RAISE EXCEPTION 'vault secret service_role_key is not set';
  END IF;

  v_request_id := net.http_post(
    url     := v_url || '/' || function_name,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body    := body::text
  );

  RETURN v_request_id;
END;
$$;

COMMENT ON FUNCTION call_edge_function IS
  'Calls a Supabase Edge Function via pg_net. URL and token read from vault.decrypted_secrets.';

-- ── Remove any pre-existing jobs (idempotent re-run) ─────────────────────────

SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN (
  'complilet_compliance_autopilot',
  'complilet_rent_monitor',
  'complilet_inspection',
  'complilet_renewal',
  'complilet_ref_chaser',
  'complilet_maintenance_followup',
  'complilet_nrl_tax'
);

-- ── 1. Compliance Autopilot — daily at 09:00 UTC ──────────────────────────────
-- Sends WhatsApp reminders for upcoming and overdue gas safety, EICR, EPC, etc.

SELECT cron.schedule(
  'complilet_compliance_autopilot',
  '0 9 * * *',  -- every day at 09:00 UTC
  $$ SELECT call_edge_function('compliance-autopilot-cron') $$
);

-- ── 2. Rent Monitor — daily at 08:00 UTC ─────────────────────────────────────
-- Checks rent due dates; sends pre-due reminders and arrears alerts.

SELECT cron.schedule(
  'complilet_rent_monitor',
  '0 8 * * *',  -- every day at 08:00 UTC
  $$ SELECT call_edge_function('rent-monitor-cron') $$
);

-- ── 3. Inspection Cron — daily at 09:00 UTC ──────────────────────────────────
-- Schedules quarterly photo inspections, sends tenant requests,
-- sends 3-day and 6-day reminders, marks overdue inspections.

SELECT cron.schedule(
  'complilet_inspection',
  '30 9 * * *',  -- every day at 09:30 UTC (30 min after compliance to spread load)
  $$ SELECT call_edge_function('inspection-cron') $$
);

-- ── 4. Renewal Cron — daily at 08:00 UTC ─────────────────────────────────────
-- Sends 60-day landlord renewal notices, checkout inspection at 14 days,
-- closes expired tenancies after end_date passes.

SELECT cron.schedule(
  'complilet_renewal',
  '15 8 * * *',  -- every day at 08:15 UTC
  $$ SELECT call_edge_function('renewal-cron') $$
);

-- ── 5. Reference Chaser — every 6 hours ──────────────────────────────────────
-- Sends follow-up messages to unresponsive referees.
-- Runs at 4-times daily to catch timezones and working hours globally.

SELECT cron.schedule(
  'complilet_ref_chaser',
  '0 7,13,19,01 * * *',  -- 07:00, 13:00, 19:00, 01:00 UTC
  $$ SELECT call_edge_function('ref-chaser-cron') $$
);

-- ── 6. Maintenance Follow-up — daily at 10:00 UTC ────────────────────────────
-- Sends 48-hour resolution check to tenants; 7-day nudge to landlords
-- for open tickets with no contractor assigned.

SELECT cron.schedule(
  'complilet_maintenance_followup',
  '0 10 * * *',  -- every day at 10:00 UTC
  $$ SELECT call_edge_function('maintenance-followup-cron') $$
);

-- ── 7. NRL Tax Cron — daily at 07:00 UTC ─────────────────────────────────────
-- Sends NRL1 approval follow-ups, expiry reminders, Self Assessment
-- advance warnings, and quarterly payment-on-account prompts.

SELECT cron.schedule(
  'complilet_nrl_tax',
  '0 7 * * *',  -- every day at 07:00 UTC
  $$ SELECT call_edge_function('nrl-tax-cron') $$
);

-- ── Verify ────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  job_count INT;
BEGIN
  SELECT COUNT(*) INTO job_count
  FROM cron.job
  WHERE jobname LIKE 'complilet_%';

  RAISE NOTICE 'CompliLet cron jobs registered: % / 7', job_count;
END;
$$;
