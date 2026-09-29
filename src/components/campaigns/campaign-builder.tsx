"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Download, Loader2, Rocket, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { REGIONS, REGION_BY_ID } from "@/data/reference/regions";
import { CURRENT_USER_ID } from "@/data/reference/users";
import { useStore } from "@/lib/data/store";
import { SEASON_PLAYS, PLAY_DESCRIPTIONS, type SeasonPlay } from "@/lib/content/messaging";
import { templateCampaignContent, timingContext } from "@/lib/content/templates";
import { aiCampaign, useAiAvailable } from "@/lib/content/ai-client";
import { campaignEconomics, defaultCampaignName, mailListCsv, matchTargets, recipientFor, suggestedPlay, type Audience } from "@/lib/campaigns";
import { createCampaign, businessDaysOut } from "@/lib/actions/outreach";
import { downloadText } from "@/lib/csv";
import { addDays, fmtShortDate, toISODate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { sizeLabel } from "@/lib/scoring";
import { cropStatus } from "@/lib/season";
import { COMMODITIES, FACILITY_TYPES, type CampaignContent, type Campaign, type Commodity, type FacilityType, type RegionId } from "@/types/salesforce";
import { SENDER, announce } from "@/components/outreach/outreach-dialog";
import { ContentEditor } from "./content-editor";
import { ScorePill, TierLabel } from "@/components/shared/badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const STEPS = ["Audience", "Targets", "Content", "Launch"] as const;
const TYPES: Campaign["Type"][] = ["Direct Mail", "Multi-Channel", "Email", "Call Blitz"];
const ANY = "any";

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
      )}
    >
      {active && <Check className="size-3.5" />}
      {children}
    </button>
  );
}

export function CampaignBuilder() {
  const params = useSearchParams();
  const { ready } = useStore();
  if (!ready) return <Skeleton className="h-[520px]" />;
  // Re-mount when the query changes (e.g. arriving from a launch-window link)
  return <Builder key={params.toString()} params={params} />;
}

function Builder({ params }: { params: URLSearchParams }) {
  const router = useRouter();
  const { data, asOf, ranked, commit } = useStore();
  const aiAvailable = useAiAvailable();

  const initialRegions = (params.get("regions")?.split(",").filter((r) => r in REGION_BY_ID) ?? []) as RegionId[];
  const [audience, setAudience] = useState<Audience>(() => ({
    play: (SEASON_PLAYS.includes(params.get("season") as SeasonPlay) ? params.get("season") : suggestedPlay(initialRegions[0], asOf)) as SeasonPlay,
    regions: initialRegions,
    types: params.get("types")
      ? (params.get("types")!.split(",").filter((t) => FACILITY_TYPES.includes(t as FacilityType)) as FacilityType[])
      : ["Grain Elevator", "Cooperative"],
    commodity: COMMODITIES.includes(params.get("commodity") as Commodity) ? (params.get("commodity") as Commodity) : undefined,
  }));
  const [step, setStep] = useState(0);
  const [minScore, setMinScore] = useState(55);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [type, setType] = useState<Campaign["Type"]>("Direct Mail");
  const [content, setContent] = useState<CampaignContent | null>(null);
  const [generating, setGenerating] = useState(false);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);

  const matched = useMemo(() => matchTargets(ranked, audience), [ranked, audience]);
  const eligible = matched.filter((s) => s.total >= minScore);
  const selected = eligible.filter((s) => !excluded.has(s.target.id));
  const recipients = selected.map((s) => recipientFor(data, s)).filter(Boolean) as NonNullable<ReturnType<typeof recipientFor>>[];
  const avgScore = selected.length ? selected.reduce((sum, s) => sum + s.total, 0) / selected.length : 0;
  const econ = campaignEconomics(type, selected.length, avgScore);

  // Launch timing: pre-harvest campaigns land 6 weeks before harvest when that's still ahead
  const lead = audience.regions[0] ? REGION_BY_ID[audience.regions[0]] : undefined;
  const leadCrop = lead ? lead.crops.find((c) => c.commodity === audience.commodity) ?? lead.crops[0] : undefined;
  const status = lead && leadCrop ? cropStatus(lead.id, leadCrop, asOf) : undefined;
  const suggestedStart = status && audience.play === "Pre-harvest" && status.launchStart > asOf ? status.launchStart : businessDaysOut(asOf, 3);
  const [dates, setDates] = useState<{ start: string; end: string } | null>(null);
  const startDate = dates?.start ?? toISODate(suggestedStart);
  const endDate = dates?.end ?? toISODate(addDays(suggestedStart, 45));
  const setStartDate = (v: string) => setDates({ start: v, end: endDate < v ? toISODate(addDays(new Date(v + "T00:00:00Z"), 45)) : endDate });
  const setEndDate = (v: string) => setDates({ start: startDate, end: v });
  const effectiveName = nameTouched ? name : defaultCampaignName(audience, type, asOf);

  const brief = { play: audience.play, regionIds: audience.regions.length ? audience.regions : [selected[0]?.target.regionId ?? "western-corn-belt"], facilityTypes: audience.types.length ? audience.types : FACILITY_TYPES, commodity: audience.commodity, asOf, sender: SENDER };

  const generate = async (withAi: boolean) => {
    const template = templateCampaignContent(brief);
    if (!withAi) {
      setContent(template);
      return;
    }
    setGenerating(true);
    const out = await aiCampaign(template, {
      play: audience.play,
      regions: brief.regionIds.map((r) => ({ name: REGION_BY_ID[r].name, summary: REGION_BY_ID[r].summary, localColor: REGION_BY_ID[r].localColor })),
      facilityTypes: brief.facilityTypes,
      commodity: audience.commodity ?? null,
      seasonalTiming: timingContext(brief).line,
      topTargetReasons: selected.slice(0, 8).map((s) => s.whyNow),
      campaignType: type,
      sender: SENDER,
      today: toISODate(asOf),
    });
    setContent(out);
    setGenerating(false);
    if (out.source === "template") toast.info("AI unavailable, using the built-in templates", { description: "Add ANTHROPIC_API_KEY on the server to enable AI copy." });
  };


  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const setAud = (patch: Partial<Audience>) => {
    setAudience((a) => ({ ...a, ...patch }));
    setContent(null);
    setExcluded(new Set());
  };

  const launch = () => {
    if (!content || !selected.length) return;
    const { result, campaignId } = createCampaign(
      { data, asOf, userId: CURRENT_USER_ID },
      {
        name: effectiveName,
        type,
        startDate,
        endDate,
        budget: econ.budget,
        season: audience.play,
        regions: brief.regionIds,
        facilityTypes: brief.facilityTypes,
        commodity: audience.commodity,
        description: `${audience.play} play for ${brief.facilityTypes.join(", ").toLowerCase()} in ${brief.regionIds.map((r) => REGION_BY_ID[r].name).join(", ")}. ${timingContext(brief).line.replace(/^./, (c) => c.toUpperCase())}.`,
        content,
        expectedRevenue: econ.expectedRevenue,
        members: recipients.map((r) => ({ targetId: r.targetId, whoId: r.whoId })),
      },
    );
    commit(result.mutations);
    announce(result, "Campaign created");
    router.push(`/campaigns/${campaignId}`);
  };

  const exportCsv = () => downloadText(`${effectiveName.replace(/[^\w]+/g, "-").toLowerCase()}-mail-list.csv`, mailListCsv(recipients));
  const canNext = step === 0 ? true : step === 1 ? selected.length > 0 : step === 2 ? Boolean(content) : true;

  return (
    <div className="space-y-5">
      <ol className="grid grid-cols-4 gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => i <= step && setStep(i)}
              className={cn(
                "flex w-full flex-col items-start gap-1 border-t-2 pt-2 text-left text-xs sm:text-sm",
                i === step ? "border-primary font-medium text-foreground" : i < step ? "border-primary/40 text-foreground" : "border-border text-muted-foreground",
              )}
              aria-current={i === step ? "step" : undefined}
            >
              <span className="text-[11px] text-muted-foreground">Step {i + 1}</span>
              {s}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Who is this campaign for?</CardTitle>
            <CardDescription>Pick the season play, regions, facility types and commodity. The target list and copy follow from these.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <section>
              <Label className="text-sm">Season play</Label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {SEASON_PLAYS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setAud({ play: p })}
                    aria-pressed={audience.play === p}
                    className={cn("rounded-lg border p-3 text-left transition-colors hover:bg-muted/50", audience.play === p && "border-primary bg-brand-green-soft/50 ring-1 ring-primary")}
                  >
                    <span className="block text-sm font-medium">{p}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{PLAY_DESCRIPTIONS[p]}</span>
                  </button>
                ))}
              </div>
            </section>
            <section>
              <Label className="text-sm">Regions {audience.regions.length === 0 && <span className="font-normal text-muted-foreground">(all)</span>}</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {REGIONS.map((r) => (
                  <Chip key={r.id} active={audience.regions.includes(r.id)} onClick={() => setAud({ regions: toggle(audience.regions, r.id) })}>
                    {r.name}
                  </Chip>
                ))}
              </div>
            </section>
            <section>
              <Label className="text-sm">Facility types {audience.types.length === 0 && <span className="font-normal text-muted-foreground">(all)</span>}</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {FACILITY_TYPES.map((t) => (
                  <Chip key={t} active={audience.types.includes(t)} onClick={() => setAud({ types: toggle(audience.types, t) })}>
                    {t}
                  </Chip>
                ))}
              </div>
            </section>
            <section className="max-w-xs">
              <Label className="text-sm">Commodity</Label>
              <Select value={audience.commodity ?? ANY} onValueChange={(v) => setAud({ commodity: v === ANY ? undefined : (v as Commodity) })}>
                <SelectTrigger className="mt-2 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any commodity</SelectItem>
                  {COMMODITIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>
            <p className="rounded-md bg-muted/60 p-3 text-sm">
              <strong className="font-medium">{matched.length}</strong> prospects match. {cap(timingContext(brief).line)}.
            </p>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Target list</CardTitle>
            <CardDescription>Ranked for {fmtShortDate(asOf)}. Uncheck anyone you want to leave out.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs whitespace-nowrap text-muted-foreground">Min score</span>
                <Slider value={[minScore]} min={0} max={90} step={5} onValueChange={([v]) => setMinScore(v)} className="w-40" aria-label="Minimum score" />
                <span className="w-6 text-sm font-medium tabular">{minScore}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                <strong className="text-foreground">{selected.length}</strong> selected of {eligible.length} ({matched.length} matched)
              </p>
            </div>
            <div className="max-h-[480px] overflow-y-auto rounded-md border">
              <ul className="divide-y">
                {eligible.map((s) => {
                  const r = recipientFor(data, s);
                  const on = !excluded.has(s.target.id);
                  return (
                    <li key={s.target.id} className={cn("flex items-start gap-3 px-3 py-2.5", !on && "opacity-50")}>
                      <Checkbox
                        checked={on}
                        onCheckedChange={() =>
                          setExcluded((ex) => {
                            const next = new Set(ex);
                            if (next.has(s.target.id)) next.delete(s.target.id);
                            else next.add(s.target.id);
                            return next;
                          })
                        }
                        className="mt-1"
                        aria-label={`Include ${s.target.name}`}
                      />
                      <ScorePill score={s.total} size="sm" className="w-8 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {s.target.name} <TierLabel tier={s.tier} />
                          {s.target.kind === "lead" && (
                            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                              Lead
                            </Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {s.target.facilityType} · {s.target.city}, {s.target.state} · {sizeLabel(s.target)} · to {r ? `${r.firstName} ${r.lastName}, ${r.title}` : "—"}
                        </p>
                        <p className="mt-0.5 line-clamp-1 text-xs text-foreground/80">{s.whyNow}</p>
                      </div>
                    </li>
                  );
                })}
                {!eligible.length && <li className="p-6 text-center text-sm text-muted-foreground">No prospects above this score. Lower the minimum or widen the audience.</li>}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Campaign content
                {content && (
                  <Badge variant="outline" className={cn("gap-1", content.source === "ai" && "border-primary/40 text-primary")}>
                    {content.source === "ai" ? <Sparkles className="size-3" /> : null}
                    {content.source === "ai" ? "AI-written" : "Built-in template"}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Written for {audience.play.toLowerCase()} in {brief.regionIds.map((r) => REGION_BY_ID[r].name).join(", ")}. Preview uses{" "}
                {recipients[0] ? `${recipients[0].firstName} at ${recipients[0].company}` : "sample"} merge fields.
              </CardDescription>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={() => generate(false)} disabled={generating}>
                <Wand2 className="size-4" /> Reset to template
              </Button>
              <Button size="sm" onClick={() => generate(true)} disabled={generating || aiAvailable === false} title={aiAvailable === false ? "Add ANTHROPIC_API_KEY to enable" : undefined}>
                {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {generating ? "Writing…" : "Write with AI"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {content ? (
              <ContentEditor content={content} onChange={setContent} preview={recipients[0] ? { FirstName: recipients[0].firstName, Company: recipients[0].company, City: recipients[0].city } : undefined} />
            ) : (
              <Skeleton className="h-96" />
            )}
            {aiAvailable === false && <p className="mt-3 text-xs text-muted-foreground">AI copy is off (no API key on the server). The built-in templates are tailored by season, region and facility type.</p>}
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Launch settings</CardTitle>
              <CardDescription>Creating the campaign writes the Campaign, CampaignMember and Task records for you.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-1.5">
                <Label htmlFor="cname">Campaign name</Label>
                <Input
                  id="cname"
                  value={effectiveName}
                  onChange={(e) => {
                    setNameTouched(true);
                    setName(e.target.value);
                  }}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label>Type</Label>
                  <Select value={type} onValueChange={(v) => setType(v as Campaign["Type"])}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="start">Start</Label>
                  <Input id="start" type="date" value={startDate} min={toISODate(asOf)} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="end">End</Label>
                  <Input id="end" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              {status && audience.play === "Pre-harvest" && (
                <p className="rounded-md bg-muted/60 p-3 text-sm">
                  {cropNounLabel(leadCrop!.commodity)} harvest in {lead!.name} starts around <strong>{fmtShortDate(status.window.start)}</strong>. Ideal launch window:{" "}
                  <strong>
                    {fmtShortDate(status.launchStart)} – {fmtShortDate(status.launchEnd)}
                  </strong>
                  {status.launchEnd < asOf ? ". That window has passed, so launch now and keep it short." : "."}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row k="Members" v={String(selected.length)} />
              <Row k="Average score" v={avgScore.toFixed(0)} />
              <Row k="Estimated budget" v={fmtMoney(econ.budget, { compact: false })} />
              <Row k="Expected responses" v={econ.responses.toFixed(1)} />
              <Row k="Expected pipeline" v={fmtMoney(econ.expectedRevenue)} />
              <Row k="Return on budget" v={`${Math.round(econ.roi)}×`} />
              <div className="space-y-2 border-t pt-3">
                <Button variant="outline" className="w-full" onClick={exportCsv} disabled={!recipients.length}>
                  <Download className="size-4" /> Export mail list (CSV)
                </Button>
                <Button className="w-full" onClick={launch} disabled={!content || !selected.length}>
                  <Rocket className="size-4" /> Create campaign
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex items-center justify-between">
        {step > 0 ? (
          <Button variant="outline" onClick={() => setStep(step - 1)}>
            <ArrowLeft className="size-4" /> Back
          </Button>
        ) : (
          <Button asChild variant="ghost">
            <Link href="/campaigns">Cancel</Link>
          </Button>
        )}
        {step < 3 && (
          <Button
            onClick={() => {
              if (step === 1 && !content) setContent(templateCampaignContent(brief));
              setStep(step + 1);
            }}
            disabled={!canNext}
          >
            {step === 0 ? `Review ${matched.filter((s) => s.total >= minScore).length} targets` : step === 1 ? `Write content for ${selected.length}` : "Launch settings"}
            <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium tabular">{v}</span>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const cropNounLabel = (c: Commodity) => (c === "Soybeans" ? "Soybean" : c === "Pulses" ? "Pulse" : c.replace(" Wheat", " wheat"));
