/**
 * El emplazamiento de la obra para las acciones del programa (fase VS4, `docs/fem3d/viento-sismo.md`):
 * de un municipio, lo que el sismo y el viento necesitan y no se saca de memoria. Es lo que da
 * `fem emplazamiento <nombre | código INE>`.
 *
 * - **Sismo:** `ab` y `K` de la tabla del Anejo 1 de la NCSE-02 (`src/normas/peligrosidad.ts`), con su
 *   código INE, que es lo que se escribe en `acciones.emplazamiento.ine` (común al viento).
 * - **Viento:** la zona eólica de la figura D.1 del DB SE-AE. Es un mapa, no una tabla: lo que se da
 *   es la zona de la capital de la provincia, y `frontera` avisa de la parte de la provincia que cae
 *   en otra zona (`src/normas/provincias.ts`).
 *
 * Un municipio que no está en la tabla no se da por exento: `MENSAJE_NO_ENCONTRADO`. Puro, sin IO.
 */
import { ZONAS_EOLICAS, type ZonaEolica } from "../normas/cteViento.ts";
import { buscarMunicipios, MENSAJE_NO_ENCONTRADO, municipioPorIne, plegarConsulta, textoProcedencia, type Municipio } from "../normas/peligrosidad.ts";
import { esCapitalDeProvincia, PROVINCIAS, provinciaPorIne, type Provincia } from "../normas/provincias.ts";

/** El viento de una provincia: la zona de su capital. */
export interface VientoProvincia {
  /** Zona eólica de la capital de la provincia (figura D.1). */
  zona: ZonaEolica;
  /** Presión dinámica de esa zona, kN/m². */
  qb: number;
  /** Qué parte de la provincia cae en otra zona: hay que confirmar la del municipio. */
  frontera?: string;
}

/** La nieve de una provincia: su zona de clima invernal y su capital en la tabla 3.8. */
export interface NieveProvincia {
  /** Zona de clima invernal de la capital (figura E.2); con la altitud, sk en la tabla E.2. */
  zonaInvernal: number;
  /** La capital en la tabla 3.8: si la obra está en ella, sk es éste. */
  capital: { nombre: string; altitud: number; sk: number };
  /** Qué parte de la provincia cae en otra zona de clima invernal. */
  frontera?: string;
}

export interface MunicipioEmplazamiento {
  /** Código INE de 5 cifras: el `ine` de `acciones.emplazamiento`. */
  ine: string;
  nombre: string;
  provincia: string;
  /** Aceleración sísmica básica, en g, y coeficiente de contribución (Anejo 1 de la NCSE-02). */
  ab: number;
  K: number;
  /** De dónde salen ab y K, en una frase. */
  procedencia: string;
  viento: VientoProvincia | null;
  nieve: NieveProvincia | null;
  /** ¿Es la capital de su provincia? Entonces sk sale de la tabla 3.8. */
  capital: boolean;
}

export interface ProvinciaEmplazamiento {
  /** Código INE de 2 cifras. */
  ine: string;
  nombre: string;
  viento: VientoProvincia;
  nieve: NieveProvincia;
}

export interface Emplazamiento {
  consulta: string;
  /** Los municipios de la tabla que casan, por orden: el nombre completo, una clave, los que empiezan y los que contienen. */
  municipios: MunicipioEmplazamiento[];
  /** Cuántos casan en total, si son más de los que se dan. */
  total?: number;
  /** Las provincias con ese nombre o ese código (para el viento de un municipio que no está en la tabla del sismo). */
  provincias: ProvinciaEmplazamiento[];
  /** Sin municipios: por qué no se puede dar por exento. */
  noEncontrado?: string;
  notas: string[];
}

export const LIMITE_EMPLAZAMIENTO = 20;

const NOTA_SISMO =
  "Emplazamiento: «ine» es el código del municipio que se escribe, con su nombre, en acciones.emplazamiento ({ \"ine\", \"municipio\", \"altitud\" }), común al viento y al sismo: de él salen ab y K (esta tabla, la del Anejo 1 de la NCSE-02) y la zona eólica de su provincia. Hay municipios con el mismo nombre y distinta aceleración: se confirma la provincia.";
const NOTA_VIENTO =
  "Viento: la zona es la de la capital de la provincia (la figura D.1 del DB SE-AE es un mapa, no una tabla por provincias), y el viento la toma sola del emplazamiento. Con «frontera», parte de la provincia cae en otra zona: se confirma con el ingeniero cuál es la del municipio y, si es otra, se escribe en acciones.viento.zona. Un municipio que no está en la tabla del sismo se escribe con su nombre y la provincia (acciones.emplazamiento.provincia, el código de 2 cifras).";

const NOTA_NIEVE =
  "Nieve: con la altitud de acciones.emplazamiento, el programa da sk (tabla 3.8 si la obra está en la capital; si no, la E.2 por la zona de clima invernal) en la hipótesis de fem compilar; lo que se fuerza (zonaInvernal, capital, exposicion, sk) va en acciones.nieve. No genera cargas: el caso S, con el ψ de la altitud, y sus cargas en las cubiertas se escriben preguntando al ingeniero.";

function vientoDe(p: Provincia): VientoProvincia {
  return { zona: p.zonaEolica, qb: ZONAS_EOLICAS[p.zonaEolica].qb, ...(p.frontera ? { frontera: p.frontera.eolica } : {}) };
}

function nieveDe(p: Provincia): NieveProvincia {
  return { zonaInvernal: p.zonaInvernal, capital: { nombre: p.capital.capital, altitud: p.capital.altitud, sk: p.capital.sk }, ...(p.fronteraInvernal ? { frontera: p.fronteraInvernal } : {}) };
}

function municipioDe(m: Municipio): MunicipioEmplazamiento {
  const p = provinciaPorIne(m.ine);
  return { ine: m.ine, nombre: m.nombre, provincia: m.provincia, ab: m.ab, K: m.K, procedencia: textoProcedencia(m.procedencia), viento: p ? vientoDe(p) : null, nieve: p ? nieveDe(p) : null, capital: esCapitalDeProvincia(m.ine, m.nombre) };
}

/** El emplazamiento de un nombre de municipio (o parte), de su código INE de 5 cifras o de una provincia (nombre o código de 2 cifras). */
export function emplazamiento(consulta: string, limite = LIMITE_EMPLAZAMIENTO): Emplazamiento {
  const texto = consulta.trim();
  const q = plegarConsulta(texto);
  let todos: Municipio[];
  if (/^\d{5}$/.test(texto)) {
    const m = municipioPorIne(texto);
    todos = m ? [m] : [];
  } else todos = /^\d+$/.test(texto) ? [] : buscarMunicipios(texto, Number.MAX_SAFE_INTEGER);
  const provincias = PROVINCIAS.filter((p) => (/^\d{2}$/.test(texto) ? p.ine === texto : q !== "" && plegarConsulta(p.nombre) === q)).map((p) => ({ ine: p.ine, nombre: p.nombre, viento: vientoDe(p), nieve: nieveDe(p) }));
  const n = Math.max(1, Math.floor(limite));
  return {
    consulta: texto,
    municipios: todos.slice(0, n).map(municipioDe),
    ...(todos.length > n ? { total: todos.length } : {}),
    provincias,
    ...(todos.length ? {} : { noEncontrado: MENSAJE_NO_ENCONTRADO }),
    notas: [...(todos.length ? [NOTA_SISMO] : []), ...(todos.length || provincias.length ? [NOTA_VIENTO, NOTA_NIEVE] : [])],
  };
}
