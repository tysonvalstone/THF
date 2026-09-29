"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtMoney } from "@/lib/format";

interface Row {
  stage: string;
  amount: number;
  count: number;
}

function StageTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{r.stage}</p>
      <p className="mt-0.5 text-muted-foreground tabular">
        {fmtMoney(r.amount)} · {r.count} deal{r.count === 1 ? "" : "s"}
      </p>
    </div>
  );
}

export function StageChart({ data }: { data: Row[] }) {
  return (
    <div className="h-56 w-full" role="img" aria-label="Open pipeline amount by stage">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis
            type="category"
            dataKey="stage"
            width={112}
            tickLine={false}
            axisLine={{ stroke: "#c3c2b7" }}
            tick={{ fontSize: 12, fill: "#52514e" }}
          />
          <Tooltip content={<StageTooltip />} cursor={{ fill: "rgba(42,120,214,0.06)" }} />
          <Bar
            dataKey="amount"
            fill="var(--chart-1)"
            radius={[0, 4, 4, 0]}
            label={{
              position: "right",
              fontSize: 12,
              fill: "#52514e",
              formatter: (v: unknown) => fmtMoney(Number(v)),
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
