-- ─────────────────────────────────────────────────────────────────────────────
-- CompliLet — Tenancy Agreement & SignWell Migration
-- 20260413000002_tenancy_agreement_signwell.sql
--
-- Adds columns to support:
--   • Tenancy agreement PDF storage (signed and unsigned)
--   • SignWell document tracking
--   • tenancy_agreement_state conversation step in coordinator_state
--   • Landlord contact info on tenancies (needed for agreement PDF)
--
-- ALL CHANGES ARE ADDITIVE — no existing columns are modified or dropped.
-- Safe to run against a live database.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. tenancies table additions ─────────────────────────────────────────────

ALTER TABLE tenancies
  ADD COLUMN IF NOT EXISTS agreement_url            TEXT,
  ADD COLUMN IF NOT EXISTS agreement_signed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signwell_document_id     TEXT,
  ADD COLUMN IF NOT EXISTS landlord_name            TEXT,
  ADD COLUMN IF NOT EXISTS landlord_address         TEXT;

-- Index for webhook lookups by SignWell document ID (hot path)
CREATE INDEX IF NOT EXISTS idx_tenancies_signwell_document_id
  ON tenancies (signwell_document_id)
  WHERE signwell_document_id IS NOT NULL;

-- ── 2. coordinator_state — tenancy agreement conversation step ───────────────

ALTER TABLE coordinator_state
  ADD COLUMN IF NOT EXISTS tenancy_agreement_state  JSONB DEFAULT '{"step": "idle"}'::jsonb;

-- ── 3. documents table — allow tenancy_agreement type ───────────────────────
-- The documents table uses a free-text "type" column (TEXT), so no ENUM
-- migration is needed. The signwell-callback function stores the signed PDF
-- in Supabase Storage and links it via tenancies.agreement_url.
-- No schema change required for documents.

-- ── 4. Helpful comment on new columns ───────────────────────────────────────
COMMENT ON COLUMN tenancies.agreement_url IS
  'Supabase Storage signed URL for the fully executed tenancy agreement PDF.
   Populated by signwell-callback Edge Function on document.completed event.';

COMMENT ON COLUMN tenancies.agreement_signed_at IS
  'ISO timestamp when both parties completed signing via SignWell.';

COMMENT ON COLUMN tenancies.signwell_document_id IS
  'SignWell document UUID. Used by signwell-callback to look up the tenancy row.';

COMMENT ON COLUMN tenancies.landlord_name IS
  'Landlord full name at time of tenancy creation — denormalised for PDF generation.';

COMMENT ON COLUMN tenancies.landlord_address IS
  'Landlord correspondence address — denormalised for tenancy agreement PDF.';

COMMENT ON COLUMN coordinator_state.tenancy_agreement_state IS
  'JSONB state for the multi-turn tenancy agreement generation conversation.
   Shape: { step, tenancy_id, landlord_name, landlord_email, tenant_name,
            tenant_email, property_address, monthly_rent_gbp, deposit_gbp,
            start_date, special_terms }.
   step values: idle | awaiting_confirmation | awaiting_landlord_email |
                awaiting_tenant_email | awaiting_special_terms';
