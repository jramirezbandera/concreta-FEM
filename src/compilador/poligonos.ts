/**
 * Polígonos en planta para las losas (C2): áreas y momentos, punto en polígono, simplicidad y la
 * integral sobre la intersección de dos regiones. No usan la malla: con ellos, el validador de la
 * malla y el control «sin pérdidas» comprueban el mallado en vez de comprobarse a sí mismos.
 *
 * Intersección de regiones por triángulos en abanico: desde un origen O, la indicatriz de un
 * polígono simple P es, salvo en un conjunto de medida nula, s_P·Σᵢ sgn(Tᵢ)·1(Tᵢ), con
 * Tᵢ = (O, pᵢ, pᵢ₊₁), sgn(Tᵢ) el signo de su área y s_P el del área de P. Así
 * ∫_{P∩Z} f = s_P·s_Z·Σᵢ Σⱼ sgn(Tᵢ)·sgn(Sⱼ)·∫_{Tᵢ∩Sⱼ} f, y Tᵢ ∩ Sⱼ es la intersección de dos
 * triángulos, convexa (Sutherland–Hodgman). Vale para polígonos no convexos; una región con huecos
 * es su contorno menos sus huecos.
 *
 * Sólo aritmética y `Math.sqrt` (COM-12).
 */
import type { Vec2 } from "./fisico.ts";

/** Región en planta: un contorno simple menos sus huecos (simples, dentro y disjuntos). */
export interface Region {
  contorno: readonly Vec2[];
  huecos: readonly (readonly Vec2[])[];
}

/** Área y momentos estáticos de una figura: A = ∫dA, Sx = ∫x dA, Sy = ∫y dA. */
export interface Momentos {
  A: number;
  Sx: number;
  Sy: number;
}

/** Área con signo (positiva en sentido antihorario con Y hacia arriba). */
export function areaConSigno(p: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const [x0, y0] = p[i]!;
    const [x1, y1] = p[(i + 1) % n]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Área y momentos estáticos con signo de un polígono (fórmula del cordón de zapato). */
export function momentosPoligono(p: readonly Vec2[]): Momentos {
  let A = 0;
  let Sx = 0;
  let Sy = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const [x0, y0] = p[i]!;
    const [x1, y1] = p[(i + 1) % n]!;
    const c = x0 * y1 - x1 * y0;
    A += c;
    Sx += (x0 + x1) * c;
    Sy += (y0 + y1) * c;
  }
  return { A: A / 2, Sx: Sx / 6, Sy: Sy / 6 };
}

/** Área y momentos (positivos) de una región: los del contorno menos los de sus huecos. */
export function momentosRegion(r: Region): Momentos {
  const abs = (m: Momentos): Momentos => (m.A < 0 ? { A: -m.A, Sx: -m.Sx, Sy: -m.Sy } : m);
  const m = abs(momentosPoligono(r.contorno));
  for (const h of r.huecos) {
    const mh = abs(momentosPoligono(h));
    m.A -= mh.A;
    m.Sx -= mh.Sx;
    m.Sy -= mh.Sy;
  }
  return m;
}

/** ¿Está q dentro del polígono? (número de cruces; en el borde, cualquiera de los dos). */
export function puntoEnPoligono(q: Vec2, p: readonly Vec2[]): boolean {
  let dentro = false;
  for (let i = 0, n = p.length, j = n - 1; i < n; j = i++) {
    const [xi, yi] = p[i]!;
    const [xj, yj] = p[j]!;
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** ¿Está q dentro de la región (en el contorno y fuera de los huecos)? */
export function puntoEnRegion(q: Vec2, r: Region): boolean {
  return puntoEnPoligono(q, r.contorno) && !r.huecos.some((h) => puntoEnPoligono(q, h));
}

/**
 * Un polígono indexado por bandas de y para `dentro`, que da lo mismo que `puntoEnPoligono` bit a
 * bit: cada banda guarda los lados cuyo rango de y la toca, y un punto sólo recorre los de su banda.
 * Un lado que no toca la banda del punto no cumple `yi > q[1] !== yj > q[1]`, y el orden de los
 * lados no cambia la paridad. Las bandas van por `floor((y − y0) / dy)`, monótono, así que un lado
 * con yₘᵢₙ ≤ q[1] ≤ yₘₐₓ está siempre en la banda del punto. Para los contornos de las losas en el
 * arreglo (cientos de puntos sembrados), que el mallador consulta por cada triángulo de cada ronda.
 */
export class PoligonoIndexado {
  private readonly n: number;
  private readonly y0: number;
  private readonly dy: number;
  private readonly bandas: number[][];
  private readonly p: readonly Vec2[];

  constructor(p: readonly Vec2[]) {
    this.p = p;
    const n = (this.n = p.length);
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [, y] of p) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const N = Math.max(1, Math.min(n, 256));
    const dy = (y1 - y0) / N;
    this.y0 = y0;
    this.dy = dy > 0 ? dy : 1;
    this.bandas = Array.from({ length: N }, () => []);
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = p[i]![1];
      const yj = p[j]![1];
      const b0 = this.banda(Math.min(yi, yj));
      const b1 = this.banda(Math.max(yi, yj));
      for (let b = b0; b <= b1; b++) this.bandas[b]!.push(i);
    }
  }

  private banda(y: number): number {
    return Math.max(0, Math.min(this.bandas.length - 1, Math.floor((y - this.y0) / this.dy)));
  }

  /** `puntoEnPoligono(q, p)`, bit a bit. */
  dentro(q: Vec2): boolean {
    const lados = this.bandas[this.banda(q[1])];
    if (!lados) return false;
    const p = this.p;
    let dentro = false;
    for (const i of lados) {
      const [xi, yi] = p[i]!;
      const [xj, yj] = p[i === 0 ? this.n - 1 : i - 1]!;
      if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }
}

/** Una región con sus polígonos indexados: `dentro` es `puntoEnRegion`, bit a bit. */
export class RegionIndexada {
  private readonly contorno: PoligonoIndexado;
  private readonly huecos: PoligonoIndexado[];

  constructor(r: Region) {
    this.contorno = new PoligonoIndexado(r.contorno);
    this.huecos = r.huecos.map((h) => new PoligonoIndexado(h));
  }

  dentro(q: Vec2): boolean {
    return this.contorno.dentro(q) && !this.huecos.some((h) => h.dentro(q));
  }
}

/** Distancia de q al segmento ab. */
export function distanciaASegmento(q: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = a[0] + t * dx - q[0];
  const ey = a[1] + t * dy - q[1];
  return Math.sqrt(ex * ex + ey * ey);
}

/** Distancia de q al borde de un polígono (cerrado). */
export function distanciaABorde(q: Vec2, p: readonly Vec2[]): number {
  let d = Infinity;
  for (let i = 0, n = p.length; i < n; i++) d = Math.min(d, distanciaASegmento(q, p[i]!, p[(i + 1) % n]!));
  return d;
}

/** Distancia entre los segmentos ab y cd (0 si se cortan). */
export function distanciaEntreSegmentos(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (seCortan(a, b, c, d)) return 0;
  return Math.min(distanciaASegmento(a, c, d), distanciaASegmento(b, c, d), distanciaASegmento(c, a, b), distanciaASegmento(d, a, b));
}

const orient = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** ¿Se cortan los segmentos ab y cd en un punto interior de los dos (cruce propio)? */
function seCortan(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

/**
 * Qué impide que un polígono sea simple con una holgura `eps`, o null: menos de 3 vértices, lados
 * más cortos que eps, área nula, lados no contiguos a ≤ eps (se cortan o se tocan) o lados
 * contiguos que vuelven sobre sí mismos.
 */
export function defectoPoligono(p: readonly Vec2[], eps: number): string | null {
  const n = p.length;
  if (n < 3) return "tiene menos de 3 vértices";
  for (let i = 0; i < n; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % n]!;
    const L = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
    if (!(L > eps)) return `los vértices ${i + 1} y ${((i + 1) % n) + 1} coinciden`;
  }
  let per = 0;
  for (let i = 0; i < n; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % n]!;
    per += Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
  }
  if (!(Math.abs(areaConSigno(p)) > eps * per)) return "tiene área nula";
  for (let i = 0; i < n; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % n]!;
    // Contiguo siguiente: que el extremo lejano de uno no caiga sobre el otro (vuelta atrás)
    const c = p[(i + 2) % n]!;
    if (distanciaASegmento(c, a, b) <= eps || distanciaASegmento(a, b, c) <= eps) return `vuelve sobre sí mismo en el vértice ${((i + 1) % n) + 1}`;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // contiguos por el cierre
      if (distanciaEntreSegmentos(a, b, p[j]!, p[(j + 1) % n]!) <= eps) return `los lados ${i + 1} y ${j + 1} se cortan o se tocan`;
    }
  }
  return null;
}

/** Recorta el polígono convexo `s` (antihorario) por el convexo `c` (antihorario). */
function recortarConvexo(s: Vec2[], c: readonly Vec2[]): Vec2[] {
  let salida = s;
  for (let i = 0, n = c.length; i < n && salida.length; i++) {
    const a = c[i]!;
    const b = c[(i + 1) % n]!;
    const entrada = salida;
    salida = [];
    for (let k = 0, m = entrada.length; k < m; k++) {
      const P = entrada[k]!;
      const Q = entrada[(k + 1) % m]!;
      const dP = orient(a, b, P);
      const dQ = orient(a, b, Q);
      if (dP >= 0) salida.push(P);
      if ((dP >= 0 && dQ < 0) || (dP < 0 && dQ >= 0)) {
        const t = dP / (dP - dQ);
        salida.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]);
      }
    }
  }
  return salida;
}

/** Triángulos en abanico de un polígono desde O, cada uno antihorario y con su signo. */
function abanico(p: readonly Vec2[], O: Vec2): { t: Vec2[]; s: number }[] {
  const r: { t: Vec2[]; s: number }[] = [];
  for (let i = 0, n = p.length; i < n; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % n]!;
    const o = orient(O, a, b);
    if (o > 0) r.push({ t: [O, a, b], s: 1 });
    else if (o < 0) r.push({ t: [O, b, a], s: -1 });
  }
  return r;
}

const caja = (t: readonly Vec2[]) => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of t) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  return [x0, y0, x1, y1] as const;
};

/** ∫ de {1, x, y} sobre P ∩ Q, para dos polígonos simples (cualquier sentido). */
function momentosInterseccionPoligonos(P: readonly Vec2[], Q: readonly Vec2[], O: Vec2): Momentos {
  const sP = Math.sign(areaConSigno(P));
  const sQ = Math.sign(areaConSigno(Q));
  const r: Momentos = { A: 0, Sx: 0, Sy: 0 };
  const tq = abanico(Q, O).map((x) => ({ ...x, c: caja(x.t) }));
  for (const a of abanico(P, O)) {
    const ca = caja(a.t);
    for (const b of tq) {
      if (b.c[0] > ca[2] || b.c[2] < ca[0] || b.c[1] > ca[3] || b.c[3] < ca[1]) continue;
      const poli = recortarConvexo(a.t, b.t);
      if (poli.length < 3) continue;
      const m = momentosPoligono(poli);
      const s = sP * sQ * a.s * b.s;
      r.A += s * m.A;
      r.Sx += s * m.Sx;
      r.Sy += s * m.Sy;
    }
  }
  return r;
}

/** ∫ de {1, x, y} sobre la intersección de la región `r` con el polígono simple `z`. */
export function momentosInterseccion(r: Region, z: readonly Vec2[]): Momentos {
  // Origen: el centro de la caja de la zona (números pequeños en los triángulos del abanico)
  const [x0, y0, x1, y1] = caja(z);
  const O: Vec2 = [(x0 + x1) / 2, (y0 + y1) / 2];
  const m = momentosInterseccionPoligonos(r.contorno, z, O);
  for (const h of r.huecos) {
    const mh = momentosInterseccionPoligonos(h, z, O);
    m.A -= mh.A;
    m.Sx -= mh.Sx;
    m.Sy -= mh.Sy;
  }
  return m;
}

/** Integrales de {1, x, y, x·y} sobre una figura (C4: el reparto de las cargas de un paño). */
export interface Momentos2 {
  A: number;
  Sx: number;
  Sy: number;
  Sxy: number;
}

/** Integrales de {1, x, y, x·y} con signo sobre un polígono (teorema de Green). */
export function momentos2Poligono(p: readonly Vec2[]): Momentos2 {
  let A = 0;
  let Sx = 0;
  let Sy = 0;
  let Sxy = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const [x0, y0] = p[i]!;
    const [x1, y1] = p[(i + 1) % n]!;
    const c = x0 * y1 - x1 * y0;
    A += c;
    Sx += (x0 + x1) * c;
    Sy += (y0 + y1) * c;
    Sxy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c;
  }
  return { A: A / 2, Sx: Sx / 6, Sy: Sy / 6, Sxy: Sxy / 24 };
}

/**
 * Integrales de {1, x, y, x·y} sobre la intersección del polígono simple `z` (en cualquier sentido)
 * con el polígono convexo `c` (antihorario): los triángulos en abanico de z recortados por c.
 */
export function momentos2Interseccion(z: readonly Vec2[], c: readonly Vec2[]): Momentos2 {
  const [x0, y0, x1, y1] = caja(c);
  const O: Vec2 = [(x0 + x1) / 2, (y0 + y1) / 2];
  const s = Math.sign(areaConSigno(z));
  const r: Momentos2 = { A: 0, Sx: 0, Sy: 0, Sxy: 0 };
  for (const a of abanico(z, O)) {
    const ca = caja(a.t);
    if (ca[0] > x1 || ca[2] < x0 || ca[1] > y1 || ca[3] < y0) continue;
    const poli = recortarConvexo(a.t, c);
    if (poli.length < 3) continue;
    const m = momentos2Poligono(poli);
    const f = s * a.s;
    r.A += f * m.A;
    r.Sx += f * m.Sx;
    r.Sy += f * m.Sy;
    r.Sxy += f * m.Sxy;
  }
  return r;
}

/** Área de la intersección de dos regiones (para el solape de losas). */
export function areaInterseccionRegiones(a: Region, b: Region): number {
  let A = momentosInterseccion(a, b.contorno).A;
  for (const h of b.huecos) A -= momentosInterseccion(a, h).A;
  return A;
}

/**
 * Fracción del segmento ab que cae dentro de alguna de las regiones (en tantos por uno de su
 * longitud): se parte por sus cruces con los bordes y se mira el punto medio de cada trozo. Un
 * segmento entero dentro (sin cruces en su interior) da exactamente 1.
 */
export function fraccionEnRegiones(a: Vec2, b: Vec2, regiones: readonly Region[]): number {
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const ts = [0, 1];
  for (const r of regiones)
    for (const p of [r.contorno, ...r.huecos])
      for (let i = 0, n = p.length; i < n; i++) {
        const [c, e] = [p[i]!, p[(i + 1) % n]!];
        const f: Vec2 = [e[0] - c[0], e[1] - c[1]];
        const den = d[0] * f[1] - d[1] * f[0];
        if (den === 0) continue;
        const w: Vec2 = [c[0] - a[0], c[1] - a[1]];
        const t = (w[0] * f[1] - w[1] * f[0]) / den;
        const u = (w[0] * d[1] - w[1] * d[0]) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
      }
  ts.sort((x, y) => x - y);
  let s = 0;
  for (let i = 0; i + 1 < ts.length; i++) {
    const [t0, t1] = [ts[i]!, ts[i + 1]!];
    if (!(t1 > t0)) continue;
    const m: Vec2 = [a[0] + ((t0 + t1) / 2) * d[0], a[1] + ((t0 + t1) / 2) * d[1]];
    if (regiones.some((r) => puntoEnRegion(m, r))) s += t1 - t0;
  }
  return s;
}

/** Jacobiano escalado mínimo de un cuadrilátero bilineal en sus 4 puntos de Gauss. */
export function jacobianoEscalado(X: readonly Vec2[]): number {
  const g = 1 / Math.sqrt(3);
  const xi = [-1, 1, 1, -1];
  const eta = [-1, -1, 1, 1];
  let min = Infinity;
  for (const [a, b] of [
    [-g, -g],
    [g, -g],
    [g, g],
    [-g, g],
  ] as const) {
    let xx = 0;
    let xy = 0;
    let ex = 0;
    let ey = 0;
    for (let i = 0; i < 4; i++) {
      const dxi = (xi[i]! * (1 + b * eta[i]!)) / 4;
      const deta = (eta[i]! * (1 + a * xi[i]!)) / 4;
      xx += dxi * X[i]![0];
      xy += dxi * X[i]![1];
      ex += deta * X[i]![0];
      ey += deta * X[i]![1];
    }
    const det = xx * ey - ex * xy;
    min = Math.min(min, det / (Math.sqrt(xx * xx + xy * xy) * Math.sqrt(ex * ex + ey * ey)));
  }
  return min;
}

/**
 * Lo que queda de la región `r` dentro del polígono convexo `c` (cualquier sentido), en anillos para
 * rellenar con la regla par-impar: cada anillo de `r` recortado por `c` (Sutherland–Hodgman). Si la
 * región no es convexa, sus trozos pueden quedar unidos por puentes de área nula sobre el borde de
 * `c`: no cambian el relleno, pero no se deben trazar. null si `c` no es convexo.
 */
export function recorteRegionConvexo(r: Region, c: readonly Vec2[]): Vec2[][] | null {
  let signo = 0;
  for (let i = 0, n = c.length; i < n; i++) {
    const o = orient(c[i]!, c[(i + 1) % n]!, c[(i + 2) % n]!);
    if (o === 0) continue;
    if (signo !== 0 && Math.sign(o) !== signo) return null;
    signo = Math.sign(o);
  }
  if (signo === 0) return [];
  const cc = signo > 0 ? c : [...c].reverse();
  return [r.contorno, ...r.huecos].map((p) => recortarConvexo([...p], cc)).filter((p) => p.length >= 3 && areaConSigno(p) !== 0);
}

/**
 * Los trozos del segmento ab en los que `dentro` es cierto, partido por los lados de `poligonos`
 * (se mira el punto medio de cada trozo; los contiguos se unen).
 */
export function trozosSegmento(a: Vec2, b: Vec2, poligonos: readonly (readonly Vec2[])[], dentro: (q: Vec2) => boolean): [Vec2, Vec2][] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const ts = [0, 1];
  for (const p of poligonos)
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const c = p[j]!;
      const ex = p[i]![0] - c[0];
      const ey = p[i]![1] - c[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-14) continue;
      const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den;
      const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
  ts.sort((x, y) => x - y);
  const P = (t: number): Vec2 => [a[0] + t * dx, a[1] + t * dy];
  const r: [number, number][] = [];
  for (let k = 0; k + 1 < ts.length; k++) {
    const [t0, t1] = [ts[k]!, ts[k + 1]!];
    if (t1 - t0 < 1e-9 || !dentro(P((t0 + t1) / 2))) continue;
    const u = r[r.length - 1];
    if (u && Math.abs(u[1] - t0) < 1e-9) u[1] = t1;
    else r.push([t0, t1]);
  }
  return r.map(([t0, t1]) => [P(t0), P(t1)]);
}
