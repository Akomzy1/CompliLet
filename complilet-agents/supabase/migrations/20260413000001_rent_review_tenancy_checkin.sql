-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Rent Review & Tenancy Check-In Support
--
-- Replaces the Renewal Agent with two new agents under the Renters' Rights
-- Act 2025. All tenancies are now periodic — there are no fixed-term renewals.
--
-- Changes:
--   1. tenancies — add columns for Section 13 rent review and periodic check-in
--   2. coordinator_state — add JSONB state columns for new agent sub-flows
--   3. session_status ENUM — remove "renewal", which is no longer a valid state
--   4. agent_type ENUM — remove "renewal", add "tenancy_check_in" and "rent_review"
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. tenancies columns ─────────────────────────────────────────────────────

ALTER TABLE tenancies
  -- Section 13 rent review
  ADD COLUMN IF NOT EXISTS last_rent_increase_date    DATE,
  ADD COLUMN IF NOT EXISTS pending_rent_gbp           NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS rent_review_effective_date DATE,

  -- Tenancy check-in
  ADD COLUMN IF NOT EXISTS next_check_in_date         DATE,
  ADD COLUMN IF NOT EXISTS notice_given_date          DATE,

  -- Landlord details needed for Form 4A (Section 13 notice)
  ADD COLUMN IF NOT EXISTS landlord_name              TEXT,
  ADD COLUMN IF NOT EXISTS landlord_address           TEXT;

COMMENT ON COLUMN tenancies.last_rent_increase_date IS
  'Date the last Section 13 rent increase took effect. '
  'Used to enforce the 12-month frequency limit under the Renters'' Rights Act 2025. '
  'NULL means no increase has ever been applied — start_date is used as the reference.';

COMMENT ON COLUMN tenancies.pending_rent_gbp IS
  'Proposed new rent (GBP) from a Section 13 notice that has been served but '
  'has not yet reached its effective date.';

COMMENT ON COLUMN tenancies.rent_review_effective_date IS
  'Effective date of the pending Section 13 rent increase. '
  'Auto-updated to monthly_rent_gbp on this date by the compliance cron.';

COMMENT ON COLUMN tenancies.next_check_in_date IS
  'Date when the next annual tenancy check-in message should be sent to the landlord. '
  'Set to 12 months after start_date or last check-in confirmation.';

COMMENT ON COLUMN tenancies.notice_given_date IS
  'Date the tenant gave 2-month notice to vacate under the Renters'' Rights Act 2025. '
  'NULL until the tenant indicates they are leaving.';

COMMENT ON COLUMN tenancies.landlord_name IS
  'Full name (or company name) of the landlord — required on the Section 13 Form 4A.';

COMMENT ON COLUMN tenancies.landlord_address IS
  'Correspondence address of the landlord — required on the Section 13 Form 4A.';

-- ─── 2. coordinator_state columns ────────────────────────────────────────────

ALTER TABLE coordinator_state
  ADD COLUMN IF NOT EXISTS check_in_state    JSONB NOT NULL DEFAULT '{"step":"idle"}',
  ADD COLUMN IF NOT EXISTS rent_review_state JSONB NOT NULL DEFAULT '{"step":"idle"}';

COMMENT ON COLUMN coordinator_state.check_in_state IS
  'Tracks the current step in the tenancy-check-in sub-flow. '
  'Persists between WhatsApp messages so multi-turn check-in conversations resume correctly. '
  'Schema: { step: "idle" | "awaiting_landlord_response" | "awaiting_concern_detail" | "checkout_in_progress", ... }';

COMMENT ON COLUMN coordinator_state.rent_review_state IS
  'Tracks the current step in the Section 13 rent-review sub-flow. '
  'Persists between WhatsApp messages so multi-turn rent review conversations resume correctly. '
  'Schema: { step: "idle" | "awaiting_amount" | "awaiting_landlord_confirm" | "notice_served" | "disputed" | "tenant_accepted" | "tribunal_referred", ... }';

-- ─── 3. session_status ENUM — remove "renewal" ───────────────────────────────
--
-- Under the Renters' Rights Act 2025, there are no fixed-term tenancies and
-- no renewals. All tenancies continue as periodic. The "renewal" status is
-- therefore obsolete. Active tenancies that previously had status = "renewal"
-- are migrated to "active_tenancy".
--
-- NOTE: Removing an ENUM value requires rebuilding the type. We use the safe
-- approach: update existing rows first, then alter the type.

-- Migrate any existing "renewal" sessions to "active_tenancy"
UPDATE sessions
SET status = 'active_tenancy'
WHERE status = 'renewal';

-- Rebuild the session_status ENUM without "renewal"
-- (PostgreSQL requires creating a new type and swapping)
ALTER TYPE session_status RENAME TO session_status_old;

CREATE TYPE session_status AS ENUM (
  'pre_qualifying',
  'collecting_docs',
  'right_to_rent',
  'chasing_refs',
  'decision',
  'move_in_pack',
  'active_tenancy',
  'abandoned',
  'rejected'
);

ALTER TABLE sessions
  ALTER COLUMN status TYPE session_status
  USING status::text::session_status;

DROP TYPE session_status_old;

-- ─── 4. agent_type ENUM — remove "renewal", add new types ───────────────────

ALTER TYPE agent_type RENAME TO agent_type_old;

CREATE TYPE agent_type AS ENUM (
  'coordinator',
  'screener',
  'compliance',
  'maintenance',
  'inspection',
  'rent_collection',
  'tenancy_check_in',
  'rent_review'
);

-- Update any existing rows that reference agent_type columns
-- (conversation_logs and similar tables)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversation_logs'
      AND column_name = 'agent_type'
  ) THEN
    -- Migrate "renewal" agent_type rows to "tenancy_check_in" (closest equivalent)
    EXECUTE $dyn$
      UPDATE conversation_logs
      SET agent_type = 'tenancy_check_in'::text
      WHERE agent_type = 'renewal'
    $dyn$;

    EXECUTE $dyn$
      ALTER TABLE conversation_logs
        ALTER COLUMN agent_type TYPE agent_type
        USING agent_type::text::agent_type
    $dyn$;
  END IF;
END $$;

DROP TYPE agent_type_old;

-- ─── 5. Index for rent review eligibility check ──────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tenancies_last_rent_increase_date
  ON tenancies (last_rent_increase_date)
  WHERE last_rent_increase_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tenancies_rent_review_effective_date
  ON tenancies (rent_review_effective_date)
  WHERE rent_review_effective_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tenancies_next_check_in_date
  ON tenancies (next_check_in_date)
  WHERE next_check_in_date IS NOT NULL;
