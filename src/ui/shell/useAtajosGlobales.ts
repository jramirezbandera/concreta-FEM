// Atajos de teclado globales (auditoria UX-A3/UX-A5 + D23). Cierra huecos: los diálogos
// de borrado PROMETIAN "Ctrl+Z" sin listener, las teclas F3/F4 del ToolsRail eran inertes
// por teclado, y faltaban Supr/Delete y el salto de pestaña con 1-4.
//
// Montado UNA vez en App. Atajos:
//   - Ctrl/Cmd+Z            -> deshacer()  (undo del modeloStore)
//   - Ctrl/Cmd+Y           -> rehacer()   (redo)
//   - Ctrl/Cmd+Shift+Z     -> rehacer()   (redo, convencion mac/editor)
//   - Supr / Delete         -> borrarSeleccion()  (MISMO flujo del menú Edición, D23)
//   - 1 / 2 / 3 / 4         -> setPestanaActiva(pilares/vigas/resultados/isovalores, D23)
//   - F4                   -> togglePanelPlantillas()  (panel de calco DXF)
//   - F3                   -> capturarViewport()       (captura PNG del lienzo)
//
// GUARDAS (para no pisar el comportamiento nativo del navegador):
//   - Si el foco esta en un campo de texto (input/textarea/select/[contenteditable]),
//     Ctrl+Z/Y debe seguir siendo el undo NATIVO del campo (no el de la obra); Supr borra
//     texto y 1-4 escriben dígitos. Todos esos atajos se ignoran con foco en campo.
//   - Si hay un dialogo modal abierto (vistaStore.dialogoActivo != null), tampoco se
//     interceptan: el dialogo tiene su propio flujo y sus campos su undo nativo.
// F3/F4 no llevan la guarda de campo (son acciones de lienzo, no de edicion de texto),
// pero SI respetan el dialogo abierto (no tiene sentido capturar/togglear con un modal).
import { useEffect } from "react";
import { modeloStore, vistaStore, type Pestana } from "../../estado";
import { capturarViewport } from "../viewport";
import { borrarSeleccion } from "./borrarSeleccion";

// Mapa tecla -> pestaña (D23). Orden CYPECAD de las 4 solapas inferiores: 1 Pilares,
// 2 Vigas, 3 Resultados, 4 Isovalores. Los identificadores en inglés técnico; las
// etiquetas visibles las pone la UI.
const PESTANA_POR_TECLA: Record<string, Pestana> = {
  "1": "entradaPilares",
  "2": "entradaVigas",
  "3": "resultados",
  "4": "isovalores",
};

// ¿El foco esta en un elemento donde el undo/redo del teclado debe ser el NATIVO del
// campo (edicion de texto), no el de la obra?
function focoEnCampoEditable(): boolean {
  const el = document.activeElement;
  if (el === null) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

export function useAtajosGlobales(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Con un dialogo modal abierto, la app no intercepta ningun atajo global: el
      // dialogo gobierna su propio teclado (Escape lo cierra; sus campos, su undo).
      if (vistaStore.getState().dialogoActivo !== null) return;

      const ctrl = e.ctrlKey || e.metaKey; // Cmd en mac
      const k = e.key.toLowerCase();

      if (ctrl && k === "z" && !e.shiftKey) {
        // Undo de la obra SOLO fuera de campos de texto (si no, pisaria el undo nativo).
        if (focoEnCampoEditable()) return;
        e.preventDefault();
        modeloStore.getState().deshacer();
        return;
      }
      if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) {
        if (focoEnCampoEditable()) return;
        e.preventDefault();
        modeloStore.getState().rehacer();
        return;
      }
      // Supr / Delete: borra la selección con el MISMO flujo del menú Edición (D23).
      // Sin modificadores y fuera de campos de texto (donde Delete borra caracteres).
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !ctrl &&
        !e.altKey &&
        !e.shiftKey
      ) {
        if (focoEnCampoEditable()) return;
        e.preventDefault();
        borrarSeleccion();
        return;
      }
      // 1-4 (sin modificador): salta a la pestaña correspondiente (D23). Fuera de campos
      // editables (donde el dígito debe escribirse) y de diálogos (guarda de arriba).
      const pestana = PESTANA_POR_TECLA[e.key];
      if (pestana !== undefined && !ctrl && !e.altKey && !e.shiftKey) {
        if (focoEnCampoEditable()) return;
        e.preventDefault();
        vistaStore.getState().setPestanaActiva(pestana);
        return;
      }
      // F4: panel de plantillas DXF. F3: captura PNG. Anunciadas en el ToolsRail; aqui
      // se cablean tambien por teclado (preventDefault para no disparar la ayuda del
      // navegador ligada a esas teclas de funcion).
      if (k === "f4" && !ctrl && !e.altKey) {
        e.preventDefault();
        vistaStore.getState().togglePanelPlantillas();
        return;
      }
      if (k === "f3" && !ctrl && !e.altKey) {
        e.preventDefault();
        capturarViewport();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
