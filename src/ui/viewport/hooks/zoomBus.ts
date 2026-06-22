// zoomBus: canal ligero entre el HUD (HTML, fuera del Canvas) y la escena R3F
// (dentro del Canvas) para los botones de zoom +/-. El HUD no tiene acceso directo
// a la camara; en lugar de elevar la camara a estado React (que la metaria en el
// ciclo de render), emitimos un evento y un componente interno lo aplica mutando
// la camara via useThree + invalidate(). Mantiene la regla #11 (sin setState por
// frame, sin camara en estado reactivo).
type ZoomDir = "in" | "out";
type Oyente = (dir: ZoomDir) => void;

const oyentes = new Set<Oyente>();

export function emitirZoom(dir: ZoomDir): void {
  for (const o of oyentes) o(dir);
}

export function suscribirZoom(o: Oyente): () => void {
  oyentes.add(o);
  return () => {
    oyentes.delete(o);
  };
}
