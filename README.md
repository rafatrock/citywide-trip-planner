# CityWide Trip Planner — Telegram bot (version 2)

Travellers chat with **Maya**, a friendly AI travel assistant (she always says she's an AI if asked). They type a trip in one line; Maya replies with three picks for their group: ⭐ best overall, 💰 cheapest and 🛋️ most comfortable, plus weather and visa notes for their passport, and can watch prices.

Runs free on Cloudflare (Workers, D1, Workers AI) and earns through your Travelpayouts account.

**Setup:** follow the step-by-step **CityWide Trip Planner — Setup Guide** doc. No commands, nothing to install: only Telegram, GitHub's website and the Cloudflare dashboard.

## What's new in version 2

- **One-time profile, remembered:** name (used in every reply), home city, passport(s), visas held, email (unique, checked, confirmed by a 6-digit code once Resend is on), WhatsApp number (optional, one tap via Telegram), and consent for deal emails. `/profile` shows it, `/settings` changes it, `/delete` erases it.
- **Countries or cities:** "Thailand" → "Which part?" with city buttons and a "Compare all" option; city codes (DAC, BKK…) are shown on the confirmation card.
- **Exact or flexible dates:** exact, ± 3 days, or any day that month.
- **Visa check for every search**, using the traveller's best passport and any visas they hold, with an early warning when an embassy visa is needed and an "Easier places" button.
- **Typical weather** at the destination for the travel month (and how it compares with home), from NASA POWER climate data (free, public domain).
- **Three kinds of picks**, never just one.
- **📧 Email me this plan** (once Resend is set up).
- **Small talk** handled warmly without using up searches.

## Protections

- Per user per day: 5 searches and 1 new price watch in the first week; 10 and 2 after. Max 3 active watches.
- 10 messages a minute per person; groups answer only commands, @mentions and replies.
- One email and one phone number per account; temporary email addresses refused; email domains checked.
- AI only fills trip fields, checked against the city list; 6 AI calls per person and 800 for the whole bot per day.
- Prices cached 6 hours; 3,000 price API calls a day max. Emails capped at 90 a day (Resend free plan: 100).

## Data sources and their limits

| Data | Source | Note |
| --- | --- | --- |
| Flight prices | Travelpayouts / Aviasales Data API | Seen by travellers in the last ~48 h; booking site shows live price |
| Visa rules | passport-index-dataset (MIT licence), Jan 2025 + newer checked corrections in `src/visa.js` | Always tell users to confirm on official sites |
| Weather | NASA POWER climatology | 30-year monthly averages, fetched once per city |
| Email | Resend | Free: 3,000/month, 100/day |

## Files

| File | Job |
| --- | --- |
| `src/index.js` | Webhook, `/setup`, tracked `/go/` links, scheduled jobs |
| `src/bot.js` | The conversation: trips, results, buttons, quotas |
| `src/onboarding.js` | One-time profile questions |
| `src/parse.js` | Understands one-line requests |
| `src/ai.js` | AI fallback for messy sentences, with strict checks |
| `src/rank.js` | Best overall / cheapest / most comfortable picks |
| `src/visa.js`, `src/visa-data.js` | Visa ease per passport (edit corrections in `visa.js`) |
| `src/weather.js` | Typical weather by month |
| `src/email.js` | Email checks, codes, trip-plan emails |
| `src/countries.js` | Country names, passports, Schengen list |
| `src/places.js` | 114 cities with codes, time zones, coordinates |
| `src/tp.js` | Travelpayouts prices and booking links |
| `src/watch.js` | Price watches and alerts |
| `src/admin.js` | `/stats`, `/ban`, `/grant`, `/routecheck`, daily report |
| `src/db.js` | Database tables (created and upgraded automatically) |
| `tools/build-visa-data.mjs` | Rebuilds the visa table (developer only) |
| `test/` | Automated tests (developer only) |
