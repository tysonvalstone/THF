import type { FacilityType } from "@/types/salesforce";

export type SeasonPlay = "Pre-harvest" | "Harvest" | "Post-harvest" | "Pre-planting" | "Year-round";
export const SEASON_PLAYS: SeasonPlay[] = ["Pre-harvest", "Harvest", "Post-harvest", "Pre-planting", "Year-round"];

export const PLAY_DESCRIPTIONS: Record<SeasonPlay, string> = {
  "Pre-harvest": "Land 4–6 weeks before harvest: scale lines, ticket accuracy, real-time position.",
  Harvest: "Light touch while they're slammed: plant a flag, book a post-harvest demo.",
  "Post-harvest": "Settlements, deferred payments, tax slips, year-end inventory and board reporting.",
  "Pre-planting": "Agronomy prepay and bookings, spring application tickets, input inventory.",
  "Year-round": "Processors and feed mills: margins, procurement and delivery efficiency.",
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
    "Pre-harvest": {
      hook: "Harvest is about to hit your scale house. Is your ticketing ready for the rush?",
      pains: [
        "trucks backed up onto the highway while tickets are written and keyed twice",
        "grade, moisture, shrink and drying discounts worked out by hand at the end of the day",
        "a merchandiser who can't see today's position until someone reconciles three spreadsheets",
      ],
      outcomes: [
        "driver kiosks and probe integration that cut time at the scale by about a third",
        "discounts calculated on the ticket, the moment the sample is graded",
        "a live company-wide position, including DP and storage bushels, by bin and by location",
      ],
      proof: "A four-location elevator in north-central Iowa went live six weeks before harvest last year and cut average truck time on the scale from 11 minutes to 7.",
      offer: "a free 30-minute harvest-readiness review of your scale house and ticket-to-settlement process",
      products: ["ThiboLi ScaleHouse", "ThiboLi Merchandiser", "ThiboLi BinSight"],
    },
    Harvest: {
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
      products: ["ThiboLi Settle", "ThiboLi ScaleHouse"],
    },
    "Post-harvest": {
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
      products: ["ThiboLi Settle", "ThiboLi Ledger", "ThiboLi GrowerHub"],
    },
    "Pre-planting": {
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
      products: ["ThiboLi Ledger", "ThiboLi Merchandiser", "Harvest-Ready Training"],
    },
    "Year-round": {
      hook: "One system from the scale ticket to the settlement cheque.",
      pains: ["double entry between scale, accounting and merchandising", "no real-time position", "manual settlements"],
      outcomes: ["tickets that flow straight into contracts and settlements", "a live position", "automated settlements"],
      proof: "More than 400 ag businesses across North America run on ThiboLiSoft.",
      offer: "a 30-minute walkthrough tailored to your operation",
      products: ["ThiboLi Ledger", "ThiboLi ScaleHouse", "ThiboLi Merchandiser"],
    },
  },
  processing: {
    "Pre-harvest": {
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
      products: ["ThiboLi PlantOps", "ThiboLi Merchandiser", "ThiboLi GrowerHub"],
    },
    Harvest: {
      hook: "Receiving is running flat out, so we'll keep this brief.",
      pains: ["long receiving lines", "grade and quality disputes", "procurement and receiving out of sync"],
      outcomes: ["a post-harvest look at receiving and procurement", "a short improvement list", "no pitch until you're ready"],
      proof: "Most processors we work with evaluate right after new-crop receiving settles down.",
      offer: "a post-harvest procurement review",
      products: ["ThiboLi PlantOps", "ThiboLi ScaleHouse"],
    },
    "Post-harvest": {
      hook: "New-crop is booked. This is the moment to fix procurement before next year.",
      pains: ["contract and settlement reconciliation", "co-product sales tracked in spreadsheets", "rail and logistics planned by phone"],
      outcomes: ["automated grower settlements", "co-product contracts in the same position", "rail car planning tied to sales"],
      proof: "An oilseed crusher in Saskatchewan reconciled its year-end contracts in two days instead of two weeks.",
      offer: "a year-end procurement and settlement review",
      products: ["ThiboLi PlantOps", "ThiboLi Settle"],
    },
    "Pre-planting": {
      hook: "Spring is the quiet window to plan next year's origination program.",
      pains: ["planning grower programs in spreadsheets", "limited producer engagement tools", "manual contract paperwork"],
      outcomes: ["a producer portal for grower programs", "e-signed contracts", "a go-live before new-crop"],
      proof: "Customers who started in spring were live well ahead of new-crop receiving.",
      offer: "an origination planning session",
      products: ["ThiboLi GrowerHub", "ThiboLi PlantOps"],
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
      products: ["ThiboLi PlantOps", "ThiboLi Merchandiser"],
    },
  },
  feed: {
    "Pre-harvest": {
      hook: "New-crop corn is coming. Lock in your ingredient costing before winter tonnage climbs.",
      pains: ["ration costs recalculated by hand whenever corn or meal moves", "batch records on paper in the control room", "delivery tickets that don't match the batch"],
      outcomes: ["ration costing that updates with every ingredient receipt", "batch and VFD records captured automatically", "delivery tickets tied to the batch, the truck and the customer"],
      proof: "A poultry feed mill in Georgia cut batch-to-invoice errors by 80% in its first quarter live.",
      offer: "a feed-mill efficiency review before winter feeding season",
      products: ["ThiboLi FeedWorks", "ThiboLi Ledger"],
    },
    Harvest: {
      hook: "New-crop corn is flowing in. Here's one idea for after the rush.",
      pains: ["receiving and batching both at peak", "ingredient inventory drift", "invoicing lag"],
      outcomes: ["a short post-harvest review", "an inventory accuracy check", "no pitch until you're ready"],
      proof: "Most mills we work with evaluate once new-crop receiving settles down.",
      offer: "a post-harvest feed-mill review",
      products: ["ThiboLi FeedWorks"],
    },
    "Post-harvest": {
      hook: "Winter feeding season is here. Is every batch, ticket and invoice lining up?",
      pains: ["delivery routing done on a whiteboard", "medicated feed and VFD paperwork", "invoices that lag deliveries by days"],
      outcomes: ["routed bulk deliveries with e-tickets", "VFD records attached to every batch", "same-day invoicing"],
      proof: "A swine feed mill in Iowa now invoices the same day it delivers, and cut receivables days by 11.",
      offer: "a delivery and invoicing review",
      products: ["ThiboLi FeedWorks", "ThiboLi Ledger"],
    },
    "Pre-planting": {
      hook: "Plan next year's feed program before spring gets busy.",
      pains: ["contract pricing built in spreadsheets", "ingredient hedging disconnected from sales", "manual customer statements"],
      outcomes: ["contract feed pricing tied to ingredient cost", "hedges alongside sales", "automated statements"],
      proof: "Mills that start in the spring are live before the next harvest.",
      offer: "a feed-program planning session",
      products: ["ThiboLi FeedWorks", "ThiboLi Merchandiser"],
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
      products: ["ThiboLi FeedWorks", "ThiboLi Ledger"],
    },
  },
  agronomy: {
    "Pre-harvest": {
      hook: "Fall application season is coming right behind harvest. Are your bookings and tickets ready?",
      pains: ["application tickets on paper in the cab", "fall fertilizer bookings in a spreadsheet", "split billing between landlord and tenant done by hand"],
      outcomes: ["mobile application tickets, synced back to the office", "bookings and prepay tracked by grower", "split billing done automatically"],
      proof: "A five-location agronomy retailer in Illinois billed fall application the same week, instead of waiting until December.",
      offer: "a fall application readiness review",
      products: ["ThiboLi AgronomyPro", "ThiboLi Ledger"],
    },
    Harvest: {
      hook: "Your growers are combining and your applicators are next. Quick note:",
      pains: ["fall bookings coming in by phone", "product allocations shifting daily", "billing waiting until after the rush"],
      outcomes: ["a post-season look at bookings and billing", "a short improvement list", "no pitch until you're ready"],
      proof: "Most agronomy retailers we work with plan changes right after fall application.",
      offer: "a post-season agronomy review",
      products: ["ThiboLi AgronomyPro"],
    },
    "Post-harvest": {
      hook: "Prepay season is here. Make it easy for growers to commit early.",
      pains: ["prepay and booking contracts on paper", "no easy way for growers to see their bookings", "year-end chemical and fertilizer inventory counts"],
      outcomes: ["digital prepay and bookings with e-signature", "a grower portal showing bookings, balances and prepay", "perpetual input inventory by location"],
      proof: "A retailer in Manitoba grew its prepay dollars 22% after moving bookings to the grower portal.",
      offer: "a prepay and bookings walkthrough",
      products: ["ThiboLi AgronomyPro", "ThiboLi GrowerHub"],
    },
    "Pre-planting": {
      hook: "Spring is six weeks out. Are bookings, inventory and application tickets ready?",
      pains: ["booked product vs. inventory tracked separately", "custom application scheduled on a whiteboard", "application tickets re-keyed for billing"],
      outcomes: ["bookings reconciled to inventory by location", "application scheduling and mobile tickets", "same-week billing, including split billing"],
      proof: "A five-location retailer in Illinois cut spring billing time by 60%.",
      offer: "a spring readiness review of bookings, inventory and application",
      products: ["ThiboLi AgronomyPro", "ThiboLi Ledger"],
    },
    "Year-round": {
      hook: "From prepay to application ticket to invoice, in one system.",
      pains: ["bookings in spreadsheets", "paper application tickets", "manual split billing"],
      outcomes: ["digital bookings", "mobile tickets", "automated split billing"],
      proof: "Agronomy retailers across the Corn Belt and the Prairies run on ThiboLiSoft.",
      offer: "a 30-minute agronomy walkthrough",
      products: ["ThiboLi AgronomyPro"],
    },
  },
};

/** Map a scored prospect's timing state to the natural seasonal play */
export function playForTiming(state: "before" | "during" | "after" | undefined, kind?: string): SeasonPlay {
  if (kind === "spring-application") return state === "after" ? "Post-harvest" : "Pre-planting";
  if (kind === "feeding-season") return "Year-round";
  if (state === "during") return "Harvest";
  if (state === "after") return "Post-harvest";
  if (state === "before") return "Pre-harvest";
  return "Year-round";
}
