/**
 * Cotas temporales al poner un pilar (CT1, `docs/fem3d/cotas.md` §2.1): desde el punto que se va a
 * colocar, la distancia a la referencia más cercana a cada lado, en las dos direcciones de los ejes
 * de la planta (`IndiceEnganches.direccion`: d y n = d girado 90°; sin girar, X e Y).
 *
 * - **Referencias:** las rectas de los ejes de replanteo (los del modelo o los propuestos) paralelos a
 *   d o a n, y el punto fijo de los pilares que llegan o arrancan en la planta. Las de un mismo valor
 *   (a ≤ 1e-6 m) son una sola, con el nombre del eje si lo hay.
 * - **Lados:** izquierda y derecha van por s = p·d (la referencia es una recta paralela a n); abajo y
 *   arriba, por t = p·n.
 * - **Fijar** una cota es dar su distancia: la coordenada de esa dirección pasa a ser la de la
 *   referencia más (o menos) el valor, y la otra sigue al cursor. La suma se limpia del ruido de coma
 *   flotante (`limpio`): con ejes paralelos a X o a Y, 3 + 2,4 da el 5,4 que daría la tabla.
 * - Con d paralelo a X o a Y, pasar al marco (s, t) y volver es exacto, bit a bit; si no, sólo se
 *   mueve el punto lo que cambia la coordenada fijada.
 *
 * Puro: sin IO, sin React ni DOM.
 */
import { ejesDe } from "../../compilador/ejes.ts";
import type { ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import { rotuloCota } from "../../agente/render/ejes.ts";
import { PlantaFisica } from "../../agente/render/modelo.ts";
import { unitario, type IndiceEnganches } from "./enganches.ts";

export type Lado = "izquierda" | "derecha" | "abajo" | "arriba";

/** El orden de Tab. */
export const LADOS: readonly Lado[] = ["izquierda", "derecha", "abajo", "arriba"];

/** Una recta de referencia: s = valor (izquierda y derecha) o t = valor (abajo y arriba). */
export interface Referencia {
  valor: number;
  /** «eje 2», «P5»… */
  nombre: string;
  /** De dónde sale: los puntos de los pilares y los extremos de los ejes (para la línea de referencia). */
  origenes: { puntos: Vec2[]; segmentos: [Vec2, Vec2][] };
}

export interface ReferenciasCotas {
  d: Vec2;
  n: Vec2;
  /** Ordenadas por valor. */
  s: Referencia[];
  t: Referencia[];
}

/** Una cota fijada: su lado, la referencia de cuando se fijó y la distancia. */
export interface Fijo {
  lado: Lado;
  ref: Referencia;
  valor: number;
}

export interface CotaTemporal {
  lado: Lado;
  ref: Referencia;
  distancia: number;
  /** De la referencia (a) al punto (b). */
  a: Vec2;
  b: Vec2;
  /** La línea de referencia, del origen más cercano a `a`, o null si `a` ya está en él. */
  extension: [Vec2, Vec2] | null;
  fija: boolean;
  activa: boolean;
  texto: string;
}

/** Por debajo de esto, dos referencias son la misma y el punto está en ella, m. */
const IGUAL = 1e-6;

const enS = (l: Lado) => l === "izquierda" || l === "derecha";
/** El signo de la distancia: la referencia de la izquierda (o de abajo) queda por debajo del punto. */
const signo = (l: Lado) => (l === "izquierda" || l === "abajo" ? 1 : -1);

const dot = (p: Vec2, v: Vec2) => p[0] * v[0] + p[1] * v[1];

/** Las coordenadas (s, t) de p. */
export const aMarco = (R: ReferenciasCotas, p: Vec2): Vec2 => [dot(p, R.d), dot(p, R.n)];

const alineado = (R: ReferenciasCotas) => R.d[0] === 0 || R.d[1] === 0;

/**
 * x sin el ruido de una suma: el decimal de 6 cifras más cercano si está a menos de 1e-9; si no, x.
 * `entero / 1e6` es el double más cercano a ese decimal, el mismo que da leerlo de una tabla.
 */
export function limpio(x: number): number {
  const r = Math.round(x * 1e6) / 1e6;
  return Math.abs(r - x) < 1e-9 ? r + 0 : x;
}

function agrupar(xs: { valor: number; nombre: string; eje: boolean; puntos: Vec2[]; segmentos: [Vec2, Vec2][] }[]): Referencia[] {
  xs.sort((a, b) => a.valor - b.valor || (a.eje === b.eje ? 0 : a.eje ? -1 : 1) || (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));
  const r: (Referencia & { eje: boolean })[] = [];
  for (const x of xs) {
    const u = r[r.length - 1];
    if (u && x.valor - u.valor <= IGUAL) {
      u.origenes.puntos.push(...x.puntos);
      u.origenes.segmentos.push(...x.segmentos);
      // El eje da el nombre y el valor
      if (x.eje && !u.eje) Object.assign(u, { valor: x.valor, nombre: x.nombre, eje: true });
      continue;
    }
    r.push({ valor: x.valor, nombre: x.nombre, eje: x.eje, origenes: { puntos: [...x.puntos], segmentos: [...x.segmentos] } });
  }
  return r.map(({ valor, nombre, origenes }) => ({ valor, nombre, origenes }));
}

/**
 * Las referencias de la planta, en el marco de los ejes de dirección `direccion` (grados). Con `sin`,
 * sin ese pilar (CT3: las cotas de un pilar elegido no se miden a él mismo, ni a los ejes propuestos
 * que pasan por él).
 */
export function referenciasCotas(m0: ModeloFisico, planta: string, direccion: number, sin?: string): ReferenciasCotas {
  const m = sin === undefined ? m0 : { ...m0, pilares: (m0.pilares ?? []).filter((p) => p.id !== sin) };
  const d = unitario(direccion);
  const n: Vec2 = [-d[1] + 0, d[0]];
  const R0 = { d, n, s: [], t: [] };
  const s: Parameters<typeof agrupar>[0] = [];
  const t: Parameters<typeof agrupar>[0] = [];
  for (const e of ejesDe(m).ejes) {
    const v: Vec2 = [e.hasta[0] - e.desde[0], e.hasta[1] - e.desde[1]];
    const l = Math.hypot(v[0], v[1]);
    if (!(l > 0) || !Number.isFinite(l)) continue;
    const nombre = `eje ${e.nombre ?? e.id}`;
    const x = { nombre, eje: true, puntos: [], segmentos: [[e.desde, e.hasta] as [Vec2, Vec2]] };
    // Paralelo a n: s constante; paralelo a d: t constante
    if (Math.abs(dot(v, d)) <= 1e-9 * l) s.push({ ...x, valor: aMarco(R0, e.desde)[0] });
    else if (Math.abs(dot(v, n)) <= 1e-9 * l) t.push({ ...x, valor: aMarco(R0, e.desde)[1] });
  }
  for (const { p } of new PlantaFisica(m, planta).pilares()) {
    const q: Vec2 = [p.x, p.y];
    if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) continue;
    const [a, b] = aMarco(R0, q);
    s.push({ valor: a, nombre: p.id, eje: false, puntos: [q], segmentos: [] });
    t.push({ valor: b, nombre: p.id, eje: false, puntos: [q], segmentos: [] });
  }
  return { d, n, s: agrupar(s), t: agrupar(t) };
}

const cache = new WeakMap<IndiceEnganches, ReferenciasCotas>();

/** Las referencias de la planta de un índice (se rehacen con él, cuando cambia el modelo). */
export function referenciasDe(m: ModeloFisico, ix: IndiceEnganches): ReferenciasCotas {
  let r = cache.get(ix);
  if (!r) {
    r = referenciasCotas(m, ix.planta, ix.direccion);
    cache.set(ix, r);
  }
  return r;
}

/** El punto con las coordenadas (s, t); con ejes paralelos a X o a Y, exacto. */
function deMarco(R: ReferenciasCotas, p: Vec2, s: number, t: number): Vec2 {
  if (alineado(R)) return [s * R.d[0] + t * R.n[0], s * R.d[1] + t * R.n[1]];
  const [s0, t0] = aMarco(R, p);
  const [ds, dt] = [s - s0, t - t0];
  return [p[0] + ds * R.d[0] + dt * R.n[0], p[1] + ds * R.d[1] + dt * R.n[1]];
}

/** La coordenada que da una cota fijada. */
const coordenada = (f: Fijo) => limpio(f.ref.valor + signo(f.lado) * f.valor);

/** p con las coordenadas de lo fijado (a lo sumo una por dirección). Sin nada fijado, p tal cual. */
export function colocar(R: ReferenciasCotas, p: Vec2, fijos: readonly Fijo[] | undefined): Vec2 {
  if (!fijos?.length) return p;
  let [s, t] = aMarco(R, p);
  for (const f of fijos) {
    if (enS(f.lado)) s = coordenada(f);
    else t = coordenada(f);
  }
  return deMarco(R, p, s, t);
}

/** La referencia más cercana del lado `lado` de p, o null. */
export function referenciaEn(R: ReferenciasCotas, p: Vec2, lado: Lado): Referencia | null {
  const [s, t] = aMarco(R, p);
  const [refs, v] = enS(lado) ? [R.s, s] : [R.t, t];
  if (signo(lado) > 0) {
    for (let i = refs.length - 1; i >= 0; i--) if (refs[i]!.valor < v - IGUAL) return refs[i]!;
  } else for (const r of refs) if (r.valor > v + IGUAL) return r;
  return null;
}

function masCercano(q: Vec2, o: Referencia["origenes"]): Vec2 | null {
  let mejor: Vec2 | null = null;
  let dm = Infinity;
  const proponer = (p: Vec2) => {
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < dm) [mejor, dm] = [p, d];
  };
  for (const p of o.puntos) proponer(p);
  for (const [a, b] of o.segmentos) {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const k = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    proponer([a[0] + k * dx, a[1] + k * dy]);
  }
  return dm > IGUAL ? mejor : null;
}

/**
 * Las cotas del punto p (ya colocado con lo fijado): en una dirección fijada, la fijada y la del otro
 * lado (lo que queda hasta la siguiente referencia); en una libre, la más cercana a cada lado.
 */
export function cotasEn(R: ReferenciasCotas, p: Vec2, fijos: readonly Fijo[] = [], activa?: Lado): CotaTemporal[] {
  const [s, t] = aMarco(R, p);
  const r: CotaTemporal[] = [];
  for (const lado of LADOS) {
    const f = fijos.find((x) => x.lado === lado);
    const ref = f ? f.ref : referenciaEn(R, p, lado);
    if (!ref) continue;
    const a = enS(lado) ? deMarco(R, p, ref.valor, t) : deMarco(R, p, s, ref.valor);
    const distancia = f ? f.valor : Math.abs((enS(lado) ? s : t) - ref.valor);
    const o = masCercano(a, ref.origenes);
    r.push({ lado, ref, distancia, a, b: p, extension: o ? [o, a] : null, fija: !!f, activa: lado === activa, texto: rotuloCota(distancia) });
  }
  return r;
}

/** Los lados con cota en p, en el orden de Tab. */
export const ladosEn = (R: ReferenciasCotas, p: Vec2, fijos: readonly Fijo[] = []): Lado[] => cotasEn(R, p, fijos).map((c) => c.lado);

/** Lo que dice la barra de una cota: «izquierda, a eje 2». */
export const nombreCota = (c: { lado: Lado; ref: Referencia }) => `${c.lado}, desde ${c.ref.nombre}`;
