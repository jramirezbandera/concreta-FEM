/**
 * La plantilla DXF de una planta (V2c-4, `docs/fem3d/dibujo.md` §10): las unidades y la colocación
 * de un DXF leído (`src/dxf/`), su geometría en el modelo y el índice con el que se engancha.
 *
 * - Unidades: las de `$INSUNITS` si dan un tamaño de edificio (de 3 a 500 m); si no, la primera que
 *   lo dé de m, mm y cm (el DXF de la vivienda dice mm y está en m). mm y cm se pasan a m dividiendo,
 *   así que salen los doubles de teclear el número en m.
 * - Colocación: p = traslación + R(giro) · p_dxf. Sin giro ni traslación, los doubles del DXF tal
 *   cual. Al importar, un DXF a más de 1 km del origen se trae con su esquina al origen (al metro).
 * - Lo enganchado de la plantilla se redondea (V2c4-c, `redondeo`, 1 mm por defecto); lo hace
 *   `enganchar` (`enganches.ts`) con `redondear`.
 * - Índice: celdas cuadradas con los segmentos que las atraviesan (recorrido de Amanatides y Woo) y
 *   los puntos que caen en ellas. `cerca` da lo que hay a ≤ r de un punto sin mirar el resto.
 *
 * Puro: sin IO, sin React ni DOM.
 */
import type { PlantillaDxf } from "../../agente/proyecto.ts";
import type { Vec2 } from "../../compilador/fisico.ts";
import { cosSin, TIPOS_PUNTO_DXF, type DibujoDxf, type TipoPuntoDxf } from "../../dxf/aplanar.ts";

export type UnidadDxf = PlantillaDxf["unidades"];

/** Cada unidad: su nombre, su `$INSUNITS` y el paso a m. */
export const UNIDADES: Readonly<Record<UnidadDxf, { nombre: string; insunits: number; aM: (x: number) => number }>> = {
  m: { nombre: "metros", insunits: 6, aM: (x) => x },
  cm: { nombre: "centímetros", insunits: 5, aM: (x) => x / 100 },
  mm: { nombre: "milímetros", insunits: 4, aM: (x) => x / 1000 },
  in: { nombre: "pulgadas", insunits: 1, aM: (x) => x * 0.0254 },
  ft: { nombre: "pies", insunits: 2, aM: (x) => x * 0.3048 },
};

/** Un tamaño de edificio, m: lo que hace creíbles unas unidades. */
const TAMANO_CREIBLE: readonly [number, number] = [3, 500];
/** Más lejos del origen que esto, m, el DXF se trae al importarlo. */
export const LEJOS_DEL_ORIGEN = 1000;

const tamano = (d: DibujoDxf): number => (d.extension ? Math.max(d.extension[2] - d.extension[0], d.extension[3] - d.extension[1]) : 0);

/** Las unidades que se proponen para un DXF. */
export function proponerUnidades(d: DibujoDxf): UnidadDxf {
  const s = tamano(d);
  const creible = (u: UnidadDxf) => {
    const x = UNIDADES[u].aM(s);
    return x >= TAMANO_CREIBLE[0] && x <= TAMANO_CREIBLE[1];
  };
  const dice = (Object.keys(UNIDADES) as UnidadDxf[]).find((u) => UNIDADES[u].insunits === d.insunits);
  if (dice && creible(dice)) return dice;
  return (["m", "mm", "cm"] as const).find(creible) ?? dice ?? "m";
}

/** Si `$INSUNITS` dice otras unidades que las propuestas (para avisar). */
export function insunitsDistintas(d: DibujoDxf, u: UnidadDxf): string | null {
  const dice = (Object.keys(UNIDADES) as UnidadDxf[]).find((x) => UNIDADES[x].insunits === d.insunits);
  return dice && dice !== u ? dice : null;
}

/** La traslación con la que se importa: la esquina al origen si el DXF está lejos; si no, ninguna. */
export function traslacionInicial(d: DibujoDxf, u: UnidadDxf): [number, number] | undefined {
  if (!d.extension) return undefined;
  const f = UNIDADES[u].aM;
  const [x0, y0] = [f(d.extension[0]), f(d.extension[1])];
  if (Math.hypot(x0, y0) <= LEJOS_DEL_ORIGEN) return undefined;
  return [-Math.floor(x0), -Math.floor(y0)];
}

/** Las capas que empiezan ocultas: las apagadas o congeladas del DXF y la de los puntos de definición de las cotas. */
export const ocultasIniciales = (d: DibujoDxf): string[] => d.capas.filter((c) => c.oculta || c.nombre.toLowerCase() === "defpoints").map((c) => c.nombre);

/** Una plantilla nueva para un DXF leído, en una planta. */
export function nuevaPlantilla(d: DibujoDxf, o: { nombre: string; fichero: string; sha256: string; planta: string }): PlantillaDxf {
  const unidades = proponerUnidades(d);
  const traslacion = traslacionInicial(d, unidades);
  const ocultas = ocultasIniciales(d);
  return {
    nombre: o.nombre,
    fichero: o.fichero,
    sha256: o.sha256,
    unidades,
    ...(traslacion ? { traslacion } : {}),
    plantas: [o.planta],
    ...(ocultas.length ? { ocultas } : {}),
  };
}

// ─── Colocar ────────────────────────────────────────────────────────────────────────────────────

/** El paso de un punto del DXF al modelo. */
export function transformacion(t: PlantillaDxf): (x: number, y: number) => Vec2 {
  const f = UNIDADES[t.unidades].aM;
  const [tx, ty] = t.traslacion ?? [0, 0];
  const g = t.giro ?? 0;
  if (g === 0) return tx === 0 && ty === 0 ? (x, y) => [f(x), f(y)] : (x, y) => [f(x) + tx, f(y) + ty];
  const [c, s] = cosSin(g);
  return (x, y) => {
    const X = f(x);
    const Y = f(y);
    return [c * X - s * Y + tx, s * X + c * Y + ty];
  };
}

/** La plantilla movida de modo que su punto a (en el modelo) vaya a b. */
export function moverPlantilla(t: PlantillaDxf, a: Vec2, b: Vec2): PlantillaDxf {
  const [tx, ty] = t.traslacion ?? [0, 0];
  const traslacion: [number, number] = [tx + (b[0] - a[0]), ty + (b[1] - a[1])];
  const { traslacion: _t, ...resto } = t;
  return traslacion[0] === 0 && traslacion[1] === 0 ? resto : { ...resto, traslacion };
}

/** La plantilla girada `grados` alrededor de c (en el modelo). */
export function girarPlantilla(t: PlantillaDxf, c: Vec2, grados: number): PlantillaDxf {
  const [co, s] = cosSin(grados);
  const [tx, ty] = t.traslacion ?? [0, 0];
  const dx = tx - c[0];
  const dy = ty - c[1];
  const traslacion: [number, number] = [c[0] + co * dx - s * dy, c[1] + s * dx + co * dy];
  const g = (((t.giro ?? 0) + grados) % 360 + 360) % 360;
  const { traslacion: _t, giro: _g, ...resto } = t;
  return { ...resto, ...(traslacion[0] !== 0 || traslacion[1] !== 0 ? { traslacion } : {}), ...(g !== 0 ? { giro: g } : {}) };
}

export interface TextoColocado {
  x: number;
  y: number;
  altura: number;
  giro: number;
  texto: string;
  h: 0 | 1 | 2;
  v: 0 | 1 | 2 | 3;
}

/** Lo que se ve de una plantilla, en el modelo (m). */
export interface PlantillaColocada {
  nombre: string;
  /** Redondeo de lo enganchado, m (0: nada). */
  redondeo: number;
  /** Segmentos rectos: x0 y0 x1 y1. */
  lineas: Float64Array;
  /** Cuerdas de curvas: x0 y0 x1 y1. */
  curvas: Float64Array;
  puntos: Float64Array;
  /** Índice en `TIPOS_PUNTO_DXF`. */
  tipos: Uint8Array;
  textos: TextoColocado[];
}

/** La plantilla colocada: sus capas visibles, en el modelo. */
export function colocar(d: DibujoDxf, t: PlantillaDxf): PlantillaColocada {
  const ocultas = new Set(t.ocultas ?? []);
  const nG = d.grupos.length / 2;
  const visible = new Uint8Array(nG);
  for (let g = 0; g < nG; g++) visible[g] = !ocultas.has(d.capas[d.grupos[2 * g]!]!.nombre) && !ocultas.has(d.capas[d.grupos[2 * g + 1]!]!.nombre) ? 1 : 0;
  const tr = transformacion(t);
  const segmentos = (xs: Float64Array, gs: Uint32Array): Float64Array => {
    let n = 0;
    for (let i = 0; i < gs.length; i++) n += visible[gs[i]!]!;
    const r = new Float64Array(4 * n);
    let k = 0;
    for (let i = 0; i < gs.length; i++) {
      if (!visible[gs[i]!]) continue;
      const a = tr(xs[4 * i]!, xs[4 * i + 1]!);
      const b = tr(xs[4 * i + 2]!, xs[4 * i + 3]!);
      r[k++] = a[0];
      r[k++] = a[1];
      r[k++] = b[0];
      r[k++] = b[1];
    }
    return r;
  };
  const pts: number[] = [];
  const tipos: number[] = [];
  for (let i = 0; i < d.tipoPuntos.length; i++) {
    if (!visible[d.grupoPuntos[i]!]) continue;
    const p = tr(d.puntos[2 * i]!, d.puntos[2 * i + 1]!);
    pts.push(p[0], p[1]);
    tipos.push(d.tipoPuntos[i]!);
  }
  const f = UNIDADES[t.unidades].aM;
  const giro = ((t.giro ?? 0) * Math.PI) / 180;
  const textos = d.textos
    .filter((x) => visible[x.grupo])
    .map((x): TextoColocado => {
      const [px, py] = tr(x.x, x.y);
      return { x: px, y: py, altura: f(x.altura), giro: x.giro + giro, texto: x.texto, h: x.h, v: x.v };
    });
  return {
    nombre: t.nombre,
    redondeo: t.redondeo ?? 0.001,
    lineas: segmentos(d.lineas, d.grupoLineas),
    curvas: segmentos(d.curvas, d.grupoCurvas),
    puntos: Float64Array.from(pts),
    tipos: Uint8Array.from(tipos),
    textos,
  };
}

/** Un punto redondeado a `paso` m (0: tal cual). Por la división, el double de teclear el número. */
export function redondear(p: Vec2, paso: number): Vec2 {
  if (!(paso > 0)) return p;
  const k = Math.round(1 / paso);
  const r = (x: number) => Math.round(x * k) / k || 0;
  return [r(p[0]), r(p[1])];
}

// ─── El índice para enganchar ───────────────────────────────────────────────────────────────────

/** Las plantillas de una planta, juntas, con sus celdas. */
export interface IndicePlantilla {
  /** Segmentos: x0 y0 x1 y1; los rectos primero (`rectos` de ellos) y luego las cuerdas. */
  seg: Float64Array;
  rectos: number;
  /** Plantilla de cada segmento y de cada punto. */
  plSeg: Uint16Array;
  pts: Float64Array;
  tipos: Uint8Array;
  plPts: Uint16Array;
  /** Nombre y redondeo de cada plantilla. */
  plantillas: { nombre: string; redondeo: number }[];
  x0: number;
  y0: number;
  lado: number;
  nx: number;
  ny: number;
  /** Celdas en CSR: los segmentos de la celda c son segCelda[inicioSeg[c] … inicioSeg[c+1]). */
  inicioSeg: Uint32Array;
  segCelda: Uint32Array;
  inicioPts: Uint32Array;
  ptsCelda: Uint32Array;
}

/** Celdas como mucho (para no reservar de más con un DXF disperso). */
const CELDAS_MAX = 1 << 20;

export function indicePlantilla(cs: readonly PlantillaColocada[]): IndicePlantilla | null {
  const rectos = cs.reduce((s, c) => s + c.lineas.length / 4, 0);
  const nSeg = rectos + cs.reduce((s, c) => s + c.curvas.length / 4, 0);
  const nPts = cs.reduce((s, c) => s + c.tipos.length, 0);
  if (nSeg + nPts === 0) return null;
  const seg = new Float64Array(4 * nSeg);
  const plSeg = new Uint16Array(nSeg);
  const pts = new Float64Array(2 * nPts);
  const tipos = new Uint8Array(nPts);
  const plPts = new Uint16Array(nPts);
  let k = 0;
  for (const tipo of ["lineas", "curvas"] as const)
    cs.forEach((c, i) => {
      seg.set(c[tipo], 4 * k);
      plSeg.fill(i, k, k + c[tipo].length / 4);
      k += c[tipo].length / 4;
    });
  k = 0;
  cs.forEach((c, i) => {
    pts.set(c.puntos, 2 * k);
    tipos.set(c.tipos, k);
    plPts.fill(i, k, k + c.tipos.length);
    k += c.tipos.length;
  });

  // La caja y el lado de las celdas: unas pocas cosas por celda
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const ver = (x: number, y: number) => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  for (let i = 0; i < seg.length; i += 2) ver(seg[i]!, seg[i + 1]!);
  for (let i = 0; i < pts.length; i += 2) ver(pts[i]!, pts[i + 1]!);
  const ancho = Math.max(x1 - x0, y1 - y0, 1e-6);
  let lado = Math.max(ancho / Math.sqrt(Math.max(1, nSeg + nPts) / 2), 1e-3);
  while (Math.ceil((x1 - x0) / lado + 1) * Math.ceil((y1 - y0) / lado + 1) > CELDAS_MAX) lado *= 2;
  const nx = Math.max(1, Math.ceil((x1 - x0) / lado) + 1);
  const ny = Math.max(1, Math.ceil((y1 - y0) / lado) + 1);
  const celda = (x: number, y: number): [number, number] => [Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / lado))), Math.min(ny - 1, Math.max(0, Math.floor((y - y0) / lado)))];

  /** Las celdas que atraviesa el segmento i (Amanatides y Woo). */
  const recorrer = (i: number, f: (c: number) => void) => {
    const [ax, ay, bx, by] = [seg[4 * i]!, seg[4 * i + 1]!, seg[4 * i + 2]!, seg[4 * i + 3]!];
    let [cx, cy] = celda(ax, ay);
    const [ex, ey] = celda(bx, by);
    const dx = bx - ax;
    const dy = by - ay;
    const sx = dx > 0 ? 1 : -1;
    const sy = dy > 0 ? 1 : -1;
    const tdx = dx === 0 ? Infinity : Math.abs(lado / dx);
    const tdy = dy === 0 ? Infinity : Math.abs(lado / dy);
    let tx = dx === 0 ? Infinity : ((dx > 0 ? x0 + (cx + 1) * lado - ax : ax - (x0 + cx * lado)) / Math.abs(dx));
    let ty = dy === 0 ? Infinity : ((dy > 0 ? y0 + (cy + 1) * lado - ay : ay - (y0 + cy * lado)) / Math.abs(dy));
    f(cy * nx + cx);
    for (let pasos = Math.abs(ex - cx) + Math.abs(ey - cy); pasos > 0; pasos--) {
      if (tx < ty) {
        cx += sx;
        tx += tdx;
      } else {
        cy += sy;
        ty += tdy;
      }
      if (cx < 0 || cy < 0 || cx >= nx || cy >= ny) break;
      f(cy * nx + cx);
    }
    // Con el redondeo, el recorrido puede acabar en una vecina: la del final entra siempre
    if (cx !== ex || cy !== ey) f(ey * nx + ex);
  };

  const nC = nx * ny;
  const contarSeg = new Uint32Array(nC + 1);
  for (let i = 0; i < nSeg; i++) recorrer(i, (c) => contarSeg[c + 1]!++);
  for (let c = 0; c < nC; c++) contarSeg[c + 1]! += contarSeg[c]!;
  const segCelda = new Uint32Array(contarSeg[nC]!);
  const llenos = contarSeg.slice(0, nC);
  for (let i = 0; i < nSeg; i++) recorrer(i, (c) => (segCelda[llenos[c]!++] = i));

  const contarPts = new Uint32Array(nC + 1);
  const celdaPts = new Uint32Array(nPts);
  for (let i = 0; i < nPts; i++) {
    const [cx, cy] = celda(pts[2 * i]!, pts[2 * i + 1]!);
    celdaPts[i] = cy * nx + cx;
    contarPts[celdaPts[i]! + 1]!++;
  }
  for (let c = 0; c < nC; c++) contarPts[c + 1]! += contarPts[c]!;
  const ptsCelda = new Uint32Array(nPts);
  const llenosP = contarPts.slice(0, nC);
  for (let i = 0; i < nPts; i++) ptsCelda[llenosP[celdaPts[i]!]!++] = i;

  return {
    seg,
    rectos,
    plSeg,
    pts,
    tipos,
    plPts,
    plantillas: cs.map((c) => ({ nombre: c.nombre, redondeo: c.redondeo })),
    x0,
    y0,
    lado,
    nx,
    ny,
    inicioSeg: contarSeg,
    segCelda,
    inicioPts: contarPts,
    ptsCelda,
  };
}

/** El tipo de enganche de un punto de la plantilla. */
export const tipoPunto = (ix: IndicePlantilla, i: number): TipoPuntoDxf => TIPOS_PUNTO_DXF[ix.tipos[i]!]!;

/**
 * Lo que hay en las celdas a ≤ r de q: los segmentos (sin repetir) y los puntos. Lo que no está a
 * ≤ r lo descarta quien lo usa.
 */
export function cerca(ix: IndicePlantilla, q: Vec2, r: number): { segmentos: number[]; puntos: number[] } {
  const c0 = Math.max(0, Math.floor((q[0] - r - ix.x0) / ix.lado));
  const c1 = Math.min(ix.nx - 1, Math.floor((q[0] + r - ix.x0) / ix.lado));
  const f0 = Math.max(0, Math.floor((q[1] - r - ix.y0) / ix.lado));
  const f1 = Math.min(ix.ny - 1, Math.floor((q[1] + r - ix.y0) / ix.lado));
  const segmentos: number[] = [];
  const puntos: number[] = [];
  if (c0 > c1 || f0 > f1) return { segmentos, puntos };
  const vistos = new Set<number>();
  for (let f = f0; f <= f1; f++)
    for (let c = c0; c <= c1; c++) {
      const k = f * ix.nx + c;
      for (let j = ix.inicioSeg[k]!; j < ix.inicioSeg[k + 1]!; j++) {
        const s = ix.segCelda[j]!;
        if (!vistos.has(s)) {
          vistos.add(s);
          segmentos.push(s);
        }
      }
      for (let j = ix.inicioPts[k]!; j < ix.inicioPts[k + 1]!; j++) puntos.push(ix.ptsCelda[j]!);
    }
  return { segmentos, puntos };
}
