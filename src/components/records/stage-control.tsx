"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { useUserId } from "@/lib/auth";
import { changeStage, LOSS_REASONS, stageBlockedReason } from "@/lib/actions/outreach";
import { ALL_STAGES, OPEN_STAGES, type Opportunity, type OpportunityStage } from "@/types/salesforce";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Hook: move a deal to a stage (gate, toast, Undo), asking for a loss reason on Closed Lost */
export function useStageChange() {
  const { data, asOf } = useStore();
  const { run } = useCrud();
  const userId = useUserId();
  const [lost, setLost] = useState<Opportunity | null>(null);

  const move = (opp: Opportunity, stage: OpportunityStage, lossReason?: string) => {
    if (stage === opp.StageName) return;
    const blocked = stageBlockedReason(opp, stage);
    if (blocked) {
      toast.error("Stage not changed", { description: blocked });
      return;
    }
    if (stage === "Closed Lost" && !lossReason) {
      setLost(opp);
      return;
    }
    const res = changeStage({ data, asOf, userId }, opp, stage, { lossReason });
    if (res.blocked) {
      toast.error("Stage not changed", { description: res.blocked });
      return;
    }
    run(res.mutations, res.summary[0], { undoable: true });
  };

  const dialog = (
    <LossReasonDialog
      opp={lost}
      onOpenChange={(o) => !o && setLost(null)}
      onConfirm={(reason) => {
        if (lost) move(lost, "Closed Lost", reason);
        setLost(null);
      }}
    />
  );
  return { move, dialog };
}

function LossReasonDialog({ opp, onOpenChange, onConfirm }: { opp: Opportunity | null; onOpenChange: (o: boolean) => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");
  const [tried, setTried] = useState(false);
  const value = reason === "Other" ? other.trim() : reason;
  return (
    <Dialog
      open={!!opp}
      onOpenChange={(o) => {
        if (!o) {
          setReason("");
          setOther("");
          setTried(false);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close as lost</DialogTitle>
          <DialogDescription>{opp?.Name}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="loss-reason">
            Loss reason <span className="text-status-critical">*</span>
          </Label>
          <select
            id="loss-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={tried && !value ? true : undefined}
            className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm aria-invalid:border-status-critical"
          >
            <option value="">Select…</option>
            {[...LOSS_REASONS, "Other"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          {reason === "Other" && (
            <input
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="Reason"
              aria-label="Other loss reason"
              className="h-9 w-full rounded-md border border-input bg-card px-2.5 text-sm outline-none focus:border-primary/50"
            />
          )}
          {tried && !value && <p className="text-xs text-status-critical">Required</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setTried(true);
              if (!value) return;
              onConfirm(value);
              setReason("");
              setOther("");
              setTried(false);
            }}
          >
            Close as lost
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Compact stage dropdown for a table row or board card */
export function StageSelect({
  opp,
  onChange,
  className,
  openOnly,
}: {
  opp: Opportunity;
  onChange: (opp: Opportunity, stage: OpportunityStage) => void;
  className?: string;
  /** Only the open stages plus the two closed outcomes (default: all) */
  openOnly?: boolean;
}) {
  const stages = openOnly ? [...OPEN_STAGES, "Closed Won", "Closed Lost"] : ALL_STAGES;
  return (
    <select
      value={opp.StageName}
      onChange={(e) => onChange(opp, e.target.value as OpportunityStage)}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Stage for ${opp.Name}`}
      className={cn(
        "h-7 max-w-full rounded-md border border-input bg-card px-1.5 text-xs",
        opp.StageName === "Closed Won" && "border-primary/40 text-primary",
        opp.StageName === "Closed Lost" && "text-muted-foreground",
        className,
      )}
    >
      {stages.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
