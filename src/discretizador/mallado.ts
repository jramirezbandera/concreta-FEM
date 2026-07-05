// Mallado PURO de un paño LOSA rectangular (F3). Capa 1 -> rejilla de quads de Capa 2.
// Genera NUDOS PROPIOS del paño (prefijo PQ<idx>); el ACOPLE al portico (remapear un
// nudo de malla a un nodo estructural N* compartido) lo hace el discretizador/acople,
// no este modulo. PURO: sin React, sin IO, sin Pyodide; ejecutable y testeable en Node.
// Depende solo de ./geometria (mapearEjes para los ejes FEM; cuantizar para fundir
// lineas de control por celda, MISMO criterio de celda que el snapping [M-4] — pero
// aqui NO se snapea la posicion de los nudos al portico: se colocan en coords de obra).
//
// DETERMINISTA byte a byte: dada la misma entrada (4 nudos, cota, espesor, tamMalla,
// indice de paño, lineas de control) produce exactamente la misma rejilla, en el mismo
// orden, sin azar. La numeracion de nudos/quads es local al paño con prefijo por indice.
//
// --- Geometria y convencion de ejes ------------------------------------------
// El paño es un rectangulo ALINEADO con los ejes de obra (lados paralelos a X y a Y de
// planta). La UI lo introduce con 4 clics que producen ese rectangulo; un cuadrilatero
// rotado o no rectangular se RECHAZA con error de obra.
//
// Convencion FEM Y-up (#18): la planta (x,y) -> plano horizontal global (X,Z); la cota
// es la vertical global Y. `mapearEjes(x,y,cota) = [x, cota, y]`. La losa vive en el
// plano Y = cota (horizontal); su normal es +Y (vertical). La presion de gravedad y el
// peso propio actuan en -Y (hacia abajo), signo que decide el discretizador (F1.2).
//
// --- Rejilla TENSORIAL de espaciado (uniforme O variable) --------------------
// La malla es una rejilla tensorial (nx+1)x(ny+1): dos listas de coordenadas `xs`, `ys`
// (una por eje) cuyo producto cartesiano son los nudos. `nodoEn(col,fila)`, el orden
// canonico i,j,m,n y el recorrido de borde dependen SOLO de la topologia col x fila, NO
// del espaciado. Por eso admite dos regimenes con el MISMO codigo aguas abajo:
//   - SIN lineas de control  -> `xs`/`ys` EQUIESPACIADAS (corte 1 / F3.2, byte-identico).
//   - CON lineas de control  -> `xs`/`ys` con una coord EXACTA en la x/y de cada pilar
//     bajo la losa (losa plana): asi un nudo de malla cae en la cabeza del pilar y el
//     acople lo remapea a su N*. Los huecos se subdividen para acercarse a tamMalla y
//     acotar la relacion de aspecto de los quads (protege Mx/My cerca del pilar).
//
//   obra-Y (FEM Z)
//      ^
//      |   n3 *---*--*----* (xMax,yMax)   Con una linea de control en x=col2, la columna
//      |      |   |  |    |               de nudos col2 cae EXACTA en la x del pilar; el
//      |      *---*--*----*               resto de columnas se reparten hacia tamMalla.
//      |      |   |  |    |               La topologia (addressing, CCW, borde) es la
//      |  n0  *---*--*----* n1            misma que en la rejilla uniforme.
//   (xMin,yMin)                  --> obra-X (FEM X)
//
// ORDEN CANONICO DE UN QUAD i,j,m,n (CCW visto desde +Y, hacia abajo):
//   i=(col,fila) j=(col+1,fila) m=(col+1,fila+1) n=(col,fila+1). Recorrer i->j->m->n
// gira ANTIHORARIO visto desde +Y. EL ORDEN FIJA LOS EJES LOCALES DE LA PLACA en PyNite:
// fuente de consistencia de Mx/My entre quads adyacentes (para promediar a nudos) y, con
// el signo de presion canonico, garantiza que el peso propio actue hacia abajo.
//
// --- Estabilizacion en el plano (anti-singular) -------------------------------
// Una losa apoyada SOLO en vertical deja libres los 3 modos de cuerpo rigido del plano
// horizontal X-Z (traslacion X, traslacion Z, giro alrededor de Y): la matriz seria
// SINGULAR. Se restringen DX y DZ en 2 nudos de borde NO coincidentes (esquina (0,0):
// DX+DZ; esquina (nx,0): DZ) para eliminar esos 3 GDL sin tocar DY ni los giros de
// flexion RX/RZ. Con rejilla no uniforme (nx>=1) las esquinas (0,0) y (nx,0) siguen
// siendo dos nudos distintos de la arista inferior: el criterio no cambia. La decision
// de EMITIR o no esta estabilizacion (una losa ya sujeta por el portico no la necesita)
// la toma el discretizador; el mallado siempre la ofrece.
import { mapearEjes, cuantizar } from "./geometria";

// Cap de elementos por paño (decision 4A). Una malla mas fina cuelga el WASM del solver.
// Si tamMalla diera mas de CAP_QUADS celdas, se ELEVA al minimo que respeta el cap (la
// rejilla se hace mas gruesa). Con lineas de control, el suelo es la rejilla de SOLO
// bordes + lineas de control: si ESE minimo ya supera el cap, no hay malla fiable y el
// mallado devuelve PANO_DEMASIADOS_PILARES (bloqueo, decision 4). El discretizador (F1.2)
// emite el aviso de cap en lenguaje de obra cuando `capAplicado` es true.
export const CAP_QUADS = 2000;

// Relacion de aspecto OBJETIVO de los quads (lado mayor / lado menor). Al insertar lineas
// de control aparecen huecos finos (pilar cerca de un borde) junto a huecos grandes; se
// subdividen los grandes para MEJORAR la relacion de aspecto. ATENCION: es una MEJORA de
// UNA sola pasada (los umbrales se calculan con los minimos PREVIOS a refinar de cada eje),
// NO una garantia: en franjas asimetricas (pilar cerca de una esquina) el aspecto real
// puede seguir por encima de ASPECTO_MAX. Parametro de CALIBRACION (no de contrato); la
// cota estricta y el estudio de convergencia viven en T-f3-convergencia.
const ASPECTO_MAX = 4;

// Tolerancia geometrica para "es un rectangulo alineado con los ejes" y "area ~ 0".
const TOL_GEOM = 1e-3; // m

// Coordenadas en planta de un nudo del perimetro (lo que el discretizador extrae de
// modelo.nudos para los 4 ids de `perimetro`). Solo (x,y); la cota la aporta la planta.
export type PuntoPlano = { x: number; y: number };

// Un nudo de la malla del paño, en coordenadas FEM globales (mapearEjes ya aplicado).
// `name` es propio del paño (prefijo por indice de paño), no colisiona con N1.. del portico.
export type NodoMalla = {
  name: string;
  x: number; // FEM X (= obra x)
  y: number; // FEM Y (= cota de la planta; la losa es horizontal)
  z: number; // FEM Z (= obra y)
};

// Un quad de la malla, con sus 4 nudos en orden canonico i,j,m,n (CCW desde +Y).
export type QuadMalla = {
  name: string;
  i: string;
  j: string;
  m: string;
  n: string;
};

// Restriccion de estabilizacion en el plano: que GDL del plano restringir en un nudo.
// El discretizador (F1.2) la combina con el apoyo de borde (bordeApoyo) en el mismo nodo.
export type EstabilizacionPlano = {
  node: string;
  DX: boolean;
  DZ: boolean;
};

// Resultado del mallado de un paño losa. PURO y determinista.
export type MallaPano = {
  nodos: NodoMalla[];
  quads: QuadMalla[];
  // Nombres de los nudos del BORDE (perimetro de la rejilla), en orden determinista.
  nodosBorde: string[];
  // Estabilizacion en el plano (DX/DZ): 2 nudos NO colineales del borde.
  estabilizacion: EstabilizacionPlano[];
  // nx, ny: subdivisiones efectivas (celdas por eje). nudos = (nx+1)*(ny+1), quads = nx*ny.
  nx: number;
  ny: number;
  // tamMalla efectivo (m) tras el cap. Con rejilla no uniforme es el espaciado OBJETIVO
  // (los huecos reales varian por las lineas de control y la relajacion de aspecto).
  tamMallaEfectivo: number;
  // capAplicado: true si se elevo el tamMalla objetivo para respetar CAP_QUADS (4A).
  capAplicado: boolean;
  // aspectoRelajado: true si la MEJORA de aspecto se OMITIO por completo porque aplicarla
  // habria excedido CAP_QUADS (decision 4: relajar aspecto antes de bloquear). OJO: false
  // NO significa "aspecto <= ASPECTO_MAX" (la mejora es de una pasada, no una garantia; ver
  // ASPECTO_MAX y T-f3-convergencia): solo significa "se aplico la pasada de mejora".
  aspectoRelajado: boolean;
};

// Error de geometria/mallado de paño, en lenguaje de obra (mismo contrato que ErrorObra
// del discretizador, pero el mallado es modulo hoja: devuelve el motivo y el discretizador
// lo envuelve en un ErrorObra con codigo/elementoId). `codigo` estable para tests.
export type ErrorMallado = {
  codigo: "PANO_NO_RECTANGULAR" | "PANO_DEGENERADO" | "PANO_DEMASIADOS_PILARES";
  mensaje: string;
};

export type ResultadoMallado =
  | { ok: true; malla: MallaPano }
  | { ok: false; error: ErrorMallado };

// Parametros de mallado de UN paño. `indicePano` (>=0) hace el prefijo de nombres unico
// por paño: la numeracion es determinista por su orden (el discretizador ordena por id).
export type ParametrosMallado = {
  perimetro: [PuntoPlano, PuntoPlano, PuntoPlano, PuntoPlano];
  cota: number;
  tamMalla: number; // m, objetivo (puede elevarse por el cap)
  indicePano: number; // >=0, para el prefijo de nombres del paño

  // --- Lineas de control (losa plana) --------------------------------------
  // Coordenadas de OBRA donde FORZAR una linea de rejilla, ademas de los bordes.
  // Provienen de la x/y de cada pilar bajo la huella (pilaresBajoPano). El mallado las
  // FUNDE con la rejilla (dedup por celda cuantizada) y garantiza que exista un nudo de
  // malla EXACTAMENTE en cada coord -> ese nudo remapea a la cabeza de su pilar. Vacias
  // o ausentes ⇒ malla uniforme (sin regresion). Una coord sobre/fuera del borde se
  // ignora (defensivo; el llamante ya filtro por huella).
  lineasControlX?: readonly number[];
  lineasControlY?: readonly number[];
};

// --- Implementacion -----------------------------------------------------------

// Limites del rectangulo de un paño. Tipo nombrado porque lo consumen tambien el
// acople paño<->portico (acople.ts) y el centro de masas (centros.ts).
export type LimitesRectangulo = { xMin: number; xMax: number; yMin: number; yMax: number };

// Comprueba que los 4 puntos forman un rectangulo ALINEADO con los ejes de obra y
// devuelve sus limites (xMin,xMax,yMin,yMax). Criterio:
//   - bounding box no degenerado: ancho y alto > TOL_GEOM (area > 0).
//   - cada uno de los 4 puntos coincide (a < TOL_GEOM) con una esquina DISTINTA del
//     bounding box: garantiza rectangulo alineado, sin puntos repetidos ni rotacion.
// No exige un orden de recorrido concreto del perimetro (acepta CW o CCW de entrada).
// EXPORTADA: es la FUENTE UNICA del bbox de un paño; el acople y el CM de paños la usan.
export function limitesRectangulo(
  pts: readonly PuntoPlano[],
): LimitesRectangulo | ErrorMallado {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const ancho = xMax - xMin;
  const alto = yMax - yMin;
  if (ancho <= TOL_GEOM || alto <= TOL_GEOM) {
    return {
      codigo: "PANO_DEGENERADO",
      mensaje:
        "El paño no tiene superficie: sus puntos no forman un rectángulo con área. Revisa su contorno.",
    };
  }
  // Las 4 esquinas del bounding box. Cada punto de entrada debe casar con una distinta.
  const esquinas = [
    { x: xMin, y: yMin },
    { x: xMax, y: yMin },
    { x: xMax, y: yMax },
    { x: xMin, y: yMax },
  ];
  const casadas = new Set<number>();
  for (const p of pts) {
    let casa = -1;
    for (let k = 0; k < esquinas.length; k++) {
      if (
        !casadas.has(k) &&
        Math.abs(p.x - esquinas[k].x) <= TOL_GEOM &&
        Math.abs(p.y - esquinas[k].y) <= TOL_GEOM
      ) {
        casa = k;
        break;
      }
    }
    if (casa === -1) {
      return {
        codigo: "PANO_NO_RECTANGULAR",
        mensaje:
          "El paño no es un rectángulo alineado con los ejes. En esta fase solo se calculan losas rectangulares.",
      };
    }
    casadas.add(casa);
  }
  return { xMin, xMax, yMin, yMax };
}

// Calcula las subdivisiones (nx,ny) UNIFORMES para un tamMalla objetivo y aplica el cap
// (4A). Estrategia: partir del numero "natural" de celdas (ceil(L/tam), >=1); si el
// producto supera CAP_QUADS, ELEVAR el tamMalla al minimo que lo respeta. Determinista.
// Se conserva INTACTA (la usa el camino uniforme, byte-identico al corte 1/F3.2).
function calcularSubdivisiones(
  ancho: number,
  alto: number,
  tamMalla: number,
): { nx: number; ny: number; tamMallaEfectivo: number; capAplicado: boolean } {
  const nxNatural = Math.max(1, Math.ceil(ancho / tamMalla));
  const nyNatural = Math.max(1, Math.ceil(alto / tamMalla));
  if (nxNatural * nyNatural <= CAP_QUADS) {
    return { nx: nxNatural, ny: nyNatural, tamMallaEfectivo: tamMalla, capAplicado: false };
  }
  let tam = tamMalla * Math.sqrt((nxNatural * nyNatural) / CAP_QUADS);
  let nx = Math.max(1, Math.ceil(ancho / tam));
  let ny = Math.max(1, Math.ceil(alto / tam));
  let guardia = 0;
  while (nx * ny > CAP_QUADS && guardia < 10000) {
    tam *= 1.01;
    nx = Math.max(1, Math.ceil(ancho / tam));
    ny = Math.max(1, Math.ceil(alto / tam));
    guardia += 1;
  }
  return { nx, ny, tamMallaEfectivo: tam, capAplicado: true };
}

// --- Rejilla no uniforme (lineas de control, losa plana) ----------------------

// Sanea las lineas de control de UN eje: filtra a estrictamente DENTRO de (min,max) por
// celda cuantizada (una linea sobre el borde es redundante) y funde por celda (dedup),
// conservando la coord REAL (la primera por orden ascendente) para que el nudo caiga en
// la posicion del pilar. `cuantizar` (no |Δ|<TOL) hace la fusion determinista [M-4].
function sanearLineasControl(
  min: number,
  max: number,
  lineas: readonly number[],
): number[] {
  const qMin = cuantizar(min);
  const qMax = cuantizar(max);
  const candidatas = lineas
    .filter((c) => Number.isFinite(c) && cuantizar(c) > qMin && cuantizar(c) < qMax)
    .sort((a, b) => a - b);
  const out: number[] = [];
  let ultimaCelda: number | null = null;
  for (const c of candidatas) {
    const q = cuantizar(c);
    if (q === ultimaCelda) continue; // misma celda que la anterior: fusion
    ultimaCelda = q;
    out.push(c);
  }
  return out;
}

// FUENTE UNICA de la regla de subdivision de un segmento de longitud `longitud` hacia el
// espaciado objetivo `h`: nº de celdas en que se parte. El `Math.max(1, ...)` es PORTANTE
// (round(longitud/h) puede ser 0 para un segmento < h/2: un segmento nunca desaparece). La
// consumen el conteo (proyeccion del cap) y la construccion del array (construirEjeRejilla):
// asi la proyeccion del cap y la rejilla realmente emitida NO pueden divergir.
function celdasDeSegmento(longitud: number, h: number): number {
  return Math.max(1, Math.round(longitud / h));
}

// Nº de celdas de un eje para un espaciado objetivo h, SIN construir el array (barato,
// para el bucle del cap). `mand` incluye min, max y lineas de control (ORDENADO).
function contarCeldasEje(mand: readonly number[], h: number): number {
  let n = 0;
  for (let i = 0; i < mand.length - 1; i++) n += celdasDeSegmento(mand[i + 1] - mand[i], h);
  return n;
}

// Construye el array de coords de UN eje: por cada segmento entre coords MANDATORIAS
// consecutivas (min, lineas de control, max), inserta intermedias para acercarse a h.
// Las coords mandatorias se emiten EXACTAS (se empujan directamente, nunca por
// interpolacion): garantiza un nudo de malla en cada linea de control == cabeza de
// pilar, y que su clave de celda case con el N* del pilar [M-4]. PURA.
function construirEjeRejilla(mand: readonly number[], h: number): number[] {
  const coords: number[] = [mand[0]];
  for (let i = 0; i < mand.length - 1; i++) {
    const a = mand[i];
    const b = mand[i + 1];
    const n = celdasDeSegmento(b - a, h); // MISMA regla que contarCeldasEje (fuente unica)
    for (let k = 1; k < n; k++) coords.push(a + ((b - a) * k) / n);
    coords.push(b); // coord mandatoria EXACTA (linea de control o borde)
  }
  return coords;
}

// Hueco minimo entre coords consecutivas (para el umbral de aspecto del otro eje).
function huecoMinimo(coords: readonly number[]): number {
  let m = Infinity;
  for (let i = 0; i < coords.length - 1; i++) m = Math.min(m, coords[i + 1] - coords[i]);
  return m;
}

// FUENTE UNICA de en cuantas celdas se parte un hueco para respetar `maxHueco`. `ceil` de un
// positivo ya es >=1 (por eso, a diferencia de `celdasDeSegmento`, NO necesita `max(1,...)`):
// un hueco <= maxHueco da 1 (no se subdivide). La consumen el conteo (guarda anti-explosion)
// y la construccion (refinarAspecto): no pueden divergir. Asume maxHueco > 0 (el llamante guarda).
function celdasDeHueco(hueco: number, maxHueco: number): number {
  return Math.ceil(hueco / maxHueco);
}

// Nº de celdas que produciria refinarAspecto SIN construir el array (guarda anti-explosion:
// un hueco fino en el otro eje podria pedir una subdivision enorme; se cuenta antes).
function contarCeldasTrasAspecto(coords: readonly number[], maxHueco: number): number {
  if (!(maxHueco > 0) || !Number.isFinite(maxHueco)) return coords.length - 1;
  let n = 0;
  for (let i = 0; i < coords.length - 1; i++) n += celdasDeHueco(coords[i + 1] - coords[i], maxHueco);
  return n;
}

// Mejora de aspecto: subdivide cualquier hueco de `coords` que exceda `maxHueco`, preservando
// EXACTAS las coords existentes (mandatorias + intermedias: cada coords[i+1] se empuja tal
// cual). PURA. MISMA regla de conteo que contarCeldasTrasAspecto (fuente unica celdasDeHueco).
function refinarAspecto(coords: readonly number[], maxHueco: number): number[] {
  if (!(maxHueco > 0) || !Number.isFinite(maxHueco)) return [...coords];
  const out: number[] = [coords[0]];
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const n = celdasDeHueco(b - a, maxHueco); // 1 si el hueco ya cabe (no subdivide)
    for (let k = 1; k < n; k++) out.push(a + ((b - a) * k) / n);
    out.push(b);
  }
  return out;
}

// Plan de rejilla: las dos listas de coords + metadatos del cap/aspecto.
export type PlanRejilla = {
  xs: number[];
  ys: number[];
  tamMallaEfectivo: number;
  capAplicado: boolean;
  aspectoRelajado: boolean;
};

// Planifica la rejilla tensorial respetando lineas de control, tamMalla y CAP_QUADS.
// PRECEDENCIA (decision 4): (1) rejilla de SOLO bordes+lineas de control; si YA supera
// el cap -> PANO_DEMASIADOS_PILARES (bloqueo). (2) subdividir hacia tamMalla, engrosando
// (capAplicado) si excede el cap. (3) relajar aspecto subdividiendo huecos grandes; si
// ESO excede el cap, se OMITE (aspectoRelajado) — nunca se borra una linea de control.
// SIN lineas de control ⇒ camino uniforme IDENTICO al corte 1/F3.2. PURA. EXPORTADA para tests.
export function planificarRejilla(
  limites: LimitesRectangulo,
  lineasControlX: readonly number[],
  lineasControlY: readonly number[],
  tamMalla: number,
): PlanRejilla | ErrorMallado {
  // Entrada mal tipada = bug del llamante (validaciones y acople ya garantizan
  // tamMalla > 0 finito): se lanza ALTO en vez de colgar. Con h <= 0 el bucle de
  // insercion de construirEjeRejilla (k < celdasDeSegmento = Infinity) no termina.
  if (!(Number.isFinite(tamMalla) && tamMalla > 0)) {
    throw new Error(`planificarRejilla: tamMalla invalido (${tamMalla}); debe ser > 0`);
  }
  const { xMin, xMax, yMin, yMax } = limites;
  const ancho = xMax - xMin;
  const alto = yMax - yMin;

  const lcX = sanearLineasControl(xMin, xMax, lineasControlX);
  const lcY = sanearLineasControl(yMin, yMax, lineasControlY);

  // Camino UNIFORME (sin lineas de control): byte-identico al corte 1/F3.2. Reusa el
  // `calcularSubdivisiones` intacto y construye las coords con la MISMA expresion de
  // antes (xMin + ancho*col/nx), de modo que los nudos salen identicos.
  if (lcX.length === 0 && lcY.length === 0) {
    const { nx, ny, tamMallaEfectivo, capAplicado } = calcularSubdivisiones(
      ancho,
      alto,
      tamMalla,
    );
    // nx, ny >= 1 (calcularSubdivisiones usa Math.max(1, ...)); coords equiespaciadas con la
    // MISMA expresion que el corte 1/F3.2 -> nudos byte-identicos.
    const xs = Array.from({ length: nx + 1 }, (_, col) => xMin + (ancho * col) / nx);
    const ys = Array.from({ length: ny + 1 }, (_, fila) => yMin + (alto * fila) / ny);
    return { xs, ys, tamMallaEfectivo, capAplicado, aspectoRelajado: false };
  }

  // Camino NO UNIFORME (lineas de control). Coords mandatorias = bordes + lineas de control.
  const mandX = [xMin, ...lcX, xMax];
  const mandY = [yMin, ...lcY, yMax];

  // (1) Rejilla MINIMA (solo mandatorias). Es el suelo: engrosar no baja de aqui. Si ya
  // supera el cap, no hay malla fiable -> bloqueo (decision 4).
  const nMin = (mandX.length - 1) * (mandY.length - 1);
  if (nMin > CAP_QUADS) {
    return {
      codigo: "PANO_DEMASIADOS_PILARES",
      mensaje:
        "El paño tiene demasiados pilares para mallarlo con fiabilidad. Divídelo en varios paños más pequeños siguiendo las alineaciones de pilares.",
    };
  }

  // (2) Espaciado objetivo: parte de tamMalla, engrosa si la rejilla a tamMalla excede el
  // cap. Converge porque el suelo (nMin) esta bajo el cap.
  let h = tamMalla;
  let capAplicado = false;
  let guardia = 0;
  while (
    contarCeldasEje(mandX, h) * contarCeldasEje(mandY, h) > CAP_QUADS &&
    guardia < 10000
  ) {
    h *= 1.05;
    capAplicado = true;
    guardia += 1;
  }
  let xs = construirEjeRejilla(mandX, h);
  let ys = construirEjeRejilla(mandY, h);

  // (3) MEJORA de aspecto (una pasada): subdividir huecos grandes para REDUCIR el aspecto de
  // los quads. Los umbrales usan los minimos PREVIOS a refinar de cada eje, asi que NO
  // garantiza aspecto <= ASPECTO_MAX en franjas asimetricas (mejora, no cota; ver ASPECTO_MAX
  // y T-f3-convergencia). Se cuenta ANTES de construir (guarda anti-explosion); si excederia
  // el cap, se OMITE por completo (aspectoRelajado). Determinista.
  let aspectoRelajado = false;
  const maxHuecoX = ASPECTO_MAX * huecoMinimo(ys);
  const maxHuecoY = ASPECTO_MAX * huecoMinimo(xs);
  const celdasX = contarCeldasTrasAspecto(xs, maxHuecoX);
  const celdasY = contarCeldasTrasAspecto(ys, maxHuecoY);
  if (celdasX * celdasY <= CAP_QUADS) {
    xs = refinarAspecto(xs, maxHuecoX);
    ys = refinarAspecto(ys, maxHuecoY);
  } else {
    aspectoRelajado = true; // el aspecto objetivo excederia el cap: se deja la rejilla base
  }

  return { xs, ys, tamMallaEfectivo: h, capAplicado, aspectoRelajado };
}

// Nombre de nudo de malla del paño `p`, en la posicion de rejilla (col,fila). Prefijo
// "PQ<indicePano>" + "-N" + indice lineal: propio del paño, sin colision con N1.. del portico.
function nombreNodo(indicePano: number, col: number, fila: number, ncols: number): string {
  return `PQ${indicePano}-N${fila * ncols + col + 1}`;
}

// Malla un paño losa rectangular. Determinista y PURO. No lanza por geometria de obra:
// devuelve { ok:false, error } en lenguaje de obra (rectangulo / area / demasiados
// pilares). Un fallo inesperado (entrada mal tipada) seria un bug del llamante.
export function mallarPano(params: ParametrosMallado): ResultadoMallado {
  const { perimetro, cota, tamMalla, indicePano } = params;

  const limites = limitesRectangulo(perimetro);
  if ("codigo" in limites) {
    return { ok: false, error: limites };
  }

  const plan = planificarRejilla(
    limites,
    params.lineasControlX ?? [],
    params.lineasControlY ?? [],
    tamMalla,
  );
  if ("codigo" in plan) {
    return { ok: false, error: plan };
  }
  const { xs, ys, tamMallaEfectivo, capAplicado, aspectoRelajado } = plan;

  const ncols = xs.length; // nudos por fila
  const nfilas = ys.length;
  const nx = ncols - 1;
  const ny = nfilas - 1;

  // --- Nudos: rejilla (col x fila), col a lo largo de X (xs), fila a lo largo de Y (ys).
  // Coords FEM via mapearEjes (plano Y=cota). Orden de emision: por filas (fila externa,
  // col interna) -> determinista.
  const nodos: NodoMalla[] = [];
  const nombrePorCelda = new Map<string, string>(); // "col|fila" -> name
  for (let fila = 0; fila < nfilas; fila++) {
    const yObra = ys[fila];
    for (let col = 0; col < ncols; col++) {
      const xObra = xs[col];
      const name = nombreNodo(indicePano, col, fila, ncols);
      const [X, Y, Z] = mapearEjes(xObra, yObra, cota);
      nodos.push({ name, x: X, y: Y, z: Z });
      nombrePorCelda.set(`${col}|${fila}`, name);
    }
  }
  const nodoEn = (col: number, fila: number): string => nombrePorCelda.get(`${col}|${fila}`)!;

  // --- Quads: orden canonico i,j,m,n CCW visto desde +Y -----------------------
  const quads: QuadMalla[] = [];
  for (let fila = 0; fila < ny; fila++) {
    for (let col = 0; col < nx; col++) {
      const name = `PQ${indicePano}-Q${fila * nx + col + 1}`;
      quads.push({
        name,
        i: nodoEn(col, fila),
        j: nodoEn(col + 1, fila),
        m: nodoEn(col + 1, fila + 1),
        n: nodoEn(col, fila + 1),
      });
    }
  }

  // --- Nudos de borde: perimetro de la rejilla --------------------------------
  // Recorrido determinista del contorno: arista inferior (fila 0, col asc), derecha
  // (col nx, fila asc), superior (fila ny, col desc), izquierda (col 0, fila desc), sin
  // duplicar esquinas. El orden es estable; los consumidores dependen del CONJUNTO.
  const bordeSet = new Set<string>();
  const nodosBorde: string[] = [];
  const anadirBorde = (col: number, fila: number): void => {
    const name = nodoEn(col, fila);
    if (!bordeSet.has(name)) {
      bordeSet.add(name);
      nodosBorde.push(name);
    }
  };
  for (let col = 0; col <= nx; col++) anadirBorde(col, 0); // inferior
  for (let fila = 1; fila <= ny; fila++) anadirBorde(nx, fila); // derecha
  for (let col = nx - 1; col >= 0; col--) anadirBorde(col, ny); // superior
  for (let fila = ny - 1; fila >= 1; fila--) anadirBorde(0, fila); // izquierda

  // --- Estabilizacion en el plano (anti-singular) -----------------------------
  // DX+DZ en la esquina (0,0); DZ en la esquina (nx,0). 2 nudos NO coincidentes en la
  // arista inferior (nx>=1 garantiza que (nx,0) != (0,0)): fijan las 2 traslaciones del
  // plano + el giro alrededor de Y. Valido con rejilla uniforme o no uniforme.
  const n00 = nodoEn(0, 0);
  const nX0 = nodoEn(nx, 0);
  const estabilizacion: EstabilizacionPlano[] = [
    { node: n00, DX: true, DZ: true },
    { node: nX0, DX: false, DZ: true },
  ];

  return {
    ok: true,
    malla: {
      nodos,
      quads,
      nodosBorde,
      estabilizacion,
      nx,
      ny,
      tamMallaEfectivo,
      capAplicado,
      aspectoRelajado,
    },
  };
}
