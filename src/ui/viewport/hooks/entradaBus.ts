// entradaBus: canal ligero de la barra de coordenadas (EntradaNumericaOverlay,
// fuera del Canvas) hacia la herramienta de colocacion ACTIVA (dentro del Canvas),
// UX-2.5. Hermano de avisoBus: un Set de oyentes + emitir, sin estado React
// compartido. El overlay parsea y emite la ExprNumerica ya validada; la herramienta
// suscrita la resuelve contra SU punto pendiente y la confirma por el MISMO
// pipeline del clic. Solo hay una Colocacion montada a la vez (gating por
// herramienta/pestana), asi que no hay doble consumo.
import type { ExprNumerica } from "../entradaNumerica";

type Oyente = (expr: ExprNumerica) => void;

const oyentes = new Set<Oyente>();

export function emitirEntrada(expr: ExprNumerica): void {
  for (const o of oyentes) o(expr);
}

export function suscribirEntrada(o: Oyente): () => void {
  oyentes.add(o);
  return () => {
    oyentes.delete(o);
  };
}
