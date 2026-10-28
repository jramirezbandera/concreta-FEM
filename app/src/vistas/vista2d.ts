/**
 * Vista 2D (planta o alzado, I2): una escena preparada de A4 con cámara ortográfica. La geometría va
 * en WebGL (`capas.ts`); los glifos, los rótulos y lo elegido que tiene tamaño en píxeles, en el
 * lienzo 2D de encima, recolocados en cada fotograma.
 *
 * El encuadre es el centro (m) y la escala (px/m). Al cambiar de escena se conserva si lo que se veía
 * sigue cayendo en la nueva (cambiar de planta no mueve el dibujo, como en CYPECAD); si no, se
 * encuadra la escena entera. Una escena vacía encuadra `CAJA_VACIA` (el origen abajo a la izquierda),
 * y lo primero que se dibuje en ella no mueve la vista si se ve.
 *
 * Detrás, la rejilla y los ejes del origen (`fondo.ts`). En las plantas de Modelo y Cargas, la
 * plantilla DXF (V2c-4): sus líneas en gris en WebGL (con el material de la rejilla), encima del
 * relleno de las losas, los ábacos y los paños y debajo de lo demás (V2c4-6, `Capas2D.ordenPlantilla`),
 * y sus textos en el lienzo 2D, si miden al menos `TEXTO_MINIMO` px.
 */
import { BufferAttribute, BufferGeometry, Color, Group, LineSegments, OrthographicCamera, Scene, type WebGLRenderer } from "three";
import { rotulo, type Texto, type Vec2 } from "../../../src/agente/render/escena.ts";
import { rotulosLineas } from "../../../src/agente/render/isovalores.ts";
import { RADIO_CLIC, type Eleccion, type EscenaPreparada, type Glifo } from "../../../src/visor/escena.ts";
import { pintura } from "../lienzo/pintura.ts";
import { Capas2D, MATERIALES, relleno, trazo } from "./capas.ts";
import { CAJA_VACIA, ENCUADRE_MINIMO, iconoEjes, MATERIAL_LINEAS, Rejilla2D } from "./fondo.ts";
import type { GeometriaPlantilla } from "../plantilla/plantillas.ts";
import { fuente, textoConHalo, Vista, type Colores, type Entorno } from "./motor.ts";
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

/**
 * Lo que dibuja con el ratón en una planta (V2c, `app/src/dibujo/controlador.ts`): recibe el cursor,
 * los clics y la ventana en m (con el radio de enganche en m), y pinta encima del dibujo. Un clic o una
 * ventana que no usa (con Elegir) va a `eventos`, como siempre.
 */
export interface Dibujo2D {
  pasar(p: Vec2, radio: number, mayus: boolean, cliente: readonly [number, number]): void;
  salir(): void;
  /** true si el clic es suyo. */
  clic(p: Vec2, radio: number, ctrl: boolean, doble: boolean): boolean;
  /** true si la ventana es suya. */
  ventana(caja: [number, number, number, number], ctrl?: boolean): boolean;
  /** V2c-3: al pulsar, true si coge algo que se arrastra (un vértice de lo elegido); al soltar tras moverse, va a `clic`. */
  agarrar?(p: Vec2, radio: number): boolean;
  /** El clic derecho sin arrastrar; true si es suyo. */
  derecho?(): boolean;
  /** El punto que se usaría (enganchado) y lo que dice la barra de estado. */
  cursor(): { p: Vec2; texto: string } | null;
  pintar(ctx: CanvasRenderingContext2D, aPx: (q: Vec2) => [number, number], c: Colores): void;
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

/** La escena no tiene nada dibujado (una planta nueva). */
export const escenaVacia = (e: EscenaPreparada): boolean => !e.glifos.length && e.capas.every((c) => !c.segmentos.length && !c.abanicos.length);

/** Radio de enganche, px (el de `src/editor/dibujo/enganches.ts`). */
const RADIO_ENGANCHE = 10;

/** V2c-4: el color y la opacidad de la plantilla DXF por tema, y el menor texto suyo que se dibuja, px. */
const COLOR_PLANTILLA = { light: { c: "#6b7280", a: 0.6 }, dark: { c: "#9ca3af", a: 0.5 } } as const;
const TEXTO_MINIMO = 5;

export class Vista2D extends Vista {
  private readonly escena3 = new Scene();
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
  private readonly rejilla = new Rejilla2D();
  /** Los nombres de los ejes del icono del origen (planta: X, Y; alzado: u, z). */
  nombresEjes: readonly [string, string] = ["X", "Y"];
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
  /** V2c: lo que dibuja con el ratón (sólo en las plantas editables). */
  dibujo: Dibujo2D | null = null;
  /** Texto del cursor para la barra de estado (planta: x, y; alzado: u, z). */
  formatoCursor: (q: Vec2) => string = (q) => `x ${rotulo(q[0], 4)} · y ${rotulo(q[1], 4)} m`;
  /** Rótulos que no cupieron en el último fotograma. */
  omitidos = 0;
  private temaCapas: string | null = null;
  /** Los rótulos de las isolíneas de la escena, con la escala en que se colocaron. */
  private isolineas: { lineas: EscenaPreparada["lineasRotuladas"]; s: number; textos: Texto[] } | null = null;
  /** V2c-4: la plantilla DXF de la planta y sus líneas, con el tema con que se pintaron. */
  private plantilla: GeometriaPlantilla | null = null;
  private plantillaL: LineSegments | null = null;
  private temaPlantilla: string | null = null;

  constructor(entorno: Entorno, camara?: Camara2D | null) {
    super(entorno);
    this.escena3.add(this.rejilla.objeto);
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
    // Lo primero que se dibuja en una planta vacía no mueve la vista (si se ve)
    const veniaVacia = !!this.escena && escenaVacia(this.escena);
    this.escena = e;
    this.reconstruir();
    if (!e) return this.entorno.pintar();
    if (!this.encuadrada || this.s <= 0 || (this.ajustada && !veniaVacia)) this.encuadrar();
    else {
      // ¿Se sigue viendo algo de la escena nueva?
      const [x0, y0] = this.aModelo(0, this.rect.h);
      const [x1, y1] = this.aModelo(this.rect.w, 0);
      const [a0, b0, a1, b1] = e.caja;
      if (a1 < x0 || a0 > x1 || b1 < y0 || b0 > y1) this.encuadrar();
      else this.entorno.pintar();
    }
  }

  /** V2c-4: la plantilla DXF de la planta (null: ninguna). */
  ponerPlantilla(g: GeometriaPlantilla | null): void {
    if (g === this.plantilla) return;
    this.plantilla = g;
    this.reconstruirPlantilla();
    this.entorno.pintar();
  }

  private reconstruirPlantilla(): void {
    if (this.plantillaL) {
      this.escena3.remove(this.plantillaL);
      this.plantillaL.geometry.dispose();
      this.plantillaL = null;
    }
    const g = this.plantilla;
    const tema = this.entorno.tema();
    this.temaPlantilla = tema;
    if (!g || !g.posiciones.length) return;
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(g.posiciones, 3));
    const { c, a } = COLOR_PLANTILLA[tema];
    const k = new Color().setStyle(c);
    const n = g.posiciones.length / 3;
    const col = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) col.set([k.r, k.g, k.b, a], 4 * i);
    geo.setAttribute("color", new BufferAttribute(col, 4));
    const l = new LineSegments(geo, MATERIAL_LINEAS);
    // Delante de la rejilla; con una escena, encima de su relleno de fondo (`render`, V2c4-6)
    l.renderOrder = -500;
    l.frustumCulled = false;
    this.plantillaL = l;
    this.escena3.add(l);
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
    let [x0, y0, x1, y1] = caja ?? (escenaVacia(e) ? CAJA_VACIA : e.caja);
    if (!caja) {
      // Un pilar solo no llena la vista
      const [dx, dy] = [Math.max(0, ENCUADRE_MINIMO - (x1 - x0)) / 2, Math.max(0, ENCUADRE_MINIMO - (y1 - y0)) / 2];
      [x0, y0, x1, y1] = [x0 - dx, y0 - dy, x1 + dx, y1 + dy];
    }
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
    const p = this.aModelo(x, y);
    if (this.dibujo?.clic(p, RADIO_ENGANCHE / this.s, ctrl, doble)) return;
    this.eventos.clic?.(p, RADIO_CLIC / this.s, ctrl, doble);
  }

  protected soltarVentana(c: [number, number, number, number], modo: "dentro" | "toca", ctrl: boolean): void {
    if (this.s <= 0) return;
    const [a, b] = [this.aModelo(c[0], c[3]), this.aModelo(c[2], c[1])];
    if (this.dibujo?.ventana([a[0], a[1], b[0], b[1]], ctrl)) return;
    this.eventos.ventana?.([a[0], a[1], b[0], b[1]], modo, ctrl);
  }

  /** V2c-3: lo que se arrastra desde un vértice cogido (px de la pulsación y si se ha movido). */
  private asa: { x0: number; y0: number; movido: boolean } | null = null;

  override pointerdown(e: PointerEvent, x: number, y: number): void {
    if (e.button === 0 && this.s > 0 && this.dibujo?.agarrar?.(this.aModelo(x, y), RADIO_ENGANCHE / this.s)) {
      this.alActivar?.();
      this.asa = { x0: x, y0: y, movido: false };
      this.entorno.pintar();
      return;
    }
    super.pointerdown(e, x, y);
  }

  override pointermove(e: PointerEvent, x: number, y: number): void {
    const a = this.asa;
    if (!a) return super.pointermove(e, x, y);
    if (!a.movido && Math.hypot(x - a.x0, y - a.y0) > 4) a.movido = true;
    this.pasar(x, y, e);
  }

  override pointerup(e: PointerEvent, x: number, y: number): void {
    const a = this.asa;
    if (!a) return super.pointerup(e, x, y);
    this.asa = null;
    // Arrastrado, se deja donde se suelta; con un clic, queda cogido hasta el clic siguiente
    if (a.movido) this.clic(x, y, e.ctrlKey || e.metaKey, false);
  }

  protected override pasar(x: number, y: number, e?: PointerEvent): void {
    if (!this.dibujo || this.s <= 0 || !this.escena) return;
    this.dibujo.pasar(this.aModelo(x, y), RADIO_ENGANCHE / this.s, !!e?.shiftKey, [e?.clientX ?? 0, e?.clientY ?? 0]);
    this.entorno.pintar();
  }

  protected override clicDerecho(): void {
    if (this.dibujo?.derecho?.()) this.entorno.pintar();
  }

  override salir(): void {
    if (!this.dibujo) return;
    this.dibujo.salir();
    this.entorno.pintar();
  }

  /** Pinta en el siguiente fotograma (el dibujo cambia sin un evento de la vista: una tecla). */
  repintar(): void {
    this.entorno.pintar();
  }

  cursor(x: number, y: number): string | null {
    if (this.s <= 0 || !this.escena) return null;
    const d = this.dibujo?.cursor();
    if (d) return `${this.formatoCursor(d.p)}${d.texto ? ` · ${d.texto}` : ""}`;
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
    if (this.fondo.rejilla) {
      const [a, b] = [this.aModelo(0, h), this.aModelo(w, 0)];
      this.rejilla.actualizar([a[0], a[1], b[0], b[1]], o, this.s, this.entorno.colores().texto, this.entorno.tema(), this.fondo.tenue, escenaVacia(this.escena));
    } else this.rejilla.ocultar();
    if (this.temaPlantilla !== this.entorno.tema()) this.reconstruirPlantilla();
    if (this.plantillaL && this.plantilla) {
      this.plantillaL.position.set(this.plantilla.origen[0] - o[0], this.plantilla.origen[1] - o[1], 0);
      this.plantillaL.renderOrder = this.capas.ordenPlantilla;
    }
    r.render(this.escena3, c);
  }

  /** V2c-4: los textos de la plantilla que se ven y miden al menos `TEXTO_MINIMO` px. */
  private textosPlantilla(ctx: CanvasRenderingContext2D): void {
    const ts = this.plantilla?.textos;
    if (!ts?.length) return;
    const { w, h } = this.rect;
    const tema = this.entorno.tema();
    ctx.save();
    ctx.fillStyle = COLOR_PLANTILLA[tema].c;
    ctx.globalAlpha = Math.min(1, COLOR_PLANTILLA[tema].a + 0.2);
    for (const t of ts) {
      const tam = t.altura * this.s;
      if (tam < TEXTO_MINIMO) continue;
      const [x, y] = this.aPx([t.x, t.y]);
      const lineas = t.texto.split("\n");
      const largo = tam * Math.max(...lineas.map((l) => l.length)) + tam * lineas.length * 1.7;
      if (x < -largo || y < -largo || x > w + largo || y > h + largo) continue;
      ctx.save();
      ctx.translate(x, y);
      if (t.giro) ctx.rotate(-t.giro);
      ctx.font = fuente(Math.min(tam, 400), false);
      ctx.textAlign = t.h === 0 ? "left" : t.h === 1 ? "center" : "right";
      ctx.textBaseline = t.v === 0 ? "alphabetic" : t.v === 1 ? "bottom" : t.v === 2 ? "middle" : "top";
      // Las líneas de un MTEXT, una debajo de otra desde su anclaje
      const paso = tam * 1.667;
      const y0 = t.v === 3 ? 0 : t.v === 2 ? (-(lineas.length - 1) * paso) / 2 : -(lineas.length - 1) * paso;
      lineas.forEach((l, i) => ctx.fillText(l, 0, y0 + i * paso));
      ctx.restore();
    }
    ctx.restore();
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
    this.textosPlantilla(ctx);
    if (this.fondo.rejilla) this.dibujarOrigen(ctx);
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
    if (this.dibujo) {
      ctx.save();
      this.dibujo.pintar(ctx, px, col);
      ctx.restore();
    }
    this.dibujarVentana(ctx);
  }

  /** El icono de los ejes en el origen o, si no se ve, en la esquina de abajo a la izquierda. */
  private dibujarOrigen(ctx: CanvasRenderingContext2D): void {
    const [x, y] = this.aPx([0, 0]);
    const { w, h } = this.rect;
    const dentro = x >= 12 && x <= w - 50 && y >= 50 && y <= h - 12;
    const [ix, iy] = dentro ? [x, y] : [this.margenes.izq + 14, h - this.margenes.abajo - 6];
    iconoEjes(ctx, ix, iy, dentro, this.nombresEjes, this.entorno.tema(), this.entorno.colores().fondo, this.fondo.tenue);
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
  async depuracion(): Promise<{ tipo: "2d"; capas: number; sha256: string | null; elegidos: string[]; escala: number; centro: Vec2; omitidos: number; plantilla: number }> {
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
    return { tipo: "2d", capas: e?.capas.length ?? 0, sha256: sha, elegidos: [...this.elegidos], escala: this.s, centro: [this.cx, this.cy], omitidos: this.omitidos, plantilla: (this.plantilla?.posiciones.length ?? 0) / 6 };
  }

  liberar(): void {
    this.capas?.liberar();
    this.capas = null;
    this.plantilla = null;
    this.reconstruirPlantilla();
    this.resaltado = null;
    this.reconstruirResaltado();
  }
}
