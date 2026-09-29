import type { ClimateSignal } from "@/types/reference";

/** Mock regional growing-season conditions by crop year. */
export const CLIMATE_SIGNALS: ClimateSignal[] = [
  // 2025 crop year
  { regionId: "southern-plains", year: 2025, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Average winter wheat crop; harvest on schedule." },
  { regionId: "northern-plains", year: 2025, condition: "Excellent Yields", harvestShiftDays: 0, yieldIndex: 1.08, note: "Record spring wheat yields filled every bin by September." },
  { regionId: "western-corn-belt", year: 2025, condition: "Excellent Yields", harvestShiftDays: -3, yieldIndex: 1.07, note: "Big corn crop; ground piles went up across Iowa and Nebraska." },
  { regionId: "eastern-corn-belt", year: 2025, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.01, note: "Trend-line yields and a smooth harvest." },
  { regionId: "great-lakes", year: 2025, condition: "Wet Delays", harvestShiftDays: 10, yieldIndex: 0.97, note: "A wet October pushed corn harvest into December." },
  { regionId: "delta", year: 2025, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Normal soybean and rice harvest." },
  { regionId: "southeast", year: 2025, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Normal season." },
  { regionId: "mid-atlantic", year: 2025, condition: "Drought Stress", harvestShiftDays: -5, yieldIndex: 0.9, note: "Dry August trimmed corn yields on Delmarva." },
  { regionId: "pacific-northwest", year: 2025, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Normal soft white wheat harvest." },
  { regionId: "western-prairies", year: 2025, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.01, note: "Average canola and wheat crop." },
  { regionId: "manitoba", year: 2025, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Normal season." },
  { regionId: "central-canada", year: 2025, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.02, note: "Good corn and soybean yields." },

  // 2026 crop year (the "current" season for the demo)
  { regionId: "southern-plains", year: 2026, condition: "Heat Stress", harvestShiftDays: -6, yieldIndex: 0.92, note: "May heat pushed winter wheat to maturity early; harvest started about a week ahead of normal." },
  { regionId: "northern-plains", year: 2026, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.02, note: "Spring wheat harvest wrapped up on schedule; row crops look strong." },
  { regionId: "western-corn-belt", year: 2026, condition: "Early & Dry", harvestShiftDays: -7, yieldIndex: 1.03, note: "Warm, dry August pushed corn to black layer early; harvest is running about a week ahead of average." },
  { regionId: "eastern-corn-belt", year: 2026, condition: "Wet Delays", harvestShiftDays: 9, yieldIndex: 1.04, note: "A wet September has combines parked; expect a compressed, high-moisture harvest and heavy drying charges." },
  { regionId: "great-lakes", year: 2026, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Normal season so far." },
  { regionId: "delta", year: 2026, condition: "Excellent Yields", harvestShiftDays: -4, yieldIndex: 1.08, note: "Excellent soybean yields and an early start to harvest." },
  { regionId: "southeast", year: 2026, condition: "Drought Stress", harvestShiftDays: -5, yieldIndex: 0.88, note: "Dry summer cut local corn supplies; feed mills are importing more corn by rail." },
  { regionId: "mid-atlantic", year: 2026, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.01, note: "Normal season." },
  { regionId: "pacific-northwest", year: 2026, condition: "Excellent Yields", harvestShiftDays: 0, yieldIndex: 1.06, note: "Strong soft white wheat yields; export elevators are full." },
  { regionId: "western-prairies", year: 2026, condition: "Drought Stress", harvestShiftDays: -5, yieldIndex: 0.86, note: "Dry conditions in southwest Saskatchewan and southern Alberta cut canola yields about 15%." },
  { regionId: "manitoba", year: 2026, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.02, note: "Good canola and wheat yields; soybeans are next." },
  { regionId: "central-canada", year: 2026, condition: "Wet Delays", harvestShiftDays: 8, yieldIndex: 1.02, note: "Rain is delaying soybean harvest in southwestern Ontario." },

  // 2027 crop year (outlook)
  { regionId: "southern-plains", year: 2027, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Good fall moisture for the 2027 wheat crop." },
  { regionId: "northern-plains", year: 2027, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Outlook: normal." },
  { regionId: "western-corn-belt", year: 2027, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Outlook: normal." },
  { regionId: "eastern-corn-belt", year: 2027, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Outlook: normal." },
  { regionId: "great-lakes", year: 2027, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Outlook: normal." },
  { regionId: "delta", year: 2027, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Outlook: normal." },
  { regionId: "southeast", year: 2027, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Outlook: normal." },
  { regionId: "mid-atlantic", year: 2027, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Outlook: normal." },
  { regionId: "pacific-northwest", year: 2027, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Outlook: normal." },
  { regionId: "western-prairies", year: 2027, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Outlook: normal, subsoil moisture still short in the southwest." },
  { regionId: "manitoba", year: 2027, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Outlook: normal." },
  { regionId: "central-canada", year: 2027, condition: "Normal", harvestShiftDays: 0, yieldIndex: 1.0, note: "Outlook: normal." },
];
