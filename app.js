(function (global) {
  var KEYS = {
    drafts: "crickipedia_drafts",
    adminSlug: "crickipedia_admin_slug"
  };

  var SKILL_EMOJI = {
    Batter: "🏏",
    Bowler: "🎯",
    "Wicket Keeper": "🧤",
    "All Rounder": "🔥"
  };

  function defaultTournament() {
    return {
      slug: "cpl-2026",
      name: "Celebria Premier League 2026",
      shortName: "CPL",
      tagline: "Official Player Registration",
      heroTitle: "Step onto the pitch.\nRegister your cricket profile.",
      heroSub: "Complete your player registration and secure your place in the tournament.",
      logoEmoji: "🏏",
      logoUrl: "",
      colors: {
        green: "#0b6b45",
        green2: "#0f8b5b",
        gold: "#f5b942",
        dark: "#071b16",
        light: "#f5f8f6"
      },
      status: "OPEN",
      registrationStart: "2026-09-20",
      registrationEnd: "2026-09-30",
      fee: 500,
      currency: "₹",
      idPrefix: "CPL2026",
      noticeTitle: "Important",
      notice: "Your spot is reserved as soon as you get a Registration ID. Pay the entry fee to confirm.",
      whatsNext: "Your registration is the first step. Later phases add auctions, teams, live scoring and prizes.",
      supportWhatsapp: "",
      fields: {
        dob: true,
        flatNumber: true,
        category: true,
        jerseyNumber: true,
        jerseySize: true,
        sleeve: true,
        photo: true,
        cricheroes: true,
        instagram: true
      },
      skills: [
        { value: "Batter", label: "Batter", emoji: "🏏" },
        { value: "Bowler", label: "Bowler", emoji: "🎯" },
        { value: "Wicket Keeper", label: "WK", emoji: "🧤" },
        { value: "All Rounder", label: "All Rounder", emoji: "🔥" }
      ],
      jerseySizes: ["S", "M", "L", "XL", "XXL", "XXXL"],
      categories: ["Resident", "Guest", "Kids"],
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

  function resolvePublicTournament(list) {
    var requested = queryParam("t");
    var items = list || [];
    if (requested) {
      var match = items.find(function (item) { return item.slug === requested; });
      if (match) return match;
    }
    return items.find(function (item) { return publicState(item) === "OPEN"; }) || items[0] || null;
  }

  function getAdminSlug(list) {
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
    var parts = String(value).split("-");
    if (parts.length !== 3) return new Date(value);
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

  function formatMoney(tournament) {
    return (tournament.currency || "₹") + Number(tournament.fee || 0);
  }

  function formatPrettyDate(value) {
    var date = parseDate(value);
    if (!date || isNaN(date.getTime())) return value || "";
    return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
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

  function applyTheme(tournament) {
    if (!tournament || !tournament.colors) return;
    var root = document.documentElement.style;
    root.setProperty("--green", tournament.colors.green || "#0b6b45");
    root.setProperty("--green2", tournament.colors.green2 || "#0f8b5b");
    root.setProperty("--gold", tournament.colors.gold || "#f5b942");
    root.setProperty("--dark", tournament.colors.dark || "#071b16");
    root.setProperty("--light", tournament.colors.light || "#f5f8f6");
  }

  function draftKey(slug) {
    return slug || "default";
  }

  function getDraft(slug) {
    return readJson(KEYS.drafts, {})[draftKey(slug)] || null;
  }

  function saveDraft(slug, draft) {
    var all = readJson(KEYS.drafts, {});
    all[draftKey(slug)] = draft;
    writeJson(KEYS.drafts, all);
  }

  function clearDraft(slug) {
    var all = readJson(KEYS.drafts, {});
    delete all[draftKey(slug)];
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

  function publicUrl(slug) {
    return "index.html?t=" + encodeURIComponent(slug);
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
      "Registration ID: " + (record && record.id ? record.id : ""),
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
          var error = new Error(data.error || "Request failed");
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
    config: function (slug, preview) {
      return request("/api/t/" + encodeURIComponent(slug) + "/config" + (preview ? "?preview=1" : ""));
    },
    lookup: function (slug, phone) {
      return request("/api/t/" + encodeURIComponent(slug) + "/lookup?phone=" + encodeURIComponent(phone)).then(function (data) {
        return data.record || null;
      });
    },
    register: function (slug, body, preview) {
      return request("/api/t/" + encodeURIComponent(slug) + "/register" + (preview ? "?preview=1" : ""), {
        method: "POST",
        body: body
      });
    },
    pay: function (slug, id) {
      return request("/api/t/" + encodeURIComponent(slug) + "/registrations/" + encodeURIComponent(id) + "/pay", {
        method: "POST",
        body: {}
      }).then(function (data) { return data.record; });
    },
    uploadPhoto: function (slug, id, file) {
      var form = new FormData();
      form.append("photo", file);
      return request("/api/t/" + encodeURIComponent(slug) + "/registrations/" + encodeURIComponent(id) + "/photo", {
        method: "POST",
        body: form
      });
    },
    login: function (username, password) {
      return request("/api/admin/login", { method: "POST", body: { username: username, password: password } });
    },
    logout: function () { return request("/api/admin/logout", { method: "POST", body: {} }); },
    me: function () { return request("/api/admin/me"); },
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
    }
  };

  global.Crickipedia = {
    KEYS: KEYS,
    defaultTournament: defaultTournament,
    slugify: slugify,
    prefixFromSlug: prefixFromSlug,
    queryParam: queryParam,
    resolvePublicTournament: resolvePublicTournament,
    getAdminSlug: getAdminSlug,
    setAdminSlug: setAdminSlug,
    publicState: publicState,
    canRegister: canRegister,
    formatMoney: formatMoney,
    formatPrettyDate: formatPrettyDate,
    formatDateRange: formatDateRange,
    stateLabel: stateLabel,
    applyTheme: applyTheme,
    getDraft: getDraft,
    saveDraft: saveDraft,
    clearDraft: clearDraft,
    escapeHtml: escapeHtml,
    nl2br: nl2br,
    skillEmoji: skillEmoji,
    publicUrl: publicUrl,
    waDigits: waDigits,
    waMeUrl: waMeUrl,
    registrationWaText: registrationWaText,
    api: api
  };
})(window);
