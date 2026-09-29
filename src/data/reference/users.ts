import type { User } from "@/types/salesforce";

/** App users (the first four can sign in) and the account owners. */
export const USERS: User[] = [
  { Id: "005Hs00000000001AA", Name: "Jeffrey Li", Title: "Sales", Email: "", Territory__c: "North America", Regions__c: [] },
  { Id: "005Hs00000000008AA", Name: "Jesse Thibodeau", Title: "Sales", Email: "", Territory__c: "North America", Regions__c: [] },
  { Id: "005Hs00000000009AA", Name: "Braydon Viragh", Title: "Sales", Email: "", Territory__c: "North America", Regions__c: [] },
  { Id: "005Hs00000000010AA", Name: "Adam D’Cunha", Title: "Sales", Email: "", Territory__c: "North America", Regions__c: [] },
  {
    Id: "005Hs00000000002AA",
    Name: "Dana Kowalski",
    Title: "Account Executive",
    Email: "dana.kowalski@thibolisoft.example",
    Territory__c: "Western Corn Belt",
    Regions__c: ["western-corn-belt"],
  },
  {
    Id: "005Hs00000000003AA",
    Name: "Marcus Reyes",
    Title: "Account Executive",
    Email: "marcus.reyes@thibolisoft.example",
    Territory__c: "Plains & Pacific Northwest",
    Regions__c: ["southern-plains", "pacific-northwest"],
  },
  {
    Id: "005Hs00000000004AA",
    Name: "Priya Sandhu",
    Title: "Account Executive",
    Email: "priya.sandhu@thibolisoft.example",
    Territory__c: "Canadian Prairies",
    Regions__c: ["western-prairies", "manitoba"],
  },
  {
    Id: "005Hs00000000005AA",
    Name: "Luke Brenneman",
    Title: "Account Executive",
    Email: "luke.brenneman@thibolisoft.example",
    Territory__c: "Eastern Corn Belt, Great Lakes & Central Canada",
    Regions__c: ["eastern-corn-belt", "great-lakes", "central-canada"],
  },
  {
    Id: "005Hs00000000006AA",
    Name: "Tasha Whitfield",
    Title: "Account Executive",
    Email: "tasha.whitfield@thibolisoft.example",
    Territory__c: "South & East",
    Regions__c: ["delta", "southeast", "mid-atlantic"],
  },
  {
    Id: "005Hs00000000007AA",
    Name: "Erik Halvorsen",
    Title: "Account Executive",
    Email: "erik.halvorsen@thibolisoft.example",
    Territory__c: "Northern Plains",
    Regions__c: ["northern-plains"],
  },
];

/** Users who can sign in to the app */
export const APP_USERS = USERS.slice(0, 4);

/** Owner for records the seed script creates (campaigns) */
export const CURRENT_USER_ID = USERS[0].Id;

export const USER_BY_ID: Record<string, User> = Object.fromEntries(USERS.map((u) => [u.Id, u]));

export function ownerForRegion(regionId: string): string {
  return USERS.find((u) => u.Regions__c.includes(regionId as never))?.Id ?? CURRENT_USER_ID;
}
