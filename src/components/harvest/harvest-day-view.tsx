"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Check, Link2, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, type Column } from "@/components/shared/data-table";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { DEFAULT_SIM_SETTINGS, facilityFromAccount, harvestRiskFor, harvestShareUrl, nearestCompetitor, type HarvestSummary, type SimSettings } from "@/lib/harvest/summary";
import { fmtMoney } from "@/lib/format";
import { fmtShortDate } from "@/lib/dates";
import type { Account } from "@/types/salesforce";
import { HarvestSimulator } from "./simulator";
import { HarvestWeightSlider } from "./weight-slider";

interface Row {
  account: Account;
  rank: number | null;
  risk: number | null;
  saved: boolean;
}

const storage = (n?: number) => (!n ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}K`);

/** Salesforce DateTime, e.g. 2026-09-29T14:03:11.000+0000 */
const sfNow = () => new Date().toISOString().replace("Z", "+0000");

export function HarvestDayView() {
  const { data, ranked, ready } = useStore();
  const { run } = useCrud();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("account");
  const [settings, setSettings] = useState<SimSettings>(DEFAULT_SIM_SETTINGS);
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState(false);

  // Ranked prospects with truck receiving first, then everyone else that receives grain
  const rows = useMemo<Row[]>(() => {
    const rankOf = new Map(ranked.map((s, i) => [s.target.id, i + 1]));
    const out: Row[] = [];
    for (const a of data.accounts) {
      if (!facilityFromAccount(a)) continue;
      const r = harvestRiskFor(a);
      out.push({ account: a, rank: rankOf.get(a.Id) ?? null, risk: r?.dollars ?? null, saved: !!r?.saved });
    }
    return out.sort((x, y) => (x.rank ?? 1e9) - (y.rank ?? 1e9) || (y.risk ?? 0) - (x.risk ?? 0));
  }, [data.accounts, ranked]);

  const account = useMemo(() => (selectedId ? data.accounts.find((a) => a.Id === selectedId) : undefined), [data.accounts, selectedId]);
  const competitor = useMemo(() => (account ? nearestCompetitor(account, data.accounts) : null), [account, data.accounts]);

  const select = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    if (id) next.set("account", id);
    else next.delete("account");
    setPicking(false);
    router.replace(next.toString() ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Facility",
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          {r.rank !== null && <span className="w-7 shrink-0 text-xs text-muted-foreground tabular">#{r.rank}</span>}
          <span className="truncate font-medium">{r.account.Name}</span>
        </span>
      ),
      sortValue: (r) => r.account.Name,
    },
    { key: "segment", header: "Segment", cell: (r) => r.account.Segment__c, sortValue: (r) => r.account.Segment__c, hideBelow: "lg" },
    {
      key: "city",
      header: "City",
      cell: (r) => [r.account.BillingCity, r.account.BillingState].filter(Boolean).join(", "),
      sortValue: (r) => `${r.account.BillingState} ${r.account.BillingCity}`,
      hideBelow: "md",
    },
    { key: "storage", header: "Storage (bu)", align: "right", cell: (r) => storage(r.account.Storage_Capacity_Bu__c), sortValue: (r) => r.account.Storage_Capacity_Bu__c ?? 0, hideBelow: "sm" },
    { key: "scales", header: "Scales", align: "right", cell: (r) => r.account.Scales__c, sortValue: (r) => r.account.Scales__c ?? 0, hideBelow: "sm" },
    { key: "pits", header: "Pits", align: "right", cell: (r) => r.account.Dump_Pits__c, sortValue: (r) => r.account.Dump_Pits__c ?? 0, hideBelow: "sm" },
    {
      key: "risk",
      header: "$ at risk",
      align: "right",
      cell: (r) => (
        <span className={r.risk ? "font-medium text-status-critical" : "text-muted-foreground"} title={r.saved ? "Saved from the simulator" : "Modeled"}>
          {r.risk === null ? "—" : fmtMoney(r.risk)}
          {r.saved && <Check className="ml-1 inline size-3 text-primary" aria-label="saved" />}
        </span>
      ),
      sortValue: (r) => r.risk ?? -1,
    },
  ];

  const save = (s: HarvestSummary) => {
    if (!account) return;
    run(
      [{ op: "update", object: "Account", id: account.Id, changes: { Harvest_At_Risk__c: s.manual.seasonDollarsLost, Harvest_At_Risk_Modeled__c: sfNow() } }],
      `Saved ${fmtMoney(s.manual.seasonDollarsLost, { compact: false })} harvest $ at risk to ${account.Name}`,
    );
  };
  const share = async () => {
    if (!account) return;
    const changed = Object.fromEntries(Object.entries(settings).filter(([k, v]) => DEFAULT_SIM_SETTINGS[k as keyof SimSettings] !== v));
    const url = await harvestShareUrl(account.Id, changed);
    if (!url) return void toast.error("Couldn't create a share link");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Share link copied", { description: "Read-only, no sign-in needed" });
    } catch {
      toast.message("Share link", { description: url });
    }
  };

  if (!ready) return <Skeleton className="h-[560px]" />;

  const picker = (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.account.Id}
      search={{ placeholder: "Search facilities", text: (r) => `${r.account.Name} ${r.account.BillingCity} ${r.account.BillingState} ${r.account.Segment__c}` }}
      onRowClick={(r) => select(r.account.Id)}
      rowClassName={(r) => (r.account.Id === selectedId ? "bg-accent-soft" : undefined)}
      pageSize={10}
      caption="Facilities that receive grain by truck"
      empty="No facilities with truck receiving"
    />
  );

  if (!account) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Pick a facility</p>
        {picker}
      </div>
    );
  }

  const savedAt = account.Harvest_At_Risk_Modeled__c;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setPicking((p) => !p)} aria-expanded={picking}>
          <Search className="size-3.5" aria-hidden /> {picking ? "Hide facilities" : "Change facility"}
        </Button>
        {savedAt && typeof account.Harvest_At_Risk__c === "number" && (
          <span className="text-xs text-muted-foreground">
            Saved {fmtShortDate(savedAt.slice(0, 10))}: {fmtMoney(account.Harvest_At_Risk__c, { compact: false })} a season
          </span>
        )}
      </div>
      {picking && picker}
      <HarvestSimulator
        key={account.Id}
        account={account}
        competitor={competitor}
        settings={settings}
        onSettingsChange={setSettings}
        actions={(s) => (
          <>
            <Button size="sm" onClick={() => save(s)}>
              <Save className="size-3.5" aria-hidden /> Save to account
            </Button>
            <Button size="sm" variant="outline" onClick={share}>
              {copied ? <Check className="size-3.5" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />} Copy share link
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/accounts/${account.Id}`}>
                Open account <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            </Button>
          </>
        )}
        aside={<HarvestWeightSlider />}
      />
    </div>
  );
}
