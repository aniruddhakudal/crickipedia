const DEFAULT_RESERVED = [
  "{{tournamentName}}",
  "",
  "Your registration is RESERVED.",
  "",
  "Name: {{name}}",
  "Category: {{category}}",
  "Fee: {{fee}}",
  "",
  "{{paymentInstructions}}"
].join("\n");

const DEFAULT_CONFIRMED = [
  "{{tournamentName}}",
  "",
  "Registration CONFIRMED",
  "",
  "Name: {{name}}",
  "Category: {{category}}",
  "",
  "Join your category WhatsApp group:",
  "{{groupLink}}"
].join("\n");

const DEFAULT_REJECTED = [
  "{{tournamentName}}",
  "",
  "We could not verify your payment, {{name}}.",
  "",
  "Reason: {{rejectReason}}",
  "",
  "Your spot is still RESERVED. Please pay and upload a clear receipt on the registration page."
].join("\n");

function defaultPaymentSettings() {
  return {
    mode: "razorpay",
    qrSource: "image",
    qrImageUrl: "",
    upiId: "",
    upiPayeeName: "",
    paymentInstructions: "Scan the QR code and pay the entry fee, then upload your payment receipt.",
    receiptImage: "required",
    receiptUpiRef: "optional",
    sendConfirmedOnRazorpay: true
  };
}

function defaultWhatsappSettings() {
  return {
    templateReserved: "registration_reserved",
    templateConfirmed: "registration_confirmed",
    templateRejected: "registration_rejected",
    templateLanguage: "en",
    messageReserved: DEFAULT_RESERVED,
    messageConfirmed: DEFAULT_CONFIRMED,
    messageRejected: DEFAULT_REJECTED
  };
}

function normalizeCategories(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const item of list) {
    if (typeof item === "string" && item.trim()) {
      out.push({ name: item.trim(), whatsappGroupUrl: "" });
      continue;
    }
    if (item && typeof item === "object" && String(item.name || "").trim()) {
      out.push({
        name: String(item.name).trim(),
        whatsappGroupUrl: String(item.whatsappGroupUrl || "").trim()
      });
    }
  }
  if (!out.length) {
    return [
      { name: "Resident", whatsappGroupUrl: "" },
      { name: "Guest", whatsappGroupUrl: "" },
      { name: "Kids", whatsappGroupUrl: "" }
    ];
  }
  return out;
}

function categoryNames(categories) {
  return normalizeCategories(categories).map((item) => item.name);
}

function groupLinkForCategory(categories, categoryName) {
  const match = normalizeCategories(categories).find((item) => item.name === categoryName);
  return match ? match.whatsappGroupUrl || "" : "";
}

function mergePaymentSettings(settings) {
  const base = defaultPaymentSettings();
  const payment = (settings && settings.payment) || {};
  return {
    ...base,
    ...payment,
    mode: payment.mode === "manual_qr" ? "manual_qr" : "razorpay"
  };
}

function mergeWhatsappSettings(settings) {
  const base = defaultWhatsappSettings();
  const whatsapp = (settings && settings.whatsapp) || {};
  const out = { ...base, ...whatsapp };
  ["messageReserved", "messageConfirmed", "messageRejected"].forEach((key) => {
    if (!String(out[key] || "").trim()) out[key] = base[key];
  });
  return out;
}

function formatFee(tournament) {
  const currency = tournament.currency || "₹";
  return currency + Number(tournament.fee || 0);
}

function buildMessageContext(tournament, record, extra) {
  const payment = mergePaymentSettings(tournament);
  return {
    tournamentName: tournament.name || "",
    registrationId: record.id || record.registration_number || "",
    name: record.name || record.full_name || "",
    category: record.category || "",
    fee: formatFee(tournament),
    groupLink: groupLinkForCategory(tournament.categories, record.category) || "",
    paymentInstructions: payment.paymentInstructions || "",
    rejectReason: (extra && extra.rejectReason) || ""
  };
}

function renderTemplate(template, context) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return context[key] != null ? String(context[key]) : "";
  });
}

module.exports = {
  defaultPaymentSettings,
  defaultWhatsappSettings,
  normalizeCategories,
  categoryNames,
  groupLinkForCategory,
  mergePaymentSettings,
  mergeWhatsappSettings,
  buildMessageContext,
  renderTemplate,
  formatFee
};
