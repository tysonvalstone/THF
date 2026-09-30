/**
 * Harvest Day share links for exports that need them synchronously (the
 * campaign mail-list CSV). Links are signed by the server, so this keeps a
 * per-session cache: `harvestLinkSync(id)` returns the cached link or "" and
 * queues the id; queued ids are signed in one batched POST a moment later.
 * Building the recipient list (recipientFor) queues every recipient, so by
 * the time the CSV is exported the links are there.
 */
const cache = new Map<string, string>();
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let waiters: (() => void)[] = [];

async function flush() {
  timer = null;
  const ids = [...pending];
  const done = waiters;
  pending.clear();
  waiters = [];
  try {
    if (ids.length) {
      const res = await fetch("/api/share/harvest-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountIds: ids }),
      });
      if (res.ok) {
        const { urls } = (await res.json()) as { urls?: Record<string, string> };
        for (const [id, url] of Object.entries(urls ?? {})) cache.set(id, url);
      }
    }
  } catch {
    // offline or signed out: links stay blank
  }
  done.forEach((r) => r());
}

/** Queues ids for signing (browser only); resolves when their batch is done */
export function prefetchHarvestLinks(ids: string[]): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  let added = false;
  for (const id of ids)
    if (id && !cache.has(id) && !pending.has(id)) {
      pending.add(id);
      added = true;
    }
  if (!added) return Promise.resolve();
  return new Promise<void>((resolve) => {
    waiters.push(resolve);
    timer ??= setTimeout(() => void flush(), 30);
  });
}

/** The signed link if already fetched, else "" (and the id is queued) */
export function harvestLinkSync(accountId: string): string {
  const hit = cache.get(accountId);
  if (hit) return hit;
  void prefetchHarvestLinks([accountId]);
  return "";
}
