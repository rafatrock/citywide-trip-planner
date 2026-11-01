// Test harness: runs the real Worker code against an in-memory SQLite database
// (standing in for Cloudflare D1) with fake Telegram, Travelpayouts and AI.
import { DatabaseSync } from 'node:sqlite';

export function makeD1() {
  const db = new DatabaseSync(':memory:');
  const norm = (a) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
  class Stmt {
    constructor(sql) { this.sql = sql; this.args = []; }
    bind(...a) { this.args = norm(a); return this; }
    async first() { return db.prepare(this.sql).get(...this.args) ?? null; }
    async all() { return { results: db.prepare(this.sql).all(...this.args) }; }
    async run() { db.prepare(this.sql).run(...this.args); return { success: true }; }
  }
  return {
    raw: db,
    prepare: (sql) => new Stmt(sql),
    batch: async (stmts) => { for (const s of stmts) await s.run(); return []; },
  };
}

export function makeEnv(overrides = {}) {
  let burst = 0;
  return {
    DB: makeD1(),
    TELEGRAM_BOT_TOKEN: 'test-token',
    TG_WEBHOOK_SECRET: 'hook-secret-123',
    SETUP_KEY: 'setup-key-456',
    TP_TOKEN: 'tp-token',
    TP_MARKER: '123456',
    ADMIN_IDS: '999',
    ADMIN_CHAT_ID: '999',
    AI_DAILY_MAX: '800',
    TP_CALLS_PER_DAY: '20000',
    NEW_SEARCHES_PER_DAY: '5',
    NEW_WATCHES_PER_DAY: '1',
    TRUSTED_SEARCHES_PER_DAY: '10',
    TRUSTED_WATCHES_PER_DAY: '2',
    MAX_ACTIVE_WATCHES: '3',
    WATCH_BATCH: '12',
    TP_FALLBACK_MARKETS: 'us,in',
    PUBLIC_URL: 'https://citywide-trip-planner.example.workers.dev',
    AI: { run: async () => ({ response: '{"destination_city":"Bangkok","month":"2026-12","group":"friends"}' }) },
    BURST: { limit: async () => ({ success: (burst += 1) <= 1000 }) },
    ...overrides,
  };
}

// Fake fares: a world where DAC-BKK has 4 options; everything else is empty.
export const fares = { scale: 1 };
function fixture(params) {
  const route = `${params.get('origin')}-${params.get('destination')}`;
  // one-way legs for multi-country tests: anything touching Dhaka or Ashgabat has a fare
  if (params.get('one_way') === 'true' && /DAC|ASB/.test(route) && !/BKK|KUL/.test(route)) {
    const m = params.get('departure_at');
    return [{ origin: params.get('origin'), destination: params.get('destination'), price: 15000, airline: 'HY', flight_number: '7',
      departure_at: `${m.length === 7 ? `${m}-12` : m}T09:00:00+06:00`, transfers: 1, duration_to: 300, link: `/search/${route.replace('-', '1201')}1?t=leg` }];
  }
  if (route !== 'DAC-BKK' && route !== 'DAC-KUL') return [];
  const s = fares.scale;
  const mk = (price, transfers, dep, dur, ret) => ({
    origin: params.get('origin'), destination: params.get('destination'), price: Math.round(price * s), airline: transfers ? 'MH' : 'TG', flight_number: String(price),
    departure_at: dep, return_at: ret, transfers, return_transfers: transfers, duration_to: dur, duration_back: dur, duration: dur * 2,
    link: `/search/DAC1012BKK1712?t=fake${price}`,
  });
  return [
    mk(18000, 1, '2026-12-10T21:00:00+06:00', 240, '2026-12-17T10:00:00+07:00'), // cheapest, lands ~02:00 local
    mk(21000, 0, '2026-12-10T10:00:00+06:00', 150, '2026-12-17T12:00:00+07:00'), // direct, daytime
    mk(19500, 1, '2026-12-11T05:00:00+06:00', 420, '2026-12-18T09:00:00+07:00'), // very early departure
    mk(26000, 0, '2026-12-12T13:00:00+06:00', 150, '2026-12-19T15:00:00+07:00'),
    mk(18000, 1, '2026-12-10T21:00:00+06:00', 240, '2026-12-17T10:00:00+07:00'), // duplicate seller
  ];
}

export function installFetch() {
  const log = { telegram: [], tp: [], emails: [], partner: [], news: [] };
  globalThis.fetch = async (input, opts = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.hostname === 'api.telegram.org') {
      const method = u.pathname.split('/').pop();
      const body = opts.body ? JSON.parse(opts.body) : {};
      log.telegram.push({ method, body });
      const result = method === 'getMe' ? { username: 'CityWideTripPlannerBot' } : { message_id: log.telegram.length };
      return new Response(JSON.stringify({ ok: true, result }));
    }
    if (u.hostname === 'api.travelpayouts.com' && u.pathname === '/data/en/airlines.json') {
      const list = Array.from({ length: 120 }, (_, i) => ({ code: `Z${String.fromCharCode(65 + (i % 26))}${i}`.slice(0, 2) + i, name: `Air ${i}` }))
        .concat([{ code: 'C6', name: 'Centrum Air', name_translations: { en: 'Centrum Air' } }, { code: 'XJ', name: 'Thai AirAsia X' }])
        .concat(Array.from({ length: 150 }, (_, i) => ({ code: `${String.fromCharCode(65 + (i % 26))}${i % 10}`, name: `Carrier ${i}` })));
      return new Response(JSON.stringify(list));
    }
    if (u.hostname === 'api.travelpayouts.com' && u.pathname.includes('prices_for_dates')) {
      log.tp.push(Object.fromEntries(u.searchParams));
      return new Response(JSON.stringify({ success: true, currency: u.searchParams.get('currency'), data: fixture(u.searchParams) }));
    }
    if (u.hostname === 'api.travelpayouts.com' && u.pathname.includes('/links/')) {
      // pretend you've joined Booking.com and Yesim only
      const target = JSON.parse(opts.body).links[0].url;
      const joined = /booking\.com|yesim\.app/.test(target);
      log.partner.push(target);
      return new Response(JSON.stringify({ result: { links: [joined ? { code: 'success', partner_url: `https://tp.st/${joined ? target.includes('booking') ? 'hotel' : 'esim' : ''}` } : { code: 'failed', message: 'trs is not subscribed for brand' }] } }));
    }
    if (u.hostname === 'cloudflare-dns.com') {
      const name = u.searchParams.get('name');
      return new Response(JSON.stringify(name === 'nomail.example' ? { Status: 3 } : { Status: 0, Answer: [{ data: `10 mx.${name}` }] }));
    }
    if (u.hostname === 'power.larc.nasa.gov') {
      const lat = Number(u.searchParams.get('latitude'));
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const tropical = Math.abs(lat) < 25;
      const avg = Object.fromEntries(months.map((m, i) => [m, tropical ? 27 + (i >= 3 && i <= 5 ? 3 : 0) : 4 + 14 * Math.sin(((i - 3) / 12) * 2 * Math.PI)]));
      const rain = Object.fromEntries(months.map((m, i) => [m, tropical && i >= 5 && i <= 8 ? 9 : 1]));
      return new Response(JSON.stringify({ properties: { parameter: { T2M: avg, PRECTOTCORR: rain } } }));
    }
    if (u.hostname === 'www.gov.uk' && u.pathname.startsWith('/foreign-travel-advice/')) {
      log.news.push(u.pathname);
      const slug = u.pathname.split('/').pop().replace('.atom', '');
      const now = new Date(Date.now() - 2 * 86400000).toISOString();
      return new Response(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Travel Advice Summary</title>
<entry><title>${slug} travel advice</title><updated>${now}</updated><link rel="alternate" type="text/html" href="https://www.gov.uk/foreign-travel-advice/${slug}"/>
<summary>Information on Severe Flooding (&#39;Warnings and Insurance&#39; page)</summary></entry></feed>`);
    }
    if (u.hostname === 'api.resend.com') {
      const body = JSON.parse(opts.body);
      log.emails.push(body);
      return new Response(JSON.stringify({ id: `em_${log.emails.length}` }));
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return log;
}

export function ctx() {
  const jobs = [];
  return { waitUntil: (p) => jobs.push(p), passThroughOnException() {}, done: () => Promise.all(jobs) };
}

let nextMsg = 1;
export const privateMsg = (text, from = { id: 42, first_name: 'Rahim' }) => ({
  update_id: nextMsg, message: { message_id: nextMsg++, from, chat: { id: from.id, type: 'private' }, text, date: 0 },
});
export const groupMsg = (text, from = { id: 43, first_name: 'Karim' }, chatId = -100777, extra = {}) => ({
  update_id: nextMsg, message: { message_id: nextMsg++, from, chat: { id: chatId, type: 'supergroup' }, text, date: 0, ...extra },
});
export const contactMsg = (phone, from = { id: 42, first_name: 'Rahim' }) => ({
  update_id: nextMsg, message: { message_id: nextMsg++, from, chat: { id: from.id, type: 'private' }, contact: { phone_number: phone, user_id: from.id }, date: 0 },
});
export const tap = (data, from = { id: 42, first_name: 'Rahim' }, chat = { id: 42, type: 'private' }) => ({
  update_id: nextMsg, callback_query: { id: String(nextMsg++), from, data, message: { message_id: 1, chat } },
});

export const lastSent = (log) => [...log.telegram].reverse().find((m) => m.method === 'sendMessage');
export const sentSince = (log, i) => log.telegram.slice(i).filter((m) => m.method === 'sendMessage');
