/**
 * Atendedor del worker de sesión (V1): contesta los pedidos de `protocolo.ts` con una `Sesion`. Es
 * común al worker del navegador y a los tests, que lo llaman directamente.
 *
 * Puro: el núcleo WASM ya iniciado por quien lo crea.
 */
import type { ArmadoProyecto } from "../agente/armaduraBase.ts";
import type { DatosArmado as DatosArmadoObra } from "../comprobaciones/armado.ts";
import { agotar } from "../comprobaciones/pasos.ts";
import type { Consultas } from "../compilador/consultas.ts";
import { claveAlDia, datosComprobacion, datosComprobaciones, datosPortico, esfuerzosPortico, esfuerzosTramoPilar, faltanAlDia, pasosAlDia, pasosArmar, type ProgresoTarea, type TipoComprobacion } from "./comprobaciones.ts";
import type { OpcionesCompilacion, ModeloFisico } from "../compilador/fisico.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { datosDesplomes, datosLosas, datosObjeto, datosPilar, datosPilares, datosRevision, datosViga, desplazamientos, estacionViga, geometria3D, piezasPlanta, reaccionesPorCaso, type Resultado, valorEnPunto } from "./datos.ts";
import { alambrico } from "./alambrico.ts";
import { punzonamiento3D } from "./armadoPlanta.ts";
import { armadoLosas3D } from "./armadoLosas3d.ts";
import { datosArmado, datosFranja } from "./franjas.ts";
import type { Pedido, Respuestas } from "./protocolo.ts";
import { Sesion } from "./sesion.ts";

export type Contestacion = { ok: true; valor: unknown } | { ok: false; diagnosticos: Diagnostico[] };

/**
 * El peso propio calculado de la revisión (`pesoPropioCalculado`, una compilación más) hecho en
 * otro hilo: en la app, un worker anidado (`app/src/sesion/pesoPropio.worker.ts`). Sin él, como en
 * los tests y en un móvil, la revisión final lo compila aquí.
 */
export type PesoAparte = (modelo: ModeloFisico, opciones: OpcionesCompilacion | undefined) => Promise<Map<string, number> | null>;

const sin = (mensaje: string): Contestacion => ({ ok: false, diagnosticos: [{ codigo: "visor/sin-proyecto", severidad: "error", mensaje }] });
/** Lo que contesta una tarea cuando el proyecto o sus resultados cambiaron mientras trabajaba. */
const OBSOLETA: Contestacion = { ok: false, diagnosticos: [{ codigo: "visor/obsoleto", severidad: "error", mensaje: "El proyecto o sus resultados han cambiado mientras se comprobaba: vuelva a pedirlo." }] };
const de = <T>(r: Resultado<T>): Contestacion => (r.valido ? { ok: true, valor: r.valor } : { ok: false, diagnosticos: r.diagnosticos });
const bien = <K extends keyof Respuestas>(_k: K, valor: Respuestas[K]): Contestacion => ({ ok: true, valor });

export class Atendedor {
  private sesion: Sesion | null = null;
  readonly motor: string;
  private readonly pesoAparte: PesoAparte | undefined;
  /** El peso propio calculado en otro hilo, por resultados (undefined si falló: se compila aquí). */
  private pesos = new WeakMap<object, Promise<Map<string, number> | null | undefined>>();

  constructor(motor: string, o: { pesoAparte?: PesoAparte } = {}) {
    this.motor = motor;
    this.pesoAparte = o.pesoAparte;
  }

  get huella(): string | null {
    return this.sesion?.huella ?? null;
  }

  /**
   * Lo que se adelanta con el worker parado, tras fijar unos resultados (V1-3): la preparación de los
   * campos SPR, que no depende del caso (en el edificio objetivo, ~0,35 s del primer mapa de M, N o Q).
   */
  ocioso(): void {
    try {
      void this.sesion?.rr?.campos;
    } catch {
      // Lo adelantado no es un pedido: si falla, fallará también el pedido que lo necesite, y lo dirá
    }
  }

  /**
   * Las puestas al día de las comprobaciones que están a medias, por su clave (`claveAlDia`): dos
   * tareas que piden lo mismo (la tabla y la planta de un tipo) avanzan la misma, y una que se deja a
   * medias sigue donde iba si se vuelve a pedir.
   */
  private puestas = new Map<string, { q: Consultas; g: ReturnType<typeof pasosAlDia>; fin?: Contestacion | null; comprobadas: number }>();

  /**
   * Los pedidos que son **tareas** (`cola.ts`): los que comprueban todas las piezas de un tipo o
   * proponen su armado, que en un edificio grande tardan minutos. Dan un generador que avisa tras cada
   * pieza y acaba con la contestación; los demás pedidos, null (`atender`).
   */
  tarea(p: Pedido): Generator<ProgresoTarea, Contestacion> | null {
    const s = this.sesion;
    if (!s) return null;
    switch (p.tipo) {
      case "comprobaciones":
        return this.conAlDia(s, p.datos, p.de, p.armado, (comprobadas) => {
          // (las partes que se han comprobado para este pedido: las de la puesta al día)
          const r = datosComprobaciones(s, p.de, p.armado);
          return de(r.valido ? { ...r, valor: { ...r.valor, comprobadas: r.valor.comprobadas + comprobadas } } : r);
        });
      case "comprobacion":
        return this.conAlDia(s, p.datos, p.de, p.armado, () => de(datosComprobacion(s, p.de, p.clave, p.armado)));
      case "punzonamiento-3d":
        return this.conAlDia(s, p.datos, "punzonamiento", p.armado, () => de(punzonamiento3D(s, p.armado)));
      case "escena": {
        const v = p.vista;
        if (v.vista !== "comprobacion") return null;
        return this.conAlDia(s, v.datos, v.de, v.armado, () => {
          const r = s.escena(p.planta, v);
          return r.valido ? bien("escena", r.valor) : { ok: false, diagnosticos: r.diagnosticos };
        });
      }
      case "armar":
        return this.armar(s, p);
      default:
        return null;
    }
  }

  /** La sesión o sus resultados han cambiado desde que empezó la tarea: lo que llevaba no vale. */
  private obsoleta(s: Sesion, q: Consultas | null): boolean {
    return this.sesion !== s || s.q !== q;
  }

  /** Una tarea que necesita lo comprobado de un tipo con un armado: lo pone al día por pasos y contesta con `fin`. */
  private *conAlDia(s: Sesion, datos: DatosArmadoObra | undefined, tipo: TipoComprobacion, armado: ArmadoProyecto | undefined, fin: (comprobadas: number) => Contestacion): Generator<ProgresoTarea, Contestacion> {
    if (datos !== undefined) s.datosArmado = datos;
    const q = s.q;
    let comprobadas = 0;
    if (q && faltanAlDia(s, tipo, armado) > 0) {
      const clave = claveAlDia(s, tipo, armado);
      let x = this.puestas.get(clave);
      if (!x || x.q !== q) {
        // (las que se quedaron a medias con otro armado no se acumulan)
        if (this.puestas.size >= 6) this.puestas.delete(this.puestas.keys().next().value!);
        this.puestas.set(clave, (x = { q, g: pasosAlDia(s, tipo, armado), comprobadas: 0 }));
      }
      while (x.fin === undefined) {
        const r = x.g.next();
        if (r.done) {
          x.fin = r.value.valido ? null : { ok: false, diagnosticos: r.value.diagnosticos };
          if (r.value.valido) x.comprobadas = r.value.valor.comprobadas;
          if (this.puestas.get(clave) === x) this.puestas.delete(clave);
          break;
        }
        yield { ...r.value, tipo };
        if (this.obsoleta(s, q)) return OBSOLETA;
      }
      if (x.fin) return x.fin;
      comprobadas = x.comprobadas;
      // Otro pedido pudo traer otros datos de la obra entre dos turnos: se contesta con los de éste
      if (datos !== undefined) s.datosArmado = datos;
    }
    return fin(comprobadas);
  }

  /** La propuesta de armado, por pasos. */
  private *armar(s: Sesion, p: Extract<Pedido, { tipo: "armar" }>): Generator<ProgresoTarea, Contestacion> {
    if (p.datos !== undefined) s.datosArmado = p.datos;
    const q = s.q;
    const g = pasosArmar(s, p);
    for (;;) {
      const r = g.next();
      if (r.done) return de(r.value);
      yield r.value;
      if (this.obsoleta(s, q)) return OBSOLETA;
      if (p.datos !== undefined) s.datosArmado = p.datos;
    }
  }

  /** `alProgreso`: las fases del cálculo según terminan (sólo en `calcular`; R-25). */
  async atender(p: Pedido, alProgreso?: (fase: string, ms: number) => void): Promise<Contestacion> {
    // Una tarea, de una vez (los tests y la CLI; el worker las lleva por turnos, `cola.ts`)
    const tarea = p.tipo === "abrir" ? null : this.tarea(p);
    if (tarea) return agotar(tarea);
    if (p.tipo === "abrir") {
      const a = Sesion.abrir(p.texto, this.motor, { diferir: !!p.diferir });
      if (!a.valido) {
        this.sesion = null;
        return { ok: false, diagnosticos: a.diagnosticos };
      }
      this.sesion = a.sesion;
      return bien("abrir", a.sesion.estado({ sinCompilar: true }));
    }
    const s = this.sesion;
    if (!s) return sin("No hay ningún proyecto abierto.");
    switch (p.tipo) {
      case "compilar":
        s.compilar();
        return bien("compilar", s.estado());
      case "guardados": {
        const r = await s.usarGuardados(p.cabecera, p.bytes);
        return bien("guardados", r.ok ? { usados: true, estado: s.estado() } : { usados: false, motivo: r.motivo });
      }
      case "calcular": {
        const r = await s.calcular(alProgreso ? { alProgreso } : {});
        if (!r.ok) return { ok: false, diagnosticos: r.diagnosticos };
        return bien("calcular", s.estado());
      }
      case "paquete": {
        // VS4: se empaquetan al pedirlos (0,2–0,5 s en el edificio objetivo), no se guardan: con el sismo son
        // 321 MiB, y abierto por URL o desde el disco nadie los pide. La cabecera, como la escribe la CLI
        // (cli/ordenes.ts): con el núcleo y el sha256 de los bytes
        const x = s.paquete();
        return bien("paquete", x ? { cabecera: JSON.stringify({ ...x.cabecera, motor: this.motor, sha256: x.sha256 }), bytes: x.bytes } : null);
      }
      case "estado":
        return bien("estado", s.estado());
      case "escena": {
        const r = s.escena(p.planta, p.vista);
        return r.valido ? bien("escena", r.valor) : { ok: false, diagnosticos: r.diagnosticos };
      }
      case "alzado": {
        const r = s.alzado(p.plano, p.diagramas, p.reacciones, p.cargas, p.deformada);
        return r.valido ? bien("alzado", r.valor) : { ok: false, diagnosticos: r.diagnosticos };
      }
      case "elegir":
        return bien("elegir", s.elegir(p.fuente, p.punto, p.radio, p.objetos, p.elegibles));
      case "ventana":
        return bien("ventana", s.ventana(p.fuente, p.caja, p.modo, p.elegibles));
      case "alambrico":
        return bien("alambrico", alambrico(s.proyecto.modelo));
      case "solido":
        return bien("solido", s.solido(p.casetones !== false));
      case "objeto":
        return de(datosObjeto(s, p.id));
      case "losas":
        return de(datosLosas(s, p.planta, p.campo, p.combinaciones, p.escala, p.malla, p.envolvente));
      case "valor-punto":
        return de(valorEnPunto(s, p.planta, p.campo, p.combinaciones, p.x, p.y, p.escala, p.envolvente));
      case "piezas":
        return bien("piezas", piezasPlanta(s, p.planta));
      case "viga":
        return de(datosViga(s, p.id, p.esfuerzo, p.combinaciones));
      case "estacion":
        return de(estacionViga(s, p.id, p.esfuerzo, p.combinaciones, p.s));
      case "pilares":
        return de(datosPilares(s, p.planta, p.combinaciones, p.malla));
      case "pilar":
        return de(datosPilar(s, p.id, p.combinaciones));
      case "armado":
        return de(datosArmado(s, p.planta, p.combinaciones, p.armadura, { ...(p.escala ? { escala: p.escala } : {}), ...(p.armado ? { armado: p.armado } : {}), ...(p.soloExceso !== undefined ? { soloExceso: p.soloExceso } : {}), ...(p.filtro ? { filtro: p.filtro } : {}) }));
      case "armado3d":
        return de(s.armado3D(p));
      case "armado-losas-3d":
        if (p.datos !== undefined) s.datosArmado = p.datos;
        return de({ valido: true as const, valor: armadoLosas3D(s.proyecto.modelo, s.origen3D, p.armado, s.datosArmado, { planta: p.planta, ...(p.cara ? { cara: p.cara } : {}), ...(p.base ? { base: true } : {}) }) });
      case "valor-armado":
        return de(s.valorArmado(p));
      case "franja":
        return de(datosFranja(s, p.id, p.combinaciones));
      case "desplomes":
        return de(datosDesplomes(s, p.combinaciones));
      case "geometria":
        return de(geometria3D(s));
      case "deformada":
        return de(desplazamientos(s, p.combinaciones));
      case "diagramas3d":
        return de(s.diagramas3D(p));
      case "isovalores3d":
        return de(s.isovalores3D(p));
      case "pilares3d":
        return de(s.pilares3D(p));
      case "reacciones3d":
        return de(s.reacciones3D(p.combinaciones, p.escala));
      case "cargas3d":
        return de(s.cargas3D(p.caso, p.escala));
      case "valor-lamina":
        return de(s.valorLamina(p));
      case "reacciones-casos":
        return de(reaccionesPorCaso(s));
      case "revision": {
        // Con la provisional se lanza el peso propio calculado en otro hilo, y la final lo espera:
        // mientras se prepara la provisional (~4 s en el edificio objetivo) se compila al lado (~2 s),
        // y la cola de este worker no se para por él
        const q = s.q;
        if (p.provisional && q && this.pesoAparte && !this.pesos.has(q) && s.proyecto.modelo.casos.some((c) => c.pesoPropio))
          this.pesos.set(q, this.pesoAparte(s.proyecto.modelo, s.proyecto.opciones).catch(() => undefined));
        const aparte = !p.provisional && q ? this.pesos.get(q) : undefined;
        if (aparte) {
          const pesoCalculado = await aparte;
          if (q) this.pesos.delete(q);
          if (pesoCalculado !== undefined) return de(datosRevision(s, { pesoCalculado }));
        }
        return de(datosRevision(s, { provisional: !!p.provisional }));
      }
      case "precalentar":
        if (s.proyecto.modelo.plantas.some((x) => x.id === p.planta)) s.rr?.valores(p.planta, "losas", "flexion");
        return bien("precalentar", null);
      // VS4: las acciones del programa
      case "viento":
        return bien("viento", s.viento());
      case "sismo":
        return bien("sismo", s.sismoDatos());
      case "modal":
        return bien("modal", s.modal());
      case "modo":
        return de(s.modo(p.modo));
      // SO: el segundo orden global
      case "segundo-orden":
        return bien("segundo-orden", s.segundoOrdenDatos());
      // CO6: las comprobaciones con el armado en barras (la tabla, la ficha y la propuesta son tareas: `tarea`)
      case "portico":
        if (p.datos !== undefined) s.datosArmado = p.datos;
        return de(datosPortico(s, p.viga));
      case "esfuerzos-portico":
        return de(esfuerzosPortico(s, p.viga));
      case "esfuerzos-pilar":
        return de(esfuerzosTramoPilar(s, p.pilar, p.planta));
      case "comprobaciones":
      case "comprobacion":
      case "punzonamiento-3d":
      case "armar":
        // (son tareas: no llegan aquí)
        return sin("No hay resultados de esta huella.");
    }
  }
}

/** Arrays tipados de una respuesta, para devolverlos por Transferable (H27). */
export function transferibles(v: unknown, vistos = new Set<unknown>()): ArrayBuffer[] {
  if (v === null || typeof v !== "object" || vistos.has(v)) return [];
  vistos.add(v);
  if (ArrayBuffer.isView(v)) return v.buffer instanceof ArrayBuffer && v.byteOffset === 0 && v.byteLength === v.buffer.byteLength ? [v.buffer] : [];
  const r: ArrayBuffer[] = [];
  for (const x of Array.isArray(v) ? v : Object.values(v)) r.push(...transferibles(x, vistos));
  return [...new Set(r)];
}
