# Connecting HarvestSignal to Salesforce (Live mode)

This guide is for the Salesforce admin. Without it, HarvestSignal runs on mock data. After these steps it reads your org's Accounts, Contacts, Opportunities, Campaigns, Campaign Members, Tasks and Events.

**HarvestSignal is read-only.** It only logs in, reads object metadata (describe) and runs SOQL `SELECT` queries. It never creates, edits or deletes records. The steps below also give the integration user read-only permissions, so this is enforced on the Salesforce side as well. The exact queries are in [`/soql`](../soql/README.md).

---

## 1. Create a Connected App (or External Client App)

Which one you create depends on your org's release:

- **Classic Connected App:** Setup → **App Manager** → **New Connected App**. (In some newer orgs this button is under *Setup → External Client Apps → Settings*, where you must first turn on "Allow creation of connected apps".)
- **External Client App** (the newer replacement): Setup → **External Client App Manager** → **New External Client App**. The OAuth settings are the same.

Then:

1. Name: `HarvestSignal`. Contact email: yours.
2. Tick **Enable OAuth Settings**.
3. **Callback URL:** `https://login.salesforce.com/services/oauth2/success`. This flow doesn't use it, but Salesforce requires a value.
4. **Selected OAuth Scopes:** add
   - *Access and manage your data (api)*
   - *Perform requests at any time (refresh_token, offline_access)*
5. Leave "Require Proof Key for Code Exchange (PKCE)" off. It doesn't apply to this flow.
6. Save. New apps can take up to 10 minutes to become active.
7. Open the app, click **Manage Consumer Details**, and copy the **Consumer Key** (this becomes `SF_CLIENT_ID`) and the **Consumer Secret** (this becomes `SF_CLIENT_SECRET`).
8. Under **Manage → Edit Policies**, set *Permitted Users* to "Admin approved users are pre-authorized" and add the integration user's profile or permission set from step 2. Alternatively, keep "All users may self-authorize".
9. **Allow the username-password flow.** Go to Setup → **OAuth and OpenID Connect Settings** and turn on **Allow OAuth Username-Password Flows**. Newer orgs block this flow by default, and without it logins fail with `invalid_grant`.

> Salesforce recommends the **OAuth 2.0 JWT Bearer flow** (certificate-based, no password) for production integrations. HarvestSignal uses the username-password flow to keep setup simple. Moving to JWT bearer is planned future work.

## 2. Create a read-only integration user

1. Setup → **Users** → **New User**.
   - If your org has **Salesforce Integration** user licenses (most orgs get a few for free), use that license with the **Minimum Access - API Only Integrations** profile. This user can't log into the UI and doesn't count against your paid seats.
   - Otherwise, use a standard Salesforce license and clone a *Read Only* profile.
2. Create a **permission set** called `HarvestSignal Read Only` and assign it to the user:
   - **System Permissions:** *API Enabled*.
   - **Object Settings:** **Read** (and nothing else: no Create, Edit, Delete, View All Modify All) on Account, Contact, Opportunity, Campaign, Campaign Member, Task and Event. *View All* is optional. Without it, the user only sees records that sharing rules give it. With it, HarvestSignal sees the whole org, which is usually what you want for segment win rates.
   - **Field-Level Security:** *Read Access* on every custom field listed in step 4. If the user can't read a field, HarvestSignal treats it as missing.
   - If you use the Salesforce Integration license, also assign the **Salesforce API Integration** permission set license.
3. Assign the Connected App to this permission set (step 1.8) if you chose admin pre-authorization.

## 3. Security token and IP restrictions

- If the integration user's profile has **no** login IP ranges and the Connected App has IP Relaxation set to "Relax IP restrictions", the password is enough.
- Otherwise, reset the user's security token (log in as the user → *Settings → Reset My Security Token*, or have an admin reset it) and **append it to the password**: `SF_PASSWORD = <password><token>` with no space between them.
- Vercel's outbound IP addresses change, so the easiest option is **Connected App → Manage → Edit Policies → IP Relaxation: Relax IP restrictions**, combined with a strong password and the read-only permission set above.

## 4. Custom fields HarvestSignal looks for

Every custom field is **optional**. HarvestSignal checks which fields exist when it loads and only asks for those. If a field is missing, it fills in a sensible default and lists a warning in the app. The more of these fields you have, the better the prioritization.

| Object | Field API name | Type | Example | If missing |
|---|---|---|---|---|
| Account | `Segment__c` | Picklist with these 8 values: `Country Elevator`, `Multi-Location Co-op`, `River Terminal`, `Rail/Shuttle Loader`, `Ethanol Plant`, `Feed Mill`, `Processor`, `Seed Cleaner / Specialty Crop` | `River Terminal` | Guessed from the account name, Industry and Type. For example, "Co-op" becomes Multi-Location Co-op, "Ethanol" becomes Ethanol Plant, and anything unrecognized becomes Country Elevator. **This is the most important field.** |
| Account | `Facility_Type__c` | Picklist: Grain Elevator, Cooperative, Ethanol Plant, Feed Mill, Oilseed Crusher, Flour Mill, Seed Processor, Agronomy Retailer | `Grain Elevator` | Derived from the segment |
| Account | `Region__c` | Text or picklist containing a HarvestSignal region id (e.g. `western-corn-belt`) | `northern-plains` | Derived from Billing State/Province |
| Account | `Primary_Commodities__c` | Multi-select picklist: Corn, Soybeans, Winter Wheat, Spring Wheat, Canola, Sorghum, Barley, Pulses, Rice | `Corn;Soybeans` | The region's two main crops |
| Account | `County__c` | Text(80) | `Story` | Blank |
| Account | `County_FIPS__c` | Text(5) | `19169` | Blank |
| Account | `Railroad__c` | Text(80) | `BNSF` | Blank |
| Account | `Rail_Served__c` | Checkbox | ✓ | True if Railroad__c or Shuttle_Loader__c is set |
| Account | `River_Access__c` | Checkbox | ✓ | True for the River Terminal segment |
| Account | `Shuttle_Loader__c` | Checkbox | ✓ | True for the Rail/Shuttle Loader segment |
| Account | `Fiscal_Year_End__c` | Text `MM-DD`, a date, or a month picklist | `08-31` | `12-31` |
| Account | `Board_Meeting_Months__c` | Multi-select picklist of months (`1`–`12` or `January`–`December`) | `3;6;9;12` | No board months (no board-timing signal) |
| Account | `Number_of_Locations__c` | Number | `14` | 1 |
| Account | `Storage_Capacity_Bu__c` | Number | `4500000` | Blank |
| Account | `Current_Software__c` | Text or picklist | `Agris` | `Unknown` |
| Account | `Software_Contract_End__c` | Date | `2027-06-30` | Blank |
| Account | `ParentId` | *Standard* Parent Account lookup | (the co-op HQ account) | No parent. Use this to link co-op locations to their headquarters. |
| Contact | `Buying_Role__c` | Picklist: Decision Maker, Economic Buyer, Champion, Influencer, End User, Board Member | `Economic Buyer` | Guessed from Title |
| Opportunity | `Economic_Buyer_Identified__c` | Checkbox | ✓ | Assumed true for any deal past Prospecting |
| Opportunity | **Stage** value `Board Approval` | Add to the Opportunity *Stage* picklist (open, around 85%) between Negotiation and Closed Won. Co-op deals often wait on a board vote. | — | Stages that don't match HarvestSignal's (Prospecting, Qualification, Needs Analysis, Proposal, Negotiation, Board Approval, Closed Won, Closed Lost) are mapped by keyword or probability, and a warning lists them |
| Campaign | `Season__c`, `Target_Regions__c`, `Target_Facility_Types__c`, `Target_Commodity__c` | Text / multi-select picklists | `Post-harvest` | Blank |

## 5. Add the credentials to Vercel

From the project folder (with the Vercel CLI linked to the project), add each variable. The CLI will prompt for the value:

```sh
vercel env add SF_LOGIN_URL production
vercel env add SF_CLIENT_ID production
vercel env add SF_CLIENT_SECRET production
vercel env add SF_USERNAME production
vercel env add SF_PASSWORD production
```

| Variable | Value |
|---|---|
| `SF_LOGIN_URL` | `https://login.salesforce.com` for production, `https://test.salesforce.com` for sandboxes, or your My Domain URL (e.g. `https://acme.my.salesforce.com`) |
| `SF_CLIENT_ID` | Consumer Key from step 1 |
| `SF_CLIENT_SECRET` | Consumer Secret from step 1 |
| `SF_USERNAME` | The integration user's username |
| `SF_PASSWORD` | The integration user's password, with the security token appended if needed (step 3) |

You can also add these in the Vercel dashboard (Project → Settings → Environment Variables). Then **redeploy** (`vercel --prod`, or Deployments → Redeploy) so the new variables take effect.

**How to check it's working**

1. Open the app. The header badge should change from **Mock data** to **Live Salesforce**.
2. Any warnings (for example, a missing `Account.Segment__c`) appear next to the badge.
3. Live data is cached for **1 hour**. Click **Refresh data** to query Salesforce again right away.
4. Opportunity links open the record in Lightning (`https://<your-domain>.lightning.force.com/lightning/r/Opportunity/<Id>/view`).

## 6. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `INVALID_LOGIN` / "authentication failure" | Wrong username or password, or a missing security token. Append the token to `SF_PASSWORD` (step 3). Check that `SF_LOGIN_URL` points at the right environment (sandbox usernames end in `.sandboxname` and need `https://test.salesforce.com`). |
| `invalid_grant` | The username-password flow is blocked. Turn on *Allow OAuth Username-Password Flows* (step 1.9). This error also appears when the user isn't allowed to use the Connected App (step 1.8), when the login is outside the allowed IP range (step 3), or when the user is locked or frozen. |
| `invalid_client_id` / `invalid_client` | The Consumer Key or Secret is wrong, or the Connected App was created less than 10 minutes ago. |
| `API_DISABLED_FOR_ORG` / "API is disabled for this User" | Give the permission set *API Enabled* (step 2). Professional Edition orgs need the API add-on. |
| "Could not describe Opportunity" / `INSUFFICIENT_ACCESS` | The integration user is missing Read access on that object. Account and Opportunity are required. For the other objects the app just shows a warning and skips them. |
| Warning: "Account.Segment__c not found in this org; using defaults." | Either the field doesn't exist, or the integration user has no field-level Read access to it. Create the field (step 4) or grant field-level security. |
| Warning: "row cap of 20,000 reached" | Your org has more records than HarvestSignal loads per object. Narrow the integration user's record visibility, or ask the developers to raise the cap. |
| Badge still says **Mock data** | One of the five variables is missing or empty in that Vercel environment, or you haven't redeployed since adding them. |
