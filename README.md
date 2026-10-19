# Crickipedia — Phase 2

Generic, admin-configurable player registration with a real Postgres database. One platform, many tournaments. Registrations survive redeploy and are shared across browsers.

## Included

- `index.html` — public registration page
- `admin.html` — sign-in, customize one tournament, view that event's players
- `app.js` — UI helpers + API client
- `server/` — Express API
- `schema.sql` — PostgreSQL model
- `docker-compose.yml` — local Postgres

## Run

1. Optional: start real Postgres (needs Docker):

```powershell
docker compose up -d
```

**Local (no account):** `DATABASE_DRIVER=pglite`

**Supabase:** create a project, then in `.env` set:

```
DATABASE_DRIVER=supabase
DATABASE_URL=   # Session pooler URI, not Transaction
SUPABASE_URL=   # https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=   # service_role secret
```

`npm start` creates tables and a public `player-photos` bucket. Do not paste the service_role key into the browser.

If Docker is not installed and Supabase is not set, `npm start` uses a local file database in `data/`.

2. Install and start the API (from the `crickipedia` folder):

```powershell
copy .env.example .env
npm install
npm start
```

3. Open:

- Player: http://localhost:3000/index.html?t=cpl-2026
- Admin: http://localhost:3000/admin.html

**Superadmin** (full admin): first account is created from `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` when the database has no admin users yet. Sign in at `/admin.html`.

**Tournament admins** (Players tab only, one tournament): sign in as superadmin → **Customize** → **Tournament admins** → set username, password, and tournament → **Create tournament admin**. Share those credentials with desk staff.

Do not use `python -m http.server` for Phase 2. The pages must be served by `npm start` so they can talk to `/api`.

**Production:** see [deploy/DEPLOY.md](deploy/DEPLOY.md). Site not loading? Start with [deploy/FIX-NOT-REACHABLE.md](deploy/FIX-NOT-REACHABLE.md) (DNS + Render/VPS). Quick cloud deploy: `render.yaml` on [Render](https://render.com).

## How it works

**Database**

- Tournaments, players, preferences, registrations, payments, sponsors
- Same WhatsApp can join two events, not the same event twice
- Player photos go to `uploads/` after the Registration ID is created

**Public page**

- Loads config from `GET /api/t/:slug/config`
- Required: name, WhatsApp, skill
- ID is created on the server, then photo uploads in the background
- **Pay:** Razorpay Checkout when `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set; otherwise demo tap writes `PAID`

**Admin**

- Cookie session. Customize and Players are blocked until sign-in
- Switcher still isolates one tournament at a time
- Save, create, delete, CSV and clear all hit the API

## Seeded event

Celebria Premier League 2026 (`cpl-2026`) is inserted if the database is empty.

## Payments

Per tournament (Admin → **Payment method**):

- **Razorpay** — online checkout (needs `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` on the server).
- **QR + receipt** — UPI QR (uploaded image or generated from UPI ID), receipt upload, admin **Approve** / **Decline** (player can resubmit).

## WhatsApp (Cloud API)

1. Create Meta templates with one body variable `{{1}}` (full message text): e.g. `registration_reserved`, `registration_confirmed`, `registration_rejected`.
2. Set `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` in `.env`.
3. Customize templates and category group links in Admin → **WhatsApp notifications** and **Registration categories**.
4. **Webhook (Meta dashboard):** Callback URL `https://crickipedia.in/api/webhooks/whatsapp`, Verify token = same value as `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in `.env`, then **Verify and save**. Subscribe to fields you need (e.g. `messages`). Restart the server after changing `.env`.

Messages fire on: new registration (reserved), Razorpay success (if enabled), admin approve (confirmed), admin decline (rejected).

**Troubleshooting:** Registration still succeeds if WhatsApp fails; check the server log. Common fixes:

1. **Phone number ID** — In [Meta Developers](https://developers.facebook.com/) → your app → **WhatsApp** → **API setup**, copy **Phone number ID** (not Business account ID) into `WHATSAPP_PHONE_NUMBER_ID`.
2. **System user** — In Business settings → **Users** → **System users** → your user → **Add assets** → assign the **WhatsApp account** (and phone) with messaging access. Generate a **new** token and set `WHATSAPP_ACCESS_TOKEN`. Restart the server.
3. **Verify** — While logged in as superadmin: `GET /api/admin/whatsapp-check` (JSON shows `displayPhoneNumber` when OK).
4. **Local dev without WhatsApp** — Leave `WHATSAPP_ACCESS_TOKEN` or `WHATSAPP_PHONE_NUMBER_ID` empty; automatic messages are skipped.

## Tournament season stats (charts)

- Stats are **per tournament**, not on the home page. Enable in Admin → **Customize** → **Season leaderboard stats** (stats league ID + division + data edition). Players see **View season stats** on that tournament’s registration page.
- **Stats league ID** groups seasons for the stats page (e.g. `srpl` for all SRPL seasons, `celebria` for CPL and CGL). Same ID on multiple tournaments lets players pick one or more seasons—or **All seasons**—to combine leaderboards.
- CSV data: `data/shankeshwaram/{gender}/{edition}/` (SRPL) and `data/celebria/{gender}/{edition}/` (CPL/CGL); JSON bundles in each store’s `_generated/` folder.
- Superadmin: Admin → **Season stats (CSVs)** tab to upload CricHeroes CSVs.
- API: `GET /api/stats/league/:leagueId`, `GET /api/stats/srpl/manifest`, `GET /api/stats/srpl/:gender/:edition/:board`, `GET /api/stats/srpl/:gender/merged/:board?editions=...`, merged players at `.../merged/players?editions=...`.
- **Search players:** `/players.html?gender=men&edition=cpl11` — search by name, then open a profile.
- Player profiles: `/player.html?gender=men&edition=cpl11&player=<id>` (from search or from names on the stats table).

## Later phases

Auctions, teams, live scoring, and deeper stats integration.
