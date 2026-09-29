import type { Commodity, FacilityType, LivestockFocus, RegionId } from "./salesforce";

/** Month-day, e.g. "09-20" */
export type MonthDay = string;

export interface CropWindow {
  commodity: Commodity;
  plantStart: MonthDay;
  plantEnd: MonthDay;
  harvestStart: MonthDay;
  harvestEnd: MonthDay;
  /** 0–1: how important this crop is to the region's handle */
  importance: number;
}

export interface Region {
  id: RegionId;
  name: string;
  shortName: string;
  country: "US" | "CA";
  /** State / province postal codes */
  states: string[];
  summary: string;
  crops: CropWindow[];
  livestock: LivestockFocus[];
  /** Typical cash basis vs. futures, $/bu (negative = under) */
  typicalBasis: Partial<Record<Commodity, number>>;
  /** Plain-English local color used in reasons and copy */
  localColor: string;
}

export type ClimateCondition =
  | "Normal"
  | "Early & Dry"
  | "Drought Stress"
  | "Wet Delays"
  | "Heat Stress"
  | "Excellent Yields";

export interface ClimateSignal {
  regionId: RegionId;
  /** Crop year the signal applies to */
  year: number;
  condition: ClimateCondition;
  /** Shift applied to harvest start/end, in days (negative = earlier) */
  harvestShiftDays: number;
  /** 1.0 = trend yield */
  yieldIndex: number;
  note: string;
}

export type PriceSeriesKey = Commodity | "DDGS" | "Ethanol" | "Soybean Meal";

export interface PricePoint {
  /** YYYY-MM */
  month: string;
  price: number;
}

export interface PriceSeries {
  key: PriceSeriesKey;
  label: string;
  unit: string;
  currency: "USD" | "CAD";
  points: PricePoint[];
}

export interface Town {
  name: string;
  state: string;
  lat: number;
  lon: number;
}

export type SoftwareKind = "manual" | "legacy" | "competitor" | "ours";

export interface SoftwareVendor {
  name: string;
  kind: SoftwareKind;
  /** 0 (ancient) – 1 (modern cloud) */
  modernity: number;
  fits: FacilityType[];
  note: string;
}
