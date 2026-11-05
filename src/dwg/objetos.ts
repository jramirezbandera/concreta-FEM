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
import { Bits, crc16, DWG_CORTADO } from "./bits.ts";
import { cmc, type Flujos } from "./cabecera.ts";
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

/** Posición del primer bit de los datos (justo detrás del MS del tamaño) y su tope. */
interface Abierto {
  tipo: number;
  inicio: number;
  fin: number;
  d: Bits;
}

/** Abre el objeto que empieza en el byte `offset` de `buf` y lee su tipo. */
export function abrir(v: Version, buf: Uint8Array, offset: number): Abierto {
  if (!Number.isInteger(offset) || offset < 0 || offset >= buf.length) throw new ErrorDxf(DWG_CORTADO);
  const c = new Bits(buf, offset * 8);
  const tam = c.MS();
  if (tam <= 0) throw new ErrorDxf("El DWG está dañado: un objeto de tamaño 0.");
  const inicio = c.pos;
  const fin = inicio + tam * 8;
  if (v.r2010) throw new Error("objetos de R2010+: DW3");
  // RS: el CRC del tamaño y los datos, detrás de ellos
  const crc = crc16(buf, offset, fin >> 3);
  if (c.en(fin, buf.length * 8).RSu() !== crc) throw new ErrorDxf("El objeto no pasa su CRC: el DWG está dañado.");
  const d = c.en(inicio, fin);
  return { tipo: d.BS(), inicio, fin, d };
}

/** RL con el tamaño de los datos en bits: el flujo de handles empieza ahí. */
function flujos(a: Abierto): Flujos {
  const bits = a.d.RL();
  const h = a.d.en(a.inicio + bits, a.fin);
  return { d: a.d, t: a.d, h };
}

/** El handle del objeto y sus datos extendidos (EED), que se saltan. Hasta R2007 lleva el tamaño de los datos. */
function comun(v: Version, a: Abierto): { handle: number; f: Flujos | null } {
  const f = v.r2000 && !v.r2010 ? flujos(a) : null;
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
  const n = f.d.BL();
  if (n < 0 || n > 1e6) throw new ErrorDxf("El DWG está dañado: un número de reactores fuera de rango.");
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
  /** La anterior y la siguiente de la lista (hasta R2000). */
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
  if (v.r2004) throw new Error("color de entidad de R2004+: DW3");
  d.BS(); // color
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
  const n = o.f.d.BL();
  if (n < 0 || n > 1e6) throw new ErrorDxf("El DWG está dañado: una tabla con un número de entradas fuera de rango.");
  const entradas: number[] = [];
  for (let i = 0; i < n; i++) entradas.push(o.f.h.H());
  return { objeto: o, entradas };
}

/** El nombre de una entrada de tabla y sus banderas de referencia externa. */
function nombreEntrada(v: Version, o: Objeto, dec: TextDecoder): string {
  const nombre = o.f.t.TV(dec);
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

export function capa(v: Version, a: Abierto, dec: TextDecoder): CapaDwg {
  const o = objeto(v, a);
  const nombre = nombreEntrada(v, o, dec);
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

// ─── Entidades ──────────────────────────────────────────────────────────────────────────────────

/** Una entidad traducida a sus pares de DXF (los códigos de grupo que lee `aplanar.ts`). */
export interface Pares {
  tipo: string;
  codigos: number[];
  valores: string[];
}

const GRADOS = 180 / Math.PI;

function pares(tipo: string): Pares & { p: (c: number, v: number | string) => void; extrusion: (e: readonly number[]) => void; espesor: (t: number) => void } {
  const r = {
    tipo,
    codigos: [] as number[],
    valores: [] as string[],
    p(c: number, v: number | string) {
      r.codigos.push(c);
      r.valores.push(typeof v === "number" ? String(v) : v);
    },
    espesor(t: number) {
      if (t !== 0) r.p(39, t);
    },
    extrusion(e: readonly number[]) {
      if (e[0] !== 0 || e[1] !== 0 || e[2] !== 1) {
        r.p(210, e[0]!);
        r.p(220, e[1]!);
        r.p(230, e[2]!);
      }
    },
  };
  return r;
}

const sinAyudas = (r: ReturnType<typeof pares>): Pares => ({ tipo: r.tipo, codigos: r.codigos, valores: r.valores });

export function linea(v: Version, e: Entidad): Pares {
  const { d } = e.f;
  const r = pares("LINE");
  let a: number[];
  let b: number[];
  if (v.r13_14) {
    a = d.BD3();
    b = d.BD3();
  } else {
    const zCero = d.B() === 1;
    const x0 = d.RD();
    const x1 = d.DD(x0);
    const y0 = d.RD();
    const y1 = d.DD(y0);
    let z0 = 0;
    let z1 = 0;
    if (!zCero) {
      z0 = d.RD();
      z1 = d.DD(z0);
    }
    a = [x0, y0, z0];
    b = [x1, y1, z1];
  }
  const t = d.BT(v.r2000);
  const ext = d.BE(v.r2000);
  r.espesor(t);
  r.p(10, a[0]!);
  r.p(20, a[1]!);
  r.p(30, a[2]!);
  r.p(11, b[0]!);
  r.p(21, b[1]!);
  r.p(31, b[2]!);
  r.extrusion(ext);
  return sinAyudas(r);
}

export function circuloOArco(v: Version, e: Entidad): Pares {
  const { d } = e.f;
  const arco = e.tipo === TIPO.ARC;
  const r = pares(arco ? "ARC" : "CIRCLE");
  const c = d.BD3();
  const radio = d.BD();
  const t = d.BT(v.r2000);
  const ext = d.BE(v.r2000);
  r.espesor(t);
  r.p(10, c[0]);
  r.p(20, c[1]);
  r.p(30, c[2]);
  r.p(40, radio);
  r.extrusion(ext);
  if (arco) {
    r.p(50, d.BD() * GRADOS);
    r.p(51, d.BD() * GRADOS);
  }
  return sinAyudas(r);
}
