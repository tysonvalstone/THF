/**
 * Loads the locally bundled /geo/*.json assets (built by scripts/build-geo.ts)
 * once per page and shapes them into region / county records for the map.
 */
import { geoBounds, geoCentroid } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";

export type AreaFeature = Feature<Polygon | MultiPolygon>;

export interface MapRegion {
  /** US state / Canadian province postal code, e.g. "IA", "SK" */
  code: string;
  name: string;
  country: "US" | "CA";
  feature: AreaFeature;
  /** [[minLon, minLat], [maxLon, maxLat]] */
  bounds: [[number, number], [number, number]];
  centroid: [number, number];
}

export interface MapCounty {
  fips: string;
  name: string;
  state: string;
  feature: AreaFeature;
  bounds: [[number, number], [number, number]];
}

export interface MapGeo {
  regions: MapRegion[];
  regionByCode: Map<string, MapRegion>;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return (await res.json()) as T;
}

let geoPromise: Promise<MapGeo> | null = null;
let countyPromise: Promise<MapCounty[]> | null = null;

function region(code: string, name: string, country: "US" | "CA", f: AreaFeature): MapRegion {
  return {
    code,
    name,
    country,
    feature: f,
    bounds: geoBounds(f) as [[number, number], [number, number]],
    centroid: geoCentroid(f) as [number, number],
  };
}

export function loadMapGeo(): Promise<MapGeo> {
  geoPromise ??= (async () => {
    const [states, canada] = await Promise.all([
      getJson<Topology<{ states: GeometryCollection<{ name: string; code: string }> }>>("/geo/us-states.json"),
      getJson<FeatureCollection<Polygon | MultiPolygon, { code: string; name: string }>>("/geo/canada-provinces.json"),
    ]);
    const stateFc = feature(states, states.objects.states) as FeatureCollection<
      Polygon | MultiPolygon,
      { name: string; code: string }
    >;
    const regions: MapRegion[] = [
      ...stateFc.features.map((f) => region(f.properties.code, f.properties.name, "US", f)),
      ...canada.features.map((f) => region(f.properties.code, f.properties.name, "CA", f)),
    ];
    return { regions, regionByCode: new Map(regions.map((r) => [r.code, r])) };
  })().catch((err) => {
    geoPromise = null;
    throw err;
  });
  return geoPromise;
}

export function loadIlIaCounties(): Promise<MapCounty[]> {
  countyPromise ??= getJson<FeatureCollection<Polygon | MultiPolygon, { fips: string; name: string; state: string }>>(
    "/geo/us-counties-il-ia.json",
  )
    .then((fc) =>
      fc.features.map((f) => ({
        ...f.properties,
        feature: f,
        bounds: geoBounds(f) as [[number, number], [number, number]],
      })),
    )
    .catch((err) => {
      countyPromise = null;
      throw err;
    });
  return countyPromise;
}

/** Cheap bounding-box pre-check before geoContains (no antimeridian cases in this extent). */
export function inBounds(b: [[number, number], [number, number]], lon: number, lat: number): boolean {
  return lon >= b[0][0] && lon <= b[1][0] && lat >= b[0][1] && lat <= b[1][1];
}
