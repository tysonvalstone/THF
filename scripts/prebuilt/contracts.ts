/**
 * Seed contracts, the clause library and contract clauses. One contract per
 * current customer ("Customer - Direct"): recent accepted quotes become the
 * contracts in flight (Draft, Legal Review, Sent for Signature, Signed);
 * older customers get an Active contract derived from their won business,
 * with end dates spread so renewal-notice and expiry alerts show up. Values
 * come from hash01 of each record's Id, never Math.random.
 */
import type { ApprovalRequest, Clause, Contract, ContractClause, ContractStatus, Quote } from "../../src/types/salesforce";
import type { DataSnapshot } from "../../src/lib/data/types";
import { CLAUSE_KEYS, CLAUSE_TEMPLATES, clauseSeedId } from "../../src/lib/contracts/library";
import type { SeedContext } from "./platform";
import { hash01 } from "./quoting";

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const addMonths = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
};
const parse = (s: string) => new Date(s.length <= 10 ? `${s}T00:00:00Z` : s);
const endFor = (start: string, term: number) => iso(addDays(addMonths(parse(start), term), -1));
const round2 = (n: number) => Math.round(n * 100) / 100;
const pick = <T>(arr: readonly T[], key: string): T => arr[Math.floor(hash01(key) * arr.length) % arr.length];
const at = (d: Date, hour: number) => `${iso(d)}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const LEGAL_APPROVER = "005Hs00000000001AA";

const contractId = (n: number) => `800Hs${String(n).padStart(10, "0")}AAC`;
const rowId = (n: number) => `a0CHs${String(n).padStart(10, "0")}AAC`;

/** Clause edits used for non-standard seed contracts */
const EDITS: Record<string, string> = {
  [CLAUSE_KEYS.liability]:
    "Except for breach of confidentiality, indemnification obligations or amounts owed for the Services, each party's total liability arising out of this Agreement is limited to the fees paid or payable by Customer in the twenty-four (24) months before the claim. The cap does not apply to ThiboLiSoft's breach of the data protection addendum. Neither party is liable for lost profits or indirect, incidental or consequential damages.",
  [CLAUSE_KEYS.sla]:
    "The hosted Services will be available 99.9% of each calendar month, excluding scheduled maintenance announced 72 hours in advance. No maintenance is performed from September 1 to December 15. During harvest phone support is available around the clock with a thirty-minute response target for scale-house outages, and Customer receives a 10% service credit for each 0.1% of missed availability.",
  [CLAUSE_KEYS.termCause]:
    "Either party may terminate this Agreement if the other party materially breaches it and does not cure the breach within sixty (60) days of written notice. On termination for ThiboLiSoft's uncured breach, ThiboLiSoft will refund prepaid fees and provide up to ninety (90) days of transition assistance at no charge.",
};

export function buildContracts(ctx: SeedContext): Pick<DataSnapshot, "contracts" | "contractClauses" | "clauses"> {
  const anchor = ctx.anchor;
  const today = iso(anchor);

  /* ------------------------------------------------ clause library */
  const clauses: Clause[] = CLAUSE_TEMPLATES.map((t, i) => {
    const version = t.IsActive ? 1 + Math.floor(hash01(`clause:${t.key}:v`) * 3) : 2;
    return {
      Id: clauseSeedId(t.key),
      Name: t.Name,
      Category: t.Category,
      Body: t.Body,
      IsActive: t.IsActive,
      IsDefault: t.IsDefault,
      Version: version,
      LastModifiedDate: at(addDays(anchor, -(40 + Math.floor(hash01(`clause:${t.key}:d`) * 400) + i)), 16),
    };
  });
  const byKey = new Map(CLAUSE_TEMPLATES.map((t, i) => [t.key, clauses[i]]));
  const defaults = clauses.filter((c) => c.IsDefault && c.IsActive);

  /* ------------------------------------------------ lookups */
  const recurringProduct = new Map(ctx.products.map((p) => [p.Id, p.Pricing_Unit__c !== "one-time"]));
  const isRec = (productId: string) => recurringProduct.get(productId) ?? true;
  const linesByOpp = new Map<string, typeof ctx.lineItems>();
  for (const l of ctx.lineItems) linesByOpp.set(l.OpportunityId, [...(linesByOpp.get(l.OpportunityId) ?? []), l]);
  const qLines = new Map<string, typeof ctx.quoteLineItems>();
  for (const l of ctx.quoteLineItems) qLines.set(l.QuoteId, [...(qLines.get(l.QuoteId) ?? []), l]);
  const accepted = new Map<string, Quote>();
  for (const q of [...ctx.quotes].sort((a, b) => (a.Accepted_Date__c ?? "").localeCompare(b.Accepted_Date__c ?? ""))) {
    if (q.Status === "Accepted") accepted.set(q.AccountId, q);
  }
  const buyer = (accountId: string) =>
    ctx.contacts.find((c) => c.AccountId === accountId && c.Buying_Role__c === "Economic Buyer") ?? ctx.contacts.find((c) => c.AccountId === accountId);

  const customers = ctx.accounts.filter((a) => a.Type === "Customer - Direct").sort((a, b) => a.Id.localeCompare(b.Id));

  type Draft = Omit<Contract, "Id" | "ContractNumber"> & { key: string; optional: string[]; edits: { key: string; status: ContractClause["ApprovalStatus"] }[] };
  const drafts: Draft[] = [];
  const inFlight: Draft[] = [];

  for (const a of customers) {
    const h = (k: string) => hash01(`${a.Id}:contract:${k}`);
    const coop = a.Segment__c === "Multi-Location Co-op";
    const seasonal = coop || a.Segment__c === "Country Elevator";
    const ccy = a.BillingCountry === "Canada" ? "CAD" : "USD";
    const won = ctx.opportunities.filter((o) => o.AccountId === a.Id && o.IsWon).sort((x, y) => y.CloseDate.localeCompare(x.CloseDate));
    const q = accepted.get(a.Id);
    const olderWon = won.filter((o) => o.Id !== q?.OpportunityId);
    // A few accepted quotes stay without a contract (ready for "Create contract")
    const useQuote = !!q && (h("quote") >= 0.2 || !olderWon.length);
    const signer = buyer(a.Id);
    const common = {
      AccountId: a.Id,
      OwnerId: a.OwnerId,
      AutoRenew: h("auto") < 0.82,
      NoticeDays: coop ? 90 : pick([60, 60, 90] as const, `${a.Id}:notice`),
      PriceIncreasePct: pick([3, 4, 5, 5] as const, `${a.Id}:pct`),
      PaymentTerms: (coop ? "Net 45" : "Net 30") as Contract["PaymentTerms"],
      CurrencyIsoCode: ccy as Contract["CurrencyIsoCode"],
      DPA: h("dpa") < 0.86,
      NonStandard: false,
      SignedByName: signer?.Name,
      SignedByTitle: signer?.Title,
      key: a.Id,
      optional: [
        ...(h("conv") < 0.3 ? [CLAUSE_KEYS.termConvenience] : []),
        ...(h("law") < 0.25 ? [CLAUSE_KEYS.law] : []),
        ...(h("conf") < 0.15 ? [CLAUSE_KEYS.confidentiality] : []),
      ],
      edits: [] as Draft["edits"],
    };

    if (useQuote && q) {
      const lines = qLines.get(q.Id) ?? [];
      const hd = (q.Discount__c ?? 0) / 100;
      const arr = round2(lines.filter((l) => isRec(l.Product2Id)).reduce((s, l) => s + l.TotalPrice, 0) * (1 - hd));
      const oneTime = round2(lines.filter((l) => !isRec(l.Product2Id)).reduce((s, l) => s + l.TotalPrice, 0));
      const term = q.Contract_Term_Months__c;
      const d: Draft = {
        ...common,
        Name: `${a.Name} · ${term}-month subscription`,
        OpportunityId: q.OpportunityId,
        QuoteId: q.Id,
        Status: "Signed",
        CreatedDate: at(addDays(parse(q.Accepted_Date__c ?? q.CreatedDate), 1), 15),
        StartDate: q.Start_Date__c,
        EndDate: endFor(q.Start_Date__c, term),
        TermMonths: term,
        AutoRenew: true,
        PaymentTerms: q.Payment_Terms__c,
        HarvestTerms: seasonal && h("harvest") < 0.35,
        BillingFrequency: q.Billing_Frequency__c,
        ARR: arr,
        OneTimeFees: oneTime,
        TCV: round2((arr * term) / 12 + oneTime),
      };
      if (q.Start_Date__c <= today) {
        d.Status = "Active";
        d.SentForSignatureDate = at(addDays(parse(q.Accepted_Date__c ?? q.CreatedDate), 2), 14);
        d.SignedDate = at(addDays(parse(q.Accepted_Date__c ?? q.CreatedDate), 4 + Math.floor(h("sign") * 5)), 17);
      } else inFlight.push(d);
      drafts.push(d);
      continue;
    }

    // Paper from the latest won deal: sent and signed a few days after it
    // closed, live from the first of a month; auto-renewing terms roll forward
    const base = olderWon[0];
    const baseLines = base ? (linesByOpp.get(base.Id) ?? []) : [];
    const term = coop ? 36 : pick([12, 24, 36, 36] as const, `${a.Id}:term`);
    let arr = 0;
    let oneTime = 0;
    if (baseLines.length) {
      arr = round2(baseLines.filter((l) => isRec(l.Product2Id)).reduce((s, l) => s + l.TotalPrice, 0));
      oneTime = round2(baseLines.filter((l) => !isRec(l.Product2Id)).reduce((s, l) => s + l.TotalPrice, 0));
    }
    if (!arr && base) arr = Math.max(4800, Math.round((base.Amount * 0.8) / 100) * 100);
    if (!arr) arr = Math.round((6000 + Math.max(1, a.Number_of_Locations__c) * 3200 + (a.Scales__c ?? 1) * 1500) / 100) * 100;
    const closed = base ? parse(base.CloseDate) : new Date(Math.min(addDays(parse(a.CreatedDate.slice(0, 10)), 30).getTime(), addDays(anchor, -400).getTime()));
    const sent = addDays(closed, 1 + Math.floor(h("sent") * 3));
    const signed = addDays(sent, 1 + Math.floor(h("sign") * 6));
    let startD = new Date(Date.UTC(signed.getUTCFullYear(), signed.getUTCMonth() + 1, 1));
    if (startD.getTime() - signed.getTime() < 14 * DAY) startD = addMonths(startD, 1);
    const start = iso(startD);
    let months: number = term;
    let autoRenew = common.AutoRenew;
    let status: ContractStatus = start <= today ? "Active" : "Signed";
    if (endFor(start, months) < today) {
      if (h("lapse") < 0.07) {
        autoRenew = false;
        status = "Expired";
      } else {
        autoRenew = true;
        while (endFor(start, months) < today) months += 12;
      }
    }
    drafts.push({
      ...common,
      AutoRenew: autoRenew,
      Name: `${a.Name} · ${term}-month subscription`,
      OpportunityId: base?.Id,
      Status: status,
      CreatedDate: at(closed, 16),
      StartDate: start,
      EndDate: endFor(start, months),
      TermMonths: months,
      HarvestTerms: seasonal && h("harvest") < 0.35,
      BillingFrequency: seasonal ? "Annual" : pick(["Annual", "Annual", "Annual", "Quarterly"] as const, `${a.Id}:bill`),
      ARR: arr,
      OneTimeFees: oneTime,
      TCV: round2((arr * months) / 12 + oneTime),
      SentForSignatureDate: at(sent, 14),
      SignedDate: at(signed, 18),
      edits: status === "Active" && h("edit") < 0.07 ? [{ key: pick([CLAUSE_KEYS.liability, CLAUSE_KEYS.sla, CLAUSE_KEYS.termCause], `${a.Id}:ek`), status: "Approved" }] : [],
    });
  }

  /* ------------------------------------------------ contracts in flight */
  inFlight.sort((x, y) => hash01(`${x.key}:flight`) - hash01(`${y.key}:flight`));
  inFlight.forEach((d, i) => {
    const floor = parse(d.CreatedDate).getTime();
    const notBefore = (dt: Date, days = 0) => new Date(Math.min(anchor.getTime(), Math.max(dt.getTime(), floor + days * DAY)));
    const created = (n: number) => at(notBefore(addDays(anchor, -n)), 15);
    d.SignedDate = undefined;
    d.SignedByName = undefined;
    d.SignedByTitle = undefined;
    d.SentForSignatureDate = undefined;
    if (i < 2) {
      d.Status = "Draft";
      d.CreatedDate = created(2 + i);
    } else if (i < 4) {
      d.Status = "Legal Review";
      d.CreatedDate = created(6 + i);
      d.edits = [{ key: i === 2 ? CLAUSE_KEYS.liability : CLAUSE_KEYS.sla, status: "Pending" }];
    } else if (i < 7) {
      d.Status = "Sent for Signature";
      const sent = i === 4 ? 21 : 3 + i;
      d.CreatedDate = created(sent + 4);
      d.SentForSignatureDate = at(notBefore(addDays(anchor, -sent), 1), 16);
    } else {
      const signed = 3 + Math.floor(hash01(`${d.key}:signed`) * 20);
      d.CreatedDate = created(signed + 12);
      d.SentForSignatureDate = at(notBefore(addDays(anchor, -(signed + 5)), 1), 16);
      d.SignedDate = at(notBefore(addDays(anchor, -signed), 3), 18);
      const s = buyer(d.AccountId);
      d.SignedByName = s?.Name;
      d.SignedByTitle = s?.Title;
    }
  });

  /* ------------------------------------------------ one terminated */
  const term = drafts.filter((d) => d.Status === "Active" && !d.QuoteId).sort((x, y) => hash01(`${x.key}:terminate`) - hash01(`${y.key}:terminate`))[0];
  if (term) {
    term.Status = "Terminated";
    term.TerminatedDate = iso(addDays(anchor, -40));
    term.AutoRenew = false;
  }

  /* ------------------------------------------------ records */
  drafts.sort((x, y) => x.CreatedDate.localeCompare(y.CreatedDate) || x.key.localeCompare(y.key));
  const contracts: Contract[] = [];
  const contractClauses: ContractClause[] = [];
  let rowN = 1;
  drafts.forEach((d, i) => {
    const id = contractId(i + 1);
    const { key, optional, edits, ...rest } = d;
    void key;
    const lib = defaults.filter((c) => (d.DPA || c.Id !== byKey.get(CLAUSE_KEYS.dpa)!.Id) && (d.AutoRenew || c.Id !== byKey.get(CLAUSE_KEYS.autoRenew)!.Id));
    if (d.HarvestTerms) lib.push(byKey.get(CLAUSE_KEYS.harvest)!);
    for (const k of optional) lib.push(byKey.get(k)!);
    lib.forEach((c, j) => {
      const edit = edits.find((e) => byKey.get(e.key)?.Id === c.Id);
      contractClauses.push({
        Id: rowId(rowN++),
        ContractId: id,
        ClauseId: c.Id,
        Name: c.Name,
        Category: c.Category,
        Body: edit ? EDITS[edit.key] : c.Body,
        Standard: !edit,
        ApprovalStatus: edit ? edit.status : "Not required",
        ...(edit?.status === "Approved" ? { ApprovedById: LEGAL_APPROVER } : {}),
        SortOrder: j + 1,
      });
    });
    const record: Contract = { ...rest, Id: id, ContractNumber: `CTR-${String(1001 + i).padStart(5, "0")}`, NonStandard: edits.length > 0 };
    for (const k of Object.keys(record) as (keyof Contract)[]) if (record[k] === undefined) delete record[k];
    contracts.push(record);
  });

  return { contracts, contractClauses, clauses };
}

/**
 * Pending approval requests for the seeded contracts in Legal Review (one
 * per contract, routed to Legal), for the platform seed's `approvals`.
 */
export function contractSeedApprovals(seed: Pick<DataSnapshot, "contracts" | "contractClauses">, ctx: Pick<SeedContext, "accounts" | "anchor">): ApprovalRequest[] {
  const names = new Map(ctx.accounts.map((a) => [a.Id, a.Name]));
  return seed.contracts
    .filter((c) => c.Status === "Legal Review")
    .map((c, i) => {
      const pending = seed.contractClauses.filter((r) => r.ContractId === c.Id && r.ApprovalStatus === "Pending");
      return {
        Id: `a0AHs${String(9001 + i).padStart(10, "0")}AAC`,
        Type: "Non-standard clause" as const,
        Object: "Contract" as const,
        RecordId: c.Id,
        RecordName: `${c.ContractNumber} · ${names.get(c.AccountId) ?? ""}`,
        ApproverRole: "legal" as const,
        Status: "Pending" as const,
        Detail: `Non-standard ${pending.length === 1 ? "clause" : "clauses"}: ${pending.map((r) => r.Name).join(", ")}`,
        RequestedById: c.OwnerId,
        RequestedDate: at(addDays(ctx.anchor, -(2 + i)), 16),
      };
    });
}
