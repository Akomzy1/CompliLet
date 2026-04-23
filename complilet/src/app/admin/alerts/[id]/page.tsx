import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";

// ── Server Actions ─────────────────────────────────────────────────────────

async function resolveAction(formData: FormData) {
  "use server";
  const id = formData.get("id") as string;
  const resolution = (formData.get("resolution") as string).trim();
  const resolvedBy = (formData.get("resolved_by") as string | null)?.trim() || "dashboard";

  if (!resolution) redirect(`/admin/alerts/${id}?error=1`);

  const now = new Date().toISOString();
  await supabaseAdmin
    .from("escalations")
    .update({ status: "resolved", resolution, resolved_by: resolvedBy, resolved_at: now, updated_at: now })
    .eq("id", id);

  // Clear the halt on coordinator_state if present
  await supabaseAdmin
    .from("coordinator_state")
    .update({ active_escalation_id: null, updated_at: now })
    .eq("active_escalation_id", id);

  redirect("/admin/alerts");
}

async function takeOverAction(formData: FormData) {
  "use server";
  const id = formData.get("id") as string;
  await supabaseAdmin
    .from("escalations")
    .update({ status: "in_progress", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open");
  redirect(`/admin/alerts/${id}`);
}

// ── Helpers ────────────────────────────────────────────────────────────────

const PRIORITY_COLOUR: Record<string, string> = {
  urgent: "bg-red-900/60 text-red-300 border-red-800",
  high:   "bg-amber-900/60 text-amber-300 border-amber-800",
  normal: "bg-gray-800 text-gray-400 border-gray-700",
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
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
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function EscalationDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;

  const { data: esc } = await supabaseAdmin
    .from("escalations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!esc) notFound();

  // Fetch conversation thread from screening_messages if session_id present
  let messages: Array<{ role: string; body: string; created_at: string }> = [];
  if (esc.session_id) {
    const { data: msgs } = await supabaseAdmin
      .from("screening_messages")
      .select("role, body, created_at")
      .eq("session_id", esc.session_id)
      .order("created_at", { ascending: true })
      .limit(200);
    messages = (msgs ?? []) as typeof messages;
  }

  // Landlord name
  let landlordName: string | null = null;
  if (esc.landlord_id) {
    const { data: landlord } = await supabaseAdmin
      .from("landlords").select("name").eq("id", esc.landlord_id).maybeSingle();
    landlordName = landlord?.name ?? null;
  }

  const isResolved = esc.status === "resolved";

  return (
    <div className="max-w-4xl">
      {/* Back */}
      <Link href="/admin/alerts" className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300">
        ← Back to alerts
      </Link>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-gray-100">
              {triggerLabel(esc.trigger_type)}
            </h1>
            <span className={`rounded border px-2 py-0.5 text-xs font-medium ${PRIORITY_COLOUR[esc.priority]}`}>
              {esc.priority}
            </span>
            <span className={`text-sm font-medium ${isResolved ? "text-green-500" : esc.status === "in_progress" ? "text-blue-400" : "text-yellow-400"}`}>
              {esc.status.replace("_", " ")}
            </span>
          </div>
          <p className="mt-1 font-mono text-sm text-gray-500">{esc.id}</p>
        </div>

        {!isResolved && esc.status === "open" && (
          <form action={takeOverAction}>
            <input type="hidden" name="id" value={esc.id} />
            <button type="submit" className="rounded-lg bg-blue-900/50 px-4 py-2 text-sm text-blue-300 hover:bg-blue-800/60">
              Take Over
            </button>
          </form>
        )}
      </div>

      {/* Meta grid */}
      <div className="mb-6 grid grid-cols-2 gap-4 rounded-xl border border-gray-800 bg-gray-900 p-5 sm:grid-cols-3">
        {[
          ["Sender", esc.sender_phone],
          ["Landlord", landlordName ?? "—"],
          ["Raised", fmtDate(esc.created_at)],
          ["Session ID", esc.session_id ?? "—"],
          ["Resolved at", fmtDate(esc.resolved_at)],
          ["Resolved by", esc.resolved_by ?? "—"],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-xs uppercase tracking-wide text-gray-600">{label}</p>
            <p className="mt-0.5 font-mono text-sm text-gray-300 break-all">{value}</p>
          </div>
        ))}
      </div>

      {/* Trigger message */}
      {esc.message_text && (
        <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900 p-5">
          <p className="mb-2 text-xs uppercase tracking-wide text-gray-600">Triggering message</p>
          <blockquote className="border-l-2 border-teal-600 pl-4 text-sm text-gray-300 italic">
            {esc.message_text}
          </blockquote>
        </div>
      )}

      {/* Context */}
      {esc.context && (
        <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900 p-5">
          <p className="mb-2 text-xs uppercase tracking-wide text-gray-600">Agent context</p>
          <p className="text-sm text-gray-400">{esc.context}</p>
        </div>
      )}

      {/* Conversation thread */}
      {messages.length > 0 && (
        <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900 p-5">
          <p className="mb-4 text-xs uppercase tracking-wide text-gray-600">Conversation thread ({messages.length} messages)</p>
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-3 ${msg.role === "assistant" ? "flex-row-reverse" : ""}`}
              >
                <div className={`rounded-lg px-3 py-2 text-sm max-w-[80%] ${
                  msg.role === "assistant"
                    ? "bg-teal-900/50 text-teal-100"
                    : "bg-gray-800 text-gray-300"
                }`}>
                  <p className="mb-0.5 text-xs font-medium opacity-60 capitalize">{msg.role}</p>
                  <p className="whitespace-pre-wrap">{msg.body}</p>
                  <p className="mt-1 text-xs opacity-40">{fmtDate(msg.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resolution */}
      {isResolved ? (
        <div className="rounded-xl border border-green-900/50 bg-green-950/30 p-5">
          <p className="mb-1 text-xs uppercase tracking-wide text-green-700">Resolution</p>
          <p className="text-sm text-green-300">{esc.resolution}</p>
        </div>
      ) : (
        <form action={resolveAction} className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <input type="hidden" name="id" value={esc.id} />
          <p className="mb-4 text-sm font-medium text-gray-300">Resolve this escalation</p>

          {error && (
            <p className="mb-3 rounded bg-red-950/50 px-3 py-2 text-sm text-red-400">
              Resolution note is required.
            </p>
          )}

          <div className="mb-4">
            <label htmlFor="resolution" className="mb-1.5 block text-xs text-gray-500">
              Resolution note <span className="text-red-500">*</span>
            </label>
            <textarea
              id="resolution"
              name="resolution"
              required
              rows={3}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-gray-100 outline-none ring-teal-500 transition focus:border-teal-500 focus:ring-1"
              placeholder="Describe what action was taken and outcome..."
            />
          </div>

          <div className="mb-4">
            <label htmlFor="resolved_by" className="mb-1.5 block text-xs text-gray-500">
              Resolved by (optional)
            </label>
            <input
              id="resolved_by"
              name="resolved_by"
              type="text"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-gray-100 outline-none ring-teal-500 transition focus:border-teal-500 focus:ring-1"
              placeholder="Your name"
            />
          </div>

          <button
            type="submit"
            className="rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-500 active:scale-[0.98]"
          >
            Mark as Resolved
          </button>
        </form>
      )}
    </div>
  );
}
