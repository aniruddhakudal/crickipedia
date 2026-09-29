const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const settingsUtil = require("./settings");

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
    notice: "Your spot is reserved as soon as you register. Pay the entry fee to confirm.",
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
    categories: settingsUtil.normalizeCategories(null),
    sleeves: ["Full Sleeve", "Half Sleeve"],
    payment: settingsUtil.defaultPaymentSettings(),
    whatsapp: settingsUtil.defaultWhatsappSettings()
  };
}

function dateOnly(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function combinedSlug(tournamentSlug, seasonSlug) {
  const t = String(tournamentSlug || "tournament").trim();
  const s = String(seasonSlug || "season").trim();
  return `${t}-${s}`;
}

function parseLegacySlug(slug) {
  const text = String(slug || "").trim();
  const match = text.match(/^(.+)-(\d{4})$/);
  if (match) {
    return { tournamentSlug: match[1], seasonSlug: match[2] };
  }
  return { tournamentSlug: text || "tournament", seasonSlug: "season" };
}

function toClient(row, sponsors) {
  const settings = row.settings || {};
  const tournamentSlug = row.tournament_slug || parseLegacySlug(row.slug).tournamentSlug;
  const seasonSlug = row.season_slug || parseLegacySlug(row.slug).seasonSlug;
  return {
    slug: row.slug,
    tournamentSlug,
    seasonSlug,
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
    categories: settingsUtil.normalizeCategories(
      settings.categories && settings.categories.length ? settings.categories : defaultSettings().categories
    ),
    sleeves: settings.sleeves || defaultSettings().sleeves,
    payment: settingsUtil.mergePaymentSettings(settings),
    whatsapp: settingsUtil.mergeWhatsappSettings(settings),
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
    categories: settingsUtil.normalizeCategories(
      body.categories && body.categories.length ? body.categories : defaultSettings().categories
    ),
    sleeves: body.sleeves || [],
    payment: settingsUtil.mergePaymentSettings({ payment: body.payment }),
    whatsapp: settingsUtil.mergeWhatsappSettings({ whatsapp: body.whatsapp })
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
    paymentStatus: row.payment_status === "PAID" || row.status === "PAID" ? "PAID" : "PENDING",
    registrationStatus: row.status || "PENDING_PAYMENT",
    verificationStatus: row.verification_status || "",
    receiptUrl: row.receipt_url || "",
    receiptUpiRef: row.receipt_upi_ref || "",
    rejectReason: row.reject_reason || ""
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
    if (/^DROP\s+TABLE/i.test(statement)) continue;
    await query(statement);
  }
  await query("ALTER TABLE players ADD COLUMN IF NOT EXISTS flat_number VARCHAR(30)");
  await query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS category VARCHAR(80)");
  await query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_order_id VARCHAR(150)");
  await query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_url TEXT");
  await query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_upi_ref VARCHAR(120)");
  await query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS verification_status VARCHAR(40)");
  await query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS reject_reason TEXT");
  await query("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS tournament_slug VARCHAR(48)");
  await query("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS season_slug VARCHAR(48)");
  const rows = await query("SELECT id, slug, tournament_slug, season_slug FROM tournaments");
  for (const row of rows.rows) {
    const parsed = parseLegacySlug(row.slug);
    const tournamentSlug = row.tournament_slug || parsed.tournamentSlug;
    const seasonSlug = row.season_slug || parsed.seasonSlug;
    await query(
      "UPDATE tournaments SET tournament_slug = $2, season_slug = $3 WHERE id = $1",
      [row.id, tournamentSlug, seasonSlug]
    );
  }
  await query(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_tournaments_tournament_season ON tournaments(tournament_slug, season_slug)"
  );
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

async function loadTournamentByKeys(tournamentSlug, seasonSlug) {
  const result = await query(
    "SELECT * FROM tournaments WHERE tournament_slug = $1 AND season_slug = $2",
    [tournamentSlug, seasonSlug]
  );
  if (!result.rows[0]) return null;
  const sponsors = await query(
    "SELECT * FROM sponsors WHERE tournament_id = $1 AND active = TRUE ORDER BY display_order, id",
    [result.rows[0].id]
  );
  return { row: result.rows[0], tournament: toClient(result.rows[0], sponsors.rows) };
}

async function loadTournamentFromParams(params) {
  if (params.season !== undefined && params.tournament !== undefined) {
    return loadTournamentByKeys(params.tournament, params.season);
  }
  if (params.slug) return loadTournament(params.slug);
  return null;
}

async function listTournamentsClient() {
  const result = await query("SELECT * FROM tournaments ORDER BY name");
  const rows = result.rows;
  if (!rows.length) return [];

  const ids = rows.map((row) => row.id);
  const sponsorsResult = await query(
    `SELECT * FROM sponsors
     WHERE active = TRUE AND tournament_id = ANY($1::bigint[])
     ORDER BY tournament_id, display_order, id`,
    [ids]
  );
  const sponsorsByTournamentId = new Map();
  for (const sponsor of sponsorsResult.rows) {
    const list = sponsorsByTournamentId.get(sponsor.tournament_id) || [];
    list.push(sponsor);
    sponsorsByTournamentId.set(sponsor.tournament_id, list);
  }

  return rows.map((row) => toClient(row, sponsorsByTournamentId.get(row.id) || []));
}

function sponsorsFromClient(sponsors) {
  return (sponsors || [])
    .filter((item) => item && item.name)
    .map((item, index) => ({
      sponsor_name: item.name,
      logo_url: item.logoUrl || "",
      website_url: item.websiteUrl || "",
      display_order: index
    }));
}

async function loadTournamentRow(slug) {
  const result = await query("SELECT * FROM tournaments WHERE slug = $1", [slug]);
  return result.rows[0] || null;
}

async function replaceSponsorsOnClient(client, tournamentId, sponsors) {
  const list = sponsorsFromClient(sponsors);
  await client.query("DELETE FROM sponsors WHERE tournament_id = $1", [tournamentId]);
  if (!list.length) return list;
  const params = [];
  const tuples = [];
  let paramIndex = 1;
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    tuples.push(
      `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4})`
    );
    params.push(tournamentId, item.sponsor_name, item.logo_url, item.website_url, item.display_order);
    paramIndex += 5;
  }
  await client.query(
    `INSERT INTO sponsors (tournament_id, sponsor_name, logo_url, website_url, display_order)
     VALUES ${tuples.join(", ")}`,
    params
  );
  return list;
}

async function replaceSponsors(tournamentId, sponsors) {
  await withTransaction(async (client) => {
    await replaceSponsorsOnClient(client, tournamentId, sponsors);
  });
}

async function updateTournamentFromAdmin(existing, payload) {
  const {
    tournamentSlug,
    seasonSlug,
    nextSlug,
    settings,
    name,
    shortName,
    logoUrl,
    registrationStart,
    registrationEnd,
    fee,
    status,
    sponsors
  } = payload;
  const keysChanged = tournamentSlug !== existing.tournament_slug || seasonSlug !== existing.season_slug;

  return withTransaction(async (client) => {
    if (keysChanged) {
      const clash = await client.query(
        "SELECT 1 FROM tournaments WHERE tournament_slug = $1 AND season_slug = $2 AND id <> $3",
        [tournamentSlug, seasonSlug, existing.id]
      );
      if (clash.rows.length) {
        const err = new Error("That tournament and season URL is already used");
        err.status = 400;
        throw err;
      }
    }
    const updated = await client.query(
      `UPDATE tournaments SET
        slug = $2, tournament_slug = $3, season_slug = $4, name = $5, short_name = $6, logo_url = $7, description = $8,
        registration_start = $9, registration_end = $10, entry_fee = $11, status = $12,
        settings = $13::jsonb, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        existing.id,
        nextSlug,
        tournamentSlug,
        seasonSlug,
        name,
        shortName,
        logoUrl,
        settings.heroSub,
        registrationStart,
        registrationEnd,
        fee,
        status,
        JSON.stringify(settings)
      ]
    );
    const sponsorRows = await replaceSponsorsOnClient(client, existing.id, sponsors);
    return { row: updated.rows[0], sponsorRows };
  });
}

async function seed() {
  const existing = await query("SELECT count(*)::int AS n FROM tournaments");
  if (existing.rows[0].n > 0) return;
  const settings = defaultSettings();
  const inserted = await query(
    `INSERT INTO tournaments
      (slug, tournament_slug, season_slug, name, short_name, logo_url, description, registration_start, registration_end, entry_fee, status, settings)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
     RETURNING id`,
    [
      "cpl-2026",
      "cpl",
      "2026",
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
  loadTournamentByKeys,
  loadTournamentFromParams,
  listTournamentsClient,
  combinedSlug,
  parseLegacySlug,
  replaceSponsors,
  updateTournamentFromAdmin,
  sponsorsFromClient,
  loadTournamentRow,
  dateOnly
};
