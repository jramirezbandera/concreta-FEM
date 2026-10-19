/**
 * Fase HR (`docs/fem3d/huella-rigida.md`, F2-9), criterio 1: sólo la huella de verdad es rígida. En
 * ningún pilar, con ninguna opción, queda un nudo rígido fuera de su huella (a más de 10·ε_geom de su
 * borde), salvo los de las caras de las vigas en su zona rígida en el pilar (C1-a), que se descuentan.
 * Antes de la fase, con la regla de C2-d (esclavos también a ≤ ε_snap), los modelos de §2 del plan
 * tenían: el edificio objetivo de una planta con losa plana, 83 (junto al hueco); las retículas al azar
 * 1, 12 y 16, 12 cada una; la 3 × 3 mezclada con h = 0,1, 60; el edificio con h = 0,15, 191; el
 * muestrario, 8; y tres modelos de la referencia congelada de F (17, 8 y 1).
 * Y el error `losa/huellas-solapadas` sale por geometría: con dos huellas a ≤ ε_snap aunque ningún
 * nudo quede entre ellas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioObjetivoLosas } from "../../validacion/c2/modelos.ts";
import { edificioReticular } from "../../validacion/c4/modelos.ts";
import { conAcciones } from "../../validacion/c5/modelos.ts";
import { MODELOS_CONGELADOS_F } from "../../validacion/f/congelar.ts";
import { losa3x3Mezclada } from "../../validacion/f3/modelos.ts";
import { leerProyecto } from "../agente/proyecto.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { contarRigidosFuera } from "../pruebas/huellasRigidas.ts";
import { reticulaAleatoria } from "../pruebas/reticulasAleatorias.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "./fisico.ts";
import { huellasSolapadas } from "./losas.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const sinVigas = (f: ModeloFisico): ModeloFisico => ({ ...f, vigas: [], cargas: (f.cargas ?? []).filter((c) => c.tipo !== "viga") });
const proyecto = (ruta: string): ModeloFisico => {
  const p = leerProyecto(readFileSync(join(import.meta.dirname, "..", "..", ruta), "utf8"));
  if (!p.valido) throw new Error(ruta);
  return p.proyecto.modelo;
};

const MODELOS: [string, () => ModeloFisico, OpcionesCompilacion[]][] = [
  ["edificio objetivo, 1 planta, losa plana", () => sinVigas(edificioObjetivoLosas(1)), [{}, { franjas: false }, { rejilla: false }, { tamanoMalla: 0.15 }]],
  ["edificio objetivo, 1 planta, con vigas", () => conAcciones(edificioObjetivoLosas(1)), [{}, { refinoEsquinas: false }, { unionLosaViga: "eje" }]],
  ["retícula de 4 × 4 de LV", () => conAcciones(edificioReticular(1, 3, 3)), [{}, { refinoEsquinas: false }]],
  ["retícula al azar 1", () => reticulaAleatoria(1), [{}, { refinoEsquinas: false }, { unionLosaViga: "eje" }, { tamanoMalla: 0.25 }]],
  ["retícula al azar 12", () => reticulaAleatoria(12), [{}]],
  ["retícula al azar 16", () => reticulaAleatoria(16), [{}]],
  ["losa 3 × 3 mezclada", () => losa3x3Mezclada(), [{ unionLosaViga: "eje" }, { unionLosaViga: "eje", tamanoMalla: 0.15 }, { unionLosaViga: "eje", tamanoMalla: 0.1 }]],
  ["muestrario", () => proyecto("ejemplos/muestrario/proyecto.json"), [{}]],
  ["vivienda", () => proyecto("ejemplos/vivienda/proyecto.json"), [{}]],
];

describe("criterio 1 de HR: ningún nudo rígido fuera de la huella", () => {
  for (const [nombre, f, opciones] of MODELOS)
    it(nombre, () => {
      const fisico = f();
      for (const op of opciones) {
        const r = contarRigidosFuera(fisico, op);
        expect(r.detalle.map((x) => `${x.pilar}@${x.planta}: ${x.nudos.length}`), JSON.stringify(op)).toEqual([]);
        expect(r.total).toBe(0);
      }
    });

  it("los modelos de la referencia congelada de F", () => {
    for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_F)) {
      const { fisico, opciones } = f();
      expect(contarRigidosFuera(fisico, opciones).total, nombre).toBe(0);
    }
  });

  it("el edificio junto al hueco sigue calculando, y sus esclavos fuera eran los de F2-9", () => {
    const r = contarRigidosFuera(sinVigas(edificioObjetivoLosas(1)));
    expect(r.total).toBe(0);
    expect(calcular(r.c.modelo).valido).toBe(true);
  });
});

describe("huellas solapadas, por geometría", () => {
  const cuadrado = (cx: number, cy: number, l: number): [number, number][] => [
    [cx - l / 2, cy - l / 2],
    [cx + l / 2, cy - l / 2],
    [cx + l / 2, cy + l / 2],
    [cx - l / 2, cy + l / 2],
  ];
  it("se solapan, se tocan, quedan a ≤ ε_snap o se cruzan sin vértices dentro", () => {
    expect(huellasSolapadas(cuadrado(0, 0, 0.3), cuadrado(0.2, 0, 0.3), 0.05)).toBe(true);
    expect(huellasSolapadas(cuadrado(0, 0, 0.3), cuadrado(0.3, 0, 0.3), 0.05)).toBe(true);
    expect(huellasSolapadas(cuadrado(0, 0, 0.3), cuadrado(0.34, 0, 0.3), 0.05)).toBe(true);
    expect(huellasSolapadas(cuadrado(0, 0, 0.3), cuadrado(0.36, 0, 0.3), 0.05)).toBe(false);
    // Una cruz: ningún vértice dentro del otro, pero los lados se cortan
    const alto: [number, number][] = [
      [-0.1, -1],
      [0.1, -1],
      [0.1, 1],
      [-0.1, 1],
    ];
    const ancho: [number, number][] = [
      [-1, -0.1],
      [1, -0.1],
      [1, 0.1],
      [-1, 0.1],
    ];
    expect(huellasSolapadas(alto, ancho, 0.05)).toBe(true);
  });

  it("dos pilares de 30 × 30 a 32 cm (2 cm entre huellas, sin ningún nudo entre ellas) son un error", () => {
    const f = sinVigas(edificioObjetivoLosas(1));
    const p = f.pilares!.find((x) => x.id === "P6-5")!;
    const g: ModeloFisico = { ...f, pilares: [...f.pilares!, { ...p, id: "PX", x: p.x + 0.32 }] };
    const r = compilar(g);
    expect(r.valido).toBe(false);
    const e = r.diagnosticos.filter((d) => d.codigo === "losa/huellas-solapadas");
    expect(e.length).toBeGreaterThan(0);
    expect(e[0]!.ids).toEqual(["P6-5", "PX"]);
  });
});
