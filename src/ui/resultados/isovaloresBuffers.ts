// isovaloresBuffers: derivacion PURA de los buffers de dibujo del mapa de ISOVALORES de
// la losa (posiciones + indices de triangulos + color por vertice) a partir de la malla
// de quads (Capa 2) y los resultados de placa. SIN React/R3F: solo `three` (Color, para
// la rampa) — testeable en Node. Lo consume IsovaloresOverlay para construir el
// BufferGeometry de la malla coloreada. Espejo de deformadaBuffers.ts.
//
// DE DONDE SALE LA GEOMETRIA (sin re-discretizar en el render): la malla NO esta en la
// obra (Capa 1) sino en la Capa 2 (`ModeloFEM`). El pipeline de resultados (feature-14)
// YA guarda en resultadosStore el `modeloFEM` (con `nodes` = coords de los nudos de malla)
// y la `trazabilidad` (con `quadANodos` = orden i,j,m,n de cada quad y `panoAQuads`/
// `nodosDeMalla`). El overlay lee de ahi: NO se vuelve a discretizar (mismo patron que la
// deformada, que reusa modeloFEM.nodes para las posiciones base).
//
// GOTCHA DE EJES (feature-14, load-bearing): los nudos FEM son Y-up; la escena del
// viewport es Z-up. La conversion FEM->escena (intercambio Y<->Z) vive en
// ../viewport/ejesEscena (femAEscena). NO usar mapearEjes (ese va planta->FEM).
//
// MAGNITUDES:
//  - "flecha"  = desplazamiento vertical NODAL: nodos[nudoMalla][combo].disp[1] (DY). Es
//    un valor por NUDO directo (no hay promediado).
//  - "momentoX"/"momentoY" = momento de placa Mx/My (kN·m/m), que el motor da POR QUAD en
//    sus 4 esquinas (orden i,j,m,n). Como PyNite NO da valores nodales de placa, se PROMEDIA
//    a los nudos: cada nudo recibe la MEDIA de los valores de esquina de todos los quads que
//    lo tocan. El contrato (Capa 2) garantiza ejes locales consistentes entre quads (por el
//    orden de nudos), asi que promediar Mx/My no introduce saltos. Esto es PRESENTACION (un
//    suavizado para colorear): no reimplementa FEM (regla de oro #1).
import { Color } from "three";
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";
import { rampaIsovalores } from "../viewport/colores";
import { femAEscena } from "../viewport/ejesEscena";
import type { MagnitudIsovalores } from "../../estado";

// Buffers de la malla coloreada: posiciones (x,y,z escena por vertice), indices de
// triangulos (2 por quad) y color por vertice (rampa). `valores` lleva el valor escalar
// por vertice (en su unidad: m para flecha, kN·m/m para Mx/My) para depurar/test.
export interface BuffersIsovalores {
  posiciones: Float32Array; // [x,y,z,...] en escena, 3 por vertice
  indices: Uint32Array; // 3 por triangulo (2 triangulos por quad)
  color: Float32Array; // [r,g,b,...], 3 por vertice
  valores: Float32Array; // valor escalar por vertice (presentacion)
  vertices: number;
  // Rango del valor escalar (min/max) sobre TODOS los nudos de malla pintados: alimenta
  // la leyenda y la normalizacion del color. Ambos 0 si no hay malla.
  valorMin: number;
  valorMax: number;
}

export interface EntradasIsovalores {
  modeloFEM: ModeloFEM | null;
  trazabilidad: Trazabilidad | null;
  resultados: ResultadosCalculo | null;
  combo: string | null;
  magnitud: MagnitudIsovalores;
}

// Extrae el valor escalar de una ESQUINA de quad para la magnitud de momento elegida.
// moments[esquina] = [Mx,My,Mxy]; idxComponente 0=Mx, 1=My.
function valorMomentoEsquina(
  moments: number[][],
  esquina: number,
  idxComponente: 0 | 1,
): number | null {
  const m = moments[esquina];
  if (!m) return null;
  const v = m[idxComponente];
  return typeof v === "number" ? v : null;
}

// Construye los buffers de isovalores. Maneja con gracia: sin malla (no hay quads),
// resultados null, combo inexistente, quad/nudo ausente. Nunca lanza. Devuelve null si no
// hay nada que pintar (sin quads o sin resultados de placa para el combo).
export function construirBuffersIsovalores(
  e: EntradasIsovalores,
): BuffersIsovalores | null {
  const { modeloFEM, trazabilidad, resultados, combo, magnitud } = e;
  if (!modeloFEM || !trazabilidad || !resultados || !combo) return null;
  const quads = modeloFEM.quads ?? [];
  if (quads.length === 0) return null;
  const resQuads = resultados.quads ?? {};

  // Map nombre de nudo -> posicion FEM (construido una vez).
  const posPorNudo = new Map(modeloFEM.nodes.map((n) => [n.name, n]));

  // --- Valor escalar por NUDO de malla -------------------------------------
  // Para flecha: DY nodal directo. Para Mx/My: acumulador (suma + cuenta) por nudo para
  // promediar las esquinas de los quads que lo tocan.
  const valorPorNudo = new Map<string, number>();

  if (magnitud === "flecha") {
    // DY nodal de cada nudo de malla en el combo activo. Solo nudos de malla
    // (trazabilidad.nodosDeMalla) para no mezclar con nudos estructurales.
    for (const nudo of trazabilidad.nodosDeMalla) {
      const dy = resultados.nodos[nudo]?.[combo]?.disp[1];
      if (typeof dy === "number") valorPorNudo.set(nudo, dy);
    }
  } else {
    // Mx/My: promediar las esquinas de todos los quads a sus nudos. idxComponente: Mx=0,
    // My=1.
    const idx: 0 | 1 = magnitud === "momentoX" ? 0 : 1;
    const suma = new Map<string, number>();
    const cuenta = new Map<string, number>();
    for (const quad of quads) {
      const nudos = trazabilidad.quadANodos[quad.name];
      const datos = resQuads[quad.name]?.[combo];
      if (!nudos || !datos) continue;
      // nudos = [i,j,m,n]; la esquina `pos` (0..3) se asocia al nudo del mismo indice.
      for (let pos = 0; pos < 4; pos++) {
        const nombreNudo = nudos[pos as 0 | 1 | 2 | 3];
        const v = valorMomentoEsquina(datos.moments, pos, idx);
        if (v === null) continue;
        suma.set(nombreNudo, (suma.get(nombreNudo) ?? 0) + v);
        cuenta.set(nombreNudo, (cuenta.get(nombreNudo) ?? 0) + 1);
      }
    }
    for (const [nudo, s] of suma) {
      const c = cuenta.get(nudo) ?? 1;
      valorPorNudo.set(nudo, s / c);
    }
  }

  if (valorPorNudo.size === 0) return null;

  // --- Indexado de vertices: un vertice por nudo de malla con valor ---------
  // Solo los nudos con valor entran (un quad cuyo nudo no tiene valor se omite). El
  // BufferGeometry necesita un array contiguo: asignamos un indice por nombre de nudo.
  const indicePorNudo = new Map<string, number>();
  const orden: string[] = [];
  for (const nudo of valorPorNudo.keys()) {
    indicePorNudo.set(nudo, orden.length);
    orden.push(nudo);
  }

  // Rango del valor (para normalizar color y alimentar la leyenda).
  let valorMin = Infinity;
  let valorMax = -Infinity;
  for (const v of valorPorNudo.values()) {
    if (v < valorMin) valorMin = v;
    if (v > valorMax) valorMax = v;
  }

  const nVert = orden.length;
  const posiciones = new Float32Array(nVert * 3);
  const valores = new Float32Array(nVert);
  const color = new Float32Array(nVert * 3);
  const rango = valorMax - valorMin;
  const aux = new Color();

  orden.forEach((nudo, k) => {
    const p = posPorNudo.get(nudo);
    const v = valorPorNudo.get(nudo) ?? 0;
    // FEM (Y-up) -> escena (Z-up): intercambio Y<->Z (femAEscena). Sin desplazar (la
    // losa se pinta en su plano; los isovalores son color, no relieve).
    const [ex, ey, ez] = p ? femAEscena(p.x, p.y, p.z) : [0, 0, 0];
    posiciones[k * 3] = ex;
    posiciones[k * 3 + 1] = ey;
    posiciones[k * 3 + 2] = ez;
    valores[k] = v;
    const t = rango > 0 ? (v - valorMin) / rango : 0;
    rampaIsovalores(t, aux);
    color[k * 3] = aux.r;
    color[k * 3 + 1] = aux.g;
    color[k * 3 + 2] = aux.b;
  });

  // --- Indices de triangulos: 2 por quad (i,j,m) + (i,m,n) ------------------
  // Solo se emiten los quads cuyos 4 nudos tienen vertice (todos con valor). Un quad con
  // algun nudo sin valor (no deberia tras el mallado) se omite en vez de indexar fuera de
  // rango.
  const indices: number[] = [];
  for (const quad of quads) {
    const nudos = trazabilidad.quadANodos[quad.name];
    if (!nudos) continue;
    const [i, j, m, n] = nudos;
    const ii = indicePorNudo.get(i);
    const ij = indicePorNudo.get(j);
    const im = indicePorNudo.get(m);
    const inn = indicePorNudo.get(n);
    if (ii === undefined || ij === undefined || im === undefined || inn === undefined) {
      continue;
    }
    // Dos triangulos del cuadrilatero i->j->m->n (CCW): (i,j,m) y (i,m,n).
    indices.push(ii, ij, im, ii, im, inn);
  }

  if (indices.length === 0) return null;

  return {
    posiciones,
    indices: new Uint32Array(indices),
    color,
    valores,
    vertices: nVert,
    valorMin: valorMin === Infinity ? 0 : valorMin,
    valorMax: valorMax === -Infinity ? 0 : valorMax,
  };
}
