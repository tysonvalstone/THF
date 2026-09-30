import { Logo } from "@/components/brand/logo";

/** Centred card with the brand above it, for sign-in and password pages */
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex justify-center">
          <Logo size="lg" />
        </div>
        <div className="mt-8 rounded-md border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>}
        <p className="mt-10 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} ThiboLiSoft · HarvestSignal</p>
      </div>
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="rounded-md border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical" role="alert">
      {message}
    </p>
  );
}
