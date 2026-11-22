// Punzonamiento — la geometría de los perímetros, que comparten el cálculo y el
// lienzo. Todo en mm.
//
// CE Anejo 19 §6.4.2(1): el perímetro crítico u1 está a 2d del área cargada.
// §6.4.2(7): «otros perímetros ui, dentro o fuera del área crítica, deben tener
// la misma forma que el perímetro crítico» — de ahí `perimetroADistancia(a)`,
// con la que se dibujan u1 y uout y se despeja la distancia de uout.
//
// Bordes libres (§6.4.2(4), figura A19.6.15; EHE-08 figura 46.2.b): el perímetro
// corre paralelo a las caras con losa delante y MUERE en el borde, perpendicular
// a él. El pilar está enrasado con el borde, y la convención del módulo es la
// del u0 del §6.4.5(3): cx es la dimensión PARALELA al borde libre y cy la
// perpendicular. En esquina, los dos bordes libres pasan por dos caras.
//
//   interior  u(a) = 2·(cx + cy) + 2π·a
//   circular  u(a) = π·(Ø + 2a)
//   borde     u(a) = cx + 2·cy + π·a         (dos cuartos de círculo)
//   esquina   u(a) = cx + cy + π·a/2         (un cuarto de círculo)
//
// Hasta el 2026-09-26 el motor usaba para u1 «2cx + cy + 2πd + 4d» en borde y
// «cx + cy + πd + 4d» en esquina: 4d de más (tramos que caerían fuera de la
// losa) y, en borde, cx contado dos veces. El u1 salía un 36-65 % largo y el vEd
// otro tanto corto: un pilar de borde al 110 % se leía al 92 %.

import type { PunchingInputs, PunchingPosition } from '../../data/defaults.ts';

/** El área que punzona: el pilar, la carga o, con cruceta, la placa. */
export interface AreaCargada {
  cx: number;
  cy: number;
  circular: boolean;
  position: PunchingPosition;
}

export function areaCargada(inp: PunchingInputs): AreaCargada {
  if (inp.mode === 'pilar-cruceta') {
    return { cx: inp.plateA, cy: inp.plateB, circular: false, position: inp.position };
  }
  // El circular sólo existe en posición interior (el formulario lo apaga fuera).
  const circular = inp.isCircular && inp.position === 'interior';
  return { cx: inp.cx, cy: circular ? inp.cx : inp.cy, circular, position: inp.position };
}

/** Longitud del perímetro de la misma forma que u1, a la distancia a de la cara. */
export function perimetroADistancia(area: AreaCargada, a: number): number {
  const { cx, cy, circular, position } = area;
  if (circular) return Math.PI * (cx + 2 * a);
  if (position === 'borde') return cx + 2 * cy + Math.PI * a;
  if (position === 'esquina') return cx + cy + (Math.PI / 2) * a;
  return 2 * (cx + cy) + 2 * Math.PI * a;
}

/** La inversa: a qué distancia de la cara mide L el perímetro (0 si no llega a salir de ella). */
export function distanciaDePerimetro(area: AreaCargada, L: number): number {
  const { cx, cy, circular, position } = area;
  let a: number;
  if (circular) a = (L / Math.PI - cx) / 2;
  else if (position === 'borde') a = (L - cx - 2 * cy) / Math.PI;
  else if (position === 'esquina') a = (2 * (L - cx - cy)) / Math.PI;
  else a = (L - 2 * (cx + cy)) / (2 * Math.PI);
  return Math.max(0, a);
}

/** Caras del área cargada que tienen losa delante: las que cuentan los cercos tipo viga. */
export type Cara = 'arriba' | 'abajo' | 'izquierda' | 'derecha';
export function carasCargadas(position: PunchingPosition): Cara[] {
  // Mismo convenio que el dibujo: el borde libre abajo y, en esquina, el 2.º a la derecha.
  if (position === 'borde') return ['arriba', 'izquierda', 'derecha'];
  if (position === 'esquina') return ['arriba', 'izquierda'];
  return ['arriba', 'abajo', 'izquierda', 'derecha'];
}

/**
 * Filas de cercos que pide el perímetro uout (lo AÑADE el lienzo: el motor no
 * pide el número de filas y la comprobación de la disposición sale como nota).
 *
 * La 1.ª a 0,5·d de la cara (CE Anejo 19 §9.4.3(4): no más de d/2), las
 * siguientes cada sr, hasta que la última quede a no más de k·d = 1,5·d dentro
 * de uout (§6.4.5(4)); dos perímetros como mínimo (§9.4.3(1)).
 * Devuelve las distancias a la cara de cada fila, mm.
 */
export function filasDeCercos(d: number, sr: number, aOut: number): number[] {
  if (!(d > 0) || !(sr > 0)) return [];
  const s0 = 0.5 * d;
  const hasta = aOut - 1.5 * d;
  const n = Math.max(2, hasta > s0 ? Math.ceil((hasta - s0) / sr - 1e-9) + 1 : 1);
  return Array.from({ length: Math.min(n, 60) }, (_, i) => s0 + i * sr);
}
