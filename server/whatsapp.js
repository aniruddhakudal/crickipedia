const API_VERSION = (process.env.WHATSAPP_API_VERSION || "v21.0").trim();

function cleanEnv(value) {
  return String(value || "").trim().replace(/^["']|["']$/g, "");
}

function accessToken() {
  return cleanEnv(process.env.WHATSAPP_ACCESS_TOKEN);
}

function phoneNumberId() {
  return cleanEnv(process.env.WHATSAPP_PHONE_NUMBER_ID);
}

function enabled() {
  return Boolean(accessToken() && phoneNumberId());
}

function webhookVerifyToken() {
  return String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "").trim();
}

function webhookConfigured() {
  return Boolean(webhookVerifyToken());
}

/** Meta GET /api/webhooks/whatsapp — hub.mode, hub.verify_token, hub.challenge */
function verifyWebhookSubscription(query) {
  const mode = String(query["hub.mode"] || "").trim();
  const token = String(query["hub.verify_token"] || "").trim();
  const challenge = query["hub.challenge"];
  const expected = webhookVerifyToken();
  if (mode !== "subscribe" || !expected || challenge == null || challenge === "") {
    return null;
  }
  if (token !== expected) {
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

function graphErrorMessage(data, fallback) {
  const err = data && data.error;
  if (!err) return fallback || "WhatsApp request failed";
  let message = err.message || fallback || "WhatsApp request failed";
  const code = err.code;
  const sub = err.error_subcode;
  if (code === 190 || /authentication/i.test(message)) {
    message +=
      " — Regenerate the system-user token in Meta Business Suite (Users → System users → Generate token) and restart the server.";
  } else if (code === 100 && (sub === 33 || /does not exist|missing permissions/i.test(message))) {
    message +=
      " — Use the Phone number ID from WhatsApp → API setup, and assign that WhatsApp account to your system user (Business settings → Users → System users → Add assets).";
  }
  return message;
}

/** Lightweight check for Admin / deploy (does not send a message). */
async function verifyCredentials() {
  if (!enabled()) {
    return { ok: false, configured: false, error: "WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are not both set" };
  }
  const url = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId()}?fields=display_phone_number,verified_name`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken()}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, configured: true, error: graphErrorMessage(data, "Could not access WhatsApp phone number") };
  }
  return {
    ok: true,
    configured: true,
    displayPhoneNumber: data.display_phone_number || "",
    verifiedName: data.verified_name || ""
  };
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
  const url = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId()}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken()}`,
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
    throw new Error(graphErrorMessage(data, "WhatsApp send failed"));
  }
  return { ok: true, data };
}

module.exports = {
  enabled,
  webhookConfigured,
  verifyWebhookSubscription,
  handleWebhookPayload,
  verifyCredentials,
  sendTemplate,
  normalizePhone
};
