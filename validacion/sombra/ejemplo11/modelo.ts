/**
 * Prueba en sombra del ejemplo 11 del usuario (CYPECAD 2027, «prueba.c3e», 2026-11-08; el listado, el
 * DWG y las capturas en `ejemplos/ejemplo 1 6x6/ejemplo 11/`): tres plantas de 3 m de 2 × 2 vanos de
 * 6 m (pilares de 30 × 30 de HA-25 en una retícula de 0, 6 y 12 m), reticular 25+5 de casetón perdido
 * a 72/12 (4,487 kN/m²) con vigas planas de 30 × 30 en el perímetro y los ábacos automáticos de
 * CYPECAD, CM 2 kN/m² y 3 kN/m en el perímetro, uso A 2 kN/m², viento (zona A, aspereza I) y sismo
 * (ab 0,11 g, K 1, suelo II, ductilidad baja, CQC).
 *
 * Escribe el proyecto de cada variante en `.datos/<variante>/proyecto.json`; la de por defecto
 * (`cype`) también en `ejemplos/ejemplo 1 6x6/proyecto.json`, para abrirla en la app.
 *
 * Variantes:
 * - `cype`: los ábacos de CYPECAD (por los nudos del listado: bordes en x = 1,10 / 4,90 / 7,38 /
 *   10,86 e y = 1,17 / 4,65 / 7,13 / 7,65 / 10,41 / 10,73), la retícula de casetones del DWG (punto de
 *   paso de los nervios en (0,84; 1,11)), la CQC y el viento con el ancho de banda de CYPECAD (18 m;
 *   ver `fachadas`), sin excentricidad accidental en el sismo (CYPECAD no la lista);
 * - `cype-e`: lo mismo con la excentricidad accidental del 5 % (la de por defecto del motor);
 * - `luces`: los ábacos de AC-e (`proponerAbacosLuces`) en lugar de los de CYPECAD;
 * - `srss`: la regla por defecto del motor (art. 3.6.2.4) en lugar de la CQC;
 * - `viento-modelo`: el viento con el ancho y la profundidad que salen del modelo (12,3 m);
 * - `h0375`, `h025`: `cype` con la malla de 0,375 m o de 0,25 m (por defecto, 0,75); `<variante>-h025`, otra
 *   variante con esa malla.
 *
 *   bun validacion/sombra/ejemplo11/modelo.ts [<variante> ...]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModeloFisico, Vec2 } from "../../../src/compilador/fisico.ts";
import { proponerAbacosLuces } from "../../../src/editor/abacos.ts";
import { coeficientesEolicos } from "../../../src/normas/cteViento.ts";

const AQUI = import.meta.dirname;
const RAIZ = join(AQUI, "..", "..", "..");

const R = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const PLANTAS = ["F3", "F2", "F1"] as const;
const PILARES: [string, number, number][] = [
  ["P1", 0, 0], ["P2", 6, 0], ["P3", 12, 0],
  ["P4", 0, 6], ["P5", 6, 6], ["P6", 12, 6],
  ["P7", 0, 12], ["P8", 6, 12], ["P9", 12, 12],
];
/** Las vigas de CYPECAD, una por vano (sus «Pórticos» 1 a 4: y = 0, y = 12, x = 0, x = 12). */
const VIGAS: [string, Vec2, Vec2][] = [
  ["P1-P2", [0, 0], [6, 0]], ["P2-P3", [6, 0], [12, 0]],
  ["P7-P8", [0, 12], [6, 12]], ["P8-P9", [6, 12], [12, 12]],
  ["P1-P4", [0, 0], [0, 6]], ["P4-P7", [0, 6], [0, 12]],
  ["P3-P6", [12, 0], [12, 6]], ["P6-P9", [12, 6], [12, 12]],
];
/** Los ábacos automáticos de CYPECAD, iguales en las tres plantas (`ejemplos/…/1.pdf`, §6 y §7). */
const M = 0.5; // lo que sobresale de la losa (se recorta con ella)
const ABACOS_CYPE: Vec2[][] = [
  R(-M, -M, 1.10, 1.17), R(4.90, -M, 7.38, 1.17), R(10.86, -M, 12 + M, 1.17),
  R(-M, 4.65, 1.10, 7.65), R(4.90, 4.65, 7.38, 7.65), R(10.86, 4.65, 12 + M, 7.13),
  R(-M, 10.41, 1.10, 12 + M), R(4.90, 10.41, 7.38, 12 + M), R(10.86, 10.73, 12 + M, 12 + M),
];
/** El cruce de los ejes de dos nervios, de la retícula de casetones del DWG (casetones de 60 a 72). */
const PASO: Vec2 = [0.84, 1.11];
const CONTORNO = R(-0.15, -0.15, 12.15, 12.15);

export function modelo(nombreVariante: string): { nombre: string; modelo: ModeloFisico; opciones?: Record<string, unknown> } {
  // «<variante>-h025» o «-h0375»: la variante con esa malla («h025» y «h0375» solos son `cype`)
  const malla = /(?:^|-)h(025|0375)$/.exec(nombreVariante);
  const variante = malla ? nombreVariante.slice(0, malla.index) || "cype" : nombreVariante;
  const m: ModeloFisico = {
    plantas: [
      { id: "F3", nombre: "Forjado 3", altura: null },
      { id: "F2", nombre: "Forjado 2", altura: 3 },
      { id: "F1", nombre: "Forjado 1", altura: 3 },
      { id: "CIM", nombre: "Cimentación", altura: 3 },
    ],
    materiales: [{ id: "HA-25", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "P30x30", material: "HA-25", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "V30x30", material: "HA-25", forma: "rectangular", b: 0.3, h: 0.3 },
    ],
    pilares: PILARES.map(([id, x, y]) => ({ id, x, y, desde: "CIM", hasta: "F3", seccion: "P30x30" })),
    vigas: PLANTAS.flatMap((p) => VIGAS.map(([id, a, b]) => ({ id: `${p}-V${id}`, planta: p, puntos: [a, b], seccion: "V30x30" }))),
    losas: PLANTAS.map((p) => ({
      id: `L-${p}`,
      planta: p,
      contorno: CONTORNO,
      espesor: 0.3,
      material: "HA-25",
      pp: 4.487,
      reticular: { intereje: 0.72, nervio: 0.12, capa: 0.05, caseton: "perdido", paso: PASO, abacos: ABACOS_CYPE },
    })),
    casos: [
      { id: "PP", nombre: "Peso propio", pesoPropio: true, accion: { tipo: "G" } },
      { id: "CM", nombre: "Cargas muertas", accion: { tipo: "G" } },
      { id: "Qa", nombre: "Sobrecarga de uso", accion: { tipo: "Q", psi: "uso-A" } },
    ],
    cargas: PLANTAS.flatMap((p) => [
      { tipo: "superficie", id: `CM-${p}`, caso: "CM", planta: p, q: [0, 0, -2], losa: `L-${p}` },
      { tipo: "superficie", id: `Qa-${p}`, caso: "Qa", planta: p, q: [0, 0, -2], losa: `L-${p}` },
      { tipo: "lineal", id: `CM-${p}-borde`, caso: "CM", planta: p, puntos: [[0, 0], [12, 0], [12, 12], [0, 12], [0, 0]], q: [0, 0, -3] },
    ]),
    acciones: {
      viento: { zona: "A", aspereza: "I" },
      sismo: { ab: 0.11, K: 1, terreno: "II", mu: 2, regla: "cqc", excentricidad: 0 },
    },
  } as unknown as ModeloFisico;
  const a = m.acciones!;
  if (variante === "cype-e") delete (a.sismo as { excentricidad?: number }).excentricidad;
  if (variante === "srss") delete (a.sismo as { regla?: string }).regla;
  if (variante !== "viento-modelo") {
    // CYPECAD: anchos de banda de 18 m en X y en Y (y d = 18 m para la esbeltez: h/d = 0,5, cp = 0,7,
    // cs = −0,4). Con el área de la fachada de cada planta se reproduce su F = w·b·h; la esbeltez del
    // motor sale del modelo (d = 12,3 m, h/d = 0,73), así que el área lleva el cociente de los dos
    // (cp − cs) para dar la misma fuerza.
    const banda: Record<string, number> = { F3: 1.5, F2: 3, F1: 3 };
    const { cp, cs } = coeficientesEolicos(9 / 12.3);
    const cpcs = (cp - cs) / 1.1;
    (a.viento as { fachadas?: unknown }).fachadas = PLANTAS.map((p) => ({ planta: p, x: (18 * banda[p]!) / cpcs, y: (18 * banda[p]!) / cpcs }));
  }
  if (variante === "luces") {
    for (const l of m.losas!) (l.reticular as { abacos?: Vec2[][] }).abacos = [];
    for (const l of m.losas!) {
      const r = proponerAbacosLuces(m, l.id);
      if ("error" in r) throw new Error(r.error);
      if (r.solapados.length) throw new Error(`ábacos solapados: ${r.solapados.join(", ")}`);
      (l.reticular as { abacos?: Vec2[][] }).abacos = r.nuevos.map((x) => x.poligono);
    }
  }
  const opciones = malla ? { tamanoMalla: malla[1] === "025" ? 0.25 : 0.375 } : undefined;
  return { nombre: `Ejemplo 11 de CYPECAD (3 plantas, 2 × 2 vanos de 6 m), variante ${nombreVariante}`, modelo: m, opciones };
}

if (import.meta.main) {
  const variantes = process.argv.slice(2).length ? process.argv.slice(2) : ["cype"];
  for (const v of variantes) {
    const { nombre, modelo: mod, opciones } = modelo(v);
    const proyecto = { esquema: "concreta-fem/proyecto@1", nombre, modelo: mod, ...(opciones ? { opciones } : {}) };
    const dir = join(AQUI, ".datos", v);
    mkdirSync(dir, { recursive: true });
    const texto = JSON.stringify(proyecto, null, 2) + "\n";
    writeFileSync(join(dir, "proyecto.json"), texto);
    if (v === "cype") writeFileSync(join(RAIZ, "ejemplos", "ejemplo 1 6x6", "proyecto.json"), texto);
    console.log(`${v}: ${join(dir, "proyecto.json")}`);
  }
}
