/**
 * «Renumerar» como en CYPECAD (I-g, `docs/fem3d/interfaz.md` §12.1): ids cortos por su posición en
 * planta.
 *
 * - Pilares, `P1…Pn`: por filas de arriba abajo y, en cada fila, de izquierda a derecha. Las filas
 *   son las alineaciones de los ejes de replanteo (`alineaciones`, C5-b, con la dirección de
 *   `direccionEjes`): «arriba» es +n y «a la derecha», +d. Varios pilares en el mismo punto (uno
 *   sobre otro), del de más abajo al de más arriba.
 * - Vigas, `V1…`: por plantas de abajo arriba y, en cada planta, por la misma regla con el punto
 *   medio de cada una (a mitad de su longitud).
 * - Losas (`L`), paños (`F`) y muros (`M`): igual, con el centroide de la losa o del paño y el punto
 *   medio del eje del muro (en la planta de su base).
 *
 * Un número que ya es el id de otro objeto que no se renumera (un material «M1»…) se salta. El
 * `nombre` de cada objeto no se toca. La lista de pilares queda además en ese orden, P1…Pn, para que
 * las tablas se lean así (decisión del usuario tras V2c-1); las demás listas no se reordenan. Ni el
 * orden de los pilares ni el de las demás listas cambia la huella ni el modelo analítico.
 *
 * Nunca se aplica solo: cambia la huella y los resultados guardados dejan de valer.
 *
 * Puro: sin IO, sin React ni DOM.
 */
import { alineaciones } from "../compilador/bandas.ts";
import { direccionEjes } from "../compilador/ejes.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion, type Vec2 } from "../compilador/fisico.ts";
import { COLECCIONES, conValor, lista, referenciasDe } from "./referencias.ts";

export const RENUMERABLES = ["pilares", "vigas", "losas", "panos", "muros"] as const;
export type Renumerable = (typeof RENUMERABLES)[number];

export const PREFIJOS: Readonly<Record<Renumerable, string>> = { pilares: "P", vigas: "V", losas: "L", panos: "F", muros: "M" };

/** Punto a mitad de la longitud de una polilínea. */
function puntoMedio(p: readonly Vec2[]): Vec2 {
  const l = p.slice(1).map((q, i) => Math.hypot(q[0] - p[i]![0], q[1] - p[i]![1]));
  let s = l.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < l.length; i++) {
    if (s <= l[i]! || i === l.length - 1) {
      const u = l[i]! > 0 ? Math.min(1, s / l[i]!) : 0;
      return [p[i]![0] + u * (p[i + 1]![0] - p[i]![0]), p[i]![1] + u * (p[i + 1]![1] - p[i]![1])];
    }
    s -= l[i]!;
  }
  return p[0] ?? [0, 0];
}

/** Centroide de un polígono (el de sus vértices si no tiene área). */
function centroide(p: readonly Vec2[]): Vec2 {
  let [a, cx, cy] = [0, 0, 0];
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const c = p[j]![0] * p[i]![1] - p[i]![0] * p[j]![1];
    a += c;
    cx += (p[j]![0] + p[i]![0]) * c;
    cy += (p[j]![1] + p[i]![1]) * c;
  }
  if (Math.abs(a) > 1e-12) return [cx / (3 * a), cy / (3 * a)];
  return [p.reduce((s, q) => s + q[0], 0) / (p.length || 1), p.reduce((s, q) => s + q[1], 0) / (p.length || 1)];
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/**
 * Ordena por filas (de arriba abajo, cada una de izquierda a derecha) unos objetos con su punto en
 * planta. Los que caen en el mismo punto conservan el orden en que vienen.
 */
function porFilas(objs: readonly { id: string; p: Vec2 }[], d: Vec2, n: Vec2, eps: number): string[] {
  const enPunto = new Map<string, string[]>();
  const puntos: { id: string; p: Vec2 }[] = [];
  for (const o of objs) {
    if (!Number.isFinite(o.p[0]) || !Number.isFinite(o.p[1])) continue;
    const k = `${r6(o.p[0])} ${r6(o.p[1])}`;
    const ya = enPunto.get(k);
    if (ya) ya.push(o.id);
    else {
      enPunto.set(k, [o.id]);
      // El id del punto, para `alineaciones`: su orden de llegada (un desempate que no depende de los ids)
      puntos.push({ id: k, p: o.p });
    }
  }
  if (!puntos.length) return [];
  const orden = new Map(puntos.map((q, i) => [q.id, String(i).padStart(9, "0")]));
  const filas = alineaciones(
    puntos.map((q) => ({ id: orden.get(q.id)!, p: q.p })),
    d,
    n,
    eps,
    1,
  );
  const clave = new Map([...orden].map(([k, v]) => [v, k]));
  return filas.reverse().flatMap((f) => f.flatMap((q) => enPunto.get(clave.get(q.id)!)!));
}

/** El orden de cada colección renumerable: el de los números nuevos. */
function ordenes(m: ModeloFisico, opciones: OpcionesCompilacion): Record<Renumerable, () => string[]> {
  const theta = (direccionEjes(m) * Math.PI) / 180;
  const d: Vec2 = [Math.cos(theta), Math.sin(theta)];
  const n: Vec2 = [-d[1], d[0]];
  const eps = resolverOpciones(opciones).epsSnap;
  // Plantas de abajo arriba (el modelo las da de arriba abajo)
  const plantas = (m.plantas ?? []).map((p) => p.id).reverse();
  const nivel = new Map(plantas.map((p, i) => [p, i]));
  const porPlanta = <T extends { id: string }>(objs: readonly T[], planta: (o: T) => string, punto: (o: T) => Vec2): string[] => {
    const r: string[] = [];
    for (const p of plantas)
      r.push(
        ...porFilas(
          objs.filter((o) => planta(o) === p).map((o) => ({ id: o.id, p: punto(o) })),
          d,
          n,
          eps,
        ),
      );
    // Lo que no está en ninguna planta del modelo (no compila), al final y en su orden
    const vistos = new Set(r);
    return [...r, ...objs.filter((o) => !vistos.has(o.id)).map((o) => o.id)];
  };

  return {
    pilares: () => {
      const ps = [...(m.pilares ?? [])].map((p, i) => ({ p, i })).sort((a, b) => (nivel.get(a.p.desde) ?? -1) - (nivel.get(b.p.desde) ?? -1) || a.i - b.i);
      const r = porFilas(
        ps.map(({ p }) => ({ id: p.id, p: [p.x, p.y] as Vec2 })),
        d,
        n,
        eps,
      );
      const vistos = new Set(r);
      return [...r, ...ps.filter(({ p }) => !vistos.has(p.id)).map(({ p }) => p.id)];
    },
    vigas: () => porPlanta(m.vigas ?? [], (v) => v.planta, (v) => puntoMedio(v.puntos)),
    losas: () => porPlanta(m.losas ?? [], (l) => l.planta, (l) => centroide(l.contorno)),
    panos: () => porPlanta(m.panos ?? [], (p) => p.planta, (p) => centroide(p.contorno)),
    muros: () => porPlanta(m.muros ?? [], (x) => x.desde, (x) => puntoMedio(x.puntos)),
  };
}

/** Los ids nuevos de los objetos de `colecciones` (sólo los que cambian). */
export function propuestaRenumerar(m: ModeloFisico, colecciones: readonly Renumerable[] = RENUMERABLES, opciones: OpcionesCompilacion = {}): Map<string, string> {
  const orden = ordenes(m, opciones);
  const cambian = new Set<string>();
  for (const c of colecciones) for (const o of lista(m, c)) cambian.add(o.id);
  // Los ids de lo que no se renumera no se pueden usar
  const ocupados = new Set<string>();
  for (const c of COLECCIONES) for (const o of lista(m, c)) if (!cambian.has(o.id)) ocupados.add(o.id);
  const r = new Map<string, string>();
  for (const c of colecciones) {
    let k = 0;
    for (const id of orden[c]()) {
      let nuevo: string;
      do nuevo = `${PREFIJOS[c]}${++k}`;
      while (ocupados.has(nuevo));
      if (nuevo !== id) r.set(id, nuevo);
    }
  }
  return r;
}

/**
 * «Renumerar» entero: los ids de `propuestaRenumerar` y, si se renumeran los pilares, su lista en el
 * orden de los números nuevos. `reordena` dice si cambia el orden de la lista (aunque no cambie
 * ningún id).
 */
export function renumerar(
  m: ModeloFisico,
  colecciones: readonly Renumerable[] = RENUMERABLES,
  opciones: OpcionesCompilacion = {},
): { modelo: ModeloFisico; mapa: Map<string, string>; reordena: boolean } {
  const mapa = propuestaRenumerar(m, colecciones, opciones);
  let r = m;
  let reordena = false;
  if (colecciones.includes("pilares") && m.pilares?.length) {
    const pos = new Map(ordenes(m, opciones).pilares().map((id, i) => [id, i]));
    const ps = [...m.pilares].sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity));
    reordena = ps.some((p, i) => p !== m.pilares![i]);
    if (reordena) r = { ...m, pilares: ps };
  }
  return { modelo: renombrarIds(r, mapa), mapa, reordena };
}

/** El modelo con los ids de `mapa` cambiados, en los objetos y en todas sus referencias. */
export function renombrarIds(m: ModeloFisico, mapa: ReadonlyMap<string, string>): ModeloFisico {
  if (!mapa.size) return m;
  let r = m;
  for (const c of COLECCIONES) {
    const l = lista(r, c);
    let cambio = false;
    const nl = l.map((o) => {
      let x = o;
      for (const ref of referenciasDe(c, o)) {
        const v = mapa.get(ref.id);
        if (v !== undefined) x = conValor(x, ref.ruta, v);
      }
      const v = mapa.get(o.id);
      if (v !== undefined) x = { ...x, id: v };
      if (x !== o) cambio = true;
      return x;
    });
    if (cambio) r = { ...r, [c]: nl } as ModeloFisico;
  }
  return r;
}
