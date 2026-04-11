import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { redirect } from "next/navigation";

// ── Types ──────────────────────────────────────────────────────────────────

interface EscalationRow {
  id: string;
  session_id: string | null;
  landlord_id: string | null;
  sender_phone: string;
  trigger_type: string;
  priority: "urgent" | "high" | "normal";
  status: "open" | "in_progress" | "resolved";
  context: string | null;
  message_text: string | null;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  // enriched
  landlord_name?: string | null;
  property_address?: string | null;
}

// ── Server Actions ─────────────────────────────────────────────────────────

async function takeOverAction(formData: FormData) {
  "use server";
  const id = formData.get("id") as string;
  await supabaseAdmin
    .from("escalations")
    .update({ status: "in_progress", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open");
  redirect("/internal/escalations");
}

async function filterAction(formData: FormData) {
  "use server";
  const status = formData.get("status") as string;
  redirect(`/internal/escalations?status=${status}`);
}

// ── Helpers ────────────────────────────────────────────────────────────────

const PRIORITY_WEIGHT: Record<string, number> = { urgent: 0, high: 1, normal: 2 };
const PRIORITY_COLOUR: Record<string, string> = {
  urgent: "bg-red-900/60 text-red-300 border-red-800",
  high:   "bg-amber-900/60 text-amber-300 border-amber-800",
  normal: "bg-gray-800 text-gray-400 border-gray-700",
};
const STATUS_COLOUR: Record<string, string> = {
  open:        "text-yellow-400",
  in_progress: "text-blue-400",
  resolved:    "text-green-500",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function triggerLabel(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Page ───────────────────────────────────────────────────────────────────

interface Props {
  searchParams: Promise<{ status?: string }>;
}

export default async function EscalationsPage({ searchParams }: Props) {
  const params = await searchParams;
  const statusFilter = params.status ?? "open";

  // Fetch escalations
  let query = supabaseAdmin
    .from("escalations")
    .select(`id, session_id, landlord_id, sender_phone, trigger_type,
             priority, status, context, message_text, resolution,
             resolved_by, resolved_at, created_at`);

  if (statusFilter !== "all") query = query.eq("status", statusFilter);

  const { data: rows } = await query.order("created_at", { ascending: true });
  const escalations: EscalationRow[] = (rows ?? []) as EscalationRow[];

  // Enrich with landlord names
  const landlordIds = [...new Set(escalations.map((e) => e.landlord_id).filter(Boolean))] as string[];
  if (landlordIds.length > 0) {
    const { data: landlords } = await supabaseAdmin
      .from("landlords").select("id, name").in("id", landlordIds);
    const map = new Map((landlords ?? []).map((l) => [l.id, l.name]));
    for (const e of escalations) {
      if (e.landlord_id) e.landlord_name = map.get(e.landlord_id) ?? null;
    }
  }

  // Sort: urgent → high → normal, then oldest first
  escalations.sort((a, b) => {
    const pw = (PRIORITY_WEIGHT[a.priority] ?? 99) - (PRIORITY_WEIGHT[b.priority] ?? 99);
    return pw !== 0 ? pw : new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  // Counts
  const { data: allRows } = await supabaseAdmin.from("escalations").select("status, priority");
  const all = allRows ?? [];
  const counts = {
    open:        all.filter((r) => r.status === "open").length,
    in_progress: all.filter((r) => r.status === "in_progress").length,
    resolved:    all.filter((r) => r.status === "resolved").length,
    urgent:      all.filter((r) => r.priority === "urgent").length,
    high:        all.filter((r) => r.priority === "high").length,
  };

  const filters = [
    { value: "open",        label: "Open"       },
    { value: "in_progress", label: "In Progress" },
    { value: "resolved",    label: "Resolved"   },
    { value: "all",         label: "All"         },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100">Escalations</h1>
          <p className="mt-1 text-sm text-gray-500">
            {counts.open} open · {counts.in_progress} in progress · {counts.urgent} urgent · {counts.high} high
          </p>
        </div>
        {/* Filter tabs */}
        <form action={filterAction} className="flex gap-1 rounded-lg border border-gray-800 bg-gray-900 p-1">
          {filters.map((f) => (
            <button
              key={f.value}
              name="status"
              value={f.value}
              type="submit"
              className={`rounded px-3 py-1.5 text-sm transition ${
                statusFilter === f.value
                  ? "bg-gray-700 text-gray-100"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {f.label}
            </button>
          ))}
        </form>
      </div>

      {/* Table */}
      {escalations.length === 0 ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900 px-6 py-16 text-center text-gray-500">
          No escalations matching this filter.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-800 bg-gray-900 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Priority</th>
                <th className="px-4 py-3 text-left">Trigger</th>
                <th className="px-4 py-3 text-left">Sender</th>
                <th className="px-4 py-3 text-left">Landlord</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Raised</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 bg-gray-950">
              {escalations.map((esc) => (
                <tr key={esc.id} className="hover:bg-gray-900/60">
                  <td className="px-4 py-3">
                    <span className={`rounded border px-2 py-0.5 text-xs font-medium ${PRIORITY_COLOUR[esc.priority]}`}>
                      {esc.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{triggerLabel(esc.trigger_type)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{esc.sender_phone}</td>
                  <td className="px-4 py-3 text-gray-400">{esc.landlord_name ?? "—"}</td>
                  <td className={`px-4 py-3 font-medium ${STATUS_COLOUR[esc.status]}`}>
                    {esc.status.replace("_", " ")}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(esc.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Link
                        href={`/internal/escalations/${esc.id}`}
                        className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-300 transition hover:bg-gray-700"
                      >
                        View
                      </Link>
                      {esc.status === "open" && (
                        <form action={takeOverAction}>
                          <input type="hidden" name="id" value={esc.id} />
                          <button
                            type="submit"
                            className="rounded bg-blue-900/50 px-2.5 py-1 text-xs text-blue-300 transition hover:bg-blue-800/60"
                          >
                            Take Over
                          </button>
                        </form>
                      )}
                    </div>
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
