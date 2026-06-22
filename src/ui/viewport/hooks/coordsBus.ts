// coordsBus: canal ligero entre la escena R3F (dentro del Canvas) y la barra de
// estado (HTML, fuera del Canvas) para las coordenadas vivas del cursor sobre el
// plano del lienzo. Mismo patron que zoomBus: un Set de oyentes + emitir/
// suscribir, sin meter las coords en estado React.
//
// REGLA #11 (CLAUDE.md / feature-9): nada de setState por frame ni por evento de
// puntero. La escena calcula la interseccion cursor->plano en onPointerMove y la
// EMITE por aqui; el consumidor (shell) se suscribe y throttlea con rAF antes de
// renderizar. El bus en si no programa ningun re-render.
export interface Coords {
  x: number;
  y: number;
}
type Oyente = (coords: Coords) => void;

const oyentes = new Set<Oyente>();

// Ultima coordenada emitida, para que un consumidor que se suscriba tarde tenga
// un snapshot inicial coherente (getSnapshot de useSyncExternalStore / estado
// inicial de un hook con throttle).
let ultima: Coords | null = null;

export function emitirCoords(coords: Coords): void {
  ultima = coords;
  for (const o of oyentes) o(coords);
}

export function suscribirCoords(o: Oyente): () => void {
  oyentes.add(o);
  return () => {
    oyentes.delete(o);
  };
}

export function leerCoords(): Coords | null {
  return ultima;
}
