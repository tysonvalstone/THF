import { expect, test, type Page } from "@playwright/test";

/**
 * Call Desk end to end: schedule a call → open the brief → start a simulated
 * call → end it → review AI Notes → save → the next brief for the account
 * shows the new notes. Guest sign-in (Demo Mode, mock data); every change
 * lives in this browser context's local change log, so nothing leaks out.
 */

const ACCOUNT = "Homestead Grain";
const APP_DATE = "2026-09-29";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((date) => {
    try {
      window.localStorage.setItem("harvest-signal:as-of:v1", date);
    } catch {
      // storage blocked
    }
  }, APP_DATE);
  await page.goto("/?guest=1");
  await page.waitForURL((u) => !u.searchParams.has("guest"));
});

async function scheduleCall(page: Page, opts: { type: string; date: string; time: string }) {
  await page.getByRole("button", { name: "Schedule call" }).first().click();
  await page.getByPlaceholder("Search accounts").fill(ACCOUNT);
  await page.getByRole("option", { name: new RegExp(ACCOUNT) }).first().click();
  const drawer = page.getByRole("dialog").filter({ has: page.getByText("Schedule call", { exact: true }) });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("Call type").selectOption(opts.type);
  await drawer.getByLabel("Date").fill(opts.date);
  await drawer.getByLabel("Time").selectOption(opts.time);
  await drawer.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByTestId("call-subject")).toHaveText(`${opts.type}: ${ACCOUNT}`);
}

test("schedule, brief, simulated call, AI Notes, save, next brief", async ({ page }) => {
  await page.goto("/call-desk");
  await expect(page.getByTestId("agenda")).toBeVisible();

  // 1. Schedule a call and open its brief
  await scheduleCall(page, { type: "Discovery", date: APP_DATE, time: "16:30" });
  const brief = page.getByTestId("call-brief");
  await expect(brief.getByRole("region", { name: "Snapshot" })).toContainText(ACCOUNT);
  await expect(brief.getByRole("region", { name: "Who's on the call" })).toBeVisible();
  const questions = brief.getByRole("region", { name: "Questions to ask" }).getByRole("checkbox");
  expect(await questions.count()).toBeGreaterThanOrEqual(5);
  await expect(brief.getByRole("region", { name: "Risks" })).toBeVisible();

  // 2. Start a simulated call
  await page.getByRole("button", { name: "Start call" }).click();
  const live = page.getByTestId("live-call");
  await expect(live).toBeVisible();
  await live.getByRole("button", { name: "Start", exact: true }).click();
  await expect(live.getByText("Transcribing (simulated)")).toBeVisible();
  await expect(live.getByTestId("transcript").locator("li").nth(1)).toBeVisible();
  await live.getByRole("region", { name: "Questions to ask" }).getByRole("checkbox").first().check();
  await live.getByRole("textbox", { name: "My notes" }).fill("Positive call, interested in a proposal\nSend kiosk video to the controller");
  await live.getByRole("button", { name: "Skip ahead" }).click();

  // 3. End the call and review AI Notes
  await live.getByRole("button", { name: "End call" }).click();
  const review = page.getByTestId("notes-review");
  await expect(review).toBeVisible();
  await expect(review.getByRole("textbox", { name: "Summary", exact: true })).toHaveValue(/Discovery call with/);
  const steps = review.getByRole("textbox", { name: "Action item" });
  expect(await steps.count()).toBeGreaterThanOrEqual(2);
  await expect(steps.last()).toHaveValue("Send kiosk video to the controller");
  const eb = review.getByTestId("suggested-updates").getByRole("checkbox").first();
  if (await eb.isEnabled()) await eb.check();

  // 4. Save to the account
  await review.getByRole("button", { name: "Save to account" }).click();
  await expect(live).toBeHidden();
  await expect(page.getByTestId("call-detail")).toContainText("Discovery call with");
  await expect(page.getByTestId("agenda").getByRole("button", { name: new RegExp(`4:30 PM.*${ACCOUNT}`) })).toContainText("Notes saved");

  // 5. The next brief for the account includes the new notes and commitments
  await scheduleCall(page, { type: "Follow-up", date: "2026-10-01", time: "09:00" });
  await expect(page.getByTestId("agenda-date")).toContainText("Oct 1");
  const last = page.getByTestId("call-brief").getByRole("region", { name: "Last time" });
  await expect(last).toContainText("Discovery call with");
  await expect(last).toContainText("Send kiosk video to the controller");
  await expect(last).toContainText("Answered:");
});
