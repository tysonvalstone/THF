"use client";

/**
 * Saved column setups for CSV exports: named presets per export, plus the
 * last-used setup for each export (restored the next time its dialog opens).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { localCollection, newId } from "@/lib/storage";
import type { ColumnSetup } from "@/lib/columns";

export interface ColumnPreset {
  id: string;
  name: string;
  exportId: string;
  setup: ColumnSetup;
  updatedAt?: string;
}

interface LastUsed {
  /** The export id */
  id: string;
  name: string;
  setup: ColumnSetup;
}

const presetCollection = localCollection<ColumnPreset>("harvest-signal:csv-presets:v1");
const lastCollection = localCollection<LastUsed>("harvest-signal:csv-last:v1");

export function useColumnPresets(exportId: string) {
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state loads after mount
    setLoaded(true);
    const bump = () => setVersion((v) => v + 1);
    const a = presetCollection.subscribe(bump);
    const b = lastCollection.subscribe(bump);
    return () => {
      a();
      b();
    };
  }, []);

  const presets = useMemo<ColumnPreset[]>(() => {
    void version;
    if (!loaded) return [];
    return presetCollection
      .list()
      .filter((p) => p.exportId === exportId)
      .sort((x, y) => x.name.localeCompare(y.name));
  }, [exportId, version, loaded]);

  const lastUsed = useMemo<ColumnSetup | undefined>(() => {
    void version;
    if (!loaded) return undefined;
    return lastCollection.list().find((l) => l.id === exportId)?.setup;
  }, [exportId, version, loaded]);

  const savePreset = useCallback(
    (name: string, setup: ColumnSetup): ColumnPreset => {
      const clean = name.trim() || "Untitled preset";
      const existing = presetCollection.list().find((p) => p.exportId === exportId && p.name.toLowerCase() === clean.toLowerCase());
      const preset: ColumnPreset = { id: existing?.id ?? newId("csvp"), name: clean, exportId, setup, updatedAt: new Date().toISOString() };
      presetCollection.save(preset);
      return preset;
    },
    [exportId],
  );

  const deletePreset = useCallback((id: string) => presetCollection.remove(id), []);

  const rememberLast = useCallback((setup: ColumnSetup) => lastCollection.save({ id: exportId, name: exportId, setup }), [exportId]);

  return { presets, savePreset, deletePreset, lastUsed, rememberLast, loaded };
}
