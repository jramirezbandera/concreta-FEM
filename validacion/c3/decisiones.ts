/**
 * Efecto de las decisiones por defecto de C3, para que el usuario decida con números:
 * - C3-d, diafragma y dinteles (E6-3): un muro acoplado de 6 plantas (dos machones de 4 m y una puerta
 *   de 2 × 2,2 m por planta, que deja un dintel de 0,8 m) con una losa de 25 cm en cada planta y
 *   100 kN por planta en su plano. Desplazamiento de cabeza con el diafragma rígido (por defecto: los
 *   nudos de lo alto de los dinteles entran), con los dinteles fuera del diafragma, con la losa
 *   semirrígida («ninguno», la referencia física), y sin losas (C1-e, como ETABS 15c).
 * - C3-i, viga perpendicular que acaba en un muro: viga de 30 × 60 y 6 m entre el centro de un muro
 *   de 6 m (2 plantas) y un pilar, con 30 kN/m. Momento en el extremo del muro y en el centro, con la
 *   huella de la viga en el muro (por defecto: el nudo de la viga, maestro de los nudos del muro en su
 *   canto y su ancho) y unida sólo en un nudo (quitando la huella), con tres tamaños de malla.
 * - C3-g, solape del peso de los muros con las losas, en el edificio objetivo con muros.
 *
 * Uso: node validacion/c3/decisiones.ts > validacion/c3/out_decisiones.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { DiagramasBarras } from "../../src/motor/barras.ts";
import { calcular } from "../../src/motor/calcular.ts";
import type { ModeloAnalitico, ResultadoCaso } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { valido } from "../../src/pruebas/metamorficasFisicas.ts";
import { edificioObjetivoMuros } from "./modelos.ts";

const resolver = (m: ModeloAnalitico) => casosValidos(calcular(m));

// C3-d: muro acoplado con losas
function acoplado(diafragma: "rigido" | "ninguno", conLosas: boolean): ModeloFisico {
  const n = 6;
  const plantas = Array.from({ length: n + 1 }, (_, i) => ({ id: `N${n - i}`, altura: i === 0 ? null : 3, ...(i < n ? { diafragma } : {}) }));
  const huecos = Array.from({ length: n }, (_, k) => ({ desde: 4, hasta: 6, z0: 3 * k, z1: 3 * k + 2.2 }));
  return {
    plantas,
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25, peso: 0 }],
    secciones: [],
    muros: [{ id: "M", puntos: [[0, 0], [10, 0]], desde: "N0", hasta: `N${n}`, espesor: 0.25, material: "HA", huecos }],
    losas: conLosas ? Array.from({ length: n }, (_, k) => ({ id: `L${k + 1}`, planta: `N${k + 1}`, contorno: [[-2, -3], [12, -3], [12, 3], [-2, 3]] as [number, number][], espesor: 0.25, material: "HA", pp: 0 })) : [],
    casos: [{ id: "H" }],
    cargas: Array.from({ length: n }, (_, k) => ({ tipo: "puntual" as const, id: `F${k + 1}`, caso: "H", planta: `N${k + 1}`, x: 0, y: 0, F: [100, 0, 0] as [number, number, number] })),
  };
}

/** Saca del diafragma los nudos de lo alto de los dinteles (x entre 4 y 6, y = 0, en la cota de una planta). */
function sinDinteles(m: ModeloAnalitico): ModeloAnalitico {
  const dintel = (i: number) => {
    const v = m.nudos[i]!;
    return Math.abs(v.y) < 1e-9 && v.x > 4 + 1e-9 && v.x < 6 - 1e-9 && Math.abs(v.z / 3 - Math.round(v.z / 3)) < 1e-9 && v.z > 0;
  };
  return { ...m, restricciones: m.restricciones!.map((r) => (r.tipo === "diafragma" ? { ...r, esclavos: r.esclavos.filter((s) => !dintel(s)) } : r)) };
}

function cabeza(m: ModeloAnalitico, c: ResultadoCaso): number {
  const n = m.nudos.findIndex((v) => Math.abs(v.x) < 1e-9 && Math.abs(v.y) < 1e-9 && Math.abs(v.z - 18) < 1e-9);
  return c.u[6 * n]!;
}

// C3-i: viga perpendicular que acaba en un muro
function vigaPerpendicular(): ModeloFisico {
  return {
    plantas: [
      { id: "N2", altura: null, diafragma: "ninguno" },
      { id: "N1", altura: 3, diafragma: "ninguno" },
      { id: "N0", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25, peso: 0 }],
    secciones: [
      { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.6 },
      { id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
    ],
    muros: [{ id: "M", puntos: [[0, 0], [6, 0]], desde: "N0", hasta: "N2", espesor: 0.25, material: "HA" }],
    pilares: [{ id: "P", x: 3, y: 6, desde: "N0", hasta: "N1", seccion: "p" }],
    vigas: [{ id: "V", planta: "N1", puntos: [[3, 0], [3, 6]], seccion: "v" }],
    casos: [{ id: "Q" }],
    cargas: [{ tipo: "viga", id: "q", caso: "Q", viga: "V", ejes: "global", q: [0, 0, -30] }],
  };
}

/** El modelo sin las huellas de las vigas en los muros: la viga, unida sólo en un nudo. */
function sinHuella(m: ModeloAnalitico): ModeloAnalitico {
  return { ...m, restricciones: m.restricciones!.filter((r) => !r.id.endsWith(":huella-muro")) };
}

function medirViga(m: ModeloAnalitico, piezas: Record<string, number[]>): { extremo: number; vano: number } {
  const [c] = resolver(m);
  const b = piezas.V![0]!;
  const d = new DiagramasBarras(m).diagrama(b, 0, c!);
  return { extremo: d.esfuerzosEn(0, 1)[4]!, vano: d.esfuerzosEn(d.L / 2, 1)[4]! };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const op: OpcionesCompilacion = {};
  console.log(`# validacion/c3/decisiones.ts — ${new Date().toLocaleDateString("sv-SE")}`);

  console.log("\n## C3-d: diafragma y dinteles en un muro acoplado de 6 plantas (desplazamiento de cabeza, mm)");
  const rigido = valido(compilar(acoplado("rigido", true), op));
  const semi = valido(compilar(acoplado("ninguno", true), op));
  const sinLosaRigido = valido(compilar(acoplado("rigido", false), op));
  const variantes: [string, ModeloAnalitico][] = [
    ["losas, diafragma rígido con los dinteles (por defecto)", rigido.modelo],
    ["losas, diafragma rígido sin los dinteles", sinDinteles(rigido.modelo)],
    ["losas semirrígidas (la membrana; referencia física)", semi.modelo],
    ["sin losas, diafragma rígido con los dinteles (C1-e, ETABS 15c)", sinLosaRigido.modelo],
    ["sin losas, diafragma rígido sin los dinteles (SAP2000 15c)", sinDinteles(sinLosaRigido.modelo)],
  ];
  const ref = cabeza(semi.modelo, resolver(semi.modelo)[0]!);
  for (const [nombre, m] of variantes) {
    const u = cabeza(m, resolver(m)[0]!);
    console.log(`- ${nombre}: ${(u * 1e3).toFixed(3)} mm (${((u / ref - 1) * 100).toFixed(1)} % frente a la semirrígida)`);
  }

  console.log("\n## C3-i: viga perpendicular de 6 m que acaba en un muro (M en el extremo del muro y en el centro, kN·m)");
  for (const h of [0.75, 0.375, 0.1875]) {
    const r = valido(compilar(vigaPerpendicular(), { tamanoMalla: h }));
    const huella = medirViga(r.modelo, r.mapeo.piezas);
    const punto = medirViga(sinHuella(r.modelo), r.mapeo.piezas);
    const esclavos = r.modelo.restricciones!.filter((x) => x.id.endsWith(":huella-muro")).reduce((s, x) => s + x.esclavos.length, 0);
    console.log(
      `- h = ${h}: con huella (${esclavos} nudos) M extremo ${huella.extremo.toFixed(2)}, M vano ${huella.vano.toFixed(2)}; en un nudo M extremo ${punto.extremo.toFixed(2)} (${((punto.extremo / huella.extremo - 1) * 100).toFixed(1)} %), M vano ${punto.vano.toFixed(2)} (${((punto.vano / huella.vano - 1) * 100).toFixed(1)} %)`,
    );
  }

  console.log("\n## C3-g: solape del peso de los muros con las losas en el edificio objetivo con muros");
  const f = edificioObjetivoMuros();
  const r = valido(compilar(f, op));
  const m = r.modelo;
  const G = m.casos.findIndex((c) => c.id === "G");
  const deMuro = new Set(Object.values(r.mapeo.muros!).flat());
  let peso = 0;
  for (const cl of m.casos[G]!.laminas ?? []) {
    if (cl.tipo !== "superficie" || !deMuro.has(cl.lamina) || typeof cl.q[0] !== "number") continue;
    const X = m.laminas![cl.lamina]!.nudos.map((n) => m.nudos[n]!);
    const area = Math.hypot(X[1]!.x - X[0]!.x, X[1]!.y - X[0]!.y) * (X[3]!.z - X[0]!.z);
    peso += -(cl.q[2] as number) * area;
  }
  const muros = new Set(Object.keys(r.mapeo.muros!));
  let solape = 0;
  for (const cn of m.casos[G]!.nodales ?? []) if (cn.f[2] > 0 && r.mapeo.nudos[cn.nudo]!.fisicos.some((x) => muros.has(x))) solape += cn.f[2];
  console.log(`- peso de los muros (γ·t·alzado sin huecos): ${peso.toFixed(1)} kN; solape que se quita: ${solape.toFixed(1)} kN (${((100 * solape) / peso).toFixed(1)} %)`);
}
