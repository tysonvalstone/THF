"use client";

import { useState } from "react";
import type { ArrBridge } from "@/lib/finance/metrics";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Step {
  key: string;
  label: string;
  value: number;
  kind: "total" | "up" | "down";
  count?: number;
  from: number;
  to: number;
}

function steps(b: ArrBridge): Step[] {
  const raw: Omit<Step, "from" | "to">[] = [
    { key: "opening", label: "Opening", value: b.opening, kind: "total" },
    { key: "new", label: "New", value: b.newArr, kind: "up", count: b.counts.new },
    { key: "expansion", label: "Expansion", value: b.expansion, kind: "up", count: b.counts.expansion },
    { key: "contraction", label: "Contraction", value: -b.contraction, kind: "down", count: b.counts.contraction },
    { key: "churn", label: "Churn", value: -b.churn, kind: "down", count: b.counts.churn },
    { key: "closing", label: "Closing", value: b.closing, kind: "total" },
  ];
  let run = 0;
  return raw.map((s) => {
    if (s.kind === "total") {
      run = s.value;
      return { ...s, from: 0, to: s.value };
    }
    const from = run;
    run += s.value;
    return { ...s, from, to: run };
  });
}

const signed = (s: Step) => (s.kind === "total" || s.value === 0 ? fmtMoney(s.value) : `${s.value > 0 ? "+" : "−"}${fmtMoney(Math.abs(s.value))}`);

/** ARR bridge waterfall: opening → new, expansion, contraction, churn → closing */
export function ArrWaterfall({ bridge, periodLabel }: { bridge: ArrBridge; periodLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const bars = steps(bridge);
  const W = 640;
  const H = 230;
  const top = 32;
  const base = H - 28;
  // Zoom the axis so movements stay visible next to large opening/closing bars
  const hi = Math.max(1, ...bars.map((b) => Math.max(b.from, b.to)));
  const lo = Math.min(...bars.filter((b) => b.kind !== "total").map((b) => Math.min(b.from, b.to)), hi);
  const floor = lo > hi * 0.5 ? Math.max(0, lo - (hi - lo) * 1.2) : 0;
  const Y = (v: number) => base - ((Math.max(v, floor) - floor) / (hi - floor)) * (base - top);
  const slot = W / bars.length;
  const bw = Math.min(64, slot * 0.5);
  const shown = hover !== null ? bars[hover] : null;
  const summary = `ARR bridge, ${periodLabel}: ${bars.map((b) => `${b.label} ${signed(b)}`).join(", ")}`;

  return (
    <div>
      <p className="h-5 text-xs text-muted-foreground tabular" aria-live="polite">
        {shown ? (
          <>
            {shown.label} · <span className="font-medium text-foreground">{signed(shown)}</span>
            {shown.count !== undefined && ` · ${shown.count} account${shown.count === 1 ? "" : "s"}`}
          </>
        ) : (
          <>
            {periodLabel} · net change{" "}
            <span className="font-medium text-foreground">
              {bridge.closing - bridge.opening >= 0 ? "+" : "−"}
              {fmtMoney(Math.abs(bridge.closing - bridge.opening))}
            </span>
          </>
        )}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-auto w-full" role="img" aria-label={summary} onMouseLeave={() => setHover(null)}>
        <line x1={0} x2={W} y1={base} y2={base} className="stroke-border" strokeWidth={1} />
        {floor > 0 && (
          <text x={W - 2} y={10} textAnchor="end" className="fill-muted-foreground text-[10px]">
            axis from {fmtMoney(floor)}
          </text>
        )}
        {bars.map((b, i) => {
          const cx = slot * i + slot / 2;
          const y1 = Y(Math.max(b.from, b.to));
          const h = Math.max(1, Math.abs(Y(b.from) - Y(b.to)));
          const next = bars[i + 1];
          return (
            <g key={b.key} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} className="outline-none">
              <rect x={slot * i} y={top - 18} width={slot} height={H - top} fill="transparent" />
              <rect
                x={cx - bw / 2}
                y={y1}
                width={bw}
                height={h}
                rx={2}
                className={cn(b.kind === "down" ? "fill-slate-400" : "fill-primary", b.kind === "up" && "opacity-60", hover === i && "opacity-100")}
              />
              {next && <line x1={cx + bw / 2} x2={cx + slot - bw / 2} y1={Y(b.to)} y2={Y(b.to)} className="stroke-slate-300" strokeDasharray="2 2" />}
              <text x={cx} y={y1 - 6} textAnchor="middle" className="fill-foreground text-[11px] font-medium tabular">
                {signed(b)}
              </text>
              <text x={cx} y={base + 16} textAnchor="middle" className={cn("text-[11px]", hover === i ? "fill-foreground" : "fill-muted-foreground")}>
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>ARR bridge, {periodLabel}</caption>
        <tbody>
          {bars.map((b) => (
            <tr key={b.key}>
              <th scope="row">{b.label}</th>
              <td>{signed(b)}</td>
              <td>{b.count !== undefined ? `${b.count} accounts` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
