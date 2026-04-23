import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Filter } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ── Unified severity model ──────────────────────────────────────────────────
//
// Escalations use priority: urgent | high | normal
// compliance_alerts use severity: critical | high | medium | low
//
// We unify on a single severity ladder:
//   critical  (escalations.urgent, compliance_alerts.critical)
//   high      (escalations.high,   compliance_alerts.high)
//   medium    (compliance_alerts.medium)
//   normal    (escalations.normal)
//   low       (compliance_alerts.low)

type UnifiedSeverity = "critical" | "high" | "medium" | "normal" | "low";
type UnifiedStatus = "open" | "in_progress" | "resolved";
type AlertSource = "escalation" | "compliance";

interface UnifiedAlert {
  id: string;
  source: AlertSource;
  severity: UnifiedSeverity;
  status: UnifiedStatus;
  type: string;
  landlord_name: string | null;
  landlord_id: string | null;
  sender_phone: string | null;
  created_at: string;
  href: string;
}

const SEVERITY_WEIGHT: Record<UnifiedSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  normal: 3,
  low: 4,
};

const SEVERITY_PILL: Record<UnifiedSeverity, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  high:     "bg-amber-50 text-amber-700 border-amber-200",
  medium:   "bg-yellow-50 text-yellow-700 border-yellow-200",
  normal:   "bg-admin-cream text-admin-mute border-admin-line",
  low:      "bg-admin-cream text-admin-mute border-admin-line",
};

const STATUS_PILL: Record<UnifiedStatus, string> = {
  open:        "bg-blue-50 text-blue-700",
  in_progress: "bg-purple-50 text-purple-700",
  resolved:    "bg-green-50 text-admin-teal",
};

function mapEscalationSeverity(p: string): UnifiedSeverity {
  if (p === "urgent") return "critical";
  if (p === "high") return "high";
  return "normal";
}

function mapComplianceSeverity(s: string): UnifiedSeverity {
  if (s === "critical") return "critical";
  if (s === "high") return "high";
  if (s === "medium") return "medium";
  return "low";
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function typeLabel(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Server Actions ──────────────────────────────────────────────────────────

async function takeOverAction(formData: FormData) {
  "use server";
  const id = formData.get("id") as string;
  await supabaseAdmin
    .from("escalations")
    .update({ status: "in_progress", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open");
  redirect("/admin/alerts");
}

async function resolveComplianceAction(formData: FormData) {
  "use server";
  const id = formData.get("id") as string;
  await supabaseAdmin
    .from("compliance_alerts")
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq("id", id);
  redirect("/admin/alerts");
}

// ── Data loading ────────────────────────────────────────────────────────────

interface Filters {
  severity: UnifiedSeverity | "all";
  status: UnifiedStatus | "all";
  source: AlertSource | "all";
}

async function loadAlerts(filters: Filters): Promise<{
  alerts: UnifiedAlert[];
  counts: { total: number; critical: number; high: number; open: number };
}> {
  // Fetch escalations
  const escRes = await supabaseAdmin
    .from("escalations")
    .select(
      "id, landlord_id, sender_phone, trigger_type, priority, status, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const compRes = await supabaseAdmin
    .from("compliance_alerts")
    .select(
      "id, tenancy_id, alert_type, severity, resolved, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const escalations = escRes.data ?? [];
  const compliance = compRes.data ?? [];

  // Landlord name lookup
  const landlordIds = [
    ...new Set(escalations.map((e) => e.landlord_id).filter(Boolean)),
  ] as string[];
  const nameMap = new Map<string, string>();
  if (landlordIds.length > 0) {
    const { data } = await supabaseAdmin
      .from("landlords")
      .select("id, name")
      .in("id", landlordIds);
    for (const l of data ?? []) {
      if (l.name) nameMap.set(l.id, l.name);
    }
  }

  const unified: UnifiedAlert[] = [
    ...escalations.map(
      (e): UnifiedAlert => ({
        id: e.id,
        source: "escalation",
        severity: mapEscalationSeverity(e.priority ?? "normal"),
        status: (e.status ?? "open") as UnifiedStatus,
        type: typeLabel(e.trigger_type ?? "Escalation"),
        landlord_name: e.landlord_id ? nameMap.get(e.landlord_id) ?? null : null,
        landlord_id: e.landlord_id,
        sender_phone: e.sender_phone,
        created_at: e.created_at,
        href: `/admin/alerts/${e.id}`,
      }),
    ),
    ...compliance.map(
      (c): UnifiedAlert => ({
        id: c.id,
        source: "compliance",
        severity: mapComplianceSeverity(c.severity ?? "medium"),
        status: (c.resolved ? "resolved" : "open") as UnifiedStatus,
        type: typeLabel(c.alert_type ?? "Compliance"),
        landlord_name: null,
        landlord_id: null,
        sender_phone: null,
        created_at: c.created_at,
        href: `/admin/tenancies`,
      }),
    ),
  ];

  // Apply filters
  const filtered = unified.filter((a) => {
    if (filters.severity !== "all" && a.severity !== filters.severity) return false;
    if (filters.status !== "all" && a.status !== filters.status) return false;
    if (filters.source !== "all" && a.source !== filters.source) return false;
    return true;
  });

  // Sort: severity asc (critical first), then oldest first within severity
  filtered.sort((a, b) => {
    const sw = SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity];
    if (sw !== 0) return sw;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  // Totals (before filters) for the top counters
  const counts = {
    total: unified.length,
    critical: unified.filter((a) => a.severity === "critical").length,
    high: unified.filter((a) => a.severity === "high").length,
    open: unified.filter((a) => a.status === "open").length,
  };

  return { alerts: filtered, counts };
}

// ── Page ────────────────────────────────────────────────────────────────────

interface Props {
  searchParams: Promise<{
    severity?: string;
    status?: string;
    source?: string;
  }>;
}

const SEVERITY_FILTERS: Array<{ value: UnifiedSeverity | "all"; label: string }> = [
  { value: "all",      label: "All severity" },
  { value: "critical", label: "Critical"     },
  { value: "high",     label: "High"         },
  { value: "medium",   label: "Medium"       },
  { value: "normal",   label: "Normal"       },
  { value: "low",      label: "Low"          },
];

const STATUS_FILTERS: Array<{ value: UnifiedStatus | "all"; label: string }> = [
  { value: "open",        label: "Open"        },
  { value: "in_progress", label: "In progress" },
  { value: "resolved",    label: "Resolved"    },
  { value: "all",         label: "All"         },
];

const SOURCE_FILTERS: Array<{ value: AlertSource | "all"; label: string }> = [
  { value: "all",         label: "All sources" },
  { value: "escalation",  label: "Escalations" },
  { value: "compliance",  label: "Compliance"  },
];

export default async function AlertsPage({ searchParams }: Props) {
  const p = await searchParams;
  const filters: Filters = {
    severity: (p.severity ?? "all") as Filters["severity"],
    status: (p.status ?? "open") as Filters["status"],
    source: (p.source ?? "all") as Filters["source"],
  };

  const { alerts, counts } = await loadAlerts(filters);

  const buildHref = (key: keyof Filters, value: string) => {
    const params = new URLSearchParams();
    if (filters.severity !== "all") params.set("severity", filters.severity);
    if (filters.status !== "open") params.set("status", filters.status);
    if (filters.source !== "all") params.set("source", filters.source);
    params.set(key, value);
    return `/admin/alerts?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-admin-ink">
            Alerts
          </h1>
          <p className="mt-1 text-sm text-admin-mute">
            Escalations and compliance alerts across the platform.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right">
          <Stat label="Total" value={counts.total} />
          <Stat label="Critical" value={counts.critical} tone="danger" />
          <Stat label="Open" value={counts.open} />
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-admin-line bg-white p-4 shadow-card">
        <div className="flex items-center gap-2 pb-2 text-xs font-medium uppercase tracking-wide text-admin-mute">
          <Filter className="h-3.5 w-3.5" aria-hidden /> Filters
        </div>
        <div className="space-y-3">
          <FilterGroup
            label="Severity"
            options={SEVERITY_FILTERS}
            active={filters.severity}
            buildHref={(v) => buildHref("severity", v)}
          />
          <FilterGroup
            label="Status"
            options={STATUS_FILTERS}
            active={filters.status}
            buildHref={(v) => buildHref("status", v)}
          />
          <FilterGroup
            label="Source"
            options={SOURCE_FILTERS}
            active={filters.source}
            buildHref={(v) => buildHref("source", v)}
          />
        </div>
      </div>

      {/* Table */}
      {alerts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-admin-line bg-admin-cream/40 px-6 py-16 text-center text-sm text-admin-mute">
          No alerts match these filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-admin-line bg-white shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b border-admin-line bg-admin-cream/50">
              <tr>
                <Th>Severity</Th>
                <Th>Type</Th>
                <Th>Source</Th>
                <Th>Landlord</Th>
                <Th>Status</Th>
                <Th>Raised</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-line">
              {alerts.map((a) => (
                <tr key={`${a.source}-${a.id}`} className="transition hover:bg-admin-cream/40">
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${SEVERITY_PILL[a.severity]}`}
                    >
                      {a.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-admin-ink">{a.type}</p>
                    {a.sender_phone && (
                      <p className="font-mono text-xs text-admin-mute">
                        {a.sender_phone}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-admin-mute">
                    {a.source === "escalation" ? "Escalation" : "Compliance"}
                  </td>
                  <td className="px-4 py-3 text-sm text-admin-ink">
                    {a.landlord_id ? (
                      <Link
                        href={`/admin/landlords/${a.landlord_id}`}
                        className="hover:underline"
                      >
                        {a.landlord_name ?? "Unnamed"}
                      </Link>
                    ) : (
                      <span className="text-admin-mute">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_PILL[a.status]}`}
                    >
                      {a.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-admin-mute">
                    {fmtDate(a.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      {a.source === "escalation" ? (
                        <>
                          {a.status === "open" && (
                            <form action={takeOverAction}>
                              <input type="hidden" name="id" value={a.id} />
                              <button
                                type="submit"
                                className="rounded-lg bg-admin-cream px-2.5 py-1 text-xs font-medium text-admin-ink transition hover:bg-admin-line"
                              >
                                Take over
                              </button>
                            </form>
                          )}
                          <Link
                            href={a.href}
                            className="inline-flex items-center gap-1 rounded-lg bg-admin-teal px-2.5 py-1 text-xs font-medium text-white transition hover:bg-[#0C5C48]"
                          >
                            View
                            <ArrowUpRight className="h-3 w-3" aria-hidden />
                          </Link>
                        </>
                      ) : (
                        a.status === "open" && (
                          <form action={resolveComplianceAction}>
                            <input type="hidden" name="id" value={a.id} />
                            <button
                              type="submit"
                              className="rounded-lg bg-admin-teal px-2.5 py-1 text-xs font-medium text-white transition hover:bg-[#0C5C48]"
                            >
                              Mark resolved
                            </button>
                          </form>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "danger";
}) {
  return (
    <div className="rounded-xl border border-admin-line bg-white px-3 py-2 text-left shadow-card">
      <p className="text-xs font-medium text-admin-mute">{label}</p>
      <p
        className={`font-display text-xl font-semibold tabular-nums ${
          tone === "danger" && value > 0 ? "text-red-700" : "text-admin-ink"
        }`}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  active,
  buildHref,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  active: T;
  buildHref: (value: T) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-xs font-medium text-admin-mute">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const isActive = opt.value === active;
          return (
            <Link
              key={opt.value}
              href={buildHref(opt.value)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                isActive
                  ? "bg-admin-ink text-white"
                  : "bg-admin-cream text-admin-ink hover:bg-admin-line"
              }`}
            >
              {opt.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-admin-mute ${className}`}
    >
      {children}
    </th>
  );
}

