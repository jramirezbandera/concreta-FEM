/**
 * Arreglo plano de una planta (C2, H28, H29): todo lo que la malla de sus losas tiene que respetar,
 * unido con las dos tolerancias y sin cruces, listo para la triangulación restringida.
 *
 * Contenido: «puntos» (los nudos de C1, que no se mueven, y los puntos sueltos: cargas y apoyos)
 * y «trazos» (polilíneas abiertas o cerradas: ejes de vigas, huellas de pilares, contornos y
 * huecos de losas, bandas, zonas y líneas de carga, apoyos lineales).
 *
 * Reglas, en este orden:
 * 1. Al añadir un vértice, se une al punto más cercano a ≤ ε_snap o, si no lo hay, al segmento más
 *    cercano a ≤ ε_snap, en su proyección (que parte ese segmento). Si no, es un punto nuevo. Se
 *    añaden por prioridad (nudos de C1, vigas, huellas, losas y lo demás), así que lo de menos
 *    prioridad se adapta a lo de más.
 * 2. Un punto cercano al interior de un segmento lo parte: el segmento se dobla para pasar por él
 *    (los nudos de C1 nunca se mueven). A ≤ ε_geom, siempre; a ≤ ε_snap, sólo si los dos trozos
 *    miden más de ε_snap. Sin esa condición, tres puntos a algo más de ε_snap entre sí (un
 *    triángulo diminuto) se parten unos a otros sin fin; un rasgo así queda como está y lo juzga
 *    la calidad de la malla.
 * 3. Dos segmentos que se cruzan se parten en su cruce, o en el punto a ≤ ε_snap del cruce.
 * 2 y 3 se repiten hasta que nada cambia. Al acabar no hay dos puntos a ≤ ε_snap, ni un punto a
 * ≤ ε_geom del interior de un segmento, ni cruces: lo que pide constrainautor.
 *
 * Los desplazamientos mayores que ε_geom (un vértice unido a otro sitio o un trazo doblado) quedan
 * en `movimientos`, para los avisos. Los de las vigas no: sus ejes no se mueven (C1 lleva el hueco
 * en un offset) y sólo se doblan los trazos que siembran la malla.
 *
 * Determinista: con los mismos objetos en el mismo orden, el mismo arreglo. Los cruces se buscan
 * con predicados exactos (robust-predicates; su orient2d es negativo en sentido antihorario).
 */
import { orient2d } from "robust-predicates";
import type { Vec2 } from "./fisico.ts";

export type TipoTrazo = "viga" | "huella" | "losa" | "hueco" | "banda" | "zona" | "linea" | "apoyo-lineal";

export interface PuntoArreglo {
  x: number;
  y: number;
  /** Nudo de la topología de C1 que es, o −1. */
  nudo: number;
}

export interface Trazo {
  /** Objeto físico del que sale. */
  id: string;
  tipo: TipoTrazo;
  /**
   * Referencia dentro del objeto: el índice del tramo en `topo.tramos` (vigas), el del hueco
   * (huecos) o el nudo del pilar (huellas); −1 si no hace falta.
   */
  ref: number;
  cerrado: boolean;
  /** Índices de sus puntos, en orden (sin repetir el primero si es cerrado). */
  puntos: number[];
}

export interface Movimiento {
  id: string;
  tipo: TipoTrazo | "punto";
  /** Qué se movió, en texto: «el vértice 3», «un lado». */
  que: string;
  distancia: number;
}

const clave = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

/** Índice espacial de cajas con altas y bajas. */
class Celdas<K> {
  private readonly celdas = new Map<string, Set<K>>();
  private readonly lado: number;
  constructor(lado: number) {
    this.lado = lado;
  }
  private recorrer(x0: number, y0: number, x1: number, y1: number, f: (c: string) => void): void {
    const l = this.lado;
    for (let i = Math.floor(x0 / l), i1 = Math.floor(x1 / l); i <= i1; i++) for (let j = Math.floor(y0 / l), j1 = Math.floor(y1 / l); j <= j1; j++) f(`${i},${j}`);
  }
  poner(k: K, x0: number, y0: number, x1: number, y1: number): void {
    this.recorrer(x0, y0, x1, y1, (c) => {
      let s = this.celdas.get(c);
      if (!s) this.celdas.set(c, (s = new Set()));
      s.add(k);
    });
  }
  quitar(k: K, x0: number, y0: number, x1: number, y1: number): void {
    this.recorrer(x0, y0, x1, y1, (c) => this.celdas.get(c)?.delete(k));
  }
  buscar(x0: number, y0: number, x1: number, y1: number): Set<K> {
    const r = new Set<K>();
    this.recorrer(x0, y0, x1, y1, (c) => {
      for (const k of this.celdas.get(c) ?? []) r.add(k);
    });
    return r;
  }
}

export class Arreglo {
  readonly puntos: PuntoArreglo[] = [];
  readonly trazos: Trazo[] = [];
  readonly movimientos: Movimiento[] = [];
  private readonly epsGeom: number;
  private readonly epsSnap: number;
  private readonly gPuntos: Celdas<number>;
  private readonly gSegmentos: Celdas<string>;
  /** Segmentos vivos: clave → extremos y número de trazos que lo usan. */
  private readonly segmentos = new Map<string, { a: number; b: number; usos: number }>();

  constructor(epsGeom: number, epsSnap: number) {
    this.epsGeom = epsGeom;
    this.epsSnap = epsSnap;
    const lado = Math.max(1, 4 * epsSnap);
    this.gPuntos = new Celdas(lado);
    this.gSegmentos = new Celdas(lado);
  }

  private P(i: number): Vec2 {
    const p = this.puntos[i]!;
    return [p.x, p.y];
  }

  private nuevo(x: number, y: number, nudo = -1): number {
    this.puntos.push({ x, y, nudo });
    const i = this.puntos.length - 1;
    this.gPuntos.poner(i, x, y, x, y);
    return i;
  }

  private alta(a: number, b: number): void {
    const k = clave(a, b);
    const s = this.segmentos.get(k);
    if (s) {
      s.usos++;
      return;
    }
    this.segmentos.set(k, { a: Math.min(a, b), b: Math.max(a, b), usos: 1 });
    const [A, B] = [this.P(a), this.P(b)];
    this.gSegmentos.poner(k, Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[0], B[0]), Math.max(A[1], B[1]));
  }

  private baja(a: number, b: number): void {
    const k = clave(a, b);
    const s = this.segmentos.get(k)!;
    if (--s.usos > 0) return;
    this.segmentos.delete(k);
    const [A, B] = [this.P(a), this.P(b)];
    this.gSegmentos.quitar(k, Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[0], B[0]), Math.max(A[1], B[1]));
  }

  /** Proyección de q sobre el segmento ab: parámetro t ∈ ℝ y distancia a la recta. */
  private proyectar(q: Vec2, a: number, b: number): { t: number; d: number; X: Vec2 } {
    const [A, B] = [this.P(a), this.P(b)];
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    const L2 = dx * dx + dy * dy;
    const t = ((q[0] - A[0]) * dx + (q[1] - A[1]) * dy) / L2;
    const X: Vec2 = [A[0] + t * dx, A[1] + t * dy];
    const ex = X[0] - q[0];
    const ey = X[1] - q[1];
    return { t, d: Math.sqrt(ex * ex + ey * ey), X };
  }

  /** Punto más cercano a q a ≤ r, o −1 (en empate, el de menor índice). */
  private puntoCercano(q: Vec2, r: number): { i: number; d: number } {
    let mejor = -1;
    let dmin = Infinity;
    for (const i of this.gPuntos.buscar(q[0] - r, q[1] - r, q[0] + r, q[1] + r)) {
      const p = this.puntos[i]!;
      const dx = p.x - q[0];
      const dy = p.y - q[1];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= r && (d < dmin || (d === dmin && i < mejor))) [mejor, dmin] = [i, d];
    }
    return { i: mejor, d: dmin };
  }

  /** Nudo de C1 fijo: no se une a nada (la topología de C1 ya los separa más de ε_snap). */
  fijo(x: number, y: number, nudo: number): number {
    return this.nuevo(x, y, nudo);
  }

  /** Vértice de algo: se une al punto o al segmento más cercano a ≤ ε_snap (regla 1). */
  punto(q: Vec2, id: string, tipo: TipoTrazo | "punto", que: string): number {
    const c = this.puntoCercano(q, this.epsSnap);
    if (c.i >= 0) {
      if (c.d > this.epsGeom && tipo !== "viga") this.movimientos.push({ id, tipo, que, distancia: c.d });
      return c.i;
    }
    // Al segmento más cercano (en empate, el de menor clave)
    const r = this.epsSnap;
    let mejor: { k: string; t: number; d: number; X: Vec2 } | null = null;
    for (const k of [...this.gSegmentos.buscar(q[0] - r, q[1] - r, q[0] + r, q[1] + r)].sort()) {
      const s = this.segmentos.get(k)!;
      const p = this.proyectar(q, s.a, s.b);
      if (p.t > 0 && p.t < 1 && p.d <= r && (!mejor || p.d < mejor.d)) mejor = { k, ...p };
    }
    if (mejor) {
      // Si la proyección cae junto a un punto, a ese punto
      const c2 = this.puntoCercano(mejor.X, this.epsSnap);
      if (c2.i >= 0) {
        const dx = this.puntos[c2.i]!.x - q[0];
        const dy = this.puntos[c2.i]!.y - q[1];
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > this.epsGeom && tipo !== "viga") this.movimientos.push({ id, tipo, que, distancia: d });
        return c2.i;
      }
      if (mejor.d > this.epsGeom && tipo !== "viga") this.movimientos.push({ id, tipo, que, distancia: mejor.d });
      const s = this.segmentos.get(mejor.k)!;
      const n = this.nuevo(mejor.X[0], mejor.X[1]);
      this.partir(s.a, s.b, [n]);
      return n;
    }
    return this.nuevo(q[0], q[1]);
  }

  /**
   * Trazo: une sus vértices (regla 1) y quita los repetidos seguidos. Devuelve null si le quedan
   * menos de 2 puntos distintos (3 si es cerrado).
   */
  trazo(id: string, tipo: TipoTrazo, ref: number, vertices: readonly Vec2[], cerrado: boolean): Trazo | null {
    const ps: number[] = [];
    vertices.forEach((v, i) => {
      const n = this.punto(v, id, tipo, `el vértice ${i + 1}`);
      if (ps[ps.length - 1] !== n) ps.push(n);
    });
    if (cerrado && ps.length > 1 && ps[0] === ps[ps.length - 1]) ps.pop();
    if (ps.length < (cerrado ? 3 : 2)) return null;
    const t: Trazo = { id, tipo, ref, cerrado, puntos: ps };
    this.trazos.push(t);
    this.recorrerLados(t, (a, b) => this.alta(a, b));
    return t;
  }

  private recorrerLados(t: Trazo, f: (a: number, b: number, i: number) => void): void {
    const n = t.puntos.length;
    for (let i = 0; i < (t.cerrado ? n : n - 1); i++) f(t.puntos[i]!, t.puntos[(i + 1) % n]!, i);
  }

  /** Parte el segmento ab en todos los trazos que lo usan, con los puntos `medio` (en orden de a a b). */
  private partir(a: number, b: number, medio0: readonly number[]): void {
    const medio = medio0.filter((m) => m !== a && m !== b);
    if (!medio.length) return;
    for (const t of this.trazos) {
      // Todas sus apariciones (una polilínea puede volver por el mismo segmento)
      for (let i = 0; i < (t.cerrado ? t.puntos.length : t.puntos.length - 1); i++) {
        const n = t.puntos.length;
        const p = t.puntos[i]!;
        const q = t.puntos[(i + 1) % n]!;
        if (!((p === a && q === b) || (p === b && q === a))) continue;
        const ins = p === a ? medio : [...medio].reverse();
        this.baja(p, q);
        t.puntos.splice(i + 1, 0, ...ins);
        const cadena = [p, ...ins, q];
        for (let j = 0; j + 1 < cadena.length; j++) this.alta(cadena[j]!, cadena[j + 1]!);
        i += ins.length;
        if (t.tipo !== "viga") {
          for (const m of ins) {
            const d = this.proyectar(this.P(m), p, q).d;
            if (d > this.epsGeom) this.movimientos.push({ id: t.id, tipo: t.tipo, que: "un lado", distancia: d });
          }
        }
      }
    }
  }

  /** Reglas 2 y 3 hasta que nada cambia. Devuelve false si no converge (no debería pasar). */
  resolver(maxPasadas = 100): boolean {
    for (let pasada = 0; pasada < maxPasadas; pasada++) {
      const a = this.partirPorPuntos();
      const b = this.partirPorCruces();
      if (!a && !b) return true;
    }
    return false;
  }

  /** ¿Parte el punto i al segmento ab? (regla 2) */
  private parte(i: number, a: number, b: number): { t: number } | null {
    const p = this.proyectar(this.P(i), a, b);
    if (!(p.t > 0 && p.t < 1)) return null;
    if (p.d <= this.epsGeom) return { t: p.t };
    if (p.d > this.epsSnap) return null;
    const [A, B] = [this.P(a), this.P(b)];
    const L = Math.sqrt((B[0] - A[0]) * (B[0] - A[0]) + (B[1] - A[1]) * (B[1] - A[1]));
    return p.t * L > this.epsSnap && (1 - p.t) * L > this.epsSnap ? { t: p.t } : null;
  }

  /** Regla 2: puntos cercanos al interior de un segmento. */
  private partirPorPuntos(): boolean {
    const r = this.epsSnap;
    let cambio = false;
    for (const k of [...this.segmentos.keys()].sort()) {
      const s = this.segmentos.get(k);
      if (!s) continue;
      const [A, B] = [this.P(s.a), this.P(s.b)];
      const cerca: { i: number; t: number }[] = [];
      for (const i of this.gPuntos.buscar(Math.min(A[0], B[0]) - r, Math.min(A[1], B[1]) - r, Math.max(A[0], B[0]) + r, Math.max(A[1], B[1]) + r)) {
        if (i === s.a || i === s.b) continue;
        const p = this.parte(i, s.a, s.b);
        if (p) cerca.push({ i, t: p.t });
      }
      if (!cerca.length) continue;
      cerca.sort((x, y) => x.t - y.t || x.i - y.i);
      this.partir(s.a, s.b, cerca.map((c) => c.i));
      cambio = true;
    }
    return cambio;
  }

  /** Regla 3: cruces propios entre segmentos. */
  private partirPorCruces(): boolean {
    const nuevos = new Map<string, { i: number; t: number }[]>();
    const claves = [...this.segmentos.keys()].sort();
    for (const k of claves) {
      const s = this.segmentos.get(k)!;
      const [A, B] = [this.P(s.a), this.P(s.b)];
      for (const k2 of [...this.gSegmentos.buscar(Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[0], B[0]), Math.max(A[1], B[1]))].sort()) {
        if (k2 <= k) continue;
        const s2 = this.segmentos.get(k2)!;
        if (s2.a === s.a || s2.a === s.b || s2.b === s.a || s2.b === s.b) continue;
        const [C, D] = [this.P(s2.a), this.P(s2.b)];
        const o1 = orient2d(A[0], A[1], B[0], B[1], C[0], C[1]);
        const o2 = orient2d(A[0], A[1], B[0], B[1], D[0], D[1]);
        if (!((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0))) continue;
        const o3 = orient2d(C[0], C[1], D[0], D[1], A[0], A[1]);
        const o4 = orient2d(C[0], C[1], D[0], D[1], B[0], B[1]);
        if (!((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) continue;
        // Cruce en el primero (por clave): A + t·(B − A), con t = o3 / (o3 − o4)
        const t = o3 / (o3 - o4);
        const X: Vec2 = [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])];
        const c = this.puntoCercano(X, this.epsSnap);
        const i = c.i >= 0 ? c.i : this.nuevo(X[0], X[1]);
        for (const [kk, ss] of [
          [k, s],
          [k2, s2],
        ] as const) {
          if (i === ss.a || i === ss.b) continue; // el cruce se une a un extremo suyo: ya pasa por él
          const p = this.proyectar(this.P(i), ss.a, ss.b);
          let l = nuevos.get(kk);
          if (!l) nuevos.set(kk, (l = []));
          if (!l.some((x) => x.i === i)) l.push({ i, t: p.t });
        }
      }
    }
    for (const k of [...nuevos.keys()].sort()) {
      const s = this.segmentos.get(k);
      if (!s) continue;
      const l = nuevos.get(k)!.sort((x, y) => x.t - y.t || x.i - y.i);
      this.partir(s.a, s.b, l.map((x) => x.i));
    }
    return nuevos.size > 0;
  }

  /** Segmentos finales con los trazos que los usan (en orden de clave). */
  lados(): { a: number; b: number; trazos: number[] }[] {
    const m = new Map<string, { a: number; b: number; trazos: number[] }>();
    this.trazos.forEach((t, ti) =>
      this.recorrerLados(t, (a, b) => {
        const k = clave(a, b);
        let s = m.get(k);
        if (!s) m.set(k, (s = { a: Math.min(a, b), b: Math.max(a, b), trazos: [] }));
        if (!s.trazos.includes(ti)) s.trazos.push(ti);
      }),
    );
    return [...m.keys()].sort().map((k) => m.get(k)!);
  }

  /**
   * Comprobación final (lo que exige constrainautor): sin cruces y sin puntos a ≤ ε_geom del
   * interior de un segmento ajeno. Devuelve el primer defecto, o null.
   */
  defecto(): string | null {
    const r = this.epsGeom;
    for (const s of this.lados()) {
      const [A, B] = [this.P(s.a), this.P(s.b)];
      for (const i of this.gPuntos.buscar(Math.min(A[0], B[0]) - r, Math.min(A[1], B[1]) - r, Math.max(A[0], B[0]) + r, Math.max(A[1], B[1]) + r)) {
        if (i === s.a || i === s.b) continue;
        const p = this.proyectar(this.P(i), s.a, s.b);
        if (p.t > 0 && p.t < 1 && p.d <= r) return `el punto ${i} queda a ${p.d.toExponential(2)} m del segmento ${s.a}–${s.b}`;
      }
      for (const k2 of this.gSegmentos.buscar(Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[0], B[0]), Math.max(A[1], B[1]))) {
        const s2 = this.segmentos.get(k2)!;
        if (s2.a === s.a || s2.a === s.b || s2.b === s.a || s2.b === s.b) continue;
        const [C, D] = [this.P(s2.a), this.P(s2.b)];
        const o1 = orient2d(A[0], A[1], B[0], B[1], C[0], C[1]);
        const o2 = orient2d(A[0], A[1], B[0], B[1], D[0], D[1]);
        const o3 = orient2d(C[0], C[1], D[0], D[1], A[0], A[1]);
        const o4 = orient2d(C[0], C[1], D[0], D[1], B[0], B[1]);
        if (o1 * o2 < 0 && o3 * o4 < 0) return `los segmentos ${s.a}–${s.b} y ${s2.a}–${s2.b} se cruzan`;
      }
    }
    return null;
  }
}
