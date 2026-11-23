/**
 * Fase CO1 (`docs/fem3d/comprobaciones.md` §4.2): las demandas de los pilares.
 *
 * Una **demanda** es una sección de una pieza en una combinación, con sus seis esfuerzos
 * [N, Vy, Vz, T, My, Mz] (kN, kN·m; N > 0 tracciona; ejes locales del pilar: z según el canto h).
 * Con el sismo del programa, una combinación da las ternas de sus signos pésimos (VS-o,
 * `ternasPesimas`): una o dos demandas, ninguna simultánea.
 *
 * El contrato:
 *  - sólo se lee por `Consultas` (los tramos, `combinar` y `sup.partir`); aquí no se ve nunca un
 *    vector por caso multiplicado por un factor (`src/pruebas/factores.test.ts`);
 *  - todas las combinaciones de las situaciones de ELU (H31; con el sismo, las ternas de los
 *    cuatro extremos no bastan: `validacion/co/out_medir.txt`);
 *  - las combinaciones del generador, ya amplificadas por γz (SO): la comprobación va con β = 1.
 *    Con el segundo orden desactivado y la estructura traslacional, β = 1 no vale (`betaUno`);
 *  - los dos extremos del tramo flexible, en las caras (LV-d, RV-b), y su longitud libre entre ellas
 *    (CO-g); y su sección central, a media altura (CO1-f: la de los cercos del centro del tramo).
 */
import { conjuntoCombinaciones } from "../../agente/combinaciones.ts";
import { ternasPesimas } from "../../agente/consultas.ts";
import type { Consultas, Respuesta } from "../../compilador/consultas.ts";
import type { Material, Seccion } from "../../compilador/fisico.ts";
import type { Situacion } from "../../combinaciones/generador.ts";
import type { Diagnostico } from "../../motor/diagnosticos.ts";

/** Las situaciones de las comprobaciones resistentes (las que no hay, sin combinaciones). */
export const SITUACIONES_ELU: readonly Situacion[] = ["ELU-PT", "ELU-ACC", "ELU-SIS"];

export interface Demanda {
  /** Id de la combinación del generador. */
  comb: string;
  /** [N, Vy, Vz, T, My, Mz], kN y kN·m, en ejes locales; N > 0 tracciona. */
  esfuerzos: number[];
  /** Con el sismo del programa: los signos pésimos de la combinación, no un estado simultáneo (VS-o). */
  pesimos?: true;
}

export interface ExtremoDemandas {
  /** Coordenada del extremo del tramo flexible a lo largo del pilar, m. */
  s: number;
  demandas: Demanda[];
}

export interface DemandasTramo {
  planta: string;
  plantaBase: string;
  seccion: Seccion;
  material: Material;
  /** Giro del canto h en planta, grados desde +X. */
  giro: number;
  /** De cota a cota, m. */
  longitud: number;
  /** Del tramo flexible, entre las caras (la de la comprobación con β = 1, CO-g), m. */
  longitudLibre: number;
  base: ExtremoDemandas;
  cabeza: ExtremoDemandas;
  /** A media altura del tramo flexible (CO1-f). Sin ella, el tramo se comprueba sólo en sus extremos. */
  centro?: ExtremoDemandas;
}

export interface DemandasPilar {
  pilar: string;
  situaciones: Situacion[];
  combinaciones: number;
  /**
   * Si la comprobación puede ir con β = 1: el segundo orden global está en los esfuerzos, o la
   * estructura es intraslacional (γz ≤ 1,10). Si no, el pilar no se da por comprobado.
   */
  betaUno: boolean;
  tramos: DemandasTramo[];
}

/** Las demandas de un pilar en las combinaciones de unas situaciones (por defecto, las de ELU). */
export function demandasPilar(q: Consultas, id: string, situaciones: readonly Situacion[] = SITUACIONES_ELU): Respuesta<DemandasPilar> {
  const tr = q.pilar(id);
  if (!tr.valido) return tr;
  const cj = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: [...situaciones] });
  if (!cj.valido) return cj;
  const diagnosticos: Diagnostico[] = [...tr.diagnosticos, ...cj.diagnosticos];
  const so = q.segundoOrden({ situaciones: [...situaciones] });
  if (!so.valido) return so;
  const sinAmplificar = so.diagnosticos.find((d) => d.codigo === "segundo-orden/sin-amplificar");
  if (sinAmplificar)
    diagnosticos.push({
      codigo: "comprobacion/beta-no-vale",
      severidad: "aviso",
      mensaje: `Los pilares se comprueban con β = 1 sobre los esfuerzos amplificados por el segundo orden global, y está desactivado con la estructura traslacional: ${id} no se da por comprobado.`,
      ids: [id],
    });
  const { nombres, factores } = cj.valor;
  const extremo = (porCaso: Float64Array, s: number): ExtremoDemandas => {
    const demandas: Demanda[] = [];
    factores.forEach((f, k) => {
      if (q.sup.esLineal(f)) demandas.push({ comb: nombres[k]!, esfuerzos: Array.from(q.combinar(porCaso, 6, f)) });
      else for (const e of ternasPesimas(q.sup.partir(porCaso, 6, f))) demandas.push({ comb: nombres[k]!, esfuerzos: e, pesimos: true });
    });
    return { s, demandas };
  };
  const tramos: DemandasTramo[] = [];
  for (const t of tr.valor) {
    const seccion = q.fisico.secciones.find((x) => x.id === t.seccion);
    const material = seccion && q.fisico.materiales.find((m) => m.id === seccion.material);
    if (!seccion || !material) return { valido: false, diagnosticos: [{ codigo: "comprobacion/sin-seccion", severidad: "error", mensaje: `El tramo de ${id} en ${t.planta} no tiene la sección ${t.seccion} o su material.`, ids: [id] }] };
    tramos.push({
      planta: t.planta,
      plantaBase: t.plantaBase,
      seccion,
      material,
      giro: t.giro,
      longitud: t.longitud,
      longitudLibre: t.cabeza.s - t.base.s,
      base: extremo(t.base.esfuerzos, t.base.s),
      cabeza: extremo(t.cabeza.esfuerzos, t.cabeza.s),
      centro: extremo(t.centro.esfuerzos, t.centro.s),
    });
  }
  return { valido: true, valor: { pilar: id, situaciones: [...situaciones], combinaciones: factores.length, betaUno: !sinAmplificar, tramos }, diagnosticos };
}
