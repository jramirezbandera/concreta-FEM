import * as Select from "@radix-ui/react-select";
import { modeloStore } from "../../estado";

// SelectHipotesis (feature-13, T3.1): selector de la hipotesis de una carga. Las
// opciones son las hipotesis de la OBRA (`modelo.hipotesis`, Capa 1): el modelo
// vacio ya siembra "Cargas muertas" y "Sobrecarga de uso", y el usuario anade mas
// desde el DialogoHipotesis. Cambian con la obra, asi que se leen con una
// suscripcion LIGERA al modeloStore (selector sobre `subscribeWithSelector`):
// re-render SOLO cuando la referencia del array cambia (Immer la preserva si no se
// tocan las hipotesis), nunca por frame (regla de oro del viewport, #11). Espejo
// EXACTO de SelectMaterial/SelectSeccion. El `value` de cada item es el `id`; la
// etiqueta visible es el `nombre` legible de la hipotesis. Reusa las clases
// .cx-select* para identico look CAD.
export interface SelectHipotesisProps {
  // `null` => placeholder "Hipótesis…" (carga sin hipotesis asignada todavia).
  valor: string | null;
  onCambio: (id: string) => void;
  etiqueta?: string;
}

export function SelectHipotesis({ valor, onCambio, etiqueta }: SelectHipotesisProps) {
  // Suscripcion ligera: re-render solo si cambia la referencia del array de
  // hipotesis de la obra. No entra en el bucle de render del viewport.
  const hipotesis = modeloStore((s) => s.modelo.hipotesis);

  return (
    <Select.Root
      // Radix usa "" como "sin valor" para mostrar el placeholder; nuestro contrato
      // es `null`, asi que mapeamos null -> undefined (controlado sin seleccion).
      value={valor ?? undefined}
      onValueChange={(v) => onCambio(v)}
    >
      <Select.Trigger className="cx-select" aria-label={etiqueta ?? "Hipótesis"}>
        <Select.Value placeholder="Hipótesis…" />
        <Select.Icon className="cx-select__icon">▾</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="cx-select-content" position="popper" sideOffset={4}>
          <Select.Viewport className="cx-select-viewport">
            {hipotesis.map((h) => (
              <Select.Item key={h.id} value={h.id} className="cx-select-item">
                <Select.ItemText>{h.nombre}</Select.ItemText>
                <Select.ItemIndicator className="cx-select-item__check">
                  ✓
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
