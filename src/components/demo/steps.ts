/**
 * The Demo Mode walkthrough: 13 steps, each made of one or more views. A view
 * may run real actions (through the same helpers and CRUD path as the UI),
 * then the walkthrough navigates to its page, shows its one-line caption and
 * highlights the element that changed. Every action checks the ids it
 * created earlier (demo state), so Back then Next never duplicates records.
 */
import type { AppRole } from "@/lib/supabase/config";
import type { Mutation } from "@/lib/data/types";
import type { Sender } from "@/lib/content/templates";
import type { DemoCtx } from "@/lib/demo/scenario";
import { emitDemo, type DemoLink, type DemoRecords } from "@/lib/demo/state";
import type { SimCounts } from "@/lib/demo/simulate";
import { PREBUILT_SEQUENCES } from "@/data/seed/sequences";
import { arrAt } from "@/lib/finance/metrics";
import { fmtMoney } from "@/lib/format";
import { fmtDate } from "@/lib/dates";
import {
  acceptAndWin,
  buildDemoQuote,
  campaignRecipients,
  convertNewBuild,
  createDemoCampaign,
  createDemoContract,
  createDemoOpportunity,
  DEMO_DATES,
  DEMO_SEQUENCE_ID,
  DEMO_TRIP_REQUEST,
  demoExpansion,
  demoRenewals,
  enrollRecipients,
  findDemoNewBuild,
  finishDemoCall,
  harvestTermsContract,
  harvestTermsDemo,
  legalApproveClause,
  renewalCheckDate,
  renewalFor,
  requestClauseChange,
  scheduleDemoCall,
  signDemoContract,
} from "@/lib/demo/scenario";

/** What a highlight points at: a CSS selector, or a heading / table row by its text */
export type DemoTarget = { selector: string } | { heading: string } | { row: string };

export interface StepApi {
  /** Latest data, date and acting user (optionally as another role) */
  ctx(role?: AppRole): DemoCtx;
  /** Commit through useCrud().run (toast, highlight, audit), then wait for the re-render */
  run(mutations: Mutation[], message?: string): Promise<void>;
  setDate(iso: string): Promise<void>;
  setRole(role: AppRole): Promise<void>;
  go(href: string): Promise<void>;
  records(): DemoRecords;
  patch(p: Partial<DemoRecords>): void;
  log(text: string, links?: DemoLink[]): void;
  /** Move the date forward with simulated activity (the "Fast-forward" button) */
  fastForwardTo(iso: string): Promise<SimCounts | null>;
  /** Wait until `check` passes (or the timeout ends); returns the last result */
  waitFor<T>(check: () => T | undefined | null | false, ms?: number): Promise<T | undefined>;
  rankedIds(): string[];
  sender(): Sender;
  saveEnrollments(list: import("@/lib/ai/types").Enrollment[]): void;
  signature(name: string): string;
  boardReport(): Promise<string>;
  asOfISO(): string;
}

export interface DemoView {
  /** Real actions for this view (runs when the view is entered) */
  run?: (api: StepApi) => Promise<void>;
  /** Navigate before running (so on-page KPIs flash the change) */
  navFirst?: boolean;
  href: (r: DemoRecords) => string;
  caption: (r: DemoRecords, api: StepApi) => string;
  highlight?: DemoTarget | ((r: DemoRecords) => DemoTarget | undefined);
  /** Auto-play waits for this signal (the live call) instead of a timer */
  waitsForCall?: boolean;
}

export interface DemoStep {
  id: string;
  title: string;
  views: DemoView[];
}

const has = <T extends { Id: string }>(list: T[], id: string | undefined) => !!id && list.some((x) => x.Id === id);
const link = (label: string, href: string): DemoLink => ({ label, href });

export const DEMO_STEPS: DemoStep[] = [
  {
    id: "october",
    title: "October: harvest",
    views: [
      {
        run: async (api) => {
          await api.setDate(DEMO_DATES.october);
          api.log(`Date set to ${fmtDate(DEMO_DATES.october)}`);
        },
        href: () => "/",
        caption: () => "October 14, harvest: year-round ethanol plants and feed mills rise to the top; elevators are in blackout.",
        highlight: { selector: 'section[aria-label="Focus this month"]' },
      },
      {
        href: () => "/segments",
        caption: () => "Segment rankings for deals started in October: ethanol plants and feed mills close best.",
        highlight: { selector: 'section[aria-label="Ranked segments"]' },
      },
      {
        href: () => "/map",
        caption: () => "The map shows the harvest band moving across the Corn Belt.",
      },
    ],
  },
  {
    id: "new-build",
    title: "New build to account",
    views: [
      {
        run: async (api) => {
          const r = api.records();
          const { data } = api.ctx();
          if (has(data.accounts, r.accountId)) return;
          const nb = findDemoNewBuild(data);
          if (!nb) throw new Error("The Fort Dodge new build is not in the data");
          if (nb.Status !== "New") throw new Error(`${nb.Name} is already ${nb.Status}`);
          const conv = convertNewBuild(api.ctx(), nb);
          await api.run(conv.mutations, `${nb.Company}: lead, then account and contact`);
          api.patch({ newBuildId: nb.Id, leadId: conv.leadId, accountId: conv.accountId, contactId: conv.contactId });
          api.log(`New build converted: ${nb.Company}`, [link("Account", `/accounts/${conv.accountId}`), link("Lead", `/leads/${conv.leadId}`)]);
        },
        href: () => "/new-builds",
        caption: () => "New Builds: the Fort Dodge ethanol plant becomes a lead, then an account with its plant controller.",
        highlight: { row: "Fort Dodge" },
      },
      {
        href: (r) => `/accounts/${r.accountId}`,
        caption: () => "The new account: Dana Kessler, Plant Controller, is the economic buyer.",
      },
    ],
  },
  {
    id: "opportunity",
    title: "Create an opportunity",
    views: [
      {
        navFirst: true,
        run: async (api) => {
          const r = api.records();
          const { data } = api.ctx();
          if (has(data.opportunities, r.opportunityId) || !r.accountId) return;
          await api.waitFor(() => document.querySelector('section[aria-label="Key metrics"]'), 4000);
          const o = createDemoOpportunity(api.ctx(), r.accountId, r.contactId);
          await api.run(o.mutations, "Opportunity created");
          api.patch({ opportunityId: o.opportunityId });
          api.log("Opportunity created from product fit", [link("Opportunity", `/opportunities/${o.opportunityId}`)]);
        },
        href: () => "/",
        caption: (r, api) => {
          const o = api.ctx().data.opportunities.find((x) => x.Id === r.opportunityId);
          return `Opportunity sized from product fit${o ? ` (${fmtMoney(o.Amount)})` : ""}: open pipeline goes up.`;
        },
        highlight: { selector: 'section[aria-label="Key metrics"]' },
      },
      {
        href: (r) => `/opportunities/${r.opportunityId}`,
        caption: () => "Economic buyer identified, so the deal starts in Qualification.",
      },
    ],
  },
  {
    id: "campaign",
    title: "Campaign and sequence",
    views: [
      {
        run: async (api) => {
          const r = api.records();
          const ctx = api.ctx();
          if (has(ctx.data.campaigns, r.campaignId)) return;
          const recipients = campaignRecipients(ctx.data, r.accountId, api.rankedIds());
          const c = createDemoCampaign(ctx, recipients, api.sender());
          await api.run(c.mutations, `Campaign created · ${recipients.length} members`);
          const seq = PREBUILT_SEQUENCES.find((s) => s.id === DEMO_SEQUENCE_ID);
          if (!seq) throw new Error("Prebuilt sequence missing");
          const e = enrollRecipients(api.ctx(), seq, recipients, api.sender());
          api.saveEnrollments(e.enrollments);
          const steps = e.enrollments.reduce((n, x) => n + x.steps.length, 0);
          await api.run(e.mutations, `Enrolled ${e.enrollments.length} in "${seq.name}" · ${steps} steps scheduled`);
          api.patch({ campaignId: c.campaignId, enrollmentIds: e.enrollments.map((x) => x.id) });
          api.log(`Campaign "${seq.name}" with ${recipients.length} ethanol and feed contacts; ${steps} sequence steps scheduled`, [
            link("Campaign", `/campaigns/${c.campaignId}`),
            link("Scheduled", "/outreach/sequences?tab=scheduled"),
          ]);
        },
        href: (r) => `/campaigns/${r.campaignId}`,
        caption: () => "Campaign “Year-Round Ethanol & Feed”: 15 ethanol plant and feed mill contacts.",
        highlight: { selector: '[data-demo="campaign-stats"]' },
      },
      {
        href: () => "/outreach/sequences?tab=scheduled",
        caption: () => "Enrolled in the prebuilt sequence: every step is scheduled around harvest and planting blackouts.",
      },
    ],
  },
  {
    id: "call",
    title: "Call Desk",
    views: [
      {
        run: async (api) => {
          const r = api.records();
          const { data } = api.ctx();
          if (has(data.calls, r.callId) || !r.accountId) return;
          const now = new Date();
          const mins = Math.min(17 * 60, Math.max(8 * 60, Math.ceil((now.getHours() * 60 + now.getMinutes() + 15) / 30) * 30));
          const time = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
          const c = scheduleDemoCall(api.ctx(), { accountId: r.accountId, opportunityId: r.opportunityId, contactId: r.contactId, time });
          await api.run(c.mutations, "Discovery call scheduled");
          api.patch({ callId: c.callId, callSaved: false });
          api.log("Discovery call scheduled for today", [link("Call Desk", `/call-desk?call=${c.callId}`)]);
        },
        href: (r) => `/call-desk?call=${r.callId}`,
        caption: () => "Discovery call with Dana Kessler today: the pre-call brief is ready.",
        highlight: { selector: '[data-testid="call-brief"]' },
      },
      {
        href: (r) => (r.callSaved ? `/call-desk?call=${r.callId}` : `/call-desk?call=${r.callId}&live=1`),
        caption: (r) => (r.callSaved ? "This call's notes are already saved." : "Simulated call: the transcript streams in. Next skips ahead."),
        waitsForCall: true,
      },
      {
        run: async (api) => {
          const r = api.records();
          if (!r.callId) return;
          emitDemo({ type: "call-close", callId: r.callId });
          const call = api.ctx().data.calls.find((c) => c.Id === r.callId);
          if (!call || call.Status === "Completed") return;
          const done = finishDemoCall(api.ctx(), r.callId);
          await api.run(done.mutations, `AI Notes saved${done.stage ? ` · stage → ${done.stage}` : ""} · ${done.tasks} follow-up task${done.tasks === 1 ? "" : "s"}`);
          api.patch({ callSaved: true, callStage: done.stage });
          api.log(`Call saved: AI Notes${done.stage ? `, stage moved to ${done.stage}` : ""}, ${done.tasks} follow-up task${done.tasks === 1 ? "" : "s"}`, [
            link("Call Desk", `/call-desk?call=${r.callId}`),
            ...(r.opportunityId ? [link("Opportunity", `/opportunities/${r.opportunityId}`)] : []),
          ]);
        },
        href: (r) => `/call-desk?call=${r.callId}`,
        caption: (r) => `Call ended: AI Notes saved${r.callStage ? `, stage moved to ${r.callStage}` : ""}, follow-up task created.`,
      },
    ],
  },
  {
    id: "quote",
    title: "Build a quote",
    views: [
      {
        run: async (api) => {
          const r = api.records();
          const { data } = api.ctx();
          if (has(data.quotes, r.quoteId) || !r.opportunityId) return;
          const q = buildDemoQuote(api.ctx(), r.opportunityId);
          await api.run(q.mutations, `Quote ${q.quoteNumber}: 12% off, auto-approved, sent`);
          api.patch({ quoteId: q.quoteId, quoteNumber: q.quoteNumber });
          api.log(`Quote ${q.quoteNumber} built from the catalog, auto-approved and sent`, [link(q.quoteNumber, `/quotes/${q.quoteId}`)]);
        },
        href: (r) => `/quotes/${r.quoteId}`,
        caption: (r) => `Quote ${r.quoteNumber ?? ""} from the product catalog: 12% off is within the rep limit (auto-approved), marked Sent.`,
      },
    ],
  },
  {
    id: "forward-30",
    title: "Fast-forward 30 days",
    views: [
      {
        run: async (api) => {
          const r = api.records();
          if (r.fastForwardTo) await api.setDate(r.fastForwardTo);
          else {
            const target = api.asOfISO() < DEMO_DATES.november ? DEMO_DATES.november : undefined;
            await api.fastForwardTo(target ?? new Date(Date.parse(`${api.asOfISO()}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10));
            api.patch({ fastForwardTo: api.asOfISO() });
          }
          const q = r.quoteId ? api.ctx().data.quotes.find((x) => x.Id === r.quoteId) : undefined;
          const opp = r.opportunityId ? api.ctx().data.opportunities.find((x) => x.Id === r.opportunityId) : undefined;
          if (q && (q.Status !== "Accepted" || !opp?.IsWon)) {
            await api.run(acceptAndWin(api.ctx(), q.Id), `Quote ${q.QuoteNumber} accepted · opportunity Closed Won`);
            api.log(`Quote ${q.QuoteNumber} accepted; opportunity Closed Won`, [link(q.QuoteNumber, `/quotes/${q.Id}`), ...(opp ? [link("Opportunity", `/opportunities/${opp.Id}`)] : [])]);
          }
        },
        href: (r) => `/campaigns/${r.campaignId}`,
        caption: () => "30 days later: sequence opens, replies and meetings show up in the campaign stats.",
        highlight: { selector: '[data-demo="campaign-stats"]' },
      },
      {
        href: (r) => `/quotes/${r.quoteId}`,
        caption: () => "The customer accepted the quote, and the opportunity is Closed Won.",
      },
      {
        href: () => "/",
        caption: () => "Home: Closed Won, the rep donut and the product, commodity and region mix update.",
        highlight: { selector: 'section[aria-label="Charts"]' },
      },
      {
        href: () => "/map?sales=1",
        caption: () => "The map's recent-sales layer shows the new win in Fort Dodge.",
      },
    ],
  },
  {
    id: "contract",
    title: "Contract",
    views: [
      {
        run: async (api) => {
          const r = api.records();
          const ctx = api.ctx("manager");
          if (!r.quoteId) return;
          if (!has(ctx.data.contracts, r.contractId)) {
            api.patch({ arrBefore: arrAt(ctx.data, ctx.asOf) });
            const c = createDemoContract(ctx, r.quoteId);
            await api.run(c.mutations, "Contract drafted from the accepted quote");
            api.patch({ contractId: c.contractId });
            api.log("Contract drafted from the accepted quote", [link("Contract", `/contracts/${c.contractId}`)]);
          }
          const cid = api.records().contractId!;
          const contract = api.ctx().data.contracts.find((x) => x.Id === cid);
          if (!api.records().clauseRowId && contract && (contract.Status === "Draft" || contract.Status === "Legal Review")) {
            const e = requestClauseChange(api.ctx("manager"), cid);
            await api.run(e.mutations, "Liability clause edited · sent to Legal");
            api.patch({ clauseRowId: e.rowId });
            api.log("Liability clause edited: non-standard, sent to Legal", [link("Contract", `/contracts/${cid}`)]);
          }
        },
        href: (r) => `/contracts/${r.contractId}`,
        caption: () => "Contract drafted from the accepted quote. The edited liability clause is non-standard, so it goes to Legal.",
      },
      {
        run: async (api) => {
          const r = api.records();
          await api.setRole("legal");
          const row = api.ctx().data.contractClauses.find((x) => x.Id === r.clauseRowId);
          if (!row || row.ApprovalStatus !== "Pending") return;
          await api.run(legalApproveClause(api.ctx("legal"), row.Id), "Clause approved by Legal");
          api.patch({ clauseApproved: true });
          api.log("Legal approved the non-standard liability clause", [link("Contract", `/contracts/${r.contractId}`)]);
        },
        href: (r) => `/contracts/${r.contractId}`,
        caption: () => "Viewing as Legal: the non-standard clause is approved.",
      },
      {
        run: async (api) => {
          await api.setRole("manager");
          const r = api.records();
          const c = api.ctx().data.contracts.find((x) => x.Id === r.contractId);
          if (c && (c.Status === "Draft" || c.Status === "Legal Review")) {
            const signer = api.ctx().data.contacts.find((x) => x.Id === r.contactId)?.Name ?? "Dana Kessler";
            const s = signDemoContract(api.ctx("manager"), c.Id, api.signature(signer));
            await api.run(s.mutations, `${c.ContractNumber} signed · first invoice sent · onboarding started`);
            const inv = api.ctx().data.invoices.find((i) => i.ContractId === c.Id);
            api.patch({ invoiceId: inv?.Id, signer: s.signer });
            api.log(`Contract ${c.ContractNumber} signed by ${s.signer}; first invoice${inv ? ` ${inv.InvoiceNumber}` : ""} sent`, [
              link("Contract", `/contracts/${c.Id}`),
              link("Invoices", "/finance/invoices"),
            ]);
          }
          if (!api.records().harvestContractId) {
            const ht = harvestTermsContract(api.ctx().data, r.contractId ? [r.contractId] : []);
            if (ht) {
              await api.run(harvestTermsDemo(api.ctx(), ht.Id), `Harvest payment terms approved by Finance on ${ht.ContractNumber}`);
              api.patch({ harvestContractId: ht.Id });
              api.log(`Finance approved harvest payment terms (due Dec 15) on ${ht.ContractNumber}`, [link(ht.ContractNumber, `/contracts/${ht.Id}`)]);
            }
          }
        },
        href: (r) => `/contracts/${r.contractId}`,
        caption: (r, api) => {
          const inv = api.ctx().data.invoices.find((i) => i.Id === r.invoiceId);
          const ht = api.ctx().data.contracts.find((c) => c.Id === r.harvestContractId);
          return `Back to Sales manager: signed by ${r.signer ?? "the customer"}, first invoice${inv ? ` ${inv.InvoiceNumber}` : ""} sent on standard terms${ht ? `; Finance approved harvest terms on ${ht.ContractNumber}` : ""}.`;
        },
      },
    ],
  },
  {
    id: "finance",
    title: "Finance",
    views: [
      {
        href: () => "/finance",
        caption: (r, api) => {
          const ctx = api.ctx();
          const up = r.arrBefore !== undefined ? arrAt(ctx.data, ctx.asOf) - r.arrBefore : 0;
          return `ARR ${up > 0 ? `up ${fmtMoney(up)}` : "updated"}: the ARR bridge counts the new customer.`;
        },
        highlight: { heading: "ARR bridge" },
      },
    ],
  },
  {
    id: "december",
    title: "December: year-end",
    views: [
      {
        run: async (api) => {
          await api.setDate(DEMO_DATES.december);
          api.log(`Date set to ${fmtDate(DEMO_DATES.december)}`);
        },
        href: () => "/segments",
        caption: () => "December 10: rankings flip to co-ops (audits, boards, budgets).",
        highlight: { selector: 'section[aria-label="Ranked segments"]' },
      },
      {
        href: () => "/",
        caption: () => "The elevator harvest blackout has ended: elevators and co-ops are back on the call list.",
        highlight: { selector: 'section[aria-label="Focus this month"]' },
      },
    ],
  },
  {
    id: "trip",
    title: "Trip planner",
    views: [
      {
        run: async (api) => api.log(`Trip planned: "${DEMO_TRIP_REQUEST}"`, [link("Map", `/map?trip=${encodeURIComponent(DEMO_TRIP_REQUEST)}`)]),
        href: () => `/map?trip=${encodeURIComponent(DEMO_TRIP_REQUEST)}`,
        caption: () => "“I'm going to Iowa in January, top 10 co-ops”: the route, day by day.",
      },
    ],
  },
  {
    id: "renewal",
    title: "Renewal and expansion",
    views: [
      {
        run: async (api) => {
          const r = api.records();
          const c = api.ctx().data.contracts.find((x) => x.Id === r.contractId);
          if (!c) return;
          const date = renewalCheckDate(c.StartDate);
          await api.setDate(date);
          // Lifecycle automation opens the renewal when the date changes; run it here too (idempotent)
          let renewal = await api.waitFor(() => renewalFor(api.ctx().data, c.Id), 3000);
          if (!renewal) {
            await api.run(demoRenewals(api.ctx()));
            renewal = renewalFor(api.ctx().data, c.Id);
          }
          if (renewal && renewal.Id !== r.renewalId) {
            api.patch({ renewalId: renewal.Id, renewalDate: date });
            api.log(`Renewal opportunity opened automatically: ${renewal.Name}`, [link("Renewal", `/opportunities/${renewal.Id}`)]);
          }
          if (!has(api.ctx().data.opportunities, api.records().expansionId)) {
            const x = demoExpansion(api.ctx());
            if (x) {
              await api.run(x.mutations, `Expansion opportunity: ${x.accountName}`);
              api.patch({ expansionId: x.opportunityId, expansionAccount: x.accountName });
              api.log(`Health score flagged an expansion: ${x.accountName}`, [link("Opportunity", `/opportunities/${x.opportunityId}`)]);
            }
          }
        },
        href: () => "/customers/renewals",
        caption: (r) => `${r.renewalDate ? fmtDate(r.renewalDate) : "Eleven months in"}: the contract ends within 120 days, so its renewal opportunity opened automatically.`,
        highlight: { row: "Fort Dodge" },
      },
      {
        href: () => "/customers",
        caption: (r) => `Customer health flags an expansion${r.expansionAccount ? `: ${r.expansionAccount} has locations not yet live` : ""}.`,
        highlight: (r) => (r.expansionAccount ? { row: r.expansionAccount } : undefined),
      },
      {
        href: (r) => (r.expansionId ? `/opportunities/${r.expansionId}` : "/customers"),
        caption: () => "The expansion opportunity covers the remaining locations.",
      },
    ],
  },
  {
    id: "board-report",
    title: "Board Report",
    views: [
      {
        run: async (api) => {
          const name = await api.boardReport();
          api.patch({ boardReport: name });
          api.log(`Board Report downloaded: ${name}`, [link("Finance", "/finance")]);
        },
        href: () => "/finance",
        caption: (r) => `Board Report PDF downloaded${r.boardReport ? ` (${r.boardReport})` : ""}. Demo complete.`,
        highlight: { heading: "ARR bridge" },
      },
    ],
  },
];
