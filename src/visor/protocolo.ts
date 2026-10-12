/**
 * Protocolo del worker de sesión del visor (V1). El hilo principal manda pedidos con un id y recibe
 * la respuesta con ese id y la huella de la sesión que la contestó: la interfaz descarta toda
 * respuesta cuya huella no sea la del proyecto que tiene abierto (criterio 3 de V1, PLA-15).
 *
 * Abrir otro proyecto, o el mismo cambiado, es crear otro worker: así cancelar es `terminate`, una
 * respuesta tardía de la sesión anterior no puede llegar, y la memoria de la anterior se libera.
 */
import type { Campo } from "../agente/render/resultados.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { DatosDesplomes, DatosEstacion, DatosLosas, DatosObjeto, DatosPilares, DatosRevision, DatosViga, Esfuerzo, FilaPilar, Combinaciones, Geometria3D, PiezaListada, ValorPunto } from "./datos.ts";
import type { Eleccion, EscenaPreparada } from "./escena.ts";
import type { Alambrico } from "./alambrico.ts";
import type { EleccionCombinaciones, EstadoSesion, FuenteEscena, PlanoPedido, VistaPlanta } from "./sesion.ts";

export type Pedido =
  | { tipo: "abrir"; texto: string }
  | { tipo: "guardados"; cabecera: string; bytes: Uint8Array }
  | { tipo: "calcular" }
  | { tipo: "estado" }
  | { tipo: "escena"; planta: string; vista: VistaPlanta }
  | { tipo: "alzado"; plano: PlanoPedido }
  /** El objeto bajo un punto de una escena, o (con `objetos`) esos objetos, resaltados. */
  | { tipo: "elegir"; fuente: FuenteEscena; punto: readonly [number, number] | null; radio: number; objetos?: string[] }
  /** Los objetos de una ventana (m) de una escena: «dentro», de izquierda a derecha; «toca», de derecha a izquierda. */
  | { tipo: "ventana"; fuente: FuenteEscena; caja: [number, number, number, number]; modo: "dentro" | "toca" }
  /** El 3D alámbrico del modelo físico (I2). */
  | { tipo: "alambrico" }
  | { tipo: "objeto"; id: string }
  | { tipo: "losas"; planta: string; campo: Campo; combinaciones: EleccionCombinaciones }
  | { tipo: "valor-punto"; planta: string; campo: Campo; combinaciones: EleccionCombinaciones; x: number; y: number }
  | { tipo: "piezas"; planta: string }
  | { tipo: "viga"; id: string; esfuerzo: Esfuerzo; combinaciones: EleccionCombinaciones }
  | { tipo: "estacion"; id: string; esfuerzo: Esfuerzo; combinaciones: EleccionCombinaciones; s: number }
  | { tipo: "pilares"; planta: string; combinaciones: EleccionCombinaciones }
  | { tipo: "pilar"; id: string; combinaciones: EleccionCombinaciones }
  | { tipo: "desplomes"; combinaciones: EleccionCombinaciones }
  | { tipo: "geometria" }
  | { tipo: "deformada"; combinaciones: EleccionCombinaciones }
  | { tipo: "revision"; firmas: string; ficheroFirmas: string }
  /** Adelanta la recuperación SPR de una planta (la primera vez cuesta ~0,3 s en el edificio objetivo). */
  | { tipo: "precalentar"; planta: string };

/** Lo que devuelve cada pedido cuando sale bien. */
export interface Respuestas {
  abrir: EstadoSesion;
  guardados: { usados: true; estado: EstadoSesion } | { usados: false; motivo: string };
  calcular: EstadoSesion;
  estado: EstadoSesion;
  escena: EscenaPreparada;
  alzado: EscenaPreparada;
  elegir: Eleccion | null;
  ventana: string[];
  alambrico: Alambrico;
  objeto: DatosObjeto;
  losas: DatosLosas;
  "valor-punto": ValorPunto | null;
  piezas: PiezaListada[];
  viga: DatosViga;
  estacion: DatosEstacion;
  pilares: DatosPilares;
  pilar: { combinaciones: Combinaciones; filas: FilaPilar[] };
  desplomes: DatosDesplomes;
  geometria: Geometria3D;
  deformada: { comb: string; etiqueta: string; u: Float32Array };
  revision: DatosRevision;
  precalentar: null;
}

export type TipoPedido = Pedido["tipo"];

export type MensajeAlWorker = { tipo: "iniciar"; wasm: ArrayBuffer } | { id: number; pedido: Pedido };

export type MensajeDelWorker =
  /** El núcleo está cargado; `motor`, su sha256. */
  | { tipo: "listo"; motor: string; ms: number }
  | { id: number; huella: string | null; ok: true; valor: unknown; ms: number }
  /** Un pedido que no se puede contestar: el modelo, la elección o el estado no lo permiten. */
  | { id: number; huella: string | null; ok: false; diagnosticos: Diagnostico[]; ms: number }
  | { tipo: "fallo"; mensaje: string };
