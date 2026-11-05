/**
 * Los objetos de un DWG (fase DW): el mapa de handles (AcDb:Handles), la cabecera común de cada
 * objeto y de cada entidad, y los tipos que se traducen. Portado de ACadSharp
 * (`IO/DWG/DwgStreamReaders/DwgHandleReader.cs` y `DwgObjectReader.cs`; MIT, commit d9f3de8,
 * citado en `NOTICE`).
 *
 * Cada objeto tiene tres flujos: los datos, los textos (hasta R2007, los mismos datos) y los
 * handles, que empiezan donde dice el tamaño en bits de los datos. Se leen en paralelo: lo que la
 * especificación pone «en los handles» se lee del flujo de handles, en su orden.
 *
 * Puro: sin IO, sin React ni DOM.
 */

import { ErrorDxf } from "../dxf/lector.ts";
import { Bits, crc16, DWG_CORTADO, flujoCadenas } from "./bits.ts";
import { cmc, type Flujos, hacerFlujos } from "./cabecera.ts";
import type { Version } from "./version.ts";

/** Los tipos fijos de objeto (Open Design Specification §20.4.1; `Types/ObjectType.cs` de ACadSharp). */
export const TIPO = {
  TEXT: 0x01,
  ATTRIB: 0x02,
  ATTDEF: 0x03,
  BLOCK: 0x04,
  ENDBLK: 0x05,
  SEQEND: 0x06,
  INSERT: 0x07,
  MINSERT: 0x08,
  VERTEX_2D: 0x0a,
  VERTEX_3D: 0x0b,
  VERTEX_MESH: 0x0c,
  VERTEX_PFACE: 0x0d,
  VERTEX_PFACE_FACE: 0x0e,
  POLYLINE_2D: 0x0f,
  POLYLINE_3D: 0x10,
  ARC: 0x11,
  CIRCLE: 0x12,
  LINE: 0x13,
  DIMENSION_ORDINATE: 0x14,
  DIMENSION_LINEAR: 0x15,
  DIMENSION_ALIGNED: 0x16,
  DIMENSION_ANG_3PT: 0x17,
  DIMENSION_ANG_2LN: 0x18,
  DIMENSION_RADIUS: 0x19,
  DIMENSION_DIAMETER: 0x1a,
  POINT: 0x1b,
  FACE3D: 0x1c,
  POLYLINE_PFACE: 0x1d,
  POLYLINE_MESH: 0x1e,
  SOLID: 0x1f,
  TRACE: 0x20,
  SHAPE: 0x21,
  VIEWPORT: 0x22,
  ELLIPSE: 0x23,
  SPLINE: 0x24,
  REGION: 0x25,
  SOLID3D: 0x26,
  BODY: 0x27,
  RAY: 0x28,
  XLINE: 0x29,
  DICTIONARY: 0x2a,
  OLEFRAME: 0x2b,
  MTEXT: 0x2c,
  LEADER: 0x2d,
  TOLERANCE: 0x2e,
  MLINE: 0x2f,
  BLOCK_CONTROL: 0x30,
  BLOCK_HEADER: 0x31,
  LAYER_CONTROL: 0x32,
  LAYER: 0x33,
  OLE2FRAME: 0x4a,
  LWPOLYLINE: 0x4d,
  HATCH: 0x4e,
} as const;

/** Los tipos fijos que son entidades (los demás fijos son objetos no gráficos). */
export function esEntidadFija(t: number): boolean {
  if (t === 0x1f2) return true; // ACAD_PROXY_ENTITY
  return (t >= 0x01 && t <= 0x29 && t !== 0x09) || (t >= 0x2b && t <= 0x2f) || t === TIPO.OLE2FRAME || t === TIPO.LWPOLYLINE || t === TIPO.HATCH;
}

// ─── El mapa de handles ─────────────────────────────────────────────────────────────────────────

/**
 * AcDb:Handles: trozos de hasta 2032 bytes con su tamaño en big-endian, cada uno con pares
 * (incremento del handle, incremento de la posición) en MC, y su CRC. Acaba en un trozo de tamaño 2.
 * Da handle → posición en bytes del objeto (absoluta hasta R2000; en AcDb:AcDbObjects desde 2004).
 */
export function leerMapa(s: Bits): Map<number, number> {
  const mapa = new Map<number, number>();
  for (let trozo = 0; ; trozo++) {
    if (trozo > 1e6) throw new ErrorDxf("El DWG está dañado: el mapa de objetos no acaba.");
    let handle = 0;
    let pos = 0;
    const inicio = s.pos >> 3;
    const tam = s.RSbe();
    if (tam === 2) break;
    if (tam < 2) throw new ErrorDxf("El DWG está dañado: un trozo del mapa de objetos con tamaño menor que 2.");
    const fin = s.pos + 8 * Math.min(tam - 2, 2032);
    while (s.pos < fin) {
      const dh = s.MC();
      handle += dh;
      pos += s.MCs();
      if (dh > 0) mapa.set(handle, pos);
    }
    const crc = crc16(s.buf, inicio, s.pos >> 3);
    if (s.RSbe() !== crc) throw new ErrorDxf("El DWG está dañado: el mapa de objetos no pasa su CRC.");
  }
  return mapa;
}

// ─── La cabecera común ──────────────────────────────────────────────────────────────────────────

/** Un objeto abierto: su tipo, su handle y sus flujos. */
export interface Objeto {
  tipo: number;
  handle: number;
  f: Flujos;
}

/** Un objeto con su tipo leído: dónde empiezan y acaban sus datos y, desde 2010, sus flujos. */
export interface Abierto {
  tipo: number;
  inicio: number;
  fin: number;
  d: Bits;
  /** Desde 2010, los flujos ya están (el tamaño de los handles va delante); antes, los da el RL de la cabecera común. */
  f: Flujos | null;
  v: Version;
  dec: TextDecoder;
}

/**
 * Abre el objeto que empieza en el byte `offset` de `buf` (el fichero hasta 2000; la sección
 * AcDb:AcDbObjects desde 2004) y lee su tipo. Comprueba su CRC: el del tamaño (MS), el tamaño de
 * los handles (MC, desde 2010) y los datos.
 */
export function abrir(v: Version, buf: Uint8Array, offset: number, dec: TextDecoder): Abierto {
  if (!Number.isInteger(offset) || offset < 0 || offset >= buf.length) throw new ErrorDxf(DWG_CORTADO);
  const c = new Bits(buf, offset * 8);
  const tam = c.MS();
  if (tam <= 0) throw new ErrorDxf("El DWG está dañado: un objeto de tamaño 0.");
  const bitsHandles = v.r2010 ? c.MC() : 0;
  const inicio = c.pos;
  const fin = inicio + tam * 8;
  // RS: el CRC, detrás de los datos
  const crc = crc16(buf, offset, fin >> 3);
  if (c.en(fin, buf.length * 8).RSu() !== crc) throw new ErrorDxf("El objeto no pasa su CRC: el DWG está dañado.");
  if (!v.r2010) {
    const d = c.en(inicio, fin);
    return { tipo: d.BS(), inicio, fin, d, f: null, v, dec };
  }
  // Desde 2010: los handles, al final; las cadenas, delante de ellos (con su bandera justo antes)
  const finDatos = fin - bitsHandles;
  if (bitsHandles > tam * 8 || finDatos <= inicio) throw new ErrorDxf("El DWG está dañado: un objeto con más handles que datos.");
  const d = c.en(inicio, finDatos);
  const h = c.en(finDatos, fin);
  const t = flujoCadenas(buf, finDatos - 1);
  // El tipo (desde 2010): BB y un RC, 0x1F0 más un RC, o un RS
  const par = d.BB();
  const tipo = par === 0 ? d.RC() : par === 1 ? 0x1f0 + d.RC() : d.RSu();
  return { tipo, inicio, fin, d, f: hacerFlujos(v, d, t, h, dec), v, dec };
}

/**
 * Hasta 2007: el RL con el tamaño de los datos en bits; el flujo de handles empieza ahí. En 2007, las
 * cadenas van delante de los handles, con su bandera en el último bit de los datos.
 */
function flujos(a: Abierto): Flujos {
  const bits = a.d.RL();
  const h = a.d.en(a.inicio + bits, a.fin);
  if (a.v.r2007) return hacerFlujos(a.v, a.d, flujoCadenas(a.d.buf, a.inicio + bits - 1), h, a.dec);
  return hacerFlujos(a.v, a.d, a.d, h, a.dec);
}

/** El handle del objeto y sus datos extendidos (EED), que se saltan. De 2000 a 2007, antes va el tamaño de los datos. */
function comun(v: Version, a: Abierto): { handle: number; f: Flujos | null } {
  const f = a.f ?? (v.r2000 ? flujos(a) : null);
  const handle = a.d.H();
  for (let tam = a.d.BS(), k = 0; tam !== 0; tam = a.d.BS(), k++) {
    if (tam < 0 || k > 1e5) throw new ErrorDxf("El DWG está dañado: datos extendidos con un tamaño negativo.");
    a.d.H(); // la aplicación
    a.d.saltar(tam);
  }
  return { handle, f };
}

/** Los reactores y el diccionario de extensión, en los handles. */
function reactores(v: Version, f: Flujos): void {
  const n = f.h.cuenta(f.d.BL(), 8);
  for (let i = 0; i < n; i++) f.h.H();
  if (!(v.r2004 && f.d.B() === 1)) f.h.H();
  if (v.r2013) f.d.B();
}

/** Un objeto no gráfico, con su cabecera leída. */
export function objeto(v: Version, a: Abierto): Objeto {
  const c = comun(v, a);
  const f = c.f ?? flujos(a);
  f.h.H(c.handle); // propietario
  reactores(v, f);
  return { tipo: a.tipo, handle: c.handle, f };
}

/** Lo común de una entidad que se usa: su modo, su capa y sus vecinas en la lista del bloque. */
export interface Entidad extends Objeto {
  /** 0: con propietario (bloques, vértices, atributos); 1: espacio papel; 2: espacio modelo. */
  modo: number;
  propietario: number;
  capa: number;
  /** La anterior y la siguiente de la lista (hasta 2000; desde 2004, el orden lo da el propietario). */
  anterior: number;
  siguiente: number;
  invisible: boolean;
}

export function entidad(v: Version, a: Abierto): Entidad {
  const c = comun(v, a);
  const { d } = a;
  if (d.B() === 1) d.saltar(v.r2010 ? d.BLL() : d.RLu()); // gráficos del proxy
  const f = c.f ?? flujos(a);
  const { h } = f;
  const modo = d.BB();
  const propietario = modo === 0 ? h.H(c.handle) : 0;
  reactores(v, f);
  let capa = 0;
  if (v.r13_14) {
    capa = h.H();
    if (d.B() === 0) h.H(); // tipo de línea
  }
  let anterior = c.handle - 1;
  let siguiente = c.handle + 1;
  if (!v.r2004 && d.B() === 0) {
    anterior = h.H(c.handle);
    siguiente = h.H(c.handle);
  }
  if (!v.r2004) d.BS(); // color
  else {
    // ENC: BS con el índice y las banderas. 0x4000: color de libro (un handle, sin RGB; DW3-3); si no,
    // 0x8000: RGB (BL). 0x2000: transparencia (BL).
    const n = d.BS() & 0xffff;
    if (n !== 0) {
      if (n & 0x4000) h.H();
      else if (n & 0x8000) d.BL();
      if (n & 0x2000) d.BL();
    }
  }
  d.BD(); // escala del tipo de línea
  if (v.r2000) {
    capa = h.H();
    if (d.BB() === 3) h.H(); // tipo de línea
    if (v.r2007) {
      if (d.BB() === 3) h.H(); // material
      d.RC(); // sombras
    }
    if (d.BB() === 3) h.H(); // estilo de trazado
    if (v.r2010) for (let i = 0; i < 3; i++) if (d.B() === 1) h.H(); // estilos visuales
  }
  const invisible = (d.BS() & 1) === 1;
  if (v.r2000) d.RC(); // grosor de línea
  return { tipo: a.tipo, handle: c.handle, f, modo, propietario, capa, anterior, siguiente, invisible };
}

// ─── Tablas ─────────────────────────────────────────────────────────────────────────────────────

/** Un objeto de control de tabla: los handles de sus entradas, en su orden. */
export function control(v: Version, a: Abierto): { objeto: Objeto; entradas: number[] } {
  const o = objeto(v, a);
  const n = o.f.h.cuenta(o.f.d.BL(), 8);
  const entradas: number[] = [];
  for (let i = 0; i < n; i++) entradas.push(o.f.h.H());
  return { objeto: o, entradas };
}

/** El nombre de una entrada de tabla y sus banderas de referencia externa. */
function nombreEntrada(v: Version, o: Objeto): string {
  const nombre = o.f.tv();
  if (v.r2007) o.f.d.BS();
  else {
    o.f.d.B();
    o.f.d.BS();
    o.f.d.B();
  }
  return nombre;
}

export interface CapaDwg {
  handle: number;
  nombre: string;
  apagada: boolean;
  congelada: boolean;
}

export function capa(v: Version, a: Abierto): CapaDwg {
  const o = objeto(v, a);
  const nombre = nombreEntrada(v, o);
  const { d } = o.f;
  let congelada = false;
  let apagada = false;
  if (v.r13_14) {
    congelada = d.B() === 1;
    apagada = d.B() === 1;
    d.B();
    d.B();
  } else {
    const valores = d.BS();
    congelada = (valores & 1) !== 0;
    apagada = (valores & 2) !== 0;
  }
  const color = cmc(v, o.f);
  return { handle: o.handle, nombre, apagada: apagada || color < 0, congelada };
}

// ─── Bloques ────────────────────────────────────────────────────────────────────────────────────

export interface CabeceraBloque {
  handle: number;
  /** El de la tabla: en los anónimos, sólo «*» y su letra; el completo va en su BLOCK. */
  nombre: string;
  xref: boolean;
  base: [number, number, number];
  /** El BLOCK que abre su definición. */
  inicio: number;
  /** Desde 2004, sus entidades en su orden (hasta 2000, la lista va de una a la siguiente). */
  propias: number[] | null;
}

export function cabeceraBloque(v: Version, a: Abierto): CabeceraBloque {
  const o = objeto(v, a);
  const nombre = nombreEntrada(v, o);
  const { d, h } = o.f;
  d.B(); // anónimo
  d.B(); // con atributos
  const xref = d.B() === 1;
  const superpuesto = d.B() === 1;
  if (v.r2000) d.B(); // cargado
  const n = v.r2004 && !xref && !superpuesto ? h.cuenta(d.BL(), 8) : 0;
  const base = d.BD3();
  h.H(); // NULL
  const inicio = h.H();
  let propias: number[] | null = null;
  if (v.r2004) {
    propias = [];
    for (let i = 0; i < n; i++) propias.push(h.H());
  }
  return { handle: o.handle, nombre, xref: xref || superpuesto, base, inicio, propias };
}

/** El nombre de un BLOCK (un texto, detrás de la cabecera común de entidad). */
export function nombreBloque(e: Entidad): string {
  return e.f.tv();
}

// ─── Clases ─────────────────────────────────────────────────────────────────────────────────────

const SENTINELA_CLASES = [0x8d, 0xa1, 0xc4, 0xb8, 0xc4, 0xa9, 0xf8, 0xc5, 0xc0, 0xdc, 0xf4, 0x5f, 0xe7, 0xcf, 0xb6, 0x8a];

export interface Clase {
  numero: number;
  nombreDxf: string;
  /** 0x1F2: produce entidades; 0x1F3: objetos. */
  entidad: boolean;
}

/**
 * AcDb:Classes: las clases (tipo ≥ 500) con su nombre de DXF. `mantenimiento` es el del fichero
 * (en 2010 y 2013, con > 3 lleva un RL más tras el tamaño, como la cabecera).
 */
export function leerClases(v: Version, s: Bits, dec: TextDecoder, mantenimiento = 0): Map<number, Clase> {
  const inicio = s.pos >> 3;
  const marca = s.bytes(16);
  if (!SENTINELA_CLASES.every((x, i) => marca[i] === x)) throw new ErrorDxf("El DWG está dañado: la sección de las clases no empieza por su marca.");
  const tam = s.RLu();
  const extra = (v.r2010 && mantenimiento > 3) || v.r2018;
  if (extra) s.RL();
  const datos = s.pos >> 3;
  const fin = datos + tam;
  const clases = new Map<number, Clase>();
  const d = s.en(s.pos, fin * 8);
  let t: Bits | null = d;
  let finDatos = fin * 8;
  if (v.r2007) {
    // RL con el tamaño en bits; la bandera de las cadenas, en su último bit
    const bandera = d.pos + d.RLu() - 1;
    t = flujoCadenas(s.buf, bandera);
    finDatos = t ? t.pos : bandera;
    d.BL(); // 0
    d.B();
  }
  if (v.r2004 && !v.r2007) {
    d.BS(); // el mayor número de clase
    d.RC();
    d.RC();
    d.B();
  }
  const f = hacerFlujos(v, d, t, d, dec);
  const queda = () => (v.r2007 ? d.pos < finDatos : Math.ceil(d.pos / 8) < fin);
  for (let k = 0; queda(); k++) {
    if (k > 1e5) throw new ErrorDxf("El DWG está dañado: la sección de las clases no acaba.");
    const numero = d.BS();
    d.BS(); // banderas de proxy
    f.tv(); // aplicación
    f.tv(); // clase de C++
    const nombreDxf = f.tv();
    d.B(); // zombi
    const id = d.BS();
    if (v.r2004) for (let i = 0; i < 5; i++) d.BL(); // instancias, versión, mantenimiento y dos más
    clases.set(numero, { numero, nombreDxf, entidad: id === 0x1f2 });
  }
  // RS: el CRC del tamaño y los datos, desde detrás de la marca
  const crc = crc16(s.buf, inicio + 16, fin);
  if (s.en(fin * 8).RSu() !== crc) throw new ErrorDxf("El DWG está dañado: la sección de las clases no pasa su CRC.");
  return clases;
}
