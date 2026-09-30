"use client";

import { ChevronLeft, ChevronRight, Loader2, Pause, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEMO_STEPS } from "./steps";
import { useDemo } from "./demo-provider";

/** Walkthrough controls: step, one-line caption, Back / Next / Auto-play / Exit (sits in the page's bottom padding) */
export function WalkthroughDock() {
  const demo = useDemo();
  const w = demo.state?.walkthrough;
  if (!demo.on || !w?.active) return null;
  const step = DEMO_STEPS[w.step];
  const last = w.step === DEMO_STEPS.length - 1 && w.view === step.views.length - 1;
  const first = w.step === 0 && w.view === 0;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-[60] flex justify-center px-4" data-testid="demo-dock">
      <div className="pointer-events-auto flex w-full max-w-4xl items-center gap-3 rounded-md border bg-card px-3 py-2 shadow-md" role="region" aria-label="Demo walkthrough">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground tabular">
            Step {w.step + 1} of {DEMO_STEPS.length} · {step.title}
            {step.views.length > 1 && ` · ${w.view + 1}/${step.views.length}`}
          </p>
          <p className="line-clamp-2 text-sm font-medium" data-testid="demo-caption" title={demo.caption}>
            {demo.busy ? "Working…" : demo.error ? `Couldn't finish this step: ${demo.error}` : w.finished ? "Demo complete." : demo.caption}
          </p>
        </div>
        {demo.busy && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" onClick={demo.back} disabled={demo.busy || first} aria-label="Back">
            <ChevronLeft data-icon="inline-start" />
            <span className="hidden sm:inline">Back</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => demo.setAutoplay(!demo.autoplay)} disabled={w.finished} aria-pressed={demo.autoplay}>
            {demo.autoplay ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
            <span className="hidden sm:inline">Auto-play</span>
          </Button>
          <Button size="sm" onClick={demo.next} disabled={demo.busy || w.finished || (last && w.finished)} data-testid="demo-next">
            {last ? "Finish" : "Next"}
            <ChevronRight data-icon="inline-end" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={demo.exit} aria-label="Exit demo">
            <X />
          </Button>
        </div>
      </div>
    </div>
  );
}
