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
 * Puro: sin IO (el núcleo WASM lo inicia quien crea la sesión).
 */
import { conjuntoCombinaciones, seleccionPorDefecto, type ConjuntoCombinaciones, type Proposito } from "../agente/combinaciones.ts";
import { resumen, type Resumen } from "../agente/consultas.ts";
import { leerProyecto, type Proyecto, type VistaGuardada } from "../agente/proyecto.ts";
import { conjuntoPorDefecto, planoDeEje, ResultadosRender, vistaAlzado, vistaAlzadoDiagramas, vistaAxiles, vistaCampo, vistaCargas, vistaDiagnosticos, vistaDiagramas, vistaMalla, vistaModelo, type Campo, type EscalaMapa, type Escena, type EsfuerzoPlano, type PlanoAlzado, type Vec2 } from "../agente/render/index.ts";
import { UNIDADES_CAMPO } from "../agente/render/resultados.ts";
import { desempaquetarResultados, empaquetarResultados, type CabeceraResultados } from "../agente/resultados.ts";
import { sensatezPrevia } from "../agente/sensatez.ts";
import { SITUACIONES, type Situacion } from "../combinaciones/generador.ts";
import { compilar, type ResultadoCompilacion } from "../compilador/compilar.ts";
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
  /** `escala`: la del mapa (`EscalaMapa`); sin ella, la completa. */
  | { vista: "campo"; campo: Campo; combinaciones: EleccionCombinaciones; escala?: EscalaMapa }
  | { vista: "vigas"; esfuerzo: "My" | "Vz"; combinaciones: EleccionCombinaciones }
  | { vista: "pilares-n"; combinaciones: EleccionCombinaciones };

/** El plano de un alzado que pide la interfaz: el de un eje (los del modelo o los propuestos) o el que pasa por dos puntos. */
export type PlanoPedido = { eje: string; profundidad?: number } | { desde: Vec2; hasta: Vec2; profundidad?: number };

/** Los diagramas de las barras del plano de un alzado (I4): el esfuerzo en el plano y sus combinaciones. */
export interface DiagramasAlzado {
  esfuerzo: EsfuerzoPlano;
  combinaciones: EleccionCombinaciones;
  /** Por la que se multiplica la escala automática. */
  escala?: number;
}

/** Una escena que se puede pedir, elegir y resaltar (I2): la de una planta en una vista, o un alzado (con diagramas, en I4). */
export type FuenteEscena = { tipo: "planta"; planta: string; vista: VistaPlanta } | { tipo: "alzado"; plano: PlanoPedido; diagramas?: DiagramasAlzado };

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
  /** sha256 de los resultados empaquetados como `resultados.bin` (el mismo que guarda la CLI): criterio 2 de V1. */
  sha256Resultados: string | null;
  /** I2: los ejes de replanteo que se dibujan (los del modelo o, si no tiene, los propuestos). */
  ejes: { id: string; nombre?: string; desde: Vec2; hasta: Vec2; propuesto: boolean }[];
  /** I3: las vistas guardadas en el proyecto. */
  vistas: VistaGuardada[];
}

export type Apertura = { valido: true; sesion: Sesion } | { valido: false; diagnosticos: Diagnostico[] };

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

export class Sesion {
  readonly proyecto: Proyecto;
  readonly compilacion: ResultadoCompilacion;
  /** sha256 del núcleo WASM con el que se calcula (el de los resultados guardados tiene que coincidir). */
  readonly motor: string;
  private readonly previa: Diagnostico[];
  private readonly res: Resumen | null;
  private casosR: ResultadoCaso[] | null = null;
  private cabecera: CabeceraResultados | null = null;
  private origenR: "calculo" | "guardados" | null = null;
  private shaR: string | null = null;
  private qC: Consultas | null = null;
  private rrC: ResultadosRender | null = null;
  /** Escenas ya hechas, por su clave (las mismas que pide la interfaz al moverse). */
  private readonly escenas = new Map<string, Escena>();

  private constructor(proyecto: Proyecto, compilacion: ResultadoCompilacion, motor: string) {
    this.proyecto = proyecto;
    this.compilacion = compilacion;
    this.motor = motor;
    this.previa = sensatezPrevia(proyecto.modelo, proyecto.opciones).flatMap((x) => x.avisos);
    if (compilacion.valido) {
      const r = resumen(proyecto, compilacion);
      this.res = r.valido ? r.valor : null;
    } else this.res = null;
  }

  /** Lee y compila un proyecto. No valido: el JSON o su esquema (lo que un modelo que no compila sí tiene: una huella y su dibujo). */
  static abrir(texto: string, motor: string): Apertura {
    const l = leerProyecto(texto);
    if (!l.valido) return { valido: false, diagnosticos: l.diagnosticos };
    return { valido: true, sesion: new Sesion(l.proyecto, compilar(l.proyecto.modelo, l.proyecto.opciones), motor) };
  }

  get huella(): string {
    return this.compilacion.huella;
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
    return this.res;
  }

  get cabeceraResultados(): CabeceraResultados | null {
    return this.cabecera;
  }

  /** Todos los diagnósticos que se enseñan: compilación, sensatez previa y cálculo. */
  get diagnosticos(): Diagnostico[] {
    return ordenSeveridad([...this.compilacion.diagnosticos, ...this.previa, ...(this.cabecera?.diagnosticos ?? [])]);
  }

  estado(): EstadoSesion {
    const f = this.proyecto.modelo;
    const cotas = cotasPlantas(f.plantas);
    const porObjeto = plantasDeObjetos(this.proyecto);
    const cuenta = new Map<string, { avisos: number; errores: number }>();
    for (const d of this.diagnosticos) {
      const plantas = new Set((d.ids ?? []).flatMap((id) => porObjeto.get(id) ?? []));
      for (const p of plantas) {
        const c = cuenta.get(p) ?? { avisos: 0, errores: 0 };
        if (d.severidad === "error") c.errores++;
        else c.avisos++;
        cuenta.set(p, c);
      }
    }
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
      combinaciones: this.combinacionesDisponibles(),
      sha256Resultados: this.shaR,
      ejes: (() => {
        const x = ejesDe(f);
        return x.ejes.map((e) => ({ id: e.id, ...(e.nombre ? { nombre: e.nombre } : {}), desde: e.desde, hasta: e.hasta, propuesto: x.propuestos }));
      })(),
      vistas: this.proyecto.vistas ?? [],
    };
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

  /** El conjunto de combinaciones de una elección, para un propósito. */
  conjunto(e: EleccionCombinaciones, proposito: Proposito): { valido: true; valor: ConjuntoCombinaciones } | { valido: false; diagnosticos: Diagnostico[] } {
    const q = this.q;
    if (!q || !this.res) return { valido: false, diagnosticos: [{ codigo: "visor/sin-resultados", severidad: "error", mensaje: "No hay resultados de esta huella." }] };
    switch (e.tipo) {
      case "defecto":
        return proposito === "lineal" ? conjuntoCombinaciones(q, seleccionPorDefecto(q.fisico.casos, "lineal")) : { valido: true, valor: conjuntoPorDefecto(q, this.res, proposito) };
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
        if (v.vista === "malla") e = vistaMalla(rr, planta, d);
        else {
          const conj = this.conjunto(v.combinaciones, v.vista === "campo" && v.campo === "uz" ? "desplazamientos" : "esfuerzos");
          if (!conj.valido) return conj;
          e = v.vista === "campo" ? vistaCampo(rr, planta, v.campo, conj.valor, d, v.escala) : v.vista === "vigas" ? vistaDiagramas(rr, planta, v.esfuerzo, conj.valor, d) : vistaAxiles(rr, planta, conj.valor, d);
        }
      }
    }
    this.escenas.set(clave, e);
    return { valido: true, valor: e };
  }

  escena(planta: string, v: VistaPlanta): { valido: true; valor: EscenaPreparada } | { valido: false; diagnosticos: Diagnostico[] } {
    const e = this.escenaA4(planta, v);
    return e.valido ? { valido: true, valor: prepararEscena(e.valor) } : e;
  }

  /** El alzado de un plano (I2), o por qué no se puede dibujar. Sólo necesita el modelo físico; con diagramas (I4), el cálculo. */
  alzadoA4(p: PlanoPedido, diagramas?: DiagramasAlzado): { valido: true; valor: Escena } | { valido: false; diagnosticos: Diagnostico[] } {
    const f = this.proyecto.modelo;
    const clave = JSON.stringify(["alzado", p, diagramas ?? null]);
    const hecha = this.escenas.get(clave);
    if (hecha) return { valido: true, valor: hecha };
    let plano: PlanoAlzado | null;
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
      e = vistaAlzadoDiagramas(rr, plano, diagramas.esfuerzo, conj.valor, d, diagramas.escala);
    } else e = vistaAlzado(f, plano, d);
    this.escenas.set(clave, e);
    return { valido: true, valor: e };
  }

  alzado(p: PlanoPedido, diagramas?: DiagramasAlzado): { valido: true; valor: EscenaPreparada } | { valido: false; diagnosticos: Diagnostico[] } {
    const e = this.alzadoA4(p, diagramas);
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
   */
  solido(): Solido {
    const x = (this.solidoC ??= solido(this.proyecto.modelo, this.origen3D, this.compilado));
    return { ...x, triangulos: x.triangulos.slice(), objeto: x.objeto.slice(), planta: x.planta.slice(), aristas: x.aristas.slice(), objetoArista: x.objetoArista.slice(), plantaArista: x.plantaArista.slice() };
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
    return fu.tipo === "planta" ? this.escenaA4(fu.planta, fu.vista) : this.alzadoA4(fu.plano, fu.diagramas);
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
