const express = require("express");
const path = require("path");
const fs = require("fs");
const { capacities, mesaOrder, parseMesa, mesaCapacity, mesaStatus, normalize } = require("./lib/mesa-logic");
const composio = require("./lib/composio");

const app = express();

const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1sgfxgivQKo3tKic5AUeGLsRgVPudB1WkYcG2eUarXVw";
const SHEET_NAME = process.env.SHEET_NAME || "Invitados";
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 15000);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 10000);
const COORDS_PATH = path.join(__dirname, "data", "coords.json");
const VERIFY_WRITE_MAX_ATTEMPTS = Number(process.env.VERIFY_WRITE_MAX_ATTEMPTS || 8);
const VERIFY_WRITE_DELAY_MS = Number(process.env.VERIFY_WRITE_DELAY_MS || 1200);
const PENDING_TTL_MS = Number(process.env.PENDING_TTL_MS || 10 * 60 * 1000);
const READ_MAX_ROWS = Number(process.env.READ_MAX_ROWS || 1200);
const READ_MAX_COL = process.env.READ_MAX_COL || "I";

let cache = {
  at: 0,
  data: null,
  error: null
};
let writeQueue = Promise.resolve();
const pendingMesaByRow = new Map();

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

function columnIndexToLetter(idx) {
  let n = idx + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanupPending(now = Date.now()) {
  for (const [row, p] of pendingMesaByRow.entries()) {
    if (now - p.at > PENDING_TTL_MS) pendingMesaByRow.delete(row);
  }
}

function detectColumns(cols, rows) {
  const byLabel = {
    nombre: cols.findIndex((c) => /(^|\s)nombre(\s|$)/i.test(String(c || ""))),
    plus: cols.findIndex((c) => /\+1/i.test(String(c || ""))),
    mesa: cols.findIndex((c) => /^mesa$/i.test(String(c || ""))),
    grupo: cols.findIndex((c) => /^grupo$/i.test(String(c || ""))),
    va: cols.findIndex((c) => /^va\?$/i.test(String(c || "")))
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

  const grupoIdx = cols.findIndex((c) => /grupo/i.test(String(c || "")));
  const vaIdx = cols.findIndex((c) => /(^|\s)va\?/i.test(String(c || "")));
  return { nombre: bestName.idx, plus: bestPlus.idx, mesa: bestMesa.idx, grupo: grupoIdx, va: vaIdx };
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

async function fetchSheetSnapshot() {
  if (process.env.COMPOSIO_API_KEY) {
    try {
      const range = `${SHEET_NAME}!A1:${READ_MAX_COL}${READ_MAX_ROWS}`;
      const resp = await composio.executeAction("GOOGLESHEETS_BATCH_GET", {
        spreadsheet_id: SPREADSHEET_ID,
        ranges: [range]
      });
      const matrix = resp?.data?.valueRanges?.[0]?.values || [];
      if (matrix.length >= 1) {
        const cols = (matrix[0] || []).map((v) => String(v || ""));
        const width = Math.max(cols.length, 9);
        const paddedCols = Array(width).fill("").map((_, i) => cols[i] || "");
        const rows = [];
        for (let r = 1; r < matrix.length; r++) {
          const src = matrix[r] || [];
          const row = Array(width).fill("");
          for (let c = 0; c < Math.min(width, src.length); c++) {
            row[c] = src[c];
          }
          rows.push(row);
        }
        const idx = detectColumns(paddedCols, rows);
        return { cols: paddedCols, rows, idx, source: "composio_batch_get" };
      }
      throw new Error("Composio devolvió snapshot vacío");
    } catch {
      // With write-enabled mode, avoid gviz fallback because row indexes can drift.
      throw new Error("No se pudo leer snapshot por Composio");
    }
  }

  const gvizUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?sheet=${encodeURIComponent(SHEET_NAME)}&headers=1&tqx=out:json`;
  const raw = await fetchWithTimeout(gvizUrl, FETCH_TIMEOUT_MS);
  const parsed = stripGvizPayload(raw);
  const cols = parsed.table.cols.map((c) => c.label || c.id || "");
  const rows = parsed.table.rows.map((r) => (r.c || []).map((c) => (c ? c.v : "")));
  const idx = detectColumns(cols, rows);
  return { cols, rows, idx, source: "gviz" };
}

async function readCellViaComposio(cellA1) {
  if (!process.env.COMPOSIO_API_KEY) return null;
  const range = `${SHEET_NAME}!${cellA1}`;
  const resp = await composio.executeAction("GOOGLESHEETS_BATCH_GET", {
    spreadsheet_id: SPREADSHEET_ID,
    ranges: [range]
  });
  const value = resp?.data?.valueRanges?.[0]?.values?.[0]?.[0];
  return value == null ? "" : String(value);
}

function enqueueWrite(taskFn) {
  const next = writeQueue.then(taskFn, taskFn);
  writeQueue = next.catch(() => undefined);
  return next;
}

async function loadMesasFromSheet() {
  cleanupPending();
  const { rows, idx } = await fetchSheetSnapshot();
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
  const unassigned = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sheetRow = i + 2; // headers=1 => first data row is sheet row 2
    const nombre = String(row[idx.nombre] || "").trim();
    if (!nombre) continue;
    const vaRaw = idx.va >= 0 ? normalize(row[idx.va]) : "";
    if (vaRaw === "no") continue;
    invitados += 1;

    const plus = normalize(row[idx.plus]) === "si" || normalize(row[idx.plus]) === "sí";
    if (plus) invitadosConPlus += 1;

    const grupo = idx.grupo >= 0 ? String(row[idx.grupo] || "").trim() : "";
    const guest = { id: `row-${sheetRow}`, row: sheetRow, name: nombre, plus1: plus, grupo };

    const pending = pendingMesaByRow.get(sheetRow);
    const mesaRaw = pending ? pending.targetMesaLabel : row[idx.mesa];
    const mesa = parseMesa(mesaRaw);
    if (pending) {
      const seenMesa = parseMesa(row[idx.mesa]);
      const targetMesa = parseMesa(pending.targetMesaLabel);
      if (seenMesa === targetMesa) {
        pendingMesaByRow.delete(sheetRow);
      }
    }
    if (!mesa || !mesasMap[mesa]) {
      unassigned.push(guest);
      continue;
    }

    const weight = plus ? 2 : 1;

    mesasMap[mesa].used += weight;
    mesasMap[mesa].guests.push(guest);
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
    mesas,
    unassigned
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

app.put("/api/guest-mesa", async (req, res) => {
  if (!process.env.COMPOSIO_API_KEY) {
    return res.status(501).json({ error: "Escritura no configurada (falta COMPOSIO_API_KEY)" });
  }

  const { guestId, guestName, targetMesa, sourceMesaKey } = req.body || {};
  if (!guestName || typeof guestName !== "string") {
    return res.status(400).json({ error: "guestName requerido" });
  }
  if (!guestId || typeof guestId !== "string") {
    return res.status(400).json({ error: "guestId requerido" });
  }
  const isClear = targetMesa === "Sin Asignar";
  const mesa = isClear ? null : parseMesa(targetMesa);
  if (!isClear && mesa === null) {
    return res.status(400).json({ error: `Mesa inválida: ${targetMesa}` });
  }

  try {
    const result = await enqueueWrite(async () => {
      const { rows, idx } = await fetchSheetSnapshot();
      if (idx.mesa < 0 || idx.nombre < 0) {
        throw new Error("No se pudieron detectar columnas en la hoja");
      }

      const idMatch = String(guestId).match(/^row-(\d+)$/);
      if (!idMatch) {
        throw new Error(`guestId inválido: ${guestId}`);
      }
      const sheetRow = Number(idMatch[1]);
      const rowIdx = sheetRow - 2;
      if (rowIdx < 0 || rowIdx >= rows.length) {
        throw new Error(`Fila fuera de rango para guestId: ${guestId}`);
      }

      const rowName = String(rows[rowIdx][idx.nombre] || "").trim();
      if (!rowName) {
        throw new Error(`La fila ${sheetRow} no tiene nombre`);
      }
      if (rowName !== guestName.trim()) {
        throw new Error(`Mismatch de nombre en fila ${sheetRow}: esperado "${guestName}", encontrado "${rowName}"`);
      }

      if (sourceMesaKey !== undefined && sourceMesaKey !== null) {
        const pendingCurrent = pendingMesaByRow.get(sheetRow);
        const effectiveMesaRaw = pendingCurrent ? pendingCurrent.targetMesaLabel : rows[rowIdx][idx.mesa];
        const currentMesa = parseMesa(effectiveMesaRaw);
        const expected = String(sourceMesaKey) === "_unassigned" ? null : parseMesa(sourceMesaKey);
        if (currentMesa !== expected) {
          throw new Error("Conflicto de estado: la mesa actual cambió, recarga antes de mover");
        }
      }

      const colLetter = columnIndexToLetter(idx.mesa);
      const cell = `${colLetter}${sheetRow}`;
      const mesaLabel = isClear ? "" : (mesa === "Novios" ? "Mesa Novios" : `Mesa ${mesa}`);

      await composio.executeAction("GOOGLESHEETS_BATCH_UPDATE", {
        spreadsheet_id: SPREADSHEET_ID,
        sheet_name: SHEET_NAME,
        first_cell_location: cell,
        values: [[mesaLabel]],
        valueInputOption: "USER_ENTERED"
      });
      pendingMesaByRow.set(sheetRow, { targetMesaLabel: mesaLabel, at: Date.now() });

      let verified = false;
      for (let attempt = 1; attempt <= VERIFY_WRITE_MAX_ATTEMPTS; attempt++) {
        let seen = null;
        try {
          seen = await readCellViaComposio(cell);
        } catch {
          seen = null;
        }

        if (seen === null) {
          const snap = await fetchSheetSnapshot();
          if (rowIdx < snap.rows.length) seen = snap.rows[rowIdx][snap.idx.mesa];
        }

        const seenMesa = parseMesa(seen);
        const ok = isClear ? String(seen || "").trim() === "" : seenMesa === mesa;
        if (ok) {
          verified = true;
          break;
        }

        await sleep(VERIFY_WRITE_DELAY_MS * attempt);
      }

      cache = { at: 0, data: null, error: null };
      return {
        guest: guestName.trim(),
        newMesa: isClear ? "Sin Asignar" : mesaLabel,
        cell,
        verified
      };
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    const msg = String(err.message || err);
    if (msg.includes("Conflicto") || msg.includes("Mismatch")) {
      return res.status(409).json({ error: `Error al mover invitado: ${msg}` });
    }
    if (msg.includes("guestId inválido") || msg.includes("fuera de rango") || msg.includes("no tiene nombre")) {
      return res.status(400).json({ error: `Error al mover invitado: ${msg}` });
    }
    return res.status(500).json({ error: `Error al mover invitado: ${msg}` });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
