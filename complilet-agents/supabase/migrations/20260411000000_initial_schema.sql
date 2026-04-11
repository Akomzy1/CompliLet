-- ============================================================================
-- CompliLet — Initial Database Schema
-- Migration: 20260411000000_initial_schema.sql
--
-- Execution order:
--   1. Extensions
--   2. Utility functions (updated_at trigger)
--   3. Tables (ordered by FK dependency)
--   4. Indexes
--   5. Updated_at triggers
--   6. Row Level Security — enable + policies
-- ============================================================================

-- ─── 1. Extensions ──────────────────────────────────────────────────────────

-- pgcrypto: gen_random_uuid() (also available via pg_catalog in PG 13+)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── 2. Utility Functions ───────────────────────────────────────────────────

-- updated_at trigger function — applied to every table that carries the column.
-- Call the trigger with: EXECUTE FUNCTION set_updated_at()
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─── 3. Tables ──────────────────────────────────────────────────────────────
-- Ordered to respect FK constraints:
--   landlords → properties → tenancies
--                          → screening_sessions → documents
--                                               → "references"
--                                               → compliance_records
--                          → compliance_deadlines
--   tenancies → maintenance_tickets
--             → inspections
--             → rent_events
--   contractors → referral_transactions ← properties
--   landlords → nrl_events
--   (messages / agent_logs / escalations have optional FKs — no hard FK constraint)
-- ============================================================================

-- ── landlords ────────────────────────────────────────────────────────────────
-- id matches auth.uid() — the Supabase Auth user is the landlord.
-- This is enforced at the application layer and via RLS.

CREATE TABLE IF NOT EXISTS landlords (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone               TEXT        UNIQUE NOT NULL,
  name                TEXT,
  email               TEXT,
  criteria_json       JSONB,                          -- custom screening criteria the landlord sets
  plan                TEXT        NOT NULL DEFAULT 'free',
  stripe_customer_id  TEXT,
  is_overseas         BOOLEAN     NOT NULL DEFAULT false,
  country             TEXT,
  timezone            TEXT,
  nrl1_status         TEXT,                           -- 'not_applied' | 'pending' | 'approved'
  nrl1_expiry         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE landlords IS 'One row per CompliLet landlord account. id = Supabase Auth user UUID.';
COMMENT ON COLUMN landlords.criteria_json IS 'JSON blob of landlord-specific screening thresholds (min income multiplier, pet policy, guarantor requirements, etc.)';
COMMENT ON COLUMN landlords.nrl1_status IS 'HMRC Non-Resident Landlord scheme status: not_applied | pending | approved';

-- ── contractors ──────────────────────────────────────────────────────────────
-- Independent of landlord ownership — visible to all authenticated users.
-- Writes are service-role only (managed by CompliLet staff).

CREATE TABLE IF NOT EXISTS contractors (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  trade         TEXT        NOT NULL,   -- 'plumber' | 'electrician' | 'gas_engineer' | 'general' etc.
  area          TEXT,                   -- postcode prefix or region (e.g. 'M' for Manchester)
  phone         TEXT,
  rating        DECIMAL(3,2),           -- 0.00–5.00
  referral_fee  DECIMAL(8,2),           -- £ fee CompliLet receives per job
  active        BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE contractors IS 'Trusted contractor directory. Managed by CompliLet ops team via service role.';

-- ── properties ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS properties (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id   UUID        NOT NULL REFERENCES landlords(id) ON DELETE CASCADE,
  address       TEXT        NOT NULL,
  postcode      TEXT,
  bedrooms      INT,
  rent_amount   DECIMAL(10,2),
  epc_expiry    DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE properties IS 'Rental properties managed by a landlord.';

-- ── tenancies ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenancies (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  tenant_phone    TEXT        NOT NULL,
  tenant_name     TEXT,
  start_date      DATE,
  end_date        DATE,
  rent_amount     DECIMAL(10,2),
  rent_due_day    INT         NOT NULL DEFAULT 1 CHECK (rent_due_day BETWEEN 1 AND 28),
  status          TEXT        NOT NULL DEFAULT 'active',   -- 'active' | 'ended' | 'notice_given'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE tenancies IS 'Active and historical tenancies at a property.';
COMMENT ON COLUMN tenancies.rent_due_day IS 'Day of month rent is due (1–28). Capped at 28 to avoid month-length issues.';

-- ── screening_sessions ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS screening_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  tenant_phone    TEXT        NOT NULL,
  tenant_name     TEXT,
  status          TEXT        NOT NULL DEFAULT 'pre_qualifying',
  -- status values: pre_qualifying | doc_collection | reference_chasing | report_ready | rejected | abandoned
  score           INT,                            -- 0–100 composite screening score
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  agent_state     JSONB       NOT NULL DEFAULT '{}'  -- stores multi-step agent conversation state
);

COMMENT ON TABLE screening_sessions IS 'Each tenant screening is a session. Tracks state machine progress and AI agent state.';
COMMENT ON COLUMN screening_sessions.agent_state IS 'Arbitrary JSONB persisted between agent turns — contains conversation history pointers, collected field values, and next-action hints.';

-- ── documents ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documents (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID        NOT NULL REFERENCES screening_sessions(id) ON DELETE CASCADE,
  type                TEXT        NOT NULL,  -- 'photo_id' | 'payslip' | 'bank_statement' | 'proof_of_address' | 'right_to_rent' | 'employment_contract'
  storage_path        TEXT,                  -- Supabase Storage object path (bucket + key)
  validated           BOOLEAN     NOT NULL DEFAULT false,
  validation_notes    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE documents IS 'Tenant documents submitted during screening. Stored in Supabase Storage (encrypted bucket).';
COMMENT ON COLUMN documents.storage_path IS 'Supabase Storage path: {bucket}/{landlord_id}/{session_id}/{filename}. Bucket enforces per-landlord isolation via RLS.';

-- ── "references" ─────────────────────────────────────────────────────────────
-- Table name is quoted because REFERENCES is a SQL reserved keyword.

CREATE TABLE IF NOT EXISTS "references" (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID        NOT NULL REFERENCES screening_sessions(id) ON DELETE CASCADE,
  referee_phone     TEXT,
  referee_name      TEXT,
  referee_type      TEXT,                  -- 'previous_landlord' | 'employer' | 'character'
  status            TEXT        NOT NULL DEFAULT 'pending',  -- 'pending' | 'chasing' | 'received' | 'unresponsive'
  response_summary  TEXT,
  last_chased_at    TIMESTAMPTZ,
  chase_count       INT         NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE "references" IS 'Reference requests sent to employer and previous landlord on behalf of the landlord.';
COMMENT ON COLUMN "references".chase_count IS 'Number of follow-up messages sent. CompliLet chases at 2 days, 4 days, 7 days (3 chasers max).';

-- ── compliance_records ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compliance_records (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID        NOT NULL REFERENCES screening_sessions(id) ON DELETE CASCADE,
  check_type        TEXT        NOT NULL,  -- 'right_to_rent' | 'identity_verified' | 'affordability_passed'
  result            TEXT,                  -- 'pass' | 'fail' | 'advisory'
  timestamp         TIMESTAMPTZ NOT NULL DEFAULT now(),
  certificate_url   TEXT                   -- presigned URL or Storage path of generated PDF certificate
);

COMMENT ON TABLE compliance_records IS 'Immutable log of compliance check outcomes per screening session.';

-- ── compliance_deadlines ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compliance_deadlines (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  type              TEXT        NOT NULL,  -- 'gas_safety' | 'eicr' | 'epc' | 'deposit_protection' | 'smoke_alarm' | 'co_alarm'
  due_date          DATE        NOT NULL,
  last_completed    DATE,
  certificate_url   TEXT,
  status            TEXT        NOT NULL DEFAULT 'pending',  -- 'pending' | 'overdue' | 'completed'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE compliance_deadlines IS 'Compliance certificate expiry tracking per property. CompliLet autopilot sends reminders at 90/60/30 days.';

-- ── messages ─────────────────────────────────────────────────────────────────
-- session_id and tenancy_id are intentionally untyped FKs to avoid
-- cross-constraint complexity. The application layer enforces consistency.

CREATE TABLE IF NOT EXISTS messages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID,                   -- NULL when message relates to post-screening tenancy workflow
  tenancy_id    UUID,                   -- NULL when message relates to pre-tenancy screening
  direction     TEXT        NOT NULL,  -- 'inbound' | 'outbound'
  sender_phone  TEXT,
  content       TEXT,
  media_url     TEXT,                   -- WhatsApp media URL (images, documents)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE messages IS 'All WhatsApp messages sent and received. Append-only audit log.';
COMMENT ON COLUMN messages.session_id IS 'Non-FK reference to screening_sessions. Null for tenancy messages.';
COMMENT ON COLUMN messages.tenancy_id IS 'Non-FK reference to tenancies. Null for screening messages.';

-- ── agent_logs ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_logs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID,
  tenancy_id        UUID,
  agent_type        TEXT        NOT NULL,  -- 'coordinator' | 'pre_qualifier' | 'doc_collector' | 'right_to_rent' | 'reference_chaser' | 'compliance_autopilot' | 'maintenance' | 'inspection' | 'rent_monitor' | 'renewal' | 'nrl_tax'
  input_summary     TEXT,                  -- truncated summary of agent input (for debugging)
  output_summary    TEXT,                  -- truncated summary of agent output
  tokens_used       INT,
  cost_estimate     DECIMAL(8,6),          -- estimated USD cost of this agent turn
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE agent_logs IS 'Append-only log of every agent invocation. Used for debugging, cost tracking, and audit.';

-- ── escalations ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS escalations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID,
  tenancy_id        UUID,
  trigger_type      TEXT        NOT NULL,  -- 'safeguarding' | 'legal_question' | 'suspected_fraud' | 'maintenance_emergency' | 'dispute' | 'system_error'
  priority          TEXT        NOT NULL DEFAULT 'normal',  -- 'low' | 'normal' | 'urgent' | 'critical'
  assigned_to       TEXT,                  -- CompliLet support team member email or ID
  status            TEXT        NOT NULL DEFAULT 'open',    -- 'open' | 'in_progress' | 'resolved'
  resolved_at       TIMESTAMPTZ,
  resolution_notes  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE escalations IS 'Human escalation queue. Every agent must be capable of triggering an escalation.';

-- ── maintenance_tickets ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS maintenance_tickets (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenancy_id        UUID        NOT NULL REFERENCES tenancies(id) ON DELETE CASCADE,
  description       TEXT,
  photos            JSONB,                 -- array of Storage paths or WhatsApp media URLs
  severity          TEXT,                  -- 'routine' | 'urgent' | 'emergency'
  self_fix_sent     BOOLEAN     NOT NULL DEFAULT false,  -- whether the AI sent a self-fix guide
  contractor_id     UUID        REFERENCES contractors(id),
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE maintenance_tickets IS 'Maintenance reports submitted by tenants via WhatsApp.';
COMMENT ON COLUMN maintenance_tickets.self_fix_sent IS 'For routine issues (dripping tap, blown fuse) the agent sends a self-fix guide before escalating to a contractor.';

-- ── inspections ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inspections (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenancy_id      UUID        NOT NULL REFERENCES tenancies(id) ON DELETE CASCADE,
  scheduled_date  DATE,
  photos_json     JSONB,       -- keyed array of room → [Storage path, ...]
  report_url      TEXT,        -- Storage path of compiled PDF condition report
  status          TEXT        NOT NULL DEFAULT 'scheduled',  -- 'scheduled' | 'photos_requested' | 'photos_received' | 'report_generated' | 'skipped'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE inspections IS 'Quarterly property inspection records. Photos submitted by tenant via WhatsApp.';

-- ── rent_events ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rent_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenancy_id      UUID        NOT NULL REFERENCES tenancies(id) ON DELETE CASCADE,
  month           DATE        NOT NULL,                    -- first day of the rent month (e.g. 2026-05-01)
  reminder_sent   BOOLEAN     NOT NULL DEFAULT false,
  confirmed_at    TIMESTAMPTZ,                             -- when landlord confirmed receipt
  arrears_flag    BOOLEAN     NOT NULL DEFAULT false,
  escalated_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenancy_id, month)
);

COMMENT ON TABLE rent_events IS 'One row per tenancy per calendar month. Tracks reminder, confirmation, and arrears state.';
COMMENT ON COLUMN rent_events.month IS 'Always the first day of the month. E.g. 2026-05-01 represents May 2026 rent.';

-- ── referral_transactions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS referral_transactions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   UUID        NOT NULL REFERENCES contractors(id),
  property_id     UUID        NOT NULL REFERENCES properties(id),
  job_type        TEXT,                    -- 'gas_safety' | 'eicr' | 'repair' | 'emergency_call'
  fee_amount      DECIMAL(8,2),            -- referral fee earned by CompliLet (£)
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE referral_transactions IS 'Revenue tracking for contractor referral fees earned by CompliLet.';

-- ── nrl_events ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nrl_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id   UUID        NOT NULL REFERENCES landlords(id) ON DELETE CASCADE,
  event_type    TEXT        NOT NULL,  -- 'nrl1_application_started' | 'nrl1_submitted' | 'nrl1_approved' | 'self_assessment_due' | 'self_assessment_filed' | 'mtd_quarterly_due'
  due_date      DATE,
  completed_at  TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE nrl_events IS 'HMRC NRL scheme and Making Tax Digital event log for overseas landlords.';

-- ─── 4. Indexes ─────────────────────────────────────────────────────────────

-- Screening sessions — look up by tenant phone frequently (inbound WhatsApp message routing)
CREATE INDEX IF NOT EXISTS idx_screening_sessions_tenant_phone
  ON screening_sessions (tenant_phone);

-- Screening sessions — look up open sessions by status
CREATE INDEX IF NOT EXISTS idx_screening_sessions_status
  ON screening_sessions (status)
  WHERE status NOT IN ('report_ready', 'rejected', 'abandoned');

-- Messages — primary join pattern: session_id or tenancy_id
CREATE INDEX IF NOT EXISTS idx_messages_session_id
  ON messages (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_tenancy_id
  ON messages (tenancy_id)
  WHERE tenancy_id IS NOT NULL;

-- Compliance deadlines — dashboard query: property + upcoming due dates
CREATE INDEX IF NOT EXISTS idx_compliance_deadlines_property_due
  ON compliance_deadlines (property_id, due_date);

-- Compliance deadlines — overdue sweep query
CREATE INDEX IF NOT EXISTS idx_compliance_deadlines_status_due
  ON compliance_deadlines (status, due_date)
  WHERE status IN ('pending', 'overdue');

-- Tenancies — active tenancy lookup by property
CREATE INDEX IF NOT EXISTS idx_tenancies_property_status
  ON tenancies (property_id, status);

-- Tenancies — inbound message routing (look up active tenancy by tenant phone)
CREATE INDEX IF NOT EXISTS idx_tenancies_tenant_phone
  ON tenancies (tenant_phone);

-- Properties — landlord ownership lookup
CREATE INDEX IF NOT EXISTS idx_properties_landlord_id
  ON properties (landlord_id);

-- References — open reference chasing sweep
CREATE INDEX IF NOT EXISTS idx_references_status
  ON "references" (status, last_chased_at)
  WHERE status IN ('pending', 'chasing');

-- Agent logs — cost analytics by agent type
CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_type_created
  ON agent_logs (agent_type, created_at DESC);

-- Escalations — open escalation queue
CREATE INDEX IF NOT EXISTS idx_escalations_status_priority
  ON escalations (status, priority)
  WHERE status IN ('open', 'in_progress');

-- Rent events — arrears sweep
CREATE INDEX IF NOT EXISTS idx_rent_events_arrears
  ON rent_events (tenancy_id, month)
  WHERE arrears_flag = true;

-- NRL events — upcoming tax deadlines
CREATE INDEX IF NOT EXISTS idx_nrl_events_landlord_due
  ON nrl_events (landlord_id, due_date)
  WHERE completed_at IS NULL;

-- ─── 5. Updated_at Triggers ──────────────────────────────────────────────────

CREATE TRIGGER trg_landlords_updated_at
  BEFORE UPDATE ON landlords
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tenancies_updated_at
  BEFORE UPDATE ON tenancies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_references_updated_at
  BEFORE UPDATE ON "references"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_compliance_deadlines_updated_at
  BEFORE UPDATE ON compliance_deadlines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_maintenance_tickets_updated_at
  BEFORE UPDATE ON maintenance_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_inspections_updated_at
  BEFORE UPDATE ON inspections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 6. Row Level Security ───────────────────────────────────────────────────
-- Strategy:
--   • Service role key (used by all Edge Functions) bypasses RLS automatically.
--   • Anon key and user JWTs are restricted by the policies below.
--   • Landlord identity: auth.uid() = landlords.id (auth user IS the landlord).
--   • All ownership checks traverse the FK chain back to landlords.landlord_id.
-- ============================================================================

-- Enable RLS on every table

ALTER TABLE landlords             ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractors           ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancies             ENABLE ROW LEVEL SECURITY;
ALTER TABLE screening_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "references"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_deadlines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_tickets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rent_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE nrl_events            ENABLE ROW LEVEL SECURITY;

-- ── landlords ────────────────────────────────────────────────────────────────
-- A landlord can only see and modify their own record.

CREATE POLICY "landlords_select_own"
  ON landlords FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "landlords_insert_own"
  ON landlords FOR INSERT
  WITH CHECK (id = auth.uid());

CREATE POLICY "landlords_update_own"
  ON landlords FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Deletion handled by service role only (account closure workflow).

-- ── contractors ───────────────────────────────────────────────────────────────
-- All authenticated landlords can read the contractor directory.
-- Writes are service-role only (RLS prevents user writes).

CREATE POLICY "contractors_select_authenticated"
  ON contractors FOR SELECT
  USING (auth.role() = 'authenticated');

-- ── properties ───────────────────────────────────────────────────────────────

CREATE POLICY "properties_select_owner"
  ON properties FOR SELECT
  USING (landlord_id = auth.uid());

CREATE POLICY "properties_insert_owner"
  ON properties FOR INSERT
  WITH CHECK (landlord_id = auth.uid());

CREATE POLICY "properties_update_owner"
  ON properties FOR UPDATE
  USING (landlord_id = auth.uid())
  WITH CHECK (landlord_id = auth.uid());

CREATE POLICY "properties_delete_owner"
  ON properties FOR DELETE
  USING (landlord_id = auth.uid());

-- ── tenancies ────────────────────────────────────────────────────────────────

CREATE POLICY "tenancies_select_owner"
  ON tenancies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM properties p
      WHERE p.id = tenancies.property_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "tenancies_insert_owner"
  ON tenancies FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM properties p
      WHERE p.id = tenancies.property_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "tenancies_update_owner"
  ON tenancies FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM properties p
      WHERE p.id = tenancies.property_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "tenancies_delete_owner"
  ON tenancies FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM properties p
      WHERE p.id = tenancies.property_id
        AND p.landlord_id = auth.uid()
    )
  );

-- ── screening_sessions ───────────────────────────────────────────────────────

CREATE POLICY "screening_sessions_select_owner"
  ON screening_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM properties p
      WHERE p.id = screening_sessions.property_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "screening_sessions_insert_owner"
  ON screening_sessions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM properties p
      WHERE p.id = screening_sessions.property_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "screening_sessions_update_owner"
  ON screening_sessions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM properties p
      WHERE p.id = screening_sessions.property_id
        AND p.landlord_id = auth.uid()
    )
  );

-- ── documents ────────────────────────────────────────────────────────────────

CREATE POLICY "documents_select_owner"
  ON documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM screening_sessions ss
      JOIN properties p ON p.id = ss.property_id
      WHERE ss.id = documents.session_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "documents_insert_owner"
  ON documents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM screening_sessions ss
      JOIN properties p ON p.id = ss.property_id
      WHERE ss.id = documents.session_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "documents_update_owner"
  ON documents FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM screening_sessions ss
      JOIN properties p ON p.id = ss.property_id
      WHERE ss.id = documents.session_id
        AND p.landlord_id = auth.uid()
    )
  );

-- ── "references" ─────────────────────────────────────────────────────────────

CREATE POLICY "references_select_owner"
  ON "references" FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM screening_sessions ss
      JOIN properties p ON p.id = ss.property_id
      WHERE ss.id = "references".session_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "references_insert_owner"
  ON "references" FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM screening_sessions ss
      JOIN properties p ON p.id = ss.property_id
      WHERE ss.id = "references".session_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "references_update_owner"
  ON "references" FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM screening_sessions ss
      JOIN properties p ON p.id = ss.property_id
      WHERE ss.id = "references".session_id
        AND p.landlord_id = auth.uid()
    )
  );

-- ── compliance_records ───────────────────────────────────────────────────────

CREATE POLICY "compliance_records_select_owner"
  ON compliance_records FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM screening_sessions ss
      JOIN properties p ON p.id = ss.property_id
      WHERE ss.id = compliance_records.session_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "compliance_records_insert_owner"
  ON compliance_records FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM screening_sessions ss
      JOIN properties p ON p.id = ss.property_id
      WHERE ss.id = compliance_records.session_id
        AND p.landlord_id = auth.uid()
    )
  );

-- compliance_records is an immutable audit log — no UPDATE policy.

-- ── compliance_deadlines ──────────────────────────────────────────────────────

CREATE POLICY "compliance_deadlines_select_owner"
  ON compliance_deadlines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM properties p
      WHERE p.id = compliance_deadlines.property_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "compliance_deadlines_insert_owner"
  ON compliance_deadlines FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM properties p
      WHERE p.id = compliance_deadlines.property_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "compliance_deadlines_update_owner"
  ON compliance_deadlines FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM properties p
      WHERE p.id = compliance_deadlines.property_id
        AND p.landlord_id = auth.uid()
    )
  );

-- ── messages ─────────────────────────────────────────────────────────────────
-- A message belongs to a landlord if its session_id traces to a property they
-- own, OR its tenancy_id traces to a property they own.

CREATE POLICY "messages_select_owner"
  ON messages FOR SELECT
  USING (
    (
      session_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM screening_sessions ss
        JOIN properties p ON p.id = ss.property_id
        WHERE ss.id = messages.session_id
          AND p.landlord_id = auth.uid()
      )
    )
    OR (
      tenancy_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM tenancies t
        JOIN properties p ON p.id = t.property_id
        WHERE t.id = messages.tenancy_id
          AND p.landlord_id = auth.uid()
      )
    )
  );

-- messages is an append-only log — INSERT only for authenticated users who own the context.

CREATE POLICY "messages_insert_owner"
  ON messages FOR INSERT
  WITH CHECK (
    (
      session_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM screening_sessions ss
        JOIN properties p ON p.id = ss.property_id
        WHERE ss.id = messages.session_id
          AND p.landlord_id = auth.uid()
      )
    )
    OR (
      tenancy_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM tenancies t
        JOIN properties p ON p.id = t.property_id
        WHERE t.id = messages.tenancy_id
          AND p.landlord_id = auth.uid()
      )
    )
  );

-- ── agent_logs ───────────────────────────────────────────────────────────────
-- Readable by the owning landlord; written exclusively by service role.
-- No INSERT policy — service role bypasses RLS for all writes.

CREATE POLICY "agent_logs_select_owner"
  ON agent_logs FOR SELECT
  USING (
    (
      session_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM screening_sessions ss
        JOIN properties p ON p.id = ss.property_id
        WHERE ss.id = agent_logs.session_id
          AND p.landlord_id = auth.uid()
      )
    )
    OR (
      tenancy_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM tenancies t
        JOIN properties p ON p.id = t.property_id
        WHERE t.id = agent_logs.tenancy_id
          AND p.landlord_id = auth.uid()
      )
    )
  );

-- ── escalations ───────────────────────────────────────────────────────────────

CREATE POLICY "escalations_select_owner"
  ON escalations FOR SELECT
  USING (
    (
      session_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM screening_sessions ss
        JOIN properties p ON p.id = ss.property_id
        WHERE ss.id = escalations.session_id
          AND p.landlord_id = auth.uid()
      )
    )
    OR (
      tenancy_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM tenancies t
        JOIN properties p ON p.id = t.property_id
        WHERE t.id = escalations.tenancy_id
          AND p.landlord_id = auth.uid()
      )
    )
  );

-- ── maintenance_tickets ───────────────────────────────────────────────────────

CREATE POLICY "maintenance_tickets_select_owner"
  ON maintenance_tickets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tenancies t
      JOIN properties p ON p.id = t.property_id
      WHERE t.id = maintenance_tickets.tenancy_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "maintenance_tickets_insert_owner"
  ON maintenance_tickets FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tenancies t
      JOIN properties p ON p.id = t.property_id
      WHERE t.id = maintenance_tickets.tenancy_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "maintenance_tickets_update_owner"
  ON maintenance_tickets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM tenancies t
      JOIN properties p ON p.id = t.property_id
      WHERE t.id = maintenance_tickets.tenancy_id
        AND p.landlord_id = auth.uid()
    )
  );

-- ── inspections ───────────────────────────────────────────────────────────────

CREATE POLICY "inspections_select_owner"
  ON inspections FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tenancies t
      JOIN properties p ON p.id = t.property_id
      WHERE t.id = inspections.tenancy_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "inspections_insert_owner"
  ON inspections FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tenancies t
      JOIN properties p ON p.id = t.property_id
      WHERE t.id = inspections.tenancy_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "inspections_update_owner"
  ON inspections FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM tenancies t
      JOIN properties p ON p.id = t.property_id
      WHERE t.id = inspections.tenancy_id
        AND p.landlord_id = auth.uid()
    )
  );

-- ── rent_events ───────────────────────────────────────────────────────────────

CREATE POLICY "rent_events_select_owner"
  ON rent_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tenancies t
      JOIN properties p ON p.id = t.property_id
      WHERE t.id = rent_events.tenancy_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "rent_events_insert_owner"
  ON rent_events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tenancies t
      JOIN properties p ON p.id = t.property_id
      WHERE t.id = rent_events.tenancy_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "rent_events_update_owner"
  ON rent_events FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM tenancies t
      JOIN properties p ON p.id = t.property_id
      WHERE t.id = rent_events.tenancy_id
        AND p.landlord_id = auth.uid()
    )
  );

-- ── referral_transactions ─────────────────────────────────────────────────────
-- Landlord can see transactions for their properties (for transparency).
-- Writes are service-role only.

CREATE POLICY "referral_transactions_select_owner"
  ON referral_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM properties p
      WHERE p.id = referral_transactions.property_id
        AND p.landlord_id = auth.uid()
    )
  );

-- ── nrl_events ────────────────────────────────────────────────────────────────

CREATE POLICY "nrl_events_select_owner"
  ON nrl_events FOR SELECT
  USING (landlord_id = auth.uid());

CREATE POLICY "nrl_events_insert_owner"
  ON nrl_events FOR INSERT
  WITH CHECK (landlord_id = auth.uid());

-- nrl_events updates (marking completed) done by service role only.

-- ============================================================================
-- Schema complete.
-- Apply with: supabase db push  (remote)
--             supabase migration up  (local dev)
-- ============================================================================
