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
  1:[30,20], 2:[50,20], 3:[70,20], 4:[23,33], 5:[77,33],
  6:[18,40], 7:[18,48], 8:[18,56], 9:[18,64], 10:[18,72],
  11:[24,42], 12:[24,50], 13:[24,58],
  14:[40,45], 15:[50,45], 16:[60,45], 17:[50,58],
  18:[76,42], 19:[76,50], 20:[76,58], 21:[76,66], 22:[76,74],
  23:[82,40], 24:[82,48], 25:[82,56],
  26:[28,62], 27:[38,66], 28:[50,67], 29:[62,66], 30:[72,62],
  31:[33,69], 32:[42,71], 33:[50,70], 34:[58,71], 35:[67,69],
  Novios:[50,62]
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
