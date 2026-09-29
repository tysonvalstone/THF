import "server-only";
import { searchHelp } from "@/lib/help/content";

/**
 * No-key answers for the AI assistant. Matches a handful of common questions
 * by keyword, runs the same read-only tools the model would call, and
 * formats the results as markdown (GFM tables, linked record names).
 */
import { REGIONS } from "@/data/reference/regions";
import { STATE_NAMES } from "@/data/reference/geo";
import { fmtMoney, plural } from "@/lib/format";
import { fmtDate, fmtShortDate } from "@/lib/dates";
import type { Area } from "@/lib/regionInsights";
import {
  parseArea,
  runTool,
  toMapCommodity,
  type AccountSearchResult,
  type OpportunitySearchResult,
  type PipelineSummaryResult,
  type RegionInsightsResult,
  type SeasonStatusResult,
  type SegmentStatsResult,
  type ToolContext,
} from "./tools";

export interface OfflineAnswer {
  markdown: string;
  accountIds: string[];
  exportable: boolean;
}

const HELP = `I can answer a few questions without the AI service. Try one of these:

- What's our open pipeline?
- Top 10 open deals by expected value in Iowa
- Which Iowa co-ops come out of blackout next?
- Summarize the Eastern Corn Belt
- Which segment should we prioritize?
- Corn harvest status in Illinois
- How do I plan a trip?`;

/* ---------------------------------------------------------------- parsing */

const REGION_TERMS = REGIONS.flatMap((r) => [
  { term: r.name.toLowerCase(), value: r.id },
  { term: r.shortName.toLowerCase().replace(/\./g, ""), value: r.id },
  { term: r.id.replace(/-/g, " "), value: r.id },
]).sort((a, b) => b.term.length - a.term.length);

const STATE_TERMS = Object.entries(STATE_NAMES)
  .flatMap(([code, name]) => [{ term: name.toLowerCase(), code }, ...(code === "QC" ? [{ term: "quebec", code }] : [])])
  .sort((a, b) => b.term.length - a.term.length);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Region or state named in the question: region names, then state names, then upper-case codes */
function findArea(question: string): { area: Area; label: string } | undefined {
  const q = ` ${question.toLowerCase().replace(/[.,?!]/g, " ").replace(/\s+/g, " ")} `;
  for (const r of REGION_TERMS) {
    if (q.includes(` ${r.term} `)) {
      const area = parseArea(r.value);
      // "Manitoba" is both a region and a province; the region covers MB only, so either reads the same
      if (area) return { area, label: REGIONS.find((x) => x.id === r.value)!.name };
    }
  }
  for (const s of STATE_TERMS) {
    if (new RegExp(`\\b${escape(s.term)}\\b`).test(q)) return { area: parseArea(s.code)!, label: STATE_NAMES[s.code] };
  }
  const code = question.match(/\b([A-Z]{2})\b/g)?.find((c) => STATE_NAMES[c]);
  if (code) return { area: parseArea(code)!, label: STATE_NAMES[code] };
  return undefined;
}

function areaArg(a: Area): { state?: string; region?: string } {
  return a.level === "state" ? { state: a.state } : { region: a.regionId };
}

const NUMBER_WORDS: Record<string, number> = { three: 3, five: 5, ten: 10, fifteen: 15, twenty: 20 };
function findCount(q: string, dflt: number): number {
  const m = q.match(/\btop\s+(\d+|three|five|ten|fifteen|twenty)\b/) ?? q.match(/\b(\d+|three|five|ten|fifteen|twenty)\s+(?:biggest|largest|best|top|open|deals|opportunities|prospects|accounts)\b/);
  if (!m) return dflt;
  const n = NUMBER_WORDS[m[1]] ?? Number(m[1]);
  return Number.isFinite(n) ? Math.max(1, Math.min(25, n)) : dflt;
}

function findCommodity(q: string) {
  const m = q.match(/\b(corn|soybeans?|soy|beans|wheat|rice|lentils?|pulses)\b/);
  return m ? toMapCommodity(m[1]) : undefined;
}

/* -------------------------------------------------------------- formatting */

const money = (n: number) => fmtMoney(n);
const cell = (s: string | number | null | undefined) => String(s ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
/** "Oct 14", or "Mar 9, 2027" outside the as-of year */
const day = (d: string, ctx: ToolContext) => (d.slice(0, 4) === String(ctx.asOf.getUTCFullYear()) ? fmtShortDate(d) : fmtDate(d));
const link = (name: string, href: string) => `[${name.replace(/[[\]]/g, "")}](${href})`;

function table(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}

function oppTable(rows: OpportunitySearchResult["rows"], ctx: ToolContext): string {
  return table(
    ["Opportunity", "Account", "Stage", "Amount", "Expected value", "Close"],
    rows.map((r) => [link(r.name, r.href), link(r.account, r.account_href), r.stage, money(r.amount), money(r.expected_value), day(r.close_date, ctx)]),
  );
}

/* ----------------------------------------------------------------- intents */

type Answer = OfflineAnswer;

async function pipeline(ctx: ToolContext, where?: { area: Area; label: string }): Promise<Answer> {
  if (where) {
    const run = await runTool("search_opportunities", { ...areaArg(where.area), open_only: true, sort_by: "expected_value", limit: 10 }, ctx);
    const r = run.result as OpportunitySearchResult;
    if (!r.total_matches) return { markdown: `There are no open deals in ${where.label} as of ${fmtDate(ctx.asOf)}.`, accountIds: [], exportable: false };
    return {
      markdown: `**Open pipeline in ${where.label}:** ${money(r.total_amount)} across ${plural(r.total_matches, "deal")} (expected value ${money(r.total_expected_value)}) as of ${fmtDate(ctx.asOf)}.\n\nTop deals by expected value:\n\n${oppTable(r.rows, ctx)}`,
      accountIds: run.accountIds,
      exportable: true,
    };
  }
  const run = await runTool("get_pipeline_summary", {}, ctx);
  const r = run.result as PipelineSummaryResult;
  const stages = table(
    ["Stage", "Deals", "Amount"],
    r.by_stage.map((s) => [s.stage, s.count, money(s.amount)]),
  );
  const segs = table(
    ["Segment", "Deals", "Amount", "Expected value"],
    r.by_segment.map((s) => [s.segment, s.count, money(s.amount), money(s.expected_value)]),
  );
  const l = r.last_90_days;
  return {
    markdown: `**Open pipeline:** ${money(r.open_amount)} across ${r.open_count} deals as of ${fmtDate(ctx.asOf)}, with an expected value of ${money(r.open_expected_value)} at current segment win rates.

In the last 90 days we won ${l.won_count} deals (${money(l.won_amount)}) and lost ${l.lost_count} (${money(l.lost_amount)}).

**By stage**

${stages}

**By segment**

${segs}

**Top 5 open deals by expected value**

${oppTable(r.top_open_by_expected_value.slice(0, 5), ctx)}`,
    accountIds: run.accountIds,
    exportable: true,
  };
}

async function topDeals(ctx: ToolContext, n: number, where?: { area: Area; label: string }): Promise<Answer> {
  const run = await runTool("search_opportunities", { ...(where ? areaArg(where.area) : {}), open_only: true, sort_by: "expected_value", limit: n }, ctx);
  const r = run.result as OpportunitySearchResult;
  const scope = where ? ` in ${where.label}` : "";
  if (!r.total_matches) return { markdown: `There are no open deals${scope} as of ${fmtDate(ctx.asOf)}.`, accountIds: [], exportable: false };
  return {
    markdown: `**${r.rows.length === 1 ? "Top open deal" : `Top ${r.rows.length} open deals`}${scope} by expected value** (amount x segment win rate), as of ${fmtDate(ctx.asOf)}. ${plural(r.total_matches, "open deal")} in total, ${money(r.total_amount)}.\n\n${oppTable(r.rows, ctx)}`,
    accountIds: run.accountIds,
    exportable: true,
  };
}

async function topProspects(ctx: ToolContext, n: number, where?: { area: Area; label: string }): Promise<Answer> {
  const run = await runTool("search_accounts", { ...(where ? areaArg(where.area) : {}), customer: false, sort_by: "score", limit: n }, ctx);
  const r = run.result as AccountSearchResult;
  const scope = where ? ` in ${where.label}` : "";
  if (!r.total_matches) return { markdown: `No prospect accounts found${scope}.`, accountIds: [], exportable: false };
  return {
    markdown: `**${r.rows.length === 1 ? "Top prospect" : `Top ${r.rows.length} prospects`}${scope}** by prospect score, as of ${fmtDate(ctx.asOf)}.\n\n${table(
      ["Account", "Segment", "Location", "Score", "Contact status", "Open pipeline"],
      r.rows.map((a) => [link(a.name, a.href), a.segment, `${a.city}, ${a.state}`, a.score, contactStatus(a, ctx), a.open_pipeline ? money(a.open_pipeline) : "—"]),
    )}`,
    accountIds: run.accountIds,
    exportable: true,
  };
}

function contactStatus(a: AccountSearchResult["rows"][number], ctx: ToolContext): string {
  if (a.blackout === "harvest no-contact" && a.blackout_ends) return `No contact to ${day(a.blackout_ends, ctx)}`;
  if (a.blackout === "planting (light)") return "Planting (light)";
  return a.blackout === "year-round segment" ? "Open (year-round)" : "Open";
}

async function blackout(ctx: ToolContext, q: string, where?: { area: Area; label: string }): Promise<Answer> {
  const coops = /co-?ops?\b|cooperative/.test(q);
  const args = { ...(where ? areaArg(where.area) : {}), ...(coops ? { segment: "Multi-Location Co-op" } : {}), in_blackout: true, sort_by: "blackout_end", limit: 15 };
  const run = await runTool("search_accounts", args, ctx);
  const r = run.result as AccountSearchResult;
  const who = coops ? "co-ops" : "accounts";
  const scope = where ? ` in ${where.label}` : "";
  if (!r.total_matches) {
    const season = (await runTool("get_season_status", { region: where ? (where.area.state ?? where.area.regionId) : "IA" }, ctx)).result as SeasonStatusResult;
    const next = season.elevator_blackouts.find((b) => b.kind === "no-contact");
    return {
      markdown: `No ${who}${scope} are in the harvest no-contact period as of ${fmtDate(ctx.asOf)}.${next ? ` This year's harvest blackout at that latitude runs ${fmtShortDate(next.start)} to ${fmtShortDate(next.end)}.` : ""} The current selling window is **${season.selling_window.name}**: ${season.selling_window.summary}`,
      accountIds: [],
      exportable: false,
    };
  }
  const first = r.rows[0];
  return {
    markdown: `**${r.total_matches} ${r.total_matches === 1 ? who.replace(/s$/, "") : who}${scope} ${r.total_matches === 1 ? "is" : "are"} in the harvest no-contact period** as of ${fmtDate(ctx.asOf)}. The first to come out is ${link(first.name, first.href)} on ${day(first.blackout_ends!, ctx)} (first contact ${day(first.resume_date!, ctx)}).

${table(
  ["Account", "Segment", "Location", "Blackout ends", "First contact", "Score"],
  r.rows.map((a) => [link(a.name, a.href), a.segment, `${a.city}, ${a.state}`, day(a.blackout_ends!, ctx), day(a.resume_date!, ctx), a.score ?? "Customer"]),
)}${r.total_matches > r.rows.length ? `

Showing the ${r.rows.length} leaving blackout soonest of ${r.total_matches}.` : ""}

Ethanol plants, feed mills and processors run year-round and can be contacted now.`,
    accountIds: run.accountIds,
    exportable: true,
  };
}

async function segments(ctx: ToolContext): Promise<Answer> {
  const run = await runTool("get_segment_stats", {}, ctx);
  const r = run.result as SegmentStatsResult;
  const best = r.segments[0];
  return {
    markdown: `**${best.segment}** is the top-priority segment this month (priority score ${best.priority_score}), with a ${best.win_rate_pct}% win rate (95% range ${best.win_rate_low_pct}–${best.win_rate_high_pct}%, ${best.confidence.toLowerCase()}).

${table(
  ["Rank", "Segment", "Priority", "Win rate", "95% range", "Decided", "Median days", "Open pipeline"],
  r.segments.map((s) => [
    s.rank,
    s.segment,
    s.priority_score,
    `${s.win_rate_pct}%`,
    `${s.win_rate_low_pct}–${s.win_rate_high_pct}%`,
    `${s.decided} (${s.confidence})`,
    s.median_days_to_close ?? "—",
    money(s.open_pipeline),
  ]),
)}

Priority combines this month's win rate with deal size, cycle speed, product fit and expansion potential.`,
    accountIds: [],
    exportable: true,
  };
}

async function summarize(ctx: ToolContext, where: { area: Area; label: string }, commodity?: string): Promise<Answer> {
  const region = where.area.state ?? where.area.regionId!;
  const run = await runTool("get_region_insights", { region, ...(commodity ? { commodity } : {}) }, ctx);
  const r = run.result as RegionInsightsResult;
  const top = r.top_prospects.length
    ? `\n\n**Top potential customers**\n\n${table(
        ["Account", "Segment", "Location", "Score", "Est. deal", "Contact status"],
        r.top_prospects.map((t) => [link(t.name, t.href), t.segment, `${t.city}, ${t.state}`, t.score, money(t.est_deal), t.contact_status]),
      )}`
    : "";
  return {
    markdown: `**${r.area}.** ${r.summary}

- ${r.facilities} facilities, ${r.customers} customers (${r.coverage})
- Open pipeline: ${money(r.open_pipeline)} across ${r.open_deals} deals
- ${r.commodity}: ${r.crop_phase.toLowerCase()} as of ${fmtDate(ctx.asOf)}
${r.insights.map((i) => `- ${i}`).join("\n")}${top}`,
    accountIds: run.accountIds,
    exportable: r.top_prospects.length > 0,
  };
}

async function season(ctx: ToolContext, where: { area: Area; label: string } | undefined, commodity: string | undefined): Promise<Answer> {
  const region = where ? (where.area.state ?? where.area.regionId!) : "IA";
  const run = await runTool("get_season_status", { region, commodity: commodity ?? ctx.commodity ?? "Corn" }, ctx);
  const r = run.result as SeasonStatusResult;
  const label = where?.label ?? "Iowa";
  if (!r.grown_here) {
    return { markdown: `${r.commodity} isn't a major crop in ${label} in the crop calendar. The current selling window is **${r.selling_window.name}**: ${r.selling_window.summary}`, accountIds: [], exportable: false };
  }
  const win = (w: { start: string; end: string } | null) => (w ? `${fmtShortDate(w.start)} – ${fmtShortDate(w.end)}` : "—");
  const hard = r.elevator_blackouts.find((b) => b.kind === "no-contact");
  return {
    markdown: `**${r.commodity} in ${label}: ${r.phase}** as of ${fmtDate(r.date)}${where?.area.level === "region" ? ` (based on ${STATE_NAMES[r.representative_state] ?? r.representative_state})` : ""}.

- Planting window: ${win(r.planting_window)}
- Harvest window: ${win(r.harvest_window)}
- Elevator and co-op harvest blackout: ${hard ? `${fmtShortDate(hard.start)} – ${fmtShortDate(hard.end)}` : "—"}${r.blackout_now ? ` (in effect now; first contact ${fmtShortDate(r.blackout_now.resume_date)})` : ""}
- Selling window: **${r.selling_window.name}** (${day(r.selling_window.start, ctx)} – ${day(r.selling_window.end, ctx)}). ${r.selling_window.summary}`,
    accountIds: [],
    exportable: false,
  };
}

/* -------------------------------------------------------------- dispatcher */

/** "How do I…" questions: point to Help Center articles */
async function howTo(question: string): Promise<OfflineAnswer | null> {
  const hits = await searchHelp(question, 3);
  if (!hits.length) return null;
  const [first, ...rest] = hits;
  const lines = [`See [${first.title}](${first.href}) in the Help Center.`, "", `> ${first.snippet}…`];
  if (rest.length) lines.push("", "Related:", ...rest.map((h) => `- [${h.title}](${h.href})`));
  return { markdown: lines.join("\n"), accountIds: [], exportable: false };
}

export async function answerOffline(question: string, ctx: ToolContext): Promise<OfflineAnswer> {
  const q = question.toLowerCase().replace(/[’']/g, "'");
  const where = findArea(question);
  const commodity = findCommodity(q);
  const n = findCount(q, 10);

  if (/\bhow (do|can|should|would) (i|we|you)\b|\bhow to\b|\bwhere (do|can) (i|we)\b|\bwhat does\b|\bwhat do .* mean\b|\bexplain\b|\bhelp (with|on|article)/.test(q)) {
    const answer = await howTo(question);
    if (answer) return answer;
  }
  if (/blackout|no[- ]contact|go(?:ne)? dark|come out of harvest/.test(q)) return blackout(ctx, q, where);
  if (/\bsegments?\b|win rates?|close rates?|prioriti[sz]e/.test(q)) return segments(ctx);
  if ((commodity || /\bcrop\b/.test(q)) && /harvest|planting|season|phase|progress|status|crop/.test(q)) return season(ctx, where, commodity);
  if (/(harvest|planting|season) (status|progress|phase)|where are we in (the )?season/.test(q)) return season(ctx, where, commodity);
  if (/\b(deals?|opportunit(y|ies)|opps?)\b/.test(q)) return topDeals(ctx, n, where);
  if (/pipeline/.test(q)) return /\btop\b|biggest|largest/.test(q) ? topDeals(ctx, n, where) : pipeline(ctx, where);
  if (/prospects?|targets?|accounts?|who should (i|we) (call|contact)|potential customers/.test(q)) return topProspects(ctx, n, where);
  if (where && /summar|overview|tell me about|how('s| is)|what's happening|insights?|about/.test(q)) return summarize(ctx, where, commodity);
  if (where) return summarize(ctx, where, commodity);
  return { markdown: HELP, accountIds: [], exportable: false };
}
