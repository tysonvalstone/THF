# HarvestSignal

**Season-aware prospecting for ThiboLiSoft's sales team.** HarvestSignal tells ag-software reps _who to call right now, why now, and what to send_, based on each prospect's crop calendar, region, this year's weather and commodity markets. It then makes the admin work disappear: one click logs the activity and updates the Salesforce-style records.

Built for the ThiboLiSoft hackathon (Quality · Completeness · Originality).

- **Live:** https://thf-tawny.vercel.app
- **Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui · Recharts · Anthropic Claude API (optional)

---

## What it does

| Screen | What you get |
|---|---|
| **Right Now** (`/`) | Today's season in one sentence, pipeline KPIs, a US + Canada tile map colored by crop phase, the top 8 prospects with "why now" reasons, open campaign launch windows, pipeline by stage and a market strip (corn, soybeans, HRW wheat, canola, ethanol crush margin). |
| **Prospects** (`/prospects`) | Every prospect account and open lead, scored 0–100. Filter by region, state/province, facility type, commodity, record type and minimum score; sort by any factor; expand a row for the full breakdown; export CSV. |
| **Account / Lead** (`/accounts/[id]`, `/leads/[id]`) | Salesforce-style record: highlights, next best action, the facility's own 12-month seasonal strip, activity timeline, contacts, opportunities (stage path + line items), campaign history, details. |
| **Campaign builder** (`/campaigns/new`) | Pick season play, regions, facility types and commodity → ranked target list → direct-mail letter + 3-email sequence + call script tied to that region's harvest timing → launch. Creates Campaign, CampaignMember and Task records and exports the mail list CSV for a mail house. |
| **Campaigns** (`/campaigns`, `/campaigns/[id]`) | Campaign history with response tracking, saved copy and members. |
| **Season calendar** (`/calendar`) | Month-by-month planting, harvest (climate-shifted), launch windows (6–4 weeks pre-harvest) and settlement windows for 12 regions, plus a 120-day launch schedule. |
| **Time travel** (header) | Pretend it's another day. Rankings, reasons, the map, pipeline, launch windows and campaign copy all recalculate. Presets for the key demo moments. |

### One-click outreach ("make admin disappear")

From any prospect (dashboard, list, record page) reps can **email**, **log a call** or **add to a campaign**. Each action writes the records a rep would otherwise type into Salesforce:

| Action | Records created / updated |
|---|---|
| Send email | Completed Email **Task** · follow-up **Task** in 3 business days · overdue follow-ups closed · **Opportunity.NextStep** updated · **Lead.Status** → Working |
| Schedule email | Not-started Email **Task** on the send date + follow-up |
| Call: connected | Completed Call **Task** · Prospecting deal → **Qualification** · recap **Task** |
| Call: interested, book demo | Demo **Event** · deal advanced, or a **new Opportunity** with line items if none exists · Lead rated Hot |
| Call: voicemail / no answer | Call-back **Task** in 2 business days · NextStep updated |
| Add to campaign / create campaign | **Campaign** · **CampaignMember** per target · mail-drop / email / call **Tasks** on the start date |

Scores react: a prospect touched in the last 7 days is penalized so nobody gets over-contacted.

---

## How prospect scoring works

`src/lib/scoring/index.ts` — pure, unit-tested, runs for any as-of date.

| Factor | Max | Logic |
|---|---:|---|
| **Season timing** | 30 | Days to the facility's next busy window: harvest (elevators, co-ops, seed plants), new-crop buying (crushers, flour mills), spring/fall application (agronomy), winter feeding (feed mills). Peaks 3–8 weeks before; low mid-harvest; high again post-harvest (settlements). Ethanol plants score on crush-margin percentile + new-crop corn. |
| **Market signal** | 15 | 3-month price moves, local basis vs. typical, crop size (yield index), DDGS/ethanol, ration costs. |
| **Fit & size** | 20 | Facility-type fit + log-scaled revenue + number of locations. |
| **Displacement** | 15 | Paper/spreadsheets and legacy systems highest; competitor contracts scored by months to renewal; legacy end-of-support dates. |
| **Engagement** | 15 | Recency and volume of touches, campaign responses, open deals, lead rating; penalties for a recent loss or a touch in the last 7 days. |
| **Climate** | 5 | This season's regional condition (early & dry, wet delays, drought, record yields) — it also shifts harvest dates. |

The **why-now** line combines the two strongest factors in plain English, e.g. _"Corn harvest starts in about 3 weeks around Ames (running ~1 week early this year). Still on Paper tickets + Excel…"_

Tiers: **Hot** ≥ 72 · **Warm** ≥ 60 · **Cool** below. Customers are excluded from prospect ranking.

---

## Data

No live Salesforce connection. The app ships with realistic, **Salesforce-shaped mock data** using standard object/field API names (`Account`, `Contact`, `Lead`, `Opportunity`, `OpportunityLineItem`, `Product2`, `Campaign`, `CampaignMember`, `Task`, `Event`, `User`) and `__c` custom fields (`Facility_Type__c`, `Primary_Commodities__c`, `Storage_Capacity_Bu__c`, `Current_Software__c`, …).

- 424 facilities in ~300 **real** US and Canadian ag towns (company and people names are fictional), 120 open leads, ~1,400 contacts
- 40 open opportunities ($7.3M pipeline) + 60 closed in the last 12 months
- 12 months of calls, emails, mail drops and meetings; 8 historical campaigns with responses
- 12 regions with crop calendars, 2025–2027 climate signals, monthly price series 2024–2027
- A fictional ThiboLiSoft product catalog and fictional competitor systems

**Editing data:** reference data is typed TypeScript in `src/data/reference/` (regions, crop calendars, towns, climate, vendors, products, users). Generated records are JSON in `src/data/seed/`. Change the generator and run `npm run seed` (deterministic: same seed, same data), or hand-edit the JSON.

**Demo state:** changes you make (emails, calls, campaigns) are stored in the browser's `localStorage` as a log of Salesforce-style mutations, so they survive a refresh. Reset them from the avatar menu → _Reset demo data_.

**Going live:** all reads/writes go through one seam, `SalesRepository` in `src/lib/data/types.ts`. The mutations are already in insert/update-by-Id form, so a Salesforce (REST/Composite API) or Supabase implementation can replace `local-repository.ts` without touching the UI.

---

## AI content (optional)

`POST /api/generate` rewrites campaign copy and 1:1 emails with **Claude (`claude-opus-5-5`)** using structured JSON output, with server-side refusal fallback enabled (`fallbacks: "default"`). The key stays on the server.

- Set `ANTHROPIC_API_KEY` to enable it. The UI shows "AI-written" vs "Built-in template".
- **Without a key the app works fully**: the built-in messaging matrix (facility group × season play) produces tailored letters, sequences and call scripts. Any API error or refusal also falls back to the template.

---

## Run it locally

Requires Node.js 20+ (24 recommended).

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # scoring + outreach unit tests
npm run build        # production build
npm run seed         # regenerate src/data/seed/*.json
```

On Windows PowerShell, use `npm.cmd` if script execution is disabled.

## Deploy to Vercel

The repo is already connected to the Vercel project **thf**; every push to `main` deploys to production.

1. Push to `main` (or open a PR for a preview deployment).
2. Optional AI: `vercel env add ANTHROPIC_API_KEY production` (and `preview`), then redeploy.
3. `vercel.json` pins the framework to Next.js; no other setup is needed.

Fresh setup: import the GitHub repo at vercel.com/new → Framework: Next.js → Deploy.

---

## Project structure

```
scripts/generate-seed.ts        deterministic mock-data generator
src/
  app/                          routes (dashboard, prospects, accounts, leads, campaigns, calendar, api/generate)
  components/
    layout/                     app shell, time travel
    dashboard/ prospects/ records/ campaigns/ calendar/ outreach/ season/ shared/ ui/
  data/
    reference/                  typed regions, crop calendars, towns, climate, vendors, products, users
    seed/                       generated Salesforce-shaped JSON + typed loader
  lib/
    data/                       SalesRepository seam, local repository, React store, selectors
    scoring/                    engine, engagement index, tests
    season/                     crop phases, busy windows, launch windows
    market/                     prices, basis, crush margin
    actions/                    one-click outreach → record mutations (+ tests)
    content/                    messaging matrix, templates, AI client
    nba.ts                      next best action rules
  types/                        Salesforce + reference data models
```
