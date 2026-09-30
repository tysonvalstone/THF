/**
 * Customer success seed: health signals and support tickets for every
 * customer, and onboarding projects for contracts signed in the last ~150
 * days. Hash-based (hash01), so it never changes other records.
 *
 * Mix: ~65% Healthy, 22% Watch, 13% At Risk; about half of the healthy
 * multi-location co-ops have high CSAT but not every location live
 * (expansion candidates); one onboarding project is At Risk.
 */
import type { SeedContext } from "./platform";
import type { DataSnapshot } from "../../src/lib/data/types";
import type { Account, HealthSignal, OnboardingProject, OnboardingTask, SupportTicket } from "../../src/types/salesforce";
import { onboardingPlan } from "../../src/lib/success/onboarding";
import { hash01 } from "./quoting";

type Band = "Healthy" | "Watch" | "At Risk";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const between = (key: string, lo: number, hi: number) => lo + hash01(key) * (hi - lo);
const int = (key: string, lo: number, hi: number) => Math.floor(between(key, lo, hi + 1));
const id = (prefix: string, n: number) => `${prefix}Hs${String(n).padStart(10, "0")}AAA`;

const SUBJECTS = [
  "Scale ticket not printing at inbound scale",
  "Settlement report totals off by a load",
  "Grade factors not pulling from probe",
  "Moisture shrink table update for new crop",
  "User locked out after password reset",
  "Contract balance not updating after delivery",
  "Driver kiosk frozen on weigh-out",
  "Month-end inventory position does not match",
  "DP (delayed price) contracts missing from position report",
  "Patronage export to accounting fails",
  "Add a new commodity code for soybeans",
  "Mobile app not syncing tickets",
  "Futures prices stale on bid sheet",
  "Warehouse receipt numbering reset",
  "Slow load times on customer statements",
  "Split ticket applied to wrong landlord",
];

const bandOf = (accountId: string): Band => {
  const r = hash01(`${accountId}:health-band`);
  return r < 0.65 ? "Healthy" : r < 0.87 ? "Watch" : "At Risk";
};

function ticketsFor(a: Account, band: Band, anchor: Date, products: SeedContext["products"], next: () => number): SupportTicket[] {
  const k = (s: string) => `${a.Id}:ticket:${s}`;
  const total = band === "Healthy" ? int(k("n"), 2, 3) : band === "Watch" ? int(k("n"), 3, 5) : int(k("n"), 4, 6);
  const recent = band === "Healthy" ? int(k("r"), 0, 1) : band === "Watch" ? int(k("r"), 2, 3) : int(k("r"), 3, 4);
  const out: SupportTicket[] = [];
  for (let i = 0; i < total; i++) {
    const isRecent = i < recent;
    const age = isRecent ? int(k(`age${i}`), 2, 85) : int(k(`age${i}`), 95, 178);
    const created = addDays(anchor, -age);
    const pr = hash01(k(`p${i}`));
    const priority: SupportTicket["Priority"] =
      band === "Healthy"
        ? pr < 0.5 ? "Low" : "Normal"
        : band === "Watch"
          ? i === 0 && isRecent ? "High" : pr < 0.3 ? "Low" : "Normal"
          : i === 0 && isRecent ? "Urgent" : i === 1 && isRecent ? "High" : pr < 0.5 ? "Normal" : "High";
    const openCount = band === "Healthy" ? 0 : band === "Watch" ? 1 : 2;
    const open = isRecent && i < openCount;
    const status: SupportTicket["Status"] = open ? (hash01(k(`s${i}`)) < 0.5 ? "Open" : "Pending") : "Closed";
    const closed = open ? undefined : addDays(created, Math.min(age - 1, int(k(`c${i}`), 1, 12)));
    const product = products.filter((p) => p.Pricing_Unit__c !== "one-time")[Math.floor(hash01(k(`prod${i}`)) * 5) % 5];
    out.push({
      Id: id("500", next()),
      AccountId: a.Id,
      Subject: SUBJECTS[Math.floor(hash01(k(`subj${i}`)) * SUBJECTS.length)],
      Priority: priority,
      Status: status,
      Product2Id: product?.Id,
      CreatedDate: `${iso(created)}T${String(13 + (i % 6)).padStart(2, "0")}:15:00.000+0000`,
      ClosedDate: closed ? `${iso(closed)}T20:00:00.000+0000` : undefined,
    });
  }
  return out.sort((x, y) => x.CreatedDate.localeCompare(y.CreatedDate));
}

function signalFor(a: Account, band: Band, recentTickets: number, anchor: Date, n: number): HealthSignal {
  const k = (s: string) => `${a.Id}:signal:${s}`;
  const locations = Math.max(1, a.Number_of_Locations__c);
  const coop = (a.Segment__c === "Multi-Location Co-op" || a.Facility_Type__c === "Cooperative") && locations > 1;
  const expansion = coop && band === "Healthy" && hash01(k("expansion")) < 0.5;
  const usage = band === "Healthy" ? between(k("u"), 70, 96) : band === "Watch" ? between(k("u"), 40, 62) : between(k("u"), 18, 44);
  const csat = expansion ? between(k("c"), 8.2, 9.7) : band === "Healthy" ? between(k("c"), 7.4, 9.6) : band === "Watch" ? between(k("c"), 5.0, 7.0) : between(k("c"), 2.8, 5.4);
  const stakeholder = band === "Healthy" ? false : band === "Watch" ? hash01(k("s")) < 0.35 : hash01(k("s")) < 0.6;
  const live = expansion ? Math.min(locations - 1, Math.max(1, Math.round(locations * between(k("l"), 0.35, 0.8)))) : locations;
  return {
    Id: id("a0H", n),
    AccountId: a.Id,
    UsageScore: Math.round(usage),
    SupportTickets90d: recentTickets,
    CSAT: Math.round(csat * 10) / 10,
    StakeholderChange: stakeholder,
    LocationsLive: live,
    AsOfDate: iso(addDays(anchor, -int(k("d"), 1, 14))),
  };
}

export function buildSuccess(
  ctx: SeedContext,
  contracts: Pick<DataSnapshot, "contracts" | "contractClauses" | "clauses">,
): Pick<DataSnapshot, "onboardingProjects" | "onboardingTasks" | "healthSignals" | "supportTickets"> {
  const { anchor } = ctx;
  const live = contracts.contracts.filter((c) => c.Status === "Active" || c.Status === "Signed");
  const withContract = new Set(live.map((c) => c.AccountId));
  const customers = ctx.accounts.filter((a) => a.Type === "Customer - Direct" || withContract.has(a.Id)).sort((a, b) => a.Id.localeCompare(b.Id));

  let ticketN = 0;
  const healthSignals: HealthSignal[] = [];
  const supportTickets: SupportTicket[] = [];
  customers.forEach((a, i) => {
    const band = bandOf(a.Id);
    const tickets = ticketsFor(a, band, anchor, ctx.products, () => ++ticketN);
    supportTickets.push(...tickets);
    const recent = tickets.filter((t) => new Date(t.CreatedDate) > addDays(anchor, -90)).length;
    healthSignals.push(signalFor(a, band, recent, anchor, i + 1));
  });

  // Onboarding: contracts signed in the last ~150 days
  const accounts = new Map(ctx.accounts.map((a) => [a.Id, a]));
  const recent = live
    .filter((c) => c.SignedDate && new Date(c.SignedDate) <= anchor && new Date(c.SignedDate) > addDays(anchor, -150))
    .sort((a, b) => a.SignedDate!.localeCompare(b.SignedDate!) || a.Id.localeCompare(b.Id));
  const onboardingProjects: OnboardingProject[] = [];
  const onboardingTasks: OnboardingTask[] = [];
  let taskN = 0;
  const anchorISO = iso(anchor);
  recent.forEach((c, i) => {
    const account = accounts.get(c.AccountId);
    const plan = onboardingPlan(account, new Date(`${c.SignedDate!.slice(0, 10)}T00:00:00Z`));
    const projectId = id("a0O", i + 1);
    const tasks: OnboardingTask[] = plan.tasks.map((t) => {
      // Tasks due before today are done a few days early (or late)
      const due = t.DueDate < anchorISO;
      const doneOn = iso(addDays(new Date(`${t.DueDate}T00:00:00Z`), int(`${projectId}:${t.Phase}:slip`, -4, 2)));
      return { Id: id("a0T", ++taskN), ProjectId: projectId, ...t, Done: due, CompletedDate: due ? (doneOn > anchorISO ? anchorISO : doneOn) : undefined };
    });
    const allDone = tasks.every((t) => t.Done);
    const anyDone = tasks.some((t) => t.Done);
    onboardingProjects.push({
      Id: projectId,
      Name: `${account?.Name ?? c.Name} onboarding`,
      ContractId: c.Id,
      AccountId: c.AccountId,
      OwnerId: c.OwnerId,
      Status: allDone ? "Live" : anyDone ? "In Progress" : plan.start > anchorISO ? "Not Started" : "In Progress",
      StartDate: plan.start,
      TargetGoLive: plan.target,
      GoLiveDate: allDone ? plan.target : undefined,
    });
    onboardingTasks.push(...tasks);
  });

  // One project At Risk: its most recent past-due task slipped
  const candidates = onboardingProjects.filter((p) => p.Status === "In Progress");
  const risky = candidates.find((p) => onboardingTasks.some((t) => t.ProjectId === p.Id && t.Done && t.Phase !== "Kickoff")) ?? candidates[0];
  if (risky) {
    risky.Status = "At Risk";
    const late = onboardingTasks.filter((t) => t.ProjectId === risky.Id && t.DueDate < anchorISO).pop();
    if (late) {
      late.Done = false;
      late.CompletedDate = undefined;
    }
  }

  return { onboardingProjects, onboardingTasks, healthSignals, supportTickets };
}
