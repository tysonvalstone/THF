"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { SEASON_PHASES, type ChatContext, type Sequence } from "@/lib/ai/types";
import { aiDraftSequence } from "@/lib/ai/client";
import { SEGMENTS } from "@/types/salesforce";
import { SEASON_PHASE_LABEL } from "@/lib/sequences/engine";
import { MONTHS } from "./sequence-store";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";

export function DraftDialog({
  open,
  onOpenChange,
  context,
  onDraft,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  context: ChatContext;
  onDraft: (s: Omit<Sequence, "id">) => void;
}) {
  const [goal, setGoal] = useState("");
  const [segment, setSegment] = useState<string>("Multi-Location Co-op");
  const [season, setSeason] = useState<string>(MONTHS[new Date(`${context.asOf}T00:00:00Z`).getUTCMonth()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await aiDraftSequence({ goal, segment, season }, context);
      if (!out.ok) {
        setError(out.reason);
        return;
      }
      onDraft(out.sequence);
      onOpenChange(false);
      setGoal("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Draft sequence</DialogTitle>
          <DialogDescription className="sr-only">Describe the sequence to draft</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-1">
            <Label htmlFor="draft-goal" className="text-xs">
              Goal
            </Label>
            <Textarea
              id="draft-goal"
              rows={4}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Book year-end reviews with co-op controllers before their board meets"
              className="text-sm"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label className="text-xs">Segment</Label>
              <Select value={segment} onValueChange={setSegment}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEGMENTS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Season</Label>
              <Select value={season} onValueChange={setSeason}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Month</SelectLabel>
                    {MONTHS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>Season phase</SelectLabel>
                    {SEASON_PHASES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {SEASON_PHASE_LABEL[p]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !goal.trim()} onClick={() => void submit()}>
            {busy && <Loader2 className="animate-spin" />}
            Draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
