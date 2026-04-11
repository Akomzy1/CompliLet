"use client";

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface DataPoint {
  reason: string;
  count: number;
}

const COLOURS = ["#ef4444", "#f97316", "#f59e0b", "#6366f1", "#0d9488", "#6b7280"];

export function EscalationReasonsChart({ data }: { data: DataPoint[] }) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        No escalations yet
      </div>
    );
  }

  const mapped = data.map((d) => ({ name: d.reason, value: d.count }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={mapped}
          cx="50%"
          cy="45%"
          outerRadius={85}
          dataKey="value"
          nameKey="name"
          paddingAngle={2}
        >
          {mapped.map((_, i) => (
            <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
