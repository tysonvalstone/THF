import { expect, test, type Page } from "@playwright/test";

/**
 * Demo Mode end to end: guest sign-in → Start demo → Next through all 13
 * steps (skipping the call's streaming transcript) → key outcomes → Reset
 * Demo restores the seed. Guests are always in Demo Mode (mock data, their
 * own change log in this browser context), so nothing leaks out.
 */

const AS_OF_KEY = "harvest-signal:as-of:v1";
const LOG_KEY = "harvest-signal:mutations:demo:v1";
const DEMO_KEY = "harvest-signal:demo:v1";

interface Records {
  accountId?: string;
  opportunityId?: string;
  quoteId?: string;
  contractId?: string;
  invoiceId?: string;
  renewalId?: string;
}

test.describe.configure({ timeout: 360_000 });

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The walkthrough is exercised on desktop");
  // Start on the seed date; later reloads keep whatever the demo set
  await page.addInitScript(
    ([key, date]) => {
      try {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, date);
      } catch {
        // storage blocked
      }
    },
    [AS_OF_KEY, "2026-09-29"],
  );
  await page.goto("/?guest=1");
  await page.waitForURL((u) => !u.searchParams.has("guest"));
});

const logLength = (page: Page) => page.evaluate((k) => (JSON.parse(window.localStorage.getItem(k) ?? "[]") as unknown[]).length, LOG_KEY);
const records = (page: Page) => page.evaluate((k) => (JSON.parse(window.localStorage.getItem(k) ?? "null") as { records: Records } | null)?.records ?? {}, DEMO_KEY);

/** Change-log length once lifecycle automation has settled */
async function settledLogLength(page: Page): Promise<number> {
  let last = -1;
  for (let i = 0; i < 20; i++) {
    const n = await logLength(page);
    if (n === last) return n;
    last = n;
    await page.waitForTimeout(750);
  }
  return last;
}

test("guided walkthrough: 13 steps, real records, reset", async ({ page }) => {
  const bar = page.getByTestId("demo-bar");
  await expect(bar).toBeVisible();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  const baseline = await settledLogLength(page);

  const dock = page.getByTestId("demo-dock");
  const stepLabel = dock.locator("p").first();
  const caption = page.getByTestId("demo-caption");
  const main = page.locator("main");

  /** Next, then wait for the following view's actions to finish */
  async function next(expected?: string | RegExp) {
    const before = (await stepLabel.textContent()) ?? "";
    await page.getByTestId("demo-next").click();
    await expect(stepLabel).not.toHaveText(before, { timeout: 60_000 });
    await expect(caption).not.toHaveText("Working…", { timeout: 60_000 });
    await expect(caption).not.toContainText("Couldn't finish");
    if (expected) await expect(caption).toContainText(expected);
  }

  // 1. October 14: Home, Segments, Map
  await bar.getByRole("button", { name: "Start demo" }).click();
  await expect(dock).toBeVisible();
  await expect(caption).toContainText("October 14", { timeout: 60_000 });
  await next("Segment rankings");
  await expect(page).toHaveURL(/\/segments$/);
  await next("harvest band");

  // 2. New build → lead → account + contact
  await next("New Builds");
  await next("economic buyer");
  await expect(page).toHaveURL(/\/accounts\//);
  await expect(main).toContainText("Fort Dodge");

  // 3. Opportunity: open pipeline goes up
  await next("open pipeline goes up");
  await next("Qualification");

  // 4. Campaign + sequence
  await next("15 ethanol plant and feed mill contacts");
  await next("prebuilt sequence");
  await expect(page).toHaveURL(/tab=scheduled/);

  // 5. Call Desk: brief, simulated call (skipped ahead with Next), saved notes
  await next("pre-call brief");
  await expect(page.getByTestId("call-brief")).toBeVisible();
  await next("transcript streams");
  await expect(page.getByTestId("live-call")).toBeVisible();
  await expect(page.getByTestId("transcript").locator("li").first()).toBeVisible();
  await next("AI Notes saved");
  await expect(page.getByTestId("live-call")).toBeHidden();

  // 6. Quote: 12% off, auto-approved, sent
  await next("auto-approved");
  await expect(page).toHaveURL(/\/quotes\//);
  await expect(main).toContainText("Sent");

  // 7. Fast-forward 30 days: engagement, quote accepted, Closed Won
  await next("30 days later");
  await expect(page.locator('[data-demo="campaign-stats"]')).toContainText("opened");
  await next("accepted the quote");
  await expect(main).toContainText("Accepted");
  await next("rep donut");
  await next("recent-sales");

  // 8. Contract: Legal approves the clause, signed, first invoice
  await next("goes to Legal");
  await next("Viewing as Legal");
  await next("signed by");
  await expect(caption).toContainText("first invoice INV-");

  // 9. Finance: ARR up
  await next(/ARR up \$/);

  // 10. December 10: co-ops on top
  await next("December 10");
  await next("blackout has ended");

  // 11. Trip planner
  await next("Iowa in January");
  await expect(page).toHaveURL(/\/map\?trip=/);
  await expect(main).toContainText("stops");

  // 12. Renewal and expansion
  await next("renewal opportunity opened automatically");
  await next("expansion");
  await next("remaining locations");

  // 13. Board Report PDF
  const download = page.waitForEvent("download", { timeout: 60_000 });
  await next("Board Report PDF downloaded");
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/i);
  await expect(page).toHaveURL(/\/finance$/);
  await page.getByTestId("demo-next").click();
  await expect(caption).toHaveText("Demo complete.");

  // Outcomes, record by record
  const r = await records(page);
  expect(r.accountId && r.opportunityId && r.quoteId && r.contractId && r.invoiceId && r.renewalId).toBeTruthy();
  await page.goto(`/opportunities/${r.opportunityId}`);
  await expect(main).toContainText("Closed Won");
  await page.goto(`/quotes/${r.quoteId}`);
  await expect(main).toContainText("Accepted");
  await page.goto(`/contracts/${r.contractId}`);
  await expect(main).toContainText(/Active|Signed/);
  const invoiceNumber = await page.evaluate(
    ([k, id]) => (JSON.parse(window.localStorage.getItem(k!) ?? "[]") as { op: string; object: string; record?: { Id: string; InvoiceNumber: string } }[]).find((m) => m.op === "create" && m.object === "Invoice" && m.record?.Id === id)?.record?.InvoiceNumber,
    [LOG_KEY, r.invoiceId],
  );
  expect(invoiceNumber).toMatch(/^INV-/);
  await page.goto(`/opportunities/${r.renewalId}`);
  await expect(main).toContainText("Renewal:");

  // Activity feed lists the demo, newest first
  await bar.getByRole("button", { name: "Activity" }).click();
  const feed = page.getByTestId("demo-activity");
  await expect(feed).toContainText("Board Report downloaded");
  await feed.getByPlaceholder("Search activity").fill("Fast-forwarded 30 days");
  await expect(feed).toContainText(/Fast-forwarded 30 days · \d+ opens?/);
  await page.keyboard.press("Escape");

  // Reset Demo restores the seed
  await bar.getByRole("button", { name: "Reset Demo" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset Demo" }).click();
  await expect(page.getByText("Demo reset to the seed data")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(await settledLogLength(page)).toBe(baseline);
  expect(await page.evaluate((k) => window.localStorage.getItem(k), DEMO_KEY)).toBeNull();
  expect(await page.evaluate((k) => window.localStorage.getItem(k), AS_OF_KEY)).toBe("2026-09-29");
  await page.goto(`/opportunities/${r.opportunityId}`);
  await expect(main).toContainText("Opportunity not found");
});
