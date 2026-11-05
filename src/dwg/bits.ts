/**
 * El flujo de bits de un DWG (fase DW, `docs/fem3d/dwg.md` §3). Portado de ACadSharp
 * (`IO/DWG/DwgStreamReaders/DwgStreamReaderBase.cs`, `DwgStreamReaderAC15.cs`; MIT, commit
 * d9f3de8, citado en `NOTICE`) y contrastado con la Open Design Specification for .dwg files 5.4.1
 * (§2, «Bit codes and data definitions»).
 *
 * Un `Bits` es una posición en bits sobre un buffer, con un tope: leer más allá del tope es un
 * fichero cortado o dañado (`ErrorDxf`), nunca un valor inventado. Los bits van del más
 * significativo al menos significativo de cada byte; los números de varios bytes, en little-endian
 * (salvo los handles, que van en big-endian).
 *
 * Tipos (los nombres de la especificación):
 * - B: 1 bit; BB: 2 bits;
 * - RC, RS, RL, RD: char, short, long (32 bits) y double sin comprimir;
 * - BS, BL, BLL, BD: short, long, long long y double comprimidos con un prefijo de 2 o 3 bits;
 * - DD: double con un valor por defecto, del que se parchean 0, 4, 6 u 8 bytes;
 * - BT, BE: espesor y extrusión (desde R2000, un bit dice si son los de por defecto);
 * - MC, MS: char y short modulares (continuación en el bit alto);
 * - H: referencia a un handle (código, número de bytes y bytes en big-endian);
 * - TV: texto de longitud BS en la página de códigos del dibujo.
 *
 * Puro: sin IO, sin React ni DOM.
 */

import { ErrorDxf } from "../dxf/lector.ts";

/** El mensaje común de un fichero que se acaba antes de lo que dicen sus tamaños. */
export const DWG_CORTADO = "El DWG está cortado o dañado: se lee más allá del final de una sección.";

const vista = new DataView(new ArrayBuffer(8));

/** La tabla del CRC-16 del DWG (el de polinomio reflejado 0xA001: la de `CRC.CrcTable` de ACadSharp). */
const TABLA_CRC = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
    t[i] = c;
  }
  return t;
})();

/** El CRC-16 de los bytes [desde, hasta) de buf, con la semilla del DWG (0xC0C1). */
export function crc16(buf: Uint8Array, desde: number, hasta: number, semilla = 0xc0c1): number {
  if (desde < 0 || hasta > buf.length || desde > hasta) throw new ErrorDxf(DWG_CORTADO);
  let c = semilla;
  for (let i = desde; i < hasta; i++) c = (c >>> 8) ^ TABLA_CRC[(buf[i]! ^ c) & 0xff]!;
  return c;
}

export class Bits {
  readonly buf: Uint8Array;
  /** Posición en bits. */
  pos: number;
  /** Tope en bits (excluido). */
  fin: number;

  constructor(buf: Uint8Array, pos = 0, fin = buf.length * 8) {
    this.buf = buf;
    this.pos = pos;
    this.fin = Math.min(fin, buf.length * 8);
  }

  /** Otro lector sobre el mismo buffer, en la posición p y con el mismo tope (o el dado). */
  en(p: number, fin = this.fin): Bits {
    return new Bits(this.buf, p, fin);
  }

  private falta(n: number): void {
    if (this.pos < 0 || this.pos + n > this.fin) throw new ErrorDxf(DWG_CORTADO);
  }

  // ─── Bits y bytes ────────────────────────────────────────────────────────────────────────────

  B(): number {
    this.falta(1);
    const p = this.pos++;
    return (this.buf[p >> 3]! >> (7 - (p & 7))) & 1;
  }

  BB(): number {
    return (this.B() << 1) | this.B();
  }

  RC(): number {
    this.falta(8);
    const i = this.pos >> 3;
    const s = this.pos & 7;
    this.pos += 8;
    return s === 0 ? this.buf[i]! : ((this.buf[i]! << s) | (this.buf[i + 1]! >> (8 - s))) & 0xff;
  }

  bytes(n: number): Uint8Array {
    if (!Number.isInteger(n) || n < 0) throw new ErrorDxf(DWG_CORTADO);
    this.falta(8 * n);
    const r = new Uint8Array(n);
    if ((this.pos & 7) === 0) {
      const i = this.pos >> 3;
      r.set(this.buf.subarray(i, i + n));
      this.pos += 8 * n;
    } else for (let k = 0; k < n; k++) r[k] = this.RC();
    return r;
  }

  /** Salta n bytes (n·8 bits). */
  saltar(n: number): void {
    if (!Number.isInteger(n) || n < 0) throw new ErrorDxf(DWG_CORTADO);
    this.falta(8 * n);
    this.pos += 8 * n;
  }

  /** Lleva la posición al siguiente byte entero. */
  alinear(): void {
    this.pos = (this.pos + 7) & ~7;
  }

  // ─── Sin comprimir ─────────────────────────────────────────────────────────────────────────

  /** RS con signo. */
  RS(): number {
    const v = this.RC() | (this.RC() << 8);
    return v >= 0x8000 ? v - 0x10000 : v;
  }

  /** RS sin signo. */
  RSu(): number {
    return this.RC() | (this.RC() << 8);
  }

  /** RS sin signo en big-endian (el tamaño de cada trozo del mapa de objetos). */
  RSbe(): number {
    return (this.RC() << 8) | this.RC();
  }

  /** RL con signo (32 bits). */
  RL(): number {
    return this.RC() | (this.RC() << 8) | (this.RC() << 16) | (this.RC() << 24);
  }

  /** RL sin signo. */
  RLu(): number {
    return this.RL() >>> 0;
  }

  RD(): number {
    for (let k = 0; k < 8; k++) vista.setUint8(k, this.RC());
    return vista.getFloat64(0, true);
  }

  RD2(): [number, number] {
    return [this.RD(), this.RD()];
  }

  RD3(): [number, number, number] {
    return [this.RD(), this.RD(), this.RD()];
  }

  // ─── Comprimidos ───────────────────────────────────────────────────────────────────────────

  BS(): number {
    switch (this.BB()) {
      case 0:
        return this.RS();
      case 1:
        return this.RC();
      case 2:
        return 0;
      default:
        return 256;
    }
  }

  BL(): number {
    switch (this.BB()) {
      case 0:
        return this.RL();
      case 1:
        return this.RC();
      case 2:
        return 0;
      default:
        throw new ErrorDxf("El DWG está dañado: un entero BL con el prefijo 11.");
    }
  }

  /** BLL: 3 bits con el número de bytes y esos bytes en little-endian. */
  BLL(): number {
    const n = (this.B() << 2) | (this.B() << 1) | this.B();
    let v = 0;
    for (let i = 0; i < n; i++) v += this.RC() * 2 ** (8 * i);
    return v;
  }

  BD(): number {
    switch (this.BB()) {
      case 0:
        return this.RD();
      case 1:
        return 1;
      case 2:
        return 0;
      default:
        throw new ErrorDxf("El DWG está dañado: un double BD con el prefijo 11.");
    }
  }

  BD2(): [number, number] {
    return [this.BD(), this.BD()];
  }

  BD3(): [number, number, number] {
    return [this.BD(), this.BD(), this.BD()];
  }

  /** DD: el double por defecto con 0, 4, 6 u 8 bytes parcheados (little-endian). */
  DD(def: number): number {
    const c = this.BB();
    if (c === 0) return def;
    if (c === 3) return this.RD();
    vista.setFloat64(0, def, true);
    if (c === 2) {
      vista.setUint8(4, this.RC());
      vista.setUint8(5, this.RC());
    }
    for (let k = 0; k < 4; k++) vista.setUint8(k, this.RC());
    return vista.getFloat64(0, true);
  }

  /** BT: el espesor. Desde R2000, un bit a 1 dice que es 0. */
  BT(r2000: boolean): number {
    return r2000 && this.B() === 1 ? 0 : this.BD();
  }

  /** BE: la extrusión. Desde R2000, un bit a 1 dice que es (0, 0, 1). */
  BE(r2000: boolean): [number, number, number] {
    return r2000 && this.B() === 1 ? [0, 0, 1] : this.BD3();
  }

  // ─── Modulares ─────────────────────────────────────────────────────────────────────────────

  /** MC sin signo. */
  MC(): number {
    let v = 0;
    for (let k = 0; k < 10; k++) {
      const b = this.RC();
      v += (b & 0x7f) * 2 ** (7 * k);
      if ((b & 0x80) === 0) return v;
    }
    throw new ErrorDxf("El DWG está dañado: un entero modular demasiado largo.");
  }

  /** MC con signo: el último byte lleva el signo en 0x40 y seis bits de valor. */
  MCs(): number {
    let v = 0;
    for (let k = 0; k < 10; k++) {
      const b = this.RC();
      if ((b & 0x80) !== 0) {
        v += (b & 0x7f) * 2 ** (7 * k);
        continue;
      }
      v += (b & 0x3f) * 2 ** (7 * k);
      return (b & 0x40) !== 0 ? -v : v;
    }
    throw new ErrorDxf("El DWG está dañado: un entero modular demasiado largo.");
  }

  /** MS: pares de bytes en little-endian con la continuación en el bit alto del segundo. */
  MS(): number {
    let v = 0;
    for (let k = 0; k < 5; k++) {
      const b1 = this.RC();
      const b2 = this.RC();
      v += (b1 | ((b2 & 0x7f) << 8)) * 2 ** (15 * k);
      if ((b2 & 0x80) === 0) return v;
    }
    throw new ErrorDxf("El DWG está dañado: un entero modular demasiado largo.");
  }

  // ─── Handles y textos ──────────────────────────────────────────────────────────────────────

  /**
   * H: una referencia a un handle. Los códigos 2 a 5 dan el handle tal cual; 6 y 8, el de
   * referencia más o menos 1; 0xA y 0xC, el de referencia más o menos lo leído.
   */
  H(ref = 0): number {
    const forma = this.RC();
    const codigo = forma >> 4;
    const n = forma & 0x0f;
    if (n > 7) throw new ErrorDxf("El DWG está dañado: un handle de más de 7 bytes.");
    let v = 0;
    for (let k = 0; k < n; k++) v = v * 256 + this.RC();
    if (codigo <= 5) return v;
    if (codigo === 6) return ref + 1;
    if (codigo === 8) return ref - 1;
    if (codigo === 0xa) return ref + v;
    if (codigo === 0xc) return ref - v;
    throw new ErrorDxf(`El DWG está dañado: una referencia a un handle con el código ${codigo}.`);
  }

  /** TV: BS con el número de bytes y el texto en la página de códigos (sin los \0). */
  TV(decodificador: TextDecoder): string {
    const n = this.BS();
    if (n <= 0) return "";
    return decodificador.decode(this.bytes(n)).replaceAll("\0", "");
  }
}
