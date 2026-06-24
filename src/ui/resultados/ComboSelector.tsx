import * as Select from "@radix-ui/react-select";
import { resultadosStore } from "../../estado/resultadosStore";
import { vistaStore } from "../../estado/vistaStore";
import { PanelFlotante } from "../primitivas";
import "./comboSelector.css";

// ComboSelector (feature-14, Tarea 2.3): selector de la COMBINACION activa de la
// pestana Resultados. Es un hudOverlay sobre el lienzo (panel flotante glass).
// Lee las combos calculadas de resultadosStore y la activa de vistaStore; al
// cambiar, actualiza vistaStore.setCombinacionActiva (estado de UI, no de obra,
// fuera de undo). Calca el patron Radix de SelectUso (Trigger asChild via clases,
// Portal, Content) y se estila solo con tokens (.cx-select*).
//
// VOCABULARIO (CLAUDE.md §2/§17): el VALUE de cada opcion es el nombre de combo
// del solver ("ELU"/"ELS") porque es lo que indexa los resultados; la ETIQUETA
// visible se enriquece a lenguaje de obra ("E.L.U. (resistencia)"). Sin jerga FEM.
//
// UNIDADES: no aplica (selector de etiquetas; no edita magnitudes).

// Etiqueta larga legible para los combos conocidos del MVP (generarCombos de
// feature-13 emite "ELU"/"ELS"). Para cualquier otro nombre futuro se muestra el
// propio nombre sin inventar copy. El value SIEMPRE es el nombre del solver.
function etiquetaCombo(nombre: string): string {
  switch (nombre) {
    case "ELU":
      return "E.L.U. (resistencia)";
    case "ELS":
      return "E.L.S. (servicio)";
    default:
      return nombre;
  }
}

export function ComboSelector() {
  // Lectura reactiva: las combos disponibles y la activa. El selector NO esta en el
  // bucle del viewport; un re-render al cambiar de combo es aceptable (#11).
  const resultados = resultadosStore((s) => s.resultados);
  const combinacionActiva = vistaStore((s) => s.combinacionActiva);
  const setCombinacionActiva = vistaStore((s) => s.setCombinacionActiva);

  // Sin resultados aun: no hay nada que seleccionar -> oculto (el BotonCalcular
  // guia al usuario; este panel solo tiene sentido con resultados disponibles).
  if (!resultados) return null;

  const combos = resultados.combos;
  // Valor mostrado: la activa si es valida; si no, la primera (coherente con la
  // inicializacion que hace useCalcular). Nunca dejamos el Select sin valor.
  const valor =
    combinacionActiva !== null && combos.includes(combinacionActiva)
      ? combinacionActiva
      : combos[0];

  return (
    <PanelFlotante className="cx-combo" titulo="Combinación" tag="resultados">
      <Select.Root value={valor} onValueChange={setCombinacionActiva}>
        <Select.Trigger className="cx-select cx-combo__trigger" aria-label="Combinación activa">
          <Select.Value />
          <Select.Icon className="cx-select__icon">▾</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="cx-select-content" position="popper" sideOffset={4}>
            <Select.Viewport className="cx-select-viewport">
              {combos.map((nombre) => (
                <Select.Item key={nombre} value={nombre} className="cx-select-item">
                  <Select.ItemText>{etiquetaCombo(nombre)}</Select.ItemText>
                  <Select.ItemIndicator className="cx-select-item__check">
                    ✓
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </PanelFlotante>
  );
}
