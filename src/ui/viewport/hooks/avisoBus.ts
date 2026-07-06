// avisoBus: canal ligero para AVISOS puntuales de las herramientas hacia la barra
// de estado (Corte UX-2.0). Hermano de cotaBus/coordsBus: un Set de oyentes +
// emitir, sin meter el aviso en estado React desde dentro del Canvas.
//
// A diferencia de la cota viva (alta frecuencia, por move), un aviso es ESPORADICO
// (un clic que no pudo crear nada, una entrada numerica invalida): el oyente (App)
// puede hacer setState directo y autolimpiar con un timeout. El bus no guarda
// "ultimo aviso": un aviso es un disparo, no un estado.
type Oyente = (texto: string) => void;

const oyentes = new Set<Oyente>();

// Emite un aviso puntual en lenguaje de obra. La barra de estado lo muestra unos
// segundos con prioridad sobre el mensaje contextual (no sobre el de calculo).
export function emitirAviso(texto: string): void {
  for (const o of oyentes) o(texto);
}

export function suscribirAviso(o: Oyente): () => void {
  oyentes.add(o);
  return () => {
    oyentes.delete(o);
  };
}
