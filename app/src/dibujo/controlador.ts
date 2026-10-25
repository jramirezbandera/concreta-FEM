/**
 * La herramienta activa de un espacio de trabajo (V2c-1, `docs/fem3d/dibujo.md` §2.1 y §2.6), fuera
 * de React: mover el ratón no pasa por un render. Las vistas de planta le dan el cursor, los clics y
 * la ventana (`Dibujo2D`); el controlador engancha (`src/editor/dibujo/enganches.ts`), pasa los
 * eventos a la herramienta (`herramientas.ts`), pinta el marcador, el borrador y lo que hay debajo, y
 * aplica la `Operacion` de lo terminado con `aplicar` (el `editar` del proyecto: un paso de deshacer).
 *
 * React sólo se entera de lo que cambia la barra o Propiedades (la herramienta, lo que pide, el
 * último error, el ortogonal y el campo de teclado), por `suscribir` e `instantanea`.
 *
 * Con Pilar se pintan también sus cotas temporales (CT1, `docs/fem3d/cotas.md` §2.1): Tab elige una
 * y un número tecleado la fija.
 */
import type { ModeloFisico, Vec2 } from "../../../src/compilador/fisico.ts";
import { apuntar, bajoCursor, indiceEnganches, NOMBRE_ENGANCHE, TIPOS_ENGANCHE, type Apunte, type IndiceEnganches, type Silueta, type TipoEnganche } from "../../../src/editor/dibujo/enganches.ts";
import { nombreCota, type CotaTemporal } from "../../../src/editor/dibujo/cotas.ts";
import { ayuda, borrador, ESTADO_INICIAL, paso, ultimoPunto, type EstadoHerramienta, type Evento, type Hecho, type NombreHerramienta, type Plantillas } from "../../../src/editor/dibujo/herramientas.ts";
import { leerEntrada, resolverEntrada } from "../../../src/editor/dibujo/teclado.ts";
import type { Colores } from "../vistas/motor.ts";
import type { Dibujo2D } from "../vistas/vista2d.ts";

/** Lo que React enseña de la herramienta. */
export interface Instantanea {
  herramienta: NombreHerramienta;
  ayuda: string;
  error: string | null;
  /** Lo último que se hizo (la etiqueta de deshacer). */
  hecho: string | null;
  orto: boolean;
  activos: ReadonlySet<TipoEnganche>;
  /** El campo de teclado, abierto con su texto inicial y dónde (px de la ventana); `cota`, la que fija lo que se escriba. */
  campo: { n: number; texto: string; x: number; y: number; error: string | null; cota?: string } | null;
}

export class ControladorDibujo {
  private modelo: ModeloFisico | null = null;
  plantillas: Plantillas = { pilar: {}, viga: {} };
  /** Aplica lo terminado; devuelve el error si no se pudo. */
  aplicar: (h: Hecho) => string | null = () => "No hay ningún proyecto que editar.";
  /** Vuelve a Elegir (Esc sin nada en curso). */
  alSalir: () => void = () => {};
  /** Repinta las vistas (una tecla cambia el dibujo sin un evento de la vista). */
  repintar: () => void = () => {};

  private herramienta: NombreHerramienta = "elegir";
  private estado: EstadoHerramienta = ESTADO_INICIAL;
  private planta: string | null = null;
  private readonly indices = new Map<string, IndiceEnganches>();
  private readonly adaptadores = new Map<string, Dibujo2D>();
  private cursorQ: Vec2 | null = null;
  private radio = 0;
  private mayus = false;
  private cliente: readonly [number, number] = [0, 0];
  private apunte: Apunte | null = null;
  private silueta: Silueta | null = null;
  private foto: Instantanea;
  /** Cuántas veces se ha abierto el campo de teclado (su clave en React). */
  private abiertos = 0;
  private readonly oyentes = new Set<() => void>();

  constructor() {
    this.foto = { herramienta: "elegir", ayuda: "", error: null, hecho: null, orto: false, activos: new Set(TIPOS_ENGANCHE), campo: null };
  }

  // ─── Para React ─────────────────────────────────────────────────────────────────────────────

  suscribir = (f: () => void): (() => void) => {
    this.oyentes.add(f);
    return () => this.oyentes.delete(f);
  };

  instantanea = (): Instantanea => this.foto;

  private cambiar(c: Partial<Instantanea>): void {
    this.foto = { ...this.foto, ayuda: ayuda(this.herramienta, this.estado), ...c };
    for (const f of this.oyentes) f();
  }

  ponerModelo(m: ModeloFisico | null): void {
    if (m === this.modelo) return;
    this.modelo = m;
    this.indices.clear();
    // Lo recién dibujado ya engancha, sin esperar a que se mueva el ratón
    this.recalcular();
  }

  ponerHerramienta(h: NombreHerramienta): void {
    if (h === this.herramienta) return;
    this.herramienta = h;
    this.estado = ESTADO_INICIAL;
    this.apunte = null;
    this.cambiar({ herramienta: h, error: null, hecho: null, campo: null });
    this.repintar();
  }

  get activa(): NombreHerramienta {
    return this.herramienta;
  }

  alternarOrto(): void {
    this.cambiar({ orto: !this.foto.orto });
    this.recalcular();
  }

  ponerActivos(a: ReadonlySet<TipoEnganche>): void {
    this.cambiar({ activos: a });
    this.recalcular();
  }

  // ─── Teclado ────────────────────────────────────────────────────────────────────────────────

  intro(): void {
    const a = this.apunte;
    this.evento({ tipo: "terminar", p: a?.p ?? null, enganche: a?.enganche ?? null });
  }

  /** Tab (Mayús+Tab, `atras`): la cota temporal siguiente. Devuelve si la herramienta las tiene. */
  tab(atras = false): boolean {
    if (this.herramienta !== "pilar") return false;
    this.evento({ tipo: "tab", cursor: this.apunte?.p ?? this.cursorQ, atras });
    const c = this.foto.campo;
    if (c) this.cambiar({ campo: { ...c, ...this.cotaCampo() } });
    return true;
  }

  /** La cota activa, para el campo. */
  private cotaCampo(): { cota?: string } {
    const c = this.cotaActiva();
    return c ? { cota: `${c.texto} ${nombreCota(c)}` } : {};
  }

  private cotaActiva(): CotaTemporal | null {
    if (this.herramienta !== "pilar" || !this.estado.activa) return null;
    return this.cotas().find((c) => c.activa) ?? null;
  }

  /** Las cotas temporales del cursor de ahora. */
  private cotas(): CotaTemporal[] {
    const ix = this.indiceActual();
    if (!this.modelo || !this.planta || !ix || !this.cursorQ) return [];
    return borrador(this.herramienta, this.estado, this.apunte?.p ?? this.cursorQ, { modelo: this.modelo, planta: this.planta, indice: ix, plantillas: this.plantillas }).cotas;
  }

  anular(): void {
    this.evento({ tipo: "anular" });
  }

  retroceso(): void {
    this.evento({ tipo: "retroceso" });
  }

  abrirCampo(texto: string): void {
    if (this.herramienta === "elegir") return;
    this.cambiar({ campo: { n: this.abiertos + 1, texto, x: this.cliente[0], y: this.cliente[1], error: null, ...this.cotaCampo() } });
    this.abiertos++;
  }

  cerrarCampo(): void {
    if (this.foto.campo) this.cambiar({ campo: null });
  }

  /** Lo escrito en el campo, como un punto. Devuelve si se aceptó. */
  teclear(texto: string): boolean {
    const ix = this.indiceActual();
    const l = leerEntrada(texto);
    // Con Pilar, un número suelto es la distancia de la cota activa
    if (l.ok && l.valor.tipo === "longitud" && this.herramienta === "pilar") {
      const antes = this.estado;
      this.evento({ tipo: "fijar", valor: l.valor.l, cursor: this.apunte?.p ?? this.cursorQ });
      if (this.estado === antes) {
        this.cambiar({ campo: this.foto.campo && { ...this.foto.campo, texto, error: this.foto.error } });
        return false;
      }
      this.cambiar({ campo: null });
      return true;
    }
    const r = l.ok && ix ? resolverEntrada(l.valor, { ultimo: ultimoPunto(this.estado), cursor: this.cursorQ, direccion: ix.direccion, orto: this.foto.orto, mayus: this.mayus }) : null;
    if (!l.ok || !r || !r.ok) {
      const mensaje = !l.ok ? l.mensaje : r && !r.ok ? r.mensaje : "Lleve el cursor a una planta.";
      this.cambiar({ campo: this.foto.campo && { ...this.foto.campo, texto, error: mensaje } });
      return false;
    }
    this.cambiar({ campo: null });
    this.evento({ tipo: "punto", p: r.valor });
    return true;
  }

  // ─── Las vistas ─────────────────────────────────────────────────────────────────────────────

  private indice(planta: string): IndiceEnganches | null {
    if (!this.modelo || !this.modelo.plantas.some((p) => p.id === planta)) return null;
    let ix = this.indices.get(planta);
    if (!ix) {
      ix = indiceEnganches(this.modelo, planta);
      this.indices.set(planta, ix);
    }
    return ix;
  }

  private indiceActual(): IndiceEnganches | null {
    return this.planta ? this.indice(this.planta) : null;
  }

  /** Lo que se da a una vista de la planta `planta`. */
  adaptador(planta: string): Dibujo2D {
    let a = this.adaptadores.get(planta);
    if (a) return a;
    a = {
      pasar: (p, radio, mayus, cliente) => this.pasar(planta, p, radio, mayus, cliente),
      salir: () => this.salir(planta),
      clic: (p, radio, _ctrl, doble) => this.clic(planta, p, radio, doble),
      ventana: (caja) => this.ventana(planta, caja),
      cursor: () => this.cursor(planta),
      pintar: (ctx, aPx, c) => this.pintar(planta, ctx, aPx, c),
    };
    this.adaptadores.set(planta, a);
    return a;
  }

  private pasar(planta: string, q: Vec2, radio: number, mayus: boolean, cliente: readonly [number, number]): void {
    // Lo que se dibuja es de una planta: al pasar a la de otra vista, empieza de nuevo
    if (planta !== this.planta && this.estado.puntos.length) this.estado = ESTADO_INICIAL;
    if (planta !== this.planta) {
      this.planta = planta;
      this.cambiar({});
    }
    this.cursorQ = q;
    this.radio = radio;
    this.mayus = mayus;
    this.cliente = cliente;
    this.recalcular(false);
  }

  /** El enganche y lo de debajo con el cursor de ahora. */
  private recalcular(pintar = true): void {
    const ix = this.indiceActual();
    const q = this.cursorQ;
    if (!ix || !q) {
      this.apunte = null;
      this.silueta = null;
    } else {
      this.apunte = this.herramienta === "elegir" ? null : apuntar(ix, q, this.radio, { ultimo: ultimoPunto(this.estado), orto: this.foto.orto, mayus: this.mayus, activos: this.foto.activos });
      this.silueta = bajoCursor(ix, this.apunte?.p ?? q, this.radio);
    }
    if (pintar) this.repintar();
  }

  private salir(planta: string): void {
    if (planta !== this.planta) return;
    this.cursorQ = null;
    this.apunte = null;
    this.silueta = null;
  }

  private clic(planta: string, q: Vec2, radio: number, doble: boolean): boolean {
    if (this.herramienta === "elegir") return false;
    if (doble) {
      this.evento({ tipo: "terminar" });
      return true;
    }
    this.pasar(planta, q, radio, this.mayus, this.cliente);
    const a = this.apunte;
    if (a) this.evento({ tipo: "punto", p: a.p, enganche: a.enganche });
    return true;
  }

  private ventana(planta: string, caja: [number, number, number, number]): boolean {
    if (this.herramienta === "elegir") return false;
    if (planta !== this.planta) this.pasar(planta, [(caja[0] + caja[2]) / 2, (caja[1] + caja[3]) / 2], this.radio, false, this.cliente);
    this.evento({ tipo: "ventana", caja });
    return true;
  }

  private evento(ev: Evento): void {
    if (this.herramienta === "elegir") return;
    // Esc no necesita planta: sin el cursor en ninguna aún, también vuelve a Elegir
    const e = this.estado;
    if (ev.tipo === "anular" && !e.puntos.length && !e.fijos?.length && !e.activa) {
      this.cambiar({ error: null });
      this.alSalir();
      return;
    }
    if (!this.modelo || !this.planta) return;
    const ix = this.indiceActual();
    if (!ix) return;
    const r = paso(this.herramienta, this.estado, ev, { modelo: this.modelo, planta: this.planta, indice: ix, plantillas: this.plantillas });
    this.estado = r.estado;
    let error = r.error ?? null;
    let hecho: string | null = this.foto.hecho;
    if (r.hecho) {
      error = this.aplicar(r.hecho);
      if (!error) hecho = r.hecho.etiqueta;
    }
    this.cambiar({ error, hecho });
    if (r.salir) this.alSalir();
    this.recalcular();
  }

  private cursor(planta: string): { p: Vec2; texto: string } | null {
    if (planta !== this.planta || !this.cursorQ) return null;
    const a = this.apunte;
    const partes: string[] = [];
    if (a?.enganche) partes.push(`${NOMBRE_ENGANCHE[a.enganche.tipo]} (${a.enganche.objeto})`);
    else if (a?.orto) partes.push("Ortogonal");
    const c = this.cotaActiva();
    if (c) partes.push(`Cota ${nombreCota(c)}: ${c.texto}`);
    if (this.herramienta === "elegir" && this.silueta) partes.push(this.silueta.id);
    return { p: a?.p ?? this.cursorQ, texto: partes.join(" · ") };
  }

  // ─── Pintar ─────────────────────────────────────────────────────────────────────────────────

  private pintar(planta: string, ctx: CanvasRenderingContext2D, aPx: (q: Vec2) => [number, number], c: Colores): void {
    if (planta !== this.planta || !this.modelo) return;
    const ix = this.indiceActual();
    const camino = (ps: readonly Vec2[], cerrado: boolean) => {
      ctx.beginPath();
      ps.forEach((q, i) => {
        const [x, y] = aPx(q);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      if (cerrado) ctx.closePath();
    };
    // Lo que hay debajo
    const s = this.silueta;
    if (s && this.cursorQ) {
      ctx.strokeStyle = c.acento;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2;
      for (const r of s.cerrados) {
        camino(r, true);
        ctx.stroke();
      }
      if (!s.cerrados.length)
        for (const r of s.abiertos) {
          camino(r, false);
          ctx.stroke();
        }
      ctx.globalAlpha = 1;
    }
    if (this.herramienta === "elegir" || !ix) return;
    // El borrador
    const b = borrador(this.herramienta, this.estado, this.cursorQ ? (this.apunte?.p ?? this.cursorQ) : null, { modelo: this.modelo, planta, indice: ix, plantillas: this.plantillas });
    ctx.strokeStyle = c.acento;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    for (const l of b.lineas) {
      camino(l, false);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const r of b.anillos) {
      camino(r, true);
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = c.acento;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
    for (const q of b.puntos) {
      const [x, y] = aPx(q);
      ctx.fillStyle = c.acento;
      ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
    }
    for (const k of b.cotas) cotaTemporal(ctx, k, aPx, c);
    // El marcador del enganche
    const e = this.apunte?.enganche;
    if (e) marcador(ctx, e.tipo, aPx(e.p), c);
  }
}

/**
 * Una cota temporal: la línea de referencia (de trazos, del eje o pilar hasta la cota), la línea de
 * cota con sus marcas a 45° y el número en una etiqueta. La fijada, llena; la activa, con el borde
 * grueso; las demás, sólo el número.
 */
function cotaTemporal(ctx: CanvasRenderingContext2D, k: CotaTemporal, aPx: (q: Vec2) => [number, number], c: Colores): void {
  const [ax, ay] = aPx(k.a);
  const [bx, by] = aPx(k.b);
  const l = Math.hypot(bx - ax, by - ay);
  // Una cota nula (el punto en su referencia) sólo se ve fijada o activa: su número junto al punto
  if (l < 1 && !k.fija && !k.activa) return;
  const [ux, uy] = l < 1 ? [1, 0] : [(bx - ax) / l, (by - ay) / l];
  ctx.save();
  ctx.strokeStyle = c.acento;
  ctx.lineWidth = 1;
  if (k.extension) {
    const [ex, ey] = aPx(k.extension[0]);
    ctx.setLineDash([2, 3]);
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  // Marcas a 45° en los dos extremos
  const m = 4;
  for (const [x, y] of [
    [ax, ay],
    [bx, by],
  ] as const) {
    ctx.moveTo(x - m * (ux - uy), y - m * (uy + ux));
    ctx.lineTo(x + m * (ux - uy), y + m * (uy + ux));
  }
  ctx.stroke();
  // El número, centrado en la cota
  const texto = k.texto;
  ctx.font = `${k.activa || k.fija ? 600 : 400} 11px Geist, system-ui, sans-serif`;
  const w = ctx.measureText(texto).width + 8;
  const h = 16;
  // Centrada en la cota; si no cabe en ella, por fuera, más allá de la referencia
  const largo = Math.abs(ux) * w + Math.abs(uy) * h;
  const [mx, my] = l < 1 ? [bx + 18, by - 14] : l >= largo + 12 ? [(ax + bx) / 2, (ay + by) / 2] : [ax - ux * (largo / 2 + 6), ay - uy * (largo / 2 + 6)];
  ctx.fillStyle = k.fija ? c.acento : c.fondo;
  ctx.fillRect(mx - w / 2, my - h / 2, w, h);
  ctx.lineWidth = k.activa ? 2 : 1;
  ctx.strokeStyle = c.acento;
  ctx.strokeRect(mx - w / 2, my - h / 2, w, h);
  ctx.fillStyle = k.fija ? c.fondo : c.acento;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(texto, mx, my + 0.5);
  ctx.restore();
}

/** Un símbolo por tipo de enganche, como el «referencia a objetos» de los CAD. */
function marcador(ctx: CanvasRenderingContext2D, t: TipoEnganche, [x, y]: [number, number], c: Colores): void {
  const r = 6;
  ctx.beginPath();
  switch (t) {
    case "fijo":
    case "extremo":
      ctx.rect(x - r, y - r, 2 * r, 2 * r);
      break;
    case "centro":
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      break;
    case "esquina":
    case "vertice":
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      break;
    case "cruce":
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      break;
    case "medio":
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r * 0.8);
      ctx.lineTo(x - r, y + r * 0.8);
      ctx.closePath();
      break;
    case "cara":
      ctx.rect(x - r, y - r, 2 * r, 2 * r);
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      break;
    case "perpendicular":
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x - r, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + r);
      break;
    case "cercano":
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.lineTo(x + r, y + r);
      ctx.closePath();
      break;
  }
  ctx.lineWidth = 4;
  ctx.strokeStyle = c.fondo;
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = c.acento;
  ctx.stroke();
}
