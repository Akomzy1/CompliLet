import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-server";
import { formatDate, formatDateTime, formatRelativeTime, formatDuration } from "@/lib/format";
import { PageHeader, SectionCard } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SCREENING_STATUS_LABELS, SCREENING_STATUS_COLOURS } from "@/lib/constants";

interface Props {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const { data } = await supabaseAdmin.from("screening_sessions").select("tenant_name").eq("id", id).single();
  return { title: data?.tenant_name ?? "Screening Detail" };
}

export default async function ScreeningDetailPage({ params }: Props) {
  const { id } = await params;

  const [
    { data: session },
    { data: messages },
    { data: documents },
    { data: agentLogs },
    { data: compliance },
  ] = await Promise.all([
    supabaseAdmin
      .from("screening_sessions")
      .select("*, landlords(id, name, email)")
      .eq("id", id)
      .single(),
    supabaseAdmin
      .from("screening_messages")
      .select("id, role, content, created_at")
      .eq("session_id", id)
      .order("created_at")
      .limit(500),
    supabaseAdmin
      .from("documents")
      .select("id, document_type, status, validation_status, created_at")
      .eq("session_id", id)
      .catch(() => ({ data: [] })),
    supabaseAdmin
      .from("agent_logs")
      .select("id, agent_type, input_tokens, output_tokens, cost_estimate, created_at")
      .eq("session_id", id)
      .order("created_at", { ascending: false })
      .catch(() => ({ data: [] })),
    supabaseAdmin
      .from("compliance_records")
      .select("id, record_type, status, created_at")
      .eq("session_id", id)
      .catch(() => ({ data: [] })),
  ]);

  if (!session) notFound();

  const landlord = session.landlords as { id: string; name?: string; email?: string } | null;
  const totalCost = (agentLogs ?? []).reduce((sum, l) => sum + (l.cost_estimate ?? 0), 0);

  return (
    <div>
      <PageHeader
        title={session.tenant_name ?? "Unknown Tenant"}
        description="Screening session detail"
        actions={
          <Link href="/internal/screenings" className="text-sm text-gray-500 hover:text-gray-800">
            ← Back to Screenings
          </Link>
        }
      />

      <div className="p-6 space-y-5">
        {/* ── Meta grid ─────────────────────────────────────────────────────── */}
        <SectionCard title="Session Overview">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
            <Field label="Status">
              <StatusBadge
                label={SCREENING_STATUS_LABELS[session.status] ?? session.status}
                colour={SCREENING_STATUS_COLOURS[session.status]}
              />
            </Field>
            <Field label="Score" value={session.score != null ? `${session.score}/100` : "Not scored yet"} />
            <Field label="Landlord">
              {landlord ? (
                <Link
                  href={`/internal/landlords/${landlord.id}`}
                  className="text-sm text-teal-700 hover:text-teal-900 font-medium"
                >
                  {landlord.name ?? "—"}
                </Link>
              ) : (
                <span className="text-sm text-gray-400">—</span>
              )}
            </Field>
            <Field label="Property" value={session.property_address ?? "—"} />
            <Field label="Tenant Phone" value={session.tenant_phone ?? "—"} mono />
            <Field label="Duration" value={formatDuration(session.created_at, session.updated_at)} />
            <Field label="Started" value={formatDateTime(session.created_at)} />
            <Field label="Last Activity" value={formatRelativeTime(session.updated_at)} />
          </div>
        </SectionCard>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          {/* ── Conversation (main, 2/3 width) ──────────────────────────────── */}
          <div className="xl:col-span-2 space-y-5">
            <SectionCard title={`Conversation (${(messages ?? []).length} messages)`}>
              <div className="max-h-[600px] overflow-y-auto divide-y divide-gray-50">
                {!(messages ?? []).length ? (
                  <EmptyState message="No messages yet." />
                ) : (
                  (messages ?? []).map((m) => (
                    <div
                      key={m.id}
                      className={`flex gap-3 px-4 py-2.5 ${
                        m.role === "system" ? "bg-gray-50" : ""
                      }`}
                    >
                      <span
                        className={`text-xs font-semibold w-16 flex-shrink-0 mt-0.5 ${
                          m.role === "assistant"
                            ? "text-teal-600"
                            : m.role === "system"
                            ? "text-gray-400"
                            : "text-gray-700"
                        }`}
                      >
                        {m.role}
                      </span>
                      <p className="text-sm text-gray-700 flex-1 whitespace-pre-wrap">
                        {m.content}
                      </p>
                      <p className="text-xs text-gray-400 whitespace-nowrap">
                        {formatDateTime(m.created_at)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </SectionCard>

            {/* Agent logs */}
            <SectionCard title={`Agent Logs — ${(agentLogs ?? []).length} calls · est. $${totalCost.toFixed(4)}`}>
              <div className="table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>In</th>
                      <th>Out</th>
                      <th>Cost</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!(agentLogs ?? []).length ? (
                      <tr><td colSpan={5}><EmptyState message="No agent logs yet." /></td></tr>
                    ) : (
                      (agentLogs ?? []).map((l) => (
                        <tr key={l.id}>
                          <td className="capitalize">{l.agent_type?.replace(/_/g, " ") ?? "—"}</td>
                          <td className="text-gray-500">{l.input_tokens?.toLocaleString() ?? "—"}</td>
                          <td className="text-gray-500">{l.output_tokens?.toLocaleString() ?? "—"}</td>
                          <td className="text-gray-500">${(l.cost_estimate ?? 0).toFixed(5)}</td>
                          <td className="text-gray-400 text-xs">{formatRelativeTime(l.created_at)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>

          {/* ── Right panel: docs, refs, compliance ─────────────────────────── */}
          <div className="space-y-5">
            {/* Documents */}
            <SectionCard title={`Documents (${(documents as unknown[]).length})`}>
              <div className="divide-y divide-gray-50">
                {!(documents as unknown[]).length ? (
                  <EmptyState message="No documents collected yet." />
                ) : (
                  (documents as Array<{ id: string; document_type?: string; status?: string; validation_status?: string; created_at: string }>).map((d) => (
                    <div key={d.id} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-gray-800 capitalize">
                          {d.document_type?.replace(/_/g, " ") ?? "Document"}
                        </p>
                        <p className="text-xs text-gray-400">{formatDate(d.created_at)}</p>
                      </div>
                      <StatusBadge
                        label={d.validation_status ?? d.status ?? "pending"}
                        colour={
                          d.validation_status === "valid"
                            ? "bg-green-100 text-green-800"
                            : d.validation_status === "invalid"
                            ? "bg-red-100 text-red-800"
                            : "bg-gray-100 text-gray-600"
                        }
                      />
                    </div>
                  ))
                )}
              </div>
            </SectionCard>

            {/* Compliance records */}
            <SectionCard title="Compliance Records">
              <div className="divide-y divide-gray-50">
                {!(compliance as unknown[]).length ? (
                  <EmptyState message="No compliance records yet." />
                ) : (
                  (compliance as Array<{ id: string; record_type?: string; status?: string; created_at: string }>).map((c) => (
                    <div key={c.id} className="flex items-center justify-between px-4 py-2.5">
                      <p className="text-sm text-gray-700 capitalize">
                        {c.record_type?.replace(/_/g, " ") ?? "Record"}
                      </p>
                      <StatusBadge
                        label={c.status ?? "pending"}
                        colour={
                          c.status === "passed"
                            ? "bg-green-100 text-green-800"
                            : c.status === "failed"
                            ? "bg-red-100 text-red-800"
                            : "bg-gray-100 text-gray-600"
                        }
                      />
                    </div>
                  ))
                )}
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}

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
