import { revalidatePath } from "next/cache";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-server";
import { formatDateTime, formatRelativeTime, getAgeColour } from "@/lib/format";
import { PageHeader, SectionCard, FilterSelect } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PRIORITY_COLOURS } from "@/lib/constants";
import { EscalationExpandRow } from "./EscalationExpandRow";

export const metadata = { title: "Escalations" };
export const dynamic = "force-dynamic";

// Priority sort order
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2 };

interface Props {
  searchParams: Promise<{ status?: string; priority?: string }>;
}

export default async function EscalationsPage({ searchParams }: Props) {
  const { status, priority } = await searchParams;

  // ── Server Actions ────────────────────────────────────────────────────────────
  async function takeOverAction(formData: FormData) {
    "use server";
    const id = formData.get("id") as string;
    await supabaseAdmin
      .from("escalations")
      .update({ status: "in_progress", updated_at: new Date().toISOString() })
      .eq("id", id);
    revalidatePath("/internal/escalations");
  }

  async function resolveAction(formData: FormData) {
    "use server";
    const id = formData.get("id") as string;
    const resolution = formData.get("resolution") as string;
    const resolvedBy = formData.get("resolved_by") as string;

    await supabaseAdmin
      .from("escalations")
      .update({
        status: "resolved",
        resolution_notes: resolution,
        resolved_by: resolvedBy || "Admin",
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    // Clear active escalation from coordinator state
    await supabaseAdmin
      .from("coordinator_state")
      .update({ active_escalation_id: null })
      .eq("active_escalation_id", id);

    revalidatePath("/internal/escalations");
  }

  async function escalateFurtherAction(formData: FormData) {
    "use server";
    const id = formData.get("id") as string;
    await supabaseAdmin
      .from("escalations")
      .update({ status: "escalated_external", updated_at: new Date().toISOString() })
      .eq("id", id);
    revalidatePath("/internal/escalations");
  }

  // ── Query ─────────────────────────────────────────────────────────────────────
  let query = supabaseAdmin
    .from("escalations")
    .select("*, landlords(id, name, phone), screening_sessions(id, tenant_name, tenant_phone)");

  if (status) query = query.eq("status", status);
  else query = query.in("status", ["open", "in_progress"]);

  if (priority) query = query.eq("priority", priority);

  const { data: escalations } = await query.order("created_at");

  // Sort: urgent → high → normal, then oldest first
  const sorted = (escalations ?? []).sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 99;
    const pb = PRIORITY_ORDER[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  // Get conversations for each escalation
  const sessionIds = sorted.map((e) => e.session_id).filter(Boolean);
  const { data: messages } = sessionIds.length
    ? await supabaseAdmin
        .from("screening_messages")
        .select("id, session_id, role, content, created_at")
        .in("session_id", sessionIds)
        .order("created_at")
        .limit(1000)
    : { data: [] };

  const messagesBySession: Record<string, typeof messages> = {};
  for (const m of messages ?? []) {
    if (!messagesBySession[m.session_id]) messagesBySession[m.session_id] = [];
    messagesBySession[m.session_id]!.push(m);
  }

  // Stats
  const urgentOpen = (escalations ?? []).filter((e) => e.priority === "urgent" && e.status !== "resolved").length;
  const avgResponseTime = "—"; // Would need resolved_at and first_response_at columns

  return (
    <div>
      <PageHeader
        title="Escalations"
        description={urgentOpen > 0 ? `⚠️ ${urgentOpen} urgent escalations need attention` : "No urgent escalations"}
      />

      <div className="p-6 space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Open", value: (escalations ?? []).filter((e) => e.status === "open").length, colour: "text-gray-900" },
            { label: "In Progress", value: (escalations ?? []).filter((e) => e.status === "in_progress").length, colour: "text-blue-700" },
            { label: "Urgent", value: urgentOpen, colour: "text-red-700" },
            { label: "Avg Response", value: avgResponseTime, colour: "text-gray-500" },
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
              <FilterSelect
                name="status"
                label="Status"
                defaultValue={status ?? ""}
                options={[
                  { value: "open", label: "Open" },
                  { value: "in_progress", label: "In Progress" },
                  { value: "resolved", label: "Resolved" },
                  { value: "escalated_external", label: "Escalated External" },
                ]}
              />
              <FilterSelect
                name="priority"
                label="Priority"
                defaultValue={priority ?? ""}
                options={[
                  { value: "urgent", label: "Urgent" },
                  { value: "high", label: "High" },
                  { value: "normal", label: "Normal" },
                ]}
              />
              {(status || priority) && (
                <a href="/internal/escalations" className="text-xs text-gray-400 hover:text-gray-600">Clear filters</a>
              )}
            </form>
          </div>
        </SectionCard>

        {/* Escalation list */}
        <SectionCard>
          {!sorted.length ? (
            <EmptyState message="No escalations match your filters." />
          ) : (
            <div className="divide-y divide-gray-100">
              {sorted.map((e) => {
                const landlord = e.landlords as { id: string; name?: string; phone?: string } | null;
                const session = e.screening_sessions as { id: string; tenant_name?: string; tenant_phone?: string } | null;
                const sessionMessages = messagesBySession[e.session_id] ?? [];

                return (
                  <div
                    key={e.id}
                    className={`p-4 ${e.priority === "urgent" ? "bg-red-50 border-l-4 border-red-500" : ""}`}
                  >
                    {/* Top row */}
                    <div className="flex flex-wrap items-start gap-3 mb-3">
                      <StatusBadge
                        label={e.priority?.toUpperCase() ?? "NORMAL"}
                        colour={PRIORITY_COLOURS[e.priority] ?? "bg-gray-100 text-gray-700"}
                      />
                      <StatusBadge
                        label={e.status?.replace("_", " ") ?? "open"}
                        colour={e.status === "in_progress" ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-600"}
                      />
                      <span className="text-sm font-medium text-gray-800 capitalize">
                        {e.type?.replace(/_/g, " ") ?? "Escalation"}
                      </span>
                      <div className="flex-1" />
                      <span className={`text-xs ${getAgeColour(e.created_at)}`}>
                        {formatRelativeTime(e.created_at)}
                      </span>
                    </div>

                    {/* Detail */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-gray-600 mb-3">
                      <div>
                        <span className="font-medium">Landlord: </span>
                        {landlord ? (
                          <Link href={`/internal/landlords/${landlord.id}`} className="text-teal-700">
                            {landlord.name ?? "—"}
                          </Link>
                        ) : "—"}
                      </div>
                      <div>
                        <span className="font-medium">Tenant: </span>
                        {session?.tenant_name ?? "—"}
                      </div>
                      <div>
                        <span className="font-medium">Trigger: </span>
                        {e.trigger_type ?? e.type ?? "—"}
                      </div>
                      <div>
                        <span className="font-medium">Assigned: </span>
                        {e.assigned_to ?? "Unassigned"}
                      </div>
                    </div>

                    {e.notes && (
                      <p className="text-sm text-gray-700 bg-white border border-gray-200 rounded p-2 mb-3">
                        {e.notes}
                      </p>
                    )}

                    {/* Expandable conversation + action buttons */}
                    <EscalationExpandRow
                      escalationId={e.id}
                      messages={sessionMessages}
                      status={e.status}
                      takeOverAction={takeOverAction}
                      resolveAction={resolveAction}
                      escalateFurtherAction={escalateFurtherAction}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
