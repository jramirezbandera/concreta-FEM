import { describe, it, expect } from "vitest";
import {
  mallarMuro,
  type ParametrosMalladoMuro,
} from "./malladoMuro";
import { cuantizar } from "./geometria";
import { CAP_QUADS } from "./mallado";

// Tests PUROS del mallado de MURO (plano vertical). Node puro, sin Pyodide: solo la
// TRADUCCION segmento+tramo -> rejilla de quads. Cubre: rejilla y determinismo (orden
// de nudos/quads, orden canonico i,j,m,n pinado por el spike), filas mandatorias en
// cotas de planta, columnas de control de pilar, ambas orientaciones, cap y geometria
// degenerada/diagonal -> error de obra.

function params(over: Partial<ParametrosMalladoMuro> = {}): ParametrosMalladoMuro {
  return {
    p1: { x: 0, y: 0 },
    p2: { x: 4, y: 0 },
    cotaBase: 0,
    cotaTope: 3,
    tamMalla: 1,
    indiceMuro: 0,
    ...over,
  };
}

function mallarOk(p: ParametrosMalladoMuro) {
  const res = mallarMuro(p);
  if (!res.ok) throw new Error("esperaba ok:true, error: " + JSON.stringify(res.error));
  return res.malla;
}

describe("malladoMuro - rejilla y determinismo", () => {
  it("muro 4 m x 3 m con tamMalla 1 -> 4x3 celdas, 5x4 nudos, nombres MQ0-*", () => {
    const m = mallarOk(params());
    expect(m.nx).toBe(4);
    expect(m.ny).toBe(3);
    expect(m.quads).toHaveLength(12);
    expect(m.nodos).toHaveLength(20);
    expect(m.capAplicado).toBe(false);
    expect(m.nodos[0].name).toBe("MQ0-N1");
    expect(m.quads[0].name).toBe("MQ0-Q1");
  });

  it("muro segun X: nudos en el plano FEM Z=coordFija (obra-y fija), Y=cota", () => {
    const m = mallarOk(params({ p1: { x: 1, y: 5 }, p2: { x: 3, y: 5 } }));
    expect(m.eje).toBe("x");
    expect(m.coordFija).toBe(5);
    for (const n of m.nodos) {
      expect(n.z).toBe(5); // FEM Z = obra y (fija)
    }
    // Primera fila a cotaBase, ultima a cotaTope.
    expect(m.nodos[0].y).toBe(0);
    expect(m.nodos[m.nodos.length - 1].y).toBe(3);
    // s asciende a lo largo de FEM X.
    expect(m.nodos[0].x).toBe(1);
    expect(m.nodos[m.ss.length - 1].x).toBe(3);
  });

  it("muro segun Y: nudos en el plano FEM X=coordFija (obra-x fija)", () => {
    const m = mallarOk(params({ p1: { x: 2, y: 0 }, p2: { x: 2, y: 4 } }));
    expect(m.eje).toBe("y");
    expect(m.coordFija).toBe(2);
    for (const n of m.nodos) {
      expect(n.x).toBe(2); // FEM X = obra x (fija)
    }
    // s asciende a lo largo de FEM Z (= obra y).
    expect(m.nodos[0].z).toBe(0);
    expect(m.nodos[m.ss.length - 1].z).toBe(4);
  });

  it("independiente del orden de clic: p2->p1 produce la MISMA malla byte a byte", () => {
    const a = mallarOk(params({ p1: { x: 0, y: 0 }, p2: { x: 4, y: 0 } }));
    const b = mallarOk(params({ p1: { x: 4, y: 0 }, p2: { x: 0, y: 0 } }));
    expect(b).toEqual(a);
  });

  it("orden canonico i,j,m,n (col=s asc, fila=cota asc) — pinado por el spike", () => {
    // Malla 2x2 (muro 2x2, tamMalla 1): el primer quad conecta las dos primeras filas.
    const m = mallarOk(params({ p2: { x: 2, y: 0 }, cotaTope: 2 }));
    const porNombre = new Map(m.nodos.map((n) => [n.name, n]));
    const q = m.quads[0];
    const ni = porNombre.get(q.i)!;
    const nj = porNombre.get(q.j)!;
    const nm = porNombre.get(q.m)!;
    const nn = porNombre.get(q.n)!;
    // i->j avanza en s (FEM X aqui) a cota constante; i->n sube en cota (FEM Y).
    expect(nj.x).toBeGreaterThan(ni.x);
    expect(nj.y).toBe(ni.y);
    expect(nn.y).toBeGreaterThan(ni.y);
    expect(nn.x).toBe(ni.x);
    // m es la esquina opuesta (s+1, cota+1).
    expect(nm.x).toBe(nj.x);
    expect(nm.y).toBe(nn.y);
  });

  it("porFila da la topologia: fila 0 = base (cotaBase), ultima = tope (cotaTope)", () => {
    const m = mallarOk(params());
    expect(m.porFila).toHaveLength(m.cotas.length);
    const porNombre = new Map(m.nodos.map((n) => [n.name, n]));
    for (const name of m.porFila[0]) expect(porNombre.get(name)!.y).toBe(0);
    for (const name of m.porFila[m.ny]) expect(porNombre.get(name)!.y).toBe(3);
    // Cada fila tiene ss.length columnas.
    for (const fila of m.porFila) expect(fila).toHaveLength(m.ss.length);
  });
});

describe("malladoMuro - filas y columnas mandatorias", () => {
  it("cotasControl (plantas intermedias) fuerzan una fila EXACTA en cada cota", () => {
    // Muro de 0 a 6 con plantas intermedias en 2.7 y 5.4 (no multiplos de tamMalla).
    const m = mallarOk(
      params({ cotaTope: 6, cotasControl: [2.7, 5.4], tamMalla: 1 }),
    );
    expect(m.cotas).toContain(2.7);
    expect(m.cotas).toContain(5.4);
    // filaPorCotaQ resuelve la fila por celda cuantizada [M-4].
    const f27 = m.filaPorCotaQ.get(cuantizar(2.7));
    expect(f27).toBeDefined();
    expect(m.cotas[f27!]).toBe(2.7);
    const fBase = m.filaPorCotaQ.get(cuantizar(0));
    expect(fBase).toBe(0);
    const fTope = m.filaPorCotaQ.get(cuantizar(6));
    expect(fTope).toBe(m.ny);
  });

  it("lineasControlS (pilares sobre el eje) fuerzan una columna EXACTA en cada s", () => {
    const m = mallarOk(params({ lineasControlS: [1.35] }));
    expect(m.ss).toContain(1.35);
  });

  it("una cotaControl fuera del intervalo (base, tope) se ignora (defensivo)", () => {
    const m = mallarOk(params({ cotasControl: [-1, 0, 3, 7] }));
    // Solo base(0)..tope(3) equiespaciadas: ninguna fila extra.
    expect(m.cotas).toEqual([0, 1, 2, 3]);
  });
});

describe("malladoMuro - errores de obra y cap", () => {
  it("segmento degenerado (p1 == p2) -> MURO_DEGENERADO", () => {
    const r = mallarMuro(params({ p2: { x: 0, y: 0 } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe("MURO_DEGENERADO");
  });

  it("sin desarrollo vertical (cotaTope <= cotaBase) -> MURO_DEGENERADO", () => {
    const r = mallarMuro(params({ cotaTope: 0 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe("MURO_DEGENERADO");
  });

  it("segmento diagonal -> MURO_NO_ALINEADO", () => {
    const r = mallarMuro(params({ p2: { x: 4, y: 2 } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe("MURO_NO_ALINEADO");
  });

  it("tamMalla que excede el cap -> capAplicado con rejilla engrosada (<= CAP_QUADS)", () => {
    // 40 m x 30 m con tamMalla 0.1 -> 400x300 = 120000 celdas naturales >> cap.
    const m = mallarOk(
      params({ p2: { x: 40, y: 0 }, cotaTope: 30, tamMalla: 0.1 }),
    );
    expect(m.capAplicado).toBe(true);
    expect(m.nx * m.ny).toBeLessThanOrEqual(CAP_QUADS);
  });

  it("tamMalla invalido (<= 0) LANZA (bug del llamante, no error de obra)", () => {
    expect(() => mallarMuro(params({ tamMalla: 0 }))).toThrow();
  });
});
