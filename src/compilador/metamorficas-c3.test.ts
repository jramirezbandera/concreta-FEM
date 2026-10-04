/**
 * Criterio 4 de C3: relaciones metamórficas con muros, sobre modelos al azar con losas y muros
 * (`losasAleatorias.ts`, `murosAleatorios.ts`):
 * - reordenar todas las listas da el mismo modelo analítico, mapeo y diagnósticos, bit a bit;
 * - una traslación y un giro (de 90° y de 37°) dan la misma malla y los resultados transformados;
 * - un ruido menor que ε_geom en los muros no cambia la malla, y uno menor que ε_snap en todo da la
 *   misma topología de C1, con avisos;
 * - invertir el sentido de un muro (con sus huecos y el lado de su empuje) y partirlo en dos muros
 *   colineales dan los mismos resultados.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import type { ModeloAnalitico } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { azar, fisicoAleatorio, longitudPolilinea } from "../pruebas/fisicoAleatorio.ts";
import { conLosasAleatorias } from "../pruebas/losasAleatorias.ts";
import { barajar, emparejarTodos, errorU, planos, relacionPlanoC2, valido } from "../pruebas/metamorficasFisicas.ts";
import { conMurosAleatorios } from "../pruebas/murosAleatorios.ts";
import { compilar } from "./compilar.ts";
import type { CargaFisica, ModeloFisico, Muro, Vec2 } from "./fisico.ts";

const SEMILLAS = [1, 2, 3, 5, 8];
const modelo = (s: number) => conMurosAleatorios(conLosasAleatorias(fisicoAleatorio(s), s), s);
const resolver = (m: ModeloAnalitico) => casosValidos(calcular(m));
const identidad = (q: readonly number[]): [number, number, number] => [q[0]!, q[1]!, q[2]!];

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

/** Los mismos resultados en los nudos de las mismas posiciones. */
function mismosResultados(f: ModeloFisico, g: ModeloFisico): { u: number; reacciones: number } {
  const [a, b] = [valido(compilar(f)), valido(compilar(g))];
  expect(b.modelo.nudos.length).toBe(a.modelo.nudos.length);
  expect(b.modelo.laminas!.length).toBe(a.modelo.laminas!.length);
  const pares = emparejarTodos(a.modelo, b.modelo, (q) => q, 1e-9);
  const [ra, rb] = [resolver(a.modelo), resolver(b.modelo)];
  return { u: errorU(ra, rb, pares, identidad, "u"), reacciones: errorU(ra, rb, pares, identidad, "reacciones") };
}

describe("criterio 4 de C3: metamórficas con muros", () => {
  it("reordenar todas las listas da el mismo modelo analítico, mapeo y diagnósticos, bit a bit", () => {
    for (const s of SEMILLAS) {
      const f = modelo(s);
      const r = azar(3100 + s);
      const g: ModeloFisico = { ...f, pilares: barajar(f.pilares!, r), vigas: barajar(f.vigas!, r), cargas: barajar(f.cargas!, r), losas: barajar(f.losas!, r), bandas: barajar(f.bandas!, r), muros: barajar(f.muros!, r), secciones: barajar(f.secciones, r) };
      const [a, b] = [valido(compilar(f)), valido(compilar(g))];
      expect(JSON.stringify(b.modelo) === JSON.stringify(a.modelo), `semilla ${s}`).toBe(true);
      expect(JSON.stringify(b.mapeo) === JSON.stringify(a.mapeo), `semilla ${s}`).toBe(true);
      expect(JSON.stringify(b.diagnosticos) === JSON.stringify(a.diagnosticos), `semilla ${s}`).toBe(true);
    }
  });

  for (const { nombre, t } of planos()) {
    it(`${nombre}: la misma malla y los resultados transformados`, () => {
      for (const s of SEMILLAS) {
        const e = relacionPlanoC2(modelo(s), t);
        expect(e.mismaMalla, `semilla ${s}`).toBe(true);
        expect(e.u, `semilla ${s}`).toBeLessThan(1e-9);
        expect(e.reacciones, `semilla ${s}`).toBeLessThan(1e-9);
      }
    });
  }

  it("un ruido menor que ε_geom en los muros no cambia la malla", () => {
    for (const s of SEMILLAS) {
      const f = modelo(s);
      const r = azar(4100 + s);
      const e = (q: Vec2): Vec2 => [q[0] + (2 * r() - 1) * 1e-8, q[1] + (2 * r() - 1) * 1e-8];
      const g: ModeloFisico = { ...f, muros: f.muros!.map((w) => ({ ...w, puntos: w.puntos.map(e) })) };
      const [a, b] = [valido(compilar(f)), valido(compilar(g))];
      expect(b.modelo.nudos.length, `semilla ${s}`).toBe(a.modelo.nudos.length);
      expect(b.modelo.laminas!.length, `semilla ${s}`).toBe(a.modelo.laminas!.length);
      const pares = emparejarTodos(a.modelo, b.modelo, (q) => q, 1e-6);
      expect(errorU(resolver(a.modelo), resolver(b.modelo), pares, identidad, "u"), `semilla ${s}`).toBeLessThan(1e-6);
    }
  });

  it("un ruido menor que ε_snap en pilares, vigas, losas y muros da la misma topología de C1, con avisos", () => {
    for (const s of SEMILLAS) {
      const f = modelo(s);
      const r = azar(5100 + s);
      const e = (q: Vec2): Vec2 => [q[0] + (2 * r() - 1) * 0.015, q[1] + (2 * r() - 1) * 0.015];
      const g: ModeloFisico = {
        ...f,
        pilares: f.pilares!.map((p) => {
          const [x, y] = e([p.x, p.y]);
          return { ...p, x, y };
        }),
        vigas: f.vigas!.map((v) => ({ ...v, puntos: v.puntos.map(e) })),
        losas: f.losas!.map((l) => ({ ...l, contorno: l.contorno.map(e) })),
        muros: f.muros!.map((w) => ({ ...w, puntos: w.puntos.map(e) })),
      };
      const [a, b] = [valido(compilar(f)), valido(compilar(g))];
      expect(Object.keys(b.mapeo.nudosPilar).sort(), `semilla ${s}`).toEqual(Object.keys(a.mapeo.nudosPilar).sort());
      expect(Object.keys(b.mapeo.piezas).sort(), `semilla ${s}`).toEqual(Object.keys(a.mapeo.piezas).sort());
      expect(Object.keys(b.mapeo.muros!).sort(), `semilla ${s}`).toEqual(Object.keys(a.mapeo.muros!).sort());
      expect(b.diagnosticos.some((d) => d.codigo === "muro/ajuste"), `semilla ${s}`).toBe(true);
    }
  });

  it("invertir el sentido de los muros (con sus huecos y el lado de sus empujes) da los mismos resultados", () => {
    for (const s of SEMILLAS) {
      const f = modelo(s);
      const largo = new Map(f.muros!.map((w) => [w.id, longitudPolilinea(w.puntos)] as const));
      const muros: Muro[] = f.muros!.map((w) => ({ ...w, puntos: [...w.puntos].reverse(), huecos: w.huecos?.map((h) => ({ ...h, desde: largo.get(w.id)! - h.hasta, hasta: largo.get(w.id)! - h.desde })) }));
      const cargas = f.cargas!.map((c): CargaFisica => (c.tipo === "empuje" ? { ...c, lado: c.lado === "izquierdo" ? "derecho" : "izquierdo" } : c));
      const e = mismosResultados(f, { ...f, muros, cargas });
      expect(e.u, `semilla ${s}`).toBeLessThan(1e-9);
      expect(e.reacciones, `semilla ${s}`).toBeLessThan(1e-9);
    }
  });

  it("partir el muro de sótano en dos muros colineales por el borde de una ventana da los mismos resultados", () => {
    for (const s of SEMILLAS) {
      const f0 = modelo(s);
      const ms = f0.muros!.find((w) => w.id === "MS")!;
      const [A, B] = ms.puntos as [Vec2, Vec2];
      // Una ventana en el primer vano: su borde izquierdo es estación en los dos modelos
      const x0 = 0.6;
      const H = 0.7;
      const f: ModeloFisico = { ...f0, muros: f0.muros!.map((w) => (w.id === "MS" ? { ...w, huecos: [{ desde: x0, hasta: x0 + 0.9, z0: 0.3, z1: 0.3 + H }] } : w)) };
      const P: Vec2 = [A[0] + ((B[0] - A[0]) * x0) / Math.hypot(B[0] - A[0], B[1] - A[1]), A[1] + ((B[1] - A[1]) * x0) / Math.hypot(B[0] - A[0], B[1] - A[1])];
      const a: Muro = { ...ms, id: "MSa", puntos: [A, P], huecos: [] };
      const b: Muro = { ...ms, id: "MSb", puntos: [P, B], huecos: [{ desde: 0, hasta: 0.9, z0: 0.3, z1: 0.3 + H }] };
      const cargas = f.cargas!.flatMap((c): CargaFisica[] => (c.tipo === "empuje" && c.muro === "MS" ? [{ ...c, id: "E-a", muro: "MSa" }, { ...c, id: "E-b", muro: "MSb" }] : [c]));
      const g: ModeloFisico = { ...f, muros: [...f.muros!.filter((w) => w.id !== "MS"), a, b], cargas };
      const e = mismosResultados(f, g);
      expect(e.u, `semilla ${s}`).toBeLessThan(1e-9);
      expect(e.reacciones, `semilla ${s}`).toBeLessThan(1e-9);
    }
  });
});
