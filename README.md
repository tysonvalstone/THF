# HarvestSignal

**Segment prioritization and seasonal selling for ThiboLiSoft's sales team.** HarvestSignal reads Salesforce opportunity history, works out which market segments close best *for deals started this month*, and tells reps who to call now, and who not to call because they're in harvest.

- **Live:** https://thf-tawny.vercel.app (mock data, no environment variables needed)
- **Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui · d3-geo + TopoJSON · Recharts · jsforce (read-only) · Claude API (optional)

---

## What's in the app

| Page | What it does |
|---|---|
| **Home** (`/`) | **Current Status** for the selected date: KPI row (Open Pipeline, Weighted Pipeline, Open Opportunities, Win Rate for the trailing 12 months, Accounts in No-Contact Period, each vs. the prior period), the **Opportunity Map** with drill-down, and the segment priority list. |
| **Segments** (`/segments`) | Segment prioritization. Left panel: sliders for the four weights (deal size, cycle speed, product fit, expansion potential) and prior strength *k*, plus Reset. Right: ranked segment cards showing close rate for deals created this month with a Wilson 95% interval bar and a `Measured` / `Blended` / `Prior` tag, decided deals, median cycle, median won deal, a 12-month close-rate strip and the priority score. Below: the top 25 open deals by expected value, linking to the record. |
| **Prospects** (`/prospects`, `/accounts/[id]`, `/leads/[id]`) | Every prospect scored 0–100 with reasons. The account page shows the segment, harvest window, calculated blackout status, fiscal year end, board meeting months, parent co-op and locations, and the buying committee. |
| **Opportunity** (`/opportunities/[id]`) | In-app record for mock mode: stage path incl. **Board Approval**, buying committee, and close-date checks (before the next board meeting, inside a no-contact period, no economic buyer). |
| **Opportunity Map** (on Home) | Seasonality heat map with real US state + Canadian province shapes, a commodity dropdown (Wheat, Corn, Soybeans, Rice, Lentils) and colour that varies within states by latitude (blue = planting, red = harvest peak), with a legend. **Drill-down:** click a state to zoom to its region, and click again to zoom to the state (500 ms eased zoom), with a breadcrumb (North America › Western Corn Belt › Iowa) and Back/Reset. The side panel shows a one-line summary, key stats (facilities, customers, penetration, open pipeline, season phase), top potential customers (ranked, with estimated deal size and blackout status) and three insights. At state level, facility dots open the account. |
| **Facilities** (`/facilities`) | ~457 IL/IA target facilities plus a lighter layer elsewhere. Coverage figures ("12 of 132 Iowa co-op locations"), whitespace counties, and Salesforce-ready CSV export/import. |
| **Campaigns** (`/campaigns`, `/campaigns/new`) | Campaign builder with the four selling-window plays, template or AI copy, mail-list CSV, and Campaign / CampaignMember / Task creation (mock mode). |
| **Calendar** (`/calendar`) | The four selling windows and the campaign for each, starting with the **Price-Later Contract Compliance Webinar** (invite copy, controller + GM target list, follow-up sequence). Crop calendar by region for reference. |
| **Time travel** (header) | Pick any date: close rates, rankings, blackouts, the map and the campaign plays all recalculate. Presets: October, December, March, July, early August. |

## Interface decisions (UI polish pass)

- **Home** replaces the old "Right Now" / Today page: *Current Status* heading + date, then KPIs, the Opportunity Map and the priority list. `/today` and `/map` redirect to Home.
- **No helper copy:** page subtitles, explainer captions, "how to use" hints and disclaimers are removed. Only the **Mock data / Live Salesforce** badge remains, and tooltips are one line.
- **Navigation:** Home, Segments, Prospects, Facilities, Campaigns, Calendar. The time-travel date sits in the header; when it isn't today the button shows "As of …", and "Today" in the picker returns to the current date.
- **Priority list on Home:** segments rather than individual deals, because the segment view carries the seasonal story. Deals stay one click away on Segments.
- **Map drill-down levels:** North America → region (the 12 sales regions) → state/province. Summary lines for regions come from `src/data/reference/regions.ts`, and for key states from `src/lib/regionInsights.ts`. Stats, top accounts and insights are computed from the loaded data.
- **Estimated deal size** on the map panel uses the account's open deal if it has one, otherwise the segment's median won deal.
- **"Accounts in No-Contact Period"** counts parent accounts (not co-op locations) in a harvest or planting blackout on the selected date.
- Removed the unused commodity-price strip and stage chart from the old Today page.

## Seasonality rules

- **Elevators, co-ops, river terminals, shuttle loaders, seed cleaners:** hard no-contact from mid-August to Thanksgiving (harvest), light no-contact mid-April to early June (planting). Both shift about a week later per ~4° north (0 days at 38°N, up to 14 days), and a further week in Canada.
- **Ethanol plants, feed mills, processors:** no blackout; they are worked year-round and rise to the top during harvest.
- **Selling windows:** Dec–Feb prime (year-end, audits, boards, budgets) · late Feb–Mar implementation ("live before planting") · Jun–Jul budget window (fiscal years often end Aug 31 / Sep 30) · early Aug quick wins only (mobile add-ons, pilots) · harvest = support customers, collect NPS, sell to year-round segments.
- Outreach during a blackout shows a warning, e.g. *"In harvest blackout until Nov 26. Schedule for Nov 30?"* in southern Illinois, *"…until Dec 5. Schedule for Dec 7?"* in northern Iowa, and pre-fills the scheduled date.
- **Buying committee:** GM (decision maker), controller (economic buyer), merchandiser (champion), board. A deal can't leave Prospecting until the economic buyer is identified. Co-ops go through a **Board Approval** stage.
- Co-op locations are child accounts (`ParentId`); deals and pipeline roll up to the parent.

## How the statistics work (`src/lib/stats.ts`, unit-tested)

Per segment, from closed opportunity history up to the as-of date:

- **Close rate** = won ÷ (won + lost), with a **Wilson 95% interval** (z = 1.96).
- **Fewer than 10 decided deals** → shown as "Not enough data", never a bare %. The rate used for ranking is **blended**: (won + k × company rate) ÷ (n + k), k = 10 by default (slider).
- **No history** (Seed Cleaner / Specialty Crop) → the company-wide rate, tagged **Prior**. Never 0%, never a crash.
- Median days Created → Close, median won Amount, and the close rate by **month created** (12 buckets). Month buckets blend toward the segment's own rate when thin.
- Every number carries a tag: `Measured`, `Blended` or `Prior`.

**Ranking (`src/lib/prioritization.ts`)**

- Segment priority = (this creation month's close rate ÷ best segment's) × (0.25 + 0.75 × weighted blend). The blend is a weighted average of deal size (log-scaled median won amount), cycle speed (inverse median days), product fit (editable table in `src/data/reference/product-fit.ts`) and expansion potential (average locations per parent account), each scaled 0–1 across segments.
- Because the rate is seasonal, in **October** ethanol plants and feed mills rise to the top on their own, and in **December** co-ops take over.
- Open-deal expected value = applicable close rate (for the deal's creation month) × Amount ÷ segment median days → expected dollars per day of cycle.

Run the tests: `npm test` (stats, crop calendar, scoring and outreach: 28 tests).

---

## Data: mock vs. live

The UI never knows the mode, apart from the **Mock data / Live Salesforce** badge in the header.

| | Mock (default) | Live Salesforce |
|---|---|---|
| Enabled when | always, with no env vars | all of `SF_LOGIN_URL`, `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_USERNAME`, `SF_PASSWORD` are set |
| Source | `src/data/seed/*.json`, generated by `scripts/generate-seed.ts` | jsforce, `src/lib/data/salesforce.ts` |
| Writes | demo changes (emails, calls, campaigns, CSV imports) are kept in the browser's localStorage | **Read-only.** No insert/update/delete anywhere in the code; outreach actions are disabled |
| Caching | static | queried once on the server, cached for 1 hour (`unstable_cache`, tag `salesforce-data`); **Refresh data** expires it |

The browser loads everything once from `GET /api/data`; all ranking and slider math runs in memory, so sliders never re-query.

### Mock data (one seeded script)

`npm run seed` regenerates everything from a fixed seed. Records are never hand-written.

- **Facilities:** ~457 in Illinois (249) and Iowa (208, including 132 co-op locations under 8 parent co-ops, one of which, with 12 locations, is a customer) and 63 feed mills across both states. Each is placed in a real county using centroids from the bundled `us-atlas` county shapes, with county, railroad, river access, shuttle loader and capacity. There is also a lighter layer across the rest of the US and Canada, 665 accounts in total. Company and people names are fictional.
- **Opportunities:** ~3 years of history, 1,332 closed plus 148 open, across the eight segments. Elevator/co-op deals created Aug–Nov close far less often and more slowly; deals created Dec–Feb close best. Ethanol, feed and processors are steady. River Terminal is deliberately thin (<10 decided) and Seed Cleaner / Specialty Crop has no history.
- Buying committees (GM, controller, merchandiser, board), fiscal year ends, board meeting months, activity history and campaigns.

### `/soql`

Every query the live adapter sends, runnable by hand (`sf data query --file soql/opportunities.soql`). See `soql/README.md`.

### Salesforce setup (live mode)

Step-by-step guide: **[docs/salesforce-setup.md](docs/salesforce-setup.md)**. It covers:

1. Creating the Connected App (or External Client App) and its OAuth scopes (`api`, `refresh_token offline_access`), and allowing the username-password flow.
2. Creating a read-only integration user and profile or permission set, with Read on Account, Contact, Opportunity, Campaign, CampaignMember, Task and Event.
3. Security token and IP restrictions.
4. The custom fields the app expects (`Account.Segment__c` and others, all optional), plus the "Board Approval" stage.
5. The Vercel env vars: `vercel env add SF_LOGIN_URL production`, and the same for the other four, then redeploy.

> **Important:** this Vercel project is public (Deployment Protection is off, so anyone with the link can see it). **Turn Vercel Authentication back on before adding Salesforce credentials**, or real customer data will be visible to anyone with the URL.

---

## Run, test, deploy

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # 28 unit tests
npm run build
npm run seed         # regenerate mock data
npx tsx scripts/build-geo.ts   # regenerate /public/geo map files
```

(Windows PowerShell: use `npm.cmd` if script execution is blocked.)

**Deploy:** push to `main`, and Vercel project `thf` deploys automatically (`vercel.json` pins Next.js). It works with **zero environment variables**. Optional extras: `ANTHROPIC_API_KEY` for AI copy (Claude, server-side, with template fallback) and the five `SF_*` variables for live mode.

---

## Assumptions

- **Segments** come from `Account.Segment__c`. When the field is missing in a live org, they are derived from the account name, Industry and Type (see `deriveSegment` in `salesforce.ts`).
- **"Thin"** means fewer than 10 decided deals. Month buckets use the same threshold and blend toward the segment's own rate.
- **Priority score:** the seasonal close rate is multiplied in (rather than being a fifth weight) so seasonality always moves the ranking. The 0.25 floor stops a strong segment from vanishing in its off month.
- **Expected value:** for open deals it uses the close rate for the month the deal was *created*, divided by the segment's median cycle, i.e. expected dollars per day.
- **Blackouts:** the northward shift is linear in latitude and capped at 14 days, with Canada a further 7 days. Thanksgiving is US Thanksgiving for all accounts. Boards are assumed to meet on the second Tuesday of their meeting months.
- **Whitespace:** a county that has target facilities but no ThiboLiSoft customer.
- **Map colours:** they are a model (a planting/harvest bell per crop, shifted by latitude), not observed crop-progress data.
- **Mock-mode actions** (outreach, CSV import, campaigns) change browser-only state. Live mode never writes.
- **Price book:** prices on the ThiboLiSoft modules (Ceres, GrainSight, ScaleTrac, GrainSight Mobile, ScaleTrac Mobile) are illustrative.

## Next (Tier 3, not built yet)

- Price book per module (per location / user / bushel), quote builder, discount approval thresholds, simulated e-signature.
- Closed Won → contracts with Active / Committed / Pipeline MRR, onboarding tasks, account NPS (fall average 48.1), promoters at multi-location co-ops flagged for expansion, auto-renewal opportunities.
- Reports: stage-to-stage conversion, cycle length by segment, coverage by territory.
- Live mode: JWT bearer auth instead of username-password, and write-back behind an explicit feature flag.

---

## 5-minute demo script

**0:00 – Setup (20 s).** "Vertical Software's CEO told us harvest isn't an opportunity, it's a no-contact period. So we built the tool around that." Point at the **Mock data** badge: it runs on Salesforce-shaped history, and the same code reads a real org read-only.

**0:20 – October (75 s).** On **Home**, set the date to **October: harvest**. The KPI row shows *Accounts in No-Contact Period* jump. Click Iowa on the Opportunity Map twice (region, then state): the panel lists ethanol plants and feed mills as the top potential customers, with *Harvest blackout ends Dec 1 – Dec 7* as the first insight. Then on **Segments**, **ethanol plants and feed mills** are ranked first, and elevators and co-ops drop to the bottom. Hover the co-op close rate: *7% for deals created in October*, measured, with a 95% interval. "In October the tool says call ethanol plants and feed mills." Point at the hatched months in the strip and at River Terminal's **Not enough data · blended** tag: "We never show a bare percentage we can't back up."

**1:35 – December (60 s).** Time travel → **December: year-end**. The ranking flips: **Multi-Location Co-op moves to #1**. "In December it flips to co-ops: audits, boards, budgets." Move the **deal size** slider and **k**: the ranking updates instantly with no re-query. Scroll to the top 25 open deals and point out the "Before board" flag.

**2:35 – Blackout and buying committee (60 s).** Go back to October and open an Iowa co-op prospect. The header shows **Harvest blackout** to early December (later the further north). Click **Email**: *"In harvest blackout until Dec 5. Schedule for Dec 7?"* Then open a deal: stage path with **Board Approval**, and "economic buyer not identified". Log a connected call with a non-economic buyer and the deal *stays in Prospecting*.

**3:35 – Facilities (30 s).** "**12 of 132 Iowa co-op locations**" covered; whitespace counties; export a Salesforce-ready CSV.

**4:05 – Map (55 s).** Back on **Home** (Reset the map), October 12, Corn: red harvest band across Iowa and Illinois, and southern Illinois deeper than northern. Switch the dropdown to **Wheat**, then time travel to **July**: winter wheat harvest lights up Kansas and Oklahoma. Switch to **Lentils** in **August**: Saskatchewan and Montana. End: "Same data, different day, a different plan."
