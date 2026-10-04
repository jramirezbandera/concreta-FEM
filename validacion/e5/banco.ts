/**
 * Banco de E5 (criterio 6): el edificio objetivo de D9/H52 de los bancos de E1–E3 (7 plantas,
 * 10 × 8 pilares, luces de 6 m, malla de 0,75 m, barras de E2, láminas de E3, huellas, diafragma
 * rígido y 24 casos). Mide lo que añade E5 sobre un cálculo hecho:
 * - CamposLaminas: preparación (regiones) y SPR completo de un caso (la primera vez, con los
 *   parches; la segunda, sólo los valores), que es lo que pide un mapa;
 * - Cortes por fuerzas nodales con los 24 casos: una planta (z = 3 m, pilares y muros) y un corte
 *   vertical de todo el edificio (x = 3 m, atraviesa los 7 diafragmas), con su error de equilibrio
 *   frente a las cargas y reacciones del lado A (validacion/e5/cortes.ts);
 * - una banda de pilar por campos fuera de la malla (x = 25,1 m, planta 4), con los 24 casos.
 *
 * Uso: node validacion/e5/banco.ts [malla]   (o bun) → una línea JSON
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../src/motor/calcular.ts";
import { CamposLaminas } from "../../src/motor/campos.ts";
import { Cortes, type Corte } from "../../src/motor/cortes.ts";
import type { CargaLamina, CasoCarga, Vec3 } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { edificio } from "../../src/pruebas/edificio.ts";
import { errorEquilibrioCorte } from "./cortes.ts";

const raiz = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const malla = Number(process.argv[2] ?? 0.75);
const motor = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined" ? "bun" : `node ${process.version}`;

// El modelo del banco de E3, con sus 24 casos
const e = edificio({ vanosX: 9, vanosY: 7, luzX: 6, luzY: 6, plantas: 7, altura: 3, malla, huella: malla, vigas: true, muro: true, diafragma: true, barrasE2: true, laminasE3: true });
const por = (v: Vec3 | undefined, f: number) => v && (v.map((x) => x * f) as unknown as Vec3);
const escalarLamina = (c: CargaLamina, f: number): CargaLamina => {
  if (c.tipo === "superficie") return { ...c, q: Array.isArray(c.q[0]) ? ((c.q as readonly Vec3[]).map((q) => por(q, f)!) as never) : por(c.q as Vec3, f)! };
  if (c.tipo === "linea") return { ...c, qa: por(c.qa, f)!, qb: por(c.qb, f) };
  return { ...c, F: por(c.F, f), M: por(c.M, f) };
};
const base = e.modelo.casos;
const casosDef: CasoCarga[] = [];
for (let k = 0; casosDef.length < 24; k++) {
  const c = base[k % base.length]!;
  const f = 1 + 0.1 * Math.floor(k / base.length);
  casosDef.push({
    id: `${c.id}·${f.toFixed(1)}`,
    nodales: c.nodales?.map((n) => ({ ...n, f: n.f.map((v) => v * f) as never })),
    impuestos: c.impuestos?.map((d) => ({ ...d, valor: d.valor * f })),
    barras: c.barras?.map((cb) => (cb.tipo === "puntual" ? { ...cb, F: cb.F && (cb.F.map((v) => v * f) as never) } : { ...cb, qa: cb.qa.map((v) => v * f) as never, qb: cb.qb && (cb.qb.map((v) => v * f) as never) })),
    laminas: c.laminas?.map((cl) => escalarLamina(cl, f)),
  });
}
const modelo = { ...e.modelo, casos: casosDef };
const t0 = performance.now();
const casos = casosValidos(calcular(modelo));
const tCalculo = performance.now() - t0;

const reloj = <T>(f: () => T): [T, number] => {
  const t = performance.now();
  const r = f();
  return [r, performance.now() - t];
};
const [campos, tCampos] = reloj(() => new CamposLaminas(modelo));
const [, tSpr1] = reloj(() => campos.nodales(casos[0]!.u));
const [nodales2, tSpr2] = reloj(() => campos.nodales(casos[1]!.u));
const [cortes, tCortes] = reloj(() => new Cortes(modelo));
const grande = [-1000, 1000] as const;
const planta: Corte = { id: "planta 1", origen: [27, 21, 3], x: [0, 0, 1], vz: [1, 0, 0], y: grande, z: grande };
const vertical: Corte = { id: "x = 3", origen: [3, 21, 10.5], x: [1, 0, 0], vz: [0, 0, 1], y: grande, z: grande };
const banda: Corte = { id: "banda de pilar fuera de la malla", origen: [25.1, 18, 12], x: [1, 0, 0], vz: [0, 0, 1], y: [-1.5, 1.5], metodo: "campos" };
const [rPlanta, tPlanta] = reloj(() => cortes.cortar(planta, casos));
const [rVertical, tVertical] = reloj(() => cortes.cortar(vertical, casos));
const [rBanda, tBanda] = reloj(() => cortes.cortar(banda, casos, campos));
const [eqPlanta, tEqPlanta] = reloj(() => errorEquilibrioCorte(modelo, planta, casos, rPlanta));
const eqVertical = errorEquilibrioCorte(modelo, vertical, casos, rVertical);

console.log(
  JSON.stringify({
    motor,
    malla,
    nudos: modelo.nudos.length,
    laminas: modelo.laminas!.length,
    barras: modelo.barras!.length,
    casos: casos.length,
    calculoMs: Math.round(tCalculo),
    campos: {
      regiones: campos.regiones.length,
      plazas: campos.nPlazas,
      prepararMs: Math.round(tCampos),
      sprPrimerCasoMs: Math.round(tSpr1),
      sprOtroCasoMs: Math.round(tSpr2),
      finitos: nodales2.every(Number.isFinite),
    },
    cortes: {
      prepararMs: Math.round(tCortes),
      planta: { ms: Math.round(tPlanta), laminas: rPlanta.laminas.length, barras: rPlanta.barras.length, restricciones: rPlanta.restricciones.length, equilibrio: eqPlanta, diagnosticos: rPlanta.diagnosticos.map((d) => d.codigo) },
      vertical: { ms: Math.round(tVertical), laminas: rVertical.laminas.length, barras: rVertical.barras.length, restricciones: rVertical.restricciones.length, equilibrio: eqVertical, diagnosticos: rVertical.diagnosticos.map((d) => d.codigo) },
      banda: { ms: Math.round(tBanda), laminas: rBanda.laminas.length, muestras: rBanda.muestras!.pesos.length, diagnosticos: rBanda.diagnosticos.map((d) => d.codigo) },
      oraculoEquilibrioMs: Math.round(tEqPlanta),
    },
    rssMB: Math.round(process.memoryUsage().rss / 2 ** 20),
  }),
);
