import { test } from "node:test";
import assert from "node:assert/strict";

import { SEED } from "@/data/seed";
import type { DataSnapshot } from "@/lib/data/types";
import type { Account, Opportunity, Quota } from "@/types/salesforce";
import { buildForecast, derivedCategory, effectiveCategory, forecastSummary, periodFor, quotaFor, seasonalAdjustment, seasonalRates, FACTOR_MAX, FACTOR_MIN } from "./index";

const REP_A = "005Hs00000000002AA";
const REP_B = "005Hs00000000003AA";

function empty(): DataSnapshot {
  const keys = Object.keys(SEED) as (keyof DataSnapshot)[];
  return Object.fromEntries(keys.map((k) => [k, []])) as unknown as DataSnapshot;
}

function acct(id: string, segment: Account["Segment__c"], lat = 41): Account {
  return { Id: id, Name: `Acct ${id}`, Segment__c: segment, BillingLatitude: lat, BillingCountry: "United States" } as unknown as Account;
}

let n = 0;
function opp(p: Partial<Opportunity>): Opportunity {
  n++;
  return {
    Id: `006T${n}`,
    AccountId: "A1",
    Name: `Deal ${n}`,
    Type: "New Business",
    StageName: "Proposal",
    Amount: 100_000,
    CloseDate: "2026-11-15",
    Probability: 50,
    ForecastCategoryName: "Best Case",
    NextStep: "",
    LeadSource: "Web",
    OwnerId: REP_A,
    IsClosed: false,
    IsWon: false,
    CreatedDate: "2026-06-01T00:00:00.000+0000",
    LastModifiedDate: "2026-06-01T00:00:00.000+0000",
    Economic_Buyer_Identified__c: true,
    ...p,
  };
}

const q = (owner: string, period: string, amount: number): Quota => ({ Id: `Q-${owner}-${period}`, OwnerId: owner, Period: period, Amount: amount });

test("periodFor: quarters and months with offsets, across year ends", () => {
  const asOf = new Date(Date.UTC(2026, 8, 29));
  assert.equal(periodFor(asOf, "quarter").key, "2026-Q3");
  assert.equal(periodFor(asOf, "quarter", 1).key, "2026-Q4");
  assert.equal(periodFor(asOf, "quarter", 2).key, "2027-Q1");
  assert.equal(periodFor(asOf, "quarter", -3).key, "2025-Q4");
  const m = periodFor(asOf, "month", 4);
  assert.equal(m.key, "2027-01");
  assert.equal(m.quarter, "2027-Q1");
  assert.equal(m.label, "Jan 2027");
});

test("quotaFor: team sum, rep filter, month is a third of the quarter", () => {
  const d = empty();
  d.quotas = [q(REP_A, "2026-Q4", 300_000), q(REP_B, "2026-Q4", 600_000), q(REP_A, "2027-Q1", 1)];
  const p = periodFor(new Date(Date.UTC(2026, 9, 5)), "quarter");
  assert.equal(quotaFor(d, p), 900_000);
  assert.equal(quotaFor(d, p, REP_A), 300_000);
  assert.equal(quotaFor(d, periodFor(new Date(Date.UTC(2026, 9, 5)), "month"), REP_B), 200_000);
});

test("effective category: manager override beats rep beats derived; closed deals are Closed/Omitted", () => {
  assert.equal(effectiveCategory(opp({ ForecastCategoryName: "Pipeline" })), "Pipeline");
  assert.equal(effectiveCategory(opp({ ForecastCategoryName: "Pipeline", Manager_Forecast_Category__c: "Commit" })), "Commit");
  assert.equal(effectiveCategory(opp({ ForecastCategoryName: "Closed", StageName: "Negotiation", Probability: 75 })), "Commit");
  assert.equal(effectiveCategory(opp({ IsClosed: true, IsWon: true, ForecastCategoryName: "Closed", Manager_Forecast_Category__c: "Pipeline" })), "Closed");
  assert.equal(effectiveCategory(opp({ IsClosed: true, IsWon: false, ForecastCategoryName: "Omitted" })), "Omitted");
  assert.equal(derivedCategory({ StageName: "Qualification", Probability: 20, IsClosed: false, IsWon: false }), "Pipeline");
  assert.equal(derivedCategory({ StageName: "Proposal", Probability: 50, IsClosed: false, IsWon: false }), "Best Case");
  assert.equal(derivedCategory({ StageName: "Board Approval", Probability: 90, IsClosed: false, IsWon: false }), "Commit");
});

test("time travel: a deal closed after the as-of date counts as open, without leaking its outcome", () => {
  const o = opp({ IsClosed: true, IsWon: false, StageName: "Closed Lost", ForecastCategoryName: "Omitted", CloseDate: "2026-11-20", Probability: 0 });
  assert.equal(effectiveCategory(o, new Date(Date.UTC(2026, 10, 1))), "Commit");
  assert.equal(effectiveCategory(o, new Date(Date.UTC(2026, 8, 1))), "Best Case");
  assert.equal(effectiveCategory(o, new Date(Date.UTC(2026, 11, 1))), "Omitted");
});

test("buildForecast: category totals, weighted, attainment, rep roll-up", () => {
  const d = empty();
  d.accounts = [acct("A1", "Ethanol Plant")];
  d.quotas = [q(REP_A, "2026-Q4", 400_000), q(REP_B, "2026-Q4", 200_000)];
  d.opportunities = [
    opp({ IsClosed: true, IsWon: true, StageName: "Closed Won", ForecastCategoryName: "Closed", CloseDate: "2026-10-10", Amount: 200_000, Probability: 100 }),
    opp({ IsClosed: true, IsWon: false, StageName: "Closed Lost", ForecastCategoryName: "Omitted", CloseDate: "2026-10-12", Amount: 999_000, Probability: 0 }),
    opp({ ForecastCategoryName: "Commit", StageName: "Negotiation", Probability: 80, Amount: 100_000 }),
    opp({ ForecastCategoryName: "Best Case", Probability: 50, Amount: 60_000, OwnerId: REP_B }),
    opp({ ForecastCategoryName: "Pipeline", StageName: "Qualification", Probability: 20, Amount: 50_000, OwnerId: REP_B }),
    opp({ ForecastCategoryName: "Pipeline", Manager_Forecast_Category__c: "Omitted", Probability: 20, Amount: 70_000 }),
    opp({ CloseDate: "2027-01-15", Amount: 5_000_000 }), // next quarter
    opp({ CreatedDate: "2026-11-01T00:00:00.000+0000" }), // created after as-of
  ];
  const f = buildForecast(d, new Date(Date.UTC(2026, 9, 20)), { granularity: "quarter" });
  assert.equal(f.period, "2026-Q4");
  assert.equal(f.quota, 600_000);
  assert.equal(f.closed, 200_000);
  assert.equal(f.commit, 100_000);
  assert.equal(f.bestCase, 60_000);
  assert.equal(f.pipeline, 50_000);
  assert.equal(f.omitted, 70_000);
  assert.equal(f.weighted, 200_000 + 80_000 + 30_000 + 10_000);
  assert.ok(Math.abs(f.attainmentPct - (200_000 / 600_000) * 100) < 1e-9);
  const a = f.byRep.find((r) => r.ownerId === REP_A)!;
  const b = f.byRep.find((r) => r.ownerId === REP_B)!;
  assert.equal(a.closed + b.closed, f.closed);
  assert.equal(a.quota, 400_000);
  assert.equal(b.pipeline, 50_000);
  assert.ok(Math.abs(a.seasonalExpected + b.seasonalExpected - f.seasonalExpected) < 1e-6);
  // ownerId filter keeps only that rep
  const onlyB = buildForecast(d, new Date(Date.UTC(2026, 9, 20)), { ownerId: REP_B });
  assert.equal(onlyB.quota, 200_000);
  assert.equal(onlyB.byRep.length, 1);
  assert.equal(onlyB.closed, 0);
});

test("what-if: win rate, deal size and slippage move the projection only", () => {
  const d = empty();
  d.accounts = [acct("A1", "Ethanol Plant")];
  d.opportunities = [
    opp({ IsClosed: true, IsWon: true, StageName: "Closed Won", ForecastCategoryName: "Closed", CloseDate: "2026-10-05", Amount: 100_000 }),
    opp({ Probability: 40, Amount: 100_000 }),
  ];
  const asOf = new Date(Date.UTC(2026, 9, 20));
  const base = buildForecast(d, asOf);
  assert.ok(Math.abs(base.projected - base.seasonalExpected) < 1e-6);
  const open = base.seasonalExpected - 100_000;
  const slipped = buildForecast(d, asOf, { whatIf: { slippagePct: 50 } });
  assert.ok(Math.abs(slipped.projected - (100_000 + open / 2)) < 1e-6);
  const bigger = buildForecast(d, asOf, { whatIf: { dealSize: 1.2 } });
  assert.ok(Math.abs(bigger.projected - (100_000 + open * 1.2)) < 1e-6);
  const sure = buildForecast(d, asOf, { whatIf: { winRate: 100 } });
  assert.equal(sure.projected, 200_000); // probability capped at 100%
  assert.equal(sure.seasonalExpected, base.seasonalExpected);
  assert.equal(sure.closed, 100_000);
});

test("seasonal adjustment: harvest close months discount a co-op deal, factor is clamped", () => {
  const d = empty();
  d.accounts = [acct("C1", "Multi-Location Co-op")];
  // History: co-op deals closing in October rarely win; June closes usually do
  const hist: Opportunity[] = [];
  for (let i = 0; i < 20; i++) {
    hist.push(opp({ AccountId: "C1", IsClosed: true, IsWon: i < 2, StageName: i < 2 ? "Closed Won" : "Closed Lost", CloseDate: "2025-10-10", CreatedDate: "2025-05-01T00:00:00.000+0000" }));
    hist.push(opp({ AccountId: "C1", IsClosed: true, IsWon: i < 12, StageName: i < 12 ? "Closed Won" : "Closed Lost", CloseDate: "2025-06-10", CreatedDate: "2025-02-01T00:00:00.000+0000" }));
  }
  d.opportunities = hist;
  const asOf = new Date(Date.UTC(2026, 8, 29));
  const rates = seasonalRates(d, asOf).get("Multi-Location Co-op")!;
  assert.equal(rates.overall.rate, 14 / 40);
  assert.equal(rates.byCloseMonth[9].rate, 0.1);
  const adj = seasonalAdjustment(rates, d.accounts[0], "2026-10-15");
  assert.equal(adj.inHarvest, true);
  assert.ok(adj.factor < 1 && adj.factor >= FACTOR_MIN);
  assert.match(adj.note, /^Closes in harvest · co-op rate 10%$/);
  const june = seasonalAdjustment(rates, d.accounts[0], "2027-06-15");
  assert.equal(june.inHarvest, false);
  assert.ok(june.factor > 1 && june.factor <= FACTOR_MAX);

  // The October co-op deal's seasonal expected is below its plain weighted value
  d.opportunities.push(opp({ AccountId: "C1", CloseDate: "2026-10-20", Probability: 50, Amount: 100_000 }));
  const f = buildForecast(d, asOf, { offset: 1 });
  const row = f.dealRows.find((r) => !r.opp.IsClosed)!;
  assert.ok(row.seasonalExpected < row.weighted);
  assert.equal(row.seasonal.inHarvest, true);
});

test("forecastSummary on the seed: consistent shape and roll-ups", () => {
  const asOf = new Date(Date.UTC(2026, 8, 29));
  for (const offset of [0, 1]) {
    const s = forecastSummary(SEED, asOf, { offset });
    assert.match(s.period, /^\d{4}-Q[1-4]$/);
    assert.ok(s.quota > 0, "seeded quotas cover the period");
    const sum = (k: "closed" | "commit" | "bestCase" | "pipeline" | "quota") => s.byRep.reduce((x, r) => x + r[k], 0);
    for (const k of ["closed", "commit", "bestCase", "pipeline", "quota"] as const) assert.ok(Math.abs(sum(k) - s[k]) < 1e-6, k);
    assert.ok(s.seasonalExpected >= s.closed);
    for (const r of s.byRep) assert.ok(Number.isFinite(r.attainmentPct));
  }
  const q3 = forecastSummary(SEED, asOf);
  assert.equal(q3.period, "2026-Q3");
  assert.ok(q3.attainmentPct > 50 && q3.attainmentPct < 150, `Q3 attainment ${q3.attainmentPct}`);
  const q4 = forecastSummary(SEED, asOf, { offset: 1 });
  assert.ok(q4.commit + q4.bestCase + q4.pipeline > 0, "open pipeline in Q4");
});
