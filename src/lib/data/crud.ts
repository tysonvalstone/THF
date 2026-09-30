"use client";

/**
 * Create / edit / delete through the shared store, with consistent feedback:
 * a success toast, a 2-second row highlight (store.recentIds), and Undo for
 * deletes. Every change is a Salesforce-style mutation in the local change
 * log, so it survives a refresh and shows up everywhere that reads the store.
 */
import { useCallback } from "react";
import { toast } from "sonner";
import { useStore } from "./store";
import { useAuth } from "@/lib/auth";
import { APP_ROLE_LABEL } from "@/lib/supabase/config";
import { auditMutations } from "@/lib/audit";
import { newId } from "./local-repository";
import type { Mutation, ObjectMap, ObjectName } from "./types";

type NewRecord<K extends ObjectName> = Omit<ObjectMap[K], "Id"> & { Id?: string };

export function useCrud() {
  const { commit, undo, changeLog, localOnly, data } = useStore();
  const { session, role } = useAuth();
  const suffix = localOnly ? " (local change, not synced)" : "";

  /** Commits mutations; returns a function that undoes exactly them if nothing else changed since */
  const run = useCallback(
    (mutations: Mutation[], message?: string, opts: { undoable?: boolean } = {}) => {
      if (!mutations.length) return;
      // Every change carries its audit entries in the same commit, so Undo removes both
      const actor = { id: session?.id ?? "system", name: session?.name ?? "System", role: APP_ROLE_LABEL[role] };
      const all = [...mutations, ...auditMutations(mutations, data, actor, new Date())];
      commit(all);
      const expected = changeLog().length;
      const revert = () => {
        if (changeLog().length === expected) undo(all.length);
        else toast.error("Can't undo: other changes were made since");
      };
      if (message) {
        if (opts.undoable) toast.success(message + suffix, { duration: 5000, action: { label: "Undo", onClick: revert } });
        else toast.success(message + suffix);
      }
    },
    [commit, undo, changeLog, suffix, data, session, role],
  );

  const create = useCallback(
    <K extends ObjectName>(object: K, record: NewRecord<K>, label?: string, extra: Mutation[] = []): string => {
      const id = record.Id ?? newId(object);
      run([{ op: "create", object, record: { ...record, Id: id } } as unknown as Mutation, ...extra], label ? `${label} created` : undefined);
      return id;
    },
    [run],
  );

  const update = useCallback(
    <K extends ObjectName>(object: K, id: string, changes: Partial<ObjectMap[K]>, label?: string, extra: Mutation[] = []) => {
      run([{ op: "update", object, id, changes } as unknown as Mutation, ...extra], label ? `${label} updated` : undefined);
    },
    [run],
  );

  /** Deletes a record (plus any dependent records in `cascade`) with a 5-second Undo */
  const remove = useCallback(
    (object: ObjectName, id: string, label: string, cascade: Mutation[] = [], verb = "deleted") => {
      run([...cascade, { op: "delete", object, id }], `${label} ${verb}`, { undoable: true });
    },
    [run],
  );

  return { run, create, update, remove };
}

export { newId };
