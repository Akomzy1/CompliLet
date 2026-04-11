import { subDays, format, parseISO } from "date-fns";
import { supabaseAdmin } from "@/lib/supabase-server";
import { PageHeader, SectionCard } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AGENT_LABELS } from "@/lib/constants";
import { AgentCostChart } from "@/components/charts/AgentCostChart";
import { EscalationReasonsChart } from "@/components/charts/EscalationReasonsChart";

export const metadata = { title: "AI Agents" };
export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const thirtyDaysAgo = subDays(new Date(), 30).toISOString();

  const [
    { data: monthlyLogs },
    { data: recentLogs },
    { data: escalationReasons },
  ] = await Promise.all([
    supabaseAdmin
      .from("agent_logs")
      .select("id, agent_type, input_tokens, output_tokens, cost_estimate, created_at, session_id")
      .gte("created_at", monthStart),
    supabaseAdmin
      .from("agent_logs")
      .select("id, cost_estimate, created_at")
      .gte("created_at", thirtyDaysAgo)
      .order("created_at"),
    supabaseAdmin
      .from("escalations")
      .select("type, trigger_type")
      .gte("created_at", monthStart)
      .catch(() => ({ data: [] })),
  ]);

  // ── Month totals ──────────────────────────────────────────────────────────────
  const totalCalls = (monthlyLogs ?? []).length;
  const totalInputTokens = (monthlyLogs ?? []).reduce((s, l) => s + (l.input_tokens ?? 0), 0);
  const totalOutputTokens = (monthlyLogs ?? []).reduce((s, l) => s + (l.output_tokens ?? 0), 0);
  const totalCost = (monthlyLogs ?? []).reduce((s, l) => s + (l.cost_estimate ?? 0), 0);

  // ── Per-agent breakdown ───────────────────────────────────────────────────────
  const agentStats: Record<string, { calls: number; inputTokens: number; outputTokens: number; cost: number; escalations: number }> = {};
  for (const log of monthlyLogs ?? []) {
    const type = log.agent_type ?? "unknown";
    if (!agentStats[type]) {
      agentStats[type] = { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0, escalations: 0 };
    }
    agentStats[type].calls++;
    agentStats[type].inputTokens += log.input_tokens ?? 0;
    agentStats[type].outputTokens += log.output_tokens ?? 0;
    agentStats[type].cost += log.cost_estimate ?? 0;
  }

  // Escalation rate per agent would need session-level data — we approximate from session count
  const { data: screeningSessions } = await supabaseAdmin
    .from("screening_sessions")
    .select("id", { count: "exact", head: false })
    .gte("created_at", monthStart)
    .eq("status", "completed")
    .catch(() => ({ data: [], count: 0 }));

  const completedCount = (screeningSessions ?? []).length || 1; // avoid div-by-zero
  const costPerScreening = totalCost / completedCount;

  // ── Daily cost chart ──────────────────────────────────────────────────────────
  const dailyCosts: Record<string, number> = {};
  for (const log of recentLogs ?? []) {
    const day = format(parseISO(log.created_at), "d MMM");
    dailyCosts[day] = (dailyCosts[day] ?? 0) + (log.cost_estimate ?? 0);
  }
  const costChartData = [];
  for (let i = 29; i >= 0; i--) {
    const day = format(subDays(new Date(), i), "d MMM");
    costChartData.push({ date: day, cost: dailyCosts[day] ?? 0, calls: 0 });
  }

  // ── Escalation reasons ────────────────────────────────────────────────────────
  const reasonCounts: Record<string, number> = {};
  for (const e of escalationReasons ?? []) {
    const key = e.trigger_type ?? e.type ?? "unknown";
    reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
  }
  const escalationReasonsData = Object.entries(reasonCounts).map(([reason, count]) => ({
    reason,
    count,
  }));

  const sortedAgents = Object.entries(agentStats).sort((a, b) => b[1].calls - a[1].calls);

  return (
    <div>
      <PageHeader
        title="AI Agent Performance"
        description={`This month: ${totalCalls.toLocaleString()} API calls · est. $${totalCost.toFixed(2)}`}
      />

      <div className="p-6 space-y-5">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "API Calls (this month)", value: totalCalls.toLocaleString() },
            { label: "Total Tokens", value: (totalInputTokens + totalOutputTokens).toLocaleString() },
            { label: "Est. Cost", value: `$${totalCost.toFixed(2)}` },
            { label: "Cost per Screening", value: `$${costPerScreening.toFixed(4)}` },
          ].map((m) => (
            <div key={m.label} className="bg-white rounded-lg border border-gray-200 px-5 py-4 shadow-sm">
              <p className="text-xs text-gray-500">{m.label}</p>
              <p className="text-2xl font-bold text-gray-900">{m.value}</p>
            </div>
          ))}
        </div>

        {/* Breakdown table */}
        <SectionCard title="Breakdown by Agent Type">
          <div className="table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Calls</th>
                  <th>Avg Input Tokens</th>
                  <th>Avg Output Tokens</th>
                  <th>Total Cost</th>
                  <th>% of Total</th>
                </tr>
              </thead>
              <tbody>
                {!sortedAgents.length ? (
                  <tr><td colSpan={6}><EmptyState message="No agent logs this month." /></td></tr>
                ) : (
                  sortedAgents.map(([type, stats]) => (
                    <tr key={type}>
                      <td className="font-medium">
                        {AGENT_LABELS[type] ?? type.replace(/_/g, " ")}
                      </td>
                      <td>{stats.calls.toLocaleString()}</td>
                      <td className="text-gray-500">
                        {stats.calls > 0 ? Math.round(stats.inputTokens / stats.calls).toLocaleString() : "—"}
                      </td>
                      <td className="text-gray-500">
                        {stats.calls > 0 ? Math.round(stats.outputTokens / stats.calls).toLocaleString() : "—"}
                      </td>
                      <td className="font-medium">${stats.cost.toFixed(4)}</td>
                      <td className="text-gray-500">
                        {totalCost > 0 ? `${((stats.cost / totalCost) * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {/* Charts */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <SectionCard title="Daily API Cost (last 30 days)">
            <div className="h-52 px-4 pb-4">
              <AgentCostChart data={costChartData} />
            </div>
          </SectionCard>

          <SectionCard title="Escalation Triggers (this month)">
            <div className="h-52">
              <EscalationReasonsChart data={escalationReasonsData} />
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
