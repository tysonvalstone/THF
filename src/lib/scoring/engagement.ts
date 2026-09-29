import type { DataSnapshot } from "@/lib/data/types";
import { parseDate } from "@/lib/dates";

export interface Engagement {
  touches: number;
  lastTouch?: Date;
  lastTouchSubject?: string;
  responses: number;
  lastResponse?: { date: Date; campaign: string };
  openOpportunities: number;
  openPipeline: number;
  lostRecently: boolean;
}

const EMPTY: Engagement = { touches: 0, responses: 0, openOpportunities: 0, openPipeline: 0, lostRecently: false };

/**
 * Activity rolled up per Account / Lead as of a given date. Records dated
 * after `asOf` are ignored so time-travel shows the world as it was.
 */
export function buildEngagementIndex(data: DataSnapshot, asOf: Date): Map<string, Engagement> {
  const idx = new Map<string, Engagement>();
  const yearAgo = asOf.getTime() - 365 * 86_400_000;
  const get = (id: string) => {
    let e = idx.get(id);
    if (!e) {
      e = { ...EMPTY };
      idx.set(id, e);
    }
    return e;
  };
  const touch = (id: string | undefined, date: Date, subject: string) => {
    if (!id) return;
    const t = date.getTime();
    if (t > asOf.getTime() || t < yearAgo) return;
    const e = get(id);
    e.touches++;
    if (!e.lastTouch || date > e.lastTouch) {
      e.lastTouch = date;
      e.lastTouchSubject = subject;
    }
  };

  for (const t of data.tasks) {
    if (t.Status !== "Completed") continue;
    const d = parseDate(t.ActivityDate);
    touch(t.AccountId ?? (t.WhoId?.startsWith("00Q") ? t.WhoId : undefined), d, t.Subject);
  }
  for (const ev of data.events) touch(ev.AccountId, parseDate(ev.StartDateTime), ev.Subject);

  const campaignName = new Map(data.campaigns.map((c) => [c.Id, c.Name]));
  for (const m of data.campaignMembers) {
    if (!m.HasResponded || !m.FirstRespondedDate) continue;
    const d = parseDate(m.FirstRespondedDate);
    if (d > asOf || d.getTime() < yearAgo) continue;
    const id = m.AccountId ?? m.LeadId;
    if (!id) continue;
    const e = get(id);
    e.responses++;
    if (!e.lastResponse || d > e.lastResponse.date) e.lastResponse = { date: d, campaign: campaignName.get(m.CampaignId) ?? "a campaign" };
  }

  for (const o of data.opportunities) {
    const created = parseDate(o.CreatedDate);
    if (created > asOf) continue;
    const e = get(o.AccountId);
    const closedByThen = o.IsClosed && parseDate(o.CloseDate) <= asOf;
    if (!closedByThen) {
      e.openOpportunities++;
      e.openPipeline += o.Amount;
    } else if (!o.IsWon && parseDate(o.CloseDate).getTime() > asOf.getTime() - 120 * 86_400_000) {
      e.lostRecently = true;
    }
  }
  return idx;
}

export function engagementFor(idx: Map<string, Engagement>, id: string): Engagement {
  return idx.get(id) ?? EMPTY;
}
