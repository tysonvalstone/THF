import type { Metadata } from "next";
import { SeasonCalendar } from "@/components/calendar/season-calendar";
import { LaunchSchedule } from "@/components/calendar/launch-schedule";

export const metadata: Metadata = { title: "Season calendar" };

export default function CalendarPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Season calendar</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          When each region plants and harvests, adjusted for this year&apos;s weather, and when to launch campaigns so they land 4–6 weeks
          before the scale house gets busy.
        </p>
      </div>
      <SeasonCalendar />
      <LaunchSchedule />
    </div>
  );
}
