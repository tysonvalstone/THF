"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useCrud, newId } from "@/lib/data/crud";
import type { Mutation } from "@/lib/data/types";
import { FACILITY_TYPES, type Product2, type ProductFamily, type ProductType } from "@/types/salesforce";
import { standardBook, standardPrice, unitLabel } from "@/lib/quotes/catalog";
import { fmtCurrency } from "@/lib/quotes/pricing";
import { DataTable, type Column } from "@/components/shared/data-table";
import { RecordDrawer, type FieldDef, type FieldValue } from "@/components/shared/record-drawer";
import { ConfirmDialog, LocalChangeTag } from "@/components/shared/confirm-dialog";
import { ExportCsvButton } from "@/components/shared/column-picker";
import type { ColumnDef } from "@/lib/columns";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { selectCls } from "./shared";

const FAMILIES: ProductFamily[] = ["Financials", "Grain Operations", "Commodity Management", "Customer Engagement", "Feed", "Agronomy", "Processing", "Services"];
const UNITS: Product2["Pricing_Unit__c"][] = ["per year", "per location / year", "one-time"];
const FIT_SHORT: Record<string, string> = {
  "Grain Elevator": "Elevator",
  Cooperative: "Co-op",
  "Ethanol Plant": "Ethanol",
  "Feed Mill": "Feed",
  "Oilseed Crusher": "Crusher",
  "Flour Mill": "Flour",
  "Seed Processor": "Seed",
  "Agronomy Retailer": "Agronomy",
};

function ActiveCell({ on }: { on: boolean }) {
  return <span className={cn("text-xs", on ? "text-status-good" : "text-muted-foreground")}>{on ? "Active" : "Inactive"}</span>;
}

interface ProductRow {
  p: Product2;
  type: string;
  price: number;
  quotes: number;
}

export function ProductsView() {
  const { ready, data } = useStore();
  const { create, update, remove } = useCrud();
  const [editing, setEditing] = useState<Product2 | "new" | null>(null);
  const [deleting, setDeleting] = useState<Product2 | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState<"" | "active" | "inactive">("");
  const std = standardBook(data.pricebooks);

  const typeName = useMemo(() => new Map(data.productTypes.map((t) => [t.Id, t.Name])), [data.productTypes]);
  const all = useMemo<ProductRow[]>(() => {
    const used = new Map<string, number>();
    for (const l of data.quoteLineItems) used.set(l.Product2Id, (used.get(l.Product2Id) ?? 0) + 1);
    return data.products.map((p) => ({ p, type: (p.Product_Type__c && typeName.get(p.Product_Type__c)) || p.Family, price: standardPrice(data, p), quotes: used.get(p.Id) ?? 0 }));
  }, [data, typeName]);
  const rows = all.filter((r) => (!typeFilter || r.p.Product_Type__c === typeFilter) && (!activeFilter || r.p.IsActive === (activeFilter === "active")));

  const columns: Column<ProductRow>[] = [
    {
      key: "name",
      header: "Product",
      sortValue: (r) => r.p.Name,
      cell: (r) => (
        <div className="max-w-[300px] min-w-[180px]">
          <p className="font-medium">
            {r.p.Name}
            <LocalChangeTag id={r.p.Id} />
          </p>
          <p className="truncate text-xs text-muted-foreground" title={r.p.Description}>
            {r.p.Description}
          </p>
        </div>
      ),
    },
    { key: "code", header: "Code", sortValue: (r) => r.p.ProductCode, cell: (r) => <span className="font-mono text-xs">{r.p.ProductCode}</span> },
    { key: "type", header: "Type", sortValue: (r) => r.type, cell: (r) => <span className="whitespace-nowrap">{r.type}</span> },
    { key: "unit", header: "Pricing unit", sortValue: (r) => r.p.Pricing_Unit__c, cell: (r) => <span className="whitespace-nowrap">{unitLabel(r.p)}</span> },
    { key: "price", header: "List price", align: "right", sortValue: (r) => r.price, cell: (r) => fmtCurrency(r.price) },
    { key: "active", header: "Status", sortValue: (r) => Number(r.p.IsActive), cell: (r) => <ActiveCell on={r.p.IsActive} /> },
    {
      key: "fit",
      header: "Best fit",
      hideBelow: "lg",
      cell: (r) => <span className="text-xs text-muted-foreground">{r.p.Best_Fit__c.length ? (r.p.Best_Fit__c.length === FACILITY_TYPES.length ? "All" : r.p.Best_Fit__c.map((f) => FIT_SHORT[f] ?? f).join(", ")) : "Any"}</span>,
    },
    { key: "quotes", header: "On quotes", align: "right", sortValue: (r) => r.quotes, hideBelow: "md", cell: (r) => <span className="text-muted-foreground">{r.quotes}</span> },
  ];

  const csv: ColumnDef<ProductRow>[] = [
    { key: "code", label: "Product Code", value: (r) => r.p.ProductCode, required: true },
    { key: "name", label: "Name", value: (r) => r.p.Name },
    { key: "type", label: "Type", value: (r) => r.type },
    { key: "unit", label: "Pricing Unit", value: (r) => r.p.Pricing_Unit__c },
    { key: "label", label: "Unit Label", value: (r) => r.p.Unit_Label__c ?? "" },
    { key: "price", label: "List Price", type: "currency", value: (r) => r.price },
    { key: "active", label: "Active", type: "boolean", value: (r) => r.p.IsActive },
    { key: "fit", label: "Best Fit", value: (r) => r.p.Best_Fit__c.join(";") },
    { key: "description", label: "Description", value: (r) => r.p.Description, defaultOn: false },
    { key: "id", label: "Product Id", value: (r) => r.p.Id, defaultOn: false },
  ];

  const current = editing && editing !== "new" ? editing : null;
  const activeTypes = data.productTypes.filter((t) => t.IsActive || t.Id === current?.Product_Type__c).sort((a, b) => a.SortOrder - b.SortOrder);
  const fields: FieldDef[] = [
    { name: "Name", label: "Name", required: true, wide: true },
    {
      name: "ProductCode",
      label: "Product code",
      required: true,
      validate: (v) => (data.products.some((p) => p.ProductCode.toLowerCase() === String(v ?? "").trim().toLowerCase() && p.Id !== current?.Id) ? "Code already used" : null),
    },
    { name: "Product_Type__c", label: "Type", type: "select", required: true, options: activeTypes.map((t) => ({ value: t.Id, label: t.Name })) },
    { name: "Pricing_Unit__c", label: "Pricing unit", type: "select", required: true, options: UNITS.map((u) => ({ value: u, label: u })) },
    { name: "Unit_Label__c", label: "Unit label", placeholder: "kiosk", help: "Priced per unit, e.g. kiosk" },
    { name: "List_Price__c", label: `List price (${std?.Name ?? "standard"})`, type: "currency", required: true, min: 0 },
    { name: "IsActive", label: "Active", type: "checkbox" },
    { name: "Description", label: "Description", type: "textarea", wide: true },
    ...FACILITY_TYPES.map((f): FieldDef => ({ name: `fit:${f}`, label: f, type: "checkbox" })),
  ];
  const initial: Record<string, FieldValue> = current
    ? {
        Name: current.Name,
        ProductCode: current.ProductCode,
        Product_Type__c: current.Product_Type__c ?? "",
        Pricing_Unit__c: current.Pricing_Unit__c,
        Unit_Label__c: current.Unit_Label__c ?? "",
        List_Price__c: standardPrice(data, current),
        IsActive: current.IsActive,
        Description: current.Description,
        ...Object.fromEntries(FACILITY_TYPES.map((f) => [`fit:${f}`, current.Best_Fit__c.includes(f)])),
      }
    : { Name: "", ProductCode: "", Product_Type__c: "", Pricing_Unit__c: "per year", Unit_Label__c: "", List_Price__c: "", IsActive: true, Description: "" };

  const save = (v: Record<string, FieldValue>) => {
    const typeId = String(v.Product_Type__c);
    const tName = typeName.get(typeId) ?? "";
    const family = (FAMILIES as string[]).includes(tName) ? (tName as ProductFamily) : (current?.Family ?? "Services");
    const price = Number(v.List_Price__c);
    const record = {
      Name: String(v.Name),
      ProductCode: String(v.ProductCode).toUpperCase(),
      Product_Type__c: typeId,
      Family: family,
      Pricing_Unit__c: v.Pricing_Unit__c as Product2["Pricing_Unit__c"],
      Unit_Label__c: String(v.Unit_Label__c ?? "").trim().toLowerCase(),
      List_Price__c: price,
      IsActive: !!v.IsActive,
      Description: String(v.Description ?? ""),
      Best_Fit__c: FACILITY_TYPES.filter((f) => !!v[`fit:${f}`]),
    };
    if (!current) {
      const id = newId("Product2");
      const extra: Mutation[] = std ? [{ op: "create", object: "PricebookEntry", record: { Id: newId("PricebookEntry"), Pricebook2Id: std.Id, Product2Id: id, UnitPrice: price, IsActive: true } }] : [];
      create("Product2", { Id: id, ...record }, record.Name, extra);
    } else {
      const entry = std && data.pricebookEntries.find((e) => e.Pricebook2Id === std.Id && e.Product2Id === current.Id);
      const extra: Mutation[] = [];
      if (entry && entry.UnitPrice !== price) extra.push({ op: "update", object: "PricebookEntry", id: entry.Id, changes: { UnitPrice: price } });
      else if (!entry && std) extra.push({ op: "create", object: "PricebookEntry", record: { Id: newId("PricebookEntry"), Pricebook2Id: std.Id, Product2Id: current.Id, UnitPrice: price, IsActive: true } });
      update("Product2", current.Id, record, record.Name, extra);
    }
    setEditing(null);
  };

  if (!ready) return <Skeleton className="h-[480px]" />;
  const deletingUses = deleting ? data.quoteLineItems.filter((l) => l.Product2Id === deleting.Id).length + data.lineItems.filter((l) => l.Product2Id === deleting.Id).length : 0;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Products</h2>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.p.Id}
          caption="Products"
          search={{ placeholder: "Search products", text: (r) => `${r.p.Name} ${r.p.ProductCode} ${r.type} ${r.p.Description}` }}
          filterKey={`${typeFilter}|${activeFilter}`}
          defaultSort={{ key: "type", dir: "asc" }}
          onRowClick={(r) => setEditing(r.p)}
          minWidth={860}
          filters={
            <>
              <select aria-label="Type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={selectCls}>
                <option value="">All types</option>
                {data.productTypes
                  .slice()
                  .sort((a, b) => a.SortOrder - b.SortOrder)
                  .map((t) => (
                    <option key={t.Id} value={t.Id}>
                      {t.Name}
                    </option>
                  ))}
              </select>
              <select aria-label="Status" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)} className={selectCls}>
                <option value="">Active and inactive</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </>
          }
          actions={
            <>
              <ExportCsvButton exportId="products" columns={csv} rows={all} filteredRows={rows} filename="products.csv" size="sm" title="Export products" />
              <Button size="sm" onClick={() => setEditing("new")}>
                <Plus />
                New product
              </Button>
            </>
          }
        />
      </section>

      <ProductTypes />

      <RecordDrawer
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={current ? `Edit ${current.Name}` : "New product"}
        fields={fields}
        initial={initial}
        submitLabel={current ? "Save" : "Create product"}
        onSubmit={save}
        onDelete={
          current
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
        title={deletingUses ? `${deleting?.Name} is in use` : `Delete ${deleting?.Name}?`}
        description={
          deletingUses
            ? `It is on ${deletingUses} quote or opportunity line${deletingUses === 1 ? "" : "s"}, so it can't be deleted. Deactivate it to hide it from new quotes.`
            : "Also removes its price book entries. You can undo this for a few seconds afterwards."
        }
        confirmLabel={deletingUses ? "Deactivate" : "Delete"}
        destructive={!deletingUses}
        onConfirm={() => {
          if (!deleting) return;
          if (deletingUses) update("Product2", deleting.Id, { IsActive: false }, deleting.Name);
          else
            remove(
              "Product2",
              deleting.Id,
              deleting.Name,
              data.pricebookEntries.filter((e) => e.Product2Id === deleting.Id).map((e): Mutation => ({ op: "delete", object: "PricebookEntry", id: e.Id })),
            );
        }}
      />
    </div>
  );
}

function ProductTypes() {
  const { data } = useStore();
  const { create, update, remove } = useCrud();
  const [editing, setEditing] = useState<ProductType | "new" | null>(null);
  const [deleting, setDeleting] = useState<ProductType | null>(null);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data.products) if (p.Product_Type__c) m.set(p.Product_Type__c, (m.get(p.Product_Type__c) ?? 0) + 1);
    return m;
  }, [data.products]);
  const current = editing && editing !== "new" ? editing : null;

  const columns: Column<ProductType>[] = [
    { key: "order", header: "Order", align: "right", sortValue: (t) => t.SortOrder, cell: (t) => <span className="text-muted-foreground">{t.SortOrder}</span>, className: "w-16" },
    {
      key: "name",
      header: "Type",
      sortValue: (t) => t.Name,
      cell: (t) => (
        <span className="font-medium">
          {t.Name}
          <LocalChangeTag id={t.Id} />
        </span>
      ),
    },
    { key: "description", header: "Description", cell: (t) => <span className="text-muted-foreground">{t.Description}</span> },
    { key: "products", header: "Products", align: "right", sortValue: (t) => counts.get(t.Id) ?? 0, cell: (t) => counts.get(t.Id) ?? 0 },
    { key: "active", header: "Status", sortValue: (t) => Number(t.IsActive), cell: (t) => <ActiveCell on={t.IsActive} /> },
  ];
  const fields: FieldDef[] = [
    { name: "Name", label: "Name", required: true, validate: (v) => (data.productTypes.some((t) => t.Name.toLowerCase() === String(v ?? "").trim().toLowerCase() && t.Id !== current?.Id) ? "Name already used" : null) },
    { name: "SortOrder", label: "Sort order", type: "number", required: true, min: 0, step: 1 },
    { name: "Description", label: "Description", wide: true },
    { name: "IsActive", label: "Active", type: "checkbox" },
  ];
  const nextOrder = data.productTypes.reduce((m, t) => Math.max(m, t.SortOrder), 0) + 1;
  const used = deleting ? (counts.get(deleting.Id) ?? 0) : 0;

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Product types</h2>
      <DataTable
        rows={data.productTypes}
        columns={columns}
        rowKey={(t) => t.Id}
        caption="Product types"
        param="typesPage"
        defaultSort={{ key: "order", dir: "asc" }}
        onRowClick={(t) => setEditing(t)}
        search={{ placeholder: "Search types", text: (t) => `${t.Name} ${t.Description}` }}
        actions={
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus />
            New type
          </Button>
        }
      />
      <RecordDrawer
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={current ? `Edit ${current.Name}` : "New product type"}
        fields={fields}
        initial={current ? { Name: current.Name, SortOrder: current.SortOrder, Description: current.Description, IsActive: current.IsActive } : { Name: "", SortOrder: nextOrder, Description: "", IsActive: true }}
        submitLabel={current ? "Save" : "Create type"}
        onSubmit={(v) => {
          const record = { Name: String(v.Name), SortOrder: Number(v.SortOrder), Description: String(v.Description ?? ""), IsActive: !!v.IsActive };
          if (current) update("ProductType", current.Id, record, record.Name);
          else create("ProductType", record, record.Name);
          setEditing(null);
        }}
        onDelete={
          current
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
        title={used ? `${deleting?.Name} is in use` : `Delete ${deleting?.Name}?`}
        description={used ? `${used} product${used === 1 ? " uses" : "s use"} this type. Deactivate it instead, or move the products first.` : undefined}
        confirmLabel={used ? "Deactivate" : "Delete"}
        destructive={!used}
        onConfirm={() => {
          if (!deleting) return;
          if (used) update("ProductType", deleting.Id, { IsActive: false }, deleting.Name);
          else remove("ProductType", deleting.Id, deleting.Name);
        }}
      />
    </section>
  );
}
