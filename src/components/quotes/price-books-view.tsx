"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useCrud, newId } from "@/lib/data/crud";
import type { Mutation } from "@/lib/data/types";
import type { Pricebook2, PricebookEntry, Product2 } from "@/types/salesforce";
import { standardBook, standardPrice, unitLabel } from "@/lib/quotes/catalog";
import { fmtCurrency } from "@/lib/quotes/pricing";
import { DataTable, type Column } from "@/components/shared/data-table";
import { RecordDrawer, type FieldDef } from "@/components/shared/record-drawer";
import { ConfirmDialog, LocalChangeTag } from "@/components/shared/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { NumCell } from "./line-items";
import { selectCls } from "./shared";

interface BookRow {
  b: Pricebook2;
  entries: number;
  quotes: number;
}

/** Price from the standard book with a ±% adjustment, rounded to $10 */
const adjusted = (price: number, pct: number) => Math.max(0, Math.round((price * (1 + pct / 100)) / 10) * 10);

export function PriceBooksView() {
  const { ready, data } = useStore();
  const { create, update, remove } = useCrud();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [editing, setEditing] = useState<Pricebook2 | "new" | null>(null);
  const [deleting, setDeleting] = useState<Pricebook2 | null>(null);
  const std = standardBook(data.pricebooks);
  const paramBook = params.get("book");
  const selectedId = paramBook && data.pricebooks.some((b) => b.Id === paramBook) ? paramBook : (std?.Id ?? "");
  const select = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("book", id);
    next.delete("entriesPage");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const rows = useMemo<BookRow[]>(
    () =>
      data.pricebooks.map((b) => ({
        b,
        entries: data.pricebookEntries.filter((e) => e.Pricebook2Id === b.Id).length,
        quotes: data.quotes.filter((q) => q.Pricebook2Id === b.Id).length,
      })),
    [data.pricebooks, data.pricebookEntries, data.quotes],
  );

  const columns: Column<BookRow>[] = [
    {
      key: "name",
      header: "Price book",
      sortValue: (r) => r.b.Name,
      cell: (r) => (
        <div>
          <p className={cn("font-medium", r.b.Id === selectedId && "text-primary")}>
            {r.b.Name}
            {r.b.IsStandard && <span className="ml-1.5 rounded-sm border px-1 py-px text-[10px] font-medium text-muted-foreground">Standard</span>}
            <LocalChangeTag id={r.b.Id} />
          </p>
          <p className="text-xs text-muted-foreground">{r.b.Description}</p>
        </div>
      ),
    },
    { key: "ccy", header: "Currency", sortValue: (r) => r.b.CurrencyIsoCode, cell: (r) => r.b.CurrencyIsoCode },
    { key: "entries", header: "Products", align: "right", sortValue: (r) => r.entries, cell: (r) => r.entries },
    { key: "quotes", header: "Quotes", align: "right", sortValue: (r) => r.quotes, cell: (r) => r.quotes },
    { key: "active", header: "Status", sortValue: (r) => Number(r.b.IsActive), cell: (r) => <span className={cn("text-xs", r.b.IsActive ? "text-status-good" : "text-muted-foreground")}>{r.b.IsActive ? "Active" : "Inactive"}</span> },
    {
      key: "edit",
      header: <span className="sr-only">Edit</span>,
      align: "right",
      cell: (r) => (
        <Button
          size="xs"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(r.b);
          }}
        >
          Edit
        </Button>
      ),
    },
  ];

  const current = editing && editing !== "new" ? editing : null;
  const fields: FieldDef[] = [
    {
      name: "Name",
      label: "Name",
      required: true,
      wide: true,
      validate: (v) => (data.pricebooks.some((b) => b.Name.toLowerCase() === String(v ?? "").trim().toLowerCase() && b.Id !== current?.Id) ? "Name already used" : null),
    },
    { name: "CurrencyIsoCode", label: "Currency", type: "select", required: true, options: [{ value: "USD", label: "USD" }, { value: "CAD", label: "CAD" }], disabled: !!current?.IsStandard },
    { name: "IsActive", label: "Active", type: "checkbox", disabled: !!current?.IsStandard },
    { name: "Description", label: "Description", type: "textarea", wide: true },
    ...(!current
      ? ([
          { name: "copy", label: `Copy prices from ${std?.Name ?? "Standard"}`, type: "checkbox", wide: true },
          { name: "adjust", label: "Adjustment", type: "percent", min: -90, max: 200, step: 1, help: "Negative for a discount, e.g. -15" },
        ] as FieldDef[])
      : []),
  ];

  if (!ready) return <Skeleton className="h-[480px]" />;
  const selected = data.pricebooks.find((b) => b.Id === selectedId);
  const deletingQuotes = deleting ? data.quotes.filter((q) => q.Pricebook2Id === deleting.Id).length : 0;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Price books</h2>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.b.Id}
          caption="Price books"
          search={{ placeholder: "Search price books", text: (r) => `${r.b.Name} ${r.b.Description} ${r.b.CurrencyIsoCode}` }}
          defaultSort={{ key: "name", dir: "asc" }}
          onRowClick={(r) => select(r.b.Id)}
          rowClassName={(r) => (r.b.Id === selectedId ? "bg-slate-50" : undefined)}
          actions={
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus />
              New price book
            </Button>
          }
        />
      </section>

      {selected && <BookEntries key={selected.Id} book={selected} />}

      <RecordDrawer
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={current ? `Edit ${current.Name}` : "New price book"}
        fields={fields}
        initial={current ? { Name: current.Name, CurrencyIsoCode: current.CurrencyIsoCode, IsActive: current.IsActive, Description: current.Description } : { Name: "", CurrencyIsoCode: "USD", IsActive: true, Description: "", copy: true, adjust: 0 }}
        submitLabel={current ? "Save" : "Create price book"}
        onSubmit={(v) => {
          const record = { Name: String(v.Name), CurrencyIsoCode: v.CurrencyIsoCode as Pricebook2["CurrencyIsoCode"], IsActive: !!v.IsActive || !!current?.IsStandard, Description: String(v.Description ?? "") };
          if (current) {
            update("Pricebook2", current.Id, record, record.Name);
          } else {
            const id = newId("Pricebook2");
            const pct = Number(v.adjust ?? 0) || 0;
            const extra: Mutation[] =
              v.copy && std
                ? data.pricebookEntries
                    .filter((e) => e.Pricebook2Id === std.Id)
                    .map((e): Mutation => ({ op: "create", object: "PricebookEntry", record: { Id: newId("PricebookEntry"), Pricebook2Id: id, Product2Id: e.Product2Id, UnitPrice: adjusted(e.UnitPrice, pct), IsActive: e.IsActive } }))
                : [];
            create("Pricebook2", { Id: id, ...record, IsStandard: false }, record.Name, extra);
            select(id);
          }
          setEditing(null);
        }}
        onDelete={
          current && !current.IsStandard
            ? () => {
                setDeleting(current);
                setEditing(null);
              }
            : undefined
        }
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deletingQuotes ? `${deleting?.Name} is in use` : `Delete ${deleting?.Name}?`}
        description={deletingQuotes ? `${deletingQuotes} quote${deletingQuotes === 1 ? " uses" : "s use"} it. Deactivate it to hide it from new quotes.` : "Also removes its prices. You can undo this for a few seconds afterwards."}
        confirmLabel={deletingQuotes ? "Deactivate" : "Delete"}
        destructive={!deletingQuotes}
        onConfirm={() => {
          if (!deleting) return;
          if (deletingQuotes) update("Pricebook2", deleting.Id, { IsActive: false }, deleting.Name);
          else {
            remove(
              "Pricebook2",
              deleting.Id,
              deleting.Name,
              data.pricebookEntries.filter((e) => e.Pricebook2Id === deleting.Id).map((e): Mutation => ({ op: "delete", object: "PricebookEntry", id: e.Id })),
            );
            if (std) select(std.Id);
          }
        }}
      />
    </div>
  );
}

interface EntryRow {
  e: PricebookEntry;
  p: Product2;
  type: string;
  std: number;
}

function BookEntries({ book }: { book: Pricebook2 }) {
  const { data } = useStore();
  const { create, update, remove, run } = useCrud();
  const [adding, setAdding] = useState("");
  const [pct, setPct] = useState("0");
  const [confirmCopy, setConfirmCopy] = useState(false);
  const [removing, setRemoving] = useState<EntryRow | null>(null);
  const std = standardBook(data.pricebooks);
  const ccy = book.CurrencyIsoCode;

  const rows = useMemo<EntryRow[]>(() => {
    const types = new Map(data.productTypes.map((t) => [t.Id, t.Name]));
    const products = new Map(data.products.map((p) => [p.Id, p]));
    return data.pricebookEntries
      .filter((e) => e.Pricebook2Id === book.Id && products.has(e.Product2Id))
      .map((e) => {
        const p = products.get(e.Product2Id)!;
        return { e, p, type: (p.Product_Type__c && types.get(p.Product_Type__c)) || p.Family, std: standardPrice(data, p) };
      });
  }, [data, book.Id]);
  const missing = data.products.filter((p) => !rows.some((r) => r.p.Id === p.Id));

  const columns: Column<EntryRow>[] = [
    {
      key: "name",
      header: "Product",
      sortValue: (r) => r.p.Name,
      cell: (r) => (
        <div>
          <p className="font-medium">
            {r.p.Name}
            {!r.p.IsActive && <span className="ml-1.5 text-xs font-normal text-amber-800">Product inactive</span>}
            <LocalChangeTag id={r.e.Id} />
          </p>
          <p className="font-mono text-xs text-muted-foreground">{r.p.ProductCode}</p>
        </div>
      ),
    },
    { key: "type", header: "Type", sortValue: (r) => r.type, cell: (r) => <span className="whitespace-nowrap">{r.type}</span> },
    { key: "unit", header: "Pricing unit", hideBelow: "md", cell: (r) => <span className="whitespace-nowrap">{unitLabel(r.p)}</span> },
    { key: "std", header: "Standard", align: "right", sortValue: (r) => r.std, hideBelow: "md", cell: (r) => <span className="text-muted-foreground">{fmtCurrency(r.std)}</span> },
    {
      key: "price",
      header: `Price (${ccy})`,
      align: "right",
      sortValue: (r) => r.e.UnitPrice,
      cell: (r) => (
        <NumCell
          key={`${r.e.Id}:${r.e.UnitPrice}`}
          value={r.e.UnitPrice}
          step={100}
          label={`Price, ${r.p.Name}`}
          className="w-28"
          onCommit={(n) => {
            const extra: Mutation[] = book.IsStandard ? [{ op: "update", object: "Product2", id: r.p.Id, changes: { List_Price__c: n } }] : [];
            update("PricebookEntry", r.e.Id, { UnitPrice: n }, `${r.p.Name} price`, extra);
          }}
        />
      ),
    },
    {
      key: "vs",
      header: "vs. standard",
      align: "right",
      hideBelow: "sm",
      sortValue: (r) => (r.std ? r.e.UnitPrice / r.std : 0),
      cell: (r) => {
        if (book.IsStandard || !r.std) return <span className="text-muted-foreground">—</span>;
        const d = Math.round((r.e.UnitPrice / r.std - 1) * 1000) / 10;
        return <span className={cn("tabular", d < 0 ? "text-primary" : d > 0 ? "text-slate-700" : "text-muted-foreground")}>{d > 0 ? `+${d}%` : `${d}%`}</span>;
      },
    },
    {
      key: "active",
      header: "Active",
      cell: (r) => (
        <input
          type="checkbox"
          checked={r.e.IsActive}
          aria-label={`${r.p.Name} active in ${book.Name}`}
          onChange={(ev) => update("PricebookEntry", r.e.Id, { IsActive: ev.target.checked }, `${r.p.Name} price`)}
          className="size-4 accent-[#1f5f4a]"
        />
      ),
    },
    {
      key: "remove",
      header: <span className="sr-only">Remove</span>,
      align: "right",
      cell: (r) => (
        <Button variant="ghost" size="icon-xs" aria-label={`Remove ${r.p.Name}`} className="text-muted-foreground hover:text-status-critical" onClick={() => setRemoving(r)}>
          <Trash2 />
        </Button>
      ),
    },
  ];

  const copyFromStandard = () => {
    if (!std) return;
    const p = Number(pct) || 0;
    const muts: Mutation[] = [];
    for (const se of data.pricebookEntries.filter((e) => e.Pricebook2Id === std.Id)) {
      const mine = rows.find((r) => r.p.Id === se.Product2Id);
      const price = adjusted(se.UnitPrice, p);
      if (mine) {
        if (mine.e.UnitPrice !== price) muts.push({ op: "update", object: "PricebookEntry", id: mine.e.Id, changes: { UnitPrice: price } });
      } else muts.push({ op: "create", object: "PricebookEntry", record: { Id: newId("PricebookEntry"), Pricebook2Id: book.Id, Product2Id: se.Product2Id, UnitPrice: price, IsActive: se.IsActive } });
    }
    run(muts, `${book.Name}: ${muts.length} price${muts.length === 1 ? "" : "s"} updated`, { undoable: true });
  };

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">
        {book.Name} <span className="font-normal text-muted-foreground">· {book.CurrencyIsoCode}</span>
      </h2>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.e.Id}
        caption={`${book.Name} prices`}
        param="entriesPage"
        defaultSort={{ key: "type", dir: "asc" }}
        search={{ placeholder: "Search products", text: (r) => `${r.p.Name} ${r.p.ProductCode} ${r.type}` }}
        minWidth={760}
        empty="No products in this price book"
        filters={
          !book.IsStandard && std ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                setConfirmCopy(true);
              }}
            >
              <Label htmlFor="copy-pct" className="text-xs font-normal whitespace-nowrap text-muted-foreground">
                From Standard
              </Label>
              <div className="relative">
                <input id="copy-pct" type="number" value={pct} min={-90} max={200} step={1} onChange={(e) => setPct(e.target.value)} className="h-8 w-20 rounded-md border border-input bg-card pr-6 pl-2 text-right text-sm tabular" />
                <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
              </div>
              <Button type="submit" size="sm" variant="outline">
                Apply
              </Button>
            </form>
          ) : undefined
        }
        actions={
          missing.length > 0 ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const p = missing.find((x) => x.Id === adding);
                if (!p) return;
                const price = book.IsStandard ? p.List_Price__c : standardPrice(data, p);
                create("PricebookEntry", { Pricebook2Id: book.Id, Product2Id: p.Id, UnitPrice: price, IsActive: true }, `${p.Name} price`);
                setAdding("");
              }}
            >
              <select aria-label="Product to add" value={adding} onChange={(e) => setAdding(e.target.value)} className={selectCls}>
                <option value="">Add product…</option>
                {missing.map((p) => (
                  <option key={p.Id} value={p.Id}>
                    {p.Name}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" disabled={!adding}>
                Add
              </Button>
            </form>
          ) : undefined
        }
      />
      <ConfirmDialog
        open={confirmCopy}
        onOpenChange={setConfirmCopy}
        title={`Reprice ${book.Name}`}
        description={`Sets every price to Standard ${Number(pct) > 0 ? "+" : ""}${Number(pct) || 0}%, rounded to $10, and adds missing products. Existing quotes keep their prices. You can undo this for a few seconds afterwards.`}
        confirmLabel="Reprice"
        destructive={false}
        onConfirm={copyFromStandard}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.p.Name} from ${book.Name}?`}
        description="It can't be added to new quotes on this price book. Existing quotes keep their lines. You can undo this for a few seconds afterwards."
        confirmLabel="Remove"
        onConfirm={() => removing && remove("PricebookEntry", removing.e.Id, `${removing.p.Name} price`)}
      />
    </section>
  );
}
