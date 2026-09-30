"use client";

import { useState } from "react";
import { Activity, FastForward, Play, RotateCcw } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { fmtDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DEMO_STEPS } from "./steps";
import { useDemo } from "./demo-provider";

/** Thin Demo Mode bar under the header: walkthrough, fast-forward, activity, reset */
export function DemoBar() {
  const demo = useDemo();
  const { asOfISO, ready } = useStore();
  const [confirm, setConfirm] = useState(false);
  if (!demo.on) return null;
  const w = demo.state?.walkthrough;
  const resumable = !!w && !w.active && !w.finished && (w.step > 0 || w.view > 0);
  return (
    <div className="border-t bg-muted/60" data-testid="demo-bar">
      <div className="scrollbar-none mx-auto flex h-10 max-w-[1400px] items-center gap-2 overflow-x-auto px-4 text-sm">
        <span className="shrink-0 font-medium">Demo Mode</span>
        <span className="hidden shrink-0 text-xs text-muted-foreground tabular sm:inline">As of {fmtDate(asOfISO)}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {w?.active ? (
            <span className="px-1 text-xs text-muted-foreground tabular">
              Step {w.step + 1} of {DEMO_STEPS.length}
            </span>
          ) : (
            <Button size="sm" onClick={demo.start} disabled={!ready || demo.busy}>
              <Play data-icon="inline-start" />
              {resumable ? "Resume demo" : "Start demo"}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void demo.fastForward(7)} disabled={!ready || demo.busy}>
            <FastForward data-icon="inline-start" />
            <span className="sm:hidden">7 days</span>
            <span className="hidden sm:inline">Fast-forward 7 days</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => void demo.fastForward(30)} disabled={!ready || demo.busy}>
            <FastForward data-icon="inline-start" />
            <span className="sm:hidden">30 days</span>
            <span className="hidden sm:inline">Fast-forward 30 days</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => demo.setActivityOpen(true)}>
            <Activity data-icon="inline-start" />
            Activity
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} disabled={!ready || demo.busy}>
            <RotateCcw data-icon="inline-start" />
            Reset Demo
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Reset the demo?"
        description={`Every demo change is discarded and the date goes back to ${fmtDate("2026-09-29")}.`}
        confirmLabel="Reset Demo"
        onConfirm={demo.reset}
      />
    </div>
  );
}
