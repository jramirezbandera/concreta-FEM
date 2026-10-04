/**
 * E4 (memoria y avance, H16): límites de tamaño del dispositivo, estimación de la memoria del
 * núcleo antes de factorizar, avance por fases y ausencia de fugas en el núcleo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { iniciarNucleo, memoriaEnUsoNucleo, memoriaNucleo } from "../nucleo/index.ts";
import { edificio } from "../pruebas/edificio.ts";
import { calcular } from "./calcular.ts";
import type { ResultadoCalculo } from "./modelo.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const modelo = () =>
  edificio({ vanosX: 2, vanosY: 2, luzX: 5, luzY: 4, plantas: 2, altura: 3, malla: 1, huella: 1, vigas: true, muro: true, diafragma: true, barrasE2: true, laminasE3: true }).modelo;

function errorUnico(r: ResultadoCalculo, codigo: string) {
  expect(r.valido).toBe(false);
  expect("casos" in r).toBe(false);
  const errores = r.diagnosticos.filter((d) => d.severidad === "error");
  expect(errores.map((d) => d.codigo)).toEqual([codigo]);
  return errores[0]!;
}

describe("límites del dispositivo", () => {
  it("sin límites (o con límites holgados) el resultado es idéntico", () => {
    const m = modelo();
    const libre = calcular(m);
    const holgado = calcular(m, { limites: { ecuaciones: 1e7, memoriaNucleo: 2 ** 32 } });
    expect(libre.valido && holgado.valido).toBe(true);
    if (!libre.valido || !holgado.valido) return;
    libre.casos.forEach((c, k) => {
      expect(holgado.casos[k]!.u).toEqual(c.u);
      expect(holgado.casos[k]!.esfuerzosLaminas).toEqual(c.esfuerzosLaminas);
    });
  });

  it("pasar de las ecuaciones da modelo/demasiado-grande tras numerar, sin factorizar", () => {
    const m = modelo();
    const n = calcular(m).estadisticas!.ecuaciones;
    const fases: string[] = [];
    const r = calcular(m, { limites: { ecuaciones: n - 1 }, alProgreso: (f) => fases.push(f) });
    const d = errorUnico(r, "modelo/demasiado-grande");
    expect(d.detalles).toEqual({ ecuaciones: n, limite: n - 1 });
    expect(d.mensaje).toContain(`${n} ecuaciones`);
    expect(fases).toEqual([]);
    expect(calcular(m, { limites: { ecuaciones: n } }).valido).toBe(true);
  });

  it("pasar de la memoria da modelo/demasiado-grande tras el análisis simbólico, sin factorizar", () => {
    const m = modelo();
    const pico = calcular(m).estadisticas!.memoriaNucleo!.picoEstimado;
    const fases: string[] = [];
    const r = calcular(m, { limites: { memoriaNucleo: pico - 1 }, alProgreso: (f) => fases.push(f) });
    const d = errorUnico(r, "modelo/demasiado-grande");
    expect(d.detalles).toMatchObject({ memoriaEstimada: pico, limite: pico - 1 });
    expect(r.estadisticas?.ecuaciones).toBeGreaterThan(0);
    expect(fases).toContain("solucion.analisis");
    expect(fases).not.toContain("solucion.factorizacion");
    expect(calcular(m, { limites: { memoriaNucleo: pico } }).valido).toBe(true);
  });

  it("el solver de perfil sólo aplica el límite de ecuaciones", () => {
    const r = calcular(modelo(), { solver: "perfil", limites: { memoriaNucleo: 1 } });
    expect(r.valido).toBe(true);
    expect(r.estadisticas!.memoriaNucleo).toBeUndefined();
  });
});

describe("memoria del núcleo", () => {
  it("la estimación cubre la memoria lineal real y el núcleo no pierde memoria al repetir", () => {
    const m = modelo();
    calcular(m); // la primera vez el núcleo reserva sus búferes fijos (gemm)
    const enUso = memoriaEnUsoNucleo();
    for (let k = 0; k < 3; k++) {
      const r = calcular(m);
      expect(r.valido).toBe(true);
      const est = r.estadisticas!.memoriaNucleo!;
      expect(est.requerida).toBeGreaterThan(0);
      expect(memoriaNucleo()).toBeLessThanOrEqual(est.picoEstimado);
      expect(memoriaEnUsoNucleo()).toBe(enUso);
    }
  });
});

describe("avance", () => {
  it("una llamada por fase, en orden, con las mismas duraciones que las estadísticas", () => {
    const vistos: [string, number][] = [];
    const r = calcular(modelo(), { alProgreso: (f, ms) => vistos.push([f, ms]) });
    expect(r.valido).toBe(true);
    expect(vistos.map(([f]) => f)).toEqual([
      "numeracion",
      "cargas",
      "patron",
      "ensamblado",
      "solucion.analisis",
      "solucion.factorizacion",
      "solucion.resolucion",
      "solucion.residuo",
      "solucion",
      "recuperacion",
    ]);
    for (const [f, ms] of vistos) expect(r.estadisticas!.tiempos[f]).toBe(ms);
  });
});
