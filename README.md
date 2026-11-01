# CityWide Trip Planner — Telegram bot (version 4.9.9)

Travellers chat with **Maya**, a friendly AI travel assistant (she always says she's an AI if asked). They type a trip in one line; Maya replies with three picks for their group: ⭐ best overall, 💰 cheapest and ⚡ fastest, plus weather and visa notes for their passport, and can watch prices.

Runs free on Cloudflare (Workers, D1, Workers AI) and earns through your Travelpayouts account.

**Setup:** follow the step-by-step **CityWide Trip Planner — Setup Guide** doc. No commands, nothing to install: only Telegram, GitHub's website and the Cloudflare dashboard.

## What's new in version 4.9.9 (fresh data, one simple rule)

- **One simple rule, like a human:** 💰 Cheapest = lowest price. ⚡ Fastest = least time travelling. ⭐ Best overall = price ÷ cheapest price + time ÷ fastest time − airline quality (lowest wins). The traveller type only changes how much each part counts.
- **Airline quality from Skytrax passenger reviews** (`src/airline-ratings.js`, 103 airlines, reviews since 2022). Reviewers are harsh, so each airline is compared with the average (3.4 / 10): Qatar 6.3 counts strongly in its favour; airlines with few reviews are pulled towards the average. Budget airlines with no reviews (Air Arabia, IndiGo…) count slightly below average. To refresh: run `tools/build-airline-ratings.py` on a new Skytrax export.
- **Fresh data, nothing stored:** every search asks Aviasales again (no price cache). Up to 4 markets × 200 fares each, plus non-stop flights asked separately, whole months fetched once and narrowed to your dates in code. Optional `TP_CACHE_MINUTES` (default 0) brings caching back; `TP_CALLS_PER_DAY` (default 20000) replaces `TP_DAILY_MAX`.
- **Real travel times (checked against the live API):** Aviasales' `duration` is the whole journey with stopovers; `duration_to`/`duration_back` are time in the air only. Maya used to show flying time (e.g. IndiGo "10h 50m") for a 30-hour trip. Now every card shows the real total ("⏱ 48h 35m travelling in total, incl. about 27h 45m waiting at stopovers"), per-way times and arrival times only when they are really known, and warns about long stopovers. Bigger price gaps read "3.9× the cheapest price".
- **Honest labels:** one fare is shown as "Fare seen", not "best/cheapest/fastest"; "Fastest" appears only when it really is faster than the cheapest.

## What's new in version 4.9.8

- **Picks like a seasoned traveller:** Maya now knows airline quality. Top full-service airlines (Qatar, Emirates, Singapore, Turkish, Etihad…) count in their favour; budget airlines (Air Arabia, IndiGo, AirAsia, flydubai…) count a little against "best overall" (bags, meals, long stopovers) and get a "check baggage" note. Families and business trips weigh quality more; backpackers barely at all. E.g. Dhaka ⇄ Istanbul: ⭐ Qatar (best balance), 💰 Air Arabia (cheapest), ⚡ Turkish (fastest, non-stop).
- **Reasons people understand:** "top-rated full-service airline, 46% more than the cheapest, 5h 35m quicker each way"; "lowest price"; "budget airline: check what baggage and meals are included".
- **More airlines found:** up to 4 markets asked at once (incl. the Gulf market, where Qatar/Emirates/Air Arabia fares from South Asia are found) and 100 fares per market instead of 30.

## What's new in version 4.9.7

- **More real fares on every card:** prices from *every* market that answers are kept (before, only the first market's were), and direct flights are asked for separately (in a cheapest-first list they get pushed out). E.g. Dhaka ⇄ Istanbul now shows Air Arabia (cheapest), Turkish Airlines direct (fastest) and IndiGo, like Aviasales.
- **Honest titles:** one fare is "Fare seen", never "best, cheapest, fastest and most comfortable"; "Fastest" only when it's actually faster than the cheapest; "Most comfortable" only with 3+ fares. When few fares are seen, the card says so and points to the live search.
- **No airline-logo banner:** Telegram showed it as a large blurry picture, so it's off.
- Lighter side checks and live prices (if set up) before the extra price lists, so the call budget goes to the most useful data first.

## What's new in version 4.9.6 (taught from /misses)

- "Me and my 5 friends", "me, and my 5 friends", "me plus 5 friends", "my 5 friends and me", "with my 5 friends" = 6 people (the speaker counts).
- /misses only lists messages where Maya recognised nothing at all. A message with only people or dates ("1 adult only no children") isn't a miss: Maya keeps it and asks where to.

## What's new in version 4.9.5

- **Honest price guide for return trips:** when nothing is seen for the dates, the guide is a real *return* fare seen on that route (with its dates and airline), not a one-way price with the way back missing. No total is shown unless every flight has a price.
- "I have **an** Australia visa" (grammar).

## What's new in version 4.9.4

- **Fix: "Too many subrequests" (no reply on quiet routes like Dhaka → Sydney).** An edge cache made two hidden outside calls per price lookup that weren't counted against the free plan's 50 per message. It's removed (the database cache does the job), the budget keeps 5 spare, and the worst case (no prices anywhere, every fallback tried) now uses 40 calls and still answers.
- **Never silent:** if a reply ever fails, Maya says sorry and asks to try again.

## What's new in version 4.9.3

- **A visa never blocks flights:** answering "No visa yet" goes straight to the flights, with how to apply. It's the traveller's call; Maya only informs.
- **Change your visa answer any time:** every trip card for a country that needs a visa keeps the visa buttons, with ✅ only on what you actually told Maya (nothing pre-ticked). /visas still lists and forgets answers.

## What's new in version 4.9.2

- **Real return tickets first:** when there's no fare for the exact dates, Maya looks at every round-trip fare travellers found that month (all price lists) and shows the ones on the nearest dates, each opening that exact ticket on Aviasales, so the card matches what people see there. Adding up two one-way prices is now the last resort.
- **Honest price guide:** if nothing real is found, the card says "PRICE GUIDE", shows the guide price per flight with the day it was seen, and makes no claims about airlines, stops or best/cheapest/fastest.
- **Airline logos:** the top pick's airline logo (Aviasales logo service, pics.avs.io) shows above the card.
- Fares without flight times say "flight times on the booking page" instead of guessing.

## What's new in version 4.9.1

- **Faster start-up:** country and language names are no longer worked out each time a fresh copy of the Worker starts (start-up work roughly halved).
- **Command menu refreshes itself daily**, so new commands like /deals appear without opening the setup link.
- **Smart Placement** (`[placement] mode = "smart"` in wrangler.toml): Cloudflare can run the Worker next to the database instead of next to Telegram's servers, which cuts the waiting on every database call.

## What's new in version 4.9 (more of the free Aviasales Data API)

- **Prices found far more often, free:** when the main index (`prices_for_dates`) has nothing, Maya also asks three other Aviasales indexes side by side: `v1/prices/cheap`, `v1/prices/direct` and `get_latest_prices`. Expired prices are skipped. Fares without flight times say "times on the booking page".
- **/deals:** real low fares from your home city right now (Aviasales special offers), with booking buttons. The best one also appears in /latest.
- **Nearby airports:** when a flight still has no price, Maya suggests a nearby airport pair that has one (`nearest-places-matrix`).
- **Exact dates stay exact:** each flight stays within a day of its own planned date.

## Version 4.8

- **Cheaper live prices:** live Google Flights prices now also work through **SearchApi** (searchapi.io, about $4 per 1,000 searches: $40 a month for 10,000; 100 free to try), as well as SerpApi. Add the secret `SEARCHAPI_KEY` and the bot uses it automatically.

## Version 4.7

- **Live prices from Google Flights** (through SerpApi; add the secret `SERPAPI_KEY`): real airlines, flight numbers, departure and arrival times, layovers and prices, marked 🟢 on the card. Used when the free data has nothing near your dates (`LIVE_MODE = "fallback"`), or for every flight (`"always"`). Each answer is kept 6 hours; `LIVE_MONTHLY_MAX` (240, inside SerpApi's free 250 a month) and `LIVE_PER_USER_DAY` (6) protect your allowance; you, the owner, are not limited per day.
- **Never "Sorry, no prices" again:** if there's no cached round-trip fare, Maya builds the trip from one-way flights (live, cached or clearly marked estimates) and shows ⭐ best overall, 💰 cheapest and ⚡ fastest whole trips with totals, plus one booking link per trip.
- The daily report shows live searches used this month.

## Version 4.6

- **⚡ Fastest** on single trips too (least time travelling, both ways), next to best overall, cheapest and most comfortable.
- **Search limits:** 7 a day in someone's first week, 10 a day after (once they've come back on 2+ days), 150 a month. Groups get twice as many, and the person asking in a group also uses their own allowance. You (ADMIN_IDS) have none. New setting names (`SEARCHES_PER_DAY_FIRST_WEEK`, `SEARCHES_PER_DAY`, `SEARCHES_PER_MONTH`), so old numbers in wrangler.toml are ignored.
- **Traveller profiles** (never for admins): searches, multi-country, one-way, flexible, direct, group size, kids, budget, trip length, how far ahead they search, which option they tap (best / cheapest / fastest / comfort), watches, emails, bookings, favourite countries and months, most active hour, and a one-line segment ("price-focused, travels with kids, plans far ahead"). `/user <id>` shows one person; `/analytics` adds "How people search and choose". `/delete` now erases everything about a person.
- **Abuse guards:** public pages (booking links, gear page, setup) limited to 10 a minute per visitor; forged buttons ignored; multi-country re-pricing free up to 6 times per route, then counted; a flood of brand-new accounts alerts you at 150 a day and pauses new sign-ups above 600; multi-country trip search kept well inside the free plan's 10 ms of CPU.

## Version 4.5

- **Multi-city trips priced straight away, as whole trips:** ⭐ Best overall, 💰 Cheapest and ⚡ Fastest, each with its total (per person and for the group), every flight in ticket format (airline, flight number, price, date, departure → arrival times, duration, stops) and why it was picked. Options that are the same trip are merged.
- **One booking link per whole trip** (not per flight); one link when all options share the same dates.
- **Every leg gets a number:** if no price was seen near your dates, Maya shows a clearly labelled estimate (cheapest seen on another day, or the same route the other way).
- **Changing nights, group or month re-prices the same route without using another search.**
- **New trip detection:** "dac malaysia trip" while a Malaysia + Thailand card is open starts a new trip.
- **AI:** Cloudflare's strongest model, gpt-oss-120b (≈ 50–80 Neurons a message), with Llama 4 Scout as automatic backup.
- Prices from other markets are asked in your currency, so legs always add up; South-East Asia routes also ask that country's market.

## Version 4.4

- **Multi-city link fixed:** the whole-route button now opens aviasales.com in the format that works (`/search/DAC1101TAS1401IST1801DAC3`).
- **Prices to compare on every leg:** the cheapest option plus a second one (fewer stops or another airline); when nothing is seen near your dates, "usually from …" with the day it was seen.
- **A smarter AI that reads the conversation:** Llama 4 Scout (free on Workers AI, ~35 Neurons a call) reads long or unclear messages and replies to an open trip card *with the trip as context* ("can we squeeze one more person in", "sounds good, show me prices"). The rules still handle simple messages instantly and free. Budget: 8,000 of the free 10,000 Neurons a day, 12 AI reads per person per day.
- **Optional Claude:** add the secret `ANTHROPIC_API_KEY` and set `AI_MODEL` to a Claude model (e.g. `claude-haiku-5-5`). Paid by your Anthropic account, not Cloudflare.
- More airline names built in (AJet, Centrum Air), and the full list loads automatically.

## Version 4.3

- **Change the trip by chatting:** with a trip card open, "1 adult only no children", "one way", "15 to 20 Jan", "flexible dates", "direct" or "budget 30,000" update that card ("Updated ✅"); "go" or "search" runs it. A new place starts a new trip.
- **Honest group label:** never "Family with kids · 1 person"; "1 adult" means 1 adult, "no children" means none.
- **Multi-city as one ticket:** the first button searches the whole route as one multi-city trip on Aviasales (live prices, all airlines and connections). Each flight is listed as a price guide, on the cheapest day near your plan, without cutting a stay short.
- **More prices found:** asks the likeliest price markets at the same time (e.g. Russian-speaking markets for Central Asia, Turkey's for Turkey); exact dates with no price fall back to the nearest days and say so.
- **Real airline names** for every code (Travelpayouts' free airline list, refreshed weekly), e.g. C6 = Centrum Air.
- **Faster:** price checks, database steps and Telegram housekeeping run side by side; a fresh Worker checks one row instead of ~30 setup statements.
- **You (ADMIN_IDS) have no search or watch limits.**

## Version 4.2

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
| `src/profile.js` | Traveller profiles, segments, `/user` |
| `src/live.js` | Live Google Flights prices (SerpApi) |
| `src/db.js` | Database tables (created and upgraded automatically) |
| `tools/build-visa-data.mjs`, `tools/build-world-data.mjs`, `tools/build-country-names.mjs` | Rebuild the visa, airport and country-name tables (developer only) |
| `src/country-names.js` | English country names (generated) |
| `test/` | Automated tests (developer only) |
