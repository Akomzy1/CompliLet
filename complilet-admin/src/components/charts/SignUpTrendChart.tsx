"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface DataPoint {
  label: string;
  count: number;
}

interface Props {
  data: DataPoint[];
  title?: string;
}

export function SignUpTrendChart({ data, title = "Landlord Sign-ups" }: Props) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        No data yet
      </div>
    );
  }
  return (
    <div className="h-full w-full">
      {title && <p className="text-xs text-gray-500 mb-2">{title}</p>}
      <ResponsiveContainer width="100%" height="90%">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "#6b7280" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#6b7280" }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="#0d9488"
            strokeWidth={2}
            dot={{ r: 3, fill: "#0d9488" }}
            activeDot={{ r: 5 }}
            name="Sign-ups"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
