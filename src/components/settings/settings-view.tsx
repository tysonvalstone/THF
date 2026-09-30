"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { changePassword, updateMyProfile } from "@/lib/account/actions";
import { MIN_PASSWORD } from "@/lib/supabase/config";
import { UsersAdmin } from "./users-admin";
import { AuditLog } from "./audit-log";
import { ClauseLibrary } from "@/components/contracts/clause-library";
import { can } from "@/lib/roles";
import { toast } from "sonner";
import { useAuth, type SalesforceConnection } from "@/lib/auth";
import { useStore } from "@/lib/data/store";
import { Avatar } from "@/components/auth/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Resize an uploaded image to a small square JPEG data URL */
async function toAvatar(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const size = 192;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d")!;
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border bg-card p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function AccountDetails() {
  const { session } = useAuth();
  const router = useRouter();
  const [name, setName] = useState(session?.name ?? "");
  const [title, setTitle] = useState(session?.title ?? "");
  const [pending, start] = useTransition();
  if (!session) return null;
  return (
    <Section title="Details">
      <form
        className="grid max-w-md gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await updateMyProfile({ name, title });
            if (r.error) toast.error(r.error);
            else {
              toast.success("Profile saved");
              router.refresh();
            }
          });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sales" />
        </div>
        <div className="grid gap-1.5">
          <Label>Email</Label>
          <Input value={session.email} disabled />
        </div>
        <div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function ProfileTab() {
  const { user, me, updateProfile, mode } = useAuth();
  const [email, setEmail] = useState(me.email ?? "");
  const [title, setTitle] = useState(me.title ?? "");
  const fileRef = useRef<HTMLInputElement>(null);
  if (!user) return null;
  return (
    <div className="space-y-5">
      <Section title="Photo">
        <div className="flex items-center gap-4">
          <Avatar name={user.Name} photo={me.photo} size={72} />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              Upload photo
            </Button>
            {me.photo && (
              <Button variant="ghost" size="sm" onClick={() => updateProfile({ photo: undefined })}>
                Remove
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                updateProfile({ photo: await toAvatar(f) });
                toast.success("Photo updated");
              } catch {
                toast.error("That file couldn't be read as an image");
              }
            }}
          />
        </div>
      </Section>
      {mode === "supabase" ? (
        <AccountDetails />
      ) : (
      <Section title="Details">
        <form
          className="grid max-w-md gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            updateProfile({ email: email.trim() || undefined, title: title.trim() || undefined });
            toast.success("Profile saved");
          }}
        >
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input value={user.Name} disabled />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sales" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </div>
          <div>
            <Button type="submit" size="sm">
              Save
            </Button>
          </div>
        </form>
      </Section>
      )}
    </div>
  );
}

function AccountPassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Section title="Password">
      <form
        className="grid max-w-md gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (next !== confirm) return setError("Passwords don't match.");
          start(async () => {
            const r = await changePassword(current, next);
            if (r.error) return setError(r.error);
            setCurrent("");
            setNext("");
            setConfirm("");
            toast.success("Password changed");
          });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="current">Current password</Label>
          <Input id="current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="new">New password</Label>
          <Input id="new" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} value={next} onChange={(e) => setNext(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        {error && <p className="text-sm text-status-critical">{error}</p>}
        <div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Change password"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function SecurityTab() {
  const { me, setPassword, mode } = useAuth();
  const has = !!me.passwordHash;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (mode === "supabase") return <AccountPassword />;

  const submit = async (remove = false) => {
    setError(null);
    if (!remove) {
      if (next.length < 6) return setError("Use at least 6 characters.");
      if (next !== confirm) return setError("Passwords don't match.");
    }
    const ok = await setPassword(has ? current : undefined, remove ? null : next);
    if (!ok) return setError("Current password is incorrect.");
    setCurrent("");
    setNext("");
    setConfirm("");
    toast.success(remove ? "Password removed" : has ? "Password changed" : "Password set");
  };

  return (
    <Section title="Password">
      <p className="text-sm text-muted-foreground">{has ? "A password is required to sign in as you." : "No password set."}</p>
      <form
        className="mt-4 grid max-w-md gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {has && (
          <div className="grid gap-1.5">
            <Label htmlFor="current">Current password</Label>
            <Input id="current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="new">{has ? "New password" : "Password"}</Label>
          <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <p className="text-sm text-status-critical">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            {has ? "Change password" : "Set password"}
          </Button>
          {has && (
            <Button type="button" variant="ghost" size="sm" disabled={!current} onClick={() => void submit(true)}>
              Remove password
            </Button>
          )}
        </div>
      </form>
    </Section>
  );
}

const STEPS = ["Redirecting to Salesforce", "Authorizing HarvestSignal", "Reading objects and fields", "Syncing records"];

function SalesforceTab() {
  const { salesforce, setSalesforce, user } = useAuth();
  const { data } = useStore();
  const [open, setOpen] = useState(false);
  const [env, setEnv] = useState<SalesforceConnection["environment"]>("Production");
  const [domain, setDomain] = useState("thibolisoft.my.salesforce.com");
  const [step, setStep] = useState(-1);

  const counts: [string, number][] = [
    ["Accounts", data.accounts.length],
    ["Contacts", data.contacts.length],
    ["Opportunities", data.opportunities.length],
    ["Campaigns", data.campaigns.length],
    ["Tasks", data.tasks.length],
    ["Events", data.events.length],
  ];

  const connect = async () => {
    for (let i = 0; i < STEPS.length; i++) {
      setStep(i);
      await new Promise((r) => setTimeout(r, 700));
    }
    const now = new Date().toISOString();
    setSalesforce({ connected: true, environment: env, domain: domain.trim(), orgName: "ThiboLiSoft", connectedBy: user?.Name ?? "", connectedAt: now, lastSyncAt: now });
    setStep(-1);
    setOpen(false);
    toast.success("Connected to Salesforce");
  };

  return (
    <div className="space-y-5">
      <Section title="Salesforce">
        {salesforce?.connected ? (
          <div className="space-y-4">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd className="flex items-center gap-2 font-medium">
                  <span className="size-2 rounded-full bg-status-good" aria-hidden /> Connected
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Org</dt>
                <dd>
                  {salesforce.orgName} ({salesforce.environment})
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Instance</dt>
                <dd>{salesforce.domain}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Connected by</dt>
                <dd>
                  {salesforce.connectedBy} · {new Date(salesforce.connectedAt).toLocaleDateString()}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Last sync</dt>
                <dd>{new Date(salesforce.lastSyncAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Access</dt>
                <dd>Read; activities logged as Tasks</dd>
              </div>
            </dl>
            <table className="w-full max-w-md text-sm">
              <tbody className="divide-y">
                {counts.map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-1.5 text-muted-foreground">{k}</td>
                    <td className="py-1.5 text-right tabular">{v.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSalesforce({ ...salesforce, lastSyncAt: new Date().toISOString() });
                  toast.success("Sync complete");
                }}
              >
                Sync now
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSalesforce(null);
                  toast.success("Disconnected");
                }}
              >
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm">
              <span className="size-2 rounded-full bg-slate-400" aria-hidden /> Not connected
            </p>
            <Button size="sm" onClick={() => setOpen(true)}>
              Connect to Salesforce
            </Button>
          </div>
        )}
      </Section>

      <Dialog open={open} onOpenChange={(o) => step < 0 && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect to Salesforce</DialogTitle>
          </DialogHeader>
          {step < 0 ? (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void connect();
              }}
            >
              <div className="grid gap-1.5">
                <Label>Environment</Label>
                <div className="inline-flex w-fit rounded-md border p-0.5 text-sm">
                  {(["Production", "Sandbox"] as const).map((e) => (
                    <button key={e} type="button" onClick={() => setEnv(e)} className={cn("rounded-[5px] px-3 py-1", env === e ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="domain">My Domain</Label>
                <Input id="domain" value={domain} onChange={(e) => setDomain(e.target.value)} required />
              </div>
              <Button type="submit">Continue to Salesforce</Button>
            </form>
          ) : (
            <ol className="space-y-2 text-sm">
              {STEPS.map((s, i) => (
                <li key={s} className={cn("flex items-center gap-2", i > step && "text-muted-foreground")}>
                  <span className={cn("size-2 rounded-full", i < step ? "bg-status-good" : i === step ? "animate-pulse bg-primary" : "bg-slate-300")} aria-hidden />
                  {s}
                </li>
              ))}
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const TABS = ["profile", "security", "salesforce", "users", "legal", "audit"] as const;
type Tab = (typeof TABS)[number];

export function SettingsView() {
  const { isAdmin, mode, role } = useAuth();
  const showAudit = can(role, "admin:settings");
  const router = useRouter();
  const params = useSearchParams();
  const showUsers = isAdmin && mode === "supabase";
  const requested = params.get("tab") as Tab | null;
  const tab: Tab =
    requested && TABS.includes(requested) && (requested !== "users" || showUsers) && (requested !== "audit" || showAudit) ? requested : "profile";
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Tabs value={tab} onValueChange={(v) => (v === "products" ? router.push("/quotes/products") : router.replace(v === "profile" ? "/settings" : `/settings?tab=${v}`, { scroll: false }))}>
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="salesforce">Salesforce</TabsTrigger>
          {showUsers && <TabsTrigger value="users">Users</TabsTrigger>}
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="legal">Legal</TabsTrigger>
          {showAudit && <TabsTrigger value="audit">Audit log</TabsTrigger>}
        </TabsList>
        <TabsContent value="profile" className="mt-4 max-w-3xl">
          <ProfileTab />
        </TabsContent>
        <TabsContent value="security" className="mt-4 max-w-3xl">
          <SecurityTab />
        </TabsContent>
        <TabsContent value="salesforce" className="mt-4 max-w-3xl">
          <SalesforceTab />
        </TabsContent>
        {showUsers && (
          <TabsContent value="users" className="mt-4">
            <UsersAdmin />
          </TabsContent>
        )}
        <TabsContent value="legal" className="mt-4">
          <ClauseLibrary />
        </TabsContent>
        {showAudit && (
          <TabsContent value="audit" className="mt-4">
            <AuditLog />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
