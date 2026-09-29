/**
 * ColorBrewer RdBu (9-class), colorblind-safe diverging scale.
 * −1 → deep blue (planting peak), 0 → pale neutral, +1 → deep red (harvest peak).
 */
export const RDBU_STOPS = [
  "#2166ac",
  "#4393c3",
  "#92c5de",
  "#d1e5f0",
  "#f7f7f7",
  "#fddbc7",
  "#f4a582",
  "#d6604d",
  "#b2182b",
] as const;

export const NOT_GROWN_COLOR = "#e2e8f0";

const RGB = RDBU_STOPS.map((hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]);

/** Linear RGB interpolation across the 9 stops. `value` in [−1, 1]. */
export function phaseColor(value: number | null): string {
  if (value === null || Number.isNaN(value)) return NOT_GROWN_COLOR;
  const t = (Math.max(-1, Math.min(1, value)) + 1) / 2;
  const x = t * (RGB.length - 1);
  const i = Math.min(RGB.length - 2, Math.floor(x));
  const f = x - i;
  const a = RGB[i];
  const b = RGB[i + 1];
  const c = (k: number) => Math.round(a[k] + (b[k] - a[k]) * f);
  return `rgb(${c(0)},${c(1)},${c(2)})`;
}
