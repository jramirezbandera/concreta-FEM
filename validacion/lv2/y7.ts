/**
 * Y7 de la fase LV2 (`docs/fem3d/refinamiento-vigas.md` §7–§8, §11): la estación de apoyo de la
 * franja L-N1:Y7 en la cara sur de la viga X5 (y = 4,85), a 0,07 m de la huella de P6-5 (un 40 × 40
 * bajo la viga Y6 de 30, que asoma 5 cm de su cara). Con h = 0,75 empeora con la plantilla de
 * esquina: −24 % frente a h = 0,125, cuando LV1 daba −7 %.
 *
 * Mide, en la retícula de 4 × 4 de `franjas.ts`, con LV1 y LV2 y h = 0,75 / 0,5 / 0,25 / 0,125:
 * - las estaciones de apoyo de las franjas Y4…Y9 en esa cara: mx (fuerzas nodales), my y mxy (campos
 *   a δ de la cara) de ELU, el ancho en losa y el superior de Wood–Armer;
 * - la cara entera del paño (x de 3,125 a 5,85) por un solo corte: el momento total y su reparto por
 *   nudos de la cara (lo que el reparto por franjas asigna a cada una sale de ahí);
 * - el campo recuperado (SPR) a δ de la cara, punto a punto, y los valores brutos de los centroides
 *   de las láminas que tocan la cara, para separar lo que es del cálculo de lo que es de la
 *   recuperación;
 * - el perfil de mxy según la distancia a la cara (la capa límite);
 * - lo mismo con todos los pilares de 30 × 30 (nada asoma: la plantilla entra con sus tres niveles);
 * - en todas las estaciones de apoyo de la losa, cuánto del error de LV2 (h = 0,75) frente a la fina
 *   es del mx por fuerzas nodales y cuánto del término de mxy de Wood–Armer.
 * Y dibuja la malla junto a P6-5 (`y7-<variante>.png`, en la carpeta que se pase como argumento).
 *
 *   bun validacion/lv2/y7.ts [carpeta-png] [--fino] > validacion/lv2/out_y7.txt
 *
 * Con `--fino`, añade LV2 con h = 0,0625 (~200 000 ecuaciones; con ε_snap = 0,025, porque h no puede
 * bajar de 2·ε_snap) a la serie de Y7.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { svgAPng } from "../../cli/png.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { CamposLaminas } from "../../src/motor/campos.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import type { ModeloAnalitico, ResultadoCaso } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioReticular } from "../c4/modelos.ts";
import { conAcciones } from "../c5/modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const base = conAcciones(edificioReticular(1, 3, 3));
const ELU = [1.35, 1.5, 0, 0];
const args = process.argv.slice(2);
const fino = args.includes("--fino");
const carpeta = args.find((a) => !a.startsWith("--"));
if (carpeta) mkdirSync(carpeta, { recursive: true });

/** La cara sur de X5 en el paño al suroeste de P6-5: de la cara del zuncho S0 a la de la viga Y6. */
const Y_CARA = 4.85;
const DELTA = 1e-3;
const [XA, XB] = [3.125, 5.85];
const PILAR = "P6-5";
const FRANJAS = ["Y4", "Y5", "Y6", "Y7", "Y8", "Y9"];
const B = 18 / 22;
/** Bordes de las franjas Y (t = x). */
const BORDES = Array.from({ length: 23 }, (_, i) => i * B);

const pct = (v: number) => `${(100 * v).toFixed(1)} %`;
const f2 = (v: number, w = 8) => v.toFixed(2).padStart(w);
const f3 = (v: number, w = 7) => v.toFixed(3).padStart(w);
const elu = (m: ArrayLike<number>, paso: number, i: number) => ELU.reduce((a, coef, kc) => a + coef * m[paso * kc + i]!, 0);

interface Estacion {
  mx: number;
  my: number;
  mxy: number;
  ancho: number;
  superior: number;
}

interface Medida {
  nombre: string;
  /** Por franja de FRANJAS, la estación de apoyo en la cara. */
  franjas: Map<string, Estacion | null>;
  /** Todas las estaciones de apoyo de la losa (clave `${franja} ${s}:${lado}`), con el máximo superior de su franja. */
  apoyos: Map<string, Estacion & { maxFranja: number }>;
  /** La cara entera: My de ELU total, y por nudo de la cara (x, My) por x creciente. */
  total: number;
  nudos: { x: number; my: number; enlace: string }[];
  /** Muestras del campo a δ de la cara (ejes de la franja Y: mx flecta la franja): x, mx, my, mxy de ELU, peso. */
  muestras: { x: number; mx: number; my: number; mxy: number; w: number }[];
  /** Centroides de las láminas que tocan la cara: x, y del centroide, [Mx, My, Mxy] brutos de ELU en ejes de lámina (X, Y), y los recuperados en su nudo de la cara de menor x. */
  centroides: { x: number; y: number; bruto: [number, number, number]; nudoCara: [number, number, number]; xNudo: number; lebesgue: number }[];
  /** El campo a una distancia d de la cara: la media en Y7 de mxy y de my, y mxy en el punto más cercano a x = 5,39. */
  perfil: (d: number) => { mxy: number; my: number; mxyPico: number };
  ecuaciones: number;
  sinRefinar: string[];
}

function medir(nombre: string, fisico: ModeloFisico, op: OpcionesCompilacion, png: string | null): Medida {
  const c = compilar(fisico, op);
  if (!c.valido) throw new Error(c.diagnosticos[0]!.mensaje);
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
  const q = new Consultas(fisico, c, k.casos, op);
  const casos: readonly ResultadoCaso[] = k.casos;

  const apoyos = new Map<string, Estacion & { maxFranja: number }>();
  const fs = q.franjas("L-N1");
  if (!fs.valido) throw new Error("L-N1");
  const franjas = new Map<string, Estacion | null>();
  for (const f of fs.valor) {
    const e = q.franja(f.id);
    const a = q.armadoFranja(f.id, [ELU]);
    if (!e.valido || !a.valido) throw new Error(f.id);
    const lista: [string, Estacion][] = [];
    e.valor.estaciones.forEach((x, i) => {
      if (x.tipo !== "apoyo") return;
      lista.push([`${f.id} ${x.s.toFixed(3)}:${x.lado}`, { mx: elu(x.medios, 3, 0), my: elu(x.medios, 3, 1), mxy: elu(x.medios, 3, 2), ancho: x.anchoEnLosa, superior: a.valor[i]!.superior }]);
    });
    const maxFranja = Math.max(1, ...e.valor.estaciones.map((_, i) => a.valor[i]!.superior));
    for (const [key, est] of lista) apoyos.set(key, { ...est, maxFranja });
    const corto = f.id.slice("L-N1:".length);
    if (FRANJAS.includes(corto)) {
      const i = e.valor.estaciones.findIndex((x) => x.tipo === "apoyo" && x.lado === -1 && Math.abs(x.s - Y_CARA) < 1e-6);
      const x = i < 0 ? null : e.valor.estaciones[i]!;
      franjas.set(corto, x ? { mx: elu(x.medios, 3, 0), my: elu(x.medios, 3, 1), mxy: elu(x.medios, 3, 2), ancho: x.anchoEnLosa, superior: a.valor[i]!.superior } : null);
    }
  }

  // Enlaces: a qué pertenece cada nudo esclavo
  const enlaceDe = new Map<number, string>();
  (c.modelo.restricciones ?? []).forEach((r, i) => {
    if (r.tipo !== "enlace-rigido") return;
    const m = c.mapeo.restricciones[i]!;
    const nombreR = m.pilar ?? m.viga ?? r.id;
    for (const e of r.esclavos) enlaceDe.set(e, nombreR);
  });

  // La cara entera, por un corte de fuerzas nodales con lo de cada nudo
  const lam0 = c.modelo.laminas![c.mapeo.losas!["L-N1"]![0]!]!;
  const z = c.modelo.nudos[lam0.nudos[0]]!.z;
  const cortes = new Cortes(c.modelo);
  const res = cortes.cortar({ id: "cara", origen: [XA, Y_CARA, z], x: [0, 1, 0], vz: [0, 0, 1], y: [-(XB - XA), 0], z: [0, 0], metodo: "fuerzas-nodales", soloLaminas: true, porLamina: true }, casos);
  if (!res.valido || !res.porLamina) throw new Error(`corte de la cara: ${res.diagnosticos.map((d) => d.mensaje).join("; ")}`);
  const total = elu(res.esfuerzos, 6, 4);
  const porX = new Map<string, { x: number; my: number }>();
  for (const p of res.porLamina)
    for (const n of p.nudos) {
      const x = XA - n.y;
      const kx = x.toFixed(4);
      const r = porX.get(kx) ?? { x, my: 0 };
      r.my += elu(n.esfuerzos, 6, 4);
      porX.set(kx, r);
    }
  const idxNudo = new Map<string, number>();
  c.modelo.nudos.forEach((n, i) => {
    if (Math.abs(n.y - Y_CARA) < 1e-6 && Math.abs(n.z - z) < 1e-6) idxNudo.set(n.x.toFixed(4), i);
  });
  const nudos = [...porX.values()].sort((a, b) => a.x - b.x).map((r) => ({ ...r, enlace: enlaceDe.get(idxNudo.get(r.x.toFixed(4)) ?? -1) ?? "" }));

  // El campo a una distancia d de la cara, como la estación: cuadratura 2 y quiebres en los bordes de las franjas
  const campos = new CamposLaminas(c.modelo);
  const muestrear = (d: number) => {
    const yc = Y_CARA - d;
    const quiebres = BORDES.filter((t) => t > XA && t < XB).map((t) => -(t - XA));
    const rc = cortes.cortar({ id: "campos", origen: [XA, yc, z], x: [0, 1, 0], vz: [0, 0, 1], y: [-(XB - XA), 0], z: [0, 0], metodo: "campos", cuadratura: 2, quiebres, soloLaminas: true }, casos, campos);
    if (!rc.valido || !rc.muestras) throw new Error(`corte por campos: ${rc.diagnosticos.map((d) => d.mensaje).join("; ")}`);
    const ms = rc.muestras;
    const out: Medida["muestras"] = [];
    for (let j = 0; j < ms.pesos.length; j++) {
      const v = (i: number) => ELU.reduce((a, coef, kc) => a + coef * ms.valores[kc]![8 * j + i]!, 0);
      out.push({ x: XA - ms.yz[2 * j]!, mx: v(3), my: v(4), mxy: v(5), w: ms.pesos[j]! });
    }
    return out.sort((a, b) => a.x - b.x);
  };
  const muestras = muestrear(DELTA);
  const perfil = (d: number) => {
    const ms = muestrear(d);
    const enY7 = ms.filter((s) => s.x > 6 * B && s.x < 7 * B);
    const W = enY7.reduce((a, s) => a + s.w, 0);
    const pico = ms.reduce((best, s) => (Math.abs(s.x - 5.39) < Math.abs(best.x - 5.39) ? s : best), ms[0]!);
    return { mxy: enY7.reduce((a, s) => a + s.w * s.mxy, 0) / W, my: enY7.reduce((a, s) => a + s.w * s.my, 0) / W, mxyPico: pico.mxy };
  };

  // Centroides brutos de las láminas que tocan la cara (lado sur), y el valor recuperado en su nudo de la cara
  const centroides: Medida["centroides"] = [];
  const u = casos.map((x) => x.u);
  (c.modelo.laminas ?? []).forEach((l, li) => {
    if (c.mapeo.laminas?.[li]?.losa !== "L-N1") return;
    const P = l.nudos.map((n) => c.modelo.nudos[n]!);
    const enCara = P.map((p) => Math.abs(p.y - Y_CARA) < 1e-6);
    if (enCara.filter(Boolean).length < 2 || P.some((p) => p.y > Y_CARA + 1e-6)) return;
    const cx = P.reduce((a, p) => a + p.x, 0) / 4;
    const cy = P.reduce((a, p) => a + p.y, 0) / 4;
    if (cx < 4.6 || cx > XB) return;
    const bruto = [3, 4, 5].map((i) => ELU.reduce((a, coef, kc) => a + coef * casos[kc]!.esfuerzosLaminas[8 * li + i]!, 0)) as [number, number, number];
    let a = -1;
    for (let m = 0; m < 4; m++) if (enCara[m] && (a < 0 || P[m]!.x < P[a]!.x)) a = m;
    const rec = u.map((uu) => campos.enNudos(li, uu));
    const nudoCara = [3, 4, 5].map((i) => ELU.reduce((s, coef, kc) => s + coef * rec[kc]![8 * a + i]!, 0)) as [number, number, number];
    const plaza = campos.plazas[4 * li + a] ?? -1;
    centroides.push({ x: cx, y: cy, bruto, nudoCara, xNudo: P[a]!.x, lebesgue: plaza >= 0 ? campos.lebesgueEn(plaza) : NaN });
  });
  centroides.sort((a, b) => a.x - b.x);

  if (png) dibujos.push(dibujar(c.modelo, c.mapeo, enlaceDe, z, png));
  return { nombre, franjas, apoyos, total, nudos, muestras, centroides, perfil, ecuaciones: k.estadisticas.ecuaciones, sinRefinar: c.diagnosticos.filter((d) => d.codigo === "malla/esquina-sin-refinar").flatMap((d) => (d.ids ?? []).slice(1)) };
}

/** La malla de la losa junto a P6-5: láminas, nudos esclavos (rojo: del pilar; azul: de una viga), la cara y los bordes de Y7. */
function dibujar(modelo: ModeloAnalitico, mapeo: { laminas?: { losa?: string }[] }, enlaceDe: Map<number, string>, z: number, fichero: string): Promise<void> {
  const [x0, x1, y0, y1] = [4.3, 6.9, 3.6, 5.6];
  const E = 420;
  const W = Math.round((x1 - x0) * E);
  const H = Math.round((y1 - y0) * E);
  const px = (x: number) => ((x - x0) * E).toFixed(1);
  const py = (y: number) => ((y1 - y) * E).toFixed(1);
  const partes: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Roboto" font-size="11">`, `<rect width="${W}" height="${H}" fill="white"/>`];
  (modelo.laminas ?? []).forEach((l, i) => {
    if (mapeo.laminas?.[i]?.losa !== "L-N1") return;
    const P = l.nudos.map((n) => modelo.nudos[n]!);
    if (P.some((p) => Math.abs(p.z - z) > 1e-6 || p.x < x0 - 1 || p.x > x1 + 1 || p.y < y0 - 1 || p.y > y1 + 1)) return;
    const rigida = l.nudos.every((n) => enlaceDe.get(n) === PILAR);
    partes.push(`<polygon points="${P.map((p) => `${px(p.x)},${py(p.y)}`).join(" ")}" fill="${rigida ? "#ddd" : "#f4f7fb"}" stroke="#555" stroke-width="0.8"/>`);
  });
  for (const x of [6 * B, 7 * B]) partes.push(`<line x1="${px(x)}" y1="0" x2="${px(x)}" y2="${H}" stroke="#2a7" stroke-width="1.5" stroke-dasharray="6 4"/>`);
  partes.push(`<line x1="0" y1="${py(Y_CARA)}" x2="${W}" y2="${py(Y_CARA)}" stroke="#d60" stroke-width="1.5" stroke-dasharray="6 4"/>`);
  partes.push(`<rect x="${px(5.8)}" y="${py(5.2)}" width="${(0.4 * E).toFixed(1)}" height="${(0.4 * E).toFixed(1)}" fill="none" stroke="#c00" stroke-width="1.5"/>`);
  modelo.nudos.forEach((n, i) => {
    if (Math.abs(n.z - z) > 1e-6 || n.x < x0 || n.x > x1 || n.y < y0 || n.y > y1) return;
    const e = enlaceDe.get(i);
    if (!e) return;
    partes.push(`<circle cx="${px(n.x)}" cy="${py(n.y)}" r="3" fill="${e === PILAR ? "#c00" : "#07c"}"/>`);
  });
  partes.push(`<text x="${px(6 * B)}" y="14" fill="#2a7" dx="3">Y7</text><text x="${px(7 * B)}" y="14" fill="#2a7" dx="3">Y8</text>`);
  partes.push(`<text x="4" y="${py(Y_CARA)}" dy="-4" fill="#d60">cara sur de X5, y = 4,85</text>`);
  partes.push("</svg>");
  const svg = partes.join("\n");
  writeFileSync(fichero.replace(/\.png$/, ".svg"), svg);
  return svgAPng(svg).then((png) => writeFileSync(fichero, png));
}

const dibujos: Promise<void>[] = [];
const variantes: [string, OpcionesCompilacion][] = [
  ["LV1 0,75", { refinoEsquinas: false }],
  ["LV2 0,75", { refinoEsquinas: true }],
  ["LV1 0,5", { tamanoMalla: 0.5, refinoEsquinas: false }],
  ["LV2 0,5", { tamanoMalla: 0.5, refinoEsquinas: true }],
  ["LV2 0,25", { tamanoMalla: 0.25, refinoEsquinas: true }],
  ["LV1 0,125", { tamanoMalla: 0.125, refinoEsquinas: false }],
  ["LV2 0,125", { tamanoMalla: 0.125, refinoEsquinas: true }],
  ...(fino ? ([["LV2 0,0625", { tamanoMalla: 0.0625, epsSnap: 0.025, refinoEsquinas: true }]] as [string, OpcionesCompilacion][]) : []),
];
const medidas = variantes.map(([n, op]) => medir(n, base, op, carpeta && op.tamanoMalla === undefined ? join(carpeta, `y7-${n.replace(/[ ,]/g, "_")}.png`) : null));
const ref = medidas.find((m) => m.nombre === "LV2 0,125")!;
const lv2 = medidas.find((m) => m.nombre === "LV2 0,75")!;

function tablaFranjas(ms: Medida[], r: Medida, lista = FRANJAS) {
  for (const f of lista) {
    console.log(`   ${f} [${((+f.slice(1) - 1) * B).toFixed(3)}, ${(+f.slice(1) * B).toFixed(3)}]:`);
    console.log(`      ${"".padEnd(12)}${"mx".padStart(9)}${"my".padStart(9)}${"mxy".padStart(9)}${"ancho".padStart(8)}${"superior".padStart(10)}${"frente a la ref.".padStart(18)}${"|mx| / sup.".padStart(14)}`);
    for (const m of ms) {
      const v = m.franjas.get(f);
      const rr = r.franjas.get(f);
      if (!v) {
        console.log(`      ${m.nombre.padEnd(12)}${"—".padStart(9)}`);
        continue;
      }
      console.log(`      ${m.nombre.padEnd(12)}${f2(v.mx, 9)}${f2(v.my, 9)}${f2(v.mxy, 9)}${f3(v.ancho, 8)}${f2(v.superior, 10)}${(rr ? pct(v.superior / rr.superior - 1) : "—").padStart(18)}${pct(Math.abs(v.mx) / v.superior).padStart(14)}`);
    }
  }
}

console.log("## Y7: la estación de apoyo en la cara sur de X5 (y = 4,85) junto a P6-5, retícula de 4 × 4\n");
console.log("### Las franjas Y4…Y9 en esa cara: mx / my / mxy de ELU (kN·m/m), ancho en losa (m) y superior de Wood–Armer (kN·m/m)\n");
tablaFranjas(medidas, ref);

console.log(`\n### La cara entera del paño (x de ${XA} a ${XB}) por un corte: My total de ELU (kN·m) y ecuaciones\n`);
for (const m of medidas) console.log(`   ${m.nombre.padEnd(12)}${f2(m.total)}   ${pct(m.total / ref.total - 1).padStart(8)}   ${m.ecuaciones} ecuaciones${m.sinRefinar.length ? `   sin refinar: ${m.sinRefinar.join(", ")}` : ""}`);

console.log("\n### Lo que entra por cada nudo de la cara con x ≥ 4,0 (My de ELU, kN·m; acumulado desde x = 4,0; enlace del nudo)\n");
for (const m of medidas) {
  if (m.nudos.filter((n) => n.x >= 4 - 1e-6).length > 12) continue;
  console.log(`   ${m.nombre}:`);
  let acum = 0;
  for (const n of m.nudos.filter((n) => n.x >= 4 - 1e-6)) {
    acum += n.my;
    console.log(`      x = ${f3(n.x)}   My = ${f2(n.my)}   acumulado ${f2(acum)}${n.enlace ? `   [${n.enlace}]` : ""}`);
  }
}

console.log("\n### Acumulado de la cara por tramos de x (My de ELU, kN·m): [4,0, 4,909], [4,909, 5,727] (Y7) y [5,727, 5,85]\n");
const tramos: [number, number][] = [
  [4, 6 * B],
  [6 * B, 7 * B],
  [7 * B, XB + 1e-6],
];
console.log(`${"".padEnd(12)}${tramos.map(([a, b]) => `[${a.toFixed(3)}, ${b.toFixed(3)}]`.padStart(18)).join("")}${"total x ≥ 4".padStart(14)}`);
for (const m of medidas) {
  const s = tramos.map(([a, b]) => m.nudos.filter((n) => n.x >= a - 1e-6 && n.x < b - 1e-6).reduce((acc, n) => acc + n.my, 0));
  console.log(`${m.nombre.padEnd(12)}${s.map((v) => f2(v, 18)).join("")}${f2(s.reduce((a, b) => a + b, 0), 14)}`);
}

console.log(`\n### El campo recuperado a δ = ${DELTA} m de la cara, por puntos de Gauss (ELU, ejes de la franja Y; x ≥ 4,75)\n`);
console.log("    mx flecta la franja (es el My del corte); my, el transversal; mxy, el torsor. Entre corchetes, la media en Y7 por los pesos.\n");
for (const m of medidas) {
  const enY7 = m.muestras.filter((s) => s.x > 6 * B && s.x < 7 * B);
  const W = enY7.reduce((a, s) => a + s.w, 0);
  const med = (f: (s: Medida["muestras"][number]) => number) => enY7.reduce((a, s) => a + s.w * f(s), 0) / W;
  console.log(`   ${m.nombre}  [Y7: mx ${med((s) => s.mx).toFixed(2)}, my ${med((s) => s.my).toFixed(2)}, mxy ${med((s) => s.mxy).toFixed(2)}, |mxy| ${med((s) => Math.abs(s.mxy)).toFixed(2)}]`);
  const lista = m.muestras.filter((s) => s.x >= 4.75);
  const paso = lista.length > 24 ? Math.ceil(lista.length / 24) : 1;
  for (let i = 0; i < lista.length; i += paso) {
    const s = lista[i]!;
    console.log(`      x = ${f3(s.x)}   mx ${f2(s.mx)}   my ${f2(s.my)}   mxy ${f2(s.mxy)}`);
  }
}

console.log("\n### Las láminas que tocan la cara (lado sur, x ≥ 4,6): centroide, [Mx, My, Mxy] brutos de ELU en ejes de lámina (X, Y) y el campo recuperado en su nudo de la cara de menor x (con la constante de Lebesgue de su plaza)\n");
console.log("    En ejes de lámina, My es el que flecta la franja Y y Mxy el torsor (su signo, el contrario al de la franja).\n");
for (const m of medidas) {
  console.log(`   ${m.nombre}:`);
  const lista = m.centroides;
  const paso = lista.length > 16 ? Math.ceil(lista.length / 16) : 1;
  for (let i = 0; i < lista.length; i += paso) {
    const s = lista[i]!;
    console.log(`      centroide (${f3(s.x, 6)}, ${f3(s.y, 6)})   bruto Mx ${f2(s.bruto[0])}  My ${f2(s.bruto[1])}  Mxy ${f2(s.bruto[2])}   | nudo x = ${f3(s.xNudo, 6)}: Mx ${f2(s.nudoCara[0])}  My ${f2(s.nudoCara[1])}  Mxy ${f2(s.nudoCara[2])}   Λ ${s.lebesgue.toFixed(1)}`);
  }
}

console.log("\n### La capa límite: media de mxy (y de my) en Y7 según la distancia d a la cara, y mxy en el punto más cercano a x = 5,39 (ELU, ejes de la franja)\n");
const distancias = [0.001, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.55];
console.log(`   ${"d (m)".padEnd(12)}${distancias.map((d) => d.toFixed(3).padStart(16)).join("")}`);
for (const m of medidas) {
  const ps = distancias.map((d) => m.perfil(d));
  console.log(`   ${m.nombre.padEnd(12)}${ps.map((p) => `${p.mxy.toFixed(2)} / ${p.mxyPico.toFixed(2)}`.padStart(16)).join("")}   (mxy medio / en x ≈ 5,39)`);
  console.log(`   ${"".padEnd(12)}${ps.map((p) => `my ${p.my.toFixed(1)}`.padStart(16)).join("")}`);
}

// Con pilares de 30 × 30: nada asoma de las vigas de 30, y la plantilla entra con sus tres niveles
console.log("\n## Lo mismo con todos los pilares de 30 × 30 (la plantilla entra entera)\n");
const treinta: ModeloFisico = { ...base, secciones: base.secciones.map((s) => (s.id === "p40" || s.id === "p3050" ? { ...s, b: 0.3, h: 0.3 } : s)) };
const m30 = [
  ["LV1 0,75", { refinoEsquinas: false }],
  ["LV2 0,75", { refinoEsquinas: true }],
  ["LV2 0,25", { tamanoMalla: 0.25, refinoEsquinas: true }],
  ["LV2 0,125", { tamanoMalla: 0.125, refinoEsquinas: true }],
].map(([n, op]) => medir(n as string, treinta, op as OpcionesCompilacion, carpeta && (op as OpcionesCompilacion).tamanoMalla === undefined ? join(carpeta, `y7-30x30-${(n as string).replace(/[ ,]/g, "_")}.png`) : null));
console.log(`   Ecuaciones: ${m30.map((m) => `${m.nombre} ${m.ecuaciones}`).join("; ")}; sin refinar con LV2 0,75: ${m30[1]!.sinRefinar.join(", ") || "ninguno"}.\n`);
tablaFranjas(m30, m30[m30.length - 1]!, ["Y6", "Y7", "Y8", "Y9"]);
console.log(`\n   Nudos de la cara con LV2 0,75 (x ≥ 4,0): ${m30[1]!.nudos.filter((n) => n.x >= 4 - 1e-6).map((n) => `${n.x.toFixed(3)} (${n.my.toFixed(2)})`).join(", ")}`);
console.log(`\n   Capa límite (mxy medio en Y7 según d):`);
console.log(`   ${"d (m)".padEnd(12)}${distancias.map((d) => d.toFixed(3).padStart(10)).join("")}`);
for (const m of m30) console.log(`   ${m.nombre.padEnd(12)}${distancias.map((d) => m.perfil(d).mxy.toFixed(2).padStart(10)).join("")}`);

// Todas las estaciones de apoyo: cuánto del error de LV2 (0,75) frente a la fina es mx y cuánto mxy
console.log("\n## Todas las estaciones de apoyo de la losa, LV2 (h = 0,75) frente a LV2 0,125: el error del superior y el del superior sin el término de mxy, max(0, −mx) («|mx|»), respecto al máximo de la franja\n");
const filas: { k: string; eSup: number; eMx: number; sup: number; supRef: number; mxyRef: number; mxy: number }[] = [];
for (const [k, r] of ref.apoyos) {
  const v = lv2.apoyos.get(k);
  if (!v) continue;
  // El superior sin el término de mxy es max(0, −mx)
  filas.push({ k, eSup: (v.superior - r.superior) / r.maxFranja, eMx: (Math.max(0, -v.mx) - Math.max(0, -r.mx)) / r.maxFranja, sup: v.superior, supRef: r.superior, mxyRef: r.mxy, mxy: v.mxy });
}
const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? NaN;
console.log(`   ${filas.length} estaciones. Mediana del |error| del superior: ${pct(med(filas.map((f) => Math.abs(f.eSup))))}; de |mx|: ${pct(med(filas.map((f) => Math.abs(f.eMx))))}.`);
for (const umbral of [0.1, 0.2]) {
  const malas = filas.filter((f) => Math.abs(f.eSup) > umbral);
  const porMx = malas.filter((f) => Math.abs(f.eMx) > umbral);
  console.log(`   Por encima del ${pct(umbral)} en el superior: ${malas.length}; de ellas, con |mx| también por encima: ${porMx.length} (las otras ${malas.length - porMx.length} son del término de mxy).`);
}
const soloMx = filas.filter((f) => Math.abs(f.eMx) > 0.1);
console.log(`   Con |mx| por encima del 10 %: ${soloMx.length}; del 20 %: ${filas.filter((f) => Math.abs(f.eMx) > 0.2).length}.`);
console.log("\n   Las 12 peores del superior (error del superior, error de |mx|, superior LV2 / ref, mxy LV2 / ref):");
for (const f of [...filas].sort((a, b) => Math.abs(b.eSup) - Math.abs(a.eSup)).slice(0, 12)) console.log(`      ${f.k.padEnd(26)} ${pct(f.eSup).padStart(8)} ${pct(f.eMx).padStart(8)}   ${f2(f.sup)} / ${f2(f.supRef)}   ${f2(f.mxy)} / ${f2(f.mxyRef)}`);
console.log("\n   Las 12 peores de |mx| (error de |mx|, error del superior):");
for (const f of [...filas].sort((a, b) => Math.abs(b.eMx) - Math.abs(a.eMx)).slice(0, 12)) console.log(`      ${f.k.padEnd(26)} ${pct(f.eMx).padStart(8)} ${pct(f.eSup).padStart(8)}`);
console.log("\n   En la fina, cuánto añade el término de mxy al superior en las estaciones de apoyo (1 − |mx|/superior): mediana y las 8 mayores:");
const anade = [...ref.apoyos].map(([k, r]) => ({ k, a: r.superior > 1 ? 1 - Math.abs(r.mx) / r.superior : 0, sup: r.superior })).filter((x) => x.sup > 1);
console.log(`      mediana ${pct(med(anade.map((x) => x.a)))}; ${anade.filter((x) => x.a > 0.1).length} de ${anade.length} por encima del 10 %`);
for (const x of anade.sort((a, b) => b.a - a.a).slice(0, 8)) console.log(`      ${x.k.padEnd(26)} ${pct(x.a).padStart(8)}   superior ${f2(x.sup)}`);
await Promise.all(dibujos);
