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
