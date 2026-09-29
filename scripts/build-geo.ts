/**
 * One-off builder for the seasonality map's geography assets.
 *
 *   npx tsx scripts/build-geo.ts
 *
 * Reads us-atlas and sane-topojson from node_modules and writes small,
 * locally served files to public/geo/ (no runtime calls to outside services):
 *
 *   us-states.json           TopoJSON, lower-48 + DC only, with properties { name, code }
 *   us-counties-il-ia.json   GeoJSON, Illinois + Iowa counties, properties { fips, name, state }
 *   canada-provinces.json    GeoJSON, 13 provinces/territories, properties { code, name }
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { geoArea } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";

const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "public", "geo");
mkdirSync(OUT, { recursive: true });

const readJson = <T>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), "utf8")) as T;

/* ---------------------------------------------------------------- US states */

const STATE_FIPS: Record<string, string> = {
  "01": "AL", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
  "12": "FL", "13": "GA", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO",
  "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC",
  "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
  "56": "WY",
};

type NamedProps = { name?: string; code?: string };
const states = readJson<Topology<{ states: GeometryCollection<NamedProps>; nation: GeometryCollection }>>(
  "node_modules/us-atlas/states-10m.json",
);
states.objects.states.geometries = states.objects.states.geometries
  .filter((g) => STATE_FIPS[String(g.id)])
  .map((g) => ({ ...g, properties: { name: (g.properties as NamedProps | undefined)?.name, code: STATE_FIPS[String(g.id)] } }));
// Nation outline includes Alaska/Hawaii and is not needed by the map.
delete (states.objects as Record<string, unknown>).nation;
writeFileSync(join(OUT, "us-states.json"), JSON.stringify(states));

/* ------------------------------------------------------- IL + IA counties */

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
function roundGeom(g: Polygon | MultiPolygon, d: number): Polygon | MultiPolygon {
  const ring = (r: Position[]) => {
    const out: Position[] = [];
    for (const p of r) {
      const q = [round(p[0], d), round(p[1], d)];
      const last = out[out.length - 1];
      if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
    }
    return out;
  };
  // Rounding can collapse tiny rings; drop degenerate ones (a closed ring needs >= 4 positions).
  const poly = (rings: Position[][]) => rings.map(ring).filter((r) => r.length >= 4);
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map(poly).filter((p) => p.length > 0);
  return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
}

const counties = readJson<Topology<{ counties: GeometryCollection<{ name: string }> }>>(
  "node_modules/us-atlas/counties-10m.json",
);
const countyFc = feature(counties, counties.objects.counties) as FeatureCollection<Polygon | MultiPolygon, { name: string }>;
const ilIa: FeatureCollection<Polygon | MultiPolygon, { fips: string; name: string; state: string }> = {
  type: "FeatureCollection",
  features: countyFc.features
    .filter((f) => /^(17|19)/.test(String(f.id)))
    .map((f) => ({
      type: "Feature",
      properties: {
        fips: String(f.id),
        name: f.properties.name,
        state: String(f.id).startsWith("17") ? "IL" : "IA",
      },
      geometry: roundGeom(f.geometry, 3),
    })),
};
writeFileSync(join(OUT, "us-counties-il-ia.json"), JSON.stringify(ilIa));

/* ------------------------------------------------------- Canada provinces */

const PROVINCE_NAMES: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick",
  NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut",
  ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};

const na = readJson<Topology<{ subunits: GeometryCollection<{ gu?: string }> }>>(
  "node_modules/sane-topojson/dist/north-america_50m.json",
);
const subunits = feature(na, na.objects.subunits) as FeatureCollection<Polygon | MultiPolygon, { gu?: string }>;

/** Arctic islands entirely north of this latitude are dropped (far outside the map extent). */
const DROP_NORTH_OF = 61;

const provinces: Feature<Polygon | MultiPolygon, { code: string; name: string }>[] = [];
for (const f of subunits.features) {
  if (f.properties?.gu !== "CAN") continue;
  const code = String(f.id);
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const kept = polys
    .filter((poly) => Math.min(...poly[0].map((p) => p[1])) < DROP_NORTH_OF)
    .map((poly) => {
      // d3-geo wants clockwise exterior rings; fix any polygon covering "the rest of the globe".
      const test: Polygon = { type: "Polygon", coordinates: poly };
      return geoArea(test) > 2 * Math.PI ? poly.map((r) => [...r].reverse()) : poly;
    });
  if (!kept.length) continue;
  const geometry = roundGeom(
    kept.length === 1 ? { type: "Polygon", coordinates: kept[0] } : { type: "MultiPolygon", coordinates: kept },
    3,
  );
  provinces.push({ type: "Feature", properties: { code, name: PROVINCE_NAMES[code] ?? code }, geometry });
}
provinces.sort((a, b) => a.properties.code.localeCompare(b.properties.code));
writeFileSync(join(OUT, "canada-provinces.json"), JSON.stringify({ type: "FeatureCollection", features: provinces }));

/* ------------------------------------------------------------------ report */

for (const f of ["us-states.json", "us-counties-il-ia.json", "canada-provinces.json"]) {
  console.log(`${f.padEnd(26)} ${(statSync(join(OUT, f)).size / 1024).toFixed(1)} KB`);
}
console.log(`provinces: ${provinces.map((p) => p.properties.code).join(", ")}`);
console.log(`IL/IA counties: ${ilIa.features.length}`);
