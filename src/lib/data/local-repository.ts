import { COLLECTION, type DataSnapshot, type Mutation, type SalesRepository } from "./types";

const STORAGE_KEY = "harvest-signal:mutations:v2";

function readLog(key: string): Mutation[] {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Mutation[]) : [];
  } catch {
    return [];
  }
}

function writeLog(key: string, log: Mutation[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(log));
  } catch {
    // Storage full or blocked: changes still live in memory for this session.
  }
}

export function applyMutations(base: DataSnapshot, mutations: Mutation[]): DataSnapshot {
  if (!mutations.length) return base;
  const next = { ...base } as Record<keyof DataSnapshot, { Id: string }[]>;
  const touched = new Set<keyof DataSnapshot>();
  for (const m of mutations) {
    const key = COLLECTION[m.object];
    if (!touched.has(key)) {
      next[key] = [...next[key]];
      touched.add(key);
    }
    const list = next[key];
    if (m.op === "create") {
      if (!list.some((r) => r.Id === m.record.Id)) list.push(m.record);
    } else if (m.op === "delete") {
      const i = list.findIndex((r) => r.Id === m.id);
      if (i >= 0) list.splice(i, 1);
    } else {
      const i = list.findIndex((r) => r.Id === m.id);
      if (i >= 0) list[i] = { ...list[i], ...m.changes };
    }
  }
  return next as unknown as DataSnapshot;
}

/** Server snapshot (mock seed or live Salesforce) + a mutation log in localStorage. */
export function createLocalRepository(base: DataSnapshot, storageKey = STORAGE_KEY): SalesRepository {
  let log = typeof window === "undefined" ? [] : readLog(storageKey);
  let snapshot = applyMutations(base, log);
  return {
    load: () => snapshot,
    commit(mutations) {
      log = [...log, ...mutations];
      writeLog(storageKey, log);
      snapshot = applyMutations(snapshot, mutations);
      return snapshot;
    },
    reset() {
      log = [];
      writeLog(storageKey, log);
      snapshot = base;
      return snapshot;
    },
    undo(count) {
      log = log.slice(0, Math.max(0, log.length - count));
      writeLog(storageKey, log);
      snapshot = applyMutations(base, log);
      return snapshot;
    },
    log: () => log,
    pendingChanges: () => log.length,
  };
}

const PREFIX: Record<string, string> = {
  Account: "001",
  Contact: "003",
  Lead: "00Q",
  Opportunity: "006",
  OpportunityLineItem: "00k",
  Campaign: "701",
  CampaignMember: "00v",
  Task: "00T",
  Event: "00U",
  ProductType: "a0P",
  Product2: "01t",
  Pricebook2: "01s",
  PricebookEntry: "01u",
  Quote: "0Q0",
  QuoteLineItem: "0QL",
  NewBuild: "a0N",
  Contract: "800",
  ContractClause: "a0C",
  Clause: "a0L",
  Invoice: "a0I",
  Payment: "a0Y",
  OnboardingProject: "a0O",
  OnboardingTask: "a0T",
  HealthSignal: "a0H",
  SupportTicket: "500",
  Quota: "a0Q",
  CommissionPlan: "a0K",
  ApprovalRequest: "a0A",
  AuditEntry: "a0Z",
  Call: "a0D",
};
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** New Salesforce-style Id for a locally created record */
export function newId(object: keyof typeof PREFIX): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (b) => B62[b % 62]).join("");
  return `${PREFIX[object]}Lc${body}AAA`.slice(0, 18);
}
