"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/data/store";
import { closedWonMix, type MixRow } from "@/lib/dashboard";
import { USER_BY_ID } from "@/data/reference/users";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Fixed categorical order (entity keeps its colour); the rest fold into "Other" */
const PALETTE = ["#1F5F4A", "#B5821E", "#4F7CAC", "#8E6BB0", "#B5574B"];
const OTHER = "#94A3B8";

function top(rows: MixRow[], n: number): MixRow[] {
  if (rows.length <= n) return rows;
  const rest = rows.slice(n - 1);
  return [...rows.slice(0, n - 1), { key: "other", label: "Other", value: rest.reduce((s, r) => s + r.value, 0), count: rest.reduce((s, r) => s + r.count, 0) }];
}

function Donut({ rows, total }: { rows: MixRow[]; total: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const r = 52;
  const c = 2 * Math.PI * r;
  const lens = rows.map((row) => (total ? (row.value / total) * c : 0));
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  const shown = hover !== null ? rows[hover] : null;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <svg viewBox="0 0 140 140" className="size-36 shrink-0" role="img" aria-label={`Closed won by rep: ${rows.map((x) => `${x.label} ${fmtMoney(x.value)}`).join(", ")}`}>
        <g transform="rotate(-90 70 70)">
          {rows.map((row, i) => (
            <circle
              key={row.key}
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={row.key === "other" ? OTHER : PALETTE[i % PALETTE.length]}
              strokeWidth={hover === i ? 20 : 16}
              strokeDasharray={`${Math.max(0, lens[i] - 2)} ${c}`}
              strokeDashoffset={-starts[i]}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className="transition-[stroke-width] duration-150"
            />
          ))}
        </g>
        <text x="70" y="66" textAnchor="middle" className="fill-foreground text-[15px] font-semibold tabular">
          {fmtMoney(shown?.value ?? total, { compact: true })}
        </text>
        <text x="70" y="84" textAnchor="middle" className="fill-muted-foreground text-[9px]">
          {shown ? shown.label.split(" ")[0] : "Total"}
        </text>
      </svg>
      <ul className="w-full space-y-1.5 text-sm">
        {rows.map((row, i) => (
          <li key={row.key} className={cn("flex items-center gap-2 rounded px-1", hover === i && "bg-muted")} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: row.key === "other" ? OTHER : PALETTE[i % PALETTE.length] }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <span className="text-xs text-muted-foreground tabular">{total ? Math.round((row.value / total) * 100) : 0}%</span>
            <span className="w-16 text-right tabular">{fmtMoney(row.value, { compact: true })}</span>
          </li>
        ))}
        {!rows.length && <li className="text-muted-foreground">No wins yet</li>}
      </ul>
    </div>
  );
}

const DIMENSIONS = [
  ["product", "Product"],
  ["commodity", "Commodity"],
  ["region", "Region"],
] as const;

/** Closed won, trailing 12 months: rep mix and product / commodity / region bars */
export function ClosedWonMix() {
  const { data, asOf } = useStore();
  const [dim, setDim] = useState<(typeof DIMENSIONS)[number][0]>("product");
  const mix = useMemo(() => closedWonMix(data, asOf, USER_BY_ID), [data, asOf]);
  const bars = mix[dim].slice(0, 7);
  const max = Math.max(1, ...bars.map((b) => b.value));
  const barTotal = mix[dim].reduce((s, r) => s + r.value, 0);

  return (
    <section className="min-w-0 rounded-md border bg-card" aria-labelledby="mix-title">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 id="mix-title" className="text-sm font-semibold">
          Closed Won, last 12 months
        </h2>
        <span className="text-xs text-muted-foreground tabular">
          {mix.deals} deals · {fmtMoney(mix.total)}
        </span>
      </div>
      <div className="grid gap-6 p-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-xs font-medium text-muted-foreground">By rep</h3>
          <Donut rows={top(mix.rep, 6)} total={mix.total} />
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">By {DIMENSIONS.find(([k]) => k === dim)![1].toLowerCase()}</h3>
            <div className="inline-flex rounded-md border p-0.5 text-xs" role="tablist" aria-label="Breakdown">
              {DIMENSIONS.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={dim === k}
                  onClick={() => setDim(k)}
                  className={cn("rounded-[4px] px-2 py-0.5", dim === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ul className="space-y-2">
            {bars.map((b) => (
              <li key={b.key} className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3 text-sm" title={`${b.label}: ${fmtMoney(b.value)} · ${b.count}`}>
                <span className="truncate text-muted-foreground">{b.label}</span>
                <span className="flex items-center gap-2">
                  <span className="h-3 rounded-r-[4px] bg-primary transition-[width] duration-500" style={{ width: `${Math.max(0.5, (b.value / max) * 70)}%` }} />
                  <span className="shrink-0 text-xs tabular">
                    {fmtMoney(b.value, { compact: true })}
                    <span className="text-muted-foreground"> · {barTotal ? Math.round((b.value / barTotal) * 100) : 0}%</span>
                  </span>
                </span>
              </li>
            ))}
            {!bars.length && <li className="text-sm text-muted-foreground">No wins yet</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}
