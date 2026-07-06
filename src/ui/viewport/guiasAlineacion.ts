// guiasAlineacion: helper PURO de las guias de alineacion (tracking) de la
// introduccion grafica (UX-2.4). Si el cursor queda casi alineado en X o en Y con
// algun punto notable de la obra (nudos, pilares de la planta activa), se propone
// AJUSTAR esa coordenada a la del punto y dibujar una guia discontinua hasta el.
// Sin React ni three: aritmetica en unidades internas (m), testeable en Node.
//
// COSTE: barrido O(n) por llamada sobre candidatos ya derivados (el llamador los
// cachea por referencia de modelo, patron puntosSnapMemo). Con <1000 elementos por
// planta es despreciable frente al raycast del propio move.

export interface PuntoGuia {
  x: number;
  y: number;
}

export interface ResultadoGuias {
  // Alineacion VERTICAL (misma X que un punto notable): valor = esa X; origen = el
  // punto que la produce (extremo de la guia dibujada). null si no hay alineacion.
  guiaX: { valor: number; origen: PuntoGuia } | null;
  // Alineacion HORIZONTAL (misma Y). Espejo de guiaX.
  guiaY: { valor: number; origen: PuntoGuia } | null;
  // Cursor con las coordenadas alineadas sustituidas (las no alineadas se devuelven
  // tal cual: el llamador decide si les aplica rejilla).
  ajustado: { x: number; y: number };
}

// Tolerancia de alineacion (m). Fija de momento (refinarla por zoom es una mejora
// futura): 0.15 m se nota al dibujar sin ser un iman agresivo.
export const TOL_GUIA_M = 0.15;

const SIN_GUIAS: ResultadoGuias = Object.freeze({
  guiaX: null,
  guiaY: null,
  ajustado: { x: 0, y: 0 },
});

export function buscarAlineaciones(
  x: number,
  y: number,
  candidatos: readonly PuntoGuia[],
  tol: number = TOL_GUIA_M,
): ResultadoGuias {
  let mejorX: { valor: number; origen: PuntoGuia } | null = null;
  let mejorDx = tol;
  let mejorY: { valor: number; origen: PuntoGuia } | null = null;
  let mejorDy = tol;

  for (const c of candidatos) {
    const dx = Math.abs(c.x - x);
    if (dx <= mejorDx) {
      // Empate/mejora: gana el origen mas CERCANO al cursor (guia mas corta y
      // menos ambigua) — de ahi el <= con distancia euclidea como desempate barato.
      if (mejorX === null || dx < mejorDx || distancia2(c, x, y) < distancia2(mejorX.origen, x, y)) {
        mejorX = { valor: c.x, origen: c };
        mejorDx = dx;
      }
    }
    const dy = Math.abs(c.y - y);
    if (dy <= mejorDy) {
      if (mejorY === null || dy < mejorDy || distancia2(c, x, y) < distancia2(mejorY.origen, x, y)) {
        mejorY = { valor: c.y, origen: c };
        mejorDy = dy;
      }
    }
  }

  if (mejorX === null && mejorY === null) {
    // Sin alineaciones: referencia estable con el cursor tal cual (objeto nuevo solo
    // en este caso barato; las constantes congeladas no pueden llevar el cursor).
    return { ...SIN_GUIAS, ajustado: { x, y } };
  }

  return {
    guiaX: mejorX,
    guiaY: mejorY,
    ajustado: { x: mejorX ? mejorX.valor : x, y: mejorY ? mejorY.valor : y },
  };
}

function distancia2(p: PuntoGuia, x: number, y: number): number {
  const dx = p.x - x;
  const dy = p.y - y;
  return dx * dx + dy * dy;
}

// Candidatos de alineacion de un modelo: pilares + nudos (posiciones en planta).
// Memoizado por REFERENCIA de modelo (WeakMap): el Modelo es inmutable entre
// ediciones (Immer), asi que cada edicion produce referencia nueva y el resto de
// moves reutiliza la lista. Tipo estructural minimo para no acoplar este modulo
// puro al tipo Modelo completo.
interface ModeloConPuntos {
  pilares: ReadonlyArray<{ x: number; y: number }>;
  nudos: ReadonlyArray<{ x: number; y: number }>;
}

const cachePuntosGuia = new WeakMap<ModeloConPuntos, PuntoGuia[]>();

export function puntosGuiaDeModelo(modelo: ModeloConPuntos): PuntoGuia[] {
  const c = cachePuntosGuia.get(modelo);
  if (c !== undefined) return c;
  const puntos: PuntoGuia[] = [
    ...modelo.pilares.map((p) => ({ x: p.x, y: p.y })),
    ...modelo.nudos.map((n) => ({ x: n.x, y: n.y })),
  ];
  cachePuntosGuia.set(modelo, puntos);
  return puntos;
}
