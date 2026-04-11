interface MetricCardProps {
  title: string;
  value: string | number;
  badge?: string;
  badgeColour?: "green" | "red" | "amber" | "blue" | "gray";
  subtext?: string;
  href?: string;
}

const BADGE_COLOURS = {
  green: "bg-green-100 text-green-800",
  red: "bg-red-100 text-red-800",
  amber: "bg-amber-100 text-amber-800",
  blue: "bg-blue-100 text-blue-800",
  gray: "bg-gray-100 text-gray-700",
};

export function MetricCard({
  title,
  value,
  badge,
  badgeColour = "green",
  subtext,
}: MetricCardProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-gray-500 font-medium">{title}</p>
        {badge && (
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${BADGE_COLOURS[badgeColour]}`}
          >
            {badge}
          </span>
        )}
      </div>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
      {subtext && <p className="mt-1 text-xs text-gray-400">{subtext}</p>}
    </div>
  );
}
