import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-server";
import { formatDate, formatDateTime, formatPence, formatRelativeTime } from "@/lib/format";
import { PageHeader, SectionCard } from "@/components/ui/PageHeader";
import { StatusBadge, ComplianceBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";

interface Props {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function TenancyDetailPage({ params }: Props) {
  const { id } = await params;

  const [
    { data: tenancy },
    { data: rentEvents },
    { data: maintenanceTickets },
    { data: inspections },
    { data: complianceDeadlines },
    { data: messages },
  ] = await Promise.all([
    supabaseAdmin.from("tenancies").select("*, landlords(id, name)").eq("id", id).single(),
    supabaseAdmin.from("rent_events").select("*").eq("tenancy_id", id).order("created_at", { ascending: false }).limit(36).catch(() => ({ data: [] })),
    supabaseAdmin.from("maintenance_tickets").select("*").eq("tenancy_id", id).order("created_at", { ascending: false }).catch(() => ({ data: [] })),
    supabaseAdmin.from("inspections").select("*").eq("tenancy_id", id).order("created_at", { ascending: false }).catch(() => ({ data: [] })),
    supabaseAdmin.from("compliance_deadlines").select("*").eq("tenancy_id", id).order("due_date").catch(() => ({ data: [] })),
    supabaseAdmin.from("screening_messages").select("id, role, content, created_at").eq("tenancy_id", id).order("created_at", { ascending: false }).limit(100).catch(() => ({ data: [] })),
  ]);

  if (!tenancy) notFound();

  const landlord = tenancy.landlords as { id: string; name?: string } | null;

  return (
    <div>
      <PageHeader
        title={tenancy.property_address ?? "Unknown Property"}
        description={`Tenant: ${tenancy.tenant_name ?? "Unknown"}`}
        actions={
          <Link href="/internal/tenancies" className="text-sm text-gray-500 hover:text-gray-800">
            ← Back to Tenancies
          </Link>
        }
      />

      <div className="p-6 space-y-5">
        {/* Overview */}
        <SectionCard title="Tenancy Details">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
            <Field label="Tenant" value={tenancy.tenant_name ?? "—"} />
            <Field label="Rent" value={tenancy.rent_amount ? formatPence(tenancy.rent_amount * 100) + "/mo" : "—"} />
            <Field label="Rent Status">
              <StatusBadge
                label={tenancy.rent_status ?? "unknown"}
                colour={
                  tenancy.rent_status === "paid" ? "bg-green-100 text-green-800"
                  : tenancy.rent_status === "arrears" ? "bg-red-100 text-red-800"
                  : tenancy.rent_status === "overdue" ? "bg-orange-100 text-orange-800"
                  : "bg-gray-100 text-gray-600"
                }
              />
            </Field>
            <Field label="Compliance"><ComplianceBadge status="green" /></Field>
            <Field label="Landlord">
              {landlord ? (
                <Link href={`/internal/landlords/${landlord.id}`} className="text-sm text-teal-700 hover:text-teal-900 font-medium">
                  {landlord.name ?? "—"}
                </Link>
              ) : <span className="text-sm text-gray-400">—</span>}
            </Field>
            <Field label="Start Date" value={formatDate(tenancy.start_date ?? null)} />
            <Field label="End Date" value={formatDate(tenancy.end_date ?? null)} />
            <Field label="Deposit" value={tenancy.deposit_amount ? formatPence(tenancy.deposit_amount * 100) : "—"} />
          </div>
        </SectionCard>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {/* Compliance deadlines */}
          <SectionCard title="Compliance Deadlines">
            {!(complianceDeadlines as unknown[]).length ? (
              <EmptyState message="No compliance deadlines tracked." />
            ) : (
              <div className="divide-y divide-gray-50">
                {(complianceDeadlines as Array<{ id: string; deadline_type?: string; due_date?: string; status?: string }>).map((d) => {
                  const isOverdue = d.due_date && new Date(d.due_date) < new Date();
                  return (
                    <div key={d.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900 capitalize">
                          {d.deadline_type?.replace(/_/g, " ") ?? "Deadline"}
                        </p>
                        <p className={`text-xs ${isOverdue ? "text-red-500 font-semibold" : "text-gray-400"}`}>
                          Due {formatDate(d.due_date ?? null)}
                          {isOverdue ? " — OVERDUE" : ""}
                        </p>
                      </div>
                      <StatusBadge
                        label={d.status ?? "pending"}
                        colour={
                          d.status === "complete" ? "bg-green-100 text-green-800"
                          : isOverdue ? "bg-red-100 text-red-800"
                          : "bg-amber-100 text-amber-800"
                        }
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Rent payment history */}
          <SectionCard title={`Rent History (${(rentEvents as unknown[]).length} records)`}>
            {!(rentEvents as unknown[]).length ? (
              <EmptyState message="No rent events recorded." />
            ) : (
              <div className="table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rentEvents as Array<{ id: string; event_date?: string; amount?: number; status?: string }>).map((r) => (
                      <tr key={r.id}>
                        <td>{formatDate(r.event_date ?? null)}</td>
                        <td>{r.amount ? formatPence(r.amount * 100) : "—"}</td>
                        <td>
                          <StatusBadge
                            label={r.status ?? "unknown"}
                            colour={
                              r.status === "paid" ? "bg-green-100 text-green-800"
                              : r.status === "missed" ? "bg-red-100 text-red-800"
                              : "bg-gray-100 text-gray-600"
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* Maintenance tickets */}
          <SectionCard title={`Maintenance Tickets (${(maintenanceTickets as unknown[]).length})`}>
            {!(maintenanceTickets as unknown[]).length ? (
              <EmptyState message="No maintenance tickets." />
            ) : (
              <div className="divide-y divide-gray-50">
                {(maintenanceTickets as Array<{ id: string; title?: string; priority?: string; status?: string; created_at: string }>).map((t) => (
                  <div key={t.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{t.title ?? "Maintenance issue"}</p>
                      <p className="text-xs text-gray-400">{formatRelativeTime(t.created_at)}</p>
                    </div>
                    <div className="flex gap-2">
                      <StatusBadge
                        label={t.priority ?? "normal"}
                        colour={t.priority === "emergency" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-600"}
                      />
                      <StatusBadge
                        label={t.status ?? "open"}
                        colour={t.status === "resolved" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Inspections */}
          <SectionCard title={`Inspections (${(inspections as unknown[]).length})`}>
            {!(inspections as unknown[]).length ? (
              <EmptyState message="No inspections recorded." />
            ) : (
              <div className="divide-y divide-gray-50">
                {(inspections as Array<{ id: string; inspection_date?: string; status?: string; outcome?: string; notes?: string }>).map((insp) => (
                  <div key={insp.id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900">
                        {formatDate(insp.inspection_date ?? null)}
                      </p>
                      <StatusBadge
                        label={insp.status ?? "scheduled"}
                        colour={insp.status === "completed" ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800"}
                      />
                    </div>
                    {insp.notes && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{insp.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Conversation log */}
        <SectionCard title={`Conversation Log (${(messages as unknown[]).length} messages)`}>
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
            {!(messages as unknown[]).length ? (
              <EmptyState message="No messages in conversation log." />
            ) : (
              (messages as Array<{ id: string; role: string; content?: string; created_at: string }>).map((m) => (
                <div key={m.id} className="flex gap-3 px-4 py-2.5">
                  <span className={`text-xs font-semibold w-16 flex-shrink-0 mt-0.5 ${m.role === "assistant" ? "text-teal-600" : "text-gray-500"}`}>
                    {m.role}
                  </span>
                  <p className="text-sm text-gray-700 flex-1 truncate">{m.content}</p>
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

function Field({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      {children ?? <p className="text-sm font-medium text-gray-900">{value ?? "—"}</p>}
    </div>
  );
}
