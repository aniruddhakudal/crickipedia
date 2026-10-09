(function () {
  var C = window.Crickipedia;

  function qs(id) {
    return document.getElementById(id);
  }

  function contextParams() {
    var params = new URLSearchParams();
    var gender = C.queryParam("gender");
    var edition = C.queryParam("edition");
    var tournament = C.queryParam("tournament");
    var season = C.queryParam("season");
    var slug = C.queryParam("t");
    if (gender) params.set("gender", gender);
    if (edition) params.set("edition", edition);
    if (tournament && season) {
      params.set("tournament", tournament);
      params.set("season", season);
    } else if (slug) {
      params.set("t", slug);
    }
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
    qs("playerTeam").textContent = profile.team ? "🏏 " + profile.team : "";
    qs("profileMeta").textContent = (profile.gender || "") + " · " + (profile.edition || "");
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
      html = '<p class="muted">No stat rows found for this player in the current season data.</p>';
    }
    qs("sections").innerHTML = html;
  }

  function loadProfile(playerId) {
    var gender = C.queryParam("gender");
    var edition = C.queryParam("edition");
    if (!gender || !edition || !playerId) {
      qs("loadError").textContent = "Missing gender, edition, or player in the URL.";
      qs("loadError").classList.remove("hidden");
      return Promise.resolve();
    }
    qs("loadError").classList.add("hidden");
    return C.api.statsPlayer(gender, edition, playerId).then(function (profile) {
      renderProfile(profile);
      history.replaceState(null, "", playerUrl(playerId));
    }).catch(function (err) {
      qs("profileRoot").classList.add("hidden");
      qs("loadError").textContent = err.message || "Could not load player profile";
      qs("loadError").classList.remove("hidden");
    });
  }

  function fillPlayerPick(players, selectedId) {
    var sel = qs("playerPick");
    sel.innerHTML = players.map(function (p) {
      return '<option value="' + C.escapeHtml(p.playerId) + '">' +
        C.escapeHtml(p.name + (p.team ? " · " + p.team : "")) + "</option>";
    }).join("");
    if (selectedId && players.some(function (p) { return p.playerId === selectedId; })) {
      sel.value = selectedId;
    }
    qs("pickPanel").classList.remove("hidden");
    sel.addEventListener("change", function () {
      loadProfile(sel.value);
    });
  }

  function boot() {
    initBackLink();
    C.initUiThemeToggle();
    var gender = C.queryParam("gender");
    var edition = C.queryParam("edition");
    var playerId = C.queryParam("player");
    if (!gender || !edition) {
      qs("loadError").textContent = "Open a player from the season stats table, or add ?gender=&edition=&player= to the URL.";
      qs("loadError").classList.remove("hidden");
      return;
    }
    C.api.statsPlayers(gender, edition).then(function (data) {
      var players = data.players || [];
      if (players.length) fillPlayerPick(players, playerId);
      if (playerId) loadProfile(playerId);
      else if (players.length) loadProfile(players[0].playerId);
      else {
        qs("loadError").textContent = "No players in this season data yet.";
        qs("loadError").classList.remove("hidden");
      }
    }).catch(function (err) {
      qs("loadError").textContent = err.message || "Could not load players";
      qs("loadError").classList.remove("hidden");
    });
  }

  boot();
})();
