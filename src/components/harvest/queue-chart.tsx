"use client";

import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { DAY_MINUTES, clockLabel, type DaySim } from "@/lib/harvest/engine";
import type { SimClock } from "./use-sim-clock";

const PAD = { l: 26, r: 8, t: 10, b: 20 };
const TICKS = [60, 240, 420, 600, 780, 960];

function areaPath(q: Uint16Array, max: number, close: boolean, W: number, H: number): string {
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (m: number) => PAD.l + (m / DAY_MINUTES) * iw;
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  let d = `M${x(0)} ${y(q[0])}`;
  for (let m = 3; m < q.length; m += 3) d += `L${x(m).toFixed(1)} ${y(q[m]).toFixed(1)}`;
  d += `L${x(DAY_MINUTES)} ${y(q[DAY_MINUTES])}`;
  return close ? `${d}L${x(DAY_MINUTES)} ${PAD.t + ih}L${x(0)} ${PAD.t + ih}Z` : d;
}

/**
 * Trucks waiting over the day. The part already played is solid; the playhead
 * follows the clock, and clicking or dragging the chart seeks.
 */
export const QueueChart = memo(function QueueChart({ manual, automated, clock, height = 116 }: { manual: DaySim; automated?: DaySim | null; clock: Pick<SimClock, "subscribe" | "seek">; height?: number }) {
  const uid = useId().replace(/:/g, "");
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(320);
  const H = height;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const clip = useRef<SVGRectElement>(null);
  const head = useRef<SVGGElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const max = useMemo(() => Math.max(4, manual.maxQueue, automated?.maxQueue ?? 0) * 1.1, [manual, automated]);
  const paths = useMemo(
    () => ({
      mArea: areaPath(manual.series.queue, max, true, W, H),
      mLine: areaPath(manual.series.queue, max, false, W, H),
      aLine: automated ? areaPath(automated.series.queue, max, false, W, H) : null,
    }),
    [manual, automated, max, W, H],
  );
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const subscribe = clock.subscribe;
  const seek = clock.seek;

  useEffect(
    () =>
      subscribe((t) => {
        const x = PAD.l + (t / DAY_MINUTES) * iw;
        clip.current?.setAttribute("width", Math.max(0, x - PAD.l).toFixed(1));
        head.current?.setAttribute("transform", `translate(${x.toFixed(1)} 0)`);
      }),
    [subscribe, iw],
  );

  const seekTo = (clientX: number) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return;
    const x = ((clientX - r.left) / r.width) * W;
    seek(((x - PAD.l) / iw) * DAY_MINUTES);
  };
  const yTicks = [0, Math.round(max / 2 / 5) * 5 || Math.round(max / 2), Math.floor(max / 5) * 5 || Math.floor(max)].filter((v, i, a) => a.indexOf(v) === i && v <= max);

  return (
    <div ref={box} className="w-full">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block cursor-ew-resize touch-none"
        role="img"
        aria-label={`Trucks waiting over the day, peak ${manual.maxQueue}${automated ? `, ${automated.maxQueue} with automation` : ""}`}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          seekTo(e.clientX);
        }}
        onPointerMove={(e) => dragging.current && seekTo(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
      >
        <defs>
          <clipPath id={`played-${uid}`}>
            <rect ref={clip} x={PAD.l} y="0" width="0" height={H} />
          </clipPath>
          <linearGradient id={`fill-${uid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#b91c1c" stopOpacity="0.28" />
            <stop offset="1" stopColor="#b91c1c" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        {yTicks.map((v) => {
          const y = PAD.t + ih - (v / max) * ih;
          return (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={PAD.l - 5} y={y + 3} textAnchor="end" fontSize="9.5" fill="#94a3b8" className="tabular">
                {v}
              </text>
            </g>
          );
        })}
        {TICKS.map((m) => (
          <text key={m} x={PAD.l + (m / DAY_MINUTES) * iw} y={H - 6} textAnchor="middle" fontSize="9.5" fill="#94a3b8">
            {clockLabel(m).replace(":00", "").replace(" ", "")}
          </text>
        ))}
        {/* Whole day, faint */}
        <path d={paths.mLine} fill="none" stroke="#cbd5e1" strokeWidth="1.2" />
        {paths.aLine && <path d={paths.aLine} fill="none" stroke="#cbd5e1" strokeWidth="1.2" strokeDasharray="3 3" />}
        {/* Played so far */}
        <g clipPath={`url(#played-${uid})`}>
          <path d={paths.mArea} fill={`url(#fill-${uid})`} />
          <path d={paths.mLine} fill="none" stroke="#b91c1c" strokeWidth="1.6" strokeLinejoin="round" />
          {paths.aLine && <path d={paths.aLine} fill="none" stroke="#1f5f4a" strokeWidth="1.8" strokeLinejoin="round" />}
        </g>
        <g ref={head}>
          <line x1="0" x2="0" y1={PAD.t - 4} y2={PAD.t + ih} stroke="#0f172a" strokeWidth="1" />
          <circle cx="0" cy={PAD.t - 4} r="2.5" fill="#0f172a" />
        </g>
      </svg>
    </div>
  );
});
