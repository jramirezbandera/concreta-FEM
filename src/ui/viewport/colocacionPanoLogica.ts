// colocacionPanoLogica: logica PURA del flujo de DOS clics para colocar un paño losa
// rectangular (F3 corte 1). Vive en su propio modulo (no en ColocacionPano.tsx) para no
// romper react-refresh/only-export-components: ese fichero solo exporta componentes.
//
// FLUJO: primer clic fija una ESQUINA; segundo clic fija la esquina OPUESTA. El paño es el
// RECTANGULO alineado a ejes (X,Y) cuyas diagonales son esas dos esquinas: cuatro nudos
// PROPIOS (corte 1 es AISLADO: la malla no comparte con el portico). El orden de las cuatro
// esquinas se emite ANTIHORARIO empezando por (xMin,yMin) para que el discretizador reciba
// un perimetro consistente; el mallado fija el orden canonico i,j,m,n de cada quad.
//
//   (xMin,yMax) n┌───────┐m (xMax,yMax)
//                │       │
//   (xMin,yMin) i└───────┘j (xMax,yMin)   (CCW visto desde +Z, planta cenital)
//
// Sin React, sin three.js, sin stores: solo aritmetica sobre coordenadas en m (#14). El
// paño degenerado (area ~0: clics demasiado proximos en X o en Y) se RECHAZA aqui (no se
// crea), igual que la viga degenerada I≈J; la red definitiva esta en el discretizador.

// Punto en planta (m). Coincide en forma con el {x,y} que consume crearPano.
export interface PuntoPano {
  x: number;
  y: number;
}

// Lado minimo del rectangulo (m) para no crear un paño degenerado. Coincide en magnitud
// con TOL_NODO del discretizador (1 mm): por debajo, las dos esquinas colapsarian en el
// mismo nudo y el rectangulo no tendria area. Es el unico criterio anti-paño-degenerado
// en el flujo de dos clics; el discretizador tiene su propia red al mallar.
export const LADO_MIN_PANO = 1e-3;

// Acciones posibles tras un clic en el flujo de colocacion del paño.
export type AccionPano =
  | { tipo: "guardarA"; a: PuntoPano } // primer clic: esquina A pendiente
  | { tipo: "ignorar" } // segundo clic degenerado (rectangulo sin area): se ignora
  | { tipo: "crear"; perimetro: [PuntoPano, PuntoPano, PuntoPano, PuntoPano] };

// Construye el perimetro CCW (i,j,m,n) del rectangulo alineado a ejes definido por dos
// esquinas opuestas. Devuelve null si el rectangulo es degenerado (ancho o alto < LADO_MIN).
export function rectanguloDesde(
  a: PuntoPano,
  b: PuntoPano,
): [PuntoPano, PuntoPano, PuntoPano, PuntoPano] | null {
  const xMin = Math.min(a.x, b.x);
  const xMax = Math.max(a.x, b.x);
  const yMin = Math.min(a.y, b.y);
  const yMax = Math.max(a.y, b.y);
  if (xMax - xMin < LADO_MIN_PANO || yMax - yMin < LADO_MIN_PANO) return null;
  // CCW desde (xMin,yMin): i=(xMin,yMin), j=(xMax,yMin), m=(xMax,yMax), n=(xMin,yMax).
  return [
    { x: xMin, y: yMin },
    { x: xMax, y: yMin },
    { x: xMax, y: yMax },
    { x: xMin, y: yMax },
  ];
}

// Procesa un clic dado el estado del flujo (esquina A pendiente o no) y el punto clicado.
//  - sin A pendiente: el clic guarda A (primer clic).
//  - con A pendiente: el clic define la esquina opuesta; si el rectangulo tiene area se
//    crea, si no se ignora (se mantiene A pendiente para que el usuario reintente).
export function procesarClicPano(
  pendienteA: PuntoPano | null,
  punto: PuntoPano,
): AccionPano {
  if (pendienteA === null) return { tipo: "guardarA", a: punto };
  const perimetro = rectanguloDesde(pendienteA, punto);
  if (perimetro === null) return { tipo: "ignorar" };
  return { tipo: "crear", perimetro };
}
