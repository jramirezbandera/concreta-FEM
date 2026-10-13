/**
 * El armado en el visor, más allá del mapa en planta (fase AB, `docs/fem3d/armado.md` §2.3 y §2.4):
 * - los tramos de las franjas de una planta (o de todas), calculados una vez por resultados,
 *   armadura y combinaciones, para el mapa, el valor de un punto y el 3D;
 * - `valorArmado`: lo que hay en un punto de la planta (la estación cuyo tramo lo contiene), con los
 *   valores de «fem consultar franja» bit a bit y la base de su losa;
 * - `armado3D`: los tramos en la cota de sus losas, con la estructura de los isovalores de I4 (el 3D
 *   los dibuja igual), los mismos límites y colores que la planta con una planta, y una escala común
 *   con todas. Cada triángulo lleva el índice de su planta, para la sonda.
 *
 * Puro: sin IO.
 */
import { baseDe, type ArmadoProyecto } from "../agente/armaduraBase.ts";
import type { ConjuntoCombinaciones } from "../agente/combinaciones.ts";
import { franja as consultaFranja, type EstacionFranjaEnvolvente } from "../agente/consultas.ts";
import { mapaArmado, tituloArmado, UNIDAD_ARMADO, type OpcionesArmado } from "../agente/render/armado.ts";
import type { EntradaLeyenda, EscalaDibujada } from "../agente/render/escena.ts";
import type { ResultadosRender } from "../agente/render/resultados.ts";
import { franjasTramos, losasDe, type Armadura, type FranjaTramos, type TramoArmado } from "../agente/refuerzos.ts";
import type { ExtremoIsovalores } from "./isovalores3d.ts";
import type { Consultas } from "../compilador/consultas.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";

type Resp<T> = { valido: true; valor: T; diagnosticos: Diagnostico[] } | { valido: false; diagnosticos: Diagnostico[] };

const cache = new WeakMap<Consultas, Map<string, Resp<FranjaTramos[]>>>();

/** Los tramos de las franjas de una planta (null: todas) en una armadura, una vez por resultados y combinaciones. */
export function tramosPlanta(q: Consultas, planta: string | null, armadura: Armadura, conjunto: ConjuntoCombinaciones): Resp<FranjaTramos[]> {
  let m = cache.get(q);
  if (!m) cache.set(q, (m = new Map()));
  const clave = JSON.stringify([planta, armadura, conjunto.descripcion, conjunto.nombres, conjunto.factores.map((f) => Array.from(f))]);
  let r = m.get(clave);
  if (!r) {
    r = franjasTramos(q, losasDe(q, planta === null ? {} : { planta }), armadura, conjunto);
    m.set(clave, r);
  }
  return r;
}

/** Lo que hay en un punto del mapa de armado. */
export interface ValorArmado {
  franja: string;
  losa: string;
  /** El punto (m, globales) y sus coordenadas en la franja (s a lo largo, t en transversal). */
  punto: [number, number];
  s: number;
  t: number;
  /** La estación cuyo tramo contiene el punto, como la da «fem consultar franja». */
  estacion: EstacionFranjaEnvolvente;
  armadura: Armadura;
  /** La demanda de la armadura en esa estación, kN·m/m, con su combinación. */
  valor: number;
  comb: string;
  /** La base de la losa en la armadura y lo que la supera (null sin base). */
  base: number | null;
  exceso: number | null;
}

/** El valor del mapa de armado en un punto de una planta (null: fuera de las franjas, en un hueco o entre las caras de un pilar sin estación). */
export function valorArmado(q: Consultas, planta: string, armadura: Armadura, conjunto: ConjuntoCombinaciones, x: number, y: number, armado?: ArmadoProyecto): Resp<ValorArmado | null> {
  const fs = tramosPlanta(q, planta, armadura, conjunto);
  if (!fs.valido) return fs;
  for (const { franja: f, tramos } of fs.valor) {
    const t = x * f.n[0] + y * f.n[1];
    if (t < f.t0 - 1e-9 || t > f.t1 + 1e-9) continue;
    const s = x * f.d[0] + y * f.d[1];
    const tr = tramos.find((u) => s >= u.a - 1e-9 && s <= u.b + 1e-9);
    if (!tr) continue;
    const c = consultaFranja(q, conjunto, f.id);
    if (!c.valido) return c;
    const e = c.valor.estaciones[tr.estacion]!;
    const base = baseDe(armado, f.losa, armadura);
    const [valor, comb] = armadura.endsWith("inf") ? e.inferior : e.superior;
    return { valido: true, valor: { franja: f.id, losa: f.losa, punto: [x, y], s, t, estacion: e, armadura, valor, comb, base, exceso: base === null ? null : valor - base }, diagnosticos: [] };
  }
  return { valido: true, valor: null, diagnosticos: [] };
}

/** El armado en el 3D: la malla de los isovalores de I4 (sin campo) y su leyenda. */
export interface Armado3D {
  armadura: Armadura;
  unidad: string;
  tituloLeyenda: string;
  origen: [number, number, number];
  /** Las plantas que se dibujan; `lamina` de cada triángulo es su índice aquí. */
  plantas: string[];
  conjunto: { descripcion: string; n: number };
  triangulos: Float32Array;
  banda: Uint16Array;
  lamina: Int32Array;
  colores: string[];
  /** Lo cubierto por la base (gris). */
  sinMapa: Float32Array;
  /** El contorno de las zonas de refuerzo. */
  isolineas: Float32Array;
  ceros: Float32Array;
  /** Con base, el máximo de cada zona de refuerzo; sin ella, el mayor de cada planta. */
  extremos: ExtremoIsovalores[];
  zonas: number;
  mapa?: EscalaDibujada;
  leyenda: EntradaLeyenda[];
  notas: string[];
}

export function armado3D(r: ResultadosRender, origen: [number, number, number], armadura: Armadura, conjunto: ConjuntoCombinaciones, op: OpcionesArmado & { planta: string | null }): Resp<Armado3D> {
  const fs = tramosPlanta(r.q, op.planta, armadura, conjunto);
  if (!fs.valido) return fs;
  const m = mapaArmado(fs.valor, armadura, op);
  // La cota de cada losa: la de sus láminas en el modelo analítico
  const c = r.c;
  const z = new Map<string, number>();
  (c.mapeo.laminas ?? []).forEach((ml, i) => {
    if (ml.losa && !z.has(ml.losa)) z.set(ml.losa, c.modelo.nudos[c.modelo.laminas![i]!.nudos[0]!]!.z);
  });
  const todas = r.q.fisico.plantas.map((p) => p.id);
  const plantaDe = new Map((r.q.fisico.losas ?? []).map((l) => [l.id, l.planta]));
  const plantas = todas.filter((p) => fs.valor.some((f) => f.franja.planta === p));
  const idx = new Map(plantas.map((p, i) => [p, i]));
  const tri: number[] = [];
  const banda: number[] = [];
  const lamina: number[] = [];
  const sin: number[] = [];
  const rel = (p: readonly number[], zz: number, a: number[]) => a.push(p[0]! - origen[0], p[1]! - origen[1], zz - origen[2]);
  for (const { t, banda: b } of m.coloreados) {
    const zz = z.get(t.losa) ?? 0;
    const R = t.rectangulo;
    for (const k of [0, 1, 2, 0, 2, 3]) rel(R[k]!, zz, tri);
    banda.push(b, b);
    const i = idx.get(plantaDe.get(t.losa)!)!;
    lamina.push(i, i);
  }
  for (const t of m.cubiertos) for (const k of [0, 1, 2, 0, 2, 3]) rel(t.rectangulo[k]!, z.get(t.losa) ?? 0, sin);
  const iso: number[] = [];
  for (const zn of m.zonas) {
    const zz = z.get(zn.losa) ?? 0;
    for (const [a, b] of zn.contorno) rel(a, zz, iso), rel(b, zz, iso);
  }
  const extremos: ExtremoIsovalores[] = [];
  const centro = (t: TramoArmado): [number, number, number] => [(t.rectangulo[0]![0] + t.rectangulo[2]![0]) / 2, (t.rectangulo[0]![1] + t.rectangulo[2]![1]) / 2, z.get(t.losa) ?? 0];
  if (m.conBase)
    for (const zn of m.zonas) {
      const t = zn.tramos.find((x) => x.franja === zn.maximo.franja && x.s === zn.maximo.s && x.v === zn.maximo.v)!;
      extremos.push({ que: "máximo", valor: zn.maximo.v, objeto: zn.id, punto: centro(t) });
    }
  else
    for (const p of plantas) {
      let mx: TramoArmado | null = null;
      for (const f of fs.valor) if (f.franja.planta === p) for (const t of f.tramos) if (t.v > (mx?.v ?? 0)) mx = t;
      if (mx) extremos.push({ que: "máximo", valor: mx.v, objeto: mx.franja, punto: centro(mx) });
    }
  const lm = m.limites;
  const notas = [...m.notas, op.planta === null ? `Todas las plantas con losas macizas o reticulares (${plantas.length}), con una escala común.` : `Planta ${op.planta}: la misma escala que su vista en planta.`];
  return {
    valido: true,
    valor: {
      armadura,
      unidad: UNIDAD_ARMADO,
      tituloLeyenda: tituloArmado(armadura),
      origen,
      plantas,
      conjunto: { descripcion: conjunto.descripcion, n: conjunto.factores.length },
      triangulos: Float32Array.from(tri),
      banda: Uint16Array.from(banda),
      lamina: Int32Array.from(lamina),
      colores: m.colores,
      sinMapa: Float32Array.from(sin),
      isolineas: Float32Array.from(iso),
      ceros: new Float32Array(0),
      extremos,
      zonas: m.zonas.length,
      ...(lm
        ? {
            mapa: {
              limites: lm.L.slice(lm.fueraAbajo ? 1 : 0, lm.fueraArriba ? lm.L.length - 1 : lm.L.length),
              paso: lm.paso,
              fueraAbajo: lm.fueraAbajo,
              fueraArriba: lm.fueraArriba,
              picos: false,
              minimo: Math.min(...m.coloreados.map((x) => x.t.v)),
              maximo: Math.max(...m.coloreados.map((x) => x.t.v)),
              combinacion: "",
            },
          }
        : {}),
      leyenda: m.leyenda,
      notas,
    },
    diagnosticos: [],
  };
}
