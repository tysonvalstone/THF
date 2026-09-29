"use client";

import { useState } from "react";
import { Copy, Eye, Pencil } from "lucide-react";
import { toast } from "sonner";
import type { CampaignContent } from "@/types/salesforce";
import { mergeFields } from "@/lib/content/templates";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface Props {
  content: CampaignContent;
  onChange?: (c: CampaignContent) => void;
  preview?: { FirstName?: string; Company?: string; City?: string };
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success("Copied to clipboard"),
    () => toast.error("Couldn't copy"),
  );
}

export function ContentEditor({ content, onChange, preview }: Props) {
  const editable = Boolean(onChange);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const show = (t: string) => (mode === "preview" && preview ? mergeFields(t, preview) : t);
  const editing = editable && mode === "edit";

  const setLetter = (patch: Partial<CampaignContent["letter"]>) => onChange?.({ ...content, letter: { ...content.letter, ...patch } });
  const setEmail = (i: number, patch: Partial<CampaignContent["emails"][number]>) =>
    onChange?.({ ...content, emails: content.emails.map((e, j) => (j === i ? { ...e, ...patch } : e)) });

  return (
    <Tabs defaultValue="letter">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="letter">Direct mail letter</TabsTrigger>
          <TabsTrigger value="emails">Email sequence</TabsTrigger>
          <TabsTrigger value="call">Call script</TabsTrigger>
        </TabsList>
        {editable && (
          <div className="flex gap-1">
            <Button size="sm" variant={mode === "preview" ? "secondary" : "ghost"} onClick={() => setMode("preview")}>
              <Eye className="size-4" /> Preview
            </Button>
            <Button size="sm" variant={mode === "edit" ? "secondary" : "ghost"} onClick={() => setMode("edit")}>
              <Pencil className="size-4" /> Edit
            </Button>
          </div>
        )}
      </div>

      <TabsContent value="letter" className="mt-3">
        {editing ? (
          <div className="space-y-2">
            <Label className="text-xs">Headline</Label>
            <Input value={content.letter.subject} onChange={(e) => setLetter({ subject: e.target.value })} />
            <Label className="text-xs">Letter (merge fields: {"{{FirstName}}"}, {"{{Company}}"})</Label>
            <Textarea rows={22} value={content.letter.body} onChange={(e) => setLetter({ body: e.target.value })} />
          </div>
        ) : (
          <article className="relative rounded-md border bg-white p-6 shadow-xs sm:p-8">
            <Button size="icon-sm" variant="ghost" className="absolute top-2 right-2" onClick={() => copy(show(content.letter.body))} aria-label="Copy letter">
              <Copy />
            </Button>
            <div className="mb-5 flex items-center justify-between border-b pb-3 text-xs text-muted-foreground">
              <span className="font-semibold tracking-wide text-primary">ThiboLiSoft</span>
              <span>Grain · Feed · Agronomy · Processing software</span>
            </div>
            <h3 className="mb-4 text-base font-semibold">{show(content.letter.subject)}</h3>
            <div className="text-sm leading-relaxed whitespace-pre-line">{show(content.letter.body)}</div>
          </article>
        )}
      </TabsContent>

      <TabsContent value="emails" className="mt-3 space-y-3">
        {content.emails.map((e, i) => (
          <div key={i} className="rounded-md border bg-card">
            <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
              <span>
                Email {i + 1} · Day {e.sendOffsetDays}
              </span>
              {!editing && (
                <Button size="icon-xs" variant="ghost" onClick={() => copy(`${show(e.subject)}\n\n${show(e.body)}`)} aria-label={`Copy email ${i + 1}`}>
                  <Copy />
                </Button>
              )}
            </div>
            <div className="space-y-2 p-4">
              {editing ? (
                <>
                  <Input value={e.subject} onChange={(ev) => setEmail(i, { subject: ev.target.value })} />
                  <Textarea rows={10} value={e.body} onChange={(ev) => setEmail(i, { body: ev.target.value })} />
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">{show(e.subject)}</p>
                  <p className="text-sm whitespace-pre-line text-foreground/85">{show(e.body)}</p>
                </>
              )}
            </div>
          </div>
        ))}
      </TabsContent>

      <TabsContent value="call" className="mt-3">
        <div className="space-y-4 rounded-md border bg-card p-5 text-sm">
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Opener</h4>
            <p className="mt-1">{show(content.callScript.opener)}</p>
          </section>
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Discovery questions</h4>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              {content.callScript.discovery.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ol>
          </section>
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Value points</h4>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {content.callScript.valuePoints.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </section>
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Objection handling</h4>
            <dl className="mt-1 space-y-2">
              {content.callScript.objections.map((o) => (
                <div key={o.objection}>
                  <dt className="font-medium">&ldquo;{o.objection}&rdquo;</dt>
                  <dd className="text-foreground/85">{o.response}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Close</h4>
            <p className="mt-1">{content.callScript.close}</p>
          </section>
        </div>
      </TabsContent>
    </Tabs>
  );
}
