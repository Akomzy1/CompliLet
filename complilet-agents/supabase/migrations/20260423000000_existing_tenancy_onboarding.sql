-- ─── Existing Tenancy Onboarding ─────────────────────────────────────────────
-- Adds support for onboarding tenancies that are already active (rather than
-- starting a new screening from scratch). Landlords can either screen a new
-- tenant, onboard an existing one, or register an empty property.
--
-- Related agent: _shared/agents/existing-tenancy-onboarding.ts
-- Related coordinator flow: entry menu (awaiting: "entry_menu_choice")

-- ─── 1. tenancies: flag onboarding source + tenant confirmation ──────────────

ALTER TABLE tenancies
  ADD COLUMN IF NOT EXISTS onboarding_type TEXT
    NOT NULL DEFAULT 'new_screening'
    CHECK (onboarding_type IN ('new_screening', 'existing'));

ALTER TABLE tenancies
  ADD COLUMN IF NOT EXISTS tenant_confirmed_at TIMESTAMPTZ;

ALTER TABLE tenancies
  ADD COLUMN IF NOT EXISTS deposit_amount DECIMAL(10, 2);

ALTER TABLE tenancies
  ADD COLUMN IF NOT EXISTS deposit_scheme TEXT
    CHECK (deposit_scheme IS NULL OR deposit_scheme IN ('tds', 'dps', 'mydeposits', 'unprotected'));

ALTER TABLE tenancies
  ADD COLUMN IF NOT EXISTS deposit_reference TEXT;

ALTER TABLE tenancies
  ADD COLUMN IF NOT EXISTS agreement_url TEXT;

-- Tenant may reply with corrections during confirmation — stored here so the
-- coordinator can pick the thread up on the next inbound message.
ALTER TABLE tenancies
  ADD COLUMN IF NOT EXISTS tenant_confirmation_state JSONB;

CREATE INDEX IF NOT EXISTS idx_tenancies_onboarding_type
  ON tenancies (onboarding_type);

CREATE INDEX IF NOT EXISTS idx_tenancies_tenant_confirmed_at
  ON tenancies (tenant_confirmed_at)
  WHERE tenant_confirmed_at IS NULL;

-- ─── 2. compliance_alerts: gaps flagged during onboarding ────────────────────

CREATE TABLE IF NOT EXISTS compliance_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenancy_id   UUID REFERENCES tenancies(id) ON DELETE CASCADE,
  property_id  UUID REFERENCES properties(id) ON DELETE CASCADE,
  landlord_id  UUID REFERENCES landlords(id) ON DELETE CASCADE,
  alert_type   TEXT NOT NULL,
  severity     TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description  TEXT NOT NULL,
  resolved     BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_alerts_tenancy_id
  ON compliance_alerts (tenancy_id)
  WHERE resolved = FALSE;

CREATE INDEX IF NOT EXISTS idx_compliance_alerts_landlord_id
  ON compliance_alerts (landlord_id)
  WHERE resolved = FALSE;

CREATE INDEX IF NOT EXISTS idx_compliance_alerts_alert_type
  ON compliance_alerts (alert_type)
  WHERE resolved = FALSE;

-- ─── 3. coordinator_state: JSONB column for the multi-turn flow ──────────────

ALTER TABLE coordinator_state
  ADD COLUMN IF NOT EXISTS existing_tenancy_state JSONB;
