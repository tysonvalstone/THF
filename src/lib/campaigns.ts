import { REGION_BY_ID } from "@/data/reference/regions";
import type { DataSnapshot } from "@/lib/data/types";
import { contactsFor, findAccount, findLead } from "@/lib/data/selectors";
import type { ScoredTarget } from "@/lib/scoring";
import { preferredContact } from "@/lib/nba";
import type { Campaign, Commodity, FacilityType, RegionId } from "@/types/salesforce";
import { playForDate, type SeasonPlay } from "@/lib/content/messaging";
import { isSeasonalSegment } from "@/lib/seasonality";
import { segmentOf } from "@/lib/scoring/target";
import { toCSV } from "@/lib/csv";

export interface MailRecipient {
  targetId: string;
  whoId?: string;
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  email: string;
  score: number;
}

export function recipientFor(data: DataSnapshot, s: ScoredTarget): MailRecipient | undefined {
  if (s.target.kind === "lead") {
    const l = findLead(data, s.target.id);
    if (!l) return undefined;
    return {
      targetId: l.Id,
      whoId: l.Id,
      firstName: l.FirstName,
      lastName: l.LastName,
      title: l.Title,
      company: l.Company,
      street: l.Street,
      city: l.City,
      state: l.State,
      postalCode: l.PostalCode,
      country: l.Country,
      email: l.Email,
      score: s.total,
    };
  }
  const a = findAccount(data, s.target.id);
  if (!a) return undefined;
  const c = preferredContact(s, contactsFor(data, a.Id));
  return {
    targetId: a.Id,
    whoId: c?.Id,
    firstName: c?.FirstName ?? "",
    lastName: c?.LastName ?? "",
    title: c?.Title ?? "General Manager",
    company: a.Name,
    street: c?.MailingStreet ?? a.BillingStreet,
    city: c?.MailingCity ?? a.BillingCity,
    state: c?.MailingState ?? a.BillingState,
    postalCode: c?.MailingPostalCode ?? a.BillingPostalCode,
    country: c?.MailingCountry ?? a.BillingCountry,
    email: c?.Email ?? "",
    score: s.total,
  };
}

export function mailListCsv(rows: MailRecipient[]): string {
  return toCSV(rows, [
    { header: "First Name", value: (r) => r.firstName },
    { header: "Last Name", value: (r) => r.lastName },
    { header: "Title", value: (r) => r.title },
    { header: "Company", value: (r) => r.company },
    { header: "Address Line 1", value: (r) => r.street },
    { header: "City", value: (r) => r.city },
    { header: "State/Province", value: (r) => r.state },
    { header: "ZIP/Postal Code", value: (r) => r.postalCode },
    { header: "Country", value: (r) => r.country },
    { header: "Email", value: (r) => r.email },
    { header: "Score", value: (r) => r.score },
    { header: "Salesforce Record Id", value: (r) => r.targetId },
    { header: "Salesforce Contact/Lead Id", value: (r) => r.whoId },
  ]);
}

export interface Audience {
  play: SeasonPlay;
  regions: RegionId[];
  types: FacilityType[];
  commodity?: Commodity;
}

export function matchTargets(ranked: ScoredTarget[], a: Audience): ScoredTarget[] {
  return ranked.filter(
    (s) =>
      (!a.regions.length || a.regions.includes(s.target.regionId)) &&
      (!a.types.length || a.types.includes(s.target.facilityType)) &&
      (!a.commodity || s.target.commodities.includes(a.commodity)),
  );
}

/** Suggest the natural play for an audience on a date */
export function suggestedPlay(types: FacilityType[], asOf: Date): SeasonPlay {
  const grain = !types.length || types.some((t) => isSeasonalSegment(segmentOf(t)));
  return playForDate(asOf, grain ? "Country Elevator" : "Ethanol Plant");
}

export function defaultCampaignName(a: Audience, type: Campaign["Type"], asOf: Date): string {
  const regions = a.regions.length ? a.regions.map((r) => REGION_BY_ID[r].shortName).join(" + ") : "All regions";
  const crop = a.commodity ? ` ${a.commodity}` : "";
  return `${asOf.getUTCFullYear()} ${a.play}${crop} · ${regions} · ${type}`;
}

export const COST_PER_TOUCH: Record<Campaign["Type"], number> = {
  "Direct Mail": 3.8,
  Email: 0.4,
  "Call Blitz": 32,
  "Multi-Channel": 41,
  Event: 180,
};

export const EXPECTED_RESPONSE: Record<Campaign["Type"], number> = {
  "Direct Mail": 0.06,
  Email: 0.04,
  "Call Blitz": 0.12,
  "Multi-Channel": 0.1,
  Event: 0.2,
};

/** Rough economics: responses × 25% win × average new-business deal */
export function campaignEconomics(type: Campaign["Type"], members: number, avgScore: number) {
  const budget = Math.round(500 + members * COST_PER_TOUCH[type]);
  const scoreLift = 0.6 + (avgScore / 100) * 0.8;
  const responses = members * EXPECTED_RESPONSE[type] * scoreLift;
  const expectedRevenue = Math.round(responses * 0.25 * 165_000);
  return { budget, responses, expectedRevenue, roi: budget ? expectedRevenue / budget : 0 };
}
