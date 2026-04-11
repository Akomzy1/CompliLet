import { Suspense } from "react";
import { format, subDays, startOfWeek, parseISO, startOfMonth } from "date-fns";
import { supabaseAdmin } from "@/lib/supabase-server";
import { fetchMRR, fetchPayPerScreenRevenue } from "@/lib/stripe";
import { formatPence, formatNumber, formatDateTime, formatRelativeTime } from "@/lib/format";
import { MetricCard } from "@/components/ui/MetricCard";
import { SectionCard } from "@/components/ui/PageHeader";
import { SignUpTrendChart } from "@/components/charts/SignUpTrendChart";
import { ScreeningsBarChart } from "@/components/charts/ScreeningsBarChart";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

// ─── Data helpers ──────────────────────────────────────────────────────────────
async function getDashboardMetrics() {
  const now = new Date();
  const weekAgo = subDays(now, 7).toISOString();
  const monthStart = startOfMonth(now).toISOString();

  const [
    { count: totalLandlords },
    { count: newThisWeek },
    { count: activeScreenings },
    { count: completedThisMonth },
    { count: activeTenancies },
    { data: escalationRows },
    mrrData,
    payPerScreenRevenue,
  ] = await Promise.all([
    supabaseAdmin.from("landlords").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("landlords").select("*", { count: "exact", head: true }).gte("created_at", weekAgo),
    supabaseAdmin.from("screening_sessions").select("*", { count: "exact", head: true }).not("status", "in", "(completed,cancelled)"),
    supabaseAdmin.from("screening_sessions").select("*", { count: "exact", head: true }).eq("status", "completed").gte("created_at", monthStart),
    supabaseAdmin.from("tenancies").select("*", { count: "exact", head: true }).eq("status", "active").then((r) => ({ count: r.count ?? 0 })).catch(() => ({ count: 0 })),
    supabaseAdmin.from("escalations").select("priority, status").in("status", ["open", "in_progress"]),
    fetchMRR(),
    fetchPayPerScreenRevenue(),
  ]);

  const openEscalations = escalationRows?.length ?? 0;
  const urgentEscalations = escalationRows?.filter((e) => e.priority === "urgent").length ?? 0;
  const mrr = mrrData.mrr + payPerScreenRevenue;

  return {
    totalLandlords: totalLandlords ?? 0,
    newThisWeek: newThisWeek ?? 0,
    activeScreenings: activeScreenings ?? 0,
    completedThisMonth: completedThisMonth ?? 0,
    activeTenancies: activeTenancies ?? 0,
    openEscalations,
    urgentEscalations,
    mrr,
  };
}

async function getSignUpTrend() {
  const since = subDays(new Date(), 30).toISOString();
  const { data } = await supabaseAdmin
    .from("landlords")
    .select("created_at")
    .gte("created_at", since)
    .order("created_at");

  if (!data?.length) return [];

  const counts: Record<string, number> = {};
  for (const row of data) {
    const day = format(parseISO(row.created_at), "d MMM");
    counts[day] = (counts[day] ?? 0) + 1;
  }

  // Fill all 30 days including zeros
  const result = [];
  for (let i = 29; i >= 0; i--) {
    const day = format(subDays(new Date(), i), "d MMM");
    result.push({ label: day, count: counts[day] ?? 0 });
  }
  return result;
}

async function getScreeningsTrend() {
  const since = subDays(new Date(), 84).toISOString(); // 12 weeks
  const { data } = await supabaseAdmin
    .from("screening_sessions")
    .select("created_at")
    .eq("status", "completed")
    .gte("created_at", since)
    .order("created_at");

  if (!data?.length) return [];

  const counts: Record<string, number> = {};
  for (const row of data) {
    const weekStart = format(startOfWeek(parseISO(row.created_at), { weekStartsOn: 1 }), "d MMM");
    counts[weekStart] = (counts[weekStart] ?? 0) + 1;
  }

  const result = [];
  for (let i = 11; i >= 0; i--) {
    const weekStart = format(startOfWeek(subDays(new Date(), i * 7), { weekStartsOn: 1 }), "d MMM");
    result.push({ week: weekStart, completed: counts[weekStart] ?? 0 });
  }
  return result;
}

async function getNeedsAttention() {
  const sevenDaysAgo = subDays(new Date(), 7).toISOString();

  const [
    { data: overdueEscalations },
    { data: overdueDates },
  ] = await Promise.all([
    supabaseAdmin
      .from("escalations")
      .select("id, type, priority, created_at, landlords(name)")
      .in("status", ["open", "in_progress"])
      .eq("priority", "urgent")
      .limit(5),
    supabaseAdmin
      .from("compliance_deadlines")
      .select("id, deadline_type, due_date, properties(address)")
      .lt("due_date", new Date().toISOString())
      .eq("status", "pending")
      .limit(5)
      .catch(() => ({ data: [] })),
  ]);

  return {
    overdueEscalations: overdueEscalations ?? [],
    overdueDates: overdueDates ?? [],
  };
}

async function getActivityFeed() {
  const since = subDays(new Date(), 1).toISOString();

  const [
    { data: recentScreenings },
    { data: recentEscalations },
    { data: recentLandlords },
  ] = await Promise.all([
    supabaseAdmin
      .from("screening_sessions")
      .select("id, status, created_at, landlords(name)")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10),
    supabaseAdmin
      .from("escalations")
      .select("id, type, priority, created_at, landlords(name)")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10),
    supabaseAdmin
      .from("landlords")
      .select("id, name, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  type ActivityItem = {
    id: string;
    type: string;
    label: string;
    created_at: string;
    colour: string;
    href?: string;
  };

  const items: ActivityItem[] = [
    ...(recentLandlords ?? []).map((l) => ({
      id: `landlord-${l.id}`,
      type: "New Landlord",
      label: l.name ?? "Unknown",
      created_at: l.created_at,
      colour: "bg-teal-100 text-teal-800",
      href: `/internal/landlords/${l.id}`,
    })),
    ...(recentScreenings ?? []).map((s) => ({
      id: `screening-${s.id}`,
      type: s.status === "completed" ? "Screening Completed" : "Screening Started",
      label: (s.landlords as { name?: string } | null)?.name ?? "Unknown landlord",
      created_at: s.created_at,
      colour: s.status === "completed" ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800",
      href: `/internal/screenings/${s.id}`,
    })),
    ...(recentEscalations ?? []).map((e) => ({
      id: `escalation-${e.id}`,
      type: "Escalation Triggered",
      label: `${e.type ?? "escalation"} — ${(e.landlords as { name?: string } | null)?.name ?? "Unknown"}`,
      created_at: e.created_at,
      colour: e.priority === "urgent" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800",
      href: `/internal/escalations`,
    })),
  ];

  return items
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 20);
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default async function DashboardPage() {
  const [metrics, signUpTrend, screeningsTrend, attention, activity] =
    await Promise.all([
      getDashboardMetrics(),
      getSignUpTrend(),
      getScreeningsTrend(),
      getNeedsAttention(),
      getActivityFeed(),
    ]);

  return (
    <div>
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">
          {format(new Date(), "EEEE d MMMM yyyy")} — Live platform overview
        </p>
      </div>

      <div className="p-6 space-y-6">
        {/* ── Metric cards ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
          <MetricCard
            title="Total Landlords"
            value={formatNumber(metrics.totalLandlords)}
            badge={`+${metrics.newThisWeek} this week`}
            badgeColour="green"
          />
          <MetricCard
            title="Active Screenings"
            value={formatNumber(metrics.activeScreenings)}
            subtext="In progress right now"
          />
          <MetricCard
            title="Completed (this month)"
            value={formatNumber(metrics.completedThisMonth)}
            subtext="Screenings completed"
          />
          <MetricCard
            title="Active Tenancies"
            value={formatNumber(metrics.activeTenancies)}
            subtext="Currently managed"
          />
          <MetricCard
            title="MRR"
            value={formatPence(metrics.mrr)}
            subtext="Subscriptions + pay-per-screen"
          />
          <MetricCard
            title="Open Escalations"
            value={formatNumber(metrics.openEscalations)}
            badge={metrics.urgentEscalations > 0 ? `${metrics.urgentEscalations} urgent` : undefined}
            badgeColour={metrics.urgentEscalations > 0 ? "red" : "gray"}
          />
        </div>

        {/* ── Charts ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <SectionCard title="Landlord Sign-ups (last 30 days)">
            <div className="h-52 px-4 pb-4">
              <SignUpTrendChart data={signUpTrend} title="" />
            </div>
          </SectionCard>
          <SectionCard title="Screenings Completed (last 12 weeks)">
            <div className="h-52 px-4 pb-4">
              <ScreeningsBarChart data={screeningsTrend} />
            </div>
          </SectionCard>
        </div>

        {/* ── Bottom panels ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Needs Attention */}
          <SectionCard title="⚠️ Needs Attention">
            <div className="p-4 space-y-3">
              {attention.overdueEscalations.length === 0 &&
                attention.overdueDates.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">All clear — nothing needs attention</p>
              ) : (
                <>
                  {attention.overdueEscalations.map((e) => (
                    <a
                      key={e.id}
                      href="/internal/escalations"
                      className="flex items-start gap-3 rounded-lg bg-red-50 border border-red-100 p-3 hover:bg-red-100 transition-colors"
                    >
                      <span className="text-red-600 text-sm font-semibold mt-0.5">🚨</span>
                      <div>
                        <p className="text-sm font-medium text-red-800">Urgent escalation</p>
                        <p className="text-xs text-red-600">
                          {(e.landlords as { name?: string } | null)?.name ?? "Unknown"} —{" "}
                          {e.type ?? "unspecified"} — {formatRelativeTime(e.created_at)}
                        </p>
                      </div>
                    </a>
                  ))}
                  {attention.overdueDates.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-100 p-3"
                    >
                      <span className="text-amber-600 text-sm">⏰</span>
                      <div>
                        <p className="text-sm font-medium text-amber-800">
                          Overdue: {d.deadline_type}
                        </p>
                        <p className="text-xs text-amber-600">
                          {(d.properties as { address?: string } | null)?.address ?? "Unknown property"} — due{" "}
                          {formatDateTime(d.due_date)}
                        </p>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </SectionCard>

          {/* Today's Activity */}
          <SectionCard title="Today's Activity">
            <div className="divide-y divide-gray-50">
              {activity.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No activity today yet</p>
              ) : (
                activity.map((item) => (
                  <a
                    key={item.id}
                    href={item.href ?? "#"}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
                  >
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${item.colour}`}
                    >
                      {item.type}
                    </span>
                    <p className="text-sm text-gray-700 flex-1 truncate">{item.label}</p>
                    <p className="text-xs text-gray-400 whitespace-nowrap">
                      {formatRelativeTime(item.created_at)}
                    </p>
                  </a>
                ))
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
