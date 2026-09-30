import { test } from "node:test";
import assert from "node:assert/strict";

import { SEED } from "@/data/seed";
import { applyMutations } from "@/lib/data/local-repository";
import { parseDate } from "@/lib/dates";
import type { Product2, Quote } from "@/types/salesforce";
import { computeTotals, paymentSchedule, priceLine, impliedDiscount, fmtCurrency } from "./pricing";
import { approvalFor, canApprove, DISCOUNT_POLICY } from "./approvals";
import { defaultPricebookFor, defaultQuantity } from "./catalog";
import { buildQuoteFromOpportunity, goLiveWarning, nextQuoteNumber, revisionNumber, suggestGoLive } from "./build";
import {
  acceptQuoteMutations,
  approveQuoteMutations,
  closeWonMutations,
  effectiveStatus,
  lineChanges,
  lineEditMutations,
  markSentMutations,
  quoteLines,
  reviseQuoteMutations,
  submitForApprovalMutations,
} from "./lifecycle";

const P = (Id: string, unit: Product2["Pricing_Unit__c"]) => ({ Id, Pricing_Unit__c: unit });
const products = [P("sub", "per year"), P("loc", "per location / year"), P("svc", "one-time")];
const header = (over: Partial<Quote> = {}) => ({ Discount__c: 0, Tax_Rate__c: 0, Contract_Term_Months__c: 36, ...over });
const asOf = parseDate("2026-09-29");
const userId = "005Hs00000000001AA";

test("line pricing: net unit and total after discount", () => {
  assert.deepEqual(priceLine(9600, 12, 10), { UnitPrice: 8640, TotalPrice: 103680 });
  assert.deepEqual(priceLine(36000, 1, 0), { UnitPrice: 36000, TotalPrice: 36000 });
  assert.deepEqual(priceLine(4800, 3, 12.5), { UnitPrice: 4200, TotalPrice: 12600 });
  assert.equal(impliedDiscount(12000, 8400), 30);
  assert.equal(impliedDiscount(12000, 36000), 0);
  assert.equal(impliedDiscount(12000, 2000, 30), 30);
});

test("totals: ARR, one-time, first year, TCV and header discount on recurring only", () => {
  const lines = [
    { Product2Id: "sub", Quantity: 1, ListPrice: 36000, Discount: 0 },
    { Product2Id: "loc", Quantity: 10, ListPrice: 9600, Discount: 10 },
    { Product2Id: "svc", Quantity: 1, ListPrice: 25000, Discount: 0 },
  ];
  const t = computeTotals(header({ Discount__c: 5, Tax_Rate__c: 0 }), lines, products);
  assert.equal(t.recurringList, 132000);
  assert.equal(t.recurringNet, 36000 + 86400);
  assert.equal(t.headerDiscount, 6120);
  assert.equal(t.arr, 116280);
  assert.equal(t.oneTime, 25000);
  assert.equal(t.firstYear, 141280);
  assert.equal(t.tcv, 116280 * 3 + 25000);
  assert.equal(t.listTotal, 157000);
  assert.equal(t.discountTotal, 157000 - 141280);
  // 10% line + 5% header stacked = 14.5%
  assert.equal(t.maxEffectiveDiscount, 14.5);
  assert.equal(t.maxLineDiscount, 10);
});

test("tax applies to first year; TCV is before tax", () => {
  const t = computeTotals(header({ Tax_Rate__c: 5, Contract_Term_Months__c: 24 }), [{ Product2Id: "sub", Quantity: 1, ListPrice: 10000, Discount: 0 }, { Product2Id: "svc", Quantity: 1, ListPrice: 2000, Discount: 0 }], products);
  assert.equal(t.tax, 600);
  assert.equal(t.firstYear, 12600);
  assert.equal(t.tcv, 22000);
});

test("payment schedule: installments add up to TCV plus tax, one-time on the first invoice", () => {
  const t = computeTotals(header({ Contract_Term_Months__c: 36 }), [{ Product2Id: "sub", Quantity: 1, ListPrice: 10000, Discount: 0 }, { Product2Id: "svc", Quantity: 1, ListPrice: 5000, Discount: 0 }], products);
  for (const [frequency, count] of [["Annual", 3], ["Quarterly", 12], ["Monthly", 36]] as const) {
    const s = paymentSchedule(t, { start: "2026-12-01", termMonths: 36, frequency, taxRate: 0 });
    assert.equal(s.length, count);
    assert.equal(s[0].oneTime, 5000);
    assert.equal(s[0].date, "2026-12-01");
    assert.equal(Math.round(s.reduce((x, i) => x + i.amount, 0) * 100) / 100, t.tcv);
  }
  const monthly = paymentSchedule({ arr: 1000, oneTime: 0 }, { start: "2027-02-01", termMonths: 12, frequency: "Monthly", taxRate: 0 });
  assert.equal(monthly[1].date, "2027-03-01");
  assert.equal(Math.round(monthly.reduce((x, i) => x + i.recurring, 0) * 100) / 100, 1000);
  // 18-month annual term: second invoice is prorated
  const odd = paymentSchedule({ arr: 12000, oneTime: 0 }, { start: "2027-02-01", termMonths: 18, frequency: "Annual", taxRate: 0 });
  assert.deepEqual(odd.map((i) => i.recurring), [12000, 6000]);
});

test("approval policy thresholds", () => {
  assert.equal(DISCOUNT_POLICY.autoMax, 15);
  assert.equal(approvalFor({ maxEffectiveDiscount: 0, tcv: 100000 }).level, "auto");
  assert.equal(approvalFor({ maxEffectiveDiscount: 12, tcv: 100000 }).level, "auto");
  assert.equal(approvalFor({ maxEffectiveDiscount: 15, tcv: 100000 }).level, "auto");
  assert.equal(approvalFor({ maxEffectiveDiscount: 15.5, tcv: 100000 }).level, "manager");
  assert.equal(approvalFor({ maxEffectiveDiscount: 25, tcv: 100000 }).level, "manager");
  const high = approvalFor({ maxEffectiveDiscount: 26, tcv: 100000 });
  assert.equal(high.level, "admin");
  assert.equal(high.reasonRequired, true);
  const big = approvalFor({ maxEffectiveDiscount: 5, tcv: 600000 });
  assert.equal(big.level, "admin");
  assert.match(big.reasons.join(" "), /TCV/);
  // CAD quotes are converted to USD for the TCV threshold
  assert.equal(approvalFor({ maxEffectiveDiscount: 5, tcv: 600000 }, "CAD").level, "auto");
  assert.equal(approvalFor({ maxEffectiveDiscount: 5, tcv: 700000 }, "CAD").level, "admin");
  assert.equal(canApprove("manager", "manager"), true);
  assert.equal(canApprove("admin", "manager"), false);
  assert.equal(canApprove("admin", "admin"), true);
  assert.equal(canApprove("manager", "rep"), false);
});

test("stacked header discount can push a quote into manager approval", () => {
  const t = computeTotals(header({ Discount__c: 10 }), [{ Product2Id: "sub", Quantity: 1, ListPrice: 10000, Discount: 10 }], products);
  assert.equal(t.maxEffectiveDiscount, 19);
  assert.equal(approvalFor(t).level, "manager");
});

test("catalog defaults: price book by account, quantity by pricing unit", () => {
  const books = SEED.pricebooks;
  const ca = SEED.accounts.find((a) => a.BillingCountry === "Canada")!;
  assert.equal(defaultPricebookFor(ca, books)?.CurrencyIsoCode, "CAD");
  const coop = SEED.accounts.find((a) => a.BillingCountry === "United States" && a.Segment__c === "Multi-Location Co-op" && a.Number_of_Locations__c >= 5)!;
  assert.equal(defaultPricebookFor(coop, books)?.Name, "Multi-Location Co-op");
  const elev = SEED.accounts.find((a) => a.BillingCountry === "United States" && a.Segment__c === "Country Elevator")!;
  assert.equal(defaultPricebookFor(elev, books)?.IsStandard, true);
  assert.equal(defaultQuantity({ Pricing_Unit__c: "per location / year" }, { Number_of_Locations__c: 7, Scales__c: 2 }), 7);
  assert.equal(defaultQuantity({ Pricing_Unit__c: "one-time", Unit_Label__c: "kiosk" }, { Number_of_Locations__c: 7, Scales__c: 2 }), 2);
  assert.equal(defaultQuantity({ Pricing_Unit__c: "per year" }, { Number_of_Locations__c: 7, Scales__c: 2 }), 1);
});

test("go-live: after harvest for elevators, with a warning inside harvest", () => {
  const elev = { Segment__c: "Country Elevator" as const, BillingLatitude: 40, BillingCountry: "United States" as const };
  const d = suggestGoLive(elev, asOf);
  assert.ok(["12-01", "02-01"].includes(d.toISOString().slice(5, 10)));
  assert.ok(goLiveWarning(elev, "2026-10-15"));
  assert.equal(goLiveWarning(elev, "2027-02-01"), null);
  assert.equal(goLiveWarning({ Segment__c: "Ethanol Plant", BillingLatitude: 42, BillingCountry: "United States" }, "2026-10-15"), null);
});

test("quote numbers and revisions", () => {
  assert.equal(nextQuoteNumber([{ QuoteNumber: "Q-01041" }, { QuoteNumber: "Q-01142-v2" }]), "Q-01143");
  assert.equal(revisionNumber([{ QuoteNumber: "Q-01041" }], "Q-01041"), "Q-01041-v2");
  assert.equal(revisionNumber([{ QuoteNumber: "Q-01041" }, { QuoteNumber: "Q-01041-v2" }], "Q-01041"), "Q-01041-v3");
});

test("demo path: build with 12% discount → auto-approved → sent → accepted → Closed Won", () => {
  const opp = SEED.opportunities.find((o) => !o.IsClosed && o.StageName === "Proposal" && SEED.lineItems.some((l) => l.OpportunityId === o.Id))!;
  let data = SEED;
  const ctx = () => ({ data, asOf, userId });
  const built = buildQuoteFromOpportunity(ctx(), opp.Id, { discount: 12 });
  assert.equal(built.quote.Status, "Draft");
  assert.ok(built.lines.length > 0);
  assert.equal(built.approval.level, built.totals.tcv > DISCOUNT_POLICY.adminTcv ? "admin" : "auto");
  data = applyMutations(data, built.mutations);
  const id = built.quote.Id;

  if (built.approval.level === "auto") {
    const sub = submitForApprovalMutations(ctx(), id);
    assert.equal(sub.status, "Approved");
    data = applyMutations(data, sub.mutations);
  } else {
    data = applyMutations(data, approveQuoteMutations({ ...ctx(), role: "admin" }, id, "Strategic co-op"));
  }
  assert.equal(data.quotes.find((q) => q.Id === id)!.Status, "Approved");

  data = applyMutations(data, markSentMutations(ctx(), id));
  assert.equal(data.quotes.find((q) => q.Id === id)!.Status, "Sent");
  assert.ok(data.tasks.some((t) => t.Subject === `Sent quote ${built.quote.QuoteNumber}` && t.Status === "Completed"));

  data = applyMutations(data, acceptQuoteMutations(ctx(), id));
  const q = data.quotes.find((x) => x.Id === id)!;
  assert.equal(q.Status, "Accepted");
  const oppAfter = data.opportunities.find((o) => o.Id === opp.Id)!;
  assert.equal(oppAfter.Amount, built.totals.firstYearBeforeTax);
  const oppLines = data.lineItems.filter((l) => l.OpportunityId === opp.Id);
  assert.equal(oppLines.length, built.lines.length);
  assert.equal(Math.round(oppLines.reduce((s, l) => s + l.TotalPrice, 0)), Math.round(built.totals.firstYearBeforeTax));

  data = applyMutations(data, closeWonMutations(ctx(), opp.Id));
  const won = data.opportunities.find((o) => o.Id === opp.Id)!;
  assert.equal(won.StageName, "Closed Won");
  assert.equal(won.IsWon, true);
  assert.equal(won.Probability, 100);
  assert.equal(won.CloseDate, "2026-09-29");
  assert.equal(won.ForecastCategoryName, "Closed");
});

test("editing lines after approval returns the quote to Draft; revise makes v2", () => {
  const opp = SEED.opportunities.find((o) => !o.IsClosed && o.StageName === "Negotiation")!;
  let data = SEED;
  const ctx = () => ({ data, asOf, userId });
  const built = buildQuoteFromOpportunity(ctx(), opp.Id, { discount: 5, lines: "fit" });
  data = applyMutations(data, built.mutations);
  data = applyMutations(data, approveQuoteMutations({ ...ctx(), role: "admin" }, built.quote.Id, "ok"));
  const line = quoteLines(data, built.quote.Id)[0];
  data = applyMutations(data, lineEditMutations(ctx(), built.quote.Id, [{ op: "update", object: "QuoteLineItem", id: line.Id, changes: lineChanges(line, { Discount: 20 }) }]));
  const q = data.quotes.find((x) => x.Id === built.quote.Id)!;
  assert.equal(q.Status, "Draft");
  assert.equal(q.Approved_By__c, "");
  const rev = reviseQuoteMutations(ctx(), q.Id);
  assert.equal(rev.quoteNumber, `${q.QuoteNumber}-v2`);
  data = applyMutations(data, rev.mutations);
  assert.equal(quoteLines(data, rev.id).length, quoteLines(data, q.Id).length);
});

test("expired: open quotes past their expiration date", () => {
  assert.equal(effectiveStatus({ Status: "Sent", ExpirationDate: "2026-09-01" }, asOf), "Expired");
  assert.equal(effectiveStatus({ Status: "Accepted", ExpirationDate: "2026-09-01" }, asOf), "Accepted");
  assert.equal(effectiveStatus({ Status: "Draft", ExpirationDate: "2026-09-29" }, asOf), "Draft");
});

test("currency formatting", () => {
  assert.equal(fmtCurrency(12400), "$12,400");
  assert.equal(fmtCurrency(12400.5, "CAD"), "CA$12,400.50");
});
