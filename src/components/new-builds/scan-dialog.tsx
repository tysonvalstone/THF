"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useCrud, newId } from "@/lib/data/crud";
import type { Mutation } from "@/lib/data/types";
import { SCAN_SOURCES, scanNewBuilds, sourceIndex } from "@/lib/new-builds/scan";
import { fmtMoney } from "@/lib/format";
import type { NewBuild } from "@/types/salesforce";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const STEP_MS = 650;

/** Simulated scan: walks the sources, then adds what it "found" as NewBuild records. No web requests. */
export function ScanDialog({ open, onOpenChange, onView }: { open: boolean; onOpenChange: (o: boolean) => void; onView: (id: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">{open && <ScanBody onClose={() => onOpenChange(false)} onView={onView} />}</DialogContent>
    </Dialog>
  );
}

function ScanBody({ onClose, onView }: { onClose: () => void; onView: (id: string) => void }) {
  const { data, asOfISO } = useStore();
  const { run } = useCrud();
  // What this scan will "find": fixed when the dialog opens
  const [planned] = useState(() => scanNewBuilds(asOfISO, data.newBuilds).map((b): NewBuild => ({ ...b, Id: newId("NewBuild") })));
  const [step, setStep] = useState(0);
  const done = step >= SCAN_SOURCES.length;

  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => {
      const next = step + 1;
      if (next >= SCAN_SOURCES.length && planned.length) {
        const mutations: Mutation[] = planned.map((record) => ({ op: "create", object: "NewBuild", record }));
        run(mutations, `${planned.length} new build${planned.length === 1 ? "" : "s"} found`);
      }
      setStep(next);
    }, STEP_MS);
    return () => clearTimeout(t);
  }, [step, done, planned, run]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Scan sources</DialogTitle>
        <DialogDescription>{done ? "Scan complete" : `Scanning ${SCAN_SOURCES[step].name.toLowerCase()}…`}</DialogDescription>
      </DialogHeader>
      <Progress value={(step / SCAN_SOURCES.length) * 100} aria-label="Scan progress" />
      <ol className="divide-y rounded-md border text-sm">
        {SCAN_SOURCES.map((s, i) => {
          const state = i < step ? "done" : i === step ? "active" : "pending";
          const n = planned.filter((b) => sourceIndex(b.Source) === i).length;
          return (
            <li key={s.name} className="flex items-center gap-2.5 px-3 py-2">
              <span className="flex size-4 shrink-0 items-center justify-center">
                {state === "done" ? (
                  <Check className="size-3.5 text-primary" aria-hidden />
                ) : state === "active" ? (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
                ) : (
                  <span className="size-1.5 rounded-full bg-slate-300" />
                )}
              </span>
              <span className={cn("min-w-0 flex-1 truncate", state === "pending" && "text-muted-foreground")}>{s.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular">{state === "done" ? (n ? `${n} found` : "Nothing new") : ""}</span>
            </li>
          );
        })}
      </ol>
      {done &&
        (planned.length ? (
          <ul className="divide-y rounded-md border text-sm">
            {planned.map((b) => (
              <li key={b.Id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{b.Name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {b.City}, {b.State} · {b.Stage} · {fmtMoney(b.Estimated_Investment)}
                  </span>
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    onClose();
                    onView(b.Id);
                  }}
                >
                  View
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">No new builds since the last scan</p>
        ))}
      <DialogFooter>
        <Button variant={done ? "default" : "ghost"} onClick={onClose}>
          {done ? "Done" : "Cancel"}
        </Button>
      </DialogFooter>
    </>
  );
}
