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
 *
 * Las coordenadas van en la base (d, n) de la dirección: s = p·d a lo largo, t = p·n transversal.
 */
import { Diagnosticos, type Diagnostico } from "../motor/diagnosticos.ts";
import { resolverOpciones, type Banda, type ModeloFisico, type OpcionesCompilacion, type Pilar, type Vec2 } from "./fisico.ts";
import { huellaPilar, radioHuella, type Huella } from "./geometria2d.ts";
import { direccionEje1 } from "./losas.ts";
import { areaConSigno, areaInterseccionRegiones, distanciaABorde, puntoEnPoligono, puntoEnRegion, type Region } from "./poligonos.ts";
import { validar, type Contexto, type LosaCompilada } from "./validar.ts";

/** Separación mínima entre ejes de pilares que cuenta como separación entre alineaciones, m (C5-b). */
export const SEPARACION_MINIMA_ALINEACIONES = 1;
/** τ = máx(ε_snap, FACTOR_TAU · S) (C5-b). */
export const FACTOR_TAU = 0.1;
/** Fracción mínima del área de una banda dentro de la losa para conservarla. */
export const FRACCION_MINIMA_BANDA = 0.5;

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

function pilaresEnLosa(ctx: Contexto, l: LosaCompilada): PilarEnLosa[] {
  const k = ctx.planta.get(l.losa.planta)!;
  const r: PilarEnLosa[] = [];
  for (const p of ctx.pilares) {
    const kh = ctx.planta.get(p.hasta)!;
    const kb = ctx.planta.get(p.desde)!;
    if (!(k >= kh && k < kb)) continue;
    const forma = ctx.secciones.get(seccionEn(p, l.losa.planta))?.huella ?? null;
    const huella = huellaPilar(p.x, p.y, p.giro ?? 0, forma);
    const P: Vec2 = [p.x, p.y];
    if (puntoEnRegion(P, l.region) || distanciaABorde(P, l.region.contorno) <= radioHuella(huella) + ctx.op.epsSnap) r.push({ id: p.id, p: P, huella });
  }
  return r;
}

/** Media extensión de una huella a lo largo de la dirección d (0 sin forma). */
function semiextension(h: Huella, d: Vec2): number {
  const f = h.forma;
  if (!f) return 0;
  if (f.tipo === "circulo") return f.D / 2;
  return (f.h / 2) * Math.abs(h.ez[0] * d[0] + h.ez[1] * d[1]) + (f.b / 2) * Math.abs(h.ey[0] * d[0] + h.ey[1] * d[1]);
}

/** Agrupa los pilares por t (C5-b). */
function alineaciones(pilares: PilarEnLosa[], d: Vec2, n: Vec2, epsSnap: number): { id: string; s: number; t: number }[][] {
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
  return grupos.filter((g) => g.length >= 2).map((g) => g.sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : 1)));
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
function bandasDireccion(ctx: Contexto, l: LosaCompilada, pilares: PilarEnLosa[], d: Vec2, n: Vec2, etiqueta: string, diag: Diagnosticos): Banda[] {
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
  const huellaDe = new Map(pilares.map((p) => [p.id, p.huella]));
  // Apoyos de una banda (C5.2): la huella de cada pilar a lo largo de d, desde su comienzo s0
  const apoyosDe = (ps: { id: string; s: number }[], s0: number, s1: number): [number, number][] =>
    ps
      .map((q) => {
        const e = semiextension(huellaDe.get(q.id)!, d);
        return [redondear(Math.max(0, q.s - e - s0)), redondear(Math.min(s1 - s0, q.s + e - s0))] as [number, number];
      })
      .filter(([a, c]) => c >= a);
  const nueva = (id: string, tipo: "pilares" | "central", s0: number, s1: number, tMenos: number, tMas: number, apoyos: [number, number][]) => {
    const tc = (tMenos + tMas) / 2;
    const desde = punto(d, n, s0, tc).map(redondear) as unknown as Vec2;
    const hasta = punto(d, n, s1, tc).map(redondear) as unknown as Vec2;
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
  al.forEach((a, i) => nueva(`${l.losa.id}:${etiqueta}:P${i + 1}`, "pilares", a.s0, a.s1, a.t - a.wMenos, a.t + a.wMas, apoyosDe(a.pilares, a.s0, a.s1)));
  al.forEach((a, i) => {
    const b = vecina(i, 1);
    if (!b) return;
    const j = al.indexOf(b);
    const [s0, s1] = [Math.max(a.s0, b.s0), Math.min(a.s1, b.s1)];
    nueva(`${l.losa.id}:${etiqueta}:C${i + 1}-${j + 1}`, "central", s0, s1, a.t + a.wMas, b.t - b.wMenos, apoyosDe([...a.pilares, ...b.pilares], s0, s1));
  });
  return bandas;
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
  for (const l of ctx.losas) {
    const pilares = pilaresEnLosa(ctx, l);
    const d = direccionEje1(l.losa.eje1 ?? 0);
    const n: Vec2 = [-d[1], d[0]];
    bandas.push(...bandasDireccion(ctx, l, pilares, d, n, "1", diag), ...bandasDireccion(ctx, l, pilares, n, d, "2", diag));
  }
  return { bandas, diagnosticos: diag.lista };
}
