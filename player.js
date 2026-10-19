(function () {
  var C = window.Crickipedia;
  var manifest = null;
  var scopedStats = null;
  var leagueSeasons = [];
  var playerPickBound = false;

  function qs(id) {
    return document.getElementById(id);
  }

  function formatEditionLabel(edition) {
    var e = String(edition || "");
    var m = e.match(/^(cpl|cgl|srpl)(\d+)$/i);
    if (m) return m[1].toUpperCase() + " " + m[2];
    return e.toUpperCase();
  }

  function compareEditionKeys(a, b) {
    var ma = String(a).match(/^(cpl|cgl|srpl)(\d+)$/i);
    var mb = String(b).match(/^(cpl|cgl|srpl)(\d+)$/i);
    if (ma && mb) {
      var seriesOrder = { cpl: 0, cgl: 1, srpl: 0 };
      var sa = seriesOrder[ma[1].toLowerCase()] != null ? seriesOrder[ma[1].toLowerCase()] : 2;
      var sb = seriesOrder[mb[1].toLowerCase()] != null ? seriesOrder[mb[1].toLowerCase()] : 2;
      if (sa !== sb) return sa - sb;
      return Number(ma[2]) - Number(mb[2]);
    }
    return String(a).localeCompare(String(b));
  }

  function sortSeasonEntries(seasons) {
    return seasons.slice().sort(function (a, b) {
      if (a.gender !== b.gender) return a.gender.localeCompare(b.gender);
      return compareEditionKeys(a.edition, b.edition);
    });
  }

  function groupSeasonsForDisplay(seasons) {
    var cpl = [];
    var cgl = [];
    var other = [];
    seasons.forEach(function (s) {
      if (/^cpl\d+$/i.test(s.edition)) cpl.push(s);
      else if (/^cgl\d+$/i.test(s.edition)) cgl.push(s);
      else other.push(s);
    });
    cpl.sort(function (a, b) { return compareEditionKeys(a.edition, b.edition); });
    cgl.sort(function (a, b) { return compareEditionKeys(a.edition, b.edition); });
    other.sort(function (a, b) { return compareEditionKeys(a.edition, b.edition); });
    return { cpl: cpl, cgl: cgl, other: other };
  }

  function isStatsScopedToTournament() {
    return Boolean(scopedStats && scopedStats.enabled && scopedStats.edition);
  }

  function hasStatsLeague() {
    return Boolean(scopedStats && scopedStats.leagueId && leagueSeasons.length);
  }

  function leagueSeasonsForGender(gender) {
    return leagueSeasons.filter(function (s) { return s.gender === gender; });
  }

  function editionsForGender(gender) {
    if (!manifest || !manifest.editions || !manifest.editions[gender]) return [];
    return Object.keys(manifest.editions[gender]).sort(compareEditionKeys);
  }

  function dataStoreForLeagueId(leagueId) {
    var id = String(leagueId || "").toLowerCase();
    if (id === "celebria") return "celebria";
    if (id === "srpl" || id === "shankeshwaram") return "shankeshwaram";
    return "";
  }

  function editionsForLeague(gender, leagueId) {
    var store = dataStoreForLeagueId(leagueId);
    if (!store || !manifest || !manifest.datasets) return editionsForGender(gender);
    var set = {};
    manifest.datasets.forEach(function (d) {
      if (d.gender === gender && d.store === store) set[d.edition] = true;
    });
    return Object.keys(set).sort(compareEditionKeys);
  }

  function mergeLeagueSeasonsFromManifest() {
    if (!scopedStats || !scopedStats.leagueId || !manifest) return;
    var leagueId = scopedStats.leagueId;
    var fromDb = {};
    leagueSeasons.forEach(function (s) {
      fromDb[s.gender + ":" + s.edition] = s;
    });
    var merged = [];
    ["men", "women"].forEach(function (gender) {
      editionsForLeague(gender, leagueId).forEach(function (edition) {
        var key = gender + ":" + edition;
        if (fromDb[key]) {
          merged.push({
            edition: fromDb[key].edition,
            gender: fromDb[key].gender,
            label: formatEditionLabel(edition)
          });
        } else {
          merged.push({
            edition: edition,
            gender: gender,
            label: formatEditionLabel(edition)
          });
        }
      });
    });
    leagueSeasons = sortSeasonEntries(merged);
  }

  function seasonsForPicker(gender) {
    if (hasStatsLeague()) {
      return leagueSeasonsForGender(gender);
    }
    if (isStatsScopedToTournament()) return [];
    var eds = editionsForGender(gender);
    if (eds.length <= 1) return [];
    return eds.map(function (edition) {
      return { edition: edition, gender: gender, label: formatEditionLabel(edition) };
    });
  }

  function shouldShowSeasonPanel(gender) {
    return seasonsForPicker(gender).length > 1;
  }

  function isInvalidEditionParam(edition) {
    if (!edition || !scopedStats) return false;
    var leagueId = scopedStats.leagueId || "";
    return Boolean(leagueId && edition === leagueId);
  }

  function sanitizeEditionList(list) {
    return (list || []).filter(function (e) {
      return e && !isInvalidEditionParam(e);
    });
  }

  function parseEditionsFromUrl() {
    var multi = C.queryParam("editions");
    if (multi) {
      return sanitizeEditionList(multi.split(",").map(function (s) { return s.trim(); }).filter(Boolean));
    }
    var single = C.queryParam("edition");
    return single ? sanitizeEditionList([single]) : [];
  }

  function resolveGender() {
    if (scopedStats && scopedStats.gender) return scopedStats.gender;
    return C.queryParam("gender") || "men";
  }

  function getSelectedEditions() {
    var gender = resolveGender();
    var panel = qs("playerSeasonChecks");
    if (shouldShowSeasonPanel(gender) && panel) {
      var picked = [];
      panel.querySelectorAll("input[data-edition]:checked").forEach(function (input) {
        picked.push(input.getAttribute("data-edition"));
      });
      picked = sanitizeEditionList(picked);
      if (picked.length) return picked;
    }
    var fromUrl = parseEditionsFromUrl();
    if (fromUrl.length) return fromUrl;
    var edition = C.queryParam("edition");
    if (edition && !isInvalidEditionParam(edition)) return [edition];
    if (scopedStats && scopedStats.edition && !isInvalidEditionParam(scopedStats.edition)) {
      return [scopedStats.edition];
    }
    return [];
  }

  function contextParams() {
    var params = new URLSearchParams();
    var gender = resolveGender();
    var editions = getSelectedEditions();
    if (gender) params.set("gender", gender);
    if (editions.length > 1) {
      params.set("editions", editions.join(","));
    } else if (editions.length === 1) {
      params.set("edition", editions[0]);
    }
    var tournament = C.queryParam("tournament");
    var season = C.queryParam("season");
    var slug = C.queryParam("t");
    if (tournament && season) {
      params.set("tournament", tournament);
      params.set("season", season);
    } else if (slug) {
      params.set("t", slug);
    }
    var board = C.queryParam("board");
    if (board) params.set("board", board);
    return params;
  }

  function statsBackUrl() {
    var params = contextParams();
    var board = C.queryParam("board");
    if (board) params.set("board", board);
    return "/stats.html?" + params.toString();
  }

  function playerUrl(playerId) {
    var params = contextParams();
    params.set("player", playerId);
    return "/player.html?" + params.toString();
  }

  function playersSearchBackUrl() {
    return "/players.html?" + contextParams().toString();
  }

  function initBackLink() {
    qs("backLink").href = playersSearchBackUrl();
    qs("backLink").textContent = "← Back to player search";
  }

  function formatProfileMeta(profile) {
    var gender = profile.gender || "";
    if (profile.merged && profile.editions && profile.editions.length) {
      var labels = profile.editions.map(formatEditionLabel);
      if (labels.length > 3) {
        return gender + " · " + labels.length + " seasons (" + labels.slice(0, 2).join(", ") + ", …)";
      }
      return gender + " · " + labels.join(", ");
    }
    return (gender || "") + " · " + (profile.edition || "");
  }

  function statCards(items) {
    return '<div class="stat-grid">' + items.map(function (item) {
      if (item.value == null || item.value === "") return "";
      return '<div class="stat-card"><b>' + C.escapeHtml(C.formatStat(item.value)) +
        '</b><span>' + C.escapeHtml(item.label) + "</span></div>";
    }).join("") + "</div>";
  }

  function renderSection(title, items) {
    var visible = items.filter(function (i) { return i.value != null && i.value !== ""; });
    if (!visible.length) return "";
    return '<section class="section"><h2>' + C.escapeHtml(title) + "</h2>" + statCards(items) + "</section>";
  }

  function renderProfile(profile) {
    qs("profileRoot").classList.remove("hidden");
    qs("playerName").textContent = profile.name || "Player";
    qs("playerTeam").textContent = profile.merged
      ? ""
      : (profile.team ? "🏏 " + profile.team : "");
    qs("profileMeta").textContent = formatProfileMeta(profile);
    document.title = (profile.name || "Player") + " — Crickipedia";

    var html = "";
    if (profile.batting) {
      var b = profile.batting;
      html += renderSection("Batting", [
        { label: "Runs", value: b.runs },
        { label: "Matches", value: b.matches },
        { label: "Innings", value: b.innings },
        { label: "Average", value: b.average },
        { label: "Strike rate", value: b.strikeRate },
        { label: "Highest", value: b.highest },
        { label: "Balls", value: b.balls },
        { label: "4s", value: b.fours },
        { label: "6s", value: b.sixes },
        { label: "50s", value: b.fifties },
        { label: "100s", value: b.hundreds }
      ]);
    }
    if (profile.bowling) {
      var w = profile.bowling;
      html += renderSection("Bowling", [
        { label: "Wickets", value: w.wickets },
        { label: "Matches", value: w.matches },
        { label: "Overs", value: w.overs },
        { label: "Economy", value: w.economy },
        { label: "Average", value: w.average },
        { label: "Best", value: w.best },
        { label: "Dot balls", value: w.dotBalls },
        { label: "Maidens", value: w.maidens }
      ]);
      if (w.style) {
        html += '<p class="muted">Bowling: ' + C.escapeHtml(w.style) + "</p>";
      }
    }
    if (profile.fielding) {
      var f = profile.fielding;
      html += renderSection("Fielding", [
        { label: "Dismissals", value: f.dismissals },
        { label: "Catches", value: f.totalCatches },
        { label: "Run outs", value: f.runOuts },
        { label: "Stumpings", value: f.stumpings },
        { label: "Matches", value: f.matches }
      ]);
    }
    if (profile.mvp) {
      var m = profile.mvp;
      html += renderSection("MVP points", [
        { label: "Total", value: m.total },
        { label: "Batting pts", value: m.batting },
        { label: "Bowling pts", value: m.bowling },
        { label: "Fielding pts", value: m.fielding },
        { label: "Matches", value: m.matches }
      ]);
    }
    if (!html) {
      html = '<p class="muted">No stat rows found for this player in the selected season data.</p>';
    }
    qs("sections").innerHTML = html;
  }

  function syncUrl(playerId) {
    if (playerId) {
      history.replaceState(null, "", playerUrl(playerId));
    }
    initBackLink();
  }

  function loadProfile(playerId) {
    var gender = resolveGender();
    var editions = getSelectedEditions();
    if (!gender || !editions.length || !playerId) {
      qs("loadError").textContent = "Missing gender, season selection, or player in the URL.";
      qs("loadError").classList.remove("hidden");
      return Promise.resolve();
    }
    qs("loadError").classList.add("hidden");
    var request = editions.length > 1
      ? C.api.statsPlayerMerged(gender, editions, playerId)
      : C.api.statsPlayer(gender, editions[0], playerId);
    return request.then(function (profile) {
      renderProfile(profile);
      syncUrl(playerId);
    }).catch(function (err) {
      qs("profileRoot").classList.add("hidden");
      qs("loadError").textContent = err.message || "Could not load player profile";
      qs("loadError").classList.remove("hidden");
    });
  }

  function loadPlayersList(selectedId) {
    var gender = resolveGender();
    var editions = getSelectedEditions();
    if (!gender || !editions.length) return Promise.resolve();
    var request = editions.length > 1
      ? C.api.statsMergedPlayers(gender, editions)
      : C.api.statsPlayers(gender, editions[0]);
    return request.then(function (data) {
      fillPlayerPick(data.players || [], selectedId);
    });
  }

  function fillPlayerPick(players, selectedId) {
    var sel = qs("playerPick");
    if (!players.length) {
      qs("pickPanel").classList.add("hidden");
      return;
    }
    sel.innerHTML = players.map(function (p) {
      return '<option value="' + C.escapeHtml(p.playerId) + '">' +
        C.escapeHtml(p.name) + "</option>";
    }).join("");
    if (selectedId && players.some(function (p) { return p.playerId === selectedId; })) {
      sel.value = selectedId;
    }
    qs("pickPanel").classList.remove("hidden");
    if (!playerPickBound) {
      playerPickBound = true;
      sel.addEventListener("change", function () {
        loadProfile(sel.value);
      });
    }
  }

  function seasonCheckboxHtml(s, initialSet) {
    var checked = initialSet[s.edition] ? " checked" : "";
    var label = s.label || formatEditionLabel(s.edition);
    return '<label class="check"><input type="checkbox" data-edition="' + C.escapeHtml(s.edition) + '"' +
      checked + "> <span>" + C.escapeHtml(label) + "</span></label>";
  }

  function onSeasonSelectionChanged() {
    var playerId = C.queryParam("player") || qs("playerPick").value;
    loadPlayersList(playerId).then(function () {
      if (playerId) loadProfile(playerId);
    });
  }

  function renderSeasonChecks(initialEditions) {
    var panel = qs("playerSeasonsPanel");
    var box = qs("playerSeasonChecks");
    var gender = resolveGender();
    var seasons = seasonsForPicker(gender);
    if (!shouldShowSeasonPanel(gender) || !panel || !box) {
      if (panel) panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    var leagueId = scopedStats && scopedStats.leagueId;
    var title = qs("playerSeasonsTitle");
    if (title) {
      title.textContent = leagueId === "celebria"
        ? "CPL & CGL seasons"
        : (leagueId ? "Seasons in league" : "Seasons");
    }
    var hint = qs("playerSeasonsHint");
    if (hint && leagueId === "celebria") {
      hint.textContent = "Celebria includes CPL (Premier League) and CGL (Ganpati League). Select any mix to combine this player’s career stats.";
    } else if (hint) {
      hint.textContent = "Select one or more seasons to combine this player’s stats.";
    }
    var initialSet = {};
    var fromUrl = sanitizeEditionList(initialEditions || []);
    var seedEditions;
    if (fromUrl.length) {
      seedEditions = fromUrl.slice().sort(compareEditionKeys);
    } else {
      seedEditions = seasons.map(function (s) { return s.edition; });
    }
    seedEditions.forEach(function (e) {
      initialSet[e] = true;
    });
    var html = '<label class="check"><input type="checkbox" data-select-all> <span>All seasons</span></label>';
    if (leagueId === "celebria") {
      var groups = groupSeasonsForDisplay(seasons);
      if (groups.cpl.length) {
        html += '<span class="muted" style="font-size:12px;font-weight:800;width:100%;margin-top:6px">CPL</span>';
        groups.cpl.forEach(function (s) { html += seasonCheckboxHtml(s, initialSet); });
      }
      if (groups.cgl.length) {
        html += '<span class="muted" style="font-size:12px;font-weight:800;width:100%;margin-top:6px">CGL</span>';
        groups.cgl.forEach(function (s) { html += seasonCheckboxHtml(s, initialSet); });
      }
      groups.other.forEach(function (s) { html += seasonCheckboxHtml(s, initialSet); });
    } else {
      seasons.forEach(function (s) { html += seasonCheckboxHtml(s, initialSet); });
    }
    box.innerHTML = html;
    var allInput = box.querySelector("[data-select-all]");
    function syncAll() {
      var inputs = box.querySelectorAll("input[data-edition]");
      var allOn = inputs.length && Array.prototype.every.call(inputs, function (i) { return i.checked; });
      if (allInput) allInput.checked = allOn;
    }
    if (allInput) {
      allInput.addEventListener("change", function () {
        var on = allInput.checked;
        box.querySelectorAll("input[data-edition]").forEach(function (input) {
          input.checked = on;
        });
        onSeasonSelectionChanged();
      });
    }
    box.querySelectorAll("input[data-edition]").forEach(function (input) {
      input.addEventListener("change", function () {
        syncAll();
        onSeasonSelectionChanged();
      });
    });
    syncAll();
  }

  function boot() {
    initBackLink();
    C.initUiThemeToggle();
    var playerId = C.queryParam("player");
    var urlEditions = parseEditionsFromUrl();

    C.fetchTournamentForQueryContext({ noCache: true }).then(function (tournament) {
      scopedStats = C.scopedLeaderboardStats(tournament);
      var chain = Promise.resolve();
      if (scopedStats && scopedStats.leagueId) {
        chain = C.api.statsLeague(scopedStats.leagueId).then(function (data) {
          leagueSeasons = data.seasons || [];
        });
      }
      return chain.then(function () {
        return C.api.statsManifest();
      });
    }).then(function (data) {
      manifest = data;
      if (hasStatsLeague()) mergeLeagueSeasonsFromManifest();
      renderSeasonChecks(urlEditions.length ? urlEditions : null);
      var editions = getSelectedEditions();
      if (!resolveGender() || !editions.length) {
        qs("loadError").textContent = "Open a player from the season stats table, or add ?gender=&edition=&player= to the URL.";
        qs("loadError").classList.remove("hidden");
        return;
      }
      return loadPlayersList(playerId).then(function () {
        if (playerId) return loadProfile(playerId);
        var sel = qs("playerPick");
        if (sel && sel.value) return loadProfile(sel.value);
        qs("loadError").textContent = "No players in the selected season data yet.";
        qs("loadError").classList.remove("hidden");
      });
    }).catch(function (err) {
      qs("loadError").textContent = err.message || "Could not load player data";
      qs("loadError").classList.remove("hidden");
    });
  }

  boot();
})();
