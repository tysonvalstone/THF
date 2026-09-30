"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import type { Mutation } from "@/lib/data/types";
import type { Product2, Quote, QuoteLineItem } from "@/types/salesforce";
import { bookEntries, defaultQuantity, isRecurring, productMap, quantityNoun, unitLabel } from "@/lib/quotes/catalog";
import { fmtCurrency, fmtPctValue, round2 } from "@/lib/quotes/pricing";
import { lineChanges, lineEditMutations, newLine, quoteLines } from "@/lib/quotes/lifecycle";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useQuoteContext } from "./shared";

/** Number input that commits on blur / Enter (Escape reverts) */
export function NumCell({
  value,
  onCommit,
  min = 0,
  max,
  step = 1,
  prefix,
  suffix,
  label,
  className,
  integer,
}: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  label: string;
  className?: string;
  integer?: boolean;
}) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const n = Number(text);
    const ok = text.trim() !== "" && Number.isFinite(n) && n >= min && (max === undefined || n <= max) && (!integer || Number.isInteger(n));
    if (!ok) return setText(String(value));
    if (n !== value) onCommit(integer ? n : round2(n));
  };
  return (
    <div className={cn("relative inline-flex", className)}>
      {prefix && <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-muted-foreground">{prefix}</span>}
      <input
        type="number"
        inputMode="decimal"
        aria-label={label}
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setText(String(value));
        }}
        className={cn(
          "h-7 w-full rounded-md border border-input bg-card px-2 text-right text-sm tabular outline-none focus:border-primary/50 [&::-webkit-inner-spin-button]:appearance-none",
          prefix && "pl-5",
          suffix && "pr-5",
        )}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}

export function LineItems({ quote, editable }: { quote: Quote; editable: boolean }) {
  const { data } = useStore();
  const ctx = useQuoteContext();
  const { run } = useCrud();
  const [adding, setAdding] = useState(false);
  const lines = quoteLines(data, quote.Id);
  const products = useMemo(() => productMap(data.products), [data.products]);
  const types = useMemo(() => new Map(data.productTypes.map((t) => [t.Id, t.Name])), [data.productTypes]);
  const account = data.accounts.find((a) => a.Id === quote.AccountId);
  const ccy = data.pricebooks.find((b) => b.Id === quote.Pricebook2Id)?.CurrencyIsoCode ?? "USD";
  const money = (n: number) => fmtCurrency(n, ccy);

  const commit = (muts: Mutation[], message?: string, undoable = false) => run(lineEditMutations(ctx, quote.Id, muts), message, { undoable });
  const patch = (l: QuoteLineItem, p: Parameters<typeof lineChanges>[1]) => commit([{ op: "update", object: "QuoteLineItem", id: l.Id, changes: lineChanges(l, p) }]);
  const name = (l: QuoteLineItem) => products.get(l.Product2Id)?.Name ?? l.Product2Id;

  const groups: { label: string; rows: QuoteLineItem[] }[] = [
    { label: "Recurring · annual", rows: lines.filter((l) => isRecurring(products.get(l.Product2Id) ?? { Pricing_Unit__c: "per year" })) },
    { label: "One-time", rows: lines.filter((l) => !isRecurring(products.get(l.Product2Id) ?? { Pricing_Unit__c: "per year" })) },
  ];

  /** Swap display order with the neighbour in the same group (no repricing) */
  const move = (group: QuoteLineItem[], i: number, dir: -1 | 1) => {
    const a = group[i];
    const b = group[i + dir];
    if (!a || !b) return;
    run([
      { op: "update", object: "QuoteLineItem", id: a.Id, changes: { SortOrder: b.SortOrder } },
      { op: "update", object: "QuoteLineItem", id: b.Id, changes: { SortOrder: a.SortOrder } },
    ]);
  };

  const th = "px-3 py-2 font-medium whitespace-nowrap";
  return (
    <section className="rounded-md border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">
          Line items <span className="font-normal text-muted-foreground">({lines.length})</span>
        </h2>
        {editable && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus />
            Add product
          </Button>
        )}
      </div>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">Quote line items</caption>
          <thead className="bg-slate-50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className={th}>
                Product
              </th>
              <th scope="col" className={cn(th, "w-24 text-right")}>
                Qty
              </th>
              <th scope="col" className={cn(th, "w-28 text-right")}>
                List
              </th>
              <th scope="col" className={cn(th, "w-20 text-right")}>
                Disc.
              </th>
              <th scope="col" className={cn(th, "w-28 text-right")}>
                Net unit
              </th>
              <th scope="col" className={cn(th, "w-28 text-right")}>
                Total
              </th>
              {editable && (
                <th scope="col" className={cn(th, "w-24")}>
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          {groups.map((g) =>
            g.rows.length ? (
              <tbody key={g.label} className="divide-y border-t">
                <tr className="bg-slate-50/60">
                  <th scope="rowgroup" colSpan={5} className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                    {g.label}
                  </th>
                  <td className="px-3 py-1.5 text-right text-xs font-medium tabular">{money(round2(g.rows.reduce((s, l) => s + l.TotalPrice, 0)))}</td>
                  {editable && <td />}
                </tr>
                {g.rows.map((l, i) => {
                  const p = products.get(l.Product2Id);
                  const def = p ? defaultQuantity(p, account) : 1;
                  return (
                    <LineRow
                      key={`${l.Id}:${l.Quantity}:${l.ListPrice}:${l.Discount}`}
                      line={l}
                      product={p}
                      typeName={p?.Product_Type__c ? types.get(p.Product_Type__c) : undefined}
                      editable={editable}
                      defaultQty={def}
                      money={money}
                      onPatch={(x) => patch(l, x)}
                      onUp={i > 0 ? () => move(g.rows, i, -1) : undefined}
                      onDown={i < g.rows.length - 1 ? () => move(g.rows, i, 1) : undefined}
                      onRemove={() => commit([{ op: "delete", object: "QuoteLineItem", id: l.Id }], `${name(l)} removed`, true)}
                    />
                  );
                })}
              </tbody>
            ) : null,
          )}
          {!lines.length && (
            <tbody>
              <tr>
                <td colSpan={editable ? 7 : 6} className="px-4 py-8 text-center text-muted-foreground">
                  No line items
                  {editable && (
                    <Button size="sm" variant="link" onClick={() => setAdding(true)}>
                      Add product
                    </Button>
                  )}
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
      {editable && <AddProductDialog quote={quote} open={adding} onOpenChange={setAdding} onAdd={(p, qty) => commit([{ op: "create", object: "QuoteLineItem", record: newLine(ctx, quote.Id, p.Id, qty) }], `${p.Name} added`)} />}
    </section>
  );
}

function LineRow({
  line: l,
  product: p,
  typeName,
  editable,
  defaultQty,
  money,
  onPatch,
  onUp,
  onDown,
  onRemove,
}: {
  line: QuoteLineItem;
  product?: Product2;
  typeName?: string;
  editable: boolean;
  defaultQty: number;
  money: (n: number) => string;
  onPatch: (p: Partial<Pick<QuoteLineItem, "Quantity" | "ListPrice" | "Discount">>) => void;
  onUp?: () => void;
  onDown?: () => void;
  onRemove: () => void;
}) {
  const { recentIds } = useStore();
  const noun = p ? quantityNoun(p) : "units";
  return (
    <tr className={cn("transition-colors duration-700", recentIds.has(l.Id) && "bg-accent-soft")}>
      <td className="px-3 py-2">
        <p className="font-medium">{p?.Name ?? l.Product2Id}</p>
        <p className="text-xs text-muted-foreground">
          {[typeName, p ? unitLabel(p) : null, l.Description].filter(Boolean).join(" · ")}
          {p && !p.IsActive && <span className="ml-1 text-amber-800">Inactive</span>}
        </p>
      </td>
      <td className="px-3 py-2 text-right align-top">
        {editable ? (
          <>
            <NumCell value={l.Quantity} min={1} integer label={`Quantity, ${p?.Name}`} onCommit={(n) => onPatch({ Quantity: n })} className="w-20" />
            {l.Quantity !== defaultQty ? (
              <button type="button" onClick={() => onPatch({ Quantity: defaultQty })} className="block w-full text-right text-[11px] text-primary hover:underline">
                Account: {defaultQty}
              </button>
            ) : (
              noun !== "units" && <span className="block text-[11px] text-muted-foreground">{noun}</span>
            )}
          </>
        ) : (
          <span className="tabular">{l.Quantity}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right align-top tabular">{editable ? <NumCell value={l.ListPrice} step={100} label={`List price, ${p?.Name}`} onCommit={(n) => onPatch({ ListPrice: n })} className="w-24" /> : money(l.ListPrice)}</td>
      <td className="px-3 py-2 text-right align-top tabular">
        {editable ? <NumCell value={l.Discount} max={100} step={0.5} suffix="%" label={`Discount, ${p?.Name}`} onCommit={(n) => onPatch({ Discount: n })} className="w-16" /> : l.Discount ? fmtPctValue(l.Discount) : "—"}
      </td>
      <td className="px-3 py-2 text-right align-top tabular">{money(l.UnitPrice)}</td>
      <td className="px-3 py-2 text-right align-top font-medium tabular">{money(l.TotalPrice)}</td>
      {editable && (
        <td className="px-2 py-2 align-top">
          <div className="flex justify-end">
            <Button variant="ghost" size="icon-xs" aria-label={`Move ${p?.Name} up`} disabled={!onUp} onClick={onUp}>
              <ArrowUp />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label={`Move ${p?.Name} down`} disabled={!onDown} onClick={onDown}>
              <ArrowDown />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label={`Remove ${p?.Name}`} onClick={onRemove} className="text-muted-foreground hover:text-status-critical">
              <Trash2 />
            </Button>
          </div>
        </td>
      )}
    </tr>
  );
}

interface CatalogRow {
  product: Product2;
  price: number;
  type: string;
  onQuote: number;
}

function AddProductDialog({ quote, open, onOpenChange, onAdd }: { quote: Quote; open: boolean; onOpenChange: (o: boolean) => void; onAdd: (p: Product2, qty: number) => void }) {
  const { data } = useStore();
  const book = data.pricebooks.find((b) => b.Id === quote.Pricebook2Id);
  const account = data.accounts.find((a) => a.Id === quote.AccountId);
  const ccy = book?.CurrencyIsoCode ?? "USD";
  const rows = useMemo<CatalogRow[]>(() => {
    const types = new Map(data.productTypes.map((t) => [t.Id, t]));
    const counts = new Map<string, number>();
    for (const l of data.quoteLineItems) if (l.QuoteId === quote.Id) counts.set(l.Product2Id, (counts.get(l.Product2Id) ?? 0) + 1);
    return bookEntries(data, quote.Pricebook2Id)
      .filter((x) => x.entry.IsActive && x.product.IsActive)
      .map(({ entry, product }) => ({ product, price: entry.UnitPrice, type: (product.Product_Type__c && types.get(product.Product_Type__c)?.Name) || product.Family, onQuote: counts.get(product.Id) ?? 0 }))
      .sort((a, b) => a.type.localeCompare(b.type) || a.product.Name.localeCompare(b.product.Name));
  }, [data, quote.Id, quote.Pricebook2Id]);

  const columns: Column<CatalogRow>[] = [
    {
      key: "name",
      header: "Product",
      sortValue: (r) => r.product.Name,
      cell: (r) => (
        <div>
          <p className="font-medium">{r.product.Name}</p>
          <p className="text-xs text-muted-foreground">{r.product.ProductCode}</p>
        </div>
      ),
    },
    { key: "type", header: "Type", sortValue: (r) => r.type, cell: (r) => r.type },
    { key: "unit", header: "Pricing unit", cell: (r) => <span className="whitespace-nowrap">{unitLabel(r.product)}</span> },
    { key: "price", header: "Price", align: "right", sortValue: (r) => r.price, cell: (r) => fmtCurrency(r.price, ccy) },
    {
      key: "add",
      header: <span className="sr-only">Add</span>,
      align: "right",
      cell: (r) => {
        const qty = defaultQuantity(r.product, account);
        return (
          <div className="flex items-center justify-end gap-2">
            {r.onQuote > 0 && <span className="text-xs whitespace-nowrap text-muted-foreground">On quote</span>}
            <Button size="xs" variant={r.onQuote ? "outline" : "default"} onClick={() => onAdd(r.product, qty)}>
              Add{qty > 1 ? ` ×${qty}` : ""}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>Add product</DialogTitle>
          <DialogDescription>{book ? `${book.Name} · ${book.CurrencyIsoCode}` : "Price book"}</DialogDescription>
        </DialogHeader>
        {open && (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.product.Id}
            urlState={false}
            dense
            pageSizes={[]}
            search={{ placeholder: "Search products", text: (r) => `${r.product.Name} ${r.product.ProductCode} ${r.type}` }}
            empty="No active products in this price book"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
