import { test } from "node:test";
import assert from "node:assert/strict";

import { SEED } from "@/data/seed";
import { parseDate } from "@/lib/dates";
import { buildEngagementIndex, engagementFor } from "./engagement";
import { FACTOR_KEYS, rankProspects, scoreTarget } from "./index";
import type { Target } from "./target";

const elevator: Target = {
  id: "test-elevator",
  kind: "account",
  name: "Test Grain",
  city: "Ames",
  state: "IA",
  country: "United States",
  regionId: "western-corn-belt",
  facilityType: "Grain Elevator",
  segment: "Country Elevator",
  commodities: ["Corn", "Soybeans"],
  storageBu: 4_000_000,
  locations: 2,
  software: "Paper tickets + Excel",
  revenue: 50_000_000,
  employees: 30,
  ownerId: "005",
  isCustomer: false,
  lat: 42,
  lon: -93.6,
};
const none = { touches: 0, responses: 0, openOpportunities: 0, openPipeline: 0, lostRecently: false };

test("scores stay within 0–100 and every factor within its max", () => {
  for (const s of rankProspects(SEED, parseDate("2026-09-29"))) {
    assert.ok(s.total >= 0 && s.total <= 100, `${s.target.name}: ${s.total}`);
    for (const k of FACTOR_KEYS) {
      const f = s.factors[k];
      assert.ok(f.points >= 0 && f.points <= f.max, `${s.target.name} ${k}: ${f.points}/${f.max}`);
    }
    assert.ok(s.whyNow.length > 20);
  }
});

test("customers are excluded from prospect rankings", () => {
  const customerIds = new Set(SEED.accounts.filter((a) => a.Type === "Customer - Direct").map((a) => a.Id));
  const ranked = rankProspects(SEED, parseDate("2026-09-29"));
  assert.ok(ranked.every((s) => !customerIds.has(s.target.id)));
});

test("harvest is a no-contact period for elevators; December is prime", () => {
  const harvest = scoreTarget(elevator, parseDate("2026-10-10"), none);
  const december = scoreTarget(elevator, parseDate("2026-12-08"), none);
  assert.ok(december.factors.timing.points > harvest.factors.timing.points);
  assert.match(harvest.factors.timing.reason, /harvest blackout/i);
});

test("year-round segments are not blacked out during harvest", () => {
  const feed = scoreTarget({ ...elevator, facilityType: "Feed Mill", segment: "Feed Mill" }, parseDate("2026-10-10"), none);
  assert.ok(!/blackout until/i.test(feed.factors.timing.reason));
  assert.ok(feed.factors.timing.points > 10);
});

test("paper and spreadsheets get full displacement points", () => {
  const s = scoreTarget(elevator, parseDate("2026-08-10"), none);
  assert.equal(s.factors.displacement.points, 15);
});

test("time travel ignores activity that hasn't happened yet", () => {
  const withHistory = SEED.tasks.find((t) => t.AccountId && t.Status === "Completed" && t.ActivityDate > "2026-06-01")!;
  const idxNow = buildEngagementIndex(SEED, parseDate("2026-09-29"));
  const idxPast = buildEngagementIndex(SEED, parseDate("2025-10-02"));
  assert.ok(engagementFor(idxNow, withHistory.AccountId!).touches > engagementFor(idxPast, withHistory.AccountId!).touches);
});

test("recent contact is penalized to avoid over-contacting", () => {
  const asOf = parseDate("2026-08-10");
  const fresh = scoreTarget(elevator, asOf, { ...none, touches: 3, lastTouch: parseDate("2026-08-08") });
  const stale = scoreTarget(elevator, asOf, { ...none, touches: 3, lastTouch: parseDate("2026-07-01") });
  assert.ok(fresh.factors.engagement.points < stale.factors.engagement.points);
});
