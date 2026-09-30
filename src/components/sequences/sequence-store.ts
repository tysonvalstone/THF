"use client";

import { useEffect, useMemo, useState } from "react";
import { localCollection, newId } from "@/lib/storage";
import type { Enrollment, MergeField, Sequence, SequenceStep, StepType } from "@/lib/ai/types";
import type { Account, Contact, Task } from "@/types/salesforce";
import type { DataSnapshot, Mutation } from "@/lib/data/types";
import { newId as newRecordId } from "@/lib/data/local-repository";

export const sequencesCollection = localCollection<Sequence>("harvest-signal:sequences:v1");
export const enrollmentsCollection = localCollection<Enrollment>("harvest-signal:enrollments:v1");

export const STEP_TYPE_LABEL: Record<StepType, string> = { email: "Email", call: "Call task", linkedin: "LinkedIn task" };

export const FIELD_LABEL: Record<MergeField, string> = {
  "contact.first_name": "Contact first name",
  "contact.title": "Contact title",
  "account.name": "Account name",
  "account.locations": "Locations",
  region: "Region",
  state: "State",
  commodity: "Commodity",
  season_phase: "Season phase",
  blackout_end_date: "Blackout end date",
  fiscal_year_end: "Fiscal year end",
  next_board_meeting: "Next board meeting",
  "sender.name": "Sender name",
};

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Browser-only list of enrollments, kept in sync with storage */
export function useEnrollments() {
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state loads after mount
    setLoaded(true);
    return enrollmentsCollection.subscribe(() => setVersion((v) => v + 1));
  }, []);
  const items = useMemo(() => {
    void version;
    return loaded ? enrollmentsCollection.list() : [];
  }, [version, loaded]);
  return { items, loaded };
}

export function blankStep(day: number, type: StepType = "email"): SequenceStep {
  return { id: newId("st"), type, day, subject: type === "email" ? "" : undefined, body: "", variants: [] };
}

export function blankSequence(): Sequence {
  return { id: newId("seq"), name: "Untitled sequence", description: "", steps: [blankStep(1)], prebuilt: false };
}

/** Make sure an AI draft has ids and arrays everywhere */
export function normalizeSequence(s: Omit<Sequence, "id"> & { id?: string }): Sequence {
  return {
    ...s,
    id: s.id ?? newId("seq"),
    prebuilt: false,
    steps: (s.steps ?? [])
      .map((st) => ({
        ...st,
        id: st.id || newId("st"),
        day: Math.max(1, Math.round(Number(st.day) || 1)),
        body: st.body ?? "",
        variants: (st.variants ?? []).map((v) => ({ ...v, id: v.id || newId("va"), rules: v.rules ?? [] })),
      }))
      .sort((a, b) => a.day - b.day),
  };
}

/** Comparable form of a sequence (ignores save metadata) */
export function fingerprint(s: Sequence | undefined | null): string {
  if (!s) return "";
  const { updatedAt, prebuilt, ...rest } = s;
  void updatedAt;
  void prebuilt;
  return JSON.stringify(rest);
}

export interface Recipient {
  key: string;
  account: Account;
  contact?: Contact;
}

export function recipientName(r: Recipient): string {
  return r.contact?.Name ?? r.account.Name;
}

export function canEmail(c: Contact): boolean {
  return !!c.Email && !c.HasOptedOutOfEmail;
}

/** Salesforce-style Tasks for an enrollment (one per step) */
export function enrollmentTasks(e: Enrollment, sequence: Sequence, userId: string, stamp: string): Mutation[] {
  return e.steps.map((s) => {
    const step = sequence.steps.find((x) => x.id === s.stepId);
    const task: Task = {
      Id: newRecordId("Task"),
      Subject: `Sequence step: ${sequence.name} — Day ${step?.day ?? 1}`,
      Type: s.type === "email" ? "Email" : s.type === "call" ? "Call" : "Other",
      TaskSubtype: s.type === "email" ? "Email" : s.type === "call" ? "Call" : "Task",
      Status: "Not Started",
      Priority: "Normal",
      ActivityDate: s.date,
      AccountId: e.accountId,
      WhatId: e.accountId,
      ...(e.contactId ? { WhoId: e.contactId } : {}),
      OwnerId: userId,
      CreatedDate: stamp,
      Description: `${s.subject ? `${s.subject}\n\n` : ""}${s.body.length > 300 ? `${s.body.slice(0, 300)}…` : s.body}`,
    };
    return { op: "create", object: "Task", record: task } as Mutation;
  });
}

export function nowStamp(asOf: Date): string {
  const now = new Date();
  const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()));
  return d.toISOString().replace(/\.\d{3}Z$/, ".000+0000");
}

export type { DataSnapshot };

/** Scheduled (not completed) Salesforce tasks that an enrollment created */
export function enrollmentTaskIds(e: Enrollment, tasks: Task[]): string[] {
  const prefix = `Sequence step: ${e.sequenceName} — `;
  const dates = new Set(e.steps.map((s) => s.date));
  return tasks
    .filter((t) => t.Status !== "Completed" && t.AccountId === e.accountId && (t.WhoId ?? undefined) === (e.contactId ?? undefined) && t.Subject.startsWith(prefix) && dates.has(t.ActivityDate))
    .map((t) => t.Id);
}
