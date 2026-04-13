-- =============================================================================
-- CompliLet — Admin summary cron job + system health helper
-- Migration: 20260412000002_admin_summary_cron.sql
-- =============================================================================

-- ── Schedule: daily admin summary at 8 PM UK time (UTC+1 in summer) ──────────
-- Using 19:00 UTC which equals 8 PM BST. Adjust for GMT (20:00 UTC) in winter.
-- For simplicity we schedule at 20:00 UTC (covers GMT; BST will be 9 PM).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'complilet_daily_admin_summary';
SELECT cron.schedule(
  'complilet_daily_admin_summary',
  '0 20 * * *',  -- 20:00 UTC = 8 PM GMT / 9 PM BST
  $$
  SELECT call_edge_function(
    'daily-admin-summary',
    '{}'::JSONB
  )
  $$
);

-- ── get_cron_job_status() — used by /internal/system page ────────────────────
-- Returns last run time and status for each scheduled cron job.
-- Reads from cron.job_run_details which pg_cron populates.
CREATE OR REPLACE FUNCTION get_cron_job_status()
RETURNS TABLE(
  jobname  TEXT,
  last_run TIMESTAMPTZ,
  status   TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    j.jobname,
    rd.start_time AS last_run,
    CASE
      WHEN rd.return_message = 'succeeded' THEN 'succeeded'
      WHEN rd.return_message ILIKE '%error%' THEN 'failed'
      ELSE rd.return_message
    END AS status
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT return_message, start_time
    FROM cron.job_run_details jrd
    WHERE jrd.jobid = j.jobid
    ORDER BY jrd.start_time DESC
    LIMIT 1
  ) rd ON TRUE
  WHERE j.jobname LIKE 'complilet_%'
  ORDER BY j.jobname;
$$;
