/**
 * Sesión del visor (V1, `docs/fem3d/visor.md` §3.1): un proyecto abierto con su compilación, sus
 * resultados y sus consultas. Vive en el worker de sesión, que la guarda entre pedidos para que
 * compilar, calcular y consultar no bloqueen la interfaz; los tests la usan directamente en Node.
 *
 * Todo número que la sesión da sale de las mismas funciones que la CLI (`cli/ordenes.ts`): las
 * consultas de C5 y de A1, las escenas de A4 y la revisión de A3. La sesión no escribe nada.
 *
 * Regla del visor: un resultado sólo existe si viene de un cálculo válido de esta misma huella. Los
 * resultados guardados por la CLI se usan si su huella, su núcleo (sha256 del WASM) y el sha256 de
 * sus bytes casan; si no, se dice por qué y se recalcula.
 *
 * Abierta con `diferir`, la sesión no compila hasta que algo lo necesita (`compilar()`, el estado
 * completo, los diagnósticos, el cálculo o una consulta): lo que sólo necesita el modelo físico (la
 * planta y el alzado del modelo y de las cargas, el alámbrico, el sólido sin paños y las cargas en
 * el 3D) se dibuja antes, con la huella que dará la compilación (`huellaSinCompilar`). En el edificio
 * objetivo con vigas, compilar tarda ~3 s y el dibujo, milisegundos.
 *
 * Puro: sin IO (el núcleo WASM lo inicia quien crea la sesión).
 */
import { conjuntoCombinaciones, seleccionPorDefecto, type ConjuntoCombinaciones, type Proposito } from "../agente/combinaciones.ts";
import { resumen, type Resumen } from "../agente/consultas.ts";
import { leerProyecto, type Proyecto, type VistaGuardada } from "../agente/proyecto.ts";
import { conjuntoPorDefecto, planoDeEje, ResultadosRender, vistaAlzado, vistaAlzadoCargas, vistaAlzadoDiagramas, vistaAxiles, vistaCampo, vistaCargas, vistaDiagnosticos, vistaDiagramas, vistaMalla, capaMalla, vistaModelo, vistaAlzadoReacciones, vistaReacciones, type Campo, type EscalaMapa, type Escena, type EsfuerzoPlano, type ModoAlzado, type PlanoAlzado, type Vec2 } from "../agente/render/index.ts";
import { vistaArmado, type Armadura, type FiltroArmado } from "../agente/render/armado.ts";
import type { DatosVista } from "../agente/render/modelo.ts";
import type { ArmadoProyecto } from "../agente/armaduraBase.ts";
import { armado3D, tramosPlanta, valorArmado, type Armado3D, type ValorArmado } from "./armado.ts";
import { UNIDADES_CAMPO } from "../agente/render/resultados.ts";
import { desempaquetarResultados, empaquetarResultados, type CabeceraResultados } from "../agente/resultados.ts";
import { sensatezPrevia } from "../agente/sensatez.ts";
import { SITUACIONES, type Situacion } from "../combinaciones/generador.ts";
import { compilar, huellaSinCompilar, type ResultadoCompilacion } from "../compilador/compilar.ts";
import { Consultas } from "../compilador/consultas.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import { ejesDe } from "../compilador/ejes.ts";
import { traducirDiagnosticos } from "../compilador/mapeo.ts";
import { calcular } from "../motor/calcular.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { ResultadoCaso } from "../motor/modelo.ts";
import { alambrico } from "./alambrico.ts";
import { solido, type Solido } from "./solido.ts";
import { diagramas3D, type Diagramas3D, type Esfuerzo3D, type PiezasDiagrama } from "./diagramas3d.ts";
import { elegir, elegirVentana, prepararEscena, resaltar, type Eleccion, type EscenaPreparada } from "./escena.ts";
import { isovalores3D, valorEnLamina, type Isovalores3D, type SuperficiesMapa } from "./isovalores3d.ts";
import { pilares3D, type MagnitudPilares, type Pilares3D } from "./pilares3d.ts";
import { reacciones3D, type Reacciones3D } from "./reacciones3d.ts";
import { cargas3D, type Cargas3D } from "./cargas3d.ts";

export type Compilado = Extract<ResultadoCompilacion, { valido: true }>;

/** Qué combinaciones usa una pantalla. */
export type EleccionCombinaciones =
  /** Las de las consultas de A1 y del render de A4 para el propósito de la vista. */
  | { tipo: "defecto" }
  /** Todas las de unas situaciones del generador (la envolvente, o la que gobierna en un mapa). */
  | { tipo: "situaciones"; situaciones: Situacion[] }
  /** Una sola combinación del generador, por su nombre. */
  | { tipo: "combinacion"; situaciones: Situacion[]; nombre: string }
  /** Un caso suelto. */
  | { tipo: "caso"; caso: string }
  /** Una combinación, por su nombre, de las de otra elección (la pésima de un conjunto, para la deformada). */
  | { tipo: "una"; de: EleccionCombinaciones; nombre: string };

export type VistaPlanta =
  | { vista: "modelo" }
  | { vista: "cargas"; caso: string }
  | { vista: "diagnosticos" }
  | { vista: "malla" }
  | VistaResultadosPlanta;

/** Las vistas de planta con resultados. `malla`: con la malla de la planta encima (`capaMalla`). */
export type VistaResultadosPlanta = (
  /** `escala`: la del mapa (`EscalaMapa`); sin ella, la completa. */
  | { vista: "campo"; campo: Campo; combinaciones: EleccionCombinaciones; escala?: EscalaMapa }
  | { vista: "vigas"; esfuerzo: "My" | "Vz"; combinaciones: EleccionCombinaciones }
  | { vista: "pilares-n"; combinaciones: EleccionCombinaciones }
  /** Fase F: la demanda de Wood–Armer de una armadura de las franjas de la planta. */
  /** AB: la armadura base va en el pedido (la del proyecto que se edita), así que cambiarla no reabre la sesión. */
  | { vista: "armado"; combinaciones: EleccionCombinaciones; armadura: Armadura; escala?: EscalaMapa; armado?: ArmadoProyecto; soloExceso?: boolean; filtro?: FiltroArmado }
  /** Las reacciones de los objetos de la planta (I4); `escala`, la de las flechas horizontales. */
  | { vista: "reacciones"; combinaciones: EleccionCombinaciones; escala?: number }
) & { malla?: boolean };

/** El plano de un alzado que pide la interfaz: el de un eje (los del modelo o los propuestos) o el que pasa por dos puntos. */
/** El plano de un alzado y cómo se dibujan sus piezas (`modo`: por defecto, «solido»; «analitico» necesita la compilación). */
export type PlanoPedido = ({ eje: string; profundidad?: number } | { desde: Vec2; hasta: Vec2; profundidad?: number }) & { modo?: ModoAlzado };

/** Los diagramas de las barras del plano de un alzado (I4): el esfuerzo en el plano y sus combinaciones. */
export interface DiagramasAlzado {
  esfuerzo: EsfuerzoPlano;
  combinaciones: EleccionCombinaciones;
  /** Por la que se multiplica la escala automática. */
  escala?: number;
}

/** Las reacciones de los objetos del plano de un alzado (I4). */
export interface ReaccionesAlzado {
  combinaciones: EleccionCombinaciones;
  /** Por la que se multiplica la escala automática. */
  escala?: number;
}

/** Las cargas de un caso en un alzado (tras I4). */
export interface CargasAlzado {
  caso: string;
  /** Por la que se multiplica la escala automática. */
  escala?: number;
}

/** Una escena que se puede pedir, elegir y resaltar (I2): la de una planta en una vista, o un alzado (con diagramas o reacciones, en I4; con las cargas de un caso, tras I4). */
export type FuenteEscena = { tipo: "planta"; planta: string; vista: VistaPlanta } | { tipo: "alzado"; plano: PlanoPedido; diagramas?: DiagramasAlzado; reacciones?: ReaccionesAlzado; cargas?: CargasAlzado };

/** Los diagramas de las barras en el 3D (I4). */
export interface PedidoDiagramas3D {
  esfuerzo: Esfuerzo3D;
  combinaciones: EleccionCombinaciones;
  /** Sólo los de una planta; null, todos. */
  planta: string | null;
  piezas: PiezasDiagrama;
  escala?: number;
}

/** Los isovalores de las losas y los muros en el 3D (I4). */
export interface PedidoIsovalores3D {
  campo: Campo;
  combinaciones: EleccionCombinaciones;
  planta: string | null;
  /** Por defecto, las losas. */
  superficies?: SuperficiesMapa;
  escala?: EscalaMapa;
}

/** AB: el armado en el 3D, de una planta o de todas (null), con la base del proyecto que se edita. */
export interface PedidoArmado3D {
  armadura: Armadura;
  combinaciones: EleccionCombinaciones;
  planta: string | null;
  escala?: EscalaMapa;
  armado?: ArmadoProyecto;
  soloExceso?: boolean;
  filtro?: FiltroArmado;
}

/** AB: el valor del mapa de armado en un punto (m, globales) de una planta. */
export interface PedidoValorArmado {
  planta: string;
  armadura: Armadura;
  combinaciones: EleccionCombinaciones;
  x: number;
  y: number;
  armado?: ArmadoProyecto;
}

/** Los pilares en el 3D por colores (I4): N o ν de cada tramo. */
export interface PedidoPilares3D {
  magnitud: MagnitudPilares;
  combinaciones: EleccionCombinaciones;
  planta: string | null;
}

/** El valor de un mapa bajo el cursor (I4): en un punto de una lámina, en una combinación. */
export interface PedidoValorLamina {
  campo: Campo;
  /** Las del mapa y, de ellas, la dibujada (`nombre`). */
  combinaciones: EleccionCombinaciones;
  nombre: string;
  lamina: number;
  punto: readonly [number, number, number];
}

export interface ValorLamina {
  valor: number;
  unidad: string;
  objeto: string;
  planta: string;
  lamina: number;
  comb: string;
}

export interface PlantaVisor {
  id: string;
  nombre?: string;
  cota: number | null;
  /** Altura de la planta (la del modelo físico; null en la cimentación). */
  altura: number | null;
  /** Diagnósticos (errores y avisos) de objetos de la planta. */
  avisos: number;
  errores: number;
}

export interface CombinacionDisponible {
  situacion: Situacion;
  nombre: string;
  etiqueta: string;
}

export interface EstadoSesion {
  huella: string;
  nombre?: string;
  descripcion?: string;
  compila: boolean;
  /**
   * La sesión aún no ha compilado (abierta con `diferir`): `compila` es false sin serlo, y sólo están
   * los diagnósticos de la sensatez previa. Lo que no necesita la compilación ya se puede pedir.
   */
  compilando?: true;
  /** Compilación y sensatez previa y, si se calculó, avisos del cálculo; errores primero. */
  diagnosticos: Diagnostico[];
  hipotesis: string[];
  plantas: PlantaVisor[];
  casos: { id: string; nombre?: string; accion?: string; pesoPropio?: boolean }[];
  resumen: Resumen | null;
  estadisticas: { nudos: number; barras: number; laminas: number; ecuaciones?: number } | null;
  /** Hay resultados válidos de esta huella. */
  calculado: boolean;
  /** De dónde salen: un cálculo en esta sesión o los guardados por la CLI. */
  origen: "calculo" | "guardados" | null;
  equilibrio: { id: string; fuerzas: number; momentos: number }[];
  combinaciones: CombinacionDisponible[];
  /** Sin combinaciones del generador, por qué: el mensaje de la consulta y los casos sin acción. */
  sinCombinaciones?: { mensaje: string; sinAccion: string[] };
  /** sha256 de los resultados empaquetados como `resultados.bin` (el mismo que guarda la CLI): criterio 2 de V1. */
  sha256Resultados: string | null;
  /** I2: los ejes de replanteo que se dibujan (los del modelo o, si no tiene, los propuestos). */
  ejes: { id: string; nombre?: string; desde: Vec2; hasta: Vec2; propuesto: boolean }[];
  /** I3: las vistas guardadas en el proyecto. */
  vistas: VistaGuardada[];
}

export type Apertura = { valido: true; sesion: Sesion } | { valido: false; diagnosticos: Diagnostico[] };

/** Avisos de la sensatez previa que la app sólo enseña con resultados. */
const SOLO_CALCULADO = new Set(["sensatez/caso-vacio"]);

const ordenSeveridad = (ds: readonly Diagnostico[]) => [...ds].sort((a, b) => (a.severidad === "error" ? 0 : 1) - (b.severidad === "error" ? 0 : 1));

/** Plantas de cada objeto físico (las que atraviesa, para los verticales), para contar los avisos por planta. */
function plantasDeObjetos(p: Proyecto): Map<string, string[]> {
  const f = p.modelo;
  const ids = f.plantas.map((x) => x.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const rango = (desde: string, hasta: string) => {
    const a = idx.get(desde);
    const b = idx.get(hasta);
    return a === undefined || b === undefined ? [] : ids.slice(Math.min(a, b), Math.max(a, b) + 1);
  };
  const m = new Map<string, string[]>();
  for (const x of f.pilares ?? []) m.set(x.id, rango(x.desde, x.hasta));
  for (const x of f.muros ?? []) m.set(x.id, rango(x.desde, x.hasta));
  for (const lista of [f.vigas, f.losas, f.panos, f.bandas, f.apoyosLineales] as ({ id: string; planta?: string }[] | undefined)[]) for (const x of lista ?? []) if (x.planta) m.set(x.id, [x.planta]);
  for (const id of ids) m.set(id, [id]);
  return m;
}

/** Errores y avisos de cada planta: los de los objetos que la tocan. */
function cuentaPorPlanta(p: Proyecto, diagnosticos: readonly Diagnostico[]): Map<string, { avisos: number; errores: number }> {
  const porObjeto = plantasDeObjetos(p);
  const cuenta = new Map<string, { avisos: number; errores: number }>();
  for (const d of diagnosticos) {
    const plantas = new Set((d.ids ?? []).flatMap((id) => porObjeto.get(id) ?? []));
    for (const x of plantas) {
      const c = cuenta.get(x) ?? { avisos: 0, errores: 0 };
      if (d.severidad === "error") c.errores++;
      else c.avisos++;
      cuenta.set(x, c);
    }
  }
  return cuenta;
}

export class Sesion {
  readonly proyecto: Proyecto;
  /** sha256 del núcleo WASM con el que se calcula (el de los resultados guardados tiene que coincidir). */
  readonly motor: string;
  private readonly previa: Diagnostico[];
  /** null hasta compilar (sólo con `diferir`). */
  private comp: ResultadoCompilacion | null = null;
  private res: Resumen | null = null;
  private huellaC: string | null = null;
  private casosR: ResultadoCaso[] | null = null;
  private cabecera: CabeceraResultados | null = null;
  private origenR: "calculo" | "guardados" | null = null;
  private shaR: string | null = null;
  private qC: Consultas | null = null;
  private rrC: ResultadosRender | null = null;
  /** Escenas ya hechas, por su clave (las mismas que pide la interfaz al moverse). */
  private readonly escenas = new Map<string, Escena>();

  private constructor(proyecto: Proyecto, motor: string, diferir: boolean) {
    this.proyecto = proyecto;
    this.motor = motor;
    this.previa = sensatezPrevia(proyecto.modelo, proyecto.opciones).flatMap((x) => x.avisos);
    if (!diferir) this.compilar();
  }

  /**
   * Lee y compila un proyecto; con `diferir`, sólo lo lee (compila cuando algo lo necesita). No
   * valido: el JSON o su esquema (lo que un modelo que no compila sí tiene: una huella y su dibujo).
   */
  static abrir(texto: string, motor: string, opciones: { diferir?: boolean } = {}): Apertura {
    const l = leerProyecto(texto);
    if (!l.valido) return { valido: false, diagnosticos: l.diagnosticos };
    return { valido: true, sesion: new Sesion(l.proyecto, motor, !!opciones.diferir) };
  }

  /** Compila, si no lo ha hecho ya. */
  compilar(): ResultadoCompilacion {
    if (this.comp) return this.comp;
    const c = compilar(this.proyecto.modelo, this.proyecto.opciones);
    if (c.valido) {
      const r = resumen(this.proyecto, c);
      this.res = r.valido ? r.valor : null;
    }
    this.comp = c;
    return c;
  }

  /** Ya compiló (sin `diferir`, siempre). */
  get compilada(): boolean {
    return this.comp !== null;
  }

  /** La compilación (si la sesión aún no ha compilado, compila). */
  get compilacion(): ResultadoCompilacion {
    return this.compilar();
  }

  /** La de la compilación; sin compilar, la que dará (`huellaSinCompilar`). */
  get huella(): string {
    return this.comp ? this.comp.huella : (this.huellaC ??= huellaSinCompilar(this.proyecto.modelo, this.proyecto.opciones));
  }

  get compilado(): Compilado | null {
    return this.compilacion.valido ? this.compilacion : null;
  }

  get calculado(): boolean {
    return this.casosR !== null;
  }

  get casos(): ResultadoCaso[] | null {
    return this.casosR;
  }

  /** Las consultas de C5 sobre el cálculo (null sin resultados). */
  get q(): Consultas | null {
    if (!this.qC && this.casosR && this.compilacion.valido) this.qC = new Consultas(this.proyecto.modelo, this.compilacion, this.casosR, this.proyecto.opciones);
    return this.qC;
  }

  get rr(): ResultadosRender | null {
    const q = this.q;
    if (!this.rrC && q && this.compilacion.valido) this.rrC = new ResultadosRender(q, this.compilacion);
    return this.rrC;
  }

  get resumen(): Resumen | null {
    this.compilar();
    return this.res;
  }

  get cabeceraResultados(): CabeceraResultados | null {
    return this.cabecera;
  }

  /** Todos los diagnósticos que se enseñan: compilación, sensatez previa y cálculo. */
  get diagnosticos(): Diagnostico[] {
    return ordenSeveridad([...this.compilacion.diagnosticos, ...this.previaMostrada, ...(this.cabecera?.diagnosticos ?? [])]);
  }

  /**
   * La sensatez previa que se enseña: un caso sin cargas sólo se avisa con resultados (mientras se
   * modela, un caso recién creado aún no tiene sus cargas; `fem validar` sí lo da).
   */
  private get previaMostrada(): Diagnostico[] {
    return this.calculado ? this.previa : this.previa.filter((d) => !SOLO_CALCULADO.has(d.codigo));
  }

  /**
   * El estado de la sesión, que compila si aún no lo ha hecho; con `sinCompilar`, el que se sabe sin
   * compilar (`compilando`: la huella, las plantas, los casos, los ejes y la sensatez previa).
   */
  estado(o: { sinCompilar?: boolean } = {}): EstadoSesion {
    if (o.sinCompilar && !this.comp) return this.estadoSinCompilar();
    const f = this.proyecto.modelo;
    const cotas = cotasPlantas(f.plantas);
    const cuenta = cuentaPorPlanta(this.proyecto, this.diagnosticos);
    const c = this.compilacion;
    return {
      huella: c.huella,
      ...(this.proyecto.nombre ? { nombre: this.proyecto.nombre } : {}),
      ...(this.proyecto.descripcion ? { descripcion: this.proyecto.descripcion } : {}),
      compila: c.valido,
      diagnosticos: this.diagnosticos,
      hipotesis: c.valido ? c.hipotesis : [],
      plantas: f.plantas.map((p, i) => ({ id: p.id, ...(p.nombre ? { nombre: p.nombre } : {}), cota: cotas[i] ?? null, altura: p.altura, avisos: cuenta.get(p.id)?.avisos ?? 0, errores: cuenta.get(p.id)?.errores ?? 0 })),
      casos: f.casos.map((x) => ({ id: x.id, ...(x.nombre ? { nombre: x.nombre } : {}), ...(x.accion ? { accion: x.accion.tipo } : {}), ...(x.pesoPropio ? { pesoPropio: true } : {}) })),
      resumen: this.res,
      estadisticas: c.valido ? { nudos: c.estadisticas.nudos, barras: c.estadisticas.barras, laminas: c.estadisticas.laminas, ...(this.cabecera ? { ecuaciones: this.cabecera.estadisticas.ecuaciones } : {}) } : null,
      calculado: this.calculado,
      origen: this.origenR,
      equilibrio: (this.cabecera?.casos ?? []).map((x) => ({ id: x.id, ...x.equilibrio })),
      ...this.combinacionesEstado(),
      sha256Resultados: this.shaR,
      ejes: this.ejesEstado(),
      vistas: this.proyecto.vistas ?? [],
    };
  }

  private estadoSinCompilar(): EstadoSesion {
    const f = this.proyecto.modelo;
    const cotas = cotasPlantas(f.plantas);
    const diagnosticos = ordenSeveridad(this.previaMostrada);
    const cuenta = cuentaPorPlanta(this.proyecto, diagnosticos);
    return {
      huella: this.huella,
      ...(this.proyecto.nombre ? { nombre: this.proyecto.nombre } : {}),
      ...(this.proyecto.descripcion ? { descripcion: this.proyecto.descripcion } : {}),
      compila: false,
      compilando: true,
      diagnosticos,
      hipotesis: [],
      plantas: f.plantas.map((p, i) => ({ id: p.id, ...(p.nombre ? { nombre: p.nombre } : {}), cota: cotas[i] ?? null, altura: p.altura, avisos: cuenta.get(p.id)?.avisos ?? 0, errores: cuenta.get(p.id)?.errores ?? 0 })),
      casos: f.casos.map((x) => ({ id: x.id, ...(x.nombre ? { nombre: x.nombre } : {}), ...(x.accion ? { accion: x.accion.tipo } : {}), ...(x.pesoPropio ? { pesoPropio: true } : {}) })),
      resumen: null,
      estadisticas: null,
      calculado: false,
      origen: null,
      equilibrio: [],
      combinaciones: [],
      sha256Resultados: null,
      ejes: this.ejesEstado(),
      vistas: this.proyecto.vistas ?? [],
    };
  }

  private ejesEstado(): EstadoSesion["ejes"] {
    const x = ejesDe(this.proyecto.modelo);
    return x.ejes.map((e) => ({ id: e.id, ...(e.nombre ? { nombre: e.nombre } : {}), desde: e.desde, hasta: e.hasta, propuesto: x.propuestos }));
  }

  // ─── Resultados ───────────────────────────────────────────────────────────────────────────────

  /**
   * Usa los resultados que guardó la CLI en `.fem/<huella>/`. Se rechazan (con el motivo) si no son
   * de esta huella, de este núcleo o si sus bytes no son los que se guardaron.
   */
  async usarGuardados(textoCabecera: string, bytes: Uint8Array): Promise<{ ok: true } | { ok: false; motivo: string }> {
    if (!this.compilacion.valido) return { ok: false, motivo: "el modelo no compila" };
    let cab: CabeceraResultados & { motor?: string; sha256?: string };
    try {
      cab = JSON.parse(textoCabecera) as typeof cab;
    } catch {
      return { ok: false, motivo: "resultados.json no es JSON" };
    }
    if (cab.huella !== this.huella) return { ok: false, motivo: `son de otra huella (${String(cab.huella).slice(0, 8)})` };
    if (cab.motor !== this.motor) return { ok: false, motivo: "se calcularon con otro núcleo de cálculo" };
    if (typeof cab.sha256 !== "string") return { ok: false, motivo: "no llevan el sha256 de sus datos (los guardó una versión anterior de la CLI)" };
    if ((await sha256Bytes(bytes)) !== cab.sha256) return { ok: false, motivo: "resultados.bin no es el que se guardó (su sha256 no coincide)" };
    const casos = desempaquetarResultados(cab, bytes);
    if (!casos) return { ok: false, motivo: "resultados.bin no casa con su cabecera" };
    if (casos.map((x) => x.id).join("\n") !== this.proyecto.modelo.casos.map((x) => x.id).join("\n")) return { ok: false, motivo: "sus casos no son los del proyecto" };
    this.fijar(casos, cab, "guardados", cab.sha256);
    return { ok: true };
  }

  /** Calcula (el núcleo ya iniciado). No válido: el modelo no compila o el cálculo falló (sin equilibrio, mecanismo…). */
  async calcular(): Promise<{ ok: true; cabecera: CabeceraResultados; bytes: Uint8Array } | { ok: false; diagnosticos: Diagnostico[] }> {
    const c = this.compilacion;
    if (!c.valido) return { ok: false, diagnosticos: c.diagnosticos.filter((d) => d.severidad === "error") };
    const r = calcular(c.modelo);
    const diags = traducirDiagnosticos(r.diagnosticos, c.modelo, c.mapeo);
    if (!r.valido) return { ok: false, diagnosticos: ordenSeveridad(diags) };
    const { cabecera, bytes } = empaquetarResultados(c.huella, r.casos, r.estadisticas, diags);
    this.fijar(r.casos, cabecera, "calculo", await sha256Bytes(bytes));
    return { ok: true, cabecera, bytes };
  }

  private fijar(casos: ResultadoCaso[], cabecera: CabeceraResultados, origen: "calculo" | "guardados", sha: string): void {
    this.casosR = casos;
    this.shaR = sha;
    this.cabecera = cabecera;
    this.origenR = origen;
    this.qC = null;
    this.rrC = null;
    this.escenas.clear();
  }

  // ─── Combinaciones ────────────────────────────────────────────────────────────────────────────

  combinacionesDisponibles(): CombinacionDisponible[] {
    const q = this.q;
    if (!q) return [];
    const r: CombinacionDisponible[] = [];
    for (const situacion of SITUACIONES) {
      const x = q.combinaciones({ situaciones: [situacion] });
      if (x.valido) for (const c of x.valor) r.push({ situacion, nombre: c.id, etiqueta: c.etiqueta });
    }
    return r;
  }

  /** Las combinaciones del generador y, si no hay ninguna (y compila), por qué. */
  private combinacionesEstado(): Pick<EstadoSesion, "combinaciones" | "sinCombinaciones"> {
    const combinaciones = this.combinacionesDisponibles();
    const q = this.q;
    if (combinaciones.length || !q) return { combinaciones };
    const x = q.combinaciones();
    const mensaje = x.valido ? "Los casos no dan ninguna combinación CTE/NCSE." : x.diagnosticos.map((d) => d.mensaje).join(" ");
    return { combinaciones, sinCombinaciones: { mensaje, sinAccion: q.fisico.casos.filter((c) => !c.accion).map((c) => c.id) } };
  }

  /** El conjunto de combinaciones de una elección, para un propósito. */
  conjunto(e: EleccionCombinaciones, proposito: Proposito): { valido: true; valor: ConjuntoCombinaciones } | { valido: false; diagnosticos: Diagnostico[] } {
    const q = this.q;
    if (!q || !this.resumen) return { valido: false, diagnosticos: [{ codigo: "visor/sin-resultados", severidad: "error", mensaje: "No hay resultados de esta huella." }] };
    switch (e.tipo) {
      case "defecto":
        return proposito === "lineal" ? conjuntoCombinaciones(q, seleccionPorDefecto(q.fisico.casos, "lineal")) : { valido: true, valor: conjuntoPorDefecto(q, this.resumen!, proposito) };
      case "situaciones":
        return conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: e.situaciones });
      case "combinacion": {
        const r = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: e.situaciones });
        if (!r.valido) return r;
        const k = r.valor.nombres.indexOf(e.nombre);
        if (k < 0) return { valido: false, diagnosticos: [{ codigo: "visor/combinacion", severidad: "error", mensaje: `No hay ninguna combinación ${e.nombre}.` }] };
        const v = r.valor;
        return { valido: true, valor: { descripcion: e.nombre, nombres: [v.nombres[k]!], etiquetas: [v.etiquetas[k]!], factores: [v.factores[k]!] } };
      }
      case "caso":
        return conjuntoCombinaciones(q, { tipo: "expresiones", expresiones: [e.caso] });
      case "una": {
        const r = this.conjunto(e.de, proposito);
        if (!r.valido) return r;
        const k = r.valor.nombres.indexOf(e.nombre);
        if (k < 0) return { valido: false, diagnosticos: [{ codigo: "visor/combinacion", severidad: "error", mensaje: `No hay ninguna combinación ${e.nombre}.` }] };
        const v = r.valor;
        return { valido: true, valor: { descripcion: e.nombre, nombres: [v.nombres[k]!], etiquetas: [v.etiquetas[k]!], factores: [v.factores[k]!] } };
      }
    }
  }

  // ─── Escenas de planta ────────────────────────────────────────────────────────────────────────

  /** La escena de A4 de una planta (la misma que `fem render`), o por qué no se puede dibujar. */
  escenaA4(planta: string, v: VistaPlanta): { valido: true; valor: Escena } | { valido: false; diagnosticos: Diagnostico[] } {
    const f = this.proyecto.modelo;
    if (!f.plantas.some((p) => p.id === planta)) return { valido: false, diagnosticos: [{ codigo: "visor/planta", severidad: "error", mensaje: `La planta ${planta} no existe.` }] };
    const clave = JSON.stringify([planta, v]);
    const hecha = this.escenas.get(clave);
    if (hecha) return { valido: true, valor: hecha };
    const d = { ...(this.proyecto.nombre ? { nombre: this.proyecto.nombre } : {}), huella: this.huella };
    let e: Escena;
    switch (v.vista) {
      case "modelo":
        e = vistaModelo(f, planta, d);
        break;
      case "cargas":
        if (!f.casos.some((c) => c.id === v.caso)) return { valido: false, diagnosticos: [{ codigo: "visor/caso", severidad: "error", mensaje: `El caso ${v.caso} no existe.` }] };
        e = vistaCargas(f, planta, v.caso, d);
        break;
      case "diagnosticos":
        e = vistaDiagnosticos(f, planta, this.diagnosticos, d);
        break;
      default: {
        const rr = this.rr;
        if (!rr) return { valido: false, diagnosticos: [{ codigo: "visor/sin-resultados", severidad: "error", mensaje: "Esta vista necesita el cálculo." }] };
        if (v.vista !== "malla" && v.malla) {
          // La malla encima del resultado (el de la escena sin ella), debajo de los rótulos
          const { malla: _, ...sin } = v;
          const r = this.escenaA4(planta, sin as VistaPlanta);
          if (!r.valido) return r;
          const m = capaMalla(rr, planta);
          const textos = r.valor.primitivas.filter((p) => p.tipo === "texto");
          e = { ...r.valor, primitivas: [...r.valor.primitivas.filter((p) => p.tipo !== "texto"), ...m.primitivas, ...textos], leyenda: [...r.valor.leyenda, ...m.leyenda], notas: [...r.valor.notas, ...m.notas] };
        } else if (v.vista === "malla") e = vistaMalla(rr, planta, d);
        else if (v.vista === "reacciones") {
          const conj = this.conjunto(v.combinaciones, "lineal");
          if (!conj.valido) return conj;
          e = vistaReacciones(rr, planta, conj.valor, d, v.escala);
        } else {
          const conj = this.conjunto(v.combinaciones, v.vista === "campo" && v.campo === "uz" ? "desplazamientos" : "esfuerzos");
          if (!conj.valido) return conj;
          e = v.vista === "campo" ? vistaCampo(rr, planta, v.campo, conj.valor, d, v.escala) : v.vista === "vigas" ? vistaDiagramas(rr, planta, v.esfuerzo, conj.valor, d) : v.vista === "armado" ? this.vistaArmado(rr, planta, v, conj.valor, d) : vistaAxiles(rr, planta, conj.valor, d);
        }
      }
    }
    this.escenas.set(clave, e);
    return { valido: true, valor: e };
  }

  private vistaArmado(rr: ResultadosRender, planta: string, v: Extract<VistaPlanta, { vista: "armado" }>, conj: ConjuntoCombinaciones, d: DatosVista): Escena {
    const fs = tramosPlanta(rr.q, planta, v.armadura, conj);
    return vistaArmado(rr, planta, v.armadura, conj, d, { ...(v.escala ? { escala: v.escala } : {}), ...(v.armado ? { armado: v.armado } : {}), ...(v.soloExceso !== undefined ? { soloExceso: v.soloExceso } : {}), ...(v.filtro ? { filtro: v.filtro } : {}), ...(fs.valido ? { franjas: fs.valor } : {}) });
  }

  escena(planta: string, v: VistaPlanta): { valido: true; valor: EscenaPreparada } | { valido: false; diagnosticos: Diagnostico[] } {
    const e = this.escenaA4(planta, v);
    return e.valido ? { valido: true, valor: prepararEscena(e.valor) } : e;
  }

  /** El alzado de un plano (I2), o por qué no se puede dibujar. Sólo necesita el modelo físico (también con las cargas); con diagramas o reacciones (I4), el cálculo. */
  alzadoA4(p: PlanoPedido, diagramas?: DiagramasAlzado, reacciones?: ReaccionesAlzado, cargas?: CargasAlzado): { valido: true; valor: Escena } | { valido: false; diagnosticos: Diagnostico[] } {
    const f = this.proyecto.modelo;
    const clave = JSON.stringify(["alzado", p, diagramas ?? null, ...(reacciones ? [reacciones] : []), ...(cargas ? [{ cargas }] : [])]);
    const hecha = this.escenas.get(clave);
    if (hecha) return { valido: true, valor: hecha };
    let plano: PlanoAlzado | null;
    const modo = p.modo ?? "solido";
    // Sólo el analítico espera a la compilación (AL-4: el dibujo del modelo físico, no)
    const c = modo === "analitico" ? this.compilado : null;
    if (modo === "analitico" && !c) return { valido: false, diagnosticos: [{ codigo: "visor/no-compila", severidad: "error", mensaje: "El modelo analítico necesita que el modelo compile." }] };
    const base = { modo, analitico: c ? { modelo: c.modelo, mapeo: c.mapeo } : null };
    if ("eje" in p) plano = planoDeEje(f, p.eje, p.profundidad);
    else plano = p.desde[0] === p.hasta[0] && p.desde[1] === p.hasta[1] ? null : { desde: p.desde, hasta: p.hasta, ...(p.profundidad !== undefined ? { profundidad: p.profundidad } : {}) };
    if (!plano) return { valido: false, diagnosticos: [{ codigo: "visor/alzado", severidad: "error", mensaje: "eje" in p ? `No hay ningún eje ${p.eje}.` : "Los dos puntos del alzado son el mismo." }] };
    const d = { ...(this.proyecto.nombre ? { nombre: this.proyecto.nombre } : {}), huella: this.huella };
    let e: Escena;
    if (diagramas) {
      const rr = this.rr;
      if (!rr) return { valido: false, diagnosticos: [{ codigo: "visor/sin-resultados", severidad: "error", mensaje: "Los diagramas necesitan el cálculo." }] };
      const conj = this.conjunto(diagramas.combinaciones, "esfuerzos");
      if (!conj.valido) return conj;
      e = vistaAlzadoDiagramas(rr, plano, diagramas.esfuerzo, conj.valor, d, diagramas.escala, modo);
    } else if (reacciones) {
      const rr = this.rr;
      if (!rr) return { valido: false, diagnosticos: [{ codigo: "visor/sin-resultados", severidad: "error", mensaje: "Las reacciones necesitan el cálculo." }] };
      const conj = this.conjunto(reacciones.combinaciones, "lineal");
      if (!conj.valido) return conj;
      e = vistaAlzadoReacciones(rr, plano, conj.valor, d, reacciones.escala, modo);
    } else if (cargas) {
      if (!f.casos.some((c) => c.id === cargas.caso)) return { valido: false, diagnosticos: [{ codigo: "visor/caso", severidad: "error", mensaje: `El caso ${cargas.caso} no existe.` }] };
      e = vistaAlzadoCargas(f, plano, cargas.caso, d, cargas.escala, base);
    } else e = vistaAlzado(f, plano, d, base);
    this.escenas.set(clave, e);
    return { valido: true, valor: e };
  }

  alzado(p: PlanoPedido, diagramas?: DiagramasAlzado, reacciones?: ReaccionesAlzado, cargas?: CargasAlzado): { valido: true; valor: EscenaPreparada } | { valido: false; diagnosticos: Diagnostico[] } {
    const e = this.alzadoA4(p, diagramas, reacciones, cargas);
    return e.valido ? { valido: true, valor: prepararEscena(e.valor) } : e;
  }

  // ─── 3D con resultados (I4) ───────────────────────────────────────────────────────────────────

  private origenC: [number, number, number] | null = null;

  /** El origen de las coordenadas del 3D: el del alámbrico, para que todo se pinte en las mismas. */
  get origen3D(): [number, number, number] {
    return (this.origenC ??= alambrico(this.proyecto.modelo).origen);
  }

  private solidoC: Solido | null = null;

  /**
   * El 3D sólido (I3), en el origen del 3D y con las viguetas de la compilación si compila. Se hace
   * una vez (en el reticular grande, ~1,5 s) y se da una copia: la respuesta se va por Transferable.
   * Sin paños no usa la compilación, así que no la espera.
   */
  solido(): Solido {
    const f = this.proyecto.modelo;
    const x = (this.solidoC ??= solido(f, this.origen3D, f.panos?.length ? this.compilado : null));
    return { ...x, triangulos: x.triangulos.slice(), objeto: x.objeto.slice(), planta: x.planta.slice(), caseton: x.caseton.slice(), aristas: x.aristas.slice(), objetoArista: x.objetoArista.slice(), plantaArista: x.plantaArista.slice() };
  }

  /** Las cargas de un caso en el 3D (tras I4): sólo necesitan el modelo físico. */
  cargas3D(caso: string, escala?: number): { valido: true; valor: Cargas3D } | { valido: false; diagnosticos: Diagnostico[] } {
    const f = this.proyecto.modelo;
    if (!f.casos.some((c) => c.id === caso)) return { valido: false, diagnosticos: [{ codigo: "visor/caso", severidad: "error", mensaje: `El caso ${caso} no existe.` }] };
    return { valido: true, valor: cargas3D(f, this.origen3D, caso, escala) };
  }

  diagramas3D(p: PedidoDiagramas3D): { valido: true; valor: Diagramas3D } | { valido: false; diagnosticos: Diagnostico[] } {
    const rr = this.rr;
    if (!rr) return { valido: false, diagnosticos: [{ codigo: "visor/sin-resultados", severidad: "error", mensaje: "Los diagramas necesitan el cálculo." }] };
    if (p.planta !== null && !this.proyecto.modelo.plantas.some((x) => x.id === p.planta)) return { valido: false, diagnosticos: [{ codigo: "visor/planta", severidad: "error", mensaje: `La planta ${p.planta} no existe.` }] };
    const conj = this.conjunto(p.combinaciones, "esfuerzos");
    if (!conj.valido) return conj;
    return { valido: true, valor: diagramas3D(rr, this.origen3D, p.esfuerzo, conj.valor, { planta: p.planta, piezas: p.piezas, ...(p.escala !== undefined ? { escala: p.escala } : {}) }) };
  }

  isovalores3D(p: PedidoIsovalores3D): { valido: true; valor: Isovalores3D } | { valido: false; diagnosticos: Diagnostico[] } {
    const rr = this.rr;
    if (!rr) return { valido: false, diagnosticos: [{ codigo: "visor/sin-resultados", severidad: "error", mensaje: "Los isovalores necesitan el cálculo." }] };
    if (p.planta !== null && !this.proyecto.modelo.plantas.some((x) => x.id === p.planta)) return { valido: false, diagnosticos: [{ codigo: "visor/planta", severidad: "error", mensaje: `La planta ${p.planta} no existe.` }] };
    const conj = this.conjunto(p.combinaciones, p.campo === "uz" ? "desplazamientos" : "esfuerzos");
    if (!conj.valido) return conj;
    return { valido: true, valor: isovalores3D(rr, this.origen3D, p.campo, conj.valor, { planta: p.planta, ...(p.superficies ? { superficies: p.superficies } : {}), ...(p.escala ? { escala: p.escala } : {}) }) };
  }

  pilares3D(p: PedidoPilares3D): { valido: true; valor: Pilares3D } | { valido: false; diagnosticos: Diagnostico[] } {
    const rr = this.rr;
    if (!rr) return { valido: false, diagnosticos: [{ codigo: "visor/sin-resultados", severidad: "error", mensaje: "Los pilares por colores necesitan el cálculo." }] };
    if (p.planta !== null && !this.proyecto.modelo.plantas.some((x) => x.id === p.planta)) return { valido: false, diagnosticos: [{ codigo: "visor/planta", severidad: "error", mensaje: `La planta ${p.planta} no existe.` }] };
    const conj = this.conjunto(p.combinaciones, "esfuerzos");
    if (!conj.valido) return conj;
    return { valido: true, valor: pilares3D(rr, this.origen3D, p.magnitud, conj.valor, p.planta) };
  }

  reacciones3D(e: EleccionCombinaciones, escala?: number): { valido: true; valor: Reacciones3D } | { valido: false; diagnosticos: Diagnostico[] } {
    const rr = this.rr;
    if (!rr) return { valido: false, diagnosticos: [{ codigo: "visor/sin-resultados", severidad: "error", mensaje: "Las reacciones necesitan el cálculo." }] };
    const conj = this.conjunto(e, "lineal");
    if (!conj.valido) return conj;
    return reacciones3D(rr, this.origen3D, conj.valor, escala);
  }

  /** AB: el armado en el 3D (`armado.ts`): una planta o todas, con la base del pedido. */
  armado3D(p: PedidoArmado3D): { valido: true; valor: Armado3D } | { valido: false; diagnosticos: Diagnostico[] } {
    const rr = this.rr;
    if (!rr) return { valido: false, diagnosticos: [{ codigo: "visor/sin-resultados", severidad: "error", mensaje: "El armado necesita el cálculo." }] };
    if (p.planta !== null && !this.proyecto.modelo.plantas.some((x) => x.id === p.planta)) return { valido: false, diagnosticos: [{ codigo: "visor/planta", severidad: "error", mensaje: `La planta ${p.planta} no existe.` }] };
    const conj = this.conjunto(p.combinaciones, "esfuerzos");
    if (!conj.valido) return conj;
    return armado3D(rr, this.origen3D, p.armadura, conj.valor, { planta: p.planta, ...(p.escala ? { escala: p.escala } : {}), ...(p.armado ? { armado: p.armado } : {}), ...(p.soloExceso !== undefined ? { soloExceso: p.soloExceso } : {}), ...(p.filtro ? { filtro: p.filtro } : {}) });
  }

  /** AB: el valor del mapa de armado en un punto de una planta (null: fuera de las franjas). */
  valorArmado(p: PedidoValorArmado): { valido: true; valor: ValorArmado | null } | { valido: false; diagnosticos: Diagnostico[] } {
    const q = this.q;
    if (!q) return { valido: false, diagnosticos: [{ codigo: "visor/sin-resultados", severidad: "error", mensaje: "No hay resultados de esta huella." }] };
    if (!this.proyecto.modelo.plantas.some((x) => x.id === p.planta)) return { valido: false, diagnosticos: [{ codigo: "visor/planta", severidad: "error", mensaje: `La planta ${p.planta} no existe.` }] };
    const conj = this.conjunto(p.combinaciones, "esfuerzos");
    if (!conj.valido) return conj;
    return valorArmado(q, p.planta, p.armadura, conj.valor, p.x, p.y, p.armado);
  }

  /** El valor de un mapa en un punto de una lámina, en la combinación dibujada (null: sin mapa o fuera de ella). */
  valorLamina(p: PedidoValorLamina): { valido: true; valor: ValorLamina | null } | { valido: false; diagnosticos: Diagnostico[] } {
    const rr = this.rr;
    if (!rr) return { valido: false, diagnosticos: [{ codigo: "visor/sin-resultados", severidad: "error", mensaje: "No hay resultados de esta huella." }] };
    if (!Number.isInteger(p.lamina) || p.lamina < 0 || p.lamina >= (rr.c.modelo.laminas?.length ?? 0)) return { valido: false, diagnosticos: [{ codigo: "visor/lamina", severidad: "error", mensaje: `No hay ninguna lámina ${p.lamina}.` }] };
    const conj = this.conjunto({ tipo: "una", de: p.combinaciones, nombre: p.nombre }, p.campo === "uz" ? "desplazamientos" : "esfuerzos");
    if (!conj.valido) return conj;
    const v = valorEnLamina(rr, p.campo, conj.valor.factores[0]!, p.lamina, p.punto);
    return { valido: true, valor: v ? { ...v, unidad: UNIDADES_CAMPO[p.campo], lamina: p.lamina, comb: p.nombre } : null };
  }

  escenaDe(fu: FuenteEscena): { valido: true; valor: Escena } | { valido: false; diagnosticos: Diagnostico[] } {
    return fu.tipo === "planta" ? this.escenaA4(fu.planta, fu.vista) : this.alzadoA4(fu.plano, fu.diagramas, fu.reacciones, fu.cargas);
  }

  /** El objeto bajo un punto de una escena (o, con `objetos`, esos objetos), resaltado. */
  elegir(fu: FuenteEscena, punto: readonly [number, number] | null, radio: number, objetos?: readonly string[]): Eleccion | null {
    const e = this.escenaDe(fu);
    if (!e.valido) return null;
    if (objetos !== undefined) return objetos.length ? resaltar(e.valor, objetos) : null;
    return punto ? elegir(e.valor, punto, radio) : null;
  }

  /** Los objetos de una ventana de una escena (`elegirVentana`). */
  ventana(fu: FuenteEscena, caja: [number, number, number, number], modo: "dentro" | "toca"): string[] {
    const e = this.escenaDe(fu);
    return e.valido ? elegirVentana(e.valor, caja, modo) : [];
  }
}

/** sha256 en hexadecimal de unos bytes, con el SubtleCrypto del entorno (navegador, worker, Node o Bun). */
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const h = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}
