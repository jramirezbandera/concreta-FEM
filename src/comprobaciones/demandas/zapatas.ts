/**
 * Fase CO5 (`docs/fem3d/comprobaciones.md` §8.9): las demandas de las zapatas aisladas.
 *
 * La zapata no está en el modelo (CO-j): el cálculo sigue con la base del pilar empotrada, y lo que
 * llega a la zapata es la reacción de esa base (`Consultas.reacciones`, cada nudo una vez: A2-47),
 * cambiada de signo (lo que el pilar hace sobre ella). Se da:
 *
 *  - **en los ejes de la zapata,** los del tramo más bajo del pilar: x según su canto h (con giro 0,
 *    +X), y a 90°;
 *  - **en la cara inferior de la zapata,** con su canto h: la base del pilar es la cara superior, así
 *    que M = M + r × H con r = (0, 0, h) (el H·h de cada dirección, con su signo). Por eso las cargas
 *    se piden con el canto (`cargas(h)`), y la reducción va caso a caso, antes de combinar: con el
 *    sismo del programa, la amplitud de M + H·h no sale de las de M y de H;
 *  - **en todas las combinaciones** (H31): las de GEO y GEO-SIS (acciones características, para el
 *    terreno: tensiones, vuelco y deslizamiento, DB SE-C 2.3.2.2) y las de ELU-PT, ELU-ACC y ELU-SIS
 *    (para el armado y el punzonamiento), las del generador, ya amplificadas por γz;
 *  - **con el sismo del programa,** los signos pésimos (VS-o): N, Mx y My con los dos signos (8
 *    ternas: la menor compresión es la peor para el vuelco y el deslizamiento y la mayor para la
 *    presión y el armado; y en una medianera, el momento hacia el lindero aunque sea el menor en valor
 *    absoluto), y Hx y Hy con el signo que aumenta su valor absoluto. No son estados simultáneos.
 *
 * El contrato es el de las demás demandas: sólo se lee por `Consultas` (las reacciones por caso,
 * `combinar` y `sup.partir`); aquí no se aplica nunca un factor a mano (`src/pruebas/factores.test.ts`).
 */
import type { Consultas, Respuesta } from "../../compilador/consultas.ts";
import type { Material, Pilar, Seccion } from "../../compilador/fisico.ts";
import type { Vec3 } from "../../motor/modelo.ts";
import type { Situacion } from "../../combinaciones/generador.ts";
import type { Diagnostico } from "../../motor/diagnosticos.ts";
import { SITUACIONES_ELU } from "./pilares.ts";

/** Las situaciones del terreno: acciones características (DB SE-C 2.3.2.2). */
export const SITUACIONES_GEO: readonly Situacion[] = ["GEO", "GEO-SIS"];

/**
 * Lo que el pilar hace sobre la zapata en una combinación, en su cara inferior y en sus ejes: N > 0
 * comprime; Hx, Hy, kN; Mx, My, los momentos como vectores (regla de la mano derecha), kN·m.
 */
export interface CargaZapata {
  comb: string;
  situacion: Situacion;
  N: number;
  Hx: number;
  Hy: number;
  Mx: number;
  My: number;
  /** Con el sismo del programa: unos signos pésimos de la combinación, no un estado simultáneo (VS-o). */
  pesimos?: true;
}

export interface CargasZapata {
  geo: CargaZapata[];
  elu: CargaZapata[];
}

export interface DemandasZapata {
  pilar: string;
  /** La planta de la base del pilar (la cara superior de la zapata). */
  planta: string;
  /** El eje del pilar en su base (el nudo de su reacción), m. */
  punto: Vec3;
  /** Giro de los ejes de la zapata (los del canto h del pilar), grados desde +X. */
  giro: number;
  /** La sección del tramo más bajo, y sus lados según los ejes de la zapata, m (circular: su diámetro). */
  seccion: Seccion;
  material: Material | undefined;
  cx: number;
  cy: number;
  circular: boolean;
  /** Combinaciones de cada grupo de situaciones. */
  combinaciones: { geo: number; elu: number };
  /** Las cargas en la cara inferior de una zapata de canto h (m). */
  cargas(h: number): CargasZapata;
}

/** Los pilares que llevan zapata: los que tienen reacción en su base (no los apeados ni los que nacen en una losa de cimentación). */
export function pilaresConZapata(q: Consultas): string[] {
  return q.objetosReaccion().filter((o) => o.tipo === "pilar").map((o) => o.id);
}

/** La sección del tramo más bajo de un pilar (la planta de su cabeza es la de encima de `desde`). */
function seccionBase(q: Consultas, p: Pilar): Seccion | undefined {
  const plantas = q.fisico.plantas;
  const k = plantas.findIndex((x) => x.id === p.desde);
  const cabeza = k > 0 ? plantas[k - 1]!.id : undefined;
  const id = p.tramos?.find((t) => t.planta === cabeza)?.seccion ?? p.seccion;
  return q.fisico.secciones.find((s) => s.id === id);
}

/** Los lados de una sección según el canto h (x) y el ancho b (y), m; null si no es rectangular ni circular. */
function lados(s: Seccion): { cx: number; cy: number; circular: boolean } | null {
  if (s.forma === "rectangular") return { cx: s.h, cy: s.b, circular: false };
  if (s.forma === "circular") return { cx: s.D, cy: s.D, circular: true };
  return null;
}

/** Las demandas de la zapata de un pilar (un pilar con reacción en su base). */
export function demandasZapata(q: Consultas, id: string): Respuesta<DemandasZapata> {
  const p = q.fisico.pilares?.find((x) => x.id === id);
  if (!p) return { valido: false, diagnosticos: [{ codigo: "consulta/no-existe", severidad: "error", mensaje: `No hay ningún pilar «${id}».`, ids: [id] }] };
  const rr = q.reacciones(id);
  if (!rr.valido) return rr;
  const seccion = seccionBase(q, p);
  if (!seccion) return { valido: false, diagnosticos: [{ codigo: "comprobacion/sin-seccion", severidad: "error", mensaje: `El tramo más bajo de ${id} no tiene sección.`, ids: [id] }] };
  const material = q.fisico.materiales.find((m) => m.id === seccion.material);
  const l = lados(seccion);
  const diagnosticos: Diagnostico[] = [];
  const combs = (situaciones: readonly Situacion[]) => {
    const r = q.combinaciones({ situaciones });
    if (!r.valido) return r;
    diagnosticos.push(...r.diagnosticos);
    return { valido: true as const, valor: r.valor };
  };
  const cg = combs(SITUACIONES_GEO);
  if (!cg.valido) return cg;
  const ce = combs(SITUACIONES_ELU);
  if (!ce.valido) return ce;
  const giro = p.giro ?? 0;
  const t = (giro * Math.PI) / 180;
  const [c, s] = [Math.cos(t), Math.sin(t)];
  const R = rr.valor.resultante;
  const nb = R.length / 6;
  const cache = new Map<number, CargasZapata>();
  const cargas = (h: number): CargasZapata => {
    const hit = cache.get(h);
    if (hit) return hit;
    // Por caso base: [Hx, Hy, N, Mx, My, 0] sobre la zapata, en sus ejes y en su cara inferior
    const v = new Float64Array(6 * nb);
    for (let k = 0; k < nb; k++) {
      const [Fx, Fy, Fz, Mx, My] = [R[6 * k]!, R[6 * k + 1]!, R[6 * k + 2]!, R[6 * k + 3]!, R[6 * k + 4]!];
      // La carga es la reacción cambiada de signo; en los ejes de la zapata
      const Hx = -(c * Fx + s * Fy);
      const Hy = -(-s * Fx + c * Fy);
      const mx = -(c * Mx + s * My);
      const my = -(-s * Mx + c * My);
      v[6 * k] = Hx;
      v[6 * k + 1] = Hy;
      v[6 * k + 2] = Fz;
      v[6 * k + 3] = mx - h * Hy;
      v[6 * k + 4] = my + h * Hx;
    }
    const de = (lista: readonly { id: string; situacion: Situacion; factores: Float64Array }[]): CargaZapata[] => {
      const r: CargaZapata[] = [];
      for (const cb of lista) {
        if (q.sup.esLineal(cb.factores)) {
          const x = q.combinar(v, 6, cb.factores);
          r.push({ comb: cb.id, situacion: cb.situacion, N: x[2]!, Hx: x[0]!, Hy: x[1]!, Mx: x[3]!, My: x[4]! });
          continue;
        }
        const { estatica: S, sismo: A } = q.sup.partir(v, 6, cb.factores);
        const aumentado = (i: number) => S[i]! + (S[i]! >= 0 ? 1 : -1) * A[i]!;
        const signos = (i: number) => (A[i] ? [S[i]! + A[i]!, S[i]! - A[i]!] : [S[i]!]);
        const vistos = new Set<string>();
        for (const N of signos(2))
          for (const Mx of signos(3))
            for (const My of signos(4)) {
              const k = `${N}|${Mx}|${My}`;
              if (vistos.has(k)) continue;
              vistos.add(k);
              r.push({ comb: cb.id, situacion: cb.situacion, N, Hx: aumentado(0), Hy: aumentado(1), Mx, My, pesimos: true });
            }
      }
      return r;
    };
    const x = { geo: de(cg.valor), elu: de(ce.valor) };
    cache.set(h, x);
    return x;
  };
  return {
    valido: true,
    valor: {
      pilar: id,
      planta: p.desde,
      punto: rr.valor.punto,
      giro,
      seccion,
      material,
      cx: l?.cx ?? 0,
      cy: l?.cy ?? 0,
      circular: l?.circular ?? false,
      combinaciones: { geo: cg.valor.length, elu: ce.valor.length },
      cargas,
    },
    diagnosticos,
  };
}
