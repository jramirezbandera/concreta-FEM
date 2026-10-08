/**
 * Resultados guardados de la capa de agente (A0): los de un cálculo válido, empaquetados en una
 * cabecera JSON y un bloque binario con los `Float64Array` de cada caso, tal cual (mismos bits).
 * Son derivados del proyecto (regla A2): la CLI los guarda en `.fem/<huella>/` y los reutiliza
 * mientras la huella no cambie.
 *
 * Puro: entra y sale texto y bytes; la CLI los escribe.
 */
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { EstadisticasCalculo, ResultadoCaso } from "../motor/modelo.ts";

export const FORMATO_RESULTADOS = "concreta-fem/resultados@1";

const CAMPOS = ["u", "reacciones", "esfuerzosBarras", "esfuerzosLaminas"] as const;

export interface CabeceraResultados {
  formato: typeof FORMATO_RESULTADOS;
  /** Huella de compilación del proyecto calculado. */
  huella: string;
  casos: { id: string; equilibrio: { fuerzas: number; momentos: number }; residuo: number }[];
  /** Longitud de cada vector de un caso; en el bloque, los de cada caso van seguidos en este orden. */
  longitudes: Record<(typeof CAMPOS)[number], number>;
  estadisticas: EstadisticasCalculo;
  /** Diagnósticos del cálculo (avisos), ya con los ids físicos. */
  diagnosticos: Diagnostico[];
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export function empaquetarResultados(huella: string, casos: readonly ResultadoCaso[], estadisticas: EstadisticasCalculo, diagnosticos: Diagnostico[]): { cabecera: CabeceraResultados; bytes: Uint8Array } {
  if (!LITTLE_ENDIAN) throw new Error("Los resultados se guardan en little-endian y esta máquina no lo es");
  const c0 = casos[0];
  const longitudes = { u: c0?.u.length ?? 0, reacciones: c0?.reacciones.length ?? 0, esfuerzosBarras: c0?.esfuerzosBarras.length ?? 0, esfuerzosLaminas: c0?.esfuerzosLaminas.length ?? 0 };
  const porCaso = CAMPOS.reduce((s, k) => s + longitudes[k], 0);
  const datos = new Float64Array(porCaso * casos.length);
  casos.forEach((c, k) => {
    let o = k * porCaso;
    for (const campo of CAMPOS) {
      if (c[campo].length !== longitudes[campo]) throw new Error(`El caso ${c.id} tiene ${c[campo].length} valores de ${campo} y el primero ${longitudes[campo]}`);
      datos.set(c[campo], o);
      o += longitudes[campo];
    }
  });
  return {
    cabecera: { formato: FORMATO_RESULTADOS, huella, casos: casos.map((c) => ({ id: c.id, equilibrio: c.equilibrio, residuo: c.residuo })), longitudes, estadisticas, diagnosticos },
    bytes: new Uint8Array(datos.buffer),
  };
}

/** Los casos de unos resultados guardados; null si la cabecera y los bytes no casan. */
export function desempaquetarResultados(cabecera: CabeceraResultados, bytes: Uint8Array): ResultadoCaso[] | null {
  if (cabecera.formato !== FORMATO_RESULTADOS || !LITTLE_ENDIAN) return null;
  const porCaso = CAMPOS.reduce((s, k) => s + cabecera.longitudes[k], 0);
  if (bytes.byteLength !== 8 * porCaso * cabecera.casos.length) return null;
  // Copia alineada: los bytes de un fichero no tienen por qué empezar en múltiplo de 8
  const datos = new Float64Array(bytes.slice().buffer);
  return cabecera.casos.map((c, k) => {
    let o = k * porCaso;
    const r = {} as Record<(typeof CAMPOS)[number], Float64Array>;
    for (const campo of CAMPOS) {
      r[campo] = datos.slice(o, o + cabecera.longitudes[campo]);
      o += cabecera.longitudes[campo];
    }
    return { id: c.id, ...r, equilibrio: c.equilibrio, residuo: c.residuo };
  });
}
