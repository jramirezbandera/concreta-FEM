/**
 * Las cargas de un caso en el alzado y en el 3D (a petición del usuario, tras I4;
 * `docs/fem3d/interfaz.md` §17). Sólo necesitan el modelo físico, así que se dibujan también si no
 * compila.
 *
 * `geometriaCargas` sitúa cada carga en el espacio como la lee el compilador (`compilador/cargas.ts`),
 * y de ella salen el alzado (`vistaAlzadoCargas`) y el 3D (`src/visor/cargas3d.ts`):
 * - superficie: la parte de su losa o su paño dentro de su zona, o la de su zona dentro de las losas y
 *   los paños de la planta (C2-h), a la cota de la planta;
 * - lineal: su polilínea, a la cota de la planta;
 * - puntual: su punto, a la cota de la planta;
 * - viga: el eje de cada tramo, a la cota de su planta (C1-c), entre `desde` y `hasta`, con q y qb
 *   pasadas a globales con los ejes del tramo si son locales;
 * - pilar: su eje, de la cota de su base hacia arriba, igual;
 * - empuje: cada tramo del eje del muro, entre las cotas de su base y su cabeza, con la presión que
 *   empuja hacia el lado contrario al del terreno, sin sus huecos.
 * Así la resultante de lo dibujado es la del caso sin el peso propio (`cargas.test.ts`).
 *
 * Alzado: lo que está en el plano, como un bloque a escala con la punta de sus flechas en la pieza
 * (hacia donde va la carga):
 * - las de superficie, donde su región está a menos de la profundidad del plano (el corte de las
 *   rectas paralelas a él en w = 0, ±prof/2 y ±prof: en un eje de fachada, el borde de la losa cae en
 *   él), con su componente Z;
 * - las lineales y las de vigas y pilares, en los tramos paralelos al plano a menos de la
 *   profundidad, con su componente en el plano perpendicular a la pieza; en los que lo cruzan, una
 *   flecha en el cruce con su componente en el plano;
 * - las puntuales a menos de la profundidad, una flecha de largo fijo con su componente en el plano, y
 *   su momento: la componente normal al plano, un arco (antihorario positivo tal como se mira), y la
 *   del plano, una flecha de doble punta (`momento2D`);
 * - los empujes, en los muros que cruzan el plano (su componente en él); en los paralelos, un rótulo.
 * Lo que es normal al plano (el viento según X en un pórtico según Y) se rotula, sin bloque.
 * Escalas: la mayor carga de superficie que se ve ocupa ORDENADA_DIAGRAMA m por la pedida, y la
 * mayor por metro, lo mismo con la suya (son otra unidad).
 *
 * Puro: sin IO.
 */
import { cotasPlantas } from "../../compilador/cotas.ts";
import { conPuntoFijo } from "../../compilador/puntoFijo.ts";
import type { CargaFisica, ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import { intervalosRecta, PROFUNDIDAD_ALZADO, SENO_PARALELO, vistaAlzado, type OpcionesAlzado, type PlanoAlzado } from "./alzado.ts";
import { ORDENADA_DIAGRAMA } from "./diagramas.ts";
import { cajaDe, momento2D, R_MOMENTO, rotulo, type EntradaLeyenda, type Escena, type Estilo, type Primitiva } from "./escena.ts";
import { ejeSeccion, giroTexto, porId, vector, type DatosVista } from "./modelo.ts";
import { flecha2D } from "./reacciones.ts";

export type V3 = [number, number, number];

/** Cómo se dibuja una carga (su color): como en la planta, las de vigas, pilares y muros son «pieza». */
export type ClaseCarga = "superficie" | "lineal" | "puntual" | "pieza";
export const CLASE_CARGA: Record<CargaFisica["tipo"], ClaseCarga> = { superficie: "superficie", lineal: "lineal", puntual: "puntual", viga: "pieza", pilar: "pieza", empuje: "pieza" };

/** La parte de P (anillos, par-impar) dentro de alguna de las `capas` (null: P entera), a la cota z, con q (kN/m², globales). */
export interface RegionCarga {
  P: Vec2[][];
  capas: Vec2[][][] | null;
  z: number;
  q: V3;
}

/** Un tramo recto con una carga por metro (kN/m, globales) que va de qa en a a qb en b. */
export interface LineaCarga {
  a: V3;
  b: V3;
  qa: V3;
  qb: V3;
}

export interface PuntoCarga {
  p: V3;
  F: V3;
  M: V3;
}

/**
 * Un empuje sobre un tramo de muro: el tramo de A a B (a la cota de su base), la dirección n en la
 * que empuja (horizontal, normal al tramo), las cotas entre las que hay presión (`zs`, dentro del
 * muro) y la presión: p0 en la cota z0 y p1 en la z1, lineal entre ellas. Sin los huecos: s a lo
 * largo del tramo desde A y cotas absolutas.
 */
export interface PresionCarga {
  A: V3;
  B: V3;
  n: V3;
  zs: [number, number];
  z0: number;
  z1: number;
  p0: number;
  p1: number;
  huecos: { s0: number; s1: number; z0: number; z1: number }[];
  espesor: number;
}

export interface GeometriaCarga {
  carga: CargaFisica;
  clase: ClaseCarga;
  regiones: RegionCarga[];
  lineas: LineaCarga[];
  puntos: PuntoCarga[];
  presiones: PresionCarga[];
}

/** La presión de un empuje a una cota (nula fuera de [z0, z1]). */
export function presionEn(pr: Pick<PresionCarga, "z0" | "z1" | "p0" | "p1">, z: number): number {
  const [lo, hi] = [Math.min(pr.z0, pr.z1), Math.max(pr.z0, pr.z1)];
  if (z < lo || z > hi) return 0;
  return pr.z1 === pr.z0 ? pr.p0 : pr.p0 + ((pr.p1 - pr.p0) * (z - pr.z0)) / (pr.z1 - pr.z0);
}

const mas = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const por = (a: readonly number[], k: number): V3 => [a[0]! * k, a[1]! * k, a[2]! * k];

/** Las cargas de un caso situadas en el espacio, por id, y lo que no se puede situar. */
export function geometriaCargas(f: ModeloFisico, caso: string): { cargas: GeometriaCarga[]; notas: string[] } {
  const plantas = f.plantas ?? [];
  const cotas = cotasPlantas(plantas);
  const indice = new Map(plantas.map((p, i) => [p.id, i]));
  const cota = (id: string) => cotas[indice.get(id) ?? -1] ?? null;
  const vigas = new Map((f.vigas ?? []).map((v) => [v.id, v]));
  const pilares = new Map((f.pilares ?? []).map((p) => [p.id, p]));
  const muros = new Map((f.muros ?? []).map((m) => [m.id, m]));
  const losas = new Map((f.losas ?? []).map((l) => [l.id, l]));
  const panos = new Map((f.panos ?? []).map((p) => [p.id, p]));
  const anillos = (x: { contorno: readonly Vec2[]; huecos?: readonly (readonly Vec2[])[] }): Vec2[][] => [x.contorno as Vec2[], ...((x.huecos ?? []) as Vec2[][])];
  const notas: string[] = [];
  const r: GeometriaCarga[] = [];

  for (const g of porId((f.cargas ?? []).filter((x) => x.caso === caso))) {
    const x: GeometriaCarga = { carga: g, clase: CLASE_CARGA[g.tipo], regiones: [], lineas: [], puntos: [], presiones: [] };
    switch (g.tipo) {
      case "superficie": {
        const z = cota(g.planta);
        if (z === null) break;
        const q: V3 = [g.q[0], g.q[1], g.q[2]];
        const sobre = g.losa ? losas.get(g.losa) : g.pano ? panos.get(g.pano) : undefined;
        if (g.losa || g.pano) {
          if (!sobre) notas.push(`${g.id}: no existe ${g.losa ?? g.pano}.`);
          else x.regiones.push({ P: anillos(sobre), capas: g.zona ? [[g.zona as Vec2[]]] : null, z, q });
        } else if (g.zona) {
          // Lo que cae fuera de las losas y los paños no es carga (C2-h)
          const capas = [...(f.losas ?? []), ...(f.panos ?? [])].filter((l) => l.planta === g.planta).map(anillos);
          if (capas.length) x.regiones.push({ P: [g.zona as Vec2[]], capas, z, q });
          else notas.push(`${g.id}: en ${g.planta} no hay losas ni paños donde caiga.`);
        } else notas.push(`${g.id}: carga de superficie sin zona, losa ni paño.`);
        break;
      }
      case "lineal": {
        const z = cota(g.planta);
        if (z === null) break;
        const q: V3 = [g.q[0], g.q[1], g.q[2]];
        for (let i = 1; i < g.puntos.length; i++) {
          const [a, b] = [g.puntos[i - 1]!, g.puntos[i]!];
          if (a[0] !== b[0] || a[1] !== b[1]) x.lineas.push({ a: [a[0], a[1], z], b: [b[0], b[1], z], qa: q, qb: q });
        }
        break;
      }
      case "puntual": {
        const z = cota(g.planta);
        if (z === null) break;
        x.puntos.push({ p: [g.x, g.y, z], F: [...(g.F ?? [0, 0, 0])] as V3, M: [...(g.M ?? [0, 0, 0])] as V3 });
        break;
      }
      case "viga": {
        const v = vigas.get(g.viga);
        const z = v ? cota(v.planta) : null;
        if (!v || z === null) {
          notas.push(`${g.id}: no existe la viga ${g.viga} o su planta.`);
          break;
        }
        // Ejes de cada tramo: x según el tramo, z = +Z, y = z × x
        let s0 = 0;
        const total = v.puntos.slice(1).reduce((s, b, i) => s + Math.hypot(b[0] - v.puntos[i]![0], b[1] - v.puntos[i]![1]), 0);
        const [a, b] = [g.desde ?? 0, g.hasta ?? total];
        const qb = g.qb ?? g.q;
        const qEn = (s: number): V3 => {
          const t = b === a ? 0 : (s - a) / (b - a);
          return [g.q[0] + t * (qb[0] - g.q[0]), g.q[1] + t * (qb[1] - g.q[1]), g.q[2] + t * (qb[2] - g.q[2])];
        };
        for (let i = 1; i < v.puntos.length; i++) {
          const [A, B] = [v.puntos[i - 1]!, v.puntos[i]!];
          const l = Math.hypot(B[0] - A[0], B[1] - A[1]);
          if (l === 0) continue;
          const ex: V3 = [(B[0] - A[0]) / l, (B[1] - A[1]) / l, 0];
          const ey: V3 = [-ex[1], ex[0], 0];
          const glob = (q: V3): V3 => (g.ejes === "global" ? q : mas(mas(por(ex, q[0]), por(ey, q[1])), por([0, 0, 1], q[2])));
          const [lo, hi] = [Math.max(a, s0), Math.min(b, s0 + l)];
          if (hi > lo) {
            const P = (s: number): V3 => [A[0] + ex[0] * (s - s0), A[1] + ex[1] * (s - s0), z];
            x.lineas.push({ a: P(lo), b: P(hi), qa: glob(qEn(lo)), qb: glob(qEn(hi)) });
          }
          s0 += l;
        }
        break;
      }
      case "pilar": {
        const p = pilares.get(g.pilar);
        const [zb, zc] = p ? [cota(p.desde), cota(p.hasta)] : [null, null];
        if (!p || zb === null || zc === null) {
          notas.push(`${g.id}: no existe el pilar ${g.pilar} o sus plantas.`);
          break;
        }
        // Ejes: x hacia arriba, z = el canto girado `giro` desde +X, y = z × x
        const t = ((p.giro ?? 0) * Math.PI) / 180;
        const [c, s] = [Math.cos(t), Math.sin(t)];
        const glob = (q: readonly number[]): V3 => (g.ejes === "global" ? [q[0]!, q[1]!, q[2]!] : [q[1]! * s + q[2]! * c, -q[1]! * c + q[2]! * s, q[0]!]);
        const [a, b] = [g.desde ?? 0, g.hasta ?? zc - zb];
        if (!(b > a)) break;
        const [qa, qb] = [glob(g.q), glob(g.qb ?? g.q)];
        if (!conPuntoFijo(p)) {
          x.lineas.push({ a: [p.x, p.y, zb + a], b: [p.x, p.y, zb + b], qa, qb });
          break;
        }
        // PF: cada tramo, en su eje (el centro de su sección), con la carga interpolada en sus extremos
        const qEn = (z: number): V3 => qa.map((v, i) => v + ((qb[i]! - v) * (z - zb - a)) / (b - a)) as unknown as V3;
        for (let k = (indice.get(p.desde) ?? 0) - 1; k >= (indice.get(p.hasta) ?? 0); k--) {
          const [z0, z1] = [cotas[k + 1], cotas[k]];
          if (z0 === null || z1 === null || z0 === undefined || z1 === undefined) continue;
          const lo = Math.max(zb + a, z0);
          const hi = Math.min(zb + b, z1);
          if (!(hi > lo)) continue;
          const sid = p.tramos?.find((t) => t.planta === plantas[k]!.id)?.seccion ?? p.seccion;
          const [ex, ey] = ejeSeccion(p, f.secciones?.find((x) => x.id === sid));
          x.lineas.push({ a: [ex, ey, lo], b: [ex, ey, hi], qa: lo === zb + a ? qa : qEn(lo), qb: hi === zb + b ? qb : qEn(hi) });
        }
        break;
      }
      case "empuje": {
        const m = muros.get(g.muro);
        const [zb, zc] = m ? [cota(m.desde), cota(m.hasta)] : [null, null];
        if (!m || zb === null || zc === null) {
          notas.push(`${g.id}: no existe el muro ${g.muro} o sus plantas.`);
          break;
        }
        const [z0, z1] = [zb + g.z0, zb + g.z1];
        const zs: [number, number] = [Math.max(Math.min(z0, z1), zb), Math.min(Math.max(z0, z1), zc)];
        if (!(zs[1] > zs[0])) break;
        let s0 = 0;
        for (let i = 1; i < m.puntos.length; i++) {
          const [A, B] = [m.puntos[i - 1]!, m.puntos[i]!];
          const l = Math.hypot(B[0] - A[0], B[1] - A[1]);
          if (l === 0) continue;
          // La normal de las láminas, a la derecha del eje; el terreno a la izquierda empuja hacia ella
          const der: V3 = [(B[1] - A[1]) / l, -(B[0] - A[0]) / l, 0];
          const huecos = (m.huecos ?? []).flatMap((h) => {
            const [a, b] = [Math.max(h.desde, s0) - s0, Math.min(h.hasta, s0 + l) - s0];
            return b > a ? [{ s0: a, s1: b, z0: zb + h.z0, z1: zb + h.z1 }] : [];
          });
          x.presiones.push({ A: [A[0], A[1], zb], B: [B[0], B[1], zb], n: g.lado === "izquierdo" ? der : por(der, -1), zs, z0, z1, p0: g.p0, p1: g.p1, huecos, espesor: m.espesor });
          s0 += l;
        }
        break;
      }
    }
    r.push(x);
  }
  return { cargas: r, notas };
}

/** El rótulo de una carga: su id, su valor y sus unidades, como en la planta. */
export function textoCarga(g: CargaFisica): string {
  switch (g.tipo) {
    case "superficie":
      return `${g.id}: ${vector(g.q)} kN/m²`;
    case "lineal":
      return `${g.id}: ${vector(g.q)} kN/m`;
    case "puntual":
      return `${g.id}: F ${vector(g.F ?? [0, 0, 0])} kN${g.M ? `, M ${vector(g.M)} kN·m` : ""}`;
    case "viga":
    case "pilar":
      return `${g.id}: ${vector(g.q)}${g.qb ? ` a ${vector(g.qb)}` : ""} kN/m ${g.ejes}`;
    case "empuje":
      return `${g.id}: empuje ${rotulo(g.p0)} a ${rotulo(g.p1)} kN/m²`;
  }
}

// ─── Alzado ─────────────────────────────────────────────────────────────────────────────────────

type Iv = [number, number];

function unir(iv: Iv[]): Iv[] {
  const s = [...iv].sort((a, b) => a[0] - b[0]);
  const r: Iv[] = [];
  for (const x of s) {
    const u = r[r.length - 1];
    if (u && x[0] <= u[1]) u[1] = Math.max(u[1], x[1]);
    else r.push([x[0], x[1]]);
  }
  return r;
}

function cortar(a: Iv[], b: Iv[]): Iv[] {
  const r: Iv[] = [];
  for (const x of a)
    for (const y of b) {
      const [lo, hi] = [Math.max(x[0], y[0]), Math.min(x[1], y[1])];
      if (hi > lo) r.push([lo, hi]);
    }
  return r;
}

const ESTILO_CLASE: Record<ClaseCarga, Estilo> = { superficie: "carga-superficie", lineal: "carga-banda-lineal", puntual: "carga-puntual", pieza: "carga-banda-pieza" };

/** Un bloque de carga en el alzado: la pieza de `base[0]` a `base[1]` y la ordenada en cada extremo (en kN/m² o kN/m, hacia donde está la cola). */
interface Bloque {
  g: CargaFisica;
  porArea: boolean;
  base: [Vec2, Vec2];
  ord: [Vec2, Vec2];
}

export function vistaAlzadoCargas(f: ModeloFisico, plano: PlanoAlzado, caso: string, d: DatosVista, escala = 1, base0: OpcionesAlzado = {}): Escena {
  const c = f.casos.find((x) => x.id === caso);
  const prof = plano.profundidad ?? PROFUNDIDAD_ALZADO;
  const L = Math.hypot(plano.hasta[0] - plano.desde[0], plano.hasta[1] - plano.desde[1]);
  const dir: Vec2 = L > 0 ? [(plano.hasta[0] - plano.desde[0]) / L, (plano.hasta[1] - plano.desde[1]) / L] : [1, 0];
  const nor: Vec2 = [-dir[1], dir[0]];
  const u = (q: readonly number[]) => (q[0]! - plano.desde[0]) * dir[0] + (q[1]! - plano.desde[1]) * dir[1];
  const w = (q: readonly number[]) => (q[0]! - plano.desde[0]) * nor[0] + (q[1]! - plano.desde[1]) * nor[1];
  /** Una carga en el plano: su componente según el alzado y la vertical. */
  const enPlano = (q: readonly number[]): Vec2 => [q[0]! * dir[0] + q[1]! * dir[1], q[2]!];
  const geo = geometriaCargas(f, caso);

  const bloques: Bloque[] = [];
  /** Las cargas que sólo tienen componente normal al plano, donde van. */
  const normales: { g: CargaFisica; p: Vec2 }[] = [];
  const cruces: { g: CargaFisica; p: Vec2; v: Vec2 }[] = [];
  /** v: F en el plano; giro y M: el momento normal al plano (hacia quien mira) y en el plano. */
  const puntuales: { g: CargaFisica; p: Vec2; v: Vec2; giro: number; M: Vec2 }[] = [];
  const paralelos: { g: CargaFisica; p: Vec2 }[] = [];
  let horizontales = false;
  for (const x of geo.cargas) {
    const g = x.carga;
    for (const r of x.regiones) {
      // Las rectas de la franja, un poco movidas para no pasar justo por los vértices
      const iv = unir(
        [-1, -0.5, 0, 0.5, 1].flatMap((k) => {
          const o: Vec2 = [plano.desde[0] + nor[0] * (k * prof + 1e-7), plano.desde[1] + nor[1] * (k * prof + 1e-7)];
          const a = intervalosRecta(r.P, o, dir);
          return r.capas ? cortar(a, unir(r.capas.flatMap((c) => intervalosRecta(c, o, dir)))) : a;
        }),
      );
      if (!iv.length) continue;
      if (r.q[0] || r.q[1]) horizontales = true;
      if (!r.q[2]) continue;
      for (const [a, b] of iv) bloques.push({ g, porArea: true, base: [[a, r.z], [b, r.z]], ord: [[0, -r.q[2]], [0, -r.q[2]]] });
    }
    for (const l of x.lineas) {
      const [dx, dy] = [l.b[0] - l.a[0], l.b[1] - l.a[1]];
      const dh = Math.hypot(dx, dy);
      const [wa, wb] = [w(l.a), w(l.b)];
      const [pa, pb]: Vec2[] = [[u(l.a), l.a[2]], [u(l.b), l.b[2]]];
      const paralelo = dh < 1e-9 || Math.abs(dx * nor[0] + dy * nor[1]) / dh < SENO_PARALELO;
      if (paralelo) {
        if (Math.abs(wa) > prof || Math.abs(wb) > prof) continue;
        const lt = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        if (!(lt > 0)) continue;
        const t: Vec2 = [(pb[0] - pa[0]) / lt, (pb[1] - pa[1]) / lt];
        // La componente en el plano perpendicular a la pieza, hacia la cola
        const perp = (q: V3): Vec2 => {
          const v = enPlano(q);
          const k = v[0] * t[0] + v[1] * t[1];
          return [-(v[0] - k * t[0]), -(v[1] - k * t[1])];
        };
        const ord: [Vec2, Vec2] = [perp(l.qa), perp(l.qb)];
        if (Math.hypot(...ord[0]) + Math.hypot(...ord[1]) > 1e-12 * (Math.hypot(...l.qa) + Math.hypot(...l.qb))) bloques.push({ g, porArea: false, base: [pa, pb], ord });
        else normales.push({ g, p: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2] });
      } else if (wa > 0 !== wb > 0 || wa === 0 || wb === 0) {
        const t = wa / (wa - wb);
        const q = l.qa.map((v, k) => v + t * (l.qb[k]! - v));
        cruces.push({ g, p: [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])], v: enPlano(q) });
      }
    }
    for (const p of x.puntos) {
      if (Math.abs(w(p.p)) > prof) continue;
      // Hacia quien mira (u a la derecha, z arriba): u × z = −nor
      puntuales.push({ g, p: [u(p.p), p.p[2]], v: enPlano(p.F), giro: -(p.M[0] * nor[0] + p.M[1] * nor[1]), M: enPlano(p.M) });
    }
    for (const pr of x.presiones) {
      const l = Math.hypot(pr.B[0] - pr.A[0], pr.B[1] - pr.A[1]);
      const t2: Vec2 = [(pr.B[0] - pr.A[0]) / l, (pr.B[1] - pr.A[1]) / l];
      const [wa, wb] = [w(pr.A), w(pr.B)];
      if (Math.abs(t2[0] * nor[0] + t2[1] * nor[1]) < SENO_PARALELO) {
        if (Math.abs(wa) <= prof + pr.espesor / 2 && Math.abs(wb) <= prof + pr.espesor / 2 && !paralelos.some((y) => y.g === g)) paralelos.push({ g, p: [(u(pr.A) + u(pr.B)) / 2, (pr.zs[0] + pr.zs[1]) / 2] });
        continue;
      }
      if (!(wa > 0 !== wb > 0 || wa === 0 || wb === 0)) continue;
      const t = wa / (wa - wb || 1);
      const uc = u(pr.A) + t * (u(pr.B) - u(pr.A));
      const pu = pr.n[0] * dir[0] + pr.n[1] * dir[1];
      if (Math.abs(pu) < 1e-9) continue;
      // Las cotas con presión en el cruce, sin los huecos que pasan por él
      let zs: Iv[] = [pr.zs];
      for (const h of pr.huecos)
        if (h.s0 < t * l && t * l < h.s1)
          zs = zs.flatMap(([a, b]) => [
            [a, Math.min(b, h.z0)],
            [Math.max(a, h.z1), b],
          ]).filter(([a, b]) => b > a) as Iv[];
      for (const [a, b] of zs)
        bloques.push({
          g,
          porArea: true,
          base: [[uc, a], [uc, b]],
          ord: [[-pu * presionEn(pr, a), 0], [-pu * presionEn(pr, b), 0]],
        });
    }
  }

  // Escalas: una por unidad
  let [maxS, maxL] = [0, 0];
  for (const b of bloques) for (const o of b.ord) if (b.porArea) maxS = Math.max(maxS, Math.hypot(...o));
  for (const b of bloques) for (const o of b.ord) if (!b.porArea) maxL = Math.max(maxL, Math.hypot(...o));
  for (const x of cruces) maxL = Math.max(maxL, Math.hypot(...x.v));
  const m = ORDENADA_DIAGRAMA * escala;
  const [kS, kL] = [maxS > 0 ? m / maxS : 0, maxL > 0 ? m / maxL : 0];

  // Lo que sube sobre la planta más alta (las colas de sus cargas): las burbujas de los ejes, encima
  const zs = cotasPlantas(f.plantas ?? []).filter((z): z is number => z !== null);
  let cima = zs.length ? Math.max(...zs) : 0;
  for (const b of bloques) for (let i = 0; i < 2; i++) cima = Math.max(cima, b.base[i]![1] + b.ord[i]![1] * (b.porArea ? kS : kL));
  for (const x of cruces) cima = Math.max(cima, x.p[1] - x.v[1] * kL);
  for (const x of puntuales) cima = Math.max(cima, x.p[1] + (Math.hypot(...x.v) > 0 ? (-x.v[1] / Math.hypot(...x.v)) * m : 0), x.giro || Math.hypot(...x.M) ? x.p[1] + 2 * R_MOMENTO : -Infinity);
  const base = vistaAlzado(f, plano, d, { ...base0, atenuado: true, arriba: zs.length && cima > Math.max(...zs) ? cima - Math.max(...zs) + 0.3 : 0 });

  const P: Primitiva[] = [...base.primitivas];
  const usados = new Set<Estilo>();
  const nuevos: Vec2[] = [];
  const rotulos = new Map<string, { p: Vec2; o: Vec2; largo: number; t?: Vec2; otros?: Vec2[]; pieza?: Vec2[] }>();
  const poner = (p: Primitiva) => {
    if (p.tipo !== "texto") usados.add(p.estilo);
    P.push(p);
  };
  /** Dónde va el rótulo de una carga: en la cola del bloque más largo (a lo largo de él, `t`). */
  const anclar = (id: string, p: Vec2, o: Vec2, largo: number, t?: Vec2, otros?: Vec2[], pieza?: Vec2[]) => {
    const r = rotulos.get(id);
    if (!r || largo > r.largo) rotulos.set(id, { p, o, largo, ...(t ? { t } : {}), ...(otros ? { otros } : {}), ...(pieza ? { pieza } : {}) });
  };
  for (const b of bloques) {
    const k = b.porArea ? kS : kL;
    const estilo = b.porArea ? "carga-superficie" : ESTILO_CLASE[CLASE_CARGA[b.g.tipo]];
    const [p0, p1] = b.base;
    const [o0, o1]: Vec2[] = b.ord.map((o) => [o[0] * k, o[1] * k]);
    if (!(Math.hypot(...o0!) + Math.hypot(...o1!) > 0)) continue;
    const c0: Vec2 = [p0[0] + o0![0], p0[1] + o0![1]];
    const c1: Vec2 = [p1[0] + o1![0], p1[1] + o1![1]];
    poner({ tipo: "poligono", anillos: [[p0, p1, c1, c0]], estilo, objeto: b.g.id });
    nuevos.push(c0, c1);
    const lb = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const n = Math.max(1, Math.round(lb / (0.5 * m)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const O: Vec2 = [o0![0] + t * (o1![0] - o0![0]), o0![1] + t * (o1![1] - o0![1])];
      if (Math.hypot(...O) > 1e-3 * m) for (const x of flecha2D([p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1])], [-O[0], -O[1]], m, estilo, b.g.id)) poner(x);
    }
    // Si no cabe en el centro, a un cuarto o a tres cuartos; si no, al otro lado de la pieza
    const cola = (t: number): Vec2 => [c0[0] + t * (c1[0] - c0[0]), c0[1] + t * (c1[1] - c0[1])];
    const pie = (t: number): Vec2 => [p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1])];
    anclar(b.g.id, cola(0.5), [(o0![0] + o1![0]) / 2, (o0![1] + o1![1]) / 2], lb, lb > 0 ? [(p1[0] - p0[0]) / lb, (p1[1] - p0[1]) / lb] : undefined, [cola(0.25), cola(0.75)], [pie(0.5), pie(0.25), pie(0.75)]);
  }
  for (const x of normales) {
    poner({ tipo: "marca", p: x.p, forma: "circulo", radio: 4, estilo: ESTILO_CLASE[CLASE_CARGA[x.g.tipo]], objeto: x.g.id });
    anclar(x.g.id, x.p, [0, 1], 0);
  }
  for (const x of cruces) {
    if (!(Math.hypot(...x.v) > 0)) normales.push({ g: x.g, p: x.p });
    const F: Vec2 = [x.v[0] * kL, x.v[1] * kL];
    for (const y of flecha2D(x.p, F, m, ESTILO_CLASE[CLASE_CARGA[x.g.tipo]], x.g.id)) poner(y);
    poner({ tipo: "marca", p: x.p, forma: "circulo", radio: 3, estilo: ESTILO_CLASE[CLASE_CARGA[x.g.tipo]], objeto: x.g.id });
    nuevos.push([x.p[0] - F[0], x.p[1] - F[1]]);
    anclar(x.g.id, [x.p[0] - F[0], x.p[1] - F[1]], [-F[0], -F[1]], 0);
  }
  for (const x of puntuales) {
    const l = Math.hypot(...x.v);
    const momento = momento2D(x.p, x.giro, x.M, "carga-puntual", x.g.id);
    for (const y of momento) poner(y);
    if (momento.length) nuevos.push([x.p[0] - 2 * R_MOMENTO, x.p[1] - 2 * R_MOMENTO], [x.p[0] + 2 * R_MOMENTO, x.p[1] + 2 * R_MOMENTO]);
    if (l > 0) {
      const F: Vec2 = [(x.v[0] / l) * m, (x.v[1] / l) * m];
      for (const y of flecha2D(x.p, F, m, "carga-puntual", x.g.id)) poner(y);
      nuevos.push([x.p[0] - F[0], x.p[1] - F[1]]);
      anclar(x.g.id, [x.p[0] - F[0], x.p[1] - F[1]], [-F[0], -F[1]], 0);
    } else if (momento.length) anclar(x.g.id, [x.p[0], x.p[1] + R_MOMENTO], [0, 1], 0);
    else {
      poner({ tipo: "marca", p: x.p, forma: "circulo", radio: 5, estilo: "carga-puntual", objeto: x.g.id });
      normales.push({ g: x.g, p: x.p });
      anclar(x.g.id, x.p, [0, 1], 0);
    }
  }
  for (const x of paralelos) anclar(x.g.id, x.p, [0, 0], 0);

  const textos = new Map(geo.cargas.map((x) => [x.carga.id, x.carga]));
  for (const [id, r] of rotulos) {
    const g = textos.get(id)!;
    const dibujada = bloques.some((b) => b.g === g) || cruces.some((x) => x.g === g && Math.hypot(...x.v) > 0) || puntuales.some((x) => x.g === g && (Math.hypot(...x.v) > 0 || x.giro !== 0 || Math.hypot(...x.M) > 0));
    const texto = paralelos.some((x) => x.g === g) && !dibujada ? `${id}: empuje normal al plano, ${rotulo(g.tipo === "empuje" ? g.p0 : 0)} a ${rotulo(g.tipo === "empuje" ? g.p1 : 0)} kN/m²` : `${textoCarga(g)}${!dibujada && normales.some((x) => x.g === g) ? ", normal al plano" : ""}`;
    // Más allá de la cola, en el sentido de la ordenada; a lo largo del bloque si lo hay
    let extra: Partial<Extract<Primitiva, { tipo: "texto" }>>;
    if (r.t) {
      const giro = giroTexto(r.t);
      const arriba = -Math.sin((giro * Math.PI) / 180) * r.o[0] + Math.cos((giro * Math.PI) / 180) * r.o[1] >= 0;
      extra = { ancla: "medio", ...(giro ? { giro } : {}), dy: arriba ? -6 : 14 };
    } else if (Math.abs(r.o[1]) >= Math.abs(r.o[0])) extra = { ancla: "medio", dy: r.o[1] >= 0 ? -6 : 14 };
    else extra = { ancla: r.o[0] < 0 ? "fin" : "inicio", dx: r.o[0] < 0 ? -4 : 4, dy: 4 };
    const alternativas = [...(r.otros ?? []).map((p) => ({ p })), ...(r.pieza ?? []).map((p) => ({ p, dy: extra.dy === -6 ? 14 : -6 }))];
    poner({ tipo: "texto", p: r.p, texto, tamano: 12, prioridad: 70, fondo: true, clase: "dato", objeto: id, ...extra, ...(alternativas.length ? { alternativas } : {}) });
  }

  const leyenda: EntradaLeyenda[] = [];
  const entrada = (e: Estilo, t: string) => {
    if (usados.has(e)) leyenda.push({ estilo: e, texto: t });
  };
  entrada("carga-superficie", "Carga de superficie (kN/m²) donde su zona está junto al plano, y empuje de un muro que lo cruza: el bloque a escala, con la punta de las flechas en la pieza");
  entrada("carga-banda-lineal", "Carga lineal (kN/m): en los tramos paralelos al plano, su componente perpendicular a ellos; en los que lo cruzan, una flecha");
  entrada("carga-banda-pieza", "Carga en una viga o un pilar (kN/m), igual");
  entrada("carga-puntual", "Carga puntual (kN): su componente en el plano, de largo fijo (un círculo si no tiene). Su momento (kN·m): el normal al plano, un arco en su sentido (antihorario, positivo hacia quien mira); el del plano, una flecha de doble punta (regla de la mano derecha)");
  const vistas = new Set([...bloques.map((b) => b.g.id), ...normales.map((x) => x.g.id), ...cruces.map((x) => x.g.id), ...puntuales.map((x) => x.g.id), ...paralelos.map((x) => x.g.id)]);
  const notas = [
    ...(maxS > 0 || maxL > 0 ? [`Escalas: ${[maxS > 0 ? `${rotulo(maxS)} kN/m² = ${rotulo(m)} m` : "", maxL > 0 ? `${rotulo(maxL)} kN/m = ${rotulo(m)} m` : ""].filter(Boolean).join("; ")}. Las puntuales, de ${rotulo(m)} m.`] : []),
    `Se dibuja la componente de cada carga en el plano; lo normal a él, en el rótulo. Las cargas de superficie, donde su zona está a menos de ${rotulo(prof)} m del plano, con su componente Z.`,
    "Cada carga, como está en el modelo: el cálculo une a ε_snap sus zonas y polilíneas a lo que tienen cerca (C2-b).",
    ...(horizontales ? ["Las componentes horizontales de las cargas de superficie no se dibujan (van en el rótulo)."] : []),
    ...(paralelos.length ? ["El empuje de un muro paralelo al plano es normal a él: sólo se rotula."] : []),
    ...(!c ? [`El caso «${caso}» no existe.`] : c.pesoPropio ? ["Este caso lleva además el peso propio de la estructura, que calcula el programa y no se dibuja."] : []),
    ...(vistas.size ? [] : ["El caso no tiene cargas en este plano."]),
    ...geo.notas,
    ...base.notas,
  ];
  return {
    ...base,
    cabecera: [base.cabecera[0]!, `Cargas del caso ${caso}${c?.nombre ? ` (${c.nombre})` : ""}${c?.accion ? `, acción ${c.accion.tipo}` : ""}`, ...base.cabecera.slice(1)],
    primitivas: P,
    leyenda: [...leyenda, ...base.leyenda],
    notas,
    extremos: [],
    caja: nuevos.length ? cajaDe([...nuevos, [base.caja[0], base.caja[1]], [base.caja[2], base.caja[3]]]) : base.caja,
  };
}
