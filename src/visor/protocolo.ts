/**
 * Protocolo del worker de sesión del visor (V1). El hilo principal manda pedidos con un id y recibe
 * la respuesta con ese id y la huella de la sesión que la contestó: la interfaz descarta toda
 * respuesta cuya huella no sea la del proyecto que tiene abierto (criterio 3 de V1, PLA-15).
 *
 * Abrir otro proyecto, o el mismo cambiado, es crear otro worker: así cancelar es `terminate`, una
 * respuesta tardía de la sesión anterior no puede llegar, y la memoria de la anterior se libera.
 */
import type { EscalaMapa } from "../agente/render/isovalores.ts";
import type { Campo } from "../agente/render/resultados.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { DatosDeformada, DatosDesplomes, DatosEstacion, DatosLosas, DatosObjeto, DatosPilares, DatosRevision, DatosViga, Esfuerzo, FilaPilar, Combinaciones, Geometria3D, PiezaListada, ValorPunto } from "./datos.ts";
import type { Eleccion, EscenaPreparada } from "./escena.ts";
import type { Alambrico } from "./alambrico.ts";
import type { Solido } from "./solido.ts";
import type { Diagramas3D } from "./diagramas3d.ts";
import type { Isovalores3D } from "./isovalores3d.ts";
import type { Armado3D, ValorArmado } from "./armado.ts";
import type { Pilares3D } from "./pilares3d.ts";
import type { Reacciones3D } from "./reacciones3d.ts";
import type { Cargas3D } from "./cargas3d.ts";
import type { DatosArmado, DatosFranja } from "./franjas.ts";
import type { Armadura } from "../agente/render/armado.ts";
import type { ArmadoProyecto } from "../agente/armaduraBase.ts";
import type { CargasAlzado, DiagramasAlzado, EleccionCombinaciones, EstadoSesion, FuenteEscena, PedidoDiagramas3D, PedidoArmado3D, PedidoIsovalores3D, PedidoPilares3D, PedidoValorArmado, PedidoValorLamina, PlanoPedido, ReaccionesAlzado, ValorLamina, VistaPlanta } from "./sesion.ts";

export type Pedido =
  | { tipo: "abrir"; texto: string }
  | { tipo: "guardados"; cabecera: string; bytes: Uint8Array }
  | { tipo: "calcular" }
  | { tipo: "estado" }
  | { tipo: "escena"; planta: string; vista: VistaPlanta }
  /** Un alzado; con `diagramas`, los de las barras del plano, y con `reacciones`, las de sus objetos (I4); con `cargas`, las de un caso. */
  | { tipo: "alzado"; plano: PlanoPedido; diagramas?: DiagramasAlzado; reacciones?: ReaccionesAlzado; cargas?: CargasAlzado }
  /** El objeto bajo un punto de una escena, o (con `objetos`) esos objetos, resaltados. */
  | { tipo: "elegir"; fuente: FuenteEscena; punto: readonly [number, number] | null; radio: number; objetos?: string[] }
  /** Los objetos de una ventana (m) de una escena: «dentro», de izquierda a derecha; «toca», de derecha a izquierda. */
  | { tipo: "ventana"; fuente: FuenteEscena; caja: [number, number, number, number]; modo: "dentro" | "toca" }
  /** El 3D alámbrico del modelo físico (I2). */
  | { tipo: "alambrico" }
  /** El 3D sólido: las secciones extruidas, con sus aristas (I3). */
  | { tipo: "solido" }
  | { tipo: "objeto"; id: string }
  | { tipo: "losas"; planta: string; campo: Campo; combinaciones: EleccionCombinaciones; escala?: EscalaMapa }
  | { tipo: "valor-punto"; planta: string; campo: Campo; combinaciones: EleccionCombinaciones; x: number; y: number; escala?: EscalaMapa }
  | { tipo: "piezas"; planta: string }
  | { tipo: "viga"; id: string; esfuerzo: Esfuerzo; combinaciones: EleccionCombinaciones }
  | { tipo: "estacion"; id: string; esfuerzo: Esfuerzo; combinaciones: EleccionCombinaciones; s: number }
  | { tipo: "pilares"; planta: string; combinaciones: EleccionCombinaciones }
  | { tipo: "pilar"; id: string; combinaciones: EleccionCombinaciones }
  /** Fase F: el mapa de una armadura de las franjas de una planta, con su tabla, y el detalle de una franja. */
  | { tipo: "armado"; planta: string; combinaciones: EleccionCombinaciones; armadura: Armadura; escala?: EscalaMapa; armado?: ArmadoProyecto; soloExceso?: boolean }
  | { tipo: "franja"; id: string; combinaciones: EleccionCombinaciones }
  | { tipo: "desplomes"; combinaciones: EleccionCombinaciones }
  | { tipo: "geometria" }
  | { tipo: "deformada"; combinaciones: EleccionCombinaciones }
  /** I4: los diagramas de las barras y los isovalores de las losas en el 3D. */
  | ({ tipo: "diagramas3d" } & PedidoDiagramas3D)
  | ({ tipo: "isovalores3d" } & PedidoIsovalores3D)
  /** I4: los pilares por colores, las reacciones y el valor de un mapa bajo el cursor. */
  | ({ tipo: "pilares3d" } & PedidoPilares3D)
  | { tipo: "reacciones3d"; combinaciones: EleccionCombinaciones; escala?: number }
  /** Las cargas de un caso en el 3D. */
  | { tipo: "cargas3d"; caso: string; escala?: number }
  | ({ tipo: "valor-lamina" } & PedidoValorLamina)
  /** AB: el armado en el 3D y el valor de un punto de su mapa. */
  | ({ tipo: "armado3d" } & PedidoArmado3D)
  | ({ tipo: "valor-armado" } & PedidoValorArmado)
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
  solido: Solido;
  objeto: DatosObjeto;
  losas: DatosLosas;
  "valor-punto": ValorPunto | null;
  piezas: PiezaListada[];
  viga: DatosViga;
  estacion: DatosEstacion;
  pilares: DatosPilares;
  pilar: { combinaciones: Combinaciones; filas: FilaPilar[] };
  armado: DatosArmado;
  franja: DatosFranja;
  desplomes: DatosDesplomes;
  geometria: Geometria3D;
  deformada: DatosDeformada;
  diagramas3d: Diagramas3D;
  isovalores3d: Isovalores3D;
  pilares3d: Pilares3D;
  reacciones3d: Reacciones3D;
  cargas3d: Cargas3D;
  "valor-lamina": ValorLamina | null;
  armado3d: Armado3D;
  "valor-armado": ValorArmado | null;
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
