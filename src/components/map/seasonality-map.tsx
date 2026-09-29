"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type JSX } from "react";
import { geoConicConformal, geoContains, geoPath, type GeoContext, type GeoProjection } from "d3-geo";

import {
  CROP_CALENDAR,
  MAP_COMMODITIES,
  growingRegions,
  harvestWindow,
  phaseLabel,
  phaseValue,
  type MapCommodity,
} from "@/lib/cropCalendar";
import { inBounds, loadIlIaCounties, loadMapGeo, type MapCounty, type MapGeo, type MapRegion } from "./geo-data";
import { NOT_GROWN_COLOR, RDBU_STOPS, phaseColor } from "./rdbu";

export interface MapFacility {
  id: string;
  lat: number;
  lon: number;
  label: string;
  covered: boolean;
}

export interface SeasonalityMapProps {
  /** The as-of date (time travel drives this). Interpreted in UTC. */
  date: Date;
  initialCommodity?: MapCommodity;
  /** Optional dot layer. */
  facilities?: MapFacility[];
  /** Optional IL/IA county FIPS codes with zero coverage, drawn hatched with a dashed outline. */
  whitespaceCountyFips?: string[];
  /** Preferred map height in px. Defaults to ~0.62 × width; capped on narrow screens. */
  height?: number;
}

/* ------------------------------------------------------------------ constants */

const ACCENT = "#1F5F4A";
const BORDER = "#94a3b8"; // slate-400
const BAND_STEP = 0.25; // degrees of latitude per colour band
const LON_STEP = 0.5;
const MAX_LAT = 60;
const MIN_LAT = 23;

/** Points framing the lower 48 + southern Canada; the projection is fitted to these. */
const FIT_FRAME: GeoJSON.MultiPoint = {
  type: "MultiPoint",
  coordinates: [
    [-124.8, 48.4],
    [-124.4, 40.4],
    [-117.1, 32.5],
    [-97.2, 25.8],
    [-80.1, 24.8],
    [-67, 44.8],
    [-59.5, 47.5],
    [-123, 55],
    [-110, 56.5],
    [-95, 56.5],
    [-75, 51],
  ],
};

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/* ------------------------------------------------------------ geometry cache */

interface Band {
  lat: number;
  path: Path2D;
}

interface ProjectedGeo {
  projection: GeoProjection;
  regionPath: Map<string, Path2D>;
  bands: (r: MapRegion) => Band[];
  countyPath: (c: MapCounty) => Path2D;
}

/** Path2D lacks beginPath(); geoPath only needs the drawing calls. */
function toPath2D(draw: (ctx: GeoContext) => void): Path2D {
  const p = new Path2D();
  const ctx = Object.assign(p, { beginPath() {} }) as unknown as GeoContext;
  draw(ctx);
  return p;
}

function buildProjectedGeo(geo: MapGeo, width: number, height: number): ProjectedGeo {
  const projection = geoConicConformal()
    .rotate([96, 0])
    .parallels([33, 55])
    .fitExtent(
      [
        [8, 8],
        [width - 8, height - 8],
      ],
      FIT_FRAME,
    )
    .clipExtent([
      [0, 0],
      [width, height],
    ]);

  const regionPath = new Map<string, Path2D>();
  for (const r of geo.regions) {
    regionPath.set(r.code, toPath2D((ctx) => geoPath(projection, ctx)(r.feature)));
  }

  // Latitude bands per region: phase value depends only on (region, latitude),
  // so a region is coloured as a stack of thin parallel strips clipped to its shape.
  // Built lazily and cached per projection; date/commodity changes only refill them.
  const bandCache = new Map<string, Band[]>();
  const bands = (r: MapRegion): Band[] => {
    let out = bandCache.get(r.code);
    if (out) return out;
    out = [];
    const [[lon0, lat0], [lon1, lat1]] = r.bounds;
    const west = lon0 - LON_STEP;
    const east = lon1 + LON_STEP;
    const start = Math.floor(Math.max(lat0, MIN_LAT) / BAND_STEP) * BAND_STEP;
    const stop = Math.min(lat1, MAX_LAT);
    for (let lat = start; lat < stop; lat += BAND_STEP) {
      const s = lat - 0.02;
      const n = lat + BAND_STEP + 0.02; // slight overlap hides hairline seams
      const path = new Path2D();
      let first = true;
      for (let lon = west; lon <= east + 1e-9; lon += LON_STEP) {
        const pt = projection([lon, s]);
        if (!pt) continue;
        if (first) path.moveTo(pt[0], pt[1]);
        else path.lineTo(pt[0], pt[1]);
        first = false;
      }
      for (let lon = east; lon >= west - 1e-9; lon -= LON_STEP) {
        const pt = projection([lon, n]);
        if (pt) path.lineTo(pt[0], pt[1]);
      }
      path.closePath();
      out.push({ lat: lat + BAND_STEP / 2, path });
    }
    bandCache.set(r.code, out);
    return out;
  };

  const countyCache = new Map<string, Path2D>();
  const countyPath = (c: MapCounty): Path2D => {
    let p = countyCache.get(c.fips);
    if (!p) {
      p = toPath2D((ctx) => geoPath(projection, ctx)(c.feature));
      countyCache.set(c.fips, p);
    }
    return p;
  };

  return { projection, regionPath, bands, countyPath };
}

function hatchPattern(ctx: CanvasRenderingContext2D, dpr: number): CanvasPattern | null {
  const size = Math.round(6 * dpr);
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (!g) return null;
  g.strokeStyle = "rgba(15, 23, 42, 0.55)"; // slate-900
  g.lineWidth = Math.max(1, dpr * 0.9);
  g.beginPath();
  g.moveTo(0, size);
  g.lineTo(size, 0);
  g.moveTo(-size / 2, size / 2);
  g.lineTo(size / 2, -size / 2);
  g.moveTo(size / 2, size * 1.5);
  g.lineTo(size * 1.5, size / 2);
  g.stroke();
  const pattern = ctx.createPattern(c, "repeat");
  pattern?.setTransform(new DOMMatrix().scale(1 / dpr));
  return pattern;
}

/* ---------------------------------------------------------------- component */

interface Probe {
  x: number;
  y: number;
  lon: number;
  lat: number;
  sticky: boolean;
}

export function SeasonalityMap({
  date,
  initialCommodity = "Corn",
  facilities,
  whitespaceCountyFips,
  height,
}: SeasonalityMapProps): JSX.Element {
  const selectId = useId();
  const summaryId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [commodity, setCommodity] = useState<MapCommodity>(initialCommodity);
  const [geo, setGeo] = useState<MapGeo | null>(null);
  const [counties, setCounties] = useState<MapCounty[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [showFacilities, setShowFacilities] = useState(true);
  const [showWhitespace, setShowWhitespace] = useState(true);
  const [probe, setProbe] = useState<Probe | null>(null);

  const hasFacilities = facilities !== undefined;
  const hasWhitespace = whitespaceCountyFips !== undefined;
  const dateMs = date.getTime();
  const asOf = useMemo(() => new Date(dateMs), [dateMs]);
  const whitespaceSet = useMemo(() => new Set(whitespaceCountyFips ?? []), [whitespaceCountyFips]);

  /* --- load assets --- */
  useEffect(() => {
    let alive = true;
    loadMapGeo()
      .then((g) => alive && setGeo(g))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Failed to load map"));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!hasWhitespace) return;
    let alive = true;
    loadIlIaCounties()
      .then((c) => alive && setCounties(c))
      .catch(() => alive && setCounties([]));
    return () => {
      alive = false;
    };
  }, [hasWhitespace]);

  /* --- size --- */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(Math.floor(el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mapHeight = useMemo(() => {
    if (!width) return height ?? 0;
    const natural = Math.round(width * 0.62);
    return Math.max(200, height ? Math.min(height, Math.round(width * 0.9)) : natural);
  }, [width, height]);

  const projected = useMemo(
    () => (geo && width > 0 && mapHeight > 0 ? buildProjectedGeo(geo, width, mapHeight) : null),
    [geo, width, mapHeight],
  );

  const regionsForCommodity = useMemo(() => {
    if (!geo) return [];
    return growingRegions(commodity)
      .map((code) => geo.regionByCode.get(code))
      .filter((r): r is MapRegion => !!r);
  }, [geo, commodity]);

  const whitespaceCounties = useMemo(
    () => (counties ?? []).filter((c) => whitespaceSet.has(c.fips)),
    [counties, whitespaceSet],
  );

  /* --- draw --- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !projected || !geo) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = width;
    const h = mapHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 1. Land base: every state/province in "Not grown" grey.
    ctx.fillStyle = NOT_GROWN_COLOR;
    for (const p of projected.regionPath.values()) ctx.fill(p);

    // 2. Growing regions: latitude bands coloured by phase, clipped to the region shape.
    for (const r of regionsForCommodity) {
      const clip = projected.regionPath.get(r.code);
      if (!clip) continue;
      ctx.save();
      ctx.clip(clip);
      for (const band of projected.bands(r)) {
        ctx.fillStyle = phaseColor(phaseValue(commodity, r.code, band.lat, asOf));
        ctx.fill(band.path);
      }
      ctx.restore();
    }

    // 3. Borders.
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 0.6;
    ctx.lineJoin = "round";
    for (const p of projected.regionPath.values()) ctx.stroke(p);

    // 4. Whitespace counties (IL/IA): hatched fill + dashed outline.
    if (hasWhitespace && showWhitespace && whitespaceCounties.length) {
      const pattern = hatchPattern(ctx, dpr);
      ctx.save();
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 1;
      for (const c of whitespaceCounties) {
        const p = projected.countyPath(c);
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fill(p);
        }
        ctx.stroke(p);
      }
      ctx.restore();
    }

    // 5. Facilities.
    if (hasFacilities && showFacilities && facilities) {
      const r = w < 480 ? 3 : 3.75;
      for (const f of facilities) {
        const pt = projected.projection([f.lon, f.lat]);
        if (!pt || pt[0] < 0 || pt[1] < 0 || pt[0] > w || pt[1] > h) continue;
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], r, 0, Math.PI * 2);
        if (f.covered) {
          ctx.fillStyle = ACCENT;
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1;
        } else {
          ctx.fillStyle = "#ffffff";
          ctx.fill();
          ctx.strokeStyle = "#64748b"; // slate-500
          ctx.lineWidth = 1.5;
        }
        ctx.stroke();
      }
    }
  }, [
    projected,
    geo,
    width,
    mapHeight,
    regionsForCommodity,
    commodity,
    asOf,
    hasWhitespace,
    showWhitespace,
    whitespaceCounties,
    hasFacilities,
    showFacilities,
    facilities,
  ]);

  /* --- hover / tap --- */
  const probeAt = useCallback(
    (clientX: number, clientY: number, sticky: boolean) => {
      const canvas = canvasRef.current;
      if (!canvas || !projected) return;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const ll = projected.projection.invert?.([x, y]);
      if (!ll) {
        setProbe(null);
        return;
      }
      setProbe({ x, y, lon: ll[0], lat: ll[1], sticky });
    },
    [projected],
  );

  const tooltip = useMemo(() => {
    if (!probe || !geo || !projected) return null;
    const { lon, lat, x, y } = probe;

    // Nearest facility within a few px takes precedence.
    let facility: MapFacility | null = null;
    if (hasFacilities && showFacilities && facilities) {
      let best = 8 * 8;
      for (const f of facilities) {
        const pt = projected.projection([f.lon, f.lat]);
        if (!pt) continue;
        const d = (pt[0] - x) ** 2 + (pt[1] - y) ** 2;
        if (d <= best) {
          best = d;
          facility = f;
        }
      }
    }

    const region = geo.regions.find((r) => inBounds(r.bounds, lon, lat) && geoContains(r.feature, [lon, lat]));
    if (!region && !facility) return null;

    let county: MapCounty | null = null;
    if (region && hasWhitespace && showWhitespace && counties && (region.code === "IL" || region.code === "IA")) {
      county = counties.find((c) => inBounds(c.bounds, lon, lat) && geoContains(c.feature, [lon, lat])) ?? null;
    }

    const value = region ? phaseValue(commodity, region.code, lat, asOf) : null;
    const win = region ? harvestWindow(commodity, region.code, lat, asOf.getUTCFullYear()) : null;
    return { x, y, region, county, facility, value, win };
  }, [
    probe,
    geo,
    projected,
    commodity,
    asOf,
    hasFacilities,
    showFacilities,
    facilities,
    hasWhitespace,
    showWhitespace,
    counties,
  ]);

  // Drop the probe when the map geometry changes (resize).
  const [probeGeometry, setProbeGeometry] = useState(projected);
  if (probeGeometry !== projected) {
    setProbeGeometry(projected);
    setProbe(null);
  }

  /* --- text summary --- */
  const summary = useMemo(() => {
    if (!geo) return null;
    const groups = new Map<string, string[]>();
    for (const r of regionsForCommodity) {
      // Canadian provinces are only farmed along their southern edge.
      const lat = r.country === "CA" ? r.bounds[0][1] + 2 : r.centroid[1];
      const label = phaseLabel(phaseValue(commodity, r.code, lat, asOf));
      groups.set(label, [...(groups.get(label) ?? []), r.name]);
    }
    const order = ["Harvest peak", "Harvest", "Planting peak", "Planting", "Growing / off-season"];
    const parts = order.filter((l) => groups.has(l)).map((l) => `${l}: ${groups.get(l)!.join(", ")}`);
    return `${CROP_CALENDAR[commodity].label} as of ${fmtDate(asOf)}. ${parts.join(". ")}.`;
  }, [geo, regionsForCommodity, commodity, asOf]);

  const ariaLabel = `Seasonality heat map of ${CROP_CALENDAR[commodity].label.toLowerCase()} planting and harvest timing across the United States and Canada as of ${fmtDate(asOf)}.`;

  /* --- tooltip position --- */
  const tipW = Math.min(240, Math.max(160, width - 16));
  const tipLeft = tooltip ? Math.max(8, Math.min(tooltip.x + 12, width - tipW - 8)) : 0;
  const tipAbove = tooltip ? tooltip.y > mapHeight * 0.55 : false;

  return (
    <div className="w-full text-sm text-slate-700">
      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-2">
        <label htmlFor={selectId} className="flex items-center gap-2">
          <span className="text-slate-600">Commodity</span>
          <select
            id={selectId}
            value={commodity}
            onChange={(e) => setCommodity(e.target.value as MapCommodity)}
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900 focus:border-[#1F5F4A] focus:outline-none focus:ring-1 focus:ring-[#1F5F4A]"
          >
            {MAP_COMMODITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {hasFacilities && (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={showFacilities}
              onChange={(e) => setShowFacilities(e.target.checked)}
              className="size-4 accent-[#1F5F4A]"
            />
            Facilities
          </label>
        )}
        {hasWhitespace && (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={showWhitespace}
              onChange={(e) => setShowWhitespace(e.target.checked)}
              className="size-4 accent-[#1F5F4A]"
            />
            Whitespace counties
          </label>
        )}
      </div>

      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-md border border-slate-200 bg-white"
        style={mapHeight ? { height: mapHeight } : { aspectRatio: "1 / 0.62" }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={ariaLabel}
          aria-describedby={summary ? summaryId : undefined}
          className="absolute inset-0 block touch-manipulation"
          style={{ width: width || "100%", height: mapHeight || "100%" }}
          onPointerMove={(e) => {
            if (e.pointerType === "mouse") probeAt(e.clientX, e.clientY, false);
          }}
          onPointerDown={(e) => {
            if (e.pointerType !== "mouse") probeAt(e.clientX, e.clientY, true);
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") setProbe(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setProbe(null);
          }}
        />
        {!geo && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-slate-500">
            {error ? "Map could not be loaded." : "Loading map…"}
          </div>
        )}
        {tooltip && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] leading-snug shadow-sm"
            style={{
              width: tipW,
              left: tipLeft,
              ...(tipAbove ? { bottom: mapHeight - tooltip.y + 12 } : { top: tooltip.y + 12 }),
            }}
          >
            {tooltip.facility && (
              <div className={tooltip.region ? "mb-1.5 border-b border-slate-200 pb-1.5" : undefined}>
                <div className="font-medium text-slate-900">{tooltip.facility.label}</div>
                <div className="text-slate-500">{tooltip.facility.covered ? "Covered" : "Not covered"}</div>
              </div>
            )}
            {tooltip.region && (
              <>
                <div className="font-medium text-slate-900">
                  {tooltip.county ? `${tooltip.county.name} County, ${tooltip.county.state}` : tooltip.region.name}
                </div>
                <div className="text-slate-500">
                  {commodity}: <span className="text-slate-900">{phaseLabel(tooltip.value)}</span>
                </div>
                {tooltip.win && (
                  <div className="text-slate-500">
                    Est. harvest {fmtDate(tooltip.win.start).replace(/, \d{4}$/, "")} –{" "}
                    {fmtDate(tooltip.win.end).replace(/, \d{4}$/, "")}
                  </div>
                )}
                {tooltip.county && whitespaceSet.has(tooltip.county.fips) && (
                  <div className="mt-1 text-slate-900">Whitespace: no coverage</div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 text-xs text-slate-600">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex h-2.5 w-full max-w-sm overflow-hidden rounded-sm border border-slate-200">
            {RDBU_STOPS.map((c) => (
              <span key={c} className="h-full flex-1" style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="mt-1 flex w-full max-w-sm justify-between">
            <span>Planting</span>
            <span>Growing / Off-season</span>
            <span>Harvest peak</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="inline-block size-3 rounded-sm border border-slate-300" style={{ backgroundColor: NOT_GROWN_COLOR }} />
            Not grown
          </span>
          {hasFacilities && showFacilities && (
            <>
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: ACCENT }} />
                Covered
              </span>
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="inline-block size-2.5 rounded-full border-[1.5px] border-slate-500 bg-white" />
                Not covered
              </span>
            </>
          )}
          <span className="whitespace-nowrap text-slate-900">As of {fmtDate(asOf)}</span>
        </div>
      </div>

      {summary && (
        <p id={summaryId} className="sr-only" aria-live="polite">
          {summary}
        </p>
      )}
    </div>
  );
}

export default SeasonalityMap;
