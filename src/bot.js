// The conversation: a named, friendly assistant (clearly an AI) that remembers
// each traveller, understands one-line trip requests and replies with three
// kinds of picks: best overall, cheapest and most comfortable.

import {
  touchUser, updateUser, deleteUserData, getUsage, addUsage, bump, saveSearch, getSearch,
  saveLink, recordPrice, priceStats, getConfig, nowSec, counter, cacheGet, cacheSet,
} from './db.js';
import { send, answer, typing, btn, url, rows, esc } from './tg.js';
import { parseTrip, missingField, addDays } from './parse.js';
import { aiParse } from './ai.js';
import { placeByCode, resolvePlace, POPULAR_FROM, PLACES } from './places.js';
import { citiesIn, countryName } from './countries.js';
import { searchFares, bookingUrl, liveSearchUrl } from './tp.js';
import { rankFares, cheapestDates, PERSONAS, localParts, arrivalLocal } from './rank.js';
import { handleAdmin, isAdmin } from './admin.js';
import { createWatch, listWatches, stopWatch } from './watch.js';
import { nextStep, askStep, onSetupText, onSetupCallback, onContact, profileText, assistant } from './onboarding.js';
import { visaFor, visaLine, isEasy, needsEmbassy, shouldAskVisa, countryVisaMap, yesCountries, setCountryVisa, OFFICIAL_EVISA, VISA_TIPS } from './visa.js';
import { toolkit, toolkitContext, storeFor, gearPicks, gearUrl } from './toolkit.js';
import { latestNewsFor, newsLine } from './news.js';
import { noteInterest, onBookedAnswer, listTrips, removeTrip, latest } from './retention.js';
import { money as fmtMoney } from './format.js';
import { multiSummary, multiKeyboard, runMulti, orderStops, stopsText } from './multi.js';
import { weatherLine, climate, describe, pleasantScore } from './weather.js';
import { sendEmail, planEmail, unsubSig, emailReady, emailRoom, monthKey } from './email.js';

const MAX_TEXT = 300;
// Currencies the price data supports well; travellers pick with /currency.
const CURRENCIES = ['usd', 'eur', 'gbp', 'bdt', 'inr', 'pkr', 'aed', 'sar', 'myr', 'sgd', 'thb', 'idr', 'aud', 'cad', 'nzd', 'rub', 'brl', 'egp', 'try', 'jpy'];
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

// ---------------- helpers ----------------
export const money = fmtMoney;

const AIRLINES = {
  BG: 'Biman', BS: 'US-Bangla', '2A': 'Air Astra', EK: 'Emirates', QR: 'Qatar Airways', EY: 'Etihad', FZ: 'flydubai',
  G9: 'Air Arabia', SV: 'Saudia', WY: 'Oman Air', TK: 'Turkish Airlines', TG: 'Thai Airways', FD: 'Thai AirAsia',
  AK: 'AirAsia', D7: 'AirAsia X', MH: 'Malaysia Airlines', OD: 'Batik Air', SQ: 'Singapore Airlines', TR: 'Scoot',
  '6E': 'IndiGo', AI: 'Air India', IX: 'Air India Express', UK: 'Vistara', UL: 'SriLankan', KB: 'Druk Air',
  CX: 'Cathay Pacific', JL: 'JAL', NH: 'ANA', KE: 'Korean Air', OZ: 'Asiana', CA: 'Air China', MU: 'China Eastern',
  CZ: 'China Southern', VN: 'Vietnam Airlines', VJ: 'VietJet', PR: 'Philippine Airlines', GA: 'Garuda',
  BA: 'British Airways', VS: 'Virgin Atlantic', LH: 'Lufthansa', AF: 'Air France', KL: 'KLM', LX: 'SWISS',
  FR: 'Ryanair', U2: 'easyJet', W6: 'Wizz Air', VY: 'Vueling', IB: 'Iberia', TP: 'TAP', AZ: 'ITA',
  AA: 'American', DL: 'Delta', UA: 'United', B6: 'JetBlue', WN: 'Southwest', NK: 'Spirit', AC: 'Air Canada',
  WS: 'WestJet', QF: 'Qantas', VA: 'Virgin Australia', JQ: 'Jetstar', NZ: 'Air New Zealand', PK: 'PIA',
  HY: 'Uzbekistan Airways', KC: 'Air Astana', DV: 'SCAT', T5: 'Turkmenistan Airlines', QH: 'Air Kyrgyzstan', J2: 'AZAL',
  A9: 'Georgian Airways', SZ: 'Somon Air', '5W': 'Wizz Air Abu Dhabi', XY: 'flynas', F3: 'flyadeal', MS: 'EgyptAir', RJ: 'Royal Jordanian',
  J9: 'Jazeera Airways', GF: 'Gulf Air', KU: 'Kuwait Airways', OV: 'SalamAir', PC: 'Pegasus', XQ: 'SunExpress',
  SU: 'Aeroflot', S7: 'S7 Airlines', ET: 'Ethiopian', KQ: 'Kenya Airways', '3K': 'Jetstar Asia', VZ: 'Thai Vietjet', DD: 'Nok Air', SL: 'Thai Lion Air',
};
const airline = (c) => AIRLINES[c] || c || 'Airline';
const LABEL_ICON = { 'Best overall': '⭐', Cheapest: '💰', 'Most comfortable': '🛋️', 'Also good': '👍' };

const fmtDur = (min) => (min ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : '');
const fmtDay = (iso) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtMonth = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const hhmm = (p) => `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
const placeName = (code) => placeByCode(code)?.name || code;
const firstName = (u) => (u?.name || u?.first_name ? esc(u.name || u.first_name) : 'there');

function nextMonths(n = 4) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i += 1) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1));
    out.push(`${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

async function publicUrl(env) {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/$/, '');
  return (await getConfig(env, 'public_url')) || '';
}

export async function trackedLink(env, href, userId, kind, meta = null) {
  if (!href) return null;
  const base = await publicUrl(env);
  if (!base) return href;
  const id = await saveLink(env, href, userId, kind, meta);
  return `${base}/go/${id}`;
}

let ENV = {};
const DEFAULTS = { NEW_SEARCHES_PER_DAY: 5, NEW_WATCHES_PER_DAY: 1, TRUSTED_SEARCHES_PER_DAY: 10, TRUSTED_WATCHES_PER_DAY: 2 };
const setting = (k) => ENV[k] ?? DEFAULTS[k];
function limitsFor(user) {
  const trusted = user && nowSec() - (user.created_at || 0) > 7 * 86400 && (user.active_days || 0) >= 2;
  return {
    searches: Number(trusted ? setting('TRUSTED_SEARCHES_PER_DAY') : setting('NEW_SEARCHES_PER_DAY')),
    watches: Number(trusted ? setting('TRUSTED_WATCHES_PER_DAY') : setting('NEW_WATCHES_PER_DAY')),
    trusted,
  };
}

// ---------------- entry ----------------
const ALWAYS_OK = ['/start', '/help', '/privacy', '/delete', '/whoami', '/about'];

export async function handleUpdate(env, update) {
  ENV = env;
  if (update.callback_query) return onCallback(env, update.callback_query);
  const msg = update.message;
  if (!msg || !msg.from || msg.from.is_bot) return;
  const chat = msg.chat;
  const isGroup = chat.type === 'group' || chat.type === 'supergroup';
  let text = (msg.text || '').trim();

  if (isGroup) {
    if (!text) return;
    const me = (await getConfig(env, 'bot_username')) || env.BOT_USERNAME || '';
    const mentioned = me && text.toLowerCase().includes(`@${me.toLowerCase()}`);
    const replyToBot = msg.reply_to_message?.from?.is_bot && (!me || msg.reply_to_message.from.username === me);
    if (!text.startsWith('/') && !mentioned && !replyToBot) return;
    if (me) text = text.replace(new RegExp(`@${me}`, 'ig'), '').trim();
  }

  if (env.BURST) {
    try {
      const { success } = await env.BURST.limit({ key: `u${msg.from.id}` });
      if (!success) {
        await bump(env, 'burst_blocked');
        const u = await getUsage(env, `u${msg.from.id}`);
        if (!u.warned) { await addUsage(env, `u${msg.from.id}`, 'warned'); await send(env, chat.id, 'Slow down a little 🙂 Try again in a minute.'); }
        return;
      }
    } catch { /* binding missing: carry on */ }
  }

  const user = await touchUser(env, msg.from, chat.type === 'private' ? chat.id : null);
  if (user.banned) return;

  if (!isGroup && msg.contact) return onContact(env, user, chat, msg.contact);
  if (!text) {
    if (!isGroup) await send(env, chat.id, 'Send me your trip in one line, e.g. <i>"Me and 3 friends, Dhaka to Bangkok, December"</i>.');
    return;
  }
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);

  const cmd = text.startsWith('/') ? text.split(/\s+/)[0].split('@')[0].toLowerCase() : null;
  // Private chats: finish the one-time profile first (a few commands always work).
  if (!isGroup && nextStep(env, user) !== 'done' && !(cmd && (ALWAYS_OK.includes(cmd) || isAdmin(env, user.id)))) {
    if (cmd) return askStep(env, user, chat.id, undefined, 'Let’s finish setting you up first, it only takes a minute.');
    return onSetupText(env, user, chat, text, msg);
  }
  if (cmd) return onCommand(env, user, chat, text, isGroup);
  if (await smallTalk(env, user, chat, text)) return;
  return onTripText(env, user, chat, text, isGroup);
}

// Friendly replies that don't cost a search. Always honest about being an AI.
async function smallTalk(env, user, chat, text) {
  const t = text.toLowerCase().trim();
  const me = assistant(env);
  if (/\b(are|r) (you|u) (a )?(human|real|person|bot|robot|ai|machine)\b|\bwho are you\b|\byour name\b/.test(t)) {
    await send(env, chat.id, `I'm ${me}, CityWide's travel assistant. I'm an AI, not a person, but I plan like a well-travelled friend: who's going, budget, visas, weather and comfort. Tell me where you'd like to go!`);
    return true;
  }
  if (/^(hi|hello|hey|salam|assalamu ?alaikum|good (morning|afternoon|evening)|yo|hola)\b[!. ]*$/.test(t)) {
    await send(env, chat.id, `Hi ${firstName(user)}! 👋 Where are you thinking of going? Tell me in one line, e.g. <i>"family trip to Thailand in December"</i>.`);
    return true;
  }
  if (/^(thanks|thank you|thx|ty|great|awesome|perfect|ok|okay|cool)\b[!. ]*$/.test(t)) {
    await send(env, chat.id, `Anytime, ${firstName(user)}! Happy travels ✈️ Tap 🔔 on any result and I'll watch the price for you.`);
    return true;
  }
  return false;
}

// ---------------- commands ----------------
async function onCommand(env, user, chat, text, isGroup) {
  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = cmdRaw.split('@')[0].toLowerCase();
  if (isAdmin(env, user.id) && await handleAdmin(env, user, chat, cmd, args)) return;
  const me = assistant(env);
  switch (cmd) {
    case '/start':
      if (isGroup) return send(env, chat.id, `Hi everyone! I'm ${me}, your trip-planning assistant (an AI). Mention me with your trip, e.g. <i>@${esc((await getConfig(env, 'bot_username')) || 'me')} 4 of us, Dhaka to Bangkok in December</i>.`);
      await updateUser(env, user.id, { draft: null });
      if (nextStep(env, user) !== 'done') {
        return askStep(env, user, chat.id, undefined, `Hi! I'm <b>${me}</b> ✈️ CityWide's travel assistant. I'm an AI, but I plan like a well-travelled friend: who's going, your budget, visas, weather and comfort.\n\nA few one-time questions so I can plan properly for you. I'll remember the answers.`);
      }
      return send(env, chat.id, `Welcome back, ${firstName(user)}! 😊 Where to next? Tell me in one line.`);
    case '/plan':
    case '/new':
      if (args.length) return onTripText(env, user, chat, args.join(' '), isGroup);
      await updateUser(env, user.id, { draft: null });
      return send(env, chat.id, `Sure, ${firstName(user)}! Tell me your trip in one line, e.g.\n<i>"Family of 4, 2 kids, London to Bali in July, under £3,000 total"</i>`);
    case '/watches':
      return listWatches(env, user, chat.id);
    case '/latest':
      return latest(env, user, chat.id);
    case '/trips':
      return listTrips(env, user, chat.id);
    case '/currency':
      return send(env, chat.id, `Prices are shown in <b>${String(user.currency || 'usd').toUpperCase()}</b>. Pick another:`, rows(CURRENCIES.map((c) => btn(c.toUpperCase(), `cur:${c}`)), 4));
    case '/visas': {
      const vmap = await countryVisaMap(env, user.id);
      const keys = Object.keys(vmap);
      if (!keys.length) return send(env, chat.id, 'You haven’t told me about any country visas yet. I’ll ask when a trip needs one.');
      return send(env, chat.id, `<b>Visas you told me about</b>\n${keys.map((cc) => `• ${esc(countryName(cc))}: ${vmap[cc] === 'yes' ? 'have a valid visa' : 'no visa yet'}`).join('\n')}`,
        keys.map((cc) => [btn(`Forget ${countryName(cc)}`, `uv:del:${cc}`)]));
    }
    case '/gear': {
      const store = storeFor(env, user.country);
      const base = await publicUrl(env);
      if (!store || !base) return send(env, chat.id, 'My travel-essentials list is coming soon! 🎒');
      return send(env, chat.id, '🎒 My packing essentials: chargers, adapters, packing cubes and more.', [[url('Open the checklist', `${base}/gear?c=${user.country || 'US'}`)]]);
    }
    case '/profile':
      return send(env, chat.id, profileText(env, user));
    case '/settings':
      return send(env, chat.id, 'What would you like to change?', rows([
        btn('Name', 'set:edit:name'), btn('Home city', 'set:edit:home'), btn('Passports', 'set:edit:passports'),
        btn('Visas held', 'set:edit:visas'), btn('Email', 'set:edit:email'), btn('WhatsApp', 'set:edit:phone'),
        btn('Deals by email', 'set:edit:deals'), btn('Travel group', 'set:edit:group'),
        ...(user.country === 'BD' ? [btn('How I pay', 'set:edit:pay')] : []),
      ], 2));
    case '/about':
      return send(env, chat.id, `I'm ${me}, an AI travel assistant from CityWide Trip (citywidetrip.com). Prices come from recent traveller searches; booking happens on the airline or travel site. I never ask for passwords or card details.`);
    case '/privacy':
      return send(env, chat.id, '<b>Privacy</b>\nI remember your name, home city, passports, visas you hold, email, optional WhatsApp number, travel preferences, price watches, and searches for 30 days. I use them to plan your trips and send what you ask for. I email deals only if you said yes. I never ask for passwords or payment details.\nSee it all with /profile, change it with /settings, erase it with /delete.');
    case '/delete':
      await deleteUserData(env, user.id);
      return send(env, chat.id, 'Done. Everything I stored about you is deleted. Send /start whenever you want to begin again.', null, { reply_markup: { remove_keyboard: true } });
    case '/whoami':
      return send(env, chat.id, `Your Telegram user ID: <code>${user.id}</code>\nThis chat ID: <code>${chat.id}</code>`);
    case '/help':
    default:
      return send(env, chat.id, helpText(env, user));
  }
}

const helpText = (env, user) => `Hi ${firstName(user)}, here's how I work:
Type your trip in one line, the way you'd tell a friend:
• <i>Me and 3 friends, Dhaka to Bangkok, December, max 25,000 BDT each</i>
• <i>Family of 5, 3 kids, London to Spain, summer holidays</i>
• <i>Business trip to Singapore 20 Nov, back 23 Nov, direct</i>

I give you three picks: ⭐ best overall, 💰 cheapest and 🛋️ most comfortable, with visa and weather notes, and I can watch prices for you.

/plan new trip · /latest updates for you · /watches price watches · /trips booked trips · /currency · /visas · /profile · /settings · /privacy · /delete`;

// ---------------- trip flow ----------------
function quotaKey(user, chat, isGroup) { return isGroup ? `g${chat.id}` : `u${user.id}`; }

async function onTripText(env, user, chat, text, isGroup) {
  const now = new Date();
  const prev = !isGroup && user.draft ? JSON.parse(user.draft) : null;

  if (prev && prev.awaiting) {
    const again = parseTrip(text, { now, home: user.home, currency: user.currency || 'usd' });
    if (prev.awaiting === 'destination' && (again.multi || again.destCountry)) {
      // "Uzbekistan, Kyrgyzstan and Turkmenistan" / "Thailand" as the answer: keep the rest of the trip
      const merged = { ...prev, ...again, origin: prev.origin || again.origin };
      for (const k of ['depart', 'ret', 'nights', 'stay', 'flex', 'adults', 'children', 'persona', 'budget']) if (prev[k] !== undefined && again[k] === undefined) merged[k] = prev[k];
      delete merged.awaiting;
      return continueDraft(env, user, chat, merged, isGroup);
    }
    const place = resolvePlace(text);
    if (prev.awaiting === 'destination' && place) { prev.destination = place.code; delete prev.awaiting; delete prev.destCountry; if (place.guessed) prev.guessed = place.guessed; return continueDraft(env, user, chat, prev, isGroup); }
    if (prev.awaiting === 'origin' && place) { prev.origin = place.code; delete prev.awaiting; return continueDraft(env, user, chat, prev, isGroup); }
    if (!again.destination && text.split(/\s+/).length <= 4) {
      // never ask the same question twice: say what went wrong instead
      await env.DB.prepare('INSERT INTO misses (user_id, text, at) VALUES (?, ?, ?)').bind(user.id, text.slice(0, 200), nowSec()).run();
      await bump(env, 'parse_misses');
      return send(env, chat.id, `Sorry ${firstName(user)}, I couldn't find "${esc(text.slice(0, 40))}" 🙈 Try the nearest big city, the country name, or the airport's 3-letter code (e.g. TAS for Tashkent).`);
    }
  }

  let draft = parseTrip(text, { now, home: user.home, currency: user.currency || 'usd' });
  if (!draft.destination && !draft.destCountry && text.split(/\s+/).length >= 3) {
    const usage = await getUsage(env, quotaKey(user, chat, isGroup));
    if (usage.ai < 6) {
      await typing(env, chat.id);
      const ai = await aiParse(env, text, { now, userKey: quotaKey(user, chat, isGroup) });
      if (ai) draft = { ...ai, ...draft, destination: draft.destination || ai.destination, origin: draft.origin || ai.origin || user.home };
    }
  }
  if (!draft.destination && !draft.destCountry && text.split(/\s+/).length >= 3) {
    await env.DB.prepare('INSERT INTO misses (user_id, text, at) VALUES (?, ?, ?)').bind(user.id, text.slice(0, 200), nowSec()).run();
    await bump(env, 'parse_misses');
  }
  if (!draft.persona && user.persona) draft.persona = user.persona;
  if (!draft.adults && !draft.children) {
    // not said: make a sensible guess for the group and let them correct it with one tap
    const guess = { family: [2, 1], friends: [3, 0], women: [3, 0], couple: [2, 0] }[draft.persona];
    if (guess) { [draft.adults, draft.children] = guess; draft.paxGuess = draft.persona !== 'couple'; } else draft.adults = 1;
  }
  if (!draft.adults) draft.adults = draft.persona === 'couple' ? 2 : 1;
  if (draft.multi && !draft.reorderedChecked) {
    const o = orderStops(draft.origin, draft.multi);
    draft.multi = o.stops; draft.reordered = o.reordered; draft.reorderedChecked = true;
    draft.destination = draft.multi[0];
  }
  if (draft.budget && !draft.budget.currency) draft.budget.currency = user.currency || 'usd';
  if (draft.depart && !draft.flex) draft.flex = draft.depart.type === 'month' ? 'month' : 'exact';
  return continueDraft(env, user, chat, draft, isGroup);
}

async function saveDraft(env, user, draft, isGroup) {
  if (!isGroup) await updateUser(env, user.id, { draft: JSON.stringify(draft) });
}

async function continueDraft(env, user, chat, draft, isGroup) {
  const missing = missingField(draft);
  if (missing === 'city') {
    draft.awaiting = 'destination';
    await saveDraft(env, user, draft, isGroup);
    const cities = citiesIn(draft.destCountry);
    return send(env, chat.id, `${countryName(draft.destCountry)}, nice choice! Which part?`, [
      ...rows(cities.slice(0, 8).map((c) => btn(placeName(c), `d:dest:${c}`)), 2),
      ...(isGroup ? [] : [[btn(`🔍 Compare all of ${countryName(draft.destCountry)}`, `d:cmp:${draft.destCountry}`)]]),
    ]);
  }
  if (missing === 'destination') {
    draft.awaiting = 'destination';
    await saveDraft(env, user, draft, isGroup);
    const pop = POPULAR_FROM[placeByCode(draft.origin)?.cc] || POPULAR_FROM.DEFAULT;
    return send(env, chat.id, `Where would you like to go, ${firstName(user)}? Tap one or type a city or country.`, rows(pop.map((c) => btn(placeName(c), `d:dest:${c}`)), 3));
  }
  if (missing === 'origin') {
    draft.awaiting = 'origin';
    await saveDraft(env, user, draft, isGroup);
    return send(env, chat.id, 'Which city are you flying from?');
  }
  if (missing === 'depart') {
    await saveDraft(env, user, draft, isGroup);
    return send(env, chat.id, 'When would you like to go?', rows(nextMonths(4).map((m) => btn(fmtMonth(m), `d:m:${m}`)), 2));
  }
  await saveDraft(env, user, draft, isGroup);
  if (draft.multi) {
    if (isGroup) return startMulti(env, user, chat, draft, isGroup);
    const vm = await countryVisaMap(env, user.id);
    const kb = multiKeyboard(draft);
    if (draft.paxGuess) kb.splice(1, 0, ...paxRows(draft));
    return send(env, chat.id, multiSummary(user, draft, vm, firstName(user)) + (draft.paxGuess ? '\n\n👥 How many are going? (my guess is above; tap to change)' : ''), kb);
  }
  if (isGroup) return runSearch(env, user, chat, draft, isGroup);
  const vmap = await countryVisaMap(env, user.id);
  const destCc = placeByCode(draft.destination)?.cc;
  const askVisa = shouldAskVisa(list(user.passports), list(user.visas), destCc, vmap) ? destCc : null;
  return send(env, chat.id, summary(env, user, draft, vmap, askVisa), confirmKeyboard(draft, askVisa));
}

const STAYS = { short: [2, 4, '2–4 nights'], week: [5, 7, '5–7 nights'], long: [8, 14, '8–14 nights'] };

function paxRows(d) {
  // 👤 = adults, 🧒 = children; ✅ marks the current choice
  const rowsOut = [[1, 2, 3, 4, 5, 6].map((n) => btn(`${d.adults === n ? '✅' : '👤'}${n}`, `d:ad:${n}`))];
  if (d.persona === 'family' || d.children) rowsOut.push([0, 1, 2, 3, 4].map((n) => btn(`${(d.children || 0) === n ? '✅' : '🧒'}${n}`, `d:ch:${n}`)));
  return rowsOut;
}

function confirmKeyboard(d, askVisa) {
  const kb = [[btn('✅ Search', 'd:go')]];
  if (d.paxGuess) kb.push(...paxRows(d));
  if (askVisa) kb.push([btn(`✅ I have a ${countryName(askVisa)} visa`, `d:visa:yes:${askVisa}`), btn('No visa yet', `d:visa:no:${askVisa}`)]);
  kb.push([btn(`${d.oneWay ? '' : '✅ '}⇄ Return`, 'd:way:rt'), btn(`${d.oneWay ? '✅ ' : ''}→ One way`, 'd:way:ow')]);
  if (!d.oneWay && !d.ret && (d.depart.type === 'month' || d.flex === 'month')) {
    const mark = (k) => ((d.stay || 'any') === k ? '✅ ' : '');
    kb.push([...Object.entries(STAYS).map(([k, v]) => btn(`${mark(k)}${v[2]}`, `d:stay:${k}`)), btn(`${mark('any')}Any`, 'd:stay:any')]);
  }
  if (d.depart.type === 'date') {
    const mark = (f) => (d.flex === f ? '✅ ' : '');
    kb.push([btn(`${mark('exact')}Exact dates`, 'd:flex:exact'), btn(`${mark('3d')}± 3 days`, 'd:flex:3d'), btn(`${mark('month')}Any day that month`, 'd:flex:month')]);
  }
  kb.push([btn('👥 Change group', 'd:grp'), btn('📅 Change month', 'd:dates')]);
  return kb;
}

function summary(env, user, d, vmap = {}, askVisa = null) {
  const pax = (d.adults || 1) + (d.children || 0);
  const who = d.persona ? PERSONAS[d.persona].label : (pax === 1 ? 'Solo' : `${pax} travellers`);
  const people = d.children ? `${d.adults} adults, ${d.children} children` : `${pax} ${pax === 1 ? 'person' : 'people'}`;
  let when;
  if (d.depart.type === 'month' || d.flex === 'month') {
    when = `${fmtMonth(d.depart.value.slice(0, 7))} (any days)`;
    if (!d.oneWay && !d.ret) when += STAYS[d.stay] ? `, staying ${STAYS[d.stay][2]}` : ', any trip length';
  } else {
    when = `${fmtDay(d.depart.value)}${d.ret && !d.oneWay ? ` → back ${fmtDay(d.ret.value)}` : ''}`;
    when += d.flex === '3d' ? ' (± 3 days)' : ' (exact)';
  }
  const arrow = d.oneWay ? '→' : '⇄';
  const lines = [
    `Got it, ${firstName(user)}! Here's what I understood:`,
    `✈️ ${esc(placeName(d.origin))} (${d.origin}) ${arrow} ${esc(placeName(d.destination))} (${d.destination}) · <b>${d.oneWay ? 'one way' : 'return trip'}</b>`,
    `📅 ${when}`,
    `👥 ${who} · ${people}${d.paxGuess ? ' <i>(my guess, tap below to change)</i>' : ''}`,
  ];
  if (d.guessed) lines.push(`<i>(I read "${esc(d.guessed)}" as ${esc(placeName(d.destination) || countryName(d.destCountry))}. Not right? Just type the place again.)</i>`);
  if (d.budget) lines.push(`💰 Budget ${money(d.budget.amount, d.budget.currency || 'usd')} ${d.budget.perPerson ? 'per person' : 'in total'}`);
  if (d.direct) lines.push('Direct flights only');
  if (d.seasonNote) lines.push(`<i>${esc(d.seasonNote)}</i>`);
  const destCc = placeByCode(d.destination)?.cc;
  const v = visaFor(list(user.passports), list(user.visas), destCc, yesCountries(vmap));
  if (askVisa) {
    lines.push(`\n🛂 ${esc(countryName(askVisa))} needs ${v?.code === 'E' ? 'an e-visa' : 'a visa'} for your passport. Do you already have a valid one? (I'll remember for next time.)`);
  } else if (needsEmbassy(v) && vmap[destCc] !== 'yes') {
    lines.push(`\n⚠️ Heads-up: ${esc(countryName(destCc))} needs ${v.code === 'N' ? 'special permission' : 'an embassy visa'} for your passport. That can take weeks, so apply early. Tap 🌏 Easier places after searching for visa-friendly ideas.`);
  }
  if (d.depart.type === 'date' && d.flex === 'exact') lines.push('\nAre your dates fixed, or can you move them a little? Flexible dates often save money.');
  if (!d.oneWay && !d.ret && (d.depart.type === 'month' || d.flex === 'month') && !d.stay) lines.push('\nHow long will you stay? Pick below, or just search any length.');
  return lines.join('\n');
}

async function checkSearchQuota(env, user, chat, isGroup) {
  const key = quotaKey(user, chat, isGroup);
  const lim = limitsFor(user);
  const usage = await getUsage(env, key);
  const allowed = (isGroup ? lim.searches * 2 : lim.searches) + (usage.bonus || 0);
  if (usage.searches >= allowed) {
    await bump(env, 'quota_blocked');
    await send(env, chat.id, `You've used today's ${allowed} free searches, ${firstName(user)}. They reset at midnight UTC.${lim.trusted ? '' : ' Regular users get more after their first week.'}\nYour price watches keep running meanwhile.`);
    return false;
  }
  await addUsage(env, key, 'searches');
  await bump(env, 'searches');
  return true;
}

const monthOf = (iso) => iso.slice(0, 7);

// Builds one or two API queries plus date windows for flexible searches.
export function fareQueries(draft, user) {
  const base = { origin: draft.origin, destination: draft.destination, oneWay: !!draft.oneWay, direct: !!draft.direct, currency: user.currency || 'usd' };
  const dep = draft.depart.value;
  if (draft.depart.type === 'month' || draft.flex === 'month') {
    const m = monthOf(dep);
    const ret = draft.oneWay ? undefined : (draft.ret && draft.flex !== 'month' ? monthOf(draft.ret.value) : m);
    return { queries: [{ ...base, depart: m, ret }], windows: {} };
  }
  if (draft.flex === '3d') {
    const from = addDays(dep, -3);
    const to = addDays(dep, 3);
    const months = [...new Set([monthOf(from), monthOf(to)])];
    const windows = { departWindow: { from, to } };
    let ret;
    if (!draft.oneWay) {
      if (draft.ret) {
        windows.returnWindow = { from: addDays(draft.ret.value, -3), to: addDays(draft.ret.value, 3) };
        ret = monthOf(draft.ret.value);
      } else ret = monthOf(dep);
    }
    return { queries: months.map((m) => ({ ...base, depart: m, ret })), windows };
  }
  // exact
  const ret = draft.oneWay ? undefined : (draft.ret ? draft.ret.value : monthOf(dep));
  return { queries: [{ ...base, depart: dep, ret }], windows: {} };
}

export async function fetchRanked(env, draft, user) {
  const { queries, windows } = fareQueries(draft, user);
  let items = [];
  let currency = (user.currency || 'usd').toLowerCase();
  let capped = false;
  for (const q of queries) {
    let res = await searchFares(env, q);
    if (!res.capped && !res.items.length && !q.oneWay && q.ret && q.ret.length === 7 && q.ret === monthOf(q.depart)) {
      const [y, m] = q.ret.split('-').map(Number);
      const next = new Date(Date.UTC(y, m, 1));
      res = await searchFares(env, { ...q, ret: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}` });
    }
    if (res.capped) capped = true;
    if (res.items.length) {
      if (items.length && res.currency !== currency) continue; // keep one currency per answer
      currency = res.currency;
      items = items.concat(res.items);
    }
  }
  const dest = placeByCode(draft.destination);
  const ranked = items.length ? rankFares(items, {
    persona: draft.persona, adults: draft.adults, children: draft.children, budget: draft.budget,
    currency, destTz: dest?.tz, avoidNight: draft.avoidNight, nights: draft.nights, oneWay: draft.oneWay, ...windows,
    stayRange: !draft.oneWay && !draft.nights && STAYS[draft.stay] ? STAYS[draft.stay].slice(0, 2) : null,
  }) : [];
  return { res: { items, currency, capped }, ranked, q: queries[0] };
}

async function runSearch(env, user, chat, draft, isGroup) {
  if (!(await checkSearchQuota(env, user, chat, isGroup))) return;
  await typing(env, chat.id);
  const { res, ranked, q } = await fetchRanked(env, draft, user);
  if (res.capped && !ranked.length) return send(env, chat.id, "I'm very busy today and paused new price checks to stay free for everyone. Please try again tomorrow, sorry!");

  const pax = (draft.adults || 1) + (draft.children || 0);
  if (!ranked.length) {
    await bump(env, 'searches_empty');
    const live = liveSearchUrl(env, { origin: draft.origin, destination: draft.destination, depart: draft.depart.value, ret: draft.ret?.value || (q.ret && q.ret.length === 10 ? q.ret : undefined), adults: draft.adults });
    const link = await trackedLink(env, live, user.id, 'live');
    const sid = await saveSearch(env, user.id, chat.id, { draft });
    return send(env, chat.id, `Sorry ${firstName(user)}, I don't have recent prices for ${esc(placeName(draft.origin))} → ${esc(placeName(draft.destination))} on those dates yet${draft.flex === 'exact' ? '. Flexible dates might help' : ''}. You can run a live search with my filters already set:`, [
      [url('🔎 Search live prices', link)],
      [btn('📅 Try another month', 'd:dates'), btn('🌏 Similar places', `r:alt:${sid}`)],
    ]);
  }

  const best = Math.min(...ranked.map((r) => r.it.price));
  const route = `${draft.origin}-${draft.destination}`;
  const month = draft.depart.value.slice(0, 7);
  const stats = await priceStats(env, route, month, res.currency);
  await recordPrice(env, route, month, best, res.currency);
  const searchId = await saveSearch(env, user.id, chat.id, { draft, best, currency: res.currency });

  if (!isGroup) await noteInterest(env, user.id, draft);
  const vmap = isGroup ? {} : await countryVisaMap(env, user.id);
  const msg = await formatResults(env, user, draft, ranked, res.currency, pax, stats, best, vmap);
  const keyboard = [];
  let shareHref = null;
  for (const r of ranked) {
    const meta = { sid: searchId, origin: draft.origin, destination: draft.destination, depart: r.it.departure_at.slice(0, 10),
      ret: r.it.return_at ? r.it.return_at.slice(0, 10) : null, adults: draft.adults, children: draft.children || 0 };
    const href = await trackedLink(env, bookingUrl(env, r.it), user.id, 'flight', meta);
    if (href) keyboard.push([url(`${LABEL_ICON[r.labels[0]]} ${airline(r.it.airline)} · ${money(r.it.price, res.currency)} · Book`, href)]);
    if (!shareHref && href) shareHref = href;
  }
  keyboard.push([btn('🔔 Track this trip', `r:w:${searchId}`), btn('📅 Cheaper dates', `r:dates:${searchId}`)]);
  const v = visaFor(list(user.passports), list(user.visas), placeByCode(draft.destination)?.cc, yesCountries(vmap));
  keyboard.push([btn(needsEmbassy(v) ? '🌏 Easier places' : '🌏 Similar places', `r:alt:${searchId}`), btn('✏️ Change', 'd:grp')]);
  const live = liveSearchUrl(env, { origin: draft.origin, destination: draft.destination, depart: ranked[0].it.departure_at.slice(0, 10),
    ret: draft.oneWay || !ranked[0].it.return_at ? undefined : ranked[0].it.return_at.slice(0, 10), adults: draft.adults });
  keyboard.push([url('🔎 All live prices, incl. connecting flights', await trackedLink(env, live, user.id, 'live'))]);
  const second = [];
  if (env.TP_TRS) second.push(btn('🧳 Trip toolkit', `r:tk:${searchId}`));
  const top = ranked[0].it;
  const shareText = `✈️ ${placeName(draft.origin)} → ${placeName(draft.destination)}, ${fmtDay(top.departure_at)}: from ${money(top.price, res.currency)} per person (${airline(top.airline)}, ${top.transfers === 0 ? 'direct' : `${top.transfers} stop`}). Found by Maya on CityWide Trip Planner${shareHref ? `: ${shareHref}` : ''}`;
  second.push(url('📤 Share on WhatsApp', `https://wa.me/?text=${encodeURIComponent(shareText)}`));
  keyboard.push(second);
  if (!isGroup && user.email) keyboard.push([btn('📧 Email me this plan', `r:em:${searchId}`)]);
  // one money-making extra that fits this trip (only programs you've joined)
  const ctx = toolkitContext(draft, ranked[0].it);
  ctx.lateArrival = ranked.some((r) => r.late);
  const extra = (await toolkit(env, ctx, 1))[0];
  if (extra) keyboard.push([url(extra.text, extra.href)]);
  const gear = await gearButton(env, user, draft, ranked[0].it);
  if (gear) keyboard.push([gear]);
  return send(env, chat.id, msg, keyboard);
}

// One option, carrier first, laid out like an e-ticket.
function pickLines(r, cur, pax, i, d) {
  const it = r.it;
  const dest = placeByCode(d.destination);
  const orig = placeByCode(d.origin);
  const back = it.return_at ? backMinutes(it) : 0;
  const ret = it.return_at ? arrivalLocal(it.return_at, back, orig?.tz) : null;
  const lines = [
    '',
    `${LABEL_ICON[r.labels[0]] || '✈️'} <b>Option ${i + 1} · ${r.labels.join(' · ')} · ${esc(airline(it.airline))}</b>`,
    `<b>${money(it.price, cur)}</b> per person${pax > 1 ? ` · about ${money(it.price * pax, cur)} for ${pax}` : ''}`,
    `🛫 ${tgDate(it.departure_at)} · ${hhmm(r.dep)} ${esc(placeName(d.origin))} → ${r.arr ? `${hhmm(r.arr)}${plusDay(r.dep.date, r.arr)} ` : ''}${esc(placeName(d.destination))}`,
    `     ${stopsText(d.origin, d.destination, it.duration_to, it.transfers)}${it.duration_to ? ` · ${fmtDur(it.duration_to)}` : ''}`,
  ];
  if (it.return_at) {
    const n = Math.round((Date.parse(it.return_at.slice(0, 10)) - Date.parse(it.departure_at.slice(0, 10))) / 86400000);
    const rd = localParts(it.return_at);
    lines.push(`🛬 ${tgDate(it.return_at)} · ${hhmm(rd)} ${esc(placeName(d.destination))} → ${ret ? `${hhmm(ret)}${plusDay(rd.date, ret)} ` : ''}${esc(placeName(d.origin))}`);
    lines.push(`     ${stopsText(d.destination, d.origin, back, it.return_transfers ?? it.transfers)}${back ? ` · ${fmtDur(back)}` : ''} · ${n} night${n === 1 ? '' : 's'} in ${esc(dest?.name || '')}`);
  } else lines.push('     One way');
  if (r.reasons.why.length) lines.push(`✅ ${r.reasons.why.join(', ')}`);
  if (r.reasons.warn.length) lines.push(`⚠️ ${r.reasons.warn.join('; ')}`);
  return lines.join('\n');
}
const tgDate = (iso) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(/^(\w+) /, '$1, ');
const backMinutes = (it) => it.duration_back || (it.duration && it.duration > (it.duration_to || 0) ? it.duration - (it.duration_to || 0) : 0);

async function formatResults(env, user, draft, ranked, cur, pax, stats, best, vmap = {}) {
  const who = (PERSONAS[draft.persona] || {}).label;
  const out = [`Here's what I found, ${firstName(user)} 👇`, `<b>${esc(placeName(draft.origin))} ${draft.oneWay ? '→' : '⇄'} ${esc(placeName(draft.destination))}</b> · ${draft.oneWay ? 'one way' : 'return'}${who ? ` · for a ${esc(who.toLowerCase())}` : ''}`];
  if (stats && stats.n >= 3 && stats.low) {
    out.push(best <= stats.low ? '📉 Lowest price I have seen for this route this month.' : `Lowest I've seen recently: ${money(stats.low, cur)}.`);
  }
  for (const [i, r] of ranked.entries()) out.push(pickLines(r, cur, pax, i, draft));
  out.push('');
  if (ranked[0].perPersonBudget && ranked.every((r) => r.overBudget)) {
    const low = Math.min(...ranked.map((r) => r.it.price));
    out.push(`💡 All of these are above your budget of ${money(ranked[0].perPersonBudget, cur)} per person (cheapest is ${money(low, cur)}). Try 📅 Cheaper dates or another month, tap 🔔 and I'll tell you if it drops, or tap 🔎 to see all live prices including connections.`);
  }
  const w = await weatherLine(env, draft.origin, draft.destination, ranked[0].it.departure_at.slice(0, 7));
  if (w) out.push(esc(w.line));
  const destCc = placeByCode(draft.destination)?.cc;
  const vl = visaLine(visaFor(list(user.passports), list(user.visas), destCc, yesCountries(vmap)), destCc);
  if (vl) out.push(vl);
  const news = await latestNewsFor(env, destCc);
  if (news) out.push(newsLine(news, countryName(destCc), esc));
  if (user.country === 'BD') {
    out.push('💳 Paying from Bangladesh: airlines\' own Bangladesh websites take dual-currency cards with no $300 limit. Paying in taka (bKash, Nagad, local card)? Compare the same dates on <a href="https://www.gozayaan.com">GoZayaan</a> or <a href="https://sharetrip.net">ShareTrip</a>.');
  }
  out.push(`<i>Prices were seen by travellers in the last 48 h; the booking site shows the live price${pax > 1 ? ' (children\'s fares may differ)' : ''}.</i>`);
  return out.join('\n');
}

// ---------------- buttons ----------------
const EDIT_FIELDS = {
  name: { name: null }, home: { home: null }, passports: { passports: null }, visas: { visas: null, visas_asked: 0 },
  email: { email: null, email_verified: 0, email_code: null }, phone: { phone: null, phone_asked: 0 },
  deals: { consent_at: null }, group: { persona: null }, pay: { pay: null },
};

async function onCallback(env, cq) {
  ENV = env;
  const data = cq.data || '';
  const chat = cq.message?.chat;
  if (!chat) return answer(env, cq.id);
  const isGroup = chat.type !== 'private';
  if (env.BURST) {
    try {
      const { success } = await env.BURST.limit({ key: `u${cq.from.id}` });
      if (!success) return answer(env, cq.id, 'Slow down a little 🙂');
    } catch { /* ignore */ }
  }
  const user = await touchUser(env, cq.from, isGroup ? null : chat.id);
  if (user.banned) return answer(env, cq.id);
  await answer(env, cq.id);
  const [ns, a, b] = data.split(':');

  if (ns === 'set') {
    if (a === 'edit' && EDIT_FIELDS[b]) {
      await updateUser(env, user.id, EDIT_FIELDS[b]);
      return askStep(env, { ...user, ...EDIT_FIELDS[b] }, chat.id);
    }
    return onSetupCallback(env, user, chat, a, b, cq.message.message_id);
  }

  if (!isGroup && nextStep(env, user) !== 'done') return askStep(env, user, chat.id, undefined, 'Let’s finish setting you up first.');

  if (ns === 'd') {
    const draft = user.draft ? JSON.parse(user.draft) : null;
    if (!draft) return send(env, chat.id, 'That trip has expired. Send me your trip again in one line.');
    if (a === 'go') return runSearch(env, user, chat, draft, false);
    if (a === 'dest') {
      const p = placeByCode(b);
      if (p) { draft.destination = p.code; delete draft.awaiting; delete draft.destCountry; }
      return continueDraft(env, user, chat, draft, false);
    }
    if (a === 'cmp') return compareCountry(env, user, chat, draft, b);
    if (a === 'm') { draft.depart = { type: 'month', value: b }; draft.flex = 'month'; delete draft.ret; return continueDraft(env, user, chat, draft, false); }
    if (a === 'flex' && ['exact', '3d', 'month'].includes(b)) { draft.flex = b; return continueDraft(env, user, chat, draft, false); }
    if (a === 'ad' && +b >= 1 && +b <= 9) { draft.adults = +b; draft.paxGuess = false; return continueDraft(env, user, chat, draft, false); }
    if (a === 'ch' && +b >= 0 && +b <= 8) { draft.children = +b; draft.paxGuess = false; return continueDraft(env, user, chat, draft, false); }
    if (a === 'mgo' && draft.multi) return startMulti(env, user, chat, draft, false);
    if (a === 'mchg' && draft.multi) return continueDraft(env, user, chat, draft, false);
    if (a === 'mn' && draft.multi && +b >= 1 && +b <= 60) { draft.nights = +b; return continueDraft(env, user, chat, draft, false); }
    if (a === 'mrm' && draft.multi) {
      draft.multi = draft.multi.filter((c) => c !== b);
      if (draft.multi.length === 1) { draft.destination = draft.multi[0]; delete draft.multi; } else draft.destination = draft.multi[0];
      return continueDraft(env, user, chat, draft, false);
    }
    if (a === 'way') { draft.oneWay = b === 'ow'; if (draft.oneWay) delete draft.ret; return continueDraft(env, user, chat, draft, false); }
    if (a === 'stay' && (STAYS[b] || b === 'any')) { draft.stay = b === 'any' ? null : b; delete draft.nights; return continueDraft(env, user, chat, draft, false); }
    if (a === 'visa') {
      const cc = data.split(':')[3];
      if (/^[A-Z]{2}$/.test(cc) && ['yes', 'no'].includes(b)) {
        await setCountryVisa(env, user.id, cc, b);
        await bump(env, `visa_answer_${b}`);
      }
      return continueDraft(env, user, chat, draft, false);
    }
    if (a === 'dates') return send(env, chat.id, 'Which month?', rows(nextMonths(6).map((m) => btn(fmtMonth(m), `d:m:${m}`)), 2));
    if (a === 'grp') {
      return send(env, chat.id, 'Who is travelling this time?', rows(Object.entries(PERSONAS).map(([k, v]) => btn(v.label, `d:p:${k}`)), 2));
    }
    if (a === 'p' && PERSONAS[b]) {
      draft.persona = b;
      if (b === 'couple' && (draft.adults || 1) < 2) draft.adults = 2;
      return continueDraft(env, user, chat, draft, false);
    }
    return null;
  }

  if (ns === 'r') {
    const s = await getSearch(env, b);
    if (!s) return send(env, chat.id, 'That search has expired. Send your trip again.');
    if (a === 'w') return createWatch(env, user, chat, s, limitsFor(user), isGroup);
    if (a === 'dates') return cheaperDates(env, user, chat, s, isGroup);
    if (a === 'alt') return similarPlaces(env, user, chat, s, isGroup);
    if (a === 'em') return emailPlan(env, user, chat, s);
    if (a === 'tk') return showToolkit(env, user, chat, s);
    return null;
  }

  if (ns === 'alt') {
    const s = await getSearch(env, a);
    const p = placeByCode(b);
    if (!s || !p) return null;
    const draft = { ...s.params.draft, destination: p.code };
    delete draft.destCountry;
    await saveDraft(env, user, draft, isGroup);
    return runSearch(env, user, chat, draft, isGroup);
  }

  if (ns === 'w' && a === 'off') return stopWatch(env, user, chat.id, Number(b));
  if (ns === 'bk' && ['y', 'n', 'x'].includes(a)) return onBookedAnswer(env, user, chat, a, b);
  if (ns === 'trip' && a === 'del') return removeTrip(env, user, chat.id, Number(b));
  if (ns === 'cur' && CURRENCIES.includes(a)) {
    await updateUser(env, user.id, { currency: a });
    return send(env, chat.id, `Done! I'll show prices in ${a.toUpperCase()} from now on.`);
  }
  if (ns === 'uv' && a === 'del' && /^[A-Z]{2}$/.test(b)) {
    await env.DB.prepare('DELETE FROM user_visas WHERE user_id = ? AND cc = ?').bind(user.id, b).run();
    return send(env, chat.id, `Removed. I'll ask about ${esc(countryName(b))} again next time it matters.`);
  }
  return null;
}

async function cheaperDates(env, user, chat, s, isGroup) {
  if (!(await checkSearchQuota(env, user, chat, isGroup))) return;
  const d = { ...s.params.draft, depart: { type: 'month', value: s.params.draft.depart.value.slice(0, 7) }, flex: 'month' };
  delete d.ret;
  const { res } = await fetchRanked(env, d, user);
  if (!res.items.length) return send(env, chat.id, 'No other dates with recent prices in that month yet.');
  const top = cheapestDates(res.items, 5);
  const lines = [`<b>Cheapest days in ${fmtMonth(d.depart.value)}</b> (${esc(placeName(d.origin))} → ${esc(placeName(d.destination))})`];
  const kb = [];
  for (const it of top) {
    lines.push(`${fmtDay(it.departure_at)}${it.return_at ? ` → ${fmtDay(it.return_at)}` : ''}: <b>${money(it.price, res.currency)}</b> · ${it.transfers === 0 ? 'direct' : `${it.transfers} stop(s)`}`);
    const href = await trackedLink(env, bookingUrl(env, it), user.id, 'flight');
    if (href) kb.push([url(`${fmtDay(it.departure_at)} · ${money(it.price, res.currency)}`, href)]);
  }
  return send(env, chat.id, lines.join('\n'), kb);
}

// Cheapest per city across a country (one search from the quota).
async function compareCountry(env, user, chat, draft, cc) {
  if (!(await checkSearchQuota(env, user, chat, false))) return;
  await typing(env, chat.id);
  const month = draft.depart ? draft.depart.value.slice(0, 7) : nextMonths(2)[1];
  const lines = [`<b>${esc(countryName(cc))} in ${fmtMonth(month)}</b>, cheapest seen per person:`];
  const kb = [];
  const ym = month;
  for (const code of citiesIn(cc).slice(0, 6)) {
    const d = { ...draft, destination: code, depart: { type: 'month', value: month }, flex: 'month' };
    delete d.ret; delete d.destCountry;
    const { res } = await fetchRanked(env, d, user);
    const w = describe(await climate(env, code), Number(ym.slice(5, 7)) - 1);
    const weather = w ? ` · ~${w.avg}°C, ${w.feel}` : '';
    if (res.items.length) {
      lines.push(`• <b>${esc(placeName(code))}</b> from ${money(Math.min(...res.items.map((i) => i.price)), res.currency)}${esc(weather)}`);
    } else lines.push(`• ${esc(placeName(code))}: no recent prices${esc(weather)}`);
    kb.push(btn(`Plan ${placeName(code)}`, `d:dest:${code}`));
  }
  draft.depart = draft.depart || { type: 'month', value: month };
  await saveDraft(env, user, draft, false);
  return send(env, chat.id, lines.join('\n'), rows(kb, 2));
}

// Similar places: same trip style, then weather and visa ease for this traveller.
async function similarPlaces(env, user, chat, s, isGroup) {
  if (!(await checkSearchQuota(env, user, chat, isGroup))) return;
  const d = s.params.draft;
  const dest = placeByCode(d.destination);
  const origin = placeByCode(d.origin);
  if (!dest) return null;
  const month = d.depart.value.slice(0, 7);
  const mi = Number(month.slice(5, 7)) - 1;
  const passports = list(user.passports);
  const held = list(user.visas);
  await typing(env, chat.id);
  const pool = PLACES
    .filter((p) => p.code !== dest.code && p.code !== d.origin && p.cc !== origin?.cc)
    .map((p) => ({ p, base: p.tags.filter((t) => dest.tags.includes(t)).length * 2 + (p.region === dest.region ? 1 : 0) }))
    .filter((x) => x.base >= 2)
    .sort((a, b) => b.base - a.base)
    .slice(0, 8);
  for (const c of pool) {
    c.visa = visaFor(passports, held, c.p.cc);
    c.weather = describe(await climate(env, c.p.code), mi);
    c.score = c.base + pleasantScore(c.weather) + (isEasy(c.visa) ? 2 : needsEmbassy(c.visa) ? -3 : 0);
  }
  pool.sort((a, b) => b.score - a.score);
  const lines = [`<b>Ideas like ${esc(dest.name)} for ${fmtMonth(month)}</b>${passports.length ? ', easiest visas first' : ''}:`];
  const kb = [];
  for (const c of pool) {
    if (passports.length && needsEmbassy(c.visa)) continue;
    const alt = { ...d, destination: c.p.code, depart: { type: 'month', value: month }, flex: 'month' };
    delete alt.ret;
    const { res } = await fetchRanked(env, alt, user);
    if (!res.items.length) continue;
    const cheapest = Math.min(...res.items.map((i) => i.price));
    let line = `• <b>${esc(c.p.name)}</b> from ${money(cheapest, res.currency)} pp`;
    if (c.weather) line += ` · ~${c.weather.avg}°C, ${esc(c.weather.feel)}`;
    if (c.visa && c.visa.code !== 'H') line += ` · 🛂 ${esc(c.visa.text)}`;
    lines.push(line);
    kb.push([btn(`Plan ${c.p.name}`, `alt:${s.id}:${c.p.code}`)]);
    if (kb.length >= 3) break;
  }
  if (!kb.length) return send(env, chat.id, 'I could not find recent prices for similar places that month. Try another month.');
  lines.push('<i>Visa info is a guide; always confirm on official government sites.</i>');
  return send(env, chat.id, lines.join('\n'), kb);
}

// ---------- the plan email: plain text, e-ticket layout, written like a note from Maya ----------
const ticketDate = (isoDate) => new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/^(\w+) /, '$1, ');
const shortDate = (isoDate, withMonth = true) => new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-GB', withMonth ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { day: 'numeric', timeZone: 'UTC' });
const plusDay = (fromDate, p) => (p && p.date > fromDate ? ` (+${Math.round((Date.parse(p.date) - Date.parse(fromDate)) / 86400000)})` : '');
const placeLabel = (code) => `${placeName(code)} (${code})`;

function ticketLeg(fromCode, toCode, depIso, minutes, arrTz, it, transfers, flightNo) {
  const dep = localParts(depIso);
  const arr = minutes ? arrivalLocal(depIso, minutes, arrTz) : null;
  return {
    date: ticketDate(dep.date),
    depTime: hhmm(dep), from: placeLabel(fromCode),
    arrTime: arr ? `${hhmm(arr)}${plusDay(dep.date, arr)}` : '', to: placeLabel(toCode),
    airline: airline(it.airline),
    flight: flightNo && /^\d{1,4}$/.test(String(flightNo)) ? `${it.airline} ${flightNo}` : '',
    stops: stopsText(fromCode, toCode, minutes, transfers, true),
    duration: minutes ? `${fmtDur(minutes)} total` : '',
  };
}

// Honest saving: the picks against the average of every fare we compared for these dates.
export function savingLines(items, ranked, cur, pax) {
  const seen = new Map();
  for (const it of items) seen.set(`${it.airline}|${it.flight_number}|${it.departure_at}|${it.return_at || ''}`, it);
  const all = [...seen.values()];
  const days = new Set(all.map((it) => it.departure_at.slice(0, 10))).size;
  const out = [];
  if (all.length >= 3) {
    const avg = all.reduce((a, it) => a + it.price, 0) / all.length;
    const low = Math.min(...ranked.map((r) => r.it.price));
    const save = Math.round((avg - low) / 10) * 10;
    if (save > 0 && save / avg >= 0.05) {
      out.push(`Average fare for these dates: ${money(Math.round(avg / 10) * 10, cur)} per person.`);
      out.push(`My cheapest pick: ${money(low, cur)}, so you save about ${money(save, cur)} each${pax > 1 ? ` (${money(save * pax, cur)} for all ${pax} of you)` : ''}.`);
    }
  }
  if (all.length) out.push(`⏱ I compared ${all.length} fares across ${days} day${days === 1 ? '' : 's'} for you, so there's no searching left to do.`);
  return out;
}

// ---------- fair use for "Email me this plan" ----------
// The chat is home; email is a copy for later. So, per person: the same plan only once a day,
// a short pause between emails, a few a day and a month, confirmed addresses only.
// For the whole bot, emailRoom() in email.js keeps us inside Resend's free plan.
const planSig = (d) => [d.origin, d.destination, d.depart?.value, d.ret?.value, d.oneWay ? 1 : 0, d.adults, d.children || 0, d.flex, d.stay, d.nights].join('|');
const hm = (sec) => new Date(sec * 1000).toISOString().slice(11, 16);

async function emailGate(env, user, d) {
  if (!user.email) return 'Add your email in /settings first and I’ll send plans there.';
  if (!emailReady(env)) return 'Email sending isn’t switched on yet. Your plan is right here in the chat.';
  if (!user.email_verified) return `Please confirm your email first (/settings → Email), ${firstName(user)}. I only send plans to confirmed addresses.`;
  const sent = await cacheGet(env, `emd:${user.id}:${planSig(d)}`);
  if (sent) return `I already emailed you this exact plan today at ${hm(sent)} UTC 📬\nCan't find it? Check Promotions or Spam and tap "Not spam".`;
  if (await cacheGet(env, `emcd:${user.id}`)) return 'I just sent you an email. Give it a couple of minutes before the next one 🙂';
  const perDay = Number(env.EMAIL_USER_DAY || 2);
  const perMonth = Number(env.EMAIL_USER_MONTH || 8);
  const usage = await getUsage(env, `u${user.id}`);
  if ((usage.emails || 0) >= perDay) return `That's ${perDay} emails today, ${firstName(user)}. Your plans stay right here in the chat, and you can email more tomorrow.`;
  if ((await counter(env, `em_u${user.id}`, monthKey())) >= perMonth) return `You've had ${perMonth} plan emails this month. Your plans stay right here in the chat 🙂`;
  const room = await emailRoom(env, 'plan');
  if (!room.ok) {
    await bump(env, 'email_capped');
    return 'Email is busy today, so I can’t send this one. Your plan stays right here in the chat, and you can try again tomorrow.';
  }
  return null;
}

async function emailPlan(env, user, chat, s) {
  const d = s.params.draft;
  const gate = await emailGate(env, user, d);
  if (gate) return send(env, chat.id, gate);
  const { res, ranked } = await fetchRanked(env, d, user);
  if (!ranked.length) return send(env, chat.id, 'Those prices have expired. Search again and I’ll email the fresh plan.');
  const cur = res.currency;
  const pax = (d.adults || 1) + (d.children || 0);
  const name = user.name || user.first_name || 'there';
  const dest = placeByCode(d.destination);
  const orig = placeByCode(d.origin);
  const destCc = dest?.cc;
  const top = ranked[0].it;

  const options = [];
  for (const [i, r] of ranked.entries()) {
    const it = r.it;
    const back = it.return_at ? backMinutes(it) : 0;
    options.push({
      title: `${LABEL_ICON[r.labels[0]] || '✈️'} OPTION ${i + 1} · ${r.labels.join(' · ').toUpperCase()} · ${airline(it.airline)}`,
      price: money(it.price, cur), total: pax > 1 ? money(it.price * pax, cur) : '',
      out: ticketLeg(d.origin, d.destination, it.departure_at, it.duration_to, dest?.tz, it, it.transfers, it.flight_number),
      back: it.return_at ? ticketLeg(d.destination, d.origin, it.return_at, back, orig?.tz, it, it.return_transfers ?? it.transfers, null) : null,
      why: r.reasons.why.length ? `Why I picked it: ${r.reasons.why.join(', ')}` : '',
      warn: r.reasons.warn.join('; '),
      href: await trackedLink(env, bookingUrl(env, it), user.id, 'email'),
    });
  }

  const dep = top.departure_at.slice(0, 10);
  const ret = top.return_at ? top.return_at.slice(0, 10) : null;
  const sameMonth = ret && dep.slice(0, 7) === ret.slice(0, 7);
  const range = ret ? `${shortDate(dep, !sameMonth)}–${shortDate(ret)}` : shortDate(dep);
  const nights = ret ? Math.round((Date.parse(ret) - Date.parse(dep)) / 86400000) : 0;
  const who = (PERSONAS[d.persona] || {}).label;
  const trip = [
    `${placeLabel(d.origin)} ${d.oneWay ? '→' : '⇄'} ${placeLabel(d.destination)} · ${d.oneWay ? 'One way' : 'Return'}`,
    ret ? `${ticketDate(dep)} – ${ticketDate(ret)} · ${nights} night${nights === 1 ? '' : 's'}` : ticketDate(dep),
    `${pax} traveller${pax === 1 ? '' : 's'}${d.children ? ` (${d.adults || 1} adult${(d.adults || 1) > 1 ? 's' : ''}, ${d.children} child${d.children > 1 ? 'ren' : ''})` : ''}${who ? ` · ${who}` : ''}`,
  ];
  if (ranked[0].perPersonBudget) trip.push(`Budget: ${money(ranked[0].perPersonBudget, cur)} per person`);

  const visa = [];
  const v = visaFor(list(user.passports), list(user.visas), destCc, yesCountries(await countryVisaMap(env, user.id)));
  if (v && v.code !== 'H') {
    const pp = v.passport ? ` with your ${countryName(v.passport)} passport` : '';
    const SHORT = { E: 'e-visa needed', V: 'visa needed from the embassy', T: 'online travel authorisation needed', A: 'visa on arrival', N: 'entry currently not allowed' };
    visa.push(`${countryName(destCc)}${pp}: ${v.held ? v.text : SHORT[v.code] || v.text}.`);
    if (v.code === 'E' || v.code === 'T') visa.push('Apply online a few weeks before you fly, so there is no last-minute stress.');
    if (v.code === 'V') visa.push('Apply at the embassy well ahead (often 3–6 weeks). Book refundable fares until it is approved.');
    if (needsEmbassy(v) && VISA_TIPS[destCc]) visa.push(VISA_TIPS[destCc]);
    if (['E', 'T'].includes(v.code) && OFFICIAL_EVISA[destCc]) visa.push(`Official site: ${OFFICIAL_EVISA[destCc]} (avoid look-alike agent sites)`);
  }
  const weather = [];
  const w = await weatherLine(env, d.origin, d.destination, top.departure_at.slice(0, 7));
  if (w) weather.push(w.line.replace(/^\P{L}+/u, ''));
  if (w && /rain/i.test(w.line)) weather.push('Pack a light rain jacket or a small umbrella.');
  const news = [];
  const n = await latestNewsFor(env, destCc);
  if (n) news.push(`${n.text}${n.source ? ` (${n.source})` : ''}${n.url ? `: ${n.url}` : ''}`);
  const pay = [];
  if (user.country === 'BD') {
    pay.push("Airlines' own Bangladesh websites take dual-currency cards for tickets, with no $300 limit.",
      'Paying in taka (bKash, Nagad, local card)? Foreign sites may decline Bangladeshi cards above $300.',
      'Same dates in taka: GoZayaan https://www.gozayaan.com or ShareTrip https://sharetrip.net');
  }
  const extras = await toolkit(env, toolkitContext(d, top), 4);
  const next = ['Pick the option you like and tap its "Book this" link. Fares change often, so booking within a day or two is safest.'];
  if (v && ['E', 'V', 'T'].includes(v.code)) next.push(`Apply for your ${countryName(destCc)} ${v.code === 'V' ? 'visa' : v.code === 'T' ? 'travel authorisation' : 'e-visa'}.`);
  next.push("Tell me in Telegram once you've booked, and I'll remind you before you fly with everything you need.");

  const bot = await getConfig(env, 'bot_username');
  const base = await publicUrl(env);
  const unsubUrl = base && user.marketing ? `${base}/unsub?u=${user.id}&s=${await unsubSig(env, user.id)}` : '';
  const mail = planEmail(env, {
    name,
    subject: `${name}, your ${placeName(d.origin)} ${d.oneWay ? '→' : '⇄'} ${placeName(d.destination)} flight plan (${range})`,
    intro: `I've compared the flights for your trip and picked the best ones for ${pax > 1 ? 'your group' : 'you'}. Everything you need is below: choose an option, tap its link, and book.`,
    trip, saving: savingLines(res.items, ranked, cur, pax), options, visa, weather, news, pay,
    extras: extras.map((x) => ({ text: x.text.replace(/^\P{L}+/u, ''), href: x.href })), next,
    chatUrl: bot ? `t.me/${bot}` : '', unsubUrl,
  });
  const r = await sendEmail(env, user.email, mail.subject, mail.html, mail.text, { unsubUrl });
  if (!r.ok) return send(env, chat.id, r.reason === 'not_configured' ? 'Email sending isn’t switched on yet. Your plan is right here in the chat.' : 'I couldn’t send the email right now. Please try again later.');
  await addUsage(env, `u${user.id}`, 'emails');
  await bump(env, `em_u${user.id}`, 1, monthKey());
  await cacheSet(env, `emd:${user.id}:${planSig(d)}`, nowSec(), 86400);
  await cacheSet(env, `emcd:${user.id}`, 1, Number(env.EMAIL_COOLDOWN_SEC || 120));
  return send(env, chat.id, `📧 Sent to ${esc(user.email)}. Check your inbox, ${firstName(user)}!\n<i>Not there in a minute? Look in Promotions or Spam and tap "Not spam", so the next one lands in your inbox.</i>`);
}

export { addDays };

async function showToolkit(env, user, chat, s) {
  const d = s.params.draft;
  const ctx = toolkitContext(d, null, d.origin);
  const items = await toolkit(env, ctx, 6);
  if (!items.length) return send(env, chat.id, 'Hotels, eSIMs and tours are coming soon here! 🧳');
  return send(env, chat.id, `🧳 <b>Trip toolkit for ${esc(placeName(d.destination))}</b>\nEverything else you might need, ${firstName(user)}:`, items.map((x) => [url(x.text, x.href)]));
}

async function startMulti(env, user, chat, draft, isGroup) {
  if (!(await checkSearchQuota(env, user, chat, isGroup))) return null;
  await typing(env, chat.id);
  if (!isGroup) for (const c of draft.multi) await noteInterest(env, user.id, { ...draft, destination: c });
  return runMulti(env, user, chat, draft, { firstName: firstName(user), airline, trackedLink, gearButton });
}

// "🎒 Pack: Universal travel adapter · Reef-safe sunscreen" → your /gear page (Amazon links live there).
export async function gearButton(env, user, draft, firstFare) {
  if (!storeFor(env, user.country)) return null;
  const base = await publicUrl(env);
  if (!base) return null;
  const dest = placeByCode(draft.destination);
  if (!dest) return null;
  const month = (firstFare?.departure_at || draft.depart?.value || '').slice(0, 7);
  const weather = month ? describe(await climate(env, dest.code), Number(month.slice(5, 7)) - 1) : null;
  const picks = gearPicks({
    homeCc: user.country, destCc: dest.cc, weather, persona: draft.persona, children: draft.children || 0,
    tags: dest.tags || [], longFlight: (firstFare?.duration_to || 0) >= 360, multi: !!draft.multi,
  });
  if (!picks.length) return null;
  return url(`🎒 Pack: ${picks.map((p) => p.name).join(' · ')}`.slice(0, 120), gearUrl(base, { homeCc: user.country, destCc: dest.cc, destName: dest.name, keys: picks.map((p) => p.key) }));
}
