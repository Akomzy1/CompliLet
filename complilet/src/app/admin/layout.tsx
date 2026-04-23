import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "CompliLet Admin",
  robots: "noindex, nofollow",
};

async function loadNavCounts() {
  const [openAlerts, unresolvedCompliance, pendingScreenings, activeTenancies] =
    await Promise.all([
      supabaseAdmin
        .from("escalations")
        .select("id", { count: "exact", head: true })
        .eq("status", "open"),
      supabaseAdmin
        .from("compliance_alerts")
        .select("id", { count: "exact", head: true })
        .eq("resolved", false),
      supabaseAdmin
        .from("screening_sessions")
        .select("id", { count: "exact", head: true })
        .in("status", ["in_progress", "awaiting_docs", "awaiting_tenant"]),
      supabaseAdmin
        .from("tenancies")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
    ]);

  return {
    alerts: (openAlerts.count ?? 0) + (unresolvedCompliance.count ?? 0),
    screenings: pendingScreenings.count ?? 0,
    tenancies: activeTenancies.count ?? 0,
  };
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const counts = await loadNavCounts().catch(() => ({
    alerts: 0,
    screenings: 0,
    tenancies: 0,
  }));

  return <AdminShell counts={counts}>{children}</AdminShell>;
}
