(function () {
  var C = window.Crickipedia;
  var manifest = null;
  var allPlayers = [];
  var scopedStats = null;

  function qs(id) {
    return document.getElementById(id);
  }

  function contextParamsObject() {
    var out = {};
    var tournament = C.queryParam("tournament");
    var season = C.queryParam("season");
    var slug = C.queryParam("t");
    if (tournament && season) {
      out.tournament = tournament;
      out.season = season;
    } else if (slug) {
      out.t = slug;
    }
    return out;
  }

  function parseEditionsFromUrl() {
    var multi = C.queryParam("editions");
    if (multi) {
      return multi.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    }
    var single = C.queryParam("edition");
    return single ? [single] : [];
  }

  function getActiveEditions() {
    var fromUrl = parseEditionsFromUrl();
    if (fromUrl.length) return fromUrl;
    var ed = qs("edition").value;
    return ed ? [ed] : [];
  }

  function playersPageUrl(gender, edition) {
    var params = new URLSearchParams();
    params.set("gender", gender);
    var editions = getActiveEditions();
    if (editions.length > 1) {
      params.set("editions", editions.join(","));
    } else {
      params.set("edition", edition || editions[0] || "");
    }
    var ctx = contextParamsObject();
    Object.keys(ctx).forEach(function (key) {
      params.set(key, ctx[key]);
    });
    return "/players.html?" + params.toString();
  }

  function isStatsScopedToTournament() {
    return Boolean(scopedStats && scopedStats.enabled && scopedStats.edition);
  }

  function editionsForGender(gender) {
    if (!manifest || !manifest.editions || !manifest.editions[gender]) return [];
    return Object.keys(manifest.editions[gender]).sort();
  }

  function applyScopedControls() {
    var scopedFilters = document.querySelectorAll(".scoped-filter");
    if (!isStatsScopedToTournament()) {
      scopedFilters.forEach(function (el) { el.classList.remove("hidden"); });
      return;
    }
    qs("gender").value = scopedStats.gender;
    scopedFilters.forEach(function (el) { el.classList.add("hidden"); });
  }

  function fillEditionSelect() {
    var gender = qs("gender").value;
    var editions;
    if (isStatsScopedToTournament()) {
      editions = [scopedStats.edition];
    } else {
      editions = editionsForGender(gender);
    }
    var sel = qs("edition");
    var prev = sel.value;
    sel.innerHTML = editions.map(function (ed) {
      return '<option value="' + C.escapeHtml(ed) + '">' + C.escapeHtml(ed.toUpperCase()) + "</option>";
    }).join("");
    if (isStatsScopedToTournament()) {
      sel.value = scopedStats.edition;
    } else if (editions.indexOf(prev) >= 0) {
      sel.value = prev;
    } else if (editions.length) {
      sel.value = editions[editions.length - 1];
    }
  }

  function syncUrl() {
    history.replaceState(null, "", playersPageUrl(qs("gender").value, qs("edition").value));
  }

  function initBackLink() {
    var ctx = contextParamsObject();
    var params = new URLSearchParams();
    params.set("gender", qs("gender").value);
    var editions = getActiveEditions();
    if (editions.length > 1) {
      params.set("editions", editions.join(","));
    } else {
      params.set("edition", editions[0] || qs("edition").value);
    }
    Object.keys(ctx).forEach(function (key) {
      params.set(key, ctx[key]);
    });
    qs("backLink").href = "/stats.html?" + params.toString();
    qs("backLink").textContent = "← Season charts & tables";
  }

  function renderResults(filtered) {
    var root = qs("results");
    qs("resultCount").textContent = filtered.length
      ? filtered.length + " player" + (filtered.length === 1 ? "" : "s")
      : "";
    if (!filtered.length) {
      root.innerHTML = '<li class="empty">' +
        (allPlayers.length ? "No players match your search." : "No players in this season yet.") +
        "</li>";
      return;
    }
    var gender = qs("gender").value;
    var editions = getActiveEditions();
    var edition = editions[0] || qs("edition").value;
    var extra = contextParamsObject();
    if (editions.length > 1) extra.editions = editions.join(",");
    root.innerHTML = filtered.map(function (p) {
      var href = C.playerProfileUrl(gender, edition, p.playerId, extra);
      return '<li><a href="' + C.escapeHtml(href) + '">' + C.escapeHtml(p.name) + "</a></li>";
    }).join("");
  }

  function applyFilter() {
    var q = qs("search").value.trim().toLowerCase();
    if (!q) {
      renderResults(allPlayers);
      return;
    }
    var filtered = allPlayers.filter(function (p) {
      return (p.name || "").toLowerCase().indexOf(q) >= 0 ||
        (p.team || "").toLowerCase().indexOf(q) >= 0;
    });
    renderResults(filtered);
  }

  function loadPlayers() {
    var gender = qs("gender").value;
    var editions = getActiveEditions();
    qs("loadError").classList.add("hidden");
    var request = editions.length > 1
      ? C.api.statsMergedPlayers(gender, editions)
      : C.api.statsPlayers(gender, editions[0] || qs("edition").value);
    return request.then(function (data) {
      allPlayers = data.players || [];
      applyFilter();
    }).catch(function (err) {
      allPlayers = [];
      renderResults([]);
      qs("loadError").textContent = err.message || "Could not load players";
      qs("loadError").classList.remove("hidden");
    });
  }

  function boot() {
    C.initUiThemeToggle();

    C.fetchTournamentForQueryContext().then(function (tournament) {
      scopedStats = C.scopedLeaderboardStats(tournament);
      if (isStatsScopedToTournament()) {
        qs("gender").value = scopedStats.gender;
      } else {
        var g = C.queryParam("gender");
        if (g && qs("gender").querySelector('option[value="' + g + '"]')) qs("gender").value = g;
      }
      applyScopedControls();
      return C.api.statsManifest();
    }).then(function (data) {
      manifest = data;
      fillEditionSelect();
      var urlEditions = parseEditionsFromUrl();
      if (urlEditions.length === 1 && editionsForGender(qs("gender").value).indexOf(urlEditions[0]) >= 0) {
        qs("edition").value = urlEditions[0];
      } else if (!urlEditions.length && !isStatsScopedToTournament()) {
        var e = C.queryParam("edition");
        if (e && editionsForGender(qs("gender").value).indexOf(e) >= 0) qs("edition").value = e;
      }
      applyScopedControls();
      initBackLink();
      syncUrl();
      return loadPlayers();
    }).catch(function (err) {
      qs("loadError").textContent = err.message || "Could not load season list";
      qs("loadError").classList.remove("hidden");
    });

    qs("gender").addEventListener("change", function () {
      fillEditionSelect();
      initBackLink();
      syncUrl();
      loadPlayers();
    });
    qs("edition").addEventListener("change", function () {
      initBackLink();
      syncUrl();
      loadPlayers();
    });
    qs("search").addEventListener("input", applyFilter);
  }

  boot();
})();
