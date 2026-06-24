// teselar: teselado PURO de arcos/circulos DXF a vertices de lineSegments
// (feature-15). Modulo sin three.js, sin React: solo aritmetica, para poder
// testearlo en Node. El llamador (OverlayPlantillas) anade la coord Z de fondo.
//
// CONVENCION DXF: los arcos van ANTIHORARIO (CCW) de anguloInicio a anguloFin,
// ENVOLVIENDO por 360 si hace falta. Un arco 350->10 grados barre +20 CCW, NO -340.
// Por eso el barrido se normaliza a [0, 2π): nunca negativo.

// Aproxima un arco [anguloInicio, anguloFin] (radianes, CCW) por segmentos de
// recta. Devuelve los vertices como pares consecutivos (x,y) listos para
// lineSegments (no line-strip): para n muestras emite n-1 segmentos = 2(n-1)*2
// numeros. SIN coord Z (la pone el llamador). `segmentosCirculo` es la resolucion
// de un circulo completo (2π); el arco usa una fraccion proporcional a su barrido.
export function verticesArco(
  cx: number,
  cy: number,
  r: number,
  anguloInicio: number,
  anguloFin: number,
  segmentosCirculo: number,
): number[] {
  // Normaliza el barrido a CCW en (0, 2π]: si es <= 0 (incluido el circulo completo,
  // cuyo 2π reduce a 0 por el modulo), suma una vuelta. Asi 350->10 grados da +20 (no
  // -340) y un circulo 0->2π conserva su 2π (no colapsa a 0). Convencion DXF: CCW.
  let barrido = (anguloFin - anguloInicio) % (Math.PI * 2);
  if (barrido <= 0) barrido += Math.PI * 2;

  // Numero de pasos proporcional al barrido (al menos 1), redondeado al alza.
  const pasos = Math.max(
    1,
    Math.ceil((barrido / (Math.PI * 2)) * segmentosCirculo),
  );

  const out: number[] = [];
  let px = cx + r * Math.cos(anguloInicio);
  let py = cy + r * Math.sin(anguloInicio);
  for (let i = 1; i <= pasos; i++) {
    const a = anguloInicio + (barrido * i) / pasos;
    const qx = cx + r * Math.cos(a);
    const qy = cy + r * Math.sin(a);
    // Segmento previo->actual (par de vertices).
    out.push(px, py, qx, qy);
    px = qx;
    py = qy;
  }
  return out;
}
