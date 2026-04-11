import { subDays } from "date-fns";
import { supabaseAdmin } from "@/lib/supabase-server";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { PageHeader, SectionCard } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata = { title: "System Health" };
export const dynamic = "force-dynamic";

// Known cron jobs
const CRON_JOBS = [
  { name: "complilet_compliance_autopilot", label: "Compliance Autopilot", schedule: "Daily 9:00 AM" },
  { name: "complilet_rent_monitor", label: "Rent Monitor", schedule: "Daily 8:00 AM" },
  { name: "complilet_inspection", label: "Inspection Trigger", schedule: "Daily 9:30 AM" },
  { name: "complilet_renewal", label: "Renewal Agent", schedule: "Daily 8:15 AM" },
  { name: "complilet_ref_chaser", label: "Reference Chaser", schedule: "4x daily" },
  { name: "complilet_maintenance_followup", label: "Maintenance Follow-up", schedule: "Daily 10:00 AM" },
  { name: "complilet_nrl_tax", label: "NRL Tax Agent", schedule: "Daily 7:00 AM" },
  { name: "complilet_daily_admin_summary", label: "Admin Daily Summary", schedule: "Daily 8:00 PM" },
];

export default async function SystemPage() {
  const oneDayAgo = subDays(new Date(), 1).toISOString();
  const sevenDaysAgo = subDays(new Date(), 7).toISOString();

  const [
    { data: recentMessages },
    { data: recentErrors },
    { data: tableCounts },
    { data: cronJobRuns },
  ] = await Promise.all([
    // Recent WhatsApp messages — check delivery status
    supabaseAdmin
      .from("messages")
      .select("id, direction, delivery_status, created_at")
      .gte("created_at", oneDayAgo)
      .order("created_at", { ascending: false })
      .limit(200),

    // Recent errors from agent_logs
    supabaseAdmin
      .from("agent_logs")
      .select("id, agent_type, error_message, created_at")
      .not("error_message", "is", null)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(50)
      .catch(() => ({ data: [] })),

    // Row counts for key tables
    Promise.all([
      "landlords",
      "screening_sessions",
      "messages",
      "tenancies",
      "escalations",
      "agent_logs",
      "properties",
    ].map(async (table) => {
      const { count } = await supabaseAdmin
        .from(table)
        .select("*", { count: "exact", head: true })
        .catch(() => ({ count: 0 }));
      return { table, count: count ?? 0 };
    })),

    // Cron job last runs — from pg_cron
    supabaseAdmin
      .rpc("get_cron_job_status")
      .catch(() => ({ data: [] })),
  ]);

  // ── WhatsApp delivery stats ───────────────────────────────────────────────────
  type MsgRow = { id: string; direction: string; delivery_status: string | null; created_at: string };
  const msgs = (recentMessages ?? []) as MsgRow[];
  const outboundMessages = msgs.filter((m) => m.direction === "outbound");
  const deliveredCount = outboundMessages.filter((m) => m.delivery_status === "delivered" || m.delivery_status === "read").length;
  const readCount = outboundMessages.filter((m) => m.delivery_status === "read").length;
  const failedMessages = outboundMessages.filter((m) => m.delivery_status === "failed");
  const deliveryRate = outboundMessages.length > 0
    ? Math.round((deliveredCount / outboundMessages.length) * 100)
    : null;

  return (
    <div>
      <PageHeader title="System Health" description="Platform status and operational metrics" />

      <div className="p-6 space-y-5">
        {/* WhatsApp delivery stats */}
        <SectionCard title="WhatsApp API — Last 24 Hours">
          <div className="grid grid-cols-4 gap-4 p-4 border-b border-gray-100">
            <Stat label="Messages Sent" value={outboundMessages.length} />
            <Stat label="Delivered" value={deliveredCount} />
            <Stat label="Read" value={readCount} />
            <Stat
              label="Delivery Rate"
              value={deliveryRate != null ? `${deliveryRate}%` : "—"}
              colour={deliveryRate != null && deliveryRate >= 95 ? "text-green-700" : "text-amber-700"}
            />
          </div>

          {failedMessages.length > 0 && (
            <div>
              <p className="px-4 py-2 text-xs font-semibold text-red-700 bg-red-50 border-b border-red-100">
                Failed Messages ({failedMessages.length})
              </p>
              <div className="table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Message ID</th>
                      <th>Status</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failedMessages.slice(0, 50).map((m: MsgRow) => (
                      <tr key={m.id}>
                        <td className="font-mono text-xs">{m.id.slice(0, 8)}…</td>
                        <td>
                          <StatusBadge label={m.delivery_status ?? "failed"} colour="bg-red-100 text-red-800" />
                        </td>
                        <td className="text-gray-400 text-xs">{formatRelativeTime(m.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </SectionCard>

        {/* Agent errors */}
        <SectionCard title={`Agent Errors (last 7 days) — ${(recentErrors ?? []).length} errors`}>
          {!(recentErrors ?? []).length ? (
            <div className="px-4 py-6 text-center">
              <p className="text-green-600 font-semibold text-sm">✓ No agent errors in the last 7 days</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Error</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {(recentErrors ?? []).map((e) => (
                    <tr key={e.id}>
                      <td className="capitalize">{e.agent_type?.replace(/_/g, " ") ?? "—"}</td>
                      <td className="text-red-600 text-xs max-w-64 truncate">{e.error_message}</td>
                      <td className="text-gray-400 text-xs">{formatDateTime(e.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* Cron job status */}
        <SectionCard title="Scheduled Jobs">
          <div className="table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Schedule</th>
                  <th>Last Run</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {CRON_JOBS.map((job) => {
                  const runData = (cronJobRuns as unknown as Array<{ jobname: string; last_run: string; status: string }> | null)
                    ?.find((r) => r.jobname === job.name);
                  return (
                    <tr key={job.name}>
                      <td className="font-medium">{job.label}</td>
                      <td className="text-gray-500 text-xs">{job.schedule}</td>
                      <td className="text-gray-500 text-xs">
                        {runData?.last_run ? formatRelativeTime(runData.last_run) : "No data"}
                      </td>
                      <td>
                        <StatusBadge
                          label={runData?.status ?? "unknown"}
                          colour={
                            runData?.status === "succeeded"
                              ? "bg-green-100 text-green-800"
                              : runData?.status === "failed"
                              ? "bg-red-100 text-red-800"
                              : "bg-gray-100 text-gray-600"
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">
            Note: Last run data requires the <code>get_cron_job_status()</code> SQL function.
            See DEPLOY.md for setup instructions.
          </p>
        </SectionCard>

        {/* Database row counts */}
        <SectionCard title="Database Row Counts">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
            {(tableCounts ?? []).map(({ table, count }) => (
              <div key={table} className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 capitalize">{table.replace(/_/g, " ")}</p>
                <p className="text-lg font-bold text-gray-900">{count.toLocaleString()}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  colour = "text-gray-900",
}: {
  label: string;
  value: string | number;
  colour?: string;
}) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold ${colour}`}>{value}</p>
    </div>
  );
}
