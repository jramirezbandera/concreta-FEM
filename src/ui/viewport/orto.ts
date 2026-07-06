// orto: helper PURO del modo orto de la colocacion de vigas (UX-2.3). Proyecta el
// cursor sobre la mas cercana de las 8 direcciones (0/45/90/... grados) desde el
// punto inicial I, como el ORTHO/POLAR de un CAD. Sin React ni three: aritmetica en
// unidades internas (m), testeable en Node.
import { snapARejilla } from "./snap";

// Limpieza numerica: cos(90 grados) = 6e-17, no 0. Sin esto, una viga "vertical"
// tendria dx = 1e-15 m y dejaria de compartir celda/alineacion con su pilar.
const EPS = 1e-9;

export interface PuntoOrto {
  x: number;
  y: number;
  // true si la direccion elegida es cardinal (0/90/180/270): solo entonces tiene
  // sentido ajustar a rejilla la coordenada que avanza (la otra esta bloqueada).
  cardinal: boolean;
}

// Proyecta (x,y) sobre la direccion de 45 en 45 grados mas cercana desde (ix,iy).
// La proyeccion es escalar (producto punto): la distancia recorrida se conserva
// sobre el eje elegido, como en AutoCAD.
export function aplicarOrto(
  ix: number,
  iy: number,
  x: number,
  y: number,
): PuntoOrto {
  const dx = x - ix;
  const dy = y - iy;
  if (dx === 0 && dy === 0) return { x, y, cardinal: true };

  const paso = Math.PI / 4;
  const ang = Math.round(Math.atan2(dy, dx) / paso) * paso;
  let ux = Math.cos(ang);
  let uy = Math.sin(ang);
  if (Math.abs(ux) < EPS) ux = 0;
  if (Math.abs(uy) < EPS) uy = 0;

  const proy = dx * ux + dy * uy;
  return {
    x: ix + ux * proy,
    y: iy + uy * proy,
    cardinal: ux === 0 || uy === 0,
  };
}

// Orto + rejilla en un paso (la prioridad del llamador es iman obra > orto > rejilla):
// aplica el orto y, si la direccion es CARDINAL y hay paso de rejilla, ajusta a
// rejilla la coordenada que avanza (la bloqueada se conserva exacta = la de I). En
// diagonal no se ajusta: la rejilla romperia los 45 grados.
export function puntoOrto(
  ix: number,
  iy: number,
  x: number,
  y: number,
  pasoRejilla?: number,
): { x: number; y: number } {
  const p = aplicarOrto(ix, iy, x, y);
  if (!p.cardinal || pasoRejilla === undefined) return { x: p.x, y: p.y };
  const s = snapARejilla(p.x, p.y, pasoRejilla);
  // Direccion horizontal: y queda bloqueada en iy; vertical: x bloqueada en ix.
  return p.y === iy ? { x: s.x, y: iy } : { x: ix, y: s.y };
}
