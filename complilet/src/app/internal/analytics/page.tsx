import { supabaseAdmin } from "@/lib/supabase-admin";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function triggerLabel(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <p className="mb-1 text-xs uppercase tracking-wide text-gray-600">{label}</p>
      <p className="text-3xl font-semibold text-gray-100">{value}</p>
      {sub && <p className="mt-1 text-sm text-gray-500">{sub}</p>}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default async function AnalyticsPage() {
  // Fetch all data in parallel
  const [
    { data: sessions },
    { data: escalations },
    { data: messages },
    { data: nrlEvents },
  ] = await Promise.all([
    supabaseAdmin.from("screening_sessions").select("id, status, created_at, updated_at"),
    supabaseAdmin.from("escalations").select("id, trigger_type, priority, status, created_at"),
    supabaseAdmin.from("screening_messages").select("id, role, created_at"),
    supabaseAdmin.from("nrl_events").select("id, event_type, created_at"),
  ]);

  const allSessions   = sessions    ?? [];
  const allEscs       = escalations ?? [];
  const allMessages   = messages    ?? [];
  const allNrlEvents  = nrlEvents   ?? [];

  // ── Session stats ────────────────────────────────────────────────────────
  const totalSessions     = allSessions.length;
  const activeSessions    = allSessions.filter((s) => s.status === "active").length;
  const completedSessions = allSessions.filter((s) => s.status === "completed").length;

  // Avg completion time (seconds) for completed sessions
  const completionTimes = allSessions
    .filter((s) => s.status === "completed")
    .map((s) => (new Date(s.updated_at).getTime() - new Date(s.created_at).getTime()) / 1000)
    .filter((t) => t > 0 && t < 86400 * 7); // ignore outliers > 7 days
  const avgCompletionSecs =
    completionTimes.length > 0
      ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
      : 0;

  // ── Escalation stats ─────────────────────────────────────────────────────
  const totalEscalations  = allEscs.length;
  const openEscalations   = allEscs.filter((e) => e.status === "open").length;
  const urgentEscalations = allEscs.filter((e) => e.priority === "urgent").length;
  const escalationRate    =
    totalSessions > 0 ? ((totalEscalations / totalSessions) * 100).toFixed(1) : "0.0";

  // Top trigger types
  const triggerCounts = allEscs.reduce<Record<string, number>>((acc, e) => {
    acc[e.trigger_type] = (acc[e.trigger_type] ?? 0) + 1;
    return acc;
  }, {});
  const topTriggers = Object.entries(triggerCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);
  const maxTriggerCount = topTriggers[0]?.[1] ?? 1;

  // ── Message stats ────────────────────────────────────────────────────────
  const totalMessages  = allMessages.length;
  const tenantMessages = allMessages.filter((m) => m.role === "user").length;
  const agentMessages  = allMessages.filter((m) => m.role === "assistant").length;

  // ── NRL stats ─────────────────────────────────────────────────────────────
  const overseasDetected  = allNrlEvents.filter((e) => e.event_type === "confirmed_overseas").length;
  const nrl1Submitted     = allNrlEvents.filter((e) => e.event_type === "nrl1_submitted").length;

  // ── 30-day trend: sessions created per day ───────────────────────────────
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentSessions = allSessions.filter(
    (s) => new Date(s.created_at) >= thirtyDaysAgo,
  );
  const sessionsByDay = recentSessions.reduce<Record<string, number>>((acc, s) => {
    const day = s.created_at.slice(0, 10);
    acc[day] = (acc[day] ?? 0) + 1;
    return acc;
  }, {});
  const trendEntries = Object.entries(sessionsByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14); // last 14 days shown
  const maxTrendCount = Math.max(...trendEntries.map(([, v]) => v), 1);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-100">Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">Live snapshot — refreshes on page load</p>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────────── */}
      <section className="mb-10">
        <p className="mb-4 text-xs uppercase tracking-widest text-gray-600">Sessions</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Total"     value={totalSessions}     />
          <StatCard label="Active"    value={activeSessions}    />
          <StatCard label="Completed" value={completedSessions} />
          <StatCard
            label="Avg completion"
            value={avgCompletionSecs > 0 ? fmtDuration(avgCompletionSecs) : "—"}
            sub={completionTimes.length > 0 ? `${completionTimes.length} sessions` : undefined}
          />
        </div>
      </section>

      <section className="mb-10">
        <p className="mb-4 text-xs uppercase tracking-widest text-gray-600">Escalations</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Total"          value={totalEscalations}                />
          <StatCard label="Open"           value={openEscalations}                 />
          <StatCard label="Urgent"         value={urgentEscalations}               />
          <StatCard label="Escalation rate" value={`${escalationRate}%`}           sub="per session" />
        </div>
      </section>

      <section className="mb-10">
        <p className="mb-4 text-xs uppercase tracking-widest text-gray-600">Messages</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label="Total messages"  value={totalMessages}  />
          <StatCard label="Tenant messages" value={tenantMessages} />
          <StatCard label="Agent responses" value={agentMessages}  />
        </div>
      </section>

      <section className="mb-10">
        <p className="mb-4 text-xs uppercase tracking-widest text-gray-600">NRL (Non-Resident Landlord)</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label="Overseas detected"  value={overseasDetected} />
          <StatCard label="NRL1 submitted"     value={nrl1Submitted}    />
          <StatCard
            label="NRL1 conversion"
            value={overseasDetected > 0 ? `${((nrl1Submitted / overseasDetected) * 100).toFixed(0)}%` : "—"}
          />
        </div>
      </section>

      {/* ── Top triggers ───────────────────────────────────────────────── */}
      {topTriggers.length > 0 && (
        <section className="mb-10">
          <p className="mb-4 text-xs uppercase tracking-widest text-gray-600">Top escalation triggers</p>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-3">
            {topTriggers.map(([trigger, count]) => (
              <div key={trigger} className="flex items-center gap-3">
                <div className="w-40 shrink-0 text-sm text-gray-400">{triggerLabel(trigger)}</div>
                <div className="flex-1 overflow-hidden rounded-full bg-gray-800 h-2">
                  <div
                    className="h-2 rounded-full bg-teal-600"
                    style={{ width: `${(count / maxTriggerCount) * 100}%` }}
                  />
                </div>
                <div className="w-8 text-right text-sm font-medium text-gray-300">{count}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 14-day session trend ────────────────────────────────────────── */}
      {trendEntries.length > 0 && (
        <section className="mb-10">
          <p className="mb-4 text-xs uppercase tracking-widest text-gray-600">Sessions — last 14 days</p>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-end gap-1.5 h-32">
              {trendEntries.map(([day, count]) => (
                <div key={day} className="flex flex-1 flex-col items-center gap-1 group">
                  <div
                    className="w-full rounded-t bg-teal-600/70 transition group-hover:bg-teal-500"
                    style={{ height: `${(count / maxTrendCount) * 100}%`, minHeight: "4px" }}
                    title={`${day}: ${count}`}
                  />
                  <span className="text-[10px] text-gray-700 rotate-45 origin-left whitespace-nowrap">
                    {day.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
