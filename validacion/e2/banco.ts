/**
 * Banco de tamaño de E2: el edificio objetivo de D9/H52 (el del banco de E1) con las barras de E2:
 * pilares y vigas de Timoshenko con zonas rígidas, vigas descolgadas, rótulas y cargas de barra
 * en los 24 casos. 7 plantas, 10×8 = 80 pilares por planta, luces de 6 m, malla de 0,75 m,
 * huella de enlaces rígidos y 24 casos de carga (los 5 del generador repetidos con factores).
 *
 * Uso: node validacion/e2/banco.ts [diafragma|semirrigido|ambos] [malla]
 *      bun validacion/e2/banco.ts …
 * Escribe una línea por variante con los tiempos de cada fase y la memoria.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../src/motor/calcular.ts";
import type { CasoCarga } from "../../src/motor/modelo.ts";
import { iniciarNucleo, memoriaNucleo } from "../../src/nucleo/index.ts";
import { edificio } from "../../src/pruebas/edificio.ts";

const raiz = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const modo = process.argv[2] ?? "ambos";
const malla = Number(process.argv[3] ?? 0.75);
const motor = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined" ? "bun" : `node ${process.version}`;

for (const diafragma of modo === "ambos" ? [true, false] : [modo === "diafragma"]) {
  const t0 = performance.now();
  const e = edificio({ vanosX: 9, vanosY: 7, luzX: 6, luzY: 6, plantas: 7, altura: 3, malla, huella: malla, vigas: true, muro: true, diafragma, barrasE2: true });
  // 24 casos: los 5 del generador con factores distintos
  const base = e.modelo.casos;
  const casos: CasoCarga[] = [];
  for (let k = 0; casos.length < 24; k++) {
    const c = base[k % base.length]!;
    const f = 1 + 0.1 * Math.floor(k / base.length);
    casos.push({
      id: `${c.id}·${f.toFixed(1)}`,
      nodales: c.nodales?.map((n) => ({ ...n, f: n.f.map((v) => v * f) as never })),
      impuestos: c.impuestos?.map((d) => ({ ...d, valor: d.valor * f })),
      barras: c.barras?.map((cb) => (cb.tipo === "puntual" ? { ...cb, F: cb.F && (cb.F.map((v) => v * f) as never) } : { ...cb, qa: cb.qa.map((v) => v * f) as never, qb: cb.qb && (cb.qb.map((v) => v * f) as never) })),
    });
  }
  const modelo = { ...e.modelo, casos };
  const tGen = performance.now() - t0;
  const t1 = performance.now();
  const r = calcular(modelo);
  const total = performance.now() - t1;
  const est = r.estadisticas!;
  const peorEq = r.valido ? Math.max(...r.casos.map((c) => Math.max(c.equilibrio.fuerzas, c.equilibrio.momentos))) : NaN;
  const peorRes = r.valido ? Math.max(...r.casos.map((c) => c.residuo)) : NaN;
  console.log(
    JSON.stringify({
      motor,
      variante: diafragma ? "diafragma rígido" : "semirrígido (sin diafragma)",
      malla,
      valido: r.valido,
      diagnosticos: r.diagnosticos.map((d) => `${d.severidad} ${d.codigo}`),
      nudos: est.nudos,
      elementos: (modelo.barras?.length ?? 0) + (modelo.laminas?.length ?? 0),
      barras: modelo.barras?.length ?? 0,
      cargasDeBarra: casos.reduce((s, c) => s + (c.barras?.length ?? 0), 0),
      ecuaciones: est.ecuaciones,
      esclavos: est.esclavos,
      nnzK: est.nnzK,
      nnzL: est.nnzL,
      pasosRefinamiento: est.pasosRefinamiento,
      generarMs: Math.round(tGen),
      tiemposMs: Object.fromEntries(Object.entries(est.tiempos).map(([k, v]) => [k, Math.round(v)])),
      totalMs: Math.round(total),
      peorEquilibrio: peorEq,
      peorResiduo: peorRes,
      heapJsMB: Math.round(process.memoryUsage().heapUsed / 2 ** 20),
      rssMB: Math.round(process.memoryUsage().rss / 2 ** 20),
      wasmMB: Math.round(memoriaNucleo() / 2 ** 20),
    }),
  );
}
