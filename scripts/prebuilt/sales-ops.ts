/**
 * Quotas and commission plans for the six territory reps.
 *
 * Quotas: one per rep per quarter, 2025-Q1 … 2027-Q4. Each is sized from the
 * rep's own closed-won run rate for that year (2027: 2026 run rate + 10%),
 * spread by the company's seasonal quarter mix, divided by a target
 * attainment between 70% and 120%, so attainment looks realistic.
 * Plans: one per rep per year, base 8–10%, accelerator 1.5× base above the
 * annual quota, +2% for multi-year (24+ month) deals.
 * Deterministic: every random choice comes from hash01.
 */
import type { SeedContext } from "./platform";
import type { DataSnapshot } from "../../src/lib/data/types";
import type { CommissionPlan, Quota } from "../../src/types/salesforce";
import { hash01 } from "./quoting";

const YEARS = [2025, 2026, 2027];
/** Territory reps (the first four users are app personas and own no deals) */
const QUOTA_REPS = (ctx: SeedContext) => ctx.users.slice(4).map((u) => u.Id);

const quarterOf = (iso: string) => Math.floor((+iso.slice(5, 7) - 1) / 3);
const round = (n: number, step: number) => Math.round(n / step) * step;

export function buildSales(ctx: SeedContext): Pick<DataSnapshot, "quotas" | "commissionPlans"> {
  const reps = QUOTA_REPS(ctx);
  const won = ctx.opportunities.filter((o) => o.IsWon);

  // Company seasonal mix: share of closed-won dollars per quarter of the year
  const qMix = [0, 0, 0, 0];
  for (const o of won) qMix[quarterOf(o.CloseDate)] += o.Amount;
  const mixTotal = qMix.reduce((a, b) => a + b, 0) || 1;
  const mix = qMix.map((v) => 0.5 * (v / mixTotal) + 0.5 * 0.25); // soften toward flat

  // Each rep's closed-won by year
  const byRepYear = new Map<string, number>();
  for (const o of won) {
    const k = `${o.OwnerId}:${o.CloseDate.slice(0, 4)}`;
    byRepYear.set(k, (byRepYear.get(k) ?? 0) + o.Amount);
  }
  const repAnnual = (rep: string, year: number) => {
    // 2025 from its actuals, 2026 annualized from Jan–Sep, 2027 = 2026 run rate + 10% growth
    const y2025 = byRepYear.get(`${rep}:2025`) ?? 0;
    const run2026 = ((byRepYear.get(`${rep}:2026`) ?? 0) * 12) / 9;
    const base = year === 2025 ? y2025 : year === 2026 ? run2026 : run2026 * 1.1;
    return Math.max(300_000, base);
  };

  const quotas: Quota[] = [];
  const commissionPlans: CommissionPlan[] = [];
  let qn = 1;
  let pn = 1;
  for (const rep of reps) {
    for (const year of YEARS) {
      const annualActual = repAnnual(rep, year);
      // Target attainment 70–120% for the year: quota = actual ÷ attainment
      const target = 0.7 + hash01(`quota:${rep}:${year}`) * 0.5;
      let annualQuota = 0;
      for (let q = 0; q < 4; q++) {
        const wobble = 0.9 + hash01(`quota:${rep}:${year}:Q${q + 1}`) * 0.2;
        const amount = Math.max(25_000, round(((annualActual * mix[q]) / target) * wobble, 5_000));
        annualQuota += amount;
        quotas.push({ Id: `a0QHs${String(qn++).padStart(11, "0")}AA`, OwnerId: rep, Period: `${year}-Q${q + 1}`, Amount: amount });
      }
      const base = 8 + round(hash01(`plan:${rep}:${year}`) * 2, 0.5);
      commissionPlans.push({
        Id: `a0CHs${String(pn++).padStart(11, "0")}AA`,
        OwnerId: rep,
        Year: year,
        BaseRatePct: base,
        AcceleratorPct: +(base * 1.5).toFixed(2),
        MultiYearBonusPct: 2,
        AnnualQuota: annualQuota,
      });
    }
  }
  return { quotas, commissionPlans };
}
