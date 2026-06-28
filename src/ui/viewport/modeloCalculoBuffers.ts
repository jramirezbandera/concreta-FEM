// modeloCalculoBuffers: empaqueta la geometria del overlay "Ver modelo de calculo"
// (F2c) en Float32Array listos para three.js. PURO (sin three): testeable en Node.
//   - barras -> lineSegments (2 vertices por barra) con color por vertice (barra normal
//     vs barra con release).
//   - nudos  -> Points (1 vertice por nudo).
import type { SegmentoCalc } from "./modeloCalculoGeometria";
import type { Vec3Escena } from "./ejesEscena";

export type RGB = readonly [number, number, number];

export interface BuffersBarras {
  posiciones: Float32Array; // 2 * n * 3
  colores: Float32Array; // 2 * n * 3
  n: number; // nº de segmentos
}

export function buffersBarras(
  barras: readonly SegmentoCalc[],
  colBarra: RGB,
  colRelease: RGB,
): BuffersBarras {
  const n = barras.length;
  const posiciones = new Float32Array(n * 2 * 3);
  const colores = new Float32Array(n * 2 * 3);
  barras.forEach((b, k) => {
    const o = k * 6;
    posiciones[o] = b.i[0];
    posiciones[o + 1] = b.i[1];
    posiciones[o + 2] = b.i[2];
    posiciones[o + 3] = b.j[0];
    posiciones[o + 4] = b.j[1];
    posiciones[o + 5] = b.j[2];
    const c = b.conRelease ? colRelease : colBarra;
    for (let v = 0; v < 6; v += 3) {
      colores[o + v] = c[0];
      colores[o + v + 1] = c[1];
      colores[o + v + 2] = c[2];
    }
  });
  return { posiciones, colores, n };
}

export function buffersNudos(nudos: readonly Vec3Escena[]): Float32Array {
  const pos = new Float32Array(nudos.length * 3);
  nudos.forEach((p, i) => {
    pos[i * 3] = p[0];
    pos[i * 3 + 1] = p[1];
    pos[i * 3 + 2] = p[2];
  });
  return pos;
}
