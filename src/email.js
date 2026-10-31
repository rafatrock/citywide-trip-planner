// Email: address checks, verification codes and trip-plan emails.
// Sending uses Resend (free: 3,000 emails/month, 100/day). Until RESEND_API_KEY
// is set, addresses are format- and domain-checked but not code-verified.

import { bump, counter, countFetch } from './db.js';

const DISPOSABLE = ['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com',
  'trashmail.com', 'getnada.com', 'sharklasers.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com',
  'mintemail.com', 'emailondeck.com', 'tempmailo.com', 'moakt.com', 'mohmal.com', 'burnermail.io', 'mail.tm'];

export function normalizeEmail(s) {
  const e = String(s || '').trim().toLowerCase();
  if (e.length > 120) return null;
  if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(e)) return null;
  return e;
}

export function isDisposable(email) {
  const domain = email.split('@')[1];
  return DISPOSABLE.some((d) => domain === d || domain.endsWith(`.${d}`));
}

// Does the domain accept email? (MX record lookup over Cloudflare DNS-over-HTTPS, free.)
export async function domainAcceptsMail(email) {
  const domain = email.split('@')[1];
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000),
    });
    const j = await res.json();
    return Array.isArray(j.Answer) && j.Answer.length > 0;
  } catch {
    return true; // don't block people if DNS lookup itself fails
  }
}

export const emailReady = (env) => !!(env.RESEND_API_KEY && env.EMAIL_FROM);

// Signed one-click unsubscribe links (for deal emails): /unsub?u=<id>&s=<signature>
export async function unsubSig(env, userId) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`unsub:${env.SETUP_KEY || 'x'}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(userId)));
  return [...new Uint8Array(sig)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- email budget (Resend free plan: 100 a day, 3,000 a month) ----------
// Sign-up codes always come first: plan emails stop a little early each day and month,
// so new users can still confirm their address.
export const monthKey = (d = new Date()) => `month:${d.toISOString().slice(0, 7)}`;
export function emailCaps(env) {
  const day = Number(env.EMAIL_DAILY_MAX || 90);
  const month = Number(env.EMAIL_MONTHLY_MAX || 2800);
  const reserve = Number(env.EMAIL_CODE_RESERVE || 15);
  return { day, month, reserve, planDay: Math.max(0, day - reserve), planMonth: Math.max(0, month - reserve * 10) };
}
export async function emailRoom(env, kind = 'plan') {
  const c = emailCaps(env);
  const today = await counter(env, 'emails_sent');
  const month = await counter(env, 'emails_sent', monthKey());
  const dayCap = kind === 'code' ? c.day : c.planDay;
  const monthCap = kind === 'code' ? c.month : c.planMonth;
  if (month >= monthCap) return { ok: false, reason: 'monthly_cap', today, month };
  if (today >= dayCap) return { ok: false, reason: 'daily_cap', today, month };
  return { ok: true, today, month };
}

export async function sendEmail(env, to, subject, html, text, { unsubUrl, kind = 'plan' } = {}) {
  if (!emailReady(env)) return { ok: false, reason: 'not_configured' };
  const room = await emailRoom(env, kind);
  if (!room.ok) { await bump(env, 'email_capped'); return room; }
  countFetch(env);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM, to: [to], subject, text,
        ...(html ? { html } : {}),
        ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}),
        // Gmail and Outlook expect a one-click unsubscribe on anything that isn't a pure one-off notice
        ...(unsubUrl ? { headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { await bump(env, 'email_errors'); return { ok: false, reason: `http_${res.status}` }; }
    await bump(env, 'emails_sent');
    await bump(env, 'emails_sent', 1, monthKey());
    await bump(env, kind === 'code' ? 'emails_code' : 'emails_plan');
    return { ok: true };
  } catch {
    await bump(env, 'email_errors');
    return { ok: false, reason: 'network' };
  }
}

export function sixDigitCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
}

// Emails are plain text on purpose: they read like a personal note from Maya,
// look the same in every inbox, and are far less likely to be filtered as promotions or spam.
const LINE = '────────────────────────';

export function codeEmail(env, name, code) {
  const who = env.ASSISTANT_NAME || 'Maya';
  const text = [
    `Hi ${name},`,
    '',
    `Your CityWide Trip code is: ${code}`,
    '',
    'Type it in our Telegram chat to confirm your email. It expires in 15 minutes.',
    "If you didn't ask for this, you can ignore this email.",
    '',
    `${who}`,
    'CityWide Trip Planner',
  ].join('\n');
  return { subject: `${code} is your CityWide Trip code`, html: undefined, text };
}

// One flight direction in the layout people know from e-tickets.
function leg(icon, title, l) {
  const out = [`${icon} ${title}   ${l.date}`];
  out.push(`   ${l.depTime}  ${l.from}`);
  if (l.arrTime) out.push(`   ${l.arrTime}  ${l.to}`);
  else out.push(`   →      ${l.to}`);
  out.push(`   ${[l.airline, l.flight, l.stops, l.duration].filter(Boolean).join(' · ')}`);
  return out.join('\n');
}

// plan = { name, subject, intro, trip[], saving[], options[], visa[], weather[], news[], pay[], extras[], next[], chatUrl, unsubUrl }
// option = { title, price, total, out, back, why, warn, href }
export function planEmail(env, plan) {
  const who = env.ASSISTANT_NAME || 'Maya';
  const block = (title, lines) => (lines && lines.length ? ['', title, ...lines] : []);
  const t = [`Hi ${plan.name},`, '', plan.intro];
  t.push(...block('🧳 YOUR TRIP', plan.trip.map((x) => `   ${x}`)));
  t.push(...block('💰 YOUR SAVING', plan.saving.map((x) => `   ${x}`)));
  for (const o of plan.options) {
    t.push('', LINE, o.title, `${o.price} per person${o.total ? ` · ${o.total} for everyone` : ''}`, '');
    t.push(leg('🛫', 'DEPART', o.out));
    if (o.back) t.push('', leg('🛬', 'RETURN', o.back));
    if (o.why) t.push('', `✅ ${o.why}`);
    if (o.warn) t.push(`⚠️ ${o.warn}`);
    if (o.href) t.push('', `👉 Book this: ${o.href}`);
  }
  t.push('', LINE);
  const dots = (lines) => lines.map((x) => `   • ${x}`);
  const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
  t.push(...block('🛂 VISA', dots(plan.visa)));
  t.push(...block('🌤 WEATHER', dots(plan.weather)));
  t.push(...block('📰 OFFICIAL TRAVEL ADVICE', dots(plan.news)));
  t.push(...block('💳 PAYING FROM BANGLADESH', dots(plan.pay)));
  t.push(...block('🎒 ALSO HANDY FOR THIS TRIP', dots(plan.extras.map((x) => `${x.text}: ${x.href}`))));
  t.push(...block("✅ WHAT'S NEXT", plan.next.map((x, i) => `   ${NUM[i] || `${i + 1}.`} ${x}`)));
  t.push('', 'Questions? Just reply to this email and I\'ll help.', '', 'Have a lovely trip,', who,
    'Your AI travel assistant at CityWide Trip Planner', `citywidetrip.com${plan.chatUrl ? ` · ${plan.chatUrl}` : ''}`);
  t.push('', '--',
    'Prices were seen by travellers in the last 48 hours and can change; the booking site always shows the live price. Please confirm visa rules on the official government site.',
    `Tip: add ${(env.EMAIL_REPLY_TO || 'this address')} to your contacts so trip plans reach your inbox.`);
  if (plan.unsubUrl) t.push(`Don't want deal emails? ${plan.unsubUrl} (plans you ask for will still arrive)`);
  return { subject: plan.subject, html: undefined, text: t.join('\n') };
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Phone numbers: international format, e.g. +8801712345678
export function normalizePhone(s) {
  let p = String(s || '').replace(/[\s()-]/g, '');
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  if (/^\d{8,15}$/.test(p)) p = `+${p}`; // Telegram contacts arrive without "+"
  return /^\+[1-9]\d{7,14}$/.test(p) ? p : null;
}
