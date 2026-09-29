import { SEED } from "@/data/seed";
import { COLLECTION, type DataSnapshot, type Mutation, type SalesRepository } from "./types";

const STORAGE_KEY = "harvest-signal:mutations:v1";

function readLog(): Mutation[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Mutation[]) : [];
  } catch {
    return [];
  }
}

function writeLog(log: Mutation[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
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
    } else {
      const i = list.findIndex((r) => r.Id === m.id);
      if (i >= 0) list[i] = { ...list[i], ...m.changes };
    }
  }
  return next as unknown as DataSnapshot;
}

/** Seed data + a mutation log in localStorage. */
export function createLocalRepository(): SalesRepository {
  let log = typeof window === "undefined" ? [] : readLog();
  let snapshot = applyMutations(SEED, log);
  return {
    load: () => snapshot,
    commit(mutations) {
      log = [...log, ...mutations];
      writeLog(log);
      snapshot = applyMutations(snapshot, mutations);
      return snapshot;
    },
    reset() {
      log = [];
      writeLog(log);
      snapshot = SEED;
      return snapshot;
    },
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
};
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** New Salesforce-style Id for a locally created record */
export function newId(object: keyof typeof PREFIX): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (b) => B62[b % 62]).join("");
  return `${PREFIX[object]}Lc${body}AAA`.slice(0, 18);
}
