import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-server";
import { formatDate, formatDateTime, formatPence, formatRelativeTime, formatDuration } from "@/lib/format";
import { PageHeader, SectionCard } from "@/components/ui/PageHeader";
import { StatusBadge, ComplianceBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PLAN_LABELS, PLAN_COLOURS, SCREENING_STATUS_LABELS, SCREENING_STATUS_COLOURS } from "@/lib/constants";

interface Props {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const { data } = await supabaseAdmin.from("landlords").select("name").eq("id", id).single();
  return { title: data?.name ?? "Landlord Detail" };
}

export default async function LandlordDetailPage({ params }: Props) {
  const { id } = await params;

  const [
    { data: landlord },
    { data: properties },
    { data: sessions },
    { data: tenancies },
    { data: messages },
    { data: agentLogs },
  ] = await Promise.all([
    supabaseAdmin.from("landlords").select("*").eq("id", id).single(),
    supabaseAdmin.from("properties").select("*").eq("landlord_id", id).order("created_at", { ascending: false }).catch(() => ({ data: [] })),
    supabaseAdmin.from("screening_sessions").select("id, status, created_at, updated_at, tenant_name, score").eq("landlord_id", id).order("created_at", { ascending: false }).limit(20),
    supabaseAdmin.from("tenancies").select("*").eq("landlord_id", id).order("created_at", { ascending: false }).catch(() => ({ data: [] })),
    supabaseAdmin.from("screening_messages").select("id, role, content, created_at").eq("landlord_id", id).order("created_at", { ascending: false }).limit(50).catch(() => ({ data: [] })),
    supabaseAdmin.from("agent_logs").select("id, agent_type, input_tokens, output_tokens, cost_estimate, created_at").eq("landlord_id", id).order("created_at", { ascending: false }).limit(100).catch(() => ({ data: [] })),
  ]);

  if (!landlord) notFound();

  const totalCost = (agentLogs ?? []).reduce((sum, l) => sum + (l.cost_estimate ?? 0), 0);
  const totalTokens = (agentLogs ?? []).reduce((sum, l) => sum + (l.input_tokens ?? 0) + (l.output_tokens ?? 0), 0);

  return (
    <div>
      <PageHeader
        title={landlord.name ?? "Unknown Landlord"}
        description={`ID: ${id}`}
        actions={
          <Link href="/internal/landlords" className="text-sm text-gray-500 hover:text-gray-800">
            ← Back to Landlords
          </Link>
        }
      />

      <div className="p-6 space-y-5">
        {/* ── Profile ───────────────────────────────────────────────────────── */}
        <SectionCard title="Landlord Profile">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
            <Field label="Email" value={landlord.email ?? "—"} />
            <Field label="Phone" value={landlord.phone ?? "—"} mono />
            <Field label="Plan">
              <StatusBadge
                label={PLAN_LABELS[landlord.plan] ?? landlord.plan ?? "—"}
                colour={PLAN_COLOURS[landlord.plan] ?? "bg-gray-100 text-gray-700"}
              />
            </Field>
            <Field label="Overseas" value={landlord.overseas ? "Yes 🌍" : "No"} />
            <Field label="Stripe Customer" value={landlord.stripe_customer_id ?? "—"} mono />
            <Field label="Subscription ID" value={landlord.stripe_subscription_id ?? "—"} mono />
            <Field label="Signed Up" value={formatDate(landlord.created_at)} />
            <Field label="Last Active" value={formatRelativeTime(landlord.updated_at)} />
          </div>
        </SectionCard>

        {/* ── Properties ───────────────────────────────────────────────────── */}
        <SectionCard title={`Properties (${(properties as unknown[]).length})`}>
          {!(properties as unknown[]).length ? (
            <EmptyState message="No properties added yet." />
          ) : (
            <div className="table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Type</th>
                    <th>Compliance</th>
                    <th>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {(properties as Array<{ id: string; address?: string; property_type?: string; created_at: string }>).map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium">{p.address ?? "—"}</td>
                      <td>{p.property_type ?? "—"}</td>
                      <td><ComplianceBadge status="green" /></td>
                      <td>{formatDate(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* ── Screening history ─────────────────────────────────────────────── */}
        <SectionCard title={`Screening History (${(sessions ?? []).length})`}>
          {!(sessions ?? []).length ? (
            <EmptyState message="No screenings yet." />
          ) : (
            <div className="table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Status</th>
                    <th>Score</th>
                    <th>Duration</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {(sessions ?? []).map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link
                          href={`/internal/screenings/${s.id}`}
                          className="text-teal-700 hover:text-teal-900"
                        >
                          {s.tenant_name ?? "—"}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge
                          label={SCREENING_STATUS_LABELS[s.status] ?? s.status}
                          colour={SCREENING_STATUS_COLOURS[s.status]}
                        />
                      </td>
                      <td>{s.score != null ? `${s.score}/100` : "—"}</td>
                      <td className="text-gray-500 text-xs">{formatDuration(s.created_at, s.updated_at)}</td>
                      <td>{formatDate(s.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* ── Active tenancies ──────────────────────────────────────────────── */}
        <SectionCard title={`Active Tenancies (${(tenancies as unknown[]).length})`}>
          {!(tenancies as unknown[]).length ? (
            <EmptyState message="No active tenancies." />
          ) : (
            <div className="table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Rent</th>
                    <th>Rent Status</th>
                    <th>Next Deadline</th>
                    <th>Start Date</th>
                  </tr>
                </thead>
                <tbody>
                  {(tenancies as Array<{ id: string; tenant_name?: string; rent_amount?: number; rent_status?: string; next_compliance_deadline?: string; start_date?: string }>).map((t) => (
                    <tr key={t.id}>
                      <td className="font-medium">{t.tenant_name ?? "—"}</td>
                      <td>{t.rent_amount ? formatPence(t.rent_amount * 100) : "—"}</td>
                      <td>
                        <StatusBadge
                          label={t.rent_status ?? "unknown"}
                          colour={
                            t.rent_status === "paid"
                              ? "bg-green-100 text-green-800"
                              : t.rent_status === "overdue"
                              ? "bg-red-100 text-red-800"
                              : "bg-gray-100 text-gray-700"
                          }
                        />
                      </td>
                      <td>{formatDate(t.next_compliance_deadline ?? null)}</td>
                      <td>{formatDate(t.start_date ?? null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* ── Agent costs ───────────────────────────────────────────────────── */}
        <SectionCard title={`Agent Logs — ${(agentLogs ?? []).length} calls`}>
          <div className="grid grid-cols-3 gap-4 p-4 border-b border-gray-100">
            <Field label="Total API Calls" value={String((agentLogs ?? []).length)} />
            <Field label="Total Tokens" value={totalTokens.toLocaleString()} />
            <Field label="Est. Cost" value={`$${totalCost.toFixed(4)}`} />
          </div>
          <div className="table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Input Tokens</th>
                  <th>Output Tokens</th>
                  <th>Est. Cost</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {(agentLogs ?? []).slice(0, 20).map((l) => (
                  <tr key={l.id}>
                    <td className="font-medium capitalize">{l.agent_type?.replace(/_/g, " ") ?? "—"}</td>
                    <td className="text-gray-500">{l.input_tokens?.toLocaleString() ?? "—"}</td>
                    <td className="text-gray-500">{l.output_tokens?.toLocaleString() ?? "—"}</td>
                    <td className="text-gray-500">${(l.cost_estimate ?? 0).toFixed(5)}</td>
                    <td className="text-gray-400 text-xs">{formatRelativeTime(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {/* ── Conversation log ──────────────────────────────────────────────── */}
        <SectionCard title={`Conversation Log (last ${(messages as unknown[]).length} messages)`}>
          <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
            {!(messages as unknown[]).length ? (
              <EmptyState message="No messages yet." />
            ) : (
              (messages as Array<{ id: string; role: string; content?: string; created_at: string }>).map((m) => (
                <div key={m.id} className="px-4 py-2.5 flex gap-3">
                  <span
                    className={`text-xs font-medium w-16 flex-shrink-0 mt-0.5 ${
                      m.role === "assistant" ? "text-teal-600" : "text-gray-500"
                    }`}
                  >
                    {m.role}
                  </span>
                  <p className="text-sm text-gray-700 flex-1">{m.content}</p>
                  <p className="text-xs text-gray-400 whitespace-nowrap">{formatDateTime(m.created_at)}</p>
                </div>
              ))
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

// ─── Field helper ──────────────────────────────────────────────────────────────
function Field({
  label,
  value,
  mono = false,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      {children ?? (
        <p className={`text-sm font-medium text-gray-900 ${mono ? "font-mono text-xs" : ""}`}>
          {value ?? "—"}
        </p>
      )}
    </div>
  );
}
