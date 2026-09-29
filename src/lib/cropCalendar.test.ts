import { test } from "node:test";
import assert from "node:assert/strict";

import { harvestWindow, phaseLabel, phaseValue } from "./cropCalendar";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

test("southern Illinois corn reaches harvest before northern Illinois", () => {
  const date = utc(2026, 9, 25);
  const south = phaseValue("Corn", "IL", 37.5, date)!;
  const north = phaseValue("Corn", "IL", 42, date)!;
  assert.ok(south > north, `south ${south} should exceed north ${north}`);
});

test("Iowa corn is in harvest on Oct 15", () => {
  const v = phaseValue("Corn", "IA", 42, utc(2026, 10, 15))!;
  assert.ok(v > 0.5, `got ${v}`);
});

test("rice is not grown in Iowa", () => {
  assert.equal(phaseValue("Rice", "IA", 42, utc(2026, 9, 1)), null);
  assert.equal(phaseLabel(null), "Not grown");
});

test("Saskatchewan lentil harvest peaks in August", () => {
  const w = harvestWindow("Lentils", "SK", 52, 2026)!;
  const mid = new Date((w.start.getTime() + w.end.getTime()) / 2);
  assert.equal(mid.getUTCMonth(), 7, `peak ${mid.toISOString()}`);
  const v = phaseValue("Lentils", "SK", 52, utc(2026, 8, 18))!;
  assert.equal(phaseLabel(v), "Harvest peak");
});

test("values are continuous across the year boundary", () => {
  const a = phaseValue("Wheat", "KS", 38, utc(2026, 12, 31))!;
  const b = phaseValue("Wheat", "KS", 38, utc(2027, 1, 1))!;
  assert.ok(Math.abs(a - b) < 0.05);
});
