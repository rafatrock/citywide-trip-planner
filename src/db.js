// D1 database: tables are created automatically on first use, so there is
// nothing to run by hand. Every helper here takes `env` (the Worker bindings).

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, chat_id INTEGER, first_name TEXT, username TEXT,
    home TEXT, country TEXT, currency TEXT, persona TEXT, pay TEXT,
    setup_step TEXT, draft TEXT, banned INTEGER DEFAULT 0,
    created_at INTEGER, last_seen INTEGER, active_days INTEGER DEFAULT 0, last_day TEXT)`,
  `CREATE TABLE IF NOT EXISTS usage (key TEXT, day TEXT, searches INTEGER DEFAULT 0, watches INTEGER DEFAULT 0,
    ai INTEGER DEFAULT 0, bonus INTEGER DEFAULT 0, warned INTEGER DEFAULT 0, PRIMARY KEY (key, day))`,
  `CREATE TABLE IF NOT EXISTS counters (day TEXT, name TEXT, value INTEGER DEFAULT 0, PRIMARY KEY (day, name))`,
  `CREATE TABLE IF NOT EXISTS searches (id TEXT PRIMARY KEY, user_id INTEGER, chat_id INTEGER, params TEXT, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS watches (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, chat_id INTEGER,
    params TEXT, label TEXT, best_price REAL, last_alert_price REAL, currency TEXT, active INTEGER DEFAULT 1,
    created_at INTEGER, last_checked INTEGER DEFAULT 0, expires_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, url TEXT, user_id INTEGER, kind TEXT, created_at INTEGER, clicks INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT, expires_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS prices (route TEXT, month TEXT, price REAL, currency TEXT, seen_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_watches_due ON watches (active, last_checked)`,
  `CREATE INDEX IF NOT EXISTS idx_prices_route ON prices (route, month, currency)`,
];

// Columns added in version 2 (profile). Added one by one; "already exists" errors are ignored.
const V2_COLUMNS = [
  'name TEXT', 'email TEXT', 'email_verified INTEGER DEFAULT 0', 'email_code TEXT', 'email_code_exp INTEGER',
  'email_tries INTEGER DEFAULT 0', 'phone TEXT', 'phone_source TEXT', 'phone_asked INTEGER DEFAULT 0',
  'passports TEXT', 'visas TEXT', 'visas_asked INTEGER DEFAULT 0', 'marketing INTEGER DEFAULT 0', 'consent_at INTEGER',
];

const ready = new WeakSet(); // per database binding, once per Worker instance
export async function ensureSchema(env) {
  if (ready.has(env.DB)) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  for (const col of V2_COLUMNS) {
    try { await env.DB.prepare(`ALTER TABLE users ADD COLUMN ${col}`).run(); } catch { /* already there */ }
  }
  try { await env.DB.prepare('ALTER TABLE usage ADD COLUMN emails INTEGER DEFAULT 0').run(); } catch { /* already there */ }
  await env.DB.batch([
    env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email IS NOT NULL'),
    env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users (phone) WHERE phone IS NOT NULL'),
  ]);
  ready.add(env.DB);
}

export const today = () => new Date().toISOString().slice(0, 10);
export const nowSec = () => Math.floor(Date.now() / 1000);

export function randomId(len = 10) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

// ---------- users ----------
export async function getUser(env, id) {
  return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

export async function touchUser(env, from, chatId) {
  const t = nowSec();
  const day = today();
  const existing = await getUser(env, from.id);
  if (!existing) {
    await env.DB.prepare(`INSERT INTO users (id, chat_id, first_name, username, setup_step, created_at, last_seen, active_days, last_day)
      VALUES (?, ?, ?, ?, 'home', ?, ?, 1, ?)`)
      .bind(from.id, chatId, (from.first_name || '').slice(0, 64), (from.username || '').slice(0, 64), t, t, day).run();
    await bump(env, 'new_users');
    return getUser(env, from.id);
  }
  const newDay = existing.last_day !== day;
  await env.DB.prepare(`UPDATE users SET last_seen = ?, chat_id = COALESCE(chat_id, ?), last_day = ?,
    active_days = active_days + ? WHERE id = ?`).bind(t, chatId, day, newDay ? 1 : 0, from.id).run();
  if (newDay) await bump(env, 'active_users');
  return { ...existing, last_seen: t, last_day: day, active_days: existing.active_days + (newDay ? 1 : 0) };
}

const USER_FIELDS = new Set(['home', 'country', 'currency', 'persona', 'pay', 'setup_step', 'draft', 'banned', 'chat_id',
  'name', 'email', 'email_verified', 'email_code', 'email_code_exp', 'email_tries', 'phone', 'phone_source', 'phone_asked',
  'passports', 'visas', 'visas_asked', 'marketing', 'consent_at']);

// Who (if anyone else) already uses this email or phone?
export async function ownerOf(env, field, value) {
  if (!['email', 'phone'].includes(field) || !value) return null;
  const row = await env.DB.prepare(`SELECT id FROM users WHERE ${field} = ?`).bind(value).first();
  return row ? row.id : null;
}
export async function updateUser(env, id, fields) {
  const keys = Object.keys(fields).filter((k) => USER_FIELDS.has(k));
  if (!keys.length) return;
  const sql = `UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  await env.DB.prepare(sql).bind(...keys.map((k) => fields[k]), id).run();
}

export async function deleteUserData(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
    env.DB.prepare('DELETE FROM watches WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM searches WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM usage WHERE key = ?').bind(`u${id}`),
  ]);
}

// ---------- per-user daily usage ----------
export async function getUsage(env, key) {
  const row = await env.DB.prepare('SELECT * FROM usage WHERE key = ? AND day = ?').bind(key, today()).first();
  return row || { searches: 0, watches: 0, ai: 0, bonus: 0, warned: 0, emails: 0 };
}

export async function addUsage(env, key, field, n = 1) {
  if (!['searches', 'watches', 'ai', 'bonus', 'warned', 'emails'].includes(field)) return;
  await env.DB.prepare(`INSERT INTO usage (key, day, ${field}) VALUES (?, ?, ?)
    ON CONFLICT (key, day) DO UPDATE SET ${field} = ${field} + excluded.${field}`).bind(key, today(), n).run();
}

// ---------- global daily counters (for the report and the budget switch) ----------
export async function bump(env, name, n = 1, day = today()) {
  await env.DB.prepare(`INSERT INTO counters (day, name, value) VALUES (?, ?, ?)
    ON CONFLICT (day, name) DO UPDATE SET value = value + excluded.value`).bind(day, name, n).run();
}

export async function counter(env, name, day = today()) {
  const row = await env.DB.prepare('SELECT value FROM counters WHERE day = ? AND name = ?').bind(day, name).first();
  return row ? row.value : 0;
}

export async function countersFor(env, day) {
  const { results } = await env.DB.prepare('SELECT name, value FROM counters WHERE day = ?').bind(day).all();
  return Object.fromEntries((results || []).map((r) => [r.name, r.value]));
}

// ---------- small key/value cache with expiry ----------
export async function cacheGet(env, key) {
  const row = await env.DB.prepare('SELECT value, expires_at FROM cache WHERE key = ?').bind(key).first();
  if (!row || row.expires_at < nowSec()) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

export async function cacheSet(env, key, value, ttlSec) {
  await env.DB.prepare(`INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`)
    .bind(key, JSON.stringify(value), nowSec() + ttlSec).run();
}

// ---------- settings saved by /setup (public URL, bot username) ----------
export async function getConfig(env, key) {
  const row = await env.DB.prepare('SELECT value FROM config WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

export async function setConfig(env, key, value) {
  await env.DB.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .bind(key, String(value)).run();
}

// ---------- saved searches (so buttons can refer to them) ----------
export async function saveSearch(env, userId, chatId, params) {
  const id = randomId(8);
  await env.DB.prepare('INSERT INTO searches (id, user_id, chat_id, params, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, userId, chatId, JSON.stringify(params), nowSec()).run();
  return id;
}

export async function getSearch(env, id) {
  const row = await env.DB.prepare('SELECT * FROM searches WHERE id = ?').bind(id).first();
  return row ? { ...row, params: JSON.parse(row.params) } : null;
}

// ---------- tracked booking links ----------
export async function saveLink(env, url, userId, kind) {
  const id = randomId(9);
  await env.DB.prepare('INSERT INTO links (id, url, user_id, kind, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, url, userId, kind, nowSec()).run();
  return id;
}

export async function useLink(env, id) {
  const row = await env.DB.prepare('SELECT url, kind FROM links WHERE id = ?').bind(id).first();
  if (!row) return null;
  await env.DB.prepare('UPDATE links SET clicks = clicks + 1 WHERE id = ?').bind(id).run();
  return row;
}

// ---------- price history ----------
export async function recordPrice(env, route, month, price, currency) {
  await env.DB.prepare('INSERT INTO prices (route, month, price, currency, seen_at) VALUES (?, ?, ?, ?, ?)')
    .bind(route, month, price, currency, nowSec()).run();
}

export async function priceStats(env, route, month, currency, days = 30) {
  return env.DB.prepare(`SELECT MIN(price) AS low, COUNT(*) AS n FROM prices
    WHERE route = ? AND month = ? AND currency = ? AND seen_at > ?`)
    .bind(route, month, currency, nowSec() - days * 86400).first();
}

// ---------- housekeeping (called by the daily cron) ----------
export async function cleanup(env) {
  const t = nowSec();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM cache WHERE expires_at < ?').bind(t),
    env.DB.prepare('DELETE FROM searches WHERE created_at < ?').bind(t - 30 * 86400),
    env.DB.prepare('DELETE FROM links WHERE created_at < ?').bind(t - 60 * 86400),
    env.DB.prepare('DELETE FROM prices WHERE seen_at < ?').bind(t - 120 * 86400),
    env.DB.prepare('DELETE FROM usage WHERE day < ?').bind(new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)),
    env.DB.prepare('UPDATE watches SET active = 0 WHERE active = 1 AND expires_at < ?').bind(t),
  ]);
}
