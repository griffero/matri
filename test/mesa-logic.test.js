const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { capacities, mesaOrder, parseMesa, mesaCapacity, mesaStatus, normalize } = require("../lib/mesa-logic");

describe("parseMesa", () => {
  it("parses 'Mesa 5' to 5", () => {
    assert.equal(parseMesa("Mesa 5"), 5);
  });

  it("parses bare number '5' to 5", () => {
    assert.equal(parseMesa("5"), 5);
  });

  it("parses 'Mesa Novios' to 'Novios'", () => {
    assert.equal(parseMesa("Mesa Novios"), "Novios");
  });
  it("parses 'Novios' to 'Novios'", () => {
    assert.equal(parseMesa("Novios"), "Novios");
  });

  it("returns null for empty string", () => {
    assert.equal(parseMesa(""), null);
  });

  it("returns null for null", () => {
    assert.equal(parseMesa(null), null);
  });

  it("returns null for 'Mesa 0' (out of range)", () => {
    assert.equal(parseMesa("Mesa 0"), null);
  });

  it("returns null for 'Mesa 36' (out of range)", () => {
    assert.equal(parseMesa("Mesa 36"), null);
  });

  it("parses 'mesa novios' case-insensitive", () => {
    assert.equal(parseMesa("mesa novios"), "Novios");
  });

  it("parses '  Mesa 12  ' with whitespace", () => {
    assert.equal(parseMesa("  Mesa 12  "), 12);
  });
});

describe("mesaCapacity", () => {
  it("returns 10 for mesas 1-5", () => {
    for (const m of [1, 2, 3, 4, 5]) {
      assert.equal(mesaCapacity(m), 10);
    }
  });

  it("returns 8 for mesas 6-13", () => {
    for (const m of [6, 7, 8, 9, 10, 11, 12, 13]) {
      assert.equal(mesaCapacity(m), 8);
    }
  });

  it("returns 20 for mesas 14-17", () => {
    for (const m of [14, 15, 16, 17]) {
      assert.equal(mesaCapacity(m), 20);
    }
  });

  it("returns 8 for mesas 18-25", () => {
    for (const m of [18, 19, 20, 21, 22, 23, 24, 25]) {
      assert.equal(mesaCapacity(m), 8);
    }
  });

  it("returns 10 for mesas 26-35", () => {
    for (const m of [26, 27, 28, 29, 30, 31, 32, 33, 34, 35]) {
      assert.equal(mesaCapacity(m), 10);
    }
  });

  it("returns 15 for Novios", () => {
    assert.equal(mesaCapacity("Novios"), 15);
  });

  it("returns 0 for unknown mesa", () => {
    assert.equal(mesaCapacity(99), 0);
  });
});

describe("mesaStatus", () => {
  it("returns SOBRECUPO when over capacity", () => {
    assert.match(mesaStatus(11, 10), /SOBRECUPO/);
  });

  it("returns LLENA when at capacity", () => {
    assert.match(mesaStatus(10, 10), /LLENA/);
    assert.doesNotMatch(mesaStatus(10, 10), /CASI/);
  });

  it("returns CASI LLENA when within 2 of capacity", () => {
    assert.match(mesaStatus(8, 10), /CASI LLENA/);
    assert.match(mesaStatus(9, 10), /CASI LLENA/);
  });

  it("returns DISPONIBLE when more than 2 below capacity", () => {
    assert.match(mesaStatus(7, 10), /DISPONIBLE/);
    assert.match(mesaStatus(0, 10), /DISPONIBLE/);
  });
});

describe("normalize", () => {
  it("converts 'Sí' to 'si'", () => {
    assert.equal(normalize("Sí"), "si");
  });

  it("strips accents", () => {
    assert.equal(normalize("café"), "cafe");
  });

  it("trims whitespace", () => {
    assert.equal(normalize("  hola  "), "hola");
  });

  it("lowercases", () => {
    assert.equal(normalize("HOLA"), "hola");
  });

  it("returns empty string for null", () => {
    assert.equal(normalize(null), "");
  });

  it("returns empty string for undefined", () => {
    assert.equal(normalize(undefined), "");
  });
});

describe("integration: occupancy calculation", () => {
  it("computes used seats from guests with +1", () => {
    const guests = [
      { name: "Ana", plus: false },
      { name: "Pedro", plus: true },
      { name: "María", plus: false }
    ];

    let used = 0;
    for (const g of guests) {
      used += g.plus ? 2 : 1;
    }

    assert.equal(used, 4);
    assert.equal(mesaCapacity(1), 10);
    assert.match(mesaStatus(used, mesaCapacity(1)), /DISPONIBLE/);
  });
});

describe("mesaOrder", () => {
  it("has 36 entries (35 numbered + Novios)", () => {
    assert.equal(mesaOrder.length, 36);
  });

  it("starts with 1 and ends with Novios", () => {
    assert.equal(mesaOrder[0], 1);
    assert.equal(mesaOrder[mesaOrder.length - 1], "Novios");
  });
});
