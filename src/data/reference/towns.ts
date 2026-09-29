import type { Town } from "@/types/reference";

/** Real agricultural towns (approximate coordinates). Company names are fictional. */
const RAW: [string, string, number, number][] = [
  // Kansas
  ["Dodge City", "KS", 37.75, -100.02], ["Garden City", "KS", 37.97, -100.87], ["Hutchinson", "KS", 38.06, -97.93],
  ["Salina", "KS", 38.84, -97.61], ["Great Bend", "KS", 38.36, -98.76], ["Colby", "KS", 39.4, -101.05],
  ["Liberal", "KS", 37.04, -100.92], ["Pratt", "KS", 37.64, -98.74], ["McPherson", "KS", 38.37, -97.66],
  ["Hays", "KS", 38.88, -99.33], ["Scott City", "KS", 38.48, -100.91], ["Goodland", "KS", 39.35, -101.71],
  ["Kingman", "KS", 37.65, -98.11], ["Concordia", "KS", 39.57, -97.66], ["Russell", "KS", 38.9, -98.86],
  // Oklahoma
  ["Enid", "OK", 36.4, -97.88], ["Alva", "OK", 36.8, -98.67], ["Guymon", "OK", 36.68, -101.48],
  ["Kingfisher", "OK", 35.86, -97.93], ["Woodward", "OK", 36.43, -99.39], ["Altus", "OK", 34.64, -99.33],
  ["Ponca City", "OK", 36.71, -97.09], ["Clinton", "OK", 35.52, -98.97],
  // Texas
  ["Amarillo", "TX", 35.22, -101.83], ["Hereford", "TX", 34.82, -102.4], ["Dalhart", "TX", 36.06, -102.52],
  ["Lubbock", "TX", 33.58, -101.86], ["Plainview", "TX", 34.18, -101.71], ["Perryton", "TX", 36.4, -100.8],
  ["Dumas", "TX", 35.87, -101.97], ["Vernon", "TX", 34.15, -99.27], ["Muleshoe", "TX", 34.23, -102.72],
  ["Dimmitt", "TX", 34.55, -102.31], ["Friona", "TX", 34.64, -102.72],
  // Colorado
  ["Yuma", "CO", 40.12, -102.72], ["Burlington", "CO", 39.31, -102.27], ["Sterling", "CO", 40.63, -103.21],
  ["Greeley", "CO", 40.42, -104.71], ["Lamar", "CO", 38.09, -102.62], ["Holyoke", "CO", 40.58, -102.3],
  // North Dakota
  ["Minot", "ND", 48.23, -101.3], ["Williston", "ND", 48.15, -103.62], ["Devils Lake", "ND", 48.11, -98.87],
  ["Jamestown", "ND", 46.91, -98.71], ["Grand Forks", "ND", 47.93, -97.03], ["Fargo", "ND", 46.88, -96.79],
  ["Dickinson", "ND", 46.88, -102.79], ["Langdon", "ND", 48.76, -98.37], ["Carrington", "ND", 47.45, -99.13],
  ["Valley City", "ND", 46.92, -98.0], ["Wahpeton", "ND", 46.27, -96.61], ["Casselton", "ND", 46.9, -97.21],
  ["Bottineau", "ND", 48.83, -100.45], ["Rugby", "ND", 48.37, -99.99], ["Hillsboro", "ND", 47.4, -97.06],
  // South Dakota
  ["Aberdeen", "SD", 45.46, -98.49], ["Huron", "SD", 44.36, -98.21], ["Mitchell", "SD", 43.71, -98.03],
  ["Watertown", "SD", 44.9, -97.12], ["Brookings", "SD", 44.31, -96.8], ["Redfield", "SD", 44.88, -98.52],
  ["Pierre", "SD", 44.37, -100.35], ["Yankton", "SD", 42.87, -97.4], ["Milbank", "SD", 45.22, -96.64],
  // Montana
  ["Great Falls", "MT", 47.5, -111.3], ["Havre", "MT", 48.55, -109.68], ["Conrad", "MT", 48.17, -111.95],
  ["Shelby", "MT", 48.51, -111.86], ["Glasgow", "MT", 48.2, -106.64], ["Sidney", "MT", 47.72, -104.16],
  ["Lewistown", "MT", 47.06, -109.43], ["Scobey", "MT", 48.79, -105.42],
  // Iowa
  ["Ames", "IA", 42.03, -93.62], ["Fort Dodge", "IA", 42.5, -94.17], ["Mason City", "IA", 43.15, -93.2],
  ["Spencer", "IA", 43.14, -95.14], ["Sioux Center", "IA", 43.08, -96.18], ["Storm Lake", "IA", 42.64, -95.21],
  ["Carroll", "IA", 42.07, -94.87], ["Denison", "IA", 42.02, -95.35], ["Atlantic", "IA", 41.4, -95.01],
  ["Webster City", "IA", 42.47, -93.82], ["Iowa Falls", "IA", 42.52, -93.27], ["Marshalltown", "IA", 42.05, -92.91],
  ["Waterloo", "IA", 42.49, -92.34], ["Le Mars", "IA", 42.79, -96.17], ["Emmetsburg", "IA", 43.11, -94.68],
  ["Algona", "IA", 43.07, -94.23], ["Decorah", "IA", 43.3, -91.79], ["Washington", "IA", 41.3, -91.69],
  ["Creston", "IA", 41.06, -94.36], ["Nevada", "IA", 42.02, -93.45], ["Galva", "IA", 42.51, -95.42],
  // Nebraska
  ["Grand Island", "NE", 40.92, -98.34], ["Kearney", "NE", 40.7, -99.08], ["Hastings", "NE", 40.59, -98.39],
  ["Columbus", "NE", 41.43, -97.37], ["Norfolk", "NE", 42.03, -97.42], ["York", "NE", 40.87, -97.59],
  ["Holdrege", "NE", 40.44, -99.37], ["McCook", "NE", 40.2, -100.63], ["North Platte", "NE", 41.12, -100.77],
  ["Aurora", "NE", 40.87, -98.0], ["Wayne", "NE", 42.23, -97.02], ["Fremont", "NE", 41.43, -96.5],
  ["Beatrice", "NE", 40.27, -96.75], ["O'Neill", "NE", 42.46, -98.65], ["Lexington", "NE", 40.78, -99.74],
  // Minnesota
  ["Mankato", "MN", 44.16, -94.0], ["Worthington", "MN", 43.62, -95.6], ["Marshall", "MN", 44.45, -95.79],
  ["Willmar", "MN", 45.12, -95.04], ["Fairmont", "MN", 43.65, -94.46], ["Redwood Falls", "MN", 44.54, -95.12],
  ["Morris", "MN", 45.59, -95.91], ["Crookston", "MN", 47.77, -96.61], ["Albert Lea", "MN", 43.65, -93.37],
  ["Owatonna", "MN", 44.08, -93.23], ["Benson", "MN", 45.31, -95.6], ["Moorhead", "MN", 46.87, -96.77],
  ["Pipestone", "MN", 44.0, -96.32], ["St. Cloud", "MN", 45.56, -94.16],
  // Missouri
  ["Chillicothe", "MO", 39.8, -93.55], ["Mexico", "MO", 39.17, -91.88], ["Sikeston", "MO", 36.88, -89.59],
  ["Macon", "MO", 39.74, -92.47], ["Maryville", "MO", 40.35, -94.87], ["Carrollton", "MO", 39.36, -93.5],
  // Illinois
  ["Decatur", "IL", 39.84, -88.95], ["Champaign", "IL", 40.12, -88.24], ["Bloomington", "IL", 40.48, -88.99],
  ["Peoria", "IL", 40.69, -89.59], ["Galesburg", "IL", 40.95, -90.37], ["Kankakee", "IL", 41.12, -87.86],
  ["Pontiac", "IL", 40.88, -88.63], ["Effingham", "IL", 39.12, -88.54], ["Quincy", "IL", 39.94, -91.41],
  ["Dixon", "IL", 41.84, -89.48], ["Mattoon", "IL", 39.48, -88.37], ["Gibson City", "IL", 40.46, -88.37],
  ["Monmouth", "IL", 40.91, -90.65], ["Taylorville", "IL", 39.55, -89.29], ["Tuscola", "IL", 39.8, -88.28],
  ["Watseka", "IL", 40.78, -87.74],
  // Indiana
  ["Lafayette", "IN", 40.42, -86.88], ["Kokomo", "IN", 40.49, -86.13], ["Logansport", "IN", 40.75, -86.36],
  ["Frankfort", "IN", 40.28, -86.51], ["Muncie", "IN", 40.19, -85.39], ["Rensselaer", "IN", 40.94, -87.15],
  ["Vincennes", "IN", 38.68, -87.53], ["Wabash", "IN", 40.8, -85.82], ["Tipton", "IN", 40.28, -86.04],
  ["Portland", "IN", 40.43, -84.98], ["Seymour", "IN", 38.96, -85.89],
  // Ohio
  ["Findlay", "OH", 41.04, -83.65], ["Lima", "OH", 40.74, -84.11], ["Wooster", "OH", 40.81, -81.94],
  ["Marion", "OH", 40.59, -83.13], ["Bowling Green", "OH", 41.37, -83.65], ["Greenville", "OH", 40.1, -84.63],
  ["Wapakoneta", "OH", 40.57, -84.19], ["Circleville", "OH", 39.6, -82.95], ["Van Wert", "OH", 40.87, -84.58],
  ["Fostoria", "OH", 41.16, -83.42], ["Celina", "OH", 40.55, -84.57],
  // Michigan
  ["Saginaw", "MI", 43.42, -83.95], ["Bay City", "MI", 43.59, -83.89], ["Caro", "MI", 43.49, -83.4],
  ["Coldwater", "MI", 41.94, -85.0], ["Hillsdale", "MI", 41.92, -84.63], ["Ithaca", "MI", 43.29, -84.61],
  ["Bad Axe", "MI", 43.8, -83.0], ["St. Johns", "MI", 43.0, -84.56], ["Zeeland", "MI", 42.81, -86.02],
  // Wisconsin
  ["Marshfield", "WI", 44.67, -90.17], ["Fond du Lac", "WI", 43.77, -88.44], ["Beaver Dam", "WI", 43.46, -88.84],
  ["Janesville", "WI", 42.68, -89.02], ["Monroe", "WI", 42.6, -89.64], ["Eau Claire", "WI", 44.81, -91.5],
  ["Platteville", "WI", 42.73, -90.48], ["Chilton", "WI", 44.03, -88.16], ["Waupun", "WI", 43.63, -88.73],
  // Arkansas
  ["Jonesboro", "AR", 35.84, -90.7], ["Stuttgart", "AR", 34.5, -91.55], ["Blytheville", "AR", 35.93, -89.92],
  ["Walnut Ridge", "AR", 36.07, -90.96], ["Wynne", "AR", 35.22, -90.79], ["Helena", "AR", 34.53, -90.59],
  ["Springdale", "AR", 36.19, -94.13],
  // Mississippi
  ["Greenville", "MS", 33.41, -91.06], ["Cleveland", "MS", 33.74, -90.72], ["Greenwood", "MS", 33.52, -90.18],
  ["Yazoo City", "MS", 32.86, -90.41], ["Clarksdale", "MS", 34.2, -90.57], ["Forest", "MS", 32.36, -89.47],
  // Louisiana
  ["Crowley", "LA", 30.21, -92.37], ["Rayne", "LA", 30.23, -92.27], ["Tallulah", "LA", 32.41, -91.19],
  // Tennessee
  ["Dyersburg", "TN", 36.03, -89.39], ["Union City", "TN", 36.42, -89.06], ["Jackson", "TN", 35.61, -88.81],
  ["Milan", "TN", 35.92, -88.76],
  // Kentucky
  ["Hopkinsville", "KY", 36.87, -87.49], ["Owensboro", "KY", 37.77, -87.11], ["Henderson", "KY", 37.84, -87.59],
  ["Mayfield", "KY", 36.74, -88.64], ["Russellville", "KY", 36.85, -86.89],
  // Georgia
  ["Gainesville", "GA", 34.3, -83.82], ["Tifton", "GA", 31.45, -83.51], ["Albany", "GA", 31.58, -84.16],
  ["Moultrie", "GA", 31.18, -83.79], ["Vidalia", "GA", 32.22, -82.41], ["Canton", "GA", 34.24, -84.49],
  ["Cordele", "GA", 31.96, -83.78],
  // Alabama
  ["Cullman", "AL", 34.17, -86.84], ["Albertville", "AL", 34.27, -86.21], ["Dothan", "AL", 31.22, -85.39],
  ["Decatur", "AL", 34.61, -86.98], ["Guntersville", "AL", 34.36, -86.29],
  // North Carolina
  ["Siler City", "NC", 35.72, -79.46], ["Wilkesboro", "NC", 36.15, -81.16], ["Clinton", "NC", 35.0, -78.32],
  ["Goldsboro", "NC", 35.38, -77.99], ["Kinston", "NC", 35.26, -77.58], ["Rocky Mount", "NC", 35.94, -77.79],
  ["Wallace", "NC", 34.74, -77.99],
  // South Carolina
  ["Orangeburg", "SC", 33.49, -80.86], ["Florence", "SC", 34.2, -79.76], ["Newberry", "SC", 34.27, -81.62],
  // Pennsylvania
  ["Lancaster", "PA", 40.04, -76.31], ["Ephrata", "PA", 40.18, -76.18], ["Lebanon", "PA", 40.34, -76.41],
  ["Chambersburg", "PA", 39.94, -77.66], ["Gettysburg", "PA", 39.83, -77.23], ["Hanover", "PA", 39.8, -76.98],
  ["Myerstown", "PA", 40.37, -76.3], ["Mifflinburg", "PA", 40.92, -77.05],
  // Maryland / Delaware
  ["Salisbury", "MD", 38.36, -75.6], ["Easton", "MD", 38.77, -76.08], ["Hagerstown", "MD", 39.64, -77.72],
  ["Frederick", "MD", 39.41, -77.41], ["Georgetown", "DE", 38.69, -75.39], ["Milford", "DE", 38.91, -75.43],
  ["Seaford", "DE", 38.64, -75.61],
  // Virginia
  ["Harrisonburg", "VA", 38.45, -78.87], ["Broadway", "VA", 38.61, -78.8], ["Warsaw", "VA", 37.96, -76.76],
  ["Suffolk", "VA", 36.73, -76.58],
  // New York
  ["Batavia", "NY", 43.0, -78.19], ["Geneva", "NY", 42.87, -76.98], ["Canandaigua", "NY", 42.89, -77.28],
  ["Lowville", "NY", 43.79, -75.49], ["Cortland", "NY", 42.6, -76.18],
  // Washington
  ["Spokane", "WA", 47.66, -117.43], ["Colfax", "WA", 46.88, -117.36], ["Ritzville", "WA", 47.13, -118.38],
  ["Pullman", "WA", 46.73, -117.18], ["Walla Walla", "WA", 46.06, -118.34], ["Moses Lake", "WA", 47.13, -119.28],
  ["Davenport", "WA", 47.65, -118.15], ["Dayton", "WA", 46.32, -117.98], ["Pasco", "WA", 46.24, -119.1],
  ["Odessa", "WA", 47.33, -118.69],
  // Oregon
  ["Pendleton", "OR", 45.67, -118.79], ["The Dalles", "OR", 45.59, -121.18], ["Condon", "OR", 45.23, -120.18],
  ["Moro", "OR", 45.48, -120.73], ["Hermiston", "OR", 45.84, -119.29], ["Klamath Falls", "OR", 42.22, -121.78],
  // Idaho
  ["Idaho Falls", "ID", 43.49, -112.03], ["Twin Falls", "ID", 42.56, -114.46], ["Rexburg", "ID", 43.83, -111.79],
  ["Burley", "ID", 42.54, -113.79], ["American Falls", "ID", 42.78, -112.85], ["Lewiston", "ID", 46.42, -117.02],
  ["Grangeville", "ID", 45.93, -116.12], ["Nampa", "ID", 43.54, -116.56],
  // Saskatchewan
  ["Regina", "SK", 50.45, -104.61], ["Saskatoon", "SK", 52.13, -106.67], ["Moose Jaw", "SK", 50.39, -105.53],
  ["Swift Current", "SK", 50.29, -107.79], ["Yorkton", "SK", 51.21, -102.46], ["Weyburn", "SK", 49.66, -103.85],
  ["Estevan", "SK", 49.14, -102.99], ["North Battleford", "SK", 52.76, -108.29], ["Prince Albert", "SK", 53.2, -105.75],
  ["Humboldt", "SK", 52.2, -105.12], ["Kindersley", "SK", 51.47, -109.16], ["Rosetown", "SK", 51.55, -107.99],
  ["Melfort", "SK", 52.86, -104.61], ["Tisdale", "SK", 52.85, -104.05], ["Assiniboia", "SK", 49.63, -105.99],
  ["Outlook", "SK", 51.49, -107.05], ["Biggar", "SK", 52.06, -107.98], ["Nipawin", "SK", 53.36, -104.02],
  // Alberta
  ["Lethbridge", "AB", 49.69, -112.84], ["Red Deer", "AB", 52.27, -113.81], ["Camrose", "AB", 53.02, -112.83],
  ["Grande Prairie", "AB", 55.17, -118.79], ["Vegreville", "AB", 53.49, -112.05], ["Taber", "AB", 49.78, -112.15],
  ["Olds", "AB", 51.79, -114.11], ["Vulcan", "AB", 50.4, -113.26], ["Wetaskiwin", "AB", 52.97, -113.38],
  ["Stettler", "AB", 52.32, -112.72], ["Lacombe", "AB", 52.47, -113.73], ["Medicine Hat", "AB", 50.04, -110.68],
  ["Westlock", "AB", 54.15, -113.86], ["Vermilion", "AB", 53.35, -110.85], ["Barrhead", "AB", 54.12, -114.4],
  // Manitoba
  ["Brandon", "MB", 49.85, -99.95], ["Portage la Prairie", "MB", 49.97, -98.29], ["Winkler", "MB", 49.18, -97.94],
  ["Morden", "MB", 49.19, -98.1], ["Steinbach", "MB", 49.53, -96.68], ["Dauphin", "MB", 51.15, -100.05],
  ["Carman", "MB", 49.5, -98.0], ["Neepawa", "MB", 50.23, -99.47], ["Virden", "MB", 49.85, -100.93],
  ["Killarney", "MB", 49.18, -99.66], ["Minnedosa", "MB", 50.25, -99.84], ["Swan River", "MB", 52.1, -101.27],
  ["Altona", "MB", 49.1, -97.56], ["Souris", "MB", 49.62, -100.26],
  // Ontario
  ["Chatham", "ON", 42.4, -82.19], ["Stratford", "ON", 43.37, -80.98], ["Woodstock", "ON", 43.13, -80.75],
  ["Guelph", "ON", 43.55, -80.25], ["Listowel", "ON", 43.73, -80.95], ["Exeter", "ON", 43.35, -81.48],
  ["Tillsonburg", "ON", 42.86, -80.73], ["Kemptville", "ON", 45.02, -75.64], ["Winchester", "ON", 45.09, -75.35],
  ["Ridgetown", "ON", 42.44, -81.89], ["Mitchell", "ON", 43.47, -81.2], ["Seaforth", "ON", 43.55, -81.39],
  ["Aylmer", "ON", 42.77, -80.98], ["Belleville", "ON", 44.16, -77.38],
  // Québec
  ["Saint-Hyacinthe", "QC", 45.63, -72.96], ["Drummondville", "QC", 45.88, -72.48], ["Granby", "QC", 45.4, -72.73],
  ["Victoriaville", "QC", 46.05, -71.96], ["Saint-Jean-sur-Richelieu", "QC", 45.31, -73.26], ["Sainte-Marie", "QC", 46.44, -71.01],
  ["Joliette", "QC", 46.02, -73.44], ["Coaticook", "QC", 45.13, -71.8],
];

export const TOWNS: Town[] = RAW.map(([name, state, lat, lon]) => ({ name, state, lat, lon }));
