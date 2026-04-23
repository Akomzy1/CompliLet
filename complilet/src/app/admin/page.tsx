import Link from "next/link";
import {
  Users,
  Home as HomeIcon,
  PoundSterling,
  AlertTriangle,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  LANDLORD_PLAN_VALUES,
  PLAN_LABEL,
  PLAN_MONTHLY_PENCE,
  SUBSCRIPTION_PLANS,
  formatGbp,
  type LandlordPlan,
} from "@/lib/admin-plans";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ── Types ───────────────────────────────────────────────────────────────────

interface LandlordRow {
  id: string;
  plan: string;
  created_at: string;
}

interface AlertQueueItem {
  id: string;
  source: "escalation" | "compliance";
  priority: "urgent" | "high" | "normal" | "critical" | "medium" | "low";
  label: string;
  landlord_name: string | null;
  created_at: string;
  href: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function daysAgo(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86_400_000);
}

function fmtRelative(iso: string): string {
  const d = daysAgo(iso);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

const PRIORITY_PILL: Record<string, string> = {
  urgent:   "bg-red-50 text-red-700 border-red-200",
  critical: "bg-red-50 text-red-700 border-red-200",
  high:     "bg-amber-50 text-amber-700 border-amber-200",
  normal:   "bg-admin-cream text-admin-mute border-admin-line",
  medium:   "bg-amber-50 text-amber-700 border-amber-200",
  low:      "bg-admin-cream text-admin-mute border-admin-line",
};

function triggerLabel(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Data loaders ────────────────────────────────────────────────────────────

async function loadOverview() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();

  const [
    landlordsRes,
    activeTenanciesRes,
    escalationsRes,
    complianceRes,
    screeningsRes,
  ] = await Promise.all([
    supabaseAdmin.from("landlords").select("id, plan, created_at"),
    supabaseAdmin
      .from("tenancies")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabaseAdmin
      .from("escalations")
      .select("id, sender_phone, trigger_type, priority, status, landlord_id, created_at")
      .in("status", ["open", "in_progress"])
      .order("created_at", { ascending: true })
      .limit(50),
    supabaseAdmin
      .from("compliance_alerts")
      .select("id, alert_type, severity, resolved, tenancy_id, created_at")
      .eq("resolved", false)
      .order("created_at", { ascending: true })
      .limit(50),
    supabaseAdmin
      .from("screening_sessions")
      .select("id, status, current_step, created_at"),
  ]);

  const landlords: LandlordRow[] = (landlordsRes.data ?? []) as LandlordRow[];
  const escalations = escalationsRes.data ?? [];
  const compliance = complianceRes.data ?? [];
  const screenings = screeningsRes.data ?? [];

  const activeLandlords = landlords.length;
  const newLast30 = landlords.filter((l) => l.created_at > thirtyDaysAgo).length;
  const newPrev30 = landlords.filter(
    (l) => l.created_at > sixtyDaysAgo && l.created_at <= thirtyDaysAgo,
  ).length;
  const landlordDelta = newLast30 - newPrev30;

  const planMix: Record<LandlordPlan, number> = {
    free_trial: 0,
    pay_per_screen: 0,
    landlord_pro: 0,
    tenancy_manager: 0,
    portfolio: 0,
    global_landlord: 0,
  };
  for (const l of landlords) {
    const plan = (LANDLORD_PLAN_VALUES as readonly string[]).includes(l.plan)
      ? (l.plan as LandlordPlan)
      : "free_trial";
    planMix[plan] += 1;
  }

  let mrrPence = 0;
  for (const plan of Object.keys(planMix) as LandlordPlan[]) {
    if (SUBSCRIPTION_PLANS.has(plan)) {
      mrrPence += planMix[plan] * PLAN_MONTHLY_PENCE[plan];
    }
  }

  const criticalCount =
    escalations.filter((e) => e.priority === "urgent").length +
    compliance.filter((c) => c.severity === "critical").length;
  const totalOpenAlerts = escalations.length + compliance.length;

  const landlordIds = [
    ...new Set(escalations.map((e) => e.landlord_id).filter(Boolean)),
  ] as string[];
  const landlordNames = new Map<string, string>();
  if (landlordIds.length > 0) {
    const { data } = await supabaseAdmin
      .from("landlords")
      .select("id, name")
      .in("id", landlordIds);
    for (const l of data ?? []) {
      if (l.name) landlordNames.set(l.id, l.name);
    }
  }

  const PRIORITY_WEIGHT: Record<string, number> = {
    urgent: 0,
    critical: 0,
    high: 1,
    medium: 2,
    normal: 3,
    low: 4,
  };

  const queue: AlertQueueItem[] = [
    ...escalations.map((e) => ({
      id: e.id,
      source: "escalation" as const,
      priority: (e.priority ?? "normal") as AlertQueueItem["priority"],
      label: triggerLabel(e.trigger_type ?? "Escalation"),
      landlord_name: e.landlord_id ? landlordNames.get(e.landlord_id) ?? null : null,
      created_at: e.created_at,
      href: `/admin/alerts/${e.id}`,
    })),
    ...compliance.map((c) => ({
      id: c.id,
      source: "compliance" as const,
      priority: (c.severity ?? "medium") as AlertQueueItem["priority"],
      label: triggerLabel(c.alert_type ?? "Compliance alert"),
      landlord_name: null,
      created_at: c.created_at,
      href: `/admin/alerts`,
    })),
  ]
    .sort((a, b) => {
      const pw =
        (PRIORITY_WEIGHT[a.priority] ?? 99) - (PRIORITY_WEIGHT[b.priority] ?? 99);
      if (pw !== 0) return pw;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    })
    .slice(0, 5);

  const screeningBreakdown = screenings.reduce<Record<string, number>>((acc, s) => {
    const key = s.status ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return {
    activeLandlords,
    landlordDelta,
    newLast30,
    activeTenancies: activeTenanciesRes.count ?? 0,
    mrrPence,
    totalOpenAlerts,
    criticalCount,
    planMix,
    queue,
    screeningBreakdown,
    totalScreenings: screenings.length,
  };
}

// ── UI Primitives ───────────────────────────────────────────────────────────

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-admin-line bg-white p-6 shadow-card ${className}`}
    >
      {children}
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  delta,
  sub,
  tone = "neutral",
}: {
  icon: typeof Users;
  label: string;
  value: string;
  delta?: { value: number; suffix?: string } | null;
  sub?: string;
  tone?: "neutral" | "danger";
}) {
  const deltaUp = (delta?.value ?? 0) > 0;
  const deltaDown = (delta?.value ?? 0) < 0;

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
            tone === "danger"
              ? "bg-red-50 text-red-700"
              : "bg-admin-cream text-admin-ink"
          }`}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        {delta && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              deltaUp
                ? "bg-green-50 text-admin-teal"
                : deltaDown
                ? "bg-red-50 text-red-700"
                : "bg-admin-cream text-admin-mute"
            }`}
          >
            {deltaUp && <TrendingUp className="h-3 w-3" aria-hidden />}
            {deltaDown && <TrendingDown className="h-3 w-3" aria-hidden />}
            {deltaUp ? "+" : ""}
            {delta.value}
            {delta.suffix ?? ""}
          </span>
        )}
      </div>
      <p className="text-sm font-medium text-admin-mute">{label}</p>
      <p
        className={`mt-1 font-display text-3xl font-semibold ${
          tone === "danger" && value !== "0" ? "text-red-700" : "text-admin-ink"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-admin-mute">{sub}</p>}
    </Card>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function AdminOverviewPage() {
  const data = await loadOverview();
  const totalLandlordsForMix = Math.max(1, data.activeLandlords);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold text-admin-ink">
          Overview
        </h1>
        <p className="mt-1 text-sm text-admin-mute">
          Platform health, alerts, and portfolio pulse.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          icon={Users}
          label="Active landlords"
          value={data.activeLandlords.toLocaleString()}
          delta={{ value: data.landlordDelta, suffix: "/mo" }}
          sub={`${data.newLast30} new in last 30 days`}
        />
        <MetricTile
          icon={HomeIcon}
          label="Active tenancies"
          value={data.activeTenancies.toLocaleString()}
          sub="Currently under management"
        />
        <MetricTile
          icon={PoundSterling}
          label="MRR (estimate)"
          value={formatGbp(data.mrrPence)}
          sub="From recurring subscriptions"
        />
        <MetricTile
          icon={AlertTriangle}
          label="Open alerts"
          value={data.totalOpenAlerts.toLocaleString()}
          sub={
            data.criticalCount > 0
              ? `${data.criticalCount} critical / urgent`
              : "Nothing critical"
          }
          tone={data.criticalCount > 0 ? "danger" : "neutral"}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-semibold text-admin-ink">
                Alert queue
              </h2>
              <p className="text-xs text-admin-mute">
                Top 5 by severity, then oldest first.
              </p>
            </div>
            <Link
              href="/admin/alerts"
              className="inline-flex items-center gap-1 text-sm font-medium text-admin-teal hover:underline"
            >
              View all
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>

          {data.queue.length === 0 ? (
            <div className="rounded-xl border border-dashed border-admin-line bg-admin-cream px-6 py-12 text-center text-sm text-admin-mute">
              No open alerts. Platform is quiet.
            </div>
          ) : (
            <ul className="divide-y divide-admin-line">
              {data.queue.map((item) => (
                <li key={`${item.source}-${item.id}`}>
                  <Link
                    href={item.href}
                    className="group flex items-center gap-4 py-3 transition hover:bg-admin-cream/60"
                  >
                    <span
                      className={`inline-flex min-w-[70px] justify-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                        PRIORITY_PILL[item.priority] ?? PRIORITY_PILL.normal
                      }`}
                    >
                      {item.priority}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-admin-ink">
                        {item.label}
                      </p>
                      <p className="truncate text-xs text-admin-mute">
                        {item.landlord_name ?? "Unassigned"} ·{" "}
                        {item.source === "escalation" ? "Escalation" : "Compliance"}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-admin-mute">
                      {fmtRelative(item.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-4 font-display text-lg font-semibold text-admin-ink">
              Active screenings
            </h2>
            {data.totalScreenings === 0 ? (
              <p className="text-sm text-admin-mute">No screenings recorded yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {Object.entries(data.screeningBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([status, count]) => {
                    const pct = Math.round((count / data.totalScreenings) * 100);
                    return (
                      <li key={status}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="font-medium capitalize text-admin-ink">
                            {status.replace(/_/g, " ")}
                          </span>
                          <span className="text-admin-mute">
                            {count} · {pct}%
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-admin-cream">
                          <div
                            className="h-full rounded-full bg-admin-teal"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-4 font-display text-lg font-semibold text-admin-ink">
              Plan mix
            </h2>
            <ul className="space-y-2.5">
              {LANDLORD_PLAN_VALUES.filter((p) => data.planMix[p] > 0).map((plan) => {
                const count = data.planMix[plan];
                const pct = Math.round((count / totalLandlordsForMix) * 100);
                const subscription = SUBSCRIPTION_PLANS.has(plan);
                return (
                  <li key={plan}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium text-admin-ink">
                        {PLAN_LABEL[plan]}
                      </span>
                      <span className="text-admin-mute">
                        {count} · {pct}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-admin-cream">
                      <div
                        className={`h-full rounded-full ${
                          subscription ? "bg-admin-teal" : "bg-admin-nav-active"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <h2 className="mb-2 font-display text-lg font-semibold text-admin-ink">
              API spend (this month)
            </h2>
            <p className="text-sm text-admin-mute">
              Connect OpenAI and Stripe billing in Settings to see live API and
              infrastructure spend. Until then, check each provider&apos;s
              dashboard directly.
            </p>
            <Link
              href="/admin/settings"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-admin-teal hover:underline"
            >
              Go to settings
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
