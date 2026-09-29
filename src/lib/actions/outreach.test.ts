import { test } from "node:test";
import assert from "node:assert/strict";

import { SEED } from "@/data/seed";
import { applyMutations } from "@/lib/data/local-repository";
import { parseDate } from "@/lib/dates";
import { addToCampaign, createCampaign, logCall, sendEmail } from "./outreach";
import { templateCampaignContent } from "@/lib/content/templates";

const asOf = parseDate("2026-09-29");
const ctx = { data: SEED, asOf, userId: "005Hs00000000001AA" };
const prospectWithoutOpp = SEED.accounts.find((a) => a.Type === "Prospect" && !SEED.opportunities.some((o) => o.AccountId === a.Id))!;
const openOpp = SEED.opportunities.find((o) => !o.IsClosed && o.StageName === "Prospecting")!;

test("sending an email logs it, creates a follow-up and updates the deal's next step", () => {
  const r = sendEmail(ctx, { targetId: openOpp.AccountId, toEmail: "x@y.com", subject: "Harvest readiness", body: "Hi" });
  const tasks = r.mutations.filter((m) => m.op === "create" && m.object === "Task");
  assert.equal(tasks.length, 2);
  assert.ok(r.mutations.some((m) => m.op === "update" && m.object === "Opportunity" && m.id === openOpp.Id));
});

test("booking a demo on an account without a deal creates an opportunity and an event", () => {
  const r = logCall(ctx, { targetId: prospectWithoutOpp.Id, outcome: "Interested - Book Demo", notes: "" });
  const after = applyMutations(SEED, r.mutations);
  const opp = after.opportunities.find((o) => o.AccountId === prospectWithoutOpp.Id);
  assert.ok(opp, "opportunity created");
  assert.equal(opp!.StageName, "Prospecting", "no economic buyer on the call, so it stays in Prospecting");
  assert.ok(after.lineItems.some((l) => l.OpportunityId === opp!.Id));
  assert.ok(after.events.some((e) => e.AccountId === prospectWithoutOpp.Id && e.Type === "Demo"));
});

test("a connected call only leaves Prospecting once the economic buyer is identified", () => {
  const blocked = logCall(ctx, { targetId: openOpp.AccountId, outcome: "Connected", notes: "Good call" });
  const unchanged = applyMutations(SEED, blocked.mutations).opportunities.find((o) => o.Id === openOpp.Id)!;
  if (!openOpp.Economic_Buyer_Identified__c) assert.equal(unchanged.StageName, "Prospecting");
  const eb = SEED.contacts.find((c) => c.AccountId === openOpp.AccountId && c.Buying_Role__c === "Economic Buyer");
  if (eb) {
    const r = logCall(ctx, { targetId: openOpp.AccountId, whoId: eb.Id, outcome: "Connected", notes: "Spoke with the controller" });
    const after = applyMutations(SEED, r.mutations).opportunities.find((o) => o.Id === openOpp.Id)!;
    assert.equal(after.StageName, "Qualification");
    assert.equal(after.Economic_Buyer_Identified__c, true);
  }
});

test("touching an open lead moves it to Working - Contacted", () => {
  const lead = SEED.leads.find((l) => l.Status === "Open - Not Contacted")!;
  const r = logCall(ctx, { targetId: lead.Id, whoId: lead.Id, outcome: "Left Voicemail", notes: "" });
  const after = applyMutations(SEED, r.mutations);
  assert.equal(after.leads.find((l) => l.Id === lead.Id)!.Status, "Working - Contacted");
});

test("creating a campaign writes the campaign, members and scheduled tasks; re-adding is idempotent", () => {
  const members = SEED.accounts.slice(0, 3).map((a) => ({ targetId: a.Id }));
  const { result, campaignId } = createCampaign(ctx, {
    name: "Test",
    type: "Direct Mail",
    startDate: "2026-10-05",
    endDate: "2026-11-15",
    budget: 1000,
    season: "Year-end",
    regions: ["western-corn-belt"],
    facilityTypes: ["Grain Elevator"],
    description: "",
    content: templateCampaignContent({ play: "Year-end", regionIds: ["western-corn-belt"], facilityTypes: ["Grain Elevator"], asOf, sender: { name: "A", title: "B", email: "c" } }),
    expectedRevenue: 0,
    members,
  });
  const after = applyMutations(SEED, result.mutations);
  assert.equal(after.campaignMembers.filter((m) => m.CampaignId === campaignId).length, 3);
  assert.equal(after.tasks.filter((t) => t.WhatId === campaignId).length, 3);
  const again = addToCampaign({ ...ctx, data: after }, { campaignId, members });
  assert.equal(again.mutations.filter((m) => m.object === "CampaignMember").length, 0);
});
