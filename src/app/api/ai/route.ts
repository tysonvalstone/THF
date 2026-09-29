import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaContentBlockParam, BetaMessageParam, BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { loadAppData } from "@/lib/data/server";
import { PRODUCTS } from "@/data/reference/products";
import { REGIONS } from "@/data/reference/regions";
import { EXPORT_FIELDS, fieldCatalogText } from "@/lib/exports/fields";
import { answerOffline } from "@/lib/ai/fallback";
import { TOOL_DEFINITIONS, TOOL_STATUS, isToolName, parseState, runTool, type ToolContext } from "@/lib/ai/tools";
import { addDays, parseDate, toISODate } from "@/lib/dates";
import { SEGMENTS } from "@/types/salesforce";
import {
  MERGE_FIELDS,
  SEASON_PHASES,
  VARIANT_FIELDS,
  type AiJsonRequest,
  type ChatContext,
  type ChatEvent,
  type ChatMessage,
  type ChatRequest,
  type DraftSequenceResponse,
  type ExportColumn,
  type ExportFilter,
  type ExportFormat,
  type ExportSort,
  type ExportSource,
  type ExportSpecResponse,
  type FilterOp,
  type RewriteStepResponse,
  type SequenceStep,
  type SourceKind,
  type StepType,
  type StepVariant,
  type TripParseRequest,
  type TripParseResponse,
  type VariantRule,
} from "@/lib/ai/types";

/**
 * AI assistant backend. The API key never leaves the server.
 * - kind "chat": NDJSON stream of ChatEvent lines. Without ANTHROPIC_API_KEY
 *   (or when the API fails before any text), answers come from the offline
 *   intent matcher over the same read-only tools.
 * - kinds "export-spec", "draft-sequence", "rewrite-step", "trip-parse":
 *   one structured-output call each; `{ ok: false, reason }` without a key.
 */

export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_ITERATIONS = 8;
const MAX_HISTORY = 20;
const MAX_ACCOUNT_IDS = 100;

function client(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ timeout: 55_000, maxRetries: 1 });
}

function errorReason(error: unknown): string {
  return error instanceof Anthropic.AuthenticationError
    ? "auth"
    : error instanceof Anthropic.RateLimitError
      ? "rate-limited"
      : error instanceof Anthropic.APIError
        ? `api-${error.status}`
        : "error";
}

/* ---------------------------------------------------------------- context */

const clip = (s: unknown, max: number) => (typeof s === "string" ? s.slice(0, max) : "");

function normalizeContext(c: unknown): ChatContext {
  const x = (c && typeof c === "object" ? c : {}) as Partial<ChatContext>;
  const asOf = typeof x.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.asOf) && !Number.isNaN(parseDate(x.asOf).getTime()) ? x.asOf : toISODate(new Date());
  return {
    asOf,
    commodity: clip(x.commodity, 40) || undefined,
    page: clip(x.page, 200) || "/",
    pageTitle: clip(x.pageTitle, 120) || undefined,
  };
}

async function toolContext(ctx: ChatContext): Promise<ToolContext> {
  const app = await loadAppData();
  return { data: app.snapshot, asOf: parseDate(ctx.asOf), mode: app.mode, lightningBaseUrl: app.lightningBaseUrl, commodity: ctx.commodity };
}

/* ------------------------------------------------------------------- chat */

function chatSystem(ctx: ChatContext, mode: ToolContext["mode"]): string {
  const products = PRODUCTS.map((p) => `- ${p.Name}: ${p.Description}`).join("\n");
  return `You are the sales assistant inside HarvestSignal, the prospecting app used by ThiboLiSoft's sales team. ThiboLiSoft sells agribusiness software to grain elevators, co-ops, river terminals, shuttle loaders, ethanol plants, feed mills and processors in the United States and Canada:
${products}

Selling seasonality matters: elevator and co-op buyers go dark during harvest (mid-August to Thanksgiving, later going north and in Canada) and lightly during spring planting. Ethanol plants, feed mills and processors buy year-round.

<context>
Treat ${ctx.asOf} as today (the app is time-travelled to this date; all figures are as of it).
Current page: ${ctx.pageTitle ? `${ctx.pageTitle} (${ctx.page})` : ctx.page}
Selected commodity: ${ctx.commodity ?? "none"}
Data: ${mode === "live" ? "live, read-only Salesforce connection" : "mock Salesforce data (demo org)"}
</context>

How to answer:
- Use the tools for every figure, account, deal, win rate or date. Never invent numbers or records; if the tools can't answer, say so.
- Be concise: lead with the answer in a sentence or two, then the detail. Use markdown.
- Use GFM tables for lists of records (at most 10-15 rows; say how many more matched).
- Link every account and opportunity name with the href the tool returned, as a markdown link: [Name](href).
- Format money like $1.2M or $85K and dates like Oct 14.
- No emoji. Do not add a sources line; the app shows sources.
- For how-to questions about using HarvestSignal, call search_help and link the matching article(s) as markdown links, e.g. [Trip Planner](/help/trip-planner).
- Use web search only for outside information (market news, weather, company background), never for pipeline or account data.${mode === "live" ? "\n- run_soql is a last resort for questions the other tools can't answer; keep queries small." : ""}`;
}

function cleanHistory(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  const out = messages
    .filter((m): m is ChatMessage => !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0)
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

const LINK_RE = /\]\((?:\/accounts\/|\/opportunities\/|\/leads\/|https:\/\/[^)\s]*\/lightning\/r\/)/g;
function isExportable(markdown: string): boolean {
  return /^\s*\|?\s*:?-{3,}/m.test(markdown) || (markdown.match(LINK_RE)?.length ?? 0) >= 3;
}

/** Offline answer as a few text chunks plus `done` */
async function streamOffline(question: string, tctx: ToolContext, emit: (e: ChatEvent) => void, textSoFar = false) {
  const a = await answerOffline(question, tctx);
  const text = (textSoFar ? "\n\n" : "") + a.markdown;
  const parts = text.split(/(?<=\n\n)/);
  for (const p of parts) emit({ type: "text", text: p });
  emit({ type: "done", sources: [tctx.mode === "live" ? "Salesforce" : "Platform data"], offline: true, accountIds: a.accountIds.slice(0, MAX_ACCOUNT_IDS), exportable: a.exportable });
}

/**
 * After a mid-output server-side fallback, blocks before the last `fallback`
 * marker that the next model can't take back (thinking, tool_use, unpaired
 * server tool calls) are dropped.
 */
function echoable(content: BetaContentBlock[]): BetaContentBlock[] {
  const last = content.map((b) => b.type).lastIndexOf("fallback");
  if (last < 0) return content;
  const resultIds = new Set(content.flatMap((b) => ("tool_use_id" in b && typeof b.tool_use_id === "string" ? [b.tool_use_id] : [])));
  return content.filter(
    (b, i) => i > last || !(b.type === "thinking" || b.type === "redacted_thinking" || b.type === "tool_use" || (b.type === "server_tool_use" && !resultIds.has(b.id))),
  );
}

async function runChat(anthropic: Anthropic, history: ChatMessage[], ctx: ChatContext, tctx: ToolContext, emit: (e: ChatEvent) => void, signal: AbortSignal) {
  const sources = new Set<SourceKind>();
  const accountIds = new Set<string>();
  let answer = "";
  const tools = [
    ...TOOL_DEFINITIONS.filter((t) => t.name !== "run_soql" || tctx.mode === "live").map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as unknown as { type: "object"; properties?: Record<string, unknown>; required?: string[] },
      eager_input_streaming: true,
    })),
    { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 3 },
  ];
  const messages: BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
  const say = (text: string) => {
    if (!text) return;
    answer += text;
    emit({ type: "text", text });
  };

  let jsonRetries = 0;
  let finished = false;
  for (let i = 0; i < MAX_ITERATIONS && !finished; i++) {
    const stream = anthropic.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system: chatSystem(ctx, tctx.mode),
        tools,
        messages,
      },
      { signal },
    );

    let iterationText = false;
    let message;
    try {
      for await (const ev of stream) {
        if (ev.type === "content_block_start") {
          const b = ev.content_block;
          if (b.type === "tool_use") emit({ type: "status", text: isToolName(b.name) ? TOOL_STATUS[b.name] : "Working" });
          else if (b.type === "server_tool_use" && b.name === "web_search") emit({ type: "status", text: "Searching the web" });
          else if (b.type === "web_search_tool_result") sources.add("Web");
        } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && ev.delta.text) {
          // Separate text written before and after a round of tool calls
          if (!iterationText && answer && !answer.endsWith("\n")) say("\n\n");
          iterationText = true;
          say(ev.delta.text);
        }
      }
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // Unparseable streamed tool input: re-issue the turn if nothing was shown yet
      if (err instanceof Anthropic.APIError || signal.aborted || iterationText || jsonRetries++ >= 2) throw err;
      continue;
    }

    const content = echoable(message.content);
    const toolUses = content.filter((b) => b.type === "tool_use");
    switch (message.stop_reason) {
      case "refusal":
        say(answer ? "\n\nI can't help with that." : "Sorry, I can't help with that request.");
        finished = true;
        break;
      case "pause_turn":
        // Server tool (web search) paused mid-turn: send the turn back to continue
        messages.push({ role: "assistant", content: content as BetaContentBlockParam[] });
        break;
      case "tool_use": {
        if (!toolUses.length) {
          finished = true;
          break;
        }
        messages.push({ role: "assistant", content: content as BetaContentBlockParam[] });
        const results: BetaToolResultBlockParam[] = [];
        for (const t of toolUses) {
          const valid = t.input && typeof t.input === "object" && !Array.isArray(t.input);
          if (!valid || !isToolName(t.name)) {
            results.push({ type: "tool_result", tool_use_id: t.id, is_error: true, content: JSON.stringify({ error: "Invalid tool input", input: JSON.stringify(t.input ?? null) }) });
            continue;
          }
          const run = await runTool(t.name, t.input, tctx);
          sources.add(run.source);
          for (const id of run.accountIds) if (accountIds.size < MAX_ACCOUNT_IDS) accountIds.add(id);
          const isError = !!run.result && typeof run.result === "object" && "error" in run.result;
          results.push({ type: "tool_result", tool_use_id: t.id, content: JSON.stringify(run.result), ...(isError ? { is_error: true } : {}) });
        }
        messages.push({ role: "user", content: results });
        break;
      }
      default:
        // end_turn, max_tokens (text is kept as is), stop_sequence, etc.
        finished = true;
    }
  }
  if (!finished && !answer) say("I couldn't finish that within the step limit. Try a narrower question, for example one state or segment.");

  emit({ type: "done", sources: [...sources], offline: false, accountIds: [...accountIds], exportable: isExportable(answer) });
  return answer;
}

function chatResponse(body: ChatRequest, req: Request): Response {
  const history = cleanHistory(body.messages);
  const ctx = normalizeContext(body.context);
  const question = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let emittedText = false;
      const emit = (e: ChatEvent) => {
        if (closed) return;
        if (e.type === "text") emittedText = true;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      let tctx: ToolContext;
      try {
        tctx = await toolContext(ctx);
      } catch (err) {
        console.error("[ai] data load failed:", err instanceof Error ? err.message : err);
        emit({ type: "error", message: "Could not load data." });
        return close();
      }

      const anthropic = client();
      try {
        if (!anthropic || !question) {
          await streamOffline(question, tctx, emit);
        } else {
          try {
            await runChat(anthropic, history, ctx, tctx, emit, req.signal);
          } catch (err) {
            if (req.signal.aborted) return close();
            const reason = errorReason(err);
            console.error("[ai] chat failed:", reason, err instanceof Error && reason === "error" ? err.message : "");
            if (!emittedText) {
              emit({ type: "status", text: "Answering offline" });
              await streamOffline(question, tctx, emit);
            } else {
              emit({ type: "error", message: reason === "rate-limited" ? "The AI service is busy. Try again in a moment." : "The answer was interrupted. Try again." });
            }
          }
        }
      } catch (err) {
        console.error("[ai] offline answer failed:", err instanceof Error ? err.message : err);
        emit({ type: "error", message: "Something went wrong answering that." });
      }
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/* ------------------------------------------------------------- JSON calls */

const COPY_RULES = `Write like an experienced ag-industry sales rep: plain, specific, respectful of how busy these operators are during their season. Use accurate industry language where it fits (scale tickets, grade and dockage, shrink, drying charges, DP/delayed price, basis, carry, settlements, deferred payments, 1099s/T5018s, patronage, DDGS, crush margin, prepay). Never use hype, emojis or exclamation marks. Do not invent statistics, customer names or product capabilities. Plain text only (no markdown).`;

async function generateJson(anthropic: Anthropic, system: string, prompt: string, schema: Record<string, unknown>): Promise<unknown | null> {
  const response = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return null;
  try {
    return JSON.parse(text.text);
  } catch {
    return null;
  }
}

const SOURCES: ExportSource[] = ["opportunities", "accounts", "contacts", "segments"];
const FILTER_OPS: FilterOp[] = ["eq", "neq", "in", "contains", "gt", "gte", "lt", "lte", "isTrue", "isFalse"];
const FORMATS: ExportFormat[] = ["csv", "xlsx", "pdf"];
const STEP_TYPES: StepType[] = ["email", "call", "linkedin"];

const EXPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "description", "source", "filters", "columns", "groupBy", "sort", "totals", "format"],
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    source: { type: "string", enum: SOURCES },
    filters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "op", "value"],
        properties: { field: { type: "string" }, op: { type: "string", enum: FILTER_OPS }, value: { type: "string" } },
      },
    },
    columns: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["field", "label"], properties: { field: { type: "string" }, label: { type: "string" } } },
    },
    groupBy: { anyOf: [{ type: "string" }, { type: "null" }] },
    sort: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "dir"],
        properties: { field: { type: "string" }, dir: { type: "string", enum: ["asc", "desc"] } },
      },
    },
    totals: { type: "array", items: { type: "string" } },
    format: { type: "string", enum: FORMATS },
  },
};

async function exportSpec(anthropic: Anthropic, prompt: string, ctx: ChatContext): Promise<ExportSpecResponse> {
  const system = `You design report templates for HarvestSignal, a sales app for an agribusiness software company. Turn the user's request into an export spec using only the fields in the catalog for the chosen source.`;
  const user = `Today is ${ctx.asOf} (use it to resolve relative dates such as "this quarter" or "next 30 days" into YYYY-MM-DD filter values).

<field_catalog>
${fieldCatalogText()}
</field_catalog>

Rules:
- Pick one source. Every filter, column, sort, groupBy and totals field must be a key from that source's catalog line.
- Filter values are strings: plain text for eq/neq/contains, a comma-separated list for "in", a number or YYYY-MM-DD for gt/gte/lt/lte, and "" for isTrue/isFalse. State values are 2-letter codes.
- Choose 4-10 useful columns in a sensible order; label them for a sales manager.
- totals only for number or currency fields. groupBy is null for a flat list.
- Default format xlsx unless the request says CSV, PDF or Salesforce import (csv).
- name is a short title (under 60 characters); description is one sentence.

<request>
${prompt.slice(0, 4000)}
</request>`;
  const out = (await generateJson(anthropic, system, user, EXPORT_SCHEMA)) as Record<string, unknown> | null;
  if (!out || !SOURCES.includes(out.source as ExportSource)) return { ok: false, reason: "invalid-output" };
  const source = out.source as ExportSource;
  const known = new Set(EXPORT_FIELDS[source].map((f) => f.key));
  const numeric = new Set(EXPORT_FIELDS[source].filter((f) => f.type === "number" || f.type === "currency").map((f) => f.key));
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]).filter((x) => x && typeof x === "object") : []);

  const filters: ExportFilter[] = arr(out.filters)
    .filter((f) => known.has(String(f.field)) && FILTER_OPS.includes(f.op as FilterOp))
    .map((f) => ({ field: String(f.field), op: f.op as FilterOp, ...(f.op === "isTrue" || f.op === "isFalse" ? {} : { value: String(f.value ?? "") }) }));
  const seen = new Set<string>();
  let columns: ExportColumn[] = arr(out.columns)
    .filter((c) => known.has(String(c.field)) && !seen.has(String(c.field)) && seen.add(String(c.field)))
    .map((c) => ({ field: String(c.field), ...(typeof c.label === "string" && c.label.trim() ? { label: c.label.trim().slice(0, 60) } : {}) }));
  if (!columns.length) columns = EXPORT_FIELDS[source].slice(0, 6).map((f) => ({ field: f.key }));
  const sort: ExportSort[] = arr(out.sort)
    .filter((s) => known.has(String(s.field)))
    .map((s) => ({ field: String(s.field), dir: s.dir === "asc" ? "asc" : "desc" }));
  const totals = (Array.isArray(out.totals) ? out.totals : []).map(String).filter((t) => numeric.has(t));
  const groupBy = typeof out.groupBy === "string" && known.has(out.groupBy) ? out.groupBy : null;
  return {
    ok: true,
    spec: {
      name: clip(out.name, 80).trim() || "Custom export",
      description: clip(out.description, 300).trim() || undefined,
      source,
      filters,
      columns,
      groupBy,
      sort,
      totals: [...new Set(totals)],
      format: FORMATS.includes(out.format as ExportFormat) ? (out.format as ExportFormat) : "xlsx",
    },
  };
}

const RULE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["field", "op", "value"],
  properties: { field: { type: "string", enum: VARIANT_FIELDS }, op: { type: "string", enum: ["eq", "neq"] }, value: { type: "string" } },
};

const SEQUENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "description", "segment", "month", "steps"],
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    segment: { type: "string" },
    month: { type: "integer" },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "day", "subject", "body", "variants"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: STEP_TYPES },
          day: { type: "integer" },
          subject: { type: "string" },
          body: { type: "string" },
          variants: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "name", "rules", "subject", "body"],
              properties: { id: { type: "string" }, name: { type: "string" }, rules: { type: "array", items: RULE_SCHEMA }, subject: { type: "string" }, body: { type: "string" } },
            },
          },
        },
      },
    },
  },
};

const mergeList = MERGE_FIELDS.map((f) => `{{${f}}}`).join(", ");

function validRule(r: Record<string, unknown>): VariantRule | null {
  const field = r.field as VariantRule["field"];
  if (!VARIANT_FIELDS.includes(field)) return null;
  const value = clip(r.value, 80).trim();
  if (!value) return null;
  if (field === "season_phase" && !SEASON_PHASES.includes(value.toLowerCase() as (typeof SEASON_PHASES)[number])) return null;
  return { field, op: r.op === "neq" ? "neq" : "eq", value: field === "season_phase" ? value.toLowerCase() : value };
}

async function draftSequence(anthropic: Anthropic, input: { goal: string; segment: string; season: string }, ctx: ChatContext): Promise<DraftSequenceResponse> {
  const system = `You write multi-step B2B sales outreach sequences for ThiboLiSoft, which sells grain accounting, scale ticketing and grain management software (Ceres, GrainSight, ScaleTrac, GrainSight Mobile, ScaleTrac Mobile) to grain elevators, co-ops, ethanol plants, feed mills and processors in the US and Canada.

${COPY_RULES}`;
  const user = `Draft an outreach sequence.

Goal: ${clip(input.goal, 1000)}
Target segment: ${clip(input.segment, 80) || "any"}
Season: ${clip(input.season, 80) || "any"}
Today: ${ctx.asOf}

Requirements:
- 4-6 steps over about 3 weeks (day 1 to roughly day 21), mixing email, call and linkedin steps. Days are 1-based integers in ascending order.
- Email steps have a subject; call and linkedin steps use an empty subject and the body holds the call notes or LinkedIn message.
- Personalize with merge fields written exactly like {{contact.first_name}}. Available: ${mergeList}. Use no others.
- At least one step has 1-2 variants whose rules use season_phase (values: ${SEASON_PHASES.join(", ")}) or commodity (e.g. Corn, Wheat, Soybeans). Steps without variants use an empty variants array.
- Emails under 120 words; call notes are short bullets using "•".
- Respect harvest and planting: elevator and co-op buyers are busy then, so keep in-season touches brief and offer a post-harvest meeting.
- month is the suggested start month (1-12). segment is the target segment name.
- Step ids s1, s2, ...; variant ids v1, v2, ....`;
  const out = (await generateJson(anthropic, system, user, SEQUENCE_SCHEMA)) as Record<string, unknown> | null;
  if (!out || !Array.isArray(out.steps)) return { ok: false, reason: "invalid-output" };

  let vn = 0;
  const steps: SequenceStep[] = (out.steps as Record<string, unknown>[])
    .filter((s) => s && STEP_TYPES.includes(s.type as StepType) && typeof s.body === "string" && s.body.trim())
    .slice(0, 10)
    .map((s) => {
      const type = s.type as StepType;
      const variants: StepVariant[] = (Array.isArray(s.variants) ? (s.variants as Record<string, unknown>[]) : [])
        .map((v) => {
          const rules = (Array.isArray(v?.rules) ? (v.rules as Record<string, unknown>[]) : []).map(validRule).filter((r): r is VariantRule => !!r);
          if (!rules.length || typeof v.body !== "string" || !v.body.trim()) return null;
          return {
            id: `v${++vn}`,
            name: clip(v.name, 60).trim() || `Variant ${vn}`,
            rules,
            ...(type === "email" && clip(v.subject, 200).trim() ? { subject: clip(v.subject, 200).trim() } : {}),
            body: v.body.trim(),
          };
        })
        .filter((v): v is NonNullable<typeof v> => !!v)
        .slice(0, 3);
      return {
        id: "",
        type,
        day: Math.max(1, Math.min(90, Math.round(Number(s.day) || 1))),
        ...(type === "email" ? { subject: clip(s.subject, 200).trim() || "Following up" } : {}),
        body: (s.body as string).trim(),
        variants,
      };
    })
    .sort((a, b) => a.day - b.day)
    .map((s, i) => ({ ...s, id: `s${i + 1}` }));
  if (!steps.length) return { ok: false, reason: "invalid-output" };
  const month = Math.round(Number(out.month));
  return {
    ok: true,
    sequence: {
      name: clip(out.name, 80).trim() || "New sequence",
      description: clip(out.description, 300).trim() || undefined,
      segment: clip(out.segment, 80).trim() || clip(input.segment, 80) || undefined,
      month: month >= 1 && month <= 12 ? month : parseDate(ctx.asOf).getUTCMonth() + 1,
      steps,
    },
  };
}

const REWRITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: { subject: { type: "string" }, body: { type: "string" } },
};

const tokensIn = (s: string) => [...new Set(s.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? [])].map((t) => t.replace(/\s+/g, ""));

async function rewriteStep(anthropic: Anthropic, step: { type: StepType; subject?: string; body: string }, instruction: string, ctx: ChatContext): Promise<RewriteStepResponse> {
  const isEmail = step.type === "email";
  const required = tokensIn(`${step.subject ?? ""}\n${step.body}`);
  const system = `You edit steps of B2B sales outreach sequences for ThiboLiSoft (agribusiness software for grain elevators, co-ops, ethanol plants, feed mills and processors).

${COPY_RULES}`;
  const base = `Rewrite this ${step.type === "linkedin" ? "LinkedIn message" : step.type === "call" ? "call-notes" : "email"} step. Instruction: ${clip(instruction, 300) || "improve it"}.

Keep every merge field token exactly as written, including the double braces${required.length ? `: ${required.join(", ")}` : ""}. Do not add new merge fields other than: ${mergeList}.
${isEmail ? "Return the new subject and body." : "Return an empty subject; put the text in body."}
Today is ${ctx.asOf}.

<step>
${isEmail ? `Subject: ${step.subject ?? ""}\n\n` : ""}${step.body.slice(0, 6000)}
</step>`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt ? `${base}\n\nYour previous rewrite dropped merge fields. Every one of these must appear: ${required.join(", ")}` : base;
    const out = (await generateJson(anthropic, system, prompt, REWRITE_SCHEMA)) as { subject?: string; body?: string } | null;
    if (!out?.body?.trim()) return { ok: false, reason: "invalid-output" };
    const got = new Set(tokensIn(`${out.subject ?? ""}\n${out.body}`));
    if (required.every((t) => got.has(t))) {
      return { ok: true, body: out.body.trim(), ...(isEmail ? { subject: (out.subject ?? "").trim() || step.subject || "" } : {}) };
    }
  }
  return { ok: false, reason: "merge-fields-lost" };
}

const TRIP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["destination", "startDate", "stops", "segment", "startCity"],
  properties: {
    destination: { type: "string" },
    startDate: { type: "string", format: "date" },
    stops: { type: "integer" },
    segment: { type: "string", enum: [...SEGMENTS, "any"] },
    startCity: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
};

async function parseTrip(anthropic: Anthropic, prompt: string, ctx: ChatContext): Promise<TripParseResponse> {
  const asOf = parseDate(ctx.asOf);
  const weekday = asOf.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const system = "You turn a sales rep's plain-words trip request into structured trip parameters for a route planner.";
  const user = `Today is ${weekday}, ${ctx.asOf}.

Extract:
- destination: a 2-letter US state or Canadian province code (e.g. IA, IL, SK), or one of these region ids: ${REGIONS.map((r) => `${r.id} (${r.name})`).join(", ")}.
- startDate: YYYY-MM-DD resolved from today. "in a month" = today + 30 days, "next week" = next Monday, "tomorrow" = today + 1. If no date is given, use the next Monday.
- stops: number of visits, 1-30. Default 10.
- segment: one of ${SEGMENTS.join(", ")}, or "any". Map "elevators" to Country Elevator, "co-ops" to Multi-Location Co-op, "ethanol" to Ethanol Plant, "feed mills" to Feed Mill, "terminals" to River Terminal, "shuttle loaders" to Rail/Shuttle Loader, "processors"/"crushers"/"flour mills" to Processor, "seed cleaners" to Seed Cleaner / Specialty Crop.
- startCity: the starting city as "City, ST" if given, else null.

<request>
${prompt.slice(0, 1000)}
</request>`;
  const out = (await generateJson(anthropic, system, user, TRIP_SCHEMA)) as Record<string, unknown> | null;
  if (!out) return { ok: false, reason: "invalid-output" };
  const rawDest = clip(out.destination, 60).trim();
  const region = REGIONS.find((r) => r.id === rawDest.toLowerCase() || r.name.toLowerCase() === rawDest.toLowerCase());
  const destination = region?.id ?? parseState(rawDest);
  if (!destination) return { ok: false, reason: "no-destination" };
  const d = typeof out.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(out.startDate) ? parseDate(out.startDate) : null;
  const startDate = d && !Number.isNaN(d.getTime()) && d >= addDays(asOf, -1) && d <= addDays(asOf, 400) ? toISODate(d) : toISODate(addDays(asOf, ((8 - asOf.getUTCDay()) % 7) || 7));
  const stops = Math.max(1, Math.min(30, Math.round(Number(out.stops) || 10)));
  const segment = (SEGMENTS as string[]).includes(String(out.segment)) ? String(out.segment) : "any";
  const startCity = clip(out.startCity, 80).trim();
  return { ok: true, trip: { destination, startDate, stops, segment, ...(startCity ? { startCity } : {}) } };
}

/* ---------------------------------------------------------------- handlers */

export async function GET() {
  const available = Boolean(process.env.ANTHROPIC_API_KEY);
  return Response.json({ aiAvailable: available, model: available ? MODEL : null });
}

type PostBody = ChatRequest | AiJsonRequest | TripParseRequest;

export async function POST(req: Request) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return Response.json({ error: "Expected a JSON object" }, { status: 400 });

  switch (body.kind) {
    case "chat":
      if (!Array.isArray(body.messages) || !cleanHistory(body.messages).length) {
        return Response.json({ error: "Expected { kind: \"chat\", messages: [{ role, content }], context }" }, { status: 400 });
      }
      return chatResponse(body, req);
    case "export-spec":
      if (typeof body.prompt !== "string" || !body.prompt.trim()) return Response.json({ error: "Expected { prompt }" }, { status: 400 });
      break;
    case "draft-sequence":
      if (typeof body.goal !== "string" || !body.goal.trim()) return Response.json({ error: "Expected { goal, segment, season }" }, { status: 400 });
      break;
    case "rewrite-step":
      if (!body.step || typeof body.step.body !== "string" || !STEP_TYPES.includes(body.step.type) || typeof body.instruction !== "string") {
        return Response.json({ error: "Expected { step: { type, subject?, body }, instruction }" }, { status: 400 });
      }
      break;
    case "trip-parse":
      if (typeof body.prompt !== "string" || !body.prompt.trim()) return Response.json({ error: "Expected { prompt }" }, { status: 400 });
      break;
    default:
      return Response.json({ error: "Unknown kind" }, { status: 400 });
  }

  const anthropic = client();
  if (!anthropic) return Response.json({ ok: false, reason: "no-api-key" });
  const ctx = normalizeContext(body.context);
  try {
    switch (body.kind) {
      case "export-spec":
        return Response.json(await exportSpec(anthropic, body.prompt, ctx));
      case "draft-sequence":
        return Response.json(await draftSequence(anthropic, { goal: body.goal, segment: String(body.segment ?? ""), season: String(body.season ?? "") }, ctx));
      case "rewrite-step":
        return Response.json(await rewriteStep(anthropic, body.step, body.instruction, ctx));
      case "trip-parse":
        return Response.json(await parseTrip(anthropic, body.prompt, ctx));
    }
  } catch (error) {
    const reason = errorReason(error);
    console.error(`[ai] ${body.kind} failed:`, reason);
    return Response.json({ ok: false, reason });
  }
}
