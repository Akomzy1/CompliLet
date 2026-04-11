import { format, formatDistanceToNow, parseISO, differenceInMinutes, differenceInHours } from "date-fns";

// ─── Currency ─────────────────────────────────────────────────────────────────
export function formatPence(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(pence / 100);
}

export function formatPounds(pounds: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(pounds);
}

// ─── Numbers ──────────────────────────────────────────────────────────────────
export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-GB").format(n);
}

export function formatPercent(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`;
}

// ─── Dates ────────────────────────────────────────────────────────────────────
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "d MMM yyyy");
  } catch {
    return "—";
  }
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "d MMM yyyy, HH:mm");
  } catch {
    return "—";
  }
}

export function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true });
  } catch {
    return "—";
  }
}

// ─── Duration ─────────────────────────────────────────────────────────────────
export function formatDuration(startStr: string, endStr?: string | null): string {
  try {
    const start = parseISO(startStr);
    const end = endStr ? parseISO(endStr) : new Date();
    const mins = differenceInMinutes(end, start);
    if (mins < 60) return `${mins}m`;
    const hrs = differenceInHours(end, start);
    const remainingMins = mins % 60;
    if (hrs < 24) return remainingMins > 0 ? `${hrs}h ${remainingMins}m` : `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d ${hrs % 24}h`;
  } catch {
    return "—";
  }
}

// ─── Age badge ────────────────────────────────────────────────────────────────
export function getAgeColour(createdAt: string): string {
  try {
    const hours = differenceInHours(new Date(), parseISO(createdAt));
    if (hours < 4) return "text-green-600";
    if (hours < 24) return "text-amber-600";
    return "text-red-600 font-semibold";
  } catch {
    return "text-gray-600";
  }
}

// ─── Token cost estimate ──────────────────────────────────────────────────────
// Claude claude-sonnet-4-6 pricing: $3/MTok input, $15/MTok output
export function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
}

export function formatCost(dollars: number): string {
  if (dollars < 0.01) return `$${(dollars * 100).toFixed(3)}¢`;
  return `$${dollars.toFixed(4)}`;
}
