/**
 * Fase LV2 (`docs/fem3d/refinamiento-vigas.md`), decisión LV2-g: un cruce de vigas con pilar cuya
 * esquina cae en la triangulación se queda sin plantilla de esquina, con la malla de LV1, y se avisa
 * (`malla/esquina-sin-refinar`) con los pilares del cruce.
 * En la retícula de 4 × 4 de la fase LV, los cruces de las cuatro esquinas del hueco de la escalera
 * (P12-10, P12-15, P18-10 y P18-15): allí están las peores estaciones de las franjas de LV2 (X13 y X19).
 *
 * Decisión LV2-f: en un pilar que atraviesa el ancho de una viga, sólo son rígidos los nudos de la
 * huella o su borde, no los de fuera a ≤ ε_snap (C2-d). En la retícula al azar 1 (22 pilares que asoman
 * de su viga), la regla de antes (LV1) deja más de 100 fuera de las huellas.
 * Y el respaldo de una planta que sólo refina esquinas avisa sin nombrar pilares (§10).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioReticular } from "../../validacion/c4/modelos.ts";
import { conAcciones } from "../../validacion/c5/modelos.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { reticulaAleatoria } from "../pruebas/reticulasAleatorias.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "./fisico.ts";
import { distanciaAHuella, huellaPilar } from "./geometria2d.ts";
import { conRespaldoRefino, type ResultadoMalla } from "./mallado.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const fisico = conAcciones(edificioReticular(1, 3, 3));
const avisos = (op: OpcionesCompilacion) => {
  const c = compilar(fisico, op);
  expect(c.valido).toBe(true);
  return c.diagnosticos.filter((d) => d.codigo === "malla/esquina-sin-refinar");
};

describe("cruces sin refinar (LV2-g)", () => {
  it("avisa de los pilares de los cruces junto al hueco, por la triangulación", () => {
    const av = avisos({ refinoEsquinas: true });
    expect(av).toHaveLength(1);
    expect(av[0]!.severidad).toBe("aviso");
    expect(av[0]!.ids).toEqual(["L-N1", "P12-10", "P12-15", "P18-10", "P18-15"]);
    expect(av[0]!.mensaje).toContain("junto a P12-10, P12-15, P18-10, P18-15");
    expect(av[0]!.mensaje).toContain("cae en la triangulación");
  });

  it("sin el refinamiento de las esquinas, o con h = 0,5 (todos los cruces caben), no avisa", () => {
    expect(avisos({ refinoEsquinas: false })).toEqual([]);
    expect(avisos({ refinoEsquinas: true, tamanoMalla: 0.5 })).toEqual([]);
  });
});

describe("sólo la huella es rígida en los pilares que atraviesa una viga (LV2-f)", () => {
  const f = reticulaAleatoria(1);
  /**
   * Nudos rígidos de cada huella fuera de ella, separados en pilares que atraviesa una viga o no. Sin
   * los de las caras de las vigas (a b/2 = 0,15 de su eje), que van a la huella por estar en la zona
   * rígida de la viga en el pilar (C1-a, `unirCaras`).
   */
  const fuera = (m: ModeloFisico, op: OpcionesCompilacion) => {
    const c = valido(compilar(m, op));
    const r = { conViga: 0, sinViga: 0 };
    (c.modelo.restricciones ?? []).forEach((x, i) => {
      const id = c.mapeo.restricciones[i]!.pilar;
      if (!x.id.endsWith(":huella") || !id) return;
      const p = m.pilares!.find((y) => y.id === id)!;
      const planta = c.mapeo.restricciones[i]!.planta;
      const sc = m.secciones.find((y) => y.id === p.seccion) as { forma: string; b: number; h: number; D?: number };
      const h = huellaPilar(p.x, p.y, p.giro ?? 0, sc.forma === "circular" ? { tipo: "circulo", D: sc.D! } : { tipo: "rectangulo", b: sc.b, h: sc.h });
      const ejes = (m.vigas ?? []).filter((v) => v.planta === planta).map((v) => v.puntos as [[number, number], [number, number]]);
      /** Distancia de un punto al eje de cada viga, si su proyección cae en ella. */
      const aEjes = (q: readonly [number, number]) =>
        ejes.flatMap(([[x0, y0], [x1, y1]]) => {
          const L = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
          const t = ((q[0] - x0) * (x1 - x0) + (q[1] - y0) * (y1 - y0)) / (L * L);
          return t >= 0 && t <= 1 ? [Math.abs((q[0] - x0) * (y1 - y0) - (q[1] - y0) * (x1 - x0)) / L] : [];
        });
      const conViga = aEjes([p.x, p.y]).some((d) => d < 1e-9);
      for (const n of x.esclavos) {
        const q = [c.modelo.nudos[n]!.x, c.modelo.nudos[n]!.y] as const;
        if (distanciaAHuella(q, h) > 1e-6 && !aEjes(q).some((d) => Math.abs(d - 0.15) < 1e-6)) r[conViga ? "conViga" : "sinViga"]++;
      }
    });
    return { r, c };
  };

  it("con LV2, ninguno fuera de las huellas de los pilares con viga; el cálculo es válido", () => {
    const { r, c } = fuera(f, { refinoEsquinas: true });
    expect(r.conViga).toBe(0);
    expect(calcular(c.modelo).valido).toBe(true);
  });

  it("con LV1 (la regla de antes), más de 100", () => {
    expect(fuera(f, { refinoEsquinas: false }).r.conViga).toBeGreaterThan(100);
  });
});

describe("respaldo de una planta que sólo refina esquinas", () => {
  it("si el refinamiento falla, el aviso es el de las esquinas y no nombra pilares (antes salía «junto a las caras de  »)", () => {
    const sinRef: ResultadoMalla = { ok: true, nudos: [], quads: [], piezas: [], piezasAncho: [], lados: [], nudosLado: [], regiones: [], calidad: { jacobianoMin: 1, bajos: 0 }, rejilla: { celdas: 0, plantillas: 0, refinadas: 0, quads: 0, cobertura: 1 }, problemas: [] };
    const conError: ResultadoMalla = { ...sinRef, problemas: [{ losa: 0, severidad: "error", codigo: "malla/lado-perdido", mensaje: "x" }] };
    const r = conRespaldoRefino(() => conError, () => ({ ...sinRef, problemas: [] }), []);
    expect(r.ok && r.problemas.map((p) => [p.codigo, p.severidad])).toEqual([["malla/esquina-sin-refinar", "aviso"]]);
    const mensaje = r.ok ? r.problemas[0]!.mensaje : "";
    expect(mensaje).toContain("esquinas de los paños");
    expect(mensaje).toContain("malla/lado-perdido");
    expect(mensaje).not.toContain("junto a las caras de");
  });
});
