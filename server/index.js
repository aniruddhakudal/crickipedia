const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const db = require("./db");
const photoStorage = require("./storage");
const razorpay = require("./razorpay");
const settingsUtil = require("./settings");
const notifications = require("./notifications");
const whatsapp = require("./whatsapp");

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

app.post("/api/webhooks/razorpay", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const rawBody = req.body;
    if (!razorpay.verifyWebhookSignature(rawBody, signature)) {
      res.status(400).json({ error: "Invalid webhook signature" });
      return;
    }
    const event = JSON.parse(rawBody.toString("utf8"));
    if (event.event !== "payment.captured") {
      res.json({ ok: true, ignored: true });
      return;
    }
    const payment = event.payload && event.payload.payment && event.payload.payment.entity;
    if (!payment || !payment.order_id) {
      res.json({ ok: true, ignored: true });
      return;
    }
    const row = await db.query(
      `SELECT r.registration_number, t.slug
       FROM payments pay
       JOIN registrations r ON r.id = pay.registration_id
       JOIN tournaments t ON t.id = r.tournament_id
       WHERE pay.gateway_order_id = $1`,
      [payment.order_id]
    );
    if (!row.rows[0]) {
      res.json({ ok: true, ignored: true });
      return;
    }
    await completeRegistrationPaid(
      row.rows[0].slug,
      row.rows[0].registration_number,
      payment.id,
      payment.order_id
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

const siteRoot = path.join(__dirname, "..");
const publicPathReserved = new Set([
  "api", "uploads", "admin.html", "index.html", "register.html", "app.js", "favicon.ico"
]);

function sendHomePage(req, res) {
  res.sendFile(path.join(siteRoot, "index.html"));
}

function sendRegisterPage(req, res) {
  res.sendFile(path.join(siteRoot, "register.html"));
}

app.get("/", sendHomePage);

app.get("/:tournament/:season", (req, res, next) => {
  const key = String(req.params.tournament || "").toLowerCase();
  if (key === "api" || publicPathReserved.has(key) || key.includes(".")) return next();
  sendRegisterPage(req, res);
});

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "tournament";
}

const TOURNAMENT_API_ROOTS = ["/api/t/:slug", "/api/t/:tournament/:season"];

function mountTournamentRoute(method, suffix, ...handlers) {
  for (const root of TOURNAMENT_API_ROOTS) {
    app[method](root + suffix, ...handlers);
  }
}

async function loadTournamentFromParams(params) {
  return db.loadTournamentFromParams(params);
}

async function resolveRouteSlug(params) {
  const loaded = await loadTournamentFromParams(params);
  return loaded ? loaded.row.slug : params.slug || null;
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

function tournamentPaymentMode(tournament) {
  const payment = settingsUtil.mergePaymentSettings(tournament);
  if (payment.mode === "manual_qr") return "manual_qr";
  return "razorpay";
}

async function findRegistration(slug, phoneOrId) {
  const result = await db.query(
    `SELECT r.registration_number, r.category, r.status, r.registered_at,
            t.slug, p.full_name, p.date_of_birth, p.flat_number, p.whatsapp_number, p.photo_url,
            p.cricheroes_url, p.instagram_url,
            pref.skill, pref.suggested_jersey_number, pref.jersey_size, pref.sleeve_type,
            pay.payment_status, pay.verification_status, pay.receipt_url, pay.receipt_upi_ref, pay.reject_reason
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

async function findRegistrationPayment(slug, registrationNumber) {
  const result = await db.query(
    `SELECT r.id AS registration_id, r.registration_number, r.status AS registration_status,
            pay.id AS payment_id, pay.amount, pay.payment_status, pay.gateway_order_id,
            p.full_name, p.whatsapp_number,
            t.name AS tournament_name, t.entry_fee
     FROM registrations r
     JOIN tournaments t ON t.id = r.tournament_id
     JOIN players p ON p.id = r.player_id
     LEFT JOIN payments pay ON pay.registration_id = r.id
     WHERE t.slug = $1 AND r.registration_number = $2`,
    [slug, registrationNumber]
  );
  return result.rows[0] || null;
}

async function markRegistrationPaid(slug, registrationNumber, gateway, paymentId, orderId) {
  const row = await findRegistrationPayment(slug, registrationNumber);
  if (!row) return null;
  if (row.payment_status === "PAID" || row.registration_status === "PAID") {
    return findRegistration(slug, registrationNumber);
  }
  await db.query(
    `UPDATE payments
     SET payment_status = 'PAID', paid_at = NOW(), gateway = $2,
         verification_status = 'APPROVED', reject_reason = NULL,
         gateway_transaction_id = $3, gateway_order_id = COALESCE(gateway_order_id, $4)
     WHERE registration_id = $1`,
    [row.registration_id, gateway || "RAZORPAY", paymentId || null, orderId || null]
  );
  await db.query("UPDATE registrations SET status = 'PAID' WHERE id = $1", [row.registration_id]);
  return findRegistration(slug, registrationNumber);
}

async function completeRegistrationPaid(slug, registrationNumber, paymentId, orderId) {
  const loaded = await db.loadTournament(slug);
  const record = await markRegistrationPaid(slug, registrationNumber, "RAZORPAY", paymentId, orderId);
  if (record && loaded && notifications.shouldNotifyConfirmedOnRazorpay(loaded.tournament)) {
    notifications.notifyConfirmed(loaded.tournament, record).catch(() => {});
  }
  return record;
}

function buildUpiUri(payment, tournament, registrationNumber) {
  const upiId = String(payment.upiId || "").trim();
  if (!upiId) return "";
  const amount = Number(tournament.fee || 0).toFixed(2);
  const payee = encodeURIComponent(payment.upiPayeeName || tournament.name || "Tournament");
  const note = encodeURIComponent(`Reg ${registrationNumber}`);
  return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${payee}&am=${amount}&cu=INR&tn=${note}`;
}

app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({
      ok: true,
      db: true,
      driver: db.getDriver(),
      photos: photoStorage.enabled() ? "supabase" : "local",
      payments: razorpay.enabled() ? "razorpay" : "demo",
      whatsapp: whatsapp.enabled() ? "cloud_api" : "off"
    });
  } catch (err) {
    res.status(500).json({ ok: false, db: false, error: err.message });
  }
});

app.get("/api/payments/config", (req, res) => {
  res.json({
    mode: razorpay.enabled() ? "razorpay" : "demo",
    keyId: razorpay.enabled() ? razorpay.keyId() : null
  });
});

mountTournamentRoute("get", "/payments/config", async (req, res) => {
  try {
    const loaded = await loadTournamentFromParams(req.params);
    if (!loaded) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    const payment = settingsUtil.mergePaymentSettings(loaded.tournament);
    const mode = tournamentPaymentMode(loaded.tournament);
    const razorpayAvailable = razorpay.enabled();
    const body = {
      mode,
      payment,
      razorpayAvailable,
      razorpayKeyId: mode === "razorpay" && razorpayAvailable ? razorpay.keyId() : null
    };
    if (mode === "manual_qr") {
      body.qrImageUrl = payment.qrSource === "image" ? payment.qrImageUrl || "" : "";
      body.upiUri = payment.qrSource === "upi" ? buildUpiUri(payment, loaded.tournament, "") : "";
      body.paymentInstructions = payment.paymentInstructions || "";
    }
    res.json(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function paymentQrPayload(slug, registrationId) {
  const loaded = await db.loadTournament(slug);
  if (!loaded) return null;
  const payment = settingsUtil.mergePaymentSettings(loaded.tournament);
  const upiUri = buildUpiUri(payment, loaded.tournament, registrationId || "");
  if (!upiUri) {
    return { upiUri: "", qrDataUrl: "", qrImageUrl: payment.qrImageUrl || "" };
  }
  const QRCode = require("qrcode");
  const qrDataUrl = await QRCode.toDataURL(upiUri, { margin: 1, width: 280 });
  return { upiUri, qrDataUrl, qrImageUrl: payment.qrImageUrl || "" };
}

mountTournamentRoute("get", "/payment-qr-image", async (req, res) => {
  try {
    const loaded = await loadTournamentFromParams(req.params);
    if (!loaded) {
      res.status(404).end();
      return;
    }
    const payment = settingsUtil.mergePaymentSettings(loaded.tournament);
    const qrImageUrl = payment.qrImageUrl || "";
    if (!qrImageUrl) {
      res.status(404).end();
      return;
    }
    const file = await photoStorage.streamPaymentQr(qrImageUrl);
    if (!file) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(file.buffer);
  } catch (err) {
    res.status(500).end();
  }
});

mountTournamentRoute("get", "/payment-qr", async (req, res) => {
  try {
    const slug = await resolveRouteSlug(req.params);
    const data = await paymentQrPayload(slug, "");
    if (!data) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

mountTournamentRoute("get", "/registrations/:id/payment-qr", async (req, res) => {
  try {
    const slug = await resolveRouteSlug(req.params);
    const data = await paymentQrPayload(slug, req.params.id);
    if (!data) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tournaments", async (req, res) => {
  try {
    const preview = req.query.preview === "1";
    const all = await db.listTournamentsClient();
    const list = [];
    for (const tournament of all) {
      const state = publicState(tournament);
      if (preview || state === "OPEN" || state === "UPCOMING" || state === "CLOSED") {
        if (!preview && tournament.status === "DRAFT") continue;
        list.push(tournament);
      }
    }
    res.json({ tournaments: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

mountTournamentRoute("get", "/config", async (req, res) => {
  try {
    const loaded = await loadTournamentFromParams(req.params);
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

mountTournamentRoute("get", "/lookup", async (req, res) => {
  try {
    const phone = String(req.query.phone || "").replace(/\D/g, "");
    if (phone.length !== 10) {
      res.json({ record: null });
      return;
    }
    const slug = await resolveRouteSlug(req.params);
    res.json({ record: await findRegistration(slug, phone) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

mountTournamentRoute("post", "/register", async (req, res) => {
  try {
    const preview = req.query.preview === "1" || req.body.preview === true;
    const loaded = await loadTournamentFromParams(req.params);
    if (!loaded) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    const slug = loaded.row.slug;
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
    const allowed = settingsUtil.categoryNames(loaded.tournament.categories);
    if (wantCategory && allowed.length && allowed.indexOf(category) === -1) {
      res.status(400).json({ error: "Invalid registration category" });
      return;
    }

    const existing = await findRegistration(slug, phone);
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
      const payMode = tournamentPaymentMode(loaded.tournament);
      const gateway = payMode === "manual_qr" ? "MANUAL_QR" : payMode === "razorpay" ? "RAZORPAY" : "DEMO";
      await client.query(
        `INSERT INTO payments (registration_id, amount, payment_status, gateway, verification_status)
         VALUES ($1, $2, 'PENDING', $3, $4)`,
        [
          registration.rows[0].id,
          loaded.tournament.fee,
          gateway,
          payMode === "manual_qr" ? "AWAITING_RECEIPT" : null
        ]
      );
    });

    const record = await findRegistration(slug, registrationNumber);
    notifications.notifyReserved(loaded.tournament, record).catch((err) => {
      console.error("Reserved WhatsApp:", err.message);
    });
    res.status(201).json({
      record,
      existing: false
    });
  } catch (err) {
    if (err.code === "23505") {
      res.json({ record: await findRegistration(slug, String(req.body.phone || "").replace(/\D/g, "")), existing: true });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

mountTournamentRoute("post", "/registrations/:id/photo", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Choose a photo" });
      return;
    }
    const slug = await resolveRouteSlug(req.params);
    const found = await db.query(
      `SELECT p.id
       FROM registrations r
       JOIN tournaments t ON t.id = r.tournament_id
       JOIN players p ON p.id = r.player_id
       WHERE t.slug = $1 AND r.registration_number = $2`,
      [slug, req.params.id]
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
    res.json({ record: await findRegistration(slug, req.params.id), photoUrl });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

mountTournamentRoute("post", "/registrations/:id/receipt", upload.single("receipt"), async (req, res) => {
  try {
    const loaded = await loadTournamentFromParams(req.params);
    if (!loaded) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    const slug = loaded.row.slug;
    if (tournamentPaymentMode(loaded.tournament) !== "manual_qr") {
      res.status(400).json({ error: "This tournament does not accept receipt uploads" });
      return;
    }
    const paymentSettings = settingsUtil.mergePaymentSettings(loaded.tournament);
    const upiRef = String(req.body.upiRef || req.body.upi_ref || "").trim();
    const needImage = paymentSettings.receiptImage === "required";
    const needUpi = paymentSettings.receiptUpiRef === "required";
    const allowImage = paymentSettings.receiptImage !== "hidden";
    const allowUpi = paymentSettings.receiptUpiRef !== "hidden";
    if (needImage && allowImage && !req.file) {
      res.status(400).json({ error: "Payment receipt image is required" });
      return;
    }
    if (needUpi && allowUpi && !upiRef) {
      res.status(400).json({ error: "UPI transaction ID is required" });
      return;
    }
    const found = await db.query(
      `SELECT r.id AS registration_id, pay.payment_status
       FROM registrations r
       JOIN tournaments t ON t.id = r.tournament_id
       LEFT JOIN payments pay ON pay.registration_id = r.id
       WHERE t.slug = $1 AND r.registration_number = $2`,
      [slug, req.params.id]
    );
    if (!found.rows[0]) {
      if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    if (found.rows[0].payment_status === "PAID") {
      res.status(400).json({ error: "Already confirmed" });
      return;
    }
    let receiptUrl = null;
    if (req.file && allowImage) {
      receiptUrl = await photoStorage.saveReceipt(found.rows[0].registration_id, req.file);
    }
    await db.query(
      `UPDATE payments
       SET receipt_url = COALESCE($2, receipt_url),
           receipt_upi_ref = CASE WHEN $3::text IS NOT NULL AND $3 <> '' THEN $3 ELSE receipt_upi_ref END,
           verification_status = 'SUBMITTED',
           reject_reason = NULL,
           gateway = 'MANUAL_QR'
       WHERE registration_id = $1`,
      [found.rows[0].registration_id, receiptUrl, allowUpi ? upiRef : null]
    );
    await db.query(
      "UPDATE registrations SET status = 'RECEIPT_SUBMITTED' WHERE id = $1",
      [found.rows[0].registration_id]
    );
    res.json({ record: await findRegistration(slug, req.params.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

mountTournamentRoute("post", "/registrations/:id/payment-order", async (req, res) => {
  try {
    const loaded = await loadTournamentFromParams(req.params);
    const slug = loaded.row.slug;
    if (!loaded || tournamentPaymentMode(loaded.tournament) !== "razorpay") {
      res.status(400).json({ error: "Online card/UPI checkout is not enabled for this tournament" });
      return;
    }
    if (!razorpay.enabled()) {
      res.status(400).json({ error: "Razorpay is not configured on the server" });
      return;
    }
    const row = await findRegistrationPayment(slug, req.params.id);
    if (!row) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    if (row.payment_status === "PAID" || row.registration_status === "PAID") {
      res.json({ record: await findRegistration(slug, req.params.id), alreadyPaid: true });
      return;
    }
    const amountPaise = razorpay.amountToPaise(row.entry_fee);
    if (amountPaise < 100) {
      res.status(400).json({ error: "Entry fee must be at least ₹1" });
      return;
    }
    const order = await razorpay.createOrder({
      amountPaise,
      receipt: row.registration_number,
      notes: {
        slug,
        registration_number: row.registration_number
      }
    });
    await db.query(
      `UPDATE payments SET gateway = 'RAZORPAY', gateway_order_id = $2 WHERE registration_id = $1`,
      [row.registration_id, order.id]
    );
    res.json({
      keyId: razorpay.keyId(),
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      name: row.tournament_name,
      description: `Registration ${row.registration_number}`,
      prefill: {
        name: row.full_name || "",
        contact: row.whatsapp_number || ""
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

mountTournamentRoute("post", "/registrations/:id/pay-verify", async (req, res) => {
  try {
    const slug = await resolveRouteSlug(req.params);
    if (!razorpay.enabled()) {
      res.status(400).json({ error: "Online payments are not configured" });
      return;
    }
    const orderId = String(req.body.razorpay_order_id || "");
    const paymentId = String(req.body.razorpay_payment_id || "");
    const signature = String(req.body.razorpay_signature || "");
    if (!orderId || !paymentId || !signature) {
      res.status(400).json({ error: "Missing payment details" });
      return;
    }
    if (!razorpay.verifyPaymentSignature(orderId, paymentId, signature)) {
      res.status(400).json({ error: "Payment verification failed" });
      return;
    }
    const row = await findRegistrationPayment(slug, req.params.id);
    if (!row) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    if (row.gateway_order_id && row.gateway_order_id !== orderId) {
      res.status(400).json({ error: "Order does not match this registration" });
      return;
    }
    const record = await completeRegistrationPaid(slug, req.params.id, paymentId, orderId);
    res.json({ record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

mountTournamentRoute("post", "/registrations/:id/pay", async (req, res) => {
  try {
    const loaded = await loadTournamentFromParams(req.params);
    const slug = loaded ? loaded.row.slug : null;
    const mode = loaded ? tournamentPaymentMode(loaded.tournament) : "demo";
    if (mode === "razorpay") {
      res.status(400).json({ error: "Use Razorpay checkout for this tournament" });
      return;
    }
    if (mode === "manual_qr") {
      res.status(400).json({ error: "Pay via QR and upload your receipt" });
      return;
    }
    const found = await db.query(
      `SELECT r.id
       FROM registrations r
       JOIN tournaments t ON t.id = r.tournament_id
       WHERE t.slug = $1 AND r.registration_number = $2`,
      [slug, req.params.id]
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
    res.json({ record: await findRegistration(slug, req.params.id) });
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
    res.json({ tournaments: await db.listTournamentsClient() });
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
    const tournamentSlug = slugify(req.body.tournamentSlug || req.body.slug || name);
    const seasonSlug = slugify(req.body.seasonSlug || new Date().getFullYear());
    const pair = await db.query(
      "SELECT 1 FROM tournaments WHERE tournament_slug = $1 AND season_slug = $2",
      [tournamentSlug, seasonSlug]
    );
    if (pair.rows.length) {
      res.status(400).json({ error: "That tournament and season URL is already used" });
      return;
    }
    const slug = db.combinedSlug(tournamentSlug, seasonSlug);
    const shortName = req.body.shortName || name.split(/\s+/).map((part) => part.charAt(0)).join("").toUpperCase().slice(0, 6) || "CUP";
    const settings = db.settingsFromClient({
      ...base,
      ...req.body,
      idPrefix: req.body.idPrefix || prefixFromSlug(slug)
    });
    const inserted = await db.query(
      `INSERT INTO tournaments
        (slug, tournament_slug, season_slug, name, short_name, logo_url, description, registration_start, registration_end, entry_fee, status, settings)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'DRAFT', $11::jsonb)
       RETURNING slug`,
      [
        slug,
        tournamentSlug,
        seasonSlug,
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
    const existing = await db.loadTournamentRow(req.params.slug);
    if (!existing) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    const tournamentSlug = slugify(
      req.body.tournamentSlug || existing.tournament_slug
    );
    const seasonSlug = slugify(req.body.seasonSlug || existing.season_slug);
    const nextSlug = db.combinedSlug(tournamentSlug, seasonSlug);
    const settings = db.settingsFromClient(req.body);
    const saved = await db.updateTournamentFromAdmin(existing, {
      tournamentSlug,
      seasonSlug,
      nextSlug,
      settings,
      name: String(req.body.name || existing.name).trim(),
      shortName: req.body.shortName || existing.short_name,
      logoUrl: req.body.logoUrl || "",
      registrationStart: req.body.registrationStart,
      registrationEnd: req.body.registrationEnd,
      fee: Number(req.body.fee || 0),
      status: req.body.status || existing.status,
      sponsors: req.body.sponsors
    });
    res.json({ tournament: db.toClient(saved.row, saved.sponsorRows) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/admin/tournaments/:slug/payment-qr", requireAdmin, upload.single("qr"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No QR image uploaded" });
      return;
    }
    const loaded = await db.loadTournament(req.params.slug);
    if (!loaded) {
      if (req.file.path) fs.unlink(req.file.path, () => {});
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    const qrImageUrl = await photoStorage.saveTournamentPaymentQr(req.params.slug, req.file);
    const tournament = loaded.tournament;
    const settings = db.settingsFromClient({
      ...tournament,
      payment: {
        ...(tournament.payment || {}),
        qrImageUrl,
        qrSource: "image"
      }
    });
    const updated = await db.query(
      `UPDATE tournaments SET settings = $2::jsonb, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [loaded.row.id, JSON.stringify(settings)]
    );
    res.json({
      qrImageUrl,
      tournament: db.toClient(updated.rows[0], db.sponsorsFromClient(tournament.sponsors))
    });
  } catch (err) {
    if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
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
              pay.payment_status, pay.verification_status, pay.receipt_url, pay.receipt_upi_ref, pay.reject_reason
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

app.post("/api/admin/tournaments/:slug/registrations/:id/approve", requireAdmin, async (req, res) => {
  try {
    const loaded = await db.loadTournament(req.params.slug);
    if (!loaded) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    const record = await markRegistrationPaid(req.params.slug, req.params.id, "MANUAL_QR", null, null);
    if (!record) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    notifications.notifyConfirmed(loaded.tournament, record).catch(() => {});
    res.json({ record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/tournaments/:slug/registrations/:id/reject", requireAdmin, async (req, res) => {
  try {
    const loaded = await db.loadTournament(req.params.slug);
    if (!loaded) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    const reason = String(req.body.reason || "Receipt could not be verified").trim();
    const row = await findRegistrationPayment(req.params.slug, req.params.id);
    if (!row) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    await db.query(
      `UPDATE payments
       SET verification_status = 'REJECTED', reject_reason = $2
       WHERE registration_id = $1`,
      [row.registration_id, reason]
    );
    await db.query(
      "UPDATE registrations SET status = 'RECEIPT_REJECTED' WHERE id = $1",
      [row.registration_id]
    );
    const record = await findRegistration(req.params.slug, req.params.id);
    notifications.notifyRejected(loaded.tournament, record, reason).catch(() => {});
    res.json({ record });
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

app.use(express.static(siteRoot, { index: false }));

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
