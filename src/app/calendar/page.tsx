import type { Metadata } from "next";
import { CampaignCalendar } from "@/components/calendar/campaign-calendar";
import { SeasonCalendar } from "@/components/calendar/season-calendar";
import { SourceNote } from "@/components/shared/source-note";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Calendar</h1>
      <CampaignCalendar />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Crop Calendar</h2>
        <SeasonCalendar />
        <SourceNote />
      </section>
    </div>
  );
}
