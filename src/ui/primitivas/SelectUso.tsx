import * as Select from "@radix-ui/react-select";
import type { CategoriaUso } from "../../dominio";

// SelectUso (Spec Diseno UI §5): selector de la categoria de uso (CTE DB-SE-AE /
// Codigo Estructural) de un grupo de plantas. Radix Select accesible, estilado
// solo con tokens via .cx-select*. Etiquetas en espanol con tildes; el valor de
// dominio es la letra A-G. Calca el patron Radix de Menubar (Trigger asChild,
// Portal, Content).

// Etiquetas legibles por categoria. El orden del array define el orden visual.
const OPCIONES: ReadonlyArray<{ valor: CategoriaUso; etiqueta: string }> = [
  { valor: "A", etiqueta: "A · Zonas residenciales" },
  { valor: "B", etiqueta: "B · Zonas administrativas" },
  { valor: "C", etiqueta: "C · Zonas de pública concurrencia" },
  { valor: "D", etiqueta: "D · Zonas comerciales" },
  { valor: "E", etiqueta: "E · Zonas de tráfico y aparcamiento (ligeros)" },
  { valor: "F", etiqueta: "F · Cubiertas transitables" },
  { valor: "G", etiqueta: "G · Cubiertas accesibles solo para conservación" },
];

export interface SelectUsoProps {
  valor: CategoriaUso;
  onCambio: (v: CategoriaUso) => void;
  etiqueta?: string;
}

export function SelectUso({ valor, onCambio, etiqueta }: SelectUsoProps) {
  return (
    <Select.Root value={valor} onValueChange={(v) => onCambio(v as CategoriaUso)}>
      <Select.Trigger
        className="cx-select"
        aria-label={etiqueta ?? "Categoría de uso"}
      >
        <Select.Value />
        <Select.Icon className="cx-select__icon">▾</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="cx-select-content" position="popper" sideOffset={4}>
          <Select.Viewport className="cx-select-viewport">
            {OPCIONES.map((op) => (
              <Select.Item key={op.valor} value={op.valor} className="cx-select-item">
                <Select.ItemText>{op.etiqueta}</Select.ItemText>
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
