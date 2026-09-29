"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Phone, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/data/store";
import { contactsFor, findLead } from "@/lib/data/selectors";
import { useSender, useUserId } from "@/lib/auth";
import { REGION_BY_ID } from "@/data/reference/regions";
import type { ScoredTarget } from "@/lib/scoring";
import { preferredContact } from "@/lib/nba";
import { templateCampaignContent, templateOneToOneEmail, mergeFields } from "@/lib/content/templates";
import { playForDate } from "@/lib/content/messaging";
import { blackoutStatus } from "@/lib/seasonality";
import { aiEmail, useAiAvailable } from "@/lib/content/ai-client";
import { addToCampaign, businessDaysOut, CALL_OUTCOMES, logCall, sendEmail, type ActionResult, type CallOutcome } from "@/lib/actions/outreach";
import { campaignBuilderHref } from "@/lib/links";
import { fmtShortDate, toISODate } from "@/lib/dates";
import type { Contact } from "@/types/salesforce";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type OutreachTab = "email" | "call" | "campaign";


interface Recipient {
  id: string;
  name: string;
  firstName: string;
  title: string;
  email: string;
  phone: string;
  optedOut: boolean;
}

function toRecipient(c: Contact): Recipient {
  return { id: c.Id, name: c.Name, firstName: c.FirstName, title: c.Title, email: c.Email, phone: c.MobilePhone ?? c.Phone, optedOut: c.HasOptedOutOfEmail };
}

export function announce(result: ActionResult, title: string) {
  toast.success(title, {
    description: (
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {result.summary.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    ),
    duration: 6000,
  });
}

export function OutreachDialog({ s, open, onOpenChange, tab }: { s: ScoredTarget; open: boolean; onOpenChange: (o: boolean) => void; tab: OutreachTab }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        {open && <OutreachBody s={s} tab={tab} close={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function OutreachBody({ s, tab, close }: { s: ScoredTarget; tab: OutreachTab; close: () => void }) {
  const { data, asOf, commit, readOnly } = useStore();
  const t = s.target;
  const recipients = useMemo<Recipient[]>(() => {
    if (t.kind === "lead") {
      const l = findLead(data, t.id);
      return l ? [{ id: l.Id, name: l.Name, firstName: l.FirstName, title: l.Title, email: l.Email, phone: l.Phone, optedOut: false }] : [];
    }
    return contactsFor(data, t.id).map(toRecipient);
  }, [data, t.id, t.kind]);
  const contacts = t.kind === "account" ? contactsFor(data, t.id) : [];
  const defaultId = (t.kind === "account" ? preferredContact(s, contacts)?.Id : recipients[0]?.id) ?? recipients[0]?.id ?? "";
  const [whoId, setWhoId] = useState(defaultId);
  const who = recipients.find((r) => r.id === whoId) ?? recipients[0];
  const userId = useUserId();
  const ctx = { data, asOf, userId };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t.name}</DialogTitle>
        <DialogDescription className="line-clamp-2">{s.whyNow}</DialogDescription>
      </DialogHeader>
      <OutreachWarnings s={s} readOnly={readOnly} />
      <div className="grid gap-1.5">
        <Label className="text-xs">Contact</Label>
        <Select value={whoId} onValueChange={setWhoId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pick a contact" />
          </SelectTrigger>
          <SelectContent>
            {recipients.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name} · {r.title}
                {r.optedOut ? " (email opt-out)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Tabs defaultValue={tab} className="mt-1">
        <TabsList className="w-full">
          <TabsTrigger value="email"> Email
          </TabsTrigger>
          <TabsTrigger value="call"> Log call
          </TabsTrigger>
          <TabsTrigger value="campaign"> Campaign
          </TabsTrigger>
        </TabsList>
        <TabsContent value="email">
          {who && (
            <EmailTab
              key={who.id}
              s={s}
              who={who}
              contact={contacts.find((c) => c.Id === who.id)}
              onSend={(subject, body, scheduleFor) => {
                const result = sendEmail(ctx, { targetId: t.id, whoId: who.id, toEmail: who.email, subject, body, scheduleFor });
                commit(result.mutations);
                announce(result, scheduleFor ? "Email scheduled" : "Email sent");
                close();
              }}
            />
          )}
        </TabsContent>
        <TabsContent value="call">
          {who && (
            <CallTab
              s={s}
              who={who}
              onSave={(outcome, notes, demoDate) => {
                const result = logCall(ctx, { targetId: t.id, whoId: who.id, whoName: who.name, outcome, notes, demoDate });
                commit(result.mutations);
                announce(result, "Call logged");
                close();
              }}
            />
          )}
        </TabsContent>
        <TabsContent value="campaign">
          <CampaignTab
            s={s}
            onAdd={(campaignId) => {
              const result = addToCampaign(ctx, { campaignId, members: [{ targetId: t.id, whoId: t.kind === "account" ? who?.id : undefined }] });
              commit(result.mutations);
              announce(result, "Added to campaign");
              close();
            }}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

/** Blackout + read-only warnings shown above every outreach tab */
function OutreachWarnings({ s, readOnly }: { s: ScoredTarget; readOnly: boolean }) {
  const { asOf } = useStore();
  const t = s.target;
  const b = blackoutStatus({ Segment__c: t.segment, BillingLatitude: t.lat, BillingCountry: t.country }, asOf);
  return (
    <>
      {b.status !== "none" && (
        <p className={cn("rounded-md border p-2.5 text-sm", b.status === "hard" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-300 bg-slate-50 text-slate-700")} role="status">
          {b.message}
        </p>
      )}
      {readOnly && <p className="rounded-md border border-slate-300 bg-slate-50 p-2.5 text-sm text-slate-700">Read-only (Live Salesforce)</p>}
    </>
  );
}

function EmailTab({ s, who, contact, onSend }: { s: ScoredTarget; who: Recipient; contact?: Contact; onSend: (subject: string, body: string, scheduleFor?: string) => void }) {
  const { asOf, readOnly } = useStore();
  const SENDER = useSender();
  const blackout = blackoutStatus({ Segment__c: s.target.segment, BillingLatitude: s.target.lat, BillingCountry: s.target.country }, asOf);
  const aiAvailable = useAiAvailable();
  const draft = useMemo(
    () => templateOneToOneEmail({ s, contact: contact ?? ({ FirstName: who.firstName } as Contact), sender: SENDER, asOf }),
    [s, contact, who.firstName, asOf, SENDER],
  );
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [source, setSource] = useState<"ai" | "template">("template");
  const [busy, setBusy] = useState(false);
  const [scheduleFor, setScheduleFor] = useState(toISODate(blackout.resumeDate ?? businessDaysOut(asOf, 1)));

  const rewrite = async () => {
    setBusy(true);
    const t = s.target;
    const out = await aiEmail(
      { subject, body },
      {
        prospect: t.name,
        facilityType: t.facilityType,
        location: `${t.city}, ${t.state}`,
        region: REGION_BY_ID[t.regionId].name,
        commodities: t.commodities,
        currentSoftware: t.software,
        recipient: `${who.name}, ${who.title}`,
        whyNow: s.whyNow,
        scoreReasons: Object.values(s.factors).map((f) => f.reason),
        sender: SENDER,
        today: toISODate(asOf),
      },
    );
    setSubject(out.subject);
    setBody(out.body);
    setSource(out.source);
    setBusy(false);
    if (out.source === "template") toast.info("AI unavailable, kept the built-in template", { description: "Add ANTHROPIC_API_KEY on the server to enable AI rewriting." });
  };

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          To: <span className="text-foreground">{who.email}</span>
        </span>
        <Badge variant="outline" className={cn("gap-1", source === "ai" && "border-primary/40 text-primary")}>
          {source === "ai" ? <Sparkles className="size-3" /> : null}
          {source === "ai" ? "AI draft" : "Template draft"}
        </Badge>
      </div>
      {who.optedOut && <p className="rounded-md bg-accent p-2 text-xs text-accent-foreground">This contact has opted out of email. Pick another contact or log a call instead.</p>}
      <div className="grid gap-1.5">
        <Label htmlFor="subject" className="text-xs">
          Subject
        </Label>
        <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="body" className="text-xs">
          Message
        </Label>
        <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} rows={12} className="font-[inherit] text-sm" />
      </div>
      <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="outline" size="sm" onClick={rewrite} disabled={busy || aiAvailable === false}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Rewrite with AI
              </Button>
            </span>
          </TooltipTrigger>
          {aiAvailable === false && <TooltipContent>No ANTHROPIC_API_KEY on the server. Templates are used instead.</TooltipContent>}
        </Tooltip>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={scheduleFor} min={toISODate(asOf)} onChange={(e) => setScheduleFor(e.target.value)} className="h-8 w-38" aria-label="Schedule date" />
          <Button variant="outline" size="sm" disabled={readOnly || who.optedOut || !subject || !body} onClick={() => onSend(subject, body, scheduleFor)}>
            {blackout.status === "hard" ? `Schedule for ${fmtShortDate(scheduleFor)}` : "Schedule"}
          </Button>
          <Button size="sm" disabled={readOnly || who.optedOut || !subject || !body} onClick={() => onSend(subject, body)}>
            {blackout.status === "hard" ? "Send anyway" : "Send now"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CallTab({ s, who, onSave }: { s: ScoredTarget; who: Recipient; onSave: (outcome: CallOutcome, notes: string, demoDate?: string) => void }) {
  const { asOf, readOnly } = useStore();
  const SENDER = useSender();
  const t = s.target;
  const script = useMemo(() => {
    const content = templateCampaignContent({
      play: playForDate(asOf, t.segment),
      regionIds: [t.regionId],
      facilityTypes: [t.facilityType],
      commodity: t.commodities[0],
      asOf,
      sender: SENDER,
    });
    return content.callScript;
  }, [t.segment, t.regionId, t.facilityType, t.commodities, asOf, SENDER]);
  const [outcome, setOutcome] = useState<CallOutcome>("Connected");
  const [notes, setNotes] = useState("");
  const [demoDate, setDemoDate] = useState(toISODate(businessDaysOut(asOf, 7)));
  const merge = (x: string) => mergeFields(x, { FirstName: who.firstName, Company: t.name });

  return (
    <div className="space-y-4 pt-2">
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">Talk track</p>
          <a href={`tel:${who.phone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
            <Phone className="size-3" /> {who.phone}
          </a>
        </div>
        <p className="mt-2 text-muted-foreground">{merge(script.opener)}</p>
        <p className="mt-2 text-xs font-medium">Ask</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
          {script.discovery.slice(0, 3).map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium">Objections</summary>
          <ul className="mt-1 space-y-1.5 text-muted-foreground">
            {script.objections.map((o) => (
              <li key={o.objection}>
                <span className="text-foreground">&ldquo;{o.objection}&rdquo;</span> {o.response}
              </li>
            ))}
          </ul>
        </details>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label className="text-xs">Outcome</Label>
          <Select value={outcome} onValueChange={(v) => setOutcome(v as CallOutcome)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CALL_OUTCOMES.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {outcome === "Interested - Book Demo" && (
          <div className="grid gap-1.5">
            <Label htmlFor="demo" className="text-xs">
              Demo date
            </Label>
            <Input id="demo" type="date" value={demoDate} min={toISODate(asOf)} onChange={(e) => setDemoDate(e.target.value)} />
          </div>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="notes" className="text-xs">
          Notes
        </Label>
        <Textarea
          id="notes"
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={`e.g. ${who.firstName} says the scale line backed up to the highway last fall; controller spends 2 days per settlement run.`}
        />
      </div>
      <div className="flex items-center justify-between gap-3 border-t pt-3">
        <span />
        <Button size="sm" disabled={readOnly} onClick={() => onSave(outcome, notes, outcome === "Interested - Book Demo" ? demoDate : undefined)}>
          Save call
        </Button>
      </div>
    </div>
  );
}

function CampaignTab({ s, onAdd }: { s: ScoredTarget; onAdd: (campaignId: string) => void }) {
  const { data, asOfISO, readOnly: readOnlyCampaign } = useStore();
  const t = s.target;
  const options = data.campaigns
    .filter((c) => (c.Status === "Planned" || c.Status === "In Progress") && c.EndDate >= asOfISO)
    .map((c) => ({
      c,
      fit: (c.Target_Regions__c.includes(t.regionId) ? 2 : 0) + (c.Target_Facility_Types__c.includes(t.facilityType) ? 1 : 0),
      member: data.campaignMembers.some((m) => m.CampaignId === c.Id && (m.AccountId === t.id || m.LeadId === t.id)),
    }))
    .sort((a, b) => b.fit - a.fit);
  const [picked, setPicked] = useState(options.find((o) => !o.member)?.c.Id ?? "");

  return (
    <div className="space-y-3 pt-2">
      {options.length ? (
        <ul className="space-y-2" role="radiogroup" aria-label="Active campaigns">
          {options.map(({ c, fit, member }) => (
            <li key={c.Id}>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm hover:bg-muted/40",
                  picked === c.Id && "border-primary ring-1 ring-primary",
                  member && "cursor-not-allowed opacity-60",
                )}
              >
                <input type="radio" name="campaign" className="mt-1 accent-[var(--primary)]" checked={picked === c.Id} disabled={member} onChange={() => setPicked(c.Id)} />
                <span className="min-w-0">
                  <span className="block font-medium">{c.Name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {c.Type} · {c.Status} · {fmtShortDate(c.StartDate)} – {fmtShortDate(c.EndDate)}
                    {fit >= 2 ? " · matches their region" : ""}
                    {member ? " · already a member" : ""}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No active campaigns</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <Button asChild variant="outline" size="sm">
          <Link href={campaignBuilderHref({ regions: [t.regionId], commodity: t.commodities[0], types: [t.facilityType] })}>
            Build a new campaign
          </Link>
        </Button>
        <Button size="sm" disabled={!picked || readOnlyCampaign} onClick={() => onAdd(picked)}>
          Add to campaign
        </Button>
      </div>
    </div>
  );
}
