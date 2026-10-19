/**
 * Fase LV2 (`docs/fem3d/refinamiento-vigas.md`), decisión LV2-g: un cruce de vigas con pilar cuya
 * esquina cae en la triangulación se queda sin plantilla de esquina, con la malla de LV1, y se avisa
 * (`malla/esquina-sin-refinar`) con los pilares del cruce.
 * En la retícula de 4 × 4 de la fase LV, los cruces de las cuatro esquinas del hueco de la escalera
 * (P12-10, P12-15, P18-10 y P18-15): allí están las peores estaciones de las franjas de LV2 (X13 y X19).
 *
 * Decisión LV2-f: en un pilar que atraviesa el ancho de una viga, sólo son rígidos los nudos de la
 * huella o su borde, no los de fuera a ≤ ε_snap (C2-d). En la retícula al azar 1 (22 pilares que asoman
 * de su viga), la regla de antes (LV1) dejaba más de 100 fuera de las huellas. Desde la fase HR
 * (`huella-rigida.md`), la regla es la misma en todos los pilares y con todas las opciones
 * (`huellaRigida.test.ts`).
 * Y el respaldo de una planta que sólo refina esquinas avisa sin nombrar pilares (§10).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioReticular } from "../../validacion/c4/modelos.ts";
import { conAcciones } from "../../validacion/c5/modelos.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { contarRigidosFuera } from "../pruebas/huellasRigidas.ts";
import { reticulaAleatoria } from "../pruebas/reticulasAleatorias.ts";
import { compilar } from "./compilar.ts";
import type { OpcionesCompilacion } from "./fisico.ts";
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

describe("sólo la huella es rígida (LV2-f, y desde la fase HR en todos los pilares y con todas las opciones)", () => {
  const f = reticulaAleatoria(1);

  it("con LV2 y con LV1, ninguno fuera de las huellas (con LV1 quedaban más de 100 antes de HR); el cálculo es válido", () => {
    const lv2 = contarRigidosFuera(f, { refinoEsquinas: true });
    expect(lv2.total).toBe(0);
    expect(calcular(lv2.c.modelo).valido).toBe(true);
    expect(contarRigidosFuera(f, { refinoEsquinas: false }).total).toBe(0);
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
