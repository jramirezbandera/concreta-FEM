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
import type { ModeloAnalitico } from "../motor/modelo.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { azar, fisicoAleatorio } from "../pruebas/fisicoAleatorio.ts";
import { conLosasAleatorias } from "../pruebas/losasAleatorias.ts";
import { barajar, emparejarTodos, errorU, planos, relacionPlanoC2, valido } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico, Vec2 } from "./fisico.ts";

const SEMILLAS = [1, 2, 3, 4, 6, 9];
const modelo = (s: number) => conLosasAleatorias(fisicoAleatorio(s), s);
const resolver = (m: ModeloAnalitico) => casosValidos(calcular(m));

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

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
