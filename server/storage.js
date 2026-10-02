const { createClient } = require("@supabase/supabase-js");

const BUCKET = process.env.SUPABASE_PHOTO_BUCKET || "player-photos";

let client = null;

function enabled() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getClient() {
  if (!enabled()) return null;
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return client;
}

async function init() {
  const supabase = getClient();
  if (!supabase) {
    console.log("Photo storage: local /uploads");
    return "local";
  }
  const { data, error } = await supabase.storage.getBucket(BUCKET);
  if (error || !data) {
    const created = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 2 * 1024 * 1024
    });
    if (created.error && !/already exists/i.test(created.error.message || "")) {
      throw new Error("Could not create Supabase bucket: " + created.error.message);
    }
  }
  console.log("Photo storage: Supabase bucket " + BUCKET);
  return "supabase";
}

function storagePathFromPublicUrl(publicUrl) {
  if (!publicUrl || typeof publicUrl !== "string") return null;
  const needle = `/storage/v1/object/public/${BUCKET}/`;
  const index = publicUrl.indexOf(needle);
  if (index === -1) return null;
  return decodeURIComponent(publicUrl.slice(index + needle.length).split("?")[0]);
}

function contentTypeForPath(pathName) {
  const ext = String(pathName || "").toLowerCase();
  if (ext.endsWith(".png")) return "image/png";
  if (ext.endsWith(".webp")) return "image/webp";
  if (ext.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

async function streamPaymentQr(qrImageUrl) {
  if (!qrImageUrl) return null;

  if (qrImageUrl.startsWith("/uploads/")) {
    const abs = require("path").join(__dirname, "..", qrImageUrl.replace(/^\//, ""));
    if (!require("fs").existsSync(abs)) return null;
    return {
      buffer: require("fs").readFileSync(abs),
      contentType: contentTypeForPath(abs)
    };
  }

  const supabase = getClient();
  if (supabase) {
    const storagePath = storagePathFromPublicUrl(qrImageUrl);
    if (storagePath) {
      const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
      if (!error && data) {
        const buffer = Buffer.from(await data.arrayBuffer());
        return { buffer, contentType: contentTypeForPath(storagePath) };
      }
    }
  }

  try {
    const response = await fetch(qrImageUrl);
    if (response.ok) {
      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") || "image/jpeg"
      };
    }
  } catch (err) {
    /* try local/supabase only */
  }
  return null;
}

async function saveTournamentMedia(slug, file, fileBase) {
  const safeSlug = String(slug || "tournament").replace(/[^a-z0-9-]/gi, "").slice(0, 48) || "tournament";
  const ext = String((file.originalname || file.filename || ".jpg").split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") || "jpg";
  const base = String(fileBase || "asset").replace(/[^a-z0-9-]/gi, "").slice(0, 64) || "asset";
  const pathName = `tournaments/${safeSlug}/${base}.${ext}`;
  const supabase = getClient();

  if (!supabase) {
    const dest = require("path").join(__dirname, "..", "uploads", "tournaments", safeSlug);
    require("fs").mkdirSync(dest, { recursive: true });
    const filename = `${base}.${ext}`;
    require("fs").copyFileSync(file.path, require("path").join(dest, filename));
    return `/uploads/tournaments/${safeSlug}/${filename}`;
  }

  const body = file.buffer || require("fs").readFileSync(file.path);
  const { error } = await supabase.storage.from(BUCKET).upload(pathName, body, {
    contentType: file.mimetype || "image/png",
    upsert: true
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathName);
  return data.publicUrl;
}

async function saveTournamentPaymentQr(slug, file) {
  return saveTournamentMedia(slug, file, "payment-qr");
}

async function saveJerseySizeChart(slug, file) {
  return saveTournamentMedia(slug, file, "jersey-size-chart");
}

async function saveSponsorLogo(slug, file) {
  const stamp = Date.now();
  return saveTournamentMedia(slug, file, `sponsor-${stamp}`);
}

async function saveReceipt(registrationId, file) {
  const supabase = getClient();
  const ext = String((file.originalname || file.filename || ".jpg").split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") || "jpg";
  const pathName = `receipts/${registrationId}/${Date.now()}.${ext}`;

  if (!supabase) {
    return `/uploads/${file.filename}`;
  }

  const body = file.buffer || require("fs").readFileSync(file.path);
  const { error } = await supabase.storage.from(BUCKET).upload(pathName, body, {
    contentType: file.mimetype || "image/jpeg",
    upsert: true
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathName);
  return data.publicUrl;
}

async function savePlayerPhoto(playerId, file) {
  const supabase = getClient();
  const ext = String((file.originalname || file.filename || ".jpg").split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") || "jpg";
  const pathName = `players/${playerId}/${Date.now()}.${ext}`;

  if (!supabase) {
    return `/uploads/${file.filename}`;
  }

  const body = file.buffer || require("fs").readFileSync(file.path);
  const { error } = await supabase.storage.from(BUCKET).upload(pathName, body, {
    contentType: file.mimetype || "image/jpeg",
    upsert: true
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathName);
  return data.publicUrl;
}

module.exports = {
  enabled,
  init,
  savePlayerPhoto,
  saveTournamentPaymentQr,
  saveTournamentMedia,
  saveJerseySizeChart,
  saveSponsorLogo,
  streamPaymentQr,
  saveReceipt,
  BUCKET
};
