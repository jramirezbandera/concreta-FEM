// encuadreBus: canal ligero HUD (HTML, fuera del Canvas) -> escena R3F para el boton
// "Encuadrar" (ajustar la camara 3D al edificio completo). Mismo patron que zoomBus:
// el HUD no tiene la camara; emite y AjusteCamara3D (dentro del Canvas) la reposiciona
// via useThree + invalidate(), sin meter la camara en estado React (regla #11).
type Oyente = () => void;

const oyentes = new Set<Oyente>();

export function emitirEncuadre(): void {
  for (const o of oyentes) o();
}

export function suscribirEncuadre(o: Oyente): () => void {
  oyentes.add(o);
  return () => {
    oyentes.delete(o);
  };
}
