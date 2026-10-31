// Country names people type ("Thailand", "from Bangladesh") and passport names
// ("Bangladeshi", "British"). Destination countries map to the cities we cover.

import { PLACES, worldCitiesIn, WORLD_COUNTRIES } from './places.js';
import { COUNTRY_EN } from './country-names.js';

// Destination countries: name + extra spellings. Cities come from PLACES.
const DEST_NAMES = {
  BD: ['Bangladesh'], IN: ['India'], NP: ['Nepal'], BT: ['Bhutan'], LK: ['Sri Lanka', 'srilanka'], MV: ['Maldives'],
  PK: ['Pakistan'], TH: ['Thailand'], MY: ['Malaysia'], SG: ['Singapore'], ID: ['Indonesia'], PH: ['Philippines'],
  VN: ['Vietnam', 'viet nam'], KH: ['Cambodia'], MM: ['Myanmar', 'burma'], JP: ['Japan'], KR: ['South Korea', 'korea'],
  CN: ['China', 'mainland china'], HK: ['Hong Kong'], MO: ['Macau', 'macao'], TW: ['Taiwan'], AE: ['UAE', 'United Arab Emirates', 'emirates'],
  QA: ['Qatar'], SA: ['Saudi Arabia', 'saudi', 'ksa'], OM: ['Oman'], TR: ['Turkey', 'türkiye', 'turkiye'],
  GB: ['United Kingdom', 'UK', 'britain', 'great britain', 'england', 'scotland'], IE: ['Ireland'], FR: ['France'],
  NL: ['Netherlands', 'holland'], BE: ['Belgium'], DE: ['Germany'], CH: ['Switzerland'], AT: ['Austria'],
  CZ: ['Czechia', 'czech republic'], HU: ['Hungary'], PL: ['Poland'], IT: ['Italy'], ES: ['Spain'], PT: ['Portugal'],
  GR: ['Greece'], DK: ['Denmark'], SE: ['Sweden'], NO: ['Norway'], US: ['United States', 'USA', 'US', 'america', 'united states of america'],
  MX: ['Mexico'], CA: ['Canada'], AU: ['Australia'], NZ: ['New Zealand'],
};

// Main city first: used when someone says only the country for where they fly FROM.
const MAIN_CITY = { UZ: 'TAS', KG: 'BSZ', TM: 'ASB', KZ: 'ALA', TJ: 'DYU', GE: 'TBS', AM: 'EVN', AZ: 'GYD', EG: 'CAI', MA: 'RAK',
  KE: 'NBO', TZ: 'DAR', ZA: 'CPT', MU: 'MRU', SC: 'SEZ', JO: 'AMM', LB: 'BEY', BH: 'BAH', KW: 'KWI', IR: 'IKA', AF: 'KBL', MN: 'ULN',
  BR: 'GRU', AR: 'EZE', PE: 'LIM', CO: 'BOG', CL: 'SCL', IS: 'KEF', FI: 'HEL', RU: 'SVO', UA: 'KBP', RO: 'OTP', BG: 'SOF', HR: 'ZAG', RS: 'BEG',
  GB: 'LON', US: 'NYC', IN: 'DEL', CN: 'BJS', JP: 'TYO', AU: 'SYD', CA: 'YTO', TH: 'BKK', MY: 'KUL', DE: 'BER', IT: 'ROM', ES: 'MAD', FR: 'PAR', VN: 'SGN', ID: 'JKT', PH: 'MNL', KR: 'SEL', AE: 'DXB', SA: 'RUH', BD: 'DAC', PK: 'KHI', NZ: 'AKL', CH: 'ZRH', KH: 'PNH' };

export const SCHENGEN = ['AT', 'BE', 'CH', 'CZ', 'DE', 'DK', 'ES', 'FR', 'GR', 'HU', 'IT', 'NL', 'NO', 'PL', 'PT', 'SE'];

export function citiesIn(cc) {
  const curated = PLACES.filter((p) => p.cc === cc).map((p) => p.code);
  if (curated.length) return curated;
  const w = worldCitiesIn(cc);
  const main = MAIN_CITY[cc];
  return main ? [main, ...w.filter((c) => c !== main)].slice(0, 8) : w;
}

export function mainCity(cc) {
  return MAIN_CITY[cc] || citiesIn(cc)[0] || null;
}

export function countryName(cc) {
  return DEST_NAMES[cc]?.[0] || regionName(cc) || cc;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Every other country, by its English name (Uzbekistan, Kyrgyzstan, Georgia, Egypt…)
const ALL_NAMES = { ...DEST_NAMES };
for (const cc of WORLD_COUNTRIES) {
  if (ALL_NAMES[cc]) continue;
  const n = COUNTRY_EN[cc]; // precomputed: no Intl work at start-up
  if (n && n !== cc && !/[()]/.test(n)) ALL_NAMES[cc] = [n];
}
Object.assign(ALL_NAMES, { CZ: [...ALL_NAMES.CZ], KG: ['Kyrgyzstan', 'Kyrgyz Republic', 'Kirghizia'], CI: ['Ivory Coast', "Côte d'Ivoire"], MM: ALL_NAMES.MM });

const COUNTRY_RES = Object.entries(ALL_NAMES)
  .flatMap(([cc, names]) => names.map((n) => [n, cc]))
  .sort((a, b) => b[0].length - a[0].length)
  .map(([n, cc]) => [new RegExp(`(^|[^a-z])${escapeRe(n.toLowerCase())}(?=$|[^a-z])`, 'i'), cc, n]);

// Countries mentioned in a text, in order. 2-letter forms (UK, US) must be capitals.
export function findCountries(text) {
  const out = [];
  const taken = [];
  for (const [re, cc, name] of COUNTRY_RES) {
    const m = re.exec(text);
    if (!m) continue;
    const start = m.index + m[1].length;
    const end = start + name.length;
    if (taken.some(([s, e]) => start < e && end > s)) continue;
    if (name.length <= 3 && name === name.toUpperCase() && text.slice(start, end) !== name) continue;
    taken.push([start, end]);
    if (!out.some((o) => o.cc === cc)) out.push({ cc, index: start, end });
  }
  return out.sort((a, b) => a.index - b.index);
}

// ---------- passports ----------
var displayNames = null; // var: used while this file is still loading
export function regionName(cc) {
  if (COUNTRY_EN[cc]) return COUNTRY_EN[cc];
  try {
    displayNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return displayNames.of(cc);
  } catch {
    return null;
  }
}

const DEMONYMS = {
  BD: ['bangladeshi', 'bangladesh'], IN: ['indian'], PK: ['pakistani'], NP: ['nepali', 'nepalese'], LK: ['sri lankan'],
  GB: ['british', 'uk', 'english', 'scottish', 'welsh'], US: ['american', 'usa', 'us'], CA: ['canadian'], AU: ['australian'],
  NZ: ['new zealander', 'kiwi'], IE: ['irish'], AE: ['emirati'], SA: ['saudi'], MY: ['malaysian'], SG: ['singaporean'],
  TH: ['thai'], ID: ['indonesian'], PH: ['filipino', 'philippine'], VN: ['vietnamese'], CN: ['chinese'], JP: ['japanese'],
  KR: ['korean', 'south korean'], DE: ['german'], FR: ['french'], IT: ['italian'], ES: ['spanish'], NL: ['dutch'],
  TR: ['turkish'], MM: ['burmese', 'myanmar'], MV: ['maldivian'], QA: ['qatari'], OM: ['omani'], PT: ['portuguese'],
  SE: ['swedish'], NO: ['norwegian'], DK: ['danish'], PL: ['polish'], GR: ['greek'], MX: ['mexican'], BR: ['brazilian'],
  NG: ['nigerian'], EG: ['egyptian'], ZA: ['south african'], KE: ['kenyan'], AF: ['afghan'], IR: ['iranian'],
};

// Resolve typed passport/nationality text to an ISO country code.
export function resolveCountry(text, knownCodes = []) {
  const t = String(text || '').trim().toLowerCase().replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/^[a-z]{2}$/.test(t) && knownCodes.includes(t.toUpperCase())) return t.toUpperCase();
  for (const [cc, words] of Object.entries(DEMONYMS)) if (words.includes(t)) return cc;
  for (const [cc, names] of Object.entries(DEST_NAMES)) if (names.some((n) => n.toLowerCase() === t)) return cc;
  for (const cc of knownCodes) {
    const n = regionName(cc);
    if (n && n.toLowerCase() === t) return cc;
  }
  for (const cc of knownCodes) {
    const n = regionName(cc);
    if (n && t.length >= 4 && n.toLowerCase().startsWith(t)) return cc;
  }
  return null;
}

export const flag = (cc) => (/^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');

export const COUNTRY_NAMES = Object.entries(ALL_NAMES).flatMap(([cc, names]) => names.filter((n) => n.length >= 5).map((n) => [n, cc]));
