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

function performUndo() {
  if (!undoStack.length) return;
  const { guestName, previousMesa } = undoStack.pop();
  if (!undoStack.length) undoBtn.disabled = true;

  // Find current mesa of the guest to do optimistic revert
  let currentKey = "_unassigned";
  if (lastData) {
    for (const m of lastData.mesas) {
      if (m.guests.some((g) => g.name === guestName)) {
        currentKey = String(m.key);
        break;
      }
    }
  }

  // Determine target key from previousMesa label
  let targetKey = "_unassigned";
  if (previousMesa === "Sin Asignar") {
    targetKey = "_unassigned";
  } else if (lastData) {
    const tgt = lastData.mesas.find((m) => m.label === previousMesa);
    if (tgt) targetKey = String(tgt.key);
  }

  applyMoveLocally(guestName, currentKey, targetKey);

  statusTextEl.textContent = `Deshaciendo: ${guestName} → ${previousMesa}...`;
  fetch("/api/guest-mesa", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guestName, targetMesa: previousMesa })
  })
    .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (!ok) {
        statusTextEl.textContent = `Error: ${data.error}`;
        load(true);
        return;
      }
      statusTextEl.textContent = `Deshecho: ${guestName} → ${data.newMesa}`;
    })
    .catch((err) => {
      statusTextEl.textContent = `Error: ${err.message}`;
      load(true);
    });
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
  1:[39,34], 2:[51,34], 3:[63,34], 4:[46,38], 5:[57,38],
  6:[23,44], 7:[23,48], 8:[23,51], 9:[23,55],
  10:[31,44], 11:[31,48], 12:[31,51], 13:[31,55],
  14:[38,45], 15:[45,49], 16:[60,49], 17:[65,45],
  18:[71,45], 19:[71,48], 20:[71,51], 21:[71,55],
  22:[79,45], 23:[79,48], 24:[79,51], 25:[79,55],
  26:[40,57], 27:[30,60], 28:[36,63], 29:[30,67], 30:[40,67],
  31:[61,57], 32:[66,62], 33:[74,60], 34:[60,67], 35:[72,67],
  Novios:[51,44]
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
let dragState = null; // { guestName, sourceMesaKey, sourceMesaLabel }

/* --- Optimistic move: update UI instantly, API in background --- */
function applyMoveLocally(guestName, sourceMesaKey, targetMesaKey) {
  if (!lastData) return;

  // Find and remove guest from source
  let guest = null;
  if (sourceMesaKey === "_unassigned") {
    const idx = (lastData.unassigned || []).findIndex((g) => g.name === guestName);
    if (idx >= 0) guest = lastData.unassigned.splice(idx, 1)[0];
  } else {
    const srcMesa = lastData.mesas.find((m) => String(m.key) === sourceMesaKey);
    if (srcMesa) {
      const idx = srcMesa.guests.findIndex((g) => g.name === guestName);
      if (idx >= 0) {
        guest = srcMesa.guests.splice(idx, 1)[0];
        const w = guest.plus1 ? 2 : 1;
        srcMesa.used -= w;
      }
    }
  }
  if (!guest) return;

  // Add guest to target
  if (targetMesaKey === "_unassigned") {
    lastData.unassigned = lastData.unassigned || [];
    lastData.unassigned.push(guest);
  } else {
    const tgtMesa = lastData.mesas.find((m) => String(m.key) === targetMesaKey);
    if (tgtMesa) {
      tgtMesa.guests.push(guest);
      const w = guest.plus1 ? 2 : 1;
      tgtMesa.used += w;
    }
  }

  // Recompute meta
  const totalUsed = lastData.mesas.reduce((a, m) => a + m.used, 0);
  const totalCapacity = lastData.mesas.reduce((a, m) => a + m.capacity, 0);
  lastData.meta.totalUsed = totalUsed;
  lastData.meta.occupancy = totalCapacity ? totalUsed / totalCapacity : 0;

  // Re-render
  renderSummary(lastData.meta);
  renderBoard(lastData.mesas);
  populateDropdown(lastData);

  // Re-select the target mesa to show updated guest list
  if (targetMesaKey === "_unassigned") {
    const unassigned = lastData.unassigned || [];
    selectMesa({ key: "_unassigned", label: "Sin Asignar", capacity: null, used: unassigned.length, guests: unassigned, status: "" });
  } else {
    const tgtMesa = lastData.mesas.find((m) => String(m.key) === targetMesaKey);
    if (tgtMesa) selectMesa(tgtMesa);
  }
}

function fireMoveBg(guestName, targetMesa, sourceMesaLabel) {
  pushUndo(guestName, sourceMesaLabel);
  statusTextEl.textContent = `Guardando ${guestName} → ${targetMesa}...`;

  fetch("/api/guest-mesa", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guestName, targetMesa })
  })
    .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (!ok) {
        statusTextEl.textContent = `Error: ${data.error}`;
        load(true); // revert to server state
        return;
      }
      statusTextEl.textContent = `${guestName} → ${data.newMesa}`;
    })
    .catch((err) => {
      statusTextEl.textContent = `Error: ${err.message}`;
      load(true); // revert to server state
    });
}

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
      const nameSpan = document.createElement("span");
      nameSpan.textContent = `${g.name}${g.plus1 ? " (+1)" : ""}`;
      li.appendChild(nameSpan);
      if (g.grupo) {
        const grupoSpan = document.createElement("span");
        grupoSpan.className = "guest-grupo";
        grupoSpan.textContent = g.grupo;
        li.appendChild(grupoSpan);
      }
      li.draggable = true;

      li.addEventListener("dragstart", (e) => {
        dragState = {
          guestName: g.name,
          sourceMesaKey: String(m.key),
          sourceMesaLabel: m.label || "Sin Asignar"
        };
        e.dataTransfer.effectAllowed = "move";
        li.classList.add("dragging-guest");
        document.querySelectorAll(".marker").forEach((mk) => mk.classList.add("can-drop"));
      });

      li.addEventListener("dragend", () => {
        dragState = null;
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
    marker.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      marker.classList.remove("drop-target");
      document.querySelectorAll(".marker").forEach((mk) => {
        mk.classList.remove("can-drop");
        mk.classList.remove("drop-target");
      });

      if (!dragState || dragState.sourceMesaKey === key) return;
      const { guestName, sourceMesaKey, sourceMesaLabel } = dragState;

      applyMoveLocally(guestName, sourceMesaKey, key);
      fireMoveBg(guestName, m.label, sourceMesaLabel);
    });

    if (isEditor) {
      setupDrag(marker, key);
    }

    markersEl.appendChild(marker);
  });
}

/* --- Drop on board (not on a marker) → unassign guest --- */
const boardEl = document.getElementById("board");
boardEl.addEventListener("dragover", (e) => e.preventDefault());
boardEl.addEventListener("drop", (e) => {
  e.preventDefault();
  document.querySelectorAll(".marker").forEach((mk) => {
    mk.classList.remove("can-drop");
    mk.classList.remove("drop-target");
  });

  if (!dragState || dragState.sourceMesaKey === "_unassigned") return;
  const { guestName, sourceMesaKey, sourceMesaLabel } = dragState;

  applyMoveLocally(guestName, sourceMesaKey, "_unassigned");
  fireMoveBg(guestName, "Sin Asignar", sourceMesaLabel);
});

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
