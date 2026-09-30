import { test } from "node:test";
import assert from "node:assert/strict";

import { SEED } from "@/data/seed";
import { parseDate } from "@/lib/dates";
import { rankProspects, scoreTarget } from "@/lib/scoring";
import { targetFromAccount } from "@/lib/scoring/target";
import type { Account } from "@/types/salesforce";
import {
  ARRIVAL_PROFILE,
  DAY_MINUTES,
  PEAK_DAY_FRACTION,
  clockLabel,
  dailyBushels,
  generateTrucks,
  hourLabel,
  mayLoseTrucks,
  pitCapacityBushels,
  quickLoss,
  simulateDay,
  type FacilityInput,
} from "./engine";
import { DEFAULT_SIM_SETTINGS, estimateHarvestRisk, facilityFromAccount, harvestSummaryFor, isGrainReceiver, nearestCompetitor } from "./summary";
import { createShareToken, readShareToken } from "./share-token";

const elevator: FacilityInput = {
  id: "001TEST000000001",
  facilityType: "Grain Elevator",
  segment: "Country Elevator",
  storageBu: 4_000_000,
  scales: 1,
  pits: 2,
  pitRateBph: 16_000,
  yieldFactor: 1.05,
};
const manual = { serviceMinutes: 5, waitLimitMinutes: 45 };
const automated = { serviceMinutes: 2, waitLimitMinutes: 45 };

test("volume: storage x peak-day fraction x county yield, capped by the pits", () => {
  assert.equal(dailyBushels(elevator), Math.round(4_000_000 * PEAK_DAY_FRACTION * 1.05));
  const tiny = { ...elevator, pits: 1, pitRateBph: 8000 };
  assert.equal(dailyBushels(tiny), Math.round(pitCapacityBushels(tiny)));
  const ethanol: FacilityInput = { ...elevator, facilityType: "Ethanol Plant", segment: "Ethanol Plant", storageBu: undefined, gallons: 100_000_000, yieldFactor: 1 };
  assert.equal(dailyBushels(ethanol), Math.round((100_000_000 / 2.8 / 365) * 1.5));
});

test("the same facility replays the same day", () => {
  const a = simulateDay(elevator, manual);
  const b = simulateDay({ ...elevator }, manual);
  assert.deepEqual(
    a.trucks.map((t) => [t.arrive, t.bu, t.scaleStart, t.lost]),
    b.trucks.map((t) => [t.arrive, t.bu, t.scaleStart, t.lost]),
  );
  assert.notDeepEqual(
    generateTrucks({ ...elevator, id: "001TEST000000002" }).map((t) => t.arrive),
    generateTrucks(elevator).map((t) => t.arrive),
  );
});

test("trucks add up to the day's volume with a realistic mix, all within 5 am to 11 pm", () => {
  const trucks = generateTrucks(elevator);
  const bu = trucks.reduce((s, t) => s + t.bu, 0);
  assert.ok(bu >= dailyBushels(elevator) && bu < dailyBushels(elevator) + 1200);
  assert.ok(trucks.every((t) => t.arrive >= 0 && t.arrive < DAY_MINUTES));
  const semis = trucks.filter((t) => t.kind === "semi").length / trucks.length;
  assert.ok(semis > 0.6 && semis < 0.85, `semis ${semis}`);
});

test("arrivals are light in the morning and peak between 3 and 9 pm", () => {
  const trucks = generateTrucks({ ...elevator, storageBu: 20_000_000, pits: 5, pitRateBph: 25_000 });
  const perHour = new Array(ARRIVAL_PROFILE.length).fill(0);
  for (const t of trucks) perHour[Math.floor(t.arrive / 60)]++;
  const morning = perHour.slice(0, 3).reduce((a, b) => a + b, 0); // 5–8 am
  const evening = perHour.slice(10, 13).reduce((a, b) => a + b, 0); // 3–6 pm
  assert.ok(evening > morning * 4, `${morning} vs ${evening}`);
  const peak = perHour.indexOf(Math.max(...perHour));
  assert.ok(peak >= 10 && peak <= 15, `peak hour index ${peak}`);
});

test("every truck is served or lost, in order, and resources are never over capacity", () => {
  const f = { ...elevator, scales: 2, pits: 2 };
  const sim = simulateDay(f, manual);
  assert.equal(sim.trucksServed + sim.trucksLost, sim.trucks.length);
  for (const t of sim.trucks) {
    if (t.lost) {
      assert.equal(t.scale, -1);
      assert.ok(Math.abs(t.leaveAt - t.arrive - 45) < 1e-6);
      continue;
    }
    assert.ok(t.arrive <= t.scaleStart && t.scaleStart < t.scaleEnd && t.scaleEnd <= t.scaleRelease && t.scaleRelease <= t.pitStart && t.pitStart < t.pitEnd);
    if (t.scaleStart <= DAY_MINUTES) assert.ok(t.scaleStart - t.arrive <= 45 + 1e-6, "waited past the limit during the day");
  }
  // At any moment: at most `scales` trucks on scales and `pits` trucks dumping
  for (let m = 0; m <= DAY_MINUTES; m += 7.3) {
    const onScale = sim.trucks.filter((t) => t.scaleStart <= m && m < t.scaleRelease).length;
    const dumping = sim.trucks.filter((t) => t.pitStart <= m && m < t.pitEnd).length;
    assert.ok(onScale <= 2 && dumping <= 2, `minute ${m}: ${onScale} on scales, ${dumping} dumping`);
  }
  assert.equal(sim.series.lost[DAY_MINUTES], sim.trucksLost);
  assert.equal(Math.round(sim.series.buLost[DAY_MINUTES]), sim.bushelsLost);
});

test("a congested one-scale elevator loses trucks; automation on the same trucks loses fewer", () => {
  const m = simulateDay(elevator, manual);
  const a = simulateDay(elevator, automated);
  assert.ok(m.trucksLost > 0, "expected losses with one manual scale");
  assert.ok(a.bushelsLost < m.bushelsLost);
  assert.ok(m.worstHour.trucksWaiting >= a.worstHour.trucksWaiting);
  assert.ok(m.maxWait >= 44);
  // quickLoss is the same model without traces
  assert.deepEqual(quickLoss(elevator, manual), { trucksLost: m.trucksLost, bushelsLost: m.bushelsLost });
});

test("more scales or a longer wait limit never lose more", () => {
  const one = simulateDay(elevator, manual).bushelsLost;
  const two = simulateDay({ ...elevator, scales: 2 }, manual).bushelsLost;
  const patient = simulateDay(elevator, { ...manual, waitLimitMinutes: 90 }).bushelsLost;
  assert.ok(two <= one && patient <= one);
});

test("automation never loses meaningfully more than manual across the seeded facilities", () => {
  // When the pits are the bottleneck both scenarios lose about the same; the mix of trucks that give up can differ by a load
  for (const a of SEED.accounts.slice(0, 300)) {
    const s = harvestSummaryFor(a, SEED);
    if (!s) continue;
    assert.ok(s.automated.bushelsLostPerDay <= s.manual.bushelsLostPerDay * 1.02 + 1100, a.Name);
    assert.ok(s.seasonSavings >= 0);
    assert.equal(s.manual.seasonDollarsLost, Math.round(s.manual.bushelsLostPerDay * DEFAULT_SIM_SETTINGS.marginPerBu * DEFAULT_SIM_SETTINGS.seasonDays));
  }
});

test("the fast ranking screen never skips a facility that loses trucks", () => {
  for (const serviceMinutes of [2, 5, 8])
    for (const waitLimitMinutes of [20, 45, 90])
      for (const a of SEED.accounts) {
        const f = facilityFromAccount(a);
        if (!f || mayLoseTrucks(f, { serviceMinutes, waitLimitMinutes })) continue;
        assert.equal(quickLoss(f, { serviceMinutes, waitLimitMinutes }).trucksLost, 0, `${a.Name} at ${serviceMinutes} min / ${waitLimitMinutes} min`);
      }
});

test("labels", () => {
  assert.equal(hourLabel(0), "5–6 am");
  assert.equal(hourLabel(6), "11 am–12 pm");
  assert.equal(hourLabel(11), "4–5 pm");
  assert.equal(hourLabel(17), "10–11 pm");
  assert.equal(clockLabel(0), "5:00 am");
  assert.equal(clockLabel(DAY_MINUTES), "11:00 pm");
  assert.equal(clockLabel(7 * 60 + 5), "12:05 pm");
});

test("summary: null without truck receiving; competitor is a grain receiver outside the co-op", () => {
  const withEquipment = SEED.accounts.find((a) => a.Segment__c === "Country Elevator" && a.ParentId)!;
  const s = harvestSummaryFor(withEquipment, SEED)!;
  assert.ok(s && s.dailyBushels > 0 && s.trucksPerDay > 0);
  const c = nearestCompetitor(withEquipment, SEED.accounts)!;
  assert.ok(isGrainReceiver(c.account));
  assert.notEqual(c.account.ParentId, withEquipment.ParentId);
  assert.notEqual(c.account.Id, withEquipment.ParentId);
  assert.equal(s.competitorName, c.account.Name);
  assert.match(c.direction, /^(N|NE|E|SE|S|SW|W|NW)$/);
  const noScales: Account = { ...withEquipment, Id: "001NOSCALES", Scales__c: undefined };
  assert.equal(harvestSummaryFor(noScales, SEED), null);
  assert.equal(estimateHarvestRisk(noScales), null);
});

test("share tokens round-trip and reject tampering", async () => {
  const token = await createShareToken("001Hs0000000001AAC", { manualMinutes: 6 });
  assert.deepEqual(await readShareToken(token), { a: "001Hs0000000001AAC", s: { manualMinutes: 6 } });
  const [body, sig] = token.split(".");
  assert.equal(await readShareToken(`${body}x.${sig}`), null);
  assert.equal(await readShareToken(`${body}.${sig.slice(0, -2)}AA`), null);
  assert.equal(await readShareToken("garbage"), null);
});

test("ranking: weight 0 is the base score; the harvest factor follows dollars at risk", () => {
  const asOf = parseDate("2026-09-29");
  const t = targetFromAccount(SEED.accounts[0]);
  const none = { touches: 0, responses: 0, openOpportunities: 0, openPipeline: 0, lostRecently: false };
  const base = scoreTarget(t, asOf, none);
  const w0 = scoreTarget(t, asOf, none, { risk: { dollars: 400_000, saved: true }, weight: 0 });
  assert.equal(w0.total, base.total);
  const low = scoreTarget(t, asOf, none, { risk: { dollars: 5_000, saved: false }, weight: 2 });
  const high = scoreTarget(t, asOf, none, { risk: { dollars: 400_000, saved: false }, weight: 2 });
  assert.ok(high.factors.harvest.points > low.factors.harvest.points);
  assert.ok(high.total > low.total);
  // Fast enough for the whole book (engine estimates are cached per facility)
  const t0 = performance.now();
  rankProspects(SEED, asOf, { harvestWeight: 1 });
  const cold = performance.now() - t0;
  const t1 = performance.now();
  rankProspects(SEED, asOf, { harvestWeight: 2 });
  const warm = performance.now() - t1;
  assert.ok(warm < cold || warm < 150, `cold ${cold.toFixed(0)} ms, warm ${warm.toFixed(0)} ms`);
});
