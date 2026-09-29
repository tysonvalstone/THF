"use client";

import { useEffect, useState } from "react";
import type { CampaignContent } from "@/types/salesforce";

/** Whether the server has an ANTHROPIC_API_KEY configured (checked once per page load) */
let availability: Promise<boolean> | null = null;
export function useAiAvailable(): boolean | null {
  const [value, setValue] = useState<boolean | null>(null);
  useEffect(() => {
    availability ??= fetch("/api/generate")
      .then((r) => r.json())
      .then((j: { aiAvailable: boolean }) => j.aiAvailable)
      .catch(() => false);
    let live = true;
    availability.then((v) => live && setValue(v));
    return () => {
      live = false;
    };
  }, []);
  return value;
}

export async function aiCampaign(template: CampaignContent, facts: Record<string, unknown>): Promise<CampaignContent> {
  try {
    const r = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "campaign", template, facts }),
    });
    if (!r.ok) return template;
    const j = (await r.json()) as CampaignContent;
    return j.letter && j.emails ? j : template;
  } catch {
    return template;
  }
}

export async function aiEmail(
  template: { subject: string; body: string },
  facts: Record<string, unknown>,
): Promise<{ subject: string; body: string; source: "ai" | "template" }> {
  try {
    const r = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "email", template, facts }),
    });
    if (!r.ok) return { ...template, source: "template" };
    const j = (await r.json()) as { subject: string; body: string; source: "ai" | "template" };
    return j.subject && j.body ? j : { ...template, source: "template" };
  } catch {
    return { ...template, source: "template" };
  }
}
