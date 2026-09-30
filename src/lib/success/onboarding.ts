/**
 * Onboarding projects: a checklist (Kickoff → Data migration → Configuration
 * → Training → Go-live) for each signed contract, with dates worked back from
 * a target go-live that lands before the customer's next spring planting.
 * Contracts signed in the fall start after harvest. Pure: returns mutations.
 */
import type { DataSnapshot, Mutation } from "@/lib/data/types";
import { newId } from "@/lib/data/local-repository";
import type { Account, Contract, OnboardingProject, OnboardingTask } from "@/types/salesforce";
import { addDays, diffDays, parseDate, toISODate } from "@/lib/dates";
import { blackoutsFor, blackoutStatus, harvestWindowFor, isSeasonalSegment } from "@/lib/seasonality";

export type OnboardingPhase = OnboardingTask["Phase"];
export type OnboardingStatus = OnboardingProject["Status"];
export const ONBOARDING_PHASES: OnboardingPhase[] = ["Kickoff", "Data migration", "Configuration", "Training", "Go-live"];
export const ONBOARDING_STATUSES: OnboardingStatus[] = ["Not Started", "In Progress", "At Risk", "Live"];

/** Shortest project, work start to go-live */
export const MIN_LEAD_DAYS = 75;
/** Go live this many days before planting starts */
export const PLANTING_BUFFER_DAYS = 14;
/** …or this many before harvest starts (when spring is too close) */
export const HARVEST_BUFFER_DAYS = 21;
/** Signed this close to harvest: start after harvest instead */
export const PRE_HARVEST_DAYS = 21;

/** Due date of each phase: days after work start (Kickoff) or before go-live (the rest) */
export const PHASE_OFFSETS: Record<OnboardingPhase, { from: "start" | "golive"; days: number }> = {
  Kickoff: { from: "start", days: 7 },
  "Data migration": { from: "golive", days: 60 },
  Configuration: { from: "golive", days: 35 },
  Training: { from: "golive", days: 14 },
  "Go-live": { from: "golive", days: 0 },
};

type SeasonalAccount = Pick<Account, "Segment__c" | "BillingLatitude" | "BillingCountry">;

/** Work starts on signing, or after harvest when signed during (or just before) harvest */
export function workStartFor(account: SeasonalAccount | undefined, signed: Date): Date {
  if (!account || !isSeasonalSegment(account.Segment__c)) return signed;
  const s = blackoutStatus(account, signed);
  if (s.status === "hard" && s.resumeDate) return s.resumeDate;
  const harvest = harvestWindowFor(account, signed.getUTCFullYear());
  if (harvest && signed < harvest.start && diffDays(harvest.start, signed) <= PRE_HARVEST_DAYS) {
    return blackoutStatus(account, harvest.start).resumeDate ?? addDays(harvest.end, 1);
  }
  return signed;
}

/**
 * Target go-live: the first "planting start − 14 days" at least 75 days after
 * work starts; when spring is too close, before harvest instead. Year-round
 * segments: the first of the month at least 90 days out.
 */
export function targetGoLiveFor(account: SeasonalAccount | undefined, workStart: Date): Date {
  const earliest = addDays(workStart, MIN_LEAD_DAYS);
  if (!account || !isSeasonalSegment(account.Segment__c)) {
    const d = addDays(workStart, 90);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + (d.getUTCDate() > 1 ? 1 : 0), 1));
  }
  const y = workStart.getUTCFullYear();
  for (const yr of [y, y + 1, y + 2]) {
    const [planting, harvest] = blackoutsFor(account, yr);
    const beforePlanting = addDays(planting.start, -PLANTING_BUFFER_DAYS);
    if (beforePlanting >= earliest) return beforePlanting;
    const beforeHarvest = addDays(harvest.start, -HARVEST_BUFFER_DAYS);
    if (beforeHarvest >= earliest) return beforeHarvest;
  }
  return earliest;
}

export interface OnboardingPlan {
  start: string;
  target: string;
  tasks: { Name: string; Phase: OnboardingPhase; DueDate: string; SortOrder: number }[];
}

const TASK_NAMES: Record<OnboardingPhase, string> = {
  Kickoff: "Kickoff call and project plan",
  "Data migration": "Migrate customers, contracts and open tickets",
  Configuration: "Configure locations, commodities and scale tickets",
  Training: "Train scale house, office and merchandising staff",
  "Go-live": "Go live and cut over from the old system",
};

/** Dates for a new project; due dates stay in order and never pass go-live */
export function onboardingPlan(account: SeasonalAccount | undefined, signed: Date): OnboardingPlan {
  const start = workStartFor(account, signed);
  const target = targetGoLiveFor(account, start);
  let prev = start;
  const tasks = ONBOARDING_PHASES.map((phase, i) => {
    const o = PHASE_OFFSETS[phase];
    let due = o.from === "start" ? addDays(start, o.days) : addDays(target, -o.days);
    if (due < prev) due = prev;
    if (due > target) due = target;
    prev = due;
    return { Name: TASK_NAMES[phase], Phase: phase, DueDate: toISODate(due), SortOrder: (i + 1) * 10 };
  });
  return { start: toISODate(start), target: toISODate(target), tasks };
}

/**
 * Project + checklist for a newly signed contract (none if the contract
 * already has a project). Owner: the contract owner.
 */
export function onboardingForContractMutations(ctx: { data: DataSnapshot; asOf: Date; userId: string }, contract: Contract): Mutation[] {
  if (ctx.data.onboardingProjects.some((p) => p.ContractId === contract.Id)) return [];
  const account = ctx.data.accounts.find((a) => a.Id === contract.AccountId);
  const signed = contract.SignedDate ? parseDate(contract.SignedDate.slice(0, 10)) : ctx.asOf;
  const plan = onboardingPlan(account, signed > ctx.asOf ? signed : ctx.asOf);
  const projectId = newId("OnboardingProject");
  const project: OnboardingProject = {
    Id: projectId,
    Name: `${account?.Name ?? contract.Name} onboarding`,
    ContractId: contract.Id,
    AccountId: contract.AccountId,
    OwnerId: contract.OwnerId || ctx.userId,
    Status: "Not Started",
    StartDate: plan.start,
    TargetGoLive: plan.target,
  };
  return [
    { op: "create", object: "OnboardingProject", record: project },
    ...plan.tasks.map((t): Mutation => ({ op: "create", object: "OnboardingTask", record: { Id: newId("OnboardingTask"), ProjectId: projectId, Done: false, ...t } })),
  ];
}

export interface ProjectProgress {
  total: number;
  done: number;
  pct: number;
  nextTask?: OnboardingTask;
  overdue: number;
  daysToGoLive: number;
}

export function projectTasks(data: Pick<DataSnapshot, "onboardingTasks">, projectId: string): OnboardingTask[] {
  return data.onboardingTasks.filter((t) => t.ProjectId === projectId).sort((a, b) => a.SortOrder - b.SortOrder || a.DueDate.localeCompare(b.DueDate));
}

export function projectProgress(project: OnboardingProject, tasks: OnboardingTask[], asOf: Date): ProjectProgress {
  const done = tasks.filter((t) => t.Done).length;
  const open = tasks.filter((t) => !t.Done);
  const live = project.Status === "Live";
  return {
    total: tasks.length,
    done,
    pct: live ? 100 : tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    nextTask: live ? undefined : open[0],
    overdue: live ? 0 : open.filter((t) => parseDate(t.DueDate) < asOf).length,
    daysToGoLive: diffDays(parseDate(project.TargetGoLive), asOf),
  };
}

/** Status after a checklist change: In Progress once anything is done (At Risk and Live are kept) */
export function statusAfterTaskChange(project: OnboardingProject, tasksAfter: OnboardingTask[]): OnboardingStatus {
  if (project.Status === "Live" || project.Status === "At Risk") return project.Status;
  return tasksAfter.some((t) => t.Done) ? "In Progress" : project.Status;
}

/** Check a task off (or back on), moving the project to In Progress when work starts */
export function toggleTaskMutations(data: Pick<DataSnapshot, "onboardingProjects" | "onboardingTasks">, taskId: string, done: boolean, asOf: Date): Mutation[] {
  const task = data.onboardingTasks.find((t) => t.Id === taskId);
  const project = task && data.onboardingProjects.find((p) => p.Id === task.ProjectId);
  if (!task || !project) return [];
  const out: Mutation[] = [{ op: "update", object: "OnboardingTask", id: taskId, changes: { Done: done, CompletedDate: done ? toISODate(asOf) : undefined } }];
  const after = projectTasks(data, project.Id).map((t) => (t.Id === taskId ? { ...t, Done: done } : t));
  const status = statusAfterTaskChange(project, after);
  if (status !== project.Status) out.push({ op: "update", object: "OnboardingProject", id: project.Id, changes: { Status: status } });
  return out;
}

/** Mark a project Live today: every open task done, go-live date set */
export function markLiveMutations(data: Pick<DataSnapshot, "onboardingTasks">, project: OnboardingProject, asOf: Date): Mutation[] {
  const today = toISODate(asOf);
  return [
    ...projectTasks(data, project.Id)
      .filter((t) => !t.Done)
      .map((t): Mutation => ({ op: "update", object: "OnboardingTask", id: t.Id, changes: { Done: true, CompletedDate: today } })),
    { op: "update", object: "OnboardingProject", id: project.Id, changes: { Status: "Live", GoLiveDate: today } },
  ];
}
