/**
 * Las 52 provincias y ciudades autónomas con su zona eólica (figura D.1 del DB SE-AE).
 *
 * Copiado de Concreta (`src/lib/acciones/provincias.ts`, commit f6afb7d; citado en `NOTICE`), sin la
 * zona de clima invernal, la capital de la tabla 3.8 ni el reconocimiento de la capital por su
 * nombre, que son de la nieve.
 *
 * La figura D.1 es un MAPA, no una tabla: la norma no asigna zonas por provincia y las líneas cruzan
 * muchas de ellas. Lo que va aquí es la zona de la CAPITAL, y `frontera.eolica` es el aviso, en
 * lenguaje llano, de qué parte de la provincia cae en otra zona. Quien lo usa lo enseña y deja
 * cambiar la zona; nunca la esconde.
 *
 * Cómo se fijó cada zona (en Concreta, 2026-09-04): lectura del mapa D.1 rasterizado, contrastada
 * con la tabla de los 50 municipios más poblados de normatia.com. Melilla no lleva rótulo en el
 * mapa: se toma A como la costa vecina y se avisa.
 *
 * El código INE de dos dígitos es la clave: es lo que llevan los municipios de la tabla de
 * peligrosidad sísmica (`peligrosidad.ts`).
 */
import type { ZonaEolica } from "./cteViento.ts";

export interface Provincia {
  /** Código INE de la provincia, dos dígitos. */
  ine: string;
  nombre: string;
  /** Zona eólica de su capital (figura D.1). */
  zonaEolica: ZonaEolica;
  /** Qué parte de la provincia cae en otra zona. Ausente: la zona vale para toda la provincia. */
  frontera?: { eolica: string };
}

type Fila = [ine: string, nombre: string, eolica: ZonaEolica, fronteraEolica?: string];

// Los nombres, los de Concreta: son los que acompañan a cada municipio de la tabla de peligrosidad.
const FILAS: Fila[] = [
  ["01", "Álava", "C", "La Rioja alavesa, al sur, está en zona B."],
  ["02", "Albacete", "A"],
  ["03", "Alicante", "B", "El interior (Alcoi, Villena, Elda) está en zona A."],
  ["04", "Almería", "A"],
  ["05", "Ávila", "A", "El norte (Arévalo) linda con la zona B."],
  ["06", "Badajoz", "B", "El este (Don Benito, Castuera) está en zona A."],
  ["07", "Baleares", "C"],
  ["08", "Barcelona", "C"],
  ["09", "Burgos", "B", "El norte (Miranda de Ebro, Merindades) está en zona C."],
  ["10", "Cáceres", "B", "El este (Plasencia, Navalmoral) está en zona A."],
  ["11", "Cádiz", "C", "El noreste (Sierra de Cádiz, Olvera) está en zona B."],
  ["12", "Castellón", "A", "El norte (Vinaròs, Morella) está en zona C."],
  ["13", "Ciudad Real", "A"],
  ["14", "Córdoba", "A"],
  ["15", "A Coruña", "C"],
  ["16", "Cuenca", "A"],
  ["17", "Girona", "C"],
  ["18", "Granada", "A"],
  ["19", "Guadalajara", "A", "El nordeste (Molina de Aragón) linda con la zona B."],
  ["20", "Gipuzkoa", "C"],
  ["21", "Huelva", "B", "El este linda con la zona A."],
  ["22", "Huesca", "C", "El sur (Monzón, Fraga) está en zona B."],
  ["23", "Jaén", "A"],
  ["24", "León", "B", "La montaña del norte está en zona C."],
  ["25", "Lleida", "C", "El sur (Les Garrigues) linda con la zona B."],
  ["26", "La Rioja", "B", "El norte linda con la zona C."],
  ["27", "Lugo", "C", "El sur (Monforte, Chantada) está en zona B."],
  ["28", "Madrid", "A"],
  ["29", "Málaga", "A", "El oeste (Estepona, Campo de Gibraltar) está en zona C."],
  ["30", "Murcia", "B", "El interior (Caravaca, Jumilla, Yecla) está en zona A."],
  ["31", "Navarra", "C", "La Ribera (Tudela) está en zona B."],
  ["32", "Ourense", "B", "El norte linda con la zona C."],
  ["33", "Asturias", "C"],
  ["34", "Palencia", "B"],
  ["35", "Las Palmas", "C"],
  ["36", "Pontevedra", "B", "El norte (Ría de Arousa) linda con la zona C."],
  ["37", "Salamanca", "A", "El norte y el oeste lindan con la zona B."],
  ["38", "Santa Cruz de Tenerife", "C"],
  ["39", "Cantabria", "C"],
  ["40", "Segovia", "A", "El norte linda con la zona B."],
  ["41", "Sevilla", "A", "El oeste (Aljarafe) y el sur (marismas) están en zona B."],
  ["42", "Soria", "B", "El sur linda con la zona A."],
  ["43", "Tarragona", "C", "El interior (Terra Alta) linda con la zona B."],
  ["44", "Teruel", "A", "El este (Bajo Aragón, Alcañiz) está en zona C."],
  ["45", "Toledo", "A", "El oeste (Talavera) linda con la zona B."],
  ["46", "Valencia", "A"],
  ["47", "Valladolid", "A", "El norte linda con la zona B."],
  ["48", "Bizkaia", "C"],
  ["49", "Zamora", "B", "El sur linda con la zona A."],
  ["50", "Zaragoza", "B", "El nordeste (Cinco Villas, Monegros) está en zona C."],
  ["51", "Ceuta", "C"],
  ["52", "Melilla", "A", "El mapa D.1 no rotula Melilla: se toma la zona A de la costa mediterránea vecina. Confírmalo."],
];

export const PROVINCIAS: readonly Provincia[] = FILAS.map(([ine, nombre, zonaEolica, eolica]) => ({ ine, nombre, zonaEolica, ...(eolica ? { frontera: { eolica } } : {}) }));

const POR_INE = new Map(PROVINCIAS.map((p) => [p.ine, p]));

/** Provincia por su código INE de dos dígitos (o por los dos primeros de un municipio). */
export function provinciaPorIne(ine: string): Provincia | undefined {
  return POR_INE.get(ine.slice(0, 2));
}

/** Nombre de la provincia de un código INE. Cadena vacía si el prefijo no existe. */
export function provinciaDe(ine: string): string {
  return provinciaPorIne(ine)?.nombre ?? "";
}
