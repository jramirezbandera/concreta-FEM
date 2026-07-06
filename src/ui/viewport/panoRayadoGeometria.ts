// panoRayadoGeometria: geometria PURA del rayado de un forjado UNIDIRECCIONAL (viguetas en
// una direccion), calcada al patron CYPECAD. SIN three.js/React: solo aritmetica sobre el
// contorno (rectangulo de obra en planta) -> vertices de `lineSegments` (pares
// consecutivos), para poder testearlo en Node. Lo consume PanoRayado.tsx (que solo
// empaqueta los vertices en un BufferGeometry y los posiciona a la cota).
//
// QUE DIBUJA: n lineas paralelas a `direccionViguetas` DENTRO del rectangulo del paño,
// repartidas a lo largo del eje PERPENDICULAR (el de reparto). Es la HUELLA de las
// viguetas: comunica al arquitecto en que direccion trabaja el forjado.
//
// ESPACIADO = INTEREJE REAL (decision). El discretizador reparte el ancho a partes
// iguales `s = B/n` con `n = max(1, round(B/intereje))` (mismo criterio que
// generarViguetas / tamMalla -> tamMallaEfectivo). Se REPRODUCE aqui ese reparto para que
// el rayado dibujado coincida EXACTAMENTE con las viguetas que el modelo calcula (no un
// espaciado cosmetico en pantalla que mentiria sobre el numero real de viguetas). Cada
// linea k va en la posicion transversal `min + s·(k + ½)`, igual que `generarViguetas`.
//
// El rayado es SOLO LECTURA de la geometria de obra: no participa en el picking (el blanco
// sigue siendo la huella PanoHuella). Vertices en el plano XY de planta (la cota la pone
// el componente).

// Direccion de las viguetas en ejes de OBRA/planta: "x" -> paralelas al eje X.
export type DireccionRayado = "x" | "y";

export interface EntradaRayado {
  contorno: { x: number; y: number }[]; // nudos del perimetro (m), en planta
  direccion: DireccionRayado;
  intereje: number; // m, objetivo (el reparto real es s = B/n)
}

// Bounding box del contorno (min/max en X e Y). null si no hay puntos.
function bbox(
  contorno: { x: number; y: number }[],
): { xMin: number; xMax: number; yMin: number; yMax: number } | null {
  if (contorno.length === 0) return null;
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of contorno) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  return { xMin, xMax, yMin, yMax };
}

// Numero de viguetas: mismo criterio que el discretizador (max(1, round(B/intereje))).
// El max(1,…) garantiza >=1 linea aunque el paño sea mas estrecho que el intereje (un
// paño sin rayado perderia la lectura de la direccion, y el modelo si monta 1 vigueta).
export function numeroViguetas(ancho: number, intereje: number): number {
  if (!(ancho > 0) || !(intereje > 0)) return 0;
  return Math.max(1, Math.round(ancho / intereje));
}

// Construye los vertices del rayado como pares consecutivos (x0,y0,x1,y1,...) listos para
// `lineSegments` (NO line-strip): para n lineas emite n segmentos = n*2 puntos = n*4
// numeros. SIN coord Z (la pone el componente al posicionar el group a la cota). Devuelve
// [] si el contorno no resuelve un rectangulo con area (degenerado): sin rayado, sin
// romper el render (el discretizador ya emite el error de obra).
//
// - direccion "x": lineas paralelas al eje X (de xMin a xMax); reparto en Y (ancho B =
//   yMax-yMin); linea k en y = yMin + s·(k+½).
// - direccion "y": simetrico (lineas de yMin a yMax; reparto en X).
export function verticesRayado(e: EntradaRayado): number[] {
  const b = bbox(e.contorno);
  if (!b) return [];
  const { xMin, xMax, yMin, yMax } = b;
  const anchoX = xMax - xMin;
  const anchoY = yMax - yMin;
  if (!(anchoX > 0) || !(anchoY > 0)) return []; // degenerado: sin area

  const out: number[] = [];
  if (e.direccion === "x") {
    // Reparto en Y; cada linea recorre X de xMin a xMax.
    const n = numeroViguetas(anchoY, e.intereje);
    if (n === 0) return [];
    const s = anchoY / n;
    for (let k = 0; k < n; k++) {
      const y = yMin + s * (k + 0.5);
      out.push(xMin, y, xMax, y);
    }
  } else {
    // Reparto en X; cada linea recorre Y de yMin a yMax.
    const n = numeroViguetas(anchoX, e.intereje);
    if (n === 0) return [];
    const s = anchoX / n;
    for (let k = 0; k < n; k++) {
      const x = xMin + s * (k + 0.5);
      out.push(x, yMin, x, yMax);
    }
  }
  return out;
}
