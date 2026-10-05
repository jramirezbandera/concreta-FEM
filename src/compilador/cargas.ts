/**
 * Paso 4 del compilador: cargas físicas → cargas analíticas, y el control «sin pérdidas».
 *
 * - Una carga repartida sobre una pieza se reparte sobre los trozos de su eje analítico
 *   (`piezas.ts`): en un tramo flexible es una carga de barra exacta (no se trocea la barra, COM-13);
 *   en una zona rígida o fuera de la cadena va al nudo como fuerza y momento estáticamente
 *   equivalentes (E2: el motor sólo carga el tramo flexible).
 * - Una carga puntual va al nudo del pilar en cuya huella cae, a la viga sobre la que cae (a
 *   ≤ ε_snap de su eje) o, si no, al nudo a ≤ ε_snap, con el momento de transporte de la distancia
 *   entre el punto y el eje o el nudo.
 * - Todo va en ejes globales; las cargas "local" se giran aquí con los ejes de cada tramo.
 * - Losas (C2): el peso propio sale de su pp, como carga de superficie de cada lámina, y una viga
 *   rectangular de hormigón bajo losa pesa sólo su descuelgue (C2-g). Las cargas de superficie van
 *   por lámina entera (las zonas están sembradas en la malla), las lineales a los nudos de sus
 *   aristas y las puntuales que caen en una losa a su vértice (C2-h).
 * - Muros (C3): pesan γ·t por lámina, menos su solape con las losas, que va como carga lineal hacia
 *   arriba en la cota de la planta (C3-g). Los empujes van por lámina con su valor en cada nudo
 *   (bilineal: exacto con una ley lineal en z, C3-h). Su resultante física se calcula por franjas
 *   entre estaciones, sin las láminas, restando los huecos.
 * - Paños unidireccionales (C4): su pp y las cargas de superficie, lineales y puntuales que caen en
 *   ellos van a sus viguetas y a las vigas de sus lados paralelos por la regla de la palanca
 *   (`RepartoPano`, C4-e). Su resultante física se calcula con los polígonos del paño unido, sin
 *   las viguetas. Una viga bajo un paño pesa sólo su descuelgue (C2-g con el canto de la vigueta).
 * - Sin pérdidas (regla 3 del plan): la resultante física de cada caso (F y M respecto al centro
 *   del modelo, calculada sobre la pieza entera) tiene que coincidir con la analítica (leída del
 *   modelo analítico ya montado, con sus offsets) a 1e-9. La de las losas se calcula sin la malla,
 *   con sus polígonos ya unidos (`poligonos.ts`): así comprueba también el mallado.
 */
import type { CargaBarra, ModeloAnalitico, Vec3 } from "../motor/modelo.ts";
import { Diagnosticos } from "../motor/diagnosticos.ts";
import type { Vec2, Viga } from "./fisico.ts";
import type { Losas } from "./losas.ts";
import { franjas, franjasLibres } from "./muros.ts";
import type { Piezas, Recta } from "./piezas.ts";
import { areaConSigno, momentosInterseccion, momentosRegion, puntoEnRegion, type Momentos, type Region } from "./poligonos.ts";
import type { Topologia } from "./topologia.ts";
import { cotaNudo, seccionTramo } from "./topologia.ts";
import { RepartoPano, trozosEnPanos, type EmisorPano, type PanosU, type Receptor } from "./unidireccional.ts";
import { distanciaARegion } from "./topologia.ts";
import type { Contexto } from "./validar.ts";

export const TOL_SIN_PERDIDAS = 1e-9;

type V = [number, number, number];
const cruz = (a: readonly number[], b: readonly number[]): V => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const mas = (a: readonly number[], b: readonly number[]): V => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
const menos = (a: readonly number[], b: readonly number[]): V => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const por = (a: readonly number[], k: number): V => [a[0]! * k, a[1]! * k, a[2]! * k];
const norma = (a: readonly number[]) => Math.sqrt(a[0]! * a[0]! + a[1]! * a[1]! + a[2]! * a[2]!);

/** Resultante de un conjunto de cargas respecto a un punto, con sus escalas (como el motor). */
export interface Resultante {
  F: V;
  M: V;
  escalaF: number;
  escalaM: number;
}

const resultanteCero = (): Resultante => ({ F: [0, 0, 0], M: [0, 0, 0], escalaF: 0, escalaM: 0 });

/** Suma una fuerza F aplicada en X (relativo al centro) y un momento M. */
function sumarPuntual(r: Resultante, X: readonly number[], F: readonly number[], M: readonly number[]): void {
  r.F = mas(r.F, F);
  r.M = mas(mas(r.M, cruz(X, F)), M);
  r.escalaF += norma(F);
  r.escalaM += norma(X) * norma(F) + norma(M);
}

/**
 * Suma una carga lineal de q1 (en X1) a q2 (en X1 + Δ·e), relativa al centro:
 * F = (q1 + q2)·Δ/2 y M = X1 × F + e × Δ²·(q1/6 + q2/3).
 */
function sumarLineal(r: Resultante, X1: readonly number[], e: readonly number[], delta: number, q1: readonly number[], q2: readonly number[]): void {
  const F = por(mas(q1, q2), delta / 2);
  const S = por(mas(por(q1, 1 / 6), por(q2, 1 / 3)), delta * delta);
  r.F = mas(r.F, F);
  r.M = mas(r.M, mas(cruz(X1, F), cruz(e, S)));
  r.escalaF += ((norma(q1) + norma(q2)) / 2) * delta;
  r.escalaM += Math.max(norma(X1), norma(mas(X1, por(e, delta)))) * ((norma(q1) + norma(q2)) / 2) * delta;
}

export interface CargasCompiladas {
  /**
   * Por caso: cargas nodales (por nudo provisional), cargas de barra (por barra de `piezas`) y
   * cargas de superficie globales por lámina (por índice de lámina, ya canónico): uniformes o con
   * un valor por nudo (empujes, C3-h).
   */
  casos: { nodales: Map<number, number[]>; barras: CargaBarra[]; laminas: Map<number, number[]>; laminasNodos: Map<number, number[][]> }[];
  /** Por caso: resultante física respecto a `centro`. */
  fisicas: Resultante[];
}

/** Suma una carga de superficie uniforme q sobre una figura de momentos m, a la cota z (relativa al centro). */
function sumarSuperficie(r: Resultante, m: Momentos, z: number, q: readonly number[]): void {
  if (!(m.A > 0)) return;
  sumarPuntual(r, [m.Sx / m.A, m.Sy / m.A, z], por(q, m.A), [0, 0, 0]);
}

/**
 * C2-g: tramos de peso de una viga de hormigón rectangular bajo losa. Por cada lado de su eje
 * cubierto por una losa se le quita γ·(b/2)·min(h, t); el lado se mira a b/4 del eje, en tramos
 * partidos donde esas dos líneas cortan el borde de una losa.
 */
function pesoBajoLosa(r: Recta, w: number, b: number, h: number, regiones: readonly { region: Region; t: number }[], eps: number): { desde: number; hasta: number; w: number }[] {
  const gamma = w / (b * h);
  const n: Vec2 = [-r.e[1], r.e[0]];
  const cortes = new Set<number>([0, r.len]);
  for (const s of [1, -1]) {
    const O: Vec2 = [r.O[0] + (s * b * n[0]) / 4, r.O[1] + (s * b * n[1]) / 4];
    for (const { region } of regiones) {
      for (const p of [region.contorno, ...region.huecos]) {
        for (let i = 0; i < p.length; i++) {
          const [A, B] = [p[i]!, p[(i + 1) % p.length]!];
          // O + σ·e = A + τ·(B − A)
          const d: Vec2 = [B[0] - A[0], B[1] - A[1]];
          const den = r.e[0] * d[1] - r.e[1] * d[0];
          if (Math.abs(den) < 1e-14) continue;
          const wx = A[0] - O[0];
          const wy = A[1] - O[1];
          const sigma = (wx * d[1] - wy * d[0]) / den;
          const tau = (wx * r.e[1] - wy * r.e[0]) / den;
          if (tau >= 0 && tau <= 1 && sigma > eps && sigma < r.len - eps) cortes.add(sigma);
        }
      }
    }
  }
  // Sin tramos más cortos que ε_geom (un borde que corta el eje casi en el mismo punto dos veces)
  const cs = [...cortes].sort((x, y) => x - y).filter((x, i, l) => i === 0 || i === l.length - 1 || x - l[i - 1]! > eps);
  if (cs.length > 2 && cs[cs.length - 1]! - cs[cs.length - 2]! <= eps) cs.splice(cs.length - 2, 1);
  const tramos: { desde: number; hasta: number; w: number }[] = [];
  for (let i = 0; i + 1 < cs.length; i++) {
    const sm = (cs[i]! + cs[i + 1]!) / 2;
    let quita = 0;
    for (const s of [1, -1]) {
      const q: Vec2 = [r.O[0] + sm * r.e[0] + (s * b * n[0]) / 4, r.O[1] + sm * r.e[1] + (s * b * n[1]) / 4];
      const l = regiones.find((x) => puntoEnRegion(q, x.region));
      if (l) quita += gamma * (b / 2) * Math.min(h, l.t);
    }
    const wi = w - quita;
    const ult = tramos[tramos.length - 1];
    if (ult && ult.w === wi) ult.hasta = cs[i + 1]!;
    else tramos.push({ desde: cs[i]!, hasta: cs[i + 1]!, w: wi });
  }
  return tramos;
}

export function construirCargas(ctx: Contexto, topo: Topologia, piezas: Piezas, losas: Losas, centro: Vec3, diag: Diagnosticos, panos: PanosU | null = null): CargasCompiladas {
  const casos = ctx.casos.map(() => ({ nodales: new Map<number, number[]>(), barras: [] as CargaBarra[], laminas: new Map<number, number[]>(), laminasNodos: new Map<number, number[][]>() }));
  const lamina = (c: number, l: number, q: readonly number[]) => {
    const m = casos[c]!.laminas;
    let v = m.get(l);
    if (!v) m.set(l, (v = [0, 0, 0]));
    for (let i = 0; i < 3; i++) v[i]! += q[i]!;
  };
  const laminaNodos = (c: number, l: number, q: readonly (readonly number[])[]) => {
    const m = casos[c]!.laminasNodos;
    let v = m.get(l);
    if (!v) m.set(l, (v = [0, 1, 2, 3].map(() => [0, 0, 0])));
    for (let n = 0; n < 4; n++) for (let i = 0; i < 3; i++) v[n]![i]! += q[n]![i]!;
  };
  // Las láminas de los muros van tras las de las losas en el modelo analítico
  const nLosas = losas.laminas.length;
  const fisicas = ctx.casos.map(resultanteCero);
  const Xn = (n: number): V => [topo.nudos[n]!.x, topo.nudos[n]!.y, cotaNudo(ctx, topo.nudos[n]!)];
  const P = (r: Recta, sigma: number): V => mas(r.O, por(r.e, sigma));
  const aGlobal = (r: Recta, ejes: "global" | "local", q: readonly number[]): V =>
    ejes === "global" ? [q[0]!, q[1]!, q[2]!] : mas(mas(por(r.ex, q[0]!), por(r.ey, q[1]!)), por(r.ez, q[2]!));

  const nodal = (c: number, n: number, F: readonly number[], M: readonly number[]) => {
    const m = casos[c]!.nodales;
    let v = m.get(n);
    if (!v) m.set(n, (v = [0, 0, 0, 0, 0, 0]));
    for (let i = 0; i < 3; i++) {
      v[i]! += F[i]!;
      v[3 + i]! += M[i]!;
    }
  };

  /** Carga lineal global de q1 (en σa) a q2 (en σb) sobre una recta, repartida en sus trozos. */
  const repartir = (c: number, r: Recta, sa: number, sb: number, q1: V, q2: V) => {
    sumarLineal(fisicas[c]!, menos(P(r, sa), centro), r.e, sb - sa, q1, q2);
    aplicarLineal(c, r, sa, sb, q1, q2);
  };
  /** Lo analítico de `repartir`, sin la resultante física (C4: la de un paño sale de su polígono). */
  const aplicarLineal = (c: number, r: Recta, sa: number, sb: number, q1: V, q2: V) => {
    const q = (s: number): V => (sb === sa ? q1 : mas(q1, por(menos(q2, q1), (s - sa) / (sb - sa))));
    for (const t of r.trozos) {
      const lo = Math.max(sa, t.desde);
      const hi = Math.min(sb, t.hasta);
      if (!(hi > lo)) continue;
      const [qlo, qhi] = [q(lo), q(hi)];
      if ("barra" in t) {
        casos[c]!.barras.push({ tipo: "distribuida", barra: t.barra, ejes: "global", qa: qlo, qb: qhi, a: lo - t.ip, b: hi - t.ip });
      } else {
        const d = hi - lo;
        const F = por(mas(qlo, qhi), d / 2);
        const M = mas(cruz(menos(P(r, lo), Xn(t.nudo)), F), cruz(r.e, por(mas(por(qlo, 1 / 6), por(qhi, 1 / 3)), d * d)));
        nodal(c, t.nudo, F, M);
      }
    }
  };

  /** Fuerza F y momento M aplicados en Q, en el punto σ de una recta. */
  const puntualEnRecta = (c: number, r: Recta, sigma: number, Q: V, F: V, M: V) => {
    const t = r.trozos.find((t) => sigma >= t.desde && sigma <= t.hasta)!;
    if ("barra" in t) casos[c]!.barras.push({ tipo: "puntual", barra: t.barra, ejes: "global", x: sigma - t.ip, F, M: mas(M, cruz(menos(Q, P(r, sigma)), F)) });
    else nodal(c, t.nudo, F, mas(M, cruz(menos(Q, Xn(t.nudo)), F)));
  };

  /** Carga repartida sobre una pieza entre dos estaciones (en sus ejes), tramo a tramo. */
  const sobrePieza = (c: number, id: string, rectas: readonly Recta[], ejes: "global" | "local", q: readonly number[], qb: readonly number[] | undefined, desde: number | undefined, hasta: number | undefined, idCarga: string) => {
    const total = rectas.reduce((s, r) => Math.max(s, r.s0 + r.len), 0);
    const a = desde ?? 0;
    const b = hasta ?? total;
    const tol = ctx.op.epsGeom;
    if (a < -tol || b > total + tol || !(b > a)) {
      diag.error("carga/fuera-de-pieza", `La carga ${idCarga} va de ${a} a ${b} m, fuera de ${id} (de 0 a ${total.toPrecision(6)} m).`, [idCarga, id]);
      return;
    }
    const q2 = qb ?? q;
    const qEn = (s: number): V => (b === a ? [q[0]!, q[1]!, q[2]!] : mas(q, por(menos(q2, q), (s - a) / (b - a))));
    for (const r of rectas) {
      const lo = Math.max(a, r.s0);
      const hi = Math.min(b, r.s0 + r.len);
      if (!(hi > lo)) continue;
      repartir(c, r, lo - r.s0, hi - r.s0, aGlobal(r, ejes, qEn(lo)), aGlobal(r, ejes, qEn(hi)));
    }
  };

  // Momentos de una figura respecto al centro del modelo (en planta), y cota relativa de una planta
  const desplazar = (m: Momentos): Momentos => ({ A: m.A, Sx: m.Sx - centro[0] * m.A, Sy: m.Sy - centro[1] * m.A });
  const cota = (planta: string) => ctx.cotas[ctx.planta.get(planta)!]! - centro[2];
  /** Losas y paños (C4) de la planta de una viga, con su región unida y su espesor (C2-g). */
  const regionesBajo = (v: Viga) => [
    ...ctx.losas.flatMap((l, i) => (l.losa.planta === v.planta ? [{ region: losas.regiones[i]!, t: l.material.t }] : [])),
    ...ctx.panos.flatMap((p, i) => (p.pano.planta === v.planta && panos ? [{ region: panos.regiones[i]!, t: p.seccion.canto }] : [])),
  ];

  // Reparto de los paños (C4-e): a las rectas de sus viguetas y de las vigas de sus lados paralelos
  const repartos = new Map<number, RepartoPano>();
  const reparto = (i: number) => {
    let x = repartos.get(i);
    if (!x) repartos.set(i, (x = new RepartoPano(panos!, i)));
    return x;
  };
  const emisor = (c: number, i: number): EmisorPano => {
    const z = ctx.cotas[ctx.panos[i]!.k]!;
    const { d, n } = panos!.marcos[i]!;
    const rectaDe = (rec: Receptor): { r: Recta; s: (sigma: number) => number; X: (sigma: number) => V } => {
      if (rec.tipo === "vigueta") {
        const v = panos!.viguetas[rec.v]!;
        const r = piezas.rectasDe.get(v.id)![0]!;
        return { r, s: (sg) => sg - v.a, X: (sg) => [sg * d[0] + v.eta * n[0], sg * d[1] + v.eta * n[1], z] };
      }
      const tv = rec.b.tramo;
      const r = piezas.rectasDe.get(tv.viga.id)!.find((x) => x.tramo === tv)!;
      const eta = rec.b.eta;
      const X = (sg: number): V => [sg * d[0] + eta * n[0], sg * d[1] + eta * n[1], z];
      return { r, s: (sg) => (X(sg)[0] - r.O[0]) * r.e[0] + (X(sg)[1] - r.O[1]) * r.e[1], X };
    };
    return {
      lineal: (rec, sa, sb, qa, qb) => {
        const { r, s } = rectaDe(rec);
        const [a, b] = [s(sa), s(sb)];
        const [q1, q2]: [V, V] = [
          [qa[0]!, qa[1]!, qa[2]!],
          [qb[0]!, qb[1]!, qb[2]!],
        ];
        if (a <= b) aplicarLineal(c, r, a, b, q1, q2);
        else aplicarLineal(c, r, b, a, q2, q1);
        // Una viga con el eje bajo el forjado (C1-c): el transporte vertical de la carga
        const dz = z - r.O[2];
        if (dz !== 0) {
          const F = por(mas(q1, q2), (sb - sa) / 2);
          const sm = s((sa + sb) / 2);
          puntualEnRecta(c, r, sm, P(r, sm), [0, 0, 0], cruz([0, 0, dz], F));
        }
      },
      puntual: (rec, sg, F, M) => {
        const { r, s, X } = rectaDe(rec);
        puntualEnRecta(c, r, s(sg), X(sg), [F[0]!, F[1]!, F[2]!], [M[0]!, M[1]!, M[2]!]);
      },
      aNudo: (nudo, Q, F, M) => nodal(c, nudo, F, mas(M, cruz(menos([Q[0], Q[1], z], Xn(nudo)), F))),
    };
  };
  const panosDe = (planta: string) => ctx.panos.flatMap((p, i) => (p.pano.planta === planta && panos?.porPano[i]!.length ? [i] : []));
  /** Reparte una carga lineal q sobre los lados que caen en los paños de la planta; devuelve lo que queda fuera (m). */
  const linealEnPanos = (c: number, planta: string, lados: readonly (readonly [Vec2, Vec2])[], q: V): number => {
    let fuera = 0;
    const lista = panosDe(planta).map((i) => ({ i, region: panos!.regiones[i]! }));
    for (const [A, B] of lados) {
      const L = Math.sqrt((B[0] - A[0]) * (B[0] - A[0]) + (B[1] - A[1]) * (B[1] - A[1]));
      let cubierto = 0;
      for (const t of trozosEnPanos(A, B, lista)) cubierto += reparto(t.i).segmento(t.A, t.B, q, emisor(c, t.i));
      fuera += Math.max(0, L - cubierto);
    }
    return fuera;
  };

  // Peso propio (C1-h): vigas en toda su longitud (bajo losa, sólo su descuelgue, C2-g); pilares, tramo a tramo con su sección
  const cPeso = ctx.casos.findIndex((c) => c.pesoPropio === true);
  if (cPeso >= 0) {
    for (const p of ctx.pilares) {
      const [r] = piezas.rectasDe.get(p.id) ?? [];
      if (!r) continue;
      const kb = ctx.planta.get(p.desde)!;
      const kh = ctx.planta.get(p.hasta)!;
      const zb = ctx.cotas[kb]!;
      for (let k = kb; k > kh; k--) {
        const w = ctx.secciones.get(seccionTramo(ctx, p, k - 1))!.peso;
        if (w > 0) repartir(cPeso, r, ctx.cotas[k]! - zb, ctx.cotas[k - 1]! - zb, [0, 0, -w], [0, 0, -w]);
      }
    }
    for (const v of ctx.vigas) {
      const sc = ctx.secciones.get(v.seccion)!;
      const w = sc.peso;
      if (!(w > 0)) continue;
      const regiones = regionesBajo(v);
      for (const r of piezas.rectasDe.get(v.id) ?? []) {
        if (!regiones.length || sc.material !== "hormigon" || sc.forma !== "rectangular" || sc.huella?.tipo !== "rectangulo") {
          repartir(cPeso, r, 0, r.len, [0, 0, -w], [0, 0, -w]);
          continue;
        }
        for (const t of pesoBajoLosa(r, w, sc.huella.b, sc.canto, regiones, ctx.op.epsGeom)) if (t.w > 0) repartir(cPeso, r, t.desde, t.hasta, [0, 0, -t.w], [0, 0, -t.w]);
      }
    }
    // Losas: su pp, por lámina (C2-g); en un reticular, el de la zona aligerada o el de los ábacos (C4-i)
    losas.laminas.forEach((l, i) => {
      const lc = ctx.losas[l.losa]!;
      const pp = l.abaco ? lc.reticular!.ppAbaco : lc.pp;
      if (pp > 0) lamina(cPeso, i, [0, 0, -pp]);
    });
    ctx.losas.forEach((l, i) => {
      if (!losas.laminas.some((x) => x.losa === i)) return;
      if (l.pp > 0) sumarSuperficie(fisicas[cPeso]!, desplazar(momentosRegion(losas.regiones[i]!)), cota(l.losa.planta), [0, 0, -l.pp]);
      // Ábacos: la diferencia con la zona aligerada sobre su parte dentro de la losa unida
      const dif = l.reticular ? l.reticular.ppAbaco - l.reticular.ppAligerada : 0;
      if (dif !== 0) for (const ab of losas.abacosUnidos.get(i) ?? []) sumarSuperficie(fisicas[cPeso]!, desplazar(momentosInterseccion(losas.regiones[i]!, ab)), cota(l.losa.planta), [0, 0, -dif]);
    });
    // Paños (C4-f): su pp, repartido a las viguetas; la física, sobre el paño unido
    for (const i of ctx.panos.flatMap((_, i) => (panos?.porPano[i]!.length ? [i] : []))) {
      const p = ctx.panos[i]!;
      if (!(p.pano.pp > 0)) continue;
      reparto(i).superficie([0, 0, -p.pano.pp], null, emisor(cPeso, i));
      sumarSuperficie(fisicas[cPeso]!, desplazar(momentosRegion(panos!.regiones[i]!)), cota(p.pano.planta), [0, 0, -p.pano.pp]);
    }
    // Muros (C3-g): γ·t por lámina; la física, por franjas sin los huecos
    losas.muros.forEach((lm, j) => {
      const m = ctx.muros[lm.w]!;
      if (m.gamma * m.material.t > 0) lamina(cPeso, nLosas + j, [0, 0, -m.gamma * m.material.t]);
    });
    const plan = losas.planMuros;
    for (const pa of plan?.panos ?? []) {
      const m = ctx.muros[pa.w]!;
      const w = m.gamma * m.material.t;
      if (!(w > 0)) continue;
      for (const f of franjas(pa))
        for (const [za, zb] of franjasLibres(plan!, pa, f.sm, ctx.cotas[pa.k + 1]!, ctx.cotas[pa.k]!)) {
          const A = f.L * (zb - za);
          sumarPuntual(fisicas[cPeso]!, [f.A[0] + (f.u[0] * f.L) / 2 - centro[0], f.A[1] + (f.u[1] * f.L) / 2 - centro[1], (za + zb) / 2 - centro[2]], [0, 0, -w * A], [0, 0, 0]);
        }
    }
    // Solape muro–losa (C3-g): γ·(t/2)·(e/2) hacia arriba por lado cubierto y por muro que llega
    for (const ld of losas.ladosMuros) {
      const m = ctx.muros[ld.w]!;
      const L = Math.sqrt((ld.B[0] - ld.A[0]) * (ld.B[0] - ld.A[0]) + (ld.B[1] - ld.A[1]) * (ld.B[1] - ld.A[1]));
      const u: Vec2 = [(ld.B[0] - ld.A[0]) / L, (ld.B[1] - ld.A[1]) / L];
      const M: Vec2 = [(ld.A[0] + ld.B[0]) / 2, (ld.A[1] + ld.B[1]) / 2];
      const idPlanta = ctx.plantas[ld.k]!.id;
      let e = 0;
      for (const s of [1, -1]) {
        const q: Vec2 = [M[0] - (s * u[1] * m.material.t) / 4, M[1] + (s * u[0] * m.material.t) / 4];
        const i = ctx.losas.findIndex((l, li) => l.losa.planta === idPlanta && puntoEnRegion(q, losas.regiones[li]!));
        if (i >= 0) e += ctx.losas[i]!.material.t;
      }
      const qz = m.gamma * (m.material.t / 2) * (e / 2) * ((ld.debajo ? 1 : 0) + (ld.encima ? 1 : 0));
      if (!(qz > 0)) continue;
      nodal(cPeso, ld.nudos[0], [0, 0, (qz * L) / 4], [0, 0, 0]);
      nodal(cPeso, ld.nudos[1], [0, 0, (qz * L) / 2], [0, 0, 0]);
      nodal(cPeso, ld.nudos[2], [0, 0, (qz * L) / 4], [0, 0, 0]);
      sumarLineal(fisicas[cPeso]!, [ld.A[0] - centro[0], ld.A[1] - centro[1], ctx.cotas[ld.k]! - centro[2]], [u[0], u[1], 0], L, [0, 0, qz], [0, 0, qz]);
    }
  }

  for (const carga of ctx.cargas) {
    const c = ctx.caso.get(carga.caso)!;
    if (carga.tipo === "puntual") {
      const k = ctx.planta.get(carga.planta)!;
      const Q: V = [carga.x, carga.y, ctx.cotas[k]!];
      const F: V = carga.F ? [...carga.F] : [0, 0, 0];
      const M: V = carga.M ? [...carga.M] : [0, 0, 0];
      const destino = topo.localizar(k, [carga.x, carga.y]);
      const enLosa = losas.puntos.get(carga.id);
      // En un paño (C4-e): a sus viguetas
      const enPano = !destino && enLosa === undefined ? panosDe(carga.planta).find((i) => distanciaARegion([carga.x, carga.y], panos!.regiones[i]!) <= 1e-9) : undefined;
      if (!destino && enLosa === undefined && enPano === undefined) {
        diag.error("carga/sin-destino", `La carga ${carga.id} no cae sobre ningún pilar, nudo, viga, losa ni paño de la planta ${carga.planta} (tolerancia ${ctx.op.epsSnap} m).`, [carga.id]);
        continue;
      }
      sumarPuntual(fisicas[c]!, menos(Q, centro), F, M);
      if (enPano !== undefined) reparto(enPano).puntual([carga.x, carga.y], F, M, emisor(c, enPano));
      else if (!destino) nodal(c, enLosa!, F, mas(M, cruz(menos(Q, Xn(enLosa!)), F)));
      else if (destino.tipo === "nudo") nodal(c, destino.nudo, F, mas(M, cruz(menos(Q, Xn(destino.nudo)), F)));
      else {
        const r = piezas.rectasDe.get(destino.tramo.viga.id)!.find((r) => r.tramo === destino.tramo)!;
        puntualEnRecta(c, r, destino.sigma, Q, F, M);
      }
    } else if (carga.tipo === "superficie") {
      // C2-h: por lámina entera; la resultante física, sobre la losa (o la zona ∩ las losas) unida
      for (const l of losas.superficies.get(carga.id) ?? []) lamina(c, l, carga.q);
      const zona = losas.zonasUnidas.get(carga.id) ?? (carga.zona && panosDe(carga.planta).length ? carga.zona.map((x) => [x[0], x[1]] as Vec2) : undefined);
      let A = 0;
      ctx.losas.forEach((l, i) => {
        if (l.losa.planta !== carga.planta || carga.pano !== undefined || (carga.losa !== undefined && l.losa.id !== carga.losa)) return;
        const m = zona ? momentosInterseccion(losas.regiones[i]!, zona) : momentosRegion(losas.regiones[i]!);
        A += m.A;
        sumarSuperficie(fisicas[c]!, desplazar(m), cota(carga.planta), carga.q);
      });
      // Paños (C4-e): la parte que cae en ellos, a sus viguetas; la física, sobre el paño unido
      for (const i of panosDe(carga.planta)) {
        if (carga.losa !== undefined || (carga.pano !== undefined && ctx.panos[i]!.pano.id !== carga.pano)) continue;
        const m = zona ? momentosInterseccion(panos!.regiones[i]!, zona) : momentosRegion(panos!.regiones[i]!);
        if (!(m.A > 0)) continue;
        A += m.A;
        reparto(i).superficie(carga.q, zona ?? null, emisor(c, i));
        sumarSuperficie(fisicas[c]!, desplazar(m), cota(carga.planta), carga.q);
      }
      const Az = zona ? Math.abs(areaConSigno(zona)) : A;
      const conPanos = ctx.panos.some((p) => p.pano.planta === carga.planta);
      if (!(A > 0)) diag.error("carga/fuera-de-losa", `La carga ${carga.id} no cae sobre ninguna losa${conPanos ? " ni ningún paño" : ""} de la planta ${carga.planta}.`, [carga.id]);
      else if (Az - A > 1e-6 * Az)
        diag.aviso(
          "carga/zona-fuera-de-losa",
          `${(Az - A).toFixed(3)} m² de la zona de la carga ${carga.id} caen fuera de las losas${conPanos ? " y los paños" : ""}${carga.losa ? ` (o de la losa ${carga.losa})` : carga.pano ? ` (o del paño ${carga.pano})` : ""} y no son carga (C2-h).`,
          [carga.id],
          { area: Az - A },
        );
    } else if (carga.tipo === "lineal") {
      // C2-h: a los nudos de sus aristas (exacto con las funciones lineales del borde de la lámina)
      for (const [a, b] of losas.lineas.get(carga.id) ?? []) {
        const [Xa, Xb] = [Xn(a), Xn(b)];
        const L = norma(menos(Xb, Xa));
        nodal(c, a, por(carga.q, L / 2), [0, 0, 0]);
        nodal(c, b, por(carga.q, L / 2), [0, 0, 0]);
      }
      // C4-e: los lados que no van sobre la malla ni sobre un muro, a los paños; en una planta sin
      // losas ni muros, toda la polilínea. Lo que no cubran se perdería: error
      const unida = losas.lineasUnidas.get(carga.id);
      const p: Vec2[] = unida ?? carga.puntos.map((x) => [x[0], x[1]] as Vec2);
      const sueltos: [Vec2, Vec2][] = unida ? (losas.lineasFuera.get(carga.id) ?? []) : p.slice(1).map((B, i) => [p[i]!, B]);
      if (sueltos.length) {
        const fuera = linealEnPanos(c, carga.planta, sueltos, [carga.q[0], carga.q[1], carga.q[2]]);
        if (fuera > ctx.op.epsGeom)
          diag.error(
            "carga/fuera-de-losa",
            `La carga lineal ${carga.id} no va entera sobre las losas, los paños o los ejes de los muros de la planta ${carga.planta}: ${fuera.toFixed(3)} m caen fuera y se perderían.`,
            [carga.id],
            { longitud: fuera },
          );
      }
      const z = ctx.cotas[ctx.planta.get(carga.planta)!]!;
      for (let i = 0; i + 1 < p.length; i++) {
        const X1: V = [p[i]![0], p[i]![1], z];
        const d = menos([p[i + 1]![0], p[i + 1]![1], z], X1);
        const L = norma(d);
        sumarLineal(fisicas[c]!, menos(X1, centro), por(d, 1 / L), L, carga.q, carga.q);
      }
    } else if (carga.tipo === "empuje") {
      // C3-h: por lámina con su valor en cada nudo; la física, por franjas sin los huecos
      const plan = losas.planMuros!;
      const w = ctx.muros.findIndex((m) => m.muro.id === carga.muro);
      const m = ctx.muros[w]!;
      const ley = plan.empujes.get(carga.id)!;
      const base = ctx.cotas[m.kb]!;
      const [a, b] = [base + carga.z0, base + carga.z1];
      const p = (z: number) => carga.p0 + ((carga.p1 - carga.p0) * (z - a)) / (b - a);
      // Empuja hacia el otro lado: −n del lado del terreno (n izquierda = (−u_y, u_x))
      const s = carga.lado === "izquierdo" ? -1 : 1;
      const dir = (u: Vec2): V => [-s * u[1], s * u[0], 0];
      losas.muros.forEach((lm, j) => {
        if (lm.w !== w) return;
        const zm = (lm.z0 + lm.z1) / 2;
        if (!(zm > ley.z0 && zm < ley.z1)) return;
        const d = dir(lm.eje1);
        laminaNodos(c, nLosas + j, lm.nudos.map((n) => por(d, p(cotaNudo(ctx, topo.nudos[n]!)))));
      });
      for (const pa of plan.panos) {
        if (pa.w !== w) continue;
        for (const f of franjas(pa))
          for (const [za, zb] of franjasLibres(plan, pa, f.sm, Math.max(ctx.cotas[pa.k + 1]!, ley.z0), Math.min(ctx.cotas[pa.k]!, ley.z1))) {
            const X1: V = [f.A[0] + (f.u[0] * f.L) / 2 - centro[0], f.A[1] + (f.u[1] * f.L) / 2 - centro[1], za - centro[2]];
            sumarLineal(fisicas[c]!, X1, [0, 0, 1], zb - za, por(dir(f.u), f.L * p(za)), por(dir(f.u), f.L * p(zb)));
          }
      }
    } else if (carga.tipo === "viga") {
      sobrePieza(c, carga.viga, piezas.rectasDe.get(carga.viga) ?? [], carga.ejes, carga.q, carga.qb, carga.desde, carga.hasta, carga.id);
    } else {
      sobrePieza(c, carga.pilar, piezas.rectasDe.get(carga.pilar) ?? [], carga.ejes, carga.q, carga.qb, carga.desde, carga.hasta, carga.id);
    }
  }
  return { casos, fisicas };
}

/**
 * Resultante de las cargas de un caso del modelo analítico, respecto a `centro`, leída del propio
 * modelo: nudos, offsets y tramos flexibles (sólo cargas globales, que son las que emite el
 * compilador).
 */
export function resultanteAnalitica(modelo: ModeloAnalitico, c: number, centro: Vec3): Resultante {
  const r = resultanteCero();
  const caso = modelo.casos[c]!;
  const X = (n: number): V => {
    const nd = modelo.nudos[n]!;
    return [nd.x - centro[0], nd.y - centro[1], nd.z - centro[2]];
  };
  for (const cn of caso.nodales ?? []) sumarPuntual(r, X(cn.nudo), cn.f.slice(0, 3), cn.f.slice(3, 6));
  // Superficie uniforme y global sobre una lámina plana: q·A en su centroide (dos triángulos). Con
  // un valor por nudo, la integral del campo bilineal con 2×2 puntos de Gauss (exacta en las
  // láminas rectangulares de los muros)
  for (const cl of caso.laminas ?? []) {
    if (cl.tipo !== "superficie" || cl.ejes !== "global") throw new Error("resultanteAnalitica: sólo superficies globales");
    const [a, b, c2, d] = modelo.laminas![cl.lamina]!.nudos.map(X) as [V, V, V, V];
    if (typeof cl.q[0] !== "number") {
      const qs = cl.q as readonly (readonly number[])[];
      const g = 1 / Math.sqrt(3);
      for (const [xi, eta] of [[-g, -g], [g, -g], [g, g], [-g, g]] as const) {
        const N = [(1 - xi) * (1 - eta), (1 + xi) * (1 - eta), (1 + xi) * (1 + eta), (1 - xi) * (1 + eta)].map((x) => x / 4);
        const dxi = [-(1 - eta), 1 - eta, 1 + eta, -(1 + eta)].map((x) => x / 4);
        const deta = [-(1 - xi), -(1 + xi), 1 + xi, 1 - xi].map((x) => x / 4);
        const P4 = [a, b, c2, d];
        let Xg: V = [0, 0, 0];
        let Xx: V = [0, 0, 0];
        let Xe: V = [0, 0, 0];
        let qg: V = [0, 0, 0];
        for (let n = 0; n < 4; n++) {
          Xg = mas(Xg, por(P4[n]!, N[n]!));
          Xx = mas(Xx, por(P4[n]!, dxi[n]!));
          Xe = mas(Xe, por(P4[n]!, deta[n]!));
          qg = mas(qg, por(qs[n]!, N[n]!));
        }
        sumarPuntual(r, Xg, por(qg, norma(cruz(Xx, Xe))), [0, 0, 0]);
      }
      continue;
    }
    const t1 = norma(cruz(menos(b, a), menos(c2, a))) / 2;
    const t2 = norma(cruz(menos(c2, a), menos(d, a))) / 2;
    const g1 = por(mas(mas(a, b), c2), 1 / 3);
    const g2 = por(mas(mas(a, c2), d), 1 / 3);
    const A = t1 + t2;
    sumarPuntual(r, por(mas(por(g1, t1), por(g2, t2)), 1 / A), por(cl.q as Vec3, A), [0, 0, 0]);
  }
  for (const cb of caso.barras ?? []) {
    const b = modelo.barras![cb.barra]!;
    const ip = mas(X(b.nudos[0]), b.offsets?.i ?? [0, 0, 0]);
    const jp = mas(X(b.nudos[1]), b.offsets?.j ?? [0, 0, 0]);
    const d = menos(jp, ip);
    const e = por(d, 1 / norma(d));
    if (cb.ejes !== "global") throw new Error("resultanteAnalitica: sólo cargas globales");
    if (cb.tipo === "puntual") sumarPuntual(r, mas(ip, por(e, cb.x)), cb.F ?? [0, 0, 0], cb.M ?? [0, 0, 0]);
    else {
      const a = cb.a ?? 0;
      const b2 = cb.b ?? norma(d);
      sumarLineal(r, mas(ip, por(e, a)), e, b2 - a, cb.qa, cb.qb ?? cb.qa);
    }
  }
  return r;
}

/** Errores relativos de fuerzas y momentos entre dos resultantes. */
export function diferenciaResultantes(a: Resultante, b: Resultante): { fuerzas: number; momentos: number } {
  const escF = Math.max(a.escalaF, b.escalaF);
  const escM = Math.max(a.escalaM, b.escalaM);
  return {
    fuerzas: escF > 0 ? norma(menos(a.F, b.F)) / escF : 0,
    momentos: escM > 0 ? norma(menos(a.M, b.M)) / escM : 0,
  };
}
