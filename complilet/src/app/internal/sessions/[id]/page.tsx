import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  body: string;
  created_at: string;
}

interface Escalation {
  id: string;
  trigger_type: string;
  priority: string;
  status: string;
  created_at: string;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function stepLabel(s: string | null) {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const STATUS_COLOUR: Record<string, string> = {
  active:    "text-green-400",
  completed: "text-gray-500",
  halted:    "text-red-400",
  abandoned: "text-gray-600",
};

const PRIORITY_BADGE: Record<string, string> = {
  urgent: "bg-red-900/60 text-red-300 border-red-800",
  high:   "bg-amber-900/60 text-amber-300 border-amber-800",
  normal: "bg-gray-800 text-gray-400 border-gray-700",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SessionDetailPage({ params }: Props) {
  const { id } = await params;

  const { data: session } = await supabaseAdmin
    .from("screening_sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!session) notFound();

  // Fetch messages
  const { data: msgRows } = await supabaseAdmin
    .from("screening_messages")
    .select("id, role, body, created_at")
    .eq("session_id", id)
    .order("created_at", { ascending: true })
    .limit(500);
  const messages: Message[] = (msgRows ?? []) as Message[];

  // Fetch escalations linked to this session
  const { data: escRows } = await supabaseAdmin
    .from("escalations")
    .select("id, trigger_type, priority, status, created_at")
    .eq("session_id", id)
    .order("created_at", { ascending: false });
  const escalations: Escalation[] = (escRows ?? []) as Escalation[];

  // Landlord
  let landlordName: string | null = null;
  if (session.landlord_id) {
    const { data: landlord } = await supabaseAdmin
      .from("landlords").select("name").eq("id", session.landlord_id).maybeSingle();
    landlordName = landlord?.name ?? null;
  }

  return (
    <div className="max-w-4xl">
      <Link href="/internal/sessions" className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300">
        ← Back to sessions
      </Link>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-gray-100">
              {session.property_address ?? "Unknown property"}
            </h1>
            <span className={`text-sm font-medium capitalize ${STATUS_COLOUR[session.status] ?? "text-gray-400"}`}>
              {session.status}
            </span>
          </div>
          <p className="mt-1 font-mono text-sm text-gray-500">{id}</p>
        </div>
        {escalations.length > 0 && (
          <span className="rounded bg-red-900/40 px-3 py-1.5 text-sm text-red-300">
            {escalations.length} escalation{escalations.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Meta */}
      <div className="mb-6 grid grid-cols-2 gap-4 rounded-xl border border-gray-800 bg-gray-900 p-5 sm:grid-cols-3">
        {[
          ["Landlord",      landlordName ?? "—"],
          ["Tenant phone",  session.tenant_phone ?? "—"],
          ["Current step",  stepLabel(session.current_step)],
          ["Created",       fmtDate(session.created_at)],
          ["Last active",   fmtDate(session.updated_at)],
          ["Session ID",    id],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-xs uppercase tracking-wide text-gray-600">{label}</p>
            <p className="mt-0.5 font-mono text-sm text-gray-300 break-all">{value}</p>
          </div>
        ))}
      </div>

      {/* Escalations sidebar */}
      {escalations.length > 0 && (
        <div className="mb-6 rounded-xl border border-red-900/40 bg-red-950/20 p-5">
          <p className="mb-3 text-xs uppercase tracking-wide text-red-700">Escalations</p>
          <div className="space-y-2">
            {escalations.map((esc) => (
              <div key={esc.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-900/60 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded border px-1.5 py-0.5 text-xs ${PRIORITY_BADGE[esc.priority]}`}>
                    {esc.priority}
                  </span>
                  <span className="text-sm text-gray-300">
                    {esc.trigger_type.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600">{fmtDate(esc.created_at)}</span>
                  <Link
                    href={`/internal/escalations/${esc.id}`}
                    className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400 hover:text-gray-200"
                  >
                    View
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conversation thread */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <p className="mb-4 text-xs uppercase tracking-wide text-gray-600">
          Conversation ({messages.length} messages)
        </p>
        {messages.length === 0 ? (
          <p className="text-sm text-gray-600">No messages recorded for this session.</p>
        ) : (
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
            {messages.map((msg) => {
              const isAssistant = msg.role === "assistant";
              const isSystem = msg.role === "system";
              if (isSystem) {
                return (
                  <div key={msg.id} className="flex justify-center">
                    <span className="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-600 italic">
                      {msg.body}
                    </span>
                  </div>
                );
              }
              return (
                <div key={msg.id} className={`flex ${isAssistant ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                    isAssistant
                      ? "rounded-br-sm bg-teal-900/50 text-teal-100"
                      : "rounded-bl-sm bg-gray-800 text-gray-300"
                  }`}>
                    <p className="mb-1 text-xs font-medium capitalize opacity-50">{msg.role}</p>
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                    <p className="mt-1.5 text-right text-xs opacity-30">{fmtDate(msg.created_at)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
