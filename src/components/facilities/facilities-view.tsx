"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useStore } from "@/lib/data/store";
import { ACCOUNT_CSV_COLUMNS, corePenetration, countyCoverage, importAccountsCsv, isCovered } from "@/lib/facilities";
import { recordHref } from "@/lib/links";
import { SEGMENTS } from "@/types/salesforce";
import { Button } from "@/components/ui/button";
import { ExportCsvButton } from "@/components/shared/column-picker";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const ALL = "all";
const fmtBu = (n?: number) => (n ? (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M bu` : `${Math.round(n / 1000)}K bu`) : "—");

export function FacilitiesView() {
  const { ready, data, commit, readOnly } = useStore();
  const [state, setState] = useState<string>("core");
  const [segment, setSegment] = useState<string>(ALL);
  const [coverage, setCoverage] = useState<string>(ALL);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(60);
  const fileRef = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(data.accounts.map((a) => [a.Id, a])), [data.accounts]);
  const pen = useMemo(() => corePenetration(data.accounts), [data.accounts]);
  const counties = useMemo(() => countyCoverage(data.accounts), [data.accounts]);
  const whitespace = counties.filter((c) => c.covered === 0);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.accounts
      .filter((a) => (state === "core" ? a.BillingState === "IL" || a.BillingState === "IA" : state === ALL ? true : a.BillingState === state))
      .filter((a) => segment === ALL || a.Segment__c === segment)
      .filter((a) => coverage === ALL || (coverage === "covered" ? isCovered(a) : !isCovered(a)))
      .filter((a) => !needle || `${a.Name} ${a.County__c ?? ""} ${a.BillingCity} ${a.Railroad__c ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => a.BillingState.localeCompare(b.BillingState) || (a.County__c ?? "").localeCompare(b.County__c ?? "") || a.Name.localeCompare(b.Name));
  }, [data.accounts, state, segment, coverage, q]);

  if (!ready) return <Skeleton className="h-[640px]" />;

  const onImport = async (file: File) => {
    const text = await file.text();
    const r = importAccountsCsv(text, data.accounts);
    commit(r.mutations);
    toast.success(`Imported ${r.created} new and ${r.updated} updated accounts`, {
      description: r.skipped.length ? `${r.skipped.length} rows skipped (e.g. line ${r.skipped[0].line}: ${r.skipped[0].reason}).` : "Stored in this browser (mock mode).",
    });
  };

  const select = (value: string, set: (v: string) => void, options: [string, string][], label: string) => (
    <label className="grid gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => set(e.target.value)} className="h-8 rounded-md border border-input bg-card px-2 text-sm">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-4 rounded-md border bg-panel p-4 lg:sticky lg:top-20 lg:self-start" aria-label="Filters">
        <h2 className="text-sm font-semibold">Filters</h2>
        <label className="grid gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Search</span>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, county, railroad" className="bg-card" />
        </label>
        {select(state, setState, [["core", "Illinois + Iowa"], ["IL", "Illinois"], ["IA", "Iowa"], [ALL, "All US & Canada"]], "Area")}
        {select(segment, setSegment, [[ALL, "All segments"], ...SEGMENTS.map((s) => [s, s] as [string, string])], "Segment")}
        {select(coverage, setCoverage, [[ALL, "Customers & prospects"], ["covered", "Customers (covered)"], ["open", "Prospects (not covered)"]], "Coverage")}
        <div className="space-y-2 border-t border-slate-300/70 pt-4">
          <p className="text-xs text-muted-foreground">CSV</p>
          <ExportCsvButton
            size="sm"
            className="w-full bg-card"
            label={`Export (${rows.length})`}
            exportId="facilities-accounts"
            title="Export accounts"
            columns={ACCOUNT_CSV_COLUMNS}
            rows={data.accounts}
            filteredRows={rows}
            filename={`accounts-${state}-${new Date().toISOString().slice(0, 10)}.csv`}
          />
          <Button variant="outline" size="sm" className="w-full bg-card" disabled={readOnly} onClick={() => fileRef.current?.click()}>
            Import CSV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
              e.target.value = "";
            }}
          />
        </div>
      </aside>

      <div className="min-w-0 space-y-6">
        <section>
          <h1 className="text-2xl font-semibold">Facilities</h1>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {pen.map((p) => (
              <div key={p.label} className="rounded-md border bg-card p-3">
                <p className="text-lg font-semibold tabular">
                  {p.covered} <span className="text-sm font-normal text-muted-foreground">of {p.total}</span>
                </p>
                <p className="text-xs text-muted-foreground">{p.label}</p>
                <div className="mt-2 h-1 rounded-sm bg-slate-100">
                  <div className="h-1 rounded-sm bg-primary" style={{ width: `${p.total ? (p.covered / p.total) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-md border bg-card">
          <header className="border-b px-4 py-3">
            <h2 className="text-base font-semibold">Whitespace Counties ({whitespace.length})</h2>
          </header>
          <ul className="grid gap-x-6 px-4 py-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {whitespace.slice(0, 24).map((c) => (
              <li key={c.fips} className="flex justify-between border-b border-slate-100 py-1.5">
                <button type="button" className="text-left text-primary hover:underline" onClick={() => setQ(c.county)}>
                  {c.county} County, {c.state}
                </button>
                <span className="text-muted-foreground tabular">{c.prospects} facilities</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-md border bg-card">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-base font-semibold">Facilities ({rows.length})</h2>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Facility</th>
                  <th className="px-4 py-2 font-medium">Segment</th>
                  <th className="px-4 py-2 font-medium">County</th>
                  <th className="px-4 py-2 font-medium">Railroad</th>
                  <th className="px-4 py-2 font-medium">River</th>
                  <th className="px-4 py-2 font-medium">Shuttle</th>
                  <th className="px-4 py-2 text-right font-medium">Capacity</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.slice(0, limit).map((a) => {
                  const parent = a.ParentId ? byId.get(a.ParentId) : undefined;
                  return (
                    <tr key={a.Id} className="hover:bg-slate-50">
                      <td className="max-w-80 px-4 py-2">
                        <Link href={recordHref(parent?.Id ?? a.Id)} className="font-medium text-primary hover:underline">
                          {a.Name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {a.BillingCity}, {a.BillingState}
                          {parent ? ` · location of ${parent.Name}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{a.Segment__c}</td>
                      <td className="px-4 py-2">{a.County__c ?? "—"}</td>
                      <td className="px-4 py-2">{a.Railroad__c ?? "—"}</td>
                      <td className="px-4 py-2">{a.River_Access__c ? "Yes" : "—"}</td>
                      <td className="px-4 py-2">{a.Shuttle_Loader__c ? "Yes" : "—"}</td>
                      <td className="px-4 py-2 text-right tabular">{fmtBu(a.Storage_Capacity_Bu__c)}</td>
                      <td className="px-4 py-2">
                        <span className={cn("rounded-md border px-1.5 py-0.5 text-xs", isCovered(a) ? "border-primary/40 text-primary" : "border-border text-muted-foreground")}>
                          {isCovered(a) ? "Customer" : "Prospect"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > limit && (
            <div className="border-t p-3 text-center">
              <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + 100)}>
                Show more ({rows.length - limit} remaining)
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

