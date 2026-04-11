/**
 * Shared TypeScript types for CompliLet Edge Functions.
 *
 * Designed for Deno / Supabase Edge Functions runtime.
 * All types mirror the database schema in 20260411000000_initial_schema.sql.
 */

// ─── WhatsApp API Response ─────────────────────────────────────────────────────

export interface WhatsAppResponse {
  messaging_product: "whatsapp";
  contacts?: Array<{
    input: string;
    wa_id: string;
  }>;
  messages?: Array<{
    id: string; // wamid.xxx
    message_status?: string;
  }>;
  error?: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

/** Thrown when Meta Cloud API returns an error body or non-2xx status */
export class WhatsAppApiError extends Error {
  readonly code: number;
  readonly type: string;
  readonly errorSubcode?: number;
  readonly fbtraceId?: string;

  constructor(
    message: string,
    code: number,
    type: string,
    errorSubcode?: number,
    fbtraceId?: string,
  ) {
    super(message);
    this.name = "WhatsAppApiError";
    this.code = code;
    this.type = type;
    this.errorSubcode = errorSubcode;
    this.fbtraceId = fbtraceId;
  }
}

// ─── Raw Webhook Payload ───────────────────────────────────────────────────────

/**
 * Typed shape of the Meta Cloud API webhook POST body.
 * Only the fields CompliLet reads are typed — unknown fields are allowed through.
 */
export interface WebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      field: string;
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          profile: { name: string };
          wa_id: string;
        }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
          image?: {
            id: string;
            mime_type: string;
            caption?: string;
            sha256?: string;
          };
          document?: {
            id: string;
            mime_type: string;
            filename?: string;
            caption?: string;
            sha256?: string;
          };
          audio?: {
            id: string;
            mime_type: string;
          };
          video?: {
            id: string;
            mime_type: string;
            caption?: string;
            sha256?: string;
          };
          sticker?: { id: string; mime_type: string };
          location?: {
            latitude: number;
            longitude: number;
            name?: string;
            address?: string;
          };
          interactive?: {
            type: "button_reply" | "list_reply";
            button_reply?: { id: string; title: string };
            list_reply?: { id: string; title: string; description?: string };
          };
          errors?: Array<{ code: number; title: string }>;
        }>;
        statuses?: Array<{
          id: string;
          status: "sent" | "delivered" | "read" | "failed";
          timestamp: string;
          recipient_id: string;
          errors?: Array<{ code: number; title: string }>;
        }>;
        errors?: Array<{ code: number; title: string; details?: string }>;
      };
    }>;
  }>;
}

// ─── Parsed Incoming Message ───────────────────────────────────────────────────

export type IncomingMessageType =
  | "text"
  | "image"
  | "document"
  | "audio"
  | "video"
  | "sticker"
  | "location"
  | "interactive"
  | "status_update"
  | "unknown";

export interface MediaInfo {
  /** WhatsApp media ID — pass to downloadMedia() */
  id: string;
  /** MIME type (e.g. "image/jpeg", "application/pdf") */
  mimeType: string;
  /** Original filename, present for document type only */
  filename?: string;
  /** Caption sent alongside the media */
  caption?: string;
  /** SHA-256 of the file — can be used to detect duplicates */
  sha256?: string;
}

/**
 * Normalised representation of any incoming WhatsApp event.
 * All routing and business logic works against this type, never the raw webhook.
 */
export interface ParsedMessage {
  /** Determines how the coordinator routes the event */
  type: IncomingMessageType;
  /**
   * Sender's phone number in E.164 format without leading +.
   * Example: "447700000000" (UK mobile)
   */
  from: string;
  /** WhatsApp message ID (wamid.xxx…) — used in markAsRead() */
  messageId: string;
  /** Unix timestamp in seconds from WhatsApp metadata */
  timestamp: number;
  /** Body text — present when type === "text" */
  text?: string;
  /** Media attachment details — present when type is image | document | audio | video */
  media?: MediaInfo;
  /** Status event details — present when type === "status_update" */
  statusUpdate?: {
    status: "sent" | "delivered" | "read" | "failed";
    /** The outbound message ID whose status changed */
    messageId: string;
    /** The recipient's phone number */
    recipientId: string;
    timestamp: number;
    errors?: Array<{ code: number; title: string }>;
  };
  /** Interactive reply payload — present when type === "interactive" */
  interactive?: {
    type: "button_reply" | "list_reply";
    id: string;
    title: string;
    description?: string;
  };
  /**
   * WhatsApp display name from the sender's profile.
   * Not verified — do not use as identity; use for display only.
   */
  contactName?: string;
  /** The receiving WhatsApp Business phone number ID (from metadata) */
  phoneNumberId?: string;
}

// ─── Session / Agent State ─────────────────────────────────────────────────────

/**
 * Mirrors the session_status ENUM in the database.
 * See SESSION_STATUS_TRANSITIONS in constants.ts for valid state machine moves.
 */
export type SessionStatus =
  | "pre_qualifying"   // AI collects name, income, move-in date, occupants
  | "collecting_docs"  // AI requests and validates ID, payslips, proof of address
  | "right_to_rent"    // AI conducts or facilitates Right to Rent check
  | "chasing_refs"     // AI contacts previous landlord + employer for references
  | "decision"         // Landlord reviews scored report and decides
  | "move_in_pack"     // AI generates and sends tenancy agreement + move-in documents
  | "active_tenancy"   // Post-move-in: rent, compliance, maintenance, inspections
  | "renewal"          // Approaching lease end — renewal workflow active
  | "abandoned"        // Tenant did not complete screening
  | "rejected";        // Landlord declined or tenant failed threshold

/**
 * Mirrors the agent_type ENUM in the database.
 * Each agent type has its own set of system prompts and tool authorisations.
 */
export type AgentType =
  | "coordinator"      // Routes messages to the correct sub-agent
  | "screener"         // Runs pre-qualifying → collecting_docs → right_to_rent → chasing_refs
  | "compliance"       // Tracks and alerts on certificate deadlines
  | "maintenance"      // Triages maintenance reports and dispatches contractors
  | "inspection"       // Manages quarterly photo-based inspections
  | "rent_collection"  // Rent reminders and arrears chasing
  | "renewal";         // Lease renewal negotiations

export type MessageRole = "system" | "user" | "assistant" | "tool";

/** A single message in a Claude API conversation history */
export interface AgentMessage {
  role: MessageRole;
  content: string;
  /** Unix timestamp — not sent to Claude but useful for logging */
  timestamp?: number;
}

// ─── Right to Rent ─────────────────────────────────────────────────────────────

/**
 * Indicates which document list a tenant's Right to Rent falls under.
 * Drives whether a follow-up check is required.
 */
export type RightToRentListType =
  | "list_a_group_1" // Single document sufficient — unlimited right
  | "list_a_group_2" // Two-document combination — unlimited right
  | "list_a_euss"    // EU Settlement Scheme Settled Status — unlimited right
  | "list_b"         // Time-limited — follow-up check required before expiry
  | "unknown";

export type RightToRentStatus =
  | "not_checked"
  | "checking"    // Online share code check initiated, awaiting result
  | "list_a"      // Unlimited right — no follow-up required
  | "list_b"      // Time-limited right — follow-up date set
  | "no_right";   // No right to rent in England

export type RightToRentVerificationMethod =
  | "in_person"   // Landlord inspected original documents face-to-face
  | "video_call"  // Live video call with document held up to camera
  | "share_code"  // gov.uk online check using tenant's share code
  | "idsp"        // Certified Identity Service Provider (for British/Irish nationals)
  | "manual";     // Landlord conducted their own check outside CompliLet

export interface RightToRentResult {
  status: RightToRentStatus;
  listType: RightToRentListType;
  /** Human-readable document type description */
  documentType: string;
  /** ISO date string — present for List B documents */
  documentExpiry?: string;
  /** Whether a calendar reminder must be set for a follow-up check */
  followUpRequired: boolean;
  /**
   * ISO date string — 2 months before documentExpiry for List B.
   * CompliLet will send a reminder and initiate follow-up at this date.
   */
  followUpByDate?: string;
  verificationMethod: RightToRentVerificationMethod;
  /** Signed URL to the generated PDF compliance certificate */
  certificateUrl?: string;
  /** ISO datetime when the check was completed */
  checkedAt: string;
  notes?: string;
}

// ─── Document Verification ─────────────────────────────────────────────────────

export type DocumentCategory =
  | "photo_id"           // Passport, driving licence, BRP
  | "proof_of_income"    // Payslips, bank statements, accountant letter
  | "proof_of_address"   // Utility bill, bank letter, HMRC letter
  | "right_to_rent"      // Right to Rent specific document
  | "other";

export interface DocumentVerificationResult {
  category: DocumentCategory;
  /** Specific document type (e.g. "UK Passport", "P60") */
  documentType: string;
  /** Storage path in Supabase (documents.storage_path) */
  storagePath?: string;
  /** Overall pass/fail for this document */
  passed: boolean;
  /** List of specific validation failures, if any */
  issues: string[];
  /** AI confidence in the validation */
  confidence: "high" | "medium" | "low";
  /** Key data points extracted from the document image */
  extractedData?: {
    name?: string;
    dateOfBirth?: string;
    expiryDate?: string;
    documentNumber?: string;
    address?: string;
    nationalInsuranceNumber?: string;
    issuer?: string;
    employerName?: string;
    grossIncome?: number;
    netIncome?: number;
  };
}

// ─── Affordability ─────────────────────────────────────────────────────────────

export type IncomeBasis =
  | "payslips"           // 3 most recent payslips
  | "bank_statements"    // 3-month bank statements
  | "accountant_letter"  // Self-employed — accountant confirms annual earnings
  | "employment_contract"// Recently employed — contract + first payslip
  | "self_declared";     // Unverified — flagged as risk

export interface AffordabilityResult {
  /** Verified gross annual income in GBP */
  grossAnnualIncome: number;
  /** Monthly rent × 12 */
  annualRent: number;
  /** grossAnnualIncome ÷ annualRent — the key affordability metric */
  incomeMultiple: number;
  /** True if incomeMultiple >= threshold (default 2.5) */
  meetsThreshold: boolean;
  /** The multiplier threshold applied (default 2.5) */
  threshold: number;
  /** What the income figure is based on */
  basis: IncomeBasis;
  notes?: string;
}

// ─── References ───────────────────────────────────────────────────────────────

export type ReferenceType = "previous_landlord" | "employer";

export type ReferenceOutcome =
  | "positive"    // Enthusiastic recommendation
  | "neutral"     // No concerns, but no strong endorsement
  | "negative"    // Concerns raised about payment or conduct
  | "refused"     // Referee declined to provide reference
  | "unreachable"; // No response after 3 follow-up attempts

export interface ReferenceResult {
  type: ReferenceType;
  /** Name of the referee */
  refereeName?: string;
  contactPhone?: string;
  contactEmail?: string;
  contacted: boolean;
  contactedAt?: string;
  followUpCount: number;   // 0–3
  responded: boolean;
  respondedAt?: string;
  outcome?: ReferenceOutcome;
  /** Summary of the reference, as extracted by the AI */
  summary?: string;
  /** Previous landlord only — did they pay rent on time? */
  paidOnTime?: boolean;
  /** Previous landlord only — left property in good condition? */
  goodCondition?: boolean;
  /** Previous landlord only — would they rent to this tenant again? */
  wouldRentAgain?: boolean;
  /** Employer only — confirmed employment status */
  employmentConfirmed?: boolean;
  /** Employer only — confirmed income level */
  incomeConfirmed?: boolean;
}

// ─── Screening Report ──────────────────────────────────────────────────────────

export type ScreeningDecision =
  | "recommended"         // Score 7–10, no red flags, meets all thresholds
  | "conditional"         // Score 5–6, minor concerns — landlord must decide
  | "not_recommended";    // Score 0–4, or red flag present

export interface ScreeningReport {
  sessionId: string;
  tenantPhone: string;
  landlordPhone: string;
  propertyAddress: string;
  monthlyRentGbp: number;
  completedAt: string;    // ISO datetime
  /** Score out of 10 */
  score: number;
  decision: ScreeningDecision;
  affordability: AffordabilityResult;
  rightToRent: RightToRentResult;
  documents: DocumentVerificationResult[];
  references: ReferenceResult[];
  /**
   * Specific issues that caused the score to be reduced or a
   * "conditional" / "not_recommended" decision.
   */
  redFlags: string[];
  notes?: string;
  /** Signed URL to the generated PDF report */
  pdfUrl?: string;
}

// ─── Compliance ────────────────────────────────────────────────────────────────

export type ComplianceType =
  | "gas_safety"               // Annual — Gas Safe certificate
  | "eicr"                     // Every 5 years — Electrical Installation Condition Report
  | "epc"                      // Every 10 years — Energy Performance Certificate
  | "deposit_protection"       // Within 30 days of receipt
  | "deposit_prescribed_info"  // Within 30 days of receipt
  | "smoke_co_alarms"          // At tenancy start and maintained throughout
  | "right_to_rent_followup"   // List B tenants — before document expiry
  | "how_to_rent_guide"        // Must be served at tenancy start
  | "energy_info_regs"         // Energy information regulations
  | "landlord_insurance"       // Annual — buildings/contents policy
  | "legionella_risk_assessment"; // As needed — Legionella risk assessment

export type ComplianceUrgency =
  | "overdue"   // Past the deadline — immediate action required
  | "critical"  // 0–14 days remaining
  | "warning"   // 15–60 days remaining
  | "ok";       // 60+ days remaining

export interface ComplianceDeadline {
  type: ComplianceType;
  /** ISO date string of the deadline */
  dueDate: string;
  /** Days past the due date — undefined if not yet overdue */
  overdueByDays?: number;
  /** Days until due — negative if overdue */
  daysUntilDue: number;
  urgency: ComplianceUrgency;
  propertyId: string;
  propertyAddress: string;
  tenancyId?: string;
}

// ─── Maintenance ───────────────────────────────────────────────────────────────

export type MaintenanceUrgency =
  | "emergency"  // Risk to life or habitability (burst pipe, no heating in winter, gas leak)
  | "urgent"     // Significant inconvenience — resolve within 24–48 hours
  | "routine";   // Minor issue — batch for landlord review

export type MaintenanceCategory =
  | "plumbing"      // Leaks, drains, toilets, water pressure
  | "heating"       // Boiler, radiators, central heating
  | "electrical"    // Power, fuses, sockets, lights
  | "structural"    // Walls, roof, windows, doors
  | "appliance"     // White goods, built-in appliances
  | "pest"          // Rodents, insects, birds
  | "security"      // Locks, entry systems, CCTV
  | "damp_mould"    // Condensation, rising damp, mould growth
  | "other";

export interface MaintenanceReport {
  tenancyId: string;
  propertyAddress: string;
  reportedBy: string;       // tenant's phone number
  description: string;      // tenant's free-text report
  urgency: MaintenanceUrgency;
  category: MaintenanceCategory;
  /** Supabase Storage paths of any photos submitted by the tenant */
  mediaStoragePaths?: string[];
  /** Whether a contractor needs to be contacted */
  requiresContractor: boolean;
  /** Type of contractor most likely needed ("gas_safe", "electrician", "plumber", etc.) */
  suggestedContractorType?: string;
  /** AI-generated rough cost estimate for landlord's information */
  estimatedCostRange?: string;
  /** Pre-authorised if landlord's threshold for this category is met */
  preAuthorised: boolean;
}

// ─── Escalation ────────────────────────────────────────────────────────────────

/**
 * Reasons that cause the coordinator to route a session to a human agent.
 * Checked by ESCALATION_TRIGGER_PATTERNS in constants.ts.
 */
export type EscalationTrigger =
  | "safeguarding_concern"      // Domestic abuse, violence, risk to safety
  | "legal_threat"              // Solicitor, court proceedings, ombudsman
  | "mental_health_crisis"      // Self-harm, suicidal ideation
  | "immigration_enforcement"   // Home Office action, deportation risk
  | "fraud_indicator"           // Borrowed/fake documents detected or suspected
  | "explicit_human_request"    // Tenant or landlord explicitly asks for a human
  | "complaint"                 // Formal complaint about CompliLet or landlord
  | "no_right_to_rent"          // Confirmed no right to rent — cannot proceed
  | "emergency_maintenance"     // Gas leak, structural danger, no heating in winter
  | "rent_arrears_severe"       // 2+ months arrears — Section 8 Ground 8 territory
  | "ai_uncertainty";           // AI confidence too low to proceed safely

export interface EscalationRequest {
  trigger: EscalationTrigger;
  /** Session ID — if escalation occurs during screening */
  sessionId?: string;
  /** Tenancy ID — if escalation occurs during active tenancy management */
  tenancyId?: string;
  /** Phone number of the person who triggered the escalation */
  senderPhone: string;
  /** Brief summary of why escalation was triggered (for human agent) */
  context: string;
  urgency: "immediate" | "within_2hrs" | "same_day";
  /** Recent conversation history for human agent context */
  messageHistory?: AgentMessage[];
}

// ─── Rent Events ───────────────────────────────────────────────────────────────

export type RentEventType =
  | "due_date_created"    // Sentinel created on the due date — no message sent
  | "reminder_sent"       // Pre-due-date reminder sent to tenant (3 days before)
  | "received"            // Rent confirmed received — by tenant, landlord, or system
  | "overdue_day_1"       // 1 day late — gentle reminder
  | "overdue_day_3"       // 3 days late — firmer message + landlord alert
  | "overdue_day_7"       // 7 days late — formal notice + landlord + arrears flag set
  | "overdue_day_14"      // 14 days late — escalation to human + Section 8 guidance
  | "partial_payment"     // Partial payment received
  | "waived";             // Landlord waived this month's rent

export type RentStatus =
  | "pending"      // Due date not yet reached
  | "paid"         // Paid on time or accepted as paid
  | "late_paid"    // Paid after due date
  | "overdue"      // Past due date, not received
  | "waived"       // Landlord waived this month
  | "partial";     // Partial payment — balance outstanding

// ─── Property / Inspection ─────────────────────────────────────────────────────

export interface InspectionPhotoSet {
  tenancyId: string;
  scheduledDate: string;  // ISO date
  submittedAt?: string;   // ISO datetime
  /** Map of room label → Supabase Storage path */
  photos: Record<string, string>;
  /** AI-generated condition notes per room */
  conditionNotes?: Record<string, string>;
  /** Overall condition assessment */
  overallCondition?: "excellent" | "good" | "fair" | "poor";
  /** Any issues flagged by AI that require landlord review */
  flaggedIssues?: string[];
  /** URL to the generated PDF inspection report */
  reportUrl?: string;
}

// ─── Coordinator Routing ───────────────────────────────────────────────────────

/**
 * The output of the coordinator agent after analysing an incoming message.
 * Drives which sub-agent is invoked next and any side-effects.
 */
export interface CoordinatorDecision {
  /** Which agent should handle the message */
  routeTo: AgentType;
  /** Optional escalation if the coordinator detects a trigger pattern */
  escalate?: EscalationRequest;
  /** Additional context to pass to the sub-agent */
  context?: Record<string, unknown>;
  /** Whether the coordinator should update session status before routing */
  updateSessionStatus?: SessionStatus;
}
