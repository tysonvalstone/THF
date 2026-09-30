"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DEFAULT_SIM_SETTINGS, type SimSettings } from "@/lib/harvest/summary";

const FIELDS: { key: keyof SimSettings; label: string; unit: string; min: number; max: number; step: number }[] = [
  { key: "manualMinutes", label: "Manual scale time", unit: "min/truck", min: 1, max: 20, step: 0.5 },
  { key: "automatedMinutes", label: "Automated scale time", unit: "min/truck", min: 0.5, max: 10, step: 0.5 },
  { key: "waitLimitMinutes", label: "Trucks leave after", unit: "min", min: 5, max: 180, step: 5 },
  { key: "marginPerBu", label: "Handling margin", unit: "$/bu", min: 0.01, max: 2, step: 0.01 },
  { key: "seasonDays", label: "Harvest season", unit: "days", min: 1, max: 120, step: 1 },
];

export function SettingsPopover({ settings, onChange }: { settings: SimSettings; onChange: (s: SimSettings) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const changed = FIELDS.some((f) => settings[f.key] !== DEFAULT_SIM_SETTINGS[f.key]);
  const commit = (key: keyof SimSettings, raw: string) => {
    const f = FIELDS.find((x) => x.key === key)!;
    const v = Number(raw);
    setDraft((d) => ({ ...d, [key]: "" }));
    if (!Number.isFinite(v) || raw.trim() === "") return;
    onChange({ ...settings, [key]: Math.min(f.max, Math.max(f.min, v)) });
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Simulation settings">
          <SlidersHorizontal className="size-3.5" aria-hidden />
          Settings
          {changed && <span className="size-1.5 rounded-full bg-primary" aria-label="changed" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="space-y-2.5">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{f.label}</span>
              <span className="flex items-center gap-1.5">
                <input
                  type="number"
                  inputMode="decimal"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={draft[f.key] || String(settings[f.key])}
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, [f.key]: e.target.value }));
                    const v = Number(e.target.value);
                    if (e.target.value !== "" && Number.isFinite(v) && v >= f.min && v <= f.max) onChange({ ...settings, [f.key]: v });
                  }}
                  onBlur={(e) => commit(f.key, e.target.value)}
                  className="h-7 w-16 rounded-md border border-input bg-card px-2 text-right text-sm tabular outline-none focus:border-primary/50"
                />
                <span className="w-14 text-xs text-muted-foreground">{f.unit}</span>
              </span>
            </label>
          ))}
          <div className="flex justify-end border-t pt-2.5">
            <Button variant="ghost" size="xs" disabled={!changed} onClick={() => onChange({ ...DEFAULT_SIM_SETTINGS })}>
              Reset to defaults
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
