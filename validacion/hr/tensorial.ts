/**
 * Fase HR, criterio 2 (`docs/fem3d/huella-rigida.md` §3.3): el oráculo externo de la rigidez de la
 * huella. La losa de 3 × 3 vanos mezclada de F3 (30 × 30 con un 40 × 40 y un 30 × 50), mallada aquí con
 * una retícula tensorial que no pasa por el mallador: líneas en las caras y el centro de cada huella,
 * en los bordes del metro de cada pilar y en el contorno, y un relleno de 0,1–0,2 m entre ellas, así
 * que ningún nudo queda a ≤ ε_snap fuera de una huella. Los pilares, como en el oráculo de F
 * (`opensees-modelos.ts`): el enlace rígido sólo en los nudos de la huella y un apoyo articulado en su
 * maestro, sin diafragma, con las cargas de superficie como nodales consistentes.
 *
 * Mide, en el metro de cada cara de cada pilar (la ventana de F-h, por fuerzas nodales):
 * - el motor en la malla tensorial (la referencia «tensorial»), y la variante «parche» (la huella como
 *   láminas 1 000 veces más rígidas, sin enlace, articulada en su centro), sólo informativa;
 * - nuestras mallas compiladas con h = 0,75, 0,5, 0,25, 0,15 y 0,1 con la regla nueva («nueva»: sólo
 *   la huella y su borde) frente a la tensorial;
 * - las mismas mallas con la regla de antes de la fase («antigua», emulada sobre el modelo compilado:
 *   los nudos de fuera a ≤ ε_snap se añaden a los esclavos de la huella), para ver F3-8 frente a un
 *   oráculo externo. Antes del paso 4 de la fase, con F3-d (el escalón con los nudos de delante).
 * Escribe también `opensees-modelos.json` (fuera del repositorio) con la malla tensorial y sus
 * estaciones para `oraculo_huella.py`, que la calcula con OpenSeesPy ASDShellQ4: el motor y OpenSees
 * tienen que coincidir en ella a ≤ 1e-6.
 *
 *   bun validacion/hr/tensorial.ts [--rapido] [--sin-antigua] > validacion/hr/out_tensorial.txt
 *   .venv312/Scripts/python.exe validacion/hr/oraculo_huella.py        → validacion/hr/out_opensees.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { distanciaAHuella } from "../../src/compilador/geometria2d.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import type { Apoyo, CargaNodal, LaminaAnalitica, ModeloAnalitico, NudoAnalitico, Restriccion } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { huellaEnPlanta } from "../../src/pruebas/huellasRigidas.ts";
import { estacionesOraculo, type EstacionOraculo } from "../f/opensees-modelos.ts";
import { losa3x3Mezclada } from "../f3/modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const RAPIDO = process.argv.includes("--rapido");
const CON_ANTIGUA = !process.argv.includes("--sin-antigua") && !RAPIDO;
const MALLAS = RAPIDO ? [0.75] : [0.75, 0.5, 0.25, 0.15, 0.1];
const fisico: ModeloFisico = losa3x3Mezclada();
const OP: OpcionesCompilacion = { unionLosaViga: "eje" };
const PLANTA = "P1";
const EPS_SNAP = 0.05;
/** Paso del relleno de la retícula tensorial (el primer nudo desde una cara queda a ≥ SEP). */
const SEP = 0.1;
const Q = -10;
const pilares = fisico.pilares!;

// ---------------------------------------------------------------------------------------------
// La retícula tensorial

const losa = fisico.losas![0]!;
const xsLosa = losa.contorno.map((p) => p[0]);
const ysLosa = losa.contorno.map((p) => p[1]);
const [X0, X1, Y0, Y1] = [Math.min(...xsLosa), Math.max(...xsLosa), Math.min(...ysLosa), Math.max(...ysLosa)];
const huellas = pilares.map((p) => {
  const h = huellaEnPlanta(fisico, p, PLANTA);
  const f = h.forma as { tipo: "rectangulo"; b: number; h: number };
  const ex = (Math.abs(h.ez[0]) * f.h) / 2 + (Math.abs(h.ey[0]) * f.b) / 2;
  const ey = (Math.abs(h.ez[1]) * f.h) / 2 + (Math.abs(h.ey[1]) * f.b) / 2;
  return { p, h, ex, ey };
});
function lineas(a: number, b: number, clave: number[]): number[] {
  const base = [...new Set([a, b, ...clave.filter((v) => v > a + 1e-9 && v < b - 1e-9)].map((v) => Number(v.toFixed(9))))].sort((x, y) => x - y);
  const out: number[] = [];
  for (let i = 0; i + 1 < base.length; i++) {
    const [u, v] = [base[i]!, base[i + 1]!];
    const n = Math.max(1, Math.floor((v - u) / SEP + 1e-9));
    for (let k = 0; k < n; k++) out.push(u + ((v - u) * k) / n);
  }
  out.push(base.at(-1)!);
  return out;
}
const XS = lineas(X0, X1, huellas.flatMap(({ p, ex }) => [p.x - ex, p.x + ex, p.x, p.x - 0.5, p.x + 0.5]));
const YS = lineas(Y0, Y1, huellas.flatMap(({ p, ey }) => [p.y - ey, p.y + ey, p.y, p.y - 0.5, p.y + 0.5]));
const nudoDe = (i: number, j: number) => i * YS.length + j;

/** La malla tensorial como modelo analítico: con el enlace rígido en la huella («enlace») o con el parche rígido («parche»). */
function modeloTensorial(material: LaminaAnalitica["material"], z: number, variante: "enlace" | "parche"): ModeloAnalitico {
  const nudos: NudoAnalitico[] = [];
  for (let i = 0; i < XS.length; i++) for (let j = 0; j < YS.length; j++) nudos.push({ id: `n${i}-${j}`, x: XS[i]!, y: YS[j]!, z });
  const enHuella = (i: number, j: number) => huellas.findIndex(({ h }) => distanciaAHuella([XS[i]!, YS[j]!], h) <= 1e-9);
  const laminas: LaminaAnalitica[] = [];
  const f = new Map<number, number>();
  for (let i = 0; i + 1 < XS.length; i++)
    for (let j = 0; j + 1 < YS.length; j++) {
      const ns: [number, number, number, number] = [nudoDe(i, j), nudoDe(i + 1, j), nudoDe(i + 1, j + 1), nudoDe(i, j + 1)];
      const dentro = variante === "parche" && [enHuella(i, j), enHuella(i + 1, j), enHuella(i + 1, j + 1), enHuella(i, j + 1)].every((k, _, a) => k >= 0 && k === a[0]);
      laminas.push({ id: `l${i}-${j}`, nudos: ns, material: dentro ? { ...material, E: 1000 * material.E } : material });
      const A = (XS[i + 1]! - XS[i]!) * (YS[j + 1]! - YS[j]!);
      for (const n of ns) f.set(n, (f.get(n) ?? 0) + (Q * A) / 4);
    }
  const restricciones: Restriccion[] = [];
  const apoyos: Apoyo[] = [];
  for (const { p, h } of huellas) {
    const esclavos: number[] = [];
    for (let i = 0; i < XS.length; i++) for (let j = 0; j < YS.length; j++) if (distanciaAHuella([XS[i]!, YS[j]!], h) <= 1e-9) esclavos.push(nudoDe(i, j));
    if (variante === "enlace") {
      nudos.push({ id: `${p.id}:maestro`, x: p.x, y: p.y, z });
      restricciones.push({ tipo: "enlace-rigido", id: `${p.id}@${PLANTA}:huella`, maestro: nudos.length - 1, esclavos });
      apoyos.push({ nudo: nudos.length - 1, coartados: [true, true, true, false, false, false] });
    } else {
      const centro = nudoDe(XS.findIndex((x) => Math.abs(x - p.x) < 1e-9), YS.findIndex((y) => Math.abs(y - p.y) < 1e-9));
      apoyos.push({ nudo: centro, coartados: [true, true, true, false, false, false] });
    }
  }
  const nodales: CargaNodal[] = [...f.entries()].sort((a, b) => a[0] - b[0]).map(([nudo, fz]) => ({ nudo, f: [0, 0, fz, 0, 0, 0] }));
  return { nudos, laminas, restricciones, apoyos, casos: [{ id: "Q", nodales }] };
}

// ---------------------------------------------------------------------------------------------
// Las estaciones: el metro de cada cara de cada pilar, de las mallas compiladas

/** Clave de una estación de cara con ventana, igual en todas las mallas (dirección, cara, lado y ventana). */
const clave = (e: EstacionOraculo) => `${e.franja.split(":")[1]![0]}|${e.s.toFixed(3)}|${e.lado}|${e.intervalo.map((v) => v.toFixed(3)).join(",")}`;
/** Grupo de una cara: «común por dentro» (la cara común de C5-g cae dentro de la huella), «exterior» (el vano es el vuelo de borde) o «propia». */
function grupo(e: EstacionOraculo): string {
  const dir = e.franja.split(":")[1]![0];
  const pid = e.piezas?.[0] ?? "";
  if (pid === "P6-5" || (pid === "P12-10" && dir === "X")) return "común por dentro";
  const lado = e.s + e.lado * 0.01;
  if (dir === "X" ? lado < 0 || lado > 18 : lado < 0 || lado > 15) return "exterior";
  return "propia";
}

/** La regla de antes de la fase, emulada: los nudos de la losa a ≤ ε_snap fuera de cada huella pasan a sus esclavos (y salen del diafragma). */
function reglaAntigua(m: ModeloAnalitico): ModeloAnalitico {
  const usados = new Set<number>([...(m.restricciones ?? []).filter((r) => r.tipo === "enlace-rigido").flatMap((r) => [r.maestro, ...r.esclavos]), ...(m.apoyos ?? []).map((a) => a.nudo)]);
  const extras = new Set<number>();
  const rs = (m.restricciones ?? []).map((r) => {
    if (!r.id.endsWith(":huella")) return r;
    const p = pilares.find((x) => x.id === r.id.split("@")[0])!;
    const h = huellaEnPlanta(fisico, p, PLANTA);
    const z = m.nudos[r.maestro]!.z;
    const extra = m.nudos.flatMap((n, i) => {
      if (usados.has(i) || Math.abs(n.z - z) > 1e-9) return [];
      const d = distanciaAHuella([n.x, n.y], h);
      return d > 1e-5 && d <= EPS_SNAP + 1e-9 ? [i] : [];
    });
    for (const i of extra) extras.add(i);
    return { ...r, esclavos: [...r.esclavos, ...extra].sort((a, b) => a - b) };
  });
  return { ...m, restricciones: rs.map((r) => (r.tipo === "diafragma" ? { ...r, esclavos: r.esclavos.filter((n) => !extras.has(n)) } : r)) };
}

interface Malla {
  nombre: string;
  h: number;
  regla: "nueva" | "antigua";
  nudos: number;
  /** My (kN·m, suma de los casos) por clave. */
  my: Map<string, number>;
  fuera: number;
}
const estacionesBase = new Map<string, EstacionOraculo>();
const mallas: Malla[] = [];
let material: LaminaAnalitica["material"] | undefined;
let zLosa = 0;
for (const h of MALLAS)
  for (const regla of CON_ANTIGUA ? (["nueva", "antigua"] as const) : (["nueva"] as const)) {
    process.stderr.write(`compilada h = ${h}, regla ${regla}\n`);
    const x = estacionesOraculo(`h=${h}`, fisico, { ...OP, tamanoMalla: h }, regla === "antigua" ? reglaAntigua : (m) => m);
    material ??= x.modelo.laminas![0]!.material;
    zLosa = x.modelo.laminas![0]!.nudos[0]! >= 0 ? x.modelo.nudos[x.modelo.laminas![0]!.nudos[0]!]!.z : 0;
    const my = new Map<string, number>();
    for (const e of x.estaciones) {
      if (e.tipo !== "cara (ventana del pilar)") continue;
      const k = clave(e);
      if (my.has(k)) continue;
      my.set(k, e.my.reduce((a, b) => a + b, 0));
      if (!estacionesBase.has(k)) estacionesBase.set(k, e);
    }
    // Esclavos fuera de la huella (los que la regla antigua añade)
    let fuera = 0;
    for (const r of x.modelo.restricciones ?? []) {
      if (!r.id.endsWith(":huella")) continue;
      const p = pilares.find((q) => q.id === r.id.split("@")[0])!;
      const hh = huellaEnPlanta(fisico, p, PLANTA);
      for (const n of r.esclavos) if (distanciaAHuella([x.modelo.nudos[n]!.x, x.modelo.nudos[n]!.y], hh) > 1e-5) fuera++;
    }
    mallas.push({ nombre: `h = ${h}, ${regla}`, h, regla, nudos: x.modelo.nudos.length, my, fuera });
  }

// ---------------------------------------------------------------------------------------------
// El motor en la malla tensorial

/** My de un intervalo de la recta de una estación, por fuerzas nodales, repartido por láminas como en opensees-modelos.ts. */
function myTensorial(cortes: Cortes, casos: ReturnType<typeof casosValidos>, e: EstacionOraculo): number | null {
  const c = e.corte;
  const x = cortes.cortar({ origen: c.origen as [number, number, number], x: c.x as [number, number, number], vz: [0, 0, 1], y: c.y, metodo: "fuerzas-nodales", soloLaminas: true, porLamina: true }, casos);
  if (!x.valido || !x.porLamina) return null;
  const [a, b] = e.intervalo;
  let my = 0;
  for (const p of x.porLamina) {
    const [ya, yb] = p.y;
    const largo = yb - ya;
    const f = largo > 1e-6 ? Math.max(0, Math.min(yb, b) - Math.max(ya, a)) / largo : (ya + yb) / 2 > a && (ya + yb) / 2 < b ? 1 : 0;
    casos.forEach((_, k) => (my += f * p.esfuerzos[6 * k + 4]!));
  }
  return my;
}
const tensoriales = new Map<string, { modelo: ModeloAnalitico; my: Map<string, number | null>; estaciones: EstacionOraculo[] }>();
for (const variante of ["enlace", "parche"] as const) {
  process.stderr.write(`tensorial ${variante}\n`);
  const modelo = modeloTensorial(material!, zLosa, variante);
  const r = calcular(modelo);
  if (!r.valido) throw new Error(`tensorial ${variante}: ${r.diagnosticos.map((d) => d.mensaje).join("\n")}`);
  const casos = casosValidos(r);
  const cortes = new Cortes(modelo);
  const my = new Map<string, number | null>();
  const estaciones: EstacionOraculo[] = [];
  for (const [k, e] of estacionesBase) {
    const v = myTensorial(cortes, casos, e);
    my.set(k, v);
    if (v !== null) estaciones.push({ ...e, my: [v] });
  }
  tensoriales.set(variante, { modelo, my, estaciones });
}
writeFileSync(join(import.meta.dirname, "opensees-modelos.json"), JSON.stringify(Object.fromEntries([...tensoriales].map(([k, v]) => [`tensorial-${k}`, { modelo: v.modelo, estaciones: v.estaciones }]))));

// ---------------------------------------------------------------------------------------------
// Las tablas

const ref = tensoriales.get("enlace")!.my;
const claves = [...estacionesBase.keys()].filter((k) => ref.get(k) !== null && ref.get(k) !== undefined);
const maxRef = Math.max(...claves.map((k) => Math.abs(ref.get(k)!)));
const conDemanda = claves.filter((k) => Math.abs(ref.get(k)!) >= 0.2 * maxRef);
const pct = (v: number) => `${(100 * v).toFixed(2)} %`;
const grupos = ["propia", "común por dentro", "exterior"];

console.log("# Fase HR, criterio 2: la losa 3 × 3 mezclada frente a la malla tensorial\n");
console.log(`Malla tensorial: ${XS.length} × ${YS.length} nudos (${tensoriales.get("enlace")!.modelo.nudos.length} con los maestros), ${(XS.length - 1) * (YS.length - 1)} láminas, paso ${SEP}–${2 * SEP} m, ningún nudo a ≤ ε_snap fuera de una huella. Los pilares, articulados en el maestro de su huella (como el oráculo de F). My del metro de cada cara (kN·m, suma de los casos); «con demanda»: |My| ≥ 20 % del mayor de la tensorial.\n`);
console.log(`Estaciones de cara con ventana: ${claves.length} (con demanda, ${conDemanda.length}); el mayor |My| de la tensorial, ${maxRef.toFixed(2)} kN·m.\n`);

console.log("## La variante «parche» (huella como láminas 1 000 veces más rígidas, articulada en el centro) frente a la tensorial con enlace\n");
{
  const parche = tensoriales.get("parche")!.my;
  for (const g of grupos) {
    const ks = conDemanda.filter((k) => grupo(estacionesBase.get(k)!) === g && parche.get(k) !== null);
    if (!ks.length) continue;
    const errs = ks.map((k) => (parche.get(k)! - ref.get(k)!) / ref.get(k)!);
    const peor = errs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
    console.log(`- ${g} (${ks.length}): media ${pct(errs.reduce((a, b) => a + Math.abs(b), 0) / errs.length)}, máximo ${pct(Math.max(...errs.map(Math.abs)))} (peor, ${pct(peor)})`);
  }
}

console.log("\n## Nuestras mallas frente a la tensorial (con demanda): media y máximo de |error|, y el peor con su signo\n");
console.log(`| Malla | Nudos | Esclavos fuera de la huella | ${grupos.map((g) => `${g}: media / máx (peor)`).join(" | ")} |`);
console.log(`|---|---|---|${grupos.map(() => "---").join("|")}|`);
for (const m of mallas) {
  const cols = grupos.map((g) => {
    const ks = conDemanda.filter((k) => grupo(estacionesBase.get(k)!) === g && m.my.has(k));
    if (!ks.length) return "—";
    const errs = ks.map((k) => (m.my.get(k)! - ref.get(k)!) / ref.get(k)!);
    const peor = errs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
    return `${pct(errs.reduce((a, b) => a + Math.abs(b), 0) / errs.length)} / ${pct(Math.max(...errs.map(Math.abs)))} (${pct(peor)}) [${ks.length}]`;
  });
  console.log(`| ${m.nombre} | ${m.nudos} | ${m.fuera} | ${cols.join(" | ")} |`);
}

console.log("\n## Las caras con nudos rígidos delante con la regla antigua (F3-5, F3-8): por estación, el error frente a la tensorial\n");
{
  const finas = mallas.filter((m) => m.regla === "antigua");
  if (!finas.length) console.log("(sin la regla antigua)");
  else {
    console.log(`| Cara (pilar, dirección, s, lado) | Tensorial | ${mallas.map((m) => m.nombre).join(" | ")} |`);
    console.log(`|---|---|${mallas.map(() => "---").join("|")}|`);
    for (const k of conDemanda) {
      const difieren = MALLAS.some((h) => {
        const a = mallas.find((m) => m.h === h && m.regla === "antigua")?.my.get(k);
        const b = mallas.find((m) => m.h === h && m.regla === "nueva")?.my.get(k);
        return a !== undefined && b !== undefined && Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(b));
      });
      if (!difieren) continue;
      const e = estacionesBase.get(k)!;
      console.log(`| ${e.piezas?.[0] ?? "?"}, ${k.split("|")[0]}, s = ${e.s.toFixed(2)}, ${e.lado > 0 ? "+" : "−"} (${grupo(e)}) | ${ref.get(k)!.toFixed(2)} | ${mallas.map((m) => (m.my.has(k) ? pct((m.my.get(k)! - ref.get(k)!) / ref.get(k)!) : "—")).join(" | ")} |`);
    }
  }
}

console.log("\n## Todas las estaciones con demanda (My en kN·m; entre paréntesis, el error frente a la tensorial)\n");
console.log(`| Cara | Grupo | Tensorial | Parche | ${mallas.map((m) => m.nombre).join(" | ")} |`);
console.log(`|---|---|---|---|${mallas.map(() => "---").join("|")}|`);
for (const k of conDemanda) {
  const e = estacionesBase.get(k)!;
  const r0 = ref.get(k)!;
  const p = tensoriales.get("parche")!.my.get(k);
  const celda = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(2)} (${pct((v - r0) / r0)})`);
  console.log(`| ${e.piezas?.[0] ?? "?"}, ${k.split("|")[0]}, s = ${e.s.toFixed(2)}, ${e.lado > 0 ? "+" : "−"} | ${grupo(e)} | ${r0.toFixed(2)} | ${celda(p)} | ${mallas.map((m) => celda(m.my.get(k))).join(" | ")} |`);
}
