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
  6:[13,41], 7:[13,49], 8:[13,57], 9:[13,65], 10:[13,73],
  11:[24,41], 12:[24,49], 13:[24,57],
  14:[40,45], 15:[50,45], 16:[60,45], 17:[50,58],
  18:[76,41], 19:[76,49], 20:[76,57], 21:[76,65], 22:[76,73],
  23:[87,41], 24:[87,49], 25:[87,57],
  26:[24,78], 27:[34,80], 28:[44,82], 29:[56,82], 30:[66,80],
  31:[76,78], 32:[30,72], 33:[40,74], 34:[60,74], 35:[70,72],
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
