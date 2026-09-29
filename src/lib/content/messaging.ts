import type { FacilityType, Segment } from "@/types/salesforce";
import { isSeasonalSegment, sellingWindowAt } from "@/lib/seasonality";

/** Campaign plays follow the four grain selling windows (plus harvest support and year-round segments) */
export type SeasonPlay = "Year-end" | "Implementation" | "Budget window" | "Quick wins" | "Harvest support" | "Year-round";
export const SEASON_PLAYS: SeasonPlay[] = ["Year-end", "Implementation", "Budget window", "Quick wins", "Harvest support", "Year-round"];

/** Old play names saved on earlier campaigns */
export const LEGACY_PLAYS: Record<string, SeasonPlay> = {
  "Post-harvest": "Year-end",
  "Pre-planting": "Implementation",
  "Pre-harvest": "Budget window",
  Harvest: "Harvest support",
};

export const PLAY_DESCRIPTIONS: Record<SeasonPlay, string> = {
  "Year-end": "Dec–Feb, prime time: year-end close, audits, boards and budgets.",
  Implementation: "Late Feb–Mar: decide now, live before planting.",
  "Budget window": "Jun–Jul: get into the next fiscal-year budget (FY ends Aug 31 / Sep 30).",
  "Quick wins": "Early Aug: mobile add-ons and pilots only.",
  "Harvest support": "Mid-Aug–Thanksgiving: support customers, collect NPS; sell to year-round segments.",
  "Year-round": "Ethanol, feed mills and processors: margins, procurement and delivery.",
};

export type FacilityGroup = "grain" | "processing" | "feed" | "agronomy";

export function facilityGroup(t: FacilityType): FacilityGroup {
  if (t === "Ethanol Plant" || t === "Oilseed Crusher" || t === "Flour Mill") return "processing";
  if (t === "Feed Mill") return "feed";
  if (t === "Agronomy Retailer") return "agronomy";
  return "grain";
}

export interface Message {
  hook: string;
  pains: string[];
  outcomes: string[];
  proof: string;
  offer: string;
  products: string[];
}

/** The messaging matrix: facility group × seasonal play. */
export const MESSAGES: Record<FacilityGroup, Record<SeasonPlay, Message>> = {
  grain: {
    "Budget window": {
      hook: "Next fiscal year's budget is being written now. Put the scale-to-settlement fix in it.",
      pains: [
        "tickets keyed twice between the scale house and the office",
        "settlements and price-later contracts assembled in spreadsheets",
        "a merchandiser who can't see today's position until someone reconciles three spreadsheets",
      ],
      outcomes: [
        "a fixed-price proposal sized to your locations, ready for the budget meeting",
        "implementation scheduled for December, after harvest and before year-end",
        "a live company-wide position, including price-later bushels, by location",
      ],
      proof: "A four-location elevator in north-central Iowa budgeted in July, went live in December and closed its books two weeks earlier.",
      offer: "a budget-ready proposal and a 30-minute walkthrough with your GM and controller",
      products: ["Ceres", "GrainSight", "ScaleTrac"],
    },
    "Quick wins": {
      hook: "Two weeks before harvest, one small thing that pays off this fall.",
      pains: ["drivers waiting at the scale for paper tickets", "growers calling the office for contract and ticket status", "last-minute scale house staffing"],
      outcomes: ["mobile scale tickets live in days, not months", "growers see tickets and contracts on their phones", "a pilot at one location before committing"],
      proof: "A co-op in Nebraska piloted ScaleTrac Mobile at two locations last August and rolled it out company-wide in December.",
      offer: "a no-cost pilot of ScaleTrac Mobile or GrainSight Mobile at one location",
      products: ["ScaleTrac Mobile", "GrainSight Mobile"],
    },
    "Harvest support": {
      hook: "We know you're buried in scale tickets right now, so this one's short.",
      pains: [
        "long days at the probe and the scale",
        "settlement questions piling up for after harvest",
        "bins filling faster than the position report can keep up",
      ],
      outcomes: [
        "a 20-minute look at your settlement process once the last truck is in",
        "a short list of what we'd fix before next harvest",
        "no pitch until you've had time to breathe",
      ],
      proof: "Most of our elevator customers made their decision in the eight weeks after harvest, when the pain was still fresh.",
      offer: "a post-harvest review, booked now for a date that suits you",
      products: ["Ceres", "ScaleTrac"],
    },
    "Year-end": {
      hook: "The bins are full. Now comes settlement season.",
      pains: [
        "settlements, deferred payments and liens assembled in Excel before every cheque run",
        "tax-slip season (1099s in the U.S., T5018s in Canada) and year-end inventory valuation eating up the office in January",
        "producers calling the office to ask about contracts and settlement status",
      ],
      outcomes: [
        "settlements generated straight from tickets and contracts, with deferred-payment schedules built in",
        "year-end grain inventory and tax slips produced in hours, not weeks",
        "a producer portal where growers see their own tickets, contracts and settlements",
      ],
      proof: "A six-location co-op in Nebraska cut its weekly settlement run from three days to four hours and closed the year two weeks earlier.",
      offer: "a 20-minute year-end review with our grain accounting team",
      products: ["Ceres", "Ceres", "GrainSight Mobile"],
    },
    Implementation: {
      hook: "Before spring gets busy: this is the quiet window to fix next harvest's problems.",
      pains: [
        "last harvest's workarounds are still in place",
        "the board wants better margin and position reporting",
        "the implementation window closes once planting starts",
      ],
      outcomes: [
        "a go-live plan that finishes well before next harvest",
        "board-ready margin and position reporting",
        "a team that is trained and confident on the new system before the first truck arrives",
      ],
      proof: "Customers who started in February were fully live, and trained, by early July.",
      offer: "a planning session to map a go-live before next harvest",
      products: ["Ceres", "GrainSight", "Go-Live Training"],
    },
    "Year-round": {
      hook: "One system from the scale ticket to the settlement cheque.",
      pains: ["double entry between scale, accounting and merchandising", "no real-time position", "manual settlements"],
      outcomes: ["tickets that flow straight into contracts and settlements", "a live position", "automated settlements"],
      proof: "More than 400 ag businesses across North America run on ThiboLiSoft.",
      offer: "a 30-minute walkthrough tailored to your operation",
      products: ["Ceres", "ScaleTrac", "GrainSight"],
    },
  },
  processing: {
    "Budget window": {
      hook: "New-crop buying is weeks away. Will your origination team see every bushel and every basis cent?",
      pains: [
        "bids, contracts and receipts spread across email, spreadsheets and the scale system",
        "co-product sales (DDGS, meal, oil, millfeed) tracked separately from grain procurement",
        "margin visibility that lags the market by a day or more",
      ],
      outcomes: [
        "producer bids pushed to growers' phones, with contracts signed electronically",
        "grain procurement and co-product sales in one position",
        "a daily margin view: crush, grind or mill spread, updated with every contract",
      ],
      proof: "A 110M-gallon plant in Nebraska tightened its average corn basis by 3¢/bu in its first new-crop season with us.",
      offer: "a new-crop origination review with our processing team",
      products: ["GrainSight", "GrainSight", "GrainSight Mobile"],
    },
    "Harvest support": {
      hook: "Receiving is running flat out, so we'll keep this brief.",
      pains: ["long receiving lines", "grade and quality disputes", "procurement and receiving out of sync"],
      outcomes: ["a post-harvest look at receiving and procurement", "a short improvement list", "no pitch until you're ready"],
      proof: "Most processors we work with evaluate right after new-crop receiving settles down.",
      offer: "a post-harvest procurement review",
      products: ["GrainSight", "ScaleTrac"],
    },
    "Year-end": {
      hook: "New-crop is booked. This is the moment to fix procurement before next year.",
      pains: ["contract and settlement reconciliation", "co-product sales tracked in spreadsheets", "rail and logistics planned by phone"],
      outcomes: ["automated grower settlements", "co-product contracts in the same position", "rail car planning tied to sales"],
      proof: "An oilseed crusher in Saskatchewan reconciled its year-end contracts in two days instead of two weeks.",
      offer: "a year-end procurement and settlement review",
      products: ["GrainSight", "Ceres"],
    },
    Implementation: {
      hook: "Spring is the quiet window to plan next year's origination program.",
      pains: ["planning grower programs in spreadsheets", "limited producer engagement tools", "manual contract paperwork"],
      outcomes: ["a producer portal for grower programs", "e-signed contracts", "a go-live before new-crop"],
      proof: "Customers who started in spring were live well ahead of new-crop receiving.",
      offer: "an origination planning session",
      products: ["GrainSight Mobile", "GrainSight"],
    },
    "Year-round": {
      hook: "Margins move every day. Your procurement system should too.",
      pains: [
        "margin that is only known after month-end",
        "corn, oilseed or wheat procurement disconnected from co-product and product sales",
        "RIN, rail and logistics records kept in separate tools",
      ],
      outcomes: ["a daily margin view", "procurement and sales in one position", "compliance and logistics records in one place"],
      proof: "A 110M-gallon plant in Nebraska tightened its average corn basis by 3¢/bu in its first year with us.",
      offer: "a margin-management walkthrough with our processing team",
      products: ["GrainSight", "GrainSight"],
    },
    "Quick wins": {
      hook: "Margins move every day. Your procurement system should too.",
      pains: [
        "margin that is only known after month-end",
        "corn, oilseed or wheat procurement disconnected from co-product and product sales",
        "RIN, rail and logistics records kept in separate tools",
      ],
      outcomes: ["a daily margin view", "procurement and sales in one position", "compliance and logistics records in one place"],
      proof: "A 110M-gallon plant in Nebraska tightened its average corn basis by 3¢/bu in its first year with us.",
      offer: "a margin-management walkthrough with our processing team",
      products: ["GrainSight", "GrainSight"],
    },
  },
  feed: {
    "Budget window": {
      hook: "New-crop corn is coming. Lock in your ingredient costing before winter tonnage climbs.",
      pains: ["ration costs recalculated by hand whenever corn or meal moves", "batch records on paper in the control room", "delivery tickets that don't match the batch"],
      outcomes: ["ration costing that updates with every ingredient receipt", "batch and VFD records captured automatically", "delivery tickets tied to the batch, the truck and the customer"],
      proof: "A poultry feed mill in Georgia cut batch-to-invoice errors by 80% in its first quarter live.",
      offer: "a feed-mill efficiency review before winter feeding season",
      products: ["Ceres", "Ceres"],
    },
    "Harvest support": {
      hook: "New-crop corn is flowing in. Here's one idea for after the rush.",
      pains: ["receiving and batching both at peak", "ingredient inventory drift", "invoicing lag"],
      outcomes: ["a short post-harvest review", "an inventory accuracy check", "no pitch until you're ready"],
      proof: "Most mills we work with evaluate once new-crop receiving settles down.",
      offer: "a post-harvest feed-mill review",
      products: ["Ceres"],
    },
    "Year-end": {
      hook: "Winter feeding season is here. Is every batch, ticket and invoice lining up?",
      pains: ["delivery routing done on a whiteboard", "medicated feed and VFD paperwork", "invoices that lag deliveries by days"],
      outcomes: ["routed bulk deliveries with e-tickets", "VFD records attached to every batch", "same-day invoicing"],
      proof: "A swine feed mill in Iowa now invoices the same day it delivers, and cut receivables days by 11.",
      offer: "a delivery and invoicing review",
      products: ["Ceres", "Ceres"],
    },
    Implementation: {
      hook: "Plan next year's feed program before spring gets busy.",
      pains: ["contract pricing built in spreadsheets", "ingredient hedging disconnected from sales", "manual customer statements"],
      outcomes: ["contract feed pricing tied to ingredient cost", "hedges alongside sales", "automated statements"],
      proof: "Mills that start in the spring are live before the next harvest.",
      offer: "a feed-program planning session",
      products: ["Ceres", "GrainSight"],
    },
    "Year-round": {
      hook: "Integrator demand never takes a day off. Neither should your batching data.",
      pains: [
        "batching on an aging PC in the control room",
        "ration costs out of date whenever corn or soybean meal moves",
        "delivery tickets, VFD records and invoices in different places",
      ],
      outcomes: ["batching integration with a full audit trail", "live ration costing", "one record from batch to delivery to invoice"],
      proof: "A poultry feed mill in Georgia cut batch-to-invoice errors by 80% in its first quarter live.",
      offer: "a 30-minute feed-mill efficiency review",
      products: ["Ceres", "Ceres"],
    },
    "Quick wins": {
      hook: "Integrator demand never takes a day off. Neither should your batching data.",
      pains: [
        "batching on an aging PC in the control room",
        "ration costs out of date whenever corn or soybean meal moves",
        "delivery tickets, VFD records and invoices in different places",
      ],
      outcomes: ["batching integration with a full audit trail", "live ration costing", "one record from batch to delivery to invoice"],
      proof: "A poultry feed mill in Georgia cut batch-to-invoice errors by 80% in its first quarter live.",
      offer: "a 30-minute feed-mill efficiency review",
      products: ["Ceres", "Ceres"],
    },
  },
  agronomy: {
    "Budget window": {
      hook: "Fall application season is coming right behind harvest. Are your bookings and tickets ready?",
      pains: ["application tickets on paper in the cab", "fall fertilizer bookings in a spreadsheet", "split billing between landlord and tenant done by hand"],
      outcomes: ["mobile application tickets, synced back to the office", "bookings and prepay tracked by grower", "split billing done automatically"],
      proof: "A five-location agronomy retailer in Illinois billed fall application the same week, instead of waiting until December.",
      offer: "a fall application readiness review",
      products: ["Ceres", "Ceres"],
    },
    "Harvest support": {
      hook: "Your growers are combining and your applicators are next. Quick note:",
      pains: ["fall bookings coming in by phone", "product allocations shifting daily", "billing waiting until after the rush"],
      outcomes: ["a post-season look at bookings and billing", "a short improvement list", "no pitch until you're ready"],
      proof: "Most agronomy retailers we work with plan changes right after fall application.",
      offer: "a post-season agronomy review",
      products: ["Ceres"],
    },
    "Year-end": {
      hook: "Prepay season is here. Make it easy for growers to commit early.",
      pains: ["prepay and booking contracts on paper", "no easy way for growers to see their bookings", "year-end chemical and fertilizer inventory counts"],
      outcomes: ["digital prepay and bookings with e-signature", "a grower portal showing bookings, balances and prepay", "perpetual input inventory by location"],
      proof: "A retailer in Manitoba grew its prepay dollars 22% after moving bookings to the grower portal.",
      offer: "a prepay and bookings walkthrough",
      products: ["Ceres", "GrainSight Mobile"],
    },
    Implementation: {
      hook: "Spring is six weeks out. Are bookings, inventory and application tickets ready?",
      pains: ["booked product vs. inventory tracked separately", "custom application scheduled on a whiteboard", "application tickets re-keyed for billing"],
      outcomes: ["bookings reconciled to inventory by location", "application scheduling and mobile tickets", "same-week billing, including split billing"],
      proof: "A five-location retailer in Illinois cut spring billing time by 60%.",
      offer: "a spring readiness review of bookings, inventory and application",
      products: ["Ceres", "Ceres"],
    },
    "Year-round": {
      hook: "From prepay to application ticket to invoice, in one system.",
      pains: ["bookings in spreadsheets", "paper application tickets", "manual split billing"],
      outcomes: ["digital bookings", "mobile tickets", "automated split billing"],
      proof: "Agronomy retailers across the Corn Belt and the Prairies run on ThiboLiSoft.",
      offer: "a 30-minute agronomy walkthrough",
      products: ["Ceres"],
    },
    "Quick wins": {
      hook: "From prepay to application ticket to invoice, in one system.",
      pains: ["bookings in spreadsheets", "paper application tickets", "manual split billing"],
      outcomes: ["digital bookings", "mobile tickets", "automated split billing"],
      proof: "Agronomy retailers across the Corn Belt and the Prairies run on ThiboLiSoft.",
      offer: "a 30-minute agronomy walkthrough",
      products: ["Ceres"],
    },
  },
};

/** The natural play for a segment on a date, from the grain selling windows */
export function playForDate(asOf: Date, segment?: Segment): SeasonPlay {
  if (!isSeasonalSegment(segment)) return "Year-round";
  switch (sellingWindowAt(asOf).id) {
    case "year-end":
    case "shoulder":
      return "Year-end";
    case "implementation":
    case "planting":
      return "Implementation";
    case "budget":
      return "Budget window";
    case "quick-wins":
      return "Quick wins";
    default:
      return "Harvest support";
  }
}
