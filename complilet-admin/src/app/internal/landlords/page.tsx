import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-server";
import { formatDate, formatRelativeTime } from "@/lib/format";
import { PageHeader, SearchBar, FilterSelect, SectionCard } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PLAN_LABELS, PLAN_COLOURS } from "@/lib/constants";

export const metadata = { title: "Landlords" };
export const dynamic = "force-dynamic";

const PLAN_OPTIONS = Object.entries(PLAN_LABELS).map(([value, label]) => ({ value, label }));

interface Props {
  searchParams: Promise<{
    q?: string;
    plan?: string;
    overseas?: string;
    page?: string;
  }>;
}

const PAGE_SIZE = 50;

export default async function LandlordsPage({ searchParams }: Props) {
  const { q, plan, overseas, page } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1"));
  const offset = (pageNum - 1) * PAGE_SIZE;

  // ── Query ────────────────────────────────────────────────────────────────────
  let query = supabaseAdmin
    .from("landlords")
    .select(
      "id, name, phone, email, plan, overseas, created_at, updated_at, stripe_customer_id",
      { count: "exact" }
    );

  if (q) {
    query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);
  }
  if (plan) query = query.eq("plan", plan);
  if (overseas === "true") query = query.eq("overseas", true);
  if (overseas === "false") query = query.eq("overseas", false);

  query = query.order("created_at", { ascending: false }).range(offset, offset + PAGE_SIZE - 1);

  const { data: landlords, count } = await query;

  // Get screening counts per landlord
  const landlordIds = (landlords ?? []).map((l) => l.id);
  const { data: screeningCounts } = landlordIds.length
    ? await supabaseAdmin
        .from("screening_sessions")
        .select("landlord_id")
        .in("landlord_id", landlordIds)
    : { data: [] };

  const countByLandlord: Record<string, number> = {};
  for (const s of screeningCounts ?? []) {
    countByLandlord[s.landlord_id] = (countByLandlord[s.landlord_id] ?? 0) + 1;
  }

  // Get property counts
  const { data: propCounts } = landlordIds.length
    ? await supabaseAdmin
        .from("properties")
        .select("landlord_id")
        .in("landlord_id", landlordIds)
        .then((r) => r)
        .catch(() => ({ data: [] }))
    : { data: [] };

  const propByLandlord: Record<string, number> = {};
  for (const p of propCounts ?? []) {
    propByLandlord[p.landlord_id] = (propByLandlord[p.landlord_id] ?? 0) + 1;
  }

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Landlords"
        description={`${count ?? 0} total landlords`}
      />

      <div className="p-6 space-y-4">
        {/* Filters */}
        <SectionCard>
          <div className="px-4 py-3">
            <form method="GET" className="flex flex-wrap items-center gap-3">
              <SearchBar name="q" defaultValue={q} placeholder="Search name, email, phone…" />
              <FilterSelect
                name="plan"
                label="Plan"
                options={PLAN_OPTIONS}
                defaultValue={plan}
              />
              <FilterSelect
                name="overseas"
                label="Overseas"
                options={[
                  { value: "true", label: "Overseas only" },
                  { value: "false", label: "Domestic only" },
                ]}
                defaultValue={overseas}
              />
              {(q || plan || overseas) && (
                <a href="/internal/landlords" className="text-xs text-gray-400 hover:text-gray-600">
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
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Plan</th>
                  <th>Properties</th>
                  <th>Screenings</th>
                  <th>Overseas</th>
                  <th>Signed Up</th>
                  <th>Last Active</th>
                </tr>
              </thead>
              <tbody>
                {(landlords ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={9}><EmptyState message="No landlords match your filters." /></td>
                  </tr>
                ) : (
                  (landlords ?? []).map((l) => (
                    <tr key={l.id}>
                      <td>
                        <Link
                          href={`/internal/landlords/${l.id}`}
                          className="font-medium text-teal-700 hover:text-teal-900"
                        >
                          {l.name ?? "—"}
                        </Link>
                      </td>
                      <td className="text-gray-600">{l.email ?? "—"}</td>
                      <td className="text-gray-600 font-mono text-xs">{l.phone ?? "—"}</td>
                      <td>
                        <StatusBadge
                          label={PLAN_LABELS[l.plan] ?? l.plan ?? "—"}
                          colour={PLAN_COLOURS[l.plan] ?? "bg-gray-100 text-gray-700"}
                        />
                      </td>
                      <td className="text-center">{propByLandlord[l.id] ?? 0}</td>
                      <td className="text-center">{countByLandlord[l.id] ?? 0}</td>
                      <td className="text-center">{l.overseas ? "🌍" : "—"}</td>
                      <td>{formatDate(l.created_at)}</td>
                      <td className="text-gray-400 text-xs">{formatRelativeTime(l.updated_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                Page {pageNum} of {totalPages}
              </p>
              <div className="flex gap-2">
                {pageNum > 1 && (
                  <a
                    href={`?${new URLSearchParams({ ...(q ? { q } : {}), ...(plan ? { plan } : {}), page: String(pageNum - 1) })}`}
                    className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
                  >
                    ← Prev
                  </a>
                )}
                {pageNum < totalPages && (
                  <a
                    href={`?${new URLSearchParams({ ...(q ? { q } : {}), ...(plan ? { plan } : {}), page: String(pageNum + 1) })}`}
                    className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
                  >
                    Next →
                  </a>
                )}
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
