// cargasDibujo: helpers PUROS que producen la geometria de las CARGAS dibujadas en planta
// (D7b, spec §4.1 / token --load). Las cargas eran invisibles en el lienzo (una viga
// cargada se veia identica a una descargada; el token --load no tenia consumidor). Aqui se
// derivan:
//   - carga LINEAL sobre viga/pilar -> hilera de flechitas "↓" a lo largo del tramo + una
//     etiqueta ("10 kN/m") en el centro.
//   - carga SUPERFICIAL de paño -> segmentos de "hatch" a 45° sobre la huella + una
//     etiqueta central ("5 kN/m²").
//
// PURO (sin React/three/stores): recibe la geometria del elemento y el valor de la carga y
// devuelve arrays de posiciones/segmentos + la etiqueta. El componente CargasDibujadas los
// pinta (lineSegments para las flechas/hatch, <Text> para la etiqueta), nunca por frame.
//
// SUMA (Σ, decision D7b): si varias cargas caen sobre el mismo elemento se SUMAN sus
// valores y se rotula "Σ N kN/m" (lo simple: una sola etiqueta y una sola hilera por
// elemento, sin apilar). La agregacion la hace el componente; estos helpers dibujan un
// unico valor ya agregado.
//
// UNIDADES: coordenadas en metros de escena; el valor de la carga ya viene en las unidades
// de presentacion formateadas por el llamador (la conversion vive en /src/unidades).

// --- Carga lineal: hilera de flechas a lo largo de un segmento ----------------

export interface PuntoXYZ {
  x: number;
  y: number;
  z: number;
}

// Una flecha "↓" es un par de segmentos: el astil (vertical corto sobre el elemento) y dos
// barbas en la punta. Para un lienzo en PLANTA cenital "↓" no puede apuntar en Z (no se
// veria); apunta hacia -Y local perpendicular... pero lo mas legible y estable es un glifo
// en el plano XY: un astil corto perpendicular al tramo con una cabeza en V. Devolvemos los
// vertices de esos segmentos (pares consecutivos = un segmento en lineSegments).
export interface FlechasCarga {
  // Vertices en pares (v0-v1, v2-v3, ...) para lineSegments. Incluye astiles y cabezas.
  vertices: number[]; // [x,y,z, x,y,z, ...]
  // Etiqueta central de la carga ("10 kN/m").
  etiqueta: { x: number; y: number; z: number };
}

// Longitud del astil de la flecha (m) y semiancho de la cabeza en V (m). Pequeños: son un
// glifo indicativo, no una cota. Separacion nominal entre flechas (m).
const ASTIL = 0.35;
const CABEZA = 0.12;
const SEP_FLECHA = 0.8;
// Nº minimo/maximo de flechas por tramo (una hilera legible sin saturar tramos largos).
const MIN_FLECHAS = 2;
const MAX_FLECHAS = 24;

// Numero de flechas para un tramo de longitud `largo`: ~1 cada SEP_FLECHA, acotado.
export function numeroFlechas(largo: number): number {
  const n = Math.round(largo / SEP_FLECHA);
  return Math.max(MIN_FLECHAS, Math.min(MAX_FLECHAS, n));
}

// Deriva la hilera de flechas de una carga lineal sobre el segmento (ax,ay)->(bx,by) a la
// cota z. Las flechas se reparten uniformemente incluyendo los extremos. Cada flecha apunta
// hacia el lado "normal" del tramo (perpendicular), simulando la carga que baja sobre la
// barra; en planta cenital eso se lee como "hay carga repartida aqui".
export function flechasCargaLineal(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  z: number,
): FlechasCarga {
  const dx = bx - ax;
  const dy = by - ay;
  const largo = Math.hypot(dx, dy) || 1e-6;
  // Direccion unitaria del tramo y su normal (girada 90°): la flecha se dibuja a lo largo
  // de la normal (astil) con la cabeza en el extremo.
  const ux = dx / largo;
  const uy = dy / largo;
  const nx = -uy; // normal
  const ny = ux;
  const n = numeroFlechas(largo);
  const vertices: number[] = [];
  for (let i = 0; i < n; i++) {
    // Reparto uniforme incluyendo extremos: t en [0,1].
    const t = n === 1 ? 0.5 : i / (n - 1);
    const px = ax + dx * t;
    const py = ay + dy * t;
    // Cola del astil (arranca del lado + de la normal) y punta (sobre el tramo).
    const cx = px + nx * ASTIL;
    const cy = py + ny * ASTIL;
    // Astil: cola -> punta.
    vertices.push(cx, cy, z, px, py, z);
    // Cabeza en V: dos barbas desde la punta hacia atras y a los lados.
    const backx = nx * CABEZA;
    const backy = ny * CABEZA;
    const sidex = ux * CABEZA;
    const sidey = uy * CABEZA;
    vertices.push(px, py, z, px + backx + sidex, py + backy + sidey, z);
    vertices.push(px, py, z, px + backx - sidex, py + backy - sidey, z);
  }
  return {
    vertices,
    etiqueta: { x: (ax + bx) / 2 + nx * ASTIL, y: (ay + by) / 2 + ny * ASTIL, z },
  };
}

// --- Carga superficial: hatch a 45° sobre la huella de un paño ----------------

export interface HatchCarga {
  // Vertices en pares para lineSegments (cada par = una linea del hatch).
  vertices: number[];
  // Etiqueta central ("5 kN/m²").
  etiqueta: { x: number; y: number; z: number };
}

// Paso entre lineas del hatch (m): denso pero sutil. La opacidad baja la pone el material.
const PASO_HATCH = 0.6;

// Punto minimo/maximo (bounding box) de un contorno.
function bbox(contorno: readonly { x: number; y: number }[]): {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
} {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const p of contorno) {
    if (p.x < xMin) xMin = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.x > xMax) xMax = p.x;
    if (p.y > yMax) yMax = p.y;
  }
  return { xMin, yMin, xMax, yMax };
}

// Centroide simple (media de vertices) para colocar la etiqueta. Suficiente para un
// rectangulo (corte 1); para poligonos concavos no es el centroide exacto pero cae dentro
// del bbox, que basta para un rotulo indicativo.
export function centroContorno(contorno: readonly { x: number; y: number }[]): {
  x: number;
  y: number;
} {
  if (contorno.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of contorno) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / contorno.length, y: sy / contorno.length };
}

// Deriva el hatch a 45° dentro del bounding box del contorno. Cada linea va de un borde a
// otro con pendiente +1 (dir 45°); se generan lineas paralelas separadas PASO_HATCH.
// Se recorta al bbox (no al poligono exacto: corte 1 es rectangular, asi que el bbox ES la
// huella; para poligonos no rectangulares el hatch puede sobresalir un poco -> deuda). El
// resultado es indicativo ("hay carga superficial aqui"), no una trama tecnica exacta.
export function hatchCargaSuperficial(
  contorno: readonly { x: number; y: number }[],
  z: number,
): HatchCarga {
  const { xMin, yMin, xMax, yMax } = bbox(contorno);
  const ancho = xMax - xMin;
  const alto = yMax - yMin;
  const vertices: number[] = [];
  if (ancho > 0 && alto > 0 && Number.isFinite(ancho) && Number.isFinite(alto)) {
    // Lineas y = x + c (pendiente 1). El intercepto c recorre desde (yMin - xMax) hasta
    // (yMax - xMin), paso PASO_HATCH. Cada linea se recorta al rectangulo [xMin,xMax] x
    // [yMin,yMax] resolviendo las intersecciones con los 4 bordes y quedandonos con el
    // tramo interior.
    const cMin = yMin - xMax;
    const cMax = yMax - xMin;
    for (let c = cMin; c <= cMax + 1e-9; c += PASO_HATCH) {
      // Interseccion de y=x+c con el rectangulo: parametrizamos x en [xMin,xMax] y
      // acotamos y a [yMin,yMax].
      // x tal que y=yMin -> x=yMin-c ; y=yMax -> x=yMax-c.
      const xa = Math.max(xMin, Math.min(xMax, yMin - c));
      const xb = Math.max(xMin, Math.min(xMax, yMax - c));
      const x0 = Math.min(xa, xb);
      const x1 = Math.max(xa, xb);
      if (x1 - x0 < 1e-6) continue; // la linea toca solo una esquina
      vertices.push(x0, x0 + c, z, x1, x1 + c, z);
    }
  }
  const centro = centroContorno(contorno);
  return { vertices, etiqueta: { x: centro.x, y: centro.y, z } };
}
