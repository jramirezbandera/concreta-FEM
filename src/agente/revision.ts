/**
 * Revisión de un proyecto calculado (A3, regla A3 de `docs/fem3d/agente.md`): las comprobaciones de
 * sensatez (`sensatez.ts`, `sensatezResultados.ts`) y el informe (`informe.ts`), y el fichero de
 * firmas en el que el ingeniero deja constancia de que lo ha revisado.
 *
 * El fichero de firmas (`<proyecto>.revision.json`, junto al proyecto y en git) guarda, por cada
 * firma, la huella del modelo, quién firma, la fecha y el sha256 del informe en Markdown. Una firma
 * vale para su huella: si el proyecto cambia, la huella cambia y no hay firma. Si la huella es la
 * misma y el informe no (otro núcleo de cálculo, otra versión de las comprobaciones), la firma se
 * marca como de otro informe.
 *
 * Puro: la CLI lee y escribe los ficheros y calcula los sha256.
 */
import type { ResultadoCompilacion } from "../compilador/compilar.ts";
import type { Consultas } from "../compilador/consultas.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { resumen } from "./consultas.ts";
import { documentoInforme, html, markdown, type Bloque, type ReaccionBase } from "./informe.ts";
import type { Proyecto } from "./proyecto.ts";
import { sensatezModelo, type Comprobacion, type DesglosePesoPropio } from "./sensatez.ts";
import { sensatezResultados, type TramoComparado } from "./sensatezResultados.ts";

export const VERSION_FIRMAS = "concreta-fem/revision@1";

export interface Firma {
  huella: string;
  /** Quién firma (lo da el ingeniero con --por). */
  por: string;
  /** Fecha y hora ISO 8601 de la firma. */
  fecha: string;
  /** sha256 del informe en Markdown que firmó. */
  informe: string;
}

export interface FicheroFirmas {
  esquema: typeof VERSION_FIRMAS;
  firmas: Firma[];
}

export interface Revision {
  comprobaciones: Comprobacion[];
  pesoPropio: DesglosePesoPropio | null;
  tributaria: TramoComparado[];
  /** Los avisos de sensatez, en el orden de las comprobaciones. */
  avisos: Diagnostico[];
  documento: Bloque[];
  markdown: string;
  html: string;
}

/**
 * Comprueba y arma el informe. `q`: las consultas del cálculo de `c`; `diagnosticos`, los avisos de
 * la compilación y del cálculo; `equilibrio`, el de cada caso.
 */
export function revisar(
  p: Proyecto,
  c: Extract<ResultadoCompilacion, { valido: true }>,
  q: Consultas,
  datos: { motor: string; diagnosticos: readonly Diagnostico[]; equilibrio: readonly { id: string; fuerzas: number; momentos: number }[]; ficheroFirmas: string },
): Revision {
  const res = resumen(p, c);
  if (!res.valido) throw new Error("revisar: el resumen de un modelo compilado no puede fallar");
  const modelo = sensatezModelo(p.modelo, p.opciones, res.valor);
  const resultados = sensatezResultados(q, res.valor, p.opciones);
  const documento = documentoInforme({ proyecto: p, huella: c.huella, resumen: res.valor, hipotesis: c.hipotesis, modelo, resultados, cimentacion: cimentacion(q), ...datos });
  const comprobaciones = [...modelo.comprobaciones, ...resultados.comprobaciones];
  return {
    comprobaciones,
    pesoPropio: modelo.pesoPropio,
    tributaria: resultados.tributaria,
    avisos: comprobaciones.flatMap((x) => x.avisos),
    documento,
    markdown: markdown(documento),
    html: html(documento),
  };
}

/** Reacciones de cada pilar, muro y apoyo con base, en el orden del modelo (las cargas en cimentación del informe). */
export function cimentacion(q: Consultas): ReaccionBase[] {
  const f = q.fisico;
  const objetos: [string, ReaccionBase["tipo"]][] = [
    ...(f.pilares ?? []).filter((x) => x.base !== "ninguno").map((x) => [x.id, "pilar"] as [string, ReaccionBase["tipo"]]),
    ...(f.muros ?? []).filter((x) => x.base !== "ninguno").map((x) => [x.id, "muro"] as [string, ReaccionBase["tipo"]]),
    ...(f.apoyos ?? []).map((x) => [x.id, "apoyo"] as [string, ReaccionBase["tipo"]]),
    ...(f.apoyosLineales ?? []).map((x) => [x.id, "apoyo lineal"] as [string, ReaccionBase["tipo"]]),
  ];
  const r: ReaccionBase[] = [];
  for (const [id, tipo] of objetos) {
    const x = q.reacciones(id);
    if (x.valido && x.valor.nudos) r.push({ id, tipo, punto: x.valor.punto, R: x.valor.resultante });
  }
  return r;
}

/** Lee el fichero de firmas; un texto vacío es un fichero sin firmas. */
export function leerFirmas(texto: string): FicheroFirmas | { error: string } {
  if (!texto.trim()) return { esquema: VERSION_FIRMAS, firmas: [] };
  let d: unknown;
  try {
    d = JSON.parse(texto);
  } catch (e) {
    return { error: `no es JSON válido: ${e instanceof Error ? e.message : String(e)}` };
  }
  const x = d as Partial<FicheroFirmas>;
  if (x?.esquema !== VERSION_FIRMAS) return { error: `no es un fichero de firmas ${VERSION_FIRMAS}` };
  if (!Array.isArray(x.firmas) || !x.firmas.every((f) => f && typeof f.huella === "string" && typeof f.por === "string" && typeof f.fecha === "string" && typeof f.informe === "string")) return { error: "sus firmas no tienen huella, por, fecha e informe" };
  return { esquema: VERSION_FIRMAS, firmas: x.firmas };
}

export type EstadoFirma =
  | { firmado: false }
  /** `mismoInforme`: el informe firmado es el de ahora (mismo sha256). */
  | { firmado: true; por: string; fecha: string; mismoInforme: boolean };

/** Estado de firma de una huella con el informe de sha256 `informe`: la última firma de esa huella. */
export function estadoFirma(f: FicheroFirmas, huella: string, informe: string): EstadoFirma {
  const firmas = f.firmas.filter((x) => x.huella === huella);
  const mismo = firmas.filter((x) => x.informe === informe);
  const ultima = (mismo.length ? mismo : firmas).at(-1);
  return ultima ? { firmado: true, por: ultima.por, fecha: ultima.fecha, mismoInforme: ultima.informe === informe } : { firmado: false };
}

/** El fichero con una firma más (si la misma persona ya firmó ese informe, no se repite). */
export function anadirFirma(f: FicheroFirmas, firma: Firma): FicheroFirmas {
  if (f.firmas.some((x) => x.huella === firma.huella && x.informe === firma.informe && x.por === firma.por)) return f;
  return { esquema: VERSION_FIRMAS, firmas: [...f.firmas, firma] };
}
