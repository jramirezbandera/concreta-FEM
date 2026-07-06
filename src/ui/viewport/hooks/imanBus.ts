// imanBus: canal ligero del ENGANCHE del iman hacia la barra de estado (UX-2.2,
// D8b). Hermano de coordsBus/cotaBus: la herramienta de colocacion emite en el mismo
// onPointerMove que ya mueve el marcador (sin setState); App materializa el ultimo
// valor con throttle rAF y la StatusBar rotula "Pilar P3" / "Extremo de V2".
//
// DEDUP EN EL BUS: el move emite decenas de veces por segundo pero el enganche
// cambia pocas veces; se descartan las emisiones con la misma etiqueta para que el
// oyente (setState de App) solo trabaje al cambiar de enganche real.
type Oyente = (etiqueta: string | null) => void;

const oyentes = new Set<Oyente>();

let ultima: string | null = null;

// Emite la etiqueta del enganche actual (o null si el cursor no engancha a obra).
export function emitirEnganche(etiqueta: string | null): void {
  if (etiqueta === ultima) return;
  ultima = etiqueta;
  for (const o of oyentes) o(etiqueta);
}

// Limpia el enganche (al salir de la herramienta): oculta el segmento de la barra.
export function limpiarEnganche(): void {
  emitirEnganche(null);
}

export function suscribirEnganche(o: Oyente): () => void {
  oyentes.add(o);
  return () => {
    oyentes.delete(o);
  };
}

export function leerEnganche(): string | null {
  return ultima;
}
