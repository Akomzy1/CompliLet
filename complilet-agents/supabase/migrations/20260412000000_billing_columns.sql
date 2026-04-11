-- ============================================================================
-- CompliLet — Billing columns migration
-- Migration: 20260412000000_billing_columns.sql
--
-- Adds Stripe billing fields required by _shared/billing.ts and
-- coordinator_state fields required by the payment gate.
-- ============================================================================

-- ── 1. landlords: billing columns ─────────────────────────────────────────────

-- plan now uses the full set of CompliLet tiers (was 'free' default)
ALTER TABLE landlords
  ALTER COLUMN plan SET DEFAULT 'free_trial';

UPDATE landlords SET plan = 'free_trial' WHERE plan = 'free';

-- Stripe subscription ID — set after a successful subscription checkout
ALTER TABLE landlords
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

COMMENT ON COLUMN landlords.stripe_subscription_id IS
  'Stripe subscription object ID (sub_...). Null for free_trial and pay_per_screen landlords.';

COMMENT ON COLUMN landlords.stripe_customer_id IS
  'Stripe customer object ID (cus_...). Created on first checkout, persisted here.';

-- ── 2. coordinator_state: payment gate columns ────────────────────────────────

-- One-time payment credits for pay_per_screen (int, never negative)
ALTER TABLE coordinator_state
  ADD COLUMN IF NOT EXISTS payment_credits INT NOT NULL DEFAULT 0
    CONSTRAINT payment_credits_non_negative CHECK (payment_credits >= 0);

COMMENT ON COLUMN coordinator_state.payment_credits IS
  'Number of pre-paid pay-per-screen credits available. Incremented by Stripe webhook, decremented on screening start.';

-- ID of the Checkout session currently awaiting payment (cleared after webhook confirms)
ALTER TABLE coordinator_state
  ADD COLUMN IF NOT EXISTS pending_checkout_id TEXT;

COMMENT ON COLUMN coordinator_state.pending_checkout_id IS
  'Stripe Checkout session ID (cs_...) awaiting completion. Cleared by stripe-webhook after checkout.session.completed.';

-- ── 3. Helper RPCs used by billing.ts ────────────────────────────────────────

-- increment_payment_credits: safely adds one credit (called after pay_per_screen checkout)
CREATE OR REPLACE FUNCTION increment_payment_credits(p_landlord_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO coordinator_state (landlord_id, payment_credits, updated_at)
  VALUES (p_landlord_id, 1, now())
  ON CONFLICT (landlord_id)
  DO UPDATE SET
    payment_credits = coordinator_state.payment_credits + 1,
    updated_at = now();
END;
$$;

COMMENT ON FUNCTION increment_payment_credits IS
  'Atomically adds one pay-per-screen credit to coordinator_state. Called by Stripe webhook after checkout.session.completed.';

-- decrement_payment_credits: safely consumes one credit (called when screening starts)
CREATE OR REPLACE FUNCTION decrement_payment_credits(p_landlord_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE coordinator_state
  SET
    payment_credits = GREATEST(0, payment_credits - 1),
    updated_at = now()
  WHERE landlord_id = p_landlord_id;
END;
$$;

COMMENT ON FUNCTION decrement_payment_credits IS
  'Atomically consumes one pay-per-screen credit. GREATEST(0, ...) prevents negative values.';

-- ── 4. coordinator_state: ensure active_escalation_id column exists ───────────
-- Added by escalation system; safe to re-run (IF NOT EXISTS)

ALTER TABLE coordinator_state
  ADD COLUMN IF NOT EXISTS active_escalation_id UUID
    REFERENCES escalations(id) ON DELETE SET NULL;

COMMENT ON COLUMN coordinator_state.active_escalation_id IS
  'If set, the session is halted pending human resolution of this escalation.';

-- ── 5. nrl_events: ensure table exists ───────────────────────────────────────
-- Created here if not already present from a previous migration run.

CREATE TABLE IF NOT EXISTS nrl_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id  UUID        NOT NULL REFERENCES landlords(id) ON DELETE CASCADE,
  event_type   TEXT        NOT NULL,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nrl_events_landlord_type_idx
  ON nrl_events (landlord_id, event_type);

COMMENT ON TABLE nrl_events IS
  'Deduplication log for NRL (Non-Resident Landlord) agent events and cron reminders.';

-- ── 6. escalations table ─────────────────────────────────────────────────────
-- Created here if not already present.

CREATE TABLE IF NOT EXISTS escalations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           UUID,
  tenancy_id           UUID,
  landlord_id          UUID        REFERENCES landlords(id) ON DELETE SET NULL,
  sender_phone         TEXT        NOT NULL,
  trigger_type         TEXT        NOT NULL,
  priority             TEXT        NOT NULL DEFAULT 'normal',
  status               TEXT        NOT NULL DEFAULT 'open',
  context              TEXT,
  message_text         TEXT,
  handler_notified     BOOLEAN     NOT NULL DEFAULT false,
  handler_notified_at  TIMESTAMPTZ,
  resolution           TEXT,
  resolved_by          TEXT,
  resolved_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS escalations_status_priority_idx
  ON escalations (status, priority, created_at);

CREATE INDEX IF NOT EXISTS escalations_session_idx
  ON escalations (session_id) WHERE session_id IS NOT NULL;

COMMENT ON TABLE escalations IS
  'Human escalation queue. Records every trigger that required human intervention.';
