/**
 * Field catalog for export templates, one list per data source.
 * Shared by the Template Builder (row building, form options) and the AI
 * route (so generated specs only use known fields). Pure data, no imports
 * beyond types, so it is safe on client and server.
 */
import type { ExportSource, FieldType } from "@/lib/ai/types";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** Salesforce API name, used as the header in Salesforce import files */
  sfName?: string;
}

export const SOURCE_LABELS: Record<ExportSource, string> = {
  opportunities: "Opportunities",
  accounts: "Accounts",
  contacts: "Contacts",
  segments: "Segments",
};

export const EXPORT_FIELDS: Record<ExportSource, FieldDef[]> = {
  opportunities: [
    { key: "id", label: "Opportunity Id", type: "string", sfName: "Id" },
    { key: "name", label: "Opportunity", type: "string", sfName: "Name" },
    { key: "account_id", label: "Account Id", type: "string", sfName: "AccountId" },
    { key: "account", label: "Account", type: "string" },
    { key: "segment", label: "Segment", type: "string" },
    { key: "state", label: "State", type: "string" },
    { key: "region", label: "Region", type: "string" },
    { key: "stage", label: "Stage", type: "string", sfName: "StageName" },
    { key: "type", label: "Type", type: "string", sfName: "Type" },
    { key: "amount", label: "Amount", type: "currency", sfName: "Amount" },
    { key: "probability", label: "Probability", type: "percent", sfName: "Probability" },
    { key: "expected_value", label: "Expected value", type: "currency" },
    { key: "win_rate", label: "Segment win rate", type: "percent" },
    { key: "close_date", label: "Close date", type: "date", sfName: "CloseDate" },
    { key: "created_date", label: "Created", type: "date" },
    { key: "days_open", label: "Days open", type: "number" },
    { key: "lead_source", label: "Lead source", type: "string", sfName: "LeadSource" },
    { key: "next_step", label: "Next step", type: "string", sfName: "NextStep" },
    { key: "owner_id", label: "Owner Id", type: "string", sfName: "OwnerId" },
    { key: "owner", label: "Owner", type: "string" },
    { key: "economic_buyer", label: "Economic buyer identified", type: "boolean", sfName: "Economic_Buyer_Identified__c" },
    { key: "is_open", label: "Open", type: "boolean" },
    { key: "is_won", label: "Won", type: "boolean", sfName: "IsWon" },
  ],
  accounts: [
    { key: "id", label: "Account Id", type: "string", sfName: "Id" },
    { key: "name", label: "Account", type: "string", sfName: "Name" },
    { key: "account_type", label: "Type", type: "string", sfName: "Type" },
    { key: "is_customer", label: "Customer", type: "boolean" },
    { key: "segment", label: "Segment", type: "string", sfName: "Segment__c" },
    { key: "facility_type", label: "Facility type", type: "string", sfName: "Facility_Type__c" },
    { key: "parent", label: "Parent co-op", type: "string" },
    { key: "city", label: "City", type: "string", sfName: "BillingCity" },
    { key: "county", label: "County", type: "string", sfName: "County__c" },
    { key: "state", label: "State", type: "string", sfName: "BillingState" },
    { key: "region", label: "Region", type: "string" },
    { key: "commodities", label: "Commodities", type: "string" },
    { key: "locations", label: "Locations", type: "number", sfName: "Number_of_Locations__c" },
    { key: "revenue", label: "Annual revenue", type: "currency", sfName: "AnnualRevenue" },
    { key: "employees", label: "Employees", type: "number", sfName: "NumberOfEmployees" },
    { key: "storage_bu", label: "Storage (bu)", type: "number", sfName: "Storage_Capacity_Bu__c" },
    { key: "current_software", label: "Current software", type: "string", sfName: "Current_Software__c" },
    { key: "contract_end", label: "Contract end", type: "date", sfName: "Software_Contract_End__c" },
    { key: "fiscal_year_end", label: "Fiscal year end", type: "string", sfName: "Fiscal_Year_End__c" },
    { key: "blackout", label: "Blackout", type: "string" },
    { key: "blackout_until", label: "Blackout ends", type: "date" },
    { key: "open_deals", label: "Open deals", type: "number" },
    { key: "open_pipeline", label: "Open pipeline", type: "currency" },
    { key: "score", label: "Prospect score", type: "number" },
    { key: "owner", label: "Owner", type: "string" },
  ],
  contacts: [
    { key: "id", label: "Contact Id", type: "string", sfName: "Id" },
    { key: "name", label: "Contact", type: "string", sfName: "Name" },
    { key: "first_name", label: "First name", type: "string", sfName: "FirstName" },
    { key: "last_name", label: "Last name", type: "string", sfName: "LastName" },
    { key: "title", label: "Title", type: "string", sfName: "Title" },
    { key: "buying_role", label: "Buying role", type: "string", sfName: "Buying_Role__c" },
    { key: "email", label: "Email", type: "string", sfName: "Email" },
    { key: "phone", label: "Phone", type: "string", sfName: "Phone" },
    { key: "opted_out", label: "Email opt-out", type: "boolean", sfName: "HasOptedOutOfEmail" },
    { key: "account_id", label: "Account Id", type: "string", sfName: "AccountId" },
    { key: "account", label: "Account", type: "string" },
    { key: "segment", label: "Segment", type: "string" },
    { key: "state", label: "State", type: "string" },
    { key: "region", label: "Region", type: "string" },
    { key: "is_customer", label: "Customer", type: "boolean" },
  ],
  segments: [
    { key: "segment", label: "Segment", type: "string" },
    { key: "rank", label: "Priority rank", type: "number" },
    { key: "priority_score", label: "Priority score", type: "number" },
    { key: "accounts", label: "Accounts", type: "number" },
    { key: "customers", label: "Customers", type: "number" },
    { key: "open_deals", label: "Open deals", type: "number" },
    { key: "open_pipeline", label: "Open pipeline", type: "currency" },
    { key: "won", label: "Won", type: "number" },
    { key: "lost", label: "Lost", type: "number" },
    { key: "win_rate", label: "Win rate", type: "percent" },
    { key: "win_rate_low", label: "Win rate low (95%)", type: "percent" },
    { key: "win_rate_high", label: "Win rate high (95%)", type: "percent" },
    { key: "confidence", label: "Confidence", type: "string" },
    { key: "median_days", label: "Median days to close", type: "number" },
    { key: "median_won_amount", label: "Median won deal", type: "currency" },
  ],
};

export function fieldDef(source: ExportSource, key: string): FieldDef | undefined {
  return EXPORT_FIELDS[source].find((f) => f.key === key);
}

/** Compact catalog text for AI prompts */
export function fieldCatalogText(): string {
  return (Object.keys(EXPORT_FIELDS) as ExportSource[])
    .map((s) => `${s}: ${EXPORT_FIELDS[s].map((f) => `${f.key} (${f.type})`).join(", ")}`)
    .join("\n");
}
