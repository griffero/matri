const capacities = {
  1: 10, 2: 10, 3: 10, 4: 10, 5: 10,
  6: 8, 7: 8, 8: 8, 9: 8, 10: 8, 11: 8, 12: 8, 13: 8,
  14: 20, 15: 20, 16: 20, 17: 20,
  18: 8, 19: 8, 20: 8, 21: 8, 22: 8, 23: 8, 24: 8, 25: 8,
  26: 10, 27: 10, 28: 10, 29: 10, 30: 10, 31: 10, 32: 10, 33: 10, 34: 10, 35: 10
};

const mesaOrder = [...Array(35).keys()].map((n) => n + 1).concat(["Novios"]);

function parseMesa(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (/^mesa novios$/i.test(s)) return "Novios";
  const m = s.match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (Number.isInteger(n) && n >= 1 && n <= 35) return n;
  return null;
}

function mesaCapacity(m) {
  return m === "Novios" ? 15 : capacities[m] || 0;
}

function mesaStatus(used, cap) {
  if (used > cap) return "🔴 SOBRECUPO";
  if (used === cap) return "🟠 LLENA";
  if (used >= cap - 2) return "🟡 CASI LLENA";
  return "🟢 DISPONIBLE";
}

function normalize(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

module.exports = { capacities, mesaOrder, parseMesa, mesaCapacity, mesaStatus, normalize };
