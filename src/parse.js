// Turns one plain sentence into a trip draft using simple rules.
// The AI is used only when these rules can't find the destination (see ai.js).

import { findPlaces, resolvePlace, placeByCode, fuzzyMatch, PLACE_NAMES } from './places.js';
import { findCountries, citiesIn, mainCity, COUNTRY_NAMES } from './countries.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

const pad = (n) => String(n).padStart(2, '0');
const monthIndex = (word) => MONTHS.indexOf(word.slice(0, 3).toLowerCase());
const num = (s) => (s in WORDNUM ? WORDNUM[s] : Number(s));

// Next occurrence of a month (this year if not yet over, otherwise next year).
function monthValue(m, now) {
  const y = now.getUTCFullYear();
  const year = m < now.getUTCMonth() ? y + 1 : y;
  return `${year}-${pad(m + 1)}`;
}

function dateValue(day, m, now, yearHint) {
  let year = yearHint || now.getUTCFullYear();
  let d = new Date(Date.UTC(year, m, day));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!yearHint && d < today) d = new Date(Date.UTC(year + 1, m, day));
  if (d.getUTCMonth() !== m) return null; // e.g. 31 Feb
  return d.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function parseDates(t, now) {
  const out = {};
  let m;
  // ISO dates: 2026-12-15 (one or two)
  const iso = [...t.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)].map((x) => `${x[1]}-${x[2]}-${x[3]}`);
  if (iso.length) {
    out.depart = { type: 'date', value: iso[0] };
    if (iso[1]) out.ret = { type: 'date', value: iso[1] };
    return out;
  }
  // "15-22 dec", "15 to 22 december"
  if ((m = t.match(new RegExp(`\\b(\\d{1,2})\\s*(?:-|–|to|till|until)\\s*(\\d{1,2})\\s*${MONTH_RE}\\b`, 'i')))) {
    const mi = monthIndex(m[3]);
    const a = dateValue(+m[1], mi, now);
    const b = dateValue(+m[2], mi, now, a ? +a.slice(0, 4) : undefined);
    if (a) out.depart = { type: 'date', value: a };
    if (b && b > a) out.ret = { type: 'date', value: b };
    return out;
  }
  // "dec 15 - jan 3" / "15 dec to 3 jan"
  const dm = [...t.matchAll(new RegExp(`\\b(?:(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH_RE}|${MONTH_RE}\\s*(\\d{1,2})(?:st|nd|rd|th)?)\\b`, 'gi'))];
  if (dm.length) {
    const vals = dm.map((x) => {
      const day = +(x[1] || x[4]);
      const mon = monthIndex(x[2] || x[3]);
      return dateValue(day, mon, now);
    }).filter(Boolean);
    if (vals.length) {
      out.depart = { type: 'date', value: vals[0] };
      if (vals[1]) {
        let r = vals[1];
        if (r < vals[0]) r = `${+r.slice(0, 4) + 1}${r.slice(4)}`;
        out.ret = { type: 'date', value: r };
      }
      return out;
    }
  }
  // "15/12", "15.12" (day/month, as used in South Asia, UK, AU)
  const sl = [...t.matchAll(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](20\d\d|\d\d))?\b/g)];
  if (sl.length) {
    const vals = sl.map((x) => {
      const y = x[3] ? (x[3].length === 2 ? 2000 + +x[3] : +x[3]) : undefined;
      return dateValue(+x[1], +x[2] - 1, now, y);
    }).filter(Boolean);
    if (vals.length) {
      out.depart = { type: 'date', value: vals[0] };
      if (vals[1] && vals[1] > vals[0]) out.ret = { type: 'date', value: vals[1] };
      return out;
    }
  }
  // "2nd week of January", "first week of may", "last week of dec"
  if ((m = t.match(new RegExp(`\\b(1st|2nd|3rd|4th|first|second|third|fourth|last)\\s+week\\s+(?:of\\s+)?${MONTH_RE}\\b`, 'i')))) {
    const which = { '1st': 1, first: 1, '2nd': 2, second: 2, '3rd': 3, third: 3, '4th': 4, fourth: 4, last: 4 }[m[1].toLowerCase()];
    const mi = monthIndex(m[2]);
    const startDay = which === 4 && /last/i.test(m[1]) ? 22 : (which - 1) * 7 + 1;
    const mid = dateValue(startDay + 3, mi, now);
    if (mid) { out.depart = { type: 'date', value: mid }; out.weekFlex = true; return out; }
  }
  // Month names: "in December", "december or january"
  const mons = [...t.matchAll(new RegExp(`\\b${MONTH_RE}\\b`, 'gi'))].map((x) => monthIndex(x[1]));
  // "may" is also a verb: only count it next to in/during/early/late/mid or another month
  const months = mons.filter((mi, i) => mi !== 4 || /\b(in|during|early|late|mid|this|next)\s+may\b/i.test(t) || mons.length > 1);
  if (months.length) {
    out.depart = { type: 'month', value: monthValue(months[0], now) };
    return out;
  }
  // Seasons and relative words
  if (/\bnext month\b/i.test(t)) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    out.depart = { type: 'month', value: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}` };
  } else if (/\bthis month\b/i.test(t)) {
    out.depart = { type: 'month', value: `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}` };
  } else if (/\b(christmas|xmas)\b/i.test(t)) {
    out.depart = { type: 'date', value: dateValue(20, 11, now) };
    out.ret = { type: 'date', value: addDays(out.depart.value, 10) };
  } else if (/\bnew year\b/i.test(t)) {
    out.depart = { type: 'date', value: dateValue(28, 11, now) };
    out.ret = { type: 'date', value: addDays(out.depart.value, 7) };
  } else if (/\bspring break\b/i.test(t)) {
    out.depart = { type: 'month', value: monthValue(2, now) };
  } else if (/\bsummer\b/i.test(t)) {
    out.depart = { type: 'month', value: monthValue(5, now) };
    out.seasonNote = 'Summer: I searched June first. Tap "Cheaper dates" or "Track" to watch June–August.';
  } else if (/\bwinter\b/i.test(t)) {
    out.depart = { type: 'month', value: monthValue(11, now) };
  }
  return out;
}

function parseTravellers(t) {
  const r = {};
  let m;
  const N = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
  if ((m = t.match(new RegExp(`\\b${N}\\s*(?:adults?|grown[- ]?ups?)`, 'i')))) r.adults = num(m[1].toLowerCase());
  if ((m = t.match(new RegExp(`\\b${N}\\s*(?:kids?|children|child|babies|baby|infants?|toddlers?)`, 'i')))) r.children = num(m[1].toLowerCase());
  else if (/\b(a|one|our)\s+(kid|child|baby|son|daughter|toddler)\b/i.test(t)) r.children = 1;
  if ((m = t.match(new RegExp(`\\bfamily of\\s*${N}`, 'i')))) {
    const total = num(m[1].toLowerCase());
    if (!r.adults && !r.children) { r.adults = Math.min(2, total); r.children = Math.max(0, total - 2); }
  }
  if ((m = t.match(new RegExp(`\\b(?:me|i|myself)\\s*(?:and|&|\\+|with)\\s*${N}\\s*(?:friends?|buddies|mates|colleagues|others|people|girls|guys)`, 'i')))) {
    r.adults = num(m[1].toLowerCase()) + 1;
  } else if ((m = t.match(new RegExp(`\\b(?:group of|we are|we're|total|party of)\\s*${N}\\b`, 'i')))) {
    r.adults = Math.max(1, num(m[1].toLowerCase()) - (r.children || 0));
  } else if (!r.adults && (m = t.match(new RegExp(`\\b${N}\\s*(?:of us|people|persons|pax|travell?ers)\\b`, 'i')))) {
    // a total head count: children (if mentioned) are part of it
    const total = num(m[1].toLowerCase());
    r.adults = Math.max(1, total - (r.children || 0));
  } else if (!r.adults && (m = t.match(new RegExp(`\\b${N}\\s*(?:[a-z]+\\s+)?(?:friends|girls|guys|ladies|women|men|colleagues|students)\\b`, 'i')))) {
    r.adults = num(m[1].toLowerCase());
  }
  if (!r.adults && /\b(couple|honeymoon|my (wife|husband|partner|girlfriend|boyfriend)|with (wife|husband|partner))\b/i.test(t)) r.adults = 2;
  if (!r.adults && /\b(solo|alone|just me|myself)\b/i.test(t)) r.adults = 1;
  if (r.children && !r.adults) r.adults = 2;
  if (r.adults) r.adults = Math.min(Math.max(r.adults, 1), 9);
  if (r.children) r.children = Math.min(r.children, 8);
  return r;
}

export function detectPersona(t) {
  if (/\b(backpack\w*)\b/i.test(t)) return 'backpacker';
  if (/\b(kids?|children|child|baby|toddler|infant|family|son|daughter|parents)\b/i.test(t)) return 'family';
  if (/\b(girls|ladies|women|female|sisters|girlfriends|hen)\b/i.test(t)) return 'women';
  if (/\b(business|work trip|conference|meeting|corporate|client|office)\b/i.test(t)) return 'corporate';
  if (/\b(honeymoon|couple|wife|husband|partner|anniversary|romantic)\b/i.test(t)) return 'couple';
  if (/\b(friends|buddies|mates|guys|squad|gang|group)\b/i.test(t)) return 'friends';
  if (/\b(backpack\w*|solo|student|cheapest|budget trip|shoestring)\b/i.test(t)) return 'backpacker';
  return null;
}

function parseBudget(t, defaultCurrency) {
  const cur = (s) => {
    if (!s) return null;
    const x = s.toLowerCase();
    if (x === '$' || x === 'usd' || x === 'dollars' || x === 'dollar') return 'usd';
    if (x === '£' || x === 'gbp' || x === 'pounds') return 'gbp';
    if (x === '€' || x === 'eur' || x === 'euros') return 'eur';
    if (x === '৳' || x === 'bdt' || x === 'tk' || x === 'taka') return 'bdt';
    if (x === '₹' || x === 'inr' || x === 'rs' || x === 'rupees') return 'inr';
    return x.length === 3 ? x : null;
  };
  const CUR = '(\\$|£|€|৳|₹|usd|gbp|eur|bdt|inr|aud|cad|nzd|aed|sgd|myr|tk|taka|rs|dollars?|pounds|euros|rupees)';
  const AMT = '(\\d[\\d,]*(?:\\.\\d+)?)\\s*(k|lakh|lac|lakhs)?';
  const re = new RegExp(`\\b(?:max(?:imum)?|under|below|budget(?: of| is)?|upto|up to|within|less than|around|about)?\\s*${CUR}?\\s*${AMT}\\s*${CUR}?\\s*(each|per person|per head|pp|a head|total|in total|for all)?`, 'gi');
  for (const m of t.matchAll(re)) {
    const lead = m[0].trim().toLowerCase();
    const hasKeyword = /^(max|under|below|budget|upto|up to|within|less than|around|about)/.test(lead);
    const c = cur(m[1]) || cur(m[4]);
    if (!hasKeyword && !c) continue; // a bare number is probably a date or a group size
    let amount = Number(m[2].replace(/,/g, ''));
    if (m[3]) amount *= /^k$/i.test(m[3]) ? 1000 : 100000;
    if (!amount || amount < 20) continue;
    const per = m[5] ? !/total|for all/i.test(m[5]) : /\b(each|per person|pp|per head)\b/i.test(t);
    return { amount, perPerson: per, currency: c || defaultCurrency };
  }
  return null;
}

export function parseTrip(text, { now = new Date(), home = null, currency = 'usd' } = {}) {
  const t = ` ${String(text || '').slice(0, 400)} `;
  const draft = {};

  // Origin and destination: "from X to Y", "X to Y", a single place = destination.
  // A country instead of a city: one city → use it; several → ask which (destCountry).
  const codes = findPlaces(t);
  const countries = findCountries(t);
  const toMatch = t.match(/\bto\s+([A-Za-z][\w' .-]{1,30})/i);
  const fromMatch = t.match(/\bfrom\s+([A-Za-z][\w' .-]{1,30})/i);
  const homeCc = placeByCode(home)?.cc;
  const fromSeg = fromMatch ? fromMatch[1].split(/\bto\b|,|\bin\b|\bfor\b/i)[0] : '';
  const toSeg = toMatch ? toMatch[1].split(/,|\bin\b|\bfor\b|\bfrom\b|\bon\b|\bwith\b|\band\b/i)[0] : '';
  let origin = fromSeg ? resolvePlace(fromSeg)?.code || null : null;
  const dp = toSeg ? resolvePlace(toSeg) : null;
  let destination = dp?.code || null;
  if (dp?.guessed) draft.guessed = dp.guessed;
  let destCountry = null;
  if (fromSeg && !origin) {
    const c = findCountries(` ${fromSeg} `)[0];
    if (c) origin = c.cc === homeCc ? home : mainCity(c.cc);
  }
  if (toSeg && !destination) {
    const c = findCountries(` ${toSeg} `)[0];
    if (c) { const cs = citiesIn(c.cc); if (cs.length === 1) destination = cs[0]; else destCountry = c.cc; }
  }
  // "Cairo and Istanbul" is a list of stops (from home); "Dhaka Bangkok" / "DAC BKK" is from → to.
  const listy = !toMatch && !fromMatch && /\band\b|,|&|\+/.test(t);
  if (!origin && !destination && !destCountry && codes.length >= 2 && !listy) { origin = codes[0]; destination = codes[1]; }
  if (!destination && !destCountry) destination = codes.find((c) => c !== origin) || null;
  if (!destination && !destCountry) {
    const oc = placeByCode(origin)?.cc;
    const c = countries.find((x) => x.cc !== oc && x.cc !== (origin ? null : homeCc)) || countries.find((x) => x.cc !== oc);
    if (c) { const cs = citiesIn(c.cc); if (cs.length === 1) destination = cs[0]; else destCountry = c.cc; }
  }
  // Nothing recognised: forgive spelling mistakes ("bangkock", "thailnd").
  if (!destination && !destCountry) {
    const seg = toSeg || t;
    const fp = fuzzyMatch(seg, PLACE_NAMES.filter(([, c]) => c !== origin));
    const fc = fuzzyMatch(seg, COUNTRY_NAMES.filter(([, cc]) => cc !== placeByCode(origin)?.cc));
    if (fp && (!fc || fp.d <= fc.d)) { destination = fp.value; draft.guessed = fp.g; }
    else if (fc) {
      const cs = citiesIn(fc.value);
      if (cs.length === 1) destination = cs[0]; else destCountry = fc.value;
      draft.guessed = fc.g;
    }
  }
  if (!origin && fromSeg) {
    const fo = fuzzyMatch(fromSeg, PLACE_NAMES);
    if (fo) origin = fo.value;
  }
  if (!origin && codes.length >= 2 && !listy) origin = codes.find((c) => c !== destination) || null;
  if (!origin && home) origin = home;
  if (origin === destination) destination = null;
  if (origin) draft.origin = origin;
  if (destination) draft.destination = destination;
  else if (destCountry) draft.destCountry = destCountry;

  // Several places ("Uzbekistan, Kyrgyzstan and Turkmenistan") → one multi-stop trip.
  const oCc = placeByCode(origin)?.cc;
  const stops = [];
  for (const c of codes) if (c !== origin) stops.push({ code: c, index: t.indexOf(placeByCode(c)?.name || c) });
  for (const c of countries) {
    if (c.cc === oCc) continue;
    if (stops.some((x) => placeByCode(x.code)?.cc === c.cc)) continue;
    const city = mainCity(c.cc) || citiesIn(c.cc)[0];
    if (city) stops.push({ code: city, index: c.index, fromCountry: c.cc });
  }
  stops.sort((a, b) => a.index - b.index);
  const uniq = [...new Set(stops.map((x) => x.code))];
  if (uniq.length >= 2) {
    draft.multi = uniq.slice(0, 5);
    draft.destination = draft.multi[0];
    delete draft.destCountry;
  }

  Object.assign(draft, parseDates(t, now));
  if (draft.weekFlex) { draft.flex = '3d'; delete draft.weekFlex; }

  let m;
  if ((m = t.match(/(?<!(?:\+\/?-|±|plus or minus|give or take)\s*)\b(\d{1,2})\s*(?:nights?|days?)\b/i))) {
    const n = +m[1];
    draft.nights = /day/i.test(m[0]) ? Math.max(1, n - 1) : n;
  } else if (/\b(a|one)\s+week\b/i.test(t)) draft.nights = 7;
  else if (/\b(two|2)\s+weeks\b/i.test(t)) draft.nights = 14;
  else if (/\b(long\s+)?weekend\b/i.test(t)) draft.nights = /long/i.test(t) ? 3 : 2;
  if (draft.depart?.type === 'date' && !draft.ret && draft.nights) draft.ret = { type: 'date', value: addDays(draft.depart.value, draft.nights) };
  if (draft.nights && !draft.ret) draft.stay = draft.nights <= 4 ? 'short' : draft.nights <= 7 ? 'week' : 'long';

  if (/\b(one[- ]?way|single trip|no return)\b/i.test(t)) draft.oneWay = true;
  if (/\b(flexible|flexi|any day|give or take|plus or minus|around those dates)\b|±|\+\/?-\s*\d/i.test(t)) draft.flex = draft.depart?.type === 'month' ? 'month' : '3d';
  else if (/\b(exact|fixed|must be on|only on)\b/i.test(t)) draft.flex = 'exact';
  if (/\b(direct|non[- ]?stop)\b/i.test(t)) draft.direct = true;
  if (/\b(no (red[- ]?eye|night flights?|late arrivals?)|day ?time flights?)\b/i.test(t)) draft.avoidNight = true;

  Object.assign(draft, parseTravellers(t));
  const persona = detectPersona(t);
  if (persona) draft.persona = persona;
  const budget = parseBudget(t, currency);
  if (budget) draft.budget = budget;
  return draft;
}

// What the bot still needs to ask before searching.
export function missingField(d) {
  if (!d.destination && d.destCountry) return 'city';
  if (!d.destination) return 'destination';
  if (!d.origin) return 'origin';
  if (!d.depart) return 'depart';
  return null;
}
