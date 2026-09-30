"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  setUserDisabled,
  updateUser,
  type ManagedUser,
  type NewUserInput,
} from "@/lib/account/admin-actions";
import { APP_ROLES, APP_ROLE_LABEL, type AppRole, type Role } from "@/lib/supabase/config";
import { USERS, USER_BY_ID } from "@/data/reference/users";
import { fmtRelative } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const STATUS: Record<ManagedUser["status"], { label: string; cls: string }> = {
  active: { label: "Active", cls: "text-status-good" },
  invited: { label: "Invited", cls: "text-muted-foreground" },
  "must-change-password": { label: "Temporary password", cls: "text-amber-800" },
  disabled: { label: "Disabled", cls: "text-status-critical" },
};

const selectCls = "h-9 w-full rounded-md border border-input bg-card px-2 text-sm";

function SfUserSelect({ value, onChange, id }: { value: string | null; onChange: (v: string | null) => void; id: string }) {
  return (
    <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={selectCls}>
      <option value="">None</option>
      {USERS.map((u) => (
        <option key={u.Id} value={u.Id}>
          {u.Name}
          {u.Title ? ` · ${u.Title}` : ""}
        </option>
      ))}
    </select>
  );
}

/** Shows a new temporary password once */
function PasswordReveal({ value, email, onClose }: { value: { password: string; email: string } | null; email?: string; onClose: () => void }) {
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Temporary password</DialogTitle>
          <DialogDescription>
            Share this with {value?.email ?? email} securely. It is shown once; they&apos;ll choose their own password when they first sign in.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-md border bg-panel px-3 py-2 font-mono text-sm select-all">{value?.password}</code>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(value?.password ?? "");
              toast.success("Copied");
            }}
          >
            Copy
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserDialog({
  open,
  onOpenChange,
  user,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Edit this user; add a new one when undefined */
  user?: ManagedUser;
  onSaved: (u: ManagedUser, tempPassword?: string) => void;
}) {
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [title, setTitle] = useState(user?.title ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "user");
  const [appRole, setAppRole] = useState<AppRole>(user?.appRole ?? "rep");
  const [sfUserId, setSfUserId] = useState<string | null>(user?.sfUserId ?? null);
  const [access, setAccess] = useState<NewUserInput["access"]>("password");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      const r = user ? await updateUser(user.id, { name, title, role, appRole, sfUserId }) : await createUser({ email, name, title, role, appRole, sfUserId, access });
      if (!r.ok) return setError(r.error);
      onSaved(r.user, (r as { tempPassword?: string }).tempPassword);
      onOpenChange(false);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{user ? "Edit user" : "Add user"}</DialogTitle>
          <DialogDescription>{user ? user.email : "They'll sign in with this email."}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="u-name">Full name</Label>
              <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            {!user && (
              <div className="grid gap-1.5">
                <Label htmlFor="u-email">Email</Label>
                <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="u-title">Title</Label>
              <Input id="u-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sales" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="u-role">Role</Label>
              <select id="u-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={selectCls}>
                <option value="user">User</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="u-app-role">Business role</Label>
              <select id="u-app-role" value={appRole} onChange={(e) => setAppRole(e.target.value as AppRole)} className={selectCls}>
                {APP_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {APP_ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="u-sf">Salesforce user</Label>
              <SfUserSelect id="u-sf" value={sfUserId} onChange={setSfUserId} />
              <p className="text-xs text-muted-foreground">Records they create are owned by this Salesforce user.</p>
            </div>
          </div>
          {!user && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Access</legend>
              {(
                [
                  ["password", "Create with a temporary password", "You'll see the password once and share it. They choose their own at first sign-in."],
                  ["invite", "Send an invitation email", "They set a password from the link in the email."],
                ] as const
              ).map(([v, label, help]) => (
                <label key={v} className={cn("flex cursor-pointer gap-3 rounded-md border p-3 text-sm", access === v && "border-primary bg-accent-soft")}>
                  <input type="radio" name="access" value={v} checked={access === v} onChange={() => setAccess(v)} className="mt-0.5 accent-[#1f5f4a]" />
                  <span>
                    <span className="block font-medium">{label}</span>
                    <span className="text-xs text-muted-foreground">{help}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {error && <p className="text-sm text-status-critical">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : user ? "Save" : "Add user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UsersAdmin() {
  const { session } = useAuth();
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [deleting, setDeleting] = useState<ManagedUser | null>(null);
  const [reveal, setReveal] = useState<{ password: string; email: string } | null>(null);
  const [query, setQuery] = useState("");
  const [, start] = useTransition();

  useEffect(() => {
    let live = true;
    listUsers().then((r) => {
      if (!live) return;
      if (r.ok) setUsers(r.users);
      else setLoadError(r.error);
    });
    return () => {
      live = false;
    };
  }, []);

  const upsert = (u: ManagedUser) => setUsers((list) => (list ? (list.some((x) => x.id === u.id) ? list.map((x) => (x.id === u.id ? u : x)) : [...list, u]) : [u]));
  const act = (fn: () => Promise<{ ok: true; user?: ManagedUser; message?: string; tempPassword?: string } | { ok: false; error: string }>, done?: string, email?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      if (r.user) upsert(r.user);
      if (r.tempPassword) setReveal({ password: r.tempPassword, email: email ?? r.user?.email ?? "" });
      else toast.success(r.message ?? done ?? "Saved");
    });

  const shown = (users ?? []).filter((u) => !query || `${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Users</h2>
          <p className="text-sm text-muted-foreground tabular">{users ? `${users.length} ${users.length === 1 ? "person" : "people"}` : "Loading…"}</p>
        </div>
        <div className="flex gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="h-8 w-48" aria-label="Search users" />
          <Button size="sm" onClick={() => setAdding(true)}>
            Add user
          </Button>
        </div>
      </div>

      {loadError && <p className="text-sm text-status-critical">{loadError}</p>}

      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Salesforce user</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Last sign-in</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((u) => {
              const self = u.id === session?.id;
              return (
                <tr key={u.id}>
                  <td className="px-4 py-2.5">
                    <span className="block font-medium">
                      {u.name || u.email}
                      {self && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {u.email}
                      {u.title ? ` · ${u.title}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {APP_ROLE_LABEL[u.appRole]}
                    {u.role === "admin" && u.appRole !== "admin" && <span className="block text-xs text-muted-foreground">Administrator</span>}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{u.sfUserId ? (USER_BY_ID[u.sfUserId]?.Name ?? u.sfUserId) : "—"}</td>
                  <td className={cn("px-3 py-2.5", STATUS[u.status].cls)}>{STATUS[u.status].label}</td>
                  <td className="px-3 py-2.5 text-muted-foreground tabular">{u.lastSignInAt ? fmtRelative(u.lastSignInAt, new Date()) : "Never"}</td>
                  <td className="px-2 py-2.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.email}`}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onSelect={() => setEditing(u)}>Edit</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => act(() => resetUserPassword(u.id, "email"))}>Email a reset link</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => act(() => resetUserPassword(u.id, "password"), undefined, u.email)}>Set temporary password</DropdownMenuItem>
                        {!self && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => act(() => setUserDisabled(u.id, u.status !== "disabled"), u.status === "disabled" ? "User enabled" : "User disabled")}>
                              {u.status === "disabled" ? "Enable" : "Disable"}
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-status-critical focus:text-status-critical" onSelect={() => setDeleting(u)}>
                              Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
            {users && !shown.length && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {adding && (
        <UserDialog
          open
          onOpenChange={setAdding}
          onSaved={(u, temp) => {
            upsert(u);
            if (temp) setReveal({ password: temp, email: u.email });
            else toast.success(`Invitation sent to ${u.email}`);
          }}
        />
      )}
      {editing && (
        <UserDialog
          key={editing.id}
          open
          user={editing}
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={(u) => {
            upsert(u);
            toast.success("User updated");
          }}
        />
      )}

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name || deleting?.email}?</DialogTitle>
            <DialogDescription>They lose access immediately. Records they created stay in place. To keep the account but block sign-in, disable it instead.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const u = deleting!;
                setDeleting(null);
                start(async () => {
                  const r = await deleteUser(u.id);
                  if (!r.ok) return void toast.error(r.error);
                  setUsers((list) => list?.filter((x) => x.id !== u.id) ?? null);
                  toast.success("User deleted");
                });
              }}
            >
              Delete user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PasswordReveal value={reveal} onClose={() => setReveal(null)} />
    </div>
  );
}
