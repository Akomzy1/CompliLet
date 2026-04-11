"use client";

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface DataPoint {
  name: string;
  value: number; // pence
}

const COLOURS = ["#0f2b46", "#0d9488", "#6366f1", "#f59e0b", "#ef4444", "#8b5cf6"];

export function RevenuePieChart({ data }: { data: DataPoint[] }) {
  if (!data.length || data.every((d) => d.value === 0)) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        No revenue data yet
      </div>
    );
  }

  const formatted = data.map((d) => ({
    ...d,
    displayValue: `£${(d.value / 100).toFixed(0)}`,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={formatted}
          cx="50%"
          cy="45%"
          innerRadius={55}
          outerRadius={90}
          dataKey="value"
          nameKey="name"
          paddingAngle={2}
        >
          {formatted.map((_, i) => (
            <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number) => `£${(value / 100).toFixed(2)}`}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
