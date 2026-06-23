import { describe, it, expect } from "vitest";
import {
  categoriaUso,
  listarCategoriasUso,
  GAMMA_G_DESFAV,
  GAMMA_G_FAV,
  GAMMA_Q_DESFAV,
  GAMMA_Q_FAV,
  GAMMA_ELS,
} from "./index";
import type { CategoriaUso } from "../dominio/categoria";

// Tests de la TABLA NORMATIVA DE ACCIONES (feature-13, T1.1). Proyecto `node`
// (sin DOM): la tabla es pura (datos + lookup). Cada valor esperado se cablea
// CONTRA LA FUENTE OFICIAL citada (reconfirmada 2026-06-23):
//   - qk: CTE DB-SE-AE Tabla 3.1 (pag. SE-AE 5).
//   - psi0/psi1/psi2: CTE DB-SE Tabla 4.2 (pag. SE-11).
//   - gamma: CTE DB-SE Tabla 4.1 (pag. SE-11).
// Un test rojo aqui senala un descuadre con la norma, no un descuido de copia.

describe("categoriaUso - sobrecarga qk (CTE DB-SE-AE Tabla 3.1)", () => {
  // Valor representativo de qk por LETRA (el enum agrupa subcategorias). Eleccion
  // documentada en acciones.ts; aqui se fija el contrato.
  const qkEsperado: Record<CategoriaUso, number> = {
    A: 2, // A1 viviendas (representativo de A)
    B: 2, // administrativo
    C: 5, // C3/C4/C5 (representativo desfavorable de C)
    D: 5, // D1/D2 comercial
    E: 2, // trafico/aparcamiento < 30 kN
    F: 1, // cubierta transitable privada
    G: 1, // G1 cubierta conservacion incl. < 20°
  };

  for (const [cat, qk] of Object.entries(qkEsperado) as [
    CategoriaUso,
    number,
  ][]) {
    it(`categoria ${cat}: qk = ${qk} kN/m² (interno, sin conversion)`, () => {
      expect(categoriaUso(cat).qk).toBe(qk);
    });
  }
});

describe("categoriaUso - coef. de simultaneidad psi (CTE DB-SE Tabla 4.2)", () => {
  // [psi0, psi1, psi2] por categoria, literal de la Tabla 4.2.
  const psiEsperado: Record<CategoriaUso, [number, number, number]> = {
    A: [0.7, 0.5, 0.3], // Zonas residenciales (Categoria A)
    B: [0.7, 0.5, 0.3], // Zonas administrativas (Categoria B) -> = A, NO = C
    C: [0.7, 0.7, 0.6], // Zonas destinadas al publico (Categoria C)
    D: [0.7, 0.7, 0.6], // Zonas comerciales (Categoria D)
    E: [0.7, 0.7, 0.6], // Trafico y aparcamiento (Categoria E)
    F: [0.7, 0.5, 0.3], // Cubiertas transitables: hereda del uso de acceso (candidato A)
    G: [0, 0, 0], // Cubiertas de conservacion: fila en blanco -> no concomitante
  };

  for (const [cat, [p0, p1, p2]] of Object.entries(psiEsperado) as [
    CategoriaUso,
    [number, number, number],
  ][]) {
    it(`categoria ${cat}: psi0=${p0}, psi1=${p1}, psi2=${p2}`, () => {
      const e = categoriaUso(cat);
      expect(e.psi0).toBeCloseTo(p0, 12);
      expect(e.psi1).toBeCloseTo(p1, 12);
      expect(e.psi2).toBeCloseTo(p2, 12);
    });
  }

  it("B sigue a A (0,5 frecuente), NO a C (0,7) - error frecuente", () => {
    expect(categoriaUso("B").psi1).toBe(categoriaUso("A").psi1);
    expect(categoriaUso("B").psi1).not.toBe(categoriaUso("C").psi1);
  });

  it("todos los psi estan en el rango [0, 1]", () => {
    for (const cat of ["A", "B", "C", "D", "E", "F", "G"] as CategoriaUso[]) {
      const e = categoriaUso(cat);
      for (const p of [e.psi0, e.psi1, e.psi2]) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("Coeficientes parciales gamma (CTE DB-SE Tabla 4.1, resistencia)", () => {
  it("permanente: desfavorable 1,35 / favorable 0,80", () => {
    expect(GAMMA_G_DESFAV).toBe(1.35);
    expect(GAMMA_G_FAV).toBe(0.8);
  });

  it("variable: desfavorable 1,50 / favorable 0", () => {
    expect(GAMMA_Q_DESFAV).toBe(1.5);
    expect(GAMMA_Q_FAV).toBe(0);
  });

  it("ELS: todos los gamma valen 1,00", () => {
    expect(GAMMA_ELS).toBe(1.0);
  });

  it("la permanente desfavorable es mayor que la favorable (coherencia fisica)", () => {
    expect(GAMMA_G_DESFAV).toBeGreaterThan(GAMMA_G_FAV);
    expect(GAMMA_Q_DESFAV).toBeGreaterThan(GAMMA_Q_FAV);
  });
});

describe("categoriaUso - metadatos y exhaustividad del enum", () => {
  it("cada categoria del enum tiene entrada con descripcion no vacia", () => {
    for (const cat of ["A", "B", "C", "D", "E", "F", "G"] as CategoriaUso[]) {
      const e = categoriaUso(cat);
      expect(e.categoria).toBe(cat);
      expect(e.descripcion.length).toBeGreaterThan(0);
    }
  });

  it("listarCategoriasUso devuelve las 7 categorias y es una copia mutable-segura", () => {
    const lista = listarCategoriasUso();
    expect(lista).toHaveLength(7);
    expect(lista.map((e) => e.categoria).sort()).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
    ]);
    // Mutar la copia no altera el resultado del lookup interno.
    lista[0].qk = 999;
    expect(categoriaUso("A").qk).toBe(2);
  });
});
