const express = require("express");
const path = require("path");
const fs = require("fs");
const { capacities, mesaOrder, parseMesa, mesaCapacity, mesaStatus, normalize } = require("./lib/mesa-logic");

const app = express();

const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1sgfxgivQKo3tKic5AUeGLsRgVPudB1WkYcG2eUarXVw";
const SHEET_NAME = process.env.SHEET_NAME || "Invitados";
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 15000);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 10000);
const COORDS_PATH = path.join(__dirname, "data", "coords.json");

let cache = {
  at: 0,
  data: null,
  error: null
};

function stripGvizPayload(text) {
  const match = text.match(/setResponse\((.*)\);?\s*$/s);
  if (!match) throw new Error("No se pudo parsear respuesta gviz");
  return JSON.parse(match[1]);
}

function countMatches(rows, colIdx, fn) {
  let c = 0;
  for (const r of rows) {
    const v = r[colIdx];
    if (fn(v)) c += 1;
  }
  return c;
}

function detectColumns(cols, rows) {
  const byLabel = {
    nombre: cols.findIndex((c) => /(^|\s)nombre(\s|$)/i.test(String(c || ""))),
    plus: cols.findIndex((c) => /\+1/i.test(String(c || ""))),
    mesa: cols.findIndex((c) => /^mesa$/i.test(String(c || "")))
  };
  if (byLabel.nombre >= 0 && byLabel.plus >= 0 && byLabel.mesa >= 0) return byLabel;

  let bestName = { idx: -1, score: -1 };
  for (let i = 0; i < cols.length; i++) {
    const score = countMatches(rows, i, (v) => String(v || "").trim().length >= 4);
    if (score > bestName.score) bestName = { idx: i, score };
  }

  let bestPlus = { idx: -1, score: -1 };
  for (let i = 0; i < cols.length; i++) {
    const score = countMatches(rows, i, (v) => {
      const s = normalize(v);
      return s === "si" || s === "sí" || s === "no";
    });
    if (score > bestPlus.score) bestPlus = { idx: i, score };
  }

  let bestMesa = { idx: -1, score: -1 };
  for (let i = 0; i < cols.length; i++) {
    const score = countMatches(rows, i, (v) => parseMesa(v) !== null);
    if (score > bestMesa.score) bestMesa = { idx: i, score };
  }

  return { nombre: bestName.idx, plus: bestPlus.idx, mesa: bestMesa.idx };
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function loadMesasFromSheet() {
  const gvizUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?sheet=${encodeURIComponent(SHEET_NAME)}&tqx=out:json`;
  const raw = await fetchWithTimeout(gvizUrl, FETCH_TIMEOUT_MS);
  const parsed = stripGvizPayload(raw);

  const cols = parsed.table.cols.map((c) => c.label || c.id || "");
  const rows = parsed.table.rows.map((r) => (r.c || []).map((c) => (c ? c.v : "")));

  const idx = detectColumns(cols, rows);
  if (idx.nombre < 0 || idx.plus < 0 || idx.mesa < 0) {
    throw new Error("No se pudieron detectar columnas Nombre/Con +1/Mesa");
  }

  const mesasMap = {};
  for (const m of mesaOrder) {
    mesasMap[m] = {
      key: m,
      label: m === "Novios" ? "Mesa Novios" : `Mesa ${m}`,
      capacity: mesaCapacity(m),
      used: 0,
      guests: []
    };
  }

  let invitados = 0;
  let invitadosConPlus = 0;

  for (const row of rows) {
    const nombre = String(row[idx.nombre] || "").trim();
    if (!nombre) continue;
    invitados += 1;

    const mesa = parseMesa(row[idx.mesa]);
    if (!mesa || !mesasMap[mesa]) continue;

    const plus = normalize(row[idx.plus]) === "si" || normalize(row[idx.plus]) === "sí";
    const weight = plus ? 2 : 1;
    if (plus) invitadosConPlus += 1;

    mesasMap[mesa].used += weight;
    mesasMap[mesa].guests.push({ name: nombre, plus1: plus });
  }

  const mesas = mesaOrder.map((m) => {
    const x = mesasMap[m];
    return {
      ...x,
      ratio: x.capacity ? x.used / x.capacity : 0,
      status: mesaStatus(x.used, x.capacity)
    };
  });

  const totalCapacity = mesas.reduce((a, m) => a + m.capacity, 0);
  const totalUsed = mesas.reduce((a, m) => a + m.used, 0);

  return {
    source: { spreadsheetId: SPREADSHEET_ID, sheetName: SHEET_NAME },
    generatedAt: new Date().toISOString(),
    meta: {
      invitadosBase: invitados,
      plus1EnabledRows: invitadosConPlus,
      mesasTotal: mesas.length,
      totalCapacity,
      totalUsed,
      occupancy: totalCapacity ? totalUsed / totalCapacity : 0,
      filled: mesas.filter((m) => m.used === m.capacity).length,
      almost: mesas.filter((m) => m.used >= m.capacity - 2 && m.used < m.capacity).length,
      over: mesas.filter((m) => m.used > m.capacity).length,
      available: mesas.filter((m) => m.used < m.capacity - 2).length
    },
    mesas
  };
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get("/readyz", (_req, res) => {
  const warm = !!cache.data;
  res.status(warm ? 200 : 503).json({ ok: warm, cacheAt: cache.at || null });
});

app.get("/api/mesas", async (req, res) => {
  const force = req.query.force === "1";
  const now = Date.now();

  if (!force && cache.data && now - cache.at < CACHE_TTL_MS) {
    return res.json({ ...cache.data, cache: { hit: true, ageMs: now - cache.at } });
  }

  try {
    const data = await loadMesasFromSheet();
    cache = { at: now, data, error: null };
    return res.json({ ...data, cache: { hit: false, ageMs: 0 } });
  } catch (err) {
    const fallback = cache.data;
    if (fallback) {
      return res.status(200).json({
        ...fallback,
        cache: { hit: true, stale: true, ageMs: now - cache.at },
        warning: `Usando cache stale por error de fuente: ${err.message}`
      });
    }
    return res.status(502).json({ error: "No se pudo cargar datos de Google Sheets", detail: err.message });
  }
});

app.get("/api/coords", (_req, res) => {
  try {
    const raw = fs.readFileSync(COORDS_PATH, "utf8");
    res.json(JSON.parse(raw));
  } catch {
    res.json({});
  }
});

app.put("/api/coords", (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "Body must be an object" });
  }
  for (const [key, val] of Object.entries(body)) {
    if (!Array.isArray(val) || val.length !== 2 || typeof val[0] !== "number" || typeof val[1] !== "number") {
      return res.status(400).json({ error: `Invalid coord for key "${key}": expected [number, number]` });
    }
  }
  fs.mkdirSync(path.dirname(COORDS_PATH), { recursive: true });
  fs.writeFileSync(COORDS_PATH, JSON.stringify(body, null, 2));
  res.json({ ok: true, keys: Object.keys(body).length });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
