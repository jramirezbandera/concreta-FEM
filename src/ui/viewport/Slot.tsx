// Mecanismo de slots del HUD (feature-17, Tarea 1.1). Permite que paneles glass de
// ORIGENES distintos (el HUD persistente `Hud.tsx` + los overlays inyectados por
// `App.tsx` via `hudOverlays`) se APILEN en columna dentro de una misma zona en vez
// de solaparse en la misma esquina. Cada `Slot` porta (createPortal) sus hijos al
// contenedor de su zona; ese contenedor (.cx-zone, flex-column) lo monta Viewport y
// lo publica por contexto. Sin esto, dos <div> absolutos en la misma esquina vuelven
// a taparse (motivo del refactor: hallazgo nº1 de /design-review F16).
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Las 8 zonas del HUD (Spec Diseno UI §4.2). F17 usa 7 (mid-left queda reservada).
export type ZonaHud =
  | "top-left"
  | "top-center"
  | "top-right"
  | "mid-left"
  | "mid-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

// Contenedores de zona publicados por Viewport. Cada valor es el <div.cx-zone--*>
// donde los Slot de esa zona portan sus hijos. Es `null` hasta que la capa HUD se
// monta (primer render): Slot tolera el target null y no pinta nada hasta tenerlo.
export type ContenedoresHud = Readonly<Partial<Record<ZonaHud, HTMLDivElement | null>>>;

const ContextoHud = createContext<ContenedoresHud>({});

/** Provee los contenedores de zona a los `Slot` descendientes. Lo monta Viewport. */
export function ProveedorHud({
  contenedores,
  children,
}: {
  contenedores: ContenedoresHud;
  children: ReactNode;
}) {
  return <ContextoHud.Provider value={contenedores}>{children}</ContextoHud.Provider>;
}

export interface SlotProps {
  /** Zona del HUD a la que se portan los hijos. */
  zona: ZonaHud;
  children?: ReactNode;
}

/**
 * Porta sus hijos al contenedor de la zona pedida (apilado en columna por CSS).
 * Tolera el primer render sin contenedor (target null): el contexto re-renderiza al
 * montarse la capa HUD y entonces el portal aparece.
 */
export function Slot({ zona, children }: SlotProps) {
  const contenedores = useContext(ContextoHud);
  const destino = contenedores[zona] ?? null;
  if (!destino) return null;
  return createPortal(children, destino);
}
