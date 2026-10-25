/**
 * El fondo de las vistas: lo que dice dónde está el espacio aunque no haya nada dibujado.
 *
 * - Planta y alzado: una rejilla que sigue a la escala (paso de 1, 2 o 5 × 10ⁿ m, con las líneas
 *   mayores cada 5 o 10 m y las menores que aparecen al acercar) y los dos ejes del origen, en rojo
 *   (X) y verde (Y), como en AutoCAD; en el lienzo 2D, el icono de los ejes en el origen (o en la
 *   esquina, si el origen no se ve).
 * - 3D: un suelo con rejilla en la cota más baja del modelo, que se desvanece hacia sus bordes, con
 *   los ejes X e Y del origen y un trípode con Z; detrás, un degradado suave (más claro arriba).
 *
 * Todo va detrás de lo dibujado (WebGL, `renderOrder` negativo y sin escribir profundidad) y es
 * tenue (más aún en una planta con algo dibujado); en Resultados (`tenue`), sólo las líneas mayores y más tenues aún, para no competir con
 * los mapas. F7 (o el botón de la vista) lo quita.
 *
 * Los materiales son de la página y no se liberan (I2-4); `renderer.ts` los precalienta.
 */
import { BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, OrthographicCamera, Scene, SRGBColorSpace, type WebGLRenderer } from "three";
import type { Theme } from "../tema/types.ts";

/** Lo que se encuadra en una vista sin nada dibujado, m: el origen abajo a la izquierda. */
export const CAJA_VACIA: readonly [number, number, number, number] = [-2, -2, 22, 16];
/** El menor ancho del encuadre automático, m (un pilar solo no llena la vista). */
export const ENCUADRE_MINIMO = 6;

/** Los colores de los ejes por tema: X rojo, Y verde, Z azul (los del ViewCube). */
export const COLORES_EJES: Record<Theme, { x: string; y: string; z: string }> = {
  light: { x: "#dc2626", y: "#16a34a", z: "#2563eb" },
  dark: { x: "#f87171", y: "#4ade80", z: "#60a5fa" },
};

/** Opacidades de las líneas (menores, mayores y ejes), normal y en Resultados. */
const ALFA_2D = { normal: { menor: 0.07, mayor: 0.13, eje: 0.45 }, tenue: { menor: 0, mayor: 0.07, eje: 0.22 } };
const ALFA_3D = { normal: { menor: 0.1, mayor: 0.2, eje: 0.55 }, tenue: { menor: 0, mayor: 0.11, eje: 0.3 } };

/** Separación mínima de las líneas menores en pantalla, px, y desde la que se ven enteras. */
const PX_MENOR = { aparece: 18, entera: 56 };
/** Con algo dibujado, la rejilla de la planta baja a esta fracción (los ejes no). */
const CON_DIBUJO = 0.55;

/** El número «redondo» (1, 2 o 5 × 10ⁿ) más pequeño que no baja de x. */
export function redondo(x: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  for (const k of [1, 2, 5, 10]) if (k * p >= x * (1 - 1e-9)) return k * p;
  return 10 * p;
}

/** Las mayores de un paso: cada 5 (pasos de 1 y 2) o cada 2 (pasos de 5), así que caen en 5 y 10 × 10ⁿ. */
const mayorDe = (menor: number) => (Math.round(menor / Math.pow(10, Math.floor(Math.log10(menor) + 1e-9))) === 5 ? 2 * menor : 5 * menor);

/** El paso de la rejilla de una vista plana con su escala (px/m), y cuánto se ven las menores (0–1). */
export function pasoRejilla(escala: number): { menor: number; mayor: number; alfaMenor: number } {
  const menor = redondo(PX_MENOR.aparece / escala);
  const px = menor * escala;
  return { menor, mayor: mayorDe(menor), alfaMenor: Math.max(0, Math.min(1, (px - PX_MENOR.aparece) / (PX_MENOR.entera - PX_MENOR.aparece))) };
}

/** Líneas con color y opacidad por vértice, que crecen cuando hace falta. */
class Lineas {
  readonly objeto: LineSegments<BufferGeometry, LineBasicMaterial>;
  private pos = new Float32Array(0);
  private col = new Float32Array(0);
  private n = 0;

  constructor(material: LineBasicMaterial) {
    this.objeto = new LineSegments(new BufferGeometry(), material);
    this.objeto.renderOrder = -1000;
    this.objeto.frustumCulled = false;
  }

  empezar(segmentos: number): void {
    if (this.pos.length < segmentos * 6) {
      const cap = Math.max(256, Math.ceil(segmentos * 1.5));
      this.pos = new Float32Array(cap * 6);
      this.col = new Float32Array(cap * 8);
      const g = this.objeto.geometry;
      g.setAttribute("position", new BufferAttribute(this.pos, 3));
      g.setAttribute("color", new BufferAttribute(this.col, 4));
    }
    this.n = 0;
  }

  /** Un segmento con el color c y las opacidades a0 y a1 en sus extremos. */
  poner(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: Color, a0: number, a1 = a0): void {
    if (this.n * 6 >= this.pos.length) return;
    const p = this.n * 6;
    const q = this.n * 8;
    this.pos.set([x0, y0, z0, x1, y1, z1], p);
    this.col.set([c.r, c.g, c.b, a0, c.r, c.g, c.b, a1], q);
    this.n++;
  }

  terminar(): void {
    const g = this.objeto.geometry;
    g.setDrawRange(0, this.n * 2);
    const [p, c] = [g.getAttribute("position"), g.getAttribute("color")];
    if (p) p.needsUpdate = true;
    if (c) c.needsUpdate = true;
    this.objeto.visible = this.n > 0;
  }

  get segmentos(): number {
    return this.n;
  }
}

/** El material de las líneas del fondo (de la página: no se libera). */
export const MATERIAL_LINEAS = new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
/** El del degradado del 3D. */
export const MATERIAL_DEGRADADO = new MeshBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false });

const color = (css: string) => new Color().setStyle(css);

/** La rejilla de una vista plana (planta o alzado). Coordenadas respecto al origen de la escena. */
export class Rejilla2D {
  private readonly l = new Lineas(MATERIAL_LINEAS);

  get objeto(): LineSegments {
    return this.l.objeto;
  }

  /**
   * Las líneas que caen en lo que se ve (`caja`, m del modelo) con la escala dada (px/m), respecto
   * a `origen` (el de las capas de la escena).
   */
  actualizar(caja: readonly [number, number, number, number], origen: readonly [number, number], escala: number, base: string, tema: Theme, tenue: boolean, vacia: boolean): void {
    const [x0, y0, x1, y1] = caja;
    const { menor, mayor, alfaMenor } = pasoRejilla(escala);
    const T = tenue ? ALFA_2D.tenue : ALFA_2D.normal;
    const f = vacia ? 1 : CON_DIBUJO;
    const A = { menor: T.menor * f, mayor: T.mayor * f, eje: T.eje };
    const menores = A.menor * alfaMenor > 0.004;
    const paso = menores ? menor : mayor;
    const [i0, i1, j0, j1] = [Math.ceil(x0 / paso), Math.floor(x1 / paso), Math.ceil(y0 / paso), Math.floor(y1 / paso)];
    const cuantas = i1 - i0 + 1 + (j1 - j0 + 1);
    this.l.empezar(Math.max(0, Math.min(cuantas, 4000)));
    if (cuantas > 4000) return this.l.terminar();
    const cb = color(base);
    const ejes = COLORES_EJES[tema];
    const [cx, cy] = [color(ejes.x), color(ejes.y)];
    const k = Math.round(mayor / paso);
    const [ox, oy] = origen;
    const linea = (i: number, vertical: boolean) => {
      const v = i * paso;
      const eje = i === 0;
      const esMayor = i % k === 0;
      const a = eje ? A.eje : esMayor ? A.mayor : A.menor * alfaMenor;
      // El eje X es la recta y = 0 (horizontal); el Y, x = 0 (vertical)
      const c = eje ? (vertical ? cy : cx) : cb;
      if (vertical) this.l.poner(v - ox, y0 - oy, 0, v - ox, y1 - oy, 0, c, a);
      else this.l.poner(x0 - ox, v - oy, 0, x1 - ox, v - oy, 0, c, a);
    };
    // Primero las menores, luego las mayores y los ejes encima
    for (const pasada of [0, 1, 2])
      for (const [a0, a1, vertical] of [
        [i0, i1, true],
        [j0, j1, false],
      ] as const)
        for (let i = a0; i <= a1; i++) {
          const nivel = i === 0 ? 2 : i % k === 0 ? 1 : 0;
          if (nivel === pasada) linea(i, vertical);
        }
    this.l.terminar();
  }

  ocultar(): void {
    this.l.objeto.visible = false;
  }
}

/** El icono de los ejes: en el origen, con su cuadradito, o en la esquina de la vista. */
export function iconoEjes(ctx: CanvasRenderingContext2D, x: number, y: number, enOrigen: boolean, nombres: readonly [string, string], tema: Theme, halo: string, tenue: boolean): void {
  const c = COLORES_EJES[tema];
  const L = 30;
  ctx.save();
  ctx.globalAlpha = tenue ? 0.45 : 0.8;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const flecha = (dx: number, dy: number, col: string, nombre: string) => {
    const [ex, ey] = [x + dx * L, y + dy * L];
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ex, ey);
    // La punta
    const [nx, ny] = [-dy, dx];
    ctx.moveTo(ex - dx * 6 + nx * 3.5, ey - dy * 6 + ny * 3.5);
    ctx.lineTo(ex, ey);
    ctx.lineTo(ex - dx * 6 - nx * 3.5, ey - dy * 6 - ny * 3.5);
    ctx.stroke();
    if (!nombre) return;
    ctx.font = `600 10px Geist, "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = halo;
    const [tx, ty] = [ex + dx * 9, ey + dy * 9];
    ctx.strokeText(nombre, tx, ty);
    ctx.fillStyle = col;
    ctx.fillText(nombre, tx, ty);
    ctx.lineWidth = 1.5;
  };
  flecha(1, 0, c.x, nombres[0]);
  flecha(0, -1, c.y, nombres[1]);
  if (enOrigen) {
    ctx.strokeStyle = c.x;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
  }
  ctx.restore();
}

/**
 * El suelo del 3D: la rejilla en el plano z (la cota más baja), en una caja (xmin, ymin, xmax, ymax,
 * m del modelo) con margen alrededor, que se desvanece hacia los bordes. Respecto a `origen`.
 */
export class Suelo3D {
  private readonly l = new Lineas(MATERIAL_LINEAS);
  private clave = "";
  /** Lo que mide la pata de cada eje del trípode, m (para rotularlos). */
  pata = 0;
  /** El origen cae en el suelo. */
  conOrigen = false;
  /** La cota del suelo, m. */
  z = 0;

  constructor() {
    // Detrás de lo que tapa, pero sin escribir profundidad
    this.l.objeto.renderOrder = -1000;
  }

  get objeto(): LineSegments {
    return this.l.objeto;
  }

  actualizar(caja: readonly [number, number, number, number], z: number, origen: readonly [number, number, number], base: string, tema: Theme, tenue: boolean): void {
    const clave = [...caja, z, ...origen, base, tema, tenue].join("|");
    if (clave === this.clave) return;
    this.clave = clave;
    this.z = z;
    const [a0, b0, a1, b1] = caja;
    const span = Math.max(a1 - a0, b1 - b0, 1);
    const m = Math.max(4, 0.35 * span);
    const [cx, cy] = [(a0 + a1) / 2, (b0 + b1) / 2];
    const paso = redondo(Math.max(1, (span + 2 * m) / 28));
    const mayor = mayorDe(paso);
    const k = Math.round(mayor / paso);
    // Media caja, a pasos enteros, cuadrada por fuera del modelo
    const hx = Math.ceil(((a1 - a0) / 2 + m) / paso) * paso;
    const hy = Math.ceil(((b1 - b0) / 2 + m) / paso) * paso;
    const [x0, x1, y0, y1] = [Math.floor((cx - hx) / paso) * paso, Math.ceil((cx + hx) / paso) * paso, Math.floor((cy - hy) / paso) * paso, Math.ceil((cy + hy) / paso) * paso];
    const A = tenue ? ALFA_3D.tenue : ALFA_3D.normal;
    const cb = color(base);
    const ejes = COLORES_EJES[tema];
    const [cX, cY, cZ] = [color(ejes.x), color(ejes.y), color(ejes.z)];
    // Desvanecido: entero hasta el 55 % del radio, nada en el borde
    const fade = (x: number, y: number) => {
      const d = Math.hypot((x - cx) / ((x1 - x0) / 2), (y - cy) / ((y1 - y0) / 2));
      const t = Math.max(0, Math.min(1, (d - 0.55) / 0.45));
      return 1 - t * t * (3 - 2 * t);
    };
    const [nx, ny] = [Math.round((x1 - x0) / paso), Math.round((y1 - y0) / paso)];
    this.l.empezar((nx + 1) * ny + (ny + 1) * nx + 1);
    const zz = z - origen[2] - 0.02;
    const [ox, oy] = [origen[0], origen[1]];
    this.conOrigen = x0 < 0 && 0 < x1 && y0 < 0 && 0 < y1;
    for (const pasada of [0, 1, 2])
      for (const vertical of [true, false]) {
        const [n, ntramos] = vertical ? [nx, ny] : [ny, nx];
        for (let i = 0; i <= n; i++) {
          const v = (vertical ? x0 : y0) + i * paso;
          const idx = Math.round(v / paso);
          const eje = idx === 0;
          const nivel = eje ? 2 : idx % k === 0 ? 1 : 0;
          if (nivel !== pasada) continue;
          const a = eje ? A.eje : nivel ? A.mayor : A.menor;
          if (a <= 0) continue;
          const c = eje ? (vertical ? cY : cX) : cb;
          for (let j = 0; j < ntramos; j++) {
            const w0 = (vertical ? y0 : x0) + j * paso;
            const w1 = w0 + paso;
            const [p0, p1]: [[number, number], [number, number]] = vertical ? [[v, w0], [v, w1]] : [[w0, v], [w1, v]];
            const [f0, f1] = [fade(...p0), fade(...p1)];
            if (f0 <= 0 && f1 <= 0) continue;
            this.l.poner(p0[0] - ox, p0[1] - oy, zz, p1[0] - ox, p1[1] - oy, zz, c, a * f0, a * f1);
          }
        }
      }
    // El trípode: la pata Z, del suelo hacia arriba
    this.pata = 2 * paso;
    if (this.conOrigen) this.l.poner(-ox, -oy, zz, -ox, -oy, zz + this.pata, cZ, A.eje, A.eje * 0.6);
    this.l.terminar();
  }

  /** Los rótulos de los ejes en sus puntas, en el lienzo 2D (`aPantalla`: del modelo a px). */
  rotular(ctx: CanvasRenderingContext2D, aPantalla: (x: number, y: number, z: number) => [number, number] | null, tema: Theme, halo: string, tenue: boolean): void {
    if (!this.conOrigen || !this.l.segmentos) return;
    const c = COLORES_EJES[tema];
    ctx.save();
    ctx.globalAlpha = tenue ? 0.5 : 0.85;
    ctx.font = `600 10px Geist, "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const [p, t, col] of [
      [[this.pata, 0, this.z], "X", c.x],
      [[0, this.pata, this.z], "Y", c.y],
      [[0, 0, this.z + this.pata], "Z", c.z],
    ] as const) {
      const q = aPantalla(p[0], p[1], p[2]);
      if (!q) continue;
      ctx.lineWidth = 3;
      ctx.strokeStyle = halo;
      ctx.strokeText(t, q[0], q[1]);
      ctx.fillStyle = col;
      ctx.fillText(t, q[0], q[1]);
    }
    ctx.restore();
  }
}

/** El degradado detrás del 3D: un poco más claro arriba y más oscuro abajo que el fondo. */
export class Degradado {
  private readonly escena = new Scene();
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, -1, 1);
  private readonly col = new Float32Array(12);
  private clave = "";

  constructor() {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setAttribute("color", new BufferAttribute(this.col, 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const m = new Mesh(g, MATERIAL_DEGRADADO);
    m.frustumCulled = false;
    this.escena.add(m);
  }

  pintar(r: WebGLRenderer, fondo: string, tema: Theme): void {
    const clave = `${fondo}|${tema}`;
    if (clave !== this.clave) {
      this.clave = clave;
      const hsl = { h: 0, s: 0, l: 0 };
      const f = color(fondo);
      f.getHSL(hsl, SRGBColorSpace);
      const [arriba, abajo] = tema === "dark" ? [0.035, -0.015] : [0.03, -0.035];
      const sup = new Color().setHSL(hsl.h, hsl.s, Math.min(1, hsl.l + arriba), SRGBColorSpace);
      const inf = new Color().setHSL(hsl.h, hsl.s, Math.max(0, hsl.l + abajo), SRGBColorSpace);
      this.col.set([inf.r, inf.g, inf.b, inf.r, inf.g, inf.b, sup.r, sup.g, sup.b, sup.r, sup.g, sup.b]);
      (this.escena.children[0] as Mesh).geometry.getAttribute("color").needsUpdate = true;
    }
    r.render(this.escena, this.cam);
  }
}
