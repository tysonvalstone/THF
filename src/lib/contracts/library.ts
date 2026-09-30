/**
 * The standard clause library (Settings → Legal). The seed copies these into
 * the store's `clauses`; contracts copy the library text into their own
 * ContractClause records, so later library edits never change signed paper.
 */
import type { ClauseCategory } from "@/types/salesforce";

export interface ClauseTemplate {
  /** Stable key, used for seed Ids and lookups */
  key: string;
  Name: string;
  Category: ClauseCategory;
  IsDefault: boolean;
  IsActive: boolean;
  Body: string;
}

export const CLAUSE_CATEGORIES: ClauseCategory[] = ["Liability", "Data privacy", "SLA", "Auto-renew", "Price increase", "Termination", "Payment", "General"];

/** Library keys the contract logic relies on */
export const CLAUSE_KEYS = {
  liability: "liability-cap",
  dpa: "data-protection",
  sla: "sla-harvest",
  autoRenew: "auto-renew",
  price: "price-increase",
  termCause: "termination-cause",
  termConvenience: "termination-convenience",
  payment: "payment-terms",
  harvest: "harvest-payment",
  law: "governing-law",
  confidentiality: "confidentiality",
  warranty: "warranty",
  ip: "intellectual-property",
  legacySupport: "legacy-support",
} as const;

export const CLAUSE_TEMPLATES: ClauseTemplate[] = [
  {
    key: CLAUSE_KEYS.liability,
    Name: "Limitation of liability",
    Category: "Liability",
    IsDefault: true,
    IsActive: true,
    Body: "Except for breach of confidentiality, indemnification obligations or amounts owed for the Services, each party's total liability arising out of this Agreement is limited to the fees paid or payable by Customer in the twelve (12) months before the claim. Neither party is liable for lost profits, lost grain margin or indirect, incidental or consequential damages.",
  },
  {
    key: CLAUSE_KEYS.dpa,
    Name: "Data protection addendum",
    Category: "Data privacy",
    IsDefault: true,
    IsActive: true,
    Body: "ThiboLiSoft processes producer, settlement and scale-ticket data only to provide the Services and under Customer's instructions. Data is encrypted in transit and at rest, hosted in North America, and returned or deleted within sixty (60) days after termination. ThiboLiSoft will notify Customer of a security incident affecting Customer data within seventy-two (72) hours.",
  },
  {
    key: CLAUSE_KEYS.sla,
    Name: "Service levels and harvest support",
    Category: "SLA",
    IsDefault: true,
    IsActive: true,
    Body: "The hosted Services will be available 99.5% of each calendar month, excluding scheduled maintenance announced 48 hours in advance. Scheduled maintenance is not performed during Customer's harvest window. During harvest (September 15 to November 30) phone support is available 6:00 a.m. to 10:00 p.m. local time, seven days a week, with a one-hour response target for scale-house outages. Service credits are Customer's sole remedy for missed availability.",
  },
  {
    key: CLAUSE_KEYS.autoRenew,
    Name: "Automatic renewal",
    Category: "Auto-renew",
    IsDefault: true,
    IsActive: true,
    Body: "At the end of the Subscription Term this Agreement renews automatically for successive twelve (12) month terms unless either party gives written notice of non-renewal at least the number of days stated in the Order Form before the end of the then-current term.",
  },
  {
    key: CLAUSE_KEYS.price,
    Name: "Annual price adjustment",
    Category: "Price increase",
    IsDefault: true,
    IsActive: true,
    Body: "Subscription fees may increase once per year on the anniversary of the Start Date by no more than the percentage stated in the Order Form, and in no event more than five percent (5%). ThiboLiSoft will give written notice of any increase at least ninety (90) days before it takes effect.",
  },
  {
    key: CLAUSE_KEYS.termCause,
    Name: "Termination for cause",
    Category: "Termination",
    IsDefault: true,
    IsActive: true,
    Body: "Either party may terminate this Agreement if the other party materially breaches it and does not cure the breach within thirty (30) days of written notice. On termination for ThiboLiSoft's uncured breach, ThiboLiSoft will refund prepaid fees for the remainder of the term.",
  },
  {
    key: CLAUSE_KEYS.payment,
    Name: "Payment terms",
    Category: "Payment",
    IsDefault: true,
    IsActive: true,
    Body: "Fees are invoiced in advance at the billing frequency stated in the Order Form and are due within the payment terms stated there. Late amounts bear interest at 1% per month or the maximum lawful rate, if less. Fees exclude taxes, which Customer pays except for taxes on ThiboLiSoft's income.",
  },
  {
    key: CLAUSE_KEYS.harvest,
    Name: "Harvest payment terms",
    Category: "Payment",
    IsDefault: false,
    IsActive: true,
    Body: "Because Customer's cash flow follows the grain year, the annual subscription invoice is issued at the Start Date and is due on December 15 following that year's harvest. One-time fees remain due on the standard payment terms.",
  },
  {
    key: CLAUSE_KEYS.termConvenience,
    Name: "Termination for convenience",
    Category: "Termination",
    IsDefault: false,
    IsActive: true,
    Body: "Customer may terminate this Agreement for convenience effective at the next anniversary of the Start Date by giving at least ninety (90) days' written notice. Fees paid for the current year are non-refundable.",
  },
  {
    key: CLAUSE_KEYS.law,
    Name: "Governing law",
    Category: "General",
    IsDefault: false,
    IsActive: true,
    Body: "This Agreement is governed by the laws of the State of Iowa (or, for Customers located in Canada, the Province of Manitoba), without regard to conflict-of-law rules. The courts located there have exclusive jurisdiction.",
  },
  {
    key: CLAUSE_KEYS.confidentiality,
    Name: "Confidentiality",
    Category: "General",
    IsDefault: false,
    IsActive: true,
    Body: "Each party will protect the other's Confidential Information, including pricing, producer lists and grain positions, with at least reasonable care, use it only to perform this Agreement, and not disclose it except to employees and advisors who need to know it. These obligations survive for three (3) years after termination.",
  },
  {
    key: CLAUSE_KEYS.warranty,
    Name: "Warranty",
    Category: "General",
    IsDefault: false,
    IsActive: true,
    Body: "ThiboLiSoft warrants that the Services will perform materially as described in the documentation. Customer's remedy for breach of this warranty is correction of the non-conformity or, if not corrected within thirty (30) days, termination and a refund of prepaid fees for the affected Services. All other warranties are disclaimed.",
  },
  {
    key: CLAUSE_KEYS.ip,
    Name: "Intellectual property",
    Category: "General",
    IsDefault: false,
    IsActive: true,
    Body: "ThiboLiSoft owns the Services, software and documentation and grants Customer a non-exclusive, non-transferable right to use them during the term. Customer owns its data. Feedback may be used by ThiboLiSoft without obligation.",
  },
  {
    key: CLAUSE_KEYS.legacySupport,
    Name: "Support hours (2023)",
    Category: "SLA",
    IsDefault: false,
    IsActive: false,
    Body: "Phone support is available 7:00 a.m. to 6:00 p.m. Central time, Monday through Friday, excluding holidays.",
  },
];

/** Deterministic seed Id for a library clause ("a0LHs0000000001AAC") */
export function clauseSeedId(key: string): string {
  const i = CLAUSE_TEMPLATES.findIndex((c) => c.key === key);
  return `a0LHs${String(i + 1).padStart(10, "0")}AAC`;
}
