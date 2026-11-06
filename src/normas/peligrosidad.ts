/**
 * La peligrosidad sísmica por municipio: la tabla del Anejo 1 de la NCSE-02 (aceleración sísmica
 * básica `ab` y coeficiente de contribución `K`), fase VS4 (`docs/fem3d/viento-sismo.md`, VS-l).
 *
 * Portado de Concreta (`src/features/seismic-ncse02/hazard.ts`, commit f6afb7d; citado en `NOTICE`):
 * los tipos, la búsqueda en cuatro niveles, el plegado de la consulta y los textos. Allí la tabla se
 * carga con `import()` detrás del buscador; aquí todo es síncrono.
 *
 * **Los datos** (`datos/ncse02.hazard.json`, con su manifiesto y su sha256) son los de Concreta, byte
 * a byte: la capa `HazardArea2002.NCSE-02` del Instituto Geográfico Nacional (CC BY 4.0, citada en
 * `NOTICE`), con el suplemento del texto del BOE que lleva su manifiesto. **El oráculo es el Anejo 1:**
 * `peligrosidad.test.ts` comprueba que cada municipio del anejo tiene aquí su ab y su K
 * (`validacion/vs4/anejo1.py`).
 *
 * El Anejo 1 sólo lista los municipios con ab ≥ 0,04 g: 2 635 filas, no los ~8 100 municipios. Que
 * uno no esté **no** quiere decir que esté exento (`MENSAJE_NO_ENCONTRADO`).
 */
import datos from "./datos/ncse02.hazard.json" with { type: "json" };
import { provinciaDe } from "./provincias.ts";

/**
 * De dónde salen `ab` y `K` cuando NO salen directamente de la capa del IGN.
 *
 * Son minoría (26 filas de 2 635), y el tipo existe porque la diferencia es normativa: en
 * `anejo1-texto` el valor es literalmente el del Anejo 1, mientras que en `segregado` es una herencia
 * que la norma no escribe con ese nombre de municipio, porque en 2002 no existía. Quien firma tiene
 * derecho a saber cuál de las dos está usando.
 */
export type Procedencia =
  | {
      /** El Anejo 1 lo lista, pero la capa del IGN no le pone aceleración. */
      tipo: "anejo1-texto";
      /** La entrada literal del BOE, para poder contrastarla. */
      boe: string;
    }
  | {
      /** Municipio creado después de 2002: hereda de su municipio de origen. */
      tipo: "segregado";
      padre: { ine: string; nombre: string };
      anio: number;
      fusion?: boolean;
    }
  | {
      /** La capa del IGN contradice al texto legal y manda el texto. */
      tipo: "correccion";
      motivo: string;
    };

/** Forma del fichero (en Concreta lo genera `scripts/harvest-ign-hazard.mjs`). */
interface TablaColumnar {
  /** Código INE de 5 dígitos, ordenado ascendente. */
  ine: string[];
  /** Nombre oficial tal cual lo publica el IGN. */
  nombre: string[];
  /** Variantes de búsqueda precalculadas, plegadas y separadas por `|`. */
  clave: string[];
  /** Índice en `abValores`. */
  ab: number[];
  /** Índice en `kValores`. */
  k: number[];
  abValores: number[];
  kValores: number[];
  /** Mapa disperso por código INE: sólo las filas que no son cosecha directa de la capa. */
  procedencia: Record<string, Procedencia>;
}

const TABLA = datos as unknown as TablaColumnar;

export interface Municipio {
  /** Código INE de 5 dígitos. */
  ine: string;
  /** Nombre oficial. Puede ser bilingüe (`Alicante/Alacant`). */
  nombre: string;
  /**
   * Provincia, por los dos primeros dígitos del código INE. No es adorno: hay municipios homónimos
   * con peligrosidades distintas (los dos «Torrent»: Girona, 0,05 g, y Valencia, 0,07 g).
   */
  provincia: string;
  /** Aceleración sísmica básica, en g. */
  ab: number;
  /** Coeficiente de contribución K. */
  K: number;
  /** null cuando `ab` y `K` salen tal cual de la capa del IGN. */
  procedencia: Procedencia | null;
}

/** Cuántos municipios tiene la tabla. */
export const NUMERO_DE_MUNICIPIOS: number = TABLA.ine.length;

/** De dónde sale la peligrosidad de un municipio, en una frase. */
export function textoProcedencia(p: Procedencia | null): string {
  if (!p) return "Anejo 1 de la NCSE-02";
  switch (p.tipo) {
    case "anejo1-texto":
      return "Anejo 1 de la NCSE-02 · leído del texto del BOE";
    case "correccion":
      return "Anejo 1 de la NCSE-02 · corregido contra el texto del BOE";
    case "segregado":
      return `Heredado de ${p.padre.nombre} · el municipio se creó en ${p.anio} y el Anejo 1, de 2002, no lo nombra`;
  }
}

/**
 * Lo que se dice cuando el buscador no encuentra nada.
 *
 * **Este mensaje no puede afirmar la exención.** Un «no encontrado» tiene tres causas:
 *   1. el municipio está de verdad por debajo de 0,04 g: exento (art. 1.2.3);
 *   2. hay una errata, o el nombre oficial se escribe de otra forma;
 *   3. el municipio no existía en 2002 y por eso el Anejo 1 no lo nombra. Los segregados posteriores
 *      heredan de su municipio de origen, pero esa lista se mantiene a mano y puede quedarse corta.
 *
 * Presentar (1) como la lectura por defecto convierte (2) y (3) en exenciones silenciosas. Por eso
 * el mensaje enumera las tres y da la salida: ab y K a mano.
 */
export const MENSAJE_NO_ENCONTRADO =
  "No figura en el Anejo 1 de la NCSE-02. Puede ser que el municipio esté por debajo de 0,04 g y quede exento (art. 1.2.3), que el nombre lleve una errata, " +
  "o que el municipio se creara después de 2002 y la Norma lo liste bajo el municipio del que se segregó. Compruébalo antes de darlo por exento: si procede, introduce ab y K a mano.";

/**
 * Pliega lo que se teclea para compararlo con las claves: sin tildes, en minúsculas y con todo lo
 * que no es letra ni cifra como un espacio. Las claves de la tabla ya vienen plegadas, con el
 * artículo invertido («Ejido (El)») y los nombres bilingües resueltos.
 */
export function plegarConsulta(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fila(i: number): Municipio {
  const ine = TABLA.ine[i]!;
  return { ine, nombre: TABLA.nombre[i]!, provincia: provinciaDe(ine), ab: TABLA.abValores[TABLA.ab[i]!]!, K: TABLA.kValores[TABLA.k[i]!]!, procedencia: TABLA.procedencia[ine] ?? null };
}

/**
 * Busca municipios por nombre: como mucho, `limite`.
 *
 * Cuatro niveles, y el de arriba es el nombre completo: (1) el nombre oficial completo, plegado, es
 * la consulta; (2) alguna clave es la consulta; (3) alguna clave empieza por ella; (4) alguna la
 * contiene. Dentro de cada nivel, por código INE. Sin el primero, quien teclea «granada» recibía
 * antes «Granada (La)» (Barcelona, 0,04 g) que Granada (0,23 g), sólo porque su provincia tiene un
 * número menor: la tabla indexa también la forma sin artículo, así que «granada» es clave exacta de
 * las dos, y lo que las separa es el nombre oficial completo.
 *
 * No se corta el barrido al llenar el primer nivel: pararse antes escondía coincidencias exactas de
 * código INE alto detrás de prefijos de código bajo.
 */
export function buscarMunicipios(consulta: string, limite = 20): Municipio[] {
  const q = plegarConsulta(consulta);
  if (!q) return [];
  const exactas: number[] = [];
  const empiezan: number[] = [];
  const contienen: number[] = [];
  for (let i = 0; i < TABLA.ine.length; i++) {
    const claves = TABLA.clave[i]!.split("|");
    if (claves.some((c) => c === q)) exactas.push(i);
    else if (claves.some((c) => c.startsWith(q))) empiezan.push(i);
    else if (claves.some((c) => c.includes(q))) contienen.push(i);
  }
  const nombreExacto = exactas.filter((i) => plegarConsulta(TABLA.nombre[i]!) === q);
  const porClave = exactas.filter((i) => plegarConsulta(TABLA.nombre[i]!) !== q);
  return [...nombreExacto, ...porClave, ...empiezan, ...contienen].slice(0, limite).map(fila);
}

/**
 * El municipio de un código INE, o null si no está en la tabla, que **no** es lo mismo que «no
 * existe» ni que «exento»: ver `MENSAJE_NO_ENCONTRADO`.
 */
export function municipioPorIne(ine: string): Municipio | null {
  // La tabla va ordenada por código INE (todos de 5 cifras): búsqueda binaria
  let lo = 0;
  let hi = TABLA.ine.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = TABLA.ine[mid]!;
    if (c === ine) return fila(mid);
    if (c < ine) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/** ¿Es `nombre` uno de los nombres del municipio de ese código (su nombre oficial o una de sus claves)? */
export function esNombreDe(ine: string, nombre: string): boolean {
  const q = plegarConsulta(nombre);
  if (!q) return false;
  let lo = 0;
  let hi = TABLA.ine.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = TABLA.ine[mid]!;
    if (c === ine) return plegarConsulta(TABLA.nombre[mid]!) === q || TABLA.clave[mid]!.split("|").includes(q);
    if (c < ine) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}
