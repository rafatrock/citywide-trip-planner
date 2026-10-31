// One-time profile questions, asked once and remembered:
// name → home city → passport(s) → visas held → email (+code) → WhatsApp (optional)
// → email offers consent → payment method (Bangladesh) → usual travel group.

import { updateUser, ownerOf, getUsage, addUsage, bump, nowSec } from './db.js';
import { send, edit, btn, rows, esc, tg } from './tg.js';
import { placeByCode, resolvePlace, currencyFor, findPlaces } from './places.js';
import { resolveCountry, countryName, flag } from './countries.js';
import { KNOWN_PASSPORTS, HELD_VISAS } from './visa.js';
import { PERSONAS } from './rank.js';
import { normalizeEmail, isDisposable, domainAcceptsMail, emailReady, sendEmail, sixDigitCode, codeEmail, normalizePhone } from './email.js';

export const assistant = (env) => env.ASSISTANT_NAME || 'Maya';
const requireEmail = (env) => String(env.REQUIRE_EMAIL ?? 'true') !== 'false';
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function nextStep(env, u) {
  if (!u.name) return 'name';
  if (!u.home) return 'home';
  if (!u.passports) return 'passport';
  if (!u.visas_asked) return 'visas';
  if (u.email_code) return 'email_code';
  if (!u.email && requireEmail(env)) return 'email';
  if (!u.phone_asked) return 'phone';
  if (!u.consent_at) return 'consent';
  if (u.country === 'BD' && !u.pay) return 'pay';
  if (!u.persona) return 'persona';
  return 'done';
}

const ORDER = ['name', 'home', 'passport', 'visas', 'email', 'phone', 'consent', 'persona'];
const progress = (step) => {
  const i = ORDER.indexOf(step === 'email_code' ? 'email' : step === 'pay' ? 'persona' : step);
  return i >= 0 ? `<i>Step ${i + 1} of ${ORDER.length}</i>\n` : '';
};

const removeKeyboard = { reply_markup: { remove_keyboard: true } };

export async function askStep(env, u, chatId, step = nextStep(env, u), lead = '') {
  const p = progress(step);
  const L = lead ? `${lead}\n\n` : '';
  switch (step) {
    case 'name':
      return send(env, chatId, `${L}${p}What should I call you? Your first name, last name or a nickname, whatever you like.`,
        u.first_name ? [[btn(`Call me ${u.first_name.slice(0, 20)}`, 'set:name:tg')]] : null);
    case 'home': {
      const choices = ['DAC', 'LON', 'NYC', 'DEL', 'SYD', 'YTO', 'DXB', 'SIN'];
      return send(env, chatId, `${L}${p}Which city do you usually fly from? Tap one or type it.`, rows(choices.map((c) => btn(placeByCode(c).name, `set:home:${c}`)), 2));
    }
    case 'passport':
      return send(env, chatId, `${L}${p}${passportPrompt(u)}`, passportKeyboard(u));
    case 'visas':
      return send(env, chatId, `${L}${p}${visasPrompt(u)}`, visasKeyboard(u));
    case 'email':
      return send(env, chatId, `${L}${p}What's your email address? I'll send your trip plans there, so you can find them later.${requireEmail(env) ? '' : '\n(You can skip this.)'}`,
        requireEmail(env) ? null : [[btn('Skip for now', 'set:email:skip')]]);
    case 'email_code':
      return send(env, chatId, `${L}I've emailed you a 6-digit code. Type it here (check spam if you don't see it).`, [[btn('Send a new code', 'set:email:resend'), btn('Change email', 'set:email:change')]]);
    case 'phone':
      return send(env, chatId, `${L}${p}Your WhatsApp number, in case you'd like updates there later (optional). Tap the button to share your Telegram number, type another number with country code (e.g. +8801712345678), or skip.`, null, {
        reply_markup: { keyboard: [[{ text: '📱 Share my number', request_contact: true }], [{ text: 'Skip' }]], one_time_keyboard: true, resize_keyboard: true },
      });
    case 'consent':
      return send(env, chatId, `${L}${p}Can I also email you travel deals and tips now and then? You can stop anytime. Trip plans you ask for are sent either way.`, [
        [btn('Yes, send me deals', 'set:mk:1')], [btn('No, only my trip plans', 'set:mk:0')],
      ]);
    case 'pay':
      return send(env, chatId, `${L}How do you usually pay for tickets? So I send you to a site that accepts your payment.`, [
        [btn('bKash / Nagad', 'set:pay:bkash')], [btn('Local debit/credit card', 'set:pay:local')], [btn('Dual-currency (international) card', 'set:pay:intl')],
      ]);
    case 'persona':
      return send(env, chatId, `${L}${p}Last one: who usually travels with you?`, rows(Object.entries(PERSONAS).map(([k, v]) => btn(v.label, `set:p:${k}`)), 2));
    default:
      return send(env, chatId, `${L}All set, ${esc(u.name)}! 🎉 Tell me your trip in one line, the way you'd tell a friend:\n<i>"Me and 3 friends, ${esc(placeByCode(u.home)?.name || 'Dhaka')} to Bangkok in December, max budget per person"</i>\n\nTip: add me to your family or friends' Telegram group so everyone sees the same deals.`, null, removeKeyboard);
  }
}

// ---------- passports (multi-select, up to 3) ----------
function suggestedPassports(u) {
  const base = [u.country, 'BD', 'IN', 'PK', 'GB', 'US', 'CA', 'AU'].filter(Boolean);
  return [...new Set([...list(u.passports), ...base])].filter((c) => KNOWN_PASSPORTS.includes(c)).slice(0, 8);
}
function passportPrompt(u) {
  const sel = list(u.passports);
  return `Which passport(s) do you hold? I use this to check visas for you. Tap up to 3, or type a country.${sel.length ? `\nSelected: ${sel.map((c) => `${flag(c)} ${countryName(c)}`).join(', ')}` : ''}`;
}
function passportKeyboard(u) {
  const sel = list(u.passports);
  const kb = rows(suggestedPassports(u).map((c) => btn(`${sel.includes(c) ? '✅ ' : ''}${flag(c)} ${countryName(c)}`, `set:pp:${c}`)), 2);
  if (sel.length) kb.push([btn('Done ✔️', 'set:ppdone')]);
  return kb;
}

// ---------- visas already held (multi-select) ----------
function visasPrompt(u) {
  const sel = list(u.visas);
  return `Do you have any valid visas or residence permits? They can open up more places for you.${sel.length ? `\nSelected: ${sel.map((v) => HELD_VISAS[v].label).join(', ')}` : ''}`;
}
function visasKeyboard(u) {
  const sel = list(u.visas);
  const kb = rows(Object.entries(HELD_VISAS).map(([k, v]) => btn(`${sel.includes(k) ? '✅ ' : ''}${v.label}`, `set:visa:${k}`)), 2);
  kb.push([btn(sel.length ? 'Done ✔️' : 'None', 'set:visadone')]);
  return kb;
}

// ---------- typed answers ----------
export async function onSetupText(env, u, chat, text, msg) {
  const step = nextStep(env, u);
  const t = text.trim();
  if (/^skip$/i.test(t) && step === 'phone') {
    await updateUser(env, u.id, { phone_asked: 1 });
    return askStep(env, { ...u, phone_asked: 1 }, chat.id, undefined, 'No problem.');
  }
  switch (step) {
    case 'name': {
      const name = t.replace(/\s+/g, ' ');
      const looksLikeTrip = name.split(' ').length > 3 || /\b(to|from|trip|flight|fly|going)\b/i.test(name) || findPlaces(name).length > 0;
      if (looksLikeTrip) return send(env, chat.id, "I'll plan that with you in a minute! 😊 First, what should I call you?");
      if (!/^[\p{L}][\p{L}\p{M} .'-]{0,29}$/u.test(name)) return send(env, chat.id, 'Just a name please, letters only (up to 30), e.g. <i>Rahim</i> or <i>Mitu</i>.');
      await updateUser(env, u.id, { name });
      return askStep(env, { ...u, name }, chat.id, undefined, `Lovely to meet you, ${esc(name)}! 😊`);
    }
    case 'home': {
      const place = resolvePlace(t);
      if (!place) return send(env, chat.id, "I don't know that city yet. Try a nearby big city or its airport code (e.g. DAC, LHR, JFK).");
      return setHome(env, u, chat.id, place);
    }
    case 'passport': {
      const cc = resolveCountry(t, KNOWN_PASSPORTS);
      if (!cc) return send(env, chat.id, "I couldn't find that country. Try its English name, e.g. <i>Bangladesh</i> or <i>United Kingdom</i>.");
      return togglePassport(env, u, chat.id, cc, null);
    }
    case 'email':
      return takeEmail(env, u, chat.id, t);
    case 'email_code':
      return checkCode(env, u, chat.id, t);
    case 'phone': {
      const phone = normalizePhone(t);
      if (!phone) return send(env, chat.id, 'Please type the number with country code, e.g. <i>+8801712345678</i>, or tap Skip.');
      return savePhone(env, u, chat.id, phone, 'typed');
    }
    default:
      return askStep(env, u, chat.id, step, 'Please tap one of the buttons below 👇');
  }
}

// Telegram "share contact" message
export async function onContact(env, u, chat, contact) {
  if (nextStep(env, u) !== 'phone') return null;
  if (contact.user_id && contact.user_id !== u.id) return send(env, chat.id, 'Please share your own number with the button, or type it.');
  const phone = normalizePhone(contact.phone_number);
  if (!phone) return send(env, chat.id, "That number didn't look right. Please type it with country code, or tap Skip.");
  return savePhone(env, u, chat.id, phone, 'telegram');
}

async function savePhone(env, u, chatId, phone, source) {
  const owner = await ownerOf(env, 'phone', phone);
  if (owner && owner !== u.id) {
    await bump(env, 'dup_phone');
    return send(env, chatId, 'That number is already linked to another account. Type a different number or tap Skip.');
  }
  await updateUser(env, u.id, { phone, phone_source: source, phone_asked: 1 });
  return askStep(env, { ...u, phone, phone_asked: 1 }, chatId, undefined, '📱 Saved.');
}

async function takeEmail(env, u, chatId, text) {
  const email = normalizeEmail(text);
  if (!email) return send(env, chatId, "That doesn't look like an email address. Please type it like <i>name@example.com</i>.");
  if (isDisposable(email)) return send(env, chatId, 'Please use your everyday email, not a temporary one.');
  const owner = await ownerOf(env, 'email', email);
  if (owner && owner !== u.id) {
    await bump(env, 'dup_email');
    return send(env, chatId, 'That email is already linked to another Telegram account. Please use a different one.');
  }
  if (!(await domainAcceptsMail(email))) return send(env, chatId, `I can't find a mail server for <i>${esc(email.split('@')[1])}</i>. Please check for typos.`);
  if (!emailReady(env)) {
    await updateUser(env, u.id, { email, email_verified: 0 });
    return askStep(env, { ...u, email }, chatId, undefined, '📧 Got it.');
  }
  return sendCode(env, u, chatId, email);
}

async function sendCode(env, u, chatId, email) {
  const key = `u${u.id}`;
  const usage = await getUsage(env, key);
  if ((usage.emails || 0) >= 3) return send(env, chatId, "I've sent 3 codes today. Please try again tomorrow, or tap Change email.");
  const code = sixDigitCode();
  const msg = codeEmail(env, u.name || 'there', code);
  const r = await sendEmail(env, email, msg.subject, msg.html, msg.text);
  await addUsage(env, key, 'emails');
  if (!r.ok) {
    // email service down or at its daily cap: accept the address unverified rather than block the user
    await updateUser(env, u.id, { email, email_verified: 0, email_code: null });
    return askStep(env, { ...u, email, email_code: null }, chatId, undefined, "📧 Saved. (I couldn't send a confirmation code right now; I'll confirm it later.)");
  }
  await updateUser(env, u.id, { email_code: `${await sha256(code)}|${email}`, email_code_exp: nowSec() + 900, email_tries: 0 });
  return askStep(env, { ...u, email_code: 'pending' }, chatId, 'email_code', `📧 Sent a code to <b>${esc(email)}</b>.`);
}

async function checkCode(env, u, chatId, text) {
  const [hash, email] = String(u.email_code || '').split('|');
  const code = text.replace(/\D/g, '');
  if (!hash || !email) { await updateUser(env, u.id, { email_code: null }); return askStep(env, { ...u, email_code: null }, chatId, 'email'); }
  if ((u.email_code_exp || 0) < nowSec()) return send(env, chatId, 'That code has expired.', [[btn('Send a new code', 'set:email:resend'), btn('Change email', 'set:email:change')]]);
  if ((u.email_tries || 0) >= 5) return send(env, chatId, 'Too many wrong tries.', [[btn('Send a new code', 'set:email:resend'), btn('Change email', 'set:email:change')]]);
  if (code.length !== 6 || (await sha256(code)) !== hash) {
    await updateUser(env, u.id, { email_tries: (u.email_tries || 0) + 1 });
    return send(env, chatId, "That code doesn't match. Please try again.");
  }
  const owner = await ownerOf(env, 'email', email);
  if (owner && owner !== u.id) return send(env, chatId, 'That email was just linked to another account. Please use a different one.', [[btn('Change email', 'set:email:change')]]);
  await updateUser(env, u.id, { email, email_verified: 1, email_code: null, email_code_exp: null, email_tries: 0 });
  await bump(env, 'emails_verified');
  return askStep(env, { ...u, email, email_code: null }, chatId, undefined, '✅ Email confirmed.');
}

export async function setHome(env, u, chatId, place) {
  const fields = { home: place.code, country: place.cc, currency: currencyFor(place.cc) };
  await updateUser(env, u.id, fields);
  return askStep(env, { ...u, ...fields }, chatId, undefined, `🏠 Home: <b>${esc(place.name)}</b>.`);
}

async function togglePassport(env, u, chatId, cc, messageId) {
  let sel = list(u.passports);
  if (sel.includes(cc)) sel = sel.filter((c) => c !== cc);
  else if (sel.length < 3) sel.push(cc);
  const passports = sel.join(',');
  await updateUser(env, u.id, { passports: passports || null });
  const nu = { ...u, passports };
  if (messageId) return edit(env, chatId, messageId, `${progress('passport')}${passportPrompt(nu)}`, passportKeyboard(nu));
  return send(env, chatId, `${progress('passport')}${passportPrompt(nu)}`, passportKeyboard(nu));
}

// ---------- button taps during setup (callback data "set:…") ----------
export async function onSetupCallback(env, u, chat, a, b, messageId) {
  switch (a) {
    case 'name':
      if (b === 'tg' && u.first_name) {
        const name = u.first_name.slice(0, 30);
        await updateUser(env, u.id, { name });
        return askStep(env, { ...u, name }, chat.id, undefined, `Lovely to meet you, ${esc(name)}! 😊`);
      }
      return null;
    case 'home': { const p = placeByCode(b); return p ? setHome(env, u, chat.id, p) : null; }
    case 'pp':
      if (!KNOWN_PASSPORTS.includes(b)) return null;
      // the "Selected" state lives in the database, so keep this message in sync by editing it
      return togglePassport(env, { ...u, passports: u.passports }, chat.id, b, messageId);
    case 'ppdone':
      if (!list(u.passports).length) return null;
      return askStep(env, u, chat.id, 'visas', `🛂 Passport${list(u.passports).length > 1 ? 's' : ''} saved.`);
    case 'visa': {
      if (!HELD_VISAS[b]) return null;
      let sel = list(u.visas);
      sel = sel.includes(b) ? sel.filter((x) => x !== b) : [...sel, b];
      const nu = { ...u, visas: sel.join(',') };
      await updateUser(env, u.id, { visas: nu.visas || null });
      return edit(env, chat.id, messageId, `${progress('visas')}${visasPrompt(nu)}`, visasKeyboard(nu));
    }
    case 'visadone':
      await updateUser(env, u.id, { visas_asked: 1 });
      return askStep(env, { ...u, visas_asked: 1 }, chat.id, undefined, 'Noted. 👍');
    case 'email':
      if (b === 'skip' && !requireEmail(env)) {
        await updateUser(env, u.id, { email: null });
        return askStep(env, { ...u, email: null, email_skipped: true }, chat.id, 'phone');
      }
      if (b === 'change') {
        await updateUser(env, u.id, { email_code: null });
        return askStep(env, { ...u, email_code: null, email: null }, chat.id, 'email');
      }
      if (b === 'resend') {
        const email = String(u.email_code || '').split('|')[1];
        return email ? sendCode(env, u, chat.id, email) : askStep(env, { ...u, email_code: null }, chat.id, 'email');
      }
      return null;
    case 'mk':
      await updateUser(env, u.id, { marketing: b === '1' ? 1 : 0, consent_at: nowSec() });
      if (b === '1') await bump(env, 'marketing_optins');
      return askStep(env, { ...u, marketing: b === '1' ? 1 : 0, consent_at: nowSec() }, chat.id, undefined, b === '1' ? 'Great, I’ll only send the good ones. ✈️' : 'Sure, only your trip plans.');
    case 'pay':
      await updateUser(env, u.id, { pay: b });
      return askStep(env, { ...u, pay: b }, chat.id, undefined, 'Thanks, noted.');
    case 'p':
      if (!PERSONAS[b]) return null;
      await updateUser(env, u.id, { persona: b, setup_step: 'done' });
      return askStep(env, { ...u, persona: b }, chat.id, 'done');
    default:
      return null;
  }
}

// /profile: what we remember
export function profileText(env, u) {
  const pp = list(u.passports).map((c) => `${flag(c)} ${countryName(c)}`).join(', ') || '—';
  const vv = list(u.visas).map((v) => HELD_VISAS[v]?.label).filter(Boolean).join(', ') || 'none';
  return [`<b>What I remember about you</b>`,
    `Name: ${esc(u.name || '—')}`,
    `Home: ${esc(placeByCode(u.home)?.name || '—')}`,
    `Passports: ${pp}`,
    `Visas held: ${vv}`,
    `Email: ${esc(u.email || '—')}${u.email ? (u.email_verified ? ' ✅' : ' (not confirmed)') : ''}`,
    `WhatsApp: ${esc(u.phone || '—')}`,
    `Deals by email: ${u.marketing ? 'yes' : 'no'}`,
    `Usually travels as: ${esc(PERSONAS[u.persona]?.label || '—')}`,
    '', 'Change anything with /settings (asks again from the start), or erase it all with /delete.'].join('\n');
}

export async function resetProfile(env, u) {
  await updateUser(env, u.id, {
    name: null, home: null, passports: null, visas: null, visas_asked: 0, email: null, email_verified: 0, email_code: null,
    phone: null, phone_asked: 0, consent_at: null, pay: null, persona: null, setup_step: 'name',
  });
}

export { tg };
