// The conversation: a named, friendly assistant (clearly an AI) that remembers
// each traveller, understands one-line trip requests and replies with three
// kinds of picks: best overall, cheapest and most comfortable.

import {
  touchUser, updateUser, deleteUserData, getUsage, addUsage, bump, saveSearch, getSearch,
  saveLink, recordPrice, priceStats, getConfig, nowSec,
} from './db.js';
import { send, answer, typing, btn, url, rows, esc } from './tg.js';
import { parseTrip, missingField, addDays } from './parse.js';
import { aiParse } from './ai.js';
import { placeByCode, resolvePlace, POPULAR_FROM, PLACES } from './places.js';
import { citiesIn, countryName } from './countries.js';
import { searchFares, bookingUrl, liveSearchUrl, partnerLink } from './tp.js';
import { rankFares, cheapestDates, PERSONAS } from './rank.js';
import { handleAdmin, isAdmin } from './admin.js';
import { createWatch, listWatches, stopWatch } from './watch.js';
import { nextStep, askStep, onSetupText, onSetupCallback, onContact, profileText, assistant } from './onboarding.js';
import { visaFor, visaLine, isEasy, needsEmbassy } from './visa.js';
import { weatherLine, climate, describe, pleasantScore } from './weather.js';
import { sendEmail, planEmail } from './email.js';

const MAX_TEXT = 300;
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

// ---------------- helpers ----------------
export const money = (amount, cur) => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase(), maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString('en-US')} ${cur.toUpperCase()}`;
  }
};

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
};
const airline = (c) => AIRLINES[c] || c || 'Airline';
const LABEL_ICON = { 'Best overall': '⭐', Cheapest: '💰', 'Most comfortable': '🛋️', 'Also good': '👍' };

const fmtDur = (min) => (min ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : '');
const fmtDay = (iso) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtMonth = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const hhmm = (p) => `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
const placeName = (code) => placeByCode(code)?.name || code;
const firstName = (u) => (u?.name ? esc(u.name) : 'there');

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

export async function trackedLink(env, href, userId, kind) {
  if (!href) return null;
  const base = await publicUrl(env);
  if (!base) return href;
  const id = await saveLink(env, href, userId, kind);
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

/plan new trip · /watches price watches · /profile what I remember · /settings change details · /privacy · /delete`;

// ---------------- trip flow ----------------
function quotaKey(user, chat, isGroup) { return isGroup ? `g${chat.id}` : `u${user.id}`; }

async function onTripText(env, user, chat, text, isGroup) {
  const now = new Date();
  const prev = !isGroup && user.draft ? JSON.parse(user.draft) : null;

  if (prev && prev.awaiting) {
    const place = resolvePlace(text);
    if (prev.awaiting === 'destination' && place) { prev.destination = place.code; delete prev.awaiting; delete prev.destCountry; return continueDraft(env, user, chat, prev, isGroup); }
    if (prev.awaiting === 'origin' && place) { prev.origin = place.code; delete prev.awaiting; return continueDraft(env, user, chat, prev, isGroup); }
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
  if (!draft.persona && user.persona) draft.persona = user.persona;
  if (!draft.adults) draft.adults = draft.persona === 'couple' ? 2 : 1;
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
  if (isGroup) return runSearch(env, user, chat, draft, isGroup);
  return send(env, chat.id, summary(env, user, draft), confirmKeyboard(draft));
}

function confirmKeyboard(d) {
  const kb = [[btn('✅ Search', 'd:go')]];
  if (d.depart.type === 'date') {
    const mark = (f) => (d.flex === f ? '✅ ' : '');
    kb.push([btn(`${mark('exact')}Exact dates`, 'd:flex:exact'), btn(`${mark('3d')}± 3 days`, 'd:flex:3d'), btn(`${mark('month')}Any day that month`, 'd:flex:month')]);
  }
  kb.push([btn('👥 Change group', 'd:grp'), btn('📅 Change month', 'd:dates')]);
  return kb;
}

function summary(env, user, d) {
  const pax = (d.adults || 1) + (d.children || 0);
  const who = d.persona ? PERSONAS[d.persona].label : (pax === 1 ? 'Solo' : `${pax} travellers`);
  const people = d.children ? `${d.adults} adults, ${d.children} children` : `${pax} ${pax === 1 ? 'person' : 'people'}`;
  let when;
  if (d.depart.type === 'month' || d.flex === 'month') when = `${fmtMonth(d.depart.value.slice(0, 7))} (any days)`;
  else {
    when = `${fmtDay(d.depart.value)}${d.ret ? ` → ${fmtDay(d.ret.value)}` : ''}`;
    when += d.flex === '3d' ? ' (± 3 days)' : ' (exact)';
  }
  const lines = [
    `Got it, ${firstName(user)}! Here's what I understood:`,
    `✈️ ${esc(placeName(d.origin))} (${d.origin}) → ${esc(placeName(d.destination))} (${d.destination})${d.oneWay ? ', one way' : ''}`,
    `📅 ${when}${d.nights && d.depart.type === 'month' ? `, about ${d.nights} nights` : ''}`,
    `👥 ${who} · ${people}`,
  ];
  if (d.budget) lines.push(`💰 Budget ${money(d.budget.amount, d.budget.currency || 'usd')} ${d.budget.perPerson ? 'per person' : 'in total'}`);
  if (d.direct) lines.push('Direct flights only');
  if (d.seasonNote) lines.push(`<i>${esc(d.seasonNote)}</i>`);
  const v = visaFor(list(user.passports), list(user.visas), placeByCode(d.destination)?.cc);
  if (needsEmbassy(v)) lines.push(`\n⚠️ Heads-up: ${esc(countryName(placeByCode(d.destination).cc))} needs ${v.code === 'N' ? 'special permission' : 'an embassy visa'} for your passport. That can take weeks, so apply early. Tap 🌏 Easier places after searching for visa-friendly ideas.`);
  if (d.depart.type === 'date') lines.push('\nAre your dates fixed, or can you move them a little? Flexible dates often save money.');
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

  const msg = await formatResults(env, user, draft, ranked, res.currency, pax, stats, best);
  const keyboard = [];
  for (const r of ranked) {
    const href = await trackedLink(env, bookingUrl(env, r.it), user.id, 'flight');
    if (href) keyboard.push([url(`${LABEL_ICON[r.labels[0]]} Book ${r.labels[0].toLowerCase()} · ${money(r.it.price, res.currency)}`, href)]);
  }
  keyboard.push([btn('🔔 Track this trip', `r:w:${searchId}`), btn('📅 Cheaper dates', `r:dates:${searchId}`)]);
  const v = visaFor(list(user.passports), list(user.visas), placeByCode(draft.destination)?.cc);
  keyboard.push([btn(needsEmbassy(v) ? '🌏 Easier places' : '🌏 Similar places', `r:alt:${searchId}`), btn('✏️ Change', 'd:grp')]);
  if (!isGroup && user.email) keyboard.push([btn('📧 Email me this plan', `r:em:${searchId}`)]);
  for (const ex of await extrasFor(env, user, draft, ranked)) keyboard.push([url(ex.text, ex.href)]);
  return send(env, chat.id, msg, keyboard);
}

function pickLines(r, cur, pax) {
  const it = r.it;
  const stopsTxt = it.transfers === 0 ? 'direct' : `${it.transfers} stop${it.transfers > 1 ? 's' : ''}`;
  const lines = [
    '',
    `${r.labels.map((l) => `${LABEL_ICON[l]} <b>${l}</b>`).join(' · ')}`,
    `<b>${money(it.price, cur)}</b> per person${pax > 1 ? ` · about ${money(it.price * pax, cur)} for ${pax}` : ''}`,
    `${esc(airline(it.airline))} · ${stopsTxt}${it.duration_to ? ` · ${fmtDur(it.duration_to)}` : ''}`,
    `Out ${fmtDay(it.departure_at)} ${hhmm(r.dep)}${r.arr ? ` → lands about ${hhmm(r.arr)} local` : ''}`,
  ];
  if (it.return_at) lines.push(`Back ${fmtDay(it.return_at)} ${hhmm({ hour: +it.return_at.slice(11, 13), minute: +it.return_at.slice(14, 16) })}`);
  if (r.reasons.why.length) lines.push(`✅ ${r.reasons.why.join(', ')}`);
  if (r.reasons.warn.length) lines.push(`⚠️ ${r.reasons.warn.join('; ')}`);
  return lines.join('\n');
}

async function formatResults(env, user, draft, ranked, cur, pax, stats, best) {
  const who = (PERSONAS[draft.persona] || {}).label;
  const out = [`Here's what I found, ${firstName(user)} 👇`, `<b>${esc(placeName(draft.origin))} → ${esc(placeName(draft.destination))}</b>${who ? ` · for a ${esc(who.toLowerCase())}` : ''}`];
  if (stats && stats.n >= 3 && stats.low) {
    out.push(best <= stats.low ? '📉 Lowest price I have seen for this route this month.' : `Lowest I've seen recently: ${money(stats.low, cur)}.`);
  }
  for (const r of ranked) out.push(pickLines(r, cur, pax));
  out.push('');
  const w = await weatherLine(env, draft.origin, draft.destination, ranked[0].it.departure_at.slice(0, 7));
  if (w) out.push(esc(w.line));
  const destCc = placeByCode(draft.destination)?.cc;
  const vl = visaLine(visaFor(list(user.passports), list(user.visas), destCc), destCc);
  if (vl) out.push(vl);
  if (user.country === 'BD') {
    if (user.pay === 'intl') out.push('💳 Tip: airlines\' own Bangladesh websites accept dual-currency cards for tickets with no $300 limit.');
    else out.push('💳 Paying in taka (bKash, Nagad, local card)? Foreign sites may decline Bangladeshi cards above $300. Compare the same dates on <a href="https://www.gozayaan.com">GoZayaan</a> or <a href="https://sharetrip.net">ShareTrip</a>, or the airline\'s own Bangladesh site.');
  }
  out.push(`<i>Prices were seen by travellers in the last 48 h; the booking site shows the live price${pax > 1 ? ' (children\'s fares may differ)' : ''}.</i>`);
  return out.join('\n');
}

async function extrasFor(env, user, draft, ranked) {
  const enabled = String(env.EXTRAS_ENABLED || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!enabled.length) return [];
  const dest = placeByCode(draft.destination);
  const top = ranked[0];
  const extras = [];
  if (enabled.includes('transfer') && ranked.some((r) => r.late) && (draft.persona === 'family' || draft.persona === 'women')) {
    const l = await partnerLink(env, 'https://holidaytaxis.com/');
    if (l) extras.push({ text: '🚕 Pre-book an airport transfer', href: l });
  }
  if (enabled.includes('hotels') && dest && top?.it?.return_at) {
    const pax = (draft.adults || 1) + (draft.children || 0);
    const target = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(dest.name)}&checkin=${top.it.departure_at.slice(0, 10)}&checkout=${top.it.return_at.slice(0, 10)}&group_adults=${draft.adults || 1}&group_children=${draft.children || 0}&no_rooms=${Math.max(1, Math.ceil(pax / 3))}`;
    const l = await partnerLink(env, target);
    if (l) extras.push({ text: `🏨 Hotels in ${dest.name} for these dates`, href: l });
  }
  if (enabled.includes('esim') && dest && dest.cc !== placeByCode(draft.origin)?.cc) {
    const l = await partnerLink(env, 'https://yesim.app/');
    if (l) extras.push({ text: '📶 Travel eSIM (data on landing)', href: l });
  }
  if (enabled.includes('lounge') && ranked.some((r) => r.it.transfers > 0 && r.it.duration_to > 600)) {
    const l = await partnerLink(env, 'https://www.prioritypass.com/');
    if (l) extras.push({ text: '🛋️ Lounge access for the long layover', href: l });
  }
  return extras.slice(0, 2);
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
    const weather = w ? ` · ${w.hi}°, ${w.feel}` : '';
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
    if (c.weather) line += ` · ${c.weather.hi}°, ${esc(c.weather.feel)}`;
    if (c.visa && c.visa.code !== 'H') line += ` · 🛂 ${esc(c.visa.text)}`;
    lines.push(line);
    kb.push([btn(`Plan ${c.p.name}`, `alt:${s.id}:${c.p.code}`)]);
    if (kb.length >= 3) break;
  }
  if (!kb.length) return send(env, chat.id, 'I could not find recent prices for similar places that month. Try another month.');
  lines.push('<i>Visa info is a guide; always confirm on official government sites.</i>');
  return send(env, chat.id, lines.join('\n'), kb);
}

async function emailPlan(env, user, chat, s) {
  if (!user.email) return send(env, chat.id, 'Add your email in /settings first and I’ll send plans there.');
  const usage = await getUsage(env, `u${user.id}`);
  if ((usage.emails || 0) >= 3) return send(env, chat.id, "I've sent you 3 emails today already. Try again tomorrow!");
  const d = s.params.draft;
  const { res, ranked } = await fetchRanked(env, d, user);
  if (!ranked.length) return send(env, chat.id, 'Those prices have expired. Search again and I’ll email the fresh plan.');
  const pax = (d.adults || 1) + (d.children || 0);
  const picks = [];
  for (const r of ranked) {
    picks.push({
      label: r.labels.join(' · '), price: money(r.it.price, res.currency), total: pax > 1 ? money(r.it.price * pax, res.currency) : '',
      airline: airline(r.it.airline), stops: r.it.transfers === 0 ? 'direct' : `${r.it.transfers} stop(s)`,
      out: `Out ${fmtDay(r.it.departure_at)} ${hhmm(r.dep)}${r.arr ? `, lands about ${hhmm(r.arr)} local` : ''}`,
      back: r.it.return_at ? `Back ${fmtDay(r.it.return_at)}` : '',
      why: r.reasons.why.join(', '), warn: r.reasons.warn.join('; '),
      href: await trackedLink(env, bookingUrl(env, r.it), user.id, 'email'),
    });
  }
  const notes = [];
  const w = await weatherLine(env, d.origin, d.destination, ranked[0].it.departure_at.slice(0, 7));
  if (w) notes.push(w.line);
  const destCc = placeByCode(d.destination)?.cc;
  const v = visaFor(list(user.passports), list(user.visas), destCc);
  if (v && v.code !== 'H') notes.push(`Visa: ${v.text}. Always confirm on the official government site.`);
  const title = `Your trip: ${placeName(d.origin)} → ${placeName(d.destination)}`;
  const mail = planEmail(env, user.name || 'there', title, picks, notes);
  const r = await sendEmail(env, user.email, mail.subject, mail.html, mail.text);
  if (!r.ok) return send(env, chat.id, r.reason === 'not_configured' ? 'Email sending isn’t switched on yet. Your plan is right here in the chat.' : 'I couldn’t send the email right now. Please try again later.');
  await addUsage(env, `u${user.id}`, 'emails');
  return send(env, chat.id, `📧 Sent to ${esc(user.email)}. Check your inbox, ${firstName(user)}!`);
}

export { addDays };
