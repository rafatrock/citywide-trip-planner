# CityWide Trip Planner — Telegram bot (version 4.2)

Travellers chat with **Maya**, a friendly AI travel assistant (she always says she's an AI if asked). They type a trip in one line; Maya replies with three picks for their group: ⭐ best overall, 💰 cheapest and 🛋️ most comfortable, plus weather and visa notes for their passport, and can watch prices.

Runs free on Cloudflare (Workers, D1, Workers AI) and earns through your Travelpayouts account.

**Setup:** follow the step-by-step **CityWide Trip Planner — Setup Guide** doc. No commands, nothing to install: only Telegram, GitHub's website and the Cloudflare dashboard.

## What's new in version 4.2

- **Airline first, everywhere:** every option starts with its carrier ("💰 Option 2 · Cheapest · Malaysia Airlines"), and so do the Book buttons and multi-country legs.
- **E-ticket layout:** "🛫 Thu, 10 Dec · 21:00 Dhaka → 02:00 (+1) Bangkok", the same for the return.
- **Connection time:** one-stop flights show about how long you wait to change planes (an estimate from total journey time and distance; the booking page shows exact times).
- **Plain-text trip email from Maya:** e-ticket layout, carrier first, "Your saving" (cheapest pick vs the average fare for those dates, and how many fares she compared), bullet sections for visa, weather, travel advice, paying, extras and what's next.
- **Email fair use:** confirmed addresses only; the same plan only once a day; 2 minutes between emails; 2 plan emails a day and 8 a month per person; the bot stops plan emails at 75 a day and 2,650 a month so sign-up codes always get through (Resend free plan: 100 a day, 3,000 a month). All adjustable.
- **No payment question in setup** (8 steps, same for every country). Bangladesh users still see a short paying tip.
- **/analytics** (owner only): people, active today/week/month, who comes back after a week and a month, days of use, home countries, Telegram languages, traveller types, top destinations, the path from search to booking, last 7 days, and email used this month.

## Version 4

- **The whole world:** every airport city with scheduled flights (3,245 airports) and every country, with correct local times. Visa data now covers all 199 countries.
- **No more question loops:** if Maya can't find a place she says so and suggests what to type, instead of asking "Where would you like to go?" again.
- **Multi-country trips:** "Uzbekistan, Kyrgyzstan and Turkmenistan, 7 days" → a route without backtracking, flights priced leg by leg, nights per stop, honest tips (tight schedules, short hops by road, hard visas), drop a stop with one tap.
- **Group size:** "family trip" with no numbers → Maya guesses 2 adults + 1 child and asks with one tap (no more "Family with kids · 1 person").
- **Better understanding:** "me with 2 friends" = 3 people, "2nd week of January" = 8–14 Jan, "Backpackers" wins over "friends".
- **Official travel updates, automatically:** UK Foreign Office travel-advice changes for the countries your users search, as a short headline + link in `/latest` and under results.
- **Trip-tailored Amazon picks:** 1–2 items for each trip (e.g. the right plug adapter, sunscreen, thermals) on a button that opens your `/gear` page, where the Amazon links and disclosure live. Never in emails.

## Version 3

- **Fixes:** realistic weather (average temperature, not monthly extremes); "Also good" picks are real alternatives (different airline/flight), not the same flight on other dates; group members greeted by name; no false price alerts after switching currency.
- **⇄ Return / → One way** shown clearly, with a one-tap switch, and a **trip length** choice (2–4, 5–7, 8–14 nights) for flexible-month searches.
- **Visa question only when it matters:** if a destination needs a visa for your passport, Maya asks once whether you already have one and remembers per country (`/visas`). Official e-visa sites are linked.
- **🔎 All live prices, incl. connecting flights** button on every result.
- **Spelling mistakes forgiven** ("bangkock", "kualalampur", "thailnd"), with Maya saying what she guessed.
- **Retention:** "Did you book?" a day after someone taps Book → saved trip (`/trips`) → reminders 14, 3 and 1 day before, each with useful next steps. `/latest` shows up to 5 updates picked for that person; a weekly digest goes to people who said yes to deals.
- **Revenue:** 🧳 Trip toolkit (hotels, eSIM, tours, transfers, insurance) showing only Travelpayouts programs you've joined; one fitting extra under every result; 📤 Share on WhatsApp (free); travel-gear page for Amazon Associates (`/gear`).
- **Admin:** `/misses` (sentences Maya didn't understand), `/post` news into `/latest`, `/news`, `/unpost`.
- **Efficiency:** AI answers cached and reused; edge cache on custom domains; fewer database writes; every message stays under the free plan's 50 outgoing calls.
- **Email:** one-click unsubscribe headers (Gmail/Outlook), reply-to address, trip toolkit links in plan emails.

## Version 2

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
| Email | Resend | Free: 3,000/month, 100/day (the bot stays below both) |

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
| `src/email.js` | Email checks, codes, trip-plan emails, unsubscribe |
| `src/retention.js` | Interests, booked trips, reminders, /latest, weekly digest |
| `src/toolkit.js` | Trip toolkit (partner programs) and the travel-gear page |
| `src/format.js` | Money formatting |
| `src/countries.js` | Country names, passports, Schengen list |
| `src/places.js`, `src/world-data.js` | 114 hand-tuned cities + 3,245 world airports (OurAirports, public domain; time zones from mwgg/Airports, MIT) |
| `src/multi.js` | Multi-country trips |
| `src/news.js` | Official travel-advice updates (UK FCDO, Open Government Licence) |
| `src/tp.js` | Travelpayouts prices and booking links |
| `src/watch.js` | Price watches and alerts |
| `src/admin.js` | `/stats`, `/ban`, `/grant`, `/routecheck`, daily report |
| `src/analytics.js` | `/analytics` for the owner |
| `src/db.js` | Database tables (created and upgraded automatically) |
| `tools/build-visa-data.mjs`, `tools/build-world-data.mjs` | Rebuild the visa and airport tables (developer only) |
| `test/` | Automated tests (developer only) |
