/**
 * Bandas de dimensionado propuestas (C5.1, D5, H25): las del Anejo I del EC2 (el Anejo 19 del CE)
 * a partir de las alineaciones de pilares de cada losa maciza o reticular. Son una propuesta
 * (C5-a): el usuario las guarda en el modelo físico (`bandas`, con `origen: "propuesta"`), las
 * edita si quiere, y el compilador siembra sus lados en la malla (C2) como los de cualquier otra.
 *
 * Para cada losa y cada una de sus dos direcciones (su eje 1 y la perpendicular):
 * 1. Los pilares que llegan a la planta y caen en la losa (su eje dentro, o a menos de su radio del
 *    borde) se agrupan por su coordenada transversal t: dos ejes consecutivos a ≤ τ son de la misma
 *    alineación (C5-b: τ = máx(ε_snap, 0,1·S), con S la menor separación de más de 1 m entre ejes).
 *    Una alineación necesita ≥ 2 pilares; su eje va por la media de sus t.
 * 2. Banda de pilares (I.1.2(1), figura I.1): del primer pilar al último, prolongada hasta el borde
 *    de la losa si el voladizo es ≤ el vano contiguo; a cada lado, lx/4, con lx la menor dimensión
 *    de los recuadros de ese lado (la distancia a la alineación paralela vecina y el menor vano a lo
 *    largo de la alineación). Sin vecina en un lado (borde), ese lado llega como mucho al borde de la
 *    losa. En un reticular, si los ábacos de todos sus pilares miden más de lx/3 en transversal, la
 *    banda toma su ancho común (I.1.2(3)).
 * 3. Banda central: lo que queda entre dos bandas de pilares vecinas, en el tramo que comparten.
 * 4. Una banda que queda con menos de la mitad de su área dentro de la losa (sin sus huecos) se
 *    descarta, con aviso.
 * 5. Apoyos de cada banda (C5.2): el tramo de cada pilar a lo largo de d, con una cara común por
 *    línea transversal de pilares (C5-g, `carasComunes`): todas las bandas cortan esa línea por las
 *    mismas dos rectas, que la malla siembra enteras (E5-5).
 *
 * Las coordenadas van en la base (d, n) de la dirección: s = p·d a lo largo, t = p·n transversal.
 */
import { Diagnosticos, type Diagnostico } from "../motor/diagnosticos.ts";
import { FRACCION_MINIMA_BANDA, resolverOpciones, type Banda, type ModeloFisico, type OpcionesCompilacion, type Pilar, type Vec2 } from "./fisico.ts";
import { huellaPilar, radioHuella, type Huella } from "./geometria2d.ts";
import { direccionEje1 } from "./losas.ts";
import { ejePilar, medidasForma } from "./puntoFijo.ts";
import { areaConSigno, areaInterseccionRegiones, distanciaABorde, puntoEnPoligono, puntoEnRegion, type Region } from "./poligonos.ts";
import { validar, type Contexto, type LosaCompilada } from "./validar.ts";

/** Separación mínima entre ejes de pilares que cuenta como separación entre alineaciones, m (C5-b). */
export const SEPARACION_MINIMA_ALINEACIONES = 1;
/** τ = máx(ε_snap, FACTOR_TAU · S) (C5-b). */
export const FACTOR_TAU = 0.1;
export { FRACCION_MINIMA_BANDA };
/** Distancia mínima de la cara común al eje de cada pilar, en fracciones de su semiextensión (C5-g). */
export const CARA_COMUN = 0.5;

export interface PropuestaBandas {
  bandas: Banda[];
  diagnosticos: Diagnostico[];
}

interface PilarEnLosa {
  id: string;
  p: Vec2;
  /** Su huella en la planta (sin forma, un punto). */
  huella: Huella;
}

interface Alineacion {
  t: number;
  /** Pilares ordenados por s. */
  pilares: { id: string; s: number; t: number }[];
  s0: number;
  s1: number;
  /** Anchos a cada lado del eje (−n y +n). */
  wMenos: number;
  wMas: number;
  /** Menor vano entre pilares consecutivos. */
  vano: number;
}

const punto = (d: Vec2, n: Vec2, s: number, t: number): Vec2 => [s * d[0] + t * n[0], s * d[1] + t * n[1]];
const redondear = (x: number) => Math.round(x * 1e9) / 1e9;

/**
 * Distancia desde P, en la dirección u (unitaria), hasta el primer cruce con el contorno de la
 * losa (Infinity si no lo cruza). P puede estar en el contorno: los cruces a ≤ eps no cuentan.
 */
function alBorde(P: Vec2, u: Vec2, contorno: readonly Vec2[], eps: number): number {
  let mejor = Infinity;
  for (let i = 0; i < contorno.length; i++) {
    const A = contorno[i]!;
    const B = contorno[(i + 1) % contorno.length]!;
    const e: Vec2 = [B[0] - A[0], B[1] - A[1]];
    const den = u[0] * e[1] - u[1] * e[0];
    if (Math.abs(den) < 1e-14) continue;
    const w: Vec2 = [A[0] - P[0], A[1] - P[1]];
    const lam = (w[0] * e[1] - w[1] * e[0]) / den;
    const mu = (w[0] * u[1] - w[1] * u[0]) / den;
    if (mu < -1e-12 || mu > 1 + 1e-12 || lam <= eps) continue;
    mejor = Math.min(mejor, lam);
  }
  return mejor;
}

/** Sección del tramo de pilar que llega a la planta (su cabeza en ella) o, si no, la del pilar. */
function seccionEn(p: Pilar, planta: string): string {
  return p.tramos?.find((t) => t.planta === planta)?.seccion ?? p.seccion;
}

export function pilaresEnLosa(ctx: Contexto, l: LosaCompilada): PilarEnLosa[] {
  const k = ctx.planta.get(l.losa.planta)!;
  const r: PilarEnLosa[] = [];
  for (const p of ctx.pilares) {
    const kh = ctx.planta.get(p.hasta)!;
    const kb = ctx.planta.get(p.desde)!;
    if (!(k >= kh && k < kb)) continue;
    const forma = ctx.secciones.get(seccionEn(p, l.losa.planta))?.huella ?? null;
    const P = ejePilar(p, medidasForma(forma));
    const huella = huellaPilar(P[0], P[1], p.giro ?? 0, forma);
    if (puntoEnRegion(P, l.region) || distanciaABorde(P, l.region.contorno) <= radioHuella(huella) + ctx.op.epsSnap) r.push({ id: p.id, p: P, huella });
  }
  return r;
}

/** Media extensión de una huella a lo largo de la dirección d (0 sin forma). */
export function semiextension(h: Huella, d: Vec2): number {
  const f = h.forma;
  if (!f) return 0;
  if (f.tipo === "circulo") return f.D / 2;
  return (f.h / 2) * Math.abs(h.ez[0] * d[0] + h.ez[1] * d[1]) + (f.b / 2) * Math.abs(h.ey[0] * d[0] + h.ey[1] * d[1]);
}

/**
 * Caras comunes de los apoyos a lo largo de d (C5-g): los pilares de una misma línea transversal
 * comparten sus dos caras, la más interior de cada lado. Así todas las bandas cortan la línea por las
 * mismas dos rectas, que se siembran enteras en la malla, sin quiebros ni rasgos de unos centímetros
 * entre pilares de tamaños distintos. El corte de un pilar mayor cae dentro de su huella, del lado
 * seguro: el momento de apoyo crece hacia el eje.
 * 1. Líneas: los pilares cuyas huellas se solapan a lo largo de d, encadenadas.
 * 2. Grupos de cada línea, de la menor semiextensión a la mayor: un pilar entra en el grupo mientras
 *    la cara común quede, a los dos lados, a no menos de CARA_COMUN de su semiextensión de su eje
 *    (con los ejes alineados, mientras no pase del doble de la menor); si no, empieza otro.
 * Devuelve el tramo [s0, s1] de cada pilar (s = p·d).
 */
export function carasComunes(pilares: readonly { id: string; p: Vec2; huella: Huella }[], d: Vec2): Map<string, [number, number]> {
  type Item = { id: string; s: number; e: number };
  const items: Item[] = pilares.map((p) => ({ id: p.id, s: p.p[0] * d[0] + p.p[1] * d[1], e: semiextension(p.huella, d) })).sort((a, b) => a.s - a.e - (b.s - b.e) || (a.id < b.id ? -1 : 1));
  const tramo = (g: Item[]): [number, number] => [Math.max(...g.map((x) => x.s - x.e)), Math.min(...g.map((x) => x.s + x.e))];
  const cabe = (g: Item[]) => {
    const [lo, hi] = tramo(g);
    return g.every((x) => hi - x.s >= CARA_COMUN * x.e - 1e-12 && x.s - lo >= CARA_COMUN * x.e - 1e-12);
  };
  const r = new Map<string, [number, number]>();
  const agrupar = (linea: Item[]) => {
    linea.sort((a, b) => a.e - b.e || a.s - b.s || (a.id < b.id ? -1 : 1));
    let grupo: Item[] = [];
    const cerrar = () => {
      const t = tramo(grupo);
      for (const x of grupo) r.set(x.id, t);
    };
    for (const q of linea) {
      if (grupo.length && cabe([...grupo, q])) grupo.push(q);
      else {
        if (grupo.length) cerrar();
        grupo = [q];
      }
    }
    cerrar();
  };
  // Líneas: huellas que se solapan a lo largo de d (por su comienzo s − e)
  let linea: Item[] = [];
  let fin = -Infinity;
  for (const q of items) {
    if (linea.length && q.s - q.e >= fin) {
      agrupar(linea);
      linea = [];
    }
    linea.push(q);
    fin = Math.max(linea.length > 1 ? fin : -Infinity, q.s + q.e);
  }
  if (linea.length) agrupar(linea);
  return r;
}

/** Agrupa los pilares por t (C5-b). También propone los ejes de replanteo (`ejes.ts`). */
export function alineaciones(pilares: readonly { id: string; p: Vec2 }[], d: Vec2, n: Vec2, epsSnap: number, minimo = 2): { id: string; s: number; t: number }[][] {
  const pts = pilares.map((p) => ({ id: p.id, s: p.p[0] * d[0] + p.p[1] * d[1], t: p.p[0] * n[0] + p.p[1] * n[1] })).sort((a, b) => a.t - b.t || a.s - b.s || (a.id < b.id ? -1 : 1));
  const huecos = pts.slice(1).map((q, i) => q.t - pts[i]!.t);
  const S = Math.min(...huecos.filter((g) => g > SEPARACION_MINIMA_ALINEACIONES));
  const tau = Number.isFinite(S) ? Math.max(epsSnap, FACTOR_TAU * S) : epsSnap;
  const grupos: { id: string; s: number; t: number }[][] = [];
  for (const q of pts) {
    const g = grupos[grupos.length - 1];
    if (g && q.t - g[g.length - 1]!.t <= tau) g.push(q);
    else grupos.push([q]);
  }
  return grupos.filter((g) => g.length >= minimo).map((g) => g.sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : 1)));
}

/** Rectángulo de una banda (para medir su área en la losa). */
function rectangulo(b: Banda): Vec2[] {
  const dx = b.hasta[0] - b.desde[0];
  const dy = b.hasta[1] - b.desde[1];
  const L = Math.sqrt(dx * dx + dy * dy);
  const m: Vec2 = [(-dy / L) * (b.ancho / 2), (dx / L) * (b.ancho / 2)];
  return [
    [b.desde[0] - m[0], b.desde[1] - m[1]],
    [b.hasta[0] - m[0], b.hasta[1] - m[1]],
    [b.hasta[0] + m[0], b.hasta[1] + m[1]],
    [b.desde[0] + m[0], b.desde[1] + m[1]],
  ];
}

/** Las bandas de una losa en una dirección (d a lo largo, n transversal). */
function bandasDireccion(ctx: Contexto, l: LosaCompilada, pilares: PilarEnLosa[], tramos: ReadonlyMap<string, [number, number]>, d: Vec2, n: Vec2, etiqueta: string, diag: Diagnosticos): Banda[] {
  const eps = ctx.op.epsGeom;
  const grupos = alineaciones(pilares, d, n, ctx.op.epsSnap);
  if (!grupos.length) {
    diag.aviso("banda/sin-alineaciones", `La losa ${l.losa.id} no tiene alineaciones de al menos dos pilares en su dirección ${etiqueta}: no se proponen bandas en ella.`, [l.losa.id]);
    return [];
  }
  const contorno = l.region.contorno;
  const al: Alineacion[] = grupos.map((g) => {
    const t = g.reduce((a, q) => a + q.t, 0) / g.length;
    const vanos = g.slice(1).map((q, i) => q.s - g[i]!.s);
    const vano = Math.min(...vanos);
    // Prolongación hasta el borde si el voladizo es ≤ el vano contiguo
    const primero = g[0]!;
    const ultimo = g[g.length - 1]!;
    const atras = alBorde(punto(d, n, primero.s, t), [-d[0], -d[1]], contorno, eps);
    const delante = alBorde(punto(d, n, ultimo.s, t), d, contorno, eps);
    const s0 = Number.isFinite(atras) && atras <= vanos[0]! + eps ? primero.s - atras : primero.s;
    const s1 = Number.isFinite(delante) && delante <= vanos[vanos.length - 1]! + eps ? ultimo.s + delante : ultimo.s;
    return { t, pilares: g, s0, s1, wMenos: 0, wMas: 0, vano };
  });
  const solapan = (a: Alineacion, b: Alineacion) => Math.min(a.s1, b.s1) - Math.max(a.s0, b.s0) > eps;
  const vecina = (i: number, sentido: 1 | -1): Alineacion | undefined => {
    for (let j = i + sentido; j >= 0 && j < al.length; j += sentido) if (solapan(al[i]!, al[j]!)) return al[j];
    return undefined;
  };
  const abacos = l.reticular?.abacos ?? [];
  al.forEach((a, i) => {
    const menos = vecina(i, -1);
    const mas = vecina(i, 1);
    const lxMenos = Math.min(a.vano, menos ? a.t - menos.t : Infinity);
    const lxMas = Math.min(a.vano, mas ? mas.t - a.t : Infinity);
    // Un lado sin vecina es de borde: lx del otro lado, y como mucho hasta el borde de la losa
    const lx = Math.min(lxMenos, lxMas);
    const borde = (u: Vec2) => Math.min(...a.pilares.map((q) => alBorde(punto(d, n, q.s, a.t), u, contorno, -eps)));
    const limiteMenos = menos ? Infinity : borde([-n[0], -n[1]]);
    const limiteMas = mas ? Infinity : borde(n);
    a.wMenos = Math.min(menos ? lxMenos / 4 : lx / 4, limiteMenos);
    a.wMas = Math.min(mas ? lxMas / 4 : lx / 4, limiteMas);
    // Ábacos de todos sus pilares más anchos que lx/3: la banda toma su ancho común (I.1.2(3))
    if (abacos.length) {
      const extensiones = a.pilares.map((q) => {
        const P = punto(d, n, q.s, q.t);
        const ab = abacos.find((poly) => puntoEnPoligono(P, poly));
        if (!ab) return null;
        const ts = ab.map((v) => v[0] * n[0] + v[1] * n[1]);
        return [Math.min(...ts), Math.max(...ts)] as const;
      });
      if (extensiones.every((e) => e && e[1] - e[0] > lx / 3 + eps)) {
        a.wMenos = Math.min(limiteMenos, ...extensiones.map((e) => a.t - e![0]));
        a.wMas = Math.min(limiteMas, ...extensiones.map((e) => e![1] - a.t));
      }
    }
  });

  const bandas: Banda[] = [];
  // Apoyos de una banda (C5.2): el tramo de cada pilar a lo largo de d, con las caras comunes de su
  // línea transversal (C5-g), desde el comienzo s0 de la banda (el de su `desde` guardado, como en
  // `apoyosBandaEn`)
  const apoyosDe = (ps: { id: string; s: number }[], s0: number, s1: number): [number, number][] =>
    ps
      .map((q) => {
        const [a, c] = tramos.get(q.id)!;
        return [redondear(Math.max(0, a - s0)), redondear(Math.min(s1 - s0, c - s0))] as [number, number];
      })
      .filter(([a, c]) => c >= a)
      .filter(([a, c], i, todos) => todos.findIndex(([x, y]) => x === a && y === c) === i)
      .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const nueva = (id: string, tipo: "pilares" | "central", s0: number, s1: number, tMenos: number, tMas: number, pilares: { id: string; s: number }[]) => {
    const tc = (tMenos + tMas) / 2;
    const desde = punto(d, n, s0, tc).map(redondear) as unknown as Vec2;
    const hasta = punto(d, n, s1, tc).map(redondear) as unknown as Vec2;
    const apoyos = apoyosDe(pilares, desde[0] * d[0] + desde[1] * d[1], hasta[0] * d[0] + hasta[1] * d[1]);
    const b: Banda = { id, planta: l.losa.planta, desde, hasta, ancho: redondear(tMas - tMenos), tipo, origen: "propuesta", apoyos };
    if (!(b.ancho > eps) || !(s1 - s0 > eps)) return;
    const rect: Region = { contorno: rectangulo(b), huecos: [] };
    const fraccion = areaInterseccionRegiones(rect, l.region) / Math.abs(areaConSigno(rect.contorno));
    if (fraccion < FRACCION_MINIMA_BANDA) {
      diag.aviso("banda/fuera-de-losa", `La banda ${id} propuesta queda con el ${(100 * fraccion).toFixed(0)} % de su área en la losa ${l.losa.id}: se descarta.`, [l.losa.id], { fraccion });
      return;
    }
    bandas.push(b);
  };
  al.forEach((a, i) => nueva(`${l.losa.id}:${etiqueta}:P${i + 1}`, "pilares", a.s0, a.s1, a.t - a.wMenos, a.t + a.wMas, a.pilares));
  al.forEach((a, i) => {
    const b = vecina(i, 1);
    if (!b) return;
    const j = al.indexOf(b);
    const [s0, s1] = [Math.max(a.s0, b.s0), Math.min(a.s1, b.s1)];
    nueva(`${l.losa.id}:${etiqueta}:C${i + 1}-${j + 1}`, "central", s0, s1, a.t + a.wMas, b.t - b.wMenos, [...a.pilares, ...b.pilares]);
  });
  return bandas;
}

/**
 * Alineaciones de pilares de una losa en sus dos direcciones (las de la propuesta, C5-b): para cada
 * dirección d (su eje 1 y la perpendicular), la coordenada transversal t = p·n de cada alineación
 * (la media de sus pilares) y sus pilares ordenados a lo largo. Las usan los recuadros de las
 * flechas (C5.4).
 */
export function alineacionesLosa(ctx: Contexto, l: LosaCompilada): { d: Vec2; n: Vec2; alineaciones: { t: number; pilares: string[] }[] }[] {
  const pilares = pilaresEnLosa(ctx, l);
  const d = direccionEje1(l.losa.eje1 ?? 0);
  const n: Vec2 = [-d[1], d[0]];
  return [
    [d, n],
    [n, d],
  ].map(([a, b]) => ({
    d: a as Vec2,
    n: b as Vec2,
    alineaciones: alineaciones(pilares, a as Vec2, b as Vec2, ctx.op.epsSnap).map((g) => ({ t: g.reduce((s, q) => s + q.t, 0) / g.length, pilares: g.map((q) => q.id) })),
  }));
}

/**
 * Propone las bandas de pilares y centrales de todas las losas macizas y reticulares del modelo
 * (C5.1). No las añade: el llamante las guarda en `bandas` (D5, C5-a). Si el modelo no es válido,
 * devuelve sus diagnósticos y ninguna banda.
 */
export function proponerBandas(fisico: ModeloFisico, opciones: OpcionesCompilacion = {}): PropuestaBandas {
  const diag = new Diagnosticos();
  const ctx = validar(fisico, resolverOpciones(opciones), diag);
  if (!ctx || diag.hayErrores) return { bandas: [], diagnosticos: diag.lista };
  const bandas: Banda[] = [];
  const enLosa = ctx.losas.map((l) => pilaresEnLosa(ctx, l));
  ctx.losas.forEach((l, i) => {
    const pilares = enLosa[i]!;
    const d = direccionEje1(l.losa.eje1 ?? 0);
    const n: Vec2 = [-d[1], d[0]];
    // Las caras comunes, con los pilares de todas las losas de la planta (C5-g): una línea
    // transversal de pilares es la misma en dos losas vecinas
    const dePlanta = new Map<string, PilarEnLosa>();
    ctx.losas.forEach((o, j) => {
      if (o.losa.planta === l.losa.planta) for (const p of enLosa[j]!) dePlanta.set(p.id, p);
    });
    const todos = [...dePlanta.values()];
    bandas.push(...bandasDireccion(ctx, l, pilares, carasComunes(todos, d), d, n, "1", diag), ...bandasDireccion(ctx, l, pilares, carasComunes(todos, n), n, d, "2", diag));
  });
  return { bandas, diagnosticos: diag.lista };
}

/**
 * Direcciones (d a lo largo, n transversal) de una banda: si su eje es paralelo a una de las dos
 * direcciones de la losa (su eje 1 o la perpendicular), exactamente ésa, como en la propuesta; si
 * no, la de su eje.
 */
function direccionesBanda(b: Banda, eje1: number): { d: Vec2; n: Vec2 } {
  const dx = b.hasta[0] - b.desde[0];
  const dy = b.hasta[1] - b.desde[1];
  const L = Math.sqrt(dx * dx + dy * dy);
  const u: Vec2 = [dx / L, dy / L];
  const d1 = direccionEje1(eje1);
  const n1: Vec2 = [-d1[1], d1[0]];
  for (const [a, b2] of [
    [d1, n1],
    [n1, d1],
  ] as const) {
    const c = u[0] * a[0] + u[1] * a[1];
    if (Math.abs(Math.abs(c) - 1) < 1e-9) return { d: c > 0 ? a : [-a[0], -a[1]], n: b2 };
  }
  return { d: u, n: [-u[1], u[0]] };
}

/** La losa de la planta de la banda con más área bajo ella (la primera, si empatan); null si ninguna. */
function losaDeBanda(ctx: Contexto, b: Banda): LosaCompilada | null {
  let mejor: LosaCompilada | null = null;
  let area = 1e-12;
  const rect: Region = { contorno: rectangulo(b), huecos: [] };
  for (const l of ctx.losas) {
    if (l.losa.planta !== b.planta) continue;
    const a = areaInterseccionRegiones(rect, l.region);
    if (a > area) [mejor, area] = [l, a];
  }
  return mejor;
}

/**
 * Apoyos de una banda cualquiera (V2b, decisión a): los tramos de su eje ocupados por pilares, con
 * las caras comunes de C5-g, igual que en la propuesta. Cuentan las alineaciones de pilares de su
 * losa (la de más área bajo la banda) en su dirección (C5-b: de al menos dos pilares) cuyo eje cae en
 * el ancho de la banda; si no cae ninguna (una banda central), la más cercana a cada lado. Con la
 * banda de una propuesta sin tocar, da sus `apoyos`. Sin losa, o con una dirección sin alineaciones,
 * ninguno.
 */
export function apoyosBandaEn(ctx: Contexto, b: Banda): [number, number][] {
  const l = losaDeBanda(ctx, b);
  if (!l) return [];
  const { d, n } = direccionesBanda(b, l.losa.eje1 ?? 0);
  const todos = new Map<string, PilarEnLosa>();
  for (const o of ctx.losas) if (o.losa.planta === b.planta) for (const p of pilaresEnLosa(ctx, o)) todos.set(p.id, p);
  const tramos = carasComunes([...todos.values()], d);
  const grupos = alineaciones(pilaresEnLosa(ctx, l), d, n, ctx.op.epsSnap).map((g) => ({ t: g.reduce((a, q) => a + q.t, 0) / g.length, pilares: g }));
  const tc = b.desde[0] * n[0] + b.desde[1] * n[1];
  const tol = ctx.op.epsSnap;
  const [t0, t1] = [tc - b.ancho / 2 - tol, tc + b.ancho / 2 + tol];
  let elegidas = grupos.filter((g) => g.t >= t0 && g.t <= t1);
  if (!elegidas.length) {
    const menos = grupos.filter((g) => g.t < t0).sort((x, y) => y.t - x.t)[0];
    const mas = grupos.filter((g) => g.t > t1).sort((x, y) => x.t - y.t)[0];
    elegidas = [menos, mas].filter((g) => g !== undefined);
  }
  const s0 = b.desde[0] * d[0] + b.desde[1] * d[1];
  const s1 = b.hasta[0] * d[0] + b.hasta[1] * d[1];
  return elegidas
    .flatMap((g) => g.pilares)
    .map((q) => {
      const [a, c] = tramos.get(q.id)!;
      return [redondear(Math.max(0, a - s0)), redondear(Math.min(s1 - s0, c - s0))] as [number, number];
    })
    .filter(([a, c]) => c >= a)
    .filter(([a, c], i, x) => x.findIndex(([p, q]) => p === a && q === c) === i)
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

/**
 * Apoyos de una banda del modelo `fisico` (V2b): los de `apoyosBandaEn` con lo que la banda necesita
 * del modelo (plantas, materiales, secciones, sus pilares y las losas de su planta), así que no depende
 * de lo demás ni lo valida. null si eso no es válido (el compilador lo dirá).
 */
export function apoyosBanda(fisico: ModeloFisico, b: Banda, opciones: OpcionesCompilacion = {}): [number, number][] | null {
  const reducido: ModeloFisico = {
    plantas: fisico.plantas,
    materiales: fisico.materiales,
    secciones: fisico.secciones,
    pilares: fisico.pilares ?? [],
    losas: (fisico.losas ?? []).filter((l) => l.planta === b.planta),
    casos: [{ id: "_" }],
  };
  const diag = new Diagnosticos();
  const ctx = validar(reducido, resolverOpciones(opciones), diag);
  if (!ctx || diag.hayErrores) return null;
  return apoyosBandaEn(ctx, b);
}

/** Tolerancia al comparar los apoyos guardados con los recalculados, m. */
const TOLERANCIA_APOYOS = 1e-6;

/**
 * Aviso de las bandas cuyos apoyos guardados ya no son los de sus pilares (V2b, decisión a): un pilar
 * se movió o cambió de sección después de proponerlas o de editarlas.
 */
export function avisarApoyosBandas(ctx: Contexto, diag: Diagnosticos): void {
  for (const b of ctx.bandas) {
    if (b.apoyos === undefined || !ctx.losas.some((l) => l.losa.planta === b.planta)) continue;
    const r = apoyosBandaEn(ctx, b);
    const iguales = r.length === b.apoyos.length && r.every(([a, c], i) => Math.abs(a - b.apoyos![i]![0]) <= TOLERANCIA_APOYOS && Math.abs(c - b.apoyos![i]![1]) <= TOLERANCIA_APOYOS);
    if (!iguales)
      diag.aviso(
        "banda/apoyos-desfasados",
        `Los apoyos de la banda ${b.id} no son los de los pilares de ahora (${JSON.stringify(b.apoyos)} frente a ${JSON.stringify(r)}): se usan los guardados. Vuelva a proponer las bandas o edite ésta para recalcularlos.`,
        [b.id],
      );
  }
}
