(function () {
  var C = window.Crickipedia;
  var manifest = null;
  var manifestVersion = "";
  var bundleCache = {};
  var chartInstances = [];
  var currentBoard = "batting";
  var pollTimer = null;
  var chartJsPromise = null;

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
      return d.gender + "/" + d.edition + "/" + d.board + ":" + d.v;
    }).join("|");
  }

  function editionsForGender(gender) {
    if (!manifest || !manifest.editions || !manifest.editions[gender]) return [];
    return Object.keys(manifest.editions[gender]).sort();
  }

  function boardsForSelection(gender, edition) {
    if (!manifest || !manifest.editions || !manifest.editions[gender]) return [];
    var list = manifest.editions[gender][edition] || [];
    return list.slice().sort(function (a, b) {
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
    link.href = C.playersSearchUrl(qs("gender").value, qs("edition").value, contextParamsObject());
  }

  function syncUrl() {
    var gender = qs("gender").value;
    var edition = qs("edition").value;
    var params = tournamentContextParams();
    params.set("gender", gender);
    params.set("edition", edition);
    if (currentBoard) params.set("board", currentBoard);
    history.replaceState(null, "", "?" + params.toString());
    updatePlayersSearchLink();
  }

  function initTournamentContext() {
    var back = qs("backLink");
    var tournament = C.queryParam("tournament");
    var season = C.queryParam("season");
    var slug = C.queryParam("t");
    if (tournament && season) {
      back.href = "/" + encodeURIComponent(tournament) + "/" + encodeURIComponent(season);
      back.textContent = "← Back to tournament";
      C.api.config({ tournamentSlug: tournament, seasonSlug: season }).then(function (data) {
        if (data.tournament && data.tournament.name) {
          qs("pageTitle").textContent = data.tournament.name + " — stats";
          document.title = data.tournament.name + " stats — Crickipedia";
        }
      }).catch(function () { /* ignore */ });
      return;
    }
    if (slug) {
      back.href = C.publicUrl({ slug: slug });
      back.textContent = "← Back to tournament";
      C.api.config({ slug: slug }).then(function (data) {
        if (data.tournament && data.tournament.name) {
          qs("pageTitle").textContent = data.tournament.name + " — stats";
          document.title = data.tournament.name + " stats — Crickipedia";
        }
      }).catch(function () { /* ignore */ });
      return;
    }
    back.href = "/";
    back.textContent = "← Crickipedia home";
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

  function renderBoardTabs() {
    var gender = qs("gender").value;
    var edition = qs("edition").value;
    var boards = boardsForSelection(gender, edition);
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
        var chart = new window.Chart(ctx, {
          type: "bar",
          data: {
            labels: spec.labels,
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
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: function (ctx) {
                    return statTooltipLabel(ctx.label, ctx.parsed.x, spec.unit);
                  }
                }
              }
            },
            scales: {
              x: {
                beginAtZero: true,
                ticks: { callback: statAxisTick }
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
    var edition = qs("edition").value;
    var linkExtra = {};
    tournamentContextParams().forEach(function (value, key) {
      linkExtra[key] = value;
    });
    linkExtra.board = currentBoard;
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

  function cacheKey(gender, edition, board) {
    return gender + "|" + edition + "|" + board;
  }

  function loadBoard(force) {
    var gender = qs("gender").value;
    var edition = qs("edition").value;
    var board = currentBoard;
    var key = cacheKey(gender, edition, board);
    var entry = (manifest.datasets || []).find(function (d) {
      return d.gender === gender && d.edition === edition && d.board === board;
    });
    qs("loadError").classList.add("hidden");
    if (!entry) {
      destroyCharts();
      qs("chartGrid").innerHTML = '<p class="muted">No CSV uploaded for this board yet.</p>';
      qs("tableHead").innerHTML = "";
      qs("tableBody").innerHTML = "";
      qs("freshness").textContent = "";
      return Promise.resolve();
    }
    var cached = bundleCache[key];
    if (!force && cached && cached.v === entry.v) {
      renderCharts(cached.bundle);
      renderTable(cached.bundle);
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
    fillEditionSelect();
    renderBoardTabs();
    if (initial) {
      var g = C.queryParam("gender");
      var e = C.queryParam("edition");
      var b = C.queryParam("board");
      if (g && qs("gender").querySelector('option[value="' + g + '"]')) qs("gender").value = g;
      fillEditionSelect();
      if (e && editionsForGender(qs("gender").value).indexOf(e) >= 0) qs("edition").value = e;
      if (b) currentBoard = b;
      renderBoardTabs();
    }
    if (changed || initial) {
      bundleCache = {};
      loadBoard(true);
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

  initTournamentContext();
  C.initUiThemeToggle();
  refreshManifest(true).then(startPolling);
})();
