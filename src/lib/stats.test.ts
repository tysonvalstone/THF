import { test } from "node:test";
import assert from "node:assert/strict";

import {
  blendedRate,
  computeStats,
  estimateRate,
  formatRate,
  median,
  rateForMonth,
  wilsonInterval,
  type OppRecord,
} from "./stats";

/** Build `won` won + `lost` lost closed opps (and `open` open ones) for a segment, created in `month` of 2025. */
function opps(segment: string, won: number, lost: number, open = 0, month = 3): OppRecord[] {
  const mm = String(month + 1).padStart(2, "0");
  const base = { segment, createdDate: `2025-${mm}-01`, closeDate: `2025-${mm}-21`, amount: 1000 };
  return [
    ...Array.from({ length: won }, () => ({ ...base, isClosed: true, isWon: true })),
    ...Array.from({ length: lost }, () => ({ ...base, isClosed: true, isWon: false })),
    ...Array.from({ length: open }, () => ({ ...base, isClosed: false, isWon: false })),
  ];
}

const near = (actual: number, expected: number, eps = 1e-3) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} ≈ ${expected}`);

test("wilsonInterval matches known values and handles edge cases", () => {
  const w = wilsonInterval(8, 10);
  near(w.low, 0.4902);
  near(w.high, 0.9433);
  assert.deepEqual(wilsonInterval(0, 0), { low: 0, high: 1 });
  const zero = wilsonInterval(0, 10);
  assert.equal(zero.low, 0);
  assert.ok(zero.high > 0);
  const all = wilsonInterval(10, 10);
  assert.equal(all.high, 1);
});

test("blendedRate shrinks toward the prior", () => {
  assert.equal(blendedRate(3, 5, 0.4, 10), (3 + 4) / 15);
});

test("median handles odd, even and empty arrays", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test("estimateRate never returns NaN", () => {
  const r = estimateRate(0, 0, { rate: 0.3, low: 0.1, high: 0.5 });
  assert.equal(r.tag, "Prior");
  assert.equal(r.rate, 0.3);
  assert.ok(!Number.isNaN(r.low) && !Number.isNaN(r.high));
});

const history = [
  ...opps("Grain", 18, 24, 3), // 42 decided → Measured
  ...opps("Feed", 2, 4), // 6 decided → Blended
];

test("segments with >= 10 decided deals are Measured", () => {
  const { segments, company } = computeStats(history);
  const grain = segments.find((s) => s.segment === "Grain")!;
  assert.equal(grain.closeRate.tag, "Measured");
  assert.equal(grain.closeRate.enoughData, true);
  near(grain.closeRate.rate, 18 / 42, 1e-9);
  assert.equal(grain.open, 3);
  assert.equal(grain.closeRate.explanation, "Measured: 18 won of 42 decided deals.");
  assert.equal(formatRate(grain.closeRate), "43% (Measured)");
  assert.equal(company.tag, "Measured");
  near(company.rate, 20 / 48, 1e-9);
  assert.equal(grain.medianDaysToClose, 20);
  assert.equal(grain.medianWonAmount, 1000);
});

test("thin segments are Blended with the company rate and flagged as not enough data", () => {
  const { segments, company } = computeStats(history);
  const feed = segments.find((s) => s.segment === "Feed")!;
  assert.equal(feed.decided, 6);
  assert.equal(feed.closeRate.tag, "Blended");
  assert.equal(feed.closeRate.enoughData, false);
  near(feed.closeRate.rate, (2 + 10 * company.rate) / 16, 1e-9);
  assert.ok(formatRate(feed.closeRate).startsWith("Not enough data"));
  assert.match(feed.closeRate.explanation, /Only 6 decided deals/);
});

test("segments with zero history use the company rate as a Prior", () => {
  const { segments, company } = computeStats(history, { segments: ["Seed"] });
  const seed = segments.find((s) => s.segment === "Seed")!;
  assert.equal(seed.closeRate.tag, "Prior");
  assert.equal(seed.closeRate.rate, company.rate);
  assert.ok(seed.closeRate.rate > 0);
  assert.equal(seed.medianDaysToClose, null);
  assert.ok(formatRate(seed.closeRate).endsWith("(Prior)"));
  assert.deepEqual(
    segments.map((s) => s.segment),
    ["Feed", "Grain", "Seed"],
  );
  // Buckets of a Prior segment are Prior too.
  assert.ok(seed.byCreatedMonth.every((b) => b.tag === "Prior"));
});

test("no history at all falls back to an assumed 25% company rate", () => {
  const { company, segments } = computeStats([], { segments: ["Grain"] });
  assert.equal(company.tag, "Prior");
  assert.equal(company.rate, 0.25);
  assert.deepEqual([company.low, company.high], [0, 1]);
  assert.equal(segments[0].closeRate.rate, 0.25);
});

test("month buckets blend thin months toward the segment's own rate", () => {
  // 20 decided in April (10/10) + 4 decided in October (4/0).
  const { segments } = computeStats([...opps("Grain", 10, 10, 0, 3), ...opps("Grain", 4, 0, 0, 9)]);
  const grain = segments[0];
  assert.equal(grain.byCreatedMonth.length, 12);

  const april = rateForMonth(grain, 3);
  assert.equal(april.tag, "Measured");
  assert.equal(april.rate, 0.5);

  const october = rateForMonth(grain, 9);
  assert.equal(october.tag, "Blended");
  assert.equal(october.decided, 4);
  near(october.rate, blendedRate(4, 4, grain.closeRate.rate, 10), 1e-9);
  assert.ok(october.rate < 1 && october.rate > grain.closeRate.rate);

  const june = rateForMonth(grain, 5);
  assert.equal(june.tag, "Prior");
  assert.equal(june.rate, grain.closeRate.rate);
});

test("asOf excludes later-created opps and treats later-closed opps as open", () => {
  const records: OppRecord[] = [
    { segment: "Grain", createdDate: "2025-01-10", closeDate: "2025-02-01", isClosed: true, isWon: true, amount: 500 },
    { segment: "Grain", createdDate: "2025-01-10T12:00:00.000+0000", closeDate: "2025-06-01", isClosed: true, isWon: false, amount: 900 },
    { segment: "Grain", createdDate: "2025-04-01", closeDate: "2025-05-01", isClosed: true, isWon: true, amount: 700 },
  ];
  const { segments, company } = computeStats(records, { asOf: new Date("2025-03-15T00:00:00Z") });
  const grain = segments[0];
  assert.equal(grain.won, 1);
  assert.equal(grain.lost, 0);
  assert.equal(grain.decided, 1);
  assert.equal(grain.open, 1);
  assert.equal(company.decided, 1);
  assert.equal(grain.medianDaysToClose, 22);
  assert.equal(grain.medianWonAmount, 500);

  // Without a cutoff all three count.
  const all = computeStats(records).segments[0];
  assert.equal(all.decided, 3);
  assert.equal(all.open, 0);
});

test("days to close is never negative", () => {
  const bad: OppRecord = { segment: "X", createdDate: "2025-05-10", closeDate: "2025-05-01", isClosed: true, isWon: true, amount: null };
  const { segments } = computeStats([bad]);
  assert.equal(segments[0].medianDaysToClose, 0);
  assert.equal(segments[0].medianWonAmount, null);
});
