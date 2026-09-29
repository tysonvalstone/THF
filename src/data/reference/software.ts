import type { SoftwareVendor } from "@/types/reference";

/** All vendor names are fictional. */
export const SOFTWARE_VENDORS: SoftwareVendor[] = [
  {
    name: "Spreadsheets + QuickBooks",
    kind: "manual",
    modernity: 0.05,
    fits: ["Grain Elevator", "Seed Processor", "Agronomy Retailer", "Feed Mill"],
    note: "Scale tickets keyed twice, settlements built in Excel, no real-time position.",
  },
  {
    name: "Paper tickets + Excel",
    kind: "manual",
    modernity: 0,
    fits: ["Grain Elevator", "Seed Processor", "Feed Mill"],
    note: "Carbon-copy scale tickets and a merchandiser's spreadsheet for the position.",
  },
  {
    name: "In-house AS/400 system",
    kind: "legacy",
    modernity: 0.1,
    fits: ["Cooperative", "Grain Elevator", "Flour Mill", "Oilseed Crusher"],
    note: "Green-screen system maintained by one retiring programmer.",
  },
  {
    name: "GrainMaster Classic",
    kind: "legacy",
    modernity: 0.2,
    fits: ["Grain Elevator", "Cooperative"],
    note: "On-premise, vendor announced end of support for 2027.",
  },
  {
    name: "Prairie Systems CMS",
    kind: "legacy",
    modernity: 0.25,
    fits: ["Grain Elevator", "Cooperative", "Seed Processor"],
    note: "Client-server grain accounting; no mobile, no producer portal.",
  },
  {
    name: "MillSoft Batch 7",
    kind: "legacy",
    modernity: 0.25,
    fits: ["Feed Mill"],
    note: "Batching runs on a Windows 7 PC in the control room.",
  },
  {
    name: "AgriLedger Pro",
    kind: "competitor",
    modernity: 0.55,
    fits: ["Grain Elevator", "Cooperative", "Agronomy Retailer"],
    note: "Mid-market competitor; weak merchandising and hedging module.",
  },
  {
    name: "SiloTrack",
    kind: "competitor",
    modernity: 0.5,
    fits: ["Grain Elevator", "Seed Processor"],
    note: "Scale and inventory only; accounting handled elsewhere.",
  },
  {
    name: "FieldBooks ERP",
    kind: "competitor",
    modernity: 0.6,
    fits: ["Cooperative", "Agronomy Retailer", "Feed Mill"],
    note: "Generic ERP with an ag add-on; heavy customization costs.",
  },
  {
    name: "PlantWorks ERP",
    kind: "competitor",
    modernity: 0.6,
    fits: ["Ethanol Plant", "Oilseed Crusher", "Flour Mill"],
    note: "Processing ERP with limited grain origination and DDGS tools.",
  },
  {
    name: "FeedLogic Cloud",
    kind: "competitor",
    modernity: 0.8,
    fits: ["Feed Mill"],
    note: "Modern cloud feed platform; strong on batching, weak on grain.",
  },
  {
    name: "HarvestCore 360",
    kind: "competitor",
    modernity: 0.85,
    fits: ["Grain Elevator", "Cooperative", "Ethanol Plant", "Oilseed Crusher"],
    note: "Modern cloud competitor; expensive, usually locked in multi-year terms.",
  },
  {
    name: "AgroDesk",
    kind: "competitor",
    modernity: 0.65,
    fits: ["Agronomy Retailer", "Cooperative"],
    note: "Agronomy bookings and application tickets; no grain side.",
  },
  {
    name: "ThiboLiSoft",
    kind: "ours",
    modernity: 1,
    fits: [],
    note: "Current ThiboLiSoft customer.",
  },
];

export const VENDOR_BY_NAME: Record<string, SoftwareVendor> = Object.fromEntries(
  SOFTWARE_VENDORS.map((v) => [v.name, v]),
);
