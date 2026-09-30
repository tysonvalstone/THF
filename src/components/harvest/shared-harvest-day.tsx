"use client";

import { useState } from "react";
import { Logo } from "@/components/brand/logo";
import type { Competitor, SimSettings } from "@/lib/harvest/summary";
import type { Account } from "@/types/salesforce";
import { HarvestSimulator } from "./simulator";

/** Public, read-only simulator for one facility (share link) */
export function SharedHarvestDay({ account, competitor, settings: initial }: { account: Account; competitor: Competitor | null; settings: SimSettings }) {
  const [settings, setSettings] = useState(initial);
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 px-4">
          <Logo />
          <span className="text-sm text-muted-foreground">Harvest Day Simulator</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-6 pb-12">
        <HarvestSimulator account={account} competitor={competitor} settings={settings} onSettingsChange={setSettings} />
      </main>
      <footer className="border-t bg-card">
        <div className="mx-auto max-w-[1400px] px-4 py-4 text-xs text-muted-foreground">Prepared by ThiboLiSoft</div>
      </footer>
    </div>
  );
}
