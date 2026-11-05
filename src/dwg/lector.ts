/**
 * Lector de DWG (fase DW, `docs/fem3d/dwg.md`). Da el mismo `Dxf` que `src/dxf/lector.ts`: la
 * cabecera, las capas y las entidades del espacio modelo con sus pares de DXF, así que lo que viene
 * detrás (`aplanar.ts`, la plantilla, los enganches) no sabe de dónde viene el dibujo.
 *
 * Portado de ACadSharp (`IO/DwgReader.cs` y `IO/DWG/`; MIT, commit d9f3de8, citado en `NOTICE`).
 * Tramo DW1: R13–R2000 (AC1012, AC1014, AC1015), con las capas y `LINE`, `ARC` y `CIRCLE`.
 *
 * - Lo que el fichero dice mal (tamaños, posiciones, handles) es un `ErrorDxf`. Un objeto que no se
 *   puede leer se salta y queda en `fallos`, como en ACadSharp: el resto del dibujo sirve.
 * - Lo del espacio papel no se lee (modo 1), como en el DXF.
 * - Las entidades del espacio modelo van en el orden de su lista (anterior y siguiente).
 *
 * Puro: sin IO, sin React ni DOM.
 */

import { type CapaLeida, type Dxf, type Entidad, ErrorDxf } from "../dxf/lector.ts";
import { Bits, crc16 } from "./bits.ts";
import { type CabeceraDwg, leerCabecera } from "./cabecera.ts";
import { abrir, capa, type CapaDwg, circuloOArco, control, entidad, esEntidadFija, leerMapa, linea, type Pares, TIPO } from "./objetos.ts";
import { type Version, version } from "./version.ts";

/** Lo que da `leerDwg`, además del `Dxf`. */
export interface Dwg extends Dxf {
  cabeceraDwg: CabeceraDwg;
  /** El handle (en hexadecimal, como el código 5 del DXF) de cada entidad del espacio modelo. */
  handles: string[];
  /** Los objetos que no se pudieron leer. */
  fallos: { handle: string; tipo: number; mensaje: string }[];
  /** Entidades del espacio modelo que se leyeron pero aún no se traducen, por tipo. */
  sinTraducir: Map<number, number>;
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

function seccion(secciones: Map<number, Seccion>, num: number, nombre: string, bytes: Uint8Array): Seccion {
  const sec = secciones.get(num);
  if (!sec || sec.posicion + sec.tamano > bytes.length) throw new ErrorDxf(`El DWG está dañado: le falta la sección ${nombre}.`);
  return sec;
}

export function leerDwg(bytes: Uint8Array): Dwg {
  if (!esDwg(bytes)) throw new ErrorDxf("No es un DWG.");
  const v: Version = version(String.fromCharCode(...bytes.subarray(0, 6)));

  const { pagina, secciones } = cabeceraFichero15(bytes);
  const codificacion = paginaDwg(pagina);
  const dec = new TextDecoder(codificacion);

  // AcDb:Header
  const sc = seccion(secciones, 0, "de la cabecera", bytes);
  const hc = new Bits(bytes, sc.posicion * 8, (sc.posicion + sc.tamano) * 8);
  const sentinela = hc.bytes(16);
  if (!SENTINELA_CABECERA.every((x, i) => sentinela[i] === x)) throw new ErrorDxf("El DWG está dañado: la sección de la cabecera no empieza por su marca.");
  const tamCabecera = hc.RLu();
  const dc = hc.en(hc.pos, hc.pos + tamCabecera * 8);
  // RS: el CRC del tamaño y los datos, desde detrás de la marca
  const desde = sc.posicion + 16;
  const hasta = desde + 4 + tamCabecera;
  if (hc.en(hasta * 8).RSu() !== crc16(bytes, desde, hasta)) throw new ErrorDxf("El DWG está dañado: la sección de la cabecera no pasa su CRC.");
  const cabeceraDwg = leerCabecera(v, { d: dc, t: dc, h: dc }, dec);

  // AcDb:Handles
  const sm = seccion(secciones, 2, "del mapa de objetos", bytes);
  const mapa = leerMapa(new Bits(bytes, sm.posicion * 8, (sm.posicion + sm.tamano) * 8));

  const capasPorHandle = new Map<number, CapaDwg>();
  let ordenCapas: number[] = [];
  const fallos: Dwg["fallos"] = [];
  const sinTraducir = new Map<number, number>();
  interface Leida {
    handle: number;
    anterior: number;
    siguiente: number;
    pares: Pares | null;
    capa: number;
  }
  const modelo = new Map<number, Leida>();

  const handles = [...mapa.keys()].sort((a, b) => a - b);
  for (const handle of handles) {
    const offset = mapa.get(handle)!;
    let tipo = -1;
    try {
      const a = abrir(v, bytes, offset);
      tipo = a.tipo;
      if (tipo === TIPO.LAYER_CONTROL) {
        ordenCapas = control(v, a).entradas;
      } else if (tipo === TIPO.LAYER) {
        const c = capa(v, a, dec);
        capasPorHandle.set(c.handle, c);
      } else if (esEntidadFija(tipo)) {
        const e = entidad(v, a);
        if (e.modo !== 2) continue;
        let p: Pares | null = null;
        if (tipo === TIPO.LINE) p = linea(v, e);
        else if (tipo === TIPO.ARC || tipo === TIPO.CIRCLE) p = circuloOArco(v, e);
        else if (tipo !== TIPO.BLOCK && tipo !== TIPO.ENDBLK && tipo !== TIPO.SEQEND) sinTraducir.set(tipo, (sinTraducir.get(tipo) ?? 0) + 1);
        modelo.set(e.handle, { handle: e.handle, anterior: e.anterior, siguiente: e.siguiente, pares: p, capa: e.capa });
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

  // Las entidades del espacio modelo, por su lista: desde las que no tienen anterior en él
  const orden: Leida[] = [];
  const puestas = new Set<number>();
  const seguir = (inicio: Leida) => {
    for (let e: Leida | undefined = inicio; e && !puestas.has(e.handle); e = modelo.get(e.siguiente)) {
      puestas.add(e.handle);
      orden.push(e);
    }
  };
  for (const h of [...modelo.keys()].sort((a, b) => a - b)) {
    const e = modelo.get(h)!;
    if (!modelo.has(e.anterior)) seguir(e);
  }
  for (const h of [...modelo.keys()].sort((a, b) => a - b)) seguir(modelo.get(h)!);

  const entidades: Entidad[] = [];
  const handlesModelo: string[] = [];
  for (const e of orden) {
    if (!e.pares) continue;
    const nombreCapa = capasPorHandle.get(e.capa)?.nombre ?? "0";
    entidades.push({ tipo: e.pares.tipo, capa: nombreCapa, codigos: [5, 8, ...e.pares.codigos], valores: [hex(e.handle), nombreCapa, ...e.pares.valores] });
    handlesModelo.push(hex(e.handle));
  }

  return {
    version: v.nombre,
    codificacion,
    insunits: cabeceraDwg.insunits,
    capas,
    bloques: new Map(),
    entidades,
    cabeceraDwg,
    handles: handlesModelo,
    fallos,
    sinTraducir,
    posiciones: mapa,
  };
}
