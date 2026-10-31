// Places the bot understands in version 1: the most-visited cities in South and
// Southeast Asia, East Asia (incl. China), the Middle East hubs, Europe, the UK,
// US, Canada, Australia and New Zealand.
//
// code  = IATA city code (covers all airports of the city where one exists)
// cc    = ISO country code, tz = standard UTC offset in hours (daylight saving
//         is ignored, so arrival times are "about")
// tags  = trip types used by "similar places" suggestions
// aliases = extra spellings people type

const P = (code, name, cc, tz, region, tags, aliases = []) => ({ code, name, cc, tz, region, tags, aliases });

export const PLACES = [
  // Bangladesh
  P('DAC', 'Dhaka', 'BD', 6, 'south_asia', ['city'], ['dhaka', 'dacca']),
  P('CGP', 'Chattogram', 'BD', 6, 'south_asia', ['city'], ['chittagong', 'chattogram', 'ctg']),
  P('ZYL', 'Sylhet', 'BD', 6, 'south_asia', ['city', 'nature'], ['sylhet']),
  P('CXB', "Cox's Bazar", 'BD', 6, 'south_asia', ['beach'], ["cox's bazar", 'coxs bazar', 'cox bazar', 'coxsbazar']),
  // India, Nepal, Bhutan, Sri Lanka, Maldives, Pakistan
  P('DEL', 'Delhi', 'IN', 5.5, 'south_asia', ['city', 'culture'], ['delhi', 'new delhi']),
  P('BOM', 'Mumbai', 'IN', 5.5, 'south_asia', ['city'], ['mumbai', 'bombay']),
  P('BLR', 'Bengaluru', 'IN', 5.5, 'south_asia', ['city'], ['bangalore', 'bengaluru']),
  P('MAA', 'Chennai', 'IN', 5.5, 'south_asia', ['city'], ['chennai', 'madras']),
  P('CCU', 'Kolkata', 'IN', 5.5, 'south_asia', ['city', 'culture'], ['kolkata', 'calcutta']),
  P('HYD', 'Hyderabad', 'IN', 5.5, 'south_asia', ['city'], ['hyderabad']),
  P('GOI', 'Goa', 'IN', 5.5, 'south_asia', ['beach'], ['goa']),
  P('COK', 'Kochi', 'IN', 5.5, 'south_asia', ['beach', 'nature'], ['kochi', 'cochin', 'kerala']),
  P('JAI', 'Jaipur', 'IN', 5.5, 'south_asia', ['culture'], ['jaipur']),
  P('KTM', 'Kathmandu', 'NP', 5.75, 'south_asia', ['nature', 'culture'], ['kathmandu']),
  P('PBH', 'Paro (Bhutan)', 'BT', 6, 'south_asia', ['nature', 'culture'], ['paro', 'thimphu']),
  P('CMB', 'Colombo', 'LK', 5.5, 'south_asia', ['beach', 'city'], ['colombo']),
  P('MLE', 'Malé (Maldives)', 'MV', 5, 'south_asia', ['beach'], ['male', 'malé']),
  P('KHI', 'Karachi', 'PK', 5, 'south_asia', ['city'], ['karachi']),
  P('LHE', 'Lahore', 'PK', 5, 'south_asia', ['city', 'culture'], ['lahore']),
  // Southeast Asia
  P('BKK', 'Bangkok', 'TH', 7, 'se_asia', ['city', 'shopping', 'food'], ['bangkok']),
  P('HKT', 'Phuket', 'TH', 7, 'se_asia', ['beach'], ['phuket']),
  P('CNX', 'Chiang Mai', 'TH', 7, 'se_asia', ['nature', 'culture'], ['chiang mai', 'chiangmai']),
  P('USM', 'Koh Samui', 'TH', 7, 'se_asia', ['beach'], ['koh samui', 'samui']),
  P('KUL', 'Kuala Lumpur', 'MY', 8, 'se_asia', ['city', 'shopping', 'food'], ['kuala lumpur', 'kl']),
  P('LGK', 'Langkawi', 'MY', 8, 'se_asia', ['beach'], ['langkawi']),
  P('PEN', 'Penang', 'MY', 8, 'se_asia', ['food', 'culture', 'beach'], ['penang']),
  P('BKI', 'Kota Kinabalu', 'MY', 8, 'se_asia', ['nature', 'beach'], ['kota kinabalu', 'sabah']),
  P('SIN', 'Singapore', 'SG', 8, 'se_asia', ['city', 'shopping', 'food'], ['singapore']),
  P('DPS', 'Bali', 'ID', 8, 'se_asia', ['beach', 'nature'], ['bali', 'denpasar']),
  P('JKT', 'Jakarta', 'ID', 7, 'se_asia', ['city'], ['jakarta']),
  P('MNL', 'Manila', 'PH', 8, 'se_asia', ['city'], ['manila']),
  P('CEB', 'Cebu', 'PH', 8, 'se_asia', ['beach'], ['cebu']),
  P('SGN', 'Ho Chi Minh City', 'VN', 7, 'se_asia', ['city', 'food'], ['ho chi minh', 'saigon', 'hcmc']),
  P('HAN', 'Hanoi', 'VN', 7, 'se_asia', ['city', 'culture', 'food'], ['hanoi']),
  P('DAD', 'Da Nang', 'VN', 7, 'se_asia', ['beach'], ['da nang', 'danang']),
  P('PNH', 'Phnom Penh', 'KH', 7, 'se_asia', ['city', 'culture'], ['phnom penh']),
  P('REP', 'Siem Reap', 'KH', 7, 'se_asia', ['culture'], ['siem reap', 'angkor', 'angkor wat']),
  P('RGN', 'Yangon', 'MM', 6.5, 'se_asia', ['culture'], ['yangon', 'rangoon']),
  // East Asia
  P('TYO', 'Tokyo', 'JP', 9, 'east_asia', ['city', 'shopping', 'food', 'culture'], ['tokyo']),
  P('OSA', 'Osaka', 'JP', 9, 'east_asia', ['city', 'food', 'culture'], ['osaka', 'kyoto']),
  P('SEL', 'Seoul', 'KR', 9, 'east_asia', ['city', 'shopping', 'food'], ['seoul']),
  P('PUS', 'Busan', 'KR', 9, 'east_asia', ['beach', 'city'], ['busan']),
  P('BJS', 'Beijing', 'CN', 8, 'east_asia', ['city', 'culture'], ['beijing', 'peking']),
  P('SHA', 'Shanghai', 'CN', 8, 'east_asia', ['city', 'shopping'], ['shanghai']),
  P('CAN', 'Guangzhou', 'CN', 8, 'east_asia', ['city', 'shopping'], ['guangzhou', 'canton']),
  P('SZX', 'Shenzhen', 'CN', 8, 'east_asia', ['city', 'shopping'], ['shenzhen']),
  P('CTU', 'Chengdu', 'CN', 8, 'east_asia', ['food', 'nature'], ['chengdu']),
  P('KMG', 'Kunming', 'CN', 8, 'east_asia', ['nature'], ['kunming']),
  P('HKG', 'Hong Kong', 'HK', 8, 'east_asia', ['city', 'shopping', 'food'], ['hong kong', 'hongkong']),
  P('MFM', 'Macau', 'MO', 8, 'east_asia', ['city'], ['macau', 'macao']),
  P('TPE', 'Taipei', 'TW', 8, 'east_asia', ['city', 'food'], ['taipei']),
  // Middle East and Turkey
  P('DXB', 'Dubai', 'AE', 4, 'middle_east', ['city', 'shopping'], ['dubai']),
  P('AUH', 'Abu Dhabi', 'AE', 4, 'middle_east', ['city'], ['abu dhabi']),
  P('DOH', 'Doha', 'QA', 3, 'middle_east', ['city'], ['doha']),
  P('RUH', 'Riyadh', 'SA', 3, 'middle_east', ['city'], ['riyadh']),
  P('JED', 'Jeddah', 'SA', 3, 'middle_east', ['city'], ['jeddah', 'jidda']),
  P('MED', 'Madinah', 'SA', 3, 'middle_east', ['culture'], ['madinah', 'medina']),
  P('MCT', 'Muscat', 'OM', 4, 'middle_east', ['city', 'nature'], ['muscat']),
  P('IST', 'Istanbul', 'TR', 3, 'europe', ['city', 'culture', 'food'], ['istanbul']),
  // Europe and UK
  P('LON', 'London', 'GB', 0, 'europe', ['city', 'culture', 'shopping'], ['london']),
  P('MAN', 'Manchester', 'GB', 0, 'europe', ['city'], ['manchester']),
  P('BHX', 'Birmingham', 'GB', 0, 'europe', ['city'], ['birmingham']),
  P('EDI', 'Edinburgh', 'GB', 0, 'europe', ['city', 'culture'], ['edinburgh']),
  P('DUB', 'Dublin', 'IE', 0, 'europe', ['city'], ['dublin']),
  P('PAR', 'Paris', 'FR', 1, 'europe', ['city', 'culture', 'food'], ['paris']),
  P('NCE', 'Nice', 'FR', 1, 'europe', ['beach'], ['nice', 'french riviera']),
  P('AMS', 'Amsterdam', 'NL', 1, 'europe', ['city', 'culture'], ['amsterdam']),
  P('BRU', 'Brussels', 'BE', 1, 'europe', ['city'], ['brussels']),
  P('BER', 'Berlin', 'DE', 1, 'europe', ['city', 'culture'], ['berlin']),
  P('MUC', 'Munich', 'DE', 1, 'europe', ['city'], ['munich', 'münchen']),
  P('FRA', 'Frankfurt', 'DE', 1, 'europe', ['city'], ['frankfurt']),
  P('ZRH', 'Zurich', 'CH', 1, 'europe', ['nature', 'city'], ['zurich', 'zürich']),
  P('GVA', 'Geneva', 'CH', 1, 'europe', ['nature', 'city'], ['geneva']),
  P('VIE', 'Vienna', 'AT', 1, 'europe', ['city', 'culture'], ['vienna']),
  P('PRG', 'Prague', 'CZ', 1, 'europe', ['city', 'culture'], ['prague']),
  P('BUD', 'Budapest', 'HU', 1, 'europe', ['city', 'culture'], ['budapest']),
  P('WAW', 'Warsaw', 'PL', 1, 'europe', ['city'], ['warsaw']),
  P('ROM', 'Rome', 'IT', 1, 'europe', ['city', 'culture', 'food'], ['rome', 'roma']),
  P('MIL', 'Milan', 'IT', 1, 'europe', ['city', 'shopping'], ['milan', 'milano']),
  P('VCE', 'Venice', 'IT', 1, 'europe', ['culture'], ['venice', 'venezia']),
  P('FLR', 'Florence', 'IT', 1, 'europe', ['culture', 'food'], ['florence', 'firenze']),
  P('BCN', 'Barcelona', 'ES', 1, 'europe', ['city', 'beach', 'food'], ['barcelona']),
  P('MAD', 'Madrid', 'ES', 1, 'europe', ['city', 'food'], ['madrid']),
  P('LIS', 'Lisbon', 'PT', 0, 'europe', ['city', 'beach', 'food'], ['lisbon', 'lisboa']),
  P('ATH', 'Athens', 'GR', 2, 'europe', ['culture', 'beach'], ['athens']),
  P('CPH', 'Copenhagen', 'DK', 1, 'europe', ['city'], ['copenhagen']),
  P('STO', 'Stockholm', 'SE', 1, 'europe', ['city'], ['stockholm']),
  P('OSL', 'Oslo', 'NO', 1, 'europe', ['nature', 'city'], ['oslo']),
  // North America
  P('NYC', 'New York', 'US', -5, 'north_america', ['city', 'shopping', 'culture'], ['new york', 'nyc', 'ny', 'manhattan']),
  P('WAS', 'Washington DC', 'US', -5, 'north_america', ['city', 'culture'], ['washington', 'washington dc', 'dc']),
  P('BOS', 'Boston', 'US', -5, 'north_america', ['city'], ['boston']),
  P('CHI', 'Chicago', 'US', -6, 'north_america', ['city'], ['chicago']),
  P('MIA', 'Miami', 'US', -5, 'north_america', ['beach', 'city'], ['miami']),
  P('MCO', 'Orlando', 'US', -5, 'north_america', ['family'], ['orlando', 'disney world']),
  P('ATL', 'Atlanta', 'US', -5, 'north_america', ['city'], ['atlanta']),
  P('DFW', 'Dallas', 'US', -6, 'north_america', ['city'], ['dallas']),
  P('LAX', 'Los Angeles', 'US', -8, 'north_america', ['city', 'beach'], ['los angeles', 'la']),
  P('SFO', 'San Francisco', 'US', -8, 'north_america', ['city'], ['san francisco', 'sf']),
  P('LAS', 'Las Vegas', 'US', -8, 'north_america', ['city'], ['las vegas', 'vegas']),
  P('SEA', 'Seattle', 'US', -8, 'north_america', ['city', 'nature'], ['seattle']),
  P('HNL', 'Honolulu', 'US', -10, 'north_america', ['beach'], ['honolulu', 'hawaii']),
  P('CUN', 'Cancún', 'MX', -5, 'north_america', ['beach'], ['cancun', 'cancún']),
  P('YTO', 'Toronto', 'CA', -5, 'north_america', ['city'], ['toronto']),
  P('YMQ', 'Montreal', 'CA', -5, 'north_america', ['city', 'culture'], ['montreal', 'montréal']),
  P('YVR', 'Vancouver', 'CA', -8, 'north_america', ['city', 'nature'], ['vancouver']),
  P('YYC', 'Calgary', 'CA', -7, 'north_america', ['nature'], ['calgary', 'banff']),
  // Australia and New Zealand
  P('SYD', 'Sydney', 'AU', 10, 'oceania', ['city', 'beach'], ['sydney']),
  P('MEL', 'Melbourne', 'AU', 10, 'oceania', ['city', 'food'], ['melbourne']),
  P('BNE', 'Brisbane', 'AU', 10, 'oceania', ['city', 'beach'], ['brisbane']),
  P('PER', 'Perth', 'AU', 8, 'oceania', ['city', 'beach'], ['perth']),
  P('OOL', 'Gold Coast', 'AU', 10, 'oceania', ['beach'], ['gold coast']),
  P('AKL', 'Auckland', 'NZ', 12, 'oceania', ['city', 'nature'], ['auckland']),
  P('CHC', 'Christchurch', 'NZ', 12, 'oceania', ['nature'], ['christchurch']),
  P('ZQN', 'Queenstown', 'NZ', 12, 'oceania', ['nature'], ['queenstown']),
];


// Approximate city-centre coordinates (lat, lon) for weather lookups.
export const COORDS = {
  DAC: [23.81, 90.41], CGP: [22.36, 91.78], ZYL: [24.9, 91.87], CXB: [21.43, 92.01], DEL: [28.61, 77.21], BOM: [19.08, 72.88],
  BLR: [12.97, 77.59], MAA: [13.08, 80.27], CCU: [22.57, 88.36], HYD: [17.39, 78.49], GOI: [15.5, 73.83], COK: [9.93, 76.27],
  JAI: [26.91, 75.79], KTM: [27.72, 85.32], PBH: [27.43, 89.42], CMB: [6.93, 79.86], MLE: [4.18, 73.51], KHI: [24.86, 67.01],
  LHE: [31.55, 74.34], BKK: [13.76, 100.5], HKT: [7.88, 98.39], CNX: [18.79, 98.98], USM: [9.51, 100.01], KUL: [3.14, 101.69],
  LGK: [6.35, 99.8], PEN: [5.41, 100.33], BKI: [5.98, 116.07], SIN: [1.35, 103.82], DPS: [-8.65, 115.22], JKT: [-6.21, 106.85],
  MNL: [14.6, 120.98], CEB: [10.32, 123.89], SGN: [10.82, 106.63], HAN: [21.03, 105.85], DAD: [16.05, 108.2], PNH: [11.56, 104.92],
  REP: [13.36, 103.86], RGN: [16.87, 96.2], TYO: [35.68, 139.69], OSA: [34.69, 135.5], SEL: [37.57, 126.98], PUS: [35.18, 129.08],
  BJS: [39.9, 116.41], SHA: [31.23, 121.47], CAN: [23.13, 113.26], SZX: [22.54, 114.06], CTU: [30.57, 104.07], KMG: [25.04, 102.71],
  HKG: [22.32, 114.17], MFM: [22.2, 113.54], TPE: [25.03, 121.57], DXB: [25.2, 55.27], AUH: [24.45, 54.38], DOH: [25.29, 51.53],
  RUH: [24.71, 46.68], JED: [21.49, 39.19], MED: [24.47, 39.61], MCT: [23.59, 58.41], IST: [41.01, 28.98], LON: [51.51, -0.13],
  MAN: [53.48, -2.24], BHX: [52.49, -1.89], EDI: [55.95, -3.19], DUB: [53.35, -6.26], PAR: [48.86, 2.35], NCE: [43.7, 7.27],
  AMS: [52.37, 4.9], BRU: [50.85, 4.35], BER: [52.52, 13.4], MUC: [48.14, 11.58], FRA: [50.11, 8.68], ZRH: [47.38, 8.54],
  GVA: [46.2, 6.14], VIE: [48.21, 16.37], PRG: [50.08, 14.44], BUD: [47.5, 19.04], WAW: [52.23, 21.01], ROM: [41.9, 12.5],
  MIL: [45.46, 9.19], VCE: [45.44, 12.32], FLR: [43.77, 11.26], BCN: [41.39, 2.17], MAD: [40.42, -3.7], LIS: [38.72, -9.14],
  ATH: [37.98, 23.73], CPH: [55.68, 12.57], STO: [59.33, 18.07], OSL: [59.91, 10.75], NYC: [40.71, -74.01], WAS: [38.91, -77.04],
  BOS: [42.36, -71.06], CHI: [41.88, -87.63], MIA: [25.76, -80.19], MCO: [28.54, -81.38], ATL: [33.75, -84.39], DFW: [32.78, -96.8],
  LAX: [34.05, -118.24], SFO: [37.77, -122.42], LAS: [36.17, -115.14], SEA: [47.61, -122.33], HNL: [21.31, -157.86], CUN: [21.16, -86.85],
  YTO: [43.65, -79.38], YMQ: [45.5, -73.57], YVR: [49.28, -123.12], YYC: [51.05, -114.07], SYD: [-33.87, 151.21], MEL: [-37.81, 144.96],
  BNE: [-27.47, 153.03], PER: [-31.95, 115.86], OOL: [-28.02, 153.4], AKL: [-36.85, 174.76], CHC: [-43.53, 172.64], ZQN: [-45.03, 168.66],
};

const BY_CODE = new Map(PLACES.map((p) => [p.code, p]));

// Alias index, longest first so "new york" wins over "york".
const ALIASES = [];
for (const p of PLACES) {
  const names = new Set([p.name.toLowerCase(), ...p.aliases.map((a) => a.toLowerCase())]);
  for (const n of names) ALIASES.push([n, p.code]);
}
ALIASES.sort((a, b) => b[0].length - a[0].length);

export function placeByCode(code) {
  return code ? BY_CODE.get(String(code).toUpperCase()) || null : null;
}

const AMBIGUOUS = new Set(['nice', 'male', 'la', 'sf', 'ny', 'dc']);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALIAS_RES = ALIASES.map(([name, code]) => [new RegExp(`(^|[^a-z])${escapeRe(name)}(?=$|[^a-z])`, 'i'), code, name]);

// Find every known place mentioned in a text, in the order they appear.
export function findPlaces(text) {
  const found = [];
  const taken = []; // [start, end] ranges already used by a longer alias
  for (const [re, code, name] of ALIAS_RES) {
    const m = re.exec(text);
    if (!m) continue;
    const start = m.index + m[1].length;
    const end = start + name.length;
    if (taken.some(([s, e]) => start < e && end > s)) continue;
    // Words that are also ordinary English ("nice", "male") or 2-letter codes ("la", "uk")
    // only count when capitalised the way a place name would be: "Nice", "LA".
    if (AMBIGUOUS.has(name)) {
      const typed = text.slice(start, end);
      const ok = name.length <= 2 ? typed === typed.toUpperCase() : typed[0] === typed[0].toUpperCase();
      if (!ok) continue;
    }
    taken.push([start, end]);
    if (!found.some((f) => f.code === code)) found.push({ code, index: start });
  }
  // bare IATA codes typed in capitals, e.g. "DAC BKK"
  for (const m of text.matchAll(/\b([A-Z]{3})\b/g)) {
    if (BY_CODE.has(m[1]) && !found.some((f) => f.code === m[1]) && !taken.some(([s, e]) => m.index < e && m.index + 3 > s)) {
      found.push({ code: m[1], index: m.index });
    }
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.code);
}

// Resolve one typed name (setup, follow-up answers, AI output).
export function resolvePlace(text) {
  if (!text) return null;
  const t = String(text).trim();
  if (/^[A-Za-z]{3}$/.test(t) && BY_CODE.has(t.toUpperCase())) return BY_CODE.get(t.toUpperCase());
  const codes = findPlaces(t);
  return codes.length ? BY_CODE.get(codes[0]) : null;
}

// Currency per home country (prices requested in this currency, USD as fallback).
const CURRENCY = {
  BD: 'bdt', IN: 'inr', PK: 'pkr', NP: 'npr', LK: 'lkr', US: 'usd', GB: 'gbp', IE: 'eur', CA: 'cad', AU: 'aud', NZ: 'nzd',
  AE: 'aed', QA: 'qar', SA: 'sar', OM: 'omr', SG: 'sgd', MY: 'myr', TH: 'thb', ID: 'idr', PH: 'php', VN: 'vnd', JP: 'jpy',
  KR: 'krw', CN: 'cny', HK: 'hkd', TW: 'twd', TR: 'try', CH: 'chf', SE: 'sek', NO: 'nok', DK: 'dkk', PL: 'pln', CZ: 'czk',
  HU: 'huf', MX: 'mxn',
};
const EURO = ['FR', 'NL', 'BE', 'DE', 'AT', 'IT', 'ES', 'PT', 'GR'];
export function currencyFor(cc) {
  if (EURO.includes(cc)) return 'eur';
  return CURRENCY[cc] || 'usd';
}


export const POPULAR_FROM = {
  BD: ['BKK', 'KUL', 'DXB', 'CCU', 'SIN', 'KTM'],
  IN: ['DXB', 'BKK', 'SIN', 'KUL', 'MLE', 'LON'],
  GB: ['BCN', 'PAR', 'ROM', 'DXB', 'NYC', 'LIS'],
  US: ['CUN', 'LON', 'PAR', 'TYO', 'HNL', 'ROM'],
  CA: ['CUN', 'LON', 'PAR', 'NYC', 'TYO', 'MIA'],
  AU: ['DPS', 'SIN', 'TYO', 'AKL', 'BKK', 'LON'],
  NZ: ['SYD', 'MEL', 'DPS', 'TYO', 'SIN', 'HNL'],
  DEFAULT: ['DXB', 'BKK', 'LON', 'SIN', 'IST', 'TYO'],
};
