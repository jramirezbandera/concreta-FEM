/**
 * Conjuntos de combinaciones para las consultas de la capa de agente (A1): los casos sueltos, las
 * combinaciones CTE/NCSE del generador (por situación) o una combinación escrita como expresión
 * («1.35*G + 1.5*Q»). Una consulta de máximos busca en cada combinación del conjunto (el máximo
 * de una combinación no es la combinación de los máximos, cabecera de `compilador/consultas.ts`).
 *
 * Por defecto:
 * - para esfuerzos, las situaciones ELU del generador (persistente o transitoria y, si hay casos
 *   de sismo o accidentales, las suyas) si todos los casos llevan su acción; si no, los casos;
 * - para desplazamientos (flechas y deriva), la ELS característica, con la misma regla;
 * - para lo que es lineal en los casos (reacciones), los casos sueltos.
 */
import type { Situacion } from "../combinaciones/generador.ts";
import type { CasoFisico } from "../compilador/fisico.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { Consultas } from "../compilador/consultas.ts";

export interface ConjuntoCombinaciones {
  /** Qué es, en una línea («casos», «ELU-PT, ELU-SIS», «1.35*G+1.5*Q»). */
  descripcion: string;
  /** Nombre de cada combinación (el id del caso, el de la combinación del generador o la expresión). */
  nombres: string[];
  /** Etiqueta de cada una (la del generador, con sus factores) o su nombre. */
  etiquetas: string[];
  /** Factores de cada combinación, en el orden de los casos del modelo. */
  factores: Float64Array[];
}

export type Seleccion =
  | { tipo: "casos" }
  | { tipo: "situaciones"; situaciones: Situacion[] }
  /** Combinaciones escritas como expresiones lineales de los casos. */
  | { tipo: "expresiones"; expresiones: string[] };

/** «lineal»: lo que se combina linealmente (reacciones): por defecto, los casos sueltos. */
export type Proposito = "esfuerzos" | "desplazamientos" | "lineal";

type Respuesta<T> = { valido: true; valor: T; diagnosticos: Diagnostico[] } | { valido: false; diagnosticos: Diagnostico[] };

const no = <T>(codigo: string, mensaje: string): Respuesta<T> => ({ valido: false, diagnosticos: [{ codigo, severidad: "error", mensaje }] });

/** La selección por defecto para un propósito. */
export function seleccionPorDefecto(casos: readonly CasoFisico[], proposito: Proposito): Seleccion {
  if (proposito === "lineal" || !casos.length || !casos.every((c) => c.accion)) return { tipo: "casos" };
  if (proposito === "desplazamientos") return { tipo: "situaciones", situaciones: ["ELS-C"] };
  const tipos = new Set(casos.map((c) => c.accion!.tipo));
  return { tipo: "situaciones", situaciones: ["ELU-PT", ...(tipos.has("E") ? (["ELU-SIS"] as const) : []), ...(tipos.has("A") ? (["ELU-ACC"] as const) : [])] };
}

/**
 * Factores de una expresión lineal de los casos: términos «[±][número][*]caso» separados por + o −.
 * Los ids de los casos se reconocen por el más largo que encaja, así que pueden llevar guiones.
 */
export function factoresExpresion(expresion: string, ids: readonly string[]): { factores: Float64Array } | { error: string } {
  const f = new Float64Array(ids.length);
  const porLongitud = [...ids].map((id, k) => [id, k] as const).sort((a, b) => b[0].length - a[0].length);
  let i = 0;
  const t = expresion;
  const blancos = () => {
    while (i < t.length && /\s/.test(t[i]!)) i++;
  };
  let terminos = 0;
  blancos();
  while (i < t.length) {
    let signo = 1;
    if (t[i] === "+" || t[i] === "-") {
      signo = t[i] === "-" ? -1 : 1;
      i++;
      blancos();
    } else if (terminos > 0) return { error: `falta un + o un − antes de «${t.slice(i)}»` };
    let coef = 1;
    const num = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(t.slice(i));
    if (num) {
      coef = Number(num[0]);
      i += num[0].length;
      blancos();
      if (t[i] === "*" || t[i] === "·" || t[i] === "×") {
        i++;
        blancos();
      }
    }
    const caso = porLongitud.find(([id]) => t.startsWith(id, i));
    if (!caso) return { error: `«${t.slice(i)}» no empieza por el id de ningún caso (${ids.join(", ")})` };
    f[caso[1]] += signo * coef;
    i += caso[0].length;
    terminos++;
    blancos();
  }
  if (!terminos) return { error: "la expresión está vacía" };
  return { factores: f };
}

/** El conjunto de combinaciones de una selección. */
export function conjuntoCombinaciones(q: Consultas, seleccion: Seleccion): Respuesta<ConjuntoCombinaciones> {
  const casos = q.fisico.casos;
  const ids = casos.map((c) => c.id);
  if (seleccion.tipo === "casos") {
    const factores = ids.map((_, k) => {
      const f = new Float64Array(ids.length);
      f[k] = 1;
      return f;
    });
    return { valido: true, valor: { descripcion: "casos", nombres: ids, etiquetas: casos.map((c) => c.nombre ?? c.id), factores }, diagnosticos: [] };
  }
  if (seleccion.tipo === "expresiones") {
    const factores: Float64Array[] = [];
    for (const e of seleccion.expresiones) {
      const r = factoresExpresion(e, ids);
      if ("error" in r) return no("consulta/combinacion", `La combinación «${e}» no se entiende: ${r.error}.`);
      factores.push(r.factores);
    }
    return { valido: true, valor: { descripcion: seleccion.expresiones.join("; "), nombres: seleccion.expresiones, etiquetas: seleccion.expresiones, factores }, diagnosticos: [] };
  }
  const r = q.combinaciones({ situaciones: seleccion.situaciones });
  if (!r.valido) return r;
  if (!r.valor.length) return no("consulta/sin-combinaciones", `Las situaciones ${seleccion.situaciones.join(", ")} no dan ninguna combinación con estos casos.`);
  return {
    valido: true,
    valor: { descripcion: seleccion.situaciones.join(", "), nombres: r.valor.map((c) => c.id), etiquetas: r.valor.map((c) => c.etiqueta), factores: r.valor.map((c) => c.factores) },
    diagnosticos: r.diagnosticos,
  };
}
