// snapDxf: puntos notables de las entidades DXF para el iman (calco) de la
// introduccion grafica (feature-15, T3.3). Modulo PURO: solo aritmetica en metros
// (sistema interno, CLAUDE.md §14). Sin three.js, sin React, sin stores.
//
// Su salida son CANDIDATOS de enganche de prioridad media: la geometria real de la
// obra (nudos/cabezas de pilar) gana siempre; el DXF solo aporta puntos cuando no
// hay obra mas cerca; la rejilla es el ultimo recurso (ver imanViga.resolverPunto y
// ColocacionPilar). La plantilla es ayuda de dibujo, NO Capa 1.
import { transformarEntidad } from "./transformar";
import type { EntidadDxf, Plantilla, PuntoXY } from "./tiposDxf";

// Cuantos puntos del arco se ofrecen ademas de centro y extremos: ninguno por
// ahora (extremos + centro cubren los enganches utiles sin recalcular cuadrantes
// fuera del barrido). Mantener barato (#21 espiritu: empezar simple).

// Extrae los puntos notables a los que tiene sentido engancharse de UNA entidad ya
// transformada al sistema de obra (coords absolutas en m):
//  - linea     -> sus dos extremos.
//  - polilinea -> todos sus vertices.
//  - punto     -> el propio punto.
//  - circulo   -> centro + 4 cuadrantes (enganche barato y util a centros de pilar
//                 redondo dibujados como circulo).
//  - arco      -> centro + los dos extremos del barrido.
// La entidad DEBE venir ya transformada (transformarEntidad): aqui no se aplica la
// transform de la plantilla, para no duplicar la matematica (#unica fuente).
export function puntosNotablesDeEntidad(entidad: EntidadDxf): PuntoXY[] {
  switch (entidad.tipo) {
    case "linea":
      return [
        { x: entidad.x1, y: entidad.y1 },
        { x: entidad.x2, y: entidad.y2 },
      ];
    case "polilinea":
      // Copia defensiva: no devolver las referencias internas de la entidad.
      return entidad.puntos.map((p) => ({ x: p.x, y: p.y }));
    case "punto":
      return [{ x: entidad.x, y: entidad.y }];
    case "circulo":
      return [
        { x: entidad.cx, y: entidad.cy },
        { x: entidad.cx + entidad.r, y: entidad.cy },
        { x: entidad.cx - entidad.r, y: entidad.cy },
        { x: entidad.cx, y: entidad.cy + entidad.r },
        { x: entidad.cx, y: entidad.cy - entidad.r },
      ];
    case "arco":
      return [
        { x: entidad.cx, y: entidad.cy },
        {
          x: entidad.cx + entidad.r * Math.cos(entidad.anguloInicio),
          y: entidad.cy + entidad.r * Math.sin(entidad.anguloInicio),
        },
        {
          x: entidad.cx + entidad.r * Math.cos(entidad.anguloFin),
          y: entidad.cy + entidad.r * Math.sin(entidad.anguloFin),
        },
      ];
  }
}

// Reune los puntos de enganche de TODAS las plantillas visibles de la planta dada,
// con su transform aplicada. El llamador (ColocacionPilar/Viga) los calcula desde
// vistaStore y los pasa al iman: asi imanViga sigue siendo puro (no toca el store).
// Si `plantaActivaId` es null no hay planta de destino -> sin candidatos.
export function puntosSnapDePlantillas(
  plantillas: readonly Plantilla[],
  plantaActivaId: string | null,
): PuntoXY[] {
  if (plantaActivaId === null) return [];
  const puntos: PuntoXY[] = [];
  for (const pl of plantillas) {
    if (!pl.visible || pl.plantaId !== plantaActivaId) continue;
    for (const e of pl.entidades) {
      const et = transformarEntidad(e, pl);
      for (const p of puntosNotablesDeEntidad(et)) puntos.push(p);
    }
  }
  return puntos;
}

// Engancha (x,y) al punto extra (DXF) mas cercano dentro de `radio`. Devuelve null
// si no hay ninguno en radio (o la lista esta vacia). Reutilizado por imanViga (paso
// intermedio obra->DXF->rejilla) y por ColocacionPilar (que no tiene candidatos de
// obra: para el, DXF->rejilla).
export function engancharAPuntoExtra(
  x: number,
  y: number,
  puntos: readonly PuntoXY[],
  radio: number,
): PuntoXY | null {
  let mejor: PuntoXY | null = null;
  let mejorDist2 = radio * radio;
  for (const p of puntos) {
    const dx = p.x - x;
    const dy = p.y - y;
    const dist2 = dx * dx + dy * dy;
    if (dist2 <= mejorDist2) {
      // <= para que, a igualdad, gane el ultimo (irrelevante; coords identicas).
      mejor = p;
      mejorDist2 = dist2;
    }
  }
  return mejor;
}
