"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftRight, X } from "lucide-react";
import { useStore } from "@/lib/data/store";
import type { Prioritization } from "@/lib/prioritization";
import type { TripRequest } from "@/lib/ai/types";
import { aiParseTrip, useAiStatus } from "@/lib/ai/client";
import { setHandoff } from "@/lib/ai/handoff";
import { localCollection, newId, useStoredCollection } from "@/lib/storage";
import {
  destinationName,
  fmtClock,
  fmtDrive,
  itineraryRows,
  parseTripLocally,
  planTrip,
  tripToIcs,
  type TripPlan,
} from "@/lib/trips";
import { downloadText } from "@/lib/csv";
import { drawPdfFooterBrand, drawPdfLogo, loadPdfLogo } from "@/lib/exports/pdf-brand";
import type { ColumnDef } from "@/lib/columns";
import { ExportCsvButton } from "@/components/shared/column-picker";
import { fmtShortDate, parseDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { recordHref } from "@/lib/links";
import { REGIONS } from "@/data/reference/regions";
import { STATE_NAMES } from "@/data/reference/geo";
import { SEGMENTS } from "@/types/salesforce";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ItineraryRow = ReturnType<typeof itineraryRows>[number];

export const ITINERARY_CSV_COLUMNS: ColumnDef<ItineraryRow>[] = [
  { key: "stop", label: "Stop", type: "number", value: (r) => r.stop },
  { key: "day", label: "Day", type: "number", value: (r) => r.day },
  { key: "date", label: "Date", type: "date", value: (r) => r.date },
  { key: "arrive", label: "Arrive", value: (r) => r.arrive },
  { key: "account", label: "Account", value: (r) => r.account },
  { key: "segment", label: "Segment", value: (r) => r.segment },
  { key: "address", label: "Address", value: (r) => r.address },
  { key: "phone", label: "Phone", value: (r) => r.phone },
  { key: "why", label: "Why", value: (r) => r.why },
  { key: "open", label: "Open pipeline", type: "currency", value: (r) => r.open },
  { key: "last_contact", label: "Last contact", type: "date", value: (r) => r.lastContact },
  { key: "blackout", label: "Blackout", value: (r) => r.blackout },
  { key: "drive", label: "Drive from previous", value: (r) => r.drive },
];

interface SavedTrip {
  id: string;
  name: string;
  request: TripRequest;
  exclude: string[];
  createdAt: string;
  prebuilt?: boolean;
  updatedAt?: string;
}

const trips = localCollection<SavedTrip>("harvest-signal:trips:v1");
const NO_PREBUILT: SavedTrip[] = [];
const MAX_SAVED = 8;

const inputCls = "h-8 w-full min-w-0 rounded-md border border-input bg-card px-2 text-sm text-foreground";
const weekday = (iso: string) => parseDate(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export function TripPlanner({
  prio,
  defaultDestination,
  onPlan,
  highlightId,
  onHover,
}: {
  prio: Prioritization;
  defaultDestination: string;
  onPlan: (plan: TripPlan | null) => void;
  highlightId: string | null;
  onHover: (accountId: string | null) => void;
}) {
  const router = useRouter();
  const { data, asOf, asOfISO, ranked } = useStore();
  const { available } = useAiStatus();
  const saved = useStoredCollection(trips, NO_PREBUILT, "trip");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<TripRequest>(() => parseTripLocally("", asOf, defaultDestination));
  const [request, setRequest] = useState<TripRequest | null>(null);
  const [exclude, setExclude] = useState<string[]>([]);

  const plan = useMemo(
    () => (request ? planTrip(request, { data, asOf, prio, ranked }, new Set(exclude)) : null),
    [request, exclude, data, asOf, prio, ranked],
  );
  useEffect(() => onPlan(plan), [plan, onPlan]);

  const run = (req: TripRequest, keep: string[] = []) => {
    setForm(req);
    setRequest(req);
    setExclude(keep);
    const name = `${destinationName(req.destination)} · ${fmtShortDate(req.startDate)}`;
    // Keep the most recent trips
    const existing = saved.items.filter((t) => !t.prebuilt);
    const same = existing.find((t) => t.name === name);
    saved.save({ id: same?.id ?? newId("trip"), name, request: req, exclude: keep, createdAt: new Date().toISOString() });
    existing
      .filter((t) => t.id !== same?.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(MAX_SAVED - 1)
      .forEach((t) => saved.remove(t.id));
  };

  const fromText = async () => {
    if (!text.trim()) return;
    setBusy(true);
    let req = parseTripLocally(text, asOf, form.destination || defaultDestination);
    if (available) {
      const res = await aiParseTrip(text, { asOf: asOfISO, page: "/map", pageTitle: "Map" });
      if (res.ok) req = res.trip;
    }
    setBusy(false);
    run(req);
  };

  const update = (patch: Partial<TripRequest>) => {
    const next = { ...(request ?? form), ...patch };
    setForm(next);
    if (request) {
      setRequest(next);
      setExclude([]);
    }
  };

  const exportPdf = async (p: TripPlan) => {
    const [{ jsPDF }, { autoTable }, logo] = await Promise.all([import("jspdf"), import("jspdf-autotable"), loadPdfLogo()]);
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
    drawPdfLogo(doc, logo, 38, 24, 16);
    const top = 64;
    doc.setFontSize(14);
    doc.text(`Trip: ${p.destinationName}`, 40, top);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`${p.stops.length} stops · ${p.days.length} day${p.days.length === 1 ? "" : "s"} · ${p.totalMiles} mi · ${fmtDrive(p.totalDriveMinutes)} driving${p.start ? ` · from ${p.start.name}` : ""}`, 40, top + 16);
    autoTable(doc, {
      startY: top + 30,
      head: [["#", "Day", "Arrive", "Account", "Segment", "City", "Why", "Open", "Last contact", "Blackout"]],
      body: itineraryRows(p).map((r) => [
        r.stop,
        `${r.day} · ${weekday(r.date)}`,
        r.arrive,
        r.account,
        r.segment,
        r.address.split(", ").slice(1, 3).join(", "),
        r.why,
        r.open ? fmtMoney(r.open) : "",
        r.lastContact ? fmtShortDate(r.lastContact) : "",
        r.blackout,
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
      columnStyles: { 6: { cellWidth: 150 } },
      didDrawPage: () => drawPdfFooterBrand(doc, doc.internal.pageSize.getHeight() - 18),
    });
    doc.save(`trip-${slug(p.destinationName)}-${p.request.startDate}.pdf`);
  };

  const recent = saved.items.filter((t) => !t.prebuilt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-4 p-3">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          fromText();
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              fromText();
            }
          }}
          rows={2}
          placeholder="I'm going to Illinois in a month, give me the top 10 elevators to visit"
          className="w-full resize-none rounded-md border border-input bg-card px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50"
          aria-label="Describe the trip"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{available === false ? "AI offline — keyword matching" : ""}</span>
          <Button type="submit" size="sm" disabled={busy || !text.trim()}>
            {busy ? "Planning…" : "Plan trip"}
          </Button>
        </div>
      </form>

      <div className="grid grid-cols-2 gap-2 rounded-md bg-panel p-2.5">
        <label className="col-span-2 grid gap-1 text-xs text-muted-foreground">
          Destination
          <select value={form.destination} onChange={(e) => update({ destination: e.target.value })} className={inputCls}>
            <optgroup label="Regions">
              {REGIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="States and provinces">
              {Object.entries(STATE_NAMES)
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
            </optgroup>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Start date
          <input type="date" value={form.startDate} onChange={(e) => e.target.value && update({ startDate: e.target.value })} className={inputCls} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Stops
          <input
            type="number"
            min={1}
            max={30}
            value={form.stops}
            onChange={(e) => update({ stops: Math.min(30, Math.max(1, Number(e.target.value) || 1)) })}
            className={inputCls}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Segment
          <select value={form.segment} onChange={(e) => update({ segment: e.target.value })} className={inputCls}>
            <option value="any">Any</option>
            <option value="year-round">Year-round segments</option>
            {SEGMENTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Start city
          <input value={form.startCity ?? ""} onChange={(e) => update({ startCity: e.target.value || undefined })} placeholder="Optional" className={inputCls} />
        </label>
        {!request && (
          <Button type="button" size="sm" className="col-span-2 mt-1" onClick={() => run(form)}>
            Plan trip
          </Button>
        )}
      </div>

      {!plan && recent.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground">Recent trips</h4>
          <ul className="mt-1.5 divide-y rounded-md border">
            {recent.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
                <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-primary" onClick={() => run(t.request, t.exclude)}>
                  {t.name}
                  <span className="text-xs text-muted-foreground"> · {t.request.stops} stops</span>
                </button>
                <button type="button" aria-label={`Delete ${t.name}`} className="text-muted-foreground hover:text-foreground" onClick={() => saved.remove(t.id)}>
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan && (
        <>
          {plan.warning && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
              <p>{plan.warning.message}</p>
              <div className="flex flex-wrap gap-2">
                {plan.warning.yearRoundCount && plan.request.segment !== "year-round" && (
                  <Button size="xs" variant="outline" className="bg-card" onClick={() => update({ segment: "year-round" })}>
                    Year-round segments instead ({plan.warning.yearRoundCount})
                  </Button>
                )}
                {plan.warning.betterDate && (
                  <Button size="xs" variant="outline" className="bg-card" onClick={() => update({ startDate: plan.warning!.betterDate! })}>
                    Go {fmtShortDate(plan.warning.betterDate)} instead
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-sm font-semibold">
              {plan.destinationName} · {weekday(plan.request.startDate)}
            </h3>
            <p className="text-xs text-muted-foreground tabular">
              {plan.stops.length} stops · {plan.days.length} day{plan.days.length === 1 ? "" : "s"} · {plan.totalMiles} mi · {fmtDrive(plan.totalDriveMinutes)}
            </p>
          </div>

          {!plan.stops.length && <p className="text-sm text-muted-foreground">No matching facilities. Try another segment or destination.</p>}

          {plan.days.map((d) => (
            <div key={d.day}>
              <p className="mb-1 flex justify-between text-xs font-medium text-muted-foreground">
                <span>
                  Day {d.day} · {weekday(d.date)}
                </span>
                <span className="tabular">
                  {d.miles} mi · {fmtDrive(d.driveMinutes)}
                </span>
              </p>
              <ol className="divide-y rounded-md border" onMouseLeave={() => onHover(null)}>
                {d.stops.map((s) => {
                  const n = plan.stops.indexOf(s) + 1;
                  return (
                    <li
                      key={s.account.Id}
                      onMouseEnter={() => onHover(s.account.Id)}
                      className={cn("px-2.5 py-2", highlightId === s.account.Id && "bg-accent-soft")}
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white tabular">{n}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <Link href={recordHref(s.account.Id)} className="truncate text-sm font-medium hover:text-primary hover:underline">
                              {s.account.Name}
                            </Link>
                            <span className="flex shrink-0 gap-0.5">
                              <button
                                type="button"
                                aria-label={`Swap ${s.account.Name}`}
                                title="Swap for the next best"
                                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                onClick={() => setExclude((x) => [...x, s.account.Id])}
                              >
                                <ArrowLeftRight className="size-3.5" aria-hidden />
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove ${s.account.Name}`}
                                title="Remove stop"
                                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                onClick={() => {
                                  setExclude((x) => [...x, s.account.Id]);
                                  setRequest((r) => (r ? { ...r, stops: Math.max(1, r.stops - 1) } : r));
                                  setForm((f) => ({ ...f, stops: Math.max(1, f.stops - 1) }));
                                }}
                              >
                                <X className="size-3.5" aria-hidden />
                              </button>
                            </span>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {s.account.Segment__c} · {s.account.BillingCity}, {s.account.BillingState}
                          </p>
                          <p className="mt-1 text-xs">{s.why}</p>
                          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular">
                            <span>{fmtClock(s.arrive)}</span>
                            {s.legMinutes > 0 && <span>{fmtDrive(s.legMinutes)} drive</span>}
                            <span>{s.openPipeline ? `${fmtMoney(s.openPipeline)} open` : "No open deal"}</span>
                            <span>{s.lastContact ? `Last contact ${fmtShortDate(s.lastContact)}` : "No contact yet"}</span>
                          </p>
                          <p className={cn("mt-1 text-xs", s.blackout.status === "hard" ? "font-medium text-amber-800" : "text-muted-foreground")}>{s.blackout.text}</p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}

          {plan.stops.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" onClick={() => exportPdf(plan)}>
                Export PDF
              </Button>
              <ExportCsvButton
                size="sm"
                exportId="trip-itinerary"
                title="Export itinerary"
                columns={ITINERARY_CSV_COLUMNS}
                rows={itineraryRows(plan)}
                filename={`trip-${slug(plan.destinationName)}-${plan.request.startDate}.csv`}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  downloadText(`trip-${slug(plan.destinationName)}-${plan.request.startDate}.ics`, tripToIcs(plan), "text/calendar;charset=utf-8");
                  toast.success("Calendar file downloaded");
                }}
              >
                Calendar (.ics)
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setHandoff("enroll", { accountIds: plan.stops.map((s) => s.account.Id), from: `Trip: ${plan.destinationName}, ${fmtShortDate(plan.request.startDate)}` });
                  router.push("/campaigns/sequences?enroll=1");
                }}
              >
                Enroll in sequence
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="col-span-2"
                onClick={() => {
                  setRequest(null);
                  setExclude([]);
                }}
              >
                Clear trip
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
