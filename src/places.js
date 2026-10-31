import { WORLD } from './world-data.js';
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

// ---------- the rest of the world (every airport with scheduled flights) ----------
const WORLD_BY_CODE = new Map();
const WORLD_BY_NAME = new Map(); // lower-case city name → biggest airport (rows are sorted large first)
for (const r of WORLD) {
  WORLD_BY_CODE.set(r[0], r);
  const n = r[1].toLowerCase();
  if (!WORLD_BY_NAME.has(n)) WORLD_BY_NAME.set(n, r);
}
for (const r of WORLD) for (const a of (r[7] || '').split(' ').filter(Boolean)) if (!WORLD_BY_CODE.has(a)) WORLD_BY_CODE.set(a, r);

// Hours from UTC for an IANA time zone, right now (handles daylight saving).
const TZ_CACHE = new Map();
export function tzOffset(tzName, lon = 0) {
  if (TZ_CACHE.has(tzName)) return TZ_CACHE.get(tzName);
  let h = Math.round(lon / 15);
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tzName, timeZoneName: 'shortOffset' })
      .formatToParts(new Date()).find((x) => x.type === 'timeZoneName')?.value || '';
    const m = part.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (m) h = (m[1] === '-' ? -1 : 1) * (Number(m[2]) + Number(m[3] || 0) / 60);
    else if (part === 'GMT') h = 0;
  } catch { /* keep the longitude estimate */ }
  TZ_CACHE.set(tzName, h);
  return h;
}

const WORLD_PLACE = new Map();
function worldPlace(r) {
  if (!r) return null;
  if (!WORLD_PLACE.has(r[0])) {
    WORLD_PLACE.set(r[0], {
      code: r[0], name: r[1], cc: r[2], tz: tzOffset(r[5], r[4]), region: null, tags: [], aliases: [],
      alts: (r[7] || '').split(' ').filter(Boolean), world: true, lat: r[3], lon: r[4],
    });
  }
  return WORLD_PLACE.get(r[0]);
}

export function placeByCode(code) {
  if (!code) return null;
  const c = String(code).toUpperCase();
  return BY_CODE.get(c) || worldPlace(WORLD_BY_CODE.get(c)) || null;
}

export function coordsFor(code) {
  if (COORDS[code]) return COORDS[code];
  const p = placeByCode(code);
  return p?.world ? [p.lat, p.lon] : null;
}

// Airports (biggest first) in a country, from the world list.
export function worldCitiesIn(cc, n = 8) {
  const seen = new Set();
  const out = [];
  for (const r of WORLD) {
    if (r[2] !== cc || seen.has(r[1])) continue;
    seen.add(r[1]);
    out.push(r[0]);
    if (out.length >= n) break;
  }
  return out;
}

// Capital 3-letter words that are not airports (currencies, common words).
const NOT_AIRPORTS = new Set(['BDT', 'USD', 'GBP', 'EUR', 'INR', 'AED', 'MYR', 'SGD', 'THB', 'AUD', 'CAD', 'NZD', 'PKR', 'SAR', 'QAR', 'TRY',
  'JPY', 'CNY', 'HKD', 'IDR', 'PHP', 'VND', 'KRW', 'NPR', 'LKR', 'RUB', 'BRL', 'EGP', 'CHF', 'OMR', 'KWD', 'BHD', 'MAX', 'MIN', 'THE', 'AND',
  'FOR', 'ANY', 'YOU', 'ALL', 'TWO', 'ONE', 'BUT', 'NOT', 'WAY', 'OUT', 'DAY', 'PER', 'PAX', 'KID', 'VIA', 'ASAP']);

// Words that are also world city names but usually mean something else.
const WORLD_SKIP = new Set(['mobile', 'split', 'liberal', 'independence', 'hope', 'batman', 'normal', 'friendly', 'sale', 'page',
  'eagle', 'globe', 'paradise', 'victoria', 'aurora', 'florence', 'bath', 'reading', 'deer lake', 'beach', 'island', 'lake', 'valley',
  'trip', 'family', 'friends', 'january', 'december', 'march', 'may', 'august', 'summer', 'winter', 'total', 'days', 'week']);

// World cities mentioned in a text. To avoid false hits, the name must be written
// like a place ("Tashkent"), or follow to/from/in/visit/via/and/a comma, or be the whole answer.
function findWorld(text, taken) {
  const words = [...text.matchAll(/[A-Za-z\u00C0-\u024F'’-]+/g)];
  const found = [];
  const short = words.length <= 3;
  for (let i = 0; i < words.length; i += 1) {
    for (const len of [3, 2, 1]) {
      if (i + len > words.length) continue;
      const start = words[i].index;
      const last = words[i + len - 1];
      const end = last.index + last[0].length;
      const phrase = text.slice(start, end).replace(/\s+/g, ' ');
      const key = phrase.toLowerCase();
      if (key.length < 4 || WORLD_SKIP.has(key)) continue;
      const r = WORLD_BY_NAME.get(key);
      if (!r || taken.some(([s, e]) => start < e && end > s)) continue;
      const before = text.slice(Math.max(0, start - 8), start).toLowerCase();
      const ok = short || /^[A-Z\u00C0-\u00DE]/.test(phrase) || /(\bto|\bfrom|\bin|\bvisit|\bvia|\band|,)\s*$/.test(before);
      if (!ok) continue;
      taken.push([start, end]);
      found.push({ code: r[0], index: start });
      break;
    }
  }
  return found;
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
  // bare IATA codes typed in capitals, e.g. "DAC BKK" or "TAS"
  const shortMsg = text.trim().split(/\s+/).length <= 4;
  for (const m of text.matchAll(/\b([A-Z]{3})\b/g)) {
    if (NOT_AIRPORTS.has(m[1])) continue;
    const code = BY_CODE.has(m[1]) ? m[1] : shortMsg ? WORLD_BY_CODE.get(m[1])?.[0] : null;
    if (code && !found.some((f) => f.code === code) && !taken.some(([s, e]) => m.index < e && m.index + 3 > s)) {
      found.push({ code, index: m.index });
      taken.push([m.index, m.index + 3]);
    }
  }
  for (const f of findWorld(text, taken)) if (!found.some((x) => x.code === f.code)) found.push(f);
  return found.sort((a, b) => a.index - b.index).map((f) => f.code);
}

// Resolve one typed name (setup, follow-up answers, AI output).
export function resolvePlace(text) {
  if (!text) return null;
  const t = String(text).trim();
  if (/^[A-Za-z]{3}$/.test(t) && placeByCode(t)) return placeByCode(t);
  const exact = WORLD_BY_NAME.get(t.toLowerCase());
  const codes = findPlaces(t);
  if (codes.length) return placeByCode(codes[0]);
  if (exact) return worldPlace(exact);
  // last try: a spelling mistake in a world city name ("tashkant")
  if (t.length >= 5 && t.length <= 30) {
    const f = fuzzyMatch(t, [...PLACE_NAMES, ...WORLD_NAMES]);
    if (f) return { ...placeByCode(f.value), guessed: f.g };
  }
  return null;
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

// ---------- typo tolerance ----------
// "bangkock" → Bangkok, "kualalampur" → Kuala Lumpur. Only for words of 5+ letters,
// allowing 1 mistake (5–7 letters) or 2 mistakes (8+ letters).
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const STOP = new Set(['trip', 'family', 'friends', 'flight', 'flights', 'ticket', 'tickets', 'travel', 'going', 'budget', 'cheap',
  'cheapest', 'holiday', 'holidays', 'summer', 'winter', 'december', 'january', 'february', 'march', 'april', 'august',
  'september', 'october', 'november', 'people', 'children', 'adults', 'return', 'direct', 'business', 'honeymoon', 'please',
  'weekend', 'nights', 'month', 'during', 'around', 'under', 'maximum', 'between', 'there', 'where', 'somewhere', 'anywhere']);

// candidates: [[name, value]]; returns best value or null
export function fuzzyMatch(text, candidates) {
  const words = String(text).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  const grams = [];
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].length >= 5 && !STOP.has(words[i])) grams.push(words[i]);
    if (i + 1 < words.length && !STOP.has(words[i]) && !STOP.has(words[i + 1])) {
      grams.push(`${words[i]} ${words[i + 1]}`, `${words[i]}${words[i + 1]}`);
    }
  }
  let best = null;
  for (const g of grams) {
    for (const [name, value] of candidates) {
      const n = name.toLowerCase();
      if (n.length < 5 || Math.abs(n.length - g.length) > 2) continue;
      const max = n.length >= 8 ? 2 : 1;
      const d = Math.min(editDistance(g, n, max), editDistance(g, n.replace(/\s+/g, ''), max));
      if (d <= max && (!best || d < best.d)) best = { d, value, g };
    }
  }
  return best;
}

export const PLACE_NAMES = ALIASES.map(([n, code]) => [n, code]);

export const WORLD_NAMES = [...WORLD_BY_NAME.entries()].map(([n, r]) => [n, r[0]]);
export const WORLD_COUNTRIES = [...new Set(WORLD.map((r) => r[2]))];
