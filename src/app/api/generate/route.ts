import Anthropic from "@anthropic-ai/sdk";
import type { CampaignContent } from "@/types/salesforce";

/**
 * Server-side AI copy generation. The API key never leaves the server.
 * Every request carries the template version as `template`; if there is no
 * ANTHROPIC_API_KEY, or the call fails or is declined, that template is
 * returned unchanged so the demo never breaks.
 */

export const maxDuration = 60;

const MODEL = "claude-opus-5-5";

const SYSTEM = `You are a senior B2B copywriter for ThiboLiSoft, a company that sells grain accounting, scale ticketing, merchandising, feed mill, agronomy and processing software to agribusinesses in the United States and Canada (grain elevators, co-ops, ethanol plants, feed mills, oilseed crushers, flour mills, seed processors and agronomy retailers).

Write like an experienced ag-industry sales rep: plain, specific, respectful of how busy these operators are during their season. Use accurate industry language where it fits (scale tickets, grade and dockage, shrink, drying charges, DP/delayed price, basis, carry, settlements, deferred payments, 1099s/T5018s, patronage, DDGS, crush margin, VFD, prepay, custom application). Never use hype, emojis or exclamation marks.

Rules:
- Ground every claim in the facts provided. Do not invent statistics, customer names or product capabilities beyond what's given.
- Keep merge fields such as {{FirstName}} and {{Company}} exactly as written when they appear in the draft.
- Plain text only (no markdown). Bullets may use "•".
- Keep roughly the same length and structure as the draft you are given; improve relevance, specificity and flow.`;

const CAMPAIGN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["letter", "emails", "callScript"],
  properties: {
    letter: {
      type: "object",
      additionalProperties: false,
      required: ["subject", "body"],
      properties: { subject: { type: "string" }, body: { type: "string" } },
    },
    emails: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["subject", "body", "sendOffsetDays"],
        properties: { subject: { type: "string" }, body: { type: "string" }, sendOffsetDays: { type: "integer" } },
      },
    },
    callScript: {
      type: "object",
      additionalProperties: false,
      required: ["opener", "discovery", "valuePoints", "objections", "close"],
      properties: {
        opener: { type: "string" },
        discovery: { type: "array", items: { type: "string" } },
        valuePoints: { type: "array", items: { type: "string" } },
        objections: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["objection", "response"],
            properties: { objection: { type: "string" }, response: { type: "string" } },
          },
        },
        close: { type: "string" },
      },
    },
  },
} as const;

const EMAIL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: { subject: { type: "string" }, body: { type: "string" } },
} as const;

type GenerateRequest =
  | { kind: "campaign"; facts: Record<string, unknown>; template: CampaignContent }
  | { kind: "email"; facts: Record<string, unknown>; template: { subject: string; body: string } };

function client(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ timeout: 55_000, maxRetries: 1 });
}

async function generateJson(anthropic: Anthropic, prompt: string, schema: Record<string, unknown>): Promise<unknown | null> {
  const response = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return null;
  return JSON.parse(text.text);
}

function isCampaignContent(x: unknown): x is Omit<CampaignContent, "source"> {
  const c = x as CampaignContent;
  return (
    !!c &&
    typeof c.letter?.body === "string" &&
    Array.isArray(c.emails) &&
    c.emails.length >= 1 &&
    c.emails.every((e) => typeof e.subject === "string" && typeof e.body === "string") &&
    typeof c.callScript?.opener === "string" &&
    Array.isArray(c.callScript.discovery)
  );
}

export async function GET() {
  return Response.json({ aiAvailable: Boolean(process.env.ANTHROPIC_API_KEY), model: process.env.ANTHROPIC_API_KEY ? MODEL : null });
}

export async function POST(req: Request) {
  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.template || (body.kind !== "campaign" && body.kind !== "email")) {
    return Response.json({ error: "Expected { kind, facts, template }" }, { status: 400 });
  }

  const anthropic = client();
  if (!anthropic) return Response.json({ source: "template", reason: "no-api-key", ...body.template });

  const facts = JSON.stringify(body.facts ?? {}, null, 2);
  try {
    if (body.kind === "campaign") {
      const prompt = `Rewrite this seasonal sales campaign so it lands with the audience below. Keep 3 emails with the same send offsets, a direct-mail letter, and a call script with the same sections.

<facts>
${facts}
</facts>

<draft>
${JSON.stringify({ letter: body.template.letter, emails: body.template.emails, callScript: body.template.callScript }, null, 2)}
</draft>`;
      const out = await generateJson(anthropic, prompt, CAMPAIGN_SCHEMA);
      if (!isCampaignContent(out)) return Response.json({ ...body.template, source: "template", reason: "invalid-output" });
      return Response.json({ ...out, source: "ai" });
    }

    const prompt = `Rewrite this one-to-one sales email for the prospect below. Make it feel written for this facility, this season and this person. Under 150 words.

<facts>
${facts}
</facts>

<draft>
Subject: ${body.template.subject}

${body.template.body}
</draft>`;
    const out = (await generateJson(anthropic, prompt, EMAIL_SCHEMA)) as { subject?: string; body?: string } | null;
    if (!out?.subject || !out.body) return Response.json({ ...body.template, source: "template", reason: "invalid-output" });
    return Response.json({ subject: out.subject, body: out.body, source: "ai" });
  } catch (error) {
    const reason =
      error instanceof Anthropic.AuthenticationError
        ? "auth"
        : error instanceof Anthropic.RateLimitError
          ? "rate-limited"
          : error instanceof Anthropic.APIError
            ? `api-${error.status}`
            : "error";
    console.error("[generate] falling back to template:", reason);
    return Response.json({ ...body.template, source: "template", reason });
  }
}
