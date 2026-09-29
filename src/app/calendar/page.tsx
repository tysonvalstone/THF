import type { Metadata } from "next";
import { CampaignCalendar } from "@/components/calendar/campaign-calendar";
import { SeasonCalendar } from "@/components/calendar/season-calendar";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Campaign calendar</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Four selling windows for grain buyers, with the campaign to run in each. Harvest is for supporting customers, not selling to them.
        </p>
      </div>
      <CampaignCalendar />
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Crop calendar by region (reference)</h2>
          <p className="text-sm text-muted-foreground">Planting, harvest and settlement periods, adjusted for this year&apos;s weather.</p>
        </div>
        <SeasonCalendar />
      </section>
    </div>
  );
}
