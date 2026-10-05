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
        whatsappGroupUrl: String(item.whatsappGroupUrl || "").trim(),
        qrImageUrl: String(item.qrImageUrl || "").trim()
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

function resolvePaymentQrImageUrl(tournament, categoryName) {
  const payment = mergePaymentSettings(tournament);
  const name = String(categoryName || "").trim();
  if (name) {
    const key = name.toLowerCase();
    const match = normalizeCategories(tournament.categories).find(
      (item) => String(item.name || "").trim().toLowerCase() === key
    );
    if (match && match.qrImageUrl) return match.qrImageUrl;
  }
  if (payment.qrSource === "image") return payment.qrImageUrl || "";
  return payment.qrImageUrl || "";
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

const REGISTRATION_FIELD_KEYS = [
  "flatNumber",
  "category",
  "dob",
  "jerseyNumber",
  "jerseySize",
  "sleeve",
  "photo",
  "cricheroes",
  "instagram"
];

const REGISTRATION_FIELD_DEFAULTS = {
  flatNumber: "required",
  category: "required",
  dob: "optional",
  jerseyNumber: "optional",
  jerseySize: "optional",
  sleeve: "optional",
  photo: "optional",
  cricheroes: "optional",
  instagram: "optional"
};

const REGISTRATION_FIELD_LABELS = {
  flatNumber: "Flat number",
  category: "Registration category",
  dob: "Date of birth",
  jerseyNumber: "Jersey number",
  jerseySize: "Jersey size",
  sleeve: "Sleeve",
  photo: "Photo",
  cricheroes: "CricHeroes",
  instagram: "Instagram"
};

function normalizeFieldMode(value, key) {
  const fallback = REGISTRATION_FIELD_DEFAULTS[key] || "optional";
  if (value === false || value === "off" || value === "hidden") return "off";
  if (value === "required" || value === "optional") return value;
  if (value === true) return fallback;
  if (value == null || value === "") return fallback;
  return fallback;
}

function fieldMode(fields, key) {
  return normalizeFieldMode(fields && fields[key], key);
}

function mergeFieldsSettings(fields) {
  const out = {};
  REGISTRATION_FIELD_KEYS.forEach((key) => {
    out[key] = normalizeFieldMode(fields && fields[key], key);
  });
  return out;
}

function defaultFieldsSettings() {
  return mergeFieldsSettings(null);
}

function defaultFormFieldsArray() {
  return REGISTRATION_FIELD_KEYS.map((id) => ({
    id,
    source: "builtin",
    mode: REGISTRATION_FIELD_DEFAULTS[id] === "required" ? "required" : "optional"
  }));
}

function normalizeCustomFormField(raw) {
  if (!raw || !raw.id) return null;
  const id = String(raw.id).trim();
  if (!id.startsWith("cf_")) return null;
  const type = ["text", "number", "date", "url", "select"].includes(raw.type) ? raw.type : "text";
  const mode = raw.mode === "required" ? "required" : "optional";
  const label = String(raw.label || "Custom field").trim().slice(0, 80) || "Custom field";
  const options = Array.isArray(raw.options)
    ? raw.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 40)
    : String(raw.options || "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
        .slice(0, 40);
  return { id, source: "custom", label, type, mode, options };
}

function normalizeBuiltinFormField(raw) {
  if (!raw || raw.source !== "builtin") return null;
  const id = String(raw.id || "").trim();
  if (!REGISTRATION_FIELD_KEYS.includes(id)) return null;
  const mode = raw.mode === "required" ? "required" : "optional";
  return { id, source: "builtin", mode };
}

function normalizeFormFields(raw, legacyFields) {
  if (Array.isArray(raw) && raw.length) {
    const out = [];
    const seenBuiltin = {};
    raw.forEach((item) => {
      if (!item) return;
      if (item.source === "custom" || String(item.id || "").startsWith("cf_")) {
        const norm = normalizeCustomFormField(item);
        if (norm) out.push(norm);
        return;
      }
      const norm = normalizeBuiltinFormField({ ...item, source: "builtin" });
      if (norm && !seenBuiltin[norm.id]) {
        seenBuiltin[norm.id] = true;
        out.push(norm);
      }
    });
    return out;
  }
  const merged = mergeFieldsSettings(legacyFields);
  const out = [];
  REGISTRATION_FIELD_KEYS.forEach((id) => {
    const mode = merged[id];
    if (mode === "off") return;
    out.push({
      id,
      source: "builtin",
      mode: mode === "required" ? "required" : "optional"
    });
  });
  return out;
}

function fieldsObjectFromFormFields(formFields) {
  const out = {};
  REGISTRATION_FIELD_KEYS.forEach((key) => {
    out[key] = "off";
  });
  (formFields || []).forEach((item) => {
    if (item && item.source === "builtin" && REGISTRATION_FIELD_KEYS.includes(item.id)) {
      out[item.id] = item.mode === "required" ? "required" : "optional";
    }
  });
  return mergeFieldsSettings(out);
}

function fieldModeForTournament(tournament, key) {
  const list = normalizeFormFields(tournament.formFields, tournament.fields);
  if (tournament.formFields && tournament.formFields.length) {
    const hit = list.find((f) => f.source === "builtin" && f.id === key);
    return hit ? (hit.mode === "required" ? "required" : "optional") : "off";
  }
  return fieldMode(tournament.fields, key);
}

function customFormFields(tournament) {
  return normalizeFormFields(tournament.formFields, tournament.fields).filter((f) => f.source === "custom");
}

function validateCustomRegistrationFields(tournament, customValues) {
  const errors = [];
  const values = customValues && typeof customValues === "object" ? customValues : {};
  const isEmpty = (value) => value == null || String(value).trim() === "";

  customFormFields(tournament).forEach((field) => {
    const value = values[field.id];
    if (field.mode === "required" && isEmpty(value)) {
      errors.push(field.label + " is required");
      return;
    }
    if (isEmpty(value)) return;
    if (field.type === "number" && Number.isNaN(Number(value))) {
      errors.push(field.label + " must be a number");
    }
    if (field.type === "url") {
      try {
        const parsed = new URL(String(value));
        if (!parsed.protocol.startsWith("http")) errors.push(field.label + " must be a valid URL");
      } catch (e) {
        errors.push(field.label + " must be a valid URL");
      }
    }
    if (field.type === "select" && field.options.length && field.options.indexOf(String(value)) === -1) {
      errors.push(field.label + " has an invalid choice");
    }
  });

  return errors;
}

function sanitizeCustomFieldValues(tournament, customValues) {
  const values = customValues && typeof customValues === "object" ? customValues : {};
  const out = {};
  customFormFields(tournament).forEach((field) => {
    const raw = values[field.id];
    if (raw == null || String(raw).trim() === "") return;
    let value = String(raw).trim().slice(0, 500);
    if (field.type === "number") value = String(Number(value));
    out[field.id] = value;
  });
  return out;
}

function validateRegistrationFields(tournament, body) {
  const errors = [];
  const isEmpty = (value) => value == null || String(value).trim() === "";

  REGISTRATION_FIELD_KEYS.forEach((key) => {
    if (key === "photo") return;
    const mode = fieldModeForTournament(tournament, key);
    if (mode !== "required") return;
    let value;
    if (key === "flatNumber") value = body.flat;
    else if (key === "category") value = body.category;
    else if (key === "jerseyNumber") {
      value = body.jersey;
      if (body.jersey === 0 || body.jersey === "0") value = "0";
    } else if (key === "jerseySize") value = body.size;
    else if (key === "sleeve") value = body.sleeve;
    else value = body[key];
    if (isEmpty(value)) {
      errors.push((REGISTRATION_FIELD_LABELS[key] || key) + " is required");
    }
  });

  const customErrors = validateCustomRegistrationFields(tournament, body.customFields);
  return errors.concat(customErrors);
}

module.exports = {
  defaultPaymentSettings,
  defaultWhatsappSettings,
  normalizeCategories,
  categoryNames,
  groupLinkForCategory,
  resolvePaymentQrImageUrl,
  mergePaymentSettings,
  mergeWhatsappSettings,
  buildMessageContext,
  renderTemplate,
  formatFee,
  REGISTRATION_FIELD_KEYS,
  REGISTRATION_FIELD_LABELS,
  fieldMode,
  fieldModeForTournament,
  mergeFieldsSettings,
  defaultFieldsSettings,
  defaultFormFieldsArray,
  normalizeFormFields,
  fieldsObjectFromFormFields,
  customFormFields,
  sanitizeCustomFieldValues,
  validateRegistrationFields
};
