/**
 * Quote pricing math (pure, unit tested in pricing.test.ts).
 *
 * - Line: net unit = list × (1 − line discount); line total = net unit × quantity.
 * - Recurring lines (per year, per location / year) add up to the recurring net;
 *   the header discount applies to recurring only. ARR = recurring net − header discount.
 * - One-time lines (implementation, training, kiosks) are billed once.
 * - First-year total = ARR + one-time + tax (tax on both).
 * - TCV (total contract value) = ARR × term in years + one-time (before tax).
 */
import type { BillingFrequency, Product2, Quote, QuoteLineItem } from "@/types/salesforce";
import { addMonths, parseDate, toISODate } from "@/lib/dates";
import { isRecurring } from "./catalog";

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const clampPct = (n: number) => Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0));

export type PricedLineInput = Pick<QuoteLineItem, "Product2Id" | "Quantity" | "ListPrice" | "Discount">;
export type QuotePricingInput = Pick<Quote, "Discount__c" | "Tax_Rate__c" | "Contract_Term_Months__c">;

/** Net unit price and line total for a list price, quantity and line discount % */
export function priceLine(listPrice: number, quantity: number, discountPct: number): { UnitPrice: number; TotalPrice: number } {
  const unit = round2(listPrice * (1 - clampPct(discountPct) / 100));
  return { UnitPrice: unit, TotalPrice: round2(unit * quantity) };
}

/** Discount % that turns a list price into a net price (0 when the net is at or above list) */
export function impliedDiscount(listPrice: number, netPrice: number, max = 100): number {
  if (!listPrice || netPrice >= listPrice) return 0;
  return Math.min(max, Math.max(0, Math.round((1 - netPrice / listPrice) * 100)));
}

export interface QuoteTotals {
  /** List value of recurring lines, one year */
  recurringList: number;
  /** Recurring after line discounts, one year */
  recurringNet: number;
  /** Header discount amount (on recurring), one year */
  headerDiscount: number;
  /** Annual recurring revenue after all discounts */
  arr: number;
  oneTimeList: number;
  oneTime: number;
  /** List value of everything (Quote.Subtotal) */
  listTotal: number;
  /** First-year discounts in dollars (list − net) */
  discountTotal: number;
  /** ARR + one-time, before tax */
  firstYearBeforeTax: number;
  tax: number;
  /** ARR + one-time + tax (Quote.TotalPrice) */
  firstYear: number;
  termYears: number;
  /** ARR × term years + one-time, before tax */
  tcv: number;
  maxLineDiscount: number;
  /** Largest discount on any line with the header discount stacked on recurring lines */
  maxEffectiveDiscount: number;
  recurringCount: number;
  oneTimeCount: number;
}

type ProductLookup = Map<string, Pick<Product2, "Pricing_Unit__c">> | Pick<Product2, "Id" | "Pricing_Unit__c">[];

function lookup(products: ProductLookup) {
  if (products instanceof Map) return (id: string) => products.get(id);
  const m = new Map(products.map((p) => [p.Id, p]));
  return (id: string) => m.get(id);
}

/** Unknown products count as recurring (per year) */
export function lineIsRecurring(line: Pick<QuoteLineItem, "Product2Id">, products: ProductLookup): boolean {
  const p = lookup(products)(line.Product2Id);
  return p ? isRecurring(p) : true;
}

export function computeTotals(quote: QuotePricingInput, lines: PricedLineInput[], products: ProductLookup): QuoteTotals {
  const get = lookup(products);
  const h = clampPct(quote.Discount__c ?? 0);
  let recurringList = 0;
  let recurringNet = 0;
  let oneTimeList = 0;
  let oneTime = 0;
  let maxLine = 0;
  let maxEff = 0;
  let recurringCount = 0;
  let oneTimeCount = 0;
  for (const l of lines) {
    const p = get(l.Product2Id);
    const recurring = p ? isRecurring(p) : true;
    const d = clampPct(l.Discount ?? 0);
    const { TotalPrice } = priceLine(l.ListPrice, l.Quantity, d);
    const list = round2(l.ListPrice * l.Quantity);
    maxLine = Math.max(maxLine, d);
    if (recurring) {
      recurringCount++;
      recurringList += list;
      recurringNet += TotalPrice;
      maxEff = Math.max(maxEff, 100 * (1 - (1 - d / 100) * (1 - h / 100)));
    } else {
      oneTimeCount++;
      oneTimeList += list;
      oneTime += TotalPrice;
      maxEff = Math.max(maxEff, d);
    }
  }
  recurringList = round2(recurringList);
  recurringNet = round2(recurringNet);
  oneTimeList = round2(oneTimeList);
  oneTime = round2(oneTime);
  const headerDiscount = recurringCount ? round2(recurringNet * (h / 100)) : 0;
  const arr = round2(recurringNet - headerDiscount);
  const firstYearBeforeTax = round2(arr + oneTime);
  const tax = round2(firstYearBeforeTax * (clampPct(quote.Tax_Rate__c ?? 0) / 100));
  const termYears = Math.max(0, quote.Contract_Term_Months__c || 12) / 12;
  const listTotal = round2(recurringList + oneTimeList);
  return {
    recurringList,
    recurringNet,
    headerDiscount,
    arr,
    oneTimeList,
    oneTime,
    listTotal,
    discountTotal: round2(listTotal - firstYearBeforeTax),
    firstYearBeforeTax,
    tax,
    firstYear: round2(firstYearBeforeTax + tax),
    termYears,
    tcv: round2(arr * termYears + oneTime),
    maxLineDiscount: maxLine,
    maxEffectiveDiscount: Math.round(maxEff * 100) / 100,
    recurringCount,
    oneTimeCount,
  };
}

/** Header roll-up fields stored on the Quote */
export function rollupFields(t: QuoteTotals): Pick<Quote, "Subtotal" | "TotalPrice"> {
  return { Subtotal: t.listTotal, TotalPrice: t.firstYear };
}

export interface Installment {
  n: number;
  /** Invoice date, YYYY-MM-DD */
  date: string;
  recurring: number;
  oneTime: number;
  tax: number;
  amount: number;
}

export const PERIOD_MONTHS: Record<BillingFrequency, number> = { Annual: 12, Quarterly: 3, Monthly: 1 };

/**
 * Invoices over the term: recurring fees split by billing frequency (a short
 * final period is prorated), one-time fees on the first invoice, tax on each.
 */
export function paymentSchedule(
  totals: Pick<QuoteTotals, "arr" | "oneTime">,
  opts: { start: string; termMonths: number; frequency: BillingFrequency; taxRate: number },
): Installment[] {
  const period = PERIOD_MONTHS[opts.frequency] ?? 12;
  const months = Math.max(1, Math.round(opts.termMonths || 12));
  const count = Math.ceil(months / period);
  const recurringTotal = round2((totals.arr * months) / 12);
  const rate = clampPct(opts.taxRate) / 100;
  const start = parseDate(opts.start || "2026-01-01");
  const out: Installment[] = [];
  let billed = 0;
  for (let i = 0; i < count; i++) {
    const covered = Math.min(period, months - i * period);
    const last = i === count - 1;
    const recurring = last ? round2(recurringTotal - billed) : round2((totals.arr * covered) / 12);
    billed = round2(billed + recurring);
    const oneTime = i === 0 ? totals.oneTime : 0;
    const tax = round2((recurring + oneTime) * rate);
    out.push({ n: i + 1, date: toISODate(addMonths(start, i * period)), recurring, oneTime, tax, amount: round2(recurring + oneTime + tax) });
  }
  return out;
}

/** Money in the quote's currency: "$12,400" or "CA$12,400" (cents only when present) */
export function fmtCurrency(n: number, currency: "USD" | "CAD" = "USD", opts: { cents?: boolean } = {}): string {
  const cents = opts.cents ?? Math.round(n * 100) % 100 !== 0;
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return `${n < 0 ? "−" : ""}${currency === "CAD" ? "CA$" : "$"}${s}`;
}

/** "12%" or "12.5%" */
export function fmtPctValue(n: number): string {
  return `${Math.round(n * 100) / 100}%`;
}
