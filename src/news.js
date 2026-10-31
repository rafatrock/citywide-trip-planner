// Automatic travel updates from an official source: UK Foreign Office (FCDO) travel
// advice, one free Atom feed per country (e.g. gov.uk/foreign-travel-advice/thailand.atom).
// Each feed's latest entry says what changed ("Information on Severe Flooding").
// Content is Crown copyright under the Open Government Licence v3.0: free to reuse with attribution.
// We store a short headline + link; travellers see it in /latest and under search results.

import { nowSec, bump, canFetch, cacheGet, cacheSet } from './db.js';
import { regionName } from './countries.js';
import { placeByCode } from './places.js';

const SLUG = {
  US: 'usa', AE: 'united-arab-emirates', KR: 'south-korea', KP: 'north-korea', CZ: 'czech-republic', MM: 'burma',
  TR: 'turkey', HK: 'hong-kong', MO: 'macao', VN: 'vietnam', LA: 'laos', RU: 'russia', IR: 'iran', SY: 'syria',
  TW: 'taiwan', CI: 'cote-d-ivoire', CD: 'democratic-republic-of-the-congo', CG: 'congo', GM: 'the-gambia',
  BS: 'bahamas', MK: 'north-macedonia', MD: 'moldova', BO: 'bolivia', VE: 'venezuela', TZ: 'tanzania',
  BN: 'brunei', CV: 'cape-verde', SZ: 'eswatini', TL: 'timor-leste', PS: 'the-occupied-palestinian-territories',
  KG: 'kyrgyzstan', FM: 'micronesia', VA: 'italy', GB: null,
};

export function fcdoSlug(cc) {
  if (cc in SLUG) return SLUG[cc];
  const n = regionName(cc);
  if (!n || n === cc) return null;
  return n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Pure: read the newest entry of an FCDO Atom feed.
export function parseFcdo(xml) {
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/);
  if (!entry) return null;
  const get = (tag) => (entry[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1];
  const link = (entry[1].match(/<link[^>]*href="([^"]+)"/) || [])[1];
  const clean = (s) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  const updated = get('updated');
  if (!updated || !link?.startsWith('https://www.gov.uk/')) return null;
  return { title: clean(get('title')), summary: clean(get('summary')).slice(0, 220), updated, link };
}

async function fetchCountry(env, cc) {
  const slug = fcdoSlug(cc);
  if (!slug || !canFetch(env, 1, 8)) return false;
  let item = null;
  try {
    const res = await fetch(`https://www.gov.uk/foreign-travel-advice/${slug}.atom`, { signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'CityWideTripPlanner/1.0 (+https://citywidetrip.com)' } });
    if (res.ok) item = parseFcdo(await res.text());
  } catch { /* try again next time */ }
  await cacheSet(env, `news:fcdo:${cc}`, { at: nowSec() }, 12 * 3600);
  if (!item) return false;
  const t = Math.floor(Date.parse(item.updated) / 1000);
  if (!t || t < nowSec() - 60 * 86400) return false; // only recent changes are news
  const ext = `fcdo:${cc}:${item.updated}`;
  const exists = await env.DB.prepare('SELECT id FROM news WHERE ext_id = ?').bind(ext).first();
  if (exists) return false;
  const text = item.summary || 'Travel advice updated';
  await env.DB.prepare('INSERT INTO news (tags, text, url, source, ext_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(cc, text, item.link, 'UK FCDO travel advice', ext, t, t + 30 * 86400).run();
  await bump(env, 'news_pulled');
  return true;
}

// Called by the 30-minute cron: refresh up to 3 countries travellers care about (each at most twice a day).
export async function refreshNews(env) {
  if (String(env.AUTO_NEWS ?? 'true') === 'false') return;
  const { results } = await env.DB.prepare(`SELECT dest, COUNT(*) AS c FROM interests WHERE last_at > ? GROUP BY dest ORDER BY c DESC LIMIT 40`)
    .bind(nowSec() - 60 * 86400).all();
  const countries = [...new Set((results || []).map((r) => placeByCode(r.dest)?.cc).filter(Boolean))];
  let fetched = 0;
  for (const cc of countries) {
    if (fetched >= 3) break;
    if (await cacheGet(env, `news:fcdo:${cc}`)) continue;
    await fetchCountry(env, cc);
    fetched += 1;
  }
}

// Newest update for one country (shown under search results), or null.
export async function latestNewsFor(env, cc, maxAgeDays = 30) {
  if (!cc) return null;
  return env.DB.prepare(`SELECT * FROM news WHERE (',' || tags || ',') LIKE ? AND created_at > ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1`)
    .bind(`%,${cc},%`, nowSec() - maxAgeDays * 86400, nowSec()).first();
}

export function newsLine(n, countryLabel, esc) {
  const when = new Date(n.created_at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const src = n.source ? ` (${esc(n.source)}, ${when})` : '';
  const link = n.url ? ` <a href="${n.url}">Read more</a>` : '';
  return `📰 ${countryLabel ? `<b>${esc(countryLabel)}</b>${src}: ` : ''}${esc(n.text)}${link}`;
}
