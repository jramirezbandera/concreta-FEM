/**
 * `fem importar-dxf` (MA6, `docs/fem3d/modelado.md` §2.6): de un plano DXF a un `proyecto.json` con
 * plantas, pilares, contornos de losa y ejes de replanteo, más un informe de lo reconocido y de lo
 * que no, para que el agente lo pregunte. Sin cargas: eso lo pone el agente con lo que le digan.
 *
 * - **Lector:** el propio de V2c-4 (`src/dxf/`, decisión V2c4-a), con la colocación de la plantilla
 *   (`editor/dibujo/plantilla.ts`): las mismas unidades propuestas, la misma traslación si el plano
 *   está lejos del origen y todo redondeado al mm (V2c4-c). El DXF queda como plantilla de la planta
 *   de las losas, así que en la app se ve detrás de lo importado, en su sitio.
 * - **Grafo de segmentos** de cada capa (líneas y cuerdas de curvas): los extremos al mm, partidos
 *   en los cruces, en las T y en los solapes, sin repetidos y sin los tramos sueltos (un extremo sin
 *   nada). Sus caras salen de recorrer las semiaristas (la siguiente es la primera en sentido horario
 *   desde la gemela): las acotadas, antihorarias; la exterior de cada componente, horaria.
 * - **Pilares:** los rectángulos del grafo de su capa (cuatro esquinas unidas por cadenas rectas de
 *   aristas, con lados de 0,15 m a `ladoMaximo`) que no caen dentro de otro: así vale el de una
 *   polilínea cerrada, el de cuatro `LINE`, el que tiene su cruz o su aspa y el que cruza un muro
 *   dibujado en la misma capa (el plano de arquitectura). Si alguno tiene un nudo en el centro (la
 *   cruz o el aspa), sólo cuentan los que lo tienen: los demás son trozos de muro o de mobiliario. El
 *   canto h va según el lado largo, con su giro. Circulares, los componentes sueltos con ≥ 12
 *   vértices a la misma distancia del centro. Lo que no es ni lo uno ni lo otro, a `noReconocidos`.
 * - **Losas:** cada cara acotada es una región (con los componentes que caen dentro como huecos).
 *   Una región «delgada» (2·A/P ≤ `anchoTira`: el hueco entre las dos líneas de un peto o de una
 *   fachada, o un pilar dibujado en la capa) no es losa: se une a la losa vecina con la que comparte
 *   más borde, así que el contorno sale por la línea de fuera (la losa hasta su borde real, TB). De
 *   las regiones gruesas, unas son losa y otras hueco, alternando de fuera adentro (las delgadas no
 *   cuentan): un rectángulo dentro de una losa es un hueco, y una isla dentro de un hueco, losa.
 *   Dos regiones gruesas juntas (dos cubiertas que se tocan) son dos losas.
 * - **Ejes:** las líneas de su capa de ≥ 2 m, las colineales unidas; su nombre, el texto corto más
 *   cercano a uno de sus extremos (el de la burbuja), a ≤ 1,5 m.
 * - **Cotas** (`DIMENSION` lineales): sus dos puntos tienen que caer, a ≤ 1 cm, en algo reconocido
 *   (un vértice o el centro de un pilar, un eje o el borde de una losa). Las que no cuadran se listan:
 *   si no cuadra ninguna, las unidades o la escala están mal.
 *
 * Puro: sin IO. Entra el DXF leído (`leerDxf`) y aplanado (`aplanarDxf`), y sale el proyecto.
 */
import type { Material, Pilar, Planta, Losa, EjeReplanteo, Seccion, Vec2 } from "../compilador/fisico.ts";
import type { DibujoDxf } from "../dxf/aplanar.ts";
import { num, texto, tiene, type Dxf } from "../dxf/lector.ts";
import { colocar, insunitsDistintas, proponerUnidades, transformacion, traslacionInicial, UNIDADES, type UnidadDxf } from "../editor/dibujo/plantilla.ts";
import { MATERIALES_TIPICOS } from "../editor/gestores.ts";
import { aplicar } from "../editor/operaciones.ts";
import { VERSION_ESQUEMA, type PlantillaDxf, type Proyecto } from "./proyecto.ts";

export interface OpcionesImportar {
  capasPilares?: readonly string[];
  capasLosas?: readonly string[];
  capasEjes?: readonly string[];
  /** Las unidades del DXF; por defecto, las propuestas (`proponerUnidades`). */
  unidades?: UnidadDxf;
  /** Las plantas con su cota (m), en cualquier orden; por defecto, «Cim» a 0 y «N1» a 3 (supuesto). */
  plantas?: readonly { id: string; cota: number }[];
  /** La planta de las losas y de la cabeza de los pilares; por defecto, la más alta. */
  plantaLosas?: string;
  /** Id del material (un hormigón «HA-xx» o un acero típico); por defecto, HA-25 (supuesto). */
  material?: string;
  /** Espesor de las losas, m; por defecto, 0,30 (supuesto). */
  espesor?: number;
  /** Lado máximo de un pilar, m. Por defecto, 1,5. */
  ladoMaximo?: number;
  /** Ancho por debajo del cual una región es una tira (peto, fachada doble), m. Por defecto, 0,5. */
  anchoTira?: number;
  /** Nombre del proyecto. */
  nombre?: string;
  /** El DXF como plantilla: su nombre de fichero junto al proyecto y su sha256 (sin él, no hay plantilla). */
  plantilla?: { fichero: string; sha256: string };
}

/** Lo que tiene una capa, para elegir las de pilares, losas y ejes. */
export interface CapaImportable {
  nombre: string;
  entidades: number;
  oculta: boolean;
  /** Segmentos (rectos y cuerdas de curvas). */
  segmentos: number;
  textos: number;
  /** Componentes cerrados que serían pilares (rectángulos o círculos de lado ≤ ladoMaximo). */
  pilares: number;
  /** Regiones gruesas cerradas de más de 10 m² (contornos de losa posibles). */
  contornos: number;
  /** Líneas rectas de ≥ 2 m. */
  lineasLargas: number;
}

export interface NoReconocido {
  capa: "pilares" | "losas" | "ejes";
  motivo: string;
  /** Caja [xmin, ymin, xmax, ymax], m. */
  caja: [number, number, number, number];
  vertices?: number;
}

export interface InformeImportar {
  unidades: UnidadDxf;
  insunits: number | null;
  traslacion?: [number, number];
  capas: CapaImportable[];
  /** Las capas que se proponen si no se dan (por lo que tienen y por su nombre). */
  propuesta: { pilares?: string; losas?: string; ejes?: string };
  usadas: { pilares: string[]; losas: string[]; ejes: string[] };
  pilares: { n: number; secciones: { id: string; n: number }[] };
  losas: { id: string; area: number; vertices: number; huecos: number }[];
  ejes: { id: string; nombre?: string }[];
  cotas: { total: number; cuadran: number; noCuadran: { valor: number; texto?: string; a: Vec2; b: Vec2 }[] };
  noReconocidos: NoReconocido[];
  /** Lo que se puso sin dato: hay que confirmarlo con el usuario. */
  supuestos: string[];
  avisos: string[];
}

// ─── Números ────────────────────────────────────────────────────────────────────────────────────

/** Al mm, con el double de teclear el número (por la división), como `redondear` de la plantilla. */
const mm = (x: number) => Math.round(x * 1000) / 1000 || 0;
/** A la décima de mm (el centro de un rectángulo de vértices al mm). */
const dmm = (x: number) => Math.round(x * 10000) / 10000 || 0;
const TOL = 0.5e-3;
type P = [number, number];

// ─── Grafo plano ────────────────────────────────────────────────────────────────────────────────

interface Grafo {
  nodos: P[];
  /** Semiaristas: la 2k va de a[k][0] a a[k][1] y la 2k+1, al revés. */
  aristas: [number, number][];
  /** Siguiente semiarista de la misma cara. */
  siguiente: Int32Array;
  /** Cara de cada semiarista (índice en `caras`). */
  cara: Int32Array;
  caras: Cara[];
  /** Componente de cada nodo. */
  componente: Int32Array;
  componentes: number;
}

interface Cara {
  semi: number[];
  /** Área con signo del ciclo: > 0 acotada (antihoraria), < 0 la exterior de su componente. */
  area: number;
  perimetro: number;
  componente: number;
}

const origen = (g: Grafo, h: number): number => g.aristas[h >> 1]![h & 1];
const destino = (g: Grafo, h: number): number => g.aristas[h >> 1]![1 - (h & 1)];

/** El grafo de unos segmentos (x0 y0 x1 y1, en m): partido en cruces, T y solapes, sin tramos sueltos. */
function grafo(segs: Float64Array): Grafo {
  // 1. Al mm y sin los de longitud nula
  const s: [P, P][] = [];
  for (let i = 0; i < segs.length; i += 4) {
    const a: P = [mm(segs[i]!), mm(segs[i + 1]!)];
    const b: P = [mm(segs[i + 2]!), mm(segs[i + 3]!)];
    if (a[0] !== b[0] || a[1] !== b[1]) s.push([a, b]);
  }
  // 2. Puntos de corte de cada segmento (barrido por x)
  const cortes: P[][] = s.map(() => []);
  const orden = s.map((_, i) => i).sort((i, j) => Math.min(s[i]![0][0], s[i]![1][0]) - Math.min(s[j]![0][0], s[j]![1][0]));
  const enSeg = (p: P, [a, b]: [P, P]): boolean => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    if (t <= 0 || t >= 1) return false;
    const d = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.sqrt(l2);
    const l = Math.sqrt(l2);
    return d <= TOL && t * l > TOL && (1 - t) * l > TOL;
  };
  for (let oi = 0; oi < orden.length; oi++) {
    const i = orden[oi]!;
    const si = s[i]!;
    const xmax = Math.max(si[0][0], si[1][0]);
    const [ymin, ymax] = [Math.min(si[0][1], si[1][1]), Math.max(si[0][1], si[1][1])];
    for (let oj = oi + 1; oj < orden.length; oj++) {
      const j = orden[oj]!;
      const sj = s[j]!;
      if (Math.min(sj[0][0], sj[1][0]) > xmax + TOL) break;
      if (Math.min(sj[0][1], sj[1][1]) > ymax + TOL || Math.max(sj[0][1], sj[1][1]) < ymin - TOL) continue;
      // T y solapes: los extremos de uno sobre el otro
      for (const p of sj) if (enSeg(p, si)) cortes[i]!.push(p);
      for (const p of si) if (enSeg(p, sj)) cortes[j]!.push(p);
      // Cruce propio
      const [a, b] = si;
      const [c, d] = sj;
      const r: P = [b[0] - a[0], b[1] - a[1]];
      const q: P = [d[0] - c[0], d[1] - c[1]];
      const den = r[0] * q[1] - r[1] * q[0];
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c[0] - a[0]) * q[1] - (c[1] - a[1]) * q[0]) / den;
      const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
      if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue;
      const p: P = [mm(a[0] + t * r[0]), mm(a[1] + t * r[1])];
      const igual = (x: P) => x[0] === p[0] && x[1] === p[1];
      if (!igual(a) && !igual(b)) cortes[i]!.push(p);
      if (!igual(c) && !igual(d)) cortes[j]!.push(p);
    }
  }
  // 3. Nodos y aristas, sin repetidas
  const nodos: P[] = [];
  const clave = new Map<string, number>();
  const nodo = (p: P): number => {
    const k = `${p[0]},${p[1]}`;
    let n = clave.get(k);
    if (n === undefined) {
      n = nodos.length;
      nodos.push(p);
      clave.set(k, n);
    }
    return n;
  };
  const vistas = new Set<string>();
  let aristas: [number, number][] = [];
  s.forEach(([a, b], i) => {
    const t = (p: P) => (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
    const ps = [a, ...cortes[i]!.sort((x, y) => t(x) - t(y)), b];
    for (let k = 0; k + 1 < ps.length; k++) {
      const [u, v] = [nodo(ps[k]!), nodo(ps[k + 1]!)];
      if (u === v) continue;
      const kk = u < v ? `${u},${v}` : `${v},${u}`;
      if (vistas.has(kk)) continue;
      vistas.add(kk);
      aristas.push([u, v]);
    }
  });
  // 4. Sin tramos sueltos: se quitan los nudos de grado 1 hasta que no quede ninguno
  for (;;) {
    const grado = new Int32Array(nodos.length);
    for (const [u, v] of aristas) {
      grado[u]!++;
      grado[v]!++;
    }
    const quedan = aristas.filter(([u, v]) => grado[u]! > 1 && grado[v]! > 1);
    if (quedan.length === aristas.length) break;
    aristas = quedan;
  }
  // 5. Semiaristas y caras
  const salientes: number[][] = nodos.map(() => []);
  aristas.forEach(([u, v], k) => {
    salientes[u]!.push(2 * k);
    salientes[v]!.push(2 * k + 1);
  });
  const g: Grafo = { nodos, aristas, siguiente: new Int32Array(2 * aristas.length), cara: new Int32Array(2 * aristas.length).fill(-1), caras: [], componente: new Int32Array(nodos.length).fill(-1), componentes: 0 };
  const angulo = (h: number) => {
    const [a, b] = [nodos[origen(g, h)]!, nodos[destino(g, h)]!];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  const posicion = new Int32Array(2 * aristas.length);
  for (const l of salientes) {
    l.sort((x, y) => angulo(x) - angulo(y));
    l.forEach((h, i) => (posicion[h] = i));
  }
  for (let h = 0; h < 2 * aristas.length; h++) {
    const gem = h ^ 1;
    const l = salientes[destino(g, h)]!;
    g.siguiente[h] = l[(posicion[gem]! - 1 + l.length) % l.length]!;
  }
  // Componentes
  for (let n = 0; n < nodos.length; n++) {
    if (g.componente[n] !== -1 || !salientes[n]!.length) continue;
    const pila = [n];
    g.componente[n] = g.componentes;
    while (pila.length) {
      const x = pila.pop()!;
      for (const h of salientes[x]!) {
        const y = destino(g, h);
        if (g.componente[y] === -1) {
          g.componente[y] = g.componentes;
          pila.push(y);
        }
      }
    }
    g.componentes++;
  }
  for (let h0 = 0; h0 < 2 * aristas.length; h0++) {
    if (g.cara[h0] !== -1) continue;
    const semi: number[] = [];
    let area = 0;
    let perimetro = 0;
    const [x0, y0] = nodos[origen(g, h0)]!;
    for (let h = h0; g.cara[h] === -1; h = g.siguiente[h]!) {
      g.cara[h] = g.caras.length;
      semi.push(h);
      const [a, b] = [nodos[origen(g, h)]!, nodos[destino(g, h)]!];
      area += (a[0] - x0) * (b[1] - y0) - (b[0] - x0) * (a[1] - y0);
      perimetro += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    g.caras.push({ semi, area: area / 2, perimetro, componente: g.componente[origen(g, h0)]! });
  }
  return g;
}

/** Los vértices de una cara, sin los alineados (a ≤ TOL de la recta de sus vecinos). */
function vertices(g: Grafo, semi: readonly number[]): P[] {
  let ps = semi.map((h) => g.nodos[origen(g, h)]!);
  for (let cambio = true; cambio && ps.length > 3; ) {
    cambio = false;
    for (let i = 0; i < ps.length && ps.length > 3; i++) {
      const [a, b, c] = [ps[(i - 1 + ps.length) % ps.length]!, ps[i]!, ps[(i + 1) % ps.length]!];
      const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const d = l > 0 ? Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / l : 0;
      const dentro = (b[0] - a[0]) * (c[0] - a[0]) + (b[1] - a[1]) * (c[1] - a[1]) >= 0 && (b[0] - c[0]) * (a[0] - c[0]) + (b[1] - c[1]) * (a[1] - c[1]) >= 0;
      if (d <= TOL && dentro) {
        ps = ps.filter((_, k) => k !== i);
        cambio = true;
        i--;
      }
    }
  }
  return ps;
}

function dentroDe(p: P, ps: readonly P[]): boolean {
  let r = false;
  for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
    const [a, b] = [ps[i]!, ps[j]!];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) r = !r;
  }
  return r;
}

const caja = (ps: readonly P[]): [number, number, number, number] => [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))];

function areaDe(ps: readonly P[]): number {
  let a = 0;
  const [x0, y0] = ps[0]!;
  for (let i = 0; i < ps.length; i++) {
    const [p, q] = [ps[i]!, ps[(i + 1) % ps.length]!];
    a += (p[0] - x0) * (q[1] - y0) - (q[0] - x0) * (p[1] - y0);
  }
  return a / 2;
}

/**
 * La cara acotada que contiene a cada componente (por el primer nudo de su exterior), la más pequeña,
 * o -1. Y el contorno exterior (horario) de cada componente.
 */
function anidamiento(g: Grafo): { contenedor: Int32Array; exterior: Int32Array; poligono: (f: number) => P[] } {
  const poligonos = new Map<number, P[]>();
  const poligono = (f: number) => {
    let p = poligonos.get(f);
    if (!p) poligonos.set(f, (p = g.caras[f]!.semi.map((h) => g.nodos[origen(g, h)]!)));
    return p;
  };
  const exterior = new Int32Array(g.componentes).fill(-1);
  g.caras.forEach((c, f) => {
    if (c.area < 0 && (exterior[c.componente] === -1 || c.area < g.caras[exterior[c.componente]!]!.area)) exterior[c.componente] = f;
  });
  const contenedor = new Int32Array(g.componentes).fill(-1);
  const acotadas = g.caras.map((c, f) => ({ c, f })).filter((x) => x.c.area > 0);
  for (let k = 0; k < g.componentes; k++) {
    const e = exterior[k]!;
    if (e < 0) continue;
    const p = g.nodos[origen(g, g.caras[e]!.semi[0]!)]!;
    let mejor = -1;
    for (const { c, f } of acotadas) {
      if (c.componente === k || (mejor >= 0 && c.area >= g.caras[mejor]!.area)) continue;
      if (dentroDe(p, poligono(f))) mejor = f;
    }
    contenedor[k] = mejor;
  }
  return { contenedor, exterior, poligono };
}

// ─── Pilares ────────────────────────────────────────────────────────────────────────────────────

type FormaPilar = { forma: "rectangular"; b: number; h: number; giro: number; centro: P } | { forma: "circular"; D: number; centro: P };

/** Un contorno exterior como pilar, o el motivo por el que no lo es. */
function comoPilar(ps: readonly P[], ladoMaximo: number): FormaPilar | { motivo: string } {
  if (ps.length === 4) {
    const lados = ps.map((p, i) => {
      const q = ps[(i + 1) % 4]!;
      return [q[0] - p[0], q[1] - p[1]] as P;
    });
    const l = lados.map((v) => Math.hypot(v[0], v[1]));
    const recto = lados.every((v, i) => {
      const w = lados[(i + 1) % 4]!;
      return Math.abs(v[0] * w[0] + v[1] * w[1]) <= 1e-3 * l[i]! * l[(i + 1) % 4]!;
    });
    if (!recto) return { motivo: "cuadrilátero que no es un rectángulo" };
    const [a, b] = [mm((l[0]! + l[2]!) / 2), mm((l[1]! + l[3]!) / 2)];
    const h = Math.max(a, b);
    const bb = Math.min(a, b);
    if (h > ladoMaximo) return { motivo: `rectángulo de ${h} m de lado, mayor que el lado máximo de un pilar (${ladoMaximo} m)` };
    if (bb < 0.05) return { motivo: `rectángulo de ${bb} m de lado: demasiado estrecho para un pilar` };
    const largo = a >= b ? lados[0]! : lados[1]!;
    let giro = (Math.atan2(largo[1], largo[0]) * 180) / Math.PI;
    giro = ((giro % 180) + 180) % 180;
    if (a === b) giro %= 90;
    giro = Math.round(giro * 1e6) / 1e6;
    if (giro === 180 || giro === 90 && a === b) giro = 0;
    const centro: P = [dmm((ps[0]![0] + ps[2]![0]) / 2), dmm((ps[0]![1] + ps[2]![1]) / 2)];
    return { forma: "rectangular", b: bb, h, giro: giro || 0, centro };
  }
  if (ps.length >= 12) {
    const cx = ps.reduce((s, p) => s + p[0], 0) / ps.length;
    const cy = ps.reduce((s, p) => s + p[1], 0) / ps.length;
    const r = ps.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
    const rm = r.reduce((s, x) => s + x, 0) / r.length;
    if (r.every((x) => Math.abs(x - rm) <= Math.max(0.01 * rm, 2e-3))) {
      const D = mm(2 * Math.max(...r));
      if (D > ladoMaximo) return { motivo: `círculo de ${D} m de diámetro, mayor que el lado máximo de un pilar (${ladoMaximo} m)` };
      return { forma: "circular", D, centro: [dmm(cx), dmm(cy)] };
    }
  }
  return { motivo: `polígono de ${ps.length} vértices: ni rectángulo ni círculo` };
}

/** Los rectángulos del grafo: cuatro esquinas unidas por cadenas rectas de aristas, de lados ≤ L. */
function rectangulos(g: Grafo, ladoMinimo: number, ladoMaximo: number): P[][] {
  const salientes: number[][] = g.nodos.map(() => []);
  for (let h = 0; h < 2 * g.aristas.length; h++) salientes[origen(g, h)]!.push(h);
  const dir = (h: number): P => {
    const [a, b] = [g.nodos[origen(g, h)]!, g.nodos[destino(g, h)]!];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  /** Los nudos de la cadena recta desde n según d, con su distancia, hasta L. */
  const cadena = (n: number, d: P): Map<number, number> => {
    const r = new Map<number, number>();
    const a = g.nodos[n]!;
    let x = n;
    for (;;) {
      let sig = -1;
      for (const h of salientes[x]!) {
        const y = g.nodos[destino(g, h)]!;
        const [vx, vy] = [y[0] - a[0], y[1] - a[1]];
        const s = vx * d[0] + vy * d[1];
        if (s > (r.get(x) ?? 0) + TOL && Math.abs(vx * d[1] - vy * d[0]) <= 2 * TOL) {
          sig = destino(g, h);
          break;
        }
      }
      if (sig < 0) break;
      const y = g.nodos[sig]!;
      const s = (y[0] - a[0]) * d[0] + (y[1] - a[1]) * d[1];
      if (s > ladoMaximo + TOL) break;
      r.set(sig, s);
      x = sig;
    }
    return r;
  };
  const vistos = new Set<string>();
  const r: P[][] = [];
  for (let a = 0; a < g.nodos.length; a++) {
    const hs = salientes[a]!;
    for (const h1 of hs) {
      const d1 = dir(h1);
      const d2: P = [-d1[1], d1[0]];
      if (!hs.some((h2) => {
        const e = dir(h2);
        return Math.abs(e[0] - d2[0]) + Math.abs(e[1] - d2[1]) <= 1e-2;
      })) continue;
      const c1 = cadena(a, d1);
      const c2 = cadena(a, d2);
      for (const [b, s] of c1) {
        if (s < ladoMinimo - TOL) continue;
        const cb = cadena(b, d2);
        for (const [dd, t] of c2) {
          if (t < ladoMinimo - TOL) continue;
          const cd = cadena(dd, d1);
          const c = [...cb].find(([, tt]) => Math.abs(tt - t) <= 2 * TOL)?.[0];
          if (c === undefined || Math.abs((cd.get(c) ?? -1) - s) > 2 * TOL) continue;
          const k = [a, b, c, dd].sort((x, y) => x - y).join(",");
          if (vistos.has(k)) continue;
          vistos.add(k);
          r.push([g.nodos[a]!, g.nodos[b]!, g.nodos[c]!, g.nodos[dd]!]);
        }
      }
    }
  }
  return r;
}

function pilaresDe(segs: Float64Array, ladoMaximo: number): { formas: FormaPilar[]; noReconocidos: NoReconocido[]; sinMarca: number } {
  const g = grafo(segs);
  const { contenedor, exterior } = anidamiento(g);
  const noReconocidos: NoReconocido[] = [];
  // Rectángulos: los que no caen dentro de otro (las cuatro cuartas de un pilar con su cruz, no)
  const rects = rectangulos(g, 0.15, ladoMaximo);
  const dentroRect = (q: P, r: readonly P[], margen: number) => {
    // En los ejes del rectángulo
    const [o, u, v] = [r[0]!, [r[1]![0] - r[0]![0], r[1]![1] - r[0]![1]], [r[3]![0] - r[0]![0], r[3]![1] - r[0]![1]]];
    const [lu, lv] = [Math.hypot(u[0]!, u[1]!), Math.hypot(v[0]!, v[1]!)];
    const s = ((q[0] - o[0]) * u[0]! + (q[1] - o[1]) * u[1]!) / lu;
    const t = ((q[0] - o[0]) * v[0]! + (q[1] - o[1]) * v[1]!) / lv;
    return s >= margen && s <= lu - margen && t >= margen && t <= lv - margen;
  };
  const maximos = rects.filter((r, i) => !rects.some((o, j) => j !== i && r.every((q) => dentroRect(q, o, -TOL)) && !o.every((q) => dentroRect(q, r, -TOL))));
  // Con marca: un nudo en el centro (la cruz o el aspa que se dibuja en los pilares)
  const nudos = new Set(g.nodos.map((p) => `${p[0]},${p[1]}`));
  const marcado = maximos.map((r) => {
    const c: P = [(r[0]![0] + r[2]![0]) / 2, (r[0]![1] + r[2]![1]) / 2];
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) if (nudos.has(`${mm(c[0] + dx * 1e-3)},${mm(c[1] + dy * 1e-3)}`)) return true;
    return false;
  });
  const hayMarcas = marcado.some(Boolean);
  const formas: FormaPilar[] = [];
  let sinMarca = 0;
  maximos.forEach((r, i) => {
    const f = comoPilar(r, ladoMaximo);
    if ("motivo" in f) return;
    if (hayMarcas && !marcado[i]) {
      sinMarca++;
      if (sinMarca <= 10) noReconocidos.push({ capa: "pilares", motivo: "rectángulo sin cruz ni aspa en el centro, cuando otros sí la tienen (¿un trozo de muro?)", caja: caja(r) });
      return;
    }
    formas.push(f);
  });
  // Círculos y lo que no es ni lo uno ni lo otro: por el contorno exterior de cada componente suelto
  for (let k = 0; k < g.componentes; k++) {
    const e = exterior[k]!;
    if (e < 0 || contenedor[k]! >= 0) continue;
    const ps = vertices(g, g.caras[e]!.semi).reverse();
    const cj = caja(ps);
    if (cj[2] - cj[0] > ladoMaximo + TOL || cj[3] - cj[1] > ladoMaximo + TOL) continue;
    if (formas.some((f) => f.centro[0] >= cj[0] && f.centro[0] <= cj[2] && f.centro[1] >= cj[1] && f.centro[1] <= cj[3])) continue;
    const f = comoPilar(ps, ladoMaximo);
    if ("motivo" in f) noReconocidos.push({ capa: "pilares", motivo: f.motivo, caja: cj, vertices: ps.length });
    else if (f.forma === "circular") formas.push(f);
  }
  return { formas, noReconocidos, sinMarca };
}

// ─── Losas ──────────────────────────────────────────────────────────────────────────────────────

interface ContornoLosa {
  contorno: P[];
  huecos: P[][];
}

function losasDe(segs: Float64Array, anchoTira: number): { losas: ContornoLosa[]; noReconocidos: NoReconocido[] } {
  const g = grafo(segs);
  const { contenedor, exterior, poligono } = anidamiento(g);
  // La cara de cada semiarista, con los exteriores de los componentes anidados en su contenedor
  const caraDe = Int32Array.from(g.cara);
  const huecosDe = new Map<number, number[]>();
  for (let k = 0; k < g.componentes; k++) {
    const e = exterior[k]!;
    if (e < 0) continue;
    for (const h of g.caras[e]!.semi) caraDe[h] = contenedor[k]!;
    if (contenedor[k]! >= 0) huecosDe.set(contenedor[k]!, [...(huecosDe.get(contenedor[k]!) ?? []), e]);
  }
  const acotadas = g.caras.map((_, f) => f).filter((f) => g.caras[f]!.area > 0);
  const neta = new Map<number, { area: number; perimetro: number }>();
  for (const f of acotadas) {
    const hs = huecosDe.get(f) ?? [];
    neta.set(f, { area: g.caras[f]!.area + hs.reduce((s, e) => s + g.caras[e]!.area, 0), perimetro: g.caras[f]!.perimetro + hs.reduce((s, e) => s + g.caras[e]!.perimetro, 0) });
  }
  const delgada = (f: number) => {
    const n = neta.get(f)!;
    return (2 * n.area) / n.perimetro <= anchoTira;
  };
  // Llenas y vacías, alternando de fuera adentro por las gruesas
  const llena = new Map<number, boolean>();
  const estadoDe = (f: number): boolean => {
    // Lo que hay alrededor de la cara f: la gruesa que la contiene más cerca
    let k = g.caras[f]!.componente;
    for (;;) {
      const c = contenedor[k]!;
      if (c < 0) return false;
      if (!delgada(c)) return lleno(c);
      k = g.caras[c]!.componente;
    }
  };
  const lleno = (f: number): boolean => {
    let v = llena.get(f);
    if (v === undefined) llena.set(f, (v = !estadoDe(f)));
    return v;
  };
  const losas = acotadas.filter((f) => !delgada(f) && lleno(f));
  const grupo = new Map<number, number>(losas.map((f) => [f, f]));
  // Cada tira, con la losa (o la tira ya asignada) con la que comparte más borde
  const tiras = acotadas.filter(delgada);
  for (let cambio = true; cambio; ) {
    cambio = false;
    for (const t of tiras) {
      if (grupo.has(t)) continue;
      const comparte = new Map<number, number>();
      const recorrer = (semi: readonly number[]) => {
        for (const h of semi) {
          const otra = caraDe[h ^ 1]!;
          const gr = otra >= 0 ? grupo.get(otra) : undefined;
          if (gr === undefined) continue;
          const [a, b] = [g.nodos[origen(g, h)]!, g.nodos[destino(g, h)]!];
          comparte.set(gr, (comparte.get(gr) ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]));
        }
      };
      recorrer(g.caras[t]!.semi);
      for (const e of huecosDe.get(t) ?? []) recorrer(g.caras[e]!.semi);
      const mejor = [...comparte].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0];
      if (mejor) {
        grupo.set(t, mejor[0]);
        cambio = true;
      }
    }
  }
  const noReconocidos: NoReconocido[] = tiras.filter((t) => !grupo.has(t) && lleno(t)).map((t) => ({ capa: "losas", motivo: "tira delgada (2·A/P ≤ ancho de tira) sin losa al lado", caja: caja(poligono(t)) }));
  // El borde de cada losa con sus tiras: las semiaristas de su grupo con la gemela fuera de él
  const enGrupo = (h: number, gr: number) => caraDe[h]! >= 0 && grupo.get(caraDe[h]!) === gr;
  const resultado: ContornoLosa[] = [];
  for (const gr of losas) {
    const borde = new Set<number>();
    for (let h = 0; h < caraDe.length; h++) if (enGrupo(h, gr) && !enGrupo(h ^ 1, gr)) borde.add(h);
    const ciclos: P[][] = [];
    while (borde.size) {
      const h0 = borde.values().next().value!;
      const semi: number[] = [];
      let h = h0;
      for (let guarda = 0; guarda <= caraDe.length; guarda++) {
        semi.push(h);
        borde.delete(h);
        // La siguiente de la cara; si es interior al grupo (las dos caras en él), se gira en su nudo
        let c = g.siguiente[h]!;
        for (let vueltas = 0; enGrupo(c ^ 1, gr) && vueltas < caraDe.length; vueltas++) c = g.siguiente[c ^ 1]!;
        if (c === h0 || !borde.has(c)) break;
        h = c;
      }
      ciclos.push(vertices(g, semi));
    }
    const exteriores = ciclos.filter((c) => areaDe(c) > 0);
    const interiores = ciclos.filter((c) => areaDe(c) < 0).map((c) => c.reverse());
    for (const e of exteriores) resultado.push({ contorno: e, huecos: interiores.filter((h) => dentroDe(h[0]!, e)) });
  }
  return { losas: resultado, noReconocidos };
}

// ─── Ejes ───────────────────────────────────────────────────────────────────────────────────────

interface EjeLeido {
  a: P;
  b: P;
  nombre?: string;
}

function ejesDe(lineas: Float64Array, textos: readonly { x: number; y: number; texto: string }[]): EjeLeido[] {
  // Por rectas: la dirección (en [0°, 180°)) y la distancia al origen, al mm
  const rectas = new Map<string, { u: P; n: P; d: number; tramos: [number, number][] }>();
  for (let i = 0; i < lineas.length; i += 4) {
    const a: P = [mm(lineas[i]!), mm(lineas[i + 1]!)];
    const b: P = [mm(lineas[i + 2]!), mm(lineas[i + 3]!)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 2) continue;
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (ang < 0) ang += Math.PI;
    if (ang >= Math.PI - 1e-9) ang -= Math.PI;
    const angR = Math.round(((ang * 180) / Math.PI) * 1e4) / 1e4;
    const u: P = [Math.cos((angR * Math.PI) / 180), Math.sin((angR * Math.PI) / 180)];
    if (angR === 0) [u[0], u[1]] = [1, 0];
    if (angR === 90) [u[0], u[1]] = [0, 1];
    const n: P = [-u[1], u[0]];
    const d = mm(a[0] * n[0] + a[1] * n[1]);
    const k = `${angR}|${d}`;
    let r = rectas.get(k);
    if (!r) rectas.set(k, (r = { u, n, d, tramos: [] }));
    const [s0, s1] = [a[0] * u[0] + a[1] * u[1], b[0] * u[0] + b[1] * u[1]];
    r.tramos.push([Math.min(s0, s1), Math.max(s0, s1)]);
  }
  const ejes: EjeLeido[] = [];
  for (const r of rectas.values()) {
    r.tramos.sort((x, y) => x[0] - y[0]);
    const unidos: [number, number][] = [];
    for (const t of r.tramos) {
      const u = unidos[unidos.length - 1];
      if (u && t[0] <= u[1] + 0.01) u[1] = Math.max(u[1], t[1]);
      else unidos.push([...t]);
    }
    for (const [s0, s1] of unidos) {
      const p = (s: number): P => [mm(s * r.u[0] + r.d * r.n[0]), mm(s * r.u[1] + r.d * r.n[1])];
      ejes.push({ a: p(s0), b: p(s1) });
    }
  }
  // El nombre: el texto corto más cercano a un extremo
  const cortos = textos.filter((t) => /^[A-Za-z0-9'´’]{1,4}$/.test(t.texto.trim()));
  for (const e of ejes) {
    let mejor: { t: string; d: number } | null = null;
    for (const t of cortos)
      for (const p of [e.a, e.b]) {
        const d = Math.hypot(t.x - p[0], t.y - p[1]);
        if (d <= 1.5 && (!mejor || d < mejor.d)) mejor = { t: t.texto.trim(), d };
      }
    if (mejor) e.nombre = mejor.t;
  }
  return ejes;
}

// ─── Capas ──────────────────────────────────────────────────────────────────────────────────────

/** La plantilla con sólo unas capas a la vista, para colocar su geometría en el modelo. */
function conCapas(base: PlantillaDxf, d: DibujoDxf, capas: readonly string[]): PlantillaDxf {
  const ver = new Set(capas);
  return { ...base, ocultas: d.capas.map((c) => c.nombre).filter((n) => !ver.has(n)), redondeo: 0.001 };
}

const segmentosDe = (c: { lineas: Float64Array; curvas: Float64Array }): Float64Array => {
  const r = new Float64Array(c.lineas.length + c.curvas.length);
  r.set(c.lineas);
  r.set(c.curvas, c.lineas.length);
  return r;
};

/** Lo que hay en cada capa (para elegir) y las que se proponen. */
export function capasImportables(d: DibujoDxf, o: Pick<OpcionesImportar, "unidades" | "ladoMaximo" | "anchoTira"> = {}): { capas: CapaImportable[]; propuesta: InformeImportar["propuesta"] } {
  const base = plantillaBase(d, o.unidades);
  const ladoMaximo = o.ladoMaximo ?? 1.5;
  const capas = d.capas.map((c): CapaImportable => {
    const col = colocar(d, conCapas(base, d, [c.nombre]));
    const segs = segmentosDe(col);
    const n = segs.length / 4;
    let pilares = 0;
    let contornos = 0;
    let lineasLargas = 0;
    if (n > 0 && n <= 50_000) {
      pilares = pilaresDe(segs, ladoMaximo).formas.length;
      contornos = losasDe(segs, o.anchoTira ?? 0.5).losas.filter((l) => areaDe(l.contorno) > 10).length;
    }
    for (let i = 0; i < col.lineas.length; i += 4) if (Math.hypot(col.lineas[i + 2]! - col.lineas[i]!, col.lineas[i + 3]! - col.lineas[i + 1]!) >= 2) lineasLargas++;
    return { nombre: c.nombre, entidades: c.entidades, oculta: c.oculta, segmentos: n, textos: col.textos.length, pilares, contornos, lineasLargas };
  });
  const visibles = capas.filter((c) => !c.oculta && c.nombre.toLowerCase() !== "defpoints");
  const mejor = (f: (c: CapaImportable) => number, re: RegExp) => {
    const cs = visibles.filter((c) => f(c) > 0).sort((a, b) => Number(re.test(b.nombre)) - Number(re.test(a.nombre)) || f(b) - f(a));
    return cs[0]?.nombre;
  };
  const pilares = mejor((c) => c.pilares, /pilar|column|soport/i);
  const losas = mejor((c) => (c.nombre === pilares ? 0 : c.contornos), /forj|losa|contorn|estruct|cubiert|planta/i);
  const ejes = mejor((c) => (/eje|axis|grid|replant/i.test(c.nombre) ? c.lineasLargas : 0), /eje|axis|grid|replant/i);
  return { capas, propuesta: { ...(pilares ? { pilares } : {}), ...(losas ? { losas } : {}), ...(ejes ? { ejes } : {}) } };
}

function plantillaBase(d: DibujoDxf, unidades?: UnidadDxf, plantilla?: { fichero: string; sha256: string }, planta = "N1"): PlantillaDxf {
  const u = unidades ?? proponerUnidades(d);
  const tr = traslacionInicial(d, u);
  return { nombre: plantilla?.fichero.replace(/\.dxf$/i, "") ?? "DXF", fichero: plantilla?.fichero ?? "plano.dxf", sha256: plantilla?.sha256 ?? "0".repeat(64), unidades: u, ...(tr ? { traslacion: tr } : {}), plantas: [planta] };
}

// ─── Importar ───────────────────────────────────────────────────────────────────────────────────

export type ResultadoImportar = { ok: true; proyecto: Proyecto; informe: InformeImportar } | { ok: false; errores: string[]; informe?: Partial<InformeImportar> };

function material(id: string): Material | null {
  const t = MATERIALES_TIPICOS.find((m) => m.id === id);
  if (t) return t;
  const m = /^HA-(\d+(?:\.\d+)?)$/.exec(id);
  return m ? { id, tipo: "hormigon", fck: Number(m[1]) } : null;
}

export function importarDxf(dxf: Dxf, d: DibujoDxf, o: OpcionesImportar = {}): ResultadoImportar {
  const supuestos: string[] = [];
  const avisos: string[] = [];
  const errores: string[] = [];
  const { capas, propuesta } = capasImportables(d, o);
  const existe = new Set(d.capas.map((c) => c.nombre));
  const usar = (dadas: readonly string[] | undefined, prop: string | undefined, que: string): string[] => {
    if (dadas?.length) {
      for (const c of dadas) if (!existe.has(c)) errores.push(`No hay ninguna capa «${c}» en el DXF (${que}).`);
      return [...dadas];
    }
    if (prop) {
      supuestos.push(`Capa de ${que}: «${prop}», propuesta por lo que tiene y por su nombre (dar otra con --capa-${que}).`);
      return [prop];
    }
    return [];
  };
  const usadas = { pilares: usar(o.capasPilares, propuesta.pilares, "pilares"), losas: usar(o.capasLosas, propuesta.losas, "losas"), ejes: usar(o.capasEjes, propuesta.ejes, "ejes") };
  // Plantas
  const plantasDadas = o.plantas?.length ? o.plantas : (supuestos.push("Plantas: «Cim» a la cota 0 y «N1» a 3,00 m (dar las de verdad con --planta id:cota)."), [{ id: "Cim", cota: 0 }, { id: "N1", cota: 3 }]);
  const ordenadas = [...plantasDadas].sort((a, b) => b.cota - a.cota);
  if (ordenadas.length < 2) errores.push("Hacen falta al menos dos plantas (la cimentación y una encima).");
  if (new Set(ordenadas.map((p) => p.id)).size !== ordenadas.length) errores.push("Hay plantas con el mismo id.");
  const hayNegativas = ordenadas.some((p) => p.cota < 0);
  if (hayNegativas && !ordenadas.some((p) => p.cota === 0)) errores.push("Con plantas bajo la cota 0 (sótanos), tiene que haber una a la cota 0.");
  const plantaLosas = o.plantaLosas ?? ordenadas[0]?.id;
  if (plantaLosas && !ordenadas.some((p) => p.id === plantaLosas)) errores.push(`La planta de las losas, «${plantaLosas}», no está entre las plantas.`);
  const matId = o.material ?? (supuestos.push("Material: HA-25 (dar otro con --material)."), "HA-25");
  const mat = material(matId);
  if (!mat) errores.push(`Material desconocido «${matId}»: HA-25…HA-50, HA-<fck>, S235, S275 o S355.`);
  const espesor = o.espesor ?? 0.3;
  if (o.espesor === undefined && usadas.losas.length) supuestos.push("Espesor de las losas: 0,30 m (dar el de verdad con --espesor; un reticular o un unidireccional se completa después).");
  if (!(espesor > 0 && espesor < 3)) errores.push(`Espesor no válido: ${espesor} m.`);
  if (errores.length) return { ok: false, errores, informe: { capas, propuesta } };

  const unidades = o.unidades ?? proponerUnidades(d);
  const distintas = insunitsDistintas(d, unidades);
  if (distintas) avisos.push(`El DXF dice que está en ${UNIDADES[distintas].nombre} ($INSUNITS = ${d.insunits}), pero su tamaño es de un edificio en ${UNIDADES[unidades].nombre}: se lee en ${UNIDADES[unidades].nombre} (con --unidades se fuerza).`);
  if (!o.unidades && d.insunits === null) supuestos.push(`Unidades: ${UNIDADES[unidades].nombre}, por el tamaño del dibujo (el DXF no las dice; con --unidades se fuerzan).`);
  const base = plantillaBase(d, unidades, o.plantilla, plantaLosas);
  if (base.traslacion) avisos.push(`El plano está a más de 1 km del origen: se trae ${base.traslacion[0]}, ${base.traslacion[1]} m (la plantilla lleva la misma traslación).`);

  // Pilares
  const noReconocidos: NoReconocido[] = [];
  const colP = colocar(d, conCapas(base, d, usadas.pilares));
  const p = usadas.pilares.length ? pilaresDe(segmentosDe(colP), o.ladoMaximo ?? 1.5) : { formas: [], noReconocidos: [], sinMarca: 0 };
  noReconocidos.push(...p.noReconocidos);
  if (p.sinMarca) avisos.push(`${p.sinMarca} rectángulos de la capa de pilares sin cruz ni aspa en el centro no se toman como pilares, porque otros sí la tienen (los diez primeros, en noReconocidos).`);
  // Dos pilares en el mismo sitio (el mismo rectángulo en dos capas): uno
  const vistos = new Set<string>();
  const formas = p.formas.filter((f) => {
    const k = `${f.centro[0]},${f.centro[1]}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  const secciones: Seccion[] = [];
  const seccionDe = (f: FormaPilar): string => {
    const cm = (x: number) => String(Math.round(x * 1000) / 10).replace(/\.0$/, "");
    const id = f.forma === "rectangular" ? `P${cm(f.b)}x${cm(f.h)}` : `C${cm(f.D)}`;
    if (!secciones.some((s) => s.id === id)) secciones.push(f.forma === "rectangular" ? { id, material: matId, forma: "rectangular", b: f.b, h: f.h } : { id, material: matId, forma: "circular", D: f.D });
    return id;
  };
  const desde = ordenadas[ordenadas.length - 1]!.id;
  const pilares: Pilar[] = formas.map((f, i) => ({
    id: `P${i + 1}`,
    x: f.centro[0],
    y: f.centro[1],
    desde,
    hasta: plantaLosas!,
    seccion: seccionDe(f),
    ...(f.forma === "rectangular" && f.giro ? { giro: f.giro } : {}),
  }));
  if (usadas.pilares.length && !pilares.length) avisos.push(`No se reconoció ningún pilar en ${usadas.pilares.map((c) => `«${c}»`).join(", ")}.`);

  // Losas
  const colL = colocar(d, conCapas(base, d, usadas.losas));
  const l = usadas.losas.length ? losasDe(segmentosDe(colL), o.anchoTira ?? 0.5) : { losas: [], noReconocidos: [] };
  noReconocidos.push(...l.noReconocidos);
  const losas: Losa[] = l.losas.map((x, i) => ({ id: `L${i + 1}`, planta: plantaLosas!, contorno: x.contorno, ...(x.huecos.length ? { huecos: x.huecos } : {}), espesor, material: matId }));
  if (usadas.losas.length && !losas.length) avisos.push(`No se reconoció ningún contorno cerrado de losa en ${usadas.losas.map((c) => `«${c}»`).join(", ")}.`);

  // Ejes
  const colE = colocar(d, conCapas(base, d, usadas.ejes));
  const ejesLeidos = usadas.ejes.length ? ejesDe(colE.lineas, colE.textos) : [];
  const idsEjes = new Set<string>();
  const ejes: EjeReplanteo[] = ejesLeidos.map((e, i) => {
    let id = e.nombre ?? `E${i + 1}`;
    for (let k = 2; idsEjes.has(id) || /^(P|L)\d+$/.test(id) || id === matId || ordenadas.some((x) => x.id === id) || secciones.some((s) => s.id === id); k++) id = `${e.nombre ?? "E"}-${k}`;
    idsEjes.add(id);
    return { id, desde: e.a, hasta: e.b };
  });

  // Plantas
  const plantas: Planta[] = ordenadas.map((x, i) => ({ id: x.id, altura: i === 0 ? null : mm(ordenadas[i - 1]!.cota - x.cota), ...(x.cota < 0 ? { tipo: "sotano" as const } : {}) }));
  if (!hayNegativas && ordenadas[ordenadas.length - 1]!.cota !== 0) avisos.push(`La planta más baja está a ${ordenadas[ordenadas.length - 1]!.cota} m: las cotas del modelo se cuentan desde ella (la ±0,00).`);

  let proyecto: Proyecto = {
    esquema: VERSION_ESQUEMA,
    ...(o.nombre ? { nombre: o.nombre } : {}),
    modelo: {
      plantas,
      materiales: [mat!],
      secciones,
      ...(pilares.length ? { pilares } : {}),
      ...(losas.length ? { losas } : {}),
      // Sólo el peso propio: las demás cargas y casos los pone el agente con lo que le digan
      casos: [{ id: "G", nombre: "Permanentes", pesoPropio: true, accion: { tipo: "G" } }],
      ...(ejes.length ? { ejes } : {}),
    },
    ...(o.plantilla ? { plantillas: [{ ...base, plantas: [plantaLosas!] }] } : {}),
  };
  // Ids por su posición en planta, como «Renumerar»
  const r = aplicar(proyecto, { op: "renumerar", colecciones: ["pilares", "losas"] });
  if (r.ok) proyecto = r.proyecto;
  else avisos.push(`No se pudo renumerar: ${r.errores[0]?.mensaje ?? ""}`);

  // Cotas
  const cotas = comprobarCotas(dxf, base, proyecto);
  if (cotas.total && !cotas.cuadran) avisos.push(`Ninguna de las ${cotas.total} cotas cae en lo reconocido: revisar las unidades (${UNIDADES[unidades].nombre}) y las capas.`);

  const porSeccion = new Map<string, number>();
  for (const x of proyecto.modelo.pilares ?? []) porSeccion.set(x.seccion, (porSeccion.get(x.seccion) ?? 0) + 1);
  return {
    ok: true,
    proyecto,
    informe: {
      unidades,
      insunits: d.insunits,
      ...(base.traslacion ? { traslacion: base.traslacion } : {}),
      capas,
      propuesta,
      usadas,
      pilares: { n: proyecto.modelo.pilares?.length ?? 0, secciones: [...porSeccion].map(([id, n]) => ({ id, n })) },
      losas: (proyecto.modelo.losas ?? []).map((x) => ({ id: x.id, area: Number(areaDe(x.contorno as P[]).toFixed(3)), vertices: x.contorno.length, huecos: x.huecos?.length ?? 0 })),
      ejes: (proyecto.modelo.ejes ?? []).map((e) => ({ id: e.id })),
      cotas,
      noReconocidos,
      supuestos,
      avisos,
    },
  };
}

/** Las cotas lineales del DXF frente a lo reconocido. */
function comprobarCotas(dxf: Dxf, base: PlantillaDxf, p: Proyecto): InformeImportar["cotas"] {
  const tr = transformacion(base);
  const f = UNIDADES[base.unidades].aM;
  const puntos: P[] = [];
  const tramos: [P, P][] = [];
  for (const x of p.modelo.pilares ?? []) {
    puntos.push([x.x, x.y]);
    const s = p.modelo.secciones.find((y) => y.id === x.seccion);
    if (s?.forma === "rectangular") {
      const g = ((x.giro ?? 0) * Math.PI) / 180;
      const [c, sn] = [Math.cos(g), Math.sin(g)];
      const esq = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([i, j]): P => [x.x + (i! * s.h * c) / 2 - (j! * s.b * sn) / 2, x.y + (i! * s.h * sn) / 2 + (j! * s.b * c) / 2]);
      puntos.push(...esq);
      esq.forEach((q, i) => tramos.push([q, esq[(i + 1) % 4]!]));
    } else if (s?.forma === "circular") for (let k = 0; k < 4; k++) puntos.push([x.x + (s.D / 2) * Math.cos((k * Math.PI) / 2), x.y + (s.D / 2) * Math.sin((k * Math.PI) / 2)]);
  }
  for (const e of p.modelo.ejes ?? []) tramos.push([e.desde as P, e.hasta as P]);
  for (const l of p.modelo.losas ?? []) for (const anillo of [l.contorno, ...(l.huecos ?? [])]) anillo.forEach((q, i) => (puntos.push(q as P), tramos.push([q as P, anillo[(i + 1) % anillo.length] as P])));
  const cerca = (q: P) => {
    if (puntos.some((x) => Math.hypot(x[0] - q[0], x[1] - q[1]) <= 0.01)) return true;
    return tramos.some(([a, b]) => {
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
      return Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1]) <= 0.01;
    });
  };
  let total = 0;
  let cuadran = 0;
  const noCuadran: InformeImportar["cotas"]["noCuadran"] = [];
  for (const e of dxf.entidades) {
    if (e.tipo !== "DIMENSION" || !tiene(e, 13) || !tiene(e, 14)) continue;
    const tipo = num(e, 70) & 7;
    if (tipo !== 0 && tipo !== 1) continue;
    total++;
    const a = tr(num(e, 13), num(e, 23));
    const b = tr(num(e, 14), num(e, 24));
    const valor = tiene(e, 42) ? mm(f(num(e, 42))) : mm(Math.hypot(b[0] - a[0], b[1] - a[1]));
    if (cerca([a[0], a[1]]) && cerca([b[0], b[1]])) cuadran++;
    else if (noCuadran.length < 10) {
      const t = texto(e, 1);
      noCuadran.push({ valor, ...(t && t !== "<>" ? { texto: t } : {}), a: [mm(a[0]), mm(a[1])], b: [mm(b[0]), mm(b[1])] });
    }
  }
  return { total, cuadran, noCuadran };
}
