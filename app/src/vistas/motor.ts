/**
 * Motor de vistas (I2, `docs/fem3d/interfaz.md` §5, §10 y §14): fuera de React (H41), alimentado
 * por efectos.
 *
 * - Un solo `<canvas>` WebGL para toda la zona de vistas (el renderer compartido) y, encima, un
 *   lienzo 2D para lo que tiene tamaño en píxeles: glifos, rótulos, la ventana de elegir y el
 *   ViewCube. Cada vista se pinta en su rectángulo (`setViewport` y `setScissor`), que es el de su
 *   celda en el DOM.
 * - Se pinta sólo cuando algo cambia, todo en el mismo fotograma.
 * - Cada vista recibe los eventos de su superficie (un div de su celda) y los traduce: rueda, botón
 *   central o derecho (desplazar; con Mayús, orbitar), y con el izquierdo, clic o ventana (o
 *   desplazar u orbitar, con esas herramientas: para el panel táctil).
 *
 * Sin WebGL, `disponible` es false y las vistas no pintan nada.
 */
import { Vector2, type WebGLRenderer } from "three";
import type { Theme } from "../tema/types.ts";
import { rendererCompartido } from "./renderer.ts";

export type Herramienta = "elegir" | "desplazar" | "orbitar";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Colores que no son de un estilo de A4: los del lienzo y la interfaz, del tema. */
export interface Colores {
  fondo: string;
  texto: string;
  textoSuave: string;
  acento: string;
  panel: string;
  borde: string;
}

export interface Entorno {
  pintar(): void;
  colores(): Colores;
  tema(): Theme;
  /** Ancho de un texto en px, con la fuente de la interfaz. */
  medir(texto: string, tam: number, negrita: boolean): number;
}

/** Lo que una vista sabe hacer; el motor la pinta y le pasa los eventos de su superficie. */
export abstract class Vista {
  rect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  herramienta: Herramienta = "elegir";
  /** El fondo (`fondo.ts`): la rejilla y los ejes del origen; `tenue`, en Resultados. */
  protected fondo = { rejilla: true, tenue: false };
  /**
   * La cámara es la del último encuadre completo (nadie la ha movido desde entonces): al cambiar de
   * tamaño o de escena se encuadra de nuevo. Desplazar, orbitar o acercar la sueltan.
   */
  ajustada = false;
  /** La ventana de elegir que se está arrastrando, en px de la vista. */
  protected ventana: [number, number, number, number] | null = null;
  protected readonly entorno: Entorno;
  private arrastre: { boton: number; x0: number; y0: number; x: number; y: number; movido: boolean; mayus: boolean; ctrl: boolean } | null = null;
  /** Avisos de la vista activa (la del último clic). */
  alActivar: (() => void) | null = null;
  /** Cada cambio de cámara, para recordarla (con una pausa). */
  alCambiarCamara: ((c: unknown) => void) | null = null;
  private pausaCamara = 0;

  constructor(entorno: Entorno) {
    this.entorno = entorno;
  }

  abstract render(r: WebGLRenderer): void;
  abstract superponer(ctx: CanvasRenderingContext2D): void;
  abstract encuadrar(): void;
  abstract liberar(): void;
  /** Coordenadas del cursor para la barra de estado (null fuera de la vista). */
  abstract cursor(x: number, y: number): string | null;
  protected abstract desplazar(dx: number, dy: number): void;
  protected abstract orbitar(dx: number, dy: number, x0: number, y0: number): void;
  protected abstract acercar(factor: number, x: number, y: number): void;
  protected abstract clic(x: number, y: number, ctrl: boolean, doble: boolean): void;
  protected abstract soltarVentana(c: [number, number, number, number], modo: "dentro" | "toca", ctrl: boolean): void;
  abstract camara(): unknown;

  ponerFondo(rejilla: boolean, tenue: boolean): void {
    if (rejilla === this.fondo.rejilla && tenue === this.fondo.tenue) return;
    this.fondo = { rejilla, tenue };
    this.entorno.pintar();
  }

  protected camaraCambiada(): void {
    this.entorno.pintar();
    if (!this.alCambiarCamara) return;
    clearTimeout(this.pausaCamara);
    this.pausaCamara = window.setTimeout(() => this.alCambiarCamara?.(this.camara()), 400);
  }

  // ─── Eventos de la superficie ───────────────────────────────────────────────────────────────

  pointerdown(e: PointerEvent, x: number, y: number): void {
    this.alActivar?.();
    this.arrastre = { boton: e.button, x0: x, y0: y, x, y, movido: false, mayus: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
  }

  pointermove(e: PointerEvent, x: number, y: number): void {
    const a = this.arrastre;
    if (!a) return this.pasar(x, y, e);
    const [dx, dy] = [x - a.x, y - a.y];
    if (!a.movido && Math.hypot(x - a.x0, y - a.y0) > 4) a.movido = true;
    if (!a.movido) return;
    a.x = x;
    a.y = y;
    const navegar = a.boton === 1 || a.boton === 2 || (a.boton === 0 && this.herramienta !== "elegir");
    if (navegar) {
      this.ajustada = false;
      if (a.mayus || (a.boton === 0 && this.herramienta === "orbitar")) this.orbitar(dx, dy, a.x0, a.y0);
      else this.desplazar(dx, dy);
      this.camaraCambiada();
    } else if (a.boton === 0) {
      this.ventana = [a.x0, a.y0, x, y];
      this.entorno.pintar();
    }
  }

  pointerup(_e: PointerEvent, x: number, y: number): void {
    const a = this.arrastre;
    this.arrastre = null;
    if (!a) return;
    if (a.boton === 0 && !a.movido) this.clic(x, y, a.ctrl, false);
    else if (a.boton === 2 && !a.movido) this.clicDerecho();
    else if (this.ventana) {
      const [x0, y0, x1, y1] = this.ventana;
      this.ventana = null;
      this.soltarVentana([Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)], x1 >= x0 ? "dentro" : "toca", a.ctrl);
      this.entorno.pintar();
    }
  }

  /** El cursor se mueve sin arrastrar (I4: lo que hay debajo; V2c: los enganches). */
  protected pasar(_x: number, _y: number, _e?: PointerEvent): void {}

  /** El cursor sale de la vista. */
  salir(): void {}

  /** Un clic con el botón derecho sin arrastrar (arrastrando, desplaza la cámara). */
  protected clicDerecho(): void {}

  dobleclic(e: MouseEvent, x: number, y: number): void {
    this.clic(x, y, e.ctrlKey || e.metaKey, true);
  }

  rueda(e: WheelEvent, x: number, y: number): void {
    const pasos = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / 100;
    this.ajustada = false;
    // Rueda hacia delante (deltaY < 0) acerca, como en CAD
    this.acercar(Math.pow(0.85, pasos), x, y);
    this.camaraCambiada();
  }

  /** La ventana de elegir: continua de izquierda a derecha (dentro), a trazos al revés (toca). */
  protected dibujarVentana(ctx: CanvasRenderingContext2D): void {
    const v = this.ventana;
    if (!v) return;
    const c = this.entorno.colores();
    const [x0, y0, x1, y1] = v;
    ctx.save();
    ctx.fillStyle = c.acento;
    ctx.globalAlpha = 0.08;
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c.acento;
    ctx.lineWidth = 1;
    if (x1 < x0) ctx.setLineDash([5, 3]);
    ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.restore();
  }
}

interface Celda {
  vista: Vista;
  superficie: HTMLElement;
  quitar: () => void;
}

export class Motor {
  readonly disponible: boolean;
  private readonly contenedor: HTMLElement;
  private readonly renderer: WebGLRenderer | null;
  private readonly lienzo2D: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly celdas = new Map<number, Celda>();
  private readonly ro: ResizeObserver;
  private pendiente = 0;
  private temaV: Theme;
  private coloresV: Colores;
  private readonly medidas = new Map<string, number>();
  /** Lo que tardó el último fotograma en el hilo principal, ms (para el banco). */
  ultimoFotograma = 0;
  fotogramas = 0;

  constructor(contenedor: HTMLElement, tema: Theme) {
    this.contenedor = contenedor;
    this.temaV = tema;
    this.coloresV = this.leerColores();
    this.renderer = rendererCompartido();
    this.disponible = !!this.renderer;
    this.lienzo2D = document.createElement("canvas");
    Object.assign(this.lienzo2D.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "2" });
    this.ctx = this.disponible ? this.lienzo2D.getContext("2d") : null;
    if (this.renderer) {
      const c = this.renderer.domElement;
      Object.assign(c.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "1" });
      contenedor.prepend(this.lienzo2D);
      contenedor.prepend(c);
    }
    this.ro = new ResizeObserver(() => {
      this.medir();
      this.pintar();
    });
    this.ro.observe(contenedor);
    this.medir();
  }

  get entorno(): Entorno {
    return {
      pintar: () => this.pintar(),
      colores: () => this.coloresV,
      tema: () => this.temaV,
      medir: (t, tam, negrita) => this.anchoTexto(t, tam, negrita),
    };
  }

  private leerColores(): Colores {
    const s = getComputedStyle(this.contenedor);
    const v = (n: string, d: string) => s.getPropertyValue(n).trim() || d;
    return { fondo: v("--color-bg-canvas", "#f4f5f7"), texto: v("--color-text-primary", "#111827"), textoSuave: v("--color-text-secondary", "#4b5563"), acento: v("--color-accent", "#2563eb"), panel: v("--color-bg-primary", "#ffffff"), borde: v("--color-border-main", "#d1d5db") };
  }

  ponerTema(t: Theme): void {
    this.temaV = t;
    // Las variables del tema cambian en el mismo render: se leen en el fotograma siguiente
    requestAnimationFrame(() => {
      this.coloresV = this.leerColores();
      this.pintar();
    });
  }

  anchoTexto(t: string, tam: number, negrita: boolean): number {
    const k = `${negrita ? 1 : 0}${tam}|${t}`;
    const m = this.medidas.get(k);
    if (m !== undefined) return m;
    let w = t.length * tam * 0.55;
    if (this.ctx) {
      this.ctx.font = fuente(tam, negrita);
      w = this.ctx.measureText(t).width;
    }
    if (this.medidas.size > 20000) this.medidas.clear();
    this.medidas.set(k, w);
    return w;
  }

  /** Engancha una vista a su celda (`superficie`: el div que recibe sus eventos). */
  poner(i: number, vista: Vista, superficie: HTMLElement): void {
    this.quitar(i);
    const rel = (e: MouseEvent): [number, number] => {
      const r = superficie.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const down = (e: PointerEvent) => {
      try {
        superficie.setPointerCapture(e.pointerId);
      } catch {
        // un puntero que ya no está (o sintético): sin captura
      }
      if (e.button === 1) e.preventDefault();
      vista.pointerdown(e, ...rel(e));
    };
    const move = (e: PointerEvent) => {
      const [x, y] = rel(e);
      vista.pointermove(e, x, y);
      this.ultimoCursor = { vista, x, y };
      this.alCursor?.(vista.cursor(x, y));
    };
    const up = (e: PointerEvent) => vista.pointerup(e, ...rel(e));
    const dbl = (e: MouseEvent) => vista.dobleclic(e, ...rel(e));
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      vista.rueda(e, ...rel(e));
    };
    const menu = (e: Event) => e.preventDefault();
    const fuera = () => {
      this.ultimoCursor = null;
      this.alCursor?.(null);
      vista.salir();
    };
    superficie.addEventListener("pointerdown", down);
    superficie.addEventListener("pointermove", move);
    superficie.addEventListener("pointerup", up);
    superficie.addEventListener("dblclick", dbl);
    superficie.addEventListener("wheel", wheel, { passive: false });
    superficie.addEventListener("contextmenu", menu);
    superficie.addEventListener("pointerleave", fuera);
    const ro = new ResizeObserver(() => {
      this.medir();
      this.pintar();
    });
    ro.observe(superficie);
    this.celdas.set(i, {
      vista,
      superficie,
      quitar: () => {
        superficie.removeEventListener("pointerdown", down);
        superficie.removeEventListener("pointermove", move);
        superficie.removeEventListener("pointerup", up);
        superficie.removeEventListener("dblclick", dbl);
        superficie.removeEventListener("wheel", wheel);
        superficie.removeEventListener("contextmenu", menu);
        superficie.removeEventListener("pointerleave", fuera);
        ro.disconnect();
        vista.liberar();
      },
    });
    this.medir();
    this.pintar();
  }

  quitar(i: number): void {
    const c = this.celdas.get(i);
    if (!c) return;
    c.quitar();
    this.celdas.delete(i);
    this.pintar();
  }

  vista(i: number): Vista | null {
    return this.celdas.get(i)?.vista ?? null;
  }

  /** Los programas de WebGL compilados (para el banco: qué falta en el precalentado). */
  programas(): string[] {
    return (this.renderer?.info.programs ?? []).map((p) => `${p.name} ${(p as unknown as { cacheKey: string }).cacheKey}`);
  }

  /** Los índices de las vistas montadas (para el banco). */
  indices(): number[] {
    return [...this.celdas.keys()].sort((a, b) => a - b);
  }

  /** Coordenadas del cursor para la barra de estado. */
  alCursor: ((texto: string | null) => void) | null = null;
  /** Dónde se movió el ratón la última vez, para rehacer el texto del cursor sin moverlo. */
  private ultimoCursor: { vista: Vista; x: number; y: number } | null = null;

  /** Rehace el texto del cursor sin que se mueva el ratón (una tecla cambia lo que dice: Tab en las cotas de CT1). */
  refrescarCursor(): void {
    const c = this.ultimoCursor;
    if (c) this.alCursor?.(c.vista.cursor(c.x, c.y));
  }

  private medir(): void {
    const r0 = this.contenedor.getBoundingClientRect();
    const [w, h] = [Math.max(1, Math.round(r0.width)), Math.max(1, Math.round(r0.height))];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.renderer) {
      const s = this.renderer.getSize(new Vector2());
      if (s.x !== w || s.y !== h) this.renderer.setSize(w, h, false);
    }
    if (this.lienzo2D.width !== Math.round(w * dpr) || this.lienzo2D.height !== Math.round(h * dpr)) {
      this.lienzo2D.width = Math.round(w * dpr);
      this.lienzo2D.height = Math.round(h * dpr);
    }
    for (const c of this.celdas.values()) {
      const r = c.superficie.getBoundingClientRect();
      const antes = c.vista.rect;
      c.vista.rect = { x: r.left - r0.left, y: r.top - r0.top, w: Math.max(1, r.width), h: Math.max(1, r.height) };
      // Otro tamaño: una vista sin tocar se encuadra de nuevo, y una tocada, sólo si el cambio es grande (otra disposición)
      const cambio = Math.max(antes.w / c.vista.rect.w, c.vista.rect.w / antes.w, antes.h / c.vista.rect.h, c.vista.rect.h / antes.h);
      if (antes.w > 2 && antes.h > 2 && cambio > 1.01 && (c.vista.ajustada || cambio > 1.4)) c.vista.encuadrar();
    }
  }

  /** Pinta en el siguiente fotograma (varios cambios seguidos, una sola vez). */
  pintar(): void {
    if (this.pendiente || !this.renderer) return;
    this.pendiente = requestAnimationFrame(() => {
      this.pendiente = 0;
      const t0 = performance.now();
      this.fotograma();
      this.ultimoFotograma = performance.now() - t0;
      this.fotogramas++;
    });
  }

  private fotograma(): void {
    const r = this.renderer!;
    const ctx = this.ctx;
    const H = this.contenedor.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    r.setScissorTest(false);
    r.setClearColor(this.coloresV.fondo, 1);
    r.clear(true, true, true);
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.lienzo2D.width, this.lienzo2D.height);
    }
    for (const { vista } of this.celdas.values()) {
      const { x, y, w, h } = vista.rect;
      if (w < 2 || h < 2) continue;
      r.setViewport(x, H - y - h, w, h);
      r.setScissor(x, H - y - h, w, h);
      r.setScissorTest(true);
      r.clear(true, true, true);
      vista.render(r);
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, x * dpr, y * dpr);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.clip();
        vista.superponer(ctx);
        ctx.restore();
      }
    }
    r.setScissorTest(false);
  }

  liberar(): void {
    for (const i of [...this.celdas.keys()]) this.quitar(i);
    this.ro.disconnect();
    if (this.pendiente) cancelAnimationFrame(this.pendiente);
    if (this.renderer?.domElement.parentElement === this.contenedor) this.contenedor.removeChild(this.renderer.domElement);
    if (this.lienzo2D.parentElement === this.contenedor) this.contenedor.removeChild(this.lienzo2D);
  }
}

export const fuente = (tam: number, negrita: boolean) => `${negrita ? 600 : 400} ${tam}px Geist, "Segoe UI", system-ui, sans-serif`;

/** Un texto con halo del color del fondo, para que se lea sobre cualquier cosa. */
export function textoConHalo(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, color: string, halo: string): void {
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = halo;
  ctx.strokeText(t, x, y);
  ctx.fillStyle = color;
  ctx.fillText(t, x, y);
}
