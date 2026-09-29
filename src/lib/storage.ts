"use client";

/**
 * Small storage module for user-created templates, sequences and enrollments.
 *
 * Everything goes through `Collection`, so the localStorage implementation
 * can be swapped for a database-backed one later without touching the UI.
 * Prebuilt items (seeded JSON) are merged in by `useStoredCollection`: editing
 * a prebuilt item saves a local override with the same id; deleting one hides it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

export interface Collection<T extends { id: string }> {
  list(): T[];
  save(item: T): void;
  remove(id: string): void;
  hidden(): string[];
  hide(id: string): void;
  subscribe(fn: () => void): () => void;
}

export function localCollection<T extends { id: string }>(key: string): Collection<T> {
  const listeners = new Set<() => void>();
  const hiddenKey = `${key}:hidden`;
  function read<V>(k: string, fallback: V): V {
    try {
      const raw = window.localStorage.getItem(k);
      return raw ? (JSON.parse(raw) as V) : fallback;
    } catch {
      return fallback;
    }
  }
  function write(k: string, v: unknown) {
    try {
      window.localStorage.setItem(k, JSON.stringify(v));
    } catch {
      // storage blocked or full: nothing to do
    }
    listeners.forEach((fn) => fn());
  }
  return {
    list: () => read<T[]>(key, []),
    save(item) {
      const all = read<T[]>(key, []);
      const i = all.findIndex((x) => x.id === item.id);
      if (i >= 0) all[i] = item;
      else all.push(item);
      write(key, all);
    },
    remove(id) {
      write(
        key,
        read<T[]>(key, []).filter((x) => x.id !== id),
      );
    },
    hidden: () => read<string[]>(hiddenKey, []),
    hide(id) {
      write(hiddenKey, [...new Set([...read<string[]>(hiddenKey, []), id])]);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Prebuilt + user items, with save / remove / duplicate */
export function useStoredCollection<T extends { id: string; name: string; prebuilt?: boolean; updatedAt?: string }>(
  collection: Collection<T>,
  prebuilt: T[],
  idPrefix: string,
) {
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state loads after mount
    setLoaded(true);
    return collection.subscribe(() => setVersion((v) => v + 1));
  }, [collection]);

  const items = useMemo<T[]>(() => {
    void version;
    if (!loaded) return prebuilt.map((p) => ({ ...p, prebuilt: true }));
    const local = collection.list();
    const hidden = new Set(collection.hidden());
    const localById = new Map(local.map((x) => [x.id, x]));
    const prebuiltIds = new Set(prebuilt.map((p) => p.id));
    const base = prebuilt.filter((p) => !hidden.has(p.id)).map((p) => ({ ...(localById.get(p.id) ?? p), prebuilt: true }));
    return [...base, ...local.filter((x) => !prebuiltIds.has(x.id) && !hidden.has(x.id))];
  }, [collection, prebuilt, version, loaded]);

  const save = useCallback((item: T) => collection.save({ ...item, updatedAt: new Date().toISOString() }), [collection]);
  const remove = useCallback(
    (id: string) => {
      collection.remove(id);
      if (prebuilt.some((p) => p.id === id)) collection.hide(id);
    },
    [collection, prebuilt],
  );
  const duplicate = useCallback(
    (item: T): T => {
      const copy: T = { ...structuredClone(item), id: newId(idPrefix), name: `${item.name} (copy)`, prebuilt: false, updatedAt: new Date().toISOString() };
      collection.save(copy);
      return copy;
    },
    [collection, idPrefix],
  );
  return { items, save, remove, duplicate, loaded };
}
