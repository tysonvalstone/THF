"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, CircleCheck, Pencil, Plus, Trash2 } from "lucide-react";
import type { OnboardingTask } from "@/types/salesforce";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { USERS } from "@/data/reference/users";
import { userName } from "@/lib/data/selectors";
import { fmtDate, fmtShortDate, parseDate } from "@/lib/dates";
import { goLiveWarning } from "@/lib/quotes/build";
import { markLiveMutations, ONBOARDING_PHASES, ONBOARDING_STATUSES, projectProgress, projectTasks, statusAfterTaskChange, toggleTaskMutations } from "@/lib/success/onboarding";
import { RecordDrawer, type FieldDef } from "@/components/shared/record-drawer";
import { ConfirmDialog, LocalChangeTag } from "@/components/shared/confirm-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Notice } from "@/components/quotes/shared";
import { cn } from "@/lib/utils";
import { ProgressBar, ProjectStatusPill } from "./shared";

const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x }));

export function OnboardingDetail({ id }: { id: string }) {
  const { ready, data, asOf } = useStore();
  const { run, create, update, remove } = useCrud();
  const [editing, setEditing] = useState(false);
  const [taskForm, setTaskForm] = useState<null | "new" | OnboardingTask>(null);
  const [deleting, setDeleting] = useState<OnboardingTask | null>(null);
  const [goingLive, setGoingLive] = useState(false);

  const project = data.onboardingProjects.find((p) => p.Id === id);
  const tasks = useMemo(() => projectTasks(data, id), [data, id]);
  if (!ready) return <Skeleton className="h-[560px]" />;
  if (!project) {
    return (
      <div className="space-y-3">
        <Link href="/customers/onboarding" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ChevronLeft className="size-4" />
          Onboarding
        </Link>
        <p className="text-sm text-muted-foreground">This project no longer exists.</p>
      </div>
    );
  }

  const account = data.accounts.find((a) => a.Id === project.AccountId);
  const contract = data.contracts.find((c) => c.Id === project.ContractId);
  const progress = projectProgress(project, tasks, asOf);
  const warning = goLiveWarning(account, project.TargetGoLive);
  const live = project.Status === "Live";

  const projectFields: FieldDef[] = [
    { name: "Status", label: "Status", type: "select", required: true, options: opts(ONBOARDING_STATUSES) },
    { name: "OwnerId", label: "Owner", type: "select", required: true, options: USERS.map((u) => ({ value: u.Id, label: u.Name })) },
    { name: "StartDate", label: "Start", type: "date", required: true },
    {
      name: "TargetGoLive",
      label: "Target go-live",
      type: "date",
      required: true,
      validate: (v, all) => (String(v) < String(all.StartDate) ? "After the start date" : null),
    },
  ];
  const taskFields: FieldDef[] = [
    { name: "Name", label: "Task", required: true, wide: true },
    { name: "Phase", label: "Phase", type: "select", required: true, options: opts(ONBOARDING_PHASES) },
    { name: "DueDate", label: "Due", type: "date", required: true },
  ];

  function setDue(t: OnboardingTask, due: string) {
    if (!due || due === t.DueDate) return;
    update("OnboardingTask", t.Id, { DueDate: due }, "Task");
  }

  return (
    <div className="space-y-5">
      <Link href="/customers/onboarding" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ChevronLeft className="size-4" />
        Onboarding
      </Link>

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">
            {project.Name}
            <LocalChangeTag id={project.Id} />
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <ProjectStatusPill status={project.Status} />
            {account && (
              <Link href={`/accounts/${account.Id}`} className="text-primary hover:underline">
                {account.Name}
              </Link>
            )}
            {contract && <span>{contract.ContractNumber}</span>}
            <span>{userName(project.OwnerId)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil />
            Edit
          </Button>
          {!live && (
            <Button size="sm" onClick={() => setGoingLive(true)}>
              <CircleCheck />
              Mark Live
            </Button>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">Start</dt>
          <dd className="mt-0.5 font-medium tabular">{fmtDate(project.StartDate)}</dd>
        </div>
        <div className="rounded-md border bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">{live ? "Went live" : "Target go-live"}</dt>
          <dd className="mt-0.5 font-medium tabular">{fmtDate(live && project.GoLiveDate ? project.GoLiveDate : project.TargetGoLive)}</dd>
        </div>
        <div className="rounded-md border bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">Days to go-live</dt>
          <dd className={cn("mt-0.5 font-medium tabular", !live && progress.daysToGoLive < 0 && "text-status-critical")}>{live ? "—" : progress.daysToGoLive}</dd>
        </div>
        <div className="rounded-md border bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">Progress</dt>
          <dd className="mt-1.5">
            <ProgressBar pct={progress.pct} />
          </dd>
        </div>
      </dl>

      {warning && !live && <Notice>{warning}</Notice>}

      <section className="rounded-md border bg-card">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">
            Checklist
            <span className="ml-2 font-normal text-muted-foreground tabular">
              {progress.done} of {progress.total}
            </span>
          </h2>
          <Button size="sm" variant="outline" onClick={() => setTaskForm("new")}>
            <Plus />
            Add task
          </Button>
        </div>
        {tasks.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No tasks</p>
        ) : (
          <ul className="divide-y">
            {tasks.map((t) => {
              const overdue = !t.Done && !live && parseDate(t.DueDate) < asOf;
              return (
                <li key={t.Id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <Checkbox
                    checked={t.Done}
                    aria-label={`${t.Name} done`}
                    onCheckedChange={(v) => run(toggleTaskMutations(data, t.Id, v === true, asOf), v === true ? "Task done" : "Task reopened")}
                  />
                  <div className="min-w-[200px] flex-1">
                    <p className={cn("text-sm", t.Done && "text-muted-foreground line-through")}>
                      {t.Name}
                      <LocalChangeTag id={t.Id} />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.Phase}
                      {t.Done && t.CompletedDate && ` · Done ${fmtShortDate(t.CompletedDate)}`}
                      {overdue && <span className="font-medium text-status-critical"> · Overdue</span>}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Due
                    <input
                      type="date"
                      value={t.DueDate}
                      onChange={(e) => setDue(t, e.target.value)}
                      className={cn("h-8 rounded-md border border-input bg-card px-2 text-sm text-foreground tabular", overdue && "border-red-300")}
                    />
                  </label>
                  <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${t.Name}`} onClick={() => setTaskForm(t)}>
                    <Pencil />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-8" aria-label={`Delete ${t.Name}`} onClick={() => setDeleting(t)}>
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <RecordDrawer
        open={editing}
        onOpenChange={setEditing}
        title="Edit project"
        description={project.Name}
        fields={projectFields}
        initial={{ Status: project.Status, OwnerId: project.OwnerId, StartDate: project.StartDate, TargetGoLive: project.TargetGoLive }}
        onSubmit={(v) => {
          const status = v.Status as typeof project.Status;
          update(
            "OnboardingProject",
            project.Id,
            {
              Status: status,
              OwnerId: String(v.OwnerId),
              StartDate: String(v.StartDate),
              TargetGoLive: String(v.TargetGoLive),
              ...(status === "Live" && !project.GoLiveDate ? { GoLiveDate: asOf.toISOString().slice(0, 10) } : {}),
            },
            "Project",
          );
          setEditing(false);
        }}
      />

      <RecordDrawer
        open={taskForm !== null}
        onOpenChange={(o) => !o && setTaskForm(null)}
        title={taskForm === "new" ? "Add task" : "Edit task"}
        description={project.Name}
        fields={taskFields}
        initial={
          taskForm && taskForm !== "new"
            ? { Name: taskForm.Name, Phase: taskForm.Phase, DueDate: taskForm.DueDate }
            : { Name: "", Phase: progress.nextTask?.Phase ?? "Configuration", DueDate: progress.nextTask?.DueDate ?? project.TargetGoLive }
        }
        onSubmit={(v) => {
          const fields = { Name: String(v.Name).trim(), Phase: v.Phase as OnboardingTask["Phase"], DueDate: String(v.DueDate) };
          if (taskForm === "new") {
            const phaseIdx = ONBOARDING_PHASES.indexOf(fields.Phase);
            const samePhase = tasks.filter((t) => ONBOARDING_PHASES.indexOf(t.Phase) <= phaseIdx);
            const sort = (samePhase.length ? Math.max(...samePhase.map((t) => t.SortOrder)) : 0) + 1;
            const next = statusAfterTaskChange(project, tasks);
            create("OnboardingTask", { ProjectId: project.Id, ...fields, Done: false, SortOrder: sort }, "Task", next !== project.Status ? [{ op: "update", object: "OnboardingProject", id: project.Id, changes: { Status: next } }] : []);
          } else if (taskForm) {
            update("OnboardingTask", taskForm.Id, fields, "Task");
          }
          setTaskForm(null);
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.Name ?? ""}"?`}
        onConfirm={() => deleting && remove("OnboardingTask", deleting.Id, "Task")}
      />

      <ConfirmDialog
        open={goingLive}
        onOpenChange={setGoingLive}
        title="Mark this project Live?"
        description={`Open tasks are checked off and the go-live date is set to ${fmtDate(asOf)}.`}
        confirmLabel="Mark Live"
        destructive={false}
        onConfirm={() => run(markLiveMutations(data, project, asOf), `${account?.Name ?? "Project"} is live`)}
      />
    </div>
  );
}
