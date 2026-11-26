/**
 * CO6 §8.24: el área capaz de las vigas. Lo que no puede fallar:
 *  - donde la sección tiene las barras de una zona del armado, MRd y VRd son los de la comprobación
 *    (el módulo de vigas, `calcRCBeam`) bit a bit;
 *  - una barra cuenta entera donde está anclada y crece lineal desde su punta a lo largo de su anclaje;
 *  - los cercos cambian el cortante y el torsor en escalón, en el límite de su tramo;
 *  - TRd es la fórmula del CE A19 §6.3.2 con los cercos de la sección.
 */
import { describe, expect, it } from "vitest";
import { armadoViga, type ArmadoVanoViga } from "./armado.ts";
import { capacidadEn, capacidadPortico } from "./capacidadVigas.ts";
import { calcRCBeam } from "./concreta/lib/calculations/rcBeams.ts";
import { getBarArea } from "./concreta/data/rebar.ts";
import { getFyd } from "./concreta/data/materials.ts";
import { entradaModuloViga, type GeometriaViga } from "./comprobar/vigas.ts";
import { torsionRC } from "./comprobar/torsion.ts";
import { despiecePortico, type DatosDespiece } from "./despieceVigas.ts";
import type { Portico, VanoPortico } from "./porticos.ts";

const G: GeometriaViga = { b: 300, h: 500, fck: 25 };
const vano = (clave: string, desde: number, hasta: number, apoyos: [number | null, number | null]): VanoPortico => ({ clave, viga: "V1", vano: Number(clave.split("/")[1]), invertida: false, desde, hasta, apoyos, seccion: "v", geometria: G });
/** Pilares de 40 en x = 0, 6 y 11: dos vanos. */
const PORTICO: Portico = {
  id: "V1",
  planta: "F1",
  nombre: "P1 – P2 – P3",
  vigas: [{ id: "V1", invertida: false, x: [0, 11] }],
  apoyos: [
    { objeto: "P1", tipo: "pilar", eje: 0, caras: [-0.2, 0.2] },
    { objeto: "P2", tipo: "pilar", eje: 6, caras: [5.8, 6.2] },
    { objeto: "P3", tipo: "pilar", eje: 11, caras: [10.8, 11.2] },
  ],
  vanos: [vano("V1/0", 0.2, 5.8, [0, 1]), vano("V1/1", 6.2, 10.8, [1, 2])],
  x: [-0.2, 11.2],
  quiebros: [],
};
const LB: Record<number, [number, number]> = { 8: [0.3, 0.45], 12: [0.5, 0.7], 16: [0.65, 0.95], 20: [0.8, 1.15] };
const DATOS: DatosDespiece = { recubrimiento: 30, cotTheta: 2, fyk: 500, anclajes: { "V1/0": LB, "V1/1": LB } };
const ARMADO: ArmadoVanoViga = {
  inferior: { n: 3, diametro: 16 },
  superior: { n: 2, diametro: 12 },
  superiorFin: { n: 4, diametro: 12 },
  cercos: { diametro: 8, separacion: 200 },
  cercosFin: { diametro: 8, separacion: 100 },
};
const ARMADOS = { "V1/0": ARMADO, "V1/1": { ...ARMADO, superiorFin: undefined, cercosFin: undefined, superiorInicio: { n: 4, diametro: 12 }, cercosInicio: { diametro: 8, separacion: 100 } } };
const SIN = { positivo: 0, negativo: 0, cortante: 0, cpPositivo: 0, cpNegativo: 0 };

describe("CO6 §8.24: el área capaz de las vigas", () => {
  const d = despiecePortico(PORTICO, ARMADOS, DATOS);
  const c = capacidadPortico(PORTICO, d, DATOS);

  it("en el centro de un vano, MRd y VRd son los de la comprobación con el armado de esa zona, bit a bit", () => {
    const r = calcRCBeam(entradaModuloViga(G, armadoViga(ARMADO), "centro", SIN));
    const x = 3;
    const m = capacidadEn(c.My, x)!;
    expect(m.max).toBe(r.vano.MRd);
    expect(m.min).toBe(-r.apoyo.MRd);
    const v = capacidadEn(c.Vz, x)!;
    expect(v.max).toBe(Math.min(r.vano.VRd, r.apoyo.VRd));
  });

  it("junto al apoyo del fin, con su superior y sus cercos: los de la zona del fin", () => {
    const r = calcRCBeam(entradaModuloViga(G, armadoViga(ARMADO), "fin", SIN));
    // A 0,5 m de la cara de P2: dentro del cuarto de la luz y antes de la punta de la inferior de V1/1,
    // que entra en V1/0 su anclaje (5,55) y ya comprimiría algo más
    const m = capacidadEn(c.My, 5.3)!;
    expect(m.min).toBe(-r.apoyo.MRd);
    expect(capacidadEn(c.Vz, 5.3)!.max).toBe(Math.min(r.vano.VRd, r.apoyo.VRd));
  });

  it("una barra crece lineal desde su punta a lo largo de su anclaje: lo que resiste sube de lo de sin ella a lo de con ella", () => {
    // La superior de más del apoyo P2 en V1/0 (2Ø12 sobre la corrida) acaba en el vano: su punta y el fin de su anclaje
    const extra = d.barras.find((b) => b.papel === "apoyo" && b.x[1] > 6)!;
    const punta = extra.x[0];
    const sin = -capacidadEn(c.My, punta - 0.01)!.min;
    const con = -capacidadEn(c.My, punta + LB[12]![1] + 0.01)!.min;
    const medio = -capacidadEn(c.My, punta + LB[12]![1] / 2)!.min;
    expect(con).toBeGreaterThan(sin * 1.3);
    expect(medio).toBeGreaterThan(sin);
    expect(medio).toBeLessThan(con);
    // Casi lineal (MRd no lo es del todo en As): a mitad de camino, cerca de la media
    expect(Math.abs(medio - (sin + con) / 2) / con).toBeLessThan(0.03);
  });

  it("los cercos cambian el cortante en escalón en el límite de su tramo", () => {
    const tramos = d.cercos.filter((t) => t.x[0] < 5.8 && t.x[1] > 0.2);
    expect(tramos.length).toBe(2);
    const limite = (tramos[0]!.x[1] + tramos[1]!.x[0]) / 2;
    const puntos = c.Vz[0]!.filter((q) => Math.abs(q.x - limite) < 1e-5);
    expect(puntos.length).toBe(2);
    expect(puntos[1]!.max).toBeGreaterThan(puntos[0]!.max * 1.5);
  });

  it("TRd: min(2·Ak·Asw/s·fyd·cot θ, TRd,max) con los cercos de la sección", () => {
    const t = torsionRC({ b: 300, h: 500, fck: 25, fyk: 500, cPrima: 30 + 8 + 16 / 2 })!;
    const TRds = (2 * t.Ak * (getBarArea(8) / 200) * getFyd(500) * t.cotTheta) / 1e6;
    expect(capacidadEn(c.T, 3)!.max).toBeCloseTo(Math.min(TRds, t.TRdMax), 9);
  });

  it("sin armado, nada resiste; sin geometría (no se arma), no hay curva", () => {
    const vacio = capacidadPortico(PORTICO, despiecePortico(PORTICO, {}, DATOS), DATOS);
    expect(vacio.My.flat().every((q) => q.max === 0 && q.min === 0)).toBe(true);
    const sinG = capacidadPortico({ ...PORTICO, vanos: PORTICO.vanos.map((v) => ({ ...v, geometria: undefined })) as VanoPortico[] }, d, DATOS);
    expect(sinG.My.length).toBe(0);
  });
});
