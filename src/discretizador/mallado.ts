// Mallado PURO de un paño LOSA rectangular (F3 corte 1). Capa 1 -> rejilla de quads
// de Capa 2. AISLADO (decision 5A): genera NUDOS PROPIOS del paño; NO se snapea a los
// nudos del portico (el acoplamiento malla<->portico es un corte posterior). PURO: sin
// React, sin IO, sin Pyodide; ejecutable y testeable en Node. Solo depende de
// ./geometria (mapearEjes; aqui NO se usa clavePosicion: no hay snapping).
//
// DETERMINISTA byte a byte: dada la misma entrada (mismos 4 nudos, cota, espesor,
// tamMalla, indice de paño) produce exactamente la misma rejilla, en el mismo orden,
// sin azar. La numeracion de nudos/quads del paño es local al paño y lleva un PREFIJO
// derivado del indice del paño para no colisionar con N1.. / M1.. del portico.
//
// --- Geometria y convencion de ejes ------------------------------------------
// El paño es un rectangulo ALINEADO con los ejes de obra (lados paralelos a X y a Y de
// planta). La UI lo introduce con 4 clics que producen ese rectangulo; un cuadrilatero
// rotado o no rectangular se RECHAZA con error de obra (corte 1 = rectangulo aislado).
//
// Convencion FEM Y-up (#18): la planta (x,y) -> plano horizontal global (X,Z); la cota
// es la vertical global Y. `mapearEjes(x,y,cota) = [x, cota, y]`. La losa vive en el
// plano Y = cota (horizontal); su normal es +Y (vertical). La presion de gravedad y el
// peso propio actuan en -Y (hacia abajo), signo que decide el discretizador (F1.2).
//
// --- Diagrama del mallado (vista en planta, mirando desde +Y hacia abajo) -----
//
//   obra-Y (FEM Z)
//      ^
//      |   n3 *----*----*----* (xMax,yMax)
//      |      |    |    |    |
//      |      *----*----*----*      rejilla (nx x ny) de celdas; (nx+1)x(ny+1) nudos.
//      |      |    |    |    |      nx subdivisiones en X, ny en Y.
//      |  n0  *----*----*----* n1
//   (xMin,yMin)                  --> obra-X (FEM X)
//
//   n0=(xMin,yMin)  n1=(xMax,yMin)  n2=(xMax,yMax)  n3=(xMin,yMax)
//
// ORDEN CANONICO DE UN QUAD i,j,m,n (CCW visto desde +Y, hacia abajo):
//
//        n *--------* m        (col+1)
//          |  quad  |          i = esquina (col,   fila)      [xMin local, yMin local]
//          | (a,b)  |          j = esquina (col+1, fila)      [xMax local, yMin local]
//        i *--------* j        (col)     m = esquina (col+1, fila+1)    [xMax local, yMax local]
//          fila    fila+1                n = esquina (col,   fila+1)    [xMin local, yMax local]
//
// Recorrer i->j->m->n gira en sentido ANTIHORARIO visto desde +Y (X crece a la derecha,
// Z=obra-Y crece hacia arriba). EL ORDEN FIJA LOS EJES LOCALES DE LA PLACA en PyNite:
// es la fuente de consistencia de Mx/My entre quads adyacentes (imprescindible para
// promediar a nudos en los isovalores) y, con el signo de presion canonico, garantiza
// que el peso propio actue hacia abajo y Mx/My no se inviertan.
//
// --- Estabilizacion en el plano (anti-singular) -------------------------------
// Una losa apoyada SOLO en vertical (bordeApoyo "simple": cada nudo de borde restringe
// DY) deja libres los 3 modos de cuerpo rigido CONTENIDOS en el plano horizontal X-Z:
// traslacion en X, traslacion en Z y giro alrededor de Y. Con solo DY restringido la
// matriz de rigidez es SINGULAR (el solver no converge). Para eliminar esos 3 modos sin
// contaminar la flexion (que vive en DY + giros RX,RZ), se restringen DX y DZ en nudos
// de borde NO COLINEALES:
//   - DX y DZ en n0 (esquina xMin,yMin): fija las dos traslaciones en el plano.
//   - DZ en n1 (esquina xMax,yMin): fija el giro alrededor de Y (n0 y n1 estan en una
//     misma arista; el par DZ(n0)+DZ(n1) impide la rotacion de cuerpo rigido).
// Son 3 restricciones en el plano (DX@n0, DZ@n0, DZ@n1) sobre 3 esquinas reducidas a 2
// nudos distintos NO coincidentes: minimas y suficientes (cuerpo rigido plano = 3 GDL).
// NO tocan DY ni los giros RX/RZ -> no introducen rigidez espuria en la flexion (un
// apoyo plano no aporta momento flector a una placa que flecta en Y). Se aplican SIEMPRE
// (cualquier bordeApoyo, incluso "libre"): sin ellas la losa aislada flota en su plano.
// El discretizador (F1.2) las traduce a supports DX/DZ; el bordeApoyo gobierna DY+giros.
import { mapearEjes } from "./geometria";

// Cap de elementos por paño (decision 4A). Una malla mas fina cuelga el WASM del solver.
// Si tamMalla diera mas de CAP_QUADS celdas, se ELEVA al minimo que respeta el cap (la
// rejilla se hace mas gruesa). El discretizador (F1.2) emite el aviso en lenguaje de obra.
export const CAP_QUADS = 2000;

// Tolerancia geometrica para "es un rectangulo alineado con los ejes" y "area ~ 0".
// Reusa el mismo orden de magnitud que el snapping de nodos del portico (TOL_NODO=1e-3 m):
// dos puntos a menos de 1e-3 m se consideran el mismo. Local al modulo (no se snapea a la
// obra, asi que no se importa TOL_NODO para no insinuar acoplamiento).
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
  // El discretizador les aplica el apoyo de borde segun bordeApoyo (simple=DY;
  // empotrado=DY+giros de placa; libre=ninguno).
  nodosBorde: string[];
  // Estabilizacion en el plano (DX/DZ): 2 nudos NO colineales del borde. SIEMPRE
  // presente (independiente de bordeApoyo): sin ella la losa aislada es singular en su plano.
  estabilizacion: EstabilizacionPlano[];
  // nx, ny: subdivisiones efectivas (tras aplicar el cap). nudos = (nx+1)*(ny+1),
  // quads = nx*ny. Util para el aviso de cap del discretizador y para tests.
  nx: number;
  ny: number;
  // tamMalla efectivo (m) tras el cap. Si == tamMalla pedido, no hubo recorte.
  tamMallaEfectivo: number;
  // capAplicado: true si se elevo el tamMalla para respetar CAP_QUADS (4A); el
  // discretizador (F1.2) emite el aviso en lenguaje de obra cuando es true.
  capAplicado: boolean;
};

// Error de geometria de paño, en lenguaje de obra (mismo contrato que ErrorObra del
// discretizador, pero el mallado es modulo hoja: devuelve el motivo y el discretizador
// lo envuelve en un ErrorObra con codigo/elementoId). `codigo` estable para tests.
export type ErrorMallado = {
  codigo: "PANO_NO_RECTANGULAR" | "PANO_DEGENERADO";
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
};

// --- Implementacion -----------------------------------------------------------

// Comprueba que los 4 puntos forman un rectangulo ALINEADO con los ejes de obra y
// devuelve sus limites (xMin,xMax,yMin,yMax). Criterio (corte 1, AISLADO):
//   - bounding box no degenerado: ancho y alto > TOL_GEOM (area > 0).
//   - cada uno de los 4 puntos coincide (a < TOL_GEOM) con una esquina DISTINTA del
//     bounding box: garantiza rectangulo alineado, sin puntos repetidos ni rotacion.
// No exige un orden de recorrido concreto del perimetro (acepta CW o CCW de entrada):
// la malla SIEMPRE se emite en el orden canonico interno, independiente del de entrada.
function limitesRectangulo(
  pts: readonly PuntoPlano[],
): { xMin: number; xMax: number; yMin: number; yMax: number } | ErrorMallado {
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

// Calcula las subdivisiones (nx,ny) para un tamMalla objetivo y aplica el cap (4A).
// Estrategia del cap: partir del numero "natural" de celdas (ceil(L/tam), >=1) en cada
// direccion; si el producto supera CAP_QUADS, se ELEVA el tamMalla (rejilla mas gruesa)
// al minimo factor que lo respeta, recomputando nx,ny con ese tamMalla efectivo. Asi la
// proporcion entre lados se conserva razonablemente y el resultado es determinista.
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
  // Cap superado: hay que engrosar la malla. Buscar el tamMalla minimo (escala >1) que
  // deja nx*ny <= CAP_QUADS. El nº de celdas decrece monotonicamente al crecer el tam,
  // asi que se escala el tamMalla por el factor sqrt(celdas/CAP) y se ajusta al alza
  // hasta cumplir el cap (el ceil puede dejarlo justo por encima; el bucle lo corrige).
  let tam = tamMalla * Math.sqrt((nxNatural * nyNatural) / CAP_QUADS);
  let nx = Math.max(1, Math.ceil(ancho / tam));
  let ny = Math.max(1, Math.ceil(alto / tam));
  // Ajuste determinista: mientras se exceda el cap, engrosar un 1% mas y recomputar.
  // Converge en pocas iteraciones (el factor inicial ya deja cerca del objetivo).
  let guardia = 0;
  while (nx * ny > CAP_QUADS && guardia < 10000) {
    tam *= 1.01;
    nx = Math.max(1, Math.ceil(ancho / tam));
    ny = Math.max(1, Math.ceil(alto / tam));
    guardia += 1;
  }
  return { nx, ny, tamMallaEfectivo: tam, capAplicado: true };
}

// Nombre de nudo de malla del paño `p`, en la posicion de rejilla (col,fila).
// Prefijo "PQ<indicePano>" + "-N" + indice lineal de nudo: propio del paño, sin
// colision con N1.. del portico. Determinista por (indicePano, col, fila).
function nombreNodo(indicePano: number, col: number, fila: number, ncols: number): string {
  return `PQ${indicePano}-N${fila * ncols + col + 1}`;
}

// Malla un paño losa rectangular. Determinista y PURO. No lanza por geometria de obra:
// devuelve { ok:false, error } en lenguaje de obra (rectangulo / area). Un fallo
// inesperado (entrada mal tipada) seria un bug del llamante, no un error de obra.
export function mallarPano(params: ParametrosMallado): ResultadoMallado {
  const { perimetro, cota, tamMalla, indicePano } = params;

  const limites = limitesRectangulo(perimetro);
  if ("codigo" in limites) {
    return { ok: false, error: limites };
  }
  const { xMin, xMax, yMin, yMax } = limites;
  const ancho = xMax - xMin; // a lo largo de obra-X (FEM X)
  const alto = yMax - yMin; //  a lo largo de obra-Y (FEM Z)

  const { nx, ny, tamMallaEfectivo, capAplicado } = calcularSubdivisiones(
    ancho,
    alto,
    tamMalla,
  );

  const ncols = nx + 1; // nudos por fila
  const nfilas = ny + 1;

  // --- Nudos: rejilla (col x fila), col a lo largo de X, fila a lo largo de Y --
  // Coordenadas equiespaciadas; coords FEM via mapearEjes (plano Y=cota). Orden de
  // emision: por filas (fila externa, col interna) -> determinista.
  const nodos: NodoMalla[] = [];
  const nombrePorCelda = new Map<string, string>(); // "col|fila" -> name
  for (let fila = 0; fila < nfilas; fila++) {
    const yObra = ny === 0 ? yMin : yMin + (alto * fila) / ny;
    for (let col = 0; col < ncols; col++) {
      const xObra = nx === 0 ? xMin : xMin + (ancho * col) / nx;
      const name = nombreNodo(indicePano, col, fila, ncols);
      const [X, Y, Z] = mapearEjes(xObra, yObra, cota);
      nodos.push({ name, x: X, y: Y, z: Z });
      nombrePorCelda.set(`${col}|${fila}`, name);
    }
  }
  const nodoEn = (col: number, fila: number): string => nombrePorCelda.get(`${col}|${fila}`)!;

  // --- Quads: orden canonico i,j,m,n CCW visto desde +Y -----------------------
  // i=(col,fila) j=(col+1,fila) m=(col+1,fila+1) n=(col,fila+1). Orden de emision:
  // por celdas (fila externa, col interna) -> determinista. Nombre "PQ<idx>-Q<lineal>".
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
  // Recorrido determinista del contorno: arista inferior (fila 0, col asc), arista
  // derecha (col nx, fila asc), arista superior (fila ny, col desc), arista izquierda
  // (col 0, fila desc), sin duplicar las esquinas. El orden es estable; la UI / el
  // discretizador no dependen del orden concreto, solo del CONJUNTO.
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
  // arista inferior: fijan las 2 traslaciones del plano + el giro alrededor de Y. Como
  // siempre hay >=1 celda (nx>=1, ny>=1), (nx,0) != (0,0): nudos distintos garantizados.
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
    },
  };
}
