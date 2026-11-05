/**
 * Las secciones de un DWG 2007 (AC1021; fase DW, tramo DW5). Portado de ACadSharp (`IO/DwgReader.cs`:
 * `readFileHeaderAC21`, `getPageBuffer`, `getSectionBuffer21`, `reedSolomonDecoding`;
 * `IO/DWG/DwgStreamReaders/DwgLZ77AC21Decompressor.cs`; y, para comprobar lo leído, lo que escribe
 * su escritor: `IO/DWG/CRC.cs`, `DwgStreamWriters/ReedSolomon.cs`, `DwgChecksumCalculatorAC21.cs`,
 * `DwgFileHeaderWriterAC21.cs` y `DwgCheckDataAC21.cs`; MIT, commit d9f3de8, citado en `NOTICE`).
 *
 * Es un formato aparte, que no vuelve en 2010: la cabecera del fichero (0x80), el mapa de páginas y
 * el de secciones van codificados con Reed-Solomon (255, 239) y entrelazados, las páginas de datos
 * con (255, 251), y lo comprimido, con un LZ77 distinto del de 2004 (sus literales se copian en
 * trozos con los bytes en otro orden). Las posiciones de las páginas son desde 0x480.
 *
 * Todo lo que el fichero lleva para comprobarse se comprueba (ACadSharp sólo desentrelaza, sin mirar
 * la paridad, y no mira ningún CRC): la paridad de cada bloque de Reed-Solomon, los CRC-64 de la
 * cabecera y de lo comprimido, y el CRC-64 y la suma de cada página de datos. Una que no cuadra es un
 * `ErrorDxf`: el fichero está dañado. Los CRC del mapa de páginas y del de secciones llevan una
 * semilla cifrada que no se sabe descifrar: a esos dos los cubre su Reed-Solomon.
 *
 * Puro: sin IO, sin React ni DOM.
 */

import { ErrorDxf } from "../dxf/lector.ts";
import { DWG_CORTADO } from "./bits.ts";
import type { Secciones2004 } from "./secciones2004.ts";

const DANADO = (que: string) => new ErrorDxf(`El DWG está dañado: ${que}.`);
const vista = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Un entero de 8 bytes sin signo en p (que quepa en un double), comprobando que esté. */
function rll(b: Uint8Array, p: number): number {
  if (p < 0 || p + 8 > b.length) throw new ErrorDxf(DWG_CORTADO);
  const v = vista(b);
  return v.getUint32(p, true) + v.getUint32(p + 4, true) * 2 ** 32;
}

const align8 = (n: number) => Math.ceil(n / 8) * 8;

// ─── CRC-64 ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Las tablas del CRC-64 de `CRC.cs`, generadas: la normal es la del ECMA-182 (0x42F0E1EBA9EA3693,
 * del bit alto al bajo) y la reflejada, la de Jones (0x95AC9329AC4BC9B5). Cada entrada, en dos
 * mitades de 32 bits.
 */
function tablas64(): { nHi: Uint32Array; nLo: Uint32Array; mHi: Uint32Array; mLo: Uint32Array } {
  const nHi = new Uint32Array(256);
  const nLo = new Uint32Array(256);
  const mHi = new Uint32Array(256);
  const mLo = new Uint32Array(256);
  const P = 0x42f0e1eba9ea3693n;
  const R = 0x95ac9329ac4bc9b5n;
  const M64 = (1n << 64n) - 1n;
  for (let i = 0; i < 256; i++) {
    let c = BigInt(i) << 56n;
    for (let k = 0; k < 8; k++) c = c >> 63n ? ((c << 1n) ^ P) & M64 : (c << 1n) & M64;
    nHi[i] = Number(c >> 32n);
    nLo[i] = Number(c & 0xffffffffn);
    let r = BigInt(i);
    for (let k = 0; k < 8; k++) r = r & 1n ? (r >> 1n) ^ R : r >> 1n;
    mHi[i] = Number(r >> 32n);
    mLo[i] = Number(r & 0xffffffffn);
  }
  return { nHi, nLo, mHi, mLo };
}
let TABLAS: ReturnType<typeof tablas64> | null = null;

const M64 = (1n << 64n) - 1n;

/** `CRC.UpdateSeed1`: la semilla de un CRC-64 por el tamaño de lo que cubre. */
export function semilla1(semilla: bigint, n: number): bigint {
  let s = ((semilla + BigInt(n)) * 0x343fdn + 0x269ec3n) & M64;
  s = (s | ((s * 0x343fd00000000n + 0x269ec300000000n) & M64)) & M64;
  return ~s & M64;
}

/** `CRC.UpdateSeed2`. */
export function semilla2(semilla: bigint, n: number): bigint {
  let s = ((semilla + BigInt(n)) * 0x343fdn + 0x269ec3n) & M64;
  s = (s * 0x1000343fdn + BigInt(n) + 0x269ec3n) & M64;
  return ~s & M64;
}

/**
 * `CRC.Encode`: el CRC-64 de los `n` bytes de buf desde `desde`, que se recorren de 8 en 8 con los
 * pares de bytes al revés (6, 4, 2, 0); normal (con el complemento al final) o reflejado.
 */
export function crc64(buf: Uint8Array, desde: number, n: number, semilla: bigint, reflejado: boolean): bigint {
  if (desde < 0 || desde + n > buf.length) throw new ErrorDxf(DWG_CORTADO);
  const t = (TABLAS ??= tablas64());
  let hi = Number(semilla >> 32n) >>> 0;
  let lo = Number(semilla & 0xffffffffn) >>> 0;
  const uno = reflejado
    ? (v: number) => {
        const i = (lo ^ v) & 0xff;
        lo = (((lo >>> 8) | (hi << 24)) ^ t.mLo[i]!) >>> 0;
        hi = ((hi >>> 8) ^ t.mHi[i]!) >>> 0;
      }
    : (v: number) => {
        const i = (v ^ (hi >>> 24)) & 0xff;
        hi = (((hi << 8) | (lo >>> 24)) ^ t.nHi[i]!) >>> 0;
        lo = ((lo << 8) ^ t.nLo[i]!) >>> 0;
      };
  const par = (p: number) => {
    uno(buf[p]!);
    uno(buf[p + 1]!);
  };
  let p = desde;
  for (let k = n >>> 3; k > 0; k--, p += 8) {
    par(p + 6);
    par(p + 4);
    par(p + 2);
    par(p);
  }
  switch (n & 7) {
    case 1: uno(buf[p]!); break;
    case 2: par(p); break;
    case 3: par(p); uno(buf[p + 2]!); break;
    case 4: par(p + 2); par(p); break;
    case 5: par(p + 2); par(p); uno(buf[p + 4]!); break;
    case 6: par(p + 2); par(p); par(p + 4); break;
    case 7: par(p + 2); par(p); par(p + 4); uno(buf[p + 6]!); break;
  }
  const r = (BigInt(hi) << 32n) | BigInt(lo);
  return reflejado ? r : ~r & M64;
}

/** `DwgCheckDataAC21.Encode`: gira el valor a la izquierda lo que digan los 5 bits bajos de `giro`. */
function girar(valor: bigint, giro: bigint): bigint {
  const r = giro & 0x1fn;
  return r === 0n ? valor : ((valor << r) | (valor >> (64n - r))) & M64;
}

/**
 * `DwgChecksumCalculatorAC21.Calculate`: la suma de una página de 2007 (una variante de Adler-32 en
 * trozos de 0x15B0, con la semilla mezclada con el tamaño y los pares de bytes en otro orden).
 */
export function sumaPagina2007(semilla: number, buf: Uint8Array, desde: number, n: number): number {
  if (desde < 0 || desde + n > buf.length) throw new ErrorDxf(DWG_CORTADO);
  const s = (Math.imul((semilla + n) >>> 0, 0x343fd) + 2531011) >>> 0;
  let s1 = s & 0xffff;
  let s2 = (s >>> 16) & 0xffff;
  let p = desde;
  const uno = (i: number) => {
    s1 += buf[i]!;
    s2 += s1;
  };
  const dos = (i: number) => {
    uno(i);
    uno(i + 1);
  };
  for (let queda = n; queda > 0; s1 %= 0xfff1, s2 %= 0xfff1) {
    const trozo = Math.min(0x15b0, queda);
    queda -= trozo;
    for (let k = trozo >>> 3; k > 0; k--, p += 8) {
      dos(p + 6);
      dos(p + 4);
      dos(p + 2);
      dos(p);
    }
    const resto = trozo & 7;
    switch (resto) {
      case 1: uno(p); break;
      case 2: dos(p); break;
      case 3: dos(p); uno(p + 2); break;
      case 4: dos(p + 2); dos(p); break;
      case 5: dos(p + 2); dos(p); uno(p + 4); break;
      case 6: dos(p + 2); dos(p); dos(p + 4); break;
      case 7: dos(p + 2); dos(p); dos(p + 4); uno(p + 6); break;
    }
    p += resto;
  }
  return ((s2 << 16) | (s1 & 0xffff)) >>> 0;
}

// ─── Reed-Solomon ───────────────────────────────────────────────────────────────────────────────

/** Un código de Reed-Solomon de 255 símbolos de 8 bits (`ReedSolomon.cs`): sólo la paridad, para comprobar. */
class ReedSolomon {
  readonly bloque: number;
  readonly paridad: number;
  private readonly alfa: Uint32Array;
  private readonly indice: Int32Array;
  private readonly generador: Int32Array;

  /** `polinomio`: los 8 coeficientes bajos del polinomio primitivo; `t`: los errores que corrige. */
  constructor(polinomio: readonly number[], t: number) {
    const N = 255;
    this.paridad = 2 * t;
    this.bloque = N - this.paridad;
    const alfa = new Uint32Array(N + 1);
    const indice = new Int32Array(N + 1);
    let mascara = 1;
    alfa[8] = 0;
    for (let i = 0; i < 8; i++) {
      alfa[i] = mascara;
      indice[mascara] = i;
      if (polinomio[i] !== 0) alfa[8]! ^= mascara;
      mascara <<= 1;
    }
    indice[alfa[8]!] = 8;
    mascara >>= 1;
    for (let i = 9; i < N; i++) {
      const previo = alfa[i - 1]!;
      const v = previo >= mascara ? alfa[8]! ^ ((previo ^ mascara) << 1) : previo << 1;
      alfa[i] = v;
      indice[v] = i;
    }
    indice[0] = -1;
    const gen = new Int32Array(this.paridad + 1);
    gen[0] = 2;
    gen[1] = 1;
    for (let i = 2; i <= this.paridad; i++) {
      gen[i] = 1;
      for (let j = i - 1; j !== 0; j--) gen[j] = gen[j] !== 0 ? gen[j - 1]! ^ alfa[(indice[gen[j]!]! + i) % N]! : gen[j - 1]!;
      gen[0] = alfa[(indice[gen[0]!]! + i) % N]!;
    }
    for (let i = 0; i <= this.paridad; i++) gen[i] = indice[gen[i]!]!;
    this.alfa = new Uint32Array(2 * N);
    for (let i = 0; i < 2 * N; i++) this.alfa[i] = alfa[i % N]!;
    this.indice = indice;
    this.generador = gen;
  }

  /** La paridad de los `bloque` bytes de datos desde `desde` (`Encode`). */
  calcular(datos: Uint8Array, desde: number): Uint8Array {
    const n = this.paridad;
    const p = new Uint8Array(n);
    const { alfa, indice, generador: g } = this;
    for (let i = desde + this.bloque - 1; i >= desde; i--) {
      const f = indice[datos[i]! ^ p[n - 1]!]!;
      if (f !== -1) {
        for (let j = n - 1; j > 0; j--) p[j] = g[j] !== -1 ? p[j - 1]! ^ alfa[g[j]! + f]! : p[j - 1]!;
        p[0] = alfa[g[0]! + f]!;
      } else {
        p.copyWithin(1, 0, n - 1);
        p[0] = 0;
      }
    }
    return p;
  }
}

let RS239: ReedSolomon | null = null;
let RS251: ReedSolomon | null = null;
const rs239 = () => (RS239 ??= new ReedSolomon([1, 0, 0, 1, 0, 1, 1, 0], 8));
const rs251 = () => (RS251 ??= new ReedSolomon([1, 0, 1, 1, 1, 0, 0, 0], 2));

/**
 * Desentrelaza `bloques` palabras de 255 bytes que empiezan en `src[desde]` (el byte j de la palabra
 * b está en desde + b + j·bloques) y da sus datos seguidos; comprueba la paridad de cada una.
 */
export function desentrelazar(src: Uint8Array, desde: number, bloques: number, rs: ReedSolomon, que: string): Uint8Array {
  if (!Number.isInteger(bloques) || bloques <= 0 || desde < 0 || desde + bloques * 255 > src.length) throw new ErrorDxf(DWG_CORTADO);
  const k = rs.bloque;
  const datos = new Uint8Array(bloques * k);
  for (let b = 0; b < bloques; b++) {
    for (let j = 0; j < k; j++) datos[b * k + j] = src[desde + b + j * bloques]!;
    const p = rs.calcular(datos, b * k);
    for (let j = 0; j < rs.paridad; j++) if (src[desde + b + (k + j) * bloques] !== p[j]) throw DANADO(`${que} no pasa su Reed-Solomon`);
  }
  return datos;
}

// ─── LZ77 de 2007 ───────────────────────────────────────────────────────────────────────────────

/**
 * El orden de los bytes al copiar n literales (n < 32) en `DwgLZ77AC21Decompressor`: el destino k
 * toma el byte `PERMUTACIONES[n][k]` del origen. Sacado de sus 31 funciones de copia con un script.
 */
const PERMUTACIONES: readonly (readonly number[])[] = [
  [],
  [0],
  [1, 0],
  [2, 1, 0],
  [0, 1, 2, 3],
  [4, 0, 1, 2, 3],
  [5, 1, 2, 3, 4, 0],
  [6, 5, 1, 2, 3, 4, 0],
  [0, 1, 2, 3, 4, 5, 6, 7],
  [8, 0, 1, 2, 3, 4, 5, 6, 7],
  [9, 1, 2, 3, 4, 5, 6, 7, 8, 0],
  [10, 9, 1, 2, 3, 4, 5, 6, 7, 8, 0],
  [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7],
  [12, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7],
  [13, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 0],
  [14, 13, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 0],
  [8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7],
  [9, 10, 11, 12, 13, 14, 15, 16, 8, 0, 1, 2, 3, 4, 5, 6, 7],
  [17, 9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8, 0],
  [18, 17, 16, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7],
  [16, 17, 18, 19, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7],
  [20, 16, 17, 18, 19, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7],
  [21, 20, 16, 17, 18, 19, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7],
  [22, 21, 20, 16, 17, 18, 19, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7],
  [16, 17, 18, 19, 20, 21, 22, 23, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7],
  [17, 18, 19, 20, 21, 22, 23, 24, 16, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7],
  [25, 17, 18, 19, 20, 21, 22, 23, 24, 16, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7],
  [26, 25, 17, 18, 19, 20, 21, 22, 23, 24, 16, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7],
  [24, 25, 26, 27, 16, 17, 18, 19, 20, 21, 22, 23, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7],
  [28, 24, 25, 26, 27, 16, 17, 18, 19, 20, 21, 22, 23, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7],
  [29, 28, 24, 25, 26, 27, 16, 17, 18, 19, 20, 21, 22, 23, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7],
  [30, 26, 27, 28, 29, 18, 19, 20, 21, 22, 23, 24, 25, 10, 11, 12, 13, 14, 15, 16, 17, 2, 3, 4, 5, 6, 7, 8, 9, 1, 0],
];

/** Los 32 bytes de un trozo entero: los grupos de 4 en el orden 24, 28, 16, 20, 8, 12, 0, 4. */
const TROZO32 = [24, 28, 16, 20, 8, 12, 0, 4];

/**
 * `DwgLZ77AC21Decompressor.Decompress`: lo comprimido de `src[desde, desde + n)` en `dst` (que tiene
 * el tamaño de lo descomprimido). Leer fuera de lo comprimido, escribir fuera de `dst` o copiar desde
 * antes de su principio es un `ErrorDxf`.
 */
export function lz77_2007(src: Uint8Array, desde: number, n: number, dst: Uint8Array): void {
  const roto = () => DANADO("una página comprimida no se puede descomprimir");
  const fin = desde + n;
  if (desde < 0 || fin > src.length) throw new ErrorDxf(DWG_CORTADO);
  let i = desde;
  const byte = () => {
    if (i >= fin) throw roto();
    return src[i++]!;
  };
  let longitud = 0;
  let distancia = 0;
  let op = byte();
  let o = 0;
  if (i >= fin) return;
  if ((op & 0xf0) === 0x20) {
    i += 3;
    if (i > fin) throw roto();
    longitud = src[i - 1]! & 7;
  }

  const literales = (k: number) => {
    if (i + k > fin || o + k > dst.length) throw roto();
    for (; k >= 32; k -= 32, i += 32, o += 32) for (let g = 0; g < 8; g++) for (let b = 0; b < 4; b++) dst[o + 4 * g + b] = src[i + TROZO32[g]! + b]!;
    const perm = PERMUTACIONES[k]!;
    for (let b = 0; b < k; b++) dst[o + b] = src[i + perm[b]!]!;
    i += k;
    o += k;
  };
  const instrucciones = () => {
    switch (op >> 4) {
      case 0:
        longitud = (op & 0xf) + 0x13;
        distancia = byte();
        op = byte();
        longitud += (op >> 3) & 0x10;
        distancia += ((op & 0x78) << 5) + 1;
        break;
      case 1:
        longitud = (op & 0xf) + 3;
        distancia = byte();
        op = byte();
        distancia += ((op & 0xf8) << 5) + 1;
        break;
      case 2:
        distancia = byte();
        distancia |= byte() << 8;
        longitud = op & 7;
        if ((op & 8) === 0) {
          op = byte();
          longitud += op & 0xf8;
        } else {
          distancia++;
          longitud += byte() << 3;
          op = byte();
          longitud += ((op & 0xf8) << 8) + 0x100;
        }
        break;
      default:
        longitud = op >> 4;
        distancia = op & 15;
        op = byte();
        distancia += ((op & 0xf8) << 1) + 1;
    }
  };

  while (i < fin) {
    // Los literales
    if (longitud === 0) {
      longitud = op + 8;
      if (longitud === 0x17) {
        let b = byte();
        longitud += b;
        if (b === 0xff)
          do {
            b = byte();
            b |= byte() << 8;
            longitud += b;
          } while (b === 0xffff);
      }
    }
    literales(longitud);
    if (i >= fin) break;
    // Las copias de lo ya descomprimido
    longitud = 0;
    op = byte();
    instrucciones();
    for (;;) {
      if (distancia > o || o + longitud > dst.length) throw roto();
      for (let k = 0; k < longitud; k++, o++) dst[o] = dst[o - distancia]!;
      longitud = op & 7;
      if (longitud !== 0 || i >= fin) break;
      op = byte();
      if (op >> 4 === 0) break;
      if (op >> 4 === 15) op &= 15;
      instrucciones();
    }
  }
}

// ─── La cabecera, los mapas y las secciones ─────────────────────────────────────────────────────

/** El origen de las posiciones de las páginas: tras las dos copias de la cabecera. */
const ORIGEN = 0x480;
/** Lo descomprimido de la cabecera del fichero. */
const TAM_METADATOS = 0x110;

/**
 * Una página del sistema (el mapa de páginas o el de secciones) en `ORIGEN + posicion`: sus datos van
 * repetidos `factor` veces y codificados con Reed-Solomon (255, 239) entrelazado (`getPageBuffer`).
 */
function paginaSistema(bytes: Uint8Array, posicion: number, comprimido: number, tam: number, factor: number, que: string): Uint8Array {
  if (comprimido <= 0 || tam <= 0 || factor <= 0 || tam > 0x10000000 || comprimido > 0x10000000 || factor > 0x10000) throw DANADO(`${que} dice que mide ${comprimido} bytes`);
  const bloques = Math.ceil((align8(comprimido) * factor) / 239);
  const datos = desentrelazar(bytes, ORIGEN + posicion, bloques, rs239(), que);
  if (comprimido > datos.length) throw DANADO(`${que} está cortado`);
  if (comprimido === tam) return datos.slice(0, tam);
  const d = new Uint8Array(tam);
  lz77_2007(datos, 0, comprimido, d);
  return d;
}

interface Pagina {
  /** Posición en la sección descomprimida. */
  posicion: number;
  numero: number;
  tam: number;
  comprimido: number;
  suma: number;
  crc: bigint;
}

interface Descriptor {
  nombre: string;
  cifrada: number;
  codificacion: number;
  paginas: Pagina[];
}

const u64 = (b: Uint8Array, p: number) => {
  if (p < 0 || p + 8 > b.length) throw new ErrorDxf(DWG_CORTADO);
  return vista(b).getBigUint64(p, true);
};

export function leerSecciones2007(bytes: Uint8Array): Secciones2004 {
  if (bytes.length < ORIGEN) throw new ErrorDxf(DWG_CORTADO);
  const mantenimiento = bytes[0x0b]!;
  const pagina = vista(bytes).getInt16(0x13, true);

  // 0x80: la cabecera del fichero, tres palabras de Reed-Solomon (255, 239) entrelazadas
  const cab = desentrelazar(bytes, 0x80, 3, rs239(), "la cabecera del fichero");
  const crc = u64(cab, 0);
  const clave = u64(cab, 8);
  const crcComprimido = u64(cab, 16);
  const comprimido = vista(cab).getInt32(24, true);
  // El CRC de la clave (con ella girada por sí misma detrás) y el de lo comprimido
  const k = new Uint8Array(16);
  vista(k).setBigUint64(0, clave, true);
  vista(k).setBigUint64(8, girar(clave, clave), true);
  if (crc64(k, 0, 16, semilla1(0n, 16), false) !== crc) throw DANADO("la cabecera del fichero no pasa su CRC");
  const n = comprimido < 0 ? -comprimido : comprimido;
  if (n === 0 || 32 + n > cab.length) throw DANADO("la cabecera del fichero dice que mide lo que no mide");
  if (crc64(cab, 32, n, semilla2(0n, n), false) !== crcComprimido) throw DANADO("la cabecera del fichero no pasa su CRC");
  let meta: Uint8Array;
  if (comprimido < 0) {
    if (n !== TAM_METADATOS) throw DANADO("la cabecera del fichero dice que mide lo que no mide");
    meta = cab.slice(32, 32 + n);
  } else {
    meta = new Uint8Array(TAM_METADATOS);
    lz77_2007(cab, 32, n, meta);
  }
  // 0x108: el CRC-64 de los metadatos, calculado con ese campo a 0
  const crcMeta = u64(meta, 0x108);
  const sinCrc = meta.slice();
  vista(sinCrc).setBigUint64(0x108, 0n, true);
  if (crc64(sinCrc, 0, TAM_METADATOS, semilla2(0n, TAM_METADATOS), false) !== crcMeta) throw DANADO("la cabecera del fichero no pasa su CRC");

  const m = (p: number) => rll(meta, p);
  // El mapa de páginas: tamaño y número de cada una, seguidas desde ORIGEN
  const mp = paginaSistema(bytes, m(0x38), m(0x50), m(0x58), m(0x18), "el mapa de páginas");
  const posiciones = new Map<number, { posicion: number; tam: number }>();
  for (let q = 0, total = 0; q + 16 <= mp.length; q += 16) {
    const tam = rll(mp, q);
    const numero = Math.abs(Number(vista(mp).getBigInt64(q + 8, true)));
    posiciones.set(numero, { posicion: total, tam });
    total += tam;
  }

  // El mapa de secciones
  const pms = posiciones.get(m(0xc0));
  if (!pms) throw DANADO("falta el mapa de secciones");
  const ms = paginaSistema(bytes, pms.posicion, m(0xb0), m(0xc8), m(0xd8), "el mapa de secciones");
  const descriptores = new Map<string, Descriptor>();
  for (let q = 0; q + 64 <= ms.length; ) {
    const cifrada = rll(ms, q + 0x10);
    const largoNombre = rll(ms, q + 0x20);
    const codificacion = rll(ms, q + 0x30);
    const np = rll(ms, q + 0x38);
    q += 64;
    if (largoNombre > 0x1000 || q + largoNombre > ms.length || np > 0x100000) throw DANADO("el mapa de secciones está cortado");
    const nombre = new TextDecoder("utf-16le").decode(ms.subarray(q, q + largoNombre)).replace(/\0/g, "");
    q += largoNombre;
    const paginas: Pagina[] = [];
    for (let j = 0; j < np; j++, q += 56) {
      if (q + 56 > ms.length) throw DANADO("el mapa de secciones está cortado");
      paginas.push({
        posicion: rll(ms, q),
        numero: rll(ms, q + 16),
        tam: rll(ms, q + 24),
        comprimido: rll(ms, q + 32),
        suma: rll(ms, q + 40),
        crc: u64(ms, q + 48),
      });
    }
    if (largoNombre > 0) descriptores.set(nombre, { nombre, cifrada, codificacion, paginas });
  }

  const hechas = new Map<string, Uint8Array>();
  return {
    mantenimiento,
    pagina,
    seccion(nombre: string): Uint8Array | null {
      const hecha = hechas.get(nombre);
      if (hecha) return hecha;
      const d = descriptores.get(nombre);
      if (!d) return null;
      if (d.cifrada === 1) throw new ErrorDxf("El DWG está protegido con contraseña: guárdalo sin ella.");
      // Las páginas, cada una en su posición; los huecos entre ellas (páginas de ceros), a 0
      let total = 0;
      for (const p of d.paginas) total = Math.max(total, p.posicion + p.tam);
      if (total > 0x40000000) throw DANADO(`la sección ${nombre} dice que mide ${total} bytes`);
      const s = new Uint8Array(total);
      const que = `una página de la sección ${nombre}`;
      for (const pl of d.paginas) {
        const r = posiciones.get(pl.numero);
        if (!r) throw DANADO(`falta ${que}`);
        if (pl.comprimido <= 0 || pl.comprimido > pl.tam && pl.comprimido > r.tam) throw DANADO(`${que} dice que mide lo que no mide`);
        const p = ORIGEN + r.posicion;
        if (p + r.tam > bytes.length) throw new ErrorDxf(DWG_CORTADO);
        // Con Reed-Solomon (255, 251), entrelazado (4) o con la paridad detrás (1)
        let datos: Uint8Array;
        const alineado = align8(pl.comprimido);
        const bloques = Math.ceil(alineado / 251);
        if (d.codificacion === 4) datos = desentrelazar(bytes, p, bloques, rs251(), que);
        else if (d.codificacion === 1) {
          if (alineado + bloques * 4 > r.tam) throw DANADO(`${que} está cortada`);
          datos = bytes.subarray(p, p + alineado);
          const rs = rs251();
          for (let b = 0; b < bloques; b++) {
            const bloque = new Uint8Array(251);
            bloque.set(datos.subarray(b * 251, Math.min((b + 1) * 251, alineado)));
            // El último bloque va relleno con lo que el fichero no guarda: sólo se comprueban los enteros
            if ((b + 1) * 251 > alineado) break;
            const par = rs.calcular(bloque, 0);
            for (let j = 0; j < 4; j++) if (bytes[p + alineado + 4 * b + j] !== par[j]) throw DANADO(`${que} no pasa su Reed-Solomon`);
          }
        } else throw DANADO(`${que} tiene una codificación que no se conoce (${d.codificacion})`);
        if (crc64(datos, 0, pl.comprimido, semilla1(0n, pl.comprimido), true) !== pl.crc) throw DANADO(`${que} no pasa su CRC`);
        let pag: Uint8Array;
        if (pl.comprimido === pl.tam) pag = datos.subarray(0, pl.tam);
        else {
          pag = new Uint8Array(pl.tam);
          lz77_2007(datos, 0, pl.comprimido, pag);
        }
        if (sumaPagina2007(0, pag, 0, pl.tam) !== pl.suma) throw DANADO(`${que} no pasa su suma de comprobación`);
        s.set(pag, pl.posicion);
      }
      hechas.set(nombre, s);
      return s;
    },
  };
}
