export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador",
  NS: "Nova Scotia", ON: "Ontario", PE: "Prince Edward Island", QC: "Québec", SK: "Saskatchewan",
};

export const CANADIAN_PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "ON", "PE", "QC", "SK"];

/**
 * Tile-grid cartogram of Canada (top rows) and the United States.
 * [col, row] — equal-area tiles keep small ag states readable on mobile.
 */
export const TILE_GRID: Record<string, [number, number]> = {
  // Canada
  BC: [1, 0], AB: [2, 0], SK: [3, 0], MB: [4, 0], ON: [6, 0], QC: [8, 0], NL: [10, 0],
  NB: [9, 1], PE: [10, 1], NS: [10, 2],
  // United States
  AK: [0, 2], ME: [11, 2],
  WI: [6, 3], VT: [10, 3], NH: [11, 3],
  WA: [1, 4], ID: [2, 4], MT: [3, 4], ND: [4, 4], MN: [5, 4], IL: [6, 4], MI: [7, 4], NY: [9, 4], MA: [10, 4],
  OR: [1, 5], NV: [2, 5], WY: [3, 5], SD: [4, 5], IA: [5, 5], IN: [6, 5], OH: [7, 5], PA: [8, 5], NJ: [9, 5], CT: [10, 5], RI: [11, 5],
  CA: [1, 6], UT: [2, 6], CO: [3, 6], NE: [4, 6], MO: [5, 6], KY: [6, 6], WV: [7, 6], VA: [8, 6], MD: [9, 6], DE: [10, 6],
  AZ: [2, 7], NM: [3, 7], KS: [4, 7], AR: [5, 7], TN: [6, 7], NC: [7, 7], SC: [8, 7],
  OK: [4, 8], LA: [5, 8], MS: [6, 8], AL: [7, 8], GA: [8, 8],
  HI: [0, 9], TX: [4, 9], FL: [9, 9],
};

/** Postal-code helpers for realistic mock addresses */
export const ZIP_PREFIX: Record<string, [number, number]> = {
  KS: [660, 679], OK: [730, 749], TX: [790, 799], CO: [806, 816], ND: [580, 588], SD: [570, 577],
  MT: [590, 599], IA: [500, 528], NE: [680, 693], MN: [550, 567], MO: [630, 658], IL: [600, 629],
  IN: [460, 479], OH: [430, 458], MI: [480, 499], WI: [530, 549], AR: [716, 729], MS: [386, 397],
  LA: [700, 714], TN: [370, 385], KY: [400, 427], GA: [300, 319], AL: [350, 369], NC: [270, 289],
  SC: [290, 299], PA: [150, 196], MD: [206, 219], DE: [197, 199], VA: [220, 246], NY: [100, 149],
  WA: [980, 994], OR: [970, 979], ID: [832, 838],
};

export const POSTAL_FSA_LETTER: Record<string, string[]> = {
  SK: ["S"], AB: ["T"], MB: ["R"], ON: ["N", "K"], QC: ["J", "G"],
};

export const AREA_CODES: Record<string, string[]> = {
  KS: ["620", "785"], OK: ["580"], TX: ["806", "940"], CO: ["970", "719"], ND: ["701"], SD: ["605"],
  MT: ["406"], IA: ["515", "712", "641", "319"], NE: ["308", "402"], MN: ["507", "320", "218"],
  MO: ["660", "573"], IL: ["217", "309", "815"], IN: ["765", "574", "812"], OH: ["419", "937", "330"],
  MI: ["989", "517", "616"], WI: ["715", "920", "608"], AR: ["870", "479"], MS: ["662", "601"],
  LA: ["337", "318"], TN: ["731"], KY: ["270"], GA: ["770", "229", "912"], AL: ["256", "334"],
  NC: ["919", "336", "910", "252"], SC: ["803", "843"], PA: ["717"], MD: ["410", "301"], DE: ["302"],
  VA: ["540", "804", "757"], NY: ["585", "315", "607"], WA: ["509"], OR: ["541"], ID: ["208"],
  SK: ["306"], AB: ["403", "780"], MB: ["204"], ON: ["519", "613"], QC: ["450", "819"],
};
