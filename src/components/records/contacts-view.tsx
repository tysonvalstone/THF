"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { userName } from "@/lib/data/selectors";
import type { ColumnDef } from "@/lib/columns";
import type { Account, BuyingRole, Contact } from "@/types/salesforce";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog, LocalChangeTag } from "@/components/shared/confirm-dialog";
import { ExportCsvButton } from "@/components/shared/column-picker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactDrawer } from "./forms";
import { contactDeletePlan } from "./delete-rules";

const ALL = "all";
const ROLES: BuyingRole[] = ["Decision Maker", "Economic Buyer", "Champion", "Influencer", "End User", "Board Member"];

interface Row {
  c: Contact;
  account?: Account;
}

const CSV: ColumnDef<Row>[] = [
  { key: "id", label: "Contact Id", value: (r) => r.c.Id },
  { key: "first", label: "First Name", value: (r) => r.c.FirstName },
  { key: "last", label: "Last Name", value: (r) => r.c.LastName },
  { key: "title", label: "Title", value: (r) => r.c.Title },
  { key: "account", label: "Account", value: (r) => r.account?.Name },
  { key: "role", label: "Buying Role", value: (r) => r.c.Buying_Role__c },
  { key: "email", label: "Email", value: (r) => r.c.Email },
  { key: "phone", label: "Phone", value: (r) => r.c.Phone },
  { key: "mobile", label: "Mobile", value: (r) => r.c.MobilePhone },
  { key: "state", label: "State/Province", value: (r) => r.c.MailingState },
  { key: "opted_out", label: "Email Opt Out", type: "boolean", value: (r) => r.c.HasOptedOutOfEmail },
  { key: "owner", label: "Owner", value: (r) => userName(r.c.OwnerId) },
];

export function ContactsView() {
  const { ready, data, asOfISO } = useStore();
  const { remove } = useCrud();
  const [role, setRole] = useState(ALL);
  const [optOut, setOptOut] = useState(ALL);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Contact | null>(null);

  const rows = useMemo<Row[]>(() => {
    const accounts = new Map(data.accounts.map((a) => [a.Id, a]));
    return data.contacts.map((c) => ({ c, account: accounts.get(c.AccountId) }));
  }, [data.contacts, data.accounts]);
  const filtered = useMemo(
    () => rows.filter((r) => (role === ALL || r.c.Buying_Role__c === role) && (optOut === ALL || (optOut === "out") === r.c.HasOptedOutOfEmail)),
    [rows, role, optOut],
  );

  if (!ready) return <Skeleton className="h-[560px]" />;

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Name",
      sortValue: (r) => `${r.c.LastName} ${r.c.FirstName}`,
      cell: (r) => (
        <div className="min-w-0">
          <p className="font-medium">
            {r.c.Name}
            <LocalChangeTag id={r.c.Id} />
          </p>
          <p className="truncate text-xs text-muted-foreground">{r.c.Title}</p>
        </div>
      ),
    },
    {
      key: "account",
      header: "Account",
      sortValue: (r) => r.account?.Name,
      cell: (r) =>
        r.account ? (
          <div className="min-w-0 max-w-72">
            <Link href={`/accounts/${r.account.Id}`} className="block truncate hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
              {r.account.Name}
            </Link>
            <p className="text-xs text-muted-foreground">
              {r.account.BillingCity}, {r.account.BillingState}
            </p>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: "role", header: "Buying role", sortValue: (r) => r.c.Buying_Role__c, cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{r.c.Buying_Role__c}</span> },
    { key: "email", header: "Email", hideBelow: "md", sortValue: (r) => r.c.Email, cell: (r) => <span className="text-muted-foreground">{r.c.Email || "—"}</span> },
    { key: "phone", header: "Phone", hideBelow: "lg", cell: (r) => <span className="whitespace-nowrap text-muted-foreground tabular">{r.c.MobilePhone || r.c.Phone || "—"}</span> },
    {
      key: "opt",
      header: "Opted out",
      hideBelow: "sm",
      sortValue: (r) => Number(r.c.HasOptedOutOfEmail),
      cell: (r) => (r.c.HasOptedOutOfEmail ? <span className="rounded-sm border px-1.5 py-px text-xs text-muted-foreground">Opted out</span> : <span className="text-muted-foreground">—</span>),
    },
  ];

  const sel = (label: string, value: string, set: (v: string) => void, options: [string, string][]) => (
    <select value={value} onChange={(e) => set(e.target.value)} aria-label={label} className="h-8 rounded-md border border-input bg-card px-2 text-sm">
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Contacts</h1>
      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.c.Id}
        search={{ placeholder: "Search name, title, account, email", text: (r) => `${r.c.Name} ${r.c.Title} ${r.account?.Name ?? ""} ${r.c.Email}` }}
        filters={
          <>
            {sel("Buying role", role, setRole, [[ALL, "All buying roles"], ...ROLES.map((x) => [x, x] as [string, string])])}
            {sel("Email opt-out", optOut, setOptOut, [[ALL, "Opted in & out"], ["in", "Opted in"], ["out", "Opted out"]])}
          </>
        }
        filterKey={`${role}|${optOut}`}
        actions={
          <>
            <ExportCsvButton
              size="sm"
              exportId="contacts"
              title="Export contacts"
              columns={CSV}
              rows={rows}
              filteredRows={filtered}
              filename={`harvestsignal-contacts-${asOfISO}.csv`}
              disabled={!filtered.length}
            />
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> New contact
            </Button>
          </>
        }
        defaultSort={{ key: "name", dir: "asc" }}
        onRowClick={(r) => setEditing(r.c)}
        minWidth={720}
        caption="Contacts"
      />
      <ContactDrawer
        open={creating || !!editing}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
          }
        }}
        record={editing ?? undefined}
        onDelete={
          editing
            ? () => {
                setDeleting(editing);
                setEditing(null);
              }
            : undefined
        }
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.Name ?? "contact"}?`}
        description={`${contactDeletePlan().detail} You can undo this for a few seconds afterwards.`}
        onConfirm={() => deleting && remove("Contact", deleting.Id, "Contact", contactDeletePlan().cascade)}
      />
    </div>
  );
}
