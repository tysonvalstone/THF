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
  /** Optional dot colour (e.g. by commodity) */
  color?: string;
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
  /** Controlled commodity (optional). */
  commodity?: MapCommodity;
  onCommodityChange?: (c: MapCommodity) => void;
  /** State/province codes to zoom to. Empty or undefined = full view. */
  focusCodes?: string[];
  /** Called with the state/province code under a click. */
  onAreaClick?: (code: string) => void;
  /** Called with a facility id when a dot is clicked. */
  onFacilityClick?: (id: string) => void;
  /** Hide the commodity select / layer toggles (the parent renders them). */
  hideControls?: boolean;
  /** Hide the built-in phase legend (the parent renders its own). */
  hideLegend?: boolean;
  /** "season" = planting/harvest heat map; "commodity" = fill each state with regionColor(code) */
  fillMode?: "season" | "commodity";
  regionColor?: (code: string) => string | null;
  /** Facility to emphasise (e.g. hovered in a list) */
  highlightId?: string | null;
  onFacilityHover?: (id: string | null) => void;
}

interface View {
  k: number;
  tx: number;
  ty: number;
}
const IDENTITY: View = { k: 1, tx: 0, ty: 0 };
const ZOOM_MS = 500;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

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
  commodity: controlledCommodity,
  onCommodityChange,
  focusCodes,
  onAreaClick,
  onFacilityClick,
  hideControls = false,
  hideLegend = false,
  fillMode = "season",
  regionColor,
  highlightId = null,
  onFacilityHover,
}: SeasonalityMapProps): JSX.Element {
  const selectId = useId();
  const summaryId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [ownCommodity, setOwnCommodity] = useState<MapCommodity>(initialCommodity);
  const commodity = controlledCommodity ?? ownCommodity;
  const setCommodity = (c: MapCommodity) => {
    setOwnCommodity(c);
    onCommodityChange?.(c);
  };
  const [view, setView] = useState<View>(IDENTITY);
  const viewRef = useRef<View>(IDENTITY);
  const focusKey = (focusCodes ?? []).join(",");
  const [geo, setGeo] = useState<MapGeo | null>(null);
  const [counties, setCounties] = useState<MapCounty[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [showFacilities, setShowFacilities] = useState(true);
  const [showWhitespace, setShowWhitespace] = useState(true);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [hoverCode, setHoverCode] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);

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

  /* --- zoom: fit the focus features, animate the canvas transform --- */
  const targetView = useMemo<View>(() => {
    if (!geo || !projected || !focusKey) return IDENTITY;
    const path = geoPath(projected.projection);
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const code of focusKey.split(",")) {
      const r = geo.regionByCode.get(code);
      if (!r) continue;
      const [[a, b], [c, d]] = path.bounds(r.feature);
      x0 = Math.min(x0, a);
      y0 = Math.min(y0, b);
      x1 = Math.max(x1, c);
      y1 = Math.max(y1, d);
    }
    if (!Number.isFinite(x0)) return IDENTITY;
    const k = Math.min(14, 0.86 * Math.min(width / Math.max(1, x1 - x0), mapHeight / Math.max(1, y1 - y0)));
    return { k, tx: width / 2 - k * ((x0 + x1) / 2), ty: mapHeight / 2 - k * ((y0 + y1) / 2) };
  }, [geo, projected, focusKey, width, mapHeight]);

  useEffect(() => {
    const from = viewRef.current;
    const to = targetView;
    if (from.k === to.k && from.tx === to.tx && from.ty === to.ty) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = reduce ? 1 : Math.min(1, (now - start) / ZOOM_MS);
      const e = ease(t);
      const v = { k: from.k + (to.k - from.k) * e, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e };
      viewRef.current = v;
      setView(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [targetView]);

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
    const { k, tx, ty } = view;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);
    const focusSet = new Set(focusKey ? focusKey.split(",") : []);

    // 1. Land base: every state/province in "Not grown" grey.
    ctx.fillStyle = NOT_GROWN_COLOR;
    for (const p of projected.regionPath.values()) ctx.fill(p);

    // 2a. Commodity view: each state/province filled with its colour.
    if (fillMode === "commodity" && regionColor) {
      for (const [code, p] of projected.regionPath) {
        const c = regionColor(code);
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fill(p);
      }
    }
    // 2b. Season view: latitude bands coloured by phase, clipped to the region shape.
    for (const r of fillMode === "season" ? regionsForCommodity : []) {
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

    // 3. Borders; outside the focus area is washed out.
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 0.6 / k;
    ctx.lineJoin = "round";
    for (const p of projected.regionPath.values()) ctx.stroke(p);
    if (focusSet.size) {
      ctx.fillStyle = "rgba(248, 250, 252, 0.72)";
      for (const [code, p] of projected.regionPath) if (!focusSet.has(code)) ctx.fill(p);
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 1.4 / k;
      for (const code of focusSet) {
        const p = projected.regionPath.get(code);
        if (p) ctx.stroke(p);
      }
    }
    if (hoverCode && onAreaClick) {
      const p = projected.regionPath.get(hoverCode);
      if (p) {
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 2 / k;
        ctx.stroke(p);
      }
    }

    // 4. Whitespace counties (IL/IA): hatched fill + dashed outline.
    if (hasWhitespace && showWhitespace && whitespaceCounties.length) {
      const pattern = hatchPattern(ctx, dpr);
      ctx.save();
      ctx.setLineDash([3 / k, 2 / k]);
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 1 / k;
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
      const r = (w < 480 ? 3.5 : 4.5) / k;
      for (const f of facilities) {
        const pt = projected.projection([f.lon, f.lat]);
        if (!pt || pt[0] < 0 || pt[1] < 0 || pt[0] > w || pt[1] > h) continue;
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], r, 0, Math.PI * 2);
        if (f.color) {
          ctx.fillStyle = f.color;
          ctx.fill();
          ctx.strokeStyle = f.covered ? "#0f172a" : "#ffffff";
          ctx.lineWidth = (f.covered ? 1.5 : 1) / k;
        } else if (f.covered) {
          ctx.fillStyle = ACCENT;
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1 / k;
        } else {
          ctx.fillStyle = "#ffffff";
          ctx.fill();
          ctx.strokeStyle = "#64748b"; // slate-500
          ctx.lineWidth = 1.5 / k;
        }
        ctx.stroke();
      }
      const hl = highlightId ? facilities.find((x) => x.id === highlightId) : undefined;
      const hp = hl ? projected.projection([hl.lon, hl.lat]) : null;
      if (hl && hp) {
        ctx.beginPath();
        ctx.arc(hp[0], hp[1], r * 2.1, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(31, 95, 74, 0.18)";
        ctx.fill();
        ctx.lineWidth = 2.5 / k;
        ctx.strokeStyle = "#0f172a";
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hp[0], hp[1], r * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = hl.color ?? ACCENT;
        ctx.fill();
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
    view,
    focusKey,
    fillMode,
    regionColor,
    highlightId,
    hoverCode,
    onAreaClick,
  ]);

  /* --- hover / tap --- */
  const probeAt = useCallback(
    (clientX: number, clientY: number, sticky: boolean) => {
      const canvas = canvasRef.current;
      if (!canvas || !projected) return;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const v = viewRef.current;
      const ll = projected.projection.invert?.([(x - v.tx) / v.k, (y - v.ty) / v.k]);
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
        const d = (pt[0] * view.k + view.tx - x) ** 2 + (pt[1] * view.k + view.ty - y) ** 2;
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
    view,
  ]);

  const tipRegion = tooltip?.region?.code ?? null;
  const tipFacility = tooltip?.facility?.id ?? null;
  const [lastTip, setLastTip] = useState<{ r: string | null; f: string | null }>({ r: null, f: null });
  if (lastTip.r !== tipRegion || lastTip.f !== tipFacility) {
    setLastTip({ r: tipRegion, f: tipFacility });
    setHoverCode(tipRegion);
  }
  useEffect(() => {
    onFacilityHover?.(tipFacility);
  }, [tipFacility, onFacilityHover]);

  /* --- manual zoom / pan --- */
  const applyView = useCallback((v: View) => {
    viewRef.current = v;
    setView(v);
  }, []);
  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      const v = viewRef.current;
      const k = Math.min(24, Math.max(0.9, v.k * factor));
      const f = k / v.k;
      applyView({ k, tx: cx - (cx - v.tx) * f, ty: cy - (cy - v.ty) * f });
    },
    [applyView],
  );
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoomAt]);
  const fitToTarget = () => {
    const from = viewRef.current;
    const to = targetView;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ZOOM_MS);
      const e = ease(t);
      applyView({ k: from.k + (to.k - from.k) * e, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e });
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

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
      <div className={hideControls ? "hidden" : "mb-2 flex flex-wrap items-center gap-x-5 gap-y-2"}>
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
          className={`absolute inset-0 block touch-none select-none ${tooltip && (onAreaClick || (onFacilityClick && tooltip.facility)) ? "cursor-pointer" : "cursor-grab"}`}
          style={{ width: width || "100%", height: mapHeight || "100%" }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d && e.buttons === 1) {
              const dx = e.clientX - d.x;
              const dy = e.clientY - d.y;
              if (d.moved || Math.abs(dx) + Math.abs(dy) > 4) {
                d.moved = true;
                applyView({ k: viewRef.current.k, tx: d.tx + dx, ty: d.ty + dy });
                setProbe(null);
                return;
              }
            }
            if (e.pointerType === "mouse") probeAt(e.clientX, e.clientY, false);
          }}
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty, moved: false };
            if (e.pointerType !== "mouse") probeAt(e.clientX, e.clientY, true);
          }}
          onPointerUp={() => {
            setTimeout(() => (drag.current = null), 0);
          }}
          onPointerLeave={(e) => {
            drag.current = null;
            if (e.pointerType === "mouse") setProbe(null);
          }}
          onClick={(e) => {
            if (!projected || !geo) return;
            if (drag.current?.moved) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const v = viewRef.current;
            if (onFacilityClick && facilities && showFacilities) {
              let hit: MapFacility | null = null;
              let best = 10 * 10;
              for (const f of facilities) {
                const pt = projected.projection([f.lon, f.lat]);
                if (!pt) continue;
                const d = (pt[0] * v.k + v.tx - x) ** 2 + (pt[1] * v.k + v.ty - y) ** 2;
                if (d <= best) {
                  best = d;
                  hit = f;
                }
              }
              if (hit) {
                onFacilityClick(hit.id);
                return;
              }
            }
            const ll = projected.projection.invert?.([(x - v.tx) / v.k, (y - v.ty) / v.k]);
            if (!ll || !onAreaClick) return;
            const region = geo.regions.find((r) => inBounds(r.bounds, ll[0], ll[1]) && geoContains(r.feature, ll));
            if (region) onAreaClick(region.code);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setProbe(null);
          }}
        />
        <div className="absolute top-2 right-2 z-10 flex flex-col overflow-hidden rounded-md border border-slate-200 bg-white text-slate-700 shadow-sm">
          <button type="button" aria-label="Zoom in" className="size-8 text-base hover:bg-slate-50" onClick={() => zoomAt(1.5, width / 2, mapHeight / 2)}>
            +
          </button>
          <button type="button" aria-label="Zoom out" className="size-8 border-t border-slate-200 text-base hover:bg-slate-50" onClick={() => zoomAt(1 / 1.5, width / 2, mapHeight / 2)}>
            −
          </button>
          <button type="button" aria-label="Fit" className="size-8 border-t border-slate-200 text-[11px] hover:bg-slate-50" onClick={fitToTarget}>
            Fit
          </button>
        </div>
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

      <div className={hideLegend ? "hidden" : "mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 text-xs text-slate-600"}>
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
