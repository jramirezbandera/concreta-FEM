/**
 * Diagramas de barras en el 3D del visor (I4, `docs/fem3d/interfaz.md` §7 y §10): los de
 * `agente/render/diagramas.ts` en búferes para la GPU.
 *
 * - En los ejes locales de cada tramo (cabecera de `src/motor/modelo.ts`): My en el plano x-z
 *   (vertical en las vigas) y Mz en el x-y, del lado de las tracciones (My > 0 tracciona la fibra
 *   −z; Mz > 0, la −y); Vz, N y T hacia +z y Vy hacia +y, con la pieza leída en su sentido canónico
 *   (Z, X o Y crecientes), como en la planta.
 * - Los valores son los de `envolventeTramo`, los mismos de la planta y del alzado de la pieza; los
 *   rótulos, el máximo y el mínimo de lo que se ve (con su pieza y su combinación) y los de cada
 *   pieza, de esos mismos puntos.
 * - Escala: el mayor |valor| que se ve ocupa ORDENADA_DIAGRAMA m por la escala pedida.
 *
 * Las coordenadas, en Float32 respecto a `origen` (el del alámbrico), Z hacia arriba.
 *
 * Puro: sin IO.
 */
import type { ConjuntoCombinaciones } from "../agente/combinaciones.ts";
import { rotulo } from "../agente/render/escena.ts";
import { axilSinValor, canonico3D, combinacionEn, envolventeGuardada, extremosCurva, ORDENADA_DIAGRAMA, piezasConDiagrama, por, tramosEspacio, trozosTramo, type TramoEspacio, type V3 } from "../agente/render/diagramas.ts";
import type { PuntoEnvolvente, ResultadosRender } from "../agente/render/resultados.ts";

export const ESFUERZOS_3D = ["My", "Mz", "Vz", "Vy", "N", "T"] as const;
export type Esfuerzo3D = (typeof ESFUERZOS_3D)[number];
/** Qué piezas se dibujan. */
export type PiezasDiagrama = "todas" | "vigas" | "pilares";

const COMP: Record<Esfuerzo3D, number> = { N: 0, Vy: 1, Vz: 2, T: 3, My: 4, Mz: 5 };
export const UNIDAD_ESFUERZO: Record<Esfuerzo3D, string> = { N: "kN", Vy: "kN", Vz: "kN", T: "kN·m", My: "kN·m", Mz: "kN·m" };

/** Dirección de los valores positivos de un esfuerzo en un tramo. */
export function direccion3D(e: Esfuerzo3D, tr: TramoEspacio): V3 {
  switch (e) {
    case "My":
      return por(tr.e3, -1);
    case "Mz":
      return por(tr.e2, -1);
    case "Vy":
      return por(tr.e2, tr.signo);
    default:
      return por(tr.e3, tr.signo);
  }
}

export interface ExtremoDiagrama {
  /** «máximo» o «mínimo». */
  que: "máximo" | "mínimo";
  valor: number;
  pieza: string;
  /** Estación en la pieza (m). */
  s: number;
  /** La punta de la ordenada (m, globales): donde va el rótulo. */
  punta: V3;
  /** La combinación que lo da (sólo en los extremos de lo que se ve). */
  comb?: string;
}

export interface Diagramas3D {
  esfuerzo: Esfuerzo3D;
  unidad: string;
  origen: [number, number, number];
  /** Ordenada del mayor |valor| (m) y ese |valor|. */
  escala: { m: number; valor: number };
  /** Triángulos de los rellenos positivos y negativos (x, y, z de sus vértices respecto al origen). */
  positivo: Float32Array;
  negativo: Float32Array;
  /** Segmentos de las curvas y su signo (1 positivo, 0 negativo). */
  lineas: Float32Array;
  signoLinea: Uint8Array;
  /** El máximo y el mínimo de lo que se ve. */
  extremos: ExtremoDiagrama[];
  /** Los de cada pieza que se ve (para rotular las elegidas). */
  piezas: { id: string; tipo: TramoEspacio["tipo"]; max: ExtremoDiagrama | null; min: ExtremoDiagrama | null }[];
  /** El eje de cada tramo que se ve (i', j' respecto al origen), su pieza (índice en `piezas`) y sus estaciones s0, s1: para el valor bajo el cursor. */
  ejes: Float32Array;
  ejePieza: Uint32Array;
  ejeS: Float64Array;
  /** De qué conjunto de combinaciones sale. */
  conjunto: { descripcion: string; n: number };
  leyenda: { estilo: "diagrama-positivo" | "diagrama-negativo"; texto: string }[];
  notas: string[];
}

export interface OpcionesDiagramas3D {
  /** Sólo los de una planta (sus vigas y viguetas, y los tramos de pilar que llegan a ella); null: todos. */
  planta: string | null;
  piezas: PiezasDiagrama;
  /** Por la que se multiplica la escala automática. Por defecto, 1. */
  escala?: number;
}

const LEYENDA: Record<Esfuerzo3D, [string, string]> = {
  My: ["My > 0 (tracciona la cara −z: momento de vano), del lado de las tracciones", "My < 0, del lado de las tracciones"],
  Mz: ["Mz > 0 (tracciona la cara −y), del lado de las tracciones", "Mz < 0, del lado de las tracciones"],
  Vz: ["Vz > 0, hacia +z con la pieza leída en X, Y o Z crecientes", "Vz < 0, hacia −z"],
  Vy: ["Vy > 0, hacia +y con la pieza leída en X, Y o Z crecientes", "Vy < 0, hacia −y"],
  N: ["N > 0 (tracción), hacia +z", "N < 0 (compresión), hacia −z"],
  T: ["T > 0, hacia +z", "T < 0, hacia −z"],
};

export function diagramas3D(r: ResultadosRender, origen: [number, number, number], esfuerzo: Esfuerzo3D, conjunto: ConjuntoCombinaciones, op: OpcionesDiagramas3D): Diagramas3D {
  const comp = COMP[esfuerzo];
  const una = conjunto.factores.length === 1;
  // Los tramos que se ven, con sus curvas
  const vistos: { tr: TramoEspacio; puntos: PuntoEnvolvente[] }[] = [];
  const porPieza = new Map<string, { tr: TramoEspacio; puntos: PuntoEnvolvente[] }[]>();
  const sinAxil = new Set<string>();
  for (const id of piezasConDiagrama(r)) {
    for (const tr of tramosEspacio(r, id, canonico3D)) {
      if (op.piezas === "vigas" && tr.tipo === "pilar") continue;
      if (op.piezas === "pilares" && tr.tipo !== "pilar") continue;
      if (op.planta !== null && tr.planta !== op.planta) continue;
      if (esfuerzo === "N" && axilSinValor(r, tr)) {
        sinAxil.add(id);
        continue;
      }
      const x = { tr, puntos: envolventeGuardada(r, tr.t, conjunto, comp) };
      vistos.push(x);
      porPieza.set(id, [...(porPieza.get(id) ?? []), x]);
    }
  }
  let maxAbs = 0;
  for (const { puntos } of vistos) for (const p of puntos) maxAbs = Math.max(maxAbs, Math.abs(p.max), Math.abs(p.min));
  const m = ORDENADA_DIAGRAMA * (op.escala ?? 1);
  const k = maxAbs > 0 ? m / maxAbs : 0;

  const pos: number[] = [];
  const neg: number[] = [];
  const lin: number[] = [];
  const sl: number[] = [];
  const rel = (q: V3, a: number[]) => a.push(q[0] - origen[0], q[1] - origen[1], q[2] - origen[2]);
  for (const { tr, puntos } of vistos) {
    for (const t of trozosTramo(tr, puntos, direccion3D(esfuerzo, tr), k, una)) {
      const n = t.pies.length;
      for (let i = 0; i + 1 < n; i++) {
        rel(t.puntas[i]!, lin);
        rel(t.puntas[i + 1]!, lin);
        sl.push(t.signo > 0 ? 1 : 0);
      }
      if (!t.relleno) continue;
      const a = t.signo > 0 ? pos : neg;
      // Una tira entre el eje y la curva; y las rectas de cierre en sus extremos
      for (let i = 0; i + 1 < n; i++) {
        for (const q of [t.pies[i]!, t.pies[i + 1]!, t.puntas[i + 1]!, t.pies[i]!, t.puntas[i + 1]!, t.puntas[i]!]) rel(q, a);
      }
      for (const i of [0, n - 1]) {
        rel(t.pies[i]!, lin);
        rel(t.puntas[i]!, lin);
        sl.push(t.signo > 0 ? 1 : 0);
      }
    }
  }

  // Extremos de cada pieza y de todo lo que se ve
  const piezas: Diagramas3D["piezas"] = [];
  let gmax: { e: ExtremoDiagrama; tr: TramoEspacio } | null = null;
  let gmin: { e: ExtremoDiagrama; tr: TramoEspacio } | null = null;
  for (const [id, xs] of porPieza) {
    let pmax: { e: ExtremoDiagrama; tr: TramoEspacio } | null = null;
    let pmin: { e: ExtremoDiagrama; tr: TramoEspacio } | null = null;
    for (const { tr, puntos } of xs) {
      const ex = extremosCurva(puntos);
      const L = tr.t.s1 - tr.t.s0;
      const d = direccion3D(esfuerzo, tr);
      const punta = (s: number, v: number): V3 => {
        const f = L > 0 ? (s - tr.t.s0) / L : 0;
        return [tr.a[0] + f * (tr.b[0] - tr.a[0]) + d[0] * v * k, tr.a[1] + f * (tr.b[1] - tr.a[1]) + d[1] * v * k, tr.a[2] + f * (tr.b[2] - tr.a[2]) + d[2] * v * k];
      };
      if (ex.max && (!pmax || ex.max.v > pmax.e.valor)) pmax = { e: { que: "máximo", valor: ex.max.v, pieza: id, s: ex.max.s, punta: punta(ex.max.s, ex.max.v) }, tr };
      if (ex.min && (!pmin || ex.min.v < pmin.e.valor)) pmin = { e: { que: "mínimo", valor: ex.min.v, pieza: id, s: ex.min.s, punta: punta(ex.min.s, ex.min.v) }, tr };
    }
    piezas.push({ id, tipo: xs[0]!.tr.tipo, max: pmax?.e ?? null, min: pmin?.e ?? null });
    if (pmax && (!gmax || pmax.e.valor > gmax.e.valor)) gmax = pmax;
    if (pmin && (!gmin || pmin.e.valor < gmin.e.valor)) gmin = pmin;
  }
  const indicePieza = new Map(piezas.map((x, i) => [x.id, i]));
  const ejes = new Float32Array(6 * vistos.length);
  const ejePieza = new Uint32Array(vistos.length);
  const ejeS = new Float64Array(2 * vistos.length);
  vistos.forEach(({ tr }, i) => {
    for (let k = 0; k < 3; k++) {
      ejes[6 * i + k] = tr.a[k]! - origen[k]!;
      ejes[6 * i + 3 + k] = tr.b[k]! - origen[k]!;
    }
    ejePieza[i] = indicePieza.get(tr.pieza)!;
    ejeS[2 * i] = tr.t.s0;
    ejeS[2 * i + 1] = tr.t.s1;
  });
  const extremos: ExtremoDiagrama[] = [];
  for (const g of [gmax, gmin]) {
    // Sólo un máximo positivo y un mínimo negativo
    if (!g || (g.e.que === "máximo" ? g.e.valor <= 0 : g.e.valor >= 0)) continue;
    const comb = combinacionEn(r, g.tr.t, conjunto, comp, g.e.s, g.e.valor);
    extremos.push({ ...g.e, ...(comb ? { comb } : {}) });
  }

  const unidad = UNIDAD_ESFUERZO[esfuerzo];
  const notas = [
    `${conjunto.factores.length > 1 ? `Envolvente de ${conjunto.descripcion} (${conjunto.factores.length} combinaciones): rellena por fuera y con las dos curvas.` : `Combinación ${conjunto.etiquetas[0] ?? conjunto.nombres[0] ?? ""}.`}`,
    `Escala: ${rotulo(maxAbs)} ${unidad} = ${rotulo(m)} m. Los valores son los de las estaciones de cada diagrama (las de la planta y del alzado de la pieza).`,
    "Ejes locales de cada barra: x = de i a j; z = el canto; y = z × x (cabecera del motor).",
    ...(sinAxil.size ? [`${sinAxil.size} vigas y viguetas en el plano de un diafragma rígido, sin N: su axil no tiene valor (C1-d).`] : []),
    ...(vistos.length ? [] : ["No hay ninguna pieza que dibujar."]),
  ];
  return {
    esfuerzo,
    unidad,
    origen,
    escala: { m, valor: maxAbs },
    positivo: Float32Array.from(pos),
    negativo: Float32Array.from(neg),
    lineas: Float32Array.from(lin),
    signoLinea: Uint8Array.from(sl),
    extremos,
    piezas,
    ejes,
    ejePieza,
    ejeS,
    conjunto: { descripcion: conjunto.descripcion, n: conjunto.factores.length },
    leyenda: [
      { estilo: "diagrama-positivo", texto: LEYENDA[esfuerzo][0] },
      { estilo: "diagrama-negativo", texto: LEYENDA[esfuerzo][1] },
    ],
    notas,
  };
}
