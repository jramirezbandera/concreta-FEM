/**
 * Ejes de replanteo en las vistas de planta (I2, `docs/fem3d/interfaz.md` §8, §9 y §14): los del
 * modelo o, si no tiene, los propuestos (`compilador/ejes.ts`).
 *
 * - Cada eje, una recta fina de trazo y punto, con una burbuja en cada extremo que dice su nombre
 *   (o su id). Las burbujas tienen tamaño en píxeles; la recta, la geometría exacta del eje.
 * - Cotas (sólo en la vista `modelo`): por cada grupo de ejes paralelos, una cadena con la distancia
 *   entre ejes consecutivos, a COTA_DENTRO del extremo de los ejes donde empiezan, entre las
 *   burbujas y la estructura.
 *
 * Puro: sin IO.
 */
import { ejesDe } from "../../compilador/ejes.ts";
import type { EjeReplanteo, ModeloFisico } from "../../compilador/fisico.ts";
import type { EntradaLeyenda, Primitiva, Vec2 } from "./escena.ts";
import { giroTexto } from "./modelo.ts";

/** Distancia de la cadena de cotas al extremo de los ejes, m. */
export const COTA_DENTRO = 1;
/** Radio de las burbujas, px. */
export const RADIO_BURBUJA = 11;

const degenerado = (e: EjeReplanteo) => !(Number.isFinite(e.desde[0]) && Number.isFinite(e.desde[1]) && Number.isFinite(e.hasta[0]) && Number.isFinite(e.hasta[1])) || (e.desde[0] === e.hasta[0] && e.desde[1] === e.hasta[1]);

/** Distancia entre ejes, con dos decimales y coma («6,00»). */
const distancia = (d: number) => d.toFixed(2).replace(".", ",");

export function capaEjes(f: ModeloFisico, o: { cotas: boolean }): { primitivas: Primitiva[]; leyenda: EntradaLeyenda[]; notas: string[] } {
  const { ejes, propuestos } = ejesDe(f);
  const P: Primitiva[] = [];
  const notas: string[] = [];
  const validos = [...ejes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).filter((e) => {
    if (!degenerado(e)) return true;
    notas.push(`El eje ${e.id} no tiene dos extremos distintos: no se dibuja.`);
    return false;
  });
  if (!validos.length) return { primitivas: [], leyenda: [], notas };
  for (const e of validos) P.push({ tipo: "linea", puntos: [e.desde, e.hasta], estilo: "eje", objeto: e.id });
  if (o.cotas) P.push(...cotas(validos));
  for (const e of validos)
    for (const p of [e.desde, e.hasta]) {
      P.push({ tipo: "marca", p, forma: "circulo", radio: RADIO_BURBUJA, estilo: "eje-burbuja", objeto: e.id });
      P.push({ tipo: "texto", p, texto: e.nombre ?? e.id, tamano: 12, negrita: true, ancla: "medio", dy: 4, prioridad: 95, clase: "eje", objeto: e.id });
    }
  if (propuestos) notas.push("Ejes propuestos con las alineaciones de los pilares: el modelo no tiene ejes de replanteo.");
  return { primitivas: P, leyenda: [{ estilo: "eje", texto: propuestos ? "Eje de replanteo propuesto" : "Eje de replanteo" }, ...(o.cotas ? [{ estilo: "cota" as const, texto: "Cota entre ejes paralelos (m)" }] : [])], notas };
}

/** Cadenas de cotas entre ejes paralelos. */
function cotas(ejes: readonly EjeReplanteo[]): Primitiva[] {
  const grupos = new Map<number, { e: EjeReplanteo; d: Vec2 }[]>();
  for (const e of ejes) {
    let [dx, dy] = [e.hasta[0] - e.desde[0], e.hasta[1] - e.desde[1]];
    const l = Math.hypot(dx, dy);
    [dx, dy] = [dx / l, dy / l];
    // La dirección, en [0°, 180°)
    let a = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (a < 0 || a >= 180 - 1e-9) {
      a = (a + 180) % 180;
      [dx, dy] = [-dx, -dy];
    }
    const k = Math.round(a * 1e4) / 1e4;
    const g = grupos.get(k) ?? [];
    g.push({ e, d: [dx, dy] });
    grupos.set(k, g);
  }
  const P: Primitiva[] = [];
  for (const k of [...grupos.keys()].sort((a, b) => a - b)) {
    const g = grupos.get(k)!;
    if (g.length < 2) continue;
    const d = g[0]!.d;
    const n: Vec2 = [-d[1], d[0]];
    const dot = (p: Vec2, v: Vec2) => p[0] * v[0] + p[1] * v[1];
    const ts = [...new Set(g.map((x) => Math.round(dot(x.e.desde, n) * 1e9) / 1e9))].sort((a, b) => a - b);
    if (ts.length < 2) continue;
    const s = Math.min(...g.flatMap((x) => [dot(x.e.desde, d), dot(x.e.hasta, d)])) + COTA_DENTRO;
    const punto = (t: number): Vec2 => [s * d[0] + t * n[0], s * d[1] + t * n[1]];
    P.push({ tipo: "linea", puntos: [punto(ts[0]!), punto(ts[ts.length - 1]!)], estilo: "cota" });
    const m = 0.12;
    for (const t of ts) {
      const p = punto(t);
      P.push({ tipo: "linea", puntos: [[p[0] - m * (d[0] + n[0]), p[1] - m * (d[1] + n[1])], [p[0] + m * (d[0] + n[0]), p[1] + m * (d[1] + n[1])]], estilo: "cota" });
    }
    const giro = giroTexto(n);
    for (let i = 1; i < ts.length; i++) P.push({ tipo: "texto", p: punto((ts[i - 1]! + ts[i]!) / 2), texto: distancia(ts[i]! - ts[i - 1]!), tamano: 11, giro, ancla: "medio", dy: -4, fondo: true, prioridad: 15, clase: "cota" });
  }
  return P;
}
