/**
 * LV2-f (`docs/fem3d/refinamiento-vigas.md` §9 y §10): los pilares que asoman de la viga que los
 * atraviesa (un 40 × 40, 30 × 50 o 25 × 60 bajo una viga de 30). En las 24 retículas al azar de G, con
 * h = 0,75, frente a LV2 con h = 0,25: el momento de las vigas en sus caras y las estaciones de apoyo
 * de las franjas junto a ellos (la superior de 1,35·G + 1,5·Q), respecto al máximo de la viga o de la
 * franja, como en `franjas.ts`.
 * - LV1 (`refinoEsquinas: false`): sin plantillas de esquina y con la regla de antes de C2-d (rígidos
 *   también los nudos de fuera de la huella a ≤ ε_snap);
 * - LV2: con las esquinas y, en estos pilares, sólo la huella rígida (LV2-f).
 * Cuenta los nudos rígidos de cada huella fuera de ella, sin los de las caras de las vigas en su zona
 * rígida en el pilar, que van a la huella a propósito (C1-a, `unirCaras`).
 *
 * La medida que decidió LV2-f (A: la regla de antes con las esquinas; C y D: no sembrar lo que asoma)
 * está en §9 y en el `out_asoma.txt` del commit 1f46a20; necesitaba un interruptor en el compilador
 * que se quitó (§10). Desde LV-8 (§13) la referencia lleva también las tiras, el ancho exacto y las
 * caras hasta el ancho, así que el conjunto de estaciones y los números de LV1 no son los de §9.
 *
 *   bun validacion/lv2/asoma.ts > validacion/lv2/out_asoma.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion, Pilar } from "../../src/compilador/fisico.ts";
import { distanciaAHuella, huellaPilar } from "../../src/compilador/geometria2d.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { reticulaAleatoria } from "../../src/pruebas/reticulasAleatorias.ts";
import { valido } from "../../src/pruebas/metamorficasFisicas.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const B_VIGA = 0.3;

/** Extensión en X y en Y de un pilar rectangular (el canto h va según el giro: 0 → X). */
function extension(f: ModeloFisico, p: Pilar): [number, number] | null {
  const sc = f.secciones.find((x) => x.id === p.seccion) as { forma: string; b: number; h: number };
  if (sc.forma !== "rectangular") return null;
  return ((p.giro ?? 0) / 90) % 2 === 1 ? [sc.b, sc.h] : [sc.h, sc.b];
}

/** Vigas que pasan por el centro del pilar, con su dirección (1: X, 2: Y), en cada planta. */
function vigasPor(f: ModeloFisico, p: Pilar) {
  return (f.vigas ?? []).flatMap((v) => {
    const [[x0, y0], [x1, y1]] = v.puntos as [[number, number], [number, number]];
    const dir = Math.abs(y1 - y0) < 1e-9 ? 1 : 2;
    const dentro = dir === 1 ? Math.abs(p.y - y0) < 1e-9 && p.x >= Math.min(x0, x1) - 1e-9 && p.x <= Math.max(x0, x1) + 1e-9 : Math.abs(p.x - x0) < 1e-9 && p.y >= Math.min(y0, y1) - 1e-9 && p.y <= Math.max(y0, y1) + 1e-9;
    return dentro ? [{ id: v.id, planta: v.planta, dir }] : [];
  });
}

/** Pilares que asoman de alguna viga que los atraviesa, por planta. */
function queAsoman(f: ModeloFisico): { pilar: Pilar; planta: string; vigas: string[] }[] {
  const r: { pilar: Pilar; planta: string; vigas: string[] }[] = [];
  for (const p of f.pilares ?? []) {
    const e = extension(f, p);
    if (!e) continue;
    const vs = vigasPor(f, p);
    for (const planta of [...new Set(vs.map((v) => v.planta))]) {
      const aqui = vs.filter((v) => v.planta === planta);
      if (aqui.some((v) => (v.dir === 1 ? e[1] : e[0]) > B_VIGA + 0.01)) r.push({ pilar: p, planta, vigas: aqui.map((v) => v.id) });
    }
  }
  return r;
}

interface Medida {
  vigas: Map<string, { v: number; escala: number }>;
  franjas: Map<string, { v: number; escala: number }>;
  rigidosFuera: number;
  jacobiano: number;
  nudos: number;
}

function medir(f: ModeloFisico, op: OpcionesCompilacion): Medida {
  const c = valido(compilar(f, op));
  const q = new Consultas(f, c, casosValidos(calcular(c.modelo)), op);
  const fac = (f.casos ?? []).map((x) => (x.id === "G" ? 1.35 : x.id === "Q" ? 1.5 : 0));
  const asoman = queAsoman(f);
  const vigas = new Map<string, { v: number; escala: number }>();
  const franjas = new Map<string, { v: number; escala: number }>();
  let rigidosFuera = 0;
  for (const { pilar: p, planta, vigas: vs } of asoman) {
    // Nudos rígidos de su huella fuera de ella, sin los de las caras de las vigas (a b/2 de su eje)
    const sc = f.secciones.find((x) => x.id === p.seccion) as { b: number; h: number };
    const h = huellaPilar(p.x, p.y, p.giro ?? 0, { tipo: "rectangulo", b: sc.b, h: sc.h });
    const ejes = (f.vigas ?? []).filter((v) => v.planta === planta).map((v) => v.puntos as [[number, number], [number, number]]);
    const enCara = (x: number, y: number) =>
      ejes.some(([[x0, y0], [x1, y1]]) => {
        const L = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
        const t = ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / (L * L);
        return t >= 0 && t <= 1 && Math.abs(Math.abs((x - x0) * (y1 - y0) - (y - y0) * (x1 - x0)) / L - B_VIGA / 2) < 1e-6;
      });
    const rs = (c.modelo.restricciones ?? []).find((x) => x.id === `${p.id}@${planta}:huella`);
    for (const n of rs?.esclavos ?? []) {
      const { x, y } = c.modelo.nudos[n]!;
      if (distanciaAHuella([x, y], h) > 1e-6 && !enCara(x, y)) rigidosFuera++;
    }
    // Momento de las vigas en sus caras
    for (const v of vs) {
      const pz = q.viga(v);
      if (!pz.valido) throw new Error(v);
      const ext = pz.valor.vanos.map((_, i) => {
        const x = q.vano(v, i, fac);
        if (!x.valido) throw new Error(v);
        return x.valor;
      });
      const escala = Math.max(1, ...ext.flatMap((x) => [Math.abs(x.inicio.esfuerzos[4]!), Math.abs(x.fin.esfuerzos[4]!), Math.abs(x.maxMy.valor), Math.abs(x.minMy.valor)]));
      pz.valor.vanos.forEach((vn, i) => {
        if (vn.apoyoInicio?.objeto === p.id) vigas.set(`${v} ${p.id} fin-izq`, { v: ext[i]!.inicio.esfuerzos[4]!, escala });
        if (vn.apoyoFin?.objeto === p.id) vigas.set(`${v} ${p.id} fin-der`, { v: ext[i]!.fin.esfuerzos[4]!, escala });
      });
    }
  }
  // Franjas: estaciones de apoyo a ≤ 0,5 m de un pilar que asoma, con la ventana sobre su huella
  for (const losa of [...new Set(asoman.map((x) => `L-${x.planta}`))]) {
    const fs = q.franjas(losa);
    if (!fs.valido) throw new Error(losa);
    for (const fr of fs.valor) {
      const est = q.franja(fr.id);
      const arm = q.armadoFranja(fr.id, [fac]);
      if (!est.valido || !arm.valido) throw new Error(fr.id);
      const apoyos = est.valor.estaciones.flatMap((x, i) => (x.tipo === "apoyo" ? [{ x, v: arm.valor[i]!.superior }] : []));
      const escala = Math.max(1, ...apoyos.map((a) => a.v));
      for (const { x, v } of apoyos)
        for (const { pilar: p, planta } of asoman) {
          if (`L-${planta}` !== losa) continue;
          const [ex, ey] = extension(f, p)!;
          const [cc, t, ancho] = fr.direccion === 1 ? [p.x, p.y, ey] : [p.y, p.x, ex];
          if (Math.abs(x.s - cc) <= 0.5 && fr.t0 < t + ancho / 2 && fr.t1 > t - ancho / 2) franjas.set(`${fr.id} ${x.s.toFixed(3)}:${x.lado}`, { v, escala });
        }
    }
  }
  return { vigas, franjas, rigidosFuera, jacobiano: c.estadisticas.malla.jacobianoMin, nudos: c.modelo.nudos.length };
}

/** Diferencias relativas (a la escala de b) de las claves comunes. */
function difs(a: Map<string, { v: number }>, b: Map<string, { v: number; escala: number }>): { k: string; d: number }[] {
  return [...a].flatMap(([k, x]) => {
    const y = b.get(k);
    return y ? [{ k, d: (x.v - y.v) / y.escala }] : [];
  });
}
const pct = (v: number) => `${(100 * v).toFixed(1)} %`;
const med = (v: number[]) => [...v].map(Math.abs).sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? NaN;
const max = (v: number[]) => Math.max(0, ...v.map(Math.abs));
const col = (v: number[]) => `${pct(med(v))} / ${pct(max(v))}`.padStart(18);
const d = (x: { d: number }[]) => x.map((y) => y.d);

type Dif = { s: number; k: string; d: number };
const VARIANTES: [string, OpcionesCompilacion][] = [
  ["LV1", { refinoEsquinas: false }],
  ["LV2", { refinoEsquinas: true }],
];
const REF: OpcionesCompilacion = { tamanoMalla: 0.25, refinoEsquinas: true };
const errV = new Map<string, Dif[]>(VARIANTES.map(([n]) => [n, []]));
const errF = new Map<string, Dif[]>(VARIANTES.map(([n]) => [n, []]));

console.log("## LV2-f: los pilares que asoman de su viga, en las retículas al azar de G\n");
console.log("h = 0,75 frente a LV2 con h = 0,25. LV1: sin esquinas y con los nudos de fuera de la huella a ≤ ε_snap rígidos; LV2: con las esquinas y sólo la huella rígida (LV2-f). Diferencias respecto al máximo de la viga o de la franja; mediana / máximo.\n");
console.log(`${"ret.".padEnd(5)}${"pil.".padStart(5)}${"rígidos fuera LV1 / LV2".padStart(25)}${"jac. mín. LV1 / LV2".padStart(22)}${"nudos LV1 / LV2".padStart(16)}   vigas LV1 | LV2 frente a la ref.      franjas LV1 | LV2 frente a la ref.`);
for (let s = 1; s <= 24; s++) {
  const f = reticulaAleatoria(s);
  const n = queAsoman(f).length;
  if (!n) {
    console.log(`${String(s).padEnd(5)}${"0".padStart(5)}`);
    continue;
  }
  process.stderr.write(`retícula ${s}\n`);
  const ref = medir(f, REF);
  const m = new Map(VARIANTES.map(([nombre, op]) => [nombre, medir(f, op)] as const));
  for (const [nombre] of VARIANTES) {
    errV.get(nombre)!.push(...difs(m.get(nombre)!.vigas, ref.vigas).map((x) => ({ s, ...x })));
    errF.get(nombre)!.push(...difs(m.get(nombre)!.franjas, ref.franjas).map((x) => ({ s, ...x })));
  }
  const [A, B] = [m.get("LV1")!, m.get("LV2")!];
  const e = (x: Medida, r: Map<string, { v: number; escala: number }>, cual: "vigas" | "franjas") => col(d(difs(x[cual], r)));
  console.log(
    `${String(s).padEnd(5)}${String(n).padStart(5)}${`${A.rigidosFuera} / ${B.rigidosFuera}`.padStart(25)}${`${A.jacobiano.toFixed(2)} / ${B.jacobiano.toFixed(2)}`.padStart(22)}${`${A.nudos} / ${B.nudos}`.padStart(16)}   ${[A, B].map((x) => e(x, ref.vigas, "vigas")).join(" |")}   ${[A, B].map((x) => e(x, ref.franjas, "franjas")).join(" |")}`,
  );
}
console.log(`\n### Todas (vigas: ${errV.get("LV2")!.length} caras; franjas: ${errF.get("LV2")!.length} estaciones)\n`);
console.log(`| | Vigas en la cara | Franjas junto al pilar |`);
console.log(`|---|---|---|`);
for (const [nombre] of VARIANTES) console.log(`| ${nombre}, h = 0,75, frente a la referencia |${col(d(errV.get(nombre)!))} |${col(d(errF.get(nombre)!))} |`);
const masDe = (v: number[], u: number) => v.filter((x) => Math.abs(x) > u).length;
console.log(`\nPor encima del 10 % / 20 % frente a la referencia:`);
for (const [nombre] of VARIANTES) console.log(`- ${nombre}: vigas ${masDe(d(errV.get(nombre)!), 0.1)} / ${masDe(d(errV.get(nombre)!), 0.2)}; franjas ${masDe(d(errF.get(nombre)!), 0.1)} / ${masDe(d(errF.get(nombre)!), 0.2)}`);
for (const [nombre, err] of [["vigas", errV], ["franjas", errF]] as const) {
  console.log(`\n### Las diez peores de LV2, ${nombre} (retícula, estación; LV2 y LV1 frente a la referencia)`);
  const lv1 = (x: Dif) => err.get("LV1")!.find((y) => y.s === x.s && y.k === x.k)?.d ?? NaN;
  for (const x of [...err.get("LV2")!].sort((p, q) => Math.abs(q.d) - Math.abs(p.d)).slice(0, 10)) console.log(`   ${String(x.s).padStart(2)}  ${x.k.padEnd(34)} LV2 ${pct(x.d).padStart(8)}   LV1 ${pct(lv1(x)).padStart(8)}`);
}
