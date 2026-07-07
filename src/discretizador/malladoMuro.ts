// Mallado PURO de un MURO/pantalla (F3): plano VERTICAL entre dos cotas. Es el hermano
// vertical de mallado.ts (losa): misma rejilla tensorial (`planificarRejilla`, fuente
// unica), mismos criterios de determinismo y celda [M-4], nudos PROPIOS del muro
// (prefijo MQ<idx>); el ACOPLE al portico (remapear un nudo de malla a un N*) lo hace
// el discretizador/acople, no este modulo. PURO: sin React, sin IO, sin Pyodide.
//
// --- Geometria y convencion de ejes ------------------------------------------
// El muro es un segmento del EJE en planta (p1-p2, coords de obra) ALINEADO con un eje
// (paralelo a obra-X o a obra-Y; diagonal = deuda T-muro-diagonal), extruido en vertical
// de cotaBase a cotaTope. El plano del muro se parametriza (s, cota):
//   - s    = coordenada a lo largo del eje, ASCENDENTE (se normaliza min->max: la rejilla
//            es independiente del orden de clic de p1/p2 — determinismo byte a byte).
//   - cota = vertical global (FEM Y), ascendente.
// Muro segun X: nudo (s,cota) -> mapearEjes(s, yFijo, cota) = [s, cota, yFijo].
// Muro segun Y: nudo (s,cota) -> mapearEjes(xFijo, s, cota) = [xFijo, cota, s].
//
// ORDEN CANONICO DE UN QUAD i,j,m,n:
//   i=(col,fila) j=(col+1,fila) m=(col+1,fila+1) n=(col,fila+1), col = s asc, fila = cota asc.
// El spike (muro_membrana_spike.md) PINNA que este orden da y_local = +Y (VERTICAL) en
// AMBAS orientaciones (fuente Quad3D: x_local=i->j, z=x×(i->n), y=z×x) => la Sy de
// membrana es SIEMPRE la tension normal vertical. NO cambiar el orden sin re-spikear.
//
// --- Filas y columnas MANDATORIAS ---------------------------------------------
// - `cotasControl` (cotas de PLANTAS intermedias que el muro cruza): fila de nudos EXACTA
//   en cada una -> el acople puede remapear/subdividir contra las vigas de ese forjado.
//   Espejo vertical de las lineas de control de pilar de la losa plana.
// - `lineasControlS` (s de PILARES sobre el eje del muro): columna de nudos EXACTA en cada
//   una -> el nudo de la fila de cota de planta cae en la MISMA celda 3D que el N* del
//   pilar (que `cotasDePilar` ya crea) y el remap por celda lo funde.
//
// --- Estabilizacion: NO se ofrece ----------------------------------------------
// A diferencia de la losa (muleta DX/DZ), el muro NO lleva estabilizacion de plano: con
// base vinculada (fila base empotrada 6 GDL, spike P3: reacciones parasitas = 0.0) los
// modos rigidos quedan fijos; sin base, validaciones exige acople suficiente
// (MURO_SIN_SUJECION, >=3 puntos no colineales en (s,cota)). Una muleta aqui robaria
// carga lateral real — exactamente lo que el muro viene a aportar.
import { mapearEjes, cuantizar } from "./geometria";
import {
  planificarRejilla,
  TOL_GEOM,
  type NodoMalla,
  type QuadMalla,
  type LimitesRectangulo,
} from "./mallado";

// Tolerancia geometrica (m) para "segmento degenerado" y "alineado con un eje":
// la MISMA que usa la losa para su rectangulo (fuente unica en mallado.ts).
const TOL_GEOM_MURO = TOL_GEOM;

// Punto del eje del muro en planta (coords de obra). Espejo de PuntoPlano de mallado.
export type PuntoEjeMuro = { x: number; y: number };

// Error de geometria/mallado de muro, en lenguaje de obra (espejo de ErrorMallado).
export type ErrorMalladoMuro = {
  codigo: "MURO_DEGENERADO" | "MURO_NO_ALINEADO" | "MURO_DEMASIADO_DENSO";
  mensaje: string;
};

export type MallaMuro = {
  nodos: NodoMalla[];
  quads: QuadMalla[];
  // Rejilla de NOMBRES por fila (fila-major: porFila[fila][col]). Da acceso barato a
  // filaBase = porFila[0], filaTope = porFila[ny] y columnas de extremo sin recomputar
  // el naming. Los consumidores (acople, emisor 6e, CR) trabajan sobre esta topologia.
  porFila: string[][];
  // Coordenadas del plano del muro: ss (a lo largo del eje, ascendente) y cotas
  // (vertical, ascendente). nodos = ss.length * cotas.length; el nudo porFila[f][c]
  // esta en (ss[c], cotas[f]).
  ss: number[];
  cotas: number[];
  // Filas cuya cota es MANDATORIA de planta, indexadas por cota CUANTIZADA [M-4]:
  // cotaBase, cada cotasControl saneada y cotaTope. Es lo que consulta el acople para
  // casar el muro con las vigas de cada forjado (la clave cuantizada es el UNICO
  // criterio valido de "misma cota").
  filaPorCotaQ: Map<number, number>;
  // Orientacion resuelta del eje: "x" (paralelo a obra-X) o "y" (paralelo a obra-Y),
  // y la coordenada de obra FIJA del plano (y de obra si eje="x"; x de obra si eje="y").
  eje: "x" | "y";
  coordFija: number;
  nx: number; // celdas a lo largo del eje
  ny: number; // celdas en vertical
  tamMallaEfectivo: number;
  capAplicado: boolean;
  aspectoRelajado: boolean;
};

export type ResultadoMalladoMuro =
  | { ok: true; malla: MallaMuro }
  | { ok: false; error: ErrorMalladoMuro };

export type ParametrosMalladoMuro = {
  p1: PuntoEjeMuro;
  p2: PuntoEjeMuro;
  cotaBase: number;
  cotaTope: number;
  tamMalla: number; // m, objetivo (puede elevarse por el cap)
  indiceMuro: number; // >=0, para el prefijo de nombres del muro
  // Cotas de plantas INTERMEDIAS que el muro cruza (fila mandatoria en cada una).
  // El llamante (acople) las deriva de modelo.plantas; aqui se sanean por celda
  // (dedup, dentro del intervalo abierto) igual que las lineas de control de losa.
  cotasControl?: readonly number[];
  // Coordenadas s (a lo largo del eje, en la MISMA dimension de obra que el eje
  // resuelto) de pilares sobre el eje del muro (columna mandatoria en cada una).
  lineasControlS?: readonly number[];
};

// Nombre de nudo de malla del muro `m`, en la posicion de rejilla (col,fila). Prefijo
// "MQ<indiceMuro>": espacio disjunto de N* (portico), PQ* (losa) y PV* (viguetas).
function nombreNodoMuro(indiceMuro: number, col: number, fila: number, ncols: number): string {
  return `MQ${indiceMuro}-N${fila * ncols + col + 1}`;
}

// Orientacion resuelta del eje de un muro (o error de obra si degenerado/diagonal).
export type EjeMuro = { eje: "x" | "y"; sMin: number; sMax: number; coordFija: number };

// Resuelve la orientacion del segmento del eje: paralelo a obra-X, a obra-Y, o invalido.
// Criterio TOL_GEOM_MURO (espejo del criterio rectangular de losa, no la celda [M-4]:
// esto es geometria de OBRA del elemento, no snapping entre elementos).
// EXPORTADA (fuente unica): el acople la usa para derivar lineas de control ANTES de
// mallar y validaciones para emitir MURO_DEGENERADO/MURO_NO_ALINEADO en obra.
export function resolverEje(
  p1: PuntoEjeMuro,
  p2: PuntoEjeMuro,
): EjeMuro | ErrorMalladoMuro {
  const dx = Math.abs(p2.x - p1.x);
  const dy = Math.abs(p2.y - p1.y);
  if (dx <= TOL_GEOM_MURO && dy <= TOL_GEOM_MURO) {
    return {
      codigo: "MURO_DEGENERADO",
      mensaje:
        "El muro no tiene longitud: sus dos extremos coinciden. Revisa su trazado en planta.",
    };
  }
  if (dx > TOL_GEOM_MURO && dy > TOL_GEOM_MURO) {
    return {
      codigo: "MURO_NO_ALINEADO",
      mensaje:
        "El muro no es paralelo a los ejes. En esta fase solo se calculan muros alineados con los ejes X o Y de la obra.",
    };
  }
  if (dx > TOL_GEOM_MURO) {
    // Paralelo a obra-X; la y de obra queda fija (se toma la de p1: |y2-y1| <= TOL).
    return { eje: "x", sMin: Math.min(p1.x, p2.x), sMax: Math.max(p1.x, p2.x), coordFija: p1.y };
  }
  return { eje: "y", sMin: Math.min(p1.y, p2.y), sMax: Math.max(p1.y, p2.y), coordFija: p1.x };
}

// Malla un muro/pantalla rectangular en su plano vertical. Determinista y PURO. No lanza
// por geometria de obra: devuelve { ok:false, error } en lenguaje de obra. Un fallo
// inesperado (entrada mal tipada, p.ej. tamMalla <= 0) es bug del llamante y LANZA
// (misma disciplina que planificarRejilla).
export function mallarMuro(params: ParametrosMalladoMuro): ResultadoMalladoMuro {
  const { p1, p2, cotaBase, cotaTope, tamMalla, indiceMuro } = params;

  const ejeR = resolverEje(p1, p2);
  if ("codigo" in ejeR) {
    return { ok: false, error: ejeR };
  }
  const { eje, sMin, sMax, coordFija } = ejeR;

  const alto = cotaTope - cotaBase;
  if (alto <= TOL_GEOM_MURO) {
    return {
      ok: false,
      error: {
        codigo: "MURO_DEGENERADO",
        mensaje:
          "El muro no tiene desarrollo vertical: la cota de su planta final no supera la de arranque.",
      },
    };
  }

  // Rejilla tensorial: eje "X" del planificador = s (a lo largo del muro); eje "Y" del
  // planificador = cota. MISMO planificador que la losa (fuente unica: lineas de control
  // exactas, cap CAP_QUADS, mejora de aspecto). Un cap por filas/columnas mandatorias
  // (PANO_DEMASIADOS_PILARES en el planificador) se traduce al codigo de muro.
  const limites: LimitesRectangulo = { xMin: sMin, xMax: sMax, yMin: cotaBase, yMax: cotaTope };
  const plan = planificarRejilla(
    limites,
    params.lineasControlS ?? [],
    params.cotasControl ?? [],
    tamMalla,
  );
  if ("codigo" in plan) {
    return {
      ok: false,
      error: {
        codigo: "MURO_DEMASIADO_DENSO",
        mensaje:
          "El muro tiene demasiadas plantas y pilares para mallarlo con fiabilidad. Divídelo en tramos más cortos.",
      },
    };
  }
  const { xs: ss, ys: cotas, tamMallaEfectivo, capAplicado, aspectoRelajado } = plan;

  const ncols = ss.length;
  const nfilas = cotas.length;
  const nx = ncols - 1;
  const ny = nfilas - 1;

  // --- Nudos: rejilla (col x fila), col a lo largo del eje s, fila en vertical. Orden de
  // emision por filas (fila externa, col interna) -> determinista (espejo de mallarPano).
  const nodos: NodoMalla[] = [];
  const porFila: string[][] = [];
  for (let fila = 0; fila < nfilas; fila++) {
    const cota = cotas[fila];
    const filaNombres: string[] = [];
    for (let col = 0; col < ncols; col++) {
      const s = ss[col];
      const name = nombreNodoMuro(indiceMuro, col, fila, ncols);
      // Muro segun X: (x=s, y=coordFija); segun Y: (x=coordFija, y=s). La cota es la
      // vertical de la fila (no la de una planta: hay filas intermedias no mandatorias).
      const [X, Y, Z] =
        eje === "x" ? mapearEjes(s, coordFija, cota) : mapearEjes(coordFija, s, cota);
      nodos.push({ name, x: X, y: Y, z: Z });
      filaNombres.push(name);
    }
    porFila.push(filaNombres);
  }

  // --- Quads: orden canonico i,j,m,n (col=s asc, fila=cota asc) — pinado por el spike:
  // y_local = +Y (vertical) en ambas orientaciones => Sy de membrana = tension vertical.
  const quads: QuadMalla[] = [];
  for (let fila = 0; fila < ny; fila++) {
    for (let col = 0; col < nx; col++) {
      const name = `MQ${indiceMuro}-Q${fila * nx + col + 1}`;
      quads.push({
        name,
        i: porFila[fila][col],
        j: porFila[fila][col + 1],
        m: porFila[fila + 1][col + 1],
        n: porFila[fila + 1][col],
      });
    }
  }

  // --- Filas mandatorias por cota cuantizada [M-4] -----------------------------
  // Base, tope y cada cotaControl SANEADA sobreviven en `cotas` con su valor EXACTO
  // (el planificador emite las mandatorias tal cual, nunca por interpolacion). Se
  // indexa TODA fila por su celda de cota: las mandatorias se recuperan con
  // cuantizar(cotaPlanta) y las intermedias no molestan (ninguna planta casara con
  // ellas: si casara, habria sido mandatoria).
  const filaPorCotaQ = new Map<number, number>();
  for (let fila = 0; fila < nfilas; fila++) {
    filaPorCotaQ.set(cuantizar(cotas[fila]), fila);
  }

  return {
    ok: true,
    malla: {
      nodos,
      quads,
      porFila,
      ss,
      cotas,
      filaPorCotaQ,
      eje,
      coordFija,
      nx,
      ny,
      tamMallaEfectivo,
      capAplicado,
      aspectoRelajado,
    },
  };
}
