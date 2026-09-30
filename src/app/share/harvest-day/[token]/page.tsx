import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadAppData } from "@/lib/data/server";
import { readShareToken } from "@/lib/harvest/share-token";
import { facilityFromAccount, nearestCompetitor, resolveSettings } from "@/lib/harvest/summary";
import { SharedHarvestDay } from "@/components/harvest/shared-harvest-day";
import type { Account } from "@/types/salesforce";

async function load(token: string) {
  const payload = await readShareToken(token);
  if (!payload) return null;
  const { snapshot } = await loadAppData();
  const account = snapshot.accounts.find((a) => a.Id === payload.a);
  if (!account || !facilityFromAccount(account)) return null;
  const c = nearestCompetitor(account, snapshot.accounts);
  // Only this facility and its competitor's name and location leave the server
  const competitorAccount = c
    ? ({
        Id: c.account.Id,
        Name: c.account.Name,
        BillingCity: c.account.BillingCity,
        BillingState: c.account.BillingState,
        BillingLatitude: c.account.BillingLatitude,
        BillingLongitude: c.account.BillingLongitude,
      } as Account)
    : null;
  const facility: Account = { ...account, Description: "", Phone: "", Website: "", OwnerId: "", AnnualRevenue: 0, NumberOfEmployees: 0, Current_Software__c: "", Software_Contract_End__c: undefined };
  return { account: facility, competitor: c && competitorAccount ? { ...c, account: competitorAccount } : null, settings: resolveSettings(payload.s) };
}

export async function generateMetadata({ params }: PageProps<"/share/harvest-day/[token]">): Promise<Metadata> {
  const { token } = await params;
  const d = await load(token);
  return { title: d ? `Harvest day at ${d.account.Name}` : "Harvest Day", robots: { index: false, follow: false } };
}

export default async function SharedHarvestDayPage({ params }: PageProps<"/share/harvest-day/[token]">) {
  const { token } = await params;
  const d = await load(token);
  if (!d) notFound();
  return <SharedHarvestDay account={d.account} competitor={d.competitor} settings={d.settings} />;
}
