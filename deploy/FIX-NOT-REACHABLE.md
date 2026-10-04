# Fix: site or /api/ping not reachable

## What we cannot fix in code

**`crickipedia.in` must exist in public DNS.** If the domain was never registered or no `crickipedia` record was added, the browser and Meta cannot reach your server. That is configured at your **domain registrar** (where you manage `crickipedia.in`), not in this repository.

Check (from home network or https://dnschecker.org):

- `crickipedia.in` — A or CNAME pointing to your server/host?

---

## Path A — You want `crickipedia.in` (recommended long-term)

1. **Register** `crickipedia.in` if you have not already.
2. **DNS record** (example for a VPS at IP `203.0.113.50`):

   | Type | Name | Value        |
   |------|------|--------------|
   | A    | `@`  | 203.0.113.50 |

3. **On the VPS**, clone repo, add `.env`, run:

   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

4. **HTTPS**: Caddy or Nginx + Let’s Encrypt for `crickipedia.in` → port `3000`.

5. Test: `https://crickipedia.in/api/ping`

---

## Path B — Get online today without custom DNS (Render)

1. Push this repo to GitHub (already `aniruddhakudal/crickipedia`).
2. [Render](https://render.com) → **New** → **Blueprint** → select repo → use `render.yaml`.
3. In Render **Environment**, paste every key from your local `.env` (Supabase, WhatsApp, admin, etc.).
4. After deploy, open: `https://crickipedia.onrender.com/api/ping` (name may vary).
5. **Meta webhook** (temporary): use  
   `https://YOUR-SERVICE.onrender.com/api/webhooks/whatsapp`  
   until custom domain works.
6. Later: Render **Settings → Custom Domains** → add `crickipedia.in` → add the **CNAME** Render shows at your registrar.

---

## Path C — Local dev + WhatsApp test only

```bash
npm start
```

Use [ngrok](https://ngrok.com): `ngrok http 3000` → put `https://xxxx.ngrok-free.app/api/webhooks/whatsapp` in Meta. Not for production.

---

## Corporate VPN note

If `nslookup` fails only on office VPN, try from mobile data or home Wi‑Fi; IQVIA DNS may block or not see your domain yet.
