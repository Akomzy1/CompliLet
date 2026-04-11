import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-server";
import { formatDate, formatPence, formatRelativeTime } from "@/lib/format";
import { PageHeader, SectionCard, FilterSelect } from "@/components/ui/PageHeader";
import { StatusBadge, ComplianceBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import type { ComplianceStatus } from "@/lib/constants";

export const metadata = { title: "Tenancies" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{
    compliance?: string;
    landlord?: string;
    overseas?: string;
    arrears?: string;
    page?: string;
  }>;
}

const PAGE_SIZE = 50;

// ─── Compliance status logic ───────────────────────────────────────────────────
function getComplianceStatus(tenancy: {
  rent_status?: string;
  next_compliance_deadline?: string;
  has_open_emergency?: boolean;
}): ComplianceStatus {
  const now = new Date();
  const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  if (
    tenancy.has_open_emergency ||
    tenancy.rent_status === "arrears" ||
    (tenancy.next_compliance_deadline && new Date(tenancy.next_compliance_deadline) < now)
  ) {
    return "red";
  }
  if (
    tenancy.rent_status === "overdue" ||
    (tenancy.next_compliance_deadline && new Date(tenancy.next_compliance_deadline) < thirtyDays)
  ) {
    return "amber";
  }
  return "green";
}

export default async function TenanciesPage({ searchParams }: Props) {
  const { compliance, landlord, overseas, arrears, page } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1"));
  const offset = (pageNum - 1) * PAGE_SIZE;

  // ── Query tenancies ───────────────────────────────────────────────────────────
  let query = supabaseAdmin
    .from("tenancies")
    .select("*", { count: "exact" });

  if (arrears === "true") query = query.in("rent_status", ["overdue", "arrears"]);
  if (landlord) query = query.eq("landlord_id", landlord);

  query = query.order("created_at", { ascending: false }).range(offset, offset + PAGE_SIZE - 1);

  const { data: tenancies, count } = await query.catch(() => ({ data: [], count: 0 }));

  // Compute compliance status per tenancy, then filter if requested
  const enriched = (tenancies ?? []).map((t) => ({
    ...t,
    complianceStatus: getComplianceStatus(t),
  }));

  const filtered = compliance
    ? enriched.filter((t) => t.complianceStatus === compliance)
    : enriched;

  // Arrears summary
  const arrearsRows = enriched.filter((t) => t.rent_status === "arrears" || t.rent_status === "overdue");
  const totalArrears = arrearsRows.reduce((sum, t) => sum + (t.rent_overdue_amount ?? 0), 0);

  // Stats
  const redCount = enriched.filter((t) => t.complianceStatus === "red").length;
  const amberCount = enriched.filter((t) => t.complianceStatus === "amber").length;
  const greenCount = enriched.filter((t) => t.complianceStatus === "green").length;

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  return (
    <div>
      <PageHeader title="Tenancies" description={`${count ?? 0} total tenancies`} />

      <div className="p-6 space-y-4">
        {/* Compliance summary */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "All Clear", value: greenCount, colour: "text-green-700", status: "green" },
            { label: "Attention", value: amberCount, colour: "text-amber-700", status: "amber" },
            { label: "Action Required", value: redCount, colour: "text-red-700", status: "red" },
            { label: "Arrears", value: arrearsRows.length, colour: "text-red-800", status: null },
          ].map((m) => (
            <Link
              key={m.label}
              href={m.status ? `/internal/tenancies?compliance=${m.status}` : "/internal/tenancies?arrears=true"}
              className="bg-white rounded-lg border border-gray-200 px-4 py-3 shadow-sm hover:bg-gray-50 block"
            >
              <p className="text-xs text-gray-500">{m.label}</p>
              <p className={`text-xl font-bold ${m.colour}`}>{m.value}</p>
            </Link>
          ))}
        </div>

        {/* Filters */}
        <SectionCard>
          <div className="px-4 py-3">
            <form method="GET" className="flex flex-wrap items-center gap-3">
              <FilterSelect
                name="compliance"
                label="Compliance"
                defaultValue={compliance}
                options={[
                  { value: "red", label: "Action Required" },
                  { value: "amber", label: "Attention" },
                  { value: "green", label: "All Clear" },
                ]}
              />
              <FilterSelect
                name="arrears"
                label="Rent"
                defaultValue={arrears}
                options={[{ value: "true", label: "In arrears only" }]}
              />
              {(compliance || landlord || arrears) && (
                <a href="/internal/tenancies" className="text-xs text-gray-400 hover:text-gray-600">Clear filters</a>
              )}
            </form>
          </div>
        </SectionCard>

        {/* Tenancy table */}
        <SectionCard>
          <div className="table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Tenant</th>
                  <th>Landlord</th>
                  <th>Rent</th>
                  <th>Rent Status</th>
                  <th>Compliance</th>
                  <th>Next Deadline</th>
                  <th>Tenancy Start</th>
                  <th>End Date</th>
                </tr>
              </thead>
              <tbody>
                {!filtered.length ? (
                  <tr><td colSpan={9}><EmptyState message="No tenancies match your filters." /></td></tr>
                ) : (
                  filtered.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <Link
                          href={`/internal/tenancies/${t.id}`}
                          className="font-medium text-teal-700 hover:text-teal-900"
                        >
                          {t.property_address ?? "Unknown property"}
                        </Link>
                      </td>
                      <td>{t.tenant_name ?? "—"}</td>
                      <td>
                        {t.landlord_id ? (
                          <Link href={`/internal/landlords/${t.landlord_id}`} className="text-teal-700 hover:text-teal-900 text-xs">
                            View
                          </Link>
                        ) : "—"}
                      </td>
                      <td>{t.rent_amount ? formatPence(t.rent_amount * 100) : "—"}</td>
                      <td>
                        <StatusBadge
                          label={t.rent_status ?? "unknown"}
                          colour={
                            t.rent_status === "paid"
                              ? "bg-green-100 text-green-800"
                              : t.rent_status === "arrears"
                              ? "bg-red-100 text-red-800"
                              : t.rent_status === "overdue"
                              ? "bg-orange-100 text-orange-800"
                              : "bg-gray-100 text-gray-600"
                          }
                        />
                      </td>
                      <td><ComplianceBadge status={t.complianceStatus} /></td>
                      <td>{formatDate(t.next_compliance_deadline ?? null)}</td>
                      <td>{formatDate(t.start_date ?? null)}</td>
                      <td>{formatDate(t.end_date ?? null)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-500">Page {pageNum} of {totalPages}</p>
              <div className="flex gap-2">
                {pageNum > 1 && (
                  <a href={`?page=${pageNum - 1}`} className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50">← Prev</a>
                )}
                {pageNum < totalPages && (
                  <a href={`?page=${pageNum + 1}`} className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50">Next →</a>
                )}
              </div>
            </div>
          )}
        </SectionCard>

        {/* Arrears panel */}
        {arrearsRows.length > 0 && (
          <SectionCard title={`Arrears Summary — ${arrearsRows.length} tenancies · £${(totalArrears / 100).toFixed(2)} outstanding`}>
            <div className="divide-y divide-gray-50">
              {arrearsRows
                .sort((a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0))
                .map((t) => (
                  <div key={t.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{t.tenant_name ?? "Unknown"}</p>
                      <p className="text-xs text-gray-500">{t.property_address ?? "—"}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-red-700">
                        {t.rent_overdue_amount ? formatPence(t.rent_overdue_amount) : "Amount unknown"}
                      </p>
                      <p className="text-xs text-red-500">
                        {t.days_overdue ? `${t.days_overdue} days overdue` : "Overdue"}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
