// Email: address checks, verification codes and trip-plan emails.
// Sending uses Resend (free: 3,000 emails/month, 100/day). Until RESEND_API_KEY
// is set, addresses are format- and domain-checked but not code-verified.

import { bump, counter } from './db.js';

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

export async function sendEmail(env, to, subject, html, text) {
  if (!emailReady(env)) return { ok: false, reason: 'not_configured' };
  const cap = Number(env.EMAIL_DAILY_MAX || 90);
  if ((await counter(env, 'emails_sent')) >= cap) return { ok: false, reason: 'daily_cap' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { await bump(env, 'email_errors'); return { ok: false, reason: `http_${res.status}` }; }
    await bump(env, 'emails_sent');
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

const shell = (env, title, body) => `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1d2733">
<div style="max-width:560px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border-radius:12px;padding:24px">
<h2 style="margin:0 0 12px;font-size:20px">${title}</h2>${body}
<p style="color:#6b7785;font-size:12px;margin-top:24px">${env.ASSISTANT_NAME || 'Maya'} · CityWide Trip Planner (an AI travel assistant). Prices were seen recently and can change; the booking site shows the live price. Always confirm visa rules on official government sites.</p>
</div></div></body></html>`;

export function codeEmail(env, name, code) {
  const html = shell(env, `Hi ${esc(name)}, here is your code`, `<p style="font-size:32px;letter-spacing:6px;font-weight:bold;margin:8px 0">${code}</p><p>Type this code in the Telegram chat to confirm your email. It expires in 15 minutes. If you didn't ask for it, ignore this email.</p>`);
  return { subject: `${code} is your CityWide Trip code`, html, text: `Your CityWide Trip code is ${code}. It expires in 15 minutes.` };
}

// picks: [{ label, price, total, airline, stops, out, back, why, warn, href }]
export function planEmail(env, name, title, picks, notes) {
  const rows = picks.map((p) => `<div style="border:1px solid #e3e8ee;border-radius:10px;padding:14px;margin:12px 0">
<div style="font-size:13px;color:#6b7785">${esc(p.label)}</div>
<div style="font-size:20px;font-weight:bold">${esc(p.price)} <span style="font-size:13px;font-weight:normal;color:#6b7785">per person${p.total ? ` · about ${esc(p.total)} total` : ''}</span></div>
<div>${esc(p.airline)} · ${esc(p.stops)}</div><div style="color:#3b4652">${esc(p.out)}${p.back ? `<br>${esc(p.back)}` : ''}</div>
${p.why ? `<div style="color:#1e7d32;margin-top:6px">✓ ${esc(p.why)}</div>` : ''}${p.warn ? `<div style="color:#a35b00">⚠ ${esc(p.warn)}</div>` : ''}
${p.href ? `<a href="${p.href}" style="display:inline-block;margin-top:10px;background:#0b6bcb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">See live price and book</a>` : ''}</div>`).join('');
  const html = shell(env, esc(title), `<p>Hi ${esc(name)}, here's the plan we put together.</p>${rows}${notes.map((n) => `<p style="margin:8px 0">${esc(n)}</p>`).join('')}`);
  const text = [`Hi ${name}, here's your plan: ${title}`, ...picks.map((p) => `${p.label}: ${p.price} pp, ${p.airline}, ${p.stops}. ${p.out}. ${p.href || ''}`), ...notes].join('\n\n');
  return { subject: title, html, text };
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
