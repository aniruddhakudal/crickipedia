const photoStorage = require("./storage");

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function entryToPublic(row) {
  const hasAttachment = Boolean(row.attachment_url || row.payment_receipt_url);
  return {
    id: String(row.id),
    type: row.entry_type,
    source: row.source,
    amount: roundMoney(row.amount),
    description: row.description || "",
    occurredAt: row.occurred_at,
    hasAttachment,
    registrationId: row.registration_number || "",
    paymentGateway: row.gateway || ""
  };
}

function entryToAdmin(row) {
  return {
    ...entryToPublic(row),
    registrationId: row.registration_number || "",
    attachmentUrl: row.attachment_url || "",
    createdAt: row.created_at,
    editable: row.source === "manual"
  };
}

async function fetchEntryWithContext(query, tournamentId, entryId) {
  const result = await query(
    `SELECT e.*, r.registration_number,
            pay.receipt_url AS payment_receipt_url, pay.gateway
     FROM ledger_entries e
     LEFT JOIN registrations r ON r.id = e.registration_id
     LEFT JOIN payments pay ON pay.registration_id = r.id
     WHERE e.tournament_id = $1 AND e.id = $2`,
    [tournamentId, entryId]
  );
  return result.rows[0] || null;
}

function resolveAttachmentUrl(row) {
  if (row.attachment_url) return row.attachment_url;
  if (row.payment_receipt_url) return row.payment_receipt_url;
  return "";
}

async function ensureRegistrationCredit(query, slug, registrationId) {
  if (!registrationId) return null;
  const loaded = await query(
    `SELECT r.id, r.tournament_id, r.registration_number, r.category,
            pay.amount, pay.receipt_url, pay.paid_at, pay.payment_status, pay.gateway,
            p.full_name
     FROM registrations r
     JOIN tournaments t ON t.id = r.tournament_id
     JOIN players p ON p.id = r.player_id
     LEFT JOIN payments pay ON pay.registration_id = r.id
     WHERE r.id = $1 AND t.slug = $2`,
    [registrationId, slug]
  );
  const row = loaded.rows[0];
  if (!row || row.payment_status !== "PAID") return null;

  const existing = await query(
    `SELECT id FROM ledger_entries
     WHERE tournament_id = $1 AND registration_id = $2 AND source = 'registration'`,
    [row.tournament_id, row.id]
  );
  if (existing.rows[0]) {
    if (row.receipt_url) {
      await query(
        `UPDATE ledger_entries
         SET attachment_url = $2
         WHERE id = $1 AND (attachment_url IS NULL OR attachment_url = '')`,
        [existing.rows[0].id, row.receipt_url]
      );
    }
    return existing.rows[0].id;
  }

  const category = row.category ? ` (${row.category})` : "";
  const description = `Registration — ${row.full_name || "Player"}${category}`;
  const amount = roundMoney(row.amount);
  const occurredAt = row.paid_at || new Date();
  const attachmentUrl = row.receipt_url || "";

  const inserted = await query(
    `INSERT INTO ledger_entries (
       tournament_id, entry_type, source, registration_id, amount, description,
       occurred_at, attachment_url
     ) VALUES ($1, 'credit', 'registration', $2, $3, $4, $5, $6)
     RETURNING id`,
    [row.tournament_id, row.id, amount, description, occurredAt, attachmentUrl || null]
  );
  return inserted.rows[0].id;
}

async function syncPaidRegistrations(query, tournamentId) {
  const result = await query(
    `SELECT r.id AS registration_id, t.slug
     FROM registrations r
     JOIN tournaments t ON t.id = r.tournament_id
     JOIN payments pay ON pay.registration_id = r.id
     WHERE r.tournament_id = $1 AND pay.payment_status = 'PAID'`,
    [tournamentId]
  );
  let added = 0;
  for (const row of result.rows) {
    const before = await query(
      `SELECT id FROM ledger_entries
       WHERE tournament_id = $1 AND registration_id = $2 AND source = 'registration'`,
      [tournamentId, row.registration_id]
    );
    if (before.rows[0]) continue;
    await ensureRegistrationCredit(query, row.slug, row.registration_id);
    added += 1;
  }
  return added;
}

async function reverseRegistrationCredit(query, tournamentId, registrationId) {
  if (!registrationId) return null;

  const existingReversal = await query(
    `SELECT id FROM ledger_entries
     WHERE tournament_id = $1 AND registration_id = $2 AND source = 'registration_reversal'`,
    [tournamentId, registrationId]
  );
  if (existingReversal.rows[0]) return existingReversal.rows[0].id;

  const reg = await query(
    `SELECT r.registration_number, r.category, p.full_name,
            pay.payment_status, pay.amount
     FROM registrations r
     JOIN players p ON p.id = r.player_id
     LEFT JOIN payments pay ON pay.registration_id = r.id
     WHERE r.id = $1 AND r.tournament_id = $2`,
    [registrationId, tournamentId]
  );
  const regRow = reg.rows[0];
  if (!regRow || regRow.payment_status !== "PAID") return null;

  const credit = await query(
    `SELECT amount, description FROM ledger_entries
     WHERE tournament_id = $1 AND registration_id = $2 AND source = 'registration'`,
    [tournamentId, registrationId]
  );
  const creditRow = credit.rows[0];
  const amount = roundMoney(creditRow ? creditRow.amount : regRow.amount);
  if (amount <= 0) return null;

  let description;
  if (creditRow && creditRow.description) {
    description = `Reversal — ${creditRow.description}`;
  } else {
    const category = regRow.category ? ` (${regRow.category})` : "";
    description = `Reversal — Registration removed — ${regRow.full_name || "Player"}${category} · ${regRow.registration_number}`;
  }

  const inserted = await query(
    `INSERT INTO ledger_entries (
       tournament_id, entry_type, source, registration_id, amount, description, occurred_at
     ) VALUES ($1, 'debit', 'registration_reversal', $2, $3, $4, NOW())
     RETURNING id`,
    [tournamentId, registrationId, amount, description]
  );
  return inserted.rows[0].id;
}

async function reverseAllPaidRegistrations(query, tournamentId) {
  const result = await query(
    `SELECT r.id
     FROM registrations r
     JOIN payments pay ON pay.registration_id = r.id
     WHERE r.tournament_id = $1 AND pay.payment_status = 'PAID'`,
    [tournamentId]
  );
  let count = 0;
  for (const row of result.rows) {
    const id = await reverseRegistrationCredit(query, tournamentId, row.id);
    if (id) count += 1;
  }
  return count;
}

async function listEntries(query, tournamentId) {
  const result = await query(
    `SELECT e.*, r.registration_number, pay.gateway, pay.receipt_url AS payment_receipt_url
     FROM ledger_entries e
     LEFT JOIN registrations r ON r.id = e.registration_id
     LEFT JOIN payments pay ON pay.registration_id = r.id
     WHERE e.tournament_id = $1
     ORDER BY e.occurred_at DESC, e.id DESC`,
    [tournamentId]
  );
  return result.rows;
}

async function summarize(query, tournamentId) {
  const result = await query(
    `SELECT entry_type, COALESCE(SUM(amount), 0) AS total
     FROM ledger_entries
     WHERE tournament_id = $1
     GROUP BY entry_type`,
    [tournamentId]
  );
  let credits = 0;
  let debits = 0;
  result.rows.forEach((row) => {
    if (row.entry_type === "credit") credits = roundMoney(row.total);
    if (row.entry_type === "debit") debits = roundMoney(row.total);
  });
  return {
    credits,
    debits,
    balance: roundMoney(credits - debits)
  };
}

async function addManualEntry(query, tournamentId, adminId, fields, file) {
  const entryType = fields.entryType === "debit" ? "debit" : "credit";
  const amount = roundMoney(fields.amount);
  if (amount <= 0) throw new Error("Amount must be greater than zero");
  const description = String(fields.description || "").trim();
  if (description.length < 2) throw new Error("Description is required");
  const occurredAt = fields.occurredAt ? new Date(fields.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) throw new Error("Invalid date");

  const inserted = await query(
    `INSERT INTO ledger_entries (
       tournament_id, entry_type, source, amount, description, occurred_at, created_by_admin_id
     ) VALUES ($1, $2, 'manual', $3, $4, $5, $6)
     RETURNING id`,
    [tournamentId, entryType, amount, description, occurredAt, adminId || null]
  );
  const entryId = inserted.rows[0].id;
  let attachmentUrl = "";
  if (file) {
    attachmentUrl = await photoStorage.saveLedgerAttachment(tournamentId, entryId, file);
    await query("UPDATE ledger_entries SET attachment_url = $2 WHERE id = $1", [entryId, attachmentUrl]);
  }
  return entryId;
}

async function updateManualEntry(query, tournamentId, entryId, fields, file) {
  const row = await query(
    "SELECT id, source FROM ledger_entries WHERE id = $1 AND tournament_id = $2",
    [entryId, tournamentId]
  );
  if (!row.rows[0]) throw new Error("Entry not found");
  if (row.rows[0].source !== "manual") throw new Error("Only manual entries can be edited");

  const entryType = fields.entryType === "debit" ? "debit" : fields.entryType === "credit" ? "credit" : null;
  const amount = fields.amount != null ? roundMoney(fields.amount) : null;
  const description = fields.description != null ? String(fields.description).trim() : null;
  const occurredAt = fields.occurredAt ? new Date(fields.occurredAt) : null;

  if (amount != null && amount <= 0) throw new Error("Amount must be greater than zero");
  if (description != null && description.length < 2) throw new Error("Description is required");
  if (occurredAt && Number.isNaN(occurredAt.getTime())) throw new Error("Invalid date");

  await query(
    `UPDATE ledger_entries SET
       entry_type = COALESCE($3, entry_type),
       amount = COALESCE($4, amount),
       description = COALESCE($5, description),
       occurred_at = COALESCE($6, occurred_at)
     WHERE id = $1 AND tournament_id = $2`,
    [
      entryId,
      tournamentId,
      entryType,
      amount,
      description,
      occurredAt
    ]
  );

  if (file) {
    const attachmentUrl = await photoStorage.saveLedgerAttachment(tournamentId, entryId, file);
    await query("UPDATE ledger_entries SET attachment_url = $2 WHERE id = $1", [entryId, attachmentUrl]);
  }
}

async function deleteManualEntry(query, tournamentId, entryId) {
  const row = await query(
    "SELECT source FROM ledger_entries WHERE id = $1 AND tournament_id = $2",
    [entryId, tournamentId]
  );
  if (!row.rows[0]) throw new Error("Entry not found");
  if (row.rows[0].source !== "manual") {
    throw new Error("Only manual entries can be deleted");
  }
  await query("DELETE FROM ledger_entries WHERE id = $1 AND tournament_id = $2", [entryId, tournamentId]);
}

module.exports = {
  entryToPublic,
  entryToAdmin,
  fetchEntryWithContext,
  resolveAttachmentUrl,
  ensureRegistrationCredit,
  reverseRegistrationCredit,
  reverseAllPaidRegistrations,
  syncPaidRegistrations,
  listEntries,
  summarize,
  addManualEntry,
  updateManualEntry,
  deleteManualEntry,
  roundMoney
};
