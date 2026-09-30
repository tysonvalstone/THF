"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { DataTable } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { QuoteDrawer } from "./quote-drawer";
import { quoteColumns, useQuoteRows } from "./quotes-list";

/** The opportunity's quotes, with "New quote" prefilled for it (used on the opportunity page) */
export function OpportunityQuotes({ opportunityId }: { opportunityId: string }) {
  const { ready, data } = useStore();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const rows = useQuoteRows((q) => q.OpportunityId === opportunityId);
  const columns = useMemo(() => quoteColumns({ compact: true }), []);
  if (!ready) return null;
  const opp = data.opportunities.find((o) => o.Id === opportunityId);
  return (
    <section className="rounded-md border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">
          Quotes <span className="font-normal text-muted-foreground">({rows.length})</span>
        </h2>
        {opp && !opp.IsClosed && (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus />
            New quote
          </Button>
        )}
      </div>
      <div className="p-3">
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.quote.Id}
          caption="Quotes on this opportunity"
          urlState={false}
          dense
          pageSizes={[]}
          defaultSort={{ key: "updated", dir: "desc" }}
          onRowClick={(r) => router.push(`/quotes/${r.quote.Id}`)}
          empty="No quotes yet"
        />
      </div>
      <QuoteDrawer open={creating} onOpenChange={setCreating} opportunityId={opportunityId} />
    </section>
  );
}
