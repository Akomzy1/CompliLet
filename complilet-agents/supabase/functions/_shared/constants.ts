/**
 * Shared constants for CompliLet Edge Functions.
 *
 * Conventions:
 * - `as const` objects instead of TypeScript enums — tree-shakeable and
 *   serialisable to JSON without a compile step.
 * - All regex patterns are compiled once at module load, not per-message.
 * - Right to Rent document lists match the Home Office Landlords' Code of
 *   Practice (updated February 2024).
 */

import type {
  AgentType,
  ComplianceType,
  EscalationTrigger,
  MaintenanceCategory,
  SessionStatus,
} from "./types.ts";

// ─── Meta / WhatsApp API ──────────────────────────────────────────────────────

export const WHATSAPP_API_VERSION = "v20.0" as const;
export const WHATSAPP_API_BASE = `https://graph.facebook.com/${WHATSAPP_API_VERSION}` as const;

/** WhatsApp caps outbound text messages at 4,096 characters */
export const WHATSAPP_MAX_TEXT_LENGTH = 4_096 as const;

/** Maximum media sizes enforced by Meta (bytes) */
export const WHATSAPP_MAX_MEDIA_SIZE = {
  image: 5 * 1024 * 1024,      //  5 MB
  document: 100 * 1024 * 1024, // 100 MB
  audio: 16 * 1024 * 1024,     // 16 MB
  video: 16 * 1024 * 1024,     // 16 MB
} as const;

/** MIME types CompliLet accepts for document uploads */
export const ACCEPTED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

// ─── Agent Types ───────────────────────────────────────────────────────────────

/**
 * Mirrors the agent_type ENUM in the database.
 * Use AGENT_TYPE.SCREENER rather than the raw string to catch typos at compile time.
 */
export const AGENT_TYPE = {
  COORDINATOR: "coordinator",
  SCREENER: "screener",
  COMPLIANCE: "compliance",
  MAINTENANCE: "maintenance",
  INSPECTION: "inspection",
  RENT_COLLECTION: "rent_collection",
  TENANCY_CHECK_IN: "tenancy_check_in",
  RENT_REVIEW: "rent_review",
} as const satisfies Record<string, AgentType>;

// ─── Session Status ────────────────────────────────────────────────────────────

/**
 * Mirrors the session_status ENUM in the database.
 * All valid session statuses — each agent only touches its own slice.
 */
export const SESSION_STATUS = {
  PRE_QUALIFYING: "pre_qualifying",
  COLLECTING_DOCS: "collecting_docs",
  RIGHT_TO_RENT: "right_to_rent",
  CHASING_REFS: "chasing_refs",
  DECISION: "decision",
  MOVE_IN_PACK: "move_in_pack",
  ACTIVE_TENANCY: "active_tenancy",
  ABANDONED: "abandoned",
  REJECTED: "rejected",
} as const satisfies Record<string, SessionStatus>;

/**
 * Valid state machine transitions.
 * The coordinator enforces this — no other transition is permitted.
 * "abandoned" and "rejected" are terminal states with no outbound transitions.
 *
 * Flow: pre_qualifying → collecting_docs → right_to_rent → chasing_refs
 *       → decision → move_in_pack → active_tenancy
 *
 * Under the Renters' Rights Act 2025, all tenancies are periodic and continue
 * indefinitely as active_tenancy. There is no "renewal" status.
 * When a tenant vacates (2-month notice), the session transitions to "abandoned".
 *
 * Any state can transition to "abandoned" (tenant stops responding or vacates)
 * or "rejected" (landlord declines / hard fail).
 */
export const SESSION_STATUS_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  pre_qualifying:  ["collecting_docs", "abandoned", "rejected"],
  collecting_docs: ["right_to_rent", "abandoned", "rejected"],
  right_to_rent:   ["chasing_refs", "abandoned", "rejected"],
  chasing_refs:    ["decision", "abandoned", "rejected"],
  decision:        ["move_in_pack", "rejected"],
  move_in_pack:    ["active_tenancy", "abandoned"],
  active_tenancy:  ["abandoned"],
  abandoned:       [],
  rejected:        [],
};

/** Human-readable labels for each session status — used in reports and logs */
export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  pre_qualifying:  "Pre-Qualifying",
  collecting_docs: "Collecting Documents",
  right_to_rent:   "Right to Rent Check",
  chasing_refs:    "Chasing References",
  decision:        "Awaiting Decision",
  move_in_pack:    "Move-In Pack",
  active_tenancy:  "Active Tenancy",
  abandoned:       "Abandoned",
  rejected:        "Rejected",
};

// ─── Escalation Trigger Patterns ──────────────────────────────────────────────

/**
 * Regex patterns matched against raw message text by the coordinator.
 * A match triggers an EscalationRequest to a human agent before any AI reply.
 *
 * Each entry is: [pattern, trigger, urgency]
 * Patterns are case-insensitive by default.
 *
 * IMPORTANT: These are defence-in-depth signals, not the only escalation path.
 * The screener and other agents can also trigger escalations programmatically.
 */
export const ESCALATION_TRIGGER_PATTERNS: Array<{
  pattern: RegExp;
  trigger: EscalationTrigger;
  urgency: "immediate" | "within_2hrs" | "same_day";
  reason: string;
}> = [
  // ── Safeguarding ──
  {
    pattern: /domestic\s+(?:violence|abuse|assault)/i,
    trigger: "safeguarding_concern",
    urgency: "immediate",
    reason: "Domestic violence or abuse mentioned",
  },
  {
    pattern: /\b(?:fleeing|flee(?:ing)?|running\s+from|escape\s+from|unsafe\s+(?:at\s+)?home)\b/i,
    trigger: "safeguarding_concern",
    urgency: "immediate",
    reason: "Tenant may be fleeing an unsafe situation",
  },
  {
    pattern: /\b(?:threatened?|threatened\s+me|threatening\s+me|in\s+danger)\b/i,
    trigger: "safeguarding_concern",
    urgency: "immediate",
    reason: "Threat to personal safety indicated",
  },

  // ── Mental health crisis ──
  {
    pattern: /\b(?:self[- ]harm(?:ing)?|hurt(?:ing)?\s+myself)\b/i,
    trigger: "mental_health_crisis",
    urgency: "immediate",
    reason: "Self-harm reference detected",
  },
  {
    pattern: /\b(?:suicid(?:al|e|ing)|end(?:ing)?\s+my\s+life|want\s+to\s+die)\b/i,
    trigger: "mental_health_crisis",
    urgency: "immediate",
    reason: "Suicidal ideation reference detected",
  },
  {
    pattern: /\bmental\s+health\s+crisis\b/i,
    trigger: "mental_health_crisis",
    urgency: "immediate",
    reason: "Explicit mental health crisis mention",
  },

  // ── Legal threats ──
  {
    pattern: /\b(?:solicit(?:or|ors?)|my\s+lawy?er|legal\s+(?:action|proceedings?|advice))\b/i,
    trigger: "legal_threat",
    urgency: "within_2hrs",
    reason: "Legal representation or action mentioned",
  },
  {
    pattern: /\b(?:county\s+court|small\s+claims|CCJ|court\s+order|court\s+hearing|tribunal)\b/i,
    trigger: "legal_threat",
    urgency: "within_2hrs",
    reason: "Court proceedings mentioned",
  },
  {
    pattern: /\b(?:ombudsman|property\s+redress|NRLA|landlord\s+licensing)\b/i,
    trigger: "legal_threat",
    urgency: "within_2hrs",
    reason: "Regulatory body or redress scheme mentioned",
  },
  {
    pattern: /\b(?:sue\s+(?:you|the\s+landlord)|take\s+(?:you|this)\s+to\s+court)\b/i,
    trigger: "legal_threat",
    urgency: "within_2hrs",
    reason: "Explicit threat to take legal action",
  },

  // ── Immigration enforcement ──
  {
    pattern: /\b(?:immigration\s+enforcement|Home\s+Office\s+(?:letter|action|raid)|deportation\s+order)\b/i,
    trigger: "immigration_enforcement",
    urgency: "immediate",
    reason: "Immigration enforcement action mentioned",
  },
  {
    pattern: /\b(?:removal\s+order|removal\s+directions?|Section\s+10\s+notice)\b/i,
    trigger: "immigration_enforcement",
    urgency: "immediate",
    reason: "Immigration removal proceedings mentioned",
  },

  // ── Fraud indicators ──
  {
    pattern: /\b(?:borrowed|friend(?:'?s)?|not\s+(?:really\s+)?mine|using\s+(?:someone|somebody)\s+else'?s?)\s+(?:ID|passport|documents?|payslip|bank\s+statement)\b/i,
    trigger: "fraud_indicator",
    urgency: "within_2hrs",
    reason: "Possible use of borrowed or fraudulent documents",
  },
  {
    pattern: /\b(?:fake|forged?|altered?|photoshopped?|edited)\s+(?:ID|passport|document|payslip)\b/i,
    trigger: "fraud_indicator",
    urgency: "within_2hrs",
    reason: "Possible document fraud explicitly mentioned",
  },
  {
    pattern: /\b(?:I\s+don'?t\s+have|haven'?t\s+got|no|without)\s+(?:any\s+)?(?:ID|passport|documents?|papers|payslip)\b/i,
    trigger: "fraud_indicator",
    urgency: "same_day",
    reason: "Tenant indicates they cannot provide required documents",
  },

  // ── Explicit human request ──
  {
    pattern: /\b(?:speak|talk|chat)\s+(?:to\s+)?(?:a\s+)?(?:real\s+)?(?:human|person|agent|manager|someone|somebody)\b/i,
    trigger: "explicit_human_request",
    urgency: "within_2hrs",
    reason: "User explicitly requested a human agent",
  },
  {
    pattern: /\b(?:not\s+(?:a\s+)?bot|stop\s+the\s+bot|automated?|AI|robot|machine)\b/i,
    trigger: "explicit_human_request",
    urgency: "within_2hrs",
    reason: "User expressing frustration with AI interaction",
  },

  // ── Formal complaint ──
  {
    pattern: /\b(?:formal\s+complaint|complain(?:ing|ed)?\s+(?:about|to|formally))\b/i,
    trigger: "complaint",
    urgency: "within_2hrs",
    reason: "Formal complaint indicated",
  },
  {
    pattern: /\b(?:this\s+is\s+unacceptable|disgraceful|report\s+(?:you|this)|data\s+protection\s+breach|ICO)\b/i,
    trigger: "complaint",
    urgency: "within_2hrs",
    reason: "Serious dissatisfaction or regulatory complaint indicated",
  },
];

// ─── Right to Rent Documents ───────────────────────────────────────────────────

/**
 * Home Office Right to Rent document lists.
 * Source: Landlords' Guide to Right to Rent (updated February 2024).
 *
 * LIST_A tenants: no follow-up check ever required.
 * LIST_B tenants: follow-up check required before document expiry date.
 */
export const RIGHT_TO_RENT_DOCUMENTS = {
  /**
   * List A – Group 1: Single document acceptable.
   * Confirms an UNLIMITED right to rent in England.
   */
  LIST_A_GROUP_1: [
    {
      id: "uk_passport",
      label: "UK passport (current or expired)",
      notes: "Including British Nationals (Overseas) passport",
    },
    {
      id: "irish_passport",
      label: "Irish passport or Irish passport card (current or expired)",
      notes: "Republic of Ireland only — not Northern Irish documents",
    },
    {
      id: "naturalisation_cert",
      label: "Certificate of registration or naturalisation as a British citizen",
      notes: "Issued by the Home Office",
    },
  ],

  /**
   * List A – Group 2: Two-document combination required (Part A + Part B).
   * Confirms an UNLIMITED right to rent in England.
   * Part A must be accompanied by Part B.
   */
  LIST_A_GROUP_2_PART_A: [
    {
      id: "uk_birth_cert",
      label: "UK full birth certificate (issued in the UK by a registrar)",
      notes: "Must include name of at least one parent",
    },
    {
      id: "uk_adoption_cert",
      label: "UK adoption certificate",
      notes: "Issued in the United Kingdom",
    },
    {
      id: "hmpo_letter",
      label: "Letter from HM Passport Office confirming right to a UK passport",
      notes: "Must be an original letter",
    },
  ],

  /**
   * Part B: National Insurance number evidence — must be combined with a Part A document.
   */
  LIST_A_GROUP_2_PART_B: [
    {
      id: "ni_hmrc_letter",
      label: "Letter from HMRC confirming National Insurance number",
      notes: null,
    },
    {
      id: "ni_dwp_letter",
      label: "Letter from DWP confirming National Insurance number",
      notes: null,
    },
    {
      id: "ni_payslip",
      label: "Recent payslip showing National Insurance number",
      notes: "Must clearly show the NI number",
    },
    {
      id: "ni_p45",
      label: "P45 or P60 showing National Insurance number",
      notes: null,
    },
  ],

  /**
   * List A – EU Settlement Scheme: Settled Status only.
   * Check using the online share code service at gov.uk/landlords-immigration-check.
   * Confirmed Settled Status = unlimited right — no follow-up needed.
   */
  LIST_A_EUSS: [
    {
      id: "euss_settled",
      label: "EU Settlement Scheme — Settled Status",
      notes: "Check using tenant's share code at gov.uk/landlords-immigration-check. Do NOT accept EU passport alone.",
    },
  ],

  /**
   * List B: TIME-LIMITED right to rent.
   * A follow-up check MUST be conducted before the document's expiry date.
   * CompliLet sets a calendar reminder 2 months before expiry.
   */
  LIST_B: [
    {
      id: "brp_limited",
      label: "Biometric Residence Permit (BRP) with limited leave to remain or enter",
      notes: "Follow-up before expiry date on card",
    },
    {
      id: "visa_in_passport",
      label: "Current valid visa in a current non-UK / non-Irish passport",
      notes: "Follow-up before visa expiry date",
    },
    {
      id: "euss_pre_settled",
      label: "EU Settlement Scheme — Pre-Settled Status",
      notes: "Check via share code. Follow-up before Pre-Settled Status expires",
    },
    {
      id: "euss_cert_application",
      label: "Certificate of Application to the EU Settlement Scheme",
      notes: "Follow-up within 6 months or on Home Office notification",
    },
    {
      id: "outstanding_application",
      label: "Home Office letter confirming outstanding leave to remain application or appeal",
      notes: "Follow-up within 6 months or on resolution",
    },
    {
      id: "arc",
      label: "Application Registration Card (ARC)",
      notes: "Follow-up within 6 months or on resolution",
    },
    {
      id: "positive_verification_notice",
      label: "Positive Verification Notice from the Employer Checking Service",
      notes: "Contact Employer Checking Service for follow-up",
    },
    {
      id: "frontier_worker_permit",
      label: "Frontier Worker Permit",
      notes: "Check via gov.uk/landlords-immigration-check share code",
    },
  ],
} as const;

/**
 * Share-code based document types — these are checked via the online tool,
 * not by visual document inspection.
 */
export const SHARE_CODE_DOCUMENT_IDS: ReadonlySet<string> = new Set([
  "euss_settled",
  "euss_pre_settled",
  "euss_cert_application",
  "outstanding_application",
  "positive_verification_notice",
  "frontier_worker_permit",
]);

// ─── Compliance ────────────────────────────────────────────────────────────────

/**
 * Days before expiry when CompliLet sends reminder messages.
 * Three-stage reminder cadence: advance warning → urgent → critical.
 */
export const COMPLIANCE_REMINDER_DAYS: Record<ComplianceType, number[]> = {
  gas_safety:              [90, 60, 30, 14],
  eicr:                    [90, 60, 30, 14],
  epc:                     [90, 60, 30],
  deposit_protection:      [14,  7,  3],  // tight deadline — within 30 days
  deposit_prescribed_info: [14,  7,  3],
  smoke_co_alarms:         [30, 14],
  right_to_rent_followup:  [60, 30, 14,  7],
  how_to_rent_guide:       [],  // served at tenancy start — no expiry reminders
  energy_info_regs:        [],  // served at tenancy start — no expiry reminders
  landlord_insurance:      [90, 30, 14, 7],
  legionella_risk_assessment: [90, 30, 14],
};

/** Fine amounts (GBP) for non-compliance — used in reminder message copy */
export const COMPLIANCE_FINES_GBP: Partial<Record<ComplianceType, string>> = {
  gas_safety:                  "up to £6,000",
  eicr:                        "up to £30,000",
  epc:                         "£500 to £5,000",
  deposit_protection:          "1–3× the deposit value",
  deposit_prescribed_info:     "1–3× the deposit value",
  smoke_co_alarms:             "£5,000 per breach",
  legionella_risk_assessment:  "up to £20,000",
};

/** Certificate validity period in days for each compliance type */
export const COMPLIANCE_VALIDITY_DAYS: Partial<Record<ComplianceType, number>> = {
  gas_safety:         365,
  eicr:               365 * 5,
  epc:                365 * 10,
  smoke_co_alarms:    365,
  landlord_insurance: 365,
};

// ─── Compliance Autopilot Cron ─────────────────────────────────────────────────

/**
 * Reminder thresholds (days before due date) used by the compliance-autopilot-cron.
 * The cron sends one message per threshold crossing, tracked by last_reminder_threshold
 * on the compliance_deadlines row.
 *
 * Note: threshold 0 means "overdue" — handled separately (resent every 7 days).
 */
export const COMPLIANCE_AUTOPILOT_THRESHOLDS = [90, 30, 14, 7, 1] as const;

/** How many days to wait before re-sending the overdue reminder */
export const COMPLIANCE_AUTOPILOT_OVERDUE_RESEND_DAYS = 7 as const;

// ─── Affordability ─────────────────────────────────────────────────────────────

/**
 * Gross annual income must be at least this multiple of annual rent.
 * Standard UK affordability threshold. Landlords can override this per property.
 */
export const AFFORDABILITY_MULTIPLIER_DEFAULT = 2.5 as const;

/**
 * Minimum net monthly income retained after paying rent.
 * Alternative affordability test for tenants with moderate income.
 * Not applied if the gross multiplier already passes.
 */
export const NET_INCOME_RESIDUAL_GBP = 500 as const;

// ─── Rent Arrears Thresholds ───────────────────────────────────────────────────

/**
 * Days after due date when each escalation level triggers.
 * These map to the rent_events.event_type ENUM.
 */
export const RENT_ARREARS_ESCALATION_DAYS = {
  REMINDER: 0,    // Due-date reminder sent 3 days before
  DAY_1:    1,    // Gentle "did you forget?" message
  DAY_3:    3,    // Firmer reminder + landlord notification
  DAY_7:    7,    // Formal notice + landlord alert + agent log
  DAY_14:   14,   // Human escalation + Section 8 Ground 11 guidance
} as const;

/**
 * Months of arrears before mandatory Ground 8 Section 8 notice becomes viable.
 * Source: Housing Act 1988 (as amended by Renters' Rights Act 2026).
 */
export const GROUND_8_ARREARS_MONTHS = 2 as const;

// ─── Inspection Schedule ───────────────────────────────────────────────────────

// ─── Tenancy Check-In ────────────────────────────────────────────────────────

/**
 * How many months after tenancy start (or last check-in) before the
 * annual check-in cron triggers a landlord check-in message.
 * Under the Renters' Rights Act 2025, tenancies are periodic — there are no
 * renewals. The check-in confirms the landlord's position (continue / rent
 * review / Section 8 concern) every 12 months.
 */
export const ANNUAL_CHECK_IN_MONTHS = 12 as const;

/**
 * Days before the tenant's notice end date when CompliLet schedules the
 * checkout inspection photo request.
 */
export const CHECKOUT_INSPECTION_NOTICE_DAYS = 14 as const;

/**
 * Minimum notice period (months) a tenant must give under the Renters' Rights
 * Act 2025 before vacating a periodic assured tenancy.
 */
export const TENANT_NOTICE_PERIOD_MONTHS = 2 as const;

/**
 * Minimum notice period (months) that must elapse between the service date
 * of a Section 13 rent increase notice and its effective date.
 */
export const SECTION_13_NOTICE_PERIOD_MONTHS = 2 as const;

/**
 * Minimum interval (months) between successive Section 13 rent increases.
 * Enforced deterministically — the AI cannot override this.
 */
export const SECTION_13_FREQUENCY_MONTHS = 12 as const;

// ─── Inspection Schedule ───────────────────────────────────────────────────────

/** How often (in days) CompliLet schedules photo-based property inspections */
export const INSPECTION_INTERVAL_DAYS = 91 as const; // ~quarterly

/** Days before scheduled inspection when tenant is notified */
export const INSPECTION_NOTICE_DAYS = 7 as const;

/** Days tenant has to submit all inspection photos */
export const INSPECTION_PHOTO_DEADLINE_DAYS = 7 as const;

/** Days after initiation when reminders are sent for incomplete inspections */
export const INSPECTION_REMINDER_DAYS = [3, 6] as const;

// ─── Maintenance Triage Thresholds ─────────────────────────────────────────────

/**
 * Maximum contractor spend (GBP, inc VAT) the AI can authorise
 * without explicit landlord approval, per maintenance category.
 * Landlords can adjust these limits per property.
 */
export const MAINTENANCE_AUTO_AUTHORISE_LIMIT_GBP: Record<MaintenanceCategory, number> = {
  plumbing:   250,
  heating:    500,  // Higher threshold — habitability risk if not fixed
  electrical: 300,
  structural: 0,    // Never auto-authorise — always requires landlord sign-off
  appliance:  150,
  pest:       200,
  security:   300,
  damp_mould: 0,    // Potentially significant — always escalate
  other:      150,
};

/**
 * Keywords in a maintenance report that immediately classify the issue
 * as "emergency" regardless of the AI's urgency classification.
 * These trigger instant contractor dispatch for pre-authorised emergencies.
 */
export const EMERGENCY_MAINTENANCE_KEYWORDS = [
  "gas leak",
  "smell of gas",
  "carbon monoxide",
  "CO alarm",
  "no heating",     // Context check: only "emergency" in Oct–Mar
  "no hot water",
  "burst pipe",
  "flooding",
  "flood",
  "electrical fire",
  "sparks",
  "smoke from wiring",
  "ceiling collaps",
  "roof collaps",
  "broken front door",
  "door won't lock",
  "front door lock",
  "intruder",
] as const;

// ─── Reference Chasing ─────────────────────────────────────────────────────────

/** Number of follow-up attempts before marking reference as "unreachable" */
export const REFERENCE_MAX_FOLLOW_UPS = 3 as const;

/** Days between follow-up attempts */
export const REFERENCE_FOLLOW_UP_DAYS = [2, 4, 7] as const;

// ─── Agent Timeouts ────────────────────────────────────────────────────────────

/**
 * If a tenant hasn't responded within this many days, the session
 * transitions to "abandoned" automatically.
 */
export const SESSION_INACTIVITY_ABANDON_DAYS: Record<string, number> = {
  pre_qualifying:  3,
  collecting_docs: 5,
  right_to_rent:   3,
  chasing_refs:    14, // References take time — give more runway
  decision:        7,
  move_in_pack:    5,
};

/** Maximum Edge Function execution time budget in milliseconds */
export const FUNCTION_TIMEOUT_MS = 25_000 as const;

/** Maximum tokens for Claude response in agent functions */
export const CLAUDE_MAX_TOKENS = 1_024 as const;

/**
 * Claude model IDs for CompliLet agents.
 *
 * FAST   — High-volume conversational agents (pre-qualifier, reference chaser,
 *          maintenance triage, compliance autopilot, rent monitor, coordinator).
 * ACCURATE — Compliance-critical agents where accuracy matters more than speed
 *          (document fraud detection, Section 13 rent review, Section 8 check-in,
 *          NRL tax compliance, Right to Rent classification).
 *
 * Changing a model here applies to every agent that references it.
 */
export const MODELS = {
  FAST:     "claude-sonnet-4-20250514",
  ACCURATE: "claude-opus-4-7",
} as const;

/** @deprecated Use MODELS.FAST or MODELS.ACCURATE instead */
export const CLAUDE_MODEL = MODELS.FAST;

// ─── Deposit Protection Schemes ────────────────────────────────────────────────

/** UK government-approved deposit protection schemes */
export const DEPOSIT_PROTECTION_SCHEMES = [
  { id: "dps",    label: "Deposit Protection Service (DPS)",  type: "custodial" },
  { id: "mydeposits", label: "mydeposits",                   type: "insured" },
  { id: "tds",    label: "Tenancy Deposit Scheme (TDS)",      type: "both" },
] as const;

/** Statutory deadline: deposit must be protected and prescribed info served within this many days */
export const DEPOSIT_PROTECTION_DEADLINE_DAYS = 30 as const;

// ─── Compliance Certificate Renewal Windows ────────────────────────────────────

/**
 * Gas Safety certificates can be renewed up to 2 months early without
 * losing the anniversary date. This window is used to prompt early renewals.
 */
export const GAS_SAFETY_EARLY_RENEWAL_DAYS = 60 as const;

// ─── NRL (Non-Resident Landlord) Scheme ───────────────────────────────────────

/** Tax deduction rate applied by tenants to overseas landlords without NRL approval */
export const NRL_WITHHOLDING_TAX_RATE = 0.20 as const; // 20% basic rate

/** Typical HMRC processing time for NRL1 applications in weeks */
export const NRL_APPROVAL_WEEKS_TYPICAL = [2, 4] as const;

/** Days before NRL1 approval expiry to send the renewal reminder */
export const NRL_EXPIRY_REMINDER_DAYS = 30 as const;

/** Weeks after NRL1 guidance to send the "have you heard back?" follow-up */
export const NRL_APPROVAL_REMINDER_WEEKS = 6 as const;

/** Month numbers (1–12) when quarterly payment-on-account reminders are sent */
export const NRL_QUARTERLY_REMINDER_MONTHS = [1, 4, 7, 10] as const;

/** Days before the 31 January Self Assessment deadline to send advance reminders */
export const NRL_SA_REMINDER_ADVANCE_DAYS = [90, 30, 7] as const;

// ─── UK Compliance Dates ───────────────────────────────────────────────────────

/** Renters' Rights Act 2026 — abolition of Section 21 no-fault evictions */
export const SECTION_21_ABOLITION_DATE = "2026-05-01" as const;

/** Making Tax Digital — mandatory quarterly filing threshold dates */
export const MTD_THRESHOLDS = {
  /** From 6 April 2026 — mandatory for gross property income > £50,000/yr */
  phase1: { effectiveDate: "2026-04-06", annualIncomeThresholdGbp: 50_000 },
  /** From 6 April 2027 — threshold drops to £30,000/yr */
  phase2: { effectiveDate: "2027-04-06", annualIncomeThresholdGbp: 30_000 },
} as const;

/** EPC minimum band requirement effective date (Band D → Band C by 2028) */
export const EPC_MINIMUM_BAND_C_DATE = "2028-12-31" as const;

// ─── Billing / Plans ──────────────────────────────────────────────────────────

/** Number of free screenings included in the free trial before payment is required */
export const FREE_TRIAL_SCREENING_LIMIT = 3 as const;

/**
 * CompliLet plan identifiers.
 * Mirrors the landlord_plan ENUM in the database.
 */
export const LANDLORD_PLAN = {
  FREE_TRIAL:       "free_trial",
  PAY_PER_SCREEN:   "pay_per_screen",
  LANDLORD_PRO:     "landlord_pro",
  TENANCY_MANAGER:  "tenancy_manager",
  PORTFOLIO:        "portfolio",
  GLOBAL_LANDLORD:  "global_landlord",
} as const;

export type LandlordPlan = typeof LANDLORD_PLAN[keyof typeof LANDLORD_PLAN];

/** Plans that carry an active Stripe subscription (recurring charge) */
export const SUBSCRIPTION_PLANS: ReadonlySet<LandlordPlan> = new Set([
  LANDLORD_PLAN.LANDLORD_PRO,
  LANDLORD_PLAN.TENANCY_MANAGER,
  LANDLORD_PLAN.PORTFOLIO,
  LANDLORD_PLAN.GLOBAL_LANDLORD,
]);

/** Plans that use Stripe metered billing (report usage per screening) */
export const METERED_PLANS: ReadonlySet<LandlordPlan> = new Set([
  LANDLORD_PLAN.TENANCY_MANAGER,
  LANDLORD_PLAN.GLOBAL_LANDLORD,
]);

/**
 * Pricing labels shown in the WhatsApp PRICING command and payment prompts.
 * Prices are in GBP.
 */
export const PLAN_LABELS: Record<LandlordPlan, string> = {
  free_trial:      "Free Trial (3 screenings)",
  pay_per_screen:  "Pay-Per-Screen — £4.99 per screening",
  landlord_pro:    "Landlord Pro — £19.99/month (unlimited screenings)",
  tenancy_manager: "Tenancy Manager — £14.99/month per property",
  portfolio:       "Portfolio — £39.99/month (unlimited properties)",
  global_landlord: "Global Landlord — £29.99/month per property",
};

/** Prices in pence (GBP × 100) for Stripe */
export const PLAN_PRICE_PENCE: Partial<Record<LandlordPlan, number>> = {
  pay_per_screen:  499,
  landlord_pro:    1999,
  tenancy_manager: 1499,
  portfolio:       3999,
  global_landlord: 2999,
};
