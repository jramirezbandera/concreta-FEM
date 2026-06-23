// Geometria de snapping del discretizador (Capa 1 -> Capa 2): tolerancia +
// helpers PUROS de mapeo de ejes y clave de posicion.
//
// Modulo HOJA (sin imports de proyecto) para ser FUENTE UNICA del criterio de
// "mismo nodo" sin crear ciclos. Lo consumen:
//  - discretizar.ts (snapping de nodos al numerar la Capa 2),
//  - validaciones.ts (rechazo de viga degenerada: dos extremos que colapsarian
//    en el MISMO nodo FEM -> barra de longitud cero),
//  - la UI de introduccion grafica (comandosModelo/imanViga/colocacionVigaLogica)
//    para resolver/coincidir nudos.
// El criterio de igualdad de nodos es la CLAVE de rejilla (clavePosicion), no la
// distancia euclidea: dos puntos distintos en euclideo pueden caer en la misma
// celda (p. ej. en diagonal). Comparar siempre por clave para no divergir del
// snapping real del solver. No duplicar este criterio en ningun otro sitio.

// Tolerancia de snapping geometrico de nodos (m). Dos puntos cuya clave de rejilla
// coincide se consideran el mismo nudo (comparten geometria). Explicita y nombrada
// para que el determinismo de la numeracion sea auditable.
export const TOL_NODO = 1e-3; // m

// Coordenada FEM global de un punto. #18 (Y vertical): la planta (x,y) que el
// arquitecto dibuja va al plano horizontal global (X,Z); la cota/altura es la
// vertical global Y. Convencion de uso fijada aqui y blindada con test.
export function mapearEjes(
  xPlanta: number,
  yPlanta: number,
  cota: number,
): [number, number, number] {
  return [xPlanta, cota, yPlanta]; // [X, Y, Z]
}

// Clave determinista de un punto para snapping. Cuantiza cada coordenada a la
// rejilla de TOL_NODO (round(c/tol)) y la usa como clave de igualdad. Dos puntos
// dentro de una celda comparten clave => mismo nudo. La clave es estable e
// independiente del orden de insercion (clave por geometria, no por id de dominio).
export function clavePosicion(
  [x, y, z]: [number, number, number],
  tol: number,
): string {
  // Math.round(0) evita la clave "-0" para coordenadas negativas pequeñas.
  const q = (c: number): number => {
    const r = Math.round(c / tol);
    return r === 0 ? 0 : r;
  };
  return `${q(x)}|${q(y)}|${q(z)}`;
}
