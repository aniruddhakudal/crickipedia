const bcrypt = require("bcryptjs");

const ROLE_SUPER = "superadmin";
const ROLE_TOURNAMENT = "tournament_admin";

async function migrateAdminTables(query) {
  await query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(80) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(24) NOT NULL CHECK (role IN ('superadmin', 'tournament_admin')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS tournament_admin_assignments (
      admin_user_id BIGINT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      PRIMARY KEY (admin_user_id, tournament_id)
    )
  `);
}

async function seedSuperadminFromEnv(query, username, password) {
  if (!username || !password) return;
  const existing = await query("SELECT count(*)::int AS n FROM admin_users");
  if (existing.rows[0].n > 0) return;
  const hash = await bcrypt.hash(String(password), 12);
  await query(
    `INSERT INTO admin_users (username, password_hash, role, active)
     VALUES ($1, $2, $3, TRUE)`,
    [String(username).trim(), hash, ROLE_SUPER]
  );
  console.log("Created superadmin user from ADMIN_USERNAME (change password after first login if shared).");
}

async function findByUsername(query, username) {
  const result = await query(
    "SELECT id, username, password_hash, role, active FROM admin_users WHERE username = $1",
    [String(username || "").trim()]
  );
  return result.rows[0] || null;
}

async function loadTournamentIdsForUser(query, userId) {
  const result = await query(
    "SELECT tournament_id FROM tournament_admin_assignments WHERE admin_user_id = $1",
    [userId]
  );
  return result.rows.map((row) => Number(row.tournament_id));
}

async function authenticate(query, username, password) {
  const row = await findByUsername(query, username);
  if (!row || !row.active) return null;
  const ok = await bcrypt.compare(String(password || ""), row.password_hash);
  if (!ok) return null;
  const tournamentIds =
    row.role === ROLE_TOURNAMENT ? await loadTournamentIdsForUser(query, row.id) : [];
  if (row.role === ROLE_TOURNAMENT && !tournamentIds.length) {
    return null;
  }
  return {
    userId: row.id,
    username: row.username,
    role: row.role,
    tournamentIds
  };
}

async function listTournamentAdmins(query) {
  const result = await query(
    `SELECT u.id, u.username, u.active, u.created_at,
            t.id AS tournament_id, t.slug, t.name AS tournament_name
     FROM admin_users u
     LEFT JOIN tournament_admin_assignments a ON a.admin_user_id = u.id
     LEFT JOIN tournaments t ON t.id = a.tournament_id
     WHERE u.role = $1
     ORDER BY u.username, t.name`,
    [ROLE_TOURNAMENT]
  );
  const byId = new Map();
  for (const row of result.rows) {
    let entry = byId.get(row.id);
    if (!entry) {
      entry = {
        id: row.id,
        username: row.username,
        active: row.active,
        createdAt: row.created_at,
        tournaments: []
      };
      byId.set(row.id, entry);
    }
    if (row.tournament_id) {
      entry.tournaments.push({
        id: row.tournament_id,
        slug: row.slug,
        name: row.tournament_name
      });
    }
  }
  return Array.from(byId.values());
}

async function createTournamentAdmin(query, { username, password, tournamentSlug }) {
  const name = String(username || "").trim();
  if (name.length < 2) {
    const err = new Error("Username must be at least 2 characters");
    err.status = 400;
    throw err;
  }
  if (String(password || "").length < 6) {
    const err = new Error("Password must be at least 6 characters");
    err.status = 400;
    throw err;
  }
  const slug = String(tournamentSlug || "").trim();
  if (!slug) {
    const err = new Error("Tournament is required");
    err.status = 400;
    throw err;
  }
  const tournament = await query("SELECT id, slug, name FROM tournaments WHERE slug = $1", [slug]);
  if (!tournament.rows[0]) {
    const err = new Error("Tournament not found");
    err.status = 404;
    throw err;
  }
  const hash = await bcrypt.hash(String(password), 12);
  let userId;
  let createdAt;
  try {
    const inserted = await query(
      `INSERT INTO admin_users (username, password_hash, role, active)
       VALUES ($1, $2, $3, TRUE)
       RETURNING id, username, created_at`,
      [name, hash, ROLE_TOURNAMENT]
    );
    userId = inserted.rows[0].id;
    createdAt = inserted.rows[0].created_at;
  } catch (err) {
    if (err.code === "23505") {
      const dup = new Error("That username is already in use");
      dup.status = 400;
      throw dup;
    }
    throw err;
  }
  await query(
    `INSERT INTO tournament_admin_assignments (admin_user_id, tournament_id)
     VALUES ($1, $2)`,
    [userId, tournament.rows[0].id]
  );
  return {
    id: userId,
    username: name,
    active: true,
    createdAt: createdAt,
    tournaments: [
      {
        id: tournament.rows[0].id,
        slug: tournament.rows[0].slug,
        name: tournament.rows[0].name
      }
    ]
  };
}

async function setTournamentAdminActive(query, userId, active) {
  const result = await query(
    "UPDATE admin_users SET active = $2 WHERE id = $1 AND role = $3 RETURNING id",
    [userId, Boolean(active), ROLE_TOURNAMENT]
  );
  return result.rows[0] || null;
}

async function resetTournamentAdminPassword(query, userId, password) {
  if (String(password || "").length < 6) {
    const err = new Error("Password must be at least 6 characters");
    err.status = 400;
    throw err;
  }
  const hash = await bcrypt.hash(String(password), 12);
  const result = await query(
    "UPDATE admin_users SET password_hash = $2 WHERE id = $1 AND role = $3 RETURNING id",
    [userId, hash, ROLE_TOURNAMENT]
  );
  return result.rows[0] || null;
}

function isSuperadmin(sessionAdmin) {
  return sessionAdmin && sessionAdmin.role === ROLE_SUPER;
}

function canAccessTournamentId(sessionAdmin, tournamentId) {
  if (!sessionAdmin) return false;
  if (isSuperadmin(sessionAdmin)) return true;
  if (sessionAdmin.role !== ROLE_TOURNAMENT) return false;
  return (sessionAdmin.tournamentIds || []).includes(Number(tournamentId));
}

module.exports = {
  ROLE_SUPER,
  ROLE_TOURNAMENT,
  migrateAdminTables,
  seedSuperadminFromEnv,
  authenticate,
  listTournamentAdmins,
  createTournamentAdmin,
  setTournamentAdminActive,
  resetTournamentAdminPassword,
  isSuperadmin,
  canAccessTournamentId,
  loadTournamentIdsForUser
};
