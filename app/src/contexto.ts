/**
 * Lo que comparten los espacios de trabajo (interfaz v4, `docs/fem3d/interfaz.md` §4): el proyecto
 * abierto, el espacio y el modo de resultados, la planta y el objeto elegidos.
 */
import { createContext, useContext } from "react";
import type { NombreTabla } from "../../src/editor/tablas.ts";
import type { ProyectoAbierto } from "./sesion/useProyecto.ts";

export type Espacio = "modelo" | "cargas" | "resultados" | "revision";

/** Los modos de Resultados: lo que eran las pantallas Losas, Vigas, Pilares y Desplomes de V1. */
export type ModoResultados = "losas" | "diagramas" | "pilares" | "deformada" | "reacciones";

export interface Visor {
  proyecto: ProyectoAbierto;
  planta: string | null;
  setPlanta: (p: string) => void;
  /**
   * Objeto físico elegido principal (pilar, viga, losa…): el último de `elegidos`, el del inspector.
   * Se conserva entre espacios y al recargar si sigue existiendo.
   */
  seleccion: string | null;
  /** Elegir uno (abre las propiedades del espacio si estaban plegadas); null suelta todo. */
  setSeleccion: (id: string | null) => void;
  /** I2: todo lo elegido, en el orden en que se eligió (en todas las vistas, el navegador y la tabla). */
  elegidos: string[];
  setElegidos: (ids: string[]) => void;
  espacio: Espacio;
  modo: ModoResultados;
  /** Ir a un espacio (y, en Resultados, a un modo). */
  irA: (e: Espacio, m?: ModoResultados) => void;
  /** Una tabla que se pide desde fuera de Modelo (la paleta); `n` cambia con cada pedido. */
  tablaPedida: { tabla: NombreTabla; n: number } | null;
  pedirTabla: (t: NombreTabla) => void;
}

export const ContextoVisor = createContext<Visor | null>(null);

export function useVisor(): Visor {
  const v = useContext(ContextoVisor);
  if (!v) throw new Error("useVisor fuera de <ContextoVisor>");
  return v;
}
