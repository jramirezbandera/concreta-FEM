import { useState, type ReactNode } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";

// SeccionColapsable (D14 · PR3): sección con cabecera-trigger + contenido colapsable,
// sobre Radix Collapsible (accesible: el trigger es un <button> con aria-expanded y
// data-state; el contenido se anuncia/oculta). Reemplaza los `Seccion` locales duplicados
// del Sidebar y del dock (DRY). Respeta prefers-reduced-motion vía CSS (sin animación de
// altura si el usuario la desactiva).
//
// CONTROL: soporta uso NO controlado (defaultAbierta, estado interno — Sidebar) y
// CONTROLADO (abierta + onAbiertaChange — el dock, que persiste el colapso por sección/
// pestaña en DockUIState). Si se pasa `abierta`, manda el llamante; si no, estado local.
//
// LENGUAJE: etiquetas de UI en español con tildes; API en inglés/dominio (CLAUDE.md §9).

export interface SeccionColapsableProps {
  /** Título de la cabecera-trigger (español con tildes). */
  titulo: ReactNode;
  /** Contenido colapsable. */
  children: ReactNode;
  /** Estado inicial en modo NO controlado. Ignorado si se pasa `abierta`. */
  defaultAbierta?: boolean;
  /** Estado en modo CONTROLADO (el llamante lo gobierna, p. ej. desde un store). */
  abierta?: boolean;
  /** Cambio de estado en modo controlado (o notificación en el no controlado). */
  onAbiertaChange?: (abierta: boolean) => void;
  /** Clase extra para el contenedor raíz. */
  className?: string;
  /** Accesorio a la derecha de la cabecera (p. ej. un contador o tag). */
  accesorio?: ReactNode;
}

export function SeccionColapsable({
  titulo,
  children,
  defaultAbierta = true,
  abierta,
  onAbiertaChange,
  className,
  accesorio,
}: SeccionColapsableProps) {
  // Modo no controlado: estado local sembrado con defaultAbierta. En modo controlado
  // (abierta !== undefined) este estado no se usa (Radix respeta `open`).
  const [abiertaLocal, setAbiertaLocal] = useState(defaultAbierta);
  const controlada = abierta !== undefined;
  const estaAbierta = controlada ? abierta : abiertaLocal;

  const onOpenChange = (o: boolean) => {
    if (!controlada) setAbiertaLocal(o);
    onAbiertaChange?.(o);
  };

  const clases = ["cx-colapsable", className].filter(Boolean).join(" ");

  return (
    <Collapsible.Root
      className={clases}
      open={estaAbierta}
      onOpenChange={onOpenChange}
    >
      <Collapsible.Trigger asChild>
        <button
          type="button"
          className="cx-colapsable__head caps"
          data-state={estaAbierta ? "open" : "closed"}
        >
          <span className="cx-colapsable__chevron" aria-hidden="true">
            ▶
          </span>
          <span className="cx-colapsable__title">{titulo}</span>
          {accesorio != null && (
            <span className="cx-colapsable__accesorio">{accesorio}</span>
          )}
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="cx-colapsable__body">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
