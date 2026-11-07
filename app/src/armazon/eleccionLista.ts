/**
 * Elegir en una lista con el ratón, como en el explorador de archivos:
 * - clic: sólo ése (y pasa a ser el ancla);
 * - Ctrl+clic: lo añade o lo quita (y pasa a ser el ancla);
 * - Mayús+clic: del ancla a ése, en el orden de la lista, en lugar de lo elegido;
 * - Ctrl+Mayús+clic: ese rango, además de lo elegido.
 * Sin ancla en la lista, Mayús hace de clic (o de Ctrl+clic con Ctrl).
 */
export function eleccionLista(
  lista: readonly string[],
  elegidos: readonly string[],
  ancla: string | null,
  id: string,
  teclas: { ctrl: boolean; mayus: boolean },
): { elegidos: string[]; ancla: string } {
  const i = lista.indexOf(id);
  const a = ancla === null ? -1 : lista.indexOf(ancla);
  if (teclas.mayus && i >= 0 && a >= 0) {
    const rango = lista.slice(Math.min(a, i), Math.max(a, i) + 1);
    if (!teclas.ctrl) return { elegidos: rango, ancla: ancla! };
    const ya = new Set(elegidos);
    return { elegidos: [...elegidos, ...rango.filter((x) => !ya.has(x))], ancla: ancla! };
  }
  if (teclas.ctrl) return { elegidos: elegidos.includes(id) ? elegidos.filter((x) => x !== id) : [...elegidos, id], ancla: id };
  return { elegidos: [id], ancla: id };
}
