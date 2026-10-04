const whatsapp = require("./whatsapp");
const settingsUtil = require("./settings");

async function sendMessage(tournament, phone, templateKey, messageKey, context) {
  const wa = settingsUtil.mergeWhatsappSettings(tournament);
  const body = settingsUtil.renderTemplate(wa[messageKey], context);
  const templateName = wa[templateKey];
  try {
    return await whatsapp.sendTemplate(phone, templateName, wa.templateLanguage, [body]);
  } catch (err) {
    console.error("WhatsApp notify failed:", err.message);
    return { ok: false, error: err.message };
  }
}

async function notifyReserved(tournament, record) {
  if (!whatsapp.enabled()) return { ok: false, skipped: true };
  const context = settingsUtil.buildMessageContext(tournament, record);
  return sendMessage(tournament, record.phone, "templateReserved", "messageReserved", context);
}

async function notifyConfirmed(tournament, record) {
  if (!whatsapp.enabled()) return { ok: false, skipped: true };
  const context = settingsUtil.buildMessageContext(tournament, record);
  return sendMessage(tournament, record.phone, "templateConfirmed", "messageConfirmed", context);
}

async function notifyRejected(tournament, record, rejectReason) {
  if (!whatsapp.enabled()) return { ok: false, skipped: true };
  const context = settingsUtil.buildMessageContext(tournament, record, { rejectReason });
  return sendMessage(tournament, record.phone, "templateRejected", "messageRejected", context);
}

function shouldNotifyConfirmedOnRazorpay(tournament) {
  const payment = settingsUtil.mergePaymentSettings(tournament);
  return payment.sendConfirmedOnRazorpay !== false;
}

module.exports = {
  notifyReserved,
  notifyConfirmed,
  notifyRejected,
  shouldNotifyConfirmedOnRazorpay
};
