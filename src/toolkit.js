// Revenue helpers: the "Trip toolkit" (hotels, eSIM, tours, transfers, insurance)
// and the travel-gear page (Amazon Associates).
//
// Toolkit links go through the Travelpayouts partner-links API. It only creates a
// link for programs you have joined, so the toolkit shows exactly what you've
// joined — join a new program in Travelpayouts and it appears here by itself.

import { partnerLink } from './tp.js';
import { placeByCode } from './places.js';
import { countryName } from './countries.js';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Each item: when it is relevant, the brand URL to convert, and the button text.
function items(ctx) {
  const { dest, checkin, checkout, adults = 1, children = 0, international, lateArrival, family } = ctx;
  const city = dest.name.replace(/ \(.*\)$/, '');
  const rooms = Math.max(1, Math.ceil((adults + children) / 3));
  const out = [];
  if (checkin && checkout) {
    out.push({ key: 'hotel', text: `🏨 Hotels in ${city} for your dates`, url: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(city)}&checkin=${checkin}&checkout=${checkout}&group_adults=${adults}&group_children=${children}&no_rooms=${rooms}` });
  } else {
    out.push({ key: 'hotel', text: `🏨 Hotels in ${city}`, url: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(city)}` });
  }
  if (international) {
    out.push({ key: 'esim', text: '📶 Travel eSIM: data the moment you land', url: 'https://yesim.app/' });
    out.push({ key: 'esim2', text: `📶 eSIM for ${countryName(dest.cc)} (Airalo)`, url: `https://www.airalo.com/${slug(countryName(dest.cc))}-esim` });
    out.push({ key: 'insurance', text: '🛡️ Travel insurance', url: 'https://ektatraveling.com/' });
  }
  out.push({ key: 'tours', text: `🎟️ Tours & tickets in ${city}`, url: `https://www.klook.com/en-US/search/result/?query=${encodeURIComponent(city)}` });
  out.push({ key: 'tours2', text: `🎟️ Things to do in ${city} (GetYourGuide)`, url: `https://www.getyourguide.com/s/?q=${encodeURIComponent(city)}` });
  out.push({ key: 'transfer', text: `🚕 Airport transfer in ${city}${lateArrival ? ' (you land late)' : ''}`, url: 'https://kiwitaxi.com/' });
  // most useful first for this trip
  const weight = { hotel: 1, transfer: lateArrival || family ? 2 : 6, esim: 3, esim2: 4, insurance: family ? 3 : 5, tours: 5, tours2: 7 };
  return out.sort((a, b) => (weight[a.key] ?? 9) - (weight[b.key] ?? 9));
}

// Returns [{ text, href }] for programs you've joined (max `limit`).
export async function toolkit(env, ctx, limit = 6) {
  if (!env.TP_TRS || !ctx.dest) return [];
  const found = [];
  const seenKind = new Set();
  for (const it of items(ctx)) {
    if (found.length >= limit) break;
    const kind = it.key.replace(/\d$/, '');
    if (seenKind.has(kind)) continue; // one eSIM, one tours brand…
    const href = await partnerLink(env, it.url);
    if (href) { found.push({ text: it.text, href }); seenKind.add(kind); }
  }
  return found;
}

export function toolkitContext(draft, best, origin) {
  const dest = placeByCode(draft.destination);
  return {
    dest,
    checkin: best?.departure_at?.slice(0, 10) || (draft.depart?.type === 'date' ? draft.depart.value : null),
    checkout: best?.return_at?.slice(0, 10) || (draft.ret?.value || null),
    adults: draft.adults || 1,
    children: draft.children || 0,
    international: !!dest && dest.cc !== placeByCode(origin || draft.origin)?.cc,
    family: draft.persona === 'family',
    lateArrival: false,
  };
}

// ---------- travel gear (Amazon Associates) ----------
// Amazon links never go in emails (Amazon's rules forbid it) and never straight into
// Telegram: Maya shows 1–2 product names tailored to the trip, and the button opens
// your own page (/gear), which holds the Amazon links and the required disclosure.

const STORES = {
  com: { host: 'www.amazon.com', tag: 'AMAZON_TAG_COM', label: 'Amazon.com' },
  uk: { host: 'www.amazon.co.uk', tag: 'AMAZON_TAG_UK', label: 'Amazon.co.uk' },
  in: { host: 'www.amazon.in', tag: 'AMAZON_TAG_IN', label: 'Amazon.in' },
  ca: { host: 'www.amazon.ca', tag: 'AMAZON_TAG_CA', label: 'Amazon.ca' },
  au: { host: 'www.amazon.com.au', tag: 'AMAZON_TAG_AU', label: 'Amazon.com.au' },
  ae: { host: 'www.amazon.ae', tag: 'AMAZON_TAG_AE', label: 'Amazon.ae' },
  sg: { host: 'www.amazon.sg', tag: 'AMAZON_TAG_SG', label: 'Amazon.sg' },
  de: { host: 'www.amazon.de', tag: 'AMAZON_TAG_DE', label: 'Amazon.de' },
};
const STORE_FOR_COUNTRY = { GB: 'uk', IE: 'uk', IN: 'in', CA: 'ca', AU: 'au', NZ: 'au', AE: 'ae', SA: 'ae', QA: 'ae', OM: 'ae', SG: 'sg', MY: 'sg', DE: 'de', AT: 'de' };

export function storeFor(env, countryCc) {
  const want = STORE_FOR_COUNTRY[countryCc] || 'com';
  if (env[STORES[want].tag]) return want;
  return env.AMAZON_TAG_COM ? 'com' : null;
}

// Plug types by country (IEC letters). Unknown countries: no adapter advice.
const EU_CF = ['C', 'F'];
export const PLUGS = {
  BD: ['C', 'D', 'G'], IN: ['C', 'D', 'M'], PK: ['C', 'D'], NP: ['C', 'D', 'M'], LK: ['D', 'G', 'M'], MV: ['C', 'D', 'G', 'J', 'K', 'L'], BT: ['C', 'D', 'G'],
  TH: ['A', 'B', 'C', 'O'], MY: ['G'], SG: ['G'], ID: EU_CF, PH: ['A', 'B', 'C'], VN: ['A', 'C', 'F'], KH: ['A', 'C', 'G'], LA: ['A', 'B', 'C', 'E', 'F'], MM: ['C', 'D', 'F', 'G'],
  JP: ['A', 'B'], KR: EU_CF, CN: ['A', 'C', 'I'], HK: ['G'], MO: ['G'], TW: ['A', 'B'],
  AE: ['G'], QA: ['G'], SA: ['G'], OM: ['G'], KW: ['G'], BH: ['G'], JO: ['B', 'C', 'D', 'F', 'G', 'J'], TR: EU_CF, EG: EU_CF, MA: ['C', 'E'],
  GB: ['G'], IE: ['G'], MT: ['G'], CY: ['G'], FR: ['C', 'E'], BE: ['C', 'E'], CZ: ['C', 'E'], PL: ['C', 'E'], DK: ['C', 'E', 'F', 'K'], CH: ['C', 'J'], IT: ['C', 'F', 'L'],
  DE: EU_CF, NL: EU_CF, AT: EU_CF, ES: EU_CF, PT: EU_CF, GR: EU_CF, SE: EU_CF, NO: EU_CF, FI: EU_CF, HU: EU_CF, RU: EU_CF, UA: EU_CF, RO: EU_CF, HR: EU_CF,
  UZ: EU_CF, KG: EU_CF, KZ: EU_CF, TJ: EU_CF, TM: ['B', 'C', 'F'], GE: EU_CF, AM: EU_CF, AZ: EU_CF,
  US: ['A', 'B'], CA: ['A', 'B'], MX: ['A', 'B'], BR: ['C', 'N'], AR: ['C', 'I'], AU: ['I'], NZ: ['I'], FJ: ['I'], ZA: ['C', 'M', 'N'], KE: ['G'], TZ: ['D', 'G'], MU: ['C', 'G'],
};

export function plugAdvice(homeCc, destCc) {
  const h = PLUGS[homeCc];
  const d = PLUGS[destCc];
  if (!h || !d) return null;
  const shared = h.filter((x) => d.includes(x));
  if (shared.length === h.length) return null; // all your plugs fit
  return { need: !shared.length, types: d, shared };
}

// Catalogue: key → [product name, Amazon search words, why (generic)]
export const GEAR = {
  adapter: ['Universal travel adapter', 'universal travel adapter usb c', 'One plug for 150+ countries'],
  sunscreen: ['Reef-safe sunscreen SPF 50', 'reef safe sunscreen spf 50 travel size', 'Strong sun where you\'re going'],
  waterpouch: ['Waterproof phone pouch', 'waterproof phone pouch', 'Beaches, boats and sudden rain'],
  umbrella: ['Compact travel umbrella', 'compact windproof travel umbrella', 'It\'s the rainy season there'],
  thermal: ['Thermal base layers', 'thermal base layer set', 'Cold where you\'re going: layers pack small'],
  pillow: ['Memory-foam neck pillow', 'memory foam travel neck pillow', 'For a long flight'],
  cubes: ['Packing cubes', 'packing cubes set', 'Keeps everyone\'s bags organised'],
  kids: ['Kids\' travel activity kit', 'kids travel activity kit airplane', 'Calmer flights with children'],
  powerbank: ['Power bank (cabin-safe)', 'power bank 20000mAh airline approved', 'Phone charged for maps and tickets; under 100 Wh is allowed in cabin bags'],
  antitheft: ['Anti-theft daypack', 'anti theft travel backpack', 'Busy markets and night buses'],
  lock: ['TSA-approved padlock', 'tsa approved luggage lock', 'Hostel lockers and checked bags'],
  scale: ['Digital luggage scale', 'digital luggage scale', 'Avoid overweight-bag fees on budget airlines'],
  bottle: ['Collapsible water bottle', 'collapsible travel water bottle', 'Refill after security'],
  toiletry: ['Travel toiletry bottles', 'travel size toiletry bottles leak proof', 'Liquids under 100 ml for cabin bags'],
};

// Pick the 2 most useful items for this trip.
export function gearPicks({ homeCc, destCc, weather, persona, children = 0, tags = [], longFlight = false, multi = false }) {
  const score = {};
  const add = (k, n) => { score[k] = (score[k] || 0) + n; };
  const plug = plugAdvice(homeCc, destCc);
  if (plug) add('adapter', plug.need ? 10 : 5);
  if (weather) {
    if (weather.avg >= 26 || tags.includes('beach')) add('sunscreen', 6);
    if (weather.rain >= 6) add('umbrella', 6);
    if (weather.avg <= 8) add('thermal', 8);
  }
  if (tags.includes('beach')) add('waterpouch', 5);
  if (longFlight) add('pillow', 5);
  if (persona === 'family') { add('cubes', 4); if (children) add('kids', 6); }
  if (persona === 'backpacker') { add('antitheft', 4); add('lock', 4); add('cubes', 2); }
  if (persona === 'friends') { add('powerbank', 3); add('scale', 2); }
  if (multi) { add('cubes', 3); add('powerbank', 2); }
  add('powerbank', 1);
  add('bottle', 0.5);
  const keys = Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
  return keys.map((k) => ({ key: k, name: GEAR[k][0], why: k === 'adapter' && plug ? `${plug.need ? 'Your plugs won\'t fit there' : 'Some of your plugs won\'t fit there'} (they use type ${plug.types.join(', ')})` : GEAR[k][2] }));
}

export function gearUrl(base, { homeCc, destCc, destName, keys }) {
  return `${base}/gear?c=${encodeURIComponent(homeCc || 'US')}&dc=${encodeURIComponent(destCc || '')}&d=${encodeURIComponent(destName || '')}&i=${keys.join(',')}`;
}

export function gearPage(env, store, destName, opts = {}) {
  const st = STORES[store];
  const tag = env[st.tag];
  const safe = (x) => String(x || '').replace(/[<>&"]/g, '');
  const link = (q) => `https://${st.host}/s?k=${encodeURIComponent(q)}&tag=${encodeURIComponent(tag)}`;
  const picked = (opts.keys || []).filter((k) => GEAR[k]);
  const plug = opts.homeCc && opts.destCc ? plugAdvice(opts.homeCc, opts.destCc) : null;
  const why = (k) => (k === 'adapter' && plug ? `${plug.need ? 'Your plugs won\'t fit' : 'Some of your plugs won\'t fit'}: ${safe(destName)} uses type ${plug.types.join(', ')}` : GEAR[k][2]);
  const item = (k) => `<li><a href="${link(GEAR[k][1])}" rel="sponsored noopener" target="_blank">${GEAR[k][0]}</a><br><small>${why(k)}</small></li>`;
  const top = picked.length ? `<h2>For your trip${destName ? ` to ${safe(destName)}` : ''}</h2><ul>${picked.map(item).join('')}</ul>` : '';
  const rest = Object.keys(GEAR).filter((k) => !picked.includes(k)).map(item).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Travel essentials · CityWide Trip</title>
<style>:root{--bg:#f6f7f9;--card:#fff;--ink:#1d2733;--muted:#5f6b78;--link:#0b6bcb;--hi:#eef6ff}
@media (prefers-color-scheme:dark){:root{--bg:#12161b;--card:#1b2128;--ink:#e8edf2;--muted:#9aa6b2;--link:#6cb4ff;--hi:#1f2a36}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}main{max-width:560px;margin:0 auto;padding:24px 16px}
.card{background:var(--card);border-radius:12px;padding:20px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:16px 0 4px;background:var(--hi);padding:8px 10px;border-radius:8px}
ul{padding-left:18px}li{margin:12px 0}a{color:var(--link);font-weight:600}small{color:var(--muted)}.note{color:var(--muted);font-size:13px;margin-top:16px}</style></head>
<body><main><div class="card"><h1>Travel essentials</h1><p style="margin:0;color:var(--muted)">Picked by Maya from CityWide Trip · ${st.label}</p>
${top}<h2>Also handy</h2><ul>${rest}</ul>
<p class="note">As an Amazon Associate, CityWide Trip earns from qualifying purchases. Prices and availability are shown on Amazon.</p>
</div></main></body></html>`;
}
