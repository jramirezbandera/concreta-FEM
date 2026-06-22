// snap: helper PURO de ajuste a rejilla para la introduccion grafica (feature-11).
// Sin React, sin three.js: solo aritmetica. La rejilla del lienzo es de 0.5 m
// (Spec §4.1, Rejilla en Escena.tsx), por eso el paso por defecto.
//
// Regla #14 (CLAUDE.md): el snap trabaja en unidades internas (m), igual que el
// resto de la geometria de la escena. No hay conversion aqui.

// Redondea cada coordenada al multiplo de `paso` mas cercano. Con paso<=0 (rejilla
// desactivada o invalida) devuelve las coordenadas sin tocar: snap inerte, no
// rompe la colocacion.
export function snapARejilla(
  x: number,
  y: number,
  paso = 0.5,
): { x: number; y: number } {
  if (!(paso > 0)) return { x, y };
  return {
    x: Math.round(x / paso) * paso,
    y: Math.round(y / paso) * paso,
  };
}
