const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BOARDS = ["batting", "bowling", "fielding", "mvp"];
const GENDERS = ["men", "women"];
const TOP_N = 12;
const CHART_SCHEMA_VERSION = "4";

const SRPL_ROOT = path.join(__dirname, "..", "..", "data", "srpl");
const GENERATED_ROOT = path.join(SRPL_ROOT, "_generated");

const BOARD_FILE_RE = /^(\d+)_(batting|bowling|fielding|mvp)_leaderboard\.csv$/i;

const REQUIRED_HEADERS = {
  batting: ["player_id", "name", "team_name", "total_runs", "strike_rate", "ball_faced", "4s", "6s"],
  bowling: ["player_id", "name", "team_name", "total_wickets", "economy", "overs", "dot_balls"],
  fielding: ["player_id", "name", "team_name", "total_dismissal", "total_catches"],
  mvp: ["Player Name", "Team Name", "Total", "Batting", "Bowling", "Fielding"]
};

function slugKey(value, label) {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!key) {
    throw new Error(`Invalid ${label}`);
  }
  return key;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const normalized = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!normalized) {
    return { headers: [], rows: [] };
  }
  const lines = normalized.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    if (!String(lines[i]).trim()) continue;
    const cells = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] != null ? String(cells[index]).trim() : "";
    });
    rows.push(row);
  }
  return { headers, rows };
}

function num(value) {
  if (value == null || value === "" || value === "-") return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function roundStat(value) {
  const n = num(value);
  if (n == null) return null;
  return Math.round(n * 100) / 100;
}

function validateHeaders(board, headers) {
  const required = REQUIRED_HEADERS[board];
  if (!required) throw new Error("Unknown board type");
  const set = new Set(headers.map((h) => h.trim()));
  const missing = required.filter((col) => !set.has(col));
  if (missing.length) {
    throw new Error(`CSV missing columns: ${missing.join(", ")}`);
  }
}

function hashContent(bufferOrString) {
  return crypto.createHash("sha256").update(bufferOrString).digest("hex").slice(0, 12);
}

function csvDir(gender, edition) {
  return path.join(SRPL_ROOT, gender, edition);
}

function bundlePath(gender, edition, board) {
  return path.join(GENERATED_ROOT, gender, edition, `${board}.json`);
}

function findCsvFile(gender, edition, board) {
  const dir = csvDir(gender, edition);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  const match = files.find((name) => {
    const m = BOARD_FILE_RE.exec(name);
    return m && m[2].toLowerCase() === board;
  });
  return match ? path.join(dir, match) : null;
}

function listCsvSources() {
  const out = [];
  if (!fs.existsSync(SRPL_ROOT)) return out;
  for (const gender of GENDERS) {
    const genderDir = path.join(SRPL_ROOT, gender);
    if (!fs.existsSync(genderDir)) continue;
    for (const edition of fs.readdirSync(genderDir)) {
      if (edition.startsWith("_") || edition.startsWith(".")) continue;
      const editionDir = path.join(genderDir, edition);
      if (!fs.statSync(editionDir).isDirectory()) continue;
      for (const file of fs.readdirSync(editionDir)) {
        const m = BOARD_FILE_RE.exec(file);
        if (!m) continue;
        out.push({
          gender,
          edition,
          board: m[2].toLowerCase(),
          filePath: path.join(editionDir, file),
          fileName: file,
          tournamentId: m[1]
        });
      }
    }
  }
  return out;
}

function topSeries(rows, labelKey, valueKey, options) {
  const opts = options || {};
  const limit = opts.limit != null ? opts.limit : TOP_N;
  const filter = opts.filter || (() => true);
  const desc = opts.desc !== false;
  const picked = rows
    .map((row) => ({
      label: String(row[labelKey] || "").trim() || "—",
      value: num(row[valueKey]),
      row
    }))
    .filter((item) => item.value != null && filter(item.row, item.value))
    .sort((a, b) => (desc ? b.value - a.value : a.value - b.value))
    .slice(0, limit);
  return {
    labels: picked.map((p) => p.label),
    values: picked.map((p) => roundStat(p.value))
  };
}

function buildCharts(board, rows) {
  if (board === "batting") {
    return [
      {
        id: "top_runs",
        title: "Top run scorers",
        type: "bar",
        unit: "runs",
        ...topSeries(rows, "name", "total_runs")
      },
      {
        id: "top_strike_rate",
        title: "Best strike rate (min 20 balls)",
        type: "bar",
        unit: "SR",
        ...topSeries(rows, "name", "strike_rate", {
          filter: (row) => (num(row.ball_faced) || 0) >= 20
        })
      },
      {
        id: "top_sixes",
        title: "Most sixes",
        type: "bar",
        unit: "6s",
        ...topSeries(rows, "name", "6s")
      },
      {
        id: "team_runs",
        title: "Team total runs",
        type: "bar",
        unit: "runs",
        ...teamAggregate(rows, "team_name", "total_runs")
      },
      {
        id: "team_runs_pie",
        title: "Run share by team",
        type: "pie",
        unit: "runs",
        ...teamAggregate(rows, "team_name", "total_runs", null)
      },
      {
        id: "team_sixes_pie",
        title: "Sixes by team",
        type: "pie",
        unit: "6s",
        ...teamAggregate(rows, "team_name", "6s", null)
      }
    ];
  }
  if (board === "bowling") {
    return [
      {
        id: "top_wickets",
        title: "Top wicket takers",
        type: "bar",
        unit: "wickets",
        ...topSeries(rows, "name", "total_wickets")
      },
      {
        id: "best_economy",
        title: "Best economy (min 3 overs)",
        type: "bar",
        unit: "econ",
        ...topSeries(rows, "name", "economy", {
          desc: false,
          filter: (row) => (num(row.overs) || 0) >= 3
        })
      },
      {
        id: "dot_balls",
        title: "Most dot balls",
        type: "bar",
        unit: "dots",
        ...topSeries(rows, "name", "dot_balls")
      },
      {
        id: "team_wickets_pie",
        title: "Wicket share by team",
        type: "pie",
        unit: "wickets",
        ...teamAggregate(rows, "team_name", "total_wickets", null)
      }
    ];
  }
  if (board === "fielding") {
    return [
      {
        id: "top_dismissals",
        title: "Most dismissals",
        type: "bar",
        unit: "dismissals",
        ...topSeries(rows, "name", "total_dismissal")
      },
      {
        id: "top_catches",
        title: "Most catches",
        type: "bar",
        unit: "catches",
        ...topSeries(rows, "name", "total_catches")
      },
      {
        id: "team_dismissals_pie",
        title: "Dismissals by team",
        type: "pie",
        unit: "dismissals",
        ...teamAggregate(rows, "team_name", "total_dismissal", null)
      }
    ];
  }
  if (board === "mvp") {
    const top = topSeries(rows, "Player Name", "Total");
    const topRows = rows
      .map((row) => ({
        name: String(row["Player Name"] || "").trim(),
        total: num(row.Total),
        batting: num(row.Batting),
        bowling: num(row.Bowling),
        fielding: num(row.Fielding)
      }))
      .filter((r) => r.total != null && r.name)
      .sort((a, b) => b.total - a.total)
      .slice(0, TOP_N);
    return [
      {
        id: "top_mvp",
        title: "MVP leaderboard",
        type: "bar",
        unit: "pts",
        labels: top.labels,
        values: top.values
      },
      {
        id: "mvp_breakdown",
        title: "MVP breakdown (top players)",
        type: "stacked",
        labels: topRows.map((r) => r.name),
        datasets: [
          { label: "Batting", values: topRows.map((r) => roundStat(r.batting) || 0) },
          { label: "Bowling", values: topRows.map((r) => roundStat(r.bowling) || 0) },
          { label: "Fielding", values: topRows.map((r) => roundStat(r.fielding) || 0) }
        ]
      },
      {
        id: "team_mvp_pie",
        title: "MVP points share by team",
        type: "pie",
        unit: "pts",
        ...teamAggregate(rows, "Team Name", "Total", null)
      },
      {
        id: "mvp_category_pie",
        title: "MVP points by category (all players)",
        type: "pie",
        unit: "pts",
        labels: ["Batting", "Bowling", "Fielding"],
        values: [
          roundStat(rows.reduce((sum, row) => sum + (num(row.Batting) || 0), 0)),
          roundStat(rows.reduce((sum, row) => sum + (num(row.Bowling) || 0), 0)),
          roundStat(rows.reduce((sum, row) => sum + (num(row.Fielding) || 0), 0))
        ]
      }
    ];
  }
  return [];
}

function teamAggregate(rows, teamKey, valueKey, limit = TOP_N) {
  const totals = new Map();
  rows.forEach((row) => {
    const team = String(row[teamKey] || "").trim() || "Unknown";
    const val = num(row[valueKey]) || 0;
    totals.set(team, (totals.get(team) || 0) + val);
  });
  let picked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  if (limit != null) {
    picked = picked.slice(0, limit);
  }
  picked = picked.filter((entry) => entry[1] > 0);
  return {
    labels: picked.map((p) => p[0]),
    values: picked.map((p) => roundStat(p[1]))
  };
}

function compactTable(board, rows) {
  if (board === "batting") {
    return rows.map((row) => ({
      playerId: String(row.player_id || "").trim(),
      name: row.name,
      team: row.team_name,
      matches: roundStat(row.total_match),
      runs: roundStat(row.total_runs),
      average: roundStat(row.average),
      strikeRate: roundStat(row.strike_rate),
      sixes: roundStat(row["6s"])
    }));
  }
  if (board === "bowling") {
    return rows.map((row) => ({
      playerId: String(row.player_id || "").trim(),
      name: row.name,
      team: row.team_name,
      matches: roundStat(row.total_match),
      wickets: roundStat(row.total_wickets),
      economy: roundStat(row.economy),
      overs: roundStat(row.overs)
    }));
  }
  if (board === "fielding") {
    return rows.map((row) => ({
      playerId: String(row.player_id || "").trim(),
      name: row.name,
      team: row.team_name,
      matches: roundStat(row.total_match),
      dismissals: roundStat(row.total_dismissal),
      catches: roundStat(row.total_catches)
    }));
  }
  if (board === "mvp") {
    return rows.map((row) => ({
      name: row["Player Name"],
      team: row["Team Name"],
      matches: roundStat(row.Matches),
      batting: roundStat(row.Batting),
      bowling: roundStat(row.Bowling),
      fielding: roundStat(row.Fielding),
      total: roundStat(row.Total)
    }));
  }
  return [];
}

function buildBundleFromCsv(gender, edition, board, csvPath) {
  const raw = fs.readFileSync(csvPath, "utf8");
  const parsed = parseCsv(raw);
  validateHeaders(board, parsed.headers);
  const v = hashContent(`${raw}|${CHART_SCHEMA_VERSION}`);
  const updatedAt = fs.statSync(csvPath).mtime.toISOString();
  const table = compactTable(board, parsed.rows);
  if (board === "mvp") {
    table.sort((a, b) => (b.total || 0) - (a.total || 0));
  } else if (board === "batting") {
    table.sort((a, b) => (b.runs || 0) - (a.runs || 0));
  } else if (board === "bowling") {
    table.sort((a, b) => (b.wickets || 0) - (a.wickets || 0));
  } else if (board === "fielding") {
    table.sort((a, b) => (b.dismissals || 0) - (a.dismissals || 0));
  }
  return {
    v,
    chartSchema: CHART_SCHEMA_VERSION,
    updatedAt,
    gender,
    edition,
    board,
    rowCount: parsed.rows.length,
    sourceFile: path.basename(csvPath),
    table,
    charts: buildCharts(board, parsed.rows)
  };
}

function bundleIsStale(bundle) {
  if (!bundle || bundle.chartSchema !== CHART_SCHEMA_VERSION) return true;
  const charts = bundle.charts || [];
  return !charts.some((chart) => chart.type === "pie");
}

function writeBundle(bundle) {
  const outPath = bundlePath(bundle.gender, bundle.edition, bundle.board);
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, JSON.stringify(bundle), "utf8");
  return outPath;
}

function rebuildBoard(gender, edition, board) {
  const g = slugKey(gender, "gender");
  const e = slugKey(edition, "edition");
  const b = slugKey(board, "board");
  if (!BOARDS.includes(b)) throw new Error("Unknown board type");
  const csvPath = findCsvFile(g, e, b);
  if (!csvPath) {
    const outPath = bundlePath(g, e, b);
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    return null;
  }
  const bundle = buildBundleFromCsv(g, e, b, csvPath);
  writeBundle(bundle);
  return bundle;
}

function rebuildAll() {
  const sources = listCsvSources();
  const rebuilt = [];
  for (const source of sources) {
    try {
      const bundle = rebuildBoard(source.gender, source.edition, source.board);
      if (bundle) rebuilt.push(bundle);
    } catch (err) {
      console.error(`SRPL stats rebuild failed for ${source.filePath}:`, err.message);
    }
  }
  return rebuilt;
}

function readBundle(gender, edition, board) {
  const g = slugKey(gender, "gender");
  const e = slugKey(edition, "edition");
  const b = slugKey(board, "board");
  const outPath = bundlePath(g, e, b);
  if (fs.existsSync(outPath)) {
    const bundle = JSON.parse(fs.readFileSync(outPath, "utf8"));
    if (!bundleIsStale(bundle)) return bundle;
  }
  return rebuildBoard(g, e, b);
}

function getManifest() {
  const datasets = listCsvSources().map((source) => {
    let v = null;
    let updatedAt = null;
    let rowCount = 0;
    let bundle = null;
    try {
      bundle = readBundle(source.gender, source.edition, source.board);
    } catch (_) {
      bundle = null;
    }
    if (bundle) {
      v = bundle.v;
      updatedAt = bundle.updatedAt;
      rowCount = bundle.rowCount || 0;
    }
    if (!v) {
      const stat = fs.statSync(source.filePath);
      v = hashContent(`${fs.readFileSync(source.filePath, "utf8")}|${CHART_SCHEMA_VERSION}`);
      updatedAt = stat.mtime.toISOString();
    }
    return {
      gender: source.gender,
      edition: source.edition,
      board: source.board,
      v,
      updatedAt,
      rowCount,
      sourceFile: source.fileName,
      tournamentId: source.tournamentId
    };
  });
  const editions = {};
  datasets.forEach((item) => {
    if (!editions[item.gender]) editions[item.gender] = {};
    if (!editions[item.gender][item.edition]) editions[item.gender][item.edition] = [];
    if (!editions[item.gender][item.edition].includes(item.board)) {
      editions[item.gender][item.edition].push(item.board);
    }
  });
  Object.keys(editions).forEach((gender) => {
    Object.keys(editions[gender]).forEach((edition) => {
      editions[gender][edition].sort();
    });
  });
  return {
    updatedAt: new Date().toISOString(),
    datasets,
    editions,
    boards: BOARDS,
    genders: GENDERS
  };
}

function validateCsvUpload(board, buffer) {
  const b = slugKey(board, "board");
  if (!BOARDS.includes(b)) throw new Error("Unknown board type");
  const parsed = parseCsv(buffer.toString("utf8"));
  validateHeaders(b, parsed.headers);
  if (!parsed.rows.length) throw new Error("CSV has no data rows");
  return { board: b, rowCount: parsed.rows.length };
}

function inferTournamentIdFromFilename(name) {
  const base = path.basename(String(name || ""));
  const m = BOARD_FILE_RE.exec(base);
  return m ? m[1] : null;
}

function saveCsvUpload({ gender, edition, board, buffer, originalName, tournamentId }) {
  const g = slugKey(gender, "gender");
  const e = slugKey(edition, "edition");
  const b = slugKey(board, "board");
  validateCsvUpload(b, buffer);
  const dir = csvDir(g, e);
  ensureDir(dir);
  const existing = findCsvFile(g, e, b);
  let id = String(tournamentId || "").trim().replace(/\D/g, "");
  if (!id) id = inferTournamentIdFromFilename(originalName);
  if (!id && existing) {
    const m = BOARD_FILE_RE.exec(path.basename(existing));
    if (m) id = m[1];
  }
  if (!id) id = String(Date.now());
  const fileName = `${id}_${b}_leaderboard.csv`;
  const dest = path.join(dir, fileName);
  if (existing && path.resolve(existing) !== path.resolve(dest)) {
    fs.unlinkSync(existing);
  }
  fs.writeFileSync(dest, buffer);
  const bundle = buildBundleFromCsv(g, e, b, dest);
  writeBundle(bundle);
  return { fileName, bundle };
}

function loadBoardRows(gender, edition, board) {
  const g = slugKey(gender, "gender");
  const e = slugKey(edition, "edition");
  const b = slugKey(board, "board");
  const csvPath = findCsvFile(g, e, b);
  if (!csvPath) return [];
  const parsed = parseCsv(fs.readFileSync(csvPath, "utf8"));
  return parsed.rows;
}

function normalizePlayerName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findRowByPlayerId(rows, playerId) {
  const id = String(playerId || "").trim();
  if (!id) return null;
  return rows.find((row) => String(row.player_id || "").trim() === id) || null;
}

function listPlayers(gender, edition) {
  const g = slugKey(gender, "gender");
  const e = slugKey(edition, "edition");
  const byId = new Map();
  for (const board of ["batting", "bowling", "fielding"]) {
    const rows = loadBoardRows(g, e, board);
    rows.forEach((row) => {
      const id = String(row.player_id || "").trim();
      const name = String(row.name || "").trim();
      if (!id || !name) return;
      if (!byId.has(id)) {
        byId.set(id, {
          playerId: id,
          name,
          team: String(row.team_name || "").trim()
        });
      }
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function profileSectionFromBatting(row) {
  if (!row) return null;
  return {
    matches: roundStat(row.total_match),
    innings: roundStat(row.innings),
    runs: roundStat(row.total_runs),
    highest: roundStat(row.highest_run),
    average: roundStat(row.average),
    notOut: roundStat(row.not_out),
    strikeRate: roundStat(row.strike_rate),
    balls: roundStat(row.ball_faced),
    fours: roundStat(row["4s"]),
    sixes: roundStat(row["6s"]),
    fifties: roundStat(row["50s"]),
    hundreds: roundStat(row["100s"]),
    hand: row.batting_hand || ""
  };
}

function profileSectionFromBowling(row) {
  if (!row) return null;
  return {
    matches: roundStat(row.total_match),
    innings: roundStat(row.innings),
    wickets: roundStat(row.total_wickets),
    balls: roundStat(row.balls),
    best: roundStat(row.highest_wicket),
    economy: roundStat(row.economy),
    strikeRate: roundStat(row.SR),
    maidens: roundStat(row.maidens),
    average: roundStat(row.avg),
    runsConceded: roundStat(row.runs),
    overs: roundStat(row.overs),
    dotBalls: roundStat(row.dot_balls),
    style: row.bowling_style || ""
  };
}

function profileSectionFromFielding(row) {
  if (!row) return null;
  return {
    matches: roundStat(row.total_match),
    catches: roundStat(row.catches),
    caughtBehind: roundStat(row.caught_behind),
    runOuts: roundStat(row.run_outs),
    assistRunOuts: roundStat(row.assist_run_outs),
    stumpings: roundStat(row.stumpings),
    caughtAndBowled: roundStat(row.caught_and_bowl),
    totalCatches: roundStat(row.total_catches),
    dismissals: roundStat(row.total_dismissal)
  };
}

function profileSectionFromMvp(row) {
  if (!row) return null;
  return {
    role: row["Player Role"] || "",
    matches: roundStat(row.Matches),
    batting: roundStat(row.Batting),
    bowling: roundStat(row.Bowling),
    fielding: roundStat(row.Fielding),
    total: roundStat(row.Total),
    battingHand: row["Batting Hand"] || "",
    bowlingStyle: row["Bowling Style"] || ""
  };
}

function getPlayerProfile(gender, edition, playerId) {
  const g = slugKey(gender, "gender");
  const e = slugKey(edition, "edition");
  const id = String(playerId || "").trim();
  if (!id) throw new Error("Player id required");

  const battingRow = findRowByPlayerId(loadBoardRows(g, e, "batting"), id);
  const bowlingRow = findRowByPlayerId(loadBoardRows(g, e, "bowling"), id);
  const fieldingRow = findRowByPlayerId(loadBoardRows(g, e, "fielding"), id);

  const name = (battingRow && battingRow.name)
    || (bowlingRow && bowlingRow.name)
    || (fieldingRow && fieldingRow.name)
    || "";
  const team = (battingRow && battingRow.team_name)
    || (bowlingRow && bowlingRow.team_name)
    || (fieldingRow && fieldingRow.team_name)
    || "";

  if (!name) return null;

  let mvpRow = null;
  const mvpRows = loadBoardRows(g, e, "mvp");
  const key = normalizePlayerName(name);
  mvpRow = mvpRows.find((row) => normalizePlayerName(row["Player Name"]) === key) || null;

  const v = hashContent(`${g}|${e}|${id}|${CHART_SCHEMA_VERSION}`);

  return {
    v,
    playerId: id,
    name,
    team,
    gender: g,
    edition: e,
    batting: profileSectionFromBatting(battingRow),
    bowling: profileSectionFromBowling(bowlingRow),
    fielding: profileSectionFromFielding(fieldingRow),
    mvp: profileSectionFromMvp(mvpRow)
  };
}

function sendJsonWithCache(res, payload, version) {
  const etag = `"${version || payload.v || hashContent(JSON.stringify(payload))}"`;
  if (res.req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json(payload);
}

module.exports = {
  BOARDS,
  GENDERS,
  SRPL_ROOT,
  getManifest,
  readBundle,
  rebuildAll,
  rebuildBoard,
  saveCsvUpload,
  validateCsvUpload,
  sendJsonWithCache,
  slugKey,
  listPlayers,
  getPlayerProfile
};
