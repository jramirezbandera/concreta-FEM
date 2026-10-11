/** Lo que comparten las pantallas: el proyecto abierto, la planta y el objeto elegidos. */
import { createContext, useContext } from "react";
import type { ProyectoAbierto } from "./sesion/useProyecto.ts";

export type Pantalla = "modelo" | "losas" | "vigas" | "pilares" | "desplomes" | "revision";

export interface Visor {
  proyecto: ProyectoAbierto;
  planta: string | null;
  setPlanta: (p: string) => void;
  /** Objeto físico elegido (pilar, viga, losa…), que se conserva entre pantallas y al recargar si sigue existiendo. */
  seleccion: string | null;
  setSeleccion: (id: string | null) => void;
  irA: (p: Pantalla) => void;
}

export const ContextoVisor = createContext<Visor | null>(null);

export function useVisor(): Visor {
  const v = useContext(ContextoVisor);
  if (!v) throw new Error("useVisor fuera de <ContextoVisor>");
  return v;
}
