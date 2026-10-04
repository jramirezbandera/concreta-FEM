/**
 * Criterio 4 de C2: relaciones metamórficas con losas, sobre modelos al azar (`losasAleatorias.ts`).
 * - Reordenar todas las listas da el mismo modelo analítico, mapeo y diagnósticos, bit a bit.
 * - Una traslación y un giro (de 90° y de 37°, con el eje 1 de las losas girado igual) dan la misma
 *   malla (los mismos nudos y láminas, transformados) y los resultados transformados.
 * - Un ruido menor que ε_geom en la geometría de las losas no cambia la malla.
 * - Un ruido menor que ε_snap en pilares, vigas y losas da la misma topología de C1 (con avisos).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import type { ModeloAnalitico, ResultadoCaso, Vec3 } from "../motor/modelo.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { azar, fisicoAleatorio } from "../pruebas/fisicoAleatorio.ts";
import { conLosasAleatorias } from "../pruebas/losasAleatorias.ts";
import { barajar, planos, transformar, valido, type Plano } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico, Vec2 } from "./fisico.ts";

const SEMILLAS = [1, 2, 3, 4, 6, 9];
const modelo = (s: number) => conLosasAleatorias(fisicoAleatorio(s), s);
const resolver = (m: ModeloAnalitico) => casosValidos(calcular(m));

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

/** Empareja todos los nudos (salvo los maestros de diafragma) por posición transformada. */
function emparejarTodos(a: ModeloAnalitico, b: ModeloAnalitico, p: (q: Vec2) => Vec2, tol: number): Map<number, number> {
  const clave = (x: number, y: number, z: number) => `${Math.round(x / tol)},${Math.round(y / tol)},${Math.round(z / tol)}`;
  const idx = new Map<string, number[]>();
  b.nudos.forEach((n, j) => {
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
      const k = clave(n.x + dx * tol, n.y + dy * tol, n.z);
      let l = idx.get(k);
      if (!l) idx.set(k, (l = []));
      l.push(j);
    }
  });
  const r = new Map<number, number>();
  a.nudos.forEach((n, i) => {
    if (n.id.endsWith(":maestro")) return;
    const [x, y] = p([n.x, n.y]);
    const j = (idx.get(clave(x, y, n.z)) ?? []).find((k) => Math.abs(b.nudos[k]!.x - x) < tol && Math.abs(b.nudos[k]!.y - y) < tol);
    if (j === undefined) throw new Error(`el nudo ${n.id} no tiene pareja`);
    r.set(i, j);
  });
  return r;
}

/** Peor error relativo de v(u_A) frente a u_B, por grupos de 3 (traslaciones y giros). */
function errorU(ra: ResultadoCaso[], rb: ResultadoCaso[], pares: Map<number, number>, v: (q: readonly number[]) => Vec3, campo: "u" | "reacciones"): number {
  let peor = 0;
  ra.forEach((ca, c) => {
    for (const g of [0, 3]) {
      let dif = 0;
      let ref = 0;
      for (const [i, j] of pares) {
        const t = v(Array.from(ca[campo].subarray(6 * i + g, 6 * i + g + 3)));
        for (let k = 0; k < 3; k++) {
          dif = Math.max(dif, Math.abs(t[k]! - rb[c]![campo][6 * j + g + k]!));
          ref = Math.max(ref, Math.abs(rb[c]![campo][6 * j + g + k]!));
        }
      }
      peor = Math.max(peor, ref > 0 ? dif / ref : dif);
    }
  });
  return peor;
}

function relacionPlanoC2(f: ModeloFisico, t: Plano): { mismaMalla: boolean; u: number; reacciones: number } {
  const a = valido(compilar(f));
  const b = valido(compilar(transformar(f, t)));
  const mismaMalla = a.modelo.nudos.length === b.modelo.nudos.length && a.modelo.laminas!.length === b.modelo.laminas!.length;
  if (!mismaMalla) return { mismaMalla, u: NaN, reacciones: NaN };
  const pares = emparejarTodos(a.modelo, b.modelo, t.p, 1e-6);
  const [ra, rb] = [resolver(a.modelo), resolver(b.modelo)];
  return { mismaMalla, u: errorU(ra, rb, pares, t.v, "u"), reacciones: errorU(ra, rb, pares, t.v, "reacciones") };
}

describe("criterio 4 de C2: metamórficas con losas", () => {
  it("reordenar todas las listas da el mismo modelo analítico, mapeo y diagnósticos, bit a bit", () => {
    for (const s of SEMILLAS) {
      const f = modelo(s);
      const r = azar(3000 + s);
      const g: ModeloFisico = { ...f, pilares: barajar(f.pilares!, r), vigas: barajar(f.vigas!, r), cargas: barajar(f.cargas!, r), losas: barajar(f.losas!, r), bandas: barajar(f.bandas!, r), secciones: barajar(f.secciones, r) };
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

  it("un ruido menor que ε_geom en las losas no cambia la malla", () => {
    for (const s of SEMILLAS) {
      const f = modelo(s);
      const r = azar(4000 + s);
      const e = (q: Vec2): Vec2 => [q[0] + (2 * r() - 1) * 1e-8, q[1] + (2 * r() - 1) * 1e-8];
      const g: ModeloFisico = { ...f, losas: f.losas!.map((l) => ({ ...l, contorno: l.contorno.map(e), huecos: l.huecos?.map((h) => h.map(e)) })) };
      const [a, b] = [valido(compilar(f)), valido(compilar(g))];
      expect(b.modelo.nudos.length, `semilla ${s}`).toBe(a.modelo.nudos.length);
      expect(b.modelo.laminas!.length, `semilla ${s}`).toBe(a.modelo.laminas!.length);
      const pares = emparejarTodos(a.modelo, b.modelo, (q) => q, 1e-6);
      expect(errorU(resolver(a.modelo), resolver(b.modelo), pares, (q) => [q[0]!, q[1]!, q[2]!], "u"), `semilla ${s}`).toBeLessThan(1e-6);
    }
  });

  it("un ruido menor que ε_snap da la misma topología de C1, con avisos", () => {
    for (const s of SEMILLAS) {
      const f = modelo(s);
      const r = azar(5000 + s);
      const e = (q: Vec2): Vec2 => [q[0] + (2 * r() - 1) * 0.015, q[1] + (2 * r() - 1) * 0.015];
      const g: ModeloFisico = {
        ...f,
        pilares: f.pilares!.map((p) => {
          const [x, y] = e([p.x, p.y]);
          return { ...p, x, y };
        }),
        vigas: f.vigas!.map((v) => ({ ...v, puntos: v.puntos.map(e) })),
        losas: f.losas!.map((l) => ({ ...l, contorno: l.contorno.map(e) })),
      };
      const [a, b] = [valido(compilar(f)), valido(compilar(g))];
      expect(Object.keys(b.mapeo.nudosPilar).sort(), `semilla ${s}`).toEqual(Object.keys(a.mapeo.nudosPilar).sort());
      expect(Object.keys(b.mapeo.piezas).sort(), `semilla ${s}`).toEqual(Object.keys(a.mapeo.piezas).sort());
      expect(b.estadisticas.huellas, `semilla ${s}`).toBe(a.estadisticas.huellas);
      expect(b.diagnosticos.some((d) => d.codigo === "topologia/fusion" || d.codigo === "losa/ajuste"), `semilla ${s}`).toBe(true);
    }
  });
});
