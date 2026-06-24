// transformar: geometria PURA de las plantillas DXF (feature-15).
//
// Una sola fuente de la matematica de transform: la consumen el render (T2.2) y el
// snapping (T3.3). Sin three.js, sin React: solo aritmetica en metros.
//
// La transform de la plantilla coloca el dibujo sobre la planta aplicando, EN ESTE
// ORDEN, a cada coordenada local de la entidad:
//   1. escala   (uniforme, respecto al origen local 0,0)
//   2. rotacion (en GRADOS, antihoraria, respecto al origen local 0,0)
//   3. traslacion (x, y) en metros
// Asi, escalar/rotar pivota sobre el origen del dibujo y el offset lo coloca donde
// el usuario quiere. transformarEntidad NO muta: devuelve una entidad nueva del
// mismo `tipo`.
import type { EntidadDxf, Bbox, Plantilla, TransformPlantilla } from "./tiposDxf";

// Aplica escala -> rotacion -> traslacion a un punto (x,y) local. Centraliza la
// matematica para que entidades y bbox usen exactamente la misma transform.
function transformarPunto(
  x: number,
  y: number,
  t: TransformPlantilla,
): { x: number; y: number } {
  const rad = (t.rotacion * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = x * t.escala;
  const sy = y * t.escala;
  return {
    x: sx * cos - sy * sin + t.x,
    y: sx * sin + sy * cos + t.y,
  };
}

// Aplica la transform de la plantilla a una entidad. Devuelve una entidad NUEVA del
// mismo tipo (no muta la original).
export function transformarEntidad(
  entidad: EntidadDxf,
  plantilla: Plantilla,
): EntidadDxf {
  const t = plantilla.transform;
  switch (entidad.tipo) {
    case "linea": {
      const a = transformarPunto(entidad.x1, entidad.y1, t);
      const b = transformarPunto(entidad.x2, entidad.y2, t);
      return { tipo: "linea", x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    case "polilinea": {
      return {
        tipo: "polilinea",
        cerrada: entidad.cerrada,
        puntos: entidad.puntos.map((p) => transformarPunto(p.x, p.y, t)),
      };
    }
    case "punto": {
      const p = transformarPunto(entidad.x, entidad.y, t);
      return { tipo: "punto", x: p.x, y: p.y };
    }
    case "circulo": {
      // El centro rota/traslada; el radio solo escala (uniforme).
      const c = transformarPunto(entidad.cx, entidad.cy, t);
      return { tipo: "circulo", cx: c.x, cy: c.y, r: entidad.r * t.escala };
    }
    case "arco": {
      // El centro rota/traslada; el radio escala; los angulos se desplazan por la
      // rotacion (en radianes, sumando la rotacion de la plantilla).
      const c = transformarPunto(entidad.cx, entidad.cy, t);
      const dRad = (t.rotacion * Math.PI) / 180;
      return {
        tipo: "arco",
        cx: c.x,
        cy: c.y,
        r: entidad.r * t.escala,
        anguloInicio: entidad.anguloInicio + dRad,
        anguloFin: entidad.anguloFin + dRad,
      };
    }
  }
}

// Bbox de la plantilla con su transform aplicada (util para "encajar a vista").
// Recorre las entidades ya transformadas y acumula extremos. Si la plantilla no
// tiene entidades, devuelve una bbox degenerada centrada en su origen.
export function bboxDePlantilla(plantilla: Plantilla): Bbox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hay = false;

  const acc = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    hay = true;
  };

  for (const e0 of plantilla.entidades) {
    const e = transformarEntidad(e0, plantilla);
    switch (e.tipo) {
      case "linea":
        acc(e.x1, e.y1);
        acc(e.x2, e.y2);
        break;
      case "polilinea":
        for (const p of e.puntos) acc(p.x, p.y);
        break;
      case "punto":
        acc(e.x, e.y);
        break;
      case "circulo":
      case "arco":
        acc(e.cx - e.r, e.cy - e.r);
        acc(e.cx + e.r, e.cy + e.r);
        break;
    }
  }

  if (!hay) {
    const { x, y } = plantilla.transform;
    return { minX: x, minY: y, maxX: x, maxY: y };
  }
  return { minX, minY, maxX, maxY };
}
