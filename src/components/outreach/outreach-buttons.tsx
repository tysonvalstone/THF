"use client";

import { useState } from "react";
import { Mail, Megaphone, Phone } from "lucide-react";
import type { ScoredTarget } from "@/lib/scoring";
import { Button } from "@/components/ui/button";
import { OutreachDialog, type OutreachTab } from "./outreach-dialog";

/** One-click outreach: email, log a call, or add to a campaign */
export function OutreachButtons({ target, size = "sm" }: { target: ScoredTarget; size?: "xs" | "sm" }) {
  const [tab, setTab] = useState<OutreachTab | null>(null);
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <Button size={size} variant="outline" onClick={() => setTab("email")}>
          <Mail /> Email
        </Button>
        <Button size={size} variant="outline" onClick={() => setTab("call")}>
          <Phone /> Log call
        </Button>
        <Button size={size} variant="outline" onClick={() => setTab("campaign")}>
          <Megaphone /> Add to campaign
        </Button>
      </div>
      <OutreachDialog s={target} open={tab !== null} onOpenChange={(o) => !o && setTab(null)} tab={tab ?? "email"} />
    </>
  );
}
