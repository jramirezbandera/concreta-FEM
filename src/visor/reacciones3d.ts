/**
 * Las reacciones en el 3D del visor (I4, `docs/fem3d/interfaz.md` §7 y §15): una flecha por objeto
 * con reacciones (pilar, muro, apoyo o apoyo lineal), de `fem consultar reacciones`.
 *
 * - Cada objeto, en el centro de sus nudos coartados, que es donde la consulta da su resultante: la
 *   flecha vertical con Fz y la horizontal con (Fx, Fy), en el sentido de la fuerza que el apoyo hace
 *   sobre la estructura (la punta en el punto; Fz > 0, hacia arriba). Mx, My y Mz no se dibujan: van
 *   en la tabla y bajo el cursor.
 * - Con varias combinaciones, la de mayor |Fz| de cada objeto (la primera, si empatan); con una, esa
 *   (`reaccionesObjetos`, la misma de la planta y el alzado de A4).
 * - Escalas: la mayor |Fz| ocupa ORDENADA_DIAGRAMA m por la pedida, y la mayor |(Fx, Fy)|, lo mismo
 *   con la suya (decisión del usuario tras I4: con una común, al lado de Fz no se verían).
 * - Rótulos: la mayor reacción hacia arriba y, si hay, la mayor hacia abajo (un apoyo que tira).
 *
 * Las coordenadas, en Float32 respecto a `origen` (el del alámbrico), Z hacia arriba.
 *
 * Puro: sin IO.
 */
import type { ConjuntoCombinaciones } from "../agente/combinaciones.ts";
import { ORDENADA_DIAGRAMA } from "../agente/render/diagramas.ts";
import { rotulo, type EntradaLeyenda } from "../agente/render/escena.ts";
import { COLOR_REACCION, notaCombinaciones, reaccionesObjetos, type ReaccionObjeto } from "../agente/render/reacciones.ts";
import type { ResultadosRender } from "../agente/render/resultados.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";

type V3 = [number, number, number];

export { COLOR_REACCION, type ReaccionObjeto };

export interface Reacciones3D {
  origen: [number, number, number];
  conjunto: { descripcion: string; n: number };
  /** Una flecha vertical y una horizontal por objeto (si no son nulas): segmentos del fuste y de la punta. */
  segmentos: Float32Array;
  /** 0: vertical; 1: horizontal. */
  tipoSegmento: Uint8Array;
  /** El objeto (índice en `objetos`) de cada segmento. */
  objetoSegmento: Uint32Array;
  objetos: ReaccionObjeto[];
  /** Totales de la consulta por combinación (la suma de todas las reacciones respecto al origen). */
  totales: { comb: string; F: number[]; M: number[] }[];
  /** La de las verticales: `valor` kN ocupan `m` metros. */
  escala: { m: number; valor: number };
  /** La de las horizontales, la suya. */
  escalaH: { m: number; valor: number };
  extremos: { que: "mayor hacia arriba" | "mayor hacia abajo"; valor: number; id: string; comb: string; punto: V3 }[];
  leyenda: EntradaLeyenda[];
  notas: string[];
  diagnosticos: Diagnostico[];
}

export function reacciones3D(r: ResultadosRender, origen: [number, number, number], conjunto: ConjuntoCombinaciones, escala = 1): { valido: true; valor: Reacciones3D } | { valido: false; diagnosticos: Diagnostico[] } {
  const q = reaccionesObjetos(r, conjunto);
  if (!q.valido) return q;
  const objetos = q.valor.objetos;
  let maxF = 0;
  let maxH = 0;
  for (const o of objetos) {
    maxF = Math.max(maxF, Math.abs(o.R[2]!));
    maxH = Math.max(maxH, Math.hypot(o.R[0]!, o.R[1]!));
  }
  const m = ORDENADA_DIAGRAMA * escala;
  const k = maxF > 0 ? m / maxF : 0;
  const kH = maxH > 0 ? m / maxH : 0;

  const seg: number[] = [];
  const tipo: number[] = [];
  const obj: number[] = [];
  const rel = (p: readonly number[]) => seg.push(p[0]! - origen[0], p[1]! - origen[1], p[2]! - origen[2]);
  /** La flecha de F (vector, m) que acaba en P: fuste y una punta de cuatro trazos. */
  const flecha = (P: V3, F: V3, t: number, i: number) => {
    const L = Math.hypot(F[0], F[1], F[2]);
    if (!(L > 0)) return;
    const d: V3 = [F[0] / L, F[1] / L, F[2] / L];
    const cola: V3 = [P[0] - F[0], P[1] - F[1], P[2] - F[2]];
    const poner = (a: V3, b: V3) => {
      rel(a);
      rel(b);
      tipo.push(t);
      obj.push(i);
    };
    poner(cola, P);
    // Dos perpendiculares a d, para que la punta se vea desde cualquier lado
    const ref: V3 = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    const u: V3 = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
    const lu = Math.hypot(...u);
    const n1: V3 = [u[0] / lu, u[1] / lu, u[2] / lu];
    const n2: V3 = [d[1] * n1[2] - d[2] * n1[1], d[2] * n1[0] - d[0] * n1[2], d[0] * n1[1] - d[1] * n1[0]];
    const h = Math.min(0.3 * L, 0.18 * m);
    const w = 0.4 * h;
    for (const n of [n1, n2])
      for (const s of [1, -1]) poner([P[0] - h * d[0] + s * w * n[0], P[1] - h * d[1] + s * w * n[1], P[2] - h * d[2] + s * w * n[2]], P);
  };
  objetos.forEach((o, i) => {
    flecha(o.punto, [0, 0, o.R[2]! * k], 0, i);
    flecha(o.punto, [o.R[0]! * kH, o.R[1]! * kH, 0], 1, i);
  });

  const extremos: Reacciones3D["extremos"] = [];
  if (objetos.length) {
    const arriba = objetos.reduce((a, b) => (b.R[2]! > a.R[2]! ? b : a));
    const abajo = objetos.reduce((a, b) => (b.R[2]! < a.R[2]! ? b : a));
    if (arriba.R[2]! > 0) extremos.push({ que: "mayor hacia arriba", valor: arriba.R[2]!, id: arriba.id, comb: arriba.comb, punto: arriba.punto });
    if (abajo.R[2]! < 0) extremos.push({ que: "mayor hacia abajo", valor: abajo.R[2]!, id: abajo.id, comb: abajo.comb, punto: abajo.punto });
  }
  const notas = [
    conjunto.factores.length > 1 ? `${notaCombinaciones(conjunto).slice(0, -1)} (dicha en su fila).` : notaCombinaciones(conjunto),
    `Escalas: verticales, ${rotulo(maxF)} kN = ${rotulo(m)} m; horizontales, la suya, ${rotulo(maxH)} kN = ${rotulo(m)} m (con la de Fz no se verían). Cada flecha, la resultante de la consulta «reacciones» en el centro de los nudos coartados de su objeto, en el sentido de la fuerza que el apoyo hace sobre la estructura.`,
    "Mx, My y Mz (los empotramientos), en la tabla y bajo el cursor.",
    ...(objetos.length ? [] : ["No hay objetos con reacciones."]),
  ];
  return {
    valido: true,
    valor: {
      origen,
      conjunto: { descripcion: conjunto.descripcion, n: conjunto.factores.length },
      segmentos: Float32Array.from(seg),
      tipoSegmento: Uint8Array.from(tipo),
      objetoSegmento: Uint32Array.from(obj),
      objetos,
      totales: q.valor.totales,
      escala: { m, valor: maxF },
      escalaH: { m, valor: maxH },
      extremos,
      leyenda: [
        { relleno: COLOR_REACCION.vertical, texto: "Fz: la reacción vertical (hacia arriba, positiva)" },
        { relleno: COLOR_REACCION.horizontal, texto: "(Fx, Fy): la reacción horizontal, a su propia escala" },
      ],
      notas,
      diagnosticos: q.valor.diagnosticos,
    },
  };
}
