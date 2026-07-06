// PopoverRejilla (UX-2.1): boton DIVIDIDO de la rejilla en el ToolsRail. El boton
// principal conmuta la visibilidad (comportamiento de siempre); la pestanita
// inferior abre un popover con el PASO de la rejilla — un unico paso compartido por
// el dibujo y el snap (dibujar a 0.5 y snapear a otro paso seria una trampa).
// Radix Popover portado a body (z --z-popover via .cx-menu-content, mismo patron
// que los menus).
import { useSyncExternalStore } from "react";
import * as Popover from "@radix-ui/react-popover";
import { vistaStore } from "../../estado";
import { CampoNumero } from "../primitivas";

// Pasos habituales de replanteo (m). El campo libre cubre cualquier otro.
const PASOS = [0.1, 0.25, 0.5, 1];

function useRejillaVisible(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.rejillaVisible, cb),
    () => vistaStore.getState().rejillaVisible,
    () => vistaStore.getState().rejillaVisible,
  );
}

function usePasoRejilla(): number {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.pasoRejilla, cb),
    () => vistaStore.getState().pasoRejilla,
    () => vistaStore.getState().pasoRejilla,
  );
}

function formatearPaso(paso: number): string {
  // Sin ceros de cola artificiales: 0.5 -> "0.50 m" es ruido en un chip.
  return `${paso} m`;
}

export function PopoverRejilla() {
  const visible = useRejillaVisible();
  const paso = usePasoRejilla();

  return (
    <div className="cx-split">
      <button
        type="button"
        className="cx-iconbtn"
        title="Rejilla"
        aria-label="Rejilla"
        aria-pressed={visible}
        data-activo={visible ? "true" : undefined}
        onClick={() => vistaStore.getState().toggleRejilla()}
      >
        ▤
      </button>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="cx-iconbtn cx-iconbtn--mini"
            title={`Paso de rejilla: ${formatearPaso(paso)}`}
            aria-label="Configurar el paso de la rejilla"
          >
            ▾
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="cx-menu-content cx-popover-rejilla"
            side="left"
            align="start"
            sideOffset={8}
          >
            <div className="cx-popover-rejilla__titulo caps">Paso de rejilla</div>
            <div
              className="cx-popover-rejilla__chips"
              role="group"
              aria-label="Pasos habituales"
            >
              {PASOS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="cx-chip mono"
                  data-activo={Math.abs(p - paso) < 1e-9 ? "true" : undefined}
                  onClick={() => vistaStore.getState().setPasoRejilla(p)}
                >
                  {formatearPaso(p)}
                </button>
              ))}
            </div>
            <CampoNumero
              etiqueta="Otro paso"
              sufijo="m"
              valor={paso}
              onCommit={(v) => {
                // El setter ya ignora valores no finitos o <= 0 (guard del store).
                vistaStore.getState().setPasoRejilla(v);
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
