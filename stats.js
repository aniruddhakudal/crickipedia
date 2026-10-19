(function () {
  var C = window.Crickipedia;
  var manifest = null;
  var manifestVersion = "";
  var bundleCache = {};
  var chartInstances = [];
  var currentBoard = "batting";
  var pollTimer = null;
  var chartJsPromise = null;
  var scopedStats = null;
  var leagueSeasons = [];

  var BOARD_LABELS = {
    batting: "Batting",
    bowling: "Bowling",
    fielding: "Fielding",
    mvp: "MVP"
  };

  function qs(id) {
    return document.getElementById(id);
  }

  function manifestFingerprint(data) {
    return (data.datasets || []).map(function (d) {
      return (d.store || "shankeshwaram") + "/" + d.gender + "/" + d.edition + "/" + d.board + ":" + d.v;
    }).join("|");
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

  function seasonCheckboxHtml(s, initialSet) {
    var checked = initialSet[s.edition] ? " checked" : "";
    var label = formatEditionLabel(s.edition);
    return '<label class="check"><input type="checkbox" data-edition="' + C.escapeHtml(s.edition) + '"' +
      checked + "> <span>" + C.escapeHtml(label) + "</span></label>";
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
            label: formatEditionLabel(edition),
            registrationName: fromDb[key].label,
            tournamentSlug: fromDb[key].tournamentSlug,
            seasonSlug: fromDb[key].seasonSlug,
            slug: fromDb[key].slug
          });
        } else {
          merged.push({
            edition: edition,
            gender: gender,
            label: formatEditionLabel(edition),
            tournamentSlug: "",
            seasonSlug: "",
            slug: ""
          });
        }
      });
    });
    leagueSeasons = sortSeasonEntries(merged);
  }

  function updateLeagueSubtitle() {
    var sub = qs("subtitle");
    if (!sub || !hasStatsLeague()) return;
    var picked = getSelectedEditions();
    if (picked.length > 1) {
      sub.textContent = "Combined career stats across " + picked.length + " seasons: " + picked.join(", ") + ".";
    } else if (picked.length === 1) {
      sub.textContent = "Single season “" + picked[0] + "”. Tick more seasons below to combine leaderboards.";
    } else {
      sub.textContent = "Pick one or more seasons below to view or combine stats.";
    }
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

  function tournamentEditionFromLeagueList() {
    var tournament = C.queryParam("tournament");
    var season = C.queryParam("season");
    if (!tournament || !season || !leagueSeasons.length) return "";
    for (var i = 0; i < leagueSeasons.length; i++) {
      var s = leagueSeasons[i];
      if (s.tournamentSlug === tournament && s.seasonSlug === season) return s.edition || "";
    }
    return "";
  }

  function resolveConfiguredEdition() {
    if (!scopedStats) return "";
    var leagueId = scopedStats.leagueId || "";
    var gender = scopedStats.gender;
    var edition = scopedStats.edition || "";
    if (isInvalidEditionParam(edition)) {
      edition = tournamentEditionFromLeagueList();
    }
    if (edition && editionHasAnyData(gender, edition, leagueId)) return edition;
    var fromList = tournamentEditionFromLeagueList();
    if (fromList && editionHasAnyData(gender, fromList, leagueId)) return fromList;
    return edition;
  }

  function reconcileScopedEdition() {
    if (!scopedStats) return;
    var fixed = resolveConfiguredEdition();
    if (fixed) scopedStats.edition = fixed;
  }

  function parseEditionsFromUrl() {
    var multi = C.queryParam("editions");
    if (multi) {
      return sanitizeEditionList(multi.split(",").map(function (s) { return s.trim(); }).filter(Boolean));
    }
    var single = C.queryParam("edition");
    return single ? sanitizeEditionList([single]) : [];
  }

  function getSelectedEditions() {
    if (hasStatsLeague()) {
      var panel = qs("leagueSeasonChecks");
      var fallback = resolveConfiguredEdition();
      if (!panel) return fallback ? [fallback] : [];
      var picked = [];
      panel.querySelectorAll("input[data-edition]:checked").forEach(function (input) {
        picked.push(input.getAttribute("data-edition"));
      });
      picked = sanitizeEditionList(picked);
      return picked.length ? picked : (fallback ? [fallback] : []);
    }
    var ed = qs("edition").value;
    if (isInvalidEditionParam(ed)) ed = resolveConfiguredEdition();
    return ed ? [ed] : [];
  }

  function editionsForGender(gender) {
    if (!manifest || !manifest.editions || !manifest.editions[gender]) return [];
    return Object.keys(manifest.editions[gender]).sort();
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

  function editionHasAnyData(gender, edition, leagueId) {
    if (!edition) return false;
    var store = dataStoreForLeagueId(leagueId);
    if (store && manifest && manifest.datasets) {
      return manifest.datasets.some(function (d) {
        return d.gender === gender && d.edition === edition && d.store === store;
      });
    }
    return editionsForGender(gender).indexOf(edition) >= 0;
  }

  function showEditionConfigError(message) {
    var el = qs("loadError");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("hidden");
    destroyCharts();
    qs("chartGrid").innerHTML = '<p class="muted">' + C.escapeHtml(message) + "</p>";
    qs("tableHead").innerHTML = "";
    qs("tableBody").innerHTML = "";
    qs("freshness").textContent = "";
  }

  function validateScopedEdition() {
    reconcileScopedEdition();
    if (!scopedStats || !scopedStats.edition) return;
    var gender = scopedStats.gender;
    var edition = resolveConfiguredEdition();
    var leagueId = scopedStats.leagueId || "";
    if (editionHasAnyData(gender, edition, leagueId)) {
      qs("loadError").classList.add("hidden");
      return;
    }
    var available = leagueId ? editionsForLeague(gender, leagueId) : editionsForGender(gender);
    var listText = available.length ? available.join(", ") : "(none on this server)";
    var example = leagueId === "celebria" ? "cpl9" : (leagueId === "srpl" ? "srpl2" : (available[0] || "cpl1"));
    if (leagueId && edition === leagueId) {
      showEditionConfigError(
        "Data edition is set to \"" + edition + "\", which is the stats league ID—not a CSV folder. " +
        "In Admin → Customize for this tournament: Stats league ID = \"" + leagueId + "\"; Data edition = a folder " +
        "under data/" + (dataStoreForLeagueId(leagueId) || leagueId) + "/" + gender + "/ (e.g. " + example + "). " +
        "Folders on this server for that league: " + listText + "."
      );
      return;
    }
    showEditionConfigError(
      "No leaderboard CSVs for data edition \"" + edition + "\" (" + gender + "). " +
      "Update Admin → Customize → Data edition, or upload CSVs for that folder. " +
      (leagueId ? "For league \"" + leagueId + "\": " : "Available: ") + listText + "."
    );
  }

  function boardsForSelection(gender, editions) {
    if (!manifest || !manifest.editions || !manifest.editions[gender]) return [];
    var editionList = editions && editions.length ? editions : [""];
    var set = {};
    editionList.forEach(function (edition) {
      (manifest.editions[gender][edition] || []).forEach(function (board) {
        set[board] = true;
      });
    });
    return Object.keys(set).sort(function (a, b) {
      var order = ["batting", "bowling", "fielding", "mvp"];
      return order.indexOf(a) - order.indexOf(b);
    });
  }

  function tournamentContextParams() {
    var params = new URLSearchParams();
    var tournament = C.queryParam("tournament");
    var season = C.queryParam("season");
    var slug = C.queryParam("t");
    if (tournament && season) {
      params.set("tournament", tournament);
      params.set("season", season);
    } else if (slug) {
      params.set("t", slug);
    }
    return params;
  }

  function contextParamsObject() {
    var out = {};
    tournamentContextParams().forEach(function (value, key) {
      out[key] = value;
    });
    return out;
  }

  function updatePlayersSearchLink() {
    var link = qs("playersSearchLink");
    if (!link) return;
    var extra = contextParamsObject();
    var editions = getSelectedEditions();
    if (editions.length > 1) extra.editions = editions.join(",");
    link.href = C.playersSearchUrl(qs("gender").value, editions[0] || "", extra);
  }

  function syncUrl() {
    var gender = qs("gender").value;
    var editions = getSelectedEditions();
    var params = tournamentContextParams();
    params.set("gender", gender);
    if (editions.length > 1) {
      params.set("editions", editions.join(","));
      params.delete("edition");
    } else if (editions.length === 1) {
      params.set("edition", editions[0]);
      params.delete("editions");
    }
    if (currentBoard) params.set("board", currentBoard);
    history.replaceState(null, "", "?" + params.toString());
    updatePlayersSearchLink();
    updateLeagueSubtitle();
  }

  function renderLeagueSeasonChecks(initialEditions) {
    var panel = qs("leagueSeasonsPanel");
    var box = qs("leagueSeasonChecks");
    if (!panel || !box) return;
    var gender = qs("gender").value;
    var seasons = leagueSeasonsForGender(gender);
    if (!hasStatsLeague() || !seasons.length) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    var title = qs("leagueSeasonsTitle");
    var leagueId = scopedStats.leagueId || "";
    if (title) {
      title.textContent = leagueId === "celebria"
        ? "CPL & CGL seasons (celebria)"
        : "Seasons in league “" + leagueId + "”";
    }
    var hint = qs("leagueSeasonsHint");
    if (hint && leagueId === "celebria") {
      hint.textContent = "Celebria includes Celebria Premier League (CPL) and Celebria Ganpati League (CGL). Select any mix to view or combine.";
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
        renderBoardTabs();
        syncUrl();
        loadBoard(false);
      });
    }
    box.querySelectorAll("input[data-edition]").forEach(function (input) {
      input.addEventListener("change", function () {
        syncAll();
        renderBoardTabs();
        syncUrl();
        loadBoard(false);
      });
    });
    syncAll();
    updateLeagueSubtitle();
  }

  function applyScopedControls() {
    var controls = document.querySelector(".controls");
    var editionLabel = qs("editionSingleLabel");
    var genderSelect = qs("gender");
    if (hasStatsLeague()) {
      if (controls) controls.classList.remove("hidden");
      if (editionLabel) editionLabel.classList.add("hidden");
      qs("gender").value = scopedStats.gender;
      if (genderSelect) genderSelect.disabled = true;
      updateLeagueSubtitle();
      return;
    }
    if (editionLabel) editionLabel.classList.remove("hidden");
    var leaguePanel = qs("leagueSeasonsPanel");
    if (leaguePanel) leaguePanel.classList.add("hidden");
    if (genderSelect) genderSelect.disabled = false;
    if (!isStatsScopedToTournament()) {
      if (controls) controls.classList.remove("hidden");
      return;
    }
    qs("gender").value = scopedStats.gender;
    if (controls) controls.classList.add("hidden");
    var sub = qs("subtitle");
    if (sub) {
      sub.textContent = "Leaderboards for " + (scopedStats.gender === "women" ? "women" : "men") +
        " · data edition “" + scopedStats.edition + "”.";
    }
  }

  function initTournamentContext(tournament) {
    var back = qs("backLink");
    var tournamentParam = C.queryParam("tournament");
    var season = C.queryParam("season");
    var slug = C.queryParam("t");
    if (tournamentParam && season) {
      back.href = "/" + encodeURIComponent(tournamentParam) + "/" + encodeURIComponent(season);
      back.textContent = "← Back to tournament";
    } else if (slug) {
      back.href = C.publicUrl({ slug: slug });
      back.textContent = "← Back to tournament";
    } else {
      back.href = "/";
      back.textContent = "← Crickipedia home";
    }
    if (tournament && tournament.name) {
      var leagueId = scopedStats && scopedStats.leagueId;
      if (leagueId) {
        var leagueLabel = leagueId.charAt(0).toUpperCase() + leagueId.slice(1) + " league";
        qs("pageTitle").textContent = leagueLabel;
        document.title = leagueLabel + " — Crickipedia";
      } else {
        qs("pageTitle").textContent = tournament.name + " — stats";
        document.title = tournament.name + " stats — Crickipedia";
      }
    }
    applyScopedControls();
  }

  function fillEditionSelect() {
    var gender = qs("gender").value;
    var editions;
    if (hasStatsLeague()) {
      editions = leagueSeasonsForGender(gender).map(function (s) { return s.edition; });
    } else if (isStatsScopedToTournament()) {
      editions = [scopedStats.edition];
    } else {
      editions = editionsForGender(gender);
    }
    var sel = qs("edition");
    var prev = sel.value;
    sel.innerHTML = editions.map(function (ed) {
      return '<option value="' + C.escapeHtml(ed) + '">' + C.escapeHtml(ed.toUpperCase()) + "</option>";
    }).join("");
    if (hasStatsLeague() && scopedStats.edition && editions.indexOf(scopedStats.edition) >= 0) {
      sel.value = scopedStats.edition;
    } else if (isStatsScopedToTournament()) {
      sel.value = scopedStats.edition;
    } else if (editions.indexOf(prev) >= 0) {
      sel.value = prev;
    } else if (editions.length) {
      sel.value = editions[editions.length - 1];
    }
  }

  function renderBoardTabs() {
    var gender = qs("gender").value;
    var editions = getSelectedEditions();
    var boards = boardsForSelection(gender, editions);
    if (boards.indexOf(currentBoard) < 0) currentBoard = boards[0] || "batting";
    var root = qs("boardTabs");
    root.innerHTML = boards.map(function (board) {
      var on = board === currentBoard ? " on" : "";
      return '<button type="button" class="tab' + on + '" data-board="' + board + '">' +
        C.escapeHtml(BOARD_LABELS[board] || board) + "</button>";
    }).join("");
    root.querySelectorAll("[data-board]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        currentBoard = btn.getAttribute("data-board");
        renderBoardTabs();
        syncUrl();
        loadBoard(false);
      });
    });
  }

  function destroyCharts() {
    chartInstances.forEach(function (ch) {
      try { ch.destroy(); } catch (_) { /* ignore */ }
    });
    chartInstances = [];
  }

  function loadChartJs() {
    if (window.Chart) return Promise.resolve();
    if (chartJsPromise) return chartJsPromise;
    chartJsPromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js";
      script.async = true;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error("Could not load charts")); };
      document.head.appendChild(script);
    });
    return chartJsPromise;
  }

  function chartColors() {
    var green = getComputedStyle(document.documentElement).getPropertyValue("--green").trim() || "#0b6b45";
    var gold = getComputedStyle(document.documentElement).getPropertyValue("--gold").trim() || "#d4a017";
    return { green: green, gold: gold };
  }

  function statAxisTick(value) {
    return C.formatStat(value);
  }

  function statTooltipLabel(label, value, unit) {
    var suffix = unit ? " " + unit : "";
    return label + ": " + C.formatStat(value) + suffix;
  }

  function piePalette(count, colors) {
    var extras = ["#5a8f7b", "#2d8a5e", "#6b9080", "#1a4d32", "#8b6914", "#3d9970", "#a67c00", "#4a7c59"];
    var list = [colors.green, colors.gold].concat(extras);
    var out = [];
    for (var i = 0; i < count; i += 1) {
      out.push(list[i % list.length]);
    }
    return out;
  }

  function renderCharts(bundle) {
    destroyCharts();
    var grid = qs("chartGrid");
    grid.innerHTML = "";
    if (!bundle || !bundle.charts || !bundle.charts.length) {
      grid.innerHTML = '<p class="muted">No chart data for this board.</p>';
      return;
    }
    return loadChartJs().then(function () {
      var colors = chartColors();
      bundle.charts.forEach(function (spec, index) {
        var box = document.createElement("div");
        box.className = "chart-box" + (spec.type === "pie" ? " chart-box--pie" : "");
        box.innerHTML = "<h3>" + C.escapeHtml(spec.title || spec.id) + '</h3><div class="chart-canvas-wrap"><canvas></canvas></div>';
        grid.appendChild(box);
        var canvas = box.querySelector("canvas");
        var ctx = canvas.getContext("2d");
        if (spec.type === "pie") {
          var pieColors = piePalette((spec.labels || []).length, colors);
          var pieChart = new window.Chart(ctx, {
            type: "pie",
            data: {
              labels: spec.labels,
              datasets: [{
                data: (spec.values || []).map(function (v) { return C.roundStatNumber(v); }),
                backgroundColor: pieColors,
                borderWidth: 1,
                borderColor: "#fff"
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: {
                  callbacks: {
                    label: function (ctx) {
                      var dataset = ctx.dataset.data || [];
                      var total = dataset.reduce(function (a, b) { return a + b; }, 0);
                      var val = ctx.parsed;
                      var pct = total ? C.formatStat((val / total) * 100) : "0";
                      var unit = spec.unit ? " " + spec.unit : "";
                      return ctx.label + ": " + C.formatStat(val) + unit + " (" + pct + "%)";
                    }
                  }
                }
              }
            }
          });
          chartInstances.push(pieChart);
          return;
        }
        if (spec.type === "stacked" && spec.datasets) {
          var chart = new window.Chart(ctx, {
            type: "bar",
            data: {
              labels: spec.labels,
              datasets: spec.datasets.map(function (ds, i) {
                return {
                  label: ds.label,
                  data: ds.values,
                  backgroundColor: i === 0 ? colors.green : i === 1 ? colors.gold : "#5a8f7b",
                  stack: "mvp"
                };
              })
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: "bottom" },
                tooltip: {
                  callbacks: {
                    label: function (ctx) {
                      return statTooltipLabel(ctx.dataset.label, ctx.parsed.y, spec.unit);
                    }
                  }
                }
              },
              scales: {
                x: {
                  stacked: true,
                  ticks: { maxRotation: 45, minRotation: 0, callback: statAxisTick }
                },
                y: { stacked: true, beginAtZero: true }
              }
            }
          });
          chartInstances.push(chart);
          return;
        }
        var chartLabels = (spec.labels || []).slice();
        var chart = new window.Chart(ctx, {
          type: "bar",
          data: {
            labels: chartLabels,
            datasets: [{
              label: spec.unit || "",
              data: (spec.values || []).map(function (v) { return C.roundStatNumber(v); }),
              backgroundColor: index % 2 === 0 ? colors.green : colors.gold,
              borderRadius: 6
            }]
          },
          options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { left: 4, right: 8 } },
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  title: function (items) {
                    var i = items[0] && items[0].dataIndex;
                    return i != null && chartLabels[i] ? chartLabels[i] : "";
                  },
                  label: function (ctx) {
                    var suffix = spec.unit ? " " + spec.unit : "";
                    return C.formatStat(ctx.parsed.x) + suffix;
                  }
                }
              }
            },
            scales: {
              x: {
                beginAtZero: true,
                ticks: { callback: statAxisTick }
              },
              y: {
                ticks: {
                  autoSkip: false,
                  font: { size: 11 },
                  callback: function (_value, index) {
                    var line = chartLabels[index];
                    if (!line) return "";
                    var paren = line.match(/^(.+?)\s+(\([^)]+\))\s*$/);
                    if (paren) return [paren[1], paren[2]];
                    return line;
                  }
                },
                afterFit: function (scale) {
                  scale.width = Math.max(scale.width, 148);
                }
              }
            }
          }
        });
        chartInstances.push(chart);
      });
    }).catch(function (err) {
      grid.innerHTML = '<p class="error">' + C.escapeHtml(err.message || "Charts failed to load") + "</p>";
    });
  }

  function renderTable(bundle) {
    var head = qs("tableHead");
    var body = qs("tableBody");
    if (!bundle || !bundle.table || !bundle.table.length) {
      head.innerHTML = "";
      body.innerHTML = '<tr><td class="muted">No rows</td></tr>';
      return;
    }
    var board = bundle.board;
    var cols;
    if (board === "batting") {
      cols = [
        { key: "name", label: "Player" },
        { key: "team", label: "Team" },
        { key: "matches", label: "M" },
        { key: "runs", label: "Runs" },
        { key: "average", label: "Avg" },
        { key: "strikeRate", label: "SR" },
        { key: "sixes", label: "6s" }
      ];
    } else if (board === "bowling") {
      cols = [
        { key: "name", label: "Player" },
        { key: "team", label: "Team" },
        { key: "matches", label: "M" },
        { key: "wickets", label: "Wkts" },
        { key: "economy", label: "Econ" },
        { key: "overs", label: "Overs" }
      ];
    } else if (board === "fielding") {
      cols = [
        { key: "name", label: "Player" },
        { key: "team", label: "Team" },
        { key: "matches", label: "M" },
        { key: "dismissals", label: "Dismissals" },
        { key: "catches", label: "Catches" }
      ];
    } else {
      cols = [
        { key: "name", label: "Player" },
        { key: "team", label: "Team" },
        { key: "matches", label: "M" },
        { key: "batting", label: "Bat" },
        { key: "bowling", label: "Bowl" },
        { key: "fielding", label: "Field" },
        { key: "total", label: "Total" }
      ];
    }
    head.innerHTML = "<tr>" + cols.map(function (c) {
      return "<th>" + C.escapeHtml(c.label) + "</th>";
    }).join("") + "</tr>";
    var gender = qs("gender").value;
    var editions = getSelectedEditions();
    var edition = editions[0] || qs("edition").value;
    var linkExtra = {};
    tournamentContextParams().forEach(function (value, key) {
      linkExtra[key] = value;
    });
    linkExtra.board = currentBoard;
    if (editions.length > 1) linkExtra.editions = editions.join(",");
    body.innerHTML = bundle.table.map(function (row) {
      return "<tr>" + cols.map(function (c) {
        var val = row[c.key];
        if (c.key === "name" && row.playerId) {
          var href = C.playerProfileUrl(gender, edition, row.playerId, linkExtra);
          var label = val == null || val === "" ? "—" : String(val);
          return '<td><a href="' + C.escapeHtml(href) + '" style="color:var(--green);font-weight:800;text-decoration:none">' +
            C.escapeHtml(label) + "</a></td>";
        }
        if (c.key === "name" || c.key === "team") {
          return "<td>" + C.escapeHtml(val == null || val === "" ? "—" : String(val)) + "</td>";
        }
        return "<td>" + C.escapeHtml(C.formatStat(val)) + "</td>";
      }).join("") + "</tr>";
    }).join("");
  }

  function cacheKey(gender, editions, board) {
    return gender + "|" + editions.join("+") + "|" + board;
  }

  function loadBoard(force) {
    var gender = qs("gender").value;
    var editions = getSelectedEditions();
    var board = currentBoard;
    var key = cacheKey(gender, editions, board);
    qs("loadError").classList.add("hidden");
    if (!editions.length) {
      destroyCharts();
      qs("chartGrid").innerHTML = '<p class="muted">Select at least one season.</p>';
      qs("tableHead").innerHTML = "";
      qs("tableBody").innerHTML = "";
      qs("freshness").textContent = "";
      return Promise.resolve();
    }
    if (editions.length > 1) {
      var cached = bundleCache[key];
      if (!force && cached) {
        renderCharts(cached.bundle);
        renderTable(cached.bundle);
        qs("freshness").textContent = "Combined " + editions.length + " seasons · v" + cached.v +
          " · " + cached.bundle.rowCount + " players";
        return Promise.resolve();
      }
      return C.api.statsMergedBundle(gender, editions, board).then(function (bundle) {
        bundleCache[key] = { v: bundle.v, bundle: bundle };
        renderCharts(bundle);
        renderTable(bundle);
        qs("freshness").textContent = "Combined " + editions.length + " seasons · updated " +
          C.formatDateTime(bundle.updatedAt) + " · v" + bundle.v + " · " + bundle.rowCount + " players";
      }).catch(function (err) {
        qs("loadError").textContent = err.message || "Could not load stats";
        qs("loadError").classList.remove("hidden");
      });
    }
    var edition = editions[0];
    var entry = (manifest.datasets || []).find(function (d) {
      return d.gender === gender && d.edition === edition && d.board === board;
    });
    if (!entry) {
      if (isStatsScopedToTournament() && scopedStats.edition === edition) {
        validateScopedEdition();
      } else {
        destroyCharts();
        qs("chartGrid").innerHTML = '<p class="muted">No CSV uploaded for this board yet.</p>';
        qs("tableHead").innerHTML = "";
        qs("tableBody").innerHTML = "";
        qs("freshness").textContent = "";
      }
      return Promise.resolve();
    }
    var cachedSingle = bundleCache[key];
    if (!force && cachedSingle && cachedSingle.v === entry.v) {
      renderCharts(cachedSingle.bundle);
      renderTable(cachedSingle.bundle);
      qs("freshness").textContent = "Updated " + C.formatDateTime(entry.updatedAt) + " · v" + entry.v;
      return Promise.resolve();
    }
    return C.api.statsBundle(gender, edition, board, entry.v).then(function (bundle) {
      bundleCache[key] = { v: bundle.v, bundle: bundle };
      renderCharts(bundle);
      renderTable(bundle);
      qs("freshness").textContent = "Updated " + C.formatDateTime(bundle.updatedAt) + " · v" + bundle.v +
        " · " + bundle.rowCount + " players";
    }).catch(function (err) {
      qs("loadError").textContent = err.message || "Could not load stats";
      qs("loadError").classList.remove("hidden");
    });
  }

  function applyManifest(data, initial) {
    var nextVersion = manifestFingerprint(data);
    var changed = nextVersion !== manifestVersion;
    manifest = data;
    manifestVersion = nextVersion;
    mergeLeagueSeasonsFromManifest();
    fillEditionSelect();
    renderBoardTabs();
    if (initial) {
      var urlEditions = parseEditionsFromUrl();
      if (isStatsScopedToTournament() || hasStatsLeague()) {
        qs("gender").value = scopedStats.gender;
      } else {
        var g = C.queryParam("gender");
        if (g && qs("gender").querySelector('option[value="' + g + '"]')) qs("gender").value = g;
      }
      fillEditionSelect();
      if (!hasStatsLeague() && !isStatsScopedToTournament()) {
        var e = C.queryParam("edition");
        if (e && editionsForGender(qs("gender").value).indexOf(e) >= 0) qs("edition").value = e;
      } else if (!hasStatsLeague() && urlEditions.length === 1) {
        qs("edition").value = urlEditions[0];
      }
      var b = C.queryParam("board");
      if (b) currentBoard = b;
      applyScopedControls();
      if (hasStatsLeague()) renderLeagueSeasonChecks(urlEditions.length ? urlEditions : null);
      renderBoardTabs();
      if (isStatsScopedToTournament()) validateScopedEdition();
    }
    if (changed || initial) {
      bundleCache = {};
      if (!isStatsScopedToTournament() ||
          editionHasAnyData(scopedStats.gender, resolveConfiguredEdition(), scopedStats.leagueId)) {
        loadBoard(true);
      }
    }
    syncUrl();
  }

  function refreshManifest(initial) {
    return C.api.statsManifest().then(function (data) {
      applyManifest(data, initial);
    }).catch(function (err) {
      qs("loadError").textContent = err.message || "Could not load manifest";
      qs("loadError").classList.remove("hidden");
    });
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      refreshManifest(false);
    }, 60000);
  }

  qs("gender").addEventListener("change", function () {
    fillEditionSelect();
    renderBoardTabs();
    syncUrl();
    loadBoard(false);
  });
  qs("edition").addEventListener("change", function () {
    renderBoardTabs();
    syncUrl();
    loadBoard(false);
  });

  C.initUiThemeToggle();
  C.fetchTournamentForQueryContext({ noCache: true }).then(function (tournament) {
    scopedStats = C.scopedLeaderboardStats(tournament);
    initTournamentContext(tournament);
    if (C.tournamentContextFromQuery() && tournament && !scopedStats) {
      qs("loadError").textContent =
        "Season stats are not configured for this tournament. Set a data edition under Admin → Customize.";
      qs("loadError").classList.remove("hidden");
    }
    if (scopedStats && scopedStats.leagueId) {
      return C.api.statsLeague(scopedStats.leagueId).then(function (data) {
        leagueSeasons = data.seasons || [];
        reconcileScopedEdition();
        return refreshManifest(true);
      });
    }
    return refreshManifest(true);
  }).then(startPolling);
})();
