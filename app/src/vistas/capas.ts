/**
 * Las capas de una escena preparada (`src/visor/escena.ts`) como objetos de Three.js (I2,
 * `docs/fem3d/interfaz.md` §14): un relleno y un trazo por capa, en el orden de la escena.
 *
 * - Relleno por stencil, sin triangular: los abanicos de la capa suben y bajan el stencil según su
 *   sentido (nonzero; `src/visor/escena.ts` orienta los anillos de las áreas); después, el
 *   rectángulo de la capa pinta donde el stencil no es 0 y lo deja a 0.
 * - Trazo con grosor en píxeles (`LineSegments2`, MIT), y las rayas en píxeles: `dashScale` es la
 *   escala (px/m) en cada encuadre.
 *
 * Todo va a la lista de transparentes con `renderOrder` creciente y sin profundidad, así que se
 * pinta en el orden de la escena, como el SVG.
 *
 * Los materiales son de la página (`MATERIALES`): uno por clase de relleno o de trazo y color, no
 * uno por capa, y no se liberan nunca (I2-4):
 * - un material nuevo cuesta en Three.js (sus parámetros, su programa y, en `LineMaterial`, la copia
 *   de sus uniformes): con los diagramas de las vigas, que alternan estilos, eran cientos;
 * - Three.js borra un programa cuando se liberan todos sus materiales, y volver a compilarlo al
 *   entrar en otro modo esperaba al driver en mitad de un fotograma (> 50 ms).
 * Son pocos (los estilos de A4 y los colores de las bandas), y lo que depende de cada vista (la
 * resolución y la escala de las rayas) se pone antes de pintarla.
 */
import {
  AlwaysStencilFunc,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DecrementWrapStencilOp,
  DoubleSide,
  FrontSide,
  Group,
  IncrementWrapStencilOp,
  KeepStencilOp,
  Mesh,
  MeshBasicMaterial,
  NotEqualStencilFunc,
  ZeroStencilOp,
  type Side,
  type StencilOp,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { Capa, EscenaPreparada } from "../../../src/visor/escena.ts";
import { pintura } from "../lienzo/pintura.ts";
import type { Theme } from "../tema/types.ts";

/** De x, y por vértice a x, y, z (z = 0). */
function a3D(xy: Float32Array): Float32Array {
  const r = new Float32Array((xy.length / 2) * 3);
  for (let i = 0, j = 0; i < xy.length; i += 2, j += 3) {
    r[j] = xy[i]!;
    r[j + 1] = xy[i + 1]!;
  }
  return r;
}

function geometria(pos: Float32Array): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  return g;
}

/** Materiales compartidos por clase y color. */
export class Materiales {
  private readonly m = new Map<string, MeshBasicMaterial | LineMaterial>();

  private de<T extends MeshBasicMaterial | LineMaterial>(clave: string, crear: () => T): T {
    let x = this.m.get(clave) as T | undefined;
    if (!x) this.m.set(clave, (x = crear()));
    return x;
  }

  /** El que escribe en el stencil: sube por delante y baja por detrás (nonzero). */
  escribir(side: Side, op: StencilOp): MeshBasicMaterial {
    return this.de(`e${side}|${op}`, () => new MeshBasicMaterial({ colorWrite: false, depthTest: false, depthWrite: false, transparent: true, side, stencilWrite: true, stencilFunc: AlwaysStencilFunc, stencilRef: 0, stencilZPass: op, stencilZFail: op, stencilFail: KeepStencilOp }));
  }

  /** El que pinta donde el stencil no es 0 y lo deja a 0. */
  tapa(color: string, opacidad: number): MeshBasicMaterial {
    return this.de(`t${color}|${opacidad}`, () => new MeshBasicMaterial({ color: new Color(color), opacity: opacidad, transparent: true, depthTest: false, depthWrite: false, side: DoubleSide, stencilWrite: true, stencilFunc: NotEqualStencilFunc, stencilRef: 0, stencilZPass: ZeroStencilOp, stencilZFail: ZeroStencilOp, stencilFail: KeepStencilOp }));
  }

  linea(color: string, grosor: number, raya: [number, number] | undefined, opacidad: number): LineMaterial {
    return this.de(`l${color}|${grosor}|${raya?.join(",") ?? ""}|${opacidad}`, () => new LineMaterial({ color: new Color(color).getHex(), linewidth: grosor, worldUnits: false, transparent: true, opacity: opacidad, depthTest: false, depthWrite: false, dashed: !!raya, dashSize: raya?.[0] ?? 1, gapSize: raya?.[1] ?? 1 }));
  }

  /** Lo que depende del encuadre: la resolución de las líneas (px) y la escala de las rayas (px/m). */
  encuadre(ancho: number, alto: number, escala: number): void {
    for (const x of this.m.values())
      if (x instanceof LineMaterial) {
        x.resolution.set(ancho, alto);
        if (x.dashed) x.dashScale = escala;
      }
  }

  liberar(): void {
    for (const x of this.m.values()) x.dispose();
    this.m.clear();
  }
}

/** Los de la página: nunca se liberan (así sus programas de WebGL tampoco). */
export const MATERIALES = new Materiales();

/** Un relleno por stencil: los abanicos (nonzero) y el rectángulo que cubre. */
export function relleno(abanicos: Float32Array, caja: readonly [number, number, number, number], color: string, opacidad: number, orden: { n: number }, mat: Materiales): Mesh[] {
  if (!abanicos.length) return [];
  const g = geometria(a3D(abanicos));
  const escribir = (side: Side, op: StencilOp) => {
    const m = new Mesh(g, mat.escribir(side, op));
    m.renderOrder = orden.n++;
    m.frustumCulled = false;
    return m;
  };
  const r = [escribir(FrontSide, IncrementWrapStencilOp), escribir(BackSide, DecrementWrapStencilOp)];
  const [x0, y0, x1, y1] = caja;
  const tapa = new Mesh(geometria(new Float32Array([x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0])), mat.tapa(color, opacidad));
  tapa.renderOrder = orden.n++;
  tapa.frustumCulled = false;
  r.push(tapa);
  return r;
}

/** Unos segmentos (x0, y0, x1, y1) con grosor en px; `raya` = [trazo, hueco] en px. */
export function trazo(segmentos: Float32Array, color: string, grosor: number, orden: { n: number }, mat: Materiales, raya?: [number, number], opacidad = 1): LineSegments2 | null {
  if (!segmentos.length) return null;
  const g = new LineSegmentsGeometry();
  g.setPositions(a3D(segmentos));
  const l = new LineSegments2(g, mat.linea(color, grosor, raya, opacidad));
  if (raya) l.computeLineDistances();
  l.renderOrder = orden.n++;
  l.frustumCulled = false;
  return l;
}

/** «14 3 2 3» → [14, 8]: el trazo y lo demás como hueco (el punto de un trazo y punto no se dibuja). */
export function raya(dash: string | undefined): [number, number] | undefined {
  if (!dash) return undefined;
  const n = dash.split(/[\s,]+/).map(Number).filter((x) => Number.isFinite(x) && x > 0);
  if (n.length < 2) return undefined;
  return [n[0]!, n.slice(1).reduce((a, b) => a + b, 0)];
}

/** Los objetos de Three.js de una escena preparada, en su orden, con lo que cambia con el encuadre. */
export class Capas2D {
  readonly grupo = new Group();
  private readonly mat = MATERIALES;

  constructor(e: EscenaPreparada, tema: Theme, orden: { n: number }) {
    for (const c of e.capas) this.capa(c, tema, orden);
  }

  private capa(c: Capa, tema: Theme, orden: { n: number }): void {
    const p = pintura(c.estilo, tema);
    if (c.forma !== "trazo") {
      const color = c.relleno ?? p.fill;
      if (color && color !== "none") for (const m of relleno(c.abanicos, c.caja, color, p.opacity ?? 1, orden, this.mat)) this.grupo.add(m);
    }
    // Las bandas, con un trazo de su color que tapa las juntas del antialias (como el SVG de V1)
    const color = c.forma === "region" ? c.relleno : p.stroke;
    const grosor = c.forma === "region" ? 0.6 : (p.sw ?? 1);
    if (!color) return;
    const l = trazo(c.segmentos, color, grosor, orden, this.mat, raya(p.dash));
    if (l) this.grupo.add(l);
  }

  /** Lo que depende del encuadre: la resolución de las líneas (px) y la escala de las rayas (px/m). */
  encuadre(ancho: number, alto: number, escala: number): void {
    this.mat.encuadre(ancho, alto, escala);
  }

  /** Libera las geometrías; los materiales son de la página. */
  liberar(): void {
    this.grupo.traverse((o) => (o as Mesh).geometry?.dispose());
    this.grupo.clear();
  }
}
