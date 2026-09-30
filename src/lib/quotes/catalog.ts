/**
 * Catalog lookups over the store's data (products, types, price books), so
 * edits made under Quoting → Products / Price books show everywhere.
 */
import type { DataSnapshot } from "@/lib/data/types";
import type { Account, Pricebook2, PricebookEntry, Product2 } from "@/types/salesforce";

type CatalogData = Pick<DataSnapshot, "products">;

/** Product name by Id from the store (falls back to the Id) */
export function productName(data: CatalogData, id: string): string {
  return data.products.find((p) => p.Id === id)?.Name ?? id;
}

export function productById(data: CatalogData, id: string): Product2 | undefined {
  return data.products.find((p) => p.Id === id);
}

/** Map for repeated lookups */
export function productMap(products: Product2[]): Map<string, Product2> {
  return new Map(products.map((p) => [p.Id, p]));
}

export function isRecurring(p: Pick<Product2, "Pricing_Unit__c"> | undefined): boolean {
  return !!p && p.Pricing_Unit__c !== "one-time";
}

/** "per location / year", "per kiosk", "per year" */
export function unitLabel(p: Pick<Product2, "Pricing_Unit__c" | "Unit_Label__c">): string {
  if (p.Unit_Label__c) return p.Pricing_Unit__c === "one-time" ? `per ${p.Unit_Label__c}, one-time` : `per ${p.Unit_Label__c} / year`;
  return p.Pricing_Unit__c;
}

/** What the quantity counts */
export function quantityNoun(p: Pick<Product2, "Pricing_Unit__c" | "Unit_Label__c">): string {
  if (p.Unit_Label__c) return `${p.Unit_Label__c}s`;
  if (p.Pricing_Unit__c === "per location / year") return "locations";
  return "units";
}

/**
 * Default quantity for a product on an account's quote: per-location products
 * use the account's locations, kiosks its truck scales, everything else 1.
 */
export function defaultQuantity(p: Pick<Product2, "Pricing_Unit__c" | "Unit_Label__c">, account?: Pick<Account, "Number_of_Locations__c" | "Scales__c">): number {
  const locations = Math.max(1, account?.Number_of_Locations__c ?? 1);
  if (p.Unit_Label__c === "kiosk") return Math.max(1, account?.Scales__c ?? 1);
  if (p.Unit_Label__c === "location" || p.Pricing_Unit__c === "per location / year") return locations;
  return 1;
}

/** Active entries of a price book, with their product */
export function bookEntries(data: Pick<DataSnapshot, "products" | "pricebookEntries">, pricebookId: string): { entry: PricebookEntry; product: Product2 }[] {
  const byId = productMap(data.products);
  return data.pricebookEntries
    .filter((e) => e.Pricebook2Id === pricebookId)
    .map((entry) => ({ entry, product: byId.get(entry.Product2Id)! }))
    .filter((x) => !!x.product);
}

export function entryFor(data: Pick<DataSnapshot, "pricebookEntries">, pricebookId: string, productId: string): PricebookEntry | undefined {
  return data.pricebookEntries.find((e) => e.Pricebook2Id === pricebookId && e.Product2Id === productId);
}

export function standardBook(pricebooks: Pricebook2[]): Pricebook2 | undefined {
  return pricebooks.find((b) => b.IsStandard) ?? pricebooks[0];
}

/** Standard price-book price (else the product's list price) */
export function standardPrice(data: Pick<DataSnapshot, "pricebooks" | "pricebookEntries">, p: Product2): number {
  const std = standardBook(data.pricebooks);
  return (std && entryFor(data, std.Id, p.Id)?.UnitPrice) ?? p.List_Price__c;
}

/**
 * Default price book for an account: Canada → the CAD book, a co-op with 5 or
 * more locations → Multi-Location Co-op, else Standard.
 */
export function defaultPricebookFor(account: Pick<Account, "BillingCountry" | "Segment__c" | "Facility_Type__c" | "Number_of_Locations__c"> | undefined, pricebooks: Pricebook2[]): Pricebook2 | undefined {
  const active = pricebooks.filter((b) => b.IsActive);
  const std = standardBook(active.length ? active : pricebooks);
  if (!account) return std;
  if (account.BillingCountry === "Canada") return active.find((b) => b.CurrencyIsoCode === "CAD") ?? std;
  const coop = account.Segment__c === "Multi-Location Co-op" || account.Facility_Type__c === "Cooperative";
  if (coop && account.Number_of_Locations__c >= 5) return active.find((b) => /co-?op/i.test(b.Name) && b.CurrencyIsoCode === "USD") ?? std;
  return std;
}
