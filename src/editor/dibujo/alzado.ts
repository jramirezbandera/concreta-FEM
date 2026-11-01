/**
 * BN3 (`docs/fem3d/barras.md` §6): los enganches de un alzado, en (u, z) como su vista
 * (`agente/render/alzado.ts`: u a lo largo del plano desde su punto `desde`, z la cota), con el punto
 * del modelo de cada rasgo (su planta y su (x, y), `PuntoModelo` de `enganches.ts`). Sólo en los
 * niveles de las plantas: en BN una barra va de planta a planta (`dz` = 0).
 *
 * Qué engancha, de lo que está a menos de la profundidad del plano (lo que se dibuja):
 * - los nudos de los pilares: el eje de la sección en cada planta en que tienen nudo (el del tramo de
 *   debajo; en la de la base, el de encima, como la huella del nudo de CB-f), «centro»; y sus caras
 *   vistas desde el plano, en esa planta, «cara»;
 * - las vigas paralelas al plano: extremos, vértices, puntos medios y el más cercano, en su planta; las
 *   que lo cruzan, el cruce;
 * - los muros paralelos al plano, lo mismo en cada planta que tocan; los que lo cruzan, el cruce;
 * - los ejes de replanteo que cruzan el plano: el cruce con cada nivel;
 * - los extremos de las barras del plano;
 * - las líneas de nivel: el más cercano y la perpendicular desde el primer extremo (una barra vertical).
 *
 * El punto del modelo de un nudo, un vértice, un cruce de rectas paralelas a X o a Y o un extremo es
 * el del modelo (o el cruce), bit a bit; el de una cara, un punto medio o un punto de una recta, y el
 * de un punto que no engancha (en una línea de nivel, a 1 mm), redondeado a 1e-9 m, como las
 * estaciones de V2c2-1. En un alzado paralelo a X o a Y, la coordenada que no cambia es la del plano.
 *
 * Puro: sin IO, sin React ni DOM.
 */
import { PROFUNDIDAD_ALZADO, SENO_PARALELO, type PlanoAlzado } from "../../agente/render/alzado.ts";
import { anchoViga, ejeSeccion, huellaSeccion, porId } from "../../agente/render/modelo.ts";
import { cotasPlantas } from "../../compilador/cotas.ts";
import { ejesDe } from "../../compilador/ejes.ts";
import type { ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import { cruce, modeloEnRecta, redondeo9, type DatosAlzado, type Enganche, type IndiceEnganches, type PuntoModelo, type PuntoRasgo, type Recta, type TipoEnganche } from "./enganches.ts";

/** Lo que un punto que no engancha puede separarse de una línea de nivel, m. */
export const TOLERANCIA_NIVEL = 1e-3;

/** Media recta del plano a cada lado, m: lo que cruza el plano lejos de su eje también se corta. */
const LEJOS = 1e4;

/** El índice de enganches del alzado `plano`; `clave`, la de su vista (`IndiceEnganches.planta`). */
export function indiceAlzado(m: ModeloFisico, plano: PlanoAlzado, clave: string): IndiceEnganches {
  const prof = plano.profundidad ?? PROFUNDIDAD_ALZADO;
  const L = Math.hypot(plano.hasta[0] - plano.desde[0], plano.hasta[1] - plano.desde[1]);
  const dir: Vec2 = L > 0 ? [(plano.hasta[0] - plano.desde[0]) / L, (plano.hasta[1] - plano.desde[1]) / L] : [1, 0];
  const nor: Vec2 = [-dir[1], dir[0]];
  const u = (p: Vec2) => (p[0] - plano.desde[0]) * dir[0] + (p[1] - plano.desde[1]) * dir[1];
  const w = (p: Vec2) => (p[0] - plano.desde[0]) * nor[0] + (p[1] - plano.desde[1]) * nor[1];
  // La recta del plano, larga: sus cruces con lo que lo atraviesa (en un plano paralelo a X o a Y, la coordenada del plano tal cual)
  const P0: Vec2 = [plano.desde[0] - LEJOS * dir[0], plano.desde[1] - LEJOS * dir[1]];
  const P1: Vec2 = [plano.hasta[0] + LEJOS * dir[0], plano.hasta[1] + LEJOS * dir[1]];

  const plantas = m.plantas ?? [];
  const cotas = cotasPlantas(plantas);
  const niveles: { planta: string; z: number }[] = [];
  plantas.forEach((p, i) => {
    const z = cotas[i];
    if (z !== null && z !== undefined) niveles.push({ planta: p.id, z });
  });
  const zDe = new Map(niveles.map((n) => [n.planta, n.z]));
  const indice = new Map(plantas.map((p, i) => [p.id, i]));
  const seccion = (id: string | undefined) => m.secciones?.find((s) => s.id === id);

  const puntos: PuntoRasgo[] = [];
  const rectas: Recta[] = [];
  /** Un rasgo en el nivel de `planta`, en el punto q del modelo. */
  const punto = (q: Vec2, planta: string, tipo: TipoEnganche, objeto: string) => {
    const z = zDe.get(planta);
    if (z !== undefined) puntos.push({ p: [u(q), z], tipo, objeto, modelo: { planta, p: q } });
  };
  /** Un tramo paralelo al plano en el nivel de `planta`: sus extremos (vértices si no lo son de la pieza), su punto medio y la recta. */
  const tramo = (a: Vec2, b: Vec2, planta: string, objeto: string, tipos: readonly [TipoEnganche, TipoEnganche]) => {
    const z = zDe.get(planta);
    if (z === undefined) return;
    punto(a, planta, tipos[0], objeto);
    punto(b, planta, tipos[1], objeto);
    const r: Recta = { a: [u(a), z], b: [u(b), z], objeto, modelo: { planta, a, b } };
    rectas.push(r);
    puntos.push({ p: [(r.a[0] + r.b[0]) / 2, z], tipo: "medio", objeto, modelo: modeloEnRecta(r.modelo!, 0.5) });
  };
  /** El cruce con el plano del segmento ab, si lo atraviesa (o lo toca). */
  const corte = (a: Vec2, b: Vec2): Vec2 | null => {
    const [wa, wb] = [w(a), w(b)];
    if (!(wa > 0 !== wb > 0 || wa === 0 || wb === 0)) return null;
    return cruce(P0, P1, a, b);
  };
  /** Una polilínea en los niveles `enPlantas`: lo paralelo al plano a ≤ prof + medio ancho, como tramos; lo que lo cruza, su cruce. */
  const polilinea = (id: string, ps: readonly Vec2[], ancho: number, enPlantas: readonly string[]) => {
    for (let i = 1; i < ps.length; i++) {
      const [a, b] = [ps[i - 1]!, ps[i]!];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l === 0) continue;
      const seno = Math.abs(((b[0] - a[0]) / l) * nor[0] + ((b[1] - a[1]) / l) * nor[1]);
      if (seno < SENO_PARALELO) {
        if (Math.abs(w(a)) > prof + ancho / 2 || Math.abs(w(b)) > prof + ancho / 2) continue;
        const tipos: [TipoEnganche, TipoEnganche] = [i === 1 ? "extremo" : "vertice", i === ps.length - 1 ? "extremo" : "vertice"];
        for (const pl of enPlantas) tramo(a, b, pl, id, tipos);
      } else {
        const c = corte(a, b);
        if (c) for (const pl of enPlantas) punto(c, pl, "cruce", id);
      }
    }
  };

  // Pilares: el nudo de cada planta (el eje del tramo de debajo; en la base, el de encima) y sus caras
  for (const p of porId(m.pilares ?? [])) {
    if (Math.abs(w([p.x, p.y])) > prof) continue;
    const [a, b] = [indice.get(p.desde), indice.get(p.hasta)];
    if (a === undefined || b === undefined || b >= a) continue;
    for (let k = b; k <= a; k++) {
      const cabeza = plantas[k === a ? a - 1 : k]!.id;
      const s = seccion(p.tramos?.find((t) => t.planta === cabeza)?.seccion ?? p.seccion);
      const planta = plantas[k]!.id;
      const eje = ejeSeccion(p, s);
      punto(eje, planta, "centro", p.id);
      const h = huellaSeccion(p, s);
      if (!h) continue;
      // Las caras que se ven desde el plano: lo que más sale de la huella a cada lado, a lo largo de él
      const ue = u(eje);
      const [d0, d1] =
        "anillo" in h
          ? [Math.min(...h.anillo.map((c) => u(c))) - ue, Math.max(...h.anillo.map((c) => u(c))) - ue]
          : [u(h.centro) - ue - h.radio, u(h.centro) - ue + h.radio];
      const cara = (d: number, i: 0 | 1) => (dir[i] === 0 ? eje[i] : redondeo9(eje[i] + d * dir[i]));
      for (const d of [d0, d1]) punto([cara(d, 0), cara(d, 1)], planta, "cara", p.id);
    }
  }

  // Vigas, en su planta
  for (const v of porId(m.vigas ?? [])) polilinea(v.id, v.puntos, anchoViga(seccion(v.seccion)), [v.planta]);

  // Muros, en cada planta de su base a su cabeza
  for (const x of porId(m.muros ?? [])) {
    const [a, b] = [indice.get(x.desde), indice.get(x.hasta)];
    if (a === undefined || b === undefined || b >= a) continue;
    polilinea(x.id, x.puntos, x.espesor, plantas.slice(b, a + 1).map((p) => p.id));
  }

  // Los ejes de replanteo que cruzan el plano, en cada nivel
  for (const e of [...ejesDe(m).ejes].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
    if (e.id === plano.eje || (e.desde[0] === e.hasta[0] && e.desde[1] === e.hasta[1])) continue;
    const [wa, wb] = [w(e.desde), w(e.hasta)];
    if (wa === wb || (wa > 0 && wb > 0) || (wa < 0 && wb < 0)) continue;
    const c = cruce(P0, P1, e.desde, e.hasta);
    if (c) for (const n of niveles) punto(c, n.planta, "cruce", e.id);
  }

  // Los extremos de las barras del plano
  for (const x of porId(m.barras ?? [])) {
    const [A, B]: [Vec2, Vec2] = [[x.inicio.x, x.inicio.y], [x.fin.x, x.fin.y]];
    if (Math.abs(w(A)) > prof || Math.abs(w(B)) > prof) continue;
    punto(A, x.inicio.planta, "extremo", x.id);
    punto(B, x.fin.planta, "extremo", x.id);
  }

  // Las líneas de nivel, de lado a lado de lo que hay (como las dibuja la vista, con 1 m más)
  let [u0, u1] = [0, L];
  for (const x of puntos) [u0, u1] = [Math.min(u0, x.p[0]), Math.max(u1, x.p[0])];
  [u0, u1] = [u0 - 1, u1 + 1];
  const enPlano = (t: number): Vec2 => [plano.desde[0] + t * dir[0], plano.desde[1] + t * dir[1]];
  for (const n of niveles) rectas.push({ a: [u0, n.z], b: [u1, n.z], objeto: n.planta, modelo: { planta: n.planta, a: enPlano(u0), b: enPlano(u1) } });

  return { planta: clave, puntos, rectas, caras: [], circulos: [], crucesEjes: [], direccion: 0, siluetas: [], alzado: { desde: plano.desde, dir, niveles } };
}

/**
 * El punto del modelo de un punto p del alzado: el del enganche; si no, el de la línea de nivel en que
 * cae (a `TOLERANCIA_NIVEL`), con su (x, y) en el plano, redondeado a 1e-9 m; null si no cae en ninguna.
 */
export function puntoModeloAlzado(a: DatosAlzado, p: Vec2, e?: Enganche | null): PuntoModelo | null {
  if (e?.modelo) return e.modelo;
  const n = a.niveles.find((x) => Math.abs(x.z - p[1]) <= TOLERANCIA_NIVEL);
  if (!n) return null;
  const c = (i: 0 | 1) => (a.dir[i] === 0 ? a.desde[i] : redondeo9(a.desde[i] + p[0] * a.dir[i]));
  return { planta: n.planta, p: [c(0), c(1)] };
}

/** Dónde se ve un punto del modelo en la vista del índice: en un alzado, (u, z) (null si su planta no tiene cota); en planta, su (x, y). */
export function puntoEnVista(q: PuntoModelo, ix: IndiceEnganches): Vec2 | null {
  const a = ix.alzado;
  if (!a) return q.p;
  const z = a.niveles.find((n) => n.planta === q.planta)?.z;
  return z === undefined ? null : [(q.p[0] - a.desde[0]) * a.dir[0] + (q.p[1] - a.desde[1]) * a.dir[1], z];
}
