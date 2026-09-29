"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import type { ScoredTarget } from "@/lib/scoring";
import { sizeLabel } from "@/lib/scoring";
import { recordHref } from "@/lib/links";
import { ScorePill, TierLabel } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";

/** Compact prospect card used on the dashboard and in lists */
export function ProspectRowCard({ s, rank, actions }: { s: ScoredTarget; rank?: number; actions?: React.ReactNode }) {
  const t = s.target;
  return (
    <div className="flex gap-3 py-3 first:pt-0 last:pb-0">
      {rank !== undefined && <span className="w-5 shrink-0 pt-0.5 text-right text-xs font-medium text-muted-foreground tabular">{rank}</span>}
      <ScorePill score={s.total} className="w-9 shrink-0 pt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={recordHref(t.id)} className="truncate font-medium hover:underline">
            {t.name}
          </Link>
          <TierLabel tier={s.tier} />
          {t.kind === "lead" && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              Lead
            </Badge>
          )}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span>{t.facilityType}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-0.5">
            <MapPin className="size-3" aria-hidden />
            {t.city}, {t.state}
          </span>
          <span aria-hidden>·</span>
          <span>{sizeLabel(t)}</span>
        </p>
        <p className="mt-1.5 line-clamp-2 text-sm text-foreground/85">{s.whyNow}</p>
        {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
