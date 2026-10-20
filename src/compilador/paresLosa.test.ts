/**
 * Los pares de la losa en las vigas (`docs/fem3d/diagramas-vigas.md`, `EsfuerzosPiezas`):
 * - en cada nudo interior de una viga, la parte de la losa del salto de T y My por las fuerzas de las
 *   láminas (trasladadas de las caras al eje) más la de las cargas nodales es el salto entero del
 *   motor, a precisión de máquina, con la unión por las caras (LV) y por el eje; y la vía rápida (el
 *   salto de los diagramas menos las cargas) da lo mismo;
 * - con el reparto, lo que queda de salto es sólo lo de las cargas nodales (el My, continuo);
 * - cada barra suavizada es la del motor más un par uniforme: el cortante no cambia, y el extremo de
 *   My de un vano se busca donde se anula Vz menos ese par;
 * - con `suavizado: false`, los diagramas del motor; los pilares no cambian;
 * - lo suavizado depende menos de la malla que lo de antes (vano y cara).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import { FuerzasNodales } from "../motor/fuerzasNodales.ts";
import type { ResultadoCaso } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { compilar, type ResultadoCompilacion } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "./fisico.ts";
import { EsfuerzosPiezas } from "./resultados.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

/** Dos recuadros de 6 × 5 con vigas de 30 × 50 en los bordes y en el eje común, losa de 0,20, cargas de superficie y una puntual excéntrica. */
const MODELO: ModeloFisico = {
  plantas: [
    { id: "P1", altura: null },
    { id: "P0", altura: 3 },
  ],
  materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
  secciones: [
    { id: "p", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
    { id: "v", material: "H", forma: "rectangular", b: 0.3, h: 0.5 },
  ],
  pilares: [
    [0, 0],
    [6, 0],
    [12, 0],
    [0, 5],
    [6, 5],
    [12, 5],
  ].map(([x, y], k) => ({ id: `C${k + 1}`, x: x!, y: y!, desde: "P0", hasta: "P1", seccion: "p" })),
  vigas: [
    { id: "VA", planta: "P1", puntos: [[0, 0], [12, 0]], seccion: "v" },
    { id: "VB", planta: "P1", puntos: [[0, 5], [12, 5]], seccion: "v" },
    { id: "V1", planta: "P1", puntos: [[0, 0], [0, 5]], seccion: "v" },
    { id: "V2", planta: "P1", puntos: [[6, 0], [6, 5]], seccion: "v" },
    { id: "V3", planta: "P1", puntos: [[12, 0], [12, 5]], seccion: "v" },
  ],
  losas: [{ id: "L", planta: "P1", material: "H", espesor: 0.2, contorno: [[0, 0], [12, 0], [12, 5], [0, 5]] }],
  casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
  cargas: [
    { tipo: "superficie", id: "cm", caso: "G", planta: "P1", losa: "L", q: [0, 0, -2] },
    { tipo: "superficie", id: "q", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -3] },
    { tipo: "puntual", id: "pq", caso: "Q", planta: "P1", x: 3.3, y: 1.6, F: [0, 0, -20] },
  ],
};

function preparar(op: OpcionesCompilacion = {}) {
  const r = valido(compilar(MODELO, op));
  const casos = casosValidos(calcular(r.modelo));
  return { r, casos, ep: new EsfuerzosPiezas(r.modelo, r.mapeo, casos), crudo: new EsfuerzosPiezas(r.modelo, r.mapeo, casos, { suavizado: false }) };
}

/** Par de las cargas nodales del nudo n y de sus esclavos (trasladado), como salto de [T, My] en los ejes de la barra b. */
function saltoCargas(r: Extract<ResultadoCompilacion, { valido: true }>, fn: FuerzasNodales, b: number, n: number, q: number): [number, number] {
  const P = r.modelo.nudos[n]!;
  const C = [0, 0, 0];
  const esclavos = (r.modelo.restricciones ?? []).filter((x) => x.tipo === "enlace-rigido" && x.maestro === n).flatMap((x) => x.esclavos);
  for (const v of [n, ...esclavos]) {
    const f = fn.cargasNodales(q).subarray(6 * v, 6 * v + 6);
    const Q = r.modelo.nudos[v]!;
    const [dx, dy, dz] = [Q.x - P.x, Q.y - P.y, Q.z - P.z];
    C[0]! += f[3]! + dy * f[2]! - dz * f[1]!;
    C[1]! += f[4]! + dz * f[0]! - dx * f[2]!;
    C[2]! += f[5]! + dx * f[1]! - dy * f[0]!;
  }
  const R = fn.barraPreparada(b).R;
  const l = [0, 1].map((i) => R[3 * i]! * C[0]! + R[3 * i + 1]! * C[1]! + R[3 * i + 2]! * C[2]!);
  return [-l[0]!, l[1]!];
}

/** Los nudos interiores suavizados de las vigas: [barra de la izquierda, de la derecha]. */
function nudosInteriores(ep: EsfuerzosPiezas, piezas: readonly string[]): [number, number][] {
  const r: [number, number][] = [];
  for (const id of piezas) {
    const ts = ep.tramos(id);
    for (let k = 0; k + 1 < ts.length; k++) if (ep.saltosLosa(ts[k]!.barra)?.some((j) => j.slice(2).some((v) => v !== 0))) r.push([ts[k]!.barra, ts[k + 1]!.barra]);
  }
  return r;
}

const VIGAS = ["VA", "VB", "V1", "V2", "V3"];

const valido2 = <T,>(r: { valido: true; valor: T } | { valido: false }): T => {
  if (!r.valido) throw new Error("consulta no válida");
  return r.valor;
};

describe("pares de la losa en las vigas", () => {
  for (const union of ["cara", "eje"] as const)
    it(`unión por ${union === "cara" ? "las caras" : "el eje"}: losa + cargas nodales = el salto del motor; tras el reparto, sólo queda lo de las cargas`, () => {
      const { r, casos, ep, crudo } = preparar({ unionLosaViga: union });
      const fn = new FuerzasNodales(r.modelo);
      const nudos = nudosInteriores(ep, VIGAS);
      expect(nudos.length).toBeGreaterThan(20);
      let mayor = 0;
      for (const [a, b] of nudos) {
        const n = r.modelo.barras![a]!.nudos[1];
        for (let q = 0; q < casos.length; q++) {
          const [da, db] = [crudo.diagrama(a, q), crudo.diagrama(b, q)];
          const [sa, sb] = [ep.diagrama(a, q), ep.diagrama(b, q)];
          const J = ep.saltosLosa(a)![q]!;
          // La vía rápida (de los diagramas) es la de las fuerzas de las láminas
          const JL = ep.saltosLosa(a, true)![q]!;
          const cargas = saltoCargas(r, fn, a, n, q);
          for (const [c, o] of [
            [3, 0],
            [4, 1],
          ] as const) {
            const total = db.esfuerzosEn(0, 1)[c]! - da.esfuerzosEn(da.L, -1)[c]!;
            const queda = sb.esfuerzosEn(0, 1)[c]! - sa.esfuerzosEn(sa.L, -1)[c]!;
            mayor = Math.max(mayor, Math.abs(total));
            const tol = 1e-9 * Math.max(1, Math.abs(total));
            expect(Math.abs(J[2 + o]! - JL[2 + o]!), `${n} ${c} ${q}`).toBeLessThan(tol);
            expect(Math.abs(total - JL[2 + o]! - cargas[o]!), `${n} ${c} ${q}`).toBeLessThan(tol);
            expect(Math.abs(queda - cargas[o]!), `${n} ${c} ${q}`).toBeLessThan(tol);
          }
        }
      }
      // Hay dientes que quitar
      expect(mayor).toBeGreaterThan(0.5);
    });

  it("cada barra es la del motor más un par uniforme: el cortante igual y el extremo de My donde Vz menos el par se anula", () => {
    const { r, casos, ep, crudo } = preparar();
    for (const [a] of nudosInteriores(ep, VIGAS))
      for (let q = 0; q < casos.length; q++) {
        const [d, s] = [crudo.diagrama(a, q), ep.diagrama(a, q)];
        const p = s.pares!;
        for (const x of [0, d.L / 3, d.L]) {
          const [e, f] = [d.esfuerzosEn(x, x === d.L ? -1 : 1), s.esfuerzosEn(x, x === d.L ? -1 : 1)];
          for (const c of [0, 1, 2]) expect(f[c]).toBe(e[c]);
        }
        // My lineal añadido: su pendiente es la de los pares
        const dM = (x: number) => s.esfuerzosEn(x)[4]! - d.esfuerzosEn(x)[4]!;
        expect(Math.abs((dM(d.L) - dM(0)) / d.L - p[1]!)).toBeLessThan(1e-9 * Math.max(1, Math.abs(p[1]!)));
        // dMy/dx = −Vz + p: en cada raíz interior de Vz − p, una estación
        for (const x of s.ceros(2, p[1])) expect(s.estaciones()).toContain(x);
      }
    // Los pilares, tal cual
    r.mapeo.barras.forEach((m, b) => {
      if (m.tipo === "pilar") expect(ep.saltosLosa(b)).toBeNull();
    });
  });

  it("el máximo del vano con el reparto es el de una búsqueda fina, y depende menos de la malla", () => {
    const F = [1.35, 1.5];
    const vanos = (h: number, suavizado: boolean) => {
      const r = valido(compilar(MODELO, { tamanoMalla: h }));
      const casos: ResultadoCaso[] = casosValidos(calcular(r.modelo));
      const c = new Consultas(MODELO, r, casos, { tamanoMalla: h });
      const ep = new EsfuerzosPiezas(r.modelo, r.mapeo, casos, { suavizado });
      (c as unknown as { piezasC: EsfuerzosPiezas }).piezasC = ep;
      return ["VA", "V2"].flatMap((id) =>
        valido2(c.viga(id)).vanos.map((_, i) => {
          const v = valido2(c.vano(id, i, F));
          return { max: v.maxMy.valor, min: v.minMy.valor };
        }),
      );
    };
    const [g0, g1, f0, f1] = [vanos(0.75, false), vanos(0.75, true), vanos(0.3, false), vanos(0.3, true)];
    let [antes, ahora] = [0, 0];
    g0.forEach((_, k) => {
      antes += Math.abs(g0[k]!.max - f0[k]!.max) + Math.abs(g0[k]!.min - f0[k]!.min);
      ahora += Math.abs(g1[k]!.max - f1[k]!.max) + Math.abs(g1[k]!.min - f1[k]!.min);
    });
    expect(ahora).toBeLessThan(antes);
  });
});
