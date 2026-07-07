// colocacionMuroLogica: logica PURA del flujo de DOS clics para colocar un MURO/
// pantalla por su EJE en planta (F3, muros). Vive en su propio modulo (no en
// ColocacionMuro.tsx) para no romper react-refresh/only-export-components.
//
// FLUJO: primer clic fija el extremo A del eje; segundo clic fija el extremo B. El
// muro de este corte es PARALELO a los ejes de obra (MURO_NO_ALINEADO bloquea el
// diagonal), asi que el segundo punto se PROYECTA al eje dominante ANTES de crear
// (orto FORZADO, no opcional como en la viga): si |dx| >= |dy| el eje corre en X
// (B.y := A.y); si no, en Y (B.x := A.x). La previsualizacion aplica la MISMA
// proyeccion (lo dibujado = lo creado).
//
// Sin React, sin three.js, sin stores: solo aritmetica en m (#14). El muro
// degenerado (extremos que colapsan a < LADO_MIN) se RECHAZA aqui; la red
// definitiva es MURO_DEGENERADO en validaciones.

// Punto en planta (m). Misma forma que el {x,y} de crearMuro (x1/y1/x2/y2).
export interface PuntoMuro {
  x: number;
  y: number;
}

// Longitud minima del eje (m) para no crear un muro degenerado. Mismo criterio de
// magnitud que LADO_MIN_PANO (TOL_NODO, 1 mm).
export const LARGO_MIN_MURO = 1e-3;

// Proyecta el punto B al eje dominante desde A (orto FORZADO del muro): el segmento
// resultante es paralelo a obra-X o a obra-Y. Empate |dx| == |dy| -> X (estable).
export function proyectarOrtoMuro(a: PuntoMuro, b: PuntoMuro): PuntoMuro {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  return dx >= dy ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
}

// Acciones posibles tras un clic en el flujo de colocacion del muro.
export type AccionMuro =
  | { tipo: "guardarA"; a: PuntoMuro } // primer clic: extremo A pendiente
  | { tipo: "ignorar" } // segundo clic degenerado (eje sin longitud): se ignora
  | { tipo: "crear"; a: PuntoMuro; b: PuntoMuro }; // b YA proyectado a orto

// Procesa un clic dado el estado del flujo (extremo A pendiente o no) y el punto
// clicado. Con A pendiente, el punto se proyecta a orto y, si el eje tiene longitud,
// se crea; si no, se ignora (se mantiene A para que el usuario reintente).
export function procesarClicMuro(
  pendienteA: PuntoMuro | null,
  punto: PuntoMuro,
): AccionMuro {
  if (pendienteA === null) return { tipo: "guardarA", a: punto };
  const b = proyectarOrtoMuro(pendienteA, punto);
  const largo = Math.hypot(b.x - pendienteA.x, b.y - pendienteA.y);
  if (largo < LARGO_MIN_MURO) return { tipo: "ignorar" };
  return { tipo: "crear", a: pendienteA, b };
}
