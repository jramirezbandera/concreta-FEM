/**
 * Criterio 4 de la fase LV2 (`docs/fem3d/refinamiento-vigas.md` §18): dónde están los cuadriláteros
 * con el jacobiano escalado bajo de un modelo. Por cada lámina de losa por debajo de JACOBIANO_BAJO:
 * su centroide, su jacobiano, su losa y los rasgos de la planta más cercanos (vigas, pilares, muros,
 * bordes de la losa y de sus huecos, cargas lineales y apoyos lineales) con su distancia. Sirve para
 * saber a qué se debe cada uno antes de tocar el mallador.
 *
 *   bun validacion/lv2/malos.ts [modelo...] [--lv1] [--todo]
 *
 * Modelos: `ret<n>` (retícula al azar), `retmuros<n>` (la misma con muros al azar), `<familia>-<base|
 * hueco|giro|circ>` (geometrías de G), `obj132` (el edificio objetivo de 1 × 3 × 2 vanos) y `muros3`
 * (`aleatorio-3-muros` de C3, con sus opciones). `--lv1` compila con `refinoEsquinas: false`; `--todo`
 * lista todos los cuadriláteros por debajo del umbral y no sólo los 12 peores.
 */
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, Vec2 } from "../../src/compilador/fisico.ts";
import { JACOBIANO_BAJO } from "../../src/compilador/mallado.ts";
import { jacobianoEscalado } from "../../src/compilador/poligonos.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { edificioGeometria, type Familia } from "../../src/pruebas/geometrias.ts";
import { conLosasAleatorias } from "../../src/pruebas/losasAleatorias.ts";
import { conMurosAleatorios } from "../../src/pruebas/murosAleatorios.ts";
import { reticulaAleatoria } from "../../src/pruebas/reticulasAleatorias.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";

type Opciones = NonNullable<Parameters<typeof compilar>[1]>;

export function modeloDe(nombre: string): { fisico: ModeloFisico; opciones: Opciones } {
  let m: RegExpMatchArray | null;
  if ((m = nombre.match(/^ret(\d+)$/))) return { fisico: reticulaAleatoria(Number(m[1])), opciones: {} };
  if ((m = nombre.match(/^retmuros(\d+)$/))) {
    // El generador de muros pone una viga de sección «vb» y un empuje en el caso «V» (los de
    // `fisicoAleatorio`), que la retícula no tiene
    const f = reticulaAleatoria(Number(m[1]));
    const conVb = { ...f, secciones: [...f.secciones, { id: "vb", material: f.secciones[0]!.material, forma: "rectangular" as const, b: 0.3, h: 0.5 }], casos: [...f.casos, { id: "V" }] };
    return { fisico: conMurosAleatorios(conVb, Number(m[1])), opciones: {} };
  }
  if ((m = nombre.match(/^(rombo|circular|abanico|alas|triangular)-(base|hueco|giro|circ)$/))) {
    const v = { base: {}, hueco: { hueco: true }, giro: { giro: 23 }, circ: { circulares: true } }[m[2]!];
    return { fisico: edificioGeometria(m[1] as Familia, v), opciones: {} };
  }
  if (nombre === "obj132") return { fisico: edificioObjetivoLosas(1, 3, 2), opciones: {} };
  if (nombre === "muros3") return { fisico: conMurosAleatorios(conLosasAleatorias(fisicoAleatorio(3), 3), 3), opciones: { franjas: false, tamanoMalla: 1.25, rejilla: false } };
  throw new Error(`modelo desconocido: ${nombre}`);
}

const dSeg = (q: Vec2, A: Vec2, B: Vec2) => {
  const [dx, dy] = [B[0] - A[0], B[1] - A[1]];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - A[0]) * dx + (q[1] - A[1]) * dy) / l2)) : 0;
  const [px, py] = [A[0] + t * dx - q[0], A[1] + t * dy - q[1]];
  return Math.sqrt(px * px + py * py);
};
const dPoli = (q: Vec2, p: readonly Vec2[], cerrada = false) => {
  let d = Infinity;
  for (let i = 0; i + 1 < p.length; i++) d = Math.min(d, dSeg(q, p[i]!, p[i + 1]!));
  if (cerrada && p.length > 2) d = Math.min(d, dSeg(q, p[p.length - 1]!, p[0]!));
  return d;
};

export interface Malo {
  lamina: number;
  losa: string;
  jac: number;
  c: Vec2;
  cerca: string[];
}

/** Los cuadriláteros de losa por debajo de `umbral`, con lo que tienen cerca. */
export function malos(fisico: ModeloFisico, opciones: Opciones, umbral = JACOBIANO_BAJO): { c: ReturnType<typeof compilar>; malos: Malo[] } {
  const c = compilar(fisico, opciones);
  const r: Malo[] = [];
  if (!c.valido) return { c, malos: r };
  const losas = new Map(fisico.losas?.map((l) => [l.id, l]) ?? []);
  const secciones = new Map(fisico.secciones.map((s) => [s.id, s]));
  c.modelo.laminas!.forEach((l, i) => {
    const mp = c.mapeo.laminas![i]!;
    if (!("losa" in mp)) return;
    const X = l.nudos.map((n) => [c.modelo.nudos[n]!.x, c.modelo.nudos[n]!.y] as Vec2);
    const jac = jacobianoEscalado(X);
    if (!(jac < umbral)) return;
    const q: Vec2 = [(X[0]![0] + X[1]![0] + X[2]![0] + X[3]![0]) / 4, (X[0]![1] + X[1]![1] + X[2]![1] + X[3]![1]) / 4];
    const losa = losas.get(mp.losa)!;
    const cand: [string, number][] = [];
    for (const v of fisico.vigas ?? []) if (v.planta === losa.planta) cand.push([`viga ${v.id}`, dPoli(q, v.puntos)]);
    for (const p of fisico.pilares ?? []) {
      const s = secciones.get(p.seccion)!;
      const rad = s.forma === "circular" ? s.D / 2 : Math.sqrt(s.b * s.b + s.h * s.h) / 2;
      cand.push([`pilar ${p.id}`, Math.max(0, Math.sqrt((p.x - q[0]) * (p.x - q[0]) + (p.y - q[1]) * (p.y - q[1])) - rad)]);
    }
    for (const w of fisico.muros ?? []) cand.push([`muro ${w.id}`, dPoli(q, w.puntos)]);
    cand.push([`borde ${losa.id}`, dPoli(q, losa.contorno, true)]);
    losa.huecos?.forEach((h, k) => cand.push([`hueco ${losa.id}#${k}`, dPoli(q, h, true)]));
    for (const a of fisico.apoyosLineales ?? []) if (a.planta === losa.planta) cand.push([`apoyo ${a.id}`, dPoli(q, a.puntos)]);
    for (const g of fisico.cargas ?? []) if (g.tipo === "lineal" && g.planta === losa.planta) cand.push([`carga ${g.id}`, dPoli(q, g.puntos)]);
    cand.sort((a, b) => a[1] - b[1]);
    r.push({ lamina: i, losa: losa.id, jac, c: q, cerca: cand.slice(0, 3).map(([n, d]) => `${n} a ${d.toFixed(3)}`) });
  });
  r.sort((a, b) => a.jac - b.jac);
  return { c, malos: r };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const lv1 = args.includes("--lv1");
  const todo = args.includes("--todo");
  const nombres = args.filter((a) => !a.startsWith("--"));
  for (const n of nombres) {
    const { fisico, opciones } = modeloDe(n);
    const op: Opciones = lv1 ? { ...opciones, refinoEsquinas: false } : opciones;
    const { c, malos: ms } = malos(fisico, op);
    if (!c.valido) {
      console.log(`${n}: NO COMPILA: ${c.diagnosticos[0]?.mensaje}`);
      continue;
    }
    const st = c.estadisticas.malla;
    const avisos = c.diagnosticos.filter((d) => d.codigo.startsWith("malla/")).map((d) => `${d.codigo}${d.objetos?.length ? ` (${d.objetos.join(", ")})` : ""}`);
    console.log(`\n${n}${lv1 ? " LV1" : " LV2"}: ${c.modelo.nudos.length} nudos, jac mín ${st.jacobianoMin.toFixed(3)}, ${st.bajos} bajos; ${avisos.join("; ") || "sin avisos de malla"}`);
    for (const m of todo ? ms : ms.slice(0, 12)) console.log(`  ${m.jac.toFixed(3)}  (${m.c[0].toFixed(2)}, ${m.c[1].toFixed(2)})  ${m.losa}  ${m.cerca.join(" · ")}`);
    if (!todo && ms.length > 12) console.log(`  … y ${ms.length - 12} más`);
  }
}
