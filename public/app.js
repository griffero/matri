const markersEl = document.getElementById("markers");
const summaryEl = document.getElementById("summary");
const mesaSelectEl = document.getElementById("mesaSelect");
const mesaInfoEl = document.getElementById("mesaInfo");
const guestListEl = document.getElementById("guestList");
const statusTextEl = document.getElementById("statusText");
const refreshBtn = document.getElementById("refreshBtn");
const undoBtn = document.getElementById("undoBtn");

const POLL_MS = 15000;
let lastData = null;
let pollTimer = null;

/* --- Undo stack --- */
const undoStack = [];

function pushUndo(guestName, previousMesa) {
  undoStack.push({ guestName, previousMesa });
  undoBtn.disabled = false;
}

async function performUndo() {
  if (!undoStack.length) return;
  const { guestName, previousMesa } = undoStack.pop();
  if (!undoStack.length) undoBtn.disabled = true;

  statusTextEl.textContent = `Deshaciendo: ${guestName} → ${previousMesa}...`;
  try {
    const res = await fetch("/api/guest-mesa", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestName, targetMesa: previousMesa })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Error al deshacer");
      statusTextEl.textContent = `Error: ${data.error}`;
      return;
    }
    statusTextEl.textContent = `Deshecho: ${guestName} → ${data.newMesa}`;
    await load(true);
  } catch (err) {
    alert(`Error: ${err.message}`);
    statusTextEl.textContent = `Error: ${err.message}`;
  }
}

undoBtn.addEventListener("click", performUndo);
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "z") {
    e.preventDefault();
    performUndo();
  }
});

/* --- Default fallback coords (used if server has none) --- */
const defaultCoords = {
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

let coords = { ...defaultCoords };

/* --- Editor mode detection --- */
const isEditor = new URLSearchParams(window.location.search).has("editor");

/* --- Load coords from server --- */
async function loadCoords() {
  try {
    const res = await fetch("/api/coords");
    if (!res.ok) return;
    const data = await res.json();
    if (data && Object.keys(data).length > 0) {
      coords = data;
    }
  } catch {
    // keep defaults
  }
}

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

let selectedMesaKey = null;

function selectMesa(m) {
  selectedMesaKey = m.key;
  document.querySelectorAll(".marker").forEach((el) => el.classList.remove("active"));
  const marker = document.querySelector(`[data-key="${m.key}"]`);
  if (marker) marker.classList.add("active");

  mesaSelectEl.value = String(m.key);
  if (m.capacity != null) {
    mesaInfoEl.textContent = `${m.used}/${m.capacity} personas - ${m.status}`;
  } else {
    mesaInfoEl.textContent = `${m.guests.length} invitados sin mesa`;
  }

  const frag = document.createDocumentFragment();
  m.guests
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
    .forEach((g) => {
      const li = document.createElement("li");
      li.textContent = `${g.name}${g.plus1 ? " (+1)" : ""}`;
      li.draggable = true;
      li.dataset.guest = g.name;
      li.dataset.sourceMesa = String(m.key);

      li.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", g.name);
        e.dataTransfer.setData("application/x-source-mesa", String(m.key));
        e.dataTransfer.setData("application/x-source-label", m.label || "Sin Asignar");
        li.classList.add("dragging-guest");
        document.querySelectorAll(".marker").forEach((mk) => mk.classList.add("can-drop"));
      });

      li.addEventListener("dragend", () => {
        li.classList.remove("dragging-guest");
        document.querySelectorAll(".marker").forEach((mk) => {
          mk.classList.remove("can-drop");
          mk.classList.remove("drop-target");
        });
      });

      frag.appendChild(li);
    });

  guestListEl.innerHTML = "";
  guestListEl.appendChild(frag);
}

function populateDropdown(data) {
  const prev = mesaSelectEl.value;
  mesaSelectEl.innerHTML = '<option value="">-- Selecciona mesa --</option>';

  for (const m of data.mesas) {
    const opt = document.createElement("option");
    opt.value = String(m.key);
    opt.textContent = `${m.label} (${m.used}/${m.capacity})`;
    mesaSelectEl.appendChild(opt);
  }

  // "Sin Asignar" option
  const unassigned = data.unassigned || [];
  const optSA = document.createElement("option");
  optSA.value = "_unassigned";
  optSA.textContent = `Sin Asignar (${unassigned.length})`;
  mesaSelectEl.appendChild(optSA);

  if (prev) mesaSelectEl.value = prev;
}

mesaSelectEl.addEventListener("change", () => {
  const val = mesaSelectEl.value;
  if (!val || !lastData) return;

  if (val === "_unassigned") {
    const unassigned = lastData.unassigned || [];
    selectMesa({
      key: "_unassigned",
      label: "Sin Asignar",
      capacity: null,
      used: unassigned.length,
      guests: unassigned,
      status: ""
    });
    return;
  }

  const mesa = lastData.mesas.find((m) => String(m.key) === val);
  if (mesa) selectMesa(mesa);
});

function renderBoard(mesas) {
  markersEl.innerHTML = "";
  mesas.forEach((m) => {
    const key = String(m.key);
    const pos = coords[key] || defaultCoords[m.key] || [50, 50];
    const marker = document.createElement("button");
    marker.className = `marker ${statusClass(m.status)}`;
    marker.style.left = `${pos[0]}%`;
    marker.style.top = `${pos[1]}%`;
    marker.dataset.key = key;
    marker.innerHTML = `${m.label.replace("Mesa ", "Mesa ")}<br>${m.used}/${m.capacity}`;
    marker.addEventListener("click", () => selectMesa(m));

    // Drop target for guest drag & drop
    marker.addEventListener("dragover", (e) => {
      e.preventDefault();
      marker.classList.add("drop-target");
    });
    marker.addEventListener("dragleave", () => {
      marker.classList.remove("drop-target");
    });
    marker.addEventListener("drop", async (e) => {
      e.preventDefault();
      marker.classList.remove("drop-target");
      document.querySelectorAll(".marker").forEach((mk) => {
        mk.classList.remove("can-drop");
        mk.classList.remove("drop-target");
      });

      const guestName = e.dataTransfer.getData("text/plain");
      const sourceMesaKey = e.dataTransfer.getData("application/x-source-mesa");
      const sourceMesaLabel = e.dataTransfer.getData("application/x-source-label");
      if (!guestName || sourceMesaKey === key) return;

      const targetMesa = m.label;
      statusTextEl.textContent = `Moviendo ${guestName} → ${targetMesa}...`;

      try {
        const res = await fetch("/api/guest-mesa", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guestName, targetMesa })
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || "Error al mover invitado");
          statusTextEl.textContent = `Error: ${data.error}`;
          return;
        }
        pushUndo(guestName, sourceMesaLabel || "Sin Asignar");
        statusTextEl.textContent = `${guestName} → ${data.newMesa}`;
        await load(true);
      } catch (err) {
        alert(`Error: ${err.message}`);
        statusTextEl.textContent = `Error: ${err.message}`;
      }
    });

    if (isEditor) {
      setupDrag(marker, key);
    }

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
    populateDropdown(data);

    const note = data.cache?.stale ? " (stale cache)" : "";
    statusTextEl.textContent = `OK${note} - ${new Date(data.generatedAt).toLocaleString()}`;
  } catch (err) {
    statusTextEl.textContent = `Error: ${err.message}`;
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => load(false), POLL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

refreshBtn.addEventListener("click", () => load(true));

/* ========== Editor mode ========== */

let saveTimeout = null;

async function saveCoords() {
  const readout = document.getElementById("coordReadout");
  try {
    if (readout) readout.textContent = "Guardando...";
    const res = await fetch("/api/coords", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(coords)
    });
    const data = await res.json();
    if (readout) readout.textContent = data.ok ? "Guardado" : `Error: ${data.error}`;
  } catch (err) {
    if (readout) readout.textContent = `Error: ${err.message}`;
  }
}

function debouncedSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveCoords, 400);
}

function setupDrag(marker, key) {
  marker.style.touchAction = "none";

  marker.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    marker.setPointerCapture(e.pointerId);
    marker.classList.add("dragging");

    const board = markersEl.parentElement;

    const onMove = (ev) => {
      const rect = board.getBoundingClientRect();
      const x = Math.round(((ev.clientX - rect.left) / rect.width) * 100);
      const y = Math.round(((ev.clientY - rect.top) / rect.height) * 100);
      const cx = Math.max(0, Math.min(100, x));
      const cy = Math.max(0, Math.min(100, y));
      marker.style.left = `${cx}%`;
      marker.style.top = `${cy}%`;
      coords[key] = [cx, cy];

      const readout = document.getElementById("coordReadout");
      if (readout) readout.textContent = `${key}: [${cx}, ${cy}]`;
    };

    const onUp = () => {
      marker.classList.remove("dragging");
      marker.removeEventListener("pointermove", onMove);
      marker.removeEventListener("pointerup", onUp);
      debouncedSave();
    };

    marker.addEventListener("pointermove", onMove);
    marker.addEventListener("pointerup", onUp);
  });
}

function initEditor() {
  const toolbar = document.getElementById("editorToolbar");
  if (!toolbar) return;
  toolbar.style.display = "flex";

  stopPolling();

  document.getElementById("saveBtn").addEventListener("click", saveCoords);

  document.getElementById("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(coords, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "coords.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("importInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        coords = imported;
        document.querySelectorAll(".marker").forEach((marker) => {
          const key = marker.dataset.key;
          const pos = coords[key] || [50, 50];
          marker.style.left = `${pos[0]}%`;
          marker.style.top = `${pos[1]}%`;
        });
        saveCoords();
      } catch (err) {
        alert(`Error al importar: ${err.message}`);
      }
    };
    reader.readAsText(file);
  });
}

/* ========== Init ========== */

async function init() {
  await loadCoords();
  await load();

  if (isEditor) {
    initEditor();
  } else {
    startPolling();
  }
}

init();
