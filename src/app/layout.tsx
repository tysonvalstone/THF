import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { StoreProvider } from "@/lib/data/store";
import { AuthProvider } from "@/lib/auth";
import { getSessionUser } from "@/lib/supabase/session";
import { supabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/layout/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { DemoProvider } from "@/components/demo/demo-provider";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Absolute URLs for the social preview image; Vercel sets the production host
  metadataBase: new URL(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000"),
  applicationName: "HarvestSignal",
  title: {
    default: "HarvestSignal",
    template: "%s · HarvestSignal",
  },
  description: "Sales intelligence for grain, feed and processing markets.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getSessionUser();
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background">
        <AuthProvider initialUser={user} mode={supabaseConfigured() && !user?.guest ? "supabase" : "demo"}>
          <StoreProvider>
            <TooltipProvider delayDuration={150}>
              <DemoProvider>
                <AppShell>{children}</AppShell>
              </DemoProvider>
              <Toaster position="bottom-right" offset={{ bottom: 84, right: 20 }} richColors closeButton />
            </TooltipProvider>
          </StoreProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
