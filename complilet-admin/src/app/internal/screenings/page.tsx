import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-server";
import { formatDate, formatRelativeTime, formatDuration } from "@/lib/format";
import { PageHeader, SearchBar, FilterSelect, SectionCard } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  SCREENING_STATUS_LABELS,
  SCREENING_STATUS_COLOURS,
} from "@/lib/constants";

export const metadata = { title: "Screenings" };
export const dynamic = "force-dynamic";

const STATUS_OPTIONS = Object.entries(SCREENING_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

interface Props {
  searchParams: Promise<{
    q?: string;
    status?: string;
    page?: string;
  }>;
}

const PAGE_SIZE = 50;

// All active statuses for "active" quick count
const ACTIVE_STATUSES = [
  "pre_qualifying",
  "collecting_docs",
  "right_to_rent",
  "chasing_refs",
  "decision",
  "move_in_pack",
];

export default async function ScreeningsPage({ searchParams }: Props) {
  const { q, status, page } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1"));
  const offset = (pageNum - 1) * PAGE_SIZE;

  // ── Status breakdown ──────────────────────────────────────────────────────────
  const { data: allStatuses } = await supabaseAdmin
    .from("screening_sessions")
    .select("status");

  const statusCounts: Record<string, number> = {};
  for (const s of allStatuses ?? []) {
    statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;
  }
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  // ── Main query ────────────────────────────────────────────────────────────────
  let query = supabaseAdmin
    .from("screening_sessions")
    .select(
      "id, status, created_at, updated_at, tenant_name, tenant_phone, score, property_address, landlord_id",
      { count: "exact" }
    );

  if (q) {
    query = query.or(`tenant_name.ilike.%${q}%,tenant_phone.ilike.%${q}%`);
  }
  if (status) query = query.eq("status", status);

  query = query.order("created_at", { ascending: false }).range(offset, offset + PAGE_SIZE - 1);

  const { data: sessions, count } = await query;

  // Enrich with landlord names
  const landlordIds = [...new Set((sessions ?? []).map((s) => s.landlord_id).filter(Boolean))];
  const { data: landlordRows } = landlordIds.length
    ? await supabaseAdmin.from("landlords").select("id, name").in("id", landlordIds)
    : { data: [] };

  const landlordNames: Record<string, string> = {};
  for (const l of landlordRows ?? []) {
    landlordNames[l.id] = l.name;
  }

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  // ── Analytics (bottom panel) ──────────────────────────────────────────────────
  const completedSessions = (allStatuses ?? []).filter((s) => s.status === "completed").length;
  const cancelledSessions = (allStatuses ?? []).filter((s) => s.status === "cancelled").length;

  return (
    <div>
      <PageHeader title="Screenings" description={`${total} total screenings`} />

      <div className="p-6 space-y-4">
        {/* Status breakdown bar */}
        <SectionCard title="Status Breakdown">
          <div className="px-4 py-3 flex flex-wrap gap-3">
            {Object.entries(SCREENING_STATUS_LABELS).map(([key, label]) => (
              <Link
                key={key}
                href={`/internal/screenings?status=${key}`}
                className="flex items-center gap-1.5 hover:opacity-80"
              >
                <span
                  className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${SCREENING_STATUS_COLOURS[key]}`}
                >
                  {label}
                </span>
                <span className="text-sm font-bold text-gray-700">
                  {statusCounts[key] ?? 0}
                </span>
              </Link>
            ))}
          </div>
        </SectionCard>

        {/* Analytics summary */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total", value: total, colour: "text-gray-900" },
            { label: "Active", value: ACTIVE_STATUSES.reduce((s, k) => s + (statusCounts[k] ?? 0), 0), colour: "text-blue-700" },
            { label: "Completed", value: completedSessions, colour: "text-green-700" },
            { label: "Cancelled", value: cancelledSessions, colour: "text-gray-500" },
          ].map((m) => (
            <div key={m.label} className="bg-white rounded-lg border border-gray-200 px-4 py-3 shadow-sm">
              <p className="text-xs text-gray-500">{m.label}</p>
              <p className={`text-xl font-bold ${m.colour}`}>{m.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <SectionCard>
          <div className="px-4 py-3">
            <form method="GET" className="flex flex-wrap items-center gap-3">
              <SearchBar name="q" defaultValue={q} placeholder="Search tenant name or phone…" />
              <FilterSelect name="status" label="Status" options={STATUS_OPTIONS} defaultValue={status} />
              {(q || status) && (
                <a href="/internal/screenings" className="text-xs text-gray-400 hover:text-gray-600">
                  Clear filters
                </a>
              )}
            </form>
          </div>
        </SectionCard>

        {/* Table */}
        <SectionCard>
          <div className="table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Landlord</th>
                  <th>Property</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Started</th>
                  <th>Last Activity</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {!(sessions ?? []).length ? (
                  <tr>
                    <td colSpan={8}><EmptyState message="No screenings match your filters." /></td>
                  </tr>
                ) : (
                  (sessions ?? []).map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link
                          href={`/internal/screenings/${s.id}`}
                          className="font-medium text-teal-700 hover:text-teal-900"
                        >
                          {s.tenant_name ?? "Unknown Tenant"}
                        </Link>
                        {s.tenant_phone && (
                          <p className="text-xs text-gray-400 font-mono">{s.tenant_phone}</p>
                        )}
                      </td>
                      <td>{landlordNames[s.landlord_id] ?? "—"}</td>
                      <td className="text-gray-500 text-xs max-w-36 truncate">
                        {s.property_address ?? "—"}
                      </td>
                      <td>
                        <StatusBadge
                          label={SCREENING_STATUS_LABELS[s.status] ?? s.status}
                          colour={SCREENING_STATUS_COLOURS[s.status]}
                        />
                      </td>
                      <td>{s.score != null ? `${s.score}/100` : "—"}</td>
                      <td>{formatDate(s.created_at)}</td>
                      <td className="text-gray-400 text-xs">{formatRelativeTime(s.updated_at)}</td>
                      <td className="text-gray-500 text-xs">{formatDuration(s.created_at, s.updated_at)}</td>
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
                  <a href={`?page=${pageNum - 1}${status ? `&status=${status}` : ""}`}
                    className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50">← Prev</a>
                )}
                {pageNum < totalPages && (
                  <a href={`?page=${pageNum + 1}${status ? `&status=${status}` : ""}`}
                    className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50">Next →</a>
                )}
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
