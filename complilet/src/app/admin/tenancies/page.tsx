import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-admin";

// ── Types ──────────────────────────────────────────────────────────────────

interface TenancyRow {
  id: string;
  property_id: string | null;
  tenant_name: string | null;
  tenant_phone: string;
  start_date: string | null;
  rent_amount: number | null;
  deposit_scheme: string | null;
  onboarding_type: string;
  tenant_confirmed_at: string | null;
  created_at: string;
  // enriched
  landlord_name?: string | null;
  property_address?: string | null;
  open_alerts?: number;
}

interface AlertRow {
  id: string;
  tenancy_id: string | null;
  alert_type: string;
  severity: "low" | "medium" | "high" | "critical";
  resolved: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const SEVERITY_COLOUR: Record<string, string> = {
  critical: "bg-red-900/60 text-red-300 border-red-800",
  high:     "bg-amber-900/60 text-amber-300 border-amber-800",
  medium:   "bg-yellow-900/40 text-yellow-300 border-yellow-800",
  low:      "bg-gray-800 text-gray-400 border-gray-700",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function alertLabel(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Page ───────────────────────────────────────────────────────────────────

export default async function ExistingTenanciesPage() {
  // Existing tenancies (onboarded, not screened)
  const { data: tenancyRows } = await supabaseAdmin
    .from("tenancies")
    .select(`id, property_id, tenant_name, tenant_phone, start_date,
             rent_amount, deposit_scheme, onboarding_type,
             tenant_confirmed_at, created_at`)
    .eq("onboarding_type", "existing")
    .order("created_at", { ascending: false });

  const tenancies: TenancyRow[] = (tenancyRows ?? []) as TenancyRow[];

  // Enrich with property address + landlord name
  const propertyIds = [
    ...new Set(tenancies.map((t) => t.property_id).filter(Boolean)),
  ] as string[];

  if (propertyIds.length > 0) {
    const { data: props } = await supabaseAdmin
      .from("properties")
      .select("id, address, landlord_id")
      .in("id", propertyIds);

    const propMap = new Map(
      (props ?? []).map((p) => [p.id, { address: p.address, landlord_id: p.landlord_id }]),
    );

    const landlordIds = [
      ...new Set((props ?? []).map((p) => p.landlord_id).filter(Boolean)),
    ] as string[];

    const { data: landlords } = await supabaseAdmin
      .from("landlords")
      .select("id, name")
      .in("id", landlordIds);

    const landlordMap = new Map((landlords ?? []).map((l) => [l.id, l.name]));

    for (const t of tenancies) {
      const prop = t.property_id ? propMap.get(t.property_id) : null;
      t.property_address = prop?.address ?? null;
      t.landlord_name = prop?.landlord_id ? (landlordMap.get(prop.landlord_id) ?? null) : null;
    }
  }

  // Load all open compliance alerts so we can count per-tenancy + breakdown
  const { data: alertRows } = await supabaseAdmin
    .from("compliance_alerts")
    .select("id, tenancy_id, alert_type, severity, resolved")
    .eq("resolved", false);

  const alerts: AlertRow[] = (alertRows ?? []) as AlertRow[];

  const alertsByTenancy = new Map<string, number>();
  for (const a of alerts) {
    if (!a.tenancy_id) continue;
    alertsByTenancy.set(a.tenancy_id, (alertsByTenancy.get(a.tenancy_id) ?? 0) + 1);
  }
  for (const t of tenancies) {
    t.open_alerts = alertsByTenancy.get(t.id) ?? 0;
  }

  // Alert-type breakdown
  const alertTypeCounts = new Map<string, number>();
  for (const a of alerts) {
    alertTypeCounts.set(a.alert_type, (alertTypeCounts.get(a.alert_type) ?? 0) + 1);
  }
  const topAlertTypes = [...alertTypeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // Severity breakdown
  const severityCounts = {
    critical: alerts.filter((a) => a.severity === "critical").length,
    high:     alerts.filter((a) => a.severity === "high").length,
    medium:   alerts.filter((a) => a.severity === "medium").length,
    low:      alerts.filter((a) => a.severity === "low").length,
  };

  // Top-level counts
  const totalTenancies = tenancies.length;
  const pendingConfirmation = tenancies.filter((t) => !t.tenant_confirmed_at).length;
  const confirmed = totalTenancies - pendingConfirmation;
  const totalAlerts = alerts.length;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-100">Existing Tenancies</h1>
        <p className="mt-1 text-sm text-gray-500">
          Tenancies onboarded via the Existing Tenancy flow (not new screenings).
        </p>
      </div>

      {/* KPI row */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-800 bg-gray-900 px-5 py-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Tenancies</div>
          <div className="mt-1 text-2xl font-semibold text-gray-100">{totalTenancies}</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 px-5 py-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Tenant confirmed</div>
          <div className="mt-1 text-2xl font-semibold text-green-400">{confirmed}</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 px-5 py-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Awaiting confirm</div>
          <div className="mt-1 text-2xl font-semibold text-yellow-400">{pendingConfirmation}</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 px-5 py-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Open alerts</div>
          <div className="mt-1 text-2xl font-semibold text-red-400">{totalAlerts}</div>
        </div>
      </div>

      {/* Severity + alert-type breakdown */}
      <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">Alerts by severity</h2>
          <div className="flex flex-wrap gap-2">
            {(["critical", "high", "medium", "low"] as const).map((sev) => (
              <span
                key={sev}
                className={`rounded border px-2.5 py-1 text-xs font-medium ${SEVERITY_COLOUR[sev]}`}
              >
                {sev}: {severityCounts[sev]}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">Top alert types</h2>
          {topAlertTypes.length === 0 ? (
            <p className="text-xs text-gray-500">No open alerts.</p>
          ) : (
            <ul className="space-y-1.5">
              {topAlertTypes.map(([type, count]) => (
                <li key={type} className="flex items-center justify-between text-sm">
                  <span className="text-gray-300">{alertLabel(type)}</span>
                  <span className="font-mono text-xs text-gray-500">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Table */}
      {tenancies.length === 0 ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900 px-6 py-16 text-center text-gray-500">
          No existing tenancies onboarded yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-800 bg-gray-900 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Tenant</th>
                <th className="px-4 py-3 text-left">Property</th>
                <th className="px-4 py-3 text-left">Landlord</th>
                <th className="px-4 py-3 text-left">Started</th>
                <th className="px-4 py-3 text-right">Rent</th>
                <th className="px-4 py-3 text-left">Deposit</th>
                <th className="px-4 py-3 text-left">Confirmed</th>
                <th className="px-4 py-3 text-right">Alerts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 bg-gray-950">
              {tenancies.map((t) => (
                <tr key={t.id} className="hover:bg-gray-900/60">
                  <td className="px-4 py-3">
                    <div className="text-gray-200">{t.tenant_name ?? "—"}</div>
                    <div className="font-mono text-xs text-gray-500">{t.tenant_phone}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {t.property_address ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{t.landlord_name ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(t.start_date)}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-300">
                    {t.rent_amount != null ? `£${t.rent_amount}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {t.deposit_scheme === "unprotected" ? (
                      <span className="rounded border border-red-800 bg-red-900/50 px-2 py-0.5 text-xs text-red-300">
                        Unprotected
                      </span>
                    ) : t.deposit_scheme ? (
                      <span className="text-xs uppercase text-gray-400">{t.deposit_scheme}</span>
                    ) : (
                      <span className="text-xs text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {t.tenant_confirmed_at ? (
                      <span className="text-xs text-green-400">✓ {fmtDate(t.tenant_confirmed_at)}</span>
                    ) : (
                      <span className="text-xs text-yellow-400">Pending</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {(t.open_alerts ?? 0) > 0 ? (
                      <span className="rounded bg-red-900/50 px-2 py-0.5 font-mono text-xs text-red-300">
                        {t.open_alerts}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs text-gray-600">
        <Link href="/admin" className="hover:text-gray-400">← Back to overview</Link>
      </p>
    </div>
  );
}
