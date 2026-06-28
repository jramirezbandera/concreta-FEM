// Tests de boundsEdificio (PURA): caja envolvente de la obra en coords de escena.
// Cubre el caso normal y los degenerados (G2): vacio -> null; un pilar / colineales ->
// radio finito con suelo minimo (la camara nunca recibe distancia NaN).
import { describe, it, expect } from "vitest";
import { boundsEdificio } from "./boundsEdificio";
import { crearModeloVacio } from "../../dominio";
import type { Modelo, Grupo, Planta, Nudo, Pilar, Viga } from "../../dominio";

function grupo(id: string): Grupo {
  return { id, nombre: id, categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 };
}
function planta(id: string, grupoId: string, cota: number): Planta {
  return { id, nombre: id, cota, altura: 3, grupoId };
}
function nudo(id: string, x: number, y: number): Nudo {
  return { id, x, y };
}
function pilar(id: string, x: number, y: number, pi: string, pf: string): Pilar {
  return {
    id, nombre: id, x, y, plantaInicial: pi, plantaFinal: pf,
    seccionId: "s1", materialId: "m1", angulo: 0, vinculacionExterior: true, arranque: "empotrado",
  };
}
function viga(id: string, plantaId: string, nudoI: string, nudoJ: string): Viga {
  return {
    id, nombre: id, plantaId, nudoI, nudoJ, seccionId: "s1", materialId: "m1",
    extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
  };
}

function base(): Modelo {
  return {
    ...crearModeloVacio(),
    grupos: [grupo("gA")],
    plantas: [planta("p0", "gA", 0), planta("p1", "gA", 3)],
    nudos: [nudo("n1", 0, 0), nudo("n2", 4, 0)],
  };
}

describe("boundsEdificio", () => {
  it("modelo sin geometria -> null (no mover la camara, G2)", () => {
    expect(boundsEdificio(base())).toBeNull();
    expect(boundsEdificio(crearModeloVacio())).toBeNull();
  });

  it("encuadra pilares y vigas en coords de escena (x,y planta; z cota)", () => {
    const modelo: Modelo = {
      ...base(),
      pilares: [pilar("pa", 0, 0, "p0", "p1"), pilar("pb", 4, 2, "p0", "p1")],
      vigas: [viga("va", "p1", "n1", "n2")],
    };
    const b = boundsEdificio(modelo)!;
    expect(b).not.toBeNull();
    expect(b.min).toEqual([0, 0, 0]);
    expect(b.max).toEqual([4, 2, 3]);
    expect(b.centro).toEqual([2, 1, 1.5]);
    expect(Number.isFinite(b.radio)).toBe(true);
    expect(b.radio).toBeGreaterThan(0);
  });

  it("un solo pilar degenerado (pi===pf) -> radio finito con suelo minimo (>= 0.5)", () => {
    const modelo: Modelo = { ...base(), pilares: [pilar("p", 1, 1, "p0", "p0")] };
    const b = boundsEdificio(modelo)!;
    expect(Number.isNaN(b.radio)).toBe(false);
    expect(b.radio).toBeGreaterThanOrEqual(0.5);
  });

  it("nudos colineales (vigas en linea, misma cota) -> radio finito, sin NaN", () => {
    const modelo: Modelo = {
      ...base(),
      nudos: [nudo("n1", 0, 0), nudo("n2", 10, 0)],
      vigas: [viga("va", "p0", "n1", "n2")],
    };
    const b = boundsEdificio(modelo)!;
    expect(Number.isFinite(b.radio)).toBe(true);
    expect(b.radio).toBeGreaterThanOrEqual(5); // semidiagonal de 10 m de luz
  });
});
