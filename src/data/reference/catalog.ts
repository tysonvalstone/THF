/**
 * Starting catalog for quoting: product types, products and price books.
 * The seed generator writes these into the mock data, and live mode uses
 * them directly (Salesforce stays read-only). Users edit them in Quoting →
 * Products / Price books; edits are stored as local changes.
 */
import type { Pricebook2, PricebookEntry, Product2, ProductFamily, ProductType } from "@/types/salesforce";
import { PRODUCTS } from "./products";

const FAMILIES: [ProductFamily, string][] = [
  ["Financials", "Accounting, settlements and tax reporting"],
  ["Commodity Management", "Contracts, positions, hedging and bids"],
  ["Grain Operations", "Scale house, tickets and receiving"],
  ["Customer Engagement", "Producer-facing apps and portals"],
  ["Feed", "Feed milling and delivery"],
  ["Agronomy", "Agronomy sales and application"],
  ["Processing", "Processing plant operations"],
  ["Services", "Implementation, training, integration and support"],
];

const typeId = (i: number) => `a0PHs0000000${String(i + 1).padStart(2, "0")}AAA`.slice(0, 18);

export const PRODUCT_TYPES: ProductType[] = FAMILIES.map(([name, description], i) => ({
  Id: typeId(i),
  Name: name,
  Description: description,
  IsActive: true,
  SortOrder: i + 1,
}));

const TYPE_BY_FAMILY = new Map(PRODUCT_TYPES.map((t) => [t.Name, t.Id]));

export const CATALOG_PRODUCTS: Product2[] = PRODUCTS.map((p) => ({ ...p, Product_Type__c: TYPE_BY_FAMILY.get(p.Family) }));

export const STANDARD_PRICEBOOK_ID = "01sHs0000000001AAA";

export const PRICEBOOKS: Pricebook2[] = [
  { Id: STANDARD_PRICEBOOK_ID, Name: "Standard Price Book", Description: "List prices, US dollars.", IsActive: true, IsStandard: true, CurrencyIsoCode: "USD" },
  {
    Id: "01sHs0000000002AAA",
    Name: "Multi-Location Co-op",
    Description: "Per-location modules 15% below list for co-ops with 5 or more locations.",
    IsActive: true,
    IsStandard: false,
    CurrencyIsoCode: "USD",
  },
  { Id: "01sHs0000000003AAA", Name: "Canada (CAD)", Description: "List prices in Canadian dollars.", IsActive: true, IsStandard: false, CurrencyIsoCode: "CAD" },
];

const CAD = 1.36;
const round = (n: number, to: number) => Math.round(n / to) * to;

export const PRICEBOOK_ENTRIES: PricebookEntry[] = PRICEBOOKS.flatMap((book, b) =>
  CATALOG_PRODUCTS.map((p, i) => {
    let price = p.List_Price__c;
    if (book.Name === "Multi-Location Co-op" && p.Pricing_Unit__c === "per location / year") price = round(price * 0.85, 100);
    if (book.CurrencyIsoCode === "CAD") price = round(price * CAD, 100);
    return {
      Id: `01uHs000000${b + 1}${String(i + 1).padStart(2, "0")}AAA`.slice(0, 18),
      Pricebook2Id: book.Id,
      Product2Id: p.Id,
      UnitPrice: price,
      IsActive: true,
    };
  }),
);

export function catalogReference() {
  return { productTypes: PRODUCT_TYPES, products: CATALOG_PRODUCTS, pricebooks: PRICEBOOKS, pricebookEntries: PRICEBOOK_ENTRIES };
}
