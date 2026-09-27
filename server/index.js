const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const db = require("./db");
const photoStorage = require("./storage");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const uploadDir = path.join(__dirname, "..", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = photoStorage.enabled()
  ? multer.memoryStorage()
  : multer.diskStorage({
    destination: uploadDir,
    filename(req, file, done) {
      const ext = path.extname(file.originalname || "").toLowerCase().replace(/[^\w.]/g, "") || ".jpg";
      done(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
  });

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, done) {
    if (!String(file.mimetype || "").startsWith("image/")) {
      done(new Error("Photo must be an image"));
      return;
    }
    done(null, true);
  }
});

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  session({
    name: "crickipedia.sid",
    secret: process.env.SESSION_SECRET || "dev-only-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);
app.use("/uploads", express.static(uploadDir));

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "tournament";
}

function prefixFromSlug(slug) {
  return String(slug || "CPL")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12) || "REG";
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) {
    next();
    return;
  }
  res.status(401).json({ error: "Sign in required" });
}

function publicState(tournament) {
  if (!tournament) return "DRAFT";
  if (tournament.status === "DRAFT") return "DRAFT";
  if (tournament.status === "CLOSED") return "CLOSED";
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (tournament.registrationStart && todayKey < tournament.registrationStart) return "UPCOMING";
  if (tournament.registrationEnd && todayKey > tournament.registrationEnd) return "CLOSED";
  return "OPEN";
}

function canPublicRegister(tournament, preview) {
  const state = publicState(tournament);
  return state === "OPEN" || (preview && state !== "CLOSED");
}

async function uniqueSlug(base) {
  let slug = base;
  let i = 2;
  while (true) {
    const found = await db.query("SELECT 1 FROM tournaments WHERE slug = $1", [slug]);
    if (!found.rows.length) return slug;
    slug = `${base}-${i}`;
    i += 1;
  }
}

async function nextRegId(tournament) {
  const prefix = tournament.idPrefix || prefixFromSlug(tournament.slug);
  for (let i = 0; i < 8; i += 1) {
    const id = `${prefix}-${String(Date.now()).slice(-6)}${i ? Math.random().toString(36).slice(2, 4).toUpperCase() : ""}`;
    const found = await db.query("SELECT 1 FROM registrations WHERE registration_number = $1", [id]);
    if (!found.rows.length) return id;
  }
  return `${prefix}-${Date.now()}`;
}

async function findRegistration(slug, phoneOrId) {
  const result = await db.query(
    `SELECT r.registration_number, r.category, r.status, r.registered_at,
            t.slug, p.full_name, p.date_of_birth, p.flat_number, p.whatsapp_number, p.photo_url,
            p.cricheroes_url, p.instagram_url,
            pref.skill, pref.suggested_jersey_number, pref.jersey_size, pref.sleeve_type,
            pay.payment_status
     FROM registrations r
     JOIN tournaments t ON t.id = r.tournament_id
     JOIN players p ON p.id = r.player_id
     LEFT JOIN player_preferences pref ON pref.player_id = p.id
     LEFT JOIN payments pay ON pay.registration_id = r.id
     WHERE t.slug = $1 AND (p.whatsapp_number = $2 OR r.registration_number = $2)
     LIMIT 1`,
    [slug, phoneOrId]
  );
  return result.rows[0] ? db.registrationToClient(result.rows[0]) : null;
}

app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({
      ok: true,
      db: true,
      driver: db.getDriver(),
      photos: photoStorage.enabled() ? "supabase" : "local"
    });
  } catch (err) {
    res.status(500).json({ ok: false, db: false, error: err.message });
  }
});

app.get("/api/tournaments", async (req, res) => {
  try {
    const preview = req.query.preview === "1";
    const result = await db.query("SELECT * FROM tournaments ORDER BY name");
    const list = [];
    for (const row of result.rows) {
      const loaded = await db.loadTournament(row.slug);
      const state = publicState(loaded.tournament);
      if (preview || state === "OPEN" || state === "UPCOMING" || state === "CLOSED") {
        if (!preview && loaded.tournament.status === "DRAFT") continue;
        list.push(loaded.tournament);
      }
    }
    res.json({ tournaments: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/t/:slug/config", async (req, res) => {
  try {
    const loaded = await db.loadTournament(req.params.slug);
    if (!loaded) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    if (loaded.tournament.status === "DRAFT" && req.query.preview !== "1") {
      res.json({ tournament: loaded.tournament, state: "DRAFT" });
      return;
    }
    res.json({ tournament: loaded.tournament, state: publicState(loaded.tournament) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/t/:slug/lookup", async (req, res) => {
  try {
    const phone = String(req.query.phone || "").replace(/\D/g, "");
    if (phone.length !== 10) {
      res.json({ record: null });
      return;
    }
    res.json({ record: await findRegistration(req.params.slug, phone) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/t/:slug/register", async (req, res) => {
  try {
    const preview = req.query.preview === "1" || req.body.preview === true;
    const loaded = await db.loadTournament(req.params.slug);
    if (!loaded) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    if (!canPublicRegister(loaded.tournament, preview)) {
      res.status(400).json({ error: "Registration is not open" });
      return;
    }

    const name = String(req.body.name || "").trim();
    const phone = String(req.body.phone || "").replace(/\D/g, "");
    const skill = String(req.body.skill || "").trim();
    if (name.length < 2) {
      res.status(400).json({ error: "Full name is required" });
      return;
    }
    if (phone.length !== 10) {
      res.status(400).json({ error: "WhatsApp number must be 10 digits" });
      return;
    }
    if (!skill) {
      res.status(400).json({ error: "Select a playing skill" });
      return;
    }
    const flat = String(req.body.flat || "").trim();
    const wantFlat = !loaded.tournament.fields || loaded.tournament.fields.flatNumber !== false;
    if (wantFlat && !flat) {
      res.status(400).json({ error: "Flat number is required" });
      return;
    }
    const category = String(req.body.category || "").trim();
    const wantCategory = !loaded.tournament.fields || loaded.tournament.fields.category !== false;
    if (wantCategory && !category) {
      res.status(400).json({ error: "Select a registration category" });
      return;
    }
    const allowed = loaded.tournament.categories || [];
    if (wantCategory && allowed.length && allowed.indexOf(category) === -1) {
      res.status(400).json({ error: "Invalid registration category" });
      return;
    }

    const existing = await findRegistration(req.params.slug, phone);
    if (existing) {
      res.json({ record: existing, existing: true });
      return;
    }

    const dob = req.body.dob || null;
    const jersey = req.body.jersey === "" || req.body.jersey == null ? null : Number(req.body.jersey);
    const size = req.body.size || null;
    const sleeve = req.body.sleeve || null;
    const cricheroes = req.body.cricheroes || null;
    const instagram = req.body.instagram || null;
    const registrationNumber = await nextRegId(loaded.tournament);

    await db.withTransaction(async (client) => {
      let player = await client.query("SELECT * FROM players WHERE whatsapp_number = $1", [phone]);
      let playerId;
      if (player.rows[0]) {
        playerId = player.rows[0].id;
        await client.query(
          `UPDATE players
           SET full_name = $2, date_of_birth = COALESCE($3, date_of_birth),
               flat_number = COALESCE($4, flat_number),
               cricheroes_url = COALESCE($5, cricheroes_url),
               instagram_url = COALESCE($6, instagram_url),
               updated_at = NOW()
           WHERE id = $1`,
          [playerId, name, dob, flat || null, cricheroes, instagram]
        );
      } else {
        player = await client.query(
          `INSERT INTO players (full_name, date_of_birth, flat_number, whatsapp_number, cricheroes_url, instagram_url)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [name, dob, flat || null, phone, cricheroes, instagram]
        );
        playerId = player.rows[0].id;
      }

      await client.query(
        `INSERT INTO player_preferences (player_id, skill, suggested_jersey_number, jersey_size, sleeve_type)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (player_id) DO UPDATE SET
           skill = EXCLUDED.skill,
           suggested_jersey_number = COALESCE(EXCLUDED.suggested_jersey_number, player_preferences.suggested_jersey_number),
           jersey_size = COALESCE(EXCLUDED.jersey_size, player_preferences.jersey_size),
           sleeve_type = COALESCE(EXCLUDED.sleeve_type, player_preferences.sleeve_type)`,
        [playerId, skill, Number.isFinite(jersey) ? jersey : null, size, sleeve]
      );

      const registration = await client.query(
        `INSERT INTO registrations (registration_number, tournament_id, player_id, category, status)
         VALUES ($1, $2, $3, $4, 'PENDING_PAYMENT') RETURNING *`,
        [registrationNumber, loaded.row.id, playerId, category || null]
      );
      await client.query(
        `INSERT INTO payments (registration_id, amount, payment_status, gateway)
         VALUES ($1, $2, 'PENDING', 'DEMO')`,
        [registration.rows[0].id, loaded.tournament.fee]
      );
    });

    res.status(201).json({
      record: await findRegistration(req.params.slug, registrationNumber),
      existing: false
    });
  } catch (err) {
    if (err.code === "23505") {
      res.json({ record: await findRegistration(req.params.slug, String(req.body.phone || "").replace(/\D/g, "")), existing: true });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/t/:slug/registrations/:id/photo", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Choose a photo" });
      return;
    }
    const found = await db.query(
      `SELECT p.id
       FROM registrations r
       JOIN tournaments t ON t.id = r.tournament_id
       JOIN players p ON p.id = r.player_id
       WHERE t.slug = $1 AND r.registration_number = $2`,
      [req.params.slug, req.params.id]
    );
    if (!found.rows[0]) {
      if (req.file.path) fs.unlink(req.file.path, () => {});
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    const photoUrl = await photoStorage.savePlayerPhoto(found.rows[0].id, req.file);
    await db.query("UPDATE players SET photo_url = $2, updated_at = NOW() WHERE id = $1", [
      found.rows[0].id,
      photoUrl
    ]);
    res.json({ record: await findRegistration(req.params.slug, req.params.id), photoUrl });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/t/:slug/registrations/:id/pay", async (req, res) => {
  try {
    const found = await db.query(
      `SELECT r.id
       FROM registrations r
       JOIN tournaments t ON t.id = r.tournament_id
       WHERE t.slug = $1 AND r.registration_number = $2`,
      [req.params.slug, req.params.id]
    );
    if (!found.rows[0]) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    await db.query(
      `UPDATE payments SET payment_status = 'PAID', paid_at = NOW(), gateway = 'DEMO'
       WHERE registration_id = $1`,
      [found.rows[0].id]
    );
    await db.query("UPDATE registrations SET status = 'PAID' WHERE id = $1", [found.rows[0].id]);
    res.json({ record: await findRegistration(req.params.slug, req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/login", (req, res) => {
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Wrong username or password" });
    return;
  }
  req.session.admin = { username };
  res.json({ ok: true, username });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.json({ username: req.session.admin.username });
});

app.get("/api/admin/tournaments", requireAdmin, async (req, res) => {
  try {
    const result = await db.query("SELECT slug FROM tournaments ORDER BY name");
    const tournaments = [];
    for (const row of result.rows) {
      const loaded = await db.loadTournament(row.slug);
      tournaments.push(loaded.tournament);
    }
    res.json({ tournaments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/tournaments", requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    const sourceSlug = req.body.copyFrom;
    const source = sourceSlug ? await db.loadTournament(sourceSlug) : null;
    const base = source ? source.tournament : {
      ...db.toClient({
        slug: "new",
        name,
        short_name: "",
        logo_url: "",
        description: "",
        registration_start: new Date(),
        registration_end: new Date(),
        entry_fee: 0,
        status: "DRAFT",
        settings: db.defaultSettings()
      }, [])
    };
    const slug = await uniqueSlug(slugify(req.body.slug || name));
    const shortName = req.body.shortName || name.split(/\s+/).map((part) => part.charAt(0)).join("").toUpperCase().slice(0, 6) || "CUP";
    const settings = db.settingsFromClient({
      ...base,
      ...req.body,
      idPrefix: req.body.idPrefix || prefixFromSlug(slug)
    });
    const inserted = await db.query(
      `INSERT INTO tournaments
        (slug, name, short_name, logo_url, description, registration_start, registration_end, entry_fee, status, settings)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9::jsonb)
       RETURNING slug`,
      [
        slug,
        name,
        shortName,
        base.logoUrl || "",
        settings.heroSub,
        base.registrationStart || "2026-09-20",
        base.registrationEnd || "2026-09-30",
        Number(base.fee || 0),
        JSON.stringify(settings)
      ]
    );
    await db.replaceSponsors(
      (await db.loadTournament(inserted.rows[0].slug)).row.id,
      base.sponsors || []
    );
    res.status(201).json({ tournament: (await db.loadTournament(inserted.rows[0].slug)).tournament });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/admin/tournaments/:slug", requireAdmin, async (req, res) => {
  try {
    const loaded = await db.loadTournament(req.params.slug);
    if (!loaded) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    const nextSlug = slugify(req.body.slug || req.params.slug);
    if (nextSlug !== req.params.slug) {
      const clash = await db.query("SELECT 1 FROM tournaments WHERE slug = $1", [nextSlug]);
      if (clash.rows.length) {
        res.status(400).json({ error: "That slug is already used" });
        return;
      }
    }
    const settings = db.settingsFromClient(req.body);
    await db.query(
      `UPDATE tournaments SET
        slug = $2, name = $3, short_name = $4, logo_url = $5, description = $6,
        registration_start = $7, registration_end = $8, entry_fee = $9, status = $10,
        settings = $11::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [
        loaded.row.id,
        nextSlug,
        String(req.body.name || loaded.tournament.name).trim(),
        req.body.shortName || loaded.tournament.shortName,
        req.body.logoUrl || "",
        settings.heroSub,
        req.body.registrationStart,
        req.body.registrationEnd,
        Number(req.body.fee || 0),
        req.body.status || loaded.tournament.status,
        JSON.stringify(settings)
      ]
    );
    await db.replaceSponsors(loaded.row.id, req.body.sponsors);
    res.json({ tournament: (await db.loadTournament(nextSlug)).tournament });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/tournaments/:slug", requireAdmin, async (req, res) => {
  try {
    const count = await db.query("SELECT count(*)::int AS n FROM tournaments");
    if (count.rows[0].n < 2) {
      res.status(400).json({ error: "Keep at least one tournament" });
      return;
    }
    const loaded = await db.loadTournament(req.params.slug);
    if (!loaded) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    await db.query("DELETE FROM tournaments WHERE id = $1", [loaded.row.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/tournaments/:slug/registrations", requireAdmin, async (req, res) => {
  try {
    const loaded = await db.loadTournament(req.params.slug);
    if (!loaded) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    const result = await db.query(
      `SELECT r.registration_number, r.category, r.status, r.registered_at,
              t.slug, p.full_name, p.date_of_birth, p.flat_number, p.whatsapp_number, p.photo_url,
              p.cricheroes_url, p.instagram_url,
              pref.skill, pref.suggested_jersey_number, pref.jersey_size, pref.sleeve_type,
              pay.payment_status
       FROM registrations r
       JOIN tournaments t ON t.id = r.tournament_id
       JOIN players p ON p.id = r.player_id
       LEFT JOIN player_preferences pref ON pref.player_id = p.id
       LEFT JOIN payments pay ON pay.registration_id = r.id
       WHERE t.slug = $1
       ORDER BY r.registered_at DESC`,
      [req.params.slug]
    );
    res.json({ registrations: result.rows.map(db.registrationToClient) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/tournaments/:slug/registrations", requireAdmin, async (req, res) => {
  try {
    const loaded = await db.loadTournament(req.params.slug);
    if (!loaded) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    await db.query("DELETE FROM registrations WHERE tournament_id = $1", [loaded.row.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/tournaments/:slug/registrations.csv", requireAdmin, async (req, res) => {
  try {
    const loaded = await db.loadTournament(req.params.slug);
    if (!loaded) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    const result = await db.query(
      `SELECT r.registration_number, r.category, r.status, r.registered_at,
              t.slug, t.name AS tournament_name, p.full_name, p.date_of_birth, p.flat_number, p.whatsapp_number, p.photo_url,
              p.cricheroes_url, p.instagram_url,
              pref.skill, pref.suggested_jersey_number, pref.jersey_size, pref.sleeve_type,
              pay.payment_status
       FROM registrations r
       JOIN tournaments t ON t.id = r.tournament_id
       JOIN players p ON p.id = r.player_id
       LEFT JOIN player_preferences pref ON pref.player_id = p.id
       LEFT JOIN payments pay ON pay.registration_id = r.id
       WHERE t.slug = $1
       ORDER BY r.registered_at DESC`,
      [req.params.slug]
    );
    const header = [
      "Tournament", "Registration ID", "Name", "Flat", "Category", "DOB", "WhatsApp", "Skill", "Jersey",
      "Size", "Sleeve", "CricHeroes", "Instagram", "Photo", "Created At", "Payment Status"
    ];
    const lines = [header.map(csvEscape).join(",")].concat(
      result.rows.map((row) => {
        const rec = db.registrationToClient(row);
        return [
          row.tournament_name, rec.id, rec.name, rec.flat, rec.category, rec.dob, rec.phone, rec.skill, rec.jersey,
          rec.size, rec.sleeve, rec.cricheroes, rec.instagram, rec.photoUrl, rec.createdAt, rec.paymentStatus
        ].map(csvEscape).join(",");
      })
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.slug}-registrations.csv"`);
    res.send(lines.join("\n"));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function csvEscape(value) {
  return `"${String(value == null ? "" : value).replaceAll('"', '""')}"`;
}

app.use(express.static(path.join(__dirname, "..")));

async function start() {
  await db.connect();
  await db.migrate();
  await db.seed();
  await photoStorage.init();
  app.listen(PORT, () => {
    console.log(`Crickipedia Phase 2 http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
