const API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";

function enabled() {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

function webhookVerifyToken() {
  return String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "").trim();
}

function webhookConfigured() {
  return Boolean(webhookVerifyToken());
}

/** Meta GET /api/webhooks/whatsapp — hub.mode, hub.verify_token, hub.challenge */
function verifyWebhookSubscription(query) {
  const mode = String(query["hub.mode"] || "");
  const token = String(query["hub.verify_token"] || "");
  const challenge = query["hub.challenge"];
  const expected = webhookVerifyToken();
  if (mode !== "subscribe" || !expected || token !== expected || challenge == null) {
    return null;
  }
  return String(challenge);
}

/** Meta POST payload — acknowledge quickly; optional logging only for now */
function handleWebhookPayload(body) {
  if (process.env.WHATSAPP_WEBHOOK_LOG === "1") {
    console.log("[whatsapp webhook]", JSON.stringify(body));
  }
  return { ok: true };
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return "91" + digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return "91" + digits.slice(1);
  return digits;
}

async function sendTemplate(toPhone, templateName, languageCode, bodyParameters) {
  if (!enabled()) {
    return { ok: false, skipped: true, reason: "WhatsApp API not configured" };
  }
  const to = normalizePhone(toPhone);
  if (to.length < 12) {
    return { ok: false, skipped: true, reason: "Invalid phone" };
  }
  const params = (bodyParameters || []).map((text) => ({
    type: "text",
    text: String(text == null ? "" : text).slice(0, 1024)
  }));
  const url = `https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: String(templateName || "hello_world"),
        language: { code: languageCode || "en" },
        components: params.length
          ? [{ type: "body", parameters: params }]
          : undefined
      }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error && data.error.message ? data.error.message : "WhatsApp send failed";
    throw new Error(message);
  }
  return { ok: true, data };
}

module.exports = {
  enabled,
  webhookConfigured,
  verifyWebhookSubscription,
  handleWebhookPayload,
  sendTemplate,
  normalizePhone
};
