export const LANDLORD_PLAN_VALUES = [
  "free_trial",
  "pay_per_screen",
  "landlord_pro",
  "tenancy_manager",
  "portfolio",
  "global_landlord",
] as const;

export type LandlordPlan = (typeof LANDLORD_PLAN_VALUES)[number];

export const PLAN_LABEL: Record<LandlordPlan, string> = {
  free_trial:      "Free Trial",
  pay_per_screen:  "Pay-Per-Screen",
  landlord_pro:    "Landlord Pro",
  tenancy_manager: "Tenancy Manager",
  portfolio:       "Portfolio",
  global_landlord: "Global Landlord",
};

export const PLAN_MONTHLY_PENCE: Record<LandlordPlan, number> = {
  free_trial:      0,
  pay_per_screen:  0,
  landlord_pro:    1999,
  tenancy_manager: 1499,
  portfolio:       3999,
  global_landlord: 2999,
};

export const SUBSCRIPTION_PLANS: ReadonlySet<LandlordPlan> = new Set<LandlordPlan>([
  "landlord_pro",
  "tenancy_manager",
  "portfolio",
  "global_landlord",
]);

export function planBadgeClass(plan: string): string {
  switch (plan) {
    case "portfolio":
    case "global_landlord":
      return "bg-admin-teal/10 text-admin-teal border-admin-teal/30";
    case "landlord_pro":
    case "tenancy_manager":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "pay_per_screen":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "free_trial":
    default:
      return "bg-admin-cream text-admin-mute border-admin-line";
  }
}

export function formatGbp(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: pence % 100 === 0 ? 0 : 2,
  }).format(pence / 100);
}
