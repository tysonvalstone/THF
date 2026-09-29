"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CloudSun, Megaphone } from "lucide-react";
import { REGION_BY_STATE } from "@/data/reference/regions";
import { STATE_NAMES, TILE_GRID } from "@/data/reference/geo";
import { useStore } from "@/lib/data/store";
import { cropStatusLabel, PHASE_ORDER, type RegionStatus } from "@/lib/season";
import { fmtShortDate } from "@/lib/dates";
import { PHASE_STYLE, PhaseChip } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { campaignBuilderHref } from "@/lib/links";
import type { RegionId } from "@/types/salesforce";
import { cn } from "@/lib/utils";

const TILE = 44;
const GAP = 4;
const COLS = 12;
const ROWS = 10;

function pickDefaultRegion(regions: RegionStatus[]): RegionId {
  const pre = regions
    .filter((r) => r.headline.phase === "Pre-harvest")
    .sort((a, b) => a.headline.daysToHarvest - b.headline.daysToHarvest)[0];
  return (pre ?? regions.find((r) => r.headline.phase === "Harvest") ?? regions[0]).region.id;
}

export function SeasonMap() {
  const { regions, ranked } = useStore();
  const byId = useMemo(() => Object.fromEntries(regions.map((r) => [r.region.id, r])) as Record<RegionId, RegionStatus>, [regions]);
  const [selected, setSelected] = useState<RegionId | null>(null);
  const [hovered, setHovered] = useState<RegionId | null>(null);
  const active = hovered ?? selected ?? pickDefaultRegion(regions);
  const status = byId[active];
  const prospectsInRegion = ranked.filter((s) => s.target.regionId === active);
  const hot = prospectsInRegion.filter((s) => s.tier === "Hot").length;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div>
        <svg
          viewBox={`0 0 ${COLS * (TILE + GAP)} ${ROWS * (TILE + GAP) + 6}`}
          className="h-auto w-full select-none"
          role="img"
          aria-label="Tile map of Canadian provinces and U.S. states colored by current crop phase"
        >
          {Object.entries(TILE_GRID).map(([code, [col, row]]) => {
            const regionId = REGION_BY_STATE[code] as RegionId | undefined;
            const st = regionId ? byId[regionId] : undefined;
            const style = st ? PHASE_STYLE[st.headline.phase] : null;
            const isActive = regionId === active;
            const x = col * (TILE + GAP);
            const y = row * (TILE + GAP) + (row >= 2 ? 6 : 0);
            return (
              <g
                key={code}
                role={regionId ? "button" : undefined}
                tabIndex={regionId ? 0 : undefined}
                aria-label={regionId ? `${STATE_NAMES[code]}: ${st!.region.name}, ${st!.headline.phase}` : STATE_NAMES[code]}
                className={cn(regionId && "cursor-pointer outline-none")}
                onMouseEnter={() => regionId && setHovered(regionId)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => regionId && setHovered(regionId)}
                onBlur={() => setHovered(null)}
                onClick={() => regionId && setSelected(regionId)}
                onKeyDown={(e) => {
                  if (regionId && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    setSelected(regionId);
                  }
                }}
              >
                <title>{STATE_NAMES[code]}</title>
                <rect
                  x={x}
                  y={y}
                  width={TILE}
                  height={TILE}
                  rx={6}
                  fill={style ? style.fill : "#f1f2ef"}
                  stroke={isActive ? "#121a15" : style ? "#ffffff" : "#e3e5df"}
                  strokeWidth={isActive ? 2.5 : 1}
                  opacity={regionId && !isActive && hovered ? 0.55 : 1}
                  style={{ transition: "opacity 120ms, stroke 120ms" }}
                />
                <text
                  x={x + TILE / 2}
                  y={y + TILE / 2 + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={12}
                  fontWeight={600}
                  fill={style ? style.text : "#a3a9a1"}
                  pointerEvents="none"
                >
                  {code}
                </text>
              </g>
            );
          })}
          <line x1={0} x2={COLS * (TILE + GAP) - GAP} y1={2 * (TILE + GAP) + 1} y2={2 * (TILE + GAP) + 1} stroke="#d6dad2" strokeDasharray="3 4" />
          <text x={0} y={2 * (TILE + GAP) - 6} fontSize={10} fill="#898781" letterSpacing={1.5}>
            CANADA ▲ ▼ UNITED STATES
          </text>
        </svg>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Legend">
          {PHASE_ORDER.map((p) => (
            <li key={p} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-3 rounded-[3px] ring-1 ring-black/5" style={{ background: PHASE_STYLE[p].fill }} />
              {PHASE_STYLE[p].label}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col rounded-lg border bg-muted/40 p-4" aria-live="polite">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{status.region.states.join(" · ")}</p>
            <h3 className="mt-0.5 text-lg font-semibold">{status.region.name}</h3>
          </div>
          <PhaseChip phase={status.headline.phase} />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{status.region.summary}</p>
        {status.climate.condition !== "Normal" && (
          <p className="mt-3 flex gap-2 rounded-md bg-card p-2.5 text-sm ring-1 ring-border">
            <CloudSun className="mt-0.5 size-4 shrink-0 text-[#8a6100]" aria-hidden />
            <span>
              <strong className="font-medium">{status.climate.condition}:</strong> {status.climate.note}
            </span>
          </p>
        )}
        <ul className="mt-3 divide-y rounded-md bg-card ring-1 ring-border">
          {status.crops.map((c) => (
            <li key={c.commodity} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: PHASE_STYLE[c.phase].fill }} aria-hidden />
                <span>{cropStatusLabel(c)}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular">
                Harvest {fmtShortDate(c.window.start)} – {fmtShortDate(c.window.end)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 text-sm">
          <strong className="tabular">{prospectsInRegion.length}</strong> ranked prospects here, <strong className="tabular">{hot}</strong> hot right now.
        </div>
        <div className="mt-auto flex flex-wrap gap-2 pt-4">
          <Button asChild size="sm">
            <Link href={campaignBuilderHref({ regions: [active], commodity: status.headline.commodity })}>
              <Megaphone className="size-4" />
              Build a {status.region.shortName} campaign
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/prospects?region=${active}`}>
              View prospects <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
