-- ─────────────────────────────────────────────────────────────────────────────
-- CompliLet — Contractor Options (3-option flow) Migration
-- 20260413000003_contractor_options.sql
--
-- Adds support for the 3-option contractor flow used by both Compliance
-- Autopilot and Maintenance Triage agents:
--
--   1️⃣ Find me a contractor (marketplace)
--   2️⃣ I have my own contractor   (landlord-provided, CompliLet coordinates)
--   3️⃣ Already booked              (CompliLet just chases the certificate)
--
-- ALL CHANGES ARE ADDITIVE — no existing columns are modified or dropped.
-- Safe to run against a live database.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. contractors table — source + landlord linkage + memory ────────────────

ALTER TABLE contractors
  ADD COLUMN IF NOT EXISTS source              TEXT        DEFAULT 'marketplace',
  ADD COLUMN IF NOT EXISTS linked_landlord_id  UUID        REFERENCES landlords(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_used_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS postcode_area       TEXT,
  ADD COLUMN IF NOT EXISTS is_verified         BOOLEAN     DEFAULT false;

-- Backfill: existing rows are marketplace + verified by default
UPDATE contractors
   SET source      = 'marketplace',
       is_verified = COALESCE(active, true)
 WHERE source IS NULL;

-- Constrain source values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_name = 'contractors' AND constraint_name = 'contractors_source_check'
  ) THEN
    ALTER TABLE contractors
      ADD CONSTRAINT contractors_source_check
      CHECK (source IN ('marketplace', 'landlord_provided'));
  END IF;
END$$;

-- Lookup index for landlord-owned contractors
CREATE INDEX IF NOT EXISTS idx_contractors_linked_landlord
  ON contractors (linked_landlord_id, trade)
  WHERE linked_landlord_id IS NOT NULL;

-- Lookup index for finding contractor by inbound phone (when they reply)
CREATE INDEX IF NOT EXISTS idx_contractors_phone
  ON contractors (phone)
  WHERE phone IS NOT NULL;

-- ── 2. referral_transactions — extend for full job tracking ──────────────────

ALTER TABLE referral_transactions
  ADD COLUMN IF NOT EXISTS landlord_id            UUID REFERENCES landlords(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS tenancy_id             UUID REFERENCES tenancies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS compliance_type        TEXT,
  ADD COLUMN IF NOT EXISTS compliance_deadline_id UUID REFERENCES compliance_deadlines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS maintenance_ticket_id  UUID REFERENCES maintenance_tickets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source                 TEXT DEFAULT 'marketplace',
  ADD COLUMN IF NOT EXISTS referred_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at           TIMESTAMPTZ;

-- Constrain source values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_name = 'referral_transactions' AND constraint_name = 'referral_transactions_source_check'
  ) THEN
    ALTER TABLE referral_transactions
      ADD CONSTRAINT referral_transactions_source_check
      CHECK (source IN ('marketplace', 'landlord_provided'));
  END IF;
END$$;

-- Hot path: "did this landlord previously use a contractor for this job at this property?"
CREATE INDEX IF NOT EXISTS idx_referrals_memory
  ON referral_transactions (landlord_id, tenancy_id, compliance_type, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_referrals_maintenance
  ON referral_transactions (landlord_id, maintenance_ticket_id);

-- ── 3. coordinator_state — contractor flow conversation step ─────────────────

ALTER TABLE coordinator_state
  ADD COLUMN IF NOT EXISTS contractor_flow_state JSONB DEFAULT '{"step": "idle"}'::jsonb;

-- ── 4. Comments ──────────────────────────────────────────────────────────────

COMMENT ON COLUMN contractors.source IS
  'marketplace = vetted by CompliLet, earns referral fee.
   landlord_provided = added by a specific landlord, no referral fee.';

COMMENT ON COLUMN contractors.linked_landlord_id IS
  'For landlord_provided contractors: the landlord who supplied this contractor.
   Used so we only show this contractor as a memory option to the same landlord.';

COMMENT ON COLUMN contractors.last_used_at IS
  'Updated when a job for this contractor is marked completed. Used to surface
   recently-used contractors in the "use the same contractor again?" memory prompt.';

COMMENT ON COLUMN coordinator_state.contractor_flow_state IS
  'JSONB state for the 3-option contractor conversation.
   Shape: { step, source ("compliance"|"maintenance"), trade, job_type, label,
            tenancy_id, deadline_id, ticket_id, contractor_id, contractor_name,
            contractor_phone, due_date, property_address, urgency }.
   step values:
     idle | awaiting_choice | awaiting_own_contractor | awaiting_availability
     | awaiting_landlord_approval | confirmed';
