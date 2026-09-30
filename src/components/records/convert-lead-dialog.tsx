"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { useUserId } from "@/lib/auth";
import { leadHasPerson, leadToAccountMutations } from "@/lib/new-builds/convert";
import { addDays, toISODate } from "@/lib/dates";
import type { Lead } from "@/types/salesforce";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Convert a lead to an Account, plus a Contact and optionally an Opportunity */
export function ConvertLeadDialog({ lead, open, onOpenChange }: { lead: Lead; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, asOf } = useStore();
  const { run } = useCrud();
  const userId = useUserId();
  const router = useRouter();
  const person = leadHasPerson(lead);
  const [name, setName] = useState(lead.Company);
  const [contact, setContact] = useState(person);
  const [opp, setOpp] = useState(false);
  const [oppName, setOppName] = useState(`${lead.Company} - New Business`);
  const [close, setClose] = useState(toISODate(addDays(asOf, 90)));
  const [tried, setTried] = useState(false);
  const nameErr = !name.trim() ? "Required" : data.accounts.some((a) => a.Name.toLowerCase() === name.trim().toLowerCase()) ? "An account with this name already exists" : null;
  const oppErr = opp && !oppName.trim() ? "Required" : null;

  const submit = () => {
    setTried(true);
    if ((nameErr && nameErr === "Required") || oppErr) return;
    const res = leadToAccountMutations(lead, { data, asOf, userId }, { accountName: name, createContact: contact, createOpportunity: opp, opportunityName: oppName, closeDate: close });
    run(res.mutations, `Lead converted to account ${name.trim()}`, { undoable: true });
    onOpenChange(false);
    router.push(`/accounts/${res.accountId}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convert lead</DialogTitle>
          <DialogDescription>
            {lead.Company} · {lead.City}, {lead.State}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="cv-name">
              Account name <span className="text-status-critical">*</span>
            </Label>
            <Input id="cv-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={tried && !!nameErr ? true : undefined} />
            {nameErr && (tried || nameErr !== "Required") && <p className={nameErr === "Required" ? "text-xs text-status-critical" : "text-xs text-muted-foreground"}>{nameErr}</p>}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={contact} disabled={!person} onChange={(e) => setContact(e.target.checked)} className="size-4 accent-[#1f5f4a]" />
            {person ? `Create contact ${lead.Name}${lead.Title ? `, ${lead.Title}` : ""}` : "No contact person on this lead"}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={opp} onChange={(e) => setOpp(e.target.checked)} className="size-4 accent-[#1f5f4a]" />
            Create an opportunity
          </label>
          {opp && (
            <div className="grid gap-3 rounded-md border bg-panel p-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
              <div className="grid gap-1.5">
                <Label htmlFor="cv-opp">
                  Opportunity name <span className="text-status-critical">*</span>
                </Label>
                <Input id="cv-opp" value={oppName} onChange={(e) => setOppName(e.target.value)} className="bg-card" aria-invalid={tried && !!oppErr ? true : undefined} />
                {tried && oppErr && <p className="text-xs text-status-critical">{oppErr}</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cv-close">Close date</Label>
                <Input id="cv-close" type="date" value={close} onChange={(e) => e.target.value && setClose(e.target.value)} className="bg-card" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Convert</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
