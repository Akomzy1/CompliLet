import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  LANDLORD_PLAN_VALUES,
  PLAN_MONTHLY_PENCE,
  SUBSCRIPTION_PLANS,
  type LandlordPlan,
} from "@/lib/admin-plans";
import {
  LandlordsTable,
  type LandlordTableRow,
} from "@/components/admin/LandlordsTable";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface LandlordRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string;
  plan: string;
  stripe_subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

async function loadLandlords(): Promise<LandlordTableRow[]> {
  const { data: landlords, error } = await supabaseAdmin
    .from("landlords")
    .select(
      "id, name, email, phone, plan, stripe_subscription_id, created_at, updated_at",
    )
    .order("created_at", { ascending: false });

  if (error || !landlords || landlords.length === 0) return [];

  const ids = (landlords as LandlordRow[]).map((l) => l.id);

  const [propertiesRes, tenanciesRes, lastMessageRes] = await Promise.all([
    supabaseAdmin
      .from("properties")
      .select("id, landlord_id")
      .in("landlord_id", ids),
    supabaseAdmin
      .from("tenancies")
      .select("id, property_id, status, property:properties(landlord_id)")
      .eq("status", "active"),
    supabaseAdmin
      .from("messages")
      .select("landlord_id, created_at")
      .in("landlord_id", ids)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const propertiesByLandlord = new Map<string, number>();
  for (const p of propertiesRes.data ?? []) {
    propertiesByLandlord.set(
      p.landlord_id,
      (propertiesByLandlord.get(p.landlord_id) ?? 0) + 1,
    );
  }

  const tenanciesByLandlord = new Map<string, number>();
  for (const t of (tenanciesRes.data ?? []) as unknown as Array<{
    property: { landlord_id: string } | { landlord_id: string }[] | null;
  }>) {
    const prop = Array.isArray(t.property) ? t.property[0] : t.property;
    const landlordId = prop?.landlord_id;
    if (!landlordId) continue;
    tenanciesByLandlord.set(
      landlordId,
      (tenanciesByLandlord.get(landlordId) ?? 0) + 1,
    );
  }

  const lastActiveByLandlord = new Map<string, string>();
  for (const m of lastMessageRes.data ?? []) {
    if (!m.landlord_id) continue;
    if (!lastActiveByLandlord.has(m.landlord_id)) {
      lastActiveByLandlord.set(m.landlord_id, m.created_at);
    }
  }

  return (landlords as LandlordRow[]).map((l) => {
    const plan = (LANDLORD_PLAN_VALUES as readonly string[]).includes(l.plan)
      ? (l.plan as LandlordPlan)
      : "free_trial";
    const mrr = SUBSCRIPTION_PLANS.has(plan) ? PLAN_MONTHLY_PENCE[plan] : 0;
    return {
      id: l.id,
      name: l.name,
      email: l.email,
      phone: l.phone,
      plan: l.plan,
      stripe_subscription_id: l.stripe_subscription_id,
      created_at: l.created_at,
      updated_at: l.updated_at,
      properties_count: propertiesByLandlord.get(l.id) ?? 0,
      tenancies_count: tenanciesByLandlord.get(l.id) ?? 0,
      last_active_at: lastActiveByLandlord.get(l.id) ?? l.updated_at,
      estimated_mrr_pence: mrr,
    };
  });
}

export default async function LandlordsPage() {
  const rows = await loadLandlords();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-admin-ink">
          Landlords
        </h1>
        <p className="mt-1 text-sm text-admin-mute">
          Every CompliLet account, their plan, and their portfolio.
        </p>
      </div>
      <LandlordsTable rows={rows} />
    </div>
  );
}
