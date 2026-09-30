/**
 * Layout of the top-down receiving yard (SVG units, viewBox 0 0 720 420) and
 * polyline paths the trucks drive along.
 */

export const VIEW_W = 720;
export const VIEW_H = 420;

export interface Pose {
  x: number;
  y: number;
  /** Heading in degrees, 0 = east */
  a: number;
}

export interface Path {
  pts: [number, number][];
  cum: number[];
  length: number;
}

/** Rounds the corners of a polyline with quadratic curves, sampled */
function smooth(points: [number, number][], radius = 22): [number, number][] {
  if (points.length < 3) return points;
  const out: [number, number][] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const d1 = Math.hypot(cx - px, cy - py);
    const d2 = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    const a: [number, number] = [cx - ((cx - px) / d1) * r, cy - ((cy - py) / d1) * r];
    const b: [number, number] = [cx + ((nx - cx) / d2) * r, cy + ((ny - cy) / d2) * r];
    out.push(a);
    for (let k = 1; k < 8; k++) {
      const t = k / 8;
      const x = (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * cx + t * t * b[0];
      const y = (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * cy + t * t * b[1];
      out.push([x, y]);
    }
    out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

export function makePath(points: [number, number][], radius?: number): Path {
  const pts = smooth(points, radius);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, length: cum[cum.length - 1] };
}

export function poseAt(p: Path, s: number): Pose {
  const d = Math.max(0, Math.min(p.length, s));
  let lo = 0,
    hi = p.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const seg = p.cum[hi] - p.cum[lo] || 1;
  const t = (d - p.cum[lo]) / seg;
  const [x0, y0] = p.pts[lo];
  const [x1, y1] = p.pts[hi];
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, a: (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI };
}

export const svgPath = (p: Path) => p.pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");

// ---------------------------------------------------------------------------
// Yard layout
// ---------------------------------------------------------------------------
export const ROAD = { top: 336, bottom: 384, west: 350, east: 370 };
export const DRIVE = { left: 92, right: 140, inX: 126, outX: 106 };
export const LANE_Y = 262;
export const OUT_LANE_Y = 242;
export const HEAD_X = 268;
export const QUEUE_SPACING = 40;
/** Vertical exit lane from the pits to the county road */
export const EXIT_X = 624;
/** Vehicle drawing scale */
export const TRUCK_SCALE = 1.2;
export const DECK = { x0: 292, x1: 364, cx: 328, h: 22 };
export const PIT = { x0: 500, x1: 530, truckX: 514, shedX0: 474, shedX1: 560 };
export const STAGING_X = [454, 414];

export interface Layout {
  scales: number;
  pits: number;
  deckY: number[];
  pitY: number[];
  inPath: Path;
  /** Arc length of the front of the line on inPath */
  headS: number;
  givePath: Path;
  exitPaths: Path[];
  bins: { cx: number; cy: number; r: number }[];
  leg: { x: number; y: number };
  house: { x: number; y: number; w: number; h: number };
  /** Outdoor ground pile */
  pile: { cx: number; cy: number; rx: number; ry: number };
  signX: number;
  signAnchor: "start" | "end";
}

const rows = (n: number, center: number, gap: number) => Array.from({ length: n }, (_, k) => center + (k - (n - 1) / 2) * gap);

/** `east`: the competitor lies east, so trucks that give up turn right on the county road */
export function makeLayout(scales: number, pits: number, east: boolean): Layout {
  const nS = Math.max(1, Math.min(4, Math.round(scales)));
  const nP = Math.max(1, Math.min(5, Math.round(pits)));
  const deckY = rows(nS, LANE_Y, nS >= 4 ? 30 : 32).map((y) => Math.min(y, ROAD.top - 20));
  const pitY = rows(nP, LANE_Y, nP >= 4 ? 28 : 32).map((y) => Math.min(y, ROAD.top - 18));
  const inPath = makePath(
    [
      [-70, ROAD.east],
      [DRIVE.inX, ROAD.east],
      [DRIVE.inX, LANE_Y],
      [HEAD_X, LANE_Y],
    ],
    26,
  );
  const giveEnd: [number, number][] = east
    ? [
        [DRIVE.outX, ROAD.east],
        [VIEW_W + 70, ROAD.east],
      ]
    : [
        [DRIVE.outX, ROAD.west],
        [-70, ROAD.west],
      ];
  const givePath = makePath([[HEAD_X, LANE_Y], [HEAD_X + 14, LANE_Y - 6], [HEAD_X + 4, OUT_LANE_Y], [DRIVE.outX, OUT_LANE_Y], ...giveEnd], 16);
  const exitPaths = pitY.map((y) =>
    makePath(
      [
        [PIT.truckX, y],
        [EXIT_X, y],
        [EXIT_X, ROAD.east],
        [VIEW_W + 70, ROAD.east],
      ],
      14,
    ),
  );
  const pitTop = pitY[0] - 17;
  return {
    scales: nS,
    pits: nP,
    deckY,
    pitY,
    inPath,
    headS: inPath.length,
    givePath,
    exitPaths,
    bins: [
      { cx: 392, cy: 92, r: 44 },
      { cx: 490, cy: 74, r: 52 },
      { cx: 594, cy: 88, r: 44 },
      { cx: 672, cy: 126, r: 32 },
    ],
    leg: { x: (PIT.x0 + PIT.x1) / 2 + 30, y: Math.min(pitTop - 26, 170) },
    house: { x: DECK.x0 + 6, y: deckY[0] - DECK.h / 2 - 40, w: 58, h: 34 },
    pile: { cx: 222, cy: 92, rx: 58, ry: 34 },
    signX: east ? VIEW_W - 10 : 10,
    signAnchor: east ? "end" : "start",
  };
}
