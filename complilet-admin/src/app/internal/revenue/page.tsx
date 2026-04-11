import { supabaseAdmin } from "@/lib/supabase-server";
import {
  fetchMRR,
  fetchPayPerScreenRevenue,
  fetchRecentTransactions,
  fetchFailedPayments,
  fetchSubscriptionStats,
} from "@/lib/stripe";
import { formatPence, formatDateTime } from "@/lib/format";
import { PageHeader, SectionCard } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { RevenuePieChart } from "@/components/charts/RevenuePieChart";

export const metadata = { title: "Revenue" };
export const dynamic = "force-dynamic";

export default async function RevenuePage() {
  const [
    mrrData,
    payPerScreen,
    transactions,
    failedPayments,
    subStats,
    { data: referrals },
  ] = await Promise.all([
    fetchMRR(),
    fetchPayPerScreenRevenue(),
    fetchRecentTransactions(50),
    fetchFailedPayments(20),
    fetchSubscriptionStats(),
    supabaseAdmin
      .from("referral_transactions")
      .select("id, amount, status, created_at, contractor_id")
      .order("created_at", { ascending: false })
      .limit(20)
      .catch(() => ({ data: [] })),
  ]);

  const totalMRR = mrrData.mrr;
  const referralRevenue = (referrals ?? [])
    .filter((r) => r.status === "paid")
    .reduce((sum, r) => sum + (r.amount ?? 0), 0);

  // Pie chart: revenue breakdown by plan
  const pieData = Object.entries(mrrData.breakdown).map(([name, value]) => ({
    name,
    value,
  }));
  if (payPerScreen > 0) {
    pieData.push({ name: "Pay Per Screen", value: payPerScreen });
  }
  if (referralRevenue > 0) {
    pieData.push({ name: "Referrals", value: referralRevenue });
  }

  return (
    <div>
      <PageHeader title="Revenue & Billing" description="Stripe data — live" />

      <div className="p-6 space-y-5">
        {/* Top stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Current MRR", value: formatPence(totalMRR), colour: "text-green-700" },
            { label: "New Subscriptions", value: subStats.newCount, colour: "text-blue-700" },
            { label: "Churned", value: subStats.churnCount, colour: "text-red-700" },
            { label: "Failed Payments", value: failedPayments.length, colour: failedPayments.length > 0 ? "text-red-700" : "text-gray-500" },
          ].map((m) => (
            <div key={m.label} className="bg-white rounded-lg border border-gray-200 px-5 py-4 shadow-sm">
              <p className="text-xs text-gray-500">{m.label}</p>
              <p className={`text-2xl font-bold ${m.colour}`}>{m.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {/* Revenue breakdown chart */}
          <SectionCard title="Revenue Breakdown by Tier">
            <div className="h-64">
              <RevenuePieChart data={pieData} />
            </div>
          </SectionCard>

          {/* Pay-per-screen + referrals */}
          <SectionCard title="One-Time & Referral Revenue (this month)">
            <div className="p-4 space-y-3">
              <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">Pay-Per-Screen</p>
                  <p className="text-xs text-gray-500">£4.99 per completed screening</p>
                </div>
                <p className="text-lg font-bold text-gray-900">{formatPence(payPerScreen)}</p>
              </div>
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-gray-800">Contractor Referrals</p>
                  <p className="text-xs text-gray-500">{(referrals ?? []).length} referral transactions</p>
                </div>
                <p className="text-lg font-bold text-gray-900">{formatPence(referralRevenue)}</p>
              </div>
            </div>
          </SectionCard>
        </div>

        {/* Failed payments */}
        {failedPayments.length > 0 && (
          <SectionCard title={`⚠️ Failed Payments Needing Attention (${failedPayments.length})`}>
            <div className="table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Amount</th>
                    <th>Attempts</th>
                    <th>Due Date</th>
                    <th>Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {failedPayments.map((inv) => (
                    <tr key={inv.id}>
                      <td>{inv.customer_email ?? inv.customer as string ?? "—"}</td>
                      <td>{formatPence(inv.amount_due)}</td>
                      <td>
                        <StatusBadge
                          label={`${inv.attempt_count} attempt${inv.attempt_count !== 1 ? "s" : ""}`}
                          colour="bg-red-100 text-red-800"
                        />
                      </td>
                      <td>{inv.due_date ? new Date(inv.due_date * 1000).toLocaleDateString("en-GB") : "—"}</td>
                      <td>
                        <a
                          href={inv.hosted_invoice_url ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-teal-700 hover:text-teal-900 text-xs"
                        >
                          View invoice →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        {/* Recent transactions */}
        <SectionCard title={`Recent Transactions (last ${transactions.length})`}>
          <div className="table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {!transactions.length ? (
                  <tr><td colSpan={5}><EmptyState message="No transactions yet." /></td></tr>
                ) : (
                  transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="text-gray-600">{t.customerEmail ?? "—"}</td>
                      <td className="font-medium">{formatPence(t.amount)}</td>
                      <td className="text-gray-500 text-xs max-w-48 truncate">{t.description ?? "—"}</td>
                      <td>
                        <StatusBadge
                          label={t.status}
                          colour={
                            t.status === "succeeded"
                              ? "bg-green-100 text-green-800"
                              : t.status === "failed"
                              ? "bg-red-100 text-red-800"
                              : "bg-gray-100 text-gray-600"
                          }
                        />
                      </td>
                      <td className="text-gray-400 text-xs">
                        {new Date(t.created * 1000).toLocaleDateString("en-GB")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
