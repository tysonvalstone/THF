import type { Phase } from "@/lib/season";
import type { Tier } from "@/lib/scoring";
import { cn } from "@/lib/utils";

export const PHASE_STYLE: Record<Phase, { fill: string; text: string; chip: string; label: string }> = {
  "Pre-harvest": { fill: "var(--phase-pre)", text: "#ffffff", chip: "bg-[#e6f0fc] text-[#1c5cab] ring-[#b7d3f6]", label: "Pre-harvest (launch window)" },
  Harvest: { fill: "var(--phase-harvest)", text: "#ffffff", chip: "bg-[#fdeee6] text-[#a8431b] ring-[#f6c9b3]", label: "Harvest underway" },
  "Post-harvest": { fill: "var(--phase-post)", text: "#ffffff", chip: "bg-[#e3f6ee] text-[#0f7a53] ring-[#a9e2cb]", label: "Post-harvest (settlements)" },
  Planting: { fill: "var(--phase-planting)", text: "#1b2a21", chip: "bg-[#eef3ee] text-[#3d5543] ring-[#cfdccf]", label: "Planting" },
  Growing: { fill: "var(--phase-growing)", text: "#1b2a21", chip: "bg-[#f1f4f0] text-[#4d5c51] ring-[#d9e0d8]", label: "Growing" },
  Dormant: { fill: "var(--phase-dormant)", text: "#1b2a21", chip: "bg-[#f3f4f2] text-[#5a625c] ring-[#e1e3dd]", label: "Off-season" },
};

export function PhaseChip({ phase, children, className }: { phase: Phase; children?: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", PHASE_STYLE[phase].chip, className)}>
      <span className="size-1.5 rounded-full" style={{ background: PHASE_STYLE[phase].fill }} aria-hidden />
      {children ?? phase}
    </span>
  );
}

const TIER: Record<Tier, string> = {
  Hot: "text-primary",
  Warm: "text-foreground",
  Cool: "text-muted-foreground",
};

export function TierLabel({ tier, className }: { tier: Tier; className?: string }) {
  return <span className={cn("text-xs font-medium", TIER[tier], className)}>{tier}</span>;
}

/** Score as a number over a thin sequential bar */
export function ScorePill({ score, className, size = "md" }: { score: number; className?: string; size?: "sm" | "md" | "lg" }) {
  const shade = score >= 72 ? "#1c5cab" : score >= 60 ? "#3987e5" : "#86b6ef";
  return (
    <span className={cn("inline-flex flex-col items-stretch", className)} aria-label={`Score ${score} out of 100`}>
      <span className={cn("font-semibold tabular leading-none", size === "lg" ? "text-3xl" : size === "sm" ? "text-sm" : "text-lg")}>{score}</span>
      <span className={cn("mt-1 overflow-hidden rounded-full bg-[#e8ecf2]", size === "lg" ? "h-1.5 w-16" : "h-1 w-9")}>
        <span className="block h-full rounded-full" style={{ width: `${score}%`, background: shade }} />
      </span>
    </span>
  );
}
