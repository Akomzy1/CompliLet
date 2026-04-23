import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Home as HomeIcon,
  AlertTriangle,
  MessageSquare,
} from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  PLAN_LABEL,
  PLAN_MONTHLY_PENCE,
  SUBSCRIPTION_PLANS,
  planBadgeClass,
  formatGbp,
  type LandlordPlan,
  LANDLORD_PLAN_VALUES,
} from "@/lib/admin-plans";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const PRIORITY_PILL: Record<string, string> = {
  urgent:   "bg-red-50 text-red-700 border-red-200",
  high:     "bg-amber-50 text-amber-700 border-amber-200",
  normal:   "bg-admin-cream text-admin-mute border-admin-line",
};

async function loadLandlordDetail(id: string) {
  const { data: landlord } = await supabaseAdmin
    .from("landlords")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!landlord) return null;

  const [
    propertiesRes,
    tenanciesRes,
    escalationsRes,
    messagesRes,
  ] = await Promise.all([
    supabaseAdmin
      .from("properties")
      .select("id, address, postcode, bedrooms, rent_amount, epc_expiry, created_at")
      .eq("landlord_id", id)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("tenancies")
      .select(
        "id, tenant_name, tenant_phone, start_date, end_date, rent_amount, status, property:properties!inner(id, address, landlord_id)",
      )
      .eq("property.landlord_id", id)
      .order("start_date", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("escalations")
      .select("id, trigger_type, priority, status, created_at")
      .eq("landlord_id", id)
      .in("status", ["open", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("messages")
      .select("id, direction, body, created_at")
      .eq("landlord_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return {
    landlord,
    properties: propertiesRes.data ?? [],
    tenancies: tenanciesRes.data ?? [],
    escalations: escalationsRes.data ?? [],
    messages: messagesRes.data ?? [],
  };
}

export default async function LandlordDetailPage({ params }: Props) {
  const { id } = await params;
  const detail = await loadLandlordDetail(id);
  if (!detail) notFound();

  const { landlord, properties, tenancies, escalations, messages } = detail;
  const planCandidate = (LANDLORD_PLAN_VALUES as readonly string[]).includes(
    landlord.plan,
  )
    ? (landlord.plan as LandlordPlan)
    : "free_trial";
  const mrr = SUBSCRIPTION_PLANS.has(planCandidate)
    ? PLAN_MONTHLY_PENCE[planCandidate]
    : 0;

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link
        href="/admin/landlords"
        className="inline-flex items-center gap-1.5 text-sm text-admin-mute hover:text-admin-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to landlords
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-semibold text-admin-ink">
              {landlord.name ?? "(unnamed landlord)"}
            </h1>
            <span
              className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${planBadgeClass(planCandidate)}`}
            >
              {PLAN_LABEL[planCandidate]}
            </span>
          </div>
          <p className="mt-1 font-mono text-sm text-admin-mute">{landlord.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled
            title="Coming in a follow-up release"
            className="inline-flex items-center gap-1.5 rounded-lg border border-admin-line bg-white px-3 py-1.5 text-sm font-medium text-admin-mute opacity-60"
          >
            Upgrade / downgrade
          </button>
          <button
            type="button"
            disabled
            title="Coming in a follow-up release"
            className="inline-flex items-center gap-1.5 rounded-lg border border-admin-line bg-white px-3 py-1.5 text-sm font-medium text-admin-mute opacity-60"
          >
            Cancel subscription
          </button>
          <button
            type="button"
            disabled
            title="Coming in a follow-up release"
            className="inline-flex items-center gap-1.5 rounded-lg bg-admin-teal px-3 py-1.5 text-sm font-medium text-white opacity-60"
          >
            Message landlord
          </button>
        </div>
      </div>

      {/* Contact + subscription */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-admin-line bg-white p-6 shadow-card">
          <h2 className="mb-4 font-display text-lg font-semibold text-admin-ink">
            Contact
          </h2>
          <dl className="space-y-3 text-sm">
            <InfoRow icon={Phone} label="Phone" value={landlord.phone} mono />
            <InfoRow icon={Mail} label="Email" value={landlord.email ?? "—"} />
            <InfoRow
              icon={MapPin}
              label="Country"
              value={landlord.country ?? "United Kingdom"}
              sub={landlord.is_overseas ? "Overseas landlord" : undefined}
            />
            <InfoRow
              icon={Calendar}
              label="Signed up"
              value={fmtShortDate(landlord.created_at)}
            />
          </dl>
        </div>

        <div className="rounded-2xl border border-admin-line bg-white p-6 shadow-card">
          <h2 className="mb-4 font-display text-lg font-semibold text-admin-ink">
            Subscription
          </h2>
          <dl className="space-y-3 text-sm">
            <InfoRow
              icon={Calendar}
              label="Plan"
              value={PLAN_LABEL[planCandidate]}
            />
            <InfoRow
              icon={Calendar}
              label="MRR contribution"
              value={mrr > 0 ? formatGbp(mrr) : "—"}
            />
            <InfoRow
              icon={Calendar}
              label="Stripe subscription"
              value={landlord.stripe_subscription_id ?? "—"}
              mono
            />
            <InfoRow
              icon={Calendar}
              label="Stripe customer"
              value={landlord.stripe_customer_id ?? "—"}
              mono
            />
          </dl>
          {landlord.nrl1_status && (
            <div className="mt-4 rounded-xl border border-admin-line bg-admin-cream/50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-admin-mute">
                HMRC NRL1
              </p>
              <p className="mt-1 text-sm text-admin-ink">
                {landlord.nrl1_status} · expires {fmtShortDate(landlord.nrl1_expiry)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Properties */}
      <section className="rounded-2xl border border-admin-line bg-white p-6 shadow-card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-admin-ink">
            Properties
          </h2>
          <span className="text-xs text-admin-mute">
            {properties.length} total
          </span>
        </div>
        {properties.length === 0 ? (
          <EmptyRow icon={HomeIcon} label="No properties yet." />
        ) : (
          <ul className="divide-y divide-admin-line">
            {properties.map((p) => (
              <li
                key={p.id}
                className="flex items-start justify-between gap-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-admin-ink">
                    {p.address}
                  </p>
                  <p className="text-xs text-admin-mute">
                    {p.postcode ?? "No postcode"}
                    {p.bedrooms ? ` · ${p.bedrooms} bed` : ""}
                    {p.rent_amount ? ` · £${p.rent_amount}/mo` : ""}
                  </p>
                </div>
                <p className="shrink-0 text-xs text-admin-mute">
                  Added {fmtShortDate(p.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Tenancies + Alerts */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-admin-line bg-white p-6 shadow-card">
          <h2 className="mb-4 font-display text-lg font-semibold text-admin-ink">
            Active tenancies
          </h2>
          {tenancies.length === 0 ? (
            <EmptyRow icon={HomeIcon} label="No tenancies recorded." />
          ) : (
            <ul className="divide-y divide-admin-line">
              {tenancies.slice(0, 6).map((t) => {
                const property = (t as unknown as {
                  property: { address: string } | null;
                }).property;
                return (
                  <li key={t.id} className="py-3">
                    <p className="text-sm font-medium text-admin-ink">
                      {t.tenant_name ?? t.tenant_phone}
                    </p>
                    <p className="truncate text-xs text-admin-mute">
                      {property?.address ?? "—"}
                    </p>
                    <p className="mt-1 text-xs text-admin-mute">
                      {fmtShortDate(t.start_date)}
                      {t.end_date ? ` → ${fmtShortDate(t.end_date)}` : ""}
                      {t.rent_amount ? ` · £${t.rent_amount}/mo` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-admin-line bg-white p-6 shadow-card">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-admin-ink">
            Open alerts
            {escalations.length > 0 && (
              <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                {escalations.length}
              </span>
            )}
          </h2>
          {escalations.length === 0 ? (
            <EmptyRow icon={AlertTriangle} label="No open alerts." />
          ) : (
            <ul className="divide-y divide-admin-line">
              {escalations.map((e) => (
                <li key={e.id} className="py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/admin/alerts/${e.id}`}
                      className="text-sm font-medium text-admin-ink hover:underline"
                    >
                      {e.trigger_type.replace(/_/g, " ")}
                    </Link>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${
                        PRIORITY_PILL[e.priority] ?? PRIORITY_PILL.normal
                      }`}
                    >
                      {e.priority}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-admin-mute">
                    {fmtDate(e.created_at)} · {e.status.replace(/_/g, " ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Recent messages */}
      <section className="rounded-2xl border border-admin-line bg-white p-6 shadow-card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-admin-ink">
            Recent messages
          </h2>
          <span className="text-xs text-admin-mute">Last 10</span>
        </div>
        {messages.length === 0 ? (
          <EmptyRow icon={MessageSquare} label="No messages yet." />
        ) : (
          <ul className="space-y-2.5">
            {messages.map((m) => {
              const inbound = m.direction === "inbound";
              return (
                <li
                  key={m.id}
                  className={`flex ${inbound ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                      inbound
                        ? "rounded-bl-sm bg-admin-cream text-admin-ink"
                        : "rounded-br-sm bg-admin-teal/10 text-admin-ink"
                    }`}
                  >
                    <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                    <p className="mt-1 text-[11px] text-admin-mute">
                      {fmtDate(m.created_at)} · {inbound ? "Inbound" : "Outbound"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  sub,
  mono = false,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-admin-mute" aria-hidden />
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-medium uppercase tracking-wide text-admin-mute">
          {label}
        </dt>
        <dd
          className={`mt-0.5 truncate text-sm text-admin-ink ${
            mono ? "font-mono" : ""
          }`}
        >
          {value}
        </dd>
        {sub && <p className="text-xs text-admin-mute">{sub}</p>}
      </div>
    </div>
  );
}

function EmptyRow({
  icon: Icon,
  label,
}: {
  icon: typeof Mail;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed border-admin-line bg-admin-cream/40 px-4 py-6 text-sm text-admin-mute">
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </div>
  );
}
