/**
 * Vista 2D (planta o alzado, I2): una escena preparada de A4 con cámara ortográfica. La geometría va
 * en WebGL (`capas.ts`); los glifos, los rótulos y lo elegido que tiene tamaño en píxeles, en el
 * lienzo 2D de encima, recolocados en cada fotograma.
 *
 * El encuadre es el centro (m) y la escala (px/m). Al cambiar de escena se conserva si lo que se veía
 * sigue cayendo en la nueva (cambiar de planta no mueve el dibujo, como en CYPECAD); si no, se
 * encuadra la escena entera.
 */
import { Group, OrthographicCamera, Scene, type WebGLRenderer } from "three";
import { rotulo, type Texto, type Vec2 } from "../../../src/agente/render/escena.ts";
import { rotulosLineas } from "../../../src/agente/render/isovalores.ts";
import type { Eleccion, EscenaPreparada, Glifo } from "../../../src/visor/escena.ts";
import { pintura } from "../lienzo/pintura.ts";
import { Capas2D, MATERIALES, relleno, trazo } from "./capas.ts";
import { fuente, textoConHalo, Vista, type Entorno } from "./motor.ts";
import { colocarRotulos, ralearBurbujas } from "./rotulos.ts";

export interface Marca {
  p: Vec2;
  texto?: string;
}

export interface Eventos2D {
  /** Un clic (o doble clic) en el punto p (m), con la tolerancia de elegir en m. */
  clic?: (p: Vec2, radio: number, ctrl: boolean, doble: boolean) => void;
  /** Una ventana de elegir, en m. */
  ventana?: (caja: [number, number, number, number], modo: "dentro" | "toca", ctrl: boolean) => void;
}

export interface Camara2D {
  cx: number;
  cy: number;
  escala: number;
}

/** Márgenes del encuadre completo, px: el carril de plantas, la cabecera y la barra de la vista. */
export interface Margenes {
  izq: number;
  arriba: number;
  der: number;
  abajo: number;
}

/** Radio de elección, px. */
const RADIO_CLIC = 6;

export class Vista2D extends Vista {
  private readonly escena3 = new Scene();
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
  private escena: EscenaPreparada | null = null;
  private capas: Capas2D | null = null;
  private resaltado: Eleccion | null = null;
  private resaltadoG: Group | null = null;
  private readonly matResaltado = MATERIALES;
  private marcas: Marca[] = [];
  private elegidos: ReadonlySet<string> = new Set();
  private cx = 0;
  private cy = 0;
  private s = 0;
  private encuadrada = false;
  margenes: Margenes = { izq: 24, arriba: 24, der: 24, abajo: 24 };
  eventos: Eventos2D = {};
  /** Texto del cursor para la barra de estado (planta: x, y; alzado: u, z). */
  formatoCursor: (q: Vec2) => string = (q) => `x ${rotulo(q[0], 4)} · y ${rotulo(q[1], 4)} m`;
  /** Rótulos que no cupieron en el último fotograma. */
  omitidos = 0;
  private temaCapas: string | null = null;
  /** Los rótulos de las isolíneas de la escena, con la escala en que se colocaron. */
  private isolineas: { lineas: EscenaPreparada["lineasRotuladas"]; s: number; textos: Texto[] } | null = null;

  constructor(entorno: Entorno, camara?: Camara2D | null) {
    super(entorno);
    if (camara && camara.escala > 0) {
      ({ cx: this.cx, cy: this.cy, escala: this.s } = camara);
      this.encuadrada = true;
    }
  }

  get escala(): number {
    return this.s;
  }

  camara(): Camara2D {
    return { cx: this.cx, cy: this.cy, escala: this.s };
  }

  /** Del modelo a px de la vista, y al revés. */
  aPx(q: Vec2): [number, number] {
    return [(q[0] - this.cx) * this.s + this.rect.w / 2, this.rect.h / 2 - (q[1] - this.cy) * this.s];
  }

  aModelo(x: number, y: number): Vec2 {
    return [this.cx + (x - this.rect.w / 2) / this.s, this.cy - (y - this.rect.h / 2) / this.s];
  }

  ponerEscena(e: EscenaPreparada | null): void {
    if (e === this.escena) return;
    this.escena = e;
    this.reconstruir();
    if (!e) return this.entorno.pintar();
    if (!this.encuadrada || this.s <= 0 || this.ajustada) this.encuadrar();
    else {
      // ¿Se sigue viendo algo de la escena nueva?
      const [x0, y0] = this.aModelo(0, this.rect.h);
      const [x1, y1] = this.aModelo(this.rect.w, 0);
      const [a0, b0, a1, b1] = e.caja;
      if (a1 < x0 || a0 > x1 || b1 < y0 || b0 > y1) this.encuadrar();
      else this.entorno.pintar();
    }
  }

  ponerResaltado(r: Eleccion | null): void {
    if (r === this.resaltado) return;
    this.resaltado = r;
    this.reconstruirResaltado();
    this.entorno.pintar();
  }

  ponerMarcas(m: Marca[] | undefined): void {
    this.marcas = m ?? [];
    this.entorno.pintar();
  }

  ponerElegidos(ids: ReadonlySet<string>): void {
    this.elegidos = ids;
    this.entorno.pintar();
  }

  /** Las capas dependen del tema (la pintura de los estilos neutros). */
  private reconstruir(): void {
    if (this.capas) {
      this.escena3.remove(this.capas.grupo);
      this.capas.liberar();
      this.capas = null;
    }
    this.temaCapas = this.entorno.tema();
    if (this.escena) {
      const orden = { n: 0 };
      this.capas = new Capas2D(this.escena, this.entorno.tema(), orden);
      this.escena3.add(this.capas.grupo);
    }
    this.reconstruirResaltado();
  }

  private reconstruirResaltado(): void {
    if (this.resaltadoG) {
      this.escena3.remove(this.resaltadoG);
      this.resaltadoG.traverse((o) => (o as { geometry?: { dispose(): void } }).geometry?.dispose());
      this.resaltadoG = null;
    }
    const r = this.resaltado;
    if (!r || !this.escena) return;
    const g = new Group();
    const acento = this.entorno.colores().acento;
    const orden = { n: 100000 };
    if (r.objetos.length === 1) for (const m of relleno(r.abanicos, r.caja, acento, 0.22, orden, this.matResaltado)) g.add(m);
    const l = trazo(r.segmentos, acento, 3, orden, this.matResaltado, undefined, 0.85);
    if (l) g.add(l);
    // Sus coordenadas son respecto a su origen; las de la escena, respecto al suyo
    g.position.set(r.origen[0] - this.escena.origen[0], r.origen[1] - this.escena.origen[1], 0);
    this.resaltadoG = g;
    this.escena3.add(g);
  }

  /** Encuadra la escena entera o, con `caja` (AB: una zona de refuerzo), esa caja del modelo (m). */
  encuadrar(caja?: readonly [number, number, number, number]): void {
    const e = this.escena;
    if (!e || this.rect.w < 2) {
      this.encuadrada = false;
      return;
    }
    const [x0, y0, x1, y1] = caja ?? e.caja;
    const m = this.margenes;
    const w = Math.max(20, this.rect.w - m.izq - m.der);
    const h = Math.max(20, this.rect.h - m.arriba - m.abajo);
    this.s = Math.min(w / Math.max(1e-6, x1 - x0), h / Math.max(1e-6, y1 - y0));
    // El centro de la caja, en el centro del hueco que dejan los márgenes
    this.cx = (x0 + x1) / 2 - (m.izq - m.der) / 2 / this.s;
    this.cy = (y0 + y1) / 2 + (m.arriba - m.abajo) / 2 / this.s;
    this.encuadrada = true;
    // Una caja elegida no es el encuadre automático: una escena nueva no la deshace
    this.ajustada = !caja;
    this.camaraCambiada();
  }

  protected desplazar(dx: number, dy: number): void {
    if (this.s <= 0) return;
    this.cx -= dx / this.s;
    this.cy += dy / this.s;
  }

  protected orbitar(dx: number, dy: number): void {
    // Una vista plana no orbita: desplaza
    this.desplazar(dx, dy);
  }

  protected acercar(factor: number, x: number, y: number): void {
    if (this.s <= 0) return;
    const q = this.aModelo(x, y);
    this.s = Math.max(0.05, Math.min(5000, this.s * factor));
    // El punto bajo el cursor se queda bajo el cursor
    this.cx = q[0] - (x - this.rect.w / 2) / this.s;
    this.cy = q[1] + (y - this.rect.h / 2) / this.s;
  }

  protected clic(x: number, y: number, ctrl: boolean, doble: boolean): void {
    if (this.s <= 0) return;
    this.eventos.clic?.(this.aModelo(x, y), RADIO_CLIC / this.s, ctrl, doble);
  }

  protected soltarVentana(c: [number, number, number, number], modo: "dentro" | "toca", ctrl: boolean): void {
    if (this.s <= 0) return;
    const [a, b] = [this.aModelo(c[0], c[3]), this.aModelo(c[2], c[1])];
    this.eventos.ventana?.([a[0], a[1], b[0], b[1]], modo, ctrl);
  }

  cursor(x: number, y: number): string | null {
    if (this.s <= 0 || !this.escena) return null;
    return this.formatoCursor(this.aModelo(x, y));
  }

  render(r: WebGLRenderer): void {
    // La primera escena pudo llegar antes de que la vista tuviera tamaño
    if (this.escena && (!this.encuadrada || this.s <= 0)) this.encuadrar();
    if (!this.escena || !this.capas || this.s <= 0) return;
    if (this.temaCapas !== this.entorno.tema()) this.reconstruir();
    const { w, h } = this.rect;
    const o = this.escena.origen;
    const c = this.cam;
    c.left = -w / 2 / this.s;
    c.right = w / 2 / this.s;
    c.top = h / 2 / this.s;
    c.bottom = -h / 2 / this.s;
    c.position.set(this.cx - o[0], this.cy - o[1], 5);
    c.updateProjectionMatrix();
    this.capas.encuadre(w, h, this.s);
    r.render(this.escena3, c);
  }

  superponer(ctx: CanvasRenderingContext2D): void {
    const e = this.escena;
    if (!e || this.s <= 0) {
      this.dibujarVentana(ctx);
      return;
    }
    const col = this.entorno.colores();
    const tema = this.entorno.tema();
    const px = (q: Vec2) => this.aPx(q);
    const burbujas = ralearBurbujas(e.glifos, e.textos, px, this.elegidos);
    for (const g of e.glifos) if (!burbujas.ocultos.has(g)) this.glifo(ctx, g, tema, col.fondo);
    const acento = col.acento;
    if (this.resaltado) {
      ctx.strokeStyle = acento;
      ctx.lineWidth = 2.5;
      for (const q of this.resaltado.puntos) {
        const [x, y] = this.aPx(q);
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
    // Rótulos
    // Los de las isolíneas: sólo cambian con la escala (al desplazar la vista, no)
    if (this.isolineas?.lineas !== e.lineasRotuladas || this.isolineas.s !== this.s) this.isolineas = { lineas: e.lineasRotuladas, s: this.s, textos: rotulosLineas(e.lineasRotuladas, this.s, (t, tam) => this.entorno.medir(t, tam, false)) };
    const isolineas = this.isolineas.textos;
    const { puestos, omitidos } = colocarRotulos(isolineas.length ? [...burbujas.textos, ...isolineas] : burbujas.textos, px, this.rect.w, this.rect.h, this.entorno.medir, this.s, this.elegidos, burbujas.obstaculos);
    this.omitidos = omitidos;
    ctx.textBaseline = "alphabetic";
    for (const p of puestos) {
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.t.giro) ctx.rotate((-p.t.giro * Math.PI) / 180);
      if (p.fondo) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = col.fondo;
        ctx.fillRect(p.fondo[0] - p.x, p.fondo[1] - p.y, p.fondo[2], p.fondo[3]);
        ctx.globalAlpha = 1;
      }
      ctx.font = fuente(p.tam, !!p.t.negrita);
      ctx.textAlign = p.ancla === "inicio" ? "left" : p.ancla === "medio" ? "center" : "right";
      const elegido = p.t.objeto !== undefined && this.elegidos.has(p.t.objeto);
      textoConHalo(ctx, p.t.texto, 0, 0, elegido ? acento : (p.t.color ?? col.texto), col.fondo);
      ctx.restore();
    }
    // Las marcas de la pantalla (el punto pulsado en Losas…)
    for (const m of this.marcas) {
      const [x, y] = this.aPx(m.p);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = acento;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = col.fondo;
      ctx.stroke();
      if (m.texto) {
        ctx.font = `600 12px "Geist Mono", ui-monospace, monospace`;
        ctx.textAlign = "left";
        textoConHalo(ctx, m.texto, x + 9, y - 8, acento, col.fondo);
      }
    }
    this.dibujarVentana(ctx);
  }

  private glifo(ctx: CanvasRenderingContext2D, g: Glifo, tema: "light" | "dark", fondo: string): void {
    const p = pintura(g.estilo, tema);
    const [x, y] = this.aPx(g.p);
    if (x < -40 || y < -40 || x > this.rect.w + 40 || y > this.rect.h + 40) return;
    ctx.save();
    ctx.lineJoin = "round";
    const rellenar = () => {
      if (!p.fill || p.fill === "none") return;
      ctx.globalAlpha = p.opacity ?? 1;
      ctx.fillStyle = p.fill;
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    const trazar = () => {
      if (!p.stroke) return;
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.sw ?? 1;
      ctx.stroke();
    };
    if (g.tipo === "marca") {
      const r = g.radio;
      ctx.beginPath();
      if (g.forma === "circulo") ctx.arc(x, y, r, 0, 2 * Math.PI);
      else if (g.forma === "cuadrado") ctx.rect(x - r, y - r, 2 * r, 2 * r);
      else {
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y + r * 0.8);
        ctx.lineTo(x - r, y + r * 0.8);
        ctx.closePath();
      }
      rellenar();
      trazar();
    } else if (g.d) {
      const l = Math.hypot(g.d[0], g.d[1]) || 1;
      const [ux, uy] = [g.d[0] / l, -g.d[1] / l];
      const [ex, ey] = [x + ux * 30, y + uy * 30];
      const [nx, ny] = [-uy, ux];
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(ex, ey);
      ctx.moveTo(ex - ux * 8 + nx * 5, ey - uy * 8 + ny * 5);
      ctx.lineTo(ex, ey);
      ctx.lineTo(ex - ux * 8 - nx * 5, ey - uy * 8 - ny * 5);
      trazar();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, 2 * Math.PI);
      ctx.fillStyle = fondo;
      ctx.fill();
      ctx.strokeStyle = p.stroke ?? "#000";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      if (g.abajo === false) {
        ctx.moveTo(x - 5, y - 5);
        ctx.lineTo(x + 5, y + 5);
        ctx.moveTo(x + 5, y - 5);
        ctx.lineTo(x - 5, y + 5);
        ctx.stroke();
      } else {
        ctx.arc(x, y, 2.6, 0, 2 * Math.PI);
        ctx.fillStyle = p.stroke ?? "#000";
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /**
   * Para el banco de Chrome (criterio 1 de I2): el sha256 de los búferes de la escena que pinta (los
   * segmentos y los abanicos de cada capa, en orden), lo elegido y el encuadre.
   */
  async depuracion(): Promise<{ tipo: "2d"; capas: number; sha256: string | null; elegidos: string[]; escala: number; centro: Vec2; omitidos: number }> {
    const e = this.escena;
    let sha: string | null = null;
    if (e) {
      const partes = e.capas.flatMap((c) => [c.segmentos, c.abanicos]);
      const n = partes.reduce((s, x) => s + x.byteLength, 0);
      const b = new Uint8Array(n);
      let o = 0;
      for (const x of partes) {
        b.set(new Uint8Array(x.buffer, x.byteOffset, x.byteLength), o);
        o += x.byteLength;
      }
      sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b)), (x) => x.toString(16).padStart(2, "0")).join("");
    }
    return { tipo: "2d", capas: e?.capas.length ?? 0, sha256: sha, elegidos: [...this.elegidos], escala: this.s, centro: [this.cx, this.cy], omitidos: this.omitidos };
  }

  liberar(): void {
    this.capas?.liberar();
    this.capas = null;
    this.resaltado = null;
    this.reconstruirResaltado();
  }
}
