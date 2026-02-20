const SHEET_ID = "1sgfxgivQKo3tKic5AUeGLsRgVPudB1WkYcG2eUarXVw";
const SHEET_NAME = "Invitados";

const capacities = {
  1:10,2:10,3:10,4:10,5:10,
  6:8,7:8,8:8,9:8,10:8,11:8,12:8,13:8,
  14:20,15:20,16:20,17:20,
  18:8,19:8,20:8,21:8,22:8,23:8,24:8,25:8,
  26:10,27:10,28:10,29:10,30:10,31:10,32:10,33:10,34:10,35:10,
};

const mesaOrder = [...Array(35).keys()].map(n => n + 1).concat(["Novios"]);

// Percent coordinates over plan image.
const coords = {
  // Top area
  1:[30,20], 2:[50,20], 3:[70,20], 4:[23,33], 5:[77,33],
  // Left rectangular blocks
  6:[13,41], 7:[13,49], 8:[13,57], 9:[13,65], 10:[13,73],
  11:[24,41], 12:[24,49], 13:[24,57],
  // Center media-lunas
  14:[40,45], 15:[50,45], 16:[60,45], 17:[50,58],
  // Right rectangular blocks
  18:[76,41], 19:[76,49], 20:[76,57], 21:[76,65], 22:[76,73],
  23:[87,41], 24:[87,49], 25:[87,57],
  // Bottom round area (kept above symbology box)
  26:[24,78], 27:[34,80], 28:[44,82], 29:[56,82], 30:[66,80],
  31:[76,78], 32:[30,72], 33:[40,74], 34:[60,74], 35:[70,72],
  // Couple table
  Novios:[50,62]
};

const markersEl = document.getElementById("markers");
const summaryEl = document.getElementById("summary");
const mesaTitleEl = document.getElementById("mesaTitle");
const mesaInfoEl = document.getElementById("mesaInfo");
const guestListEl = document.getElementById("guestList");
const sourceStatusEl = document.getElementById("sourceStatus");

let currentData = null;

document.getElementById("refreshBtn").addEventListener("click", load);

function parseMesa(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (/^mesa novios$/i.test(s)) return "Novios";
  const m = s.match(/(\d+)/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 35) return n;
  }
  return null;
}

function statusClass(used, cap) {
  if (used > cap) return "red";
  if (used === cap) return "orange";
  if (used >= cap - 2) return "yellow";
  return "green";
}

function fetchGViz(url) {
  return fetch(url)
    .then(r => r.text())
    .then(t => {
      const json = t.match(/setResponse\((.*)\);/s)?.[1];
      if (!json) throw new Error("No se pudo leer gviz.");
      return JSON.parse(json);
    });
}

function toRows(gviz) {
  const cols = gviz.table.cols.map(c => c.label || c.id);
  const rows = gviz.table.rows.map(r => r.c.map(c => (c ? c.v : "")));
  return { cols, rows };
}

function countMatches(rows, colIdx, fn) {
  let c = 0;
  for (const r of rows) {
    const v = r[colIdx];
    if (fn(v)) c += 1;
  }
  return c;
}

function detectColumnIndexes(cols, rows) {
  // 1) Fast path by label.
  const byLabel = {
    nombre: cols.findIndex(c => /(^|\s)nombre(\s|$)/i.test(String(c || ""))),
    plus: cols.findIndex(c => /\+1/i.test(String(c || ""))),
    mesa: cols.findIndex(c => /^mesa$/i.test(String(c || ""))),
  };
  if (byLabel.nombre >= 0 && byLabel.plus >= 0 && byLabel.mesa >= 0) return byLabel;

  // 2) Robust path by content.
  // Name column: highest non-empty text volume.
  let bestName = { idx: -1, score: -1 };
  for (let i = 0; i < cols.length; i++) {
    const score = countMatches(rows, i, v => String(v || "").trim().length >= 4);
    if (score > bestName.score) bestName = { idx: i, score };
  }

  // Plus1 column: mostly Sí/No/Si.
  let bestPlus = { idx: -1, score: -1 };
  for (let i = 0; i < cols.length; i++) {
    const score = countMatches(rows, i, v => {
      const s = String(v || "").trim().toLowerCase();
      return s === "sí" || s === "si" || s === "no";
    });
    if (score > bestPlus.score) bestPlus = { idx: i, score };
  }

  // Mesa column: values parseable as Mesa N / N / Mesa Novios.
  let bestMesa = { idx: -1, score: -1 };
  for (let i = 0; i < cols.length; i++) {
    const score = countMatches(rows, i, v => parseMesa(v) !== null);
    if (score > bestMesa.score) bestMesa = { idx: i, score };
  }

  return { nombre: bestName.idx, plus: bestPlus.idx, mesa: bestMesa.idx };
}

function buildStats(dataRows, idx) {
  const mesas = {};
  mesaOrder.forEach(m => {
    mesas[m] = { used: 0, cap: m === "Novios" ? 15 : capacities[m], guests: [] };
  });

  dataRows.forEach(r => {
    const name = String(r[idx.nombre] || "").trim();
    if (!name) return;
    const mesa = parseMesa(r[idx.mesa]);
    if (!mesa) return;
    const plus = String(r[idx.plus] || "").trim().toLowerCase() === "sí";
    const weight = plus ? 2 : 1;
    mesas[mesa].used += weight;
    mesas[mesa].guests.push({ name, plus });
  });

  return mesas;
}

function renderSummary(mesas) {
  const totalCap = mesaOrder.reduce((a, m) => a + mesas[m].cap, 0);
  const totalUsed = mesaOrder.reduce((a, m) => a + mesas[m].used, 0);
  const filled = mesaOrder.filter(m => mesas[m].used === mesas[m].cap).length;
  const almost = mesaOrder.filter(m => mesas[m].used >= mesas[m].cap - 2 && mesas[m].used < mesas[m].cap).length;
  const over = mesaOrder.filter(m => mesas[m].used > mesas[m].cap).length;

  summaryEl.innerHTML = `
    <div><b>${totalUsed}</b><span>Personas asignadas</span></div>
    <div><b>${totalCap}</b><span>Capacidad total</span></div>
    <div><b>${Math.round((totalUsed/totalCap)*100)}%</b><span>Ocupación</span></div>
    <div><b>${mesaOrder.length}</b><span>Mesas totales</span></div>
    <div><b>${filled}</b><span>Llenas</span></div>
    <div><b>${almost}</b><span>Casi llenas</span></div>
    <div><b>${over}</b><span>Sobrecupo</span></div>
  `;
}

function renderBoard(mesas) {
  markersEl.innerHTML = "";
  mesaOrder.forEach(m => {
    const [x, y] = coords[m] || [50, 50];
    const used = mesas[m].used;
    const cap = mesas[m].cap;
    const cls = statusClass(used, cap);
    const label = m === "Novios" ? "Novios" : `Mesa ${m}`;

    const marker = document.createElement("button");
    marker.className = `marker ${cls}`;
    marker.style.left = `${x}%`;
    marker.style.top = `${y}%`;
    marker.innerHTML = `${label}<br>${used}/${cap}`;

    marker.addEventListener("click", () => {
      document.querySelectorAll(".marker").forEach(el => el.classList.remove("active"));
      marker.classList.add("active");
      mesaTitleEl.textContent = label;
      mesaInfoEl.textContent = `Uso: ${used}/${cap} personas`;
      guestListEl.innerHTML = mesas[m].guests
        .sort((a, b) => a.name.localeCompare(b.name, "es"))
        .map(g => `<li>${g.name}${g.plus ? " (+1)" : ""}</li>`)
        .join("");
    });

    markersEl.appendChild(marker);
  });
}

async function load() {
  try {
    sourceStatusEl.textContent = "Cargando...";
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(SHEET_NAME)}&tqx=out:json`;
    const gviz = await fetchGViz(url);
    const { cols, rows } = toRows(gviz);

    const idx = detectColumnIndexes(cols, rows);

    if (idx.nombre < 0 || idx.plus < 0 || idx.mesa < 0) {
      throw new Error("No encontré columnas Nombre / Con +1 / Mesa.");
    }

    const mesas = buildStats(rows, idx);
    currentData = mesas;
    renderSummary(mesas);
    renderBoard(mesas);
    sourceStatusEl.textContent = "Conectado a Invitados (live).";
  } catch (err) {
    console.error(err);
    sourceStatusEl.textContent = `Error: ${err.message}`;
  }
}

load();
