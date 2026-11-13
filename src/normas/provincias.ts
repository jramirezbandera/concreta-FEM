/**
 * Las 52 provincias y ciudades autónomas con su zona eólica (figura D.1 del DB SE-AE).
 *
 * Copiado de Concreta (`src/lib/acciones/provincias.ts`, commit f6afb7d; citado en `NOTICE`), con la
 * zona de clima invernal (figura E.2), la capital de la tabla 3.8 y el reconocimiento de la capital
 * por su nombre, que son de la nieve (añadidos el 2026-11-07, del mismo commit). La frontera de la
 * zona invernal va aparte (`fronteraInvernal`) para no cambiar la forma de la eólica.
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
import { TABLA_3_8, type CapitalNieve, type ZonaInvernal } from "./cteNieve.ts";

export interface Provincia {
  /** Código INE de la provincia, dos dígitos. */
  ine: string;
  nombre: string;
  /** Zona eólica de su capital (figura D.1). */
  zonaEolica: ZonaEolica;
  /** Qué parte de la provincia cae en otra zona eólica. Ausente: la zona vale para toda la provincia. */
  frontera?: { eolica: string };
  /** Zona de clima invernal de su capital (figura E.2 del DB SE-AE), para la nieve. */
  zonaInvernal: ZonaInvernal;
  /** Qué parte de la provincia cae en otra zona de clima invernal. */
  fronteraInvernal?: string;
  /** Su capital en la tabla 3.8, con su altitud y su sk. */
  capital: CapitalNieve;
}

type Fila = [ine: string, nombre: string, eolica: ZonaEolica, invernal: ZonaInvernal, fronteraEolica?: string, fronteraInvernal?: string];

// Los nombres, los de Concreta: son los que acompañan a cada municipio de la tabla de peligrosidad.
const FILAS: Fila[] = [
  ["01", "Álava", "C", 2, "La Rioja alavesa, al sur, está en zona B.", "La zona 1 empieza al norte de Vitoria; el valle de Ayala es zona 1."],
  ["02", "Albacete", "A", 5, undefined, "El sureste (Hellín, Sierra del Segura) entra en la zona 6."],
  ["03", "Alicante", "B", 5, "El interior (Alcoi, Villena, Elda) está en zona A.", "La Vega Baja (Orihuela, Torrevieja) está en zona 6."],
  ["04", "Almería", "A", 6],
  ["05", "Ávila", "A", 3, "El norte (Arévalo) linda con la zona B.", "El sur de Gredos (Arenas de San Pedro) está en zona 4."],
  ["06", "Badajoz", "B", 4, "El este (Don Benito, Castuera) está en zona A.", "El sur (Zafra, Llerena) linda con la zona 6."],
  ["07", "Baleares", "C", 5],
  ["08", "Barcelona", "C", 2],
  ["09", "Burgos", "B", 3, "El norte (Miranda de Ebro, Merindades) está en zona C.", "El norte (Merindades) está en zona 1."],
  ["10", "Cáceres", "B", 4, "El este (Plasencia, Navalmoral) está en zona A.", "La sierra del norte (Hurdes, Gredos) linda con la zona 3."],
  ["11", "Cádiz", "C", 6, "El noreste (Sierra de Cádiz, Olvera) está en zona B."],
  ["12", "Castellón", "A", 5, "El norte (Vinaròs, Morella) está en zona C.", "El norte (Morella, els Ports) está en zona 2."],
  ["13", "Ciudad Real", "A", 4, undefined, "El sur (Sierra Morena) está en zona 6."],
  ["14", "Córdoba", "A", 6, undefined, "El norte (Los Pedroches, Pozoblanco) está en zona 4."],
  ["15", "A Coruña", "C", 1],
  ["16", "Cuenca", "A", 5, undefined, "El oeste (Tarancón) está en zona 4."],
  ["17", "Girona", "C", 2],
  ["18", "Granada", "A", 6],
  ["19", "Guadalajara", "A", 4, "El nordeste (Molina de Aragón) linda con la zona B.", "El norte (Sigüenza, Molina de Aragón) está en zona 3 o 2."],
  ["20", "Gipuzkoa", "C", 1],
  ["21", "Huelva", "B", 6, "El este linda con la zona A.", "La Sierra de Aracena linda con la zona 4."],
  ["22", "Huesca", "C", 2, "El sur (Monzón, Fraga) está en zona B."],
  ["23", "Jaén", "A", 6, undefined, "El norte (Sierra Morena) linda con la zona 4."],
  ["24", "León", "B", 1, "La montaña del norte está en zona C.", "El sur (Tierra de Campos, Sahagún) está en zona 3."],
  ["25", "Lleida", "C", 2, "El sur (Les Garrigues) linda con la zona B."],
  ["26", "La Rioja", "B", 2, "El norte linda con la zona C.", "El oeste (Haro, Santo Domingo) linda con la zona 3."],
  ["27", "Lugo", "C", 1, "El sur (Monforte, Chantada) está en zona B."],
  ["28", "Madrid", "A", 4, undefined, "La sierra (norte) está en zona 3."],
  ["29", "Málaga", "A", 6, "El oeste (Estepona, Campo de Gibraltar) está en zona C."],
  ["30", "Murcia", "B", 6, "El interior (Caravaca, Jumilla, Yecla) está en zona A.", "El norte (Jumilla, Yecla) está en zona 5."],
  ["31", "Navarra", "C", 2, "La Ribera (Tudela) está en zona B.", "El norte (montaña) está en zona 1."],
  ["32", "Ourense", "B", 1, "El norte linda con la zona C."],
  ["33", "Asturias", "C", 1],
  ["34", "Palencia", "B", 3, undefined, "La montaña palentina (norte) está en zona 1."],
  ["35", "Las Palmas", "C", 7],
  ["36", "Pontevedra", "B", 1, "El norte (Ría de Arousa) linda con la zona C."],
  ["37", "Salamanca", "A", 3, "El norte y el oeste lindan con la zona B."],
  ["38", "Santa Cruz de Tenerife", "C", 7],
  ["39", "Cantabria", "C", 1],
  ["40", "Segovia", "A", 3, "El norte linda con la zona B.", "La sierra del sur linda con la zona 4."],
  ["41", "Sevilla", "A", 6, "El oeste (Aljarafe) y el sur (marismas) están en zona B."],
  ["42", "Soria", "B", 3, "El sur linda con la zona A.", "El este (Ágreda) está en zona 2."],
  ["43", "Tarragona", "C", 2, "El interior (Terra Alta) linda con la zona B.", "Las Terres de l'Ebre lindan con la zona 5."],
  ["44", "Teruel", "A", 5, "El este (Bajo Aragón, Alcañiz) está en zona C.", "El norte (Alcañiz) está en zona 2."],
  ["45", "Toledo", "A", 4, "El oeste (Talavera) linda con la zona B."],
  ["46", "Valencia", "A", 5],
  ["47", "Valladolid", "A", 3, "El norte linda con la zona B."],
  ["48", "Bizkaia", "C", 1],
  ["49", "Zamora", "B", 3, "El sur linda con la zona A.", "Sanabria (noroeste) está en zona 1."],
  ["50", "Zaragoza", "B", 2, "El nordeste (Cinco Villas, Monegros) está en zona C."],
  ["51", "Ceuta", "C", 6],
  ["52", "Melilla", "A", 6, "El mapa D.1 no rotula Melilla: se toma la zona A de la costa mediterránea vecina. Confírmalo."],
];

export const PROVINCIAS: readonly Provincia[] = FILAS.map(([ine, nombre, zonaEolica, zonaInvernal, eolica, invernal]) => ({
  ine,
  nombre,
  zonaEolica,
  zonaInvernal,
  capital: TABLA_3_8[ine]!,
  ...(eolica ? { frontera: { eolica } } : {}),
  ...(invernal ? { fronteraInvernal: invernal } : {}),
}));

const POR_INE = new Map(PROVINCIAS.map((p) => [p.ine, p]));

/** Provincia por su código INE de dos dígitos (o por los dos primeros de un municipio). */
export function provinciaPorIne(ine: string): Provincia | undefined {
  return POR_INE.get(ine.slice(0, 2));
}

/** Nombre de la provincia de un código INE. Cadena vacía si el prefijo no existe. */
export function provinciaDe(ine: string): string {
  return provinciaPorIne(ine)?.nombre ?? "";
}

// ── ¿El municipio es la capital? (Concreta, `provincias.ts`, commit f6afb7d) ─────────────────────

/**
 * Nombres con los que se escribe una capital y que la tabla 3.8 no trae: el oficial largo («Santa
 * Cruz de Tenerife» por «Tenerife») o el de la otra lengua. Los pares con barra («Vitoria /
 * Gasteiz») se parten solos.
 */
const ALIAS_CAPITAL: Record<string, readonly string[]> = {
  "07": ["Palma"],
  "12": ["Castelló de la Plana", "Castellón de la Plana"],
  "31": ["Iruñea"],
  "33": ["Uviéu"],
  "35": ["Las Palmas de Gran Canaria"],
  "38": ["Santa Cruz de Tenerife"],
};

/** Artículo inicial que se cae: «A Coruña», «La Coruña» y «Coruña» son el mismo sitio. */
const ARTICULOS = ["a", "o", "el", "la", "las", "los", "les", "els"];

/** Un nombre reducido a lo comparable: sin tildes, paréntesis ni signos, en minúsculas y sin artículo delante. */
function normalizarNombre(nombre: string): string {
  const base = nombre
    .replace(/\([^)]*\)/g, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const [primera, ...resto] = base.split(" ");
  return resto.length > 0 && ARTICULOS.includes(primera!) ? resto.join(" ") : base;
}

/**
 * El nombre entero y cada mitad de los bilingües: «Vitoria-Gasteiz» → entero, «vitoria», «gasteiz».
 * Con `guion: false`, sólo las mitades con «/» («Alicante/Alacant»): el municipio que se compara con
 * la capital, porque un nombre compuesto con guion no es bilingüe («Vélez-Málaga» no es Málaga, A2-27).
 */
function variantes(nombre: string, guion = true): string[] {
  const trozos = nombre.split("/").flatMap((t) => (guion ? t.split("-") : [t]));
  return [nombre, ...trozos].map(normalizarNombre).filter((v) => v !== "");
}

/**
 * ¿El municipio es la capital de esa provincia? La tabla 3.8 da un sk propio a las 52 capitales, y en
 * 28 de ellas no es el que sale de la E.2 con su altitud. Compara sin tildes, sin artículo y por las
 * dos mitades de los nombres bilingües (también el «Granada» o el «Alicante/Alacant» de la tabla del
 * Anejo 1); lo que no se reconoce no es la capital.
 */
export function esCapitalDeProvincia(ine: string, municipio: string): boolean {
  const p = provinciaPorIne(ine);
  if (!p || municipio.trim() === "") return false;
  const aceptadas = new Set([...variantes(p.capital.capital), ...(ALIAS_CAPITAL[p.ine] ?? []).flatMap(variantes)]);
  return variantes(municipio, false).some((v) => aceptadas.has(v));
}
