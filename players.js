(function () {
  var C = window.Crickipedia;
  var manifest = null;
  var allPlayers = [];

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

  function playersPageUrl(gender, edition) {
    var params = new URLSearchParams();
    params.set("gender", gender);
    params.set("edition", edition);
    var ctx = contextParamsObject();
    Object.keys(ctx).forEach(function (key) {
      params.set(key, ctx[key]);
    });
    return "/players.html?" + params.toString();
  }

  function editionsForGender(gender) {
    if (!manifest || !manifest.editions || !manifest.editions[gender]) return [];
    return Object.keys(manifest.editions[gender]).sort();
  }

  function fillEditionSelect() {
    var gender = qs("gender").value;
    var editions = editionsForGender(gender);
    var sel = qs("edition");
    var prev = sel.value;
    sel.innerHTML = editions.map(function (ed) {
      return '<option value="' + C.escapeHtml(ed) + '">' + C.escapeHtml(ed.toUpperCase()) + "</option>";
    }).join("");
    if (editions.indexOf(prev) >= 0) sel.value = prev;
    else if (editions.length) sel.value = editions[editions.length - 1];
  }

  function syncUrl() {
    history.replaceState(null, "", playersPageUrl(qs("gender").value, qs("edition").value));
  }

  function initBackLink() {
    var ctx = contextParamsObject();
    var params = new URLSearchParams();
    params.set("gender", qs("gender").value);
    params.set("edition", qs("edition").value);
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
    var edition = qs("edition").value;
    var extra = contextParamsObject();
    root.innerHTML = filtered.map(function (p) {
      var href = C.playerProfileUrl(gender, edition, p.playerId, extra);
      return '<li><a href="' + C.escapeHtml(href) + '"><span>' + C.escapeHtml(p.name) +
        '</span><span class="team">' + C.escapeHtml(p.team || "") + "</span></a></li>";
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
    var edition = qs("edition").value;
    qs("loadError").classList.add("hidden");
    return C.api.statsPlayers(gender, edition).then(function (data) {
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
    var g = C.queryParam("gender");
    var e = C.queryParam("edition");
    if (g && qs("gender").querySelector('option[value="' + g + '"]')) qs("gender").value = g;

    C.api.statsManifest().then(function (data) {
      manifest = data;
      fillEditionSelect();
      if (e && editionsForGender(qs("gender").value).indexOf(e) >= 0) qs("edition").value = e;
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
