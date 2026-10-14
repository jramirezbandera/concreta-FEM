/**
 * SP-6: el metro de un pilar sin cara de franja (SP-3, SP-4) por el escalón desde una recta de la malla
 * que atraviesa su huella (el eje de la viga) frente al corte directo por su cara, en la misma malla.
 * Para que la cara siga la malla se siembra con una carga lineal nula (un trazo, `losas.ts`) a lo ancho
 * de su ventana y del margen de sus cortes; las dos estaciones se calculan sobre el mismo modelo, con
 * `caraDirecta` (la recta de la cara, que ahora sigue la malla) y sin ella (el escalón).
 * Además, la estación de uso en la malla sin sembrar: el corte directo si la recta de la cara sigue la
 * malla en la ventana y, si no, el escalón (cuántas van por cada uno).
 *
 * Modelo: el trozo del edificio reticular de `sp3.ts` (3 × 3 vanos, 2 plantas). Envolventes de las
 * combinaciones ELU por defecto, por estación.
 * Uso: bun validacion/abacos/sp6.ts > validacion/abacos/out_sp6.txt
 */
import { prepararNucleo } from "../a3/revisar.ts";
import { edificioReticular } from "../c4/modelos.ts";
import { conAcciones } from "../c5/modelos.ts";
import { conjuntoCombinaciones, seleccionPorDefecto } from "../../src/agente/combinaciones.ts";
import { pilaresEnLosa, semiextension } from "../../src/compilador/bandas.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import { EsfuerzosFranjas } from "../../src/compilador/esfuerzosFranjas.ts";
import { resolverOpciones, type CargaFisica, type ModeloFisico, type OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { alineada, anchoNominal, carasFranjas, ejesArmado, tramosRecta } from "../../src/compilador/franjas.ts";
import { validar } from "../../src/compilador/validar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";

await prepararNucleo();
export const base: ModeloFisico = conAcciones(edificioReticular(2, 3, 3));

/** Las caras de los pilares sin cara de franja, sembradas como cargas lineales nulas a lo ancho de su ventana y del margen de sus cortes. */
export function sembrar(f: ModeloFisico, op: OpcionesCompilacion): ModeloFisico {
  const ro = resolverOpciones(op);
  const ctx = validar(f, ro, new Diagnosticos())!;
  const cargas: CargaFisica[] = [...(f.cargas ?? [])];
  for (const l of ctx.losas) {
    const caras = carasFranjas(ctx, l);
    const b = anchoNominal(l.losa, ro.anchoFranja);
    for (const k of [1, 2] as const) {
      const { d, n } = ejesArmado(l.losa)[k];
      const conCara = new Set(caras.filter((c) => c.direccion === k).flatMap((c) => c.pilares.map((p) => p.id)));
      for (const p of pilaresEnLosa(ctx, l)) {
        if (conCara.has(p.id) || !alineada(p.huella, d)) continue;
        const sc = p.p[0] * d[0] + p.p[1] * d[1];
        const tc = p.p[0] * n[0] + p.p[1] * n[1];
        const ed = semiextension(p.huella, d);
        for (const lado of [-1, 1] as const) {
          const sp = sc + lado * ed;
          // Más allá del margen de sus cortes (2,5h + ε_snap)
          const [lo, hi] = [tc - b / 2 - 3 * ro.tamanoMalla - ro.epsSnap, tc + b / 2 + 3 * ro.tamanoMalla + ro.epsSnap];
          for (const [a, z] of tramosRecta(l.region, d, n, sp)) {
            const [ta, tb] = [Math.max(a, lo), Math.min(z, hi)];
            if (!(tb - ta > 1e-6)) continue;
            const P = (t: number): [number, number] => [sp * d[0] + t * n[0], sp * d[1] + t * n[1]];
            cargas.push({ tipo: "lineal", id: `sp6-${p.id}-${k}${lado > 0 ? "+" : "-"}-${cargas.length}`, caso: f.casos[0]!.id, planta: l.losa.planta, puntos: [P(ta), P(tb)], q: [0, 0, 0] });
          }
        }
      }
    }
  }
  return { ...f, cargas };
}

interface Valor {
  inf: number;
  sup: number;
}
type PorCara = Map<string, Valor>;

/** Las estaciones de cara de los pilares sin cara de franja (las de SP-3/4: una sola pieza, sin cara común), con su envolvente. */
function medir(f: ModeloFisico, op: OpcionesCompilacion, opciones: { caraDirecta?: boolean }[]): { nudos: number; r: PorCara[] } {
  const c = compilar(f, op);
  if (!c.valido) throw new Error(c.diagnosticos.find((x) => x.severidad === "error")?.mensaje);
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
  const q = new Consultas(f, c, k.casos, op);
  const cj = conjuntoCombinaciones(q, seleccionPorDefecto(f.casos, "esfuerzos"));
  if (!cj.valido) throw new Error(cj.diagnosticos[0]!.mensaje);
  const ctx = validar(f, resolverOpciones(op), new Diagnosticos())!;
  const cortes = new Cortes(c.modelo);
  const sinCara = new Map<string, Set<string>>();
  for (const l of ctx.losas)
    for (const kk of [1, 2] as const) {
      const con = new Set(carasFranjas(ctx, l).filter((x) => x.direccion === kk).flatMap((x) => x.pilares.map((p) => p.id)));
      sinCara.set(`${l.losa.id}:${kk}`, new Set(pilaresEnLosa(ctx, l).filter((p) => !con.has(p.id)).map((p) => p.id)));
    }
  const r = opciones.map((o) => {
    const e = new EsfuerzosFranjas(ctx, c, k.casos, { cortes, ...o });
    const m: PorCara = new Map();
    for (const fr of e.franjas()) {
      const est = e.estaciones(fr.id)!.estaciones;
      const env = e.envolvente(fr.id, cj.valor.factores)!;
      const sc = sinCara.get(`${fr.losa}:${fr.direccion}`)!;
      est.forEach((x, j) => {
        if (x.tipo !== "cara" || x.piezas.length !== 1 || !sc.has(x.piezas[0]!)) return;
        m.set(`${fr.id}|${x.piezas[0]}|${x.s.toFixed(3)}|${x.lado}`, { inf: env[j]!.inferior, sup: env[j]!.superior });
      });
    }
    return m;
  });
  console.error(`  ${JSON.stringify(op)}${f === base ? "" : " sembrada"}: ${c.modelo.nudos.length} nudos`);
  return { nudos: c.modelo.nudos.length, r };
}

if (import.meta.main) {
const MALLAS: [string, OpcionesCompilacion][] = [
  ["0,75", { tamanoMalla: 0.75 }],
  ["0,375", { tamanoMalla: 0.375 }],
  ["0,25 ε.01", { tamanoMalla: 0.25, epsSnap: 0.01 }],
  ["0,15 ε.01", { tamanoMalla: 0.15, epsSnap: 0.01 }],
  ["0,1 ε.01", { tamanoMalla: 0.1, epsSnap: 0.01 }],
];

const pc = (x: number) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)} %`;
const filas = new Map<string, { malla: string; uso: Valor | undefined; dir: Valor; esc: Valor }[]>();
console.log("SP-6: el metro de los pilares sin cara de franja en el trozo reticular (3 × 3 vanos, 2 plantas), kN·m/m");
console.log("«directo»: corte por la recta de la cara sembrada; «escalón»: desde la recta de la malla que atraviesa la huella, en la misma malla; «uso»: la estación de uso sin sembrar (el corte directo si la recta de la cara sigue la malla en la ventana; si no, el escalón).\n");
console.log(`${"malla".padEnd(10)} ${"nudos uso".padStart(10)} ${"sembrada".padStart(9)}   caras | escalón − directo (sup ≥ 20): media, |media|, mín, máx | iguales en bits | directas en la de uso`);
for (const [nm, op] of MALLAS) {
  const uso = medir(base, op, [{}, { caraDirecta: false }]);
  // En la malla de uso, las caras por el corte directo (las que difieren del escalón)
  let directasUso = 0;
  for (const [clave, v] of uso.r[0]!) {
    const w = uso.r[1]!.get(clave);
    if (w && (w.sup !== v.sup || w.inf !== v.inf)) directasUso++;
  }
  const s = medir(sembrar(base, op), op, [{}, { caraDirecta: false }]);
  const [dir, esc] = s.r as [PorCara, PorCara];
  const es: number[] = [];
  let iguales = 0;
  for (const [clave, v] of dir) {
    const w = esc.get(clave);
    if (!w) continue;
    if (w.sup === v.sup && w.inf === v.inf) iguales++;
    let fl = filas.get(clave);
    if (!fl) filas.set(clave, (fl = []));
    fl.push({ malla: nm, uso: uso.r[0]!.get(clave), dir: v, esc: w });
    if (v.sup >= 20) es.push((w.sup - v.sup) / v.sup);
  }
  const media = es.reduce((a, x) => a + x, 0) / es.length;
  const amedia = es.reduce((a, x) => a + Math.abs(x), 0) / es.length;
  console.log(`${nm.padEnd(10)} ${String(uso.nudos).padStart(10)} ${String(s.nudos).padStart(9)}   ${String(dir.size).padStart(5)} | ${pc(media)}, ${pc(amedia)}, ${pc(Math.min(...es))}, ${pc(Math.max(...es))} (${es.length}) | ${iguales} | ${directasUso}`);
}

console.log("\nPor cara (superior; las de sup ≥ 20 en la malla más fina): uso / directo / escalón en cada malla");
const ultima = MALLAS[MALLAS.length - 1]![0];
const orden = [...filas.entries()].filter(([, fl]) => (fl.find((x) => x.malla === ultima)?.dir.sup ?? 0) >= 20).sort((a, b) => (a[0] < b[0] ? -1 : 1));
console.log(`${"franja | pilar | s | lado".padEnd(34)} ${MALLAS.map(([n]) => n.padStart(24)).join("")}`);
for (const [clave, fl] of orden)
  console.log(`${clave.padEnd(34)} ${MALLAS.map(([n]) => {
    const x = fl.find((y) => y.malla === n);
    return x ? `${(x.uso?.sup ?? NaN).toFixed(1)}/${x.dir.sup.toFixed(1)}/${x.esc.sup.toFixed(1)}`.padStart(24) : "—".padStart(24);
  }).join("")}`);
}
