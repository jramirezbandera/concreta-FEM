import { createContext, useContext, type HTMLAttributes, type ReactNode } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";

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

// [D14 · PR3] Contexto de sección colapsable del dock. Un `DockSeccion` (Shell) lo provee
// alrededor de CADA panel del dock: el PanelFlotante interior lee este contexto y se pinta
// como sección colapsable (cabecera-trigger + cuerpo colapsable) SIN que el call site de
// cada panel cambie. `null` = no hay sección colapsable (uso glass o dock no colapsable).
export interface ConfigDockSeccion {
  abierta: boolean;
  onAbiertaChange: (abierta: boolean) => void;
}
const ContextoDockSeccion = createContext<ConfigDockSeccion | null>(null);

/** Envuelve UN panel del dock para hacerlo colapsable (el panel lee esto por contexto). */
export function ProveedorDockSeccion({
  config,
  children,
}: {
  config: ConfigDockSeccion;
  children: ReactNode;
}) {
  return (
    <ContextoDockSeccion.Provider value={config}>
      {children}
    </ContextoDockSeccion.Provider>
  );
}

export interface PanelFlotanteProps extends HTMLAttributes<HTMLDivElement> {
  /** Titulo de la cabecera. Si se omite, no se renderiza cabecera. */
  titulo?: ReactNode;
  /** Icono a la izquierda del titulo (acento). */
  icono?: ReactNode;
  /** Etiqueta mono a la derecha de la cabecera (p. ej. "V·nueva", "auto"). */
  tag?: ReactNode;
  /**
   * Semantica del tag. Por defecto es neutro (--text-3). "warning" lo tiñe de --warning:
   * lo usan los estados de AVISO (resultados obsoletos), donde el tag comunica un estado
   * que requiere atencion (Spec §1: --warning para avisos), no una simple etiqueta.
   */
  tagVariante?: "neutro" | "warning";
  children?: ReactNode;
}

export function PanelFlotante({
  titulo,
  icono,
  tag,
  tagVariante = "neutro",
  children,
  className,
  ...rest
}: PanelFlotanteProps) {
  const modo = useContext(ContextoModoPanel);
  // [D14 · PR3] Config de sección colapsable inyectada por DockSeccion (o null). Cuando el
  // panel se monta dentro de un DockSeccion en modo "plano", se pinta colapsable.
  const dockSeccion = useContext(ContextoDockSeccion);
  const colapsable = dockSeccion !== null && modo === "plano";
  const abierta = dockSeccion?.abierta ?? true;
  const onAbiertaChange = dockSeccion?.onAbiertaChange;
  // En "plano" el panel es una seccion del dock (sin cromo glass); en "glass" mantiene
  // .cx-float (vidrio + sombra). La clase del consumidor (className) se respeta en ambos
  // para que sus reglas propias (anchos, layout del cuerpo) sigan aplicando.
  const base = modo === "plano" ? "cx-dock-sec" : "cx-float";
  const clases = [base, className].filter(Boolean).join(" ");
  const claseCabecera = modo === "plano" ? "cx-dock-sec__head" : "cx-panel-head";
  const claseCuerpo = modo === "plano" ? "cx-dock-sec__body" : "cx-float__body";

  const tagEl =
    tag !== undefined ? (
      <span
        className={
          tagVariante === "warning"
            ? "cx-panel-head__tag cx-panel-head__tag--warning mono"
            : "cx-panel-head__tag mono"
        }
      >
        {tag}
      </span>
    ) : null;

  // [D14] Sección colapsable del dock: cabecera-trigger + cuerpo colapsable. Solo cuando
  // el panel está dentro de un DockSeccion (contexto) en modo "plano" y hay título (sin
  // cabecera no hay trigger). El chevron a la izquierda comunica el estado; el resto de la
  // cabecera (icono/título/tag) se conserva.
  if (colapsable && titulo !== undefined) {
    return (
      <Collapsible.Root
        className={clases}
        open={abierta}
        onOpenChange={(o) => onAbiertaChange?.(o)}
        {...rest}
      >
        <Collapsible.Trigger asChild>
          <button
            type="button"
            className={`${claseCabecera} cx-dock-sec__head--trigger`}
            data-state={abierta ? "open" : "closed"}
          >
            <span className="cx-dock-sec__chevron" aria-hidden="true">
              ▶
            </span>
            {icono && <span className="cx-panel-head__icon">{icono}</span>}
            <span className="cx-panel-head__title">{titulo}</span>
            {tagEl}
          </button>
        </Collapsible.Trigger>
        <Collapsible.Content className={claseCuerpo}>
          {children}
        </Collapsible.Content>
      </Collapsible.Root>
    );
  }

  return (
    <div className={clases} {...rest}>
      {titulo !== undefined && (
        <div className={claseCabecera}>
          {icono && <span className="cx-panel-head__icon">{icono}</span>}
          <span className="cx-panel-head__title">{titulo}</span>
          {tagEl}
        </div>
      )}
      <div className={claseCuerpo}>{children}</div>
    </div>
  );
}
