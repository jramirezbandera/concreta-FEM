/**
 * Lector de DWG (fase DW, `docs/fem3d/dwg.md`). Da el mismo `Dxf` que `src/dxf/lector.ts`: la
 * cabecera, las capas y las entidades del espacio modelo con sus pares de DXF, así que lo que viene
 * detrás (`aplanar.ts`, la plantilla, los enganches) no sabe de dónde viene el dibujo.
 *
 * Portado de ACadSharp (`IO/DwgReader.cs` y `IO/DWG/`; MIT, commit d9f3de8, citado en `NOTICE`).
 * Tramos DW1 y DW2: R13–R2000 (AC1012, AC1014, AC1015), con las capas, los bloques y las entidades
 * que dibuja `aplanar.ts` (las demás, sólo con su tipo, para que se cuenten como no leídas). DW3:
 * 2004, 2010, 2013 y 2018 (secciones2004.ts). DW5: 2007 (secciones2007.ts).
 *
 * - Lo que el fichero dice mal (tamaños, posiciones, handles) es un `ErrorDxf`. Un objeto que no se
 *   puede leer se salta y queda en `fallos`, como en ACadSharp: el resto del dibujo sirve.
 * - Lo del espacio papel no se lee (modo 1), como en el DXF.
 * - Las entidades del espacio modelo van en el orden de su lista (anterior y siguiente).
 *
 * Puro: sin IO, sin React ni DOM.
 */

import { type Bloque, type CapaLeida, type Dxf, type Entidad, ErrorDxf } from "../dxf/lector.ts";
import { Bits, crc16, flujoCadenas } from "./bits.ts";
import { type CabeceraDwg, type Flujos, hacerFlujos, leerCabecera } from "./cabecera.ts";
import { soloTipo, type Traducida, traducir } from "./entidades.ts";
import { abrir, type CabeceraBloque, cabeceraBloque, capa, type CapaDwg, control, entidad, esEntidadFija, leerClases, leerMapa, nombreBloque, TIPO } from "./objetos.ts";
import { leerSecciones2004 } from "./secciones2004.ts";
import { leerSecciones2007 } from "./secciones2007.ts";
import { type Version, version } from "./version.ts";

/** Lo que da `leerDwg`, además del `Dxf`. */
export interface Dwg extends Dxf {
  cabeceraDwg: CabeceraDwg;
  /** El handle (en hexadecimal, como el código 5 del DXF) de cada entidad del espacio modelo. */
  handles: string[];
  /** Los objetos que no se pudieron leer. */
  fallos: { handle: string; tipo: number; mensaje: string }[];
  /** La posición en bytes de cada objeto (el mapa de AcDb:Handles). */
  posiciones: Map<number, number>;
}

/** La firma de un DWG: «AC10» y dos cifras (o «AC1.» de los muy antiguos). */
export function esDwg(bytes: Uint8Array): boolean {
  return bytes.length >= 6 && bytes[0] === 0x41 && bytes[1] === 0x43 && bytes[2] === 0x31 && (bytes[3] === 0x30 || bytes[3] === 0x2e);
}

/**
 * La página de códigos del DWG por su índice (la tabla de `CadUtils._pageCodes` de ACadSharp), como
 * etiqueta de `TextDecoder`. Las que `TextDecoder` no tiene (IBM 437, 850…, Johab) se leen como
 * windows-1252, que coincide con ellas en ASCII.
 */
const PAGINAS: readonly string[] = [
  "windows-1252", // 0 desconocida
  "windows-1252", // 1 US-ASCII
  "windows-1252", // 2 ISO-8859-1 (en WHATWG es windows-1252)
  "iso-8859-2",
  "iso-8859-3",
  "iso-8859-4",
  "iso-8859-5",
  "iso-8859-6",
  "iso-8859-7",
  "iso-8859-8",
  "windows-1254", // 10 ISO-8859-9 (en WHATWG es windows-1254)
  "windows-1252", // 11 IBM 437
  "windows-1252", // 12 IBM 850
  "windows-1252", // 13 IBM 852
  "windows-1252", // 14 IBM 855
  "windows-1252", // 15 IBM 857
  "windows-1252", // 16 IBM 860
  "windows-1252", // 17 IBM 861
  "windows-1252", // 18 IBM 863
  "windows-1252", // 19 IBM 864
  "windows-1252", // 20 IBM 865
  "windows-1252", // 21 IBM 869
  "shift_jis",
  "macintosh",
  "big5",
  "euc-kr", // 25 KSC 5601
  "windows-1252", // 26 Johab
  "ibm866",
  "windows-1250",
  "windows-1251",
  "windows-1252",
  "gbk", // 31 GB 2312
  "windows-1253",
  "windows-1254",
  "windows-1255",
  "windows-1256",
  "windows-1257",
  "windows-874",
  "shift_jis",
  "gbk",
  "euc-kr",
  "big5",
  "windows-1252", // 42 Johab
  "utf-16le",
  "windows-1258",
];

export function paginaDwg(indice: number): string {
  return PAGINAS[indice] ?? "windows-1252";
}

const SENTINELA_FICHERO = [0x95, 0xa0, 0x4e, 0x28, 0x99, 0x82, 0x1a, 0xe5, 0x5e, 0x41, 0xe0, 0x5f, 0x9d, 0x3a, 0x4d, 0x00];
const SENTINELA_CABECERA =[0xcf, 0x7b, 0x1f, 0x23, 0xfd, 0xde, 0x38, 0xa9, 0x5f, 0x7c, 0x68, 0xb8, 0x4e, 0x6d, 0x33, 0x5f];

const hex = (h: number) => h.toString(16).toUpperCase();

/** Las clases que en R14 eran lo que desde 2000 son tipos fijos (DW2-3): se leen igual. */
const CLASES_FIJAS: Readonly<Record<string, number>> = { LWPOLYLINE: TIPO.LWPOLYLINE, LWPLINE: TIPO.LWPOLYLINE, HATCH: TIPO.HATCH };

interface Seccion {
  posicion: number;
  tamano: number;
}

/** La cabecera del fichero de R13–R2000: la página de códigos y los localizadores de sus secciones. */
function cabeceraFichero15(bytes: Uint8Array): { pagina: number; secciones: Map<number, Seccion> } {
  const s = new Bits(bytes, 6 * 8);
  s.saltar(7);
  s.RL(); // la vista previa
  s.saltar(2);
  const pagina = s.RS();
  const n = s.RL();
  if (n < 0 || n > 64) throw new ErrorDxf("El DWG está dañado: la cabecera del fichero dice que tiene un número imposible de secciones.");
  const secciones = new Map<number, Seccion>();
  for (let i = 0; i < n; i++) {
    const num = s.RC();
    const posicion = s.RLu();
    const tamano = s.RLu();
    secciones.set(num, { posicion, tamano });
  }
  // RS: el CRC desde el principio del fichero, y la marca del final
  const crc = crc16(bytes, 0, s.pos >> 3);
  if (s.RSu() !== crc || !SENTINELA_FICHERO.every((x) => s.RC() === x)) throw new ErrorDxf("El DWG está dañado: la cabecera del fichero no pasa su CRC.");
  return { pagina, secciones };
}

/**
 * Los flujos de la sección de la cabecera (AcDb:Header), comprobada: su marca, su tamaño (RL; en 2010
 * y 2013 con mantenimiento > 3, y desde 2018, un RL más) y su CRC. Desde 2007, las cadenas y los
 * handles van aparte, con un RL de tamaño en bits delante de los datos.
 */
function flujosCabecera(v: Version, s: Bits, mantenimiento: number, dec: TextDecoder): Flujos {
  const inicio = s.pos >> 3;
  const marca = s.bytes(16);
  if (!SENTINELA_CABECERA.every((x, i) => marca[i] === x)) throw new ErrorDxf("El DWG está dañado: la sección de la cabecera no empieza por su marca.");
  const tam = s.RLu();
  if ((v.r2010 && mantenimiento > 3) || v.r2018) s.RL();
  const desde = inicio + 16;
  const hasta = (s.pos >> 3) + tam;
  if (s.en(hasta * 8).RSu() !== crc16(s.buf, desde, hasta)) throw new ErrorDxf("El DWG está dañado: la sección de la cabecera no pasa su CRC.");
  const d = s.en(s.pos, hasta * 8);
  if (!v.r2007) return hacerFlujos(v, d, d, d, dec);
  const ultimo = d.pos + d.RLu() - 1;
  return hacerFlujos(v, d, flujoCadenas(s.buf, ultimo), d.en(ultimo + 1, hasta * 8), dec);
}

function seccion(secciones: Map<number, Seccion>, num: number, nombre: string, bytes: Uint8Array): Seccion {
  const sec = secciones.get(num);
  if (!sec || sec.posicion + sec.tamano > bytes.length) throw new ErrorDxf(`El DWG está dañado: le falta la sección ${nombre}.`);
  return sec;
}

export function leerDwg(bytes: Uint8Array): Dwg {
  if (!esDwg(bytes)) throw new ErrorDxf("No es un DWG.");
  const v: Version = version(String.fromCharCode(...bytes.subarray(0, 6)));

  // Hasta 2000, las secciones están en el fichero por sus localizadores; desde 2004, en páginas
  // comprimidas (secciones2004.ts), y las posiciones de los objetos son de AcDb:AcDbObjects.
  let pagina: number;
  let mantenimiento = 0;
  /** Una sección: el buffer y el bit donde empieza. */
  let deSeccion: (num: number, nombre: string, descripcion: string) => Bits;
  let objetos: Uint8Array;
  if (v.r2004) {
    const s = v.r2007 && !v.r2010 ? leerSecciones2007(bytes) : leerSecciones2004(bytes);
    pagina = s.pagina;
    mantenimiento = s.mantenimiento;
    deSeccion = (_num, nombre, descripcion) => {
      const b = s.seccion(nombre);
      if (!b) throw new ErrorDxf(`El DWG está dañado: le falta la sección ${descripcion}.`);
      return new Bits(b);
    };
    const o = s.seccion("AcDb:AcDbObjects");
    if (!o) throw new ErrorDxf("El DWG está dañado: le falta la sección de los objetos.");
    objetos = o;
  } else {
    const f = cabeceraFichero15(bytes);
    pagina = f.pagina;
    deSeccion = (num, _nombre, descripcion) => {
      const sec = seccion(f.secciones, num, descripcion, bytes);
      return new Bits(bytes, sec.posicion * 8, (sec.posicion + sec.tamano) * 8);
    };
    objetos = bytes;
  }
  const codificacion = paginaDwg(pagina);
  const dec = new TextDecoder(codificacion);

  // AcDb:Header
  const cabeceraDwg = leerCabecera(v, flujosCabecera(v, deSeccion(0, "AcDb:Header", "de la cabecera"), mantenimiento, dec));

  // AcDb:Classes: el nombre de DXF de los tipos ≥ 500
  const clases = leerClases(v, deSeccion(1, "AcDb:Classes", "de las clases"), dec, mantenimiento);

  // AcDb:Handles
  const mapa = leerMapa(deSeccion(2, "AcDb:Handles", "del mapa de objetos"));

  const capasPorHandle = new Map<number, CapaDwg>();
  let ordenCapas: number[] = [];
  /** Las entradas de la tabla de bloques, en su orden (sin *Model_Space ni el *Paper_Space activo). */
  let ordenBloques: number[] = [];
  const cabeceras = new Map<number, CabeceraBloque>();
  /** El nombre de cada BLOCK, por su handle. */
  const nombresBlock = new Map<number, string>();
  const fallos: Dwg["fallos"] = [];

  /** Una entidad leída, con lo que hace falta para ponerla en su lista. */
  interface Leida {
    handle: number;
    tipo: number;
    modo: number;
    propietario: number;
    anterior: number;
    siguiente: number;
    capa: number;
    t: Traducida;
  }
  /** Desde 2004, el orden de lo de cada propietario (bloques, polilíneas e inserciones). */
  const propiasDe = new Map<number, number[]>();
  const leidas = new Map<number, Leida>();

  const handles = [...mapa.keys()].sort((a, b) => a - b);
  for (const handle of handles) {
    const offset = mapa.get(handle)!;
    let tipo = -1;
    try {
      const a = abrir(v, objetos, offset, dec);
      tipo = a.tipo;
      const clase = tipo >= 500 ? clases.get(tipo) : undefined;
      if (tipo === TIPO.LAYER_CONTROL) ordenCapas = control(v, a).entradas;
      else if (tipo === TIPO.BLOCK_CONTROL) ordenBloques = control(v, a).entradas;
      else if (tipo === TIPO.LAYER) {
        const c = capa(v, a);
        capasPorHandle.set(c.handle, c);
      } else if (tipo === TIPO.BLOCK_HEADER) {
        const c = cabeceraBloque(v, a);
        cabeceras.set(c.handle, c);
        if (c.propias) propiasDe.set(c.handle, c.propias);
      } else if (esEntidadFija(tipo) || clase?.entidad) {
        const e = entidad(v, a);
        if (e.modo === 1) continue; // espacio papel
        let t: Traducida;
        if (tipo === TIPO.BLOCK) {
          nombresBlock.set(e.handle, nombreBloque(e));
          t = soloTipo("BLOCK");
        } else if (clase && CLASES_FIJAS[clase.nombreDxf] !== undefined) t = traducir(v, { ...e, tipo: CLASES_FIJAS[clase.nombreDxf]! });
        else if (clase) t = soloTipo(clase.nombreDxf);
        else t = traducir(v, e);
        if (t.propias) propiasDe.set(e.handle, t.propias);
        leidas.set(e.handle, { handle: e.handle, tipo, modo: e.modo, propietario: e.propietario, anterior: e.anterior, siguiente: e.siguiente, capa: e.capa, t });
      }
    } catch (err) {
      if (!(err instanceof ErrorDxf)) throw err;
      fallos.push({ handle: hex(handle), tipo, mensaje: err.message });
    }
  }

  // Las capas, en el orden de su tabla (las que no están en ella, detrás, por handle)
  const capas: CapaLeida[] = [];
  const vistas = new Set<number>();
  for (const h of [...ordenCapas, ...[...capasPorHandle.keys()].sort((a, b) => a - b)]) {
    const c = capasPorHandle.get(h);
    if (!c || vistas.has(h)) continue;
    vistas.add(h);
    capas.push({ nombre: c.nombre, apagada: c.apagada, congelada: c.congelada });
  }

  // El nombre de cada bloque. En la tabla, los anónimos sólo llevan «*» y su letra («*D», «*U»…) y
  // los espacios papel, «*Paper_Space»: AutoCAD les pone detrás su posición en la tabla de bloques
  // (DW2-2), que no siempre es el número de su BLOCK (el de un bloque dinámico lleva el nombre de éste).
  const posicionBloque = new Map(ordenBloques.map((h, i) => [h, i]));
  const nombreDe = (c: CabeceraBloque) => {
    const i = posicionBloque.get(c.handle);
    if (c.nombre.startsWith("*") && !/^\*model_space$/i.test(c.nombre) && i !== undefined && !/\d$/.test(c.nombre)) return c.nombre + i;
    return c.nombre || nombresBlock.get(c.inicio) || "";
  };

  /**
   * Las entidades de una lista (el espacio modelo o lo de un propietario), en su orden: desde 2004,
   * el de la lista de su propietario; hasta 2000, de una a la siguiente, desde las que no tienen
   * anterior en ella. Lo que la lista no tiene, detrás, por handle.
   */
  const ordenar = (lista: Leida[], propias?: number[]): Leida[] => {
    if (propias) {
      const por = new Map(lista.map((e) => [e.handle, e]));
      const r: Leida[] = [];
      const puestas = new Set<number>();
      for (const h of propias) {
        const e = por.get(h);
        if (e && !puestas.has(h)) {
          puestas.add(h);
          r.push(e);
        }
      }
      for (const e of [...lista].sort((a, b) => a.handle - b.handle)) if (!puestas.has(e.handle)) r.push(e);
      return r;
    }
    const por = new Map(lista.map((e) => [e.handle, e]));
    const orden: Leida[] = [];
    const puestas = new Set<number>();
    const seguir = (inicio: Leida) => {
      for (let e: Leida | undefined = inicio; e && !puestas.has(e.handle); e = por.get(e.siguiente)) {
        puestas.add(e.handle);
        orden.push(e);
      }
    };
    const porHandle = [...lista].sort((a, b) => a.handle - b.handle);
    for (const e of porHandle) if (!por.has(e.anterior)) seguir(e);
    for (const e of porHandle) seguir(e);
    return orden;
  };

  // Lo de cada propietario (bloques, polilíneas e inserciones), y el espacio modelo
  const hijos = new Map<number, Leida[]>();
  const modelo: Leida[] = [];
  for (const e of leidas.values()) {
    if (e.modo === 2) modelo.push(e);
    else {
      let l = hijos.get(e.propietario);
      if (!l) hijos.set(e.propietario, (l = []));
      l.push(e);
    }
  }

  const NO_EN_LISTAS = new Set<number>([TIPO.BLOCK, TIPO.ENDBLK, TIPO.SEQEND]);
  const nombreCapa = (h: number) => capasPorHandle.get(h)?.nombre ?? "0";
  const aDxf = (e: Leida): Entidad => {
    const { t } = e;
    const codigos = [5, 8, ...t.codigos];
    const valores = [hex(e.handle), nombreCapa(e.capa), ...t.valores];
    if (t.bloque !== undefined) {
      const c = cabeceras.get(t.bloque);
      valores[codigos.indexOf(2)] = c ? nombreDe(c) : "";
    }
    const r: Entidad = { tipo: t.tipo, capa: nombreCapa(e.capa), codigos, valores };
    // Los VERTEX de una POLYLINE y los ATTRIB de un INSERT
    if (t.tipo === "POLYLINE" || (t.tipo === "INSERT" && codigos.includes(66))) {
      const hijo = t.tipo === "POLYLINE" ? "VERTEX" : "ATTRIB";
      r.hijos = ordenar(hijos.get(e.handle) ?? [], propiasDe.get(e.handle))
        .filter((x) => x.t.tipo === hijo)
        .map(aDxf);
    }
    return r;
  };
  const lista = (l: Leida[], propias?: number[]): Entidad[] => ordenar(l.filter((e) => !NO_EN_LISTAS.has(e.tipo) && e.t.tipo !== "VERTEX" && e.t.tipo !== "ATTRIB"), propias).map(aDxf);

  const modelSpace = [...cabeceras.values()].find((c) => /^\*model_space$/i.test(c.nombre));
  const entidades = lista(modelo, modelSpace ? propiasDe.get(modelSpace.handle) : undefined);

  // Los bloques. Lo de los espacios papel no se lee, como en el DXF (código 67)
  const bloques = new Map<string, Bloque>();
  for (const c of [...cabeceras.values()].sort((a, b) => a.handle - b.handle)) {
    if (c.xref) continue;
    const nombre = nombreDe(c);
    const papel = /^\*paper_space/i.test(nombre);
    bloques.set(nombre, { nombre, base: c.base, entidades: papel ? [] : lista(hijos.get(c.handle) ?? [], propiasDe.get(c.handle)) });
  }

  return {
    version: v.nombre,
    codificacion,
    insunits: cabeceraDwg.insunits,
    capas,
    bloques,
    entidades,
    cabeceraDwg,
    handles: entidades.map((e) => e.valores[0]!),
    fallos,
    posiciones: mapa,
  };
}
