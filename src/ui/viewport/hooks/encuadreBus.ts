// encuadreBus: canal ligero HUD/Sidebar (HTML, fuera del Canvas) -> escena R3F para
// "Encuadrar". Mismo patron que zoomBus: el HTML no tiene la camara; emite y el
// Ajuste* activo (AjusteCamara3D / AjusteCamaraAlzado / AjusteCamaraPlanta, dentro
// del Canvas) la reposiciona via useThree + invalidate(), sin meter la camara en
// estado React (regla #11).
//
// PAYLOAD (UX-3.2): sin argumento = encuadrar el EDIFICIO completo (boton
// "Encuadrar", comportamiento historico); { objetivo: "elemento", id } = encuadrar
// UN elemento de obra (doble clic en el arbol del Sidebar).
export type ObjetivoEncuadre =
  | { objetivo: "edificio" }
  | { objetivo: "elemento"; id: string };

const EDIFICIO: ObjetivoEncuadre = { objetivo: "edificio" };

type Oyente = (obj: ObjetivoEncuadre) => void;

const oyentes = new Set<Oyente>();

export function emitirEncuadre(obj: ObjetivoEncuadre = EDIFICIO): void {
  for (const o of oyentes) o(obj);
}

export function suscribirEncuadre(o: Oyente): () => void {
  oyentes.add(o);
  return () => {
    oyentes.delete(o);
  };
}
