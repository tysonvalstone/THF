/** Citation for crop planting/harvest timing */
export const SEASON_SOURCE = {
  label: "USDA NASS, Field Crops Usual Planting and Harvesting Dates",
  url: "https://www.nass.usda.gov/Publications/Todays_Reports/reports/fcdate10.pdf",
};

export function SourceNote({ className }: { className?: string }) {
  return (
    <p className={className ?? "text-xs text-muted-foreground"}>
      Source:{" "}
      <a href={SEASON_SOURCE.url} target="_blank" rel="noreferrer" className="underline decoration-slate-300 underline-offset-2 hover:text-foreground">
        {SEASON_SOURCE.label}
      </a>
    </p>
  );
}
