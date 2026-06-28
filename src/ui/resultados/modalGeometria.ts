// modalGeometria: proyeccion PURA de una FORMA MODAL (Capa 2, ya calculada) al
// espacio de ESCENA del viewport. SIN React/R3F/three: testeable en Node. Espejo de
// deformadaGeometria.ts pero alimentada por las formas modales POR-NUDO (no por
// estacion de barra): cada barra es una recta i->j que se desplaza con la forma modal
// de sus dos nudos del modo activo.
//
// CONVENCION DE EJES (identica a deformadaGeometria, critica para superponer a la obra):
//  - El discretizador escribe los nodos FEM con mapearEjes(xPlanta,yPlanta,cota) = [X,Y,Z]
//    = [xPlanta, cota, yPlanta]  (FEM es Y-up: la vertical es Y).
//  - El viewport dibuja Z-up: la planta (x,y) va a la escena (x,y) y la cota va a la
//    escena z. Para llevar un nodo FEM a la escena hay que DESHACER mapearEjes:
//        escena = [FEM.x, FEM.z, FEM.y]   (intercambia Y<->Z)
//    y el desplazamiento [DX,DY,DZ] (mismo sistema FEM) sigue el mismo intercambio:
//        dispEscena = [DX, DZ, DY]
//  Blindado con comentario por ser el error tipico (forma girada 90 grados / "tumbada").
//
// NORMALIZACION (clave del camino modal, lo distingue de la deformada):
//  - Las amplitudes modales vienen normalizadas a masa modal unitaria, con ESCALA y
//    SIGNO ARBITRARIOS (no son desplazamientos fisicos en m). Dibujarlas crudas daria
//    una forma de tamaño impredecible (a veces invisible, a veces gigante).
//  - Por eso renormalizamos: dividimos cada desplazamiento por el MAXIMO modulo de
//    desplazamiento (traslacion) del modo, llevando la forma a amplitud ~1. Luego el
//    factor `escala` la lleva a un tamaño visible estable. Asi el signo/normalizacion
//    arbitrarios de PyNite no descuadran la vista.
//
// NO reimplementa FEM: solo dibuja lo que el motor devolvio (posicion base + su forma
// modal renormalizada y escalada). NO reutiliza datos de la deformada (resultadosStore):
// lee del contrato modal (ResultadosModales).
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosModales, Modo } from "../../solver";

// Un punto en coordenadas de ESCENA (Z-up), listo para three.js.
export type PuntoEscena = [number, number, number];

// La forma modal de UNA barra como segmento recto: 2 puntos (nudos i,j ya desplazados,
// escena) y la magnitud normalizada [0,1] del desplazamiento en cada punto, para colorear.
export interface SegmentoModal {
  puntos: [PuntoEscena, PuntoEscena];
  // |disp normalizado| por extremo (adimensional, [0,1]), alineado con `puntos`.
  mags: [number, number];
}

export interface GeometriaModal {
  segmentos: SegmentoModal[];
  // Rango de magnitud normalizada sobre todos los extremos producidos: alimenta el
  // color. Tras la renormalizacion magMax ~ 1 (salvo redondeo). 0/0 si no hay nada.
  magMin: number;
  magMax: number;
}

const vacio: GeometriaModal = { segmentos: [], magMin: 0, magMax: 0 };

// Modulo de la traslacion (DX,DY,DZ) de la forma modal de un nudo. Los giros (RX,RY,RZ)
// no se dibujan (la barra es recta entre nudos): solo cuenta la traslacion.
function moduloTraslacion(gdl: [number, number, number, number, number, number]): number {
  return Math.hypot(gdl[0], gdl[1], gdl[2]);
}

// Maximo modulo de traslacion sobre TODOS los nudos del modo: el factor de
// renormalizacion. Si es 0 (modo degenerado sin traslacion), se devuelve 1 para no
// dividir por cero (la forma queda plana, que es lo correcto).
function maxTraslacionModo(modo: Modo): number {
  let max = 0;
  for (const gdl of Object.values(modo.nodos)) {
    const m = moduloTraslacion(gdl);
    if (m > max) max = m;
  }
  return max > 0 ? max : 1;
}

// Lleva un nudo FEM (base + su forma modal renormalizada) al espacio de escena
// aplicando el factor de amplificacion. Devuelve el punto y la magnitud NORMALIZADA
// [0,1] (para colorear; la magnitud fisica no aplica: la forma modal es relativa).
function nudoDesplazado(
  base: { x: number; y: number; z: number },
  gdl: [number, number, number, number, number, number],
  norm: number,
  escala: number,
): { p: PuntoEscena; mag: number } {
  // Desplazamiento renormalizado a amplitud ~1 (signo/escala arbitrarios neutralizados).
  const dx = gdl[0] / norm;
  const dy = gdl[1] / norm;
  const dz = gdl[2] / norm;
  const mag = Math.hypot(dx, dy, dz); // [0,1] tras renormalizar
  // FEM (Y-up) -> escena (Z-up): intercambio Y<->Z, tanto en posicion como en disp.
  const p: PuntoEscena = [
    base.x + dx * escala,
    base.z + dz * escala,
    base.y + dy * escala,
  ];
  return { p, mag };
}

// Construye la geometria de la forma modal `numeroModo` (1-indexado) con factor de
// escala. Maneja con gracia: modos null, modo inexistente, member que referencia un
// nodo ausente o un nudo sin forma modal (salta ese member). Nunca lanza.
export function modalGeometria(
  modeloFEM: ModeloFEM | null,
  modos: ResultadosModales | null,
  numeroModo: number,
  escala: number,
): GeometriaModal {
  if (!modeloFEM || !modos) return vacio;

  // Localiza el modo por su `numero` (1-indexado). Si no existe (selector fuera de
  // rango tras recalcular con menos modos), no dibuja nada.
  const modo = modos.modos.find((m) => m.numero === numeroModo);
  if (!modo) return vacio;

  const norm = maxTraslacionModo(modo);

  // Map nombre de nodo -> posicion base (FEM). Construido una vez (evita find O(N×M)).
  const nodoPorNombre = new Map(modeloFEM.nodes.map((n) => [n.name, n]));

  const segmentos: SegmentoModal[] = [];
  let magMin = Infinity;
  let magMax = 0;

  for (const member of modeloFEM.members) {
    const ni = nodoPorNombre.get(member.i);
    const nj = nodoPorNombre.get(member.j);
    if (!ni || !nj) continue; // referencia rota: se omite (no deberia ocurrir)

    const gi = modo.nodos[member.i];
    const gj = modo.nodos[member.j];
    if (!gi || !gj) continue; // nudo sin forma modal en este modo: se omite

    const { p: pi, mag: mi } = nudoDesplazado(ni, gi, norm, escala);
    const { p: pj, mag: mj } = nudoDesplazado(nj, gj, norm, escala);

    segmentos.push({ puntos: [pi, pj], mags: [mi, mj] });
    magMin = Math.min(magMin, mi, mj);
    magMax = Math.max(magMax, mi, mj);
  }

  if (segmentos.length === 0) return vacio;
  return { segmentos, magMin: magMin === Infinity ? 0 : magMin, magMax };
}
