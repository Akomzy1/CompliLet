import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-admin";

interface SessionRow {
  id: string;
  landlord_id: string | null;
  tenant_phone: string | null;
  property_address: string | null;
  status: string;
  current_step: string | null;
  created_at: string;
  updated_at: string;
  // enriched
  landlord_name?: string | null;
  escalation_count?: number;
}

const STATUS_COLOUR: Record<string, string> = {
  active:    "text-green-400",
  completed: "text-gray-500",
  halted:    "text-red-400",
  abandoned: "text-gray-600",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function stepLabel(s: string | null) {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Props {
  searchParams: Promise<{ status?: string }>;
}

export default async function SessionsPage({ searchParams }: Props) {
  const params = await searchParams;
  const statusFilter = params.status ?? "active";

  let query = supabaseAdmin
    .from("screening_sessions")
    .select(`id, landlord_id, tenant_phone, property_address,
             status, current_step, created_at, updated_at`);

  if (statusFilter !== "all") query = query.eq("status", statusFilter);

  const { data: rows } = await query
    .order("updated_at", { ascending: false })
    .limit(200);

  const sessions: SessionRow[] = (rows ?? []) as SessionRow[];

  // Enrich with landlord names
  const landlordIds = [...new Set(sessions.map((s) => s.landlord_id).filter(Boolean))] as string[];
  if (landlordIds.length > 0) {
    const { data: landlords } = await supabaseAdmin
      .from("landlords").select("id, name").in("id", landlordIds);
    const map = new Map((landlords ?? []).map((l) => [l.id, l.name]));
    for (const s of sessions) {
      if (s.landlord_id) s.landlord_name = map.get(s.landlord_id) ?? null;
    }
  }

  // Escalation counts per session
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length > 0) {
    const { data: escCounts } = await supabaseAdmin
      .from("escalations")
      .select("session_id")
      .in("session_id", sessionIds);
    const countMap = new Map<string, number>();
    for (const e of escCounts ?? []) {
      countMap.set(e.session_id, (countMap.get(e.session_id) ?? 0) + 1);
    }
    for (const s of sessions) {
      s.escalation_count = countMap.get(s.id) ?? 0;
    }
  }

  const filters = [
    { value: "active",    label: "Active"    },
    { value: "completed", label: "Completed" },
    { value: "halted",    label: "Halted"    },
    { value: "all",       label: "All"       },
  ];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100">Sessions</h1>
          <p className="mt-1 text-sm text-gray-500">{sessions.length} sessions shown</p>
        </div>
        <form className="flex gap-1 rounded-lg border border-gray-800 bg-gray-900 p-1">
          {filters.map((f) => (
            <Link
              key={f.value}
              href={`/admin/screenings?status=${f.value}`}
              className={`rounded px-3 py-1.5 text-sm transition ${
                statusFilter === f.value
                  ? "bg-gray-700 text-gray-100"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </form>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900 px-6 py-16 text-center text-gray-500">
          No sessions matching this filter.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-800 bg-gray-900 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Landlord</th>
                <th className="px-4 py-3 text-left">Tenant</th>
                <th className="px-4 py-3 text-left">Property</th>
                <th className="px-4 py-3 text-left">Step</th>
                <th className="px-4 py-3 text-left">Escalations</th>
                <th className="px-4 py-3 text-left">Last active</th>
                <th className="px-4 py-3 text-left"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 bg-gray-950">
              {sessions.map((sess) => (
                <tr key={sess.id} className="hover:bg-gray-900/60">
                  <td className={`px-4 py-3 font-medium capitalize ${STATUS_COLOUR[sess.status] ?? "text-gray-400"}`}>
                    {sess.status}
                  </td>
                  <td className="px-4 py-3 text-gray-300">{sess.landlord_name ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{sess.tenant_phone ?? "—"}</td>
                  <td className="px-4 py-3 max-w-48 truncate text-gray-500" title={sess.property_address ?? ""}>
                    {sess.property_address ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{stepLabel(sess.current_step)}</td>
                  <td className="px-4 py-3">
                    {(sess.escalation_count ?? 0) > 0 ? (
                      <span className="rounded bg-red-900/40 px-2 py-0.5 text-xs text-red-300">
                        {sess.escalation_count}
                      </span>
                    ) : (
                      <span className="text-gray-700">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(sess.updated_at)}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/screenings/${sess.id}`}
                      className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-300 transition hover:bg-gray-700"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
