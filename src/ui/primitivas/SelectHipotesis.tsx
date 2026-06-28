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

  // E2(b): la hipotesis AUTOMATICA (peso propio) NO es asignable como ambito de una
  // carga de usuario (seria doble computo: el discretizador ya genera ese peso). Se
  // OCULTA del selector (invariante de dominio reforzado en la UI). El comando
  // crearCarga/editarCarga ya la rechaza como red ultima.
  const asignables = hipotesis.filter((h) => !h.automatica);

  // FIX#2: el `valor` actual puede apuntar a una hipotesis que NO esta entre las
  // ASIGNABLES (p. ej. una carga importada/heredada que cuelga de la automatica:
  // pasa el Zod y solo se bloquea al calcular). Si Radix recibe un value que no
  // coincide con ningun Item renderizado, muestra el PLACEHOLDER y oculta la
  // asignacion incorrecta. Para que el usuario VEA el valor real, anadimos un item
  // extra —deshabilitado y marcado— con la hipotesis referida cuando no este ya en
  // la lista asignable. Si el id no existe en ninguna hipotesis de la obra, se
  // muestra "(hipótesis desconocida)" en vez de quedar en blanco.
  const referidaNoAsignable =
    valor !== null && !asignables.some((h) => h.id === valor) ? valor : null;
  const hipotesisReferida =
    referidaNoAsignable !== null
      ? hipotesis.find((h) => h.id === referidaNoAsignable)
      : undefined;

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
            {asignables.map((h) => (
              <Select.Item key={h.id} value={h.id} className="cx-select-item">
                <Select.ItemText>{h.nombre}</Select.ItemText>
                <Select.ItemIndicator className="cx-select-item__check">
                  ✓
                </Select.ItemIndicator>
              </Select.Item>
            ))}
            {/* FIX#2: item solo-lectura del valor actual cuando no es asignable, para
                que el Select muestre la asignacion real en vez del placeholder. Se
                renderiza `disabled`: visible pero no re-seleccionable. */}
            {referidaNoAsignable !== null ? (
              <Select.Item
                key={referidaNoAsignable}
                value={referidaNoAsignable}
                disabled
                className="cx-select-item"
              >
                <Select.ItemText>
                  {hipotesisReferida
                    ? `${hipotesisReferida.nombre} (no asignable)`
                    : "(hipótesis desconocida)"}
                </Select.ItemText>
              </Select.Item>
            ) : null}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
