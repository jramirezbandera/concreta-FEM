import { createContext, useContext, type HTMLAttributes, type ReactNode } from "react";

// Panel "envoltura" reutilizado por TODOS los paneles de la app (inspector,
// herramienta, reacciones, diagramas, plantillas, CM/CR, modelo de cálculo…). Tiene
// DOS cromos segun el contexto donde se monte (refactor "dock de paneles", PR2):
//
//  - "glass" (def.): vidrio sobre el lienzo (Spec Diseño UI §4.2 / §5: .cx-float),
//    con --glass + --shadow-float + borde redondeado de tarjeta. Lo usan los CONTROLES
//    DE LIENZO (LeyendaEscala y el Hud persistente: ribbon, modo, zoom).
//  - "plano": seccion plana dentro del DOCK (sin sombra, sin borde-tarjeta, sin glass).
//    Cabecera al estilo de las secciones del Sidebar + filete --border inferior. Hace
//    que el dock se lea como UN panel con secciones, no como una pila de tarjetas.
//
// El cromo NO se elige por prop en cada call site (serian 8 ediciones): se hereda por
// CONTEXTO. El dock envuelve sus hijos en <ProveedorModoPanel modo="plano">; fuera del
// dock el valor por defecto "glass" mantiene el comportamiento previo intacto. Asi
// ningun componente de panel cambia: responden al contexto donde se montan.

export type ModoPanel = "glass" | "plano";

const ContextoModoPanel = createContext<ModoPanel>("glass");

/** Fija el cromo de los PanelFlotante descendientes. El dock provee "plano". */
export function ProveedorModoPanel({
  modo,
  children,
}: {
  modo: ModoPanel;
  children: ReactNode;
}) {
  return (
    <ContextoModoPanel.Provider value={modo}>{children}</ContextoModoPanel.Provider>
  );
}

export interface PanelFlotanteProps extends HTMLAttributes<HTMLDivElement> {
  /** Titulo de la cabecera. Si se omite, no se renderiza cabecera. */
  titulo?: ReactNode;
  /** Icono a la izquierda del titulo (acento). */
  icono?: ReactNode;
  /** Etiqueta mono a la derecha de la cabecera (p. ej. "V·nueva", "auto"). */
  tag?: ReactNode;
  children?: ReactNode;
}

export function PanelFlotante({
  titulo,
  icono,
  tag,
  children,
  className,
  ...rest
}: PanelFlotanteProps) {
  const modo = useContext(ContextoModoPanel);
  // En "plano" el panel es una seccion del dock (sin cromo glass); en "glass" mantiene
  // .cx-float (vidrio + sombra). La clase del consumidor (className) se respeta en ambos
  // para que sus reglas propias (anchos, layout del cuerpo) sigan aplicando.
  const base = modo === "plano" ? "cx-dock-sec" : "cx-float";
  const clases = [base, className].filter(Boolean).join(" ");
  const claseCabecera = modo === "plano" ? "cx-dock-sec__head" : "cx-panel-head";
  const claseCuerpo = modo === "plano" ? "cx-dock-sec__body" : "cx-float__body";
  return (
    <div className={clases} {...rest}>
      {titulo !== undefined && (
        <div className={claseCabecera}>
          {icono && <span className="cx-panel-head__icon">{icono}</span>}
          <span className="cx-panel-head__title">{titulo}</span>
          {tag !== undefined && <span className="cx-panel-head__tag mono">{tag}</span>}
        </div>
      )}
      <div className={claseCuerpo}>{children}</div>
    </div>
  );
}
