(function (global) {
  var KEYS = {
    drafts: "crickipedia_drafts",
    adminSlug: "crickipedia_admin_slug",
    uiTheme: "crickipedia_ui_theme"
  };

  var SKILL_EMOJI = {
    Batter: "🏏",
    Bowler: "🎯",
    "Wicket Keeper": "🧤",
    "All Rounder": "🔥"
  };

  var REGISTRATION_FIELD_DEFAULTS = {
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

  function normalizeFieldMode(value, key) {
    var fallback = REGISTRATION_FIELD_DEFAULTS[key] || "optional";
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
    var out = {};
    Object.keys(REGISTRATION_FIELD_DEFAULTS).forEach(function (key) {
      out[key] = normalizeFieldMode(fields && fields[key], key);
    });
    return out;
  }

  function defaultFieldsSettings() {
    return mergeFieldsSettings(null);
  }

  var BUILTIN_FIELD_LABELS = {
    flatNumber: "Flat number",
    category: "Registration category",
    dob: "Date of birth",
    jerseyNumber: "Jersey number",
    jerseySize: "Jersey size",
    sleeve: "Sleeve",
    photo: "Profile photo",
    cricheroes: "CricHeroes",
    instagram: "Instagram"
  };

  function normalizeCustomFormField(raw) {
    if (!raw || !raw.id) return null;
    var id = String(raw.id).trim();
    if (id.indexOf("cf_") !== 0) return null;
    var type = ["text", "number", "date", "url", "select"].indexOf(raw.type) >= 0 ? raw.type : "text";
    var mode = raw.mode === "required" ? "required" : "optional";
    var label = String(raw.label || "Custom field").trim().slice(0, 80) || "Custom field";
    var options = [];
    if (Array.isArray(raw.options)) {
      options = raw.options.map(function (o) { return String(o).trim(); }).filter(Boolean);
    } else if (raw.options) {
      options = String(raw.options).split(",").map(function (o) { return o.trim(); }).filter(Boolean);
    }
    return { id: id, source: "custom", label: label, type: type, mode: mode, options: options };
  }

  function defaultFormFieldsArray() {
    return Object.keys(REGISTRATION_FIELD_DEFAULTS).map(function (id) {
      return {
        id: id,
        source: "builtin",
        mode: REGISTRATION_FIELD_DEFAULTS[id] === "required" ? "required" : "optional"
      };
    });
  }

  function normalizeFormFields(raw, legacyFields) {
    if (Array.isArray(raw) && raw.length) {
      var out = [];
      var seenBuiltin = {};
      raw.forEach(function (item) {
        if (!item) return;
        if (item.source === "custom" || String(item.id || "").indexOf("cf_") === 0) {
          var custom = normalizeCustomFormField(item);
          if (custom) out.push(custom);
          return;
        }
        var id = String(item.id || "").trim();
        if (!REGISTRATION_FIELD_DEFAULTS[id] || seenBuiltin[id]) return;
        seenBuiltin[id] = true;
        out.push({
          id: id,
          source: "builtin",
          mode: item.mode === "required" ? "required" : "optional"
        });
      });
      return out;
    }
    var merged = mergeFieldsSettings(legacyFields);
    var legacyOut = [];
    Object.keys(REGISTRATION_FIELD_DEFAULTS).forEach(function (id) {
      if (merged[id] === "off") return;
      legacyOut.push({
        id: id,
        source: "builtin",
        mode: merged[id] === "required" ? "required" : "optional"
      });
    });
    return legacyOut;
  }

  function fieldModeForTournament(tournament, key) {
    var list = normalizeFormFields(tournament.formFields, tournament.fields);
    if (tournament.formFields && tournament.formFields.length) {
      for (var i = 0; i < list.length; i += 1) {
        if (list[i].source === "builtin" && list[i].id === key) {
          return list[i].mode === "required" ? "required" : "optional";
        }
      }
      return "off";
    }
    return fieldMode(tournament.fields, key);
  }

  function customFormFields(tournament) {
    return normalizeFormFields(tournament.formFields, tournament.fields).filter(function (f) {
      return f.source === "custom";
    });
  }

  function newCustomFieldId() {
    return "cf_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function defaultTournament() {
    return {
      slug: "cpl-2026",
      tournamentSlug: "cpl",
      seasonSlug: "2026",
      name: "Celebria Premier League 2026",
      shortName: "CPL",
      tagline: "Official Player Registration",
      heroTitle: "Step onto the pitch.\nRegister your cricket profile.",
      heroSub: "Complete your player registration and secure your place in the tournament.",
      logoEmoji: "🏏",
      logoUrl: "",
      colors: {
        green: "#00875a",
        green2: "#00c17c",
        gold: "#ffb020",
        dark: "#0a2e24",
        light: "#f4fbf7"
      },
      status: "OPEN",
      registrationStart: "2026-09-20",
      registrationEnd: "2026-09-30",
      fee: 500,
      currency: "₹",
      idPrefix: "CPL2026",
      noticeTitle: "Important",
      notice: "Your spot is reserved as soon as you register. Pay the entry fee to confirm.",
      whatsNext: "Your registration is the first step. Later phases add auctions, teams, live scoring and prizes.",
      supportWhatsapp: "",
      fields: defaultFieldsSettings(),
      formFields: defaultFormFieldsArray(),
      skills: [
        { value: "Batter", label: "Batter", emoji: "🏏" },
        { value: "Bowler", label: "Bowler", emoji: "🎯" },
        { value: "Wicket Keeper", label: "WK", emoji: "🧤" },
        { value: "All Rounder", label: "All Rounder", emoji: "🔥" }
      ],
      jerseySizes: ["S", "M", "L", "XL", "XXL", "XXXL"],
      categories: [
        { name: "Resident", whatsappGroupUrl: "" },
        { name: "Guest", whatsappGroupUrl: "" },
        { name: "Kids", whatsappGroupUrl: "" }
      ],
      payment: {
        mode: "razorpay",
        qrSource: "image",
        qrImageUrl: "",
        upiId: "",
        upiPayeeName: "",
        paymentInstructions: "",
        receiptImage: "required",
        receiptUpiRef: "optional",
        sendConfirmedOnRazorpay: true
      },
      whatsapp: {
        templateReserved: "registration_reserved",
        templateConfirmed: "registration_confirmed",
        templateRejected: "registration_rejected",
        templateLanguage: "en"
      },
      sleeves: ["Full Sleeve", "Half Sleeve"],
      sponsors: [
        { name: "Sponsor 1", logoUrl: "", websiteUrl: "" },
        { name: "Sponsor 2", logoUrl: "", websiteUrl: "" },
        { name: "Sponsor 3", logoUrl: "", websiteUrl: "" },
        { name: "Sponsor 4", logoUrl: "", websiteUrl: "" }
      ]
    };
  }

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function slugify(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "tournament";
  }

  function prefixFromSlug(slug) {
    return String(slug || "CPL")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 12) || "REG";
  }

  function queryParam(name) {
    return new URLSearchParams(location.search).get(name);
  }

  var PATH_RESERVED = {
    api: true, uploads: true, admin: true, "admin.html": true, "index.html": true, "register.html": true,
    "stats.html": true, "stats.js": true, "players.html": true, "players.js": true,
    "player.html": true, "player.js": true, "app.js": true
  };

  function parsePublicUrl() {
    var tournament = queryParam("tournament") || queryParam("t");
    var season = queryParam("season") || queryParam("s");
    if (tournament && season) {
      return { tournament: tournament, season: season };
    }
    if (tournament && !season) {
      return { legacySlug: tournament };
    }
    var parts = location.pathname.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length && /\.html$/i.test(parts[parts.length - 1])) {
      parts.pop();
    }
    if (parts.length >= 2 && !PATH_RESERVED[parts[0].toLowerCase()]) {
      return { tournament: decodeURIComponent(parts[0]), season: decodeURIComponent(parts[1]) };
    }
    return {};
  }

  function tournamentKeys(tournament) {
    if (!tournament) return { slug: "" };
    if (tournament.tournamentSlug && tournament.seasonSlug) {
      return { tournament: tournament.tournamentSlug, season: tournament.seasonSlug };
    }
    if (typeof tournament === "string") return { slug: tournament };
    return { slug: tournament.slug || "" };
  }

  function apiTournamentPath(ref) {
    var keys = tournamentKeys(ref);
    if (keys.tournament && keys.season) {
      return "/api/t/" + encodeURIComponent(keys.tournament) + "/" + encodeURIComponent(keys.season);
    }
    return "/api/t/" + encodeURIComponent(keys.slug);
  }

  function sameSeason(a, b) {
    if (!a || !b) return false;
    if (a.tournamentSlug && a.seasonSlug && b.tournamentSlug && b.seasonSlug) {
      return a.tournamentSlug === b.tournamentSlug && a.seasonSlug === b.seasonSlug;
    }
    return a.slug === b.slug;
  }

  function resolvePublicTournament(list) {
    var parsed = parsePublicUrl();
    var items = list || [];
    if (parsed.tournament && parsed.season) {
      var byPath = items.find(function (item) {
        return item.tournamentSlug === parsed.tournament && item.seasonSlug === parsed.season;
      });
      if (byPath) return byPath;
    }
    if (parsed.legacySlug) {
      var match = items.find(function (item) { return item.slug === parsed.legacySlug; });
      if (match) return match;
    }
    return items.find(function (item) { return publicState(item) === "OPEN"; }) || items[0] || null;
  }

  function getAdminSlug(list) {
    var parsed = parsePublicUrl();
    if (parsed.tournament && parsed.season) {
      var hit = list.find(function (item) {
        return item.tournamentSlug === parsed.tournament && item.seasonSlug === parsed.season;
      });
      if (hit) {
        localStorage.setItem(KEYS.adminSlug, hit.slug);
        return hit.slug;
      }
    }
    var fromUrl = queryParam("t");
    if (fromUrl && list.some(function (item) { return item.slug === fromUrl; })) {
      localStorage.setItem(KEYS.adminSlug, fromUrl);
      return fromUrl;
    }
    var saved = localStorage.getItem(KEYS.adminSlug);
    if (saved && list.some(function (item) { return item.slug === saved; })) return saved;
    return list[0] ? list[0].slug : "";
  }

  function setAdminSlug(slug) {
    localStorage.setItem(KEYS.adminSlug, slug);
  }

  function parseDate(value) {
    if (!value) return null;
    var str = String(value);
    if (/[T\s]/.test(str) || str.indexOf(":") >= 0) {
      var parsed = new Date(str);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    var parts = str.split("-");
    if (parts.length !== 3) return new Date(str);
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function startOfToday() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function publicState(tournament) {
    if (!tournament) return "DRAFT";
    if (tournament.status === "DRAFT") return "DRAFT";
    if (tournament.status === "CLOSED") return "CLOSED";
    var today = startOfToday();
    var start = parseDate(tournament.registrationStart);
    var end = parseDate(tournament.registrationEnd);
    if (start && today < start) return "UPCOMING";
    if (end && today > end) return "CLOSED";
    return "OPEN";
  }

  function canRegister(tournament, preview) {
    var state = publicState(tournament);
    return state === "OPEN" || (preview && state !== "CLOSED");
  }

  function entryFeeForCategory(tournament, categoryName) {
    var base = Number(tournament.fee || 0);
    var name = String(categoryName || "").trim();
    if (!name) return base;
    var key = name.toLowerCase();
    var list = normalizeCategories(tournament.categories);
    for (var i = 0; i < list.length; i += 1) {
      if (String(list[i].name || "").trim().toLowerCase() !== key) continue;
      if (list[i].fee != null && !isNaN(Number(list[i].fee))) return Number(list[i].fee);
      break;
    }
    return base;
  }

  function formatMoney(tournament, categoryName) {
    return (tournament.currency || "₹") + entryFeeForCategory(tournament, categoryName);
  }

  function categoryFeesConfigured(tournament) {
    var cats = normalizeCategories(tournament.categories);
    for (var i = 0; i < cats.length; i += 1) {
      if (cats[i].fee != null && !isNaN(Number(cats[i].fee))) return true;
    }
    return false;
  }

  function feeRangeLabel(tournament) {
    var cats = normalizeCategories(tournament.categories);
    if (!cats.length) return formatMoney(tournament);
    var fees = cats.map(function (c) {
      return entryFeeForCategory(tournament, c.name);
    });
    var min = Math.min.apply(null, fees);
    var max = Math.max.apply(null, fees);
    var cur = tournament.currency || "₹";
    if (min === max) return cur + min;
    return cur + min + " – " + cur + max;
  }

  function formatPrettyDate(value) {
    var date = parseDate(value);
    if (!date || isNaN(date.getTime())) return value || "";
    return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }

  function formatDateTime(value) {
    var date = parseDate(value);
    if (!date || isNaN(date.getTime())) return value || "";
    return date.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function roundStatNumber(value) {
    if (value == null || value === "") return null;
    var n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100) / 100;
  }

  function formatStat(value) {
    var n = roundStatNumber(value);
    if (n == null) return "—";
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return n.toFixed(2);
  }

  function resolvePhotoUrl(url) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url) || url.startsWith("/")) return url;
    return "/uploads/" + url.replace(/^\/+/, "");
  }

  function formatDateRange(tournament) {
    return formatPrettyDate(tournament.registrationStart) + " – " + formatPrettyDate(tournament.registrationEnd);
  }

  function stateLabel(state) {
    if (state === "OPEN") return "Registration Open";
    if (state === "UPCOMING") return "Opens soon";
    if (state === "CLOSED") return "Registration Closed";
    return "Coming soon";
  }

  function getUiTheme() {
    try {
      return localStorage.getItem(KEYS.uiTheme) === "dark" ? "dark" : "bright";
    } catch (e) {
      return "bright";
    }
  }

  function setUiTheme(mode) {
    var next = mode === "dark" ? "dark" : "bright";
    try {
      localStorage.setItem(KEYS.uiTheme, next);
    } catch (e) {
      /* ignore */
    }
    document.documentElement.setAttribute("data-ui-theme", next);
    syncThemeToggleButtons();
  }

  function applyCricketTheme() {
    setUiTheme(getUiTheme());
  }

  function themeToggleLabel(mode) {
    return mode === "dark" ? "☀️ Bright" : "🌙 Dark";
  }

  function syncThemeToggleButtons() {
    var mode = getUiTheme();
    document.querySelectorAll("[data-ui-theme-toggle]").forEach(function (btn) {
      btn.textContent = themeToggleLabel(mode);
      btn.setAttribute("aria-label", mode === "dark" ? "Switch to bright theme" : "Switch to dark theme");
    });
  }

  function initUiThemeToggle() {
    applyCricketTheme();
    document.querySelectorAll("[data-ui-theme-toggle]").forEach(function (btn) {
      if (btn.dataset.boundTheme === "1") return;
      btn.dataset.boundTheme = "1";
      btn.addEventListener("click", function () {
        setUiTheme(getUiTheme() === "dark" ? "bright" : "dark");
      });
    });
    syncThemeToggleButtons();
  }

  /** @deprecated Tournament colors are no longer customizable; use initUiThemeToggle */
  function applyTheme() {
    applyCricketTheme();
  }

  function draftKey(tournament) {
    var keys = tournamentKeys(tournament);
    if (keys.tournament && keys.season) return keys.tournament + "/" + keys.season;
    return keys.slug || "default";
  }

  function getDraft(tournament) {
    return readJson(KEYS.drafts, {})[draftKey(tournament)] || null;
  }

  function saveDraft(tournament, draft) {
    var all = readJson(KEYS.drafts, {});
    all[draftKey(tournament)] = draft;
    writeJson(KEYS.drafts, all);
  }

  function clearDraft(tournament) {
    var all = readJson(KEYS.drafts, {});
    delete all[draftKey(tournament)];
    writeJson(KEYS.drafts, all);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char];
    });
  }

  function nl2br(value) {
    return escapeHtml(value).replace(/\n/g, "<br>");
  }

  function skillEmoji(skill) {
    return SKILL_EMOJI[skill] || "🏏";
  }

  function normalizeCategories(raw) {
    var list = raw || [];
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      var item = list[i];
      if (typeof item === "string" && item.trim()) {
        out.push({ name: item.trim(), whatsappGroupUrl: "" });
      } else if (item && item.name) {
        var feeRaw = item.fee;
        var fee =
          feeRaw != null && feeRaw !== "" && !isNaN(Number(feeRaw)) ? Number(feeRaw) : null;
        out.push({
          name: String(item.name).trim(),
          whatsappGroupUrl: String(item.whatsappGroupUrl || "").trim(),
          qrImageUrl: String(item.qrImageUrl || "").trim(),
          fee: fee
        });
      }
    }
    return out.length ? out : defaultTournament().categories;
  }

  function categoryNames(categories) {
    return normalizeCategories(categories).map(function (item) { return item.name; });
  }

  function groupLinkForCategory(categories, categoryName) {
    var name = String(categoryName || "").trim();
    if (!name) return "";
    var key = name.toLowerCase();
    var list = normalizeCategories(categories);
    for (var i = 0; i < list.length; i += 1) {
      if (String(list[i].name || "").trim().toLowerCase() === key) {
        return String(list[i].whatsappGroupUrl || "").trim();
      }
    }
    return "";
  }

  function resolvePaymentQrImageUrl(tournament, categoryName) {
    if (!tournament) return "";
    var payment = (tournament.payment) || {};
    var name = String(categoryName || "").trim();
    if (name) {
      var key = name.toLowerCase();
      var cats = normalizeCategories(tournament.categories);
      for (var i = 0; i < cats.length; i += 1) {
        if (String(cats[i].name || "").trim().toLowerCase() === key && cats[i].qrImageUrl) {
          return String(cats[i].qrImageUrl).trim();
        }
      }
    }
    return String(payment.qrImageUrl || "").trim();
  }

  function paymentQrImageSrc(tournament, categoryName) {
    var direct = resolvePaymentQrImageUrl(tournament, categoryName);
    if (direct && /^https?:\/\//i.test(direct)) return direct;
    var keys = tournamentKeys(tournament);
    var base = keys.tournament && keys.season
      ? "/api/t/" + encodeURIComponent(keys.tournament) + "/" + encodeURIComponent(keys.season)
      : "/api/t/" + encodeURIComponent(keys.slug);
    base += "/payment-qr-image";
    if (categoryName) base += "?category=" + encodeURIComponent(categoryName);
    return base;
  }

  function publicUrl(tournament, options) {
    var preview = options && options.preview;
    var keys = tournamentKeys(typeof tournament === "string" ? { slug: tournament } : tournament);
    var path;
    if (keys.tournament && keys.season) {
      path = "/register.html?tournament=" + encodeURIComponent(keys.tournament) +
        "&season=" + encodeURIComponent(keys.season);
    } else {
      path = "/register.html?t=" + encodeURIComponent(keys.slug);
    }
    if (preview) path += "&preview=1";
    return path;
  }

  function normalizeLeaderboardStats(raw) {
    if (!raw || raw.enabled === false) {
      return { enabled: false, provider: "srpl", gender: "men", edition: "" };
    }
    var edition = slugify(String(raw.edition || ""));
    return {
      enabled: Boolean(edition),
      provider: "srpl",
      gender: raw.gender === "women" ? "women" : "men",
      edition: edition
    };
  }

  function tournamentStatsUrl(tournament) {
    var ls = normalizeLeaderboardStats(tournament && tournament.leaderboardStats);
    if (!ls.enabled) return null;
    var params = new URLSearchParams();
    params.set("gender", ls.gender);
    params.set("edition", ls.edition);
    var keys = tournamentKeys(tournament);
    if (keys.tournament && keys.season) {
      params.set("tournament", keys.tournament);
      params.set("season", keys.season);
    } else if (keys.slug) {
      params.set("t", keys.slug);
    }
    return "/stats.html?" + params.toString();
  }

  function publicPathUrl(tournament) {
    var keys = tournamentKeys(typeof tournament === "string" ? { slug: tournament } : tournament);
    if (keys.tournament && keys.season) {
      return "/" + encodeURIComponent(keys.tournament) + "/" + encodeURIComponent(keys.season);
    }
    return publicUrl(tournament);
  }

  function waDigits(phone) {
    var digits = String(phone || "").replace(/\D/g, "");
    if (digits.length === 10) return "91" + digits;
    if (digits.length === 11 && digits.charAt(0) === "0") return "91" + digits.slice(1);
    return digits;
  }

  function waMeUrl(phone, text) {
    var digits = waDigits(phone);
    var query = "text=" + encodeURIComponent(text || "");
    return digits ? "https://wa.me/" + digits + "?" + query : "https://wa.me/?" + query;
  }

  function registrationWaText(tournament, record) {
    var paid = record && record.paymentStatus === "PAID";
    return [
      tournament.name,
      record && record.name ? "Name: " + record.name : "",
      record && record.flat ? "Flat: " + record.flat : "",
      record && record.category ? "Category: " + record.category : "",
      "Status: " + (paid ? "Confirmed" : "Reserved — pay to confirm"),
      "Fee: " + formatMoney(tournament)
    ].filter(Boolean).join("\n");
  }

  function request(path, options) {
    var opts = options || {};
    var headers = Object.assign({}, opts.headers || {});
    var isForm = opts.body instanceof FormData;
    if (!isForm && opts.body && typeof opts.body !== "string") {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(path, Object.assign({ credentials: "include" }, opts, { headers: headers })).then(function (res) {
      var type = res.headers.get("content-type") || "";
      if (type.indexOf("text/csv") !== -1) return res;
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var fallback = res.status === 401 ? "Sign in required — open Admin and log in again"
            : res.status === 404 ? "Not found — restart the server (npm start) if you recently updated"
            : "Request failed (" + res.status + ")";
          var error = new Error(data.error || fallback);
          error.status = res.status;
          error.data = data;
          throw error;
        }
        return data;
      });
    });
  }

  var api = {
    health: function () { return request("/api/health"); },
    listPublic: function (preview) {
      return request("/api/tournaments" + (preview ? "?preview=1" : "")).then(function (data) {
        return data.tournaments || [];
      });
    },
    config: function (ref, preview) {
      return request(apiTournamentPath(ref) + "/config" + (preview ? "?preview=1" : ""));
    },
    lookup: function (ref, phone, category) {
      var q = "phone=" + encodeURIComponent(phone);
      if (category != null && String(category).trim() !== "") {
        q += "&category=" + encodeURIComponent(String(category).trim());
      }
      return request(apiTournamentPath(ref) + "/lookup?" + q).then(function (data) {
        return data.record || null;
      });
    },
    roster: function (ref, preview) {
      return request(apiTournamentPath(ref) + "/roster" + (preview ? "?preview=1" : "")).then(function (data) {
        return { categories: data.categories || [], players: data.players || [] };
      });
    },
    register: function (ref, body, preview, photoFile) {
      var url = apiTournamentPath(ref) + "/register" + (preview ? "?preview=1" : "");
      if (photoFile) {
        var fd = new FormData();
        Object.keys(body || {}).forEach(function (key) {
          var val = body[key];
          if (val == null || val === "") return;
          if (key === "customFields" && typeof val === "object") {
            fd.append(key, JSON.stringify(val));
          } else {
            fd.append(key, String(val));
          }
        });
        if (preview) fd.append("preview", "true");
        fd.append("photo", photoFile);
        return request(url, { method: "POST", body: fd });
      }
      return request(url, { method: "POST", body: body });
    },
    paymentConfig: function () {
      return request("/api/payments/config");
    },
    tournamentPaymentConfig: function (ref) {
      return request(apiTournamentPath(ref) + "/payments/config");
    },
    paymentQr: function (ref, id) {
      return request(apiTournamentPath(ref) + "/registrations/" + encodeURIComponent(id) + "/payment-qr");
    },
    paymentQrPreview: function (ref, categoryName) {
      var q = categoryName ? "?category=" + encodeURIComponent(categoryName) : "";
      return request(apiTournamentPath(ref) + "/payment-qr" + q);
    },
    paymentQrImageUrl: function (ref, categoryName) {
      var base = apiTournamentPath(ref) + "/payment-qr-image";
      if (categoryName) return base + "?category=" + encodeURIComponent(categoryName);
      return base;
    },
    jerseySizeChartImageUrl: function (ref) {
      return apiTournamentPath(ref) + "/jersey-size-chart-image";
    },
    playerPhotoImageUrl: function (ref, registrationNumber) {
      return apiTournamentPath(ref) + "/registrations/" + encodeURIComponent(registrationNumber) + "/photo-image";
    },
    uploadCategoryPaymentQr: function (slug, categoryIndex, file) {
      var form = new FormData();
      form.append("qr", file);
      form.append("categoryIndex", String(categoryIndex));
      return request("/api/admin/tournaments/" + encodeURIComponent(slug) + "/category-payment-qr", {
        method: "POST",
        body: form
      });
    },
    uploadPaymentQr: function (slug, file) {
      var form = new FormData();
      form.append("qr", file);
      return request("/api/admin/tournaments/" + encodeURIComponent(slug) + "/payment-qr", {
        method: "POST",
        body: form
      });
    },
    uploadJerseySizeChart: function (slug, file) {
      var form = new FormData();
      form.append("chart", file);
      return request("/api/admin/tournaments/" + encodeURIComponent(slug) + "/jersey-size-chart", {
        method: "POST",
        body: form
      });
    },
    uploadSponsorLogo: function (slug, file) {
      var form = new FormData();
      form.append("logo", file);
      return request("/api/admin/tournaments/" + encodeURIComponent(slug) + "/sponsor-logo", {
        method: "POST",
        body: form
      });
    },
    createPaymentOrder: function (ref, id) {
      return request(apiTournamentPath(ref) + "/registrations/" + encodeURIComponent(id) + "/payment-order", {
        method: "POST",
        body: {}
      });
    },
    verifyPayment: function (ref, id, payload) {
      return request(apiTournamentPath(ref) + "/registrations/" + encodeURIComponent(id) + "/pay-verify", {
        method: "POST",
        body: payload
      }).then(function (data) { return data.record; });
    },
    payDemo: function (ref, id) {
      return request(apiTournamentPath(ref) + "/registrations/" + encodeURIComponent(id) + "/pay", {
        method: "POST",
        body: {}
      }).then(function (data) { return data.record; });
    },
    loadRazorpayCheckout: function () {
      return new Promise(function (resolve, reject) {
        if (global.Razorpay) {
          resolve();
          return;
        }
        var script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.async = true;
        script.onload = function () { resolve(); };
        script.onerror = function () { reject(new Error("Could not load payment checkout")); };
        document.head.appendChild(script);
      });
    },
    uploadReceipt: function (ref, id, file, upiRef) {
      var form = new FormData();
      if (file) form.append("receipt", file);
      if (upiRef) form.append("upiRef", upiRef);
      return request(apiTournamentPath(ref) + "/registrations/" + encodeURIComponent(id) + "/receipt", {
        method: "POST",
        body: form
      }).then(function (data) { return data.record; });
    },
    adminPlayerPhotoUrl: function (slug, registrationId) {
      return "/api/admin/tournaments/" + encodeURIComponent(slug) + "/registrations/" + encodeURIComponent(registrationId) + "/photo-image";
    },
    adminReceiptImageUrl: function (slug, registrationId) {
      return "/api/admin/tournaments/" + encodeURIComponent(slug) + "/registrations/" + encodeURIComponent(registrationId) + "/receipt-image";
    },
    approveRegistration: function (slug, id) {
      return request("/api/admin/tournaments/" + encodeURIComponent(slug) + "/registrations/" + encodeURIComponent(id) + "/approve", {
        method: "POST",
        body: {}
      }).then(function (data) { return data.record; });
    },
    deleteRegistration: function (slug, id) {
      return request("/api/admin/tournaments/" + encodeURIComponent(slug) + "/registrations/" + encodeURIComponent(id), {
        method: "DELETE"
      });
    },
    rejectRegistration: function (slug, id, reason) {
      return request("/api/admin/tournaments/" + encodeURIComponent(slug) + "/registrations/" + encodeURIComponent(id) + "/reject", {
        method: "POST",
        body: { reason: reason }
      }).then(function (data) { return data.record; });
    },
    pay: function (ref, id) {
      return api.tournamentPaymentConfig(ref).then(function (cfg) {
        if (cfg.mode === "manual_qr") {
          return Promise.reject(new Error("Pay via QR and upload your receipt below"));
        }
        if (cfg.mode !== "razorpay") {
          return api.payDemo(ref, id);
        }
        if (cfg.razorpayAvailable === false) {
          return Promise.reject(new Error("Online payments are not configured on the server yet. Contact the organizer."));
        }
        return api.createPaymentOrder(ref, id).then(function (order) {
          if (order.alreadyPaid && order.record) return order.record;
          return api.loadRazorpayCheckout().then(function () {
            return new Promise(function (resolve, reject) {
              var options = {
                key: order.keyId || cfg.razorpayKeyId,
                amount: order.amount,
                currency: order.currency,
                name: order.name,
                description: order.description,
                order_id: order.orderId,
                prefill: order.prefill || {},
                theme: { color: "#0b6b45" },
                handler: function (response) {
                  api.verifyPayment(ref, id, {
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature
                  }).then(resolve).catch(reject);
                },
                modal: {
                  ondismiss: function () {
                    reject(new Error("Payment cancelled"));
                  }
                }
              };
              var checkout = new global.Razorpay(options);
              checkout.on("payment.failed", function (event) {
                var desc = event && event.error && event.error.description;
                reject(new Error(desc || "Payment failed"));
              });
              checkout.open();
            });
          });
        });
      });
    },
    uploadPhoto: function (ref, id, file) {
      var form = new FormData();
      form.append("photo", file);
      return request(apiTournamentPath(ref) + "/registrations/" + encodeURIComponent(id) + "/photo", {
        method: "POST",
        body: form
      });
    },
    login: function (username, password) {
      return request("/api/admin/login", { method: "POST", body: { username: username, password: password } });
    },
    logout: function () { return request("/api/admin/logout", { method: "POST", body: {} }); },
    me: function () { return request("/api/admin/me"); },
    listTournamentAdmins: function () {
      return request("/api/admin/users").then(function (data) { return data.users || []; });
    },
    createTournamentAdmin: function (body) {
      return request("/api/admin/users", { method: "POST", body: body }).then(function (data) {
        return data.user;
      });
    },
    updateTournamentAdmin: function (id, body) {
      return request("/api/admin/users/" + encodeURIComponent(id), { method: "PATCH", body: body });
    },
    listAdmin: function () {
      return request("/api/admin/tournaments").then(function (data) { return data.tournaments || []; });
    },
    createTournament: function (body) {
      return request("/api/admin/tournaments", { method: "POST", body: body }).then(function (data) {
        return data.tournament;
      });
    },
    saveTournament: function (slug, body) {
      return request("/api/admin/tournaments/" + encodeURIComponent(slug), { method: "PUT", body: body }).then(function (data) {
        return data.tournament;
      });
    },
    deleteTournament: function (slug) {
      return request("/api/admin/tournaments/" + encodeURIComponent(slug), { method: "DELETE" });
    },
    registrations: function (slug) {
      return request("/api/admin/tournaments/" + encodeURIComponent(slug) + "/registrations").then(function (data) {
        return data.registrations || [];
      });
    },
    clearRegistrations: function (slug) {
      return request("/api/admin/tournaments/" + encodeURIComponent(slug) + "/registrations", { method: "DELETE" });
    },
    exportCsv: function (slug) {
      return request("/api/admin/tournaments/" + encodeURIComponent(slug) + "/registrations.csv").then(function (res) {
        return res.blob();
      }).then(function (blob) {
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = slug + "-registrations.csv";
        link.click();
      });
    },
    statsManifest: function () {
      return request("/api/stats/srpl/manifest");
    },
    statsBundle: function (gender, edition, board, version) {
      var url =
        "/api/stats/srpl/" + encodeURIComponent(gender) + "/" +
        encodeURIComponent(edition) + "/" + encodeURIComponent(board);
      if (version) url += "?v=" + encodeURIComponent(version);
      return request(url);
    },
    uploadSrplStatsCsv: function (formData) {
      return request("/api/admin/stats/srpl/upload", { method: "POST", body: formData });
    },
    rebuildSrplStats: function () {
      return request("/api/admin/stats/srpl/rebuild", { method: "POST", body: {} });
    },
    statsPlayers: function (gender, edition) {
      return request(
        "/api/stats/srpl/" + encodeURIComponent(gender) + "/" + encodeURIComponent(edition) + "/players"
      );
    },
    statsPlayer: function (gender, edition, playerId) {
      return request(
        "/api/stats/srpl/" + encodeURIComponent(gender) + "/" + encodeURIComponent(edition) +
        "/players/" + encodeURIComponent(playerId)
      );
    },
    playerProfileUrl: function (gender, edition, playerId, extraParams) {
      var params = new URLSearchParams();
      params.set("gender", gender);
      params.set("edition", edition);
      params.set("player", String(playerId));
      if (extraParams) {
        Object.keys(extraParams).forEach(function (key) {
          if (extraParams[key] != null && extraParams[key] !== "") {
            params.set(key, extraParams[key]);
          }
        });
      }
      return "/player.html?" + params.toString();
    },
    playersSearchUrl: function (gender, edition, extraParams) {
      var params = new URLSearchParams();
      params.set("gender", gender);
      params.set("edition", edition);
      if (extraParams) {
        Object.keys(extraParams).forEach(function (key) {
          if (extraParams[key] != null && extraParams[key] !== "") {
            params.set(key, extraParams[key]);
          }
        });
      }
      return "/players.html?" + params.toString();
    }
  };

  global.Crickipedia = {
    KEYS: KEYS,
    defaultTournament: defaultTournament,
    slugify: slugify,
    prefixFromSlug: prefixFromSlug,
    queryParam: queryParam,
    parsePublicUrl: parsePublicUrl,
    tournamentKeys: tournamentKeys,
    sameSeason: sameSeason,
    resolvePublicTournament: resolvePublicTournament,
    getAdminSlug: getAdminSlug,
    setAdminSlug: setAdminSlug,
    publicState: publicState,
    canRegister: canRegister,
    formatMoney: formatMoney,
    formatPrettyDate: formatPrettyDate,
    formatDateTime: formatDateTime,
    roundStatNumber: roundStatNumber,
    formatStat: formatStat,
    resolvePhotoUrl: resolvePhotoUrl,
    formatDateRange: formatDateRange,
    stateLabel: stateLabel,
    applyTheme: applyTheme,
    getUiTheme: getUiTheme,
    setUiTheme: setUiTheme,
    applyCricketTheme: applyCricketTheme,
    initUiThemeToggle: initUiThemeToggle,
    getDraft: getDraft,
    saveDraft: saveDraft,
    clearDraft: clearDraft,
    escapeHtml: escapeHtml,
    nl2br: nl2br,
    skillEmoji: skillEmoji,
    fieldMode: fieldMode,
    fieldModeForTournament: fieldModeForTournament,
    mergeFieldsSettings: mergeFieldsSettings,
    defaultFieldsSettings: defaultFieldsSettings,
    defaultFormFieldsArray: defaultFormFieldsArray,
    normalizeFormFields: normalizeFormFields,
    customFormFields: customFormFields,
    newCustomFieldId: newCustomFieldId,
    BUILTIN_FIELD_LABELS: BUILTIN_FIELD_LABELS,
    normalizeCategories: normalizeCategories,
    categoryNames: categoryNames,
    groupLinkForCategory: groupLinkForCategory,
    entryFeeForCategory: entryFeeForCategory,
    categoryFeesConfigured: categoryFeesConfigured,
    feeRangeLabel: feeRangeLabel,
    resolvePaymentQrImageUrl: resolvePaymentQrImageUrl,
    paymentQrImageSrc: paymentQrImageSrc,
    publicUrl: publicUrl,
    publicPathUrl: publicPathUrl,
    normalizeLeaderboardStats: normalizeLeaderboardStats,
    tournamentStatsUrl: tournamentStatsUrl,
    playerProfileUrl: function (gender, edition, playerId, extraParams) {
      return api.playerProfileUrl(gender, edition, playerId, extraParams);
    },
    playersSearchUrl: function (gender, edition, extraParams) {
      return api.playersSearchUrl(gender, edition, extraParams);
    },
    waDigits: waDigits,
    waMeUrl: waMeUrl,
    registrationWaText: registrationWaText,
    api: api
  };
})(window);
