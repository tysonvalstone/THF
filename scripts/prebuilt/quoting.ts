/**
 * Seed additions for the Harvest Day Simulator, quoting and New Builds.
 * Values come from a hash of each record's Id (not the generator's random
 * stream), so adding them doesn't change any existing record.
 */
import type { Account, Contact, NewBuild, Opportunity, OpportunityLineItem, Quote, QuoteLineItem, QuoteStatus, Segment, FacilityType, RegionId } from "../../src/types/salesforce";
import { PRICEBOOKS, PRICEBOOK_ENTRIES, STANDARD_PRICEBOOK_ID } from "../../src/data/reference/catalog";
import { REGION_BY_STATE } from "../../src/data/reference/regions";
import { TOWNS } from "../../src/data/reference/towns";

/** Deterministic 0–1 value for a key */
export function hash01(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const pick = <T>(arr: readonly T[], key: string): T => arr[Math.floor(hash01(key) * arr.length) % arr.length];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/* --------------------------------------------------- receiving equipment */

/** Scales, dump pits, pit rate and county yield factor for every facility */
export function addReceivingProfiles(accounts: Account[]): void {
  for (const a of accounts) {
    const r = (k: string) => hash01(`${a.Id}:${k}`);
    const bu = a.Storage_Capacity_Bu__c ?? 0;
    let scales: number;
    let pits: number;
    if (a.Segment__c === "Ethanol Plant") {
      scales = 2 + Math.round(r("s"));
      pits = 2 + Math.round(r("p"));
    } else if (a.Segment__c === "Feed Mill" || a.Segment__c === "Processor") {
      scales = 1 + Math.round(r("s"));
      pits = 1 + Math.round(r("p"));
    } else {
      // Elevators, co-op locations, terminals and shuttle loaders scale with storage
      scales = bu < 1_500_000 ? 1 : bu < 4_000_000 ? 2 : bu < 10_000_000 ? 3 : 4;
      pits = Math.max(1, scales + (r("p") < 0.35 ? 1 : 0) - (r("p2") < 0.2 ? 1 : 0));
    }
    a.Scales__c = scales;
    a.Dump_Pits__c = pits;
    a.Dump_Pit_Rate_Bph__c = Math.round((8_000 + r("rate") * 17_000) / 1_000) * 1_000;
    // One factor per county (or town) so neighbours share this year's crop
    const county = a.County_FIPS__c ?? `${a.BillingState}:${a.BillingCity}`;
    a.County_Yield_Factor__c = +(0.86 + hash01(`yield-2026:${county}`) * 0.28).toFixed(2);
  }
}

/* --------------------------------------------------------------- quotes */

const QUOTE_STAGE_STATUS: Partial<Record<Opportunity["StageName"], QuoteStatus[]>> = {
  Proposal: ["Draft", "In Review", "Approved"],
  Negotiation: ["Approved", "Sent", "Sent"],
  "Board Approval": ["Sent"],
};

export function buildQuotes(
  accounts: Account[],
  contacts: Contact[],
  opportunities: Opportunity[],
  lineItems: OpportunityLineItem[],
  anchor: Date,
): { quotes: Quote[]; quoteLineItems: QuoteLineItem[] } {
  const byAccount = new Map(accounts.map((a) => [a.Id, a]));
  const linesByOpp = new Map<string, OpportunityLineItem[]>();
  for (const li of lineItems) linesByOpp.set(li.OpportunityId, [...(linesByOpp.get(li.OpportunityId) ?? []), li]);
  const quotes: Quote[] = [];
  const quoteLineItems: QuoteLineItem[] = [];
  let n = 1041;

  const candidates = opportunities
    .filter((o) => {
      if (!o.IsClosed) return !!QUOTE_STAGE_STATUS[o.StageName];
      // Recent wins carry their accepted quote
      return o.IsWon && new Date(o.CloseDate) > addDays(anchor, -120) && new Date(o.CloseDate) <= anchor;
    })
    .sort((a, b) => a.CreatedDate.localeCompare(b.CreatedDate));

  for (const o of candidates) {
    const a = byAccount.get(o.AccountId);
    const lines = linesByOpp.get(o.Id);
    if (!a || !lines?.length) continue;
    const book =
      a.BillingCountry === "Canada"
        ? PRICEBOOKS.find((b) => b.CurrencyIsoCode === "CAD")!
        : a.Segment__c === "Multi-Location Co-op" && a.Number_of_Locations__c >= 5
          ? PRICEBOOKS.find((b) => b.Name === "Multi-Location Co-op")!
          : PRICEBOOKS.find((b) => b.Id === STANDARD_PRICEBOOK_ID)!;
    const status: QuoteStatus = o.IsWon ? "Accepted" : pick(QUOTE_STAGE_STATUS[o.StageName]!, `${o.Id}:status`);
    // Open quotes are recent (most still inside their 30-day validity); accepted ones follow the deal
    const created = o.IsWon
      ? new Date(Math.min(addDays(new Date(o.CreatedDate), 20 + Math.floor(hash01(`${o.Id}:d`) * 25)).getTime(), anchor.getTime() - 86_400_000))
      : addDays(anchor, -(3 + Math.floor(hash01(`${o.Id}:d`) * 26)));
    const id = `0Q0Hs00000${String(n).padStart(4, "0")}AAC`.slice(0, 18);
    const contact = contacts.find((c) => c.AccountId === a.Id && c.Buying_Role__c === "Economic Buyer") ?? contacts.find((c) => c.AccountId === a.Id);
    const term = a.Segment__c === "Multi-Location Co-op" ? 36 : pick([12, 24, 36, 36] as const, `${o.Id}:term`);

    let subtotal = 0;
    let total = 0;
    let maxDiscount = 0;
    lines.forEach((li, i) => {
      const entry = PRICEBOOK_ENTRIES.find((e) => e.Pricebook2Id === book.Id && e.Product2Id === li.Product2Id);
      const list = entry?.UnitPrice ?? li.UnitPrice;
      const discount = Math.max(0, Math.min(30, Math.round((1 - li.UnitPrice / list) * 100)));
      const unit = Math.round(list * (1 - discount / 100));
      maxDiscount = Math.max(maxDiscount, discount);
      subtotal += list * li.Quantity;
      total += unit * li.Quantity;
      quoteLineItems.push({
        Id: `0QLHs00000${String(n).padStart(4, "0")}${String(i + 1).padStart(2, "0")}A`.slice(0, 18),
        QuoteId: id,
        Product2Id: li.Product2Id,
        PricebookEntryId: entry?.Id,
        Quantity: li.Quantity,
        ListPrice: list,
        Discount: discount,
        UnitPrice: unit,
        TotalPrice: unit * li.Quantity,
        Description: li.Description,
        SortOrder: i + 1,
      });
    });

    const needsApproval = maxDiscount > 10;
    const approved = needsApproval && ["Approved", "Sent", "Accepted"].includes(status);
    quotes.push({
      Id: id,
      QuoteNumber: `Q-${String(n).padStart(5, "0")}`,
      Name: `${a.Name} · ${term}-month proposal`,
      OpportunityId: o.Id,
      AccountId: a.Id,
      ContactId: contact?.Id,
      Pricebook2Id: book.Id,
      Status: needsApproval || status !== "In Review" ? status : "Draft",
      OwnerId: o.OwnerId,
      CreatedDate: created.toISOString(),
      ExpirationDate: iso(addDays(created, 30)),
      Contract_Term_Months__c: term,
      Billing_Frequency__c: "Annual",
      Payment_Terms__c: a.Segment__c === "Multi-Location Co-op" ? "Net 45" : "Net 30",
      Start_Date__c: iso(nextGoLive(created)),
      Discount__c: 0,
      Tax_Rate__c: 0,
      Description: `Proposal for ${a.Name}.`,
      Subtotal: subtotal,
      TotalPrice: total,
      ...(approved ? { Approval_Reason__c: `Line discount of ${maxDiscount}% exceeds the 10% rep limit`, Approved_By__c: "005Hs00000000002AA", Approved_Date__c: addDays(created, 2).toISOString() } : {}),
      ...(["Sent", "Accepted"].includes(status) ? { Sent_Date__c: addDays(created, 3).toISOString() } : {}),
      ...(status === "Accepted" ? { Accepted_Date__c: o.CloseDate + "T15:00:00.000Z" } : {}),
    });
    n += 1;
  }
  return { quotes, quoteLineItems };
}

/** Go-live after harvest: the next Dec 1 or Feb 1 at least 45 days out */
function nextGoLive(from: Date): Date {
  const y = from.getUTCFullYear();
  const options = [new Date(Date.UTC(y, 11, 1)), new Date(Date.UTC(y + 1, 1, 1)), new Date(Date.UTC(y + 1, 11, 1))];
  return options.find((d) => d.getTime() - from.getTime() > 45 * 86_400_000)!;
}

/* ------------------------------------------------------------ new builds */

const NB_SPECS: { segment: Segment; type: FacilityType; states: string[]; unit: NewBuild["Capacity_Unit"]; cap: [number, number]; invest: [number, number]; names: string[]; what: string }[] = [
  { segment: "Ethanol Plant", type: "Ethanol Plant", states: ["IA", "NE", "SD", "MN", "IN", "ND"], unit: "gal/yr", cap: [60e6, 150e6], invest: [140e6, 260e6], names: ["Renewable Fuels", "Bioenergy", "Clean Fuels LLC", "Ethanol Partners"], what: "ethanol plant" },
  { segment: "Rail/Shuttle Loader", type: "Grain Elevator", states: ["KS", "NE", "ND", "SD", "IA", "IL"], unit: "bu", cap: [3e6, 8e6], invest: [28e6, 55e6], names: ["Grain Terminal", "Shuttle Loading", "Rail Grain LLC"], what: "110-car shuttle loader" },
  { segment: "Feed Mill", type: "Feed Mill", states: ["IA", "MN", "NC", "IN", "OH", "MO"], unit: "tons/yr", cap: [150e3, 450e3], invest: [30e6, 70e6], names: ["Feeds", "Nutrition", "Feed Mill LLC"], what: "feed mill" },
  { segment: "Processor", type: "Oilseed Crusher", states: ["ND", "IA", "KS", "SK", "MN"], unit: "tons/yr", cap: [800e3, 1.6e6], invest: [300e6, 550e6], names: ["Crush", "Oilseed Processing", "Soy Processing"], what: "soybean crush plant" },
  { segment: "Multi-Location Co-op", type: "Cooperative", states: ["IA", "IL", "MN", "NE"], unit: "bu", cap: [2e6, 5e6], invest: [18e6, 40e6], names: ["Cooperative", "Farmers Co-op"], what: "co-op receiving expansion" },
  { segment: "Country Elevator", type: "Grain Elevator", states: ["IL", "IN", "OH", "MO"], unit: "bu", cap: [1e6, 3e6], invest: [9e6, 20e6], names: ["Grain Co.", "Grain LLC"], what: "new country elevator" },
];

const SOURCES: [string, string][] = [
  ["State air permit application", "Construction permit filed with the state environmental agency"],
  ["County board minutes", "Conditional-use permit approved at the county board meeting"],
  ["Trade press", "Reported in a regional agribusiness trade publication"],
  ["USDA grant announcement", "Named in a USDA rural energy and infrastructure grant round"],
  ["Economic development release", "Announced by the state economic development office"],
  ["Rail spur filing", "Industry track agreement filed with the serving railroad"],
];

const STAGES: NewBuild["Stage"][] = ["Announced", "Permitting", "Under Construction", "Commissioning"];

export function buildNewBuilds(anchor: Date): NewBuild[] {
  const out: NewBuild[] = [];
  const counts = [6, 4, 4, 3, 2, 3];
  NB_SPECS.forEach((spec, si) => {
    for (let k = 0; k < counts[si]; k++) {
      const key = `nb:${si}:${k}`;
      // The first ethanol plant is in Iowa and brand new (used by the demo walkthrough)
      const state = si === 0 && k === 0 ? "IA" : pick(spec.states, `${key}:state`);
      const towns = TOWNS.filter((t) => t.state === state);
      if (!towns.length) continue;
      const town = si === 0 && k === 0 ? (towns.find((t) => t.name === "Fort Dodge") ?? towns[0]) : pick(towns, `${key}:town`);
      const stage = si === 0 && k === 0 ? "Announced" : STAGES[Math.floor(hash01(`${key}:stage`) * 3.4) % 4];
      const announcedAgo = si === 0 && k === 0 ? 6 : Math.floor(20 + hash01(`${key}:ago`) * 320);
      const announced = addDays(anchor, -announcedAgo);
      const months = stage === "Announced" ? 26 : stage === "Permitting" ? 22 : stage === "Under Construction" ? 12 : 3;
      const cap = spec.cap[0] + hash01(`${key}:cap`) * (spec.cap[1] - spec.cap[0]);
      const capRound = spec.unit === "gal/yr" ? Math.round(cap / 5e6) * 5e6 : spec.unit === "bu" ? Math.round(cap / 1e5) * 1e5 : Math.round(cap / 1e4) * 1e4;
      const invest = Math.round((spec.invest[0] + hash01(`${key}:inv`) * (spec.invest[1] - spec.invest[0])) / 1e6) * 1e6;
      const [source, detail] = pick(SOURCES, `${key}:src`);
      const company = `${town.name} ${pick(spec.names, `${key}:name`)}`;
      const jitter = (h: string) => (hash01(`${key}:${h}`) - 0.5) * 0.18;
      const capText =
        spec.unit === "gal/yr" ? `${Math.round(capRound / 1e6)} million gallons a year` : spec.unit === "bu" ? `${(capRound / 1e6).toFixed(1)} million bushels of storage` : `${capRound.toLocaleString("en-US")} tons a year`;
      out.push({
        Id: `a0NHs00000${String(si).padStart(2, "0")}${String(k).padStart(2, "0")}AAA`.slice(0, 18),
        Name: `${company} ${spec.what}`,
        Company: company,
        Facility_Type__c: spec.type,
        Segment__c: spec.segment,
        City: town.name,
        State: state,
        Country: state === "SK" || state === "MB" || state === "AB" || state === "ON" ? "Canada" : "United States",
        Latitude: +(town.lat + jitter("lat")).toFixed(4),
        Longitude: +(town.lon + jitter("lon")).toFixed(4),
        Region__c: (REGION_BY_STATE[state] ?? "western-corn-belt") as RegionId,
        Stage: stage,
        Status: "New",
        Capacity: capRound,
        Capacity_Unit: spec.unit,
        Estimated_Investment: invest,
        Announced_Date: iso(announced),
        Expected_Completion: iso(addDays(announced, months * 30)),
        Source: source,
        Source_Detail: detail,
        Summary: `${company} plans a ${capText} ${spec.what} near ${town.name}, ${state}. ${stage === "Announced" ? "Newly announced; no software vendor selected yet." : stage === "Permitting" ? "In permitting; the owner is lining up vendors." : stage === "Under Construction" ? "Under construction; scale house and office systems are being specified." : "Commissioning; receiving starts soon."}`,
      });
    }
  });
  return out;
}
