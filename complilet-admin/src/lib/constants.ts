// ─── Admin Email Allowlist ────────────────────────────────────────────────────
export const ADMIN_EMAILS: string[] = (
  process.env.ADMIN_EMAIL_ALLOWLIST ?? ""
)
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// ─── Plan Labels ──────────────────────────────────────────────────────────────
export const PLAN_LABELS: Record<string, string> = {
  free_trial: "Free Trial",
  pay_per_screen: "Pay Per Screen",
  landlord_pro: "Landlord Pro",
  tenancy_manager: "Tenancy Manager",
  portfolio: "Portfolio",
  global_landlord: "Global Landlord",
};

// ─── Plan Badge Colours (Tailwind) ─────────────────────────────────────────────
export const PLAN_COLOURS: Record<string, string> = {
  free_trial: "bg-gray-100 text-gray-700",
  pay_per_screen: "bg-blue-50 text-blue-700",
  landlord_pro: "bg-teal-50 text-teal-700",
  tenancy_manager: "bg-indigo-50 text-indigo-700",
  portfolio: "bg-purple-50 text-purple-700",
  global_landlord: "bg-amber-50 text-amber-700",
};

// ─── Escalation Priority Colours ──────────────────────────────────────────────
export const PRIORITY_COLOURS: Record<string, string> = {
  urgent: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  normal: "bg-gray-100 text-gray-700",
};

// ─── Screening Status Labels ───────────────────────────────────────────────────
export const SCREENING_STATUS_LABELS: Record<string, string> = {
  pre_qualifying: "Pre-Qualifying",
  collecting_docs: "Collecting Docs",
  right_to_rent: "Right to Rent",
  chasing_refs: "Chasing Refs",
  decision: "Decision",
  move_in_pack: "Move-In Pack",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const SCREENING_STATUS_COLOURS: Record<string, string> = {
  pre_qualifying: "bg-blue-50 text-blue-700",
  collecting_docs: "bg-indigo-50 text-indigo-700",
  right_to_rent: "bg-purple-50 text-purple-700",
  chasing_refs: "bg-amber-50 text-amber-700",
  decision: "bg-orange-50 text-orange-700",
  move_in_pack: "bg-teal-50 text-teal-700",
  completed: "bg-green-50 text-green-700",
  cancelled: "bg-gray-100 text-gray-600",
};

// ─── Compliance Traffic Light Colours ─────────────────────────────────────────
export const COMPLIANCE_COLOURS = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
} as const;

export type ComplianceStatus = keyof typeof COMPLIANCE_COLOURS;

// ─── Agent Types ──────────────────────────────────────────────────────────────
export const AGENT_TYPES = [
  "pre_qualifier",
  "doc_collector",
  "right_to_rent",
  "reference_chaser",
  "compliance_autopilot",
  "rent_monitor",
  "maintenance_triage",
  "inspection_agent",
  "renewal_agent",
  "nrl_tax_agent",
  "coordinator",
] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

export const AGENT_LABELS: Record<string, string> = {
  pre_qualifier: "Pre-Qualifier",
  doc_collector: "Doc Collector",
  right_to_rent: "Right to Rent",
  reference_chaser: "Reference Chaser",
  compliance_autopilot: "Compliance Autopilot",
  rent_monitor: "Rent Monitor",
  maintenance_triage: "Maintenance Triage",
  inspection_agent: "Inspection Agent",
  renewal_agent: "Renewal Agent",
  nrl_tax_agent: "NRL Tax Agent",
  coordinator: "Coordinator",
};
