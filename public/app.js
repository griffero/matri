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
  1:[42,24], 2:[51,24], 3:[60,24], 4:[45,31], 5:[56,31],
  6:[20,40], 7:[16,48], 8:[16,56], 9:[16,63], 10:[35,40],
  11:[34,47], 12:[30,55], 13:[30,62],
  14:[69,40], 15:[50,49], 16:[60,49], 17:[50,66],
  18:[74,40], 19:[63,46], 20:[69,54], 21:[71,60],
  22:[85,40], 23:[85,48], 24:[85,55], 25:[85,62],
  26:[32,68], 27:[28,66], 28:[40,72], 29:[29,79], 30:[49,81],
  31:[61,58], 32:[66,68], 33:[73,74], 34:[64,80], 35:[74,80],
  Novios:[52,64]
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
