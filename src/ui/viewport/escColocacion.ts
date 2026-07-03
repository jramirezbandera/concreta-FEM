// escColocacion (UX-C11): predicado PURO que decide si el listener global de Esc de
// una herramienta de introduccion (ColocacionPilar/Viga/Pano) debe IGNORAR el evento.
//
// El problema: las tres herramientas escuchan Escape en `window` para cancelar el
// punto pendiente o salir de la herramienta. Pero ese mismo Esc lo usan tambien los
// dialogos (Radix cierra con Esc) y los campos que revierten su edicion. Sin coordinar,
// cerrar un dialogo con Esc tambien cancelaba la colocacion o sacaba de la herramienta.
//
// Regla: se ignora el Esc si YA fue consumido por otro handler (defaultPrevented: un
// campo que revierte hace preventDefault) o si hay un dialogo abierto (dialogoActivo).
// PURO (sin React ni stores): recibe las dos senales por parametro; se testea en Node.
export function debeIgnorarEscColocacion(
  defaultPrevented: boolean,
  dialogoActivo: unknown,
): boolean {
  return defaultPrevented || dialogoActivo !== null;
}
