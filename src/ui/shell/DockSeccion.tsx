import { useSyncExternalStore, type ReactNode } from "react";
import { ProveedorDockSeccion } from "../primitivas";
import { vistaStore, claveSeccionDock, type Pestana } from "../../estado";

// DockSeccion (D14 · PR3): envuelve UN panel del dock para hacerlo COLAPSABLE, cableando
// su estado a DockUIState (colapso por sección y pestaña, transitorio, fuera de undo). El
// PanelFlotante interior del panel lee la config por CONTEXTO (ProveedorDockSeccion) y se
// pinta como sección colapsable, sin que el call site de cada panel cambie.
//
// El `seccion` es una etiqueta estable en inglés técnico (p. ej. "reacciones"); la cabecera
// visible la pone el propio panel (español con tildes). El estado por defecto es ABIERTA
// (ausencia de clave en seccionesColapsadas).

export interface DockSeccionProps {
  /** Pestaña a la que pertenece la sección (el colapso es por pestaña). */
  pestana: Pestana;
  /** Identificador estable de la sección (inglés técnico). */
  seccion: string;
  /** El panel a envolver (un único PanelFlotante). */
  children: ReactNode;
}

// Suscripción fina al colapso de ESTA sección (no re-renderiza por otros cambios del dock).
function useSeccionColapsada(pestana: Pestana, seccion: string): boolean {
  const clave = claveSeccionDock(pestana, seccion);
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.dockUI.seccionesColapsadas[clave], cb),
    () => vistaStore.getState().dockUI.seccionesColapsadas[clave] === true,
    () => false,
  );
}

export function DockSeccion({ pestana, seccion, children }: DockSeccionProps) {
  const colapsada = useSeccionColapsada(pestana, seccion);
  return (
    <ProveedorDockSeccion
      config={{
        abierta: !colapsada,
        onAbiertaChange: (abierta) =>
          vistaStore.getState().setSeccionDockColapsada(pestana, seccion, !abierta),
      }}
    >
      {children}
    </ProveedorDockSeccion>
  );
}
