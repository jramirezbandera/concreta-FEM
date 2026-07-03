// prefersReducedMotion: helper compartido para respetar la preferencia del sistema
// "reducir movimiento" (prefers-reduced-motion). Los overlays animados (deformada, forma
// modal) lo consultan UNA vez al construir la geometria (NO por frame): si el usuario pide
// menos movimiento, la animacion no avanza y se muestra la amplitud estatica maxima.
//
// Se consulta con matchMedia, tolerante a entornos sin DOM (SSR/tests): si matchMedia no
// existe, devuelve false (animacion permitida por defecto).
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
