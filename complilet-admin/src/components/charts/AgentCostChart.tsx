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
  date: string;
  cost: number; // USD
  calls: number;
}

export function AgentCostChart({ data }: { data: DataPoint[] }) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        No agent data yet
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "#6b7280" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#6b7280" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `$${v.toFixed(2)}`}
        />
        <Tooltip
          formatter={(v: number) => [`$${v.toFixed(4)}`, "Cost"]}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
        />
        <Line
          type="monotone"
          dataKey="cost"
          stroke="#6366f1"
          strokeWidth={2}
          dot={{ r: 2 }}
          activeDot={{ r: 4 }}
          name="Cost (USD)"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
