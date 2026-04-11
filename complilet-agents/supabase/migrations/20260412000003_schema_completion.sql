-- =============================================================================
-- CompliLet — Schema Completion
-- Migration: 20260412000003_schema_completion.sql
--
-- Fills gaps between initial_schema (20260411000000) and subsequent migrations.
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS / OR REPLACE.
--
-- Changes:
--   1. coordinator_state table (referenced by ALTER in billing migration but
--      never explicitly created — this creates it with the full column set so
--      that billing migration's ADD COLUMN IF NOT EXISTS statements are no-ops)
--   2. admin_users table (entirely absent from all prior migrations)
--   3. messages: add delivery_status + whatsapp_message_id columns
--   4. agent_logs: add error_message column
--   5. tenancies: add rent_status column
--   6. screening_sessions: add denormalised landlord_id column + backfill
--   7. RLS policies for coordinator_state and admin_users
--   8. updated_at trigger for coordinator_state and admin_users
--   9. Additional indexes for new columns
-- =============================================================================

-- ─── 1. coordinator_state ────────────────────────────────────────────────────
-- One row per landlord. Persists inter-turn agent context and payment gate state.
-- The billing migration (20260412000000) adds payment_credits, pending_checkout_id,
-- and active_escalation_id via ADD COLUMN IF NOT EXISTS — those are already
-- included here so the billing ALTER statements become safe no-ops.

CREATE TABLE IF NOT EXISTS coordinator_state (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id           UUID        NOT NULL UNIQUE REFERENCES landlords(id) ON DELETE CASCADE,

  -- Current agent flow state
  current_flow          TEXT,        -- e.g. 'screening' | 'maintenance' | 'rent_reminder' | null
  flow_step             TEXT,        -- step within the current flow (agent-defined string)
  collected_data        JSONB        NOT NULL DEFAULT '{}',   -- data gathered during current interaction
  conversation_history  JSONB        NOT NULL DEFAULT '[]',   -- recent turns kept for LLM context

  -- Payment gate (managed by billing.ts + stripe-webhook)
  payment_credits       INT          NOT NULL DEFAULT 0
                          CONSTRAINT payment_credits_non_negative CHECK (payment_credits >= 0),
  pending_checkout_id   TEXT,        -- Stripe cs_... awaiting checkout.session.completed

  -- Escalation gate (set by escalation.ts, cleared on resolution)
  active_escalation_id  UUID         REFERENCES escalations(id) ON DELETE SET NULL,

  -- Timestamps
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE coordinator_state IS
  'One row per landlord. Stores inter-turn agent conversation state, payment credits, and escalation gates.';
COMMENT ON COLUMN coordinator_state.current_flow IS
  'Which agent flow is active (screening, maintenance, rent_reminder, etc). NULL when idle.';
COMMENT ON COLUMN coordinator_state.payment_credits IS
  'Pre-paid pay-per-screen credits. Incremented by Stripe webhook, decremented on screening start.';
COMMENT ON COLUMN coordinator_state.active_escalation_id IS
  'If set, the session is halted pending human resolution of this escalation.';

CREATE UNIQUE INDEX IF NOT EXISTS coordinator_state_landlord_id_uidx
  ON coordinator_state (landlord_id);

-- ─── 2. admin_users ──────────────────────────────────────────────────────────
-- Tracks CompliLet staff members who have admin dashboard access.
-- Auth is handled by Supabase Auth + email allowlist in middleware —
-- this table is for auditing and role management only.

CREATE TABLE IF NOT EXISTS admin_users (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        NOT NULL UNIQUE,
  name        TEXT,
  role        TEXT        NOT NULL DEFAULT 'admin',  -- 'admin' | 'super_admin'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE admin_users IS
  'CompliLet internal admin user registry. Authentication is via Supabase Auth + email allowlist.';
COMMENT ON COLUMN admin_users.role IS
  'admin: standard dashboard access. super_admin: can manage other admins and access sensitive operations.';

-- ─── 3. messages: delivery tracking columns ───────────────────────────────────
-- WhatsApp delivery receipts are sent to the webhook as status callbacks.
-- delivery_status tracks the current known state of each outbound message.
-- whatsapp_message_id is the wamid returned by Meta Graph API — used to match
-- incoming status callbacks to the right row.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS delivery_status    TEXT;         -- 'sent' | 'delivered' | 'read' | 'failed' | null
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS whatsapp_message_id TEXT;        -- Meta wamid (e.g. wamid.Abcd...)

COMMENT ON COLUMN messages.delivery_status IS
  'WhatsApp delivery receipt state: sent → delivered → read, or failed. Updated by incoming status webhooks.';
COMMENT ON COLUMN messages.whatsapp_message_id IS
  'Meta Graph API message ID (wamid...). Used to match delivery status callbacks to outbound messages.';

-- Index for status webhook lookups by wamid
CREATE INDEX IF NOT EXISTS idx_messages_whatsapp_message_id
  ON messages (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

-- ─── 4. agent_logs: error tracking ───────────────────────────────────────────
-- When an agent turn throws an exception, store the error message here.
-- Allows the admin System Health page to surface recent agent failures
-- without having to parse raw logs.

ALTER TABLE agent_logs
  ADD COLUMN IF NOT EXISTS error_message TEXT;              -- exception message, null on success

COMMENT ON COLUMN agent_logs.error_message IS
  'Exception message if this agent turn failed. NULL for successful turns.';

-- Index for error queries (admin system health)
CREATE INDEX IF NOT EXISTS idx_agent_logs_errors
  ON agent_logs (created_at DESC)
  WHERE error_message IS NOT NULL;

-- ─── 5. tenancies: rent status ────────────────────────────────────────────────
-- Per-tenancy rent health flag. Updated by the rent monitor cron and
-- by landlord confirmations via WhatsApp. Used for admin dashboard
-- arrears count and tenant traffic-light colouring.

ALTER TABLE tenancies
  ADD COLUMN IF NOT EXISTS rent_status TEXT NOT NULL DEFAULT 'current';
  -- 'current' | 'overdue' | 'arrears' | 'partial' | 'query'

COMMENT ON COLUMN tenancies.rent_status IS
  'Current rent collection state. Updated by rent-monitor-cron and landlord confirmations.';

-- Index for arrears reporting
CREATE INDEX IF NOT EXISTS idx_tenancies_rent_status
  ON tenancies (rent_status)
  WHERE rent_status != 'current';

-- ─── 6. screening_sessions: denormalised landlord_id ─────────────────────────
-- Avoids a JOIN through properties on every inbound WhatsApp message route.
-- The canonical landlord for a session is still properties.landlord_id —
-- this column mirrors it for performance.

ALTER TABLE screening_sessions
  ADD COLUMN IF NOT EXISTS landlord_id UUID REFERENCES landlords(id) ON DELETE SET NULL;

COMMENT ON COLUMN screening_sessions.landlord_id IS
  'Denormalised from properties.landlord_id for faster inbound message routing. Must be kept in sync.';

-- Backfill for any existing rows (safe: no-op if already populated)
UPDATE screening_sessions ss
SET    landlord_id = p.landlord_id
FROM   properties p
WHERE  p.id = ss.property_id
  AND  ss.landlord_id IS NULL;

-- Index for landlord → sessions lookup (admin panel, message routing)
CREATE INDEX IF NOT EXISTS idx_screening_sessions_landlord_id
  ON screening_sessions (landlord_id)
  WHERE landlord_id IS NOT NULL;

-- ─── 7. RLS — enable + policies ──────────────────────────────────────────────

ALTER TABLE coordinator_state  ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users        ENABLE ROW LEVEL SECURITY;

-- coordinator_state: landlord can read/write their own row only.
-- Service role (all Edge Functions) bypasses RLS automatically.

CREATE POLICY "coordinator_state_select_own"
  ON coordinator_state FOR SELECT
  USING (landlord_id = auth.uid());

CREATE POLICY "coordinator_state_insert_own"
  ON coordinator_state FOR INSERT
  WITH CHECK (landlord_id = auth.uid());

CREATE POLICY "coordinator_state_update_own"
  ON coordinator_state FOR UPDATE
  USING (landlord_id = auth.uid())
  WITH CHECK (landlord_id = auth.uid());

-- admin_users: no user-facing policies.
-- The admin dashboard connects via service role key — RLS is bypassed.
-- Anon and user JWTs cannot access this table.

-- ─── 8. updated_at triggers ──────────────────────────────────────────────────

CREATE TRIGGER trg_coordinator_state_updated_at
  BEFORE UPDATE ON coordinator_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_admin_users_updated_at
  BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 9. Seed: initial admin user (placeholder — update with real details) ────
-- Uncomment and customise before applying to production.
-- INSERT INTO admin_users (email, name, role)
-- VALUES ('admin@complilet.co.uk', 'CompliLet Admin', 'super_admin')
-- ON CONFLICT (email) DO NOTHING;

-- =============================================================================
-- Migration complete.
-- Apply with: supabase db push              (remote, requires project linking)
--             supabase migration up         (local dev)
-- =============================================================================
