// deformadaBuffers: derivacion PURA de los buffers de dibujo de la deformada
// (base / delta / color por vertice) a partir de la geometria pura. SIN React/R3F:
// solo `three` (Color, para la rampa) — testeable en Node. Lo consume
// DeformadaOverlay para construir el BufferGeometry y animar mutando posiciones.
//
// Se extrajo de DeformadaOverlay (antes inline) para poder cubrir con tests la
// matematica que decide color (normalizacion de rampa) y delta de animacion, y la
// ruta de "resultados obsoletos" (vigente=false), sin necesitar un render R3F.
import { Color } from "three";
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";
import { rampaIsovalores } from "../viewport/colores";
import { deformadaGeometria } from "./deformadaGeometria";

// Color de la deformada obsoleta (vigente=false): gris atenuado en vez de la rampa,
// para comunicar "estos resultados ya no corresponden al modelo" (semantica del store).
export const COLOR_OBSOLETO = new Color("#9aa4b2");

// Posiciones BASE (sin desplazar) y DELTA (desplazamiento ya en escena, a escala 1)
// por vertice, como arrays planos [x,y,z,...]; mas el color por vertice. La animacion
// combina base + delta*factor in situ sin recalcular nada de FEM.
export interface Buffers {
  base: Float32Array; // posiciones sin desplazar (escena)
  delta: Float32Array; // desplazamiento a escala 1 (escena)
  color: Float32Array; // color por vertice (rampa o gris)
  vertices: number;
}

// Entradas minimas de calculo de buffers (subconjunto de las del overlay): lo que
// determina la geometria y el color, sin estado de animacion ni de vista.
export interface EntradasBuffers {
  modeloFEM: ModeloFEM | null;
  resultados: ResultadosCalculo | null;
  combo: string | null;
  vigente: boolean;
}

// Construye los buffers desde la geometria pura. Pide la geometria a escala 1 (delta
// crudo = desplazamiento real) y a escala 0 (posiciones base); el overlay reescala el
// delta linealmente (delta(escala) = delta(1) * escala) para animar/posicionar.
//
// <lineSegments> dibuja PARES de vertices (v0-v1, v2-v3...), asi que una polilinea de
// n puntos se descompone en n-1 segmentos = 2*(n-1) vertices, DUPLICANDO los puntos
// interiores (el punto k es fin del segmento k-1 e inicio del segmento k). El total de
// vertices es la suma sobre todas las barras de 2*(n_barra - 1).
export function construirBuffers(e: EntradasBuffers): Buffers | null {
  // Geometria a escala unidad: delta crudo (desplazamiento real, sin amplificar).
  const geo1 = deformadaGeometria(e.modeloFEM, e.resultados, e.combo, 1);
  if (geo1.polilineas.length === 0) return null;
  // Geometria a escala 0: posiciones base (sin desplazar).
  const geo0 = deformadaGeometria(e.modeloFEM, e.resultados, e.combo, 0);

  // Total de vertices = suma de 2*(n-1) por polilinea (lineSegments dibuja pares).
  let n = 0;
  for (const pl of geo1.polilineas) n += 2 * (pl.puntos.length - 1);
  const base = new Float32Array(n * 3);
  const delta = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);

  const rango = geo1.magMax - geo1.magMin;
  const aux = new Color();

  // Escribe el vertice cuyo punto es `idx` de la polilinea `pl`/`pl0` en el offset `o`.
  const escribeVertice = (
    o: number,
    pl: (typeof geo1.polilineas)[number],
    pl0: (typeof geo0.polilineas)[number],
    idx: number,
  ): void => {
    const p1 = pl.puntos[idx]!; // desplazado a escala 1
    const p0 = pl0.puntos[idx]!; // base (escala 0)
    base[o] = p0[0];
    base[o + 1] = p0[1];
    base[o + 2] = p0[2];
    delta[o] = p1[0] - p0[0];
    delta[o + 1] = p1[1] - p0[1];
    delta[o + 2] = p1[2] - p0[2];
    // Color por magnitud (rampa) o gris si los resultados estan obsoletos.
    if (e.vigente) {
      const t = rango > 0 ? (pl.mags[idx]! - geo1.magMin) / rango : 0;
      rampaIsovalores(t, aux);
      color[o] = aux.r;
      color[o + 1] = aux.g;
      color[o + 2] = aux.b;
    } else {
      color[o] = COLOR_OBSOLETO.r;
      color[o + 1] = COLOR_OBSOLETO.g;
      color[o + 2] = COLOR_OBSOLETO.b;
    }
  };

  // Cursor de escritura (en floats); avanza 3 por vertice. El indice de polilinea
  // coincide entre geo1 y geo0 (mismo modeloFEM, mismo orden de members).
  let o = 0;
  geo1.polilineas.forEach((pl, i) => {
    const pl0 = geo0.polilineas[i]!;
    // Por cada segmento s emite DOS vertices (punto s y punto s+1): duplica interiores.
    for (let s = 0; s < pl.puntos.length - 1; s++) {
      escribeVertice(o, pl, pl0, s);
      o += 3;
      escribeVertice(o, pl, pl0, s + 1);
      o += 3;
    }
  });

  return { base, delta, color, vertices: n };
}
