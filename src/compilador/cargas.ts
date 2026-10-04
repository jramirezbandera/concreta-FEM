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
 * - Sin pérdidas (regla 3 del plan): la resultante física de cada caso (F y M respecto al centro
 *   del modelo, calculada sobre la pieza entera) tiene que coincidir con la analítica (leída del
 *   modelo analítico ya montado, con sus offsets) a 1e-9.
 */
import type { CargaBarra, ModeloAnalitico, Vec3 } from "../motor/modelo.ts";
import { Diagnosticos } from "../motor/diagnosticos.ts";
import type { Vec2, Viga } from "./fisico.ts";
import type { Losas } from "./losas.ts";
import type { Piezas, Recta } from "./piezas.ts";
import { areaConSigno, momentosInterseccion, momentosRegion, puntoEnRegion, type Momentos, type Region } from "./poligonos.ts";
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
  /**
   * Por caso: cargas nodales (por nudo provisional), cargas de barra (por barra de `piezas`) y
   * cargas de superficie uniformes y globales por lámina (por índice de lámina, ya canónico).
   */
  casos: { nodales: Map<number, number[]>; barras: CargaBarra[]; laminas: Map<number, number[]> }[];
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
function pesoBajoLosa(r: Recta, w: number, b: number, h: number, regiones: readonly { region: Region; t: number }[]): { desde: number; hasta: number; w: number }[] {
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
          if (tau >= 0 && tau <= 1 && sigma > 0 && sigma < r.len) cortes.add(sigma);
        }
      }
    }
  }
  const cs = [...cortes].sort((x, y) => x - y);
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

export function construirCargas(ctx: Contexto, topo: Topologia, piezas: Piezas, losas: Losas, centro: Vec3, diag: Diagnosticos): CargasCompiladas {
  const casos = ctx.casos.map(() => ({ nodales: new Map<number, number[]>(), barras: [] as CargaBarra[], laminas: new Map<number, number[]>() }));
  const lamina = (c: number, l: number, q: readonly number[]) => {
    const m = casos[c]!.laminas;
    let v = m.get(l);
    if (!v) m.set(l, (v = [0, 0, 0]));
    for (let i = 0; i < 3; i++) v[i]! += q[i]!;
  };
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

  // Momentos de una figura respecto al centro del modelo (en planta), y cota relativa de una planta
  const desplazar = (m: Momentos): Momentos => ({ A: m.A, Sx: m.Sx - centro[0] * m.A, Sy: m.Sy - centro[1] * m.A });
  const cota = (planta: string) => ctx.cotas[ctx.planta.get(planta)!]! - centro[2];
  /** Losas de la planta de una viga, con su región unida y su espesor (C2-g). */
  const regionesBajo = (v: Viga) => ctx.losas.flatMap((l, i) => (l.losa.planta === v.planta ? [{ region: losas.regiones[i]!, t: l.material.t }] : []));

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
        for (const t of pesoBajoLosa(r, w, sc.huella.b, sc.canto, regiones)) if (t.w > 0) repartir(cPeso, r, t.desde, t.hasta, [0, 0, -t.w], [0, 0, -t.w]);
      }
    }
    // Losas: su pp, por lámina (C2-g)
    losas.laminas.forEach((l, i) => {
      const pp = ctx.losas[l.losa]!.pp;
      if (pp > 0) lamina(cPeso, i, [0, 0, -pp]);
    });
    ctx.losas.forEach((l, i) => {
      if (l.pp > 0 && losas.laminas.some((x) => x.losa === i)) sumarSuperficie(fisicas[cPeso]!, desplazar(momentosRegion(losas.regiones[i]!)), cota(l.losa.planta), [0, 0, -l.pp]);
    });
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
      if (!destino && enLosa === undefined) {
        diag.error("carga/sin-destino", `La carga ${carga.id} no cae sobre ningún pilar, nudo, viga ni losa de la planta ${carga.planta} (tolerancia ${ctx.op.epsSnap} m).`, [carga.id]);
        continue;
      }
      sumarPuntual(fisicas[c]!, menos(Q, centro), F, M);
      if (!destino) nodal(c, enLosa!, F, mas(M, cruz(menos(Q, Xn(enLosa!)), F)));
      else if (destino.tipo === "nudo") nodal(c, destino.nudo, F, mas(M, cruz(menos(Q, Xn(destino.nudo)), F)));
      else {
        const r = piezas.rectasDe.get(destino.tramo.viga.id)!.find((r) => r.tramo === destino.tramo)!;
        puntualEnRecta(c, r, destino.sigma, Q, F, M);
      }
    } else if (carga.tipo === "superficie") {
      // C2-h: por lámina entera; la resultante física, sobre la losa (o la zona ∩ las losas) unida
      for (const l of losas.superficies.get(carga.id) ?? []) lamina(c, l, carga.q);
      const zona = losas.zonasUnidas.get(carga.id);
      let A = 0;
      ctx.losas.forEach((l, i) => {
        if (l.losa.planta !== carga.planta || (carga.losa !== undefined && l.losa.id !== carga.losa)) return;
        const m = zona ? momentosInterseccion(losas.regiones[i]!, zona) : momentosRegion(losas.regiones[i]!);
        A += m.A;
        sumarSuperficie(fisicas[c]!, desplazar(m), cota(carga.planta), carga.q);
      });
      const Az = zona ? Math.abs(areaConSigno(zona)) : A;
      if (!(A > 0)) diag.error("carga/fuera-de-losa", `La carga ${carga.id} no cae sobre ninguna losa de la planta ${carga.planta}.`, [carga.id]);
      else if (Az - A > 1e-6 * Az)
        diag.aviso("carga/zona-fuera-de-losa", `${(Az - A).toFixed(3)} m² de la zona de la carga ${carga.id} caen fuera de las losas${carga.losa ? ` (o de la losa ${carga.losa})` : ""} y no son carga (C2-h).`, [carga.id], { area: Az - A });
    } else if (carga.tipo === "lineal") {
      // C2-h: a los nudos de sus aristas (exacto con las funciones lineales del borde de la lámina)
      for (const [a, b] of losas.lineas.get(carga.id) ?? []) {
        const [Xa, Xb] = [Xn(a), Xn(b)];
        const L = norma(menos(Xb, Xa));
        nodal(c, a, por(carga.q, L / 2), [0, 0, 0]);
        nodal(c, b, por(carga.q, L / 2), [0, 0, 0]);
      }
      const p = losas.lineasUnidas.get(carga.id) ?? [];
      const z = ctx.cotas[ctx.planta.get(carga.planta)!]!;
      for (let i = 0; i + 1 < p.length; i++) {
        const X1: V = [p[i]![0], p[i]![1], z];
        const d = menos([p[i + 1]![0], p[i + 1]![1], z], X1);
        const L = norma(d);
        sumarLineal(fisicas[c]!, menos(X1, centro), por(d, 1 / L), L, carga.q, carga.q);
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
  // Superficie uniforme y global sobre una lámina plana: q·A en su centroide (dos triángulos)
  for (const cl of caso.laminas ?? []) {
    if (cl.tipo !== "superficie" || cl.ejes !== "global" || cl.q.length !== 3 || typeof cl.q[0] !== "number") throw new Error("resultanteAnalitica: sólo superficies uniformes y globales");
    const [a, b, c2, d] = modelo.laminas![cl.lamina]!.nudos.map(X) as [V, V, V, V];
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
