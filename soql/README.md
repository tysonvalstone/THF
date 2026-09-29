# SOQL queries used by HarvestSignal Live mode

SOQL has no comment syntax, so each `.soql` file here is a pure query and the
explanations live in this README. The queries are exactly what
`src/lib/data/salesforce.ts` sends **when every custom field exists** in the
org. When a field is missing, the app drops it from the SELECT (it checks with
`describe()` first), fills in a default, and shows a warning.

All queries are read-only SELECTs. Nothing in HarvestSignal writes to Salesforce.

## Running by hand

- **Developer Console:** Query Editor tab, paste the file contents, Execute.
- **Salesforce CLI:**
  ```sh
  sf data query --target-org my-org --file soql/opportunities.soql
  # or
  sf data query --target-org my-org --query "$(cat soql/opportunities.soql)"
  ```
  Add `--result-format csv` to export.

If a query fails with `No such column 'X__c'`, that custom field doesn't exist
in your org. Delete it from the query to run it by hand. The app does the same
thing automatically. See `docs/salesforce-setup.md` for the field list.

## Files

| File | Object | What it's for |
|---|---|---|
| `opportunities.soql` | Opportunity | The core prioritization query: every open deal plus deals created in the last 3 years, with the account's `Segment__c`. Drives win rates, cycle times and pipeline by segment. |
| `segment-history.soql` | Opportunity (aggregate) | Quick check of closed deals by `Account.Segment__c` and `IsWon` (count and total amount) over the last 3 years. Handy for checking the app's segment win rates. The app doesn't run this one; it computes the same numbers from `opportunities.soql`. |
| `accounts.soql` | Account | All accounts with billing address, geolocation, parent account and the HarvestSignal custom fields (segment, facility type, commodities, rail/river access, fiscal year end, board meeting months and more). |
| `contacts.soql` | Contact | Contacts linked to an account, with title, email, phone, mailing address and `Buying_Role__c`. |
| `campaigns.soql` | Campaign | All campaigns, plus the optional targeting fields (`Season__c`, `Target_Regions__c`, `Target_Facility_Types__c`, `Target_Commodity__c`, `Content__c`). |
| `campaign-members.soql` | CampaignMember | Members created in the last 3 years. `Contact.AccountId` links each response back to an account. |
| `tasks.soql` | Task | Activities in the last 12 months, anything scheduled in the future, and undated tasks created in the last 12 months. |
| `events.soql` | Event | Meetings in the last 12 months plus any scheduled in the future. |

The app loads at most 20,000 rows per object and shows a warning when it hits
that limit.
