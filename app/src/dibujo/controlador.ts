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
 *
 * Con Elegir, en las vistas con la cadena de cotas entre ejes (la de `modelo`), un clic en el número
 * de una cota la elige para estirar el modelo (CT2, §2.2): se pintan una flecha en cada extremo, un
 * clic en una elige el lado que se mueve y abre el campo con el valor actual, ← y → cambian de lado,
 * Intro aplica (`src/editor/estirar.ts`) y Esc anula. Mientras, en todas las plantas se resalta lo que
 * se mueve (lleno) y lo que se alarga (de trazos), con la línea de corte.
 *
 * Con Elegir y un solo pilar elegido, se pintan sus cotas temporales (CT3, §2.3), sin él entre las
 * referencias, en las vistas de planta en las que está: un clic en un número (o Tab) la elige y abre
 * el campo con su valor, Intro mueve el pilar con las vigas que acaban en su punto fijo, en todas sus
 * plantas (`moverPilar`), Ctrl+Intro lo mueve solo y Esc la deja.
 *
 * V2c-3 (`docs/fem3d/dibujo.md` §9): Mover, Copiar, Girar y Simetría (`editar.ts`). Sin lo elegido
 * confirmado, los clics y las ventanas van a elegir; un clic sin Ctrl (o Intro, con lo sumado con
 * Ctrl) lo confirma. Con Elegir, lo elegido enseña sus vértices (pinzamientos, `transformar.ts`): un
 * clic en uno lo coge (o se arrastra) y el clic siguiente, enganchado o tecleado, lo deja; Ctrl, un
 * pilar sin sus vigas; Esc lo suelta.
 *
 * V2c-4 (`docs/fem3d/dibujo.md` §10): en las vistas con la plantilla DXF visible, sus rasgos entran
 * en el índice de enganches de la planta (`ponerPlantillasDxf`); la barra dice «(DXF …)».
 */
import type { ModeloFisico, Vec2 } from "../../../src/compilador/fisico.ts";
import { apuntar, bajoCursor, FUENTES_ENGANCHE, indiceEnganches, NOMBRE_ENGANCHE, RADIO_ENGANCHE, TIPOS_ENGANCHE, type Apunte, type FuenteEnganche, type IndiceEnganches, type Silueta, type TipoEnganche } from "../../../src/editor/dibujo/enganches.ts";
import type { IndicePlantilla } from "../../../src/editor/dibujo/plantilla.ts";
import { colocar, cotasEn, LADOS, nombreCota, referenciasCotas, type CotaTemporal, type Lado, type ReferenciasCotas } from "../../../src/editor/dibujo/cotas.ts";
import { PlantaFisica } from "../../../src/agente/render/modelo.ts";
import { cadenasDe, cotasCadena, rotuloCota, type CotaCadena } from "../../../src/agente/render/ejes.ts";
import { ejesDe } from "../../../src/compilador/ejes.ts";
import { afectados, corte, estirar, moverPilar, type Estiramiento } from "../../../src/editor/estirar.ts";
import { ayuda, borrador, ESTADO_INICIAL, paso, ultimoPunto, type EstadoHerramienta, type Evento, type Hecho, type NombreHerramienta, type Plantillas } from "../../../src/editor/dibujo/herramientas.ts";
import { esEditar, medidaEditar } from "../../../src/editor/dibujo/editar.ts";
import { asas, moverAsa, type Asa } from "../../../src/editor/transformar.ts";
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
  /** De dónde se engancha: el modelo y las plantillas DXF. */
  fuentes: ReadonlySet<FuenteEnganche>;
  /** El campo de teclado, abierto con su texto inicial y dónde (px de la ventana); `cota`, la que fija lo que se escriba; `seleccionar`, con el texto elegido (se escribe encima) y por encima del punto (CT2: la cota está junto a la barra). */
  campo: { n: number; texto: string; x: number; y: number; error: string | null; cota?: string; seleccionar?: boolean } | null;
  /** CT2: lo que dice la barra mientras se estira desde una cota. */
  estirado: string | null;
  /** CT2: los avisos del último estirado (un hueco de muro que cambia de ancho); CT3, los de mover un pilar. */
  aviso: string | null;
  /** CT3: lo que dice la barra con un solo pilar elegido. */
  pilar: string | null;
  /** V2c-3: lo que dice la barra con un vértice cogido (pinzamientos). */
  asa: string | null;
  /** V2c-3: lo elegido que transforma la herramienta de editar, ya confirmado. */
  transformando: readonly string[] | null;
}

/** Por fuera de cada extremo de la cota que se estira, el centro de su flecha, px. */
const FLECHA = 16;

/** Con más elegidos, no se enseñan sus vértices (pinzamientos). */
const MAX_ASAS = 60;

/** Una cota de la cadena elegida para estirar y el extremo que se mueve (0, el de t menor; 1, el otro; null, sin elegir). */
interface Estirado {
  cota: CotaCadena;
  mueve: 0 | 1 | null;
}

export class ControladorDibujo {
  private modelo: ModeloFisico | null = null;
  private plantillas: Plantillas = { pilar: {}, viga: {} };
  /** Aplica lo terminado; devuelve el error si no se pudo. */
  aplicar: (h: Hecho) => string | null = () => "No hay ningún proyecto que editar.";
  /** Vuelve a Elegir (Esc sin nada en curso). */
  alSalir: () => void = () => {};
  /** Repinta las vistas (una tecla cambia el dibujo sin un evento de la vista). */
  repintar: () => void = () => {};

  private herramienta: NombreHerramienta = "elegir";
  private estado: EstadoHerramienta = ESTADO_INICIAL;
  private planta: string | null = null;
  /** Los índices de enganches por planta (y, con la plantilla DXF, por planta y «dxf»). */
  private readonly indices = new Map<string, IndiceEnganches>();
  /** V2c-4: el índice de la plantilla DXF de cada planta, y si la vista del cursor la tiene visible. */
  private plantillasDxf: ((planta: string) => IndicePlantilla | null) | null = null;
  private conPlantilla = false;
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
  /** CT2: las cotas de la cadena del modelo (se rehacen con él), la elegida y lo que mueve. */
  private cadena: CotaCadena[] | null = null;
  private estirado: Estirado | null = null;
  private afectadosCache: { clave: string; mueven: Set<string>; alargan: Set<string> } | null = null;
  /** Si la vista del cursor tiene la cadena de cotas, y la cota bajo el cursor (con Elegir). */
  private conCotas = false;
  private cotaBajo: CotaCadena | null = null;
  /** CT3: lo elegido, las referencias de las cotas del pilar elegido por planta, la cota activa y la que está bajo el cursor. */
  private elegidos: readonly string[] = [];
  private readonly refsPilar = new Map<string, ReferenciasCotas | null>();
  private ladoPilar: Lado | null = null;
  private ladoBajo: Lado | null = null;
  /** V2c-3: el último clic de elegir con una herramienta de editar esperando elección llevaba Ctrl (suma; no confirma). */
  private ctrlEleccion = false;
  /** V2c-3: los vértices de lo elegido en una planta, el que está bajo el cursor y el cogido. */
  private asasCache: { planta: string; elegidos: readonly string[]; lista: Asa[] } | null = null;
  private asaBajo: Asa | null = null;
  private asaActiva: Asa | null = null;

  constructor() {
    this.foto = { herramienta: "elegir", ayuda: "", error: null, hecho: null, orto: false, activos: new Set(TIPOS_ENGANCHE), fuentes: new Set(FUENTES_ENGANCHE), campo: null, estirado: null, aviso: null, pilar: null, asa: null, transformando: null };
  }

  // ─── Para React ─────────────────────────────────────────────────────────────────────────────

  suscribir = (f: () => void): (() => void) => {
    this.oyentes.add(f);
    return () => this.oyentes.delete(f);
  };

  instantanea = (): Instantanea => this.foto;

  private cambiar(c: Partial<Instantanea>): void {
    this.foto = { ...this.foto, ayuda: ayuda(this.herramienta, this.estado, this.plantillas), transformando: this.estado.elegidos ?? null, ...c };
    for (const f of this.oyentes) f();
  }

  ponerModelo(m: ModeloFisico | null): void {
    if (m === this.modelo) return;
    this.modelo = m;
    this.indices.clear();
    this.cadena = null;
    this.afectadosCache = null;
    this.cotaBajo = null;
    this.refsPilar.clear();
    // La cota elegida era del modelo de antes
    if (this.estirado) this.anularEstirado();
    this.soltarPilar();
    this.asasCache = null;
    this.asaBajo = null;
    if (this.asaActiva) this.soltarAsa();
    // Lo recién dibujado ya engancha, sin esperar a que se mueva el ratón
    this.recalcular();
  }

  /** V2c-4: las plantillas DXF (el índice de cada planta; cambia al leer una o al colocarla). */
  ponerPlantillasDxf(f: ((planta: string) => IndicePlantilla | null) | null): void {
    if (f === this.plantillasDxf) return;
    this.plantillasDxf = f;
    this.indices.clear();
    this.recalcular();
  }

  /**
   * La plantilla de las herramientas (desde un efecto: cambia la ayuda y el borrador). Si cambia el
   * modo de la herramienta activa (recuadro o polígono, rectángulo, zona, tramo), lo que estaba en
   * curso se anula.
   */
  ponerPlantillas(t: Plantillas): void {
    if (t === this.plantillas) return;
    const modo = (x: Plantillas) => JSON.stringify([x.forjado?.modo, x.hueco?.modo, x.cargas?.superficie?.modo, x.cargas?.barra?.modo]);
    if (modo(t) !== modo(this.plantillas)) this.estado = ESTADO_INICIAL;
    this.plantillas = t;
    this.cambiar({});
    this.repintar();
  }

  ponerHerramienta(h: NombreHerramienta): void {
    if (h === this.herramienta) return;
    this.herramienta = h;
    this.estado = ESTADO_INICIAL;
    this.apunte = null;
    this.estirado = null;
    this.ladoPilar = null;
    this.asaActiva = null;
    this.asaBajo = null;
    this.ctrlEleccion = false;
    this.cambiar({ herramienta: h, error: null, hecho: null, campo: null, estirado: null, aviso: null, pilar: this.textoPilar(), asa: null });
    // V2c-3: con algo elegido, Mover, Copiar, Girar y Simetría empiezan ya con ello
    if (esEditar(h) && this.elegidos.length) this.evento({ tipo: "elegidos", ids: this.elegidos });
    this.repintar();
  }

  /** V2c-3: la herramienta de editar espera a que se elija (sus clics y ventanas eligen). */
  private eligiendo(): boolean {
    return esEditar(this.herramienta) && !this.estado.elegidos;
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

  ponerFuentes(f: ReadonlySet<FuenteEnganche>): void {
    this.cambiar({ fuentes: f });
    this.recalcular();
  }

  /** F3: enciende o apaga los enganches a la plantilla DXF. */
  alternarPlantilla(): void {
    const f = new Set(this.foto.fuentes);
    if (f.has("plantilla")) f.delete("plantilla");
    else f.add("plantilla");
    this.ponerFuentes(f);
  }

  // ─── Teclado ────────────────────────────────────────────────────────────────────────────────

  intro(): void {
    const a = this.apunte;
    this.evento({ tipo: "terminar", p: a?.p ?? null, enganche: a?.enganche ?? null });
  }

  /** El clic derecho: Intro si la herramienta tiene puntos en curso (termina una viga, un muro, un polígono). */
  derecho(): boolean {
    if (this.herramienta === "elegir" || !this.estado.puntos.length) return false;
    this.intro();
    return true;
  }

  /** Tab (Mayús+Tab, `atras`): la cota temporal siguiente. Devuelve si la herramienta las tiene. */
  tab(atras = false): boolean {
    if (this.herramienta === "elegir") return this.tabPilar(atras);
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
    return borrador(this.herramienta, this.estado, this.apunte?.p ?? this.cursorQ, { modelo: this.modelo, planta: this.planta, indice: ix, plantillas: this.plantillas }, this.cursorQ).cotas;
  }

  anular(): void {
    this.evento({ tipo: "anular" });
  }

  /** V2c-3: hay un punto en curso de una herramienta de editar (Esc lo anula y lo elegido se queda). */
  get editando(): boolean {
    return esEditar(this.herramienta) && !!this.estado.elegidos && this.estado.puntos.length > 0;
  }

  retroceso(): void {
    this.evento({ tipo: "retroceso" });
  }

  abrirCampo(texto: string): void {
    if (this.herramienta === "elegir" && this.ladoPilar) return this.abrirCampoPilar(texto);
    if (this.herramienta === "elegir" && this.asaActiva) {
      this.cambiar({ campo: { n: ++this.abiertos, texto, x: this.cliente[0], y: this.cliente[1], error: null, cota: `vértice de ${this.asaActiva.id}` } });
      return;
    }
    if (this.eligiendo()) return;
    if (this.herramienta === "elegir" && this.estirado?.mueve == null) return;
    this.cambiar({ campo: { n: this.abiertos + 1, texto, x: this.cliente[0], y: this.cliente[1], error: null, ...this.cotaCampo() } });
    this.abiertos++;
  }

  cerrarCampo(): void {
    if (this.foto.campo) this.cambiar({ campo: null });
  }

  /** Esc en el campo: anula el estirado o, si no, sólo cierra el campo. */
  escCampo(): void {
    if (this.estirado) this.anularEstirado();
    else if (this.ladoPilar) this.soltarPilar();
    else if (this.asaActiva) this.soltarAsa();
    else this.cerrarCampo();
  }

  /** Lo escrito en el campo, como un punto; con `ctrl` (Ctrl+Intro), un pilar movido sin sus vigas (CT3). Devuelve si se aceptó. */
  teclear(texto: string, ctrl = false): boolean {
    if (this.estirado?.mueve != null) return this.teclearEstirado(texto);
    if (this.herramienta === "elegir" && this.ladoPilar) return this.teclearPilar(texto, ctrl);
    const ix = this.indiceActual();
    const l = leerEntrada(texto);
    // Girar: un número suelto son los grados
    if (l.ok && l.valor.tipo === "longitud" && this.herramienta === "girar" && this.estado.puntos.length === 1) {
      this.cambiar({ campo: null });
      this.evento({ tipo: "fijar", valor: l.valor.l, cursor: this.cursorQ });
      return true;
    }
    // Un vértice cogido: el punto escrito («@dx; dy», desde donde estaba)
    if (this.herramienta === "elegir" && this.asaActiva) {
      const r = l.ok && ix ? resolverEntrada(l.valor, { ultimo: this.asaActiva.p, cursor: this.cursorQ, direccion: ix.direccion, orto: this.foto.orto, mayus: this.mayus }) : null;
      if (!l.ok || !r || !r.ok) {
        this.cambiar({ campo: this.foto.campo && { ...this.foto.campo, texto, error: !l.ok ? l.mensaje : r && !r.ok ? r.mensaje : "Lleve el cursor a una planta." } });
        return false;
      }
      const error = this.dejarAsa(r.valor, ctrl);
      if (error) {
        this.cambiar({ campo: this.foto.campo && { ...this.foto.campo, texto, error } });
        return false;
      }
      this.cambiar({ campo: null });
      return true;
    }
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
    const pl = this.conPlantilla ? (this.plantillasDxf?.(planta) ?? null) : null;
    const clave = pl ? `${planta}\u0000dxf` : planta;
    let ix = this.indices.get(clave);
    if (!ix) {
      // Con la plantilla, el mismo índice del modelo y el suyo
      const base = this.indices.get(planta) ?? indiceEnganches(this.modelo, planta);
      this.indices.set(planta, base);
      ix = pl ? { ...base, plantilla: pl } : base;
      this.indices.set(clave, ix);
    }
    return ix;
  }

  private indiceActual(): IndiceEnganches | null {
    return this.planta ? this.indice(this.planta) : null;
  }

  /**
   * Lo que se da a una vista de la planta `planta`; `cotas`, si dibuja la cadena de cotas entre ejes
   * (CT2); `plantilla`, si tiene visible la plantilla DXF (V2c-4: engancha a ella).
   */
  adaptador(planta: string, o: { cotas?: boolean; plantilla?: boolean } = {}): Dibujo2D {
    const cotas = !!o.cotas;
    const plantilla = !!o.plantilla;
    const clave = `${planta}\u0000${cotas}\u0000${plantilla}`;
    let a = this.adaptadores.get(clave);
    if (a) return a;
    const vista = () => {
      this.conCotas = cotas;
      this.conPlantilla = plantilla;
    };
    a = {
      pasar: (p, radio, mayus, cliente) => {
        vista();
        this.pasar(planta, p, radio, mayus, cliente);
      },
      salir: () => this.salir(planta),
      clic: (p, radio, ctrl, doble) => {
        vista();
        return this.herramienta === "elegir" ? this.clicElegir(planta, p, radio, ctrl, doble, cotas) : this.clic(planta, p, radio, doble, ctrl);
      },
      ventana: (caja, ctrl) => this.ventana(planta, caja, !!ctrl),
      agarrar: (p, radio) => this.agarrar(planta, p, radio),
      derecho: () => this.derecho(),
      cursor: () => this.cursor(planta),
      pintar: (ctx, aPx, c) => this.pintar(planta, ctx, aPx, c, cotas),
    };
    this.adaptadores.set(clave, a);
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
    const [antes, ladoAntes, asaAntes] = [this.cotaBajo, this.ladoBajo, this.asaBajo];
    this.asaBajo = this.herramienta === "elegir" && !this.asaActiva && !this.estirado ? this.asaEn(planta, q, radio) : null;
    this.ladoBajo = this.herramienta === "elegir" && this.conCotas && !this.estirado && !this.asaBajo && !this.asaActiva ? this.cotaPilarEn(planta, q, radio / RADIO_ENGANCHE) : null;
    this.cotaBajo = this.herramienta === "elegir" && this.conCotas && !this.ladoBajo && !this.asaBajo && !this.asaActiva ? this.cotaEn(q, radio / RADIO_ENGANCHE) : null;
    this.recalcular(this.cotaBajo !== antes || this.ladoBajo !== ladoAntes || this.asaBajo !== asaAntes || !!this.asaActiva);
  }

  /** El enganche y lo de debajo con el cursor de ahora. */
  private recalcular(pintar = true): void {
    const ix = this.indiceActual();
    const q = this.cursorQ;
    if (!ix || !q) {
      this.apunte = null;
      this.silueta = null;
    } else {
      const asa = this.herramienta === "elegir" ? this.asaActiva : null;
      this.apunte = asa ? apuntar(ix, q, this.radio, { ultimo: asa.p, orto: this.foto.orto, mayus: this.mayus, activos: this.foto.activos, fuentes: this.foto.fuentes }) : this.herramienta === "elegir" || this.eligiendo() ? null : apuntar(ix, q, this.radio, { ultimo: ultimoPunto(this.estado), orto: this.foto.orto, mayus: this.mayus, activos: this.foto.activos, fuentes: this.foto.fuentes });
      this.silueta = bajoCursor(ix, this.apunte?.p ?? q, this.radio);
    }
    if (pintar) this.repintar();
  }

  private salir(planta: string): void {
    if (planta !== this.planta) return;
    this.cursorQ = null;
    this.apunte = null;
    this.silueta = null;
    this.cotaBajo = null;
    this.ladoBajo = null;
    this.asaBajo = null;
  }

  // ─── Pinzamientos (V2c-3) ───────────────────────────────────────────────────────────────────

  /** Los vértices de lo elegido en la planta (con Elegir y a lo sumo `MAX_ASAS` objetos). */
  private asasDe(planta: string): Asa[] {
    if (this.herramienta !== "elegir" || !this.modelo || !this.elegidos.length || this.elegidos.length > MAX_ASAS) return [];
    const c = this.asasCache;
    if (c && c.planta === planta && c.elegidos === this.elegidos) return c.lista;
    const lista = asas(this.modelo, this.elegidos, planta);
    this.asasCache = { planta, elegidos: this.elegidos, lista };
    return lista;
  }

  /** El vértice más cercano a q a menos del radio (los pilares primero: arrastran sus vigas). */
  private asaEn(planta: string, q: Vec2, radio: number): Asa | null {
    let mejor: Asa | null = null;
    let dm = radio;
    for (const a of this.asasDe(planta)) {
      const d = Math.hypot(a.p[0] - q[0], a.p[1] - q[1]) - (a.coleccion === "pilares" ? radio / 2 : 0);
      if (d <= dm) [mejor, dm] = [a, d];
    }
    return mejor;
  }

  /** Coge el vértice bajo p (un clic o el principio de un arrastre). */
  private agarrar(planta: string, p: Vec2, radio: number): boolean {
    if (this.herramienta !== "elegir" || this.asaActiva || this.estirado || this.ladoPilar) return false;
    const a = this.asaEn(planta, p, radio);
    if (!a) return false;
    this.planta = planta;
    this.asaActiva = a;
    this.asaBajo = null;
    this.cursorQ = p;
    this.radio = radio;
    this.cambiar({ asa: this.textoAsa(), aviso: null, error: null });
    this.recalcular();
    return true;
  }

  private textoAsa(): string | null {
    const a = this.asaActiva;
    if (!a) return null;
    const que = a.coleccion === "pilares" ? `${a.id} (su punto fijo)` : a.ruta[0] === "x" ? a.id : `un vértice de ${a.id}`;
    return `${que}: el punto nuevo (clic, o «x; y», «@dx; dy» e Intro)${a.coleccion === "pilares" ? "; con Ctrl, sin sus vigas" : ""}. Esc lo suelta.`;
  }

  /** Esc: suelta el vértice cogido sin moverlo. */
  soltarAsa(): void {
    if (!this.asaActiva) return;
    this.asaActiva = null;
    this.apunte = null;
    this.cambiar({ asa: null, campo: null, error: null });
    this.repintar();
  }

  /** Lleva el vértice cogido a q; con `solo`, un pilar sin sus vigas. Devuelve el error, si lo hay. */
  private dejarAsa(q: Vec2, solo: boolean): string | null {
    const a = this.asaActiva;
    if (!a || !this.modelo) return "No hay ningún vértice cogido.";
    const r = moverAsa(this.modelo, a, q, !solo);
    if (!r.ok) {
      this.cambiar({ error: r.mensaje });
      return r.mensaje;
    }
    const etiqueta = `Mover ${a.coleccion === "pilares" || a.ruta[0] === "x" ? a.id : `un vértice de ${a.id}`}${solo && a.coleccion === "pilares" ? ", sin sus vigas" : ""}`;
    const error = this.aplicar({ operacion: r.operacion, etiqueta });
    if (error) {
      this.cambiar({ error });
      return error;
    }
    this.asaActiva = null;
    this.cambiar({ asa: null, error: null, hecho: etiqueta, aviso: r.avisos.length ? r.avisos.join(" ") : null });
    this.repintar();
    return null;
  }

  /** Con Elegir: un vértice cogido se deja; si no, las cotas (CT2, CT3) o elegir. */
  private clicElegir(planta: string, q: Vec2, radio: number, ctrl: boolean, doble: boolean, cotas: boolean): boolean {
    if (this.asaActiva) {
      // El doble clic sobre el asa que se acaba de coger no la deja en su sitio
      if (doble) return true;
      this.pasar(planta, q, radio, this.mayus, this.cliente);
      this.dejarAsa(this.apunte?.p ?? q, ctrl);
      return true;
    }
    return this.clicCotas(planta, q, radio, cotas);
  }

  // ─── Estirar desde una cota (CT2) ───────────────────────────────────────────────────────────

  private cotasDeCadena(): CotaCadena[] {
    if (!this.modelo) return [];
    this.cadena ??= cadenasDe(this.modelo).flatMap(cotasCadena);
    return this.cadena;
  }

  /** La cota cuyo número está bajo q (px: los m de un px). */
  private cotaEn(q: Vec2, px: number): CotaCadena | null {
    let mejor: CotaCadena | null = null;
    let dm = Infinity;
    for (const k of this.cotasDeCadena()) {
      const { d, n } = k.cadena;
      const v: Vec2 = [q[0] - k.p[0], q[1] - k.p[1]];
      const [a, b] = [Math.abs(v[0] * n[0] + v[1] * n[1]), Math.abs(v[0] * d[0] + v[1] * d[1])];
      // El rótulo, a lo largo de la cota: ~6,5 px por carácter de 11 px
      if (a > Math.min(k.valor / 2, ((k.texto.length * 6.5) / 2 + 6) * px) || b > 12 * px) continue;
      if (a + b < dm) [mejor, dm] = [k, a + b];
    }
    return mejor;
  }

  /** El centro de la flecha del extremo `lado` de la cota. */
  private flecha(k: CotaCadena, lado: 0 | 1, px: number): Vec2 {
    const { n } = k.cadena;
    const [e, s] = lado ? [k.b, 1] : [k.a, -1];
    return [e[0] + s * n[0] * FLECHA * px, e[1] + s * n[1] * FLECHA * px];
  }

  /** El estiramiento de la cota elegida, con el extremo que se mueve. */
  private estiramiento(): Estiramiento | null {
    const x = this.estirado;
    if (!x || x.mueve === null) return null;
    const c = x.cota.cadena;
    const [ta, tb] = [c.ts[x.cota.i - 1]!, c.ts[x.cota.i]!];
    return x.mueve ? { n: c.n, fijo: ta, movil: tb } : { n: c.n, fijo: tb, movil: ta };
  }

  /** Los nombres de los ejes de los dos extremos de la cota, el de t menor primero. */
  private nombres(k: CotaCadena): [string, string] {
    const ejes = this.modelo ? ejesDe(this.modelo).ejes : [];
    const nombre = (id: string | undefined) => ejes.find((x) => x.id === id)?.nombre ?? id ?? "?";
    return [nombre(k.cadena.ejes[k.i - 1]?.[0]), nombre(k.cadena.ejes[k.i]?.[0])];
  }

  /** «1–2»: los nombres en el orden de lectura (de izquierda a derecha o de abajo arriba). */
  private titulo(k: CotaCadena): string {
    const [a, b] = this.nombres(k);
    const [dx, dy] = [k.b[0] - k.a[0], k.b[1] - k.a[1]];
    return dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dy < 0) ? `${b}–${a}` : `${a}–${b}`;
  }

  private textoEstirado(): string | null {
    const x = this.estirado;
    if (!x) return null;
    const [a, b] = this.nombres(x.cota);
    const cota = `Cota ${this.titulo(x.cota)} (${x.cota.texto} m)`;
    if (x.mueve === null) return `${cota}: elija la flecha del lado que se mueve. Esc anula.`;
    return `${cota}: se mueve el eje ${x.mueve ? b : a} y lo que hay más allá. Escriba la distancia e Intro; ← y → cambian de lado; Esc anula.`;
  }

  private textoCampo(): string {
    const x = this.estirado!;
    const [a, b] = this.nombres(x.cota);
    return `${this.titulo(x.cota)}, se mueve el ${x.mueve ? b : a}`;
  }

  private clicCotas(planta: string, q: Vec2, radio: number, cotas: boolean): boolean {
    const px = radio / RADIO_ENGANCHE;
    // CT3: el número de una cota del pilar elegido
    const lado = cotas && !this.estirado ? this.cotaPilarEn(planta, q, px) : null;
    if (lado) {
      this.planta = planta;
      this.ladoPilar = lado;
      this.abrirCampoPilar(null);
      this.repintar();
      return true;
    }
    if (this.ladoPilar) this.soltarPilar();
    const x = this.estirado;
    if (x && cotas)
      for (const lado of [0, 1] as const) {
        const f = this.flecha(x.cota, lado, px);
        if (Math.hypot(q[0] - f[0], q[1] - f[1]) <= 12 * px) {
          this.elegirLado(lado);
          return true;
        }
      }
    const k = cotas ? this.cotaEn(q, px) : null;
    if (k) {
      this.planta = planta;
      this.estirado = { cota: k, mueve: null };
      this.cambiar({ estirado: this.textoEstirado(), campo: null, aviso: null });
      this.repintar();
      return true;
    }
    if (x) this.anularEstirado();
    return false;
  }

  private elegirLado(lado: 0 | 1): void {
    const x = this.estirado;
    if (!x) return;
    x.mueve = lado;
    this.cambiar({ estirado: this.textoEstirado(), campo: { n: ++this.abiertos, texto: rotuloCota(x.cota.valor), x: this.cliente[0], y: this.cliente[1], error: null, cota: this.textoCampo(), seleccionar: true } });
    this.repintar();
  }

  /** ← o →: el otro extremo de la cota. Devuelve si había un lado elegido. */
  cambiarLado(): boolean {
    const x = this.estirado;
    if (!x || x.mueve === null) return false;
    x.mueve = x.mueve ? 0 : 1;
    const c = this.foto.campo;
    this.cambiar({ estirado: this.textoEstirado(), ...(c ? { campo: { ...c, cota: this.textoCampo(), error: null } } : {}) });
    this.repintar();
    return true;
  }

  /** Esc: deja la cota. */
  anularEstirado(): void {
    if (!this.estirado) return;
    this.estirado = null;
    this.cambiar({ estirado: null, campo: null });
    this.repintar();
  }

  private teclearEstirado(texto: string): boolean {
    const e = this.estiramiento();
    const l = leerEntrada(texto);
    const campo = (error: string) => {
      this.cambiar({ campo: this.foto.campo && { ...this.foto.campo, texto, error } });
      return false;
    };
    if (!e || !this.modelo) return campo("No hay ninguna cota elegida.");
    if (!l.ok || l.valor.tipo !== "longitud") return campo("Escriba la distancia entre los dos ejes, m (p. ej. «5,40»).");
    const r = estirar(this.modelo, e, l.valor.l);
    if (!r.ok) return campo(r.mensaje);
    const etiqueta = `Estirar ${this.titulo(this.estirado!.cota)} a ${rotuloCota(l.valor.l)} m`;
    const error = this.aplicar({ operacion: r.operacion, etiqueta });
    if (error) return campo(error);
    this.estirado = null;
    this.cambiar({ estirado: null, campo: null, hecho: etiqueta, aviso: r.avisos.length ? r.avisos.join(" ") : null });
    this.repintar();
    return true;
  }

  /** Lo que mueve y lo que alarga la cota elegida (se rehace al cambiar de lado o de modelo). */
  private afectadosAhora(): { mueven: Set<string>; alargan: Set<string> } | null {
    const e = this.estiramiento();
    if (!e || !this.modelo) return null;
    const clave = `${e.n[0]} ${e.n[1]} ${e.fijo} ${e.movil}`;
    if (this.afectadosCache?.clave !== clave) {
      const a = afectados(this.modelo, e);
      this.afectadosCache = { clave, mueven: new Set(a.mueven), alargan: new Set(a.alargan) };
    }
    return this.afectadosCache;
  }

  /** Lo de estirar en una vista: lo que se mueve y se alarga, la línea de corte y la cota con sus flechas. */
  private pintarEstirado(planta: string, ctx: CanvasRenderingContext2D, aPx: (q: Vec2) => [number, number], c: Colores, cotas: boolean): void {
    const x = this.estirado!;
    const camino = (ps: readonly Vec2[], cerrado: boolean) => {
      ctx.beginPath();
      ps.forEach((q, i) => {
        const [u, v] = aPx(q);
        if (i) ctx.lineTo(u, v);
        else ctx.moveTo(u, v);
      });
      if (cerrado) ctx.closePath();
    };
    ctx.save();
    ctx.strokeStyle = c.acento;
    ctx.fillStyle = c.acento;
    const af = this.afectadosAhora();
    const ix = af ? this.indice(planta) : null;
    if (af && ix) {
      for (const s of ix.siluetas) {
        const mueve = af.mueven.has(s.id);
        if (!mueve && !af.alargan.has(s.id)) continue;
        ctx.setLineDash(mueve ? [] : [5, 3]);
        ctx.lineWidth = mueve ? 2 : 1.5;
        for (const r of s.cerrados) {
          camino(r, true);
          if (mueve) {
            ctx.globalAlpha = s.tipo === "losa" || s.tipo === "pano" ? 0.08 : 0.3;
            ctx.fill("evenodd");
          }
          ctx.globalAlpha = 0.9;
          ctx.stroke();
        }
        if (!s.cerrados.length)
          for (const r of s.abiertos) {
            camino(r, false);
            ctx.globalAlpha = 0.9;
            ctx.stroke();
          }
      }
      // La línea de corte, de lado a lado
      const e = this.estiramiento()!;
      const { d } = x.cota.cadena;
      const t = corte(e);
      const lejos = 1e4;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1;
      ctx.setLineDash([10, 4, 2, 4]);
      camino(
        [
          [t * e.n[0] - lejos * d[0], t * e.n[1] - lejos * d[1]],
          [t * e.n[0] + lejos * d[0], t * e.n[1] + lejos * d[1]],
        ],
        false,
      );
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    if (cotas) {
      // La cota, gruesa, y una flecha por fuera de cada extremo (llena, la del lado que se mueve)
      const k = x.cota;
      ctx.lineWidth = 2.5;
      camino([k.a, k.b], false);
      ctx.stroke();
      const [ax, ay] = aPx(k.a);
      const [bx, by] = aPx(k.b);
      const l = Math.hypot(bx - ax, by - ay) || 1;
      const [ux, uy] = [(bx - ax) / l, (by - ay) / l];
      for (const lado of [0, 1] as const) {
        const [ex, ey] = lado ? [bx, by] : [ax, ay];
        const s = lado ? 1 : -1;
        // La punta, hacia fuera de la cota
        const [px, py] = [ex + s * ux * (FLECHA + 8), ey + s * uy * (FLECHA + 8)];
        const [qx, qy] = [ex + s * ux * (FLECHA - 8), ey + s * uy * (FLECHA - 8)];
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(qx - uy * 7, qy + ux * 7);
        ctx.lineTo(qx + uy * 7, qy - ux * 7);
        ctx.closePath();
        ctx.lineWidth = 1.5;
        ctx.fillStyle = x.mueve === lado ? c.acento : c.fondo;
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ─── Las cotas del pilar elegido (CT3) ──────────────────────────────────────────────────────

  /** Lo elegido en las vistas, el navegador o la tabla. */
  ponerElegidos(ids: readonly string[]): void {
    if (ids === this.elegidos) return;
    this.elegidos = ids;
    this.ladoBajo = null;
    this.asaBajo = null;
    if (this.ladoPilar) this.soltarPilar();
    if (this.asaActiva) this.soltarAsa();
    // V2c-3: lo elegido para Mover, Copiar, Girar o Simetría (con Ctrl se suma, y lo confirma Intro)
    if (esEditar(this.herramienta) && (this.estado.elegidos || (ids.length && !this.ctrlEleccion))) this.evento({ tipo: "elegidos", ids });
    else if (!esEditar(this.herramienta)) this.cambiar({ aviso: null });
    this.cambiar({ pilar: this.textoPilar() });
    this.repintar();
  }

  /** El pilar elegido solo, con Elegir. */
  private pilarElegido() {
    if (this.herramienta !== "elegir" || this.elegidos.length !== 1 || !this.modelo) return null;
    return this.modelo.pilares?.find((p) => p.id === this.elegidos[0]) ?? null;
  }

  /** Las cotas del pilar elegido en la planta (null si no hay o no está en ella). */
  private cotasPilar(planta: string): { id: string; p: Vec2; R: ReferenciasCotas; cotas: CotaTemporal[] } | null {
    const pil = this.pilarElegido();
    const ix = pil ? this.indice(planta) : null;
    if (!pil || !ix || !this.modelo) return null;
    const clave = `${planta}\u0000${pil.id}`;
    let R = this.refsPilar.get(clave);
    if (R === undefined) {
      R = new PlantaFisica(this.modelo, planta).pilares().some((x) => x.p.id === pil.id) ? referenciasCotas(this.modelo, planta, ix.direccion, pil.id) : null;
      this.refsPilar.set(clave, R);
    }
    if (!R) return null;
    const p: Vec2 = [pil.x, pil.y];
    return { id: pil.id, p, R, cotas: cotasEn(R, p) };
  }

  /**
   * La cota del pilar elegido cuyo número está bajo q (px: los m de un px), con el rótulo donde lo
   * pone `cotaTemporal`: centrado en la cota o, si no cabe, más allá de su referencia.
   */
  private cotaPilarEn(planta: string, q: Vec2, px: number): Lado | null {
    const x = this.cotasPilar(planta);
    if (!x) return null;
    for (const k of x.cotas) {
      const l = Math.hypot(k.b[0] - k.a[0], k.b[1] - k.a[1]);
      if (!(l > 0)) continue;
      const u: Vec2 = [(k.b[0] - k.a[0]) / l, (k.b[1] - k.a[1]) / l];
      // ~6,5 px por carácter de 11 px, como en `cotaEn`
      const [w, h] = [k.texto.length * 6.5 + 8, 16];
      const largo = Math.abs(u[0]) * w + Math.abs(u[1]) * h;
      const ancho = Math.abs(u[1]) * w + Math.abs(u[0]) * h;
      const c: Vec2 = l / px >= largo + 12 ? [(k.a[0] + k.b[0]) / 2, (k.a[1] + k.b[1]) / 2] : [k.a[0] - u[0] * (largo / 2 + 6) * px, k.a[1] - u[1] * (largo / 2 + 6) * px];
      const v: Vec2 = [q[0] - c[0], q[1] - c[1]];
      if (Math.abs(v[0] * u[0] + v[1] * u[1]) <= (largo / 2 + 2) * px && Math.abs(v[0] * u[1] - v[1] * u[0]) <= (ancho / 2 + 2) * px) return k.lado;
    }
    return null;
  }

  /** La cota activa del pilar elegido. */
  private cotaPilarActiva(): CotaTemporal | null {
    if (!this.ladoPilar || !this.planta) return null;
    return this.cotasPilar(this.planta)?.cotas.find((x) => x.lado === this.ladoPilar) ?? null;
  }

  private textoPilar(): string | null {
    const pil = this.pilarElegido();
    if (!pil) return null;
    const k = this.cotaPilarActiva();
    if (k) return `${pil.id}, cota ${nombreCota(k)} (${k.texto} m): escriba la distancia; Intro mueve ${pil.id} con sus vigas y Ctrl+Intro, solo; Tab, otra cota; Esc la deja.`;
    return `${pil.id}: un clic en el número de una cota (o Tab) para moverlo.`;
  }

  /** Tab con Elegir: la cota siguiente del pilar elegido (Mayús+Tab, la anterior). */
  private tabPilar(atras: boolean): boolean {
    const x = this.planta ? this.cotasPilar(this.planta) : null;
    if (!x || !x.cotas.length) return false;
    const lados = LADOS.filter((l) => x.cotas.some((k) => k.lado === l));
    const i = this.ladoPilar ? lados.indexOf(this.ladoPilar) : atras ? 0 : -1;
    this.ladoPilar = lados[(i + (atras ? -1 : 1) + lados.length) % lados.length]!;
    const c = this.foto.campo;
    this.cambiar({ pilar: this.textoPilar(), ...(c ? { campo: { ...c, cota: this.textoCampoPilar(), error: null } } : {}) });
    this.repintar();
    return true;
  }

  private textoCampoPilar(): string | undefined {
    const pil = this.pilarElegido();
    const k = this.cotaPilarActiva();
    return pil && k ? `${nombreCota(k)} · ${pil.id}` : undefined;
  }

  /** El campo de la cota activa: con `texto`, lo tecleado; si no, su valor, elegido para escribir encima. */
  private abrirCampoPilar(texto: string | null): void {
    const k = this.cotaPilarActiva();
    if (!k) return;
    this.cambiar({ pilar: this.textoPilar(), aviso: null, campo: { n: ++this.abiertos, texto: texto ?? k.texto, x: this.cliente[0], y: this.cliente[1], error: null, cota: this.textoCampoPilar(), ...(texto === null ? { seleccionar: true } : {}) } });
  }

  /** Esc: deja la cota activa del pilar. */
  soltarPilar(): void {
    if (!this.ladoPilar) return;
    this.ladoPilar = null;
    this.cambiar({ pilar: this.textoPilar(), campo: null });
    this.repintar();
  }

  private teclearPilar(texto: string, solo: boolean): boolean {
    const campo = (error: string) => {
      this.cambiar({ campo: this.foto.campo && { ...this.foto.campo, texto, error } });
      return false;
    };
    const x = this.planta ? this.cotasPilar(this.planta) : null;
    const k = this.cotaPilarActiva();
    if (!x || !k || !this.modelo) return campo("No hay ninguna cota elegida.");
    const l = leerEntrada(texto);
    if (!l.ok || l.valor.tipo !== "longitud" || l.valor.l < 0) return campo(`Escriba la distancia a ${k.ref.nombre}, m (p. ej. «5,40»).`);
    const q = colocar(x.R, x.p, [{ lado: k.lado, ref: k.ref, valor: l.valor.l }]);
    const r = moverPilar(this.modelo, x.id, q, !solo);
    if (!r.ok) return campo(r.mensaje);
    const etiqueta = `Mover ${x.id} a ${rotuloCota(l.valor.l)} m de ${k.ref.nombre}${solo ? ", sin sus vigas" : ""}`;
    const error = this.aplicar({ operacion: r.operacion, etiqueta });
    if (error) return campo(error);
    this.ladoPilar = null;
    this.cambiar({ campo: null, hecho: etiqueta, aviso: r.avisos.length ? r.avisos.join(" ") : null, pilar: this.textoPilar() });
    this.repintar();
    return true;
  }

  private clic(planta: string, q: Vec2, radio: number, doble: boolean, ctrl = false): boolean {
    if (this.herramienta === "elegir") return false;
    // Esperando elección: el clic elige (con Ctrl, suma)
    if (this.eligiendo()) {
      this.ctrlEleccion = ctrl;
      return false;
    }
    if (doble) {
      this.evento({ tipo: "terminar" });
      return true;
    }
    this.pasar(planta, q, radio, this.mayus, this.cliente);
    const a = this.apunte;
    // Con el punto del ratón sin enganchar y el radio: lo que se elige con un clic dentro, a un lado o encima de algo
    if (a) this.evento({ tipo: "punto", p: a.p, enganche: a.enganche, cursor: q, radio, ...(ctrl ? { ctrl } : {}) });
    return true;
  }

  private ventana(planta: string, caja: [number, number, number, number], ctrl: boolean): boolean {
    if (this.herramienta === "elegir") return !!this.asaActiva;
    if (this.eligiendo()) {
      this.ctrlEleccion = ctrl;
      return false;
    }
    if (esEditar(this.herramienta)) return true;
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
    // Lo elegido no necesita el cursor en una planta (se activa la herramienta con algo elegido)
    const planta = this.planta ?? (esEditar(this.herramienta) ? this.modelo?.plantas[0]?.id : null);
    if (!this.modelo || !planta) return;
    const ix = this.indice(planta);
    if (!ix) return;
    const r = paso(this.herramienta, this.estado, ev, { modelo: this.modelo, planta, indice: ix, plantillas: this.plantillas, elegidos: this.elegidos });
    this.estado = r.estado;
    let error = r.error ?? null;
    let hecho: string | null = this.foto.hecho;
    let aviso: string | null = esEditar(this.herramienta) ? this.foto.aviso : null;
    if (r.hecho) {
      error = this.aplicar(r.hecho);
      if (!error) [hecho, aviso] = [r.hecho.etiqueta, r.hecho.avisos?.join(" ") ?? null];
    }
    if (ev.tipo === "elegidos") this.ctrlEleccion = false;
    this.cambiar({ error, hecho, aviso });
    if (r.salir) this.alSalir();
    this.recalcular();
  }

  private cursor(planta: string): { p: Vec2; texto: string } | null {
    if (planta !== this.planta || !this.cursorQ) return null;
    const a = this.apunte;
    const partes: string[] = [];
    if (a?.enganche) partes.push(`${NOMBRE_ENGANCHE[a.enganche.tipo]} (${a.enganche.plantilla ? `DXF ${a.enganche.plantilla}` : a.enganche.objeto})`);
    else if (a?.orto) partes.push("Ortogonal");
    const c = this.cotaActiva();
    if (c) partes.push(`Cota ${nombreCota(c)}: ${c.texto}`);
    const medida = esEditar(this.herramienta) ? medidaEditar(this.herramienta, this.estado, a?.p ?? this.cursorQ) : null;
    if (medida) partes.push(medida);
    if (this.herramienta === "elegir" && this.asaActiva) {
      const q = a?.p ?? this.cursorQ;
      partes.push(`Δ ${rotuloCota(q[0] - this.asaActiva.p[0])}; ${rotuloCota(q[1] - this.asaActiva.p[1])} m`);
    } else if (this.herramienta === "elegir" && this.asaBajo) partes.push(`Vértice de ${this.asaBajo.id} · clic para moverlo`);
    const k = this.herramienta === "elegir" && this.ladoBajo ? this.cotasPilar(planta)?.cotas.find((x) => x.lado === this.ladoBajo) : null;
    if (k) partes.push(`Cota ${nombreCota(k)}: ${k.texto} m · clic para cambiarla`);
    else if (this.herramienta === "elegir" && this.cotaBajo) {
      partes.push(`Cota ${this.titulo(this.cotaBajo)}: ${this.cotaBajo.texto} m · clic para cambiarla`);
    } else if (this.herramienta === "elegir" && this.silueta && !this.asaBajo && !this.asaActiva) partes.push(this.silueta.id);
    return { p: a?.p ?? this.cursorQ, texto: partes.join(" · ") };
  }

  // ─── Pintar ─────────────────────────────────────────────────────────────────────────────────

  /** Un cuadrado por vértice de lo elegido: lleno el que está bajo el cursor y el cogido. */
  private pintarAsas(planta: string, ctx: CanvasRenderingContext2D, aPx: (q: Vec2) => [number, number], c: Colores): void {
    const lista = this.asasDe(planta);
    if (!lista.length) return;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.acento;
    const r = 4;
    for (const a of lista) {
      const [x, y] = aPx(a.p);
      const on = a === this.asaBajo || (this.asaActiva && a.id === this.asaActiva.id && a.ruta.join() === this.asaActiva.ruta.join());
      ctx.fillStyle = on ? c.acento : c.fondo;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      ctx.strokeRect(x - r, y - r, 2 * r, 2 * r);
    }
    ctx.restore();
  }

  private pintar(planta: string, ctx: CanvasRenderingContext2D, aPx: (q: Vec2) => [number, number], c: Colores, cotas: boolean): void {
    if (!this.modelo) return;
    // Lo de estirar, en todas las plantas (CT-c); la cota bajo el cursor, gruesa
    if (this.estirado) this.pintarEstirado(planta, ctx, aPx, c, cotas);
    else if (cotas && this.cotaBajo && planta === this.planta) {
      ctx.save();
      ctx.strokeStyle = c.acento;
      ctx.lineWidth = 2.5;
      const [a, b] = [aPx(this.cotaBajo.a), aPx(this.cotaBajo.b)];
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      ctx.restore();
    }
    // CT3: las cotas del pilar elegido, en todas las plantas en las que está
    if (cotas && !this.estirado) {
      const x = this.cotasPilar(planta);
      if (x) for (const k of x.cotas) cotaTemporal(ctx, { ...k, activa: k.lado === this.ladoPilar || (planta === this.planta && k.lado === this.ladoBajo) }, aPx, c);
    }
    // V2c-3: los vértices de lo elegido (pinzamientos), en todas las plantas en las que está
    if (this.herramienta === "elegir" && !this.estirado) this.pintarAsas(planta, ctx, aPx, c);
    if (planta !== this.planta) return;
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
    if (this.herramienta === "elegir" && this.asaActiva && this.cursorQ) {
      // El vértice cogido, con una línea hasta donde iría
      const [a, b] = [aPx(this.asaActiva.p), aPx(this.apunte?.p ?? this.cursorQ)];
      ctx.save();
      ctx.strokeStyle = c.acento;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      ctx.restore();
      const e = this.apunte?.enganche;
      if (e) marcador(ctx, e.tipo, aPx(e.p), c);
    }
    if (this.herramienta === "elegir" || !ix) return;
    // El borrador
    const b = borrador(this.herramienta, this.estado, this.cursorQ ? (this.apunte?.p ?? this.cursorQ) : null, { modelo: this.modelo, planta, indice: ix, plantillas: this.plantillas }, this.cursorQ);
    ctx.strokeStyle = c.acento;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    for (const l of b.lineas) {
      camino(l, false);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Los anillos de un mismo borrador, juntos y par-impar: el forjado con sus huecos
    if (b.anillos.length) {
      ctx.beginPath();
      for (const r of b.anillos)
        r.forEach((q, i) => {
          const [x, y] = aPx(q);
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
      ctx.closePath();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = c.acento;
      ctx.fill("evenodd");
      ctx.globalAlpha = 1;
      for (const r of b.anillos) {
        camino(r, true);
        ctx.stroke();
      }
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
