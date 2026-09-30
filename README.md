# HarvestSignal

**Segment prioritization and seasonal selling for ThiboLiSoft's sales team.** HarvestSignal reads Salesforce opportunity history, works out which market segments close best *for deals started this month*, and tells reps who to call now, and who not to call because they're in harvest.

- **Live:** https://thf-tawny.vercel.app (mock data, no environment variables needed)
- **Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui · d3-geo + TopoJSON · jsforce (read-only) · Claude API (optional) · react-markdown · write-excel-file · jsPDF

---

## What's in the app

| Page | What it does |
|---|---|
| **Home** (`/`) | Dashboard for the selected date: KPI row (Open Pipeline, Weighted Pipeline, Closed Won this quarter, Win Rate trailing 12 months, Average Deal Size, each vs. the prior period), **Focus this month** (Top Commodity with its phase and why; Top Region with accounts out of blackout, open pipeline and *View on map*), **Pipeline by Stage** and **Closed Won by Month** charts, **Top 10 Open Opportunities** by expected value with a blackout flag, and **Upcoming** (blackouts ending, selling windows opening, board meetings, close dates). |
| **Map** (`/map`, `/map?region=…`, `/map?state=IA`) | The Opportunity Map (below), plus a **Recent sales** layer and **Plan a Trip**. |
| **Segments** (`/segments`) | Segment prioritization. Left panel: sliders for the four weights (deal size, cycle speed, product fit, expansion potential) and prior strength *k*, plus Reset. Right: ranked segment cards showing close rate for deals created this month with a Wilson 95% interval bar and a `Measured` / `Blended` / `Prior` tag, decided deals, median cycle, median won deal, a 12-month close-rate strip and the priority score. Below: the top 25 open deals by expected value, linking to the record. |
| **Prospects** (`/prospects`, `/accounts/[id]`, `/leads/[id]`) | Every prospect scored 0–100 with reasons. The account page shows the segment, harvest window, calculated blackout status, fiscal year end, board meeting months, parent co-op and locations, and the buying committee. |
| **Opportunity** (`/opportunities/[id]`) | In-app record for mock mode: stage path incl. **Board Approval**, buying committee, and close-date checks (before the next board meeting, inside a no-contact period, no economic buyer). |
| **Opportunity Map** (Map tab) | Seasonality heat map with real US state + Canadian province shapes, a commodity dropdown (Wheat, Corn, Soybeans, Rice, Lentils) and colour that varies within states by latitude (blue = planting, red = harvest peak), with a legend. **Drill-down:** click a state to zoom to its region, and click again to zoom to the state (500 ms eased zoom), with a clickable breadcrumb (North America › Western Corn Belt › Iowa) and Back. The side panel shows a one-line summary, key stats (facilities, customers, penetration, open pipeline, season phase), top potential customers (ranked, with estimated deal size and blackout status) and three insights. At state level, facility dots open the account. |
| **Facilities** (`/facilities`) | ~457 IL/IA target facilities plus a lighter layer elsewhere. Coverage figures ("12 of 132 Iowa co-op locations"), whitespace counties, and Salesforce-ready CSV export/import. |
| **Campaigns** (`/campaigns`, `/campaigns/new`) | Campaign builder with six season plays (Year-end, Implementation, Budget window, Quick wins, Harvest support, Year-round), template or AI copy, mail-list CSV, and Campaign / CampaignMember / Task creation (mock mode). |
| **Sequences** (`/campaigns/sequences`) | Outreach-style email sequences: Email / Call task / LinkedIn task steps with day offsets, merge fields with an insert menu, variants chosen by rules (season phase, commodity, region, state, segment), preview for any recipient with missing fields in amber (sending blocked), blackout-aware scheduling, AI *Draft sequence* and *Rewrite step*, and enrollment from a filtered contact list, the map, the trip planner or the AI chat. Sending is simulated: steps are logged as scheduled Tasks. Four prebuilt sequences. |
| **Templates → Exports** (`/templates/exports`) | Export Template Builder: describe an export in plain words (AI turns it into a template spec), then edit source, columns, filters, grouping, sort, totals and format with a live 20-row preview. Save, Duplicate, Delete, Export now as CSV, XLSX or PDF. Four prebuilt templates, including a Salesforce Opportunity Import CSV with API-name headers. |
| **Help Center** (`/help`, the ? icon in the header) | 14 articles with a table of contents and search. Every page has a **Help** link under the header that opens its article in a drawer without leaving the page. |
| **Assistant** (button, bottom right, every page) | A 400px side panel that answers pipeline questions using read-only tools over the same data as the app (plus web search), with record links, tables, a Sources line, *Export this* and *Start sequence*. |
| **Calendar** (`/calendar`) | The four selling windows and the campaign for each, starting with the **Price-Later Contract Compliance Webinar** (invite copy, controller + GM target list, follow-up sequence). Crop calendar by region for reference. |
| **Time travel** (header) | Pick any date: close rates, rankings, blackouts, the map and the campaign plays all recalculate. Presets: October, December, March, July, early August. |

## Interface decisions (UI polish pass)

**Accounts, sign-in and brand (latest round)**

- **Email sign-in with Supabase Auth.** When `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are set (the Vercel Supabase integration adds them), users sign in with email and password. `src/proxy.ts` verifies and refreshes the session on every page request (`getClaims()`), and signed-out visitors go to `/login`. Sessions last until sign-out; access tokens refresh automatically.
- **Roles:** *Administrator* or *User*, stored in Supabase `app_metadata` (users can't change it themselves). Administrators manage people under **Settings → Users** (also in the avatar menu): add a user with a temporary password (shown once; they must choose their own at first sign-in) or by invitation email, edit name, title, role and linked Salesforce user, email a reset link or set a new temporary password, disable or enable, and delete. The server re-checks the caller's role with the Auth server on every admin action, and it won't let you remove your own admin role, disable or delete yourself, or remove the last administrator.
- **First run:** while the Supabase project has no users, `/login` shows **Set up HarvestSignal** to create the first administrator. Set `ADMIN_EMAILS` (comma-separated) to restrict who can do this; after the first account exists the screen is gone.
- **Passwords:** at least 8 characters. *Forgot password?* on the sign-in page emails a reset link (same reply whether or not the account exists). Links from invitation and reset emails land on `/auth/confirm`, then `/account/password`. Changing your password in Settings asks for the current one.
- **Salesforce user link:** each login can be linked to a Salesforce user so records it creates (Tasks, Events, Campaigns) have the right owner.
- **Profile:** name and title are saved to the account; the photo stays in the browser.
- **Demo mode** is unchanged when Supabase isn't configured, so the app still runs with no environment variables. The demo `/api/session` endpoint is disabled when Supabase is configured.
- **Brand:** the HarvestSignal logo (wheat ear with signal arcs) is in the header, on the sign-in pages, in the Help Center, on PDF exports, and as the favicon, app icon and social preview image. Source files: `src/components/brand/logo.tsx`, `public/brand/`.

### Accounts and sign-in: one-time setup in Supabase

1. **Auth → URL Configuration:** set *Site URL* to the production URL (e.g. `https://thf-tawny.vercel.app`) and add `https://thf-tawny.vercel.app/**` (and `http://localhost:3000/**` for local work) to *Redirect URLs*. Invitation and reset links only work for listed URLs.
2. **Email:** Supabase's built-in email service only delivers to members of your Supabase organization and is rate-limited. To send invitations and reset links to anyone, add a custom SMTP provider (Auth → Emails → SMTP). Until then, use *Create with a temporary password*, which needs no email.
3. **Sign-ups:** turn off *Allow new users to sign up* (Auth → Sign In / Providers) so only administrators can create accounts.
4. Open the app, create the administrator on the first-run screen, then add everyone else from Settings → Users.

**Help Center and CSV column picker**

- **Help lives in one place:** pages keep no explainer text; the ? icon in the header opens `/help` and the **Help** link on each page (right end of the section tab row) opens the matching article in a right-side drawer. Page → article mapping is in `src/lib/help/types.ts` (`helpSlugFor`); record pages and Prospects open *Segment Prioritization*, Facilities opens *Map*, Calendar opens *Seasonality Rules*, Settings opens *Getting Started*.
- **Search** is client-side (Fuse.js) over titles, summaries and article text; arrow keys and Enter pick a result.
- **Assistant + help:** the assistant has a `search_help` tool and links articles for how-do-I questions; without a key, questions that start like "how do I…", "where can I…" or "what does … mean" are answered with the best matching articles.
- **Features that aren't built yet:** *Quotes*, *Product Setup* and the *New Builds Finder* articles say plainly that the feature isn't available in this version, point to what exists today, and list the planned behaviour. The Home dashboard has no separate period selector or click-to-filter (the time-travel date sets the period) and the map has no new-builds layer; the articles describe the app as it is.
- **Column picker on every CSV export** (Prospects, Facilities, campaign mail lists, trip itineraries and CSV exports from the Template Builder): show/hide, drag or move to reorder, rename headers, live 5-row preview, all rows or the filtered view (where the page has filters), date format (YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY), named presets and a remembered last-used setup per export. Salesforce-ready files lock their required fields (Facilities: `Id`, `Name`; Opportunity import: `Name`, `StageName`, `CloseDate`, `AccountId`). One engine (`src/lib/columns.ts`) and one dialog (`src/components/shared/column-picker.tsx`) serve all of them. In the Template Builder the template's own columns are the starting setup, and presets are shared per data source. Presets are stored with the same storage module as templates and sequences.
- There are no Quotes or New Builds exports because those features don't exist yet.

### Editing help articles

Articles are MDX files in `content/help/`, one per article; the file name is the URL (`content/help/map.mdx` → `/help/map`). Each starts with front matter:

```
---
title: Map
summary: One sentence shown in search results.
order: 3
related: [trip-planner, seasonality-rules]
---
```

- Write plain Markdown (GFM tables work) with `##` and `###` headings. Link other articles as `/help/<slug>` and pages as `/map`.
- `related` becomes the *Related articles* list at the bottom; don't write it in the body.
- `<Screenshot caption="…" />` draws a placeholder box. No other components, imports or `{ }` expressions (put merge fields like `{{account.name}}` in backticks).
- Files are read at request time, so a new or edited article appears on the next page load (and after a deploy on Vercel). `order` sets the position in the table of contents.

**Navigation, dashboard, map and assistant**

- **Navigation:** four sections, **Home · Map · Campaigns · Templates**. Pages that used to be top-level are tabs inside a section, so nothing appears twice: Home has Overview / Segments / Prospects, Map has Map / Facilities, Campaigns has Campaigns / Sequences / Calendar, and Templates has Exports. Record pages (accounts, leads, opportunities) and Settings sit under Home. The time-travel bar, the Mock/Live badge and the assistant button are global. The segment priority list moved off Home (it lives on Segments).
- **Home "Focus this month":** *Top Commodity* scores each crop by the estimated deal value of its accounts (prospect score × estimated deal, discounted for blackouts) weighted by crop phase (post-harvest ×1.25, off-season ×1.1, growing ×1, planting ×0.6, harvest ×0.4), and names the two regions where most of its accounts share that phase. *Top Region* uses the same value without the phase weight. Phases come from the crop calendar: planting and harvest when the phase value is ≥ 0.5 either way, post-harvest for 120 days after the harvest window, growing between planting and harvest, off-season otherwise.
- **Home KPIs:** Closed Won compares quarter-to-date with the same number of days into the previous quarter; Win Rate and Average Deal Size compare the trailing 12 months with the 12 months before; pipeline figures compare with 30 days earlier. Charts are plain HTML bars (one accent colour, hover readout) rather than a chart library.
- **Recent sales (Map):** toggle next to the crop selector with 30 / 60 / 90 days / 12 months, measured back from the time-travel date. Closed-won deals are yellow dots (they read against both the red and blue ends of the heat map), sized by amount. The strip above the map and the **Recent Wins** list in the Area tab follow the range and the drill-down. Clicking a dot shows account, amount, products (line items), close date and owner.
- **Trip planner (Map → Plan a Trip):** plain-language request → destination, travel date (relative to the time-travel date), stops, segment and optional start city. With a key Claude extracts these; without one a keyword parser fills the same form, which can always be edited. Candidates are prospects in the destination (co-op locations included). Score = 0.6 × prospect score + a deal-size term, +15 for an open opportunity, +10 for a win in the last 12 months within 40 miles (reference visit), +6 for a whitespace county, then ×0.3 in a harvest blackout on the travel date and ×0.8 in a planting blackout. Stops are picked greedily from the start city trading score against distance (one point per 4 miles), ordered nearest-neighbour, and split into days of at most five stops with the last arrival by 5 PM (8:30 start, 60-minute visits, drive time = straight-line miles × 1.3 ÷ 55 mph). When half or more of the stops are blacked out, a warning offers year-round segments in the same area or the date when most of them reopen. Stops can be swapped (next best) or removed; itineraries export to PDF and CSV and to an .ics calendar file; *Enroll in sequence* opens the **Visiting Next Week** sequence with the stops. The last eight trips are saved in the browser.
- **Sign-in (demo mode):** without Supabase environment variables the app falls back to *Select user* with a signed, HTTP-only 30-day cookie checked in `src/proxy.ts` (Next.js 16 renamed `middleware.ts` to `proxy.ts`). See *Accounts and sign-in* below for the production setup.
- **Assistant:** answers stream from `/api/ai`. With `ANTHROPIC_API_KEY` set, Claude (`ANTHROPIC_MODEL`, default `claude-opus-5-5`) calls read-only tools (`get_pipeline_summary`, `search_opportunities`, `search_accounts`, `get_segment_stats`, `get_region_insights`, `get_season_status`, and `run_soql` in live mode only: one SELECT, capped at 200 rows) plus Anthropic web search. The system prompt carries the time-travel date, the map's crop and the current page. **Without a key** the panel still works: intent matching answers common questions from the same data (open pipeline, top deals by expected value, top opportunities or prospects in a state or region, who's in blackout and who comes out next, region summaries, segment ranking, season status) and the panel shows *AI offline — limited answers*. Tools read the server copy of the data, so browser-only changes made in mock mode aren't visible to the assistant. The conversation is kept for the browser session.
- **Export templates:** the AI returns a JSON spec that is checked against a field catalog (`src/lib/exports/fields.ts`) before it is shown. Without a key, *Build* maps the words to the closest prebuilt template and adds state/region filters. Percent values export as 0–100 in CSV and as formatted percentages in XLSX and PDF.
- **Sequences:** a step's variant is the first whose rules all match; otherwise the default text. The season phase for merge fields and rules is worked out for each step's send date. In a harvest (hard) blackout every step moves to the first allowed day; in a planting (light) blackout only call steps move. Later steps keep their spacing. A recipient with any missing merge field can't be enrolled until the text or the recipient changes.


- **No helper copy:** page subtitles, explainer captions, "how to use" hints and disclaimers are removed. Only the **Mock data / Live Salesforce** badge remains, and tooltips are one line.
- **Priority list on Home:** segments rather than individual deals, because the segment view carries the seasonal story. Deals stay one click away on Segments.
- **Map drill-down levels:** North America → region (the 12 sales regions) → state/province. Summary lines for regions come from `src/data/reference/regions.ts`, and for key states from `src/lib/regionInsights.ts`. Stats, top accounts and insights are computed from the loaded data.
- **Estimated deal size** on the map panel uses the account's open deal if it has one, otherwise the segment's median won deal.
- **Season bar** (under the navigation, every page): step a week back or forward, press **Play** to run through the year, or click or drag the timeline. The track is coloured by grain selling window, and the date button opens exact dates and presets.
- **Opportunity Map sidebar:** a **Prospects** tab (filters: status, commodity, size by revenue, segment; sort: score, estimated deal size, name) that drives the dots on the map. Hovering a row highlights its dot and hovering a dot highlights the row; clicking a dot selects its row. An **Area** tab holds the drill-down summary, stats and insights.
- **Map interaction:** click to drill down (region, then state), scroll to zoom, drag to pan, +/−/Fit buttons, and hover outlines on states.
- **Commodities view:** states tinted by their dominant crop, dots coloured by each account's primary commodity. **Colors** lets each user choose their own commodity colours (saved in the browser).
- **Prospects page:** each row has an **Email** action and a **Last Activity** column. Sending logs a completed Email Task (simulated Salesforce sync in mock mode) and adds a follow-up Task.
- **Coverage:** mock facilities now span every sales region (1,084 accounts; IL/IA core unchanged), with facility types weighted by each region's crops.
- **Ranking confidence:** segments ranked on borrowed rates count for slightly less (Prior ×0.85, Blended ×0.92), so an untested segment doesn't outrank proven ones on the company average. Deal history uses its own random stream (`OPP_SEED`, default 42), so adding facilities doesn't reshuffle it.
- `/today` redirects to Home. **Earlier rounds:**
- **Sign-in:** the app opens on **Select user** (Jeffrey Li, Jesse Thibodeau, Braydon Viragh, Adam D’Cunha). If a user has set a password, it's required to sign in. Sign out from the avatar menu. Profiles live in the browser and passwords are stored only as salted SHA-256 hashes; the session itself is the signed cookie described above. Production should use Salesforce SSO or the company identity provider, and the Vercel project should have Deployment Protection turned on.
- **Settings** (avatar menu → Settings): **Profile** (photo upload, resized in the browser; title; email used in email signatures), **Security** (set, change or remove a password), **Salesforce** (a mock *Connect to Salesforce* flow: environment, My Domain, authorization steps, then org, instance, last sync, object counts, *Sync now* and *Disconnect*). The mock connection doesn't change the data source; live mode still uses the `SF_*` environment variables.
- **Seasonality source:** planting and harvest timing is modelled on **USDA NASS, *Field Crops Usual Planting and Harvesting Dates*** (https://www.nass.usda.gov/Publications/Todays_Reports/reports/fcdate10.pdf), cited under the map and the crop calendar. The model uses a planting and a harvest peak per crop with a latitude shift, so it approximates the published state ranges rather than copying them. Canadian provinces are extrapolated northward from the same model.
- **Current user:** records created in the app (Tasks, Events, Campaigns) are owned by the signed-in user, who is also the sender on generated emails.
- Removed the unused commodity-price strip and stage chart from the old Today page.

## Seasonality rules

- **Elevators, co-ops, river terminals, shuttle loaders, seed cleaners:** hard no-contact from mid-August to Thanksgiving (harvest), light no-contact mid-April to early June (planting). Both shift 2 days later per degree north of 38°N (about 8 days at 42°N, capped at 14 days), and a further week in Canada.
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

Run the tests: `npm test` (stats, crop calendar, scoring, outreach, sequences and CSV columns).

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

- **Facilities:** ~457 in Illinois (249) and Iowa (208, including 132 co-op locations under 8 parent co-ops, one of which, with 12 locations, is a customer) and 63 feed mills across both states. Each is placed in a real county using centroids from the bundled `us-atlas` county shapes, with county, railroad, river access, shuttle loader and capacity. There is also a lighter layer across the rest of the US and Canada, 1,084 accounts in total. Company and people names are fictional.
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
npm test             # unit tests (stats, crop calendar, scoring, outreach, sequences, CSV columns)
npm run build
npm run seed         # regenerate mock data
npx tsx scripts/build-geo.ts   # regenerate /public/geo map files
```

(Windows PowerShell: use `npm.cmd` if script execution is blocked.)

**Deploy:** push to `main`, and Vercel project `thf` deploys automatically (`vercel.json` pins Next.js). It works with **zero environment variables**. Optional extras:

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on Claude for the assistant, template specs, sequence drafting and rewriting, trip parsing and campaign copy. Server-side only. Without it every feature falls back (intent-matched answers, manual template and sequence editing, keyword trip parsing, template copy). |
| `ANTHROPIC_MODEL` | Model for the assistant and the AI features. Default `claude-opus-5-5`. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Email sign-in and user administration with Supabase Auth (added by the Vercel Supabase integration). The service role key is server-only. Without them the app uses demo sign-in. |
| `ADMIN_EMAILS` | Optional. Comma-separated emails allowed to create the first administrator. |
| `SESSION_SECRET` | Demo mode only: signs the 30-day demo session cookie. |
| `SF_*` (five) | Live, read-only Salesforce mode (see above). |

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

- **Storage:** user-created export templates, sequences, enrollments and saved trips live in the browser's `localStorage` behind one small module (`src/lib/storage.ts`: `list / save / remove / hide`). Swapping it for a database-backed implementation (e.g. the Supabase project already linked to Vercel) makes them shared across users and devices without UI changes. Prebuilt templates and sequences come from seeded JSON (`scripts/prebuilt/*`, written by `npm run seed`).
- Real email sending for sequences (Salesforce or an ESP) behind an explicit switch, with replies and bounces stopping a recipient.
- Trip planner: real road distances and drive times from a routing API, and visits written back as Salesforce Events.

- Price book per module (per location / user / bushel), quote builder, discount approval thresholds, simulated e-signature.
- Closed Won → contracts with Active / Committed / Pipeline MRR, onboarding tasks, account NPS (fall average 48.1), promoters at multi-location co-ops flagged for expansion, auto-renewal opportunities.
- Reports: stage-to-stage conversion, cycle length by segment, coverage by territory.
- Live mode: JWT bearer auth instead of username-password, and write-back behind an explicit feature flag.

---

## 5-minute demo script

**0:00 – Setup (20 s).** "Vertical Software's CEO told us harvest isn't an opportunity, it's a no-contact period. So we built the tool around that." Point at the **Mock data** badge: it runs on Salesforce-shaped history, and the same code reads a real org read-only.

**0:20 – October (75 s).** On **Home**, set the date to **October: harvest** and point at *Focus this month* and the Top 10 table's blackout flags. Open **Map** and click Iowa twice (region, then state): the panel lists ethanol plants and feed mills as the top potential customers, with *Harvest blackout ends Dec 1 – Dec 7* as the first insight. Then on **Segments**, **ethanol plants and feed mills** are ranked first, and elevators and co-ops drop to the bottom. Hover the co-op close rate: *7% for deals created in October*, measured, with a 95% interval. "In October the tool says call ethanol plants and feed mills." Point at the hatched months in the strip and at River Terminal's **Not enough data · blended** tag: "We never show a bare percentage we can't back up."

**1:35 – December (60 s).** Time travel → **December: year-end**. The ranking flips: **Multi-Location Co-op moves to #1**. "In December it flips to co-ops: audits, boards, budgets." Move the **deal size** slider and **k**: the ranking updates instantly with no re-query. Scroll to the top 25 open deals and point out the "Before board" flag.

**2:35 – Blackout and buying committee (60 s).** Go back to October and open an Iowa co-op prospect. The header shows **Harvest blackout** to early December (later the further north). Click **Email**: *"In harvest blackout until Dec 5. Schedule for Dec 7?"* Then open a deal: stage path with **Board Approval**, and "economic buyer not identified". Log a connected call with a non-economic buyer and the deal *stays in Prospecting*.

**3:35 – Facilities (30 s).** "**12 of 132 Iowa co-op locations**" covered; whitespace counties; export a Salesforce-ready CSV.

**4:05 – Map (55 s).** On **Map** (Reset the map), October 12, Corn: red harvest band across Iowa and Illinois, and southern Illinois deeper than northern. Switch the dropdown to **Wheat**, then time travel to **July**: winter wheat harvest lights up Kansas and Oklahoma. Switch to **Lentils** in **August**: Saskatchewan and Montana. End: "Same data, different day, a different plan."
