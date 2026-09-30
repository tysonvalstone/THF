"use client";

import { memo, useEffect, useId, useMemo, useRef } from "react";
import { PIT_SETUP_MINUTES, queueExit, type DaySim, type TruckKind } from "@/lib/harvest/engine";
import { cn } from "@/lib/utils";
import { DECK, DRIVE, EXIT_X, HEAD_X, LANE_Y, OUT_LANE_Y, PIT, QUEUE_SPACING, ROAD, STAGING_X, TRUCK_SCALE, VIEW_H, VIEW_W, makeLayout, poseAt, type Pose } from "./geometry";
import type { SimClock } from "./use-sim-clock";

/** Scene palette */
export const C = {
  field: "#f4f1e8",
  stubble: "#e9e2cf",
  pad: "#eef1f4",
  concrete: "#dfe4ea",
  road: "#c9d1db",
  roadLine: "#f8fafc",
  structure: "#94a3b8",
  structureDark: "#64748b",
  ink: "#334155",
  label: "#94a3b8",
  gold: "#B5821E",
  grain: "#d9a441",
  grainLight: "#ecc56f",
  green: "#1f5f4a",
  amber: "#d97706",
  red: "#b91c1c",
  empty: "#e2e8f0",
  tree: "#d5ded3",
  glow: "#fde68a",
} as const;

const POOL = 90;
const LOADED_BODY = "#a37a2c";
const LOADED_EDGE = "#8a6522";
const APPROACH_MIN = 2.2;
const EXIT_MIN = 3.2;
const GIVE_MIN = 9;

export const waitColor = (w: number) => (w < 15 ? C.green : w < 30 ? C.amber : C.red);

interface Shape {
  body: [number, number, number, number];
  load: [number, number, number, number];
  cab: [number, number, number, number];
  glass: [number, number, number, number];
}
/** x, y, w, h for a vehicle pointing east, centered on 0,0 */
const SHAPES: Record<TruckKind, Shape> = {
  semi: { body: [-15, -4.5, 21, 9], load: [-14, -3.4, 19, 6.8], cab: [7, -4, 8, 8], glass: [12.4, -3.1, 1.9, 6.2] },
  straight: { body: [-10, -4.2, 13, 8.4], load: [-9, -3.2, 11, 6.4], cab: [4, -3.8, 7, 7.6], glass: [8.8, -3, 1.8, 6] },
  wagon: { body: [-11, -4, 12, 8], load: [-10, -3, 10, 6], cab: [3, -3, 8, 6], glass: [7.6, -2.4, 1.6, 4.8] },
};

const SVGNS = "http://www.w3.org/2000/svg";
const el = (tag: string, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const setRect = (r: Element, [x, y, w, h]: [number, number, number, number]) => {
  r.setAttribute("x", String(x));
  r.setAttribute("y", String(y));
  r.setAttribute("width", String(w));
  r.setAttribute("height", String(h));
};

interface Slot {
  g: SVGGElement;
  shadow: SVGRectElement;
  body: SVGRectElement;
  load: SVGRectElement;
  cab: SVGRectElement;
  glass: SVGRectElement;
  truck: number;
  kind: TruckKind | null;
  pose: Pose;
  color: string;
  loaded: boolean;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const easeOut = (x: number) => 1 - (1 - x) * (1 - x);

/** Darkness 0–1 for the hour of day (sunrise ~7:20, sunset ~6:40 in October) */
function darkness(t: number): number {
  const h = 5 + t / 60;
  if (h < 7.6) return clamp01((7.6 - h) / 2.4);
  if (h > 18.3) return clamp01((h - 18.3) / 1.3);
  return 0;
}

export interface SceneCompetitor {
  name: string;
  miles: number;
  direction: string;
  /** Competitor lies to the east (trucks turn right) */
  east: boolean;
}

const short = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Top-down receiving yard. Static structures are React-rendered; trucks, bins,
 * lights and the probe are updated imperatively each animation frame from the
 * simulation traces, so the scene stays smooth at 60 fps.
 */
export const YardScene = memo(function YardScene({
  sim,
  clock,
  competitor,
  dailyBushels,
  className,
  label,
  automated,
}: {
  sim: DaySim;
  clock: Pick<SimClock, "subscribe">;
  competitor: SceneCompetitor | null;
  dailyBushels: number;
  className?: string;
  label: string;
  /** Draws the ScaleTrac kiosks at the scales */
  automated?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const layout = useMemo(() => makeLayout(sim.scales, sim.pits, competitor?.east ?? false), [sim.scales, sim.pits, competitor?.east]);
  const poolRef = useRef<SVGGElement>(null);
  const binFill = useRef<(SVGCircleElement | null)[]>([]);
  const binPct = useRef<SVGTextElement>(null);
  const deckLight = useRef<(SVGCircleElement | null)[]>([]);
  const probe = useRef<(SVGCircleElement | null)[]>([]);
  const pitGlow = useRef<(SVGGElement | null)[]>([]);
  const conveyor = useRef<SVGGElement>(null);
  const night = useRef<SVGRectElement>(null);
  const lights = useRef<SVGGElement>(null);
  const signBox = useRef<SVGRectElement>(null);
  const signCount = useRef<SVGTSpanElement>(null);
  const badge = useRef<SVGGElement>(null);
  const badgeText = useRef<SVGTextElement>(null);
  const tag = useRef<SVGGElement>(null);
  const subscribe = clock.subscribe;

  useEffect(() => {
    const root = poolRef.current;
    if (!root) return;
    const L = layout;
    const trucks = sim.trucks;
    const n = trucks.length;
    const exitQ = new Float64Array(n);
    for (let i = 0; i < n; i++) exitQ[i] = queueExit(trucks[i]);
    const headAt = (T: number) => {
      let lo = 0,
        hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (exitQ[mid] <= T) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const rankAtArrival = new Int32Array(n);
    for (let i = 0; i < n; i++) rankAtArrival[i] = i - headAt(trucks[i].arrive);
    const binCaps = L.bins.map((b) => b.r * b.r);
    const capSum = binCaps.reduce((a, b) => a + b, 0);

    // Build the truck pool
    root.replaceChildren();
    const slots: Slot[] = [];
    for (let k = 0; k < POOL; k++) {
      const g = el("g", { display: "none" }) as SVGGElement;
      const shadow = el("rect", { fill: "#0f172a", "fill-opacity": 0.13, rx: 2, transform: "translate(1.2 1.6)" }) as SVGRectElement;
      const body = el("rect", { rx: 1.4, "stroke-width": 0.6, fill: LOADED_BODY, stroke: LOADED_EDGE }) as SVGRectElement;
      const load = el("rect", { rx: 1, fill: `url(#grain-${uid})` }) as SVGRectElement;
      const cab = el("rect", { rx: 2 }) as SVGRectElement;
      const glass = el("rect", { rx: 0.8, fill: "#e2e8f0", "fill-opacity": 0.9 }) as SVGRectElement;
      g.append(shadow, body, load, cab, glass);
      root.append(g);
      slots.push({ g, shadow, body, load, cab, glass, truck: -1, kind: null, pose: { x: 0, y: 0, a: 0 }, color: "", loaded: true });
    }
    const byTruck = new Map<number, Slot>();
    const free = [...slots];
    let wall = 0;

    interface Vis {
      i: number;
      pose: Pose;
      color: string;
      load: number;
    }

    const draw = (t: number, dt: number, jumped: boolean) => {
      wall += dt;
      const head = headAt(t);
      const vis: Vis[] = [];
      const staging: number[] = [];
      const deckState = new Array<number>(L.scales).fill(0);
      const pitLoad = new Array<number>(L.pits).fill(-1);
      let offscreen = 0;
      let lastGive = -1;
      let lastGivePose: Pose | null = null;

      for (let i = 0; i < n; i++) {
        const tr = trucks[i];
        if (tr.arrive - APPROACH_MIN > t) break;
        const eq = exitQ[i];
        const waited = Math.min(t, eq) - tr.arrive;
        if (t < tr.arrive) {
          const target = L.headS - rankAtArrival[i] * QUEUE_SPACING;
          if (target < 14) continue;
          const p = easeOut(clamp01((t - (tr.arrive - APPROACH_MIN)) / APPROACH_MIN));
          vis.push({ i, pose: poseAt(L.inPath, target * p), color: C.green, load: 1 });
        } else if (t < eq) {
          const s = L.headS - (i - head) * QUEUE_SPACING;
          if (s < 14) {
            offscreen++;
            continue;
          }
          vis.push({ i, pose: poseAt(L.inPath, s), color: waitColor(waited), load: 1 });
        } else if (tr.lost) {
          const g = t - tr.leaveAt;
          if (g > GIVE_MIN) continue;
          const pose = poseAt(L.givePath, L.givePath.length * easeInOut(clamp01(g / GIVE_MIN)));
          vis.push({ i, pose, color: C.red, load: 1 });
          if (tr.leaveAt > lastGive) {
            lastGive = tr.leaveAt;
            lastGivePose = pose;
          }
        } else if (t < tr.scaleRelease) {
          const k = Math.min(L.scales - 1, tr.scale);
          deckState[k] = t < tr.scaleEnd ? 1 : 2;
          vis.push({ i, pose: { x: DECK.cx, y: L.deckY[k], a: 0 }, color: waitColor(waited), load: 1 });
        } else if (t < tr.pitStart) {
          staging.push(i);
        } else if (t < tr.pitEnd) {
          const p = Math.min(L.pits - 1, tr.pit);
          const dump = tr.pitEnd - tr.pitStart - PIT_SETUP_MINUTES;
          const load = 1 - clamp01((t - tr.pitStart - PIT_SETUP_MINUTES) / Math.max(0.1, dump));
          if (load < 1) pitLoad[p] = load;
          vis.push({ i, pose: { x: PIT.truckX, y: L.pitY[p], a: 0 }, color: waitColor(waited), load });
        } else if (t < tr.pitEnd + EXIT_MIN) {
          const path = L.exitPaths[Math.min(L.pits - 1, tr.pit)];
          vis.push({ i, pose: poseAt(path, path.length * easeInOut(clamp01((t - tr.pitEnd) / EXIT_MIN))), color: waitColor(waited), load: 0 });
        }
      }
      staging.sort((a, b) => trucks[a].scaleRelease - trucks[b].scaleRelease || a - b);
      staging.forEach((i, r) => {
        const lane = r % L.pits;
        const depth = Math.floor(r / L.pits);
        const tr = trucks[i];
        vis.push({ i, pose: { x: STAGING_X[depth] ?? STAGING_X[STAGING_X.length - 1] - 30 * depth, y: L.pitY[lane], a: 0 }, color: waitColor(tr.scaleStart - tr.arrive), load: 1 });
      });

      // Pool: keep each truck in its slot; smooth moves between spots
      const alive = new Set<number>();
      const k = jumped ? 1 : 1 - Math.exp(-dt / 0.075);
      for (const v of vis) {
        if (alive.size >= POOL) break;
        alive.add(v.i);
        let s = byTruck.get(v.i);
        const tr = trucks[v.i];
        let snap = jumped;
        if (!s) {
          s = free.pop();
          if (!s) continue;
          byTruck.set(v.i, s);
          s.truck = v.i;
          s.g.setAttribute("display", "inline");
          snap = true;
        }
        if (s.kind !== tr.kind) {
          const sh = SHAPES[tr.kind];
          s.kind = tr.kind;
          setRect(s.body, sh.body);
          setRect(s.cab, sh.cab);
          setRect(s.glass, sh.glass);
          const [bx, by, , bh] = sh.body;
          setRect(s.shadow, [bx, by, sh.cab[0] + sh.cab[2] - bx, bh]);
          setRect(s.load, sh.load);
        }
        if (snap) s.pose = { ...v.pose };
        else {
          s.pose.x += (v.pose.x - s.pose.x) * k;
          s.pose.y += (v.pose.y - s.pose.y) * k;
          let da = v.pose.a - s.pose.a;
          da = ((((da + 180) % 360) + 360) % 360) - 180;
          s.pose.a += da * k;
        }
        s.g.setAttribute("transform", `translate(${s.pose.x.toFixed(2)} ${s.pose.y.toFixed(2)}) rotate(${s.pose.a.toFixed(1)}) scale(${TRUCK_SCALE})`);
        if (s.color !== v.color) {
          s.color = v.color;
          s.cab.setAttribute("fill", v.color);
        }
        const sh = SHAPES[tr.kind];
        const w = sh.load[2] * v.load;
        s.load.setAttribute("width", w.toFixed(2));
        s.load.setAttribute("x", (sh.load[0] + sh.load[2] - w).toFixed(2));
        const loaded = v.load > 0.02;
        if (loaded !== s.loaded) {
          s.loaded = loaded;
          s.body.setAttribute("fill", loaded ? LOADED_BODY : C.empty);
          s.body.setAttribute("stroke", loaded ? LOADED_EDGE : C.structure);
        }
      }
      for (const [i, s] of byTruck) {
        if (alive.has(i)) continue;
        s.g.setAttribute("display", "none");
        s.truck = -1;
        byTruck.delete(i);
        free.push(s);
      }

      // Scale decks and probes
      deckState.forEach((st, k) => {
        const light = deckLight.current[k];
        if (light) light.setAttribute("fill", st === 1 ? "#22c55e" : st === 2 ? C.amber : "#cbd5e1");
        const pr = probe.current[k];
        if (pr) {
          const active = st === 1;
          pr.setAttribute("fill", active ? C.gold : C.structureDark);
          pr.setAttribute("r", (active ? 3 + Math.sin(wall * 14 + k) * 0.9 : 2.6).toFixed(2));
        }
      });
      // Pits
      let anyDump = false;
      pitLoad.forEach((load, p) => {
        const g = pitGlow.current[p];
        if (!g) return;
        const on = load >= 0;
        anyDump ||= on;
        g.setAttribute("opacity", on ? "1" : "0");
        if (on) {
          const kids = g.children;
          for (let c = 1; c < kids.length; c++) {
            const phase = (wall * 2.2 + c * 0.33) % 1;
            kids[c].setAttribute("cy", (L.pitY[p] - 6 + phase * 12).toFixed(2));
            kids[c].setAttribute("opacity", (1 - phase).toFixed(2));
          }
        }
      });
      if (conveyor.current) {
        conveyor.current.setAttribute("opacity", anyDump ? "1" : "0");
        conveyor.current.style.strokeDashoffset = String(-(wall * 26) % 100);
      }
      // Bins fill in order
      const m = Math.min(sim.series.buReceived.length - 1, Math.floor(t));
      const m2 = Math.min(sim.series.buReceived.length - 1, m + 1);
      const rec = sim.series.buReceived[m] + (sim.series.buReceived[m2] - sim.series.buReceived[m]) * (t - m);
      const frac = clamp01(rec / Math.max(1, dailyBushels));
      let left = frac * capSum;
      L.bins.forEach((b, j) => {
        const f = clamp01(left / binCaps[j]);
        left -= binCaps[j] * f;
        binFill.current[j]?.setAttribute("r", (b.r * 0.94 * Math.sqrt(f)).toFixed(2));
      });
      if (binPct.current) binPct.current.textContent = `${Math.round(frac * 100)}% full`;

      // Night
      const d = darkness(t);
      night.current?.setAttribute("opacity", (d * 0.3).toFixed(3));
      lights.current?.setAttribute("opacity", d.toFixed(3));

      // Line length badge
      if (badge.current && badgeText.current) {
        badge.current.setAttribute("display", offscreen > 0 ? "inline" : "none");
        badgeText.current.textContent = `+${offscreen} in line`;
      }
      // Competitor sign and "to <competitor>" tag
      const lostSoFar = sim.series.lost[m];
      if (signCount.current) signCount.current.textContent = lostSoFar ? ` · ${lostSoFar} trucks` : "";
      if (signBox.current) {
        const recent = lastGive >= 0 && t - lastGive < 6;
        signBox.current.setAttribute("stroke", recent ? C.red : "#cbd5e1");
        signBox.current.setAttribute("stroke-width", recent ? "1.5" : "1");
      }
      if (tag.current) {
        if (lastGivePose && competitor) {
          tag.current.setAttribute("display", "inline");
          tag.current.setAttribute("transform", `translate(${lastGivePose.x.toFixed(1)} ${(lastGivePose.y - 13).toFixed(1)})`);
        } else tag.current.setAttribute("display", "none");
      }
    };
    return subscribe(draw);
  }, [sim, layout, subscribe, uid, dailyBushels, competitor]);

  const L = layout;
  const pitTop = L.pitY[0] - 17;
  const pitBottom = L.pitY[L.pits - 1] + 17;
  const signText = competitor ? `to ${short(competitor.name)} · ${competitor.miles < 10 ? competitor.miles.toFixed(1) : Math.round(competitor.miles)} mi ${competitor.direction}` : "";

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className={cn("block h-auto w-full select-none", className)} role="img" aria-label={label}>
      <defs>
        <pattern id={`stubble-${uid}`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">
          <rect width="9" height="9" fill={C.field} />
          <line x1="0" y1="0" x2="0" y2="9" stroke={C.stubble} strokeWidth="2.2" />
        </pattern>
        <pattern id={`grain-${uid}`} width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill={C.grain} />
          <circle cx="1" cy="1" r="0.7" fill={C.grainLight} />
          <circle cx="2.4" cy="2.3" r="0.5" fill="#c38f2f" />
        </pattern>
        <pattern id={`grate-${uid}`} width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill="#475569" />
          <line x1="0" y1="1.5" x2="3" y2="1.5" stroke="#94a3b8" strokeWidth="0.7" />
        </pattern>
        <radialGradient id={`glow-${uid}`}>
          <stop offset="0" stopColor={C.glow} stopOpacity="0.9" />
          <stop offset="1" stopColor={C.glow} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`binshade-${uid}`} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e2e8f0" />
        </radialGradient>
      </defs>

      {/* Fields and yard */}
      <rect width={VIEW_W} height={VIEW_H} fill={`url(#stubble-${uid})`} />
      <rect x="150" y="12" width={VIEW_W - 162} height={ROAD.top - 18} rx="10" fill={C.pad} stroke="#e2e8f0" />
      {[
        [30, 40, 16],
        [52, 58, 12],
        [24, 70, 10],
        [690, 250, 12],
        [704, 272, 9],
      ].map(([x, y, r], i) => (
        <g key={i}>
          <circle cx={x + 1.5} cy={y + 2} r={r} fill="#0f172a" opacity="0.06" />
          <circle cx={x} cy={y} r={r} fill={C.tree} />
        </g>
      ))}

      {/* Paving */}
      <rect x={DRIVE.left} y={OUT_LANE_Y - 12} width={DECK.x0 - DRIVE.left + 4} height={LANE_Y - OUT_LANE_Y + 24} fill={C.concrete} />
      <rect x={DRIVE.left} y={OUT_LANE_Y - 12} width={DRIVE.right - DRIVE.left} height={ROAD.top - OUT_LANE_Y + 12} fill={C.concrete} />
      <rect
        x={DECK.x1 - 4}
        y={Math.min(L.deckY[0], L.pitY[0]) - 16}
        width={PIT.shedX0 - DECK.x1 + 8}
        height={Math.max(L.deckY[L.scales - 1], L.pitY[L.pits - 1]) - Math.min(L.deckY[0], L.pitY[0]) + 32}
        fill={C.concrete}
      />
      {L.pitY.map((y, p) => (
        <rect key={p} x={PIT.shedX1 - 2} y={y - 10} width={EXIT_X - PIT.shedX1 + 16} height="20" fill={C.concrete} />
      ))}
      <rect x={EXIT_X - 14} y={L.pitY[0] - 10} width="28" height={ROAD.top - L.pitY[0] + 10} rx="2" fill={C.concrete} />
      <path d={`M${EXIT_X} ${ROAD.top - 34}v18m-4 -6l4 6l4 -6`} fill="none" stroke="#f8fafc" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />

      {/* Ground pile */}
      <g>
        <ellipse cx={L.pile.cx + 2} cy={L.pile.cy + 4} rx={L.pile.rx} ry={L.pile.ry} fill="#0f172a" opacity="0.07" />
        <ellipse cx={L.pile.cx} cy={L.pile.cy} rx={L.pile.rx} ry={L.pile.ry} fill={`url(#grain-${uid})`} stroke="#b88a35" strokeWidth="1" />
        <ellipse cx={L.pile.cx} cy={L.pile.cy - 3} rx={L.pile.rx * 0.62} ry={L.pile.ry * 0.5} fill={C.grainLight} opacity="0.5" />
        <line x1={L.pile.cx - L.pile.rx * 0.55} x2={L.pile.cx + L.pile.rx * 0.55} y1={L.pile.cy - 3} y2={L.pile.cy - 3} stroke="#ffffff" strokeOpacity="0.6" strokeWidth="1.2" strokeLinecap="round" />
        <text x={L.pile.cx} y={L.pile.cy + L.pile.ry + 13} textAnchor="middle" fontSize="7.5" letterSpacing="0.08em" fill={C.label}>
          GROUND PILE
        </text>
      </g>
      <line x1={(DRIVE.left + DRIVE.right) / 2} y1={OUT_LANE_Y - 6} x2={(DRIVE.left + DRIVE.right) / 2} y2={ROAD.top} stroke="#f8fafc" strokeWidth="1" strokeDasharray="6 6" />

      {/* County road */}
      <rect x="0" y={ROAD.top} width={VIEW_W} height={ROAD.bottom - ROAD.top} fill={C.road} />
      <line x1="0" x2={VIEW_W} y1={ROAD.top + 3} y2={ROAD.top + 3} stroke={C.roadLine} strokeWidth="1" />
      <line x1="0" x2={VIEW_W} y1={ROAD.bottom - 3} y2={ROAD.bottom - 3} stroke={C.roadLine} strokeWidth="1" />
      <line x1="0" x2={VIEW_W} y1={(ROAD.top + ROAD.bottom) / 2} y2={(ROAD.top + ROAD.bottom) / 2} stroke={C.roadLine} strokeWidth="1.4" strokeDasharray="12 10" />

      {/* Conveyors: pits to leg to bins */}
      <g stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round">
        <line x1={L.leg.x} y1={pitTop} x2={L.leg.x} y2={L.leg.y} />
        {L.bins.map((b, j) => (
          <line key={j} x1={L.leg.x} y1={L.leg.y} x2={b.cx} y2={b.cy} />
        ))}
      </g>
      <g ref={conveyor} opacity="0" stroke={C.gold} strokeWidth="1.6" strokeDasharray="3 5" strokeLinecap="round" fill="none">
        <line x1={L.leg.x} y1={pitTop} x2={L.leg.x} y2={L.leg.y} />
        {L.bins.map((b, j) => (
          <line key={j} x1={L.leg.x} y1={L.leg.y} x2={b.cx} y2={b.cy} />
        ))}
      </g>

      {/* Bins */}
      {L.bins.map((b, j) => (
        <g key={j}>
          <circle cx={b.cx + 2} cy={b.cy + 3} r={b.r} fill="#0f172a" opacity="0.07" />
          <circle cx={b.cx} cy={b.cy} r={b.r} fill={`url(#binshade-${uid})`} stroke={C.structure} strokeWidth="1.4" />
          <circle ref={(e) => void (binFill.current[j] = e)} cx={b.cx} cy={b.cy} r="0" fill={`url(#grain-${uid})`} />
          {Array.from({ length: 16 }, (_, r) => {
            const a = (r / 16) * Math.PI * 2;
            return (
              <line
                key={r}
                x1={b.cx + Math.cos(a) * 5}
                y1={b.cy + Math.sin(a) * 5}
                x2={b.cx + Math.cos(a) * (b.r - 2)}
                y2={b.cy + Math.sin(a) * (b.r - 2)}
                stroke="#ffffff"
                strokeOpacity="0.45"
                strokeWidth="0.7"
              />
            );
          })}
          <circle cx={b.cx} cy={b.cy} r={b.r - 3.5} fill="none" stroke="#cbd5e1" strokeWidth="0.6" />
          <circle cx={b.cx} cy={b.cy} r="4.5" fill="#cbd5e1" stroke={C.structure} strokeWidth="0.8" />
        </g>
      ))}
      <g transform={`translate(${L.bins[1].cx} ${L.bins[1].cy})`}>
        <rect x="-27" y="-10" width="54" height="20" rx="10" fill="#ffffff" fillOpacity="0.92" stroke="#e2e8f0" />
        <text ref={binPct} x="0" y="4" textAnchor="middle" className="tabular" fontSize="10.5" fontWeight="600" fill={C.ink}>
          0%
        </text>
      </g>
      <text x={L.bins[0].cx} y={L.bins[0].cy + L.bins[0].r + 14} textAnchor="middle" fontSize="7.5" letterSpacing="0.08em" fill={C.label}>
        BINS
      </text>

      {/* Leg */}
      <rect x={L.leg.x - 9} y={L.leg.y - 9} width="18" height="18" rx="2" fill="#cbd5e1" stroke={C.structureDark} strokeWidth="1" />
      <path d={`M${L.leg.x - 9} ${L.leg.y - 9}L${L.leg.x + 9} ${L.leg.y + 9}M${L.leg.x + 9} ${L.leg.y - 9}L${L.leg.x - 9} ${L.leg.y + 9}`} stroke={C.structureDark} strokeWidth="0.8" />
      <circle cx={L.leg.x} cy={L.leg.y} r="3.2" fill={C.structureDark} />

      {/* Receiving shed and pits */}
      <rect x={PIT.shedX0} y={pitTop} width={PIT.shedX1 - PIT.shedX0} height={pitBottom - pitTop} rx="3" fill="#dbe2ea" stroke={C.structure} strokeWidth="1" />
      {L.pitY.map((y, p) => (
        <g key={p}>
          <rect x={PIT.x0} y={y - 7.5} width={PIT.x1 - PIT.x0} height="15" rx="1.5" fill={`url(#grate-${uid})`} stroke="#334155" strokeWidth="0.8" />
          <g ref={(e) => void (pitGlow.current[p] = e)} opacity="0">
            <rect x={PIT.x0 - 1.5} y={y - 9} width={PIT.x1 - PIT.x0 + 3} height="18" rx="2.5" fill="none" stroke={C.gold} strokeWidth="1.4" />
            {[0, 1, 2, 3].map((c) => (
              <circle key={c} cx={PIT.x0 + 5 + c * 6.5} cy={y} r="1.3" fill={C.grainLight} />
            ))}
          </g>
        </g>
      ))}
      <text x={(PIT.shedX0 + PIT.shedX1) / 2} y={pitTop - 5} textAnchor="middle" fontSize="7.5" letterSpacing="0.08em" fill={C.label}>
        DUMP PITS
      </text>

      {/* Scale decks, probes, scale house */}
      {L.deckY.map((y, k) => (
        <g key={k}>
          <rect x={DECK.x0} y={y - DECK.h / 2} width={DECK.x1 - DECK.x0} height={DECK.h} rx="2" fill="#c3ccd7" stroke={C.structure} strokeWidth="1" />
          {[1, 2, 3].map((q) => (
            <line
              key={q}
              x1={DECK.x0 + ((DECK.x1 - DECK.x0) * q) / 4}
              x2={DECK.x0 + ((DECK.x1 - DECK.x0) * q) / 4}
              y1={y - DECK.h / 2 + 1}
              y2={y + DECK.h / 2 - 1}
              stroke="#aeb9c6"
              strokeWidth="0.8"
            />
          ))}
          <circle ref={(e) => void (deckLight.current[k] = e)} cx={DECK.x0 + 4} cy={y - DECK.h / 2 + 4} r="2" fill="#cbd5e1" />
          <line x1={DECK.x1 + 8} y1={y - DECK.h / 2 - 2} x2={DECK.cx + 2} y2={y - 3} stroke={C.structureDark} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx={DECK.x1 + 8} cy={y - DECK.h / 2 - 2} r="2.4" fill={C.structureDark} />
          <circle ref={(e) => void (probe.current[k] = e)} cx={DECK.cx + 2} cy={y - 3} r="2.6" fill={C.structureDark} />
          {automated && (
            <g>
              <rect x={DECK.x0 - 12} y={y - 13} width="8" height="10" rx="1.5" fill="#0f172a" />
              <rect x={DECK.x0 - 10.5} y={y - 11.5} width="5" height="4" rx="0.8" fill="#22c55e" />
            </g>
          )}
        </g>
      ))}
      <g>
        <rect x={L.house.x + 2} y={L.house.y + 3} width={L.house.w} height={L.house.h} rx="2" fill="#0f172a" opacity="0.1" />
        <rect x={L.house.x} y={L.house.y} width={L.house.w} height={L.house.h} rx="2" fill="#e2e8f0" stroke={C.structureDark} strokeWidth="1" />
        <path d={`M${L.house.x} ${L.house.y + L.house.h / 2}H${L.house.x + L.house.w}`} stroke={C.structure} strokeWidth="0.8" />
        <rect x={L.house.x + 6} y={L.house.y + L.house.h - 5} width={L.house.w - 12} height="3" rx="1" fill="#94a3b8" />
        <text x={L.house.x + L.house.w / 2} y={L.house.y - 5} textAnchor="middle" fontSize="7.5" letterSpacing="0.08em" fill={C.label}>
          SCALE HOUSE
        </text>
      </g>

      {/* Competitor sign */}
      {competitor && (
        <g>
          <rect
            ref={signBox}
            x={L.signAnchor === "start" ? L.signX : L.signX - 7 * signText.length - 30}
            y={ROAD.bottom + 8}
            width={7 * signText.length + 30}
            height="20"
            rx="4"
            fill="#ffffff"
            stroke="#cbd5e1"
          />
          <text x={L.signAnchor === "start" ? L.signX + 8 : L.signX - 8} y={ROAD.bottom + 22} textAnchor={L.signAnchor} fontSize="10.5" fill={C.ink}>
            {L.signAnchor === "start" ? "← " : ""}
            {signText}
            <tspan ref={signCount} fill={C.red} fontWeight="600" />
            {L.signAnchor === "end" ? " →" : ""}
          </text>
        </g>
      )}

      {/* Trucks */}
      <g ref={poolRef} />

      {/* "to <competitor>" tag on the latest truck that gave up */}
      {competitor && (
        <g ref={tag} display="none" pointerEvents="none">
          <rect x={-(short(competitor.name, 18).length * 5.4 + 22) / 2} y="-9" width={short(competitor.name, 18).length * 5.4 + 22} height="13" rx="3" fill={C.red} />
          <text x="0" y="0.5" textAnchor="middle" fontSize="8.5" fontWeight="600" fill="#ffffff">
            to {short(competitor.name, 18)}
          </text>
        </g>
      )}

      {/* Line length beyond the edge */}
      <g ref={badge} display="none">
        <rect x="6" y={ROAD.top - 22} width="74" height="16" rx="8" fill={C.ink} />
        <text ref={badgeText} x="43" y={ROAD.top - 11} textAnchor="middle" fontSize="9" fontWeight="600" fill="#ffffff" className="tabular" />
      </g>

      {/* Night */}
      <rect ref={night} width={VIEW_W} height={VIEW_H} fill="#0a1a38" opacity="0.3" pointerEvents="none" />
      <g ref={lights} opacity="1" pointerEvents="none">
        <circle cx={L.house.x + L.house.w / 2} cy={L.house.y + L.house.h} r="46" fill={`url(#glow-${uid})`} opacity="0.55" />
        <circle cx={(PIT.shedX0 + PIT.shedX1) / 2} cy={(pitTop + pitBottom) / 2} r="58" fill={`url(#glow-${uid})`} opacity="0.45" />
        <circle cx={HEAD_X - 40} cy={LANE_Y} r="30" fill={`url(#glow-${uid})`} opacity="0.35" />
        <circle cx={L.leg.x} cy={L.leg.y} r="24" fill={`url(#glow-${uid})`} opacity="0.4" />
      </g>
    </svg>
  );
});
