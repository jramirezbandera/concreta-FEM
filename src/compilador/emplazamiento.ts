/**
 * El emplazamiento de la obra, común al viento y al sismo (`acciones.emplazamiento`; VS4, a petición
 * del usuario: «por la ubicación sabes también qb»). Como los datos de la obra de Concreta
 * (`lib/obra`), que comparten viento, nieve y sismo: la provincia, el municipio y la altitud.
 *
 * - **Viento:** sin `zona` escrita, la de la provincia (la de su capital en la figura D.1, con el
 *   aviso de frontera de `provincias.ts`); sin `altitud`, la del emplazamiento.
 * - **Sismo:** sin `ine` escrito, el del emplazamiento, y con él su nombre; de ahí salen ab y K.
 *
 * Lo escrito en el viento o en el sismo manda, así que los ficheros de antes dan lo mismo. Las dos
 * funciones `vientoEfectivo` y `sismoEfectivo` dan lo que leen el viento y el sismo; los errores del
 * emplazamiento, `erroresEmplazamiento` (los da `validar`).
 */
import { municipioPorIne, MENSAJE_NO_ENCONTRADO } from "../normas/peligrosidad.ts";
import { provinciaPorIne, type Provincia } from "../normas/provincias.ts";
import type { EmplazamientoEdificio, ModeloFisico, SismoEdificio, VientoEdificio } from "./fisico.ts";

export interface ProblemaEmplazamiento {
  codigo: string;
  mensaje: string;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** El emplazamiento de `m` si es un objeto; si no, undefined (lo que no vale lo dice `erroresEmplazamiento`). */
export function emplazamientoDe(m: ModeloFisico | null | undefined): EmplazamientoEdificio | undefined {
  const e: unknown = esObjeto(m) && esObjeto(m.acciones) ? m.acciones.emplazamiento : undefined;
  return esObjeto(e) ? (e as EmplazamientoEdificio) : undefined;
}

/** El código INE del municipio del emplazamiento si está en la tabla del Anejo 1. */
const ineValido = (e: EmplazamientoEdificio | undefined): string | undefined =>
  e && typeof e.ine === "string" && /^\d{5}$/.test(e.ine) && municipioPorIne(e.ine) ? e.ine : undefined;

/** La provincia del emplazamiento: la escrita o la de su municipio. */
export function provinciaEmplazamiento(e: EmplazamientoEdificio | undefined): Provincia | undefined {
  if (!e) return undefined;
  if (typeof e.provincia === "string" && /^\d{2}$/.test(e.provincia)) return provinciaPorIne(e.provincia);
  if (typeof e.ine === "string" && /^\d{5}$/.test(e.ine)) return provinciaPorIne(e.ine);
  return undefined;
}

/** Lo que no vale del emplazamiento de `m` (vacío sin emplazamiento). */
export function erroresEmplazamiento(m: ModeloFisico): ProblemaEmplazamiento[] {
  const bruto: unknown = esObjeto(m) && esObjeto(m.acciones) ? m.acciones.emplazamiento : undefined;
  if (bruto === undefined) return [];
  const r: ProblemaEmplazamiento[] = [];
  const err = (codigo: string, mensaje: string) => r.push({ codigo, mensaje });
  if (!esObjeto(bruto)) {
    err("emplazamiento/no-valido", "El emplazamiento de las acciones tiene que ser un objeto con su provincia, su municipio y su altitud.");
    return r;
  }
  const e = bruto as EmplazamientoEdificio;
  if (e.provincia !== undefined && !(typeof e.provincia === "string" && /^\d{2}$/.test(e.provincia) && provinciaPorIne(e.provincia)))
    err("emplazamiento/provincia", `La provincia del emplazamiento es su código INE, un texto de 2 cifras ("29" es Málaga; es ${JSON.stringify(e.provincia)}).`);
  if (e.ine !== undefined) {
    if (!(typeof e.ine === "string" && /^\d{5}$/.test(e.ine))) err("emplazamiento/ine", `El «ine» del emplazamiento es el código INE del municipio, un texto de 5 cifras ("29008"; es ${JSON.stringify(e.ine)}): se busca por su nombre, con «fem emplazamiento».`);
    else if (!municipioPorIne(e.ine))
      err(
        "emplazamiento/municipio-desconocido",
        `El municipio de código INE ${e.ine} no está en la tabla de peligrosidad sísmica. ${MENSAJE_NO_ENCONTRADO} Un municipio que no figura se escribe sólo con su nombre («municipio») y su provincia.`,
      );
    else if (typeof e.provincia === "string" && e.provincia !== e.ine.slice(0, 2))
      err("emplazamiento/provincia", `El municipio del emplazamiento (código INE ${e.ine}) es de ${provinciaPorIne(e.ine)?.nombre ?? e.ine.slice(0, 2)}, y la provincia escrita, ${provinciaPorIne(e.provincia)?.nombre ?? e.provincia}: una de las dos está mal.`);
  }
  if (e.municipio !== undefined && !(typeof e.municipio === "string" && e.municipio.trim() !== "")) err("emplazamiento/municipio", `El «municipio» del emplazamiento es su nombre, un texto (es ${JSON.stringify(e.municipio)}).`);
  if (e.altitud !== undefined && !(typeof e.altitud === "number" && Number.isFinite(e.altitud))) err("emplazamiento/altitud", "La altitud del emplazamiento tiene que ser un número, en m.");
  return r;
}

/** De dónde sale la zona eólica del viento. */
export type OrigenZona = { tipo: "escrita" } | { tipo: "provincia"; provincia: Provincia };

/**
 * El viento de `m` con lo que toma del emplazamiento (la zona y la altitud), y de dónde sale su
 * zona; sin `acciones.viento`, undefined. Sin zona escrita ni provincia, `zona` queda sin dar (y el
 * viento lo dice).
 */
export function vientoEfectivo(m: ModeloFisico): { viento: VientoEdificio; origenZona: OrigenZona | null } | undefined {
  const v: unknown = esObjeto(m) && esObjeto(m.acciones) ? m.acciones.viento : undefined;
  if (v === undefined) return undefined;
  if (!esObjeto(v)) return { viento: v as VientoEdificio, origenZona: null };
  const vv = v as unknown as VientoEdificio;
  const e = emplazamientoDe(m);
  const r: VientoEdificio = { ...vv };
  let origenZona: OrigenZona | null = vv.zona !== undefined ? { tipo: "escrita" } : null;
  if (vv.zona === undefined) {
    const p = provinciaEmplazamiento(e);
    if (p) {
      r.zona = p.zonaEolica;
      origenZona = { tipo: "provincia", provincia: p };
    }
  }
  if (vv.altitud === undefined && e && typeof e.altitud === "number") r.altitud = e.altitud;
  return { viento: r, origenZona };
}

/**
 * El sismo de `m` con lo que toma del emplazamiento: su municipio (código y nombre) si el sismo no
 * lleva el suyo, y, con ab escrita, el nombre de un municipio que no figura. Sin `acciones.sismo`,
 * undefined; si no es un objeto, tal cual (lo rechaza el sismo).
 */
export function sismoEfectivo(m: ModeloFisico | null | undefined): SismoEdificio | undefined {
  const s: unknown = esObjeto(m) && esObjeto(m.acciones) ? m.acciones.sismo : undefined;
  if (!esObjeto(s)) return s as SismoEdificio | undefined;
  const ss = s as SismoEdificio;
  const e = emplazamientoDe(m);
  if (!e || ss.ine !== undefined) return ss;
  const ine = ineValido(e);
  const nombre = typeof e.municipio === "string" && e.municipio.trim() !== "" ? e.municipio : undefined;
  if (ine) return { ...ss, ine, ...(ss.municipio === undefined && nombre ? { municipio: nombre } : {}) };
  if (ss.ab !== undefined && ss.municipio === undefined && nombre) return { ...ss, municipio: nombre };
  return ss;
}

/**
 * El municipio del emplazamiento que no figura en el Anejo 1 (sólo su nombre), si el sismo tampoco
 * lleva su ab: el sismo lo avisa, porque sin ab no hay casos del sismo y no figurar no es estar exento.
 */
export function municipioFueraDelAnejo(m: ModeloFisico): string | undefined {
  const e = emplazamientoDe(m);
  const s = sismoEfectivo(m);
  if (!e || !s || s.ab !== undefined || s.ine !== undefined || e.ine !== undefined) return undefined;
  return typeof e.municipio === "string" && e.municipio.trim() !== "" ? e.municipio : undefined;
}
