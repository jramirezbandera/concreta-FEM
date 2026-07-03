// borrarSeleccion: helper compartido para borrar el elemento seleccionado de la obra.
// [D23] Extraido de Menubar.tsx para que el menú "Edición" y el atajo Supr/Delete usen
// EXACTAMENTE el mismo flujo (misma confirmación en cascada del comando eliminar*), sin
// duplicar la lógica. No es un componente ni un hook: función plana que habla con los
// stores/servicios (igual que calcularObra()).
//
// Los elementos borrables son pilar, viga y PAÑO (F3): se exige EXACTAMENTE uno
// seleccionado y que sea uno de esos tipos del modelo. Se lee el modelo con getModelo()
// JUSTO antes de construir el comando (invariante del `base`, CLAUDE.md §10). Si no
// aplica, no-op silencioso. Los comandos eliminar* ya gestionan la cascada (cargas,
// nudos huérfanos…) en un único paso de undo.
import {
  modeloStore,
  seleccionStore,
  eliminarPilar,
  eliminarViga,
  eliminarPano,
} from "../../estado";

export function borrarSeleccion(): void {
  const ids = seleccionStore.getState().seleccion;
  if (ids.length !== 1) return;
  const base = modeloStore.getState().getModelo();
  const id = ids[0]!;
  if (base.pilares.some((p) => p.id === id)) {
    modeloStore.getState().ejecutar(eliminarPilar(base, id));
  } else if (base.vigas.some((v) => v.id === id)) {
    modeloStore.getState().ejecutar(eliminarViga(base, id));
  } else if (base.panos.some((pa) => pa.id === id)) {
    modeloStore.getState().ejecutar(eliminarPano(base, id));
  } else {
    return;
  }
  seleccionStore.getState().limpiar();
}
