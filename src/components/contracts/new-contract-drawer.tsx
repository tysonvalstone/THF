"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { addMonths, parseDate, toISODate } from "@/lib/dates";
import { blankContractMutations, contractFromQuoteMutations } from "@/lib/contracts";
import { RecordDrawer, type FieldValue } from "@/components/shared/record-drawer";
import { TERM_CHOICES, useContractContext } from "./shared";

/** New contract: from an accepted quote (one click) or blank */
export function NewContractDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data, asOf } = useStore();
  const ctx = useContractContext();
  const { run } = useCrud();
  const router = useRouter();

  const quotes = useMemo(() => {
    const have = new Set(data.contracts.map((c) => c.QuoteId).filter(Boolean));
    const names = new Map(data.accounts.map((a) => [a.Id, a.Name]));
    return data.quotes
      .filter((q) => q.Status === "Accepted" && !have.has(q.Id))
      .sort((a, b) => (b.Accepted_Date__c ?? "").localeCompare(a.Accepted_Date__c ?? ""))
      .map((q) => ({ value: q.Id, label: `${q.QuoteNumber} · ${names.get(q.AccountId) ?? q.Name}` }));
  }, [data.contracts, data.quotes, data.accounts]);

  const accounts = useMemo(
    () =>
      [...data.accounts]
        .sort((a, b) => (a.Type === b.Type ? a.Name.localeCompare(b.Name) : a.Type === "Customer - Direct" ? -1 : 1))
        .map((a) => ({ value: a.Id, label: a.Type === "Customer - Direct" ? a.Name : `${a.Name} (prospect)` })),
    [data.accounts],
  );

  const firstOfNextMonth = toISODate(addMonths(parseDate(`${toISODate(asOf).slice(0, 7)}-01`), 1));
  const noQuote = (v: Record<string, FieldValue>) => !v.quoteId;

  return (
    <RecordDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="New contract"
      submitLabel="Create contract"
      initial={{ quoteId: quotes[0]?.value ?? "", accountId: "", startDate: firstOfNextMonth, termMonths: "36", arr: "", oneTime: "" }}
      fields={[
        { name: "quoteId", label: "Accepted quote", type: "select", options: quotes, wide: true, help: "Leave empty for a blank contract" },
        { name: "accountId", label: "Account", type: "select", options: accounts, wide: true, validate: (v, all) => (noQuote(all) && !v ? "Required for a blank contract" : null) },
        { name: "startDate", label: "Start date", type: "date", validate: (v, all) => (noQuote(all) && !v ? "Required" : null) },
        { name: "termMonths", label: "Term", type: "select", required: true, options: TERM_CHOICES.map((n) => ({ value: String(n), label: `${n} months` })) },
        { name: "arr", label: "ARR", type: "currency", min: 0, validate: (v, all) => (noQuote(all) && !(Number(v) > 0) ? "Required for a blank contract" : null) },
        { name: "oneTime", label: "One-time fees", type: "currency", min: 0 },
      ]}
      onSubmit={(v) => {
        try {
          const r = v.quoteId
            ? contractFromQuoteMutations(ctx, String(v.quoteId))
            : blankContractMutations(ctx, {
                accountId: String(v.accountId),
                startDate: String(v.startDate),
                termMonths: Number(v.termMonths),
                arr: Number(v.arr) || 0,
                oneTime: Number(v.oneTime) || 0,
              });
          const number = r.mutations.find((m) => m.op === "create" && m.object === "Contract");
          run(r.mutations, number && number.op === "create" && number.object === "Contract" ? `Contract ${number.record.ContractNumber} created` : "Contract created");
          onOpenChange(false);
          router.push(`/contracts/${r.contractId}`);
        } catch (e) {
          return e instanceof Error ? e.message : "Could not create the contract";
        }
      }}
    />
  );
}
