interface StatusBadgeProps {
  label: string;
  colour?: string; // Tailwind class string
}

export function StatusBadge({ label, colour = "bg-gray-100 text-gray-700" }: StatusBadgeProps) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${colour}`}>
      {label}
    </span>
  );
}

// ─── Traffic-light compliance badge ──────────────────────────────────────────
type TrafficLight = "green" | "amber" | "red";
const TL_COLOURS: Record<TrafficLight, string> = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
};
const TL_LABELS: Record<TrafficLight, string> = {
  green: "All Clear",
  amber: "Attention",
  red: "Action Required",
};

export function ComplianceBadge({ status }: { status: TrafficLight }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TL_COLOURS[status]}`}
    >
      <span className="text-[10px]">●</span>
      {TL_LABELS[status]}
    </span>
  );
}
