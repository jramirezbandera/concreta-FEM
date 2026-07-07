// esfuerzosBuffers: derivacion PURA de los buffers de dibujo del overlay de
// esfuerzos (cinta rellena + contorno, color por signo) a partir de la geometria
// pura. SIN React/R3F: solo `three` (Color, para los tokens) — testeable en Node.
// Lo consume EsfuerzosOverlay para montar un Mesh (triangulos) y un LineSegments.
//
// CINTA (estilo SAP2000): por cada par de estaciones consecutivas de un tramo de
// signo homogeneo se emiten DOS triangulos entre la linea base (la barra) y la
// curva de ordenadas c_k = base_k + ejeY·(v_k·escalaTotal):
//     (b_k, c_k, c_{k+1})  y  (b_k, c_{k+1}, b_{k+1})
// Los cruces por cero ya vienen INSERTADOS por la geometria (tramos de signo
// homogeneo): la cinta nunca se auto-interseca y el color por signo queda nitido.
//
// CONTORNO: la curva de ordenadas (pares c_k -> c_{k+1}, patron lineSegments de
// deformadaBuffers) mas las ordenadas de CIERRE en los extremos del tramo cuyo
// valor no sea 0 (los bordes internos de cruce tienen v=0: no generan cierre).
//
// TODO en UN solo par de buffers (relleno global + contorno global): 2 draw calls
// para toda la escena, independiente del numero de barras.
import { Color } from "three";
import { colorToken } from "../viewport/colores";
import { COLOR_OBSOLETO } from "./deformadaBuffers";
import type { GeometriaEsfuerzos } from "./esfuerzosGeometria";

// Un juego de atributos plano [x,y,z,...] + [r,g,b,...] listo para BufferGeometry.
export interface BufferPlano {
  position: Float32Array;
  color: Float32Array;
  vertices: number;
}

export interface BuffersEsfuerzos {
  relleno: BufferPlano; // triangulos (Mesh, 3 vertices por triangulo)
  contorno: BufferPlano; // pares (LineSegments)
}

export interface EntradasBuffersEsfuerzos {
  geometria: GeometriaEsfuerzos;
  // Escala TOTAL de ordenadas (m por kN | kN·m) = escalaBaseEsfuerzos × multiplicador
  // del usuario. La aplica este modulo (la geometria viaja con valores crudos).
  escalaTotal: number;
  // false = resultados obsoletos: todo gris (mismo lenguaje que la deformada).
  vigente: boolean;
}

export function construirBuffersEsfuerzos(
  e: EntradasBuffersEsfuerzos,
): BuffersEsfuerzos | null {
  const { geometria, escalaTotal, vigente } = e;
  if (geometria.diagramas.length === 0) return null;
  if (!Number.isFinite(escalaTotal) || escalaTotal <= 0) return null;

  // --- Recuento previo (dimensionar los Float32Array de una vez) ---------------
  let nRelleno = 0;
  let nContorno = 0;
  for (const d of geometria.diagramas) {
    for (const t of d.tramos) {
      const n = t.bases.length;
      if (n < 2) continue;
      nRelleno += 6 * (n - 1); // 2 triangulos × 3 vertices por segmento
      nContorno += 2 * (n - 1); // curva de ordenadas (pares)
      if (t.valores[0] !== 0) nContorno += 2; // cierre en el arranque del tramo
      if (t.valores[n - 1] !== 0) nContorno += 2; // cierre en el final del tramo
    }
  }
  if (nRelleno === 0) return null;

  const relleno: BufferPlano = {
    position: new Float32Array(nRelleno * 3),
    color: new Float32Array(nRelleno * 3),
    vertices: nRelleno,
  };
  const contorno: BufferPlano = {
    position: new Float32Array(nContorno * 3),
    color: new Float32Array(nContorno * 3),
    vertices: nContorno,
  };

  const colorPos = colorToken("esfuerzoPos");
  const colorNeg = colorToken("esfuerzoNeg");

  // --- Escritura ----------------------------------------------------------------
  let oR = 0; // cursor del relleno (floats)
  let oC = 0; // cursor del contorno (floats)
  const escribe = (
    buf: BufferPlano,
    o: number,
    p: readonly [number, number, number],
    c: Color,
  ): number => {
    buf.position[o] = p[0];
    buf.position[o + 1] = p[1];
    buf.position[o + 2] = p[2];
    buf.color[o] = c.r;
    buf.color[o + 1] = c.g;
    buf.color[o + 2] = c.b;
    return o + 3;
  };

  for (const d of geometria.diagramas) {
    const [ex, ey, ez] = d.ejeY;
    for (const t of d.tramos) {
      const n = t.bases.length;
      if (n < 2) continue;
      const c = vigente ? (t.signo > 0 ? colorPos : colorNeg) : COLOR_OBSOLETO;

      // Curva de ordenadas del tramo: c_k = b_k + ejeY·(v_k·escalaTotal).
      const curva: Array<[number, number, number]> = t.bases.map((b, k) => {
        const h = t.valores[k]! * escalaTotal;
        return [b[0] + ex * h, b[1] + ey * h, b[2] + ez * h];
      });

      for (let k = 0; k < n - 1; k++) {
        const b0 = t.bases[k]!;
        const b1 = t.bases[k + 1]!;
        const c0 = curva[k]!;
        const c1 = curva[k + 1]!;
        // Relleno: (b0, c0, c1) + (b0, c1, b1). En los cortes (v=0) uno de los
        // triangulos degenera a linea: invisible e inocuo.
        oR = escribe(relleno, oR, b0, c);
        oR = escribe(relleno, oR, c0, c);
        oR = escribe(relleno, oR, c1, c);
        oR = escribe(relleno, oR, b0, c);
        oR = escribe(relleno, oR, c1, c);
        oR = escribe(relleno, oR, b1, c);
        // Contorno: segmento de curva.
        oC = escribe(contorno, oC, c0, c);
        oC = escribe(contorno, oC, c1, c);
      }
      // Ordenadas de cierre solo donde el tramo NO muere en 0 (extremos de barra
      // con esfuerzo; los bordes de cruce interno tienen v=0 y no cierran).
      if (t.valores[0] !== 0) {
        oC = escribe(contorno, oC, t.bases[0]!, c);
        oC = escribe(contorno, oC, curva[0]!, c);
      }
      if (t.valores[n - 1] !== 0) {
        oC = escribe(contorno, oC, t.bases[n - 1]!, c);
        oC = escribe(contorno, oC, curva[n - 1]!, c);
      }
    }
  }

  return { relleno, contorno };
}
