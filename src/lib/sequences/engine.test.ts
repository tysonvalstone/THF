import { test } from "node:test";
import assert from "node:assert/strict";

import { SEED } from "@/data/seed";
import { PREBUILT_SEQUENCES } from "@/data/seed/sequences";
import { parseDate } from "@/lib/dates";
import type { Sequence, SequenceStep } from "@/lib/ai/types";
import type { Account } from "@/types/salesforce";
import { enrollmentFor, factsFor, mergeValues, pickVariant, renderTemplate, scheduleSequence, seasonPhaseFor, usesContactFields } from "./engine";

const base = SEED.accounts[0];
const acct = (patch: Partial<Account>): Account => ({ ...base, ...patch });
const iowaCorn = acct({ BillingState: "IA", BillingLatitude: 42, Primary_Commodities__c: ["Corn"], Segment__c: "Multi-Location Co-op", Region__c: "western-corn-belt" });
const sender = { name: "Dana Reyes" };

test("season phase follows the primary commodity's crop calendar", () => {
  assert.equal(seasonPhaseFor(iowaCorn, parseDate("2026-05-05")), "planting");
  assert.equal(seasonPhaseFor(iowaCorn, parseDate("2026-07-15")), "growing");
  assert.equal(seasonPhaseFor(iowaCorn, parseDate("2026-10-10")), "harvest");
  assert.equal(seasonPhaseFor(iowaCorn, parseDate("2026-12-10")), "post-harvest");
  assert.equal(seasonPhaseFor(iowaCorn, parseDate("2026-03-20")), "off-season");
  const ksWheat = acct({ BillingState: "KS", BillingLatitude: 38, Primary_Commodities__c: ["Winter Wheat"] });
  assert.equal(seasonPhaseFor(ksWheat, parseDate("2026-06-28")), "harvest");
  assert.equal(seasonPhaseFor(ksWheat, parseDate("2026-01-15")), "growing", "winter wheat is in the ground over winter");
});

test("merge values: contact, locations, fiscal year end, board meeting, missing fields", () => {
  const a = acct({ Number_of_Locations__c: 6, Fiscal_Year_End__c: "08-31", Board_Meeting_Months__c: [1, 4], BillingState: "IA", Region__c: "western-corn-belt", Primary_Commodities__c: ["Winter Wheat"] });
  const contact = SEED.contacts.find((c) => c.AccountId === base.Id)!;
  const v = mergeValues({ account: a, contact, sender, asOf: parseDate("2026-12-01"), data: SEED });
  assert.equal(v["contact.first_name"], contact.FirstName);
  assert.equal(v["account.locations"], "6 locations");
  assert.equal(v.fiscal_year_end, "August 31");
  assert.equal(v.next_board_meeting, "January 12");
  assert.equal(v.commodity, "wheat");
  assert.equal(v.region, "Western Corn Belt");
  assert.equal(v["sender.name"], "Dana Reyes");
  const none = mergeValues({ account: acct({ Board_Meeting_Months__c: [] }), sender, asOf: parseDate("2026-12-01"), data: SEED });
  assert.equal(none["contact.first_name"], null);
  assert.equal(none.next_board_meeting, null);
});

test("blackout end date is only set in or near a blackout", () => {
  const inHarvest = mergeValues({ account: iowaCorn, sender, asOf: parseDate("2026-09-29"), data: SEED });
  assert.ok(inHarvest.blackout_end_date?.startsWith("December") || inHarvest.blackout_end_date?.startsWith("November"));
  const winter = mergeValues({ account: iowaCorn, sender, asOf: parseDate("2026-01-15"), data: SEED });
  assert.equal(winter.blackout_end_date, null);
  const ethanol = mergeValues({ account: acct({ Segment__c: "Ethanol Plant" }), sender, asOf: parseDate("2026-09-29"), data: SEED });
  assert.equal(ethanol.blackout_end_date, null, "year-round segments have no blackout");
});

test("renderTemplate fills fields, keeps missing tokens and reports unknown ones", () => {
  const r = renderTemplate("Hi {{ contact.first_name }}, {{account.name}} {{nope}} {{next_board_meeting}}", {
    "contact.first_name": "Pat",
    "account.name": "Acme Co-op",
    next_board_meeting: null,
  });
  assert.equal(r.text, "Hi Pat, Acme Co-op {{nope}} {{next_board_meeting}}");
  assert.deepEqual(r.missing, ["next_board_meeting"]);
  assert.deepEqual(r.unknown, ["nope"]);
  assert.deepEqual(
    r.segments.filter((s) => s.field).map((s) => [s.field, !!s.missing]),
    [
      ["contact.first_name", false],
      ["account.name", false],
      ["next_board_meeting", true],
    ],
  );
});

test("pickVariant: first variant whose rules all match; commodity matches by substring", () => {
  const step: SequenceStep = {
    id: "s",
    type: "email",
    day: 1,
    body: "default",
    variants: [
      { id: "empty", name: "No rules", rules: [], body: "x" },
      { id: "late", name: "Late", rules: [{ field: "season_phase", op: "eq", value: "Harvest" }], body: "late" },
      { id: "wheat", name: "Wheat", rules: [{ field: "commodity", op: "eq", value: "wheat" }], body: "wheat" },
      { id: "not-ia", name: "Not IA", rules: [{ field: "state", op: "neq", value: "ia" }, { field: "region", op: "eq", value: "southern plains" }], body: "ks" },
    ],
  };
  const f = factsFor(iowaCorn, parseDate("2026-12-10"));
  assert.equal(pickVariant(step, f), null);
  assert.equal(pickVariant(step, factsFor(iowaCorn, parseDate("2026-10-10")))?.id, "late");
  assert.equal(pickVariant(step, { ...f, commodity: ["Corn", "Spring Wheat"] })?.id, "wheat");
  assert.equal(pickVariant(step, { ...f, state: "KS", region: { id: "southern-plains", name: "Southern Plains" } })?.id, "not-ia");
});

const seq: Sequence = {
  id: "t",
  name: "Test",
  steps: [
    { id: "a", type: "email", day: 1, subject: "Hi {{contact.first_name}}", body: "{{account.name}}", variants: [] },
    { id: "b", type: "call", day: 3, body: "Call", variants: [] },
    { id: "c", type: "email", day: 8, subject: "Next", body: "{{next_board_meeting}}", variants: [] },
  ],
};

test("schedule: weekends move to Monday; no blackout for year-round segments", () => {
  const eth = acct({ Segment__c: "Ethanol Plant" });
  const s = scheduleSequence(seq, eth, parseDate("2026-10-02")); // Friday
  assert.deepEqual(
    s.map((x) => x.date),
    ["2026-10-02", "2026-10-05", "2026-10-09"],
  );
  assert.ok(s.every((x) => !x.originalDate));
});

test("schedule: hard blackout moves every step and keeps spacing", () => {
  const s = scheduleSequence(seq, iowaCorn, parseDate("2026-09-29"));
  const first = s[0];
  assert.ok(first.originalDate === "2026-09-29" && first.reason === "Harvest blackout");
  assert.ok(first.date > "2026-11-26");
  const d = (x: string) => parseDate(x).getTime() / 86_400_000;
  assert.ok(d(s[1].date) - d(first.date) >= 2, "call keeps its 2-day gap");
  assert.ok(d(s[2].date) - d(s[1].date) >= 5, "last email keeps its 5-day gap");
  assert.ok(s.every((x) => x.originalDate && x.reason === "Harvest blackout"));
});

test("schedule: light blackout only moves calls", () => {
  const s = scheduleSequence(seq, iowaCorn, parseDate("2026-04-27"));
  assert.equal(s[0].originalDate, undefined, "email stays in spring planting");
  assert.equal(s[1].reason, "Spring planting blackout");
  assert.ok(s[1].date > "2026-06-05");
});

test("enrollment stores rendered text and variant ids; prebuilt sequences render with no unknown fields", () => {
  const coop = SEED.accounts.find((a) => a.Segment__c === "Multi-Location Co-op" && a.Board_Meeting_Months__c.length)!;
  const contact = SEED.contacts.find((c) => c.AccountId === coop.Id)!;
  const phc = PREBUILT_SEQUENCES.find((x) => x.id === "seq-post-harvest-coop")!;
  const e = enrollmentFor(phc, coop, contact, { sender, asOf: parseDate("2026-12-01"), data: SEED, enrolledBy: "005" });
  assert.equal(e.steps.length, phc.steps.length);
  assert.equal(e.contactId, contact.Id);
  assert.ok(e.steps[0].subject && !e.steps[0].subject.includes("{{"));
  assert.ok(e.steps[0].body.includes(contact.FirstName));
  for (const s of PREBUILT_SEQUENCES) {
    for (const st of s.steps) {
      for (const t of [st.subject ?? "", st.body, ...st.variants.flatMap((v) => [v.subject ?? "", v.body])]) {
        assert.deepEqual(renderTemplate(t, {}).unknown, [], `${s.id}/${st.id}`);
      }
    }
    assert.ok(usesContactFields(s));
  }
});
