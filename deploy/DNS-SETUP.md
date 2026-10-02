# Fix “crickipedia.in not reachable”

`/api/ping` is served by **your Node app**. If the domain does not resolve in DNS, **no code change will help** until DNS and hosting are set up.

## Step 1 — Create DNS for the subdomain

Where you manage **crickipedia.in** (GoDaddy, Cloudflare, Namecheap, etc.):

| Type | Name / Host | Value |
|------|-------------|--------|
| **A** | `@` (root) | Public IP of your VPS/server |
| **or CNAME** | `@` or `www` | Your host’s URL (e.g. `your-app.onrender.com`) |

Wait 5–60 minutes, then check:

```text
nslookup crickipedia.in
```

You must see an **Address** (IP), not “Non-existent domain”.

## Step 2 — Run the app on that server

On the machine with that IP (SSH):

```bash
git clone https://github.com/aniruddhakudal/crickipedia.git
cd crickipedia
# copy your production .env here (never commit it)
docker compose -f docker-compose.prod.yml up -d --build
```

Or without Docker: `npm install && npm start` (see [DEPLOY.md](DEPLOY.md)).

Test on the server:

```bash
curl http://127.0.0.1:3000/api/ping
```

## Step 3 — HTTPS reverse proxy

Browsers and Meta need **HTTPS**. Point Nginx/Caddy at `http://127.0.0.1:3000` for host `crickipedia.in`. Example Nginx block is in [DEPLOY.md](DEPLOY.md).

## Step 4 — Verify in browser

- https://crickipedia.in/api/ping → `{"ok":true,"service":"crickipedia",...}`
- Then Meta webhook **Verify and save**

## If you don’t have a VPS yet

Use a Node host (Render, Railway, Fly.io, DigitalOcean App Platform):

1. Deploy this repo with start command `npm start` and env vars from `.env`.
2. Add **CNAME** `crickipedia` → hostname they give you.
3. Enable HTTPS on their dashboard.
