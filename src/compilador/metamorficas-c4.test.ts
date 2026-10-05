/**
 * Criterio 4 de C4: relaciones metamórficas con forjados, sobre modelos al azar con paños y
 * reticulares (`forjadosAleatorios.ts`):
 * - reordenar todas las listas (también los ábacos) da el mismo modelo analítico, mapeo y
 *   diagnósticos, bit a bit;
 * - una traslación y un giro (de 90° y de 37°) dan las mismas viguetas y la misma malla, y los
 *   resultados transformados;
 * - un ruido menor que ε_geom en los paños no cambia nada;
 * - invertir el sentido del contorno de los paños y girar su dirección 180° da los mismos resultados;
 * - partir un paño por una viga interior perpendicular a sus viguetas da los mismos resultados.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import type { ModeloAnalitico } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { azar, fisicoAleatorio } from "../pruebas/fisicoAleatorio.ts";
import { conForjadosAleatorios } from "../pruebas/forjadosAleatorios.ts";
import { barajar, emparejarTodos, errorU, planos, relacionPlanoC2, valido } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import type { CargaFisica, ModeloFisico, PanoUnidireccional, Vec2 } from "./fisico.ts";

const SEMILLAS = [1, 3, 5, 7, 10];
const modelo = (s: number) => conForjadosAleatorios(fisicoAleatorio(s), s);
const unidireccional = (s: number) => conForjadosAleatorios(fisicoAleatorio(s), s, { tipo: "unidireccional" });
const resolver = (m: ModeloAnalitico) => casosValidos(calcular(m));
const identidad = (q: readonly number[]): [number, number, number] => [q[0]!, q[1]!, q[2]!];

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

/** Los mismos resultados en los nudos de las mismas posiciones. */
function mismosResultados(f: ModeloFisico, g: ModeloFisico): { u: number; reacciones: number } {
  const [a, b] = [valido(compilar(f)), valido(compilar(g))];
  expect(b.modelo.nudos.length).toBe(a.modelo.nudos.length);
  const pares = emparejarTodos(a.modelo, b.modelo, (q) => q, 1e-9);
  const [ra, rb] = [resolver(a.modelo), resolver(b.modelo)];
  return { u: errorU(ra, rb, pares, identidad, "u"), reacciones: errorU(ra, rb, pares, identidad, "reacciones") };
}

describe("criterio 4 de C4: metamórficas con forjados", () => {
  it("reordenar todas las listas (también los ábacos) da el mismo modelo analítico, mapeo y diagnósticos, bit a bit", () => {
    for (const s of SEMILLAS) {
      const f = modelo(s);
      const r = azar(3200 + s);
      const losas = (f.losas ?? []).map((l) => (l.reticular?.abacos ? { ...l, reticular: { ...l.reticular, abacos: barajar(l.reticular.abacos, r) } } : l));
      const g: ModeloFisico = { ...f, pilares: barajar(f.pilares!, r), vigas: barajar(f.vigas!, r), cargas: barajar(f.cargas!, r), secciones: barajar(f.secciones, r), ...(f.losas ? { losas: barajar(losas, r) } : {}), ...(f.panos ? { panos: barajar(f.panos, r) } : {}) };
      const [a, b] = [valido(compilar(f)), valido(compilar(g))];
      expect(JSON.stringify(b.modelo) === JSON.stringify(a.modelo), `semilla ${s}`).toBe(true);
      expect(JSON.stringify(b.mapeo) === JSON.stringify(a.mapeo), `semilla ${s}`).toBe(true);
      expect(JSON.stringify(b.diagnosticos) === JSON.stringify(a.diagnosticos), `semilla ${s}`).toBe(true);
      expect(b.huella, `semilla ${s}`).toBe(a.huella);
    }
  });

  for (const { nombre, t } of planos()) {
    it(`${nombre}: las mismas viguetas y la misma malla, y los resultados transformados`, () => {
      for (const s of SEMILLAS) {
        const e = relacionPlanoC2(modelo(s), t);
        expect(e.mismaMalla, `semilla ${s}`).toBe(true);
        expect(e.u, `semilla ${s}`).toBeLessThan(1e-9);
        expect(e.reacciones, `semilla ${s}`).toBeLessThan(1e-9);
      }
    });
  }

  it("un ruido menor que ε_geom en los paños no cambia las viguetas ni los resultados", () => {
    for (const s of SEMILLAS) {
      const f = unidireccional(s);
      const r = azar(4200 + s);
      const e = (q: Vec2): Vec2 => [q[0] + (2 * r() - 1) * 1e-8, q[1] + (2 * r() - 1) * 1e-8];
      const g: ModeloFisico = { ...f, panos: f.panos!.map((p) => ({ ...p, contorno: p.contorno.map(e), huecos: p.huecos?.map((h) => h.map(e)) })) };
      const [a, b] = [valido(compilar(f)), valido(compilar(g))];
      expect(b.modelo.nudos.length, `semilla ${s}`).toBe(a.modelo.nudos.length);
      expect((b.modelo.barras ?? []).length, `semilla ${s}`).toBe((a.modelo.barras ?? []).length);
      expect(JSON.stringify(b.mapeo.panos), `semilla ${s}`).toBe(JSON.stringify(a.mapeo.panos));
      const pares = emparejarTodos(a.modelo, b.modelo, (q) => q, 1e-6);
      expect(errorU(resolver(a.modelo), resolver(b.modelo), pares, identidad, "u"), `semilla ${s}`).toBeLessThan(1e-6);
    }
  });

  it("invertir el sentido del contorno de los paños y girar su dirección 180° da los mismos resultados", () => {
    for (const s of SEMILLAS) {
      const f = unidireccional(s);
      const panos: PanoUnidireccional[] = f.panos!.map((p) => ({ ...p, contorno: [...p.contorno].reverse(), huecos: p.huecos?.map((h) => [...h].reverse()), direccion: p.direccion + 180 }));
      const e = mismosResultados(f, { ...f, panos });
      expect(e.u, `semilla ${s}`).toBeLessThan(1e-9);
      expect(e.reacciones, `semilla ${s}`).toBeLessThan(1e-9);
    }
  });

  it("partir un paño por la viga secundaria que cruzan sus viguetas da los mismos resultados", () => {
    let partidos = 0;
    for (const s of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const f = unidireccional(s);
      const panos: PanoUnidireccional[] = [];
      const cargas: CargaFisica[] = [...f.cargas!];
      for (const p of f.panos!) {
        const m = /^F(\d+)-(\d+)-(.+)$/.exec(p.id);
        const sec = m ? f.vigas!.find((v) => v.id === `S${m[1]}-${m[2]}-${m[3]}`) : undefined;
        if (!sec) {
          panos.push(p);
          continue;
        }
        const ym = sec.puntos[0]![1];
        const [[x0, y0], [x1], , [, y1]] = p.contorno as [Vec2, Vec2, Vec2, Vec2];
        const abajo = (p.huecos ?? []).filter((h) => h.every((q) => q[1] < ym));
        const arriba = (p.huecos ?? []).filter((h) => h.every((q) => q[1] > ym));
        panos.push({ ...p, id: `${p.id}a`, contorno: [[x0, y0], [x1, y0], [x1, ym], [x0, ym]], huecos: abajo });
        panos.push({ ...p, id: `${p.id}b`, contorno: [[x0, ym], [x1, ym], [x1, y1], [x0, y1]], huecos: arriba });
        for (let k = 0; k < cargas.length; k++) {
          const c = cargas[k]!;
          if (c.tipo === "superficie" && c.pano === p.id) cargas.splice(k--, 1, { ...c, id: `${c.id}a`, pano: `${p.id}a` }, { ...c, id: `${c.id}b`, pano: `${p.id}b` });
        }
        partidos++;
      }
      if (panos.length === f.panos!.length) continue;
      const e = mismosResultados(f, { ...f, panos, cargas });
      expect(e.u, `semilla ${s}`).toBeLessThan(1e-9);
      expect(e.reacciones, `semilla ${s}`).toBeLessThan(1e-9);
    }
    expect(partidos).toBeGreaterThan(3);
  });
});
