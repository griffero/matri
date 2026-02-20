const markersEl = document.getElementById("markers");
const summaryEl = document.getElementById("summary");
const mesaTitleEl = document.getElementById("mesaTitle");
const mesaInfoEl = document.getElementById("mesaInfo");
const guestListEl = document.getElementById("guestList");
const statusTextEl = document.getElementById("statusText");
const refreshBtn = document.getElementById("refreshBtn");

const POLL_MS = 15000;
let lastData = null;

const coords = {
  // Top cluster
  1:[37,23], 2:[50,23], 3:[63,23], 4:[43,31], 5:[57,31],
  // Left block
  6:[18,38], 7:[16,46], 8:[16,54], 9:[16,62], 10:[31,38],
  11:[31,46], 12:[31,54], 13:[31,62],
  // Center / media luna
  14:[41,42], 15:[48,48], 16:[57,44], 17:[66,50],
  // Right block
  18:[69,38], 19:[66,46], 20:[66,53], 21:[66,60],
  22:[82,38], 23:[82,46], 24:[82,53], 25:[82,60],
  // Bottom
  26:[42,63], 27:[30,68], 28:[39,73], 29:[27,79], 30:[48,81],
  31:[62,56], 32:[66,68], 33:[72,74], 34:[63,80], 35:[74,80],
  Novios:[52,63]
};

function statusClass(status) {
  if (String(status).includes("SOBRECUPO")) return "red";
  if (String(status).includes("LLENA") && !String(status).includes("CASI")) return "orange";
  if (String(status).includes("CASI")) return "yellow";
  return "green";
}

function renderSummary(meta) {
  const items = [
    [meta.totalUsed, "Personas asignadas"],
    [meta.totalCapacity, "Capacidad total"],
    [`${Math.round(meta.occupancy * 100)}%`, "Ocupación"],
    [meta.mesasTotal, "Mesas"],
    [meta.filled, "Llenas"],
    [meta.almost, "Casi llenas"],
    [meta.over, "Sobrecupo"],
    [meta.available, "Disponibles"]
  ];
  summaryEl.innerHTML = items
    .map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`)
    .join("");
}

function selectMesa(m) {
  document.querySelectorAll(".marker").forEach((el) => el.classList.remove("active"));
  const marker = document.querySelector(`[data-key="${m.key}"]`);
  if (marker) marker.classList.add("active");

  mesaTitleEl.textContent = m.label;
  mesaInfoEl.textContent = `${m.used}/${m.capacity} personas - ${m.status}`;
  guestListEl.innerHTML = m.guests
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
    .map((g) => `<li>${g.name}${g.plus1 ? " (+1)" : ""}</li>`)
    .join("");
}

function renderBoard(mesas) {
  markersEl.innerHTML = "";
  mesas.forEach((m) => {
    const pos = coords[m.key] || [50, 50];
    const marker = document.createElement("button");
    marker.className = `marker ${statusClass(m.status)}`;
    marker.style.left = `${pos[0]}%`;
    marker.style.top = `${pos[1]}%`;
    marker.dataset.key = String(m.key);
    marker.innerHTML = `${m.label.replace("Mesa ", "Mesa ")}<br>${m.used}/${m.capacity}`;
    marker.addEventListener("click", () => selectMesa(m));
    markersEl.appendChild(marker);
  });
}

async function load(force = false) {
  statusTextEl.textContent = "Actualizando...";
  try {
    const res = await fetch(`/api/mesas${force ? "?force=1" : ""}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    lastData = data;

    renderSummary(data.meta);
    renderBoard(data.mesas);

    const note = data.cache?.stale ? " (stale cache)" : "";
    statusTextEl.textContent = `OK${note} - ${new Date(data.generatedAt).toLocaleString()}`;
  } catch (err) {
    statusTextEl.textContent = `Error: ${err.message}`;
  }
}

refreshBtn.addEventListener("click", () => load(true));
load();
setInterval(() => load(false), POLL_MS);
