const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

let driver = "pglite";
let pool = null;
let pglite = null;

function query(text, params) {
  if (driver === "pg") return pool.query(text, params);
  return pglite.query(text, params);
}

async function withTransaction(fn) {
  if (driver === "pg") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (rollbackErr) { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }
  return pglite.transaction(async (tx) => fn({
    query(text, params) {
      return tx.query(text, params);
    }
  }));
}

function wantsPostgres() {
  const mode = String(process.env.DATABASE_DRIVER || "").toLowerCase();
  return mode === "pg" || mode === "supabase";
}

function isSupabaseUrl(url) {
  return /supabase\.(co|com)/i.test(url || "");
}

async function connect() {
  if (wantsPostgres()) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_DRIVER is pg/supabase but DATABASE_URL is empty. Paste the Supabase Session pooler URI.");
    }
    const url = process.env.DATABASE_URL;
    pool = new Pool({
      connectionString: url,
      connectionTimeoutMillis: isSupabaseUrl(url) ? 20000 : 3000,
      ssl: isSupabaseUrl(url) || process.env.DATABASE_SSL === "1"
        ? { rejectUnauthorized: false }
        : undefined
    });
    try {
      await pool.query("SELECT 1");
      driver = "pg";
      console.log(isSupabaseUrl(url) ? "Using Supabase Postgres" : "Using PostgreSQL");
      return driver;
    } catch (err) {
      try { await pool.end(); } catch (endErr) { /* ignore */ }
      pool = null;
      throw new Error("Postgres/Supabase connection failed: " + err.message);
    }
  }
  const { PGlite } = require("@electric-sql/pglite");
  const dir = path.join(__dirname, "..", "data");
  fs.mkdirSync(dir, { recursive: true });
  pglite = new PGlite(path.join(dir, "crickipedia"));
  if (pglite.waitReady) await pglite.waitReady;
  driver = "pglite";
  console.log("Using local PGlite database in /data");
  return driver;
}

function defaultSettings() {
  return {
    tagline: "Official Player Registration",
    heroTitle: "Step onto the pitch.\nRegister your cricket profile.",
    heroSub: "Complete your player registration and secure your place in the tournament.",
    logoEmoji: "🏏",
    colors: {
      green: "#0b6b45",
      green2: "#0f8b5b",
      gold: "#f5b942",
      dark: "#071b16",
      light: "#f5f8f6"
    },
    currency: "₹",
    idPrefix: "CPL2026",
    noticeTitle: "Important",
    notice: "Your spot is reserved as soon as you get a Registration ID. Pay the entry fee to confirm.",
    whatsNext: "Your registration is the first step. Later phases add auctions, teams, live scoring and prizes.",
    supportWhatsapp: "",
    fields: {
      dob: true,
      flatNumber: true,
      category: true,
      jerseyNumber: true,
      jerseySize: true,
      sleeve: true,
      photo: true,
      cricheroes: true,
      instagram: true
    },
    skills: [
      { value: "Batter", label: "Batter", emoji: "🏏" },
      { value: "Bowler", label: "Bowler", emoji: "🎯" },
      { value: "Wicket Keeper", label: "WK", emoji: "🧤" },
      { value: "All Rounder", label: "All Rounder", emoji: "🔥" }
    ],
    jerseySizes: ["S", "M", "L", "XL", "XXL", "XXXL"],
    categories: ["Resident", "Guest", "Kids"],
    sleeves: ["Full Sleeve", "Half Sleeve"]
  };
}

function dateOnly(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function toClient(row, sponsors) {
  const settings = row.settings || {};
  return {
    slug: row.slug,
    name: row.name,
    shortName: row.short_name || "",
    tagline: settings.tagline || "",
    heroTitle: settings.heroTitle || "",
    heroSub: settings.heroSub || row.description || "",
    logoEmoji: settings.logoEmoji || "🏏",
    logoUrl: row.logo_url || "",
    colors: settings.colors || defaultSettings().colors,
    status: row.status,
    registrationStart: dateOnly(row.registration_start),
    registrationEnd: dateOnly(row.registration_end),
    fee: Number(row.entry_fee || 0),
    currency: settings.currency || "₹",
    idPrefix: settings.idPrefix || "",
    noticeTitle: settings.noticeTitle || "Important",
    notice: settings.notice || "",
    whatsNext: settings.whatsNext || "",
    supportWhatsapp: settings.supportWhatsapp || "",
    fields: settings.fields || defaultSettings().fields,
    skills: settings.skills || defaultSettings().skills,
    jerseySizes: settings.jerseySizes || defaultSettings().jerseySizes,
    categories: settings.categories && settings.categories.length ? settings.categories : defaultSettings().categories,
    sleeves: settings.sleeves || defaultSettings().sleeves,
    sponsors: (sponsors || []).map((item) => ({
      name: item.sponsor_name,
      logoUrl: item.logo_url || "",
      websiteUrl: item.website_url || ""
    }))
  };
}

function settingsFromClient(body) {
  return {
    tagline: body.tagline || "",
    heroTitle: body.heroTitle || "",
    heroSub: body.heroSub || "",
    logoEmoji: body.logoEmoji || "🏏",
    colors: body.colors || defaultSettings().colors,
    currency: body.currency || "₹",
    idPrefix: body.idPrefix || "",
    noticeTitle: body.noticeTitle || "Important",
    notice: body.notice || "",
    whatsNext: body.whatsNext || "",
    supportWhatsapp: body.supportWhatsapp || "",
    fields: body.fields || defaultSettings().fields,
    skills: body.skills && body.skills.length ? body.skills : defaultSettings().skills,
    jerseySizes: body.jerseySizes || [],
    categories: body.categories && body.categories.length ? body.categories : defaultSettings().categories,
    sleeves: body.sleeves || []
  };
}

function registrationToClient(row) {
  return {
    id: row.registration_number,
    tournamentSlug: row.slug,
    name: row.full_name,
    dob: dateOnly(row.date_of_birth),
    flat: row.flat_number || "",
    phone: row.whatsapp_number,
    skill: row.skill || "",
    category: row.category || "",
    jersey: row.suggested_jersey_number == null ? "" : String(row.suggested_jersey_number),
    size: row.jersey_size || "",
    sleeve: row.sleeve_type || "",
    cricheroes: row.cricheroes_url || "",
    instagram: row.instagram_url || "",
    photoName: row.photo_url ? path.basename(row.photo_url) : "",
    photoUrl: row.photo_url || "",
    createdAt: row.registered_at,
    paymentStatus: row.payment_status === "PAID" || row.status === "PAID" ? "PAID" : "PENDING"
  };
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  const statements = sql.split(";").map(function (part) {
    return part
      .split("\n")
      .filter(function (line) { return line.trim() && !line.trim().startsWith("--"); })
      .join("\n")
      .trim();
  }).filter(Boolean);
  for (const statement of statements) {
    await query(statement);
  }
  await query("ALTER TABLE players ADD COLUMN IF NOT EXISTS flat_number VARCHAR(30)");
  await query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS category VARCHAR(80)");
}

async function loadTournament(slug) {
  const result = await query("SELECT * FROM tournaments WHERE slug = $1", [slug]);
  if (!result.rows[0]) return null;
  const sponsors = await query(
    "SELECT * FROM sponsors WHERE tournament_id = $1 AND active = TRUE ORDER BY display_order, id",
    [result.rows[0].id]
  );
  return { row: result.rows[0], tournament: toClient(result.rows[0], sponsors.rows) };
}

async function replaceSponsors(tournamentId, sponsors) {
  await query("DELETE FROM sponsors WHERE tournament_id = $1", [tournamentId]);
  const list = (sponsors || []).filter((item) => item && item.name);
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    await query(
      `INSERT INTO sponsors (tournament_id, sponsor_name, logo_url, website_url, display_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [tournamentId, item.name, item.logoUrl || "", item.websiteUrl || "", i]
    );
  }
}

async function seed() {
  const existing = await query("SELECT count(*)::int AS n FROM tournaments");
  if (existing.rows[0].n > 0) return;
  const settings = defaultSettings();
  const inserted = await query(
    `INSERT INTO tournaments
      (slug, name, short_name, logo_url, description, registration_start, registration_end, entry_fee, status, settings)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     RETURNING id`,
    [
      "cpl-2026",
      "Celebria Premier League 2026",
      "CPL",
      "",
      settings.heroSub,
      "2026-09-20",
      "2026-09-30",
      500,
      "OPEN",
      JSON.stringify(settings)
    ]
  );
  await replaceSponsors(inserted.rows[0].id, [
    { name: "Sponsor 1" },
    { name: "Sponsor 2" },
    { name: "Sponsor 3" },
    { name: "Sponsor 4" }
  ]);
}

function getDriver() {
  return driver;
}

module.exports = {
  connect,
  getDriver,
  withTransaction,
  query,
  migrate,
  seed,
  defaultSettings,
  toClient,
  settingsFromClient,
  registrationToClient,
  loadTournament,
  replaceSponsors,
  dateOnly
};
