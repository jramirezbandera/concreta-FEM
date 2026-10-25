/**
 * Ejes de replanteo propuestos (I2, `docs/fem3d/interfaz.md` §9 y §14): sin `ejes` en el modelo, el
 * dibujo usa estos. Son una propuesta, como las bandas (D5): el usuario la guarda en el modelo y la
 * cambia si quiere. No entran en el cálculo ni en la huella.
 *
 * 1. Dirección: la del eje 1 de las losas (la de más área si hay varias, módulo 90°; con un empate,
 *    el menor ángulo), o la de las viguetas de los paños si no hay losas, o X. d = (cos θ, sin θ) y
 *    n = (−sin θ, cos θ).
 * 2. Los pilares (una vez cada posición) se agrupan en alineaciones como las bandas (C5-b,
 *    `alineaciones`): dos consecutivos a ≤ τ son de la misma, y una alineación necesita ≥ 2.
 *    - Las rectas paralelas a n, agrupadas por s = p·d, se numeran 1, 2… de menor a mayor s.
 *    - Las paralelas a d, agrupadas por t = p·n, se nombran A, B… de menor a mayor t.
 *    Cada recta pasa por la media de sus pilares. Si una dirección no tiene ninguna alineación (un
 *    pórtico: una sola fila de pilares), cada pilar da la suya.
 * 3. Cada eje va de lado a lado de todos los pilares, con MARGEN_EJES de más por cada extremo, para
 *    que sus burbujas queden fuera de la estructura.
 * 4. Un id que ya usa otro objeto del modelo pasa a `eje-<id>`, con el nombre de siempre.
 *
 * Puro: sin IO.
 */
import { alineaciones } from "./bandas.ts";
import { resolverOpciones, type EjeReplanteo, type ModeloFisico, type OpcionesCompilacion, type Vec2 } from "./fisico.ts";

/** Lo que sobresale cada eje propuesto de los pilares extremos, m. */
export const MARGEN_EJES = 2;

export interface PropuestaEjes {
  ejes: EjeReplanteo[];
  /** Por eje, lo que se separa de su recta el pilar más alejado de ella, m (CT1). */
  dispersion: number[];
  /** Dirección de los ejes con letra, grados desde +X. */
  direccion: number;
}

/** Área de un polígono (valor absoluto). */
function area(p: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j]![0] - p[i]![0]) * (p[j]![1] + p[i]![1]);
  return Math.abs(a / 2);
}

/** Dirección de los ejes (paso 1), en [0°, 90°). */
export function direccionEjes(f: ModeloFisico): number {
  const pesos = new Map<number, number>();
  const sumar = (grados: number, peso: number) => {
    if (!Number.isFinite(grados)) return;
    const g = Math.round((((grados % 90) + 90) % 90) * 1e6) / 1e6;
    const k = g === 90 ? 0 : g;
    pesos.set(k, (pesos.get(k) ?? 0) + peso);
  };
  for (const l of f.losas ?? []) sumar(l.eje1 ?? 0, area(l.contorno));
  if (!pesos.size) for (const p of f.panos ?? []) sumar(p.direccion, area(p.contorno));
  let mejor = 0;
  let peso = -Infinity;
  for (const [g, w] of pesos) if (w > peso + 1e-9 || (Math.abs(w - peso) <= 1e-9 && g < mejor)) [mejor, peso] = [g, w];
  return mejor;
}

/** Letras de un índice: A…Z, AA, AB… */
export function letraEje(i: number): string {
  let s = "";
  for (let k = i + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

export function proponerEjes(f: ModeloFisico, opciones: OpcionesCompilacion = {}): PropuestaEjes {
  const theta = direccionEjes(f);
  const rad = (theta * Math.PI) / 180;
  const d: Vec2 = [Math.cos(rad), Math.sin(rad)];
  const n: Vec2 = [-d[1], d[0]];
  // Cada posición una vez (un pilar sobre otro, en otra planta, es la misma alineación)
  const vistos = new Map<string, { id: string; p: Vec2 }>();
  for (const p of f.pilares ?? []) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const k = `${r6(p.x)} ${r6(p.y)}`;
    const ya = vistos.get(k);
    if (!ya || p.id < ya.id) vistos.set(k, { id: p.id, p: [p.x, p.y] });
  }
  const pilares = [...vistos.values()];
  if (pilares.length < 2) return { ejes: [], dispersion: [], direccion: theta };
  const eps = resolverOpciones(opciones).epsSnap;
  const s = pilares.map((q) => q.p[0] * d[0] + q.p[1] * d[1]);
  const t = pilares.map((q) => q.p[0] * n[0] + q.p[1] * n[1]);
  const [s0, s1] = [Math.min(...s) - MARGEN_EJES, Math.max(...s) + MARGEN_EJES];
  const [t0, t1] = [Math.min(...t) - MARGEN_EJES, Math.max(...t) + MARGEN_EJES];
  const punto = (a: number, b: number): Vec2 => [r6(a * d[0] + b * n[0]), r6(a * d[1] + b * n[1])];
  const media = (g: { t: number }[]) => g.reduce((x, q) => x + q.t, 0) / g.length;

  const ocupados = new Set<string>();
  for (const k of ["plantas", "materiales", "secciones", "pilares", "vigas", "apoyos", "casos", "cargas", "losas", "apoyosLineales", "bandas", "muros", "panos"] as const) for (const o of (f[k] ?? []) as readonly { id: string }[]) ocupados.add(o.id);
  const eje = (nombre: string, desde: Vec2, hasta: Vec2): EjeReplanteo => (ocupados.has(nombre) ? { id: `eje-${nombre}`, nombre, desde, hasta } : { id: nombre, desde, hasta });

  const ejes: EjeReplanteo[] = [];
  const dispersion: number[] = [];
  const separacion = (g: { t: number }[], m: number) => Math.max(...g.map((q) => Math.abs(q.t - m)));
  // Paralelos a n, por s (en `alineaciones`, la coordenada transversal es la de su segundo vector)
  const grupos = (a: Vec2, b: Vec2) => {
    const g = alineaciones(pilares, a, b, eps);
    return g.length ? g : alineaciones(pilares, a, b, eps, 1);
  };
  grupos(n, d).forEach((g, i) => {
    const sm = media(g);
    ejes.push(eje(String(i + 1), punto(sm, t0), punto(sm, t1)));
    dispersion.push(separacion(g, sm));
  });
  // Paralelos a d, por t
  grupos(d, n).forEach((g, i) => {
    const tm = media(g);
    ejes.push(eje(letraEje(i), punto(s0, tm), punto(s1, tm)));
    dispersion.push(separacion(g, tm));
  });
  return { ejes, dispersion, direccion: theta };
}

/** Los ejes que se dibujan: los del modelo o, si no tiene, los propuestos. */
export function ejesDe(f: ModeloFisico, opciones: OpcionesCompilacion = {}): { ejes: readonly EjeReplanteo[]; propuestos: boolean; dispersion?: readonly number[] } {
  if (f.ejes) return { ejes: f.ejes, propuestos: false };
  const { ejes, dispersion } = proponerEjes(f, opciones);
  return { ejes, propuestos: true, dispersion };
}
