"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { useStore } from "@/lib/data/store";
import { crushMargin, fmtPrice, history, pctChange, priceAt } from "@/lib/market";
import { addMonths, monthKey } from "@/lib/dates";
import type { PriceSeriesKey } from "@/types/reference";

const ITEMS: { key: PriceSeriesKey; label: string; note: string }[] = [
  { key: "Corn", label: "Corn", note: "Corn Belt, ethanol, feed" },
  { key: "Soybeans", label: "Soybeans", note: "Elevators, crushers" },
  { key: "Winter Wheat", label: "HRW wheat", note: "Southern Plains, flour" },
  { key: "Canola", label: "Canola", note: "Prairies, crushers" },
];

function Delta({ change }: { change: number }) {
  const Icon = Math.abs(change) < 0.01 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground tabular">
      <Icon className="size-3.5" aria-hidden />
      {change > 0 ? "+" : change < 0 ? "−" : ""}
      {Math.abs(change * 100).toFixed(1)}% 3 mo
    </span>
  );
}

function Spark({ data, format }: { data: { month: string; price: number }[]; format: (v: number) => string }) {
  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            cursor={{ stroke: "#c3c2b7", strokeWidth: 1 }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded border bg-card px-2 py-1 text-[11px] shadow-sm tabular">
                  {(payload[0].payload as { month: string }).month}: {format(Number(payload[0].value))}
                </div>
              ) : null
            }
          />
          <Line type="monotone" dataKey="price" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MarketStrip() {
  const { asOf } = useStore();
  const marginHistory = Array.from({ length: 12 }, (_, i) => {
    const d = addMonths(asOf, i - 11);
    return { month: monthKey(d), price: +crushMargin(d).toFixed(2) };
  });
  const margin = crushMargin(asOf);
  const marginChange = margin - crushMargin(addMonths(asOf, -3));
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {ITEMS.map((it) => (
        <div key={it.key} className="rounded-lg border bg-card p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">{it.label}</p>
            <Delta change={pctChange(it.key, asOf, 3)} />
          </div>
          <p className="mt-1 text-lg font-semibold tabular">{fmtPrice(it.key, priceAt(it.key, asOf))}</p>
          <Spark data={history(it.key, asOf, 12)} format={(v) => fmtPrice(it.key, v)} />
          <p className="truncate text-[11px] text-muted-foreground">{it.note}</p>
        </div>
      ))}
      <div className="col-span-2 rounded-lg border bg-card p-3 md:col-span-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">Ethanol crush margin</p>
          <span className="text-xs text-muted-foreground tabular">
            {marginChange >= 0 ? "+" : "−"}${Math.abs(marginChange).toFixed(2)} 3 mo
          </span>
        </div>
        <p className="mt-1 text-lg font-semibold tabular">${margin.toFixed(2)}/gal</p>
        <Spark data={marginHistory} format={(v) => `$${v.toFixed(2)}/gal`} />
        <p className="truncate text-[11px] text-muted-foreground">Ethanol + DDGS − corn − opex</p>
      </div>
    </div>
  );
}
