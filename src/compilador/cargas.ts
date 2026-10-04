/**
 * Paso 4 del compilador: cargas físicas → cargas analíticas, y el control «sin pérdidas».
 *
 * - Una carga repartida sobre una pieza se reparte sobre los trozos de su eje analítico
 *   (`piezas.ts`): en un tramo flexible es una carga de barra exacta (no se trocea la barra, COM-13);
 *   en una zona rígida o fuera de la cadena va al nudo como fuerza y momento estáticamente
 *   equivalentes (E2: el motor sólo carga el tramo flexible).
 * - Una carga puntual va al nudo (pilar o nudo a ≤ ε_snap) o a la viga sobre la que cae, con el
 *   momento de transporte de la distancia entre el punto y el eje: es exacta.
 * - Todo va en ejes globales; las cargas "local" se giran aquí con los ejes de cada tramo.
 * - Sin pérdidas (regla 3 del plan): la resultante física de cada caso (F y M respecto al centro
 *   del modelo, calculada sobre la pieza entera) tiene que coincidir con la analítica (leída del
 *   modelo analítico ya montado, con sus offsets) a 1e-9.
 */
import type { CargaBarra, ModeloAnalitico, Vec3 } from "../motor/modelo.ts";
import { Diagnosticos } from "../motor/diagnosticos.ts";
import type { Piezas, Recta } from "./piezas.ts";
import type { Topologia } from "./topologia.ts";
import { seccionTramo } from "./topologia.ts";
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
  /** Por caso: cargas nodales (por nudo provisional) y cargas de barra (por barra de `piezas`). */
  casos: { nodales: Map<number, number[]>; barras: CargaBarra[] }[];
  /** Por caso: resultante física respecto a `centro`. */
  fisicas: Resultante[];
}

export function construirCargas(ctx: Contexto, topo: Topologia, piezas: Piezas, centro: Vec3, diag: Diagnosticos): CargasCompiladas {
  const casos = ctx.casos.map(() => ({ nodales: new Map<number, number[]>(), barras: [] as CargaBarra[] }));
  const fisicas = ctx.casos.map(resultanteCero);
  const Xn = (n: number): V => [topo.nudos[n]!.x, topo.nudos[n]!.y, ctx.cotas[topo.nudos[n]!.k]!];
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
    const q = (s: number): V => (sb === sa ? q1 : mas(q1, por(menos(q2, q1), (s - sa) / (sb - sa))));
    sumarLineal(fisicas[c]!, menos(P(r, sa), centro), r.e, sb - sa, q1, q2);
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

  // Peso propio (C1-h): vigas en toda su longitud; pilares, tramo a tramo con su sección
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
      const w = ctx.secciones.get(v.seccion)!.peso;
      if (w > 0) for (const r of piezas.rectasDe.get(v.id) ?? []) repartir(cPeso, r, 0, r.len, [0, 0, -w], [0, 0, -w]);
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
      if (!destino) {
        diag.error("carga/sin-destino", `La carga ${carga.id} no cae sobre ningún pilar, nudo ni viga de la planta ${carga.planta} (tolerancia ${ctx.op.epsSnap} m).`, [carga.id]);
        continue;
      }
      sumarPuntual(fisicas[c]!, menos(Q, centro), F, M);
      if (destino.tipo === "nudo") nodal(c, destino.nudo, F, mas(M, cruz(menos(Q, Xn(destino.nudo)), F)));
      else {
        const r = piezas.rectasDe.get(destino.tramo.viga.id)!.find((r) => r.tramo === destino.tramo)!;
        puntualEnRecta(c, r, destino.sigma, Q, F, M);
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
