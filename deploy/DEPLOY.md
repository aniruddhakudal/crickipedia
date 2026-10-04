# Deploy Crickipedia to production (e.g. crickipedia.in)

**If the site does not load at all:** read [DNS-SETUP.md](DNS-SETUP.md) first — `crickipedia.in` must exist in DNS.

Crickipedia is **one Node.js app** (`npm start`). It serves HTML **and** `/api/*`.  
Uploading only `index.html` / `admin.html` to static hosting **will not** expose `/api/health` or webhooks.

### Docker (recommended on a VPS)

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

## 1. On the server (VPS / VM)

```bash
cd /path/to/crickipedia
npm install --production
```

Create `.env` on the server (same keys as local: `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_*`, Supabase, WhatsApp, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, etc.).

```bash
npm start
# listens on PORT (default 3000), all interfaces (HOST=0.0.0.0)
```

Keep it running with **PM2** (recommended):

```bash
npm install -g pm2
pm2 start server/index.js --name crickipedia
pm2 save
pm2 startup
```

## 2. Reverse proxy (Nginx)

Point your domain at the Node process. Example:

```nginx
server {
    listen 443 ssl;
    server_name crickipedia.in;

    # ssl_certificate ... (your cert)

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 6M;
    }
}
```

Reload Nginx: `sudo nginx -t && sudo systemctl reload nginx`

## 3. DNS

`crickipedia.in` → **A record** (or CNAME) to the machine running Node + Nginx.

## 4. Verify

| URL | Expected |
|-----|----------|
| `https://crickipedia.in/api/ping` | `{"ok":true,"service":"crickipedia",...}` — **no database required** |
| `https://crickipedia.in/api/health` | `ok: true` if Postgres/Supabase is reachable |
| WhatsApp webhook GET (Meta verify) | Plain-text challenge number |

On the server itself:

```bash
curl -s http://127.0.0.1:3000/api/ping
curl -s http://127.0.0.1:3000/api/health
```

If ping works locally but not on HTTPS, fix **Nginx/proxy/DNS**.  
If ping fails locally, Node is not running or wrong port.

## 5. Common mistakes

- Only static files on cPanel — **run Node** or use a host that supports Node.
- Firewall blocking port 3000 externally — only Nginx :443 should be public; Node stays on localhost.
- `.env` missing on server — app exits or DB never connects.
- `DATABASE_URL` wrong on server — `/api/health` returns `ok: false` (ping may still work).
