import "server-only";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { compile } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import type { HelpArticle, HelpIndexEntry, HelpMeta } from "./types";

/**
 * Help articles are MDX files in /content/help with a small front matter block:
 *
 *   ---
 *   title: Map
 *   summary: One sentence.
 *   order: 3
 *   related: [trip-planner, seasonality-rules]
 *   ---
 *
 * They are read at request time, so editing a file needs no code change.
 */
const DIR = join(process.cwd(), "content", "help");

function parseFrontMatter(raw: string): { data: Record<string, string>; body: string } {
  const m = raw.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { data, body: raw.slice(m[0].length) };
}

function toMeta(slug: string, data: Record<string, string>): HelpMeta {
  return {
    slug,
    title: data.title || slug,
    summary: data.summary || "",
    order: Number(data.order) || 99,
    related: (data.related || "")
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/** Rough plain text of an MDX body for search */
function plainText(body: string): string {
  return body
    .replace(/<Screenshot[^>]*\/>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function readAll(): Promise<{ meta: HelpMeta; body: string }[]> {
  let files: string[] = [];
  try {
    files = (await readdir(DIR)).filter((f) => f.endsWith(".mdx"));
  } catch {
    return [];
  }
  const out = await Promise.all(
    files.map(async (f) => {
      const { data, body } = parseFrontMatter(await readFile(join(DIR, f), "utf8"));
      return { meta: toMeta(f.replace(/\.mdx$/, ""), data), body };
    }),
  );
  return out.sort((a, b) => a.meta.order - b.meta.order || a.meta.title.localeCompare(b.meta.title));
}

export async function helpIndex(): Promise<HelpIndexEntry[]> {
  return (await readAll()).map(({ meta, body }) => ({ ...meta, text: plainText(body) }));
}

const compiled = new Map<string, { raw: string; article: HelpArticle }>();

export async function helpArticle(slug: string): Promise<HelpArticle | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  let raw: string;
  try {
    raw = await readFile(join(DIR, `${slug}.mdx`), "utf8");
  } catch {
    return null;
  }
  const hit = compiled.get(slug);
  if (hit && hit.raw === raw) return hit.article;
  const { data, body } = parseFrontMatter(raw);
  const code = String(await compile(body, { outputFormat: "function-body", remarkPlugins: [remarkGfm], development: false }));
  const article = { ...toMeta(slug, data), code };
  compiled.set(slug, { raw, article });
  return article;
}

/** Simple ranked search for the assistant: title hits first, then body term matches */
export async function searchHelp(query: string, limit = 3): Promise<{ slug: string; title: string; href: string; snippet: string }[]> {
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
  if (!terms.length) return [];
  const index = await helpIndex();
  return index
    .map((a) => {
      const title = a.title.toLowerCase();
      const text = `${a.summary} ${a.text}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += 5;
        const n = text.split(t).length - 1;
        score += Math.min(4, n);
      }
      const first = terms.map((t) => text.indexOf(t)).filter((i) => i >= 0).sort((x, y) => x - y)[0] ?? 0;
      const src = `${a.summary} ${a.text}`;
      const snippet = src.slice(Math.max(0, first - 60), first + 180).trim();
      return { slug: a.slug, title: a.title, href: `/help/${a.slug}`, snippet, score };
    })
    .filter((r) => r.score > 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, ...r }) => (void score, r));
}

const STOP = new Set(["how", "the", "and", "for", "what", "does", "can", "you", "with", "this", "that", "where", "when", "why", "are", "use", "get", "into", "from", "about", "help", "show", "find"]);
