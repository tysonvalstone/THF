/**
 * Small map: the facility, the nearest competitor and the section-road route
 * the trucks take when they give up. Drawn on a 1-mile grid (rural roads in
 * the grain belt follow section lines).
 */
const W = 300;
const H = 170;

export interface InsetPoint {
  name: string;
  lat: number;
  lon: number;
}

const short = (s: string, n = 30) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function RouteInset({ facility, competitor, miles, direction }: { facility: InsetPoint; competitor: InsetPoint; miles: number; direction: string }) {
  // Local flat projection in miles
  const mPerLat = 69;
  const mPerLon = 69 * Math.cos((facility.lat * Math.PI) / 180);
  const dx = (competitor.lon - facility.lon) * mPerLon;
  const dy = -(competitor.lat - facility.lat) * mPerLat;
  const span = Math.max(Math.abs(dx) / (W - 90), Math.abs(dy) / (H - 64), 0.02);
  const k = 1 / span;
  const cx = W / 2 - (dx * k) / 2;
  const cy = H / 2 - (dy * k) / 2 + 4;
  const fx = cx;
  const fy = cy;
  const tx = cx + dx * k;
  const ty = cy + dy * k;
  const step = miles > 30 ? 5 : miles > 12 ? 2 : 1; // section roads every mile
  const grid = step * k;
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  if (grid > 6) {
    for (let x = fx % grid; x < W; x += grid) lines.push({ x1: x, y1: 0, x2: x, y2: H });
    for (let y = fy % grid; y < H; y += grid) lines.push({ x1: 0, y1: y, x2: W, y2: y });
  }
  // Along the section roads: east–west first, then north–south
  const route = `M${fx} ${fy}H${tx}V${ty}`;
  const barMiles = [20, 10, 5, 2, 1, 0.5, 0.25].find((b) => b * k <= W * 0.3) ?? 0.25;
  const labelBelow = (y: number, other: number) => y >= other;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full rounded-md border bg-[#f7f5ef]" role="img" aria-label={`Route to ${competitor.name}, ${miles.toFixed(1)} miles ${direction}`}>
      <g stroke="#e7e1d1" strokeWidth="1">
        {lines.map((l, i) => (
          <line key={i} {...l} />
        ))}
      </g>
      <path d={route} fill="none" stroke="#ffffff" strokeWidth="5" strokeLinejoin="round" />
      <path d={route} fill="none" stroke="#b91c1c" strokeWidth="1.8" strokeDasharray="5 4" strokeLinejoin="round" />
      {/* Competitor */}
      <circle cx={tx} cy={ty} r="5" fill="#64748b" stroke="#ffffff" strokeWidth="1.5" />
      <text x={Math.min(W - 6, Math.max(6, tx))} y={labelBelow(ty, fy) ? ty + 16 : ty - 9} textAnchor={tx > W * 0.66 ? "end" : tx < W * 0.33 ? "start" : "middle"} fontSize="9.5" fill="#334155">
        {short(competitor.name)}
      </text>
      {/* Facility */}
      <circle cx={fx} cy={fy} r="9" fill="#1f5f4a" opacity="0.15" />
      <circle cx={fx} cy={fy} r="5.5" fill="#1f5f4a" stroke="#ffffff" strokeWidth="1.5" />
      <text
        x={Math.min(W - 6, Math.max(6, fx))}
        y={labelBelow(fy, ty) && fy !== ty ? fy + 18 : fy - 11}
        textAnchor={fx > W * 0.66 ? "end" : fx < W * 0.33 ? "start" : "middle"}
        fontSize="9.5"
        fontWeight="600"
        fill="#0f172a"
      >
        {short(facility.name)}
      </text>
      {/* North arrow and scale */}
      <g transform={`translate(${W - 16} 18)`}>
        <path d="M0 -9L4 3L0 0.5L-4 3Z" fill="#64748b" />
        <text x="0" y="13" textAnchor="middle" fontSize="7.5" fill="#64748b">
          N
        </text>
      </g>
      <g transform="translate(10 14)">
        <line x1="0" x2={barMiles * k} y1="0" y2="0" stroke="#64748b" strokeWidth="1.4" />
        <line x1="0" x2="0" y1="-3" y2="3" stroke="#64748b" strokeWidth="1.2" />
        <line x1={barMiles * k} x2={barMiles * k} y1="-3" y2="3" stroke="#64748b" strokeWidth="1.2" />
        <text x={barMiles * k + 5} y="3" fontSize="8" fill="#64748b">
          {barMiles} mi
        </text>
      </g>
    </svg>
  );
}
