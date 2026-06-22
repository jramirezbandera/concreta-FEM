import * as Select from "@radix-ui/react-select";
import { listarMateriales } from "../../biblioteca";

// SelectMaterial (feature-11, T3.1): selector del material de un pilar. Opciones =
// catalogo de materiales de la biblioteca (`listarMateriales()`); la etiqueta
// visible es la `denominacion` (p.ej. "S275", "HA-25") y el `value` es el `id`
// ASCII referenciado por `materialId` en el dominio. Calca el patron Radix de
// SelectUso (Trigger asChild via .cx-select, Portal, Content) y reusa las clases
// .cx-select* para identico look CAD. El catalogo es inmutable: se lista una vez.
const OPCIONES = listarMateriales();

export interface SelectMaterialProps {
  // `null` => placeholder "Material…" (pilar sin material asignado todavia).
  valor: string | null;
  onCambio: (id: string) => void;
  etiqueta?: string;
}

export function SelectMaterial({ valor, onCambio, etiqueta }: SelectMaterialProps) {
  return (
    <Select.Root
      // Radix usa "" como "sin valor" para mostrar el placeholder; nuestro contrato
      // es `null`, asi que mapeamos null -> undefined (controlado sin seleccion).
      value={valor ?? undefined}
      onValueChange={(v) => onCambio(v)}
    >
      <Select.Trigger className="cx-select" aria-label={etiqueta ?? "Material"}>
        <Select.Value placeholder="Material…" />
        <Select.Icon className="cx-select__icon">▾</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="cx-select-content" position="popper" sideOffset={4}>
          <Select.Viewport className="cx-select-viewport">
            {OPCIONES.map((m) => (
              <Select.Item key={m.id} value={m.id} className="cx-select-item">
                <Select.ItemText>{m.denominacion}</Select.ItemText>
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
