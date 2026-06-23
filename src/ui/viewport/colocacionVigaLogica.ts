// Logica PURA de la introduccion grafica de vigas (feature-12). Vive en su propio
// modulo (sin React ni three.js) para ser la "costura testeable" del flujo de dos
// clics SIN que ColocacionViga.tsx exporte nada que no sea un componente (regla
// react-refresh/only-export-components: un fichero de componentes solo exporta
// componentes). ColocacionViga.tsx importa de aqui; el test ataca estas funciones.
import type { DatosViga, ExtremoViga } from "../../estado";
import { nudoPorId } from "../../dominio";
import type { Modelo } from "../../dominio";
// Misma tolerancia de fusion de nudos que el discretizador (feature-4) y crearViga:
// dos extremos a <1 mm son "el mismo punto" -> viga degenerada. Fuente unica.
import { TOL_NODO } from "../../discretizador/discretizar";

// Posicion de dibujo (x,y) de un extremo ya resuelto: {nudoId} se busca en el
// modelo; {x,y} se usa tal cual. null si la referencia de nudo esta rota (no
// deberia pasar con extremos recien resueltos por el iman).
export function posicionExtremo(
  modelo: Modelo,
  extremo: ExtremoViga,
): { x: number; y: number } | null {
  if ("nudoId" in extremo) {
    const nudo = nudoPorId(modelo, extremo.nudoId);
    return nudo ? { x: nudo.x, y: nudo.y } : null;
  }
  return { x: extremo.x, y: extremo.y };
}

// True si dos extremos resuelven al MISMO punto (una viga con I===J es degenerada y
// no se crea). Con `modelo`, compara por POSICION fisica con tolerancia TOL_NODO
// (mismo criterio que el discretizador): cubre el caso id-vs-coords y los floats
// casi iguales, no solo la igualdad exacta. Sin `modelo`, cae al chequeo barato por
// id/coords exactas (suficiente para los casos del mismo tipo).
export function extremosCoinciden(
  a: ExtremoViga,
  b: ExtremoViga,
  modelo?: Modelo,
): boolean {
  if (modelo !== undefined) {
    const pa = posicionExtremo(modelo, a);
    const pb = posicionExtremo(modelo, b);
    if (pa !== null && pb !== null) {
      return Math.hypot(pa.x - pb.x, pa.y - pb.y) < TOL_NODO;
    }
    // Si alguna referencia esta rota, cae al chequeo exacto de abajo.
  }
  if ("nudoId" in a && "nudoId" in b) return a.nudoId === b.nudoId;
  if (!("nudoId" in a) && !("nudoId" in b)) return a.x === b.x && a.y === b.y;
  // Un extremo por id y otro por coords sin modelo para resolverlos: tratados como
  // distintos (el llamador real —ColocacionViga— siempre pasa el modelo).
  return false;
}

// Resultado de procesar un clic: guardar el extremo I (primer clic), crear la viga
// (segundo clic valido) o ignorar (segundo clic degenerado).
export type AccionClicViga =
  | { tipo: "guardarI"; i: ExtremoViga }
  | { tipo: "crearViga"; datos: DatosViga }
  | { tipo: "ignorar" };

// Defaults de viga necesarios para crear; seccion/material ya garantizados != null
// por el llamador (sin ellos no se coloca).
export interface DefaultsVigaResueltos {
  seccionId: string;
  materialId: string;
  extremoI: "empotrado" | "articulado";
  extremoJ: "empotrado" | "articulado";
  tirante: boolean;
}

// Decide la accion del clic dado el estado pendiente y el extremo recien resuelto.
// PURA: no toca stores ni refs; el componente aplica el resultado.
export function procesarClicViga(
  pendienteI: ExtremoViga | null,
  extremoResuelto: ExtremoViga,
  plantaId: string,
  defaults: DefaultsVigaResueltos,
  modelo?: Modelo,
): AccionClicViga {
  // Primer clic: aun no hay I. Guardar este extremo como I pendiente.
  if (pendienteI === null) {
    return { tipo: "guardarI", i: extremoResuelto };
  }
  // Segundo clic: si coincide con I (por posicion, con TOL_NODO), viga degenerada.
  if (extremosCoinciden(pendienteI, extremoResuelto, modelo)) {
    return { tipo: "ignorar" };
  }
  // Viga valida: I -> J.
  return {
    tipo: "crearViga",
    datos: {
      plantaId,
      i: pendienteI,
      j: extremoResuelto,
      seccionId: defaults.seccionId,
      materialId: defaults.materialId,
      extremoI: defaults.extremoI,
      extremoJ: defaults.extremoJ,
      tirante: defaults.tirante,
    },
  };
}
