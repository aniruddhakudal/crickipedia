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
  BUCKET
};
