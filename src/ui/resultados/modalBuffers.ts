// modalBuffers: derivacion PURA de los buffers de dibujo de una FORMA MODAL (base /
// delta / color por vertice) a partir de la geometria modal pura. SIN React/R3F: solo
// `three` (Color, para la rampa) — testeable en Node. Lo consume ModoOverlay para
// construir el BufferGeometry y animar mutando posiciones. Espejo de deformadaBuffers.ts.
//
// Diferencia con la deformada: la forma modal es un SEGMENTO recto por barra (2 puntos
// = 2 vertices, lineSegments dibuja pares directamente, sin estaciones intermedias ni
// duplicados interiores). El color va por magnitud NORMALIZADA [0,1] (la forma modal es
// relativa, no fisica): no hay "obsoleta gris" condicional aqui — el `vigente` lo
// comunica el panel/overlay; el color de la forma usa siempre la rampa.
import { Color } from "three";
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosModales } from "../../solver";
import { rampaIsovalores } from "../viewport/colores";
import { modalGeometria } from "./modalGeometria";

// Posiciones BASE (sin desplazar) y DELTA (desplazamiento ya en escena, a escala 1) por
// vertice, como arrays planos [x,y,z,...]; mas el color por vertice. La animacion
// combina base + delta*factor in situ sin recalcular nada.
export interface BuffersModal {
  base: Float32Array; // posiciones sin desplazar (escena)
  delta: Float32Array; // desplazamiento a escala 1 (escena)
  color: Float32Array; // color por vertice (rampa por magnitud normalizada)
  vertices: number;
}

// Entradas minimas de calculo de buffers: lo que determina la geometria y el color.
export interface EntradasBuffersModal {
  modeloFEM: ModeloFEM | null;
  modos: ResultadosModales | null;
  numeroModo: number;
}

// Construye los buffers desde la geometria modal pura. Pide la geometria a escala 1
// (delta crudo = forma normalizada a amplitud ~1) y a escala 0 (posiciones base); el
// overlay reescala el delta linealmente (delta(escala) = delta(1) * escala) para
// animar/posicionar.
//
// <lineSegments> dibuja PARES de vertices: cada barra modal es UN segmento (nudo i ->
// nudo j) = 2 vertices. El total de vertices es 2 * nº de segmentos.
export function construirBuffersModal(e: EntradasBuffersModal): BuffersModal | null {
  // Geometria a escala unidad: delta crudo (forma normalizada, amplitud ~1).
  const geo1 = modalGeometria(e.modeloFEM, e.modos, e.numeroModo, 1);
  if (geo1.segmentos.length === 0) return null;
  // Geometria a escala 0: posiciones base (sin desplazar).
  const geo0 = modalGeometria(e.modeloFEM, e.modos, e.numeroModo, 0);

  const n = geo1.segmentos.length * 2; // 2 vertices por segmento
  const base = new Float32Array(n * 3);
  const delta = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);

  const rango = geo1.magMax - geo1.magMin;
  const aux = new Color();

  // Escribe el vertice cuyo extremo es `idx` (0=i, 1=j) del segmento `s`/`s0` en el
  // offset `o` (en floats).
  const escribeVertice = (
    o: number,
    s: (typeof geo1.segmentos)[number],
    s0: (typeof geo0.segmentos)[number],
    idx: 0 | 1,
  ): void => {
    const p1 = s.puntos[idx]; // desplazado a escala 1
    const p0 = s0.puntos[idx]; // base (escala 0)
    base[o] = p0[0];
    base[o + 1] = p0[1];
    base[o + 2] = p0[2];
    delta[o] = p1[0] - p0[0];
    delta[o + 1] = p1[1] - p0[1];
    delta[o + 2] = p1[2] - p0[2];
    // Color por magnitud normalizada (rampa). Siempre la rampa: la forma modal es
    // relativa (no hay version "fisica obsoleta" que pintar en gris).
    const t = rango > 0 ? (s.mags[idx] - geo1.magMin) / rango : 0;
    rampaIsovalores(t, aux);
    color[o] = aux.r;
    color[o + 1] = aux.g;
    color[o + 2] = aux.b;
  };

  // El indice de segmento coincide entre geo1 y geo0 (mismo modeloFEM, mismo orden de
  // members y mismo modo): podemos parearlos por indice.
  let o = 0;
  geo1.segmentos.forEach((s, i) => {
    const s0 = geo0.segmentos[i]!;
    escribeVertice(o, s, s0, 0);
    o += 3;
    escribeVertice(o, s, s0, 1);
    o += 3;
  });

  return { base, delta, color, vertices: n };
}
