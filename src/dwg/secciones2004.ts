/**
 * Las secciones de un DWG de 2004 en adelante (AC1018, AC1024, AC1027, AC1032; fase DW, tramo DW3).
 * Portado de ACadSharp (`IO/DwgReader.cs`: `readFileHeaderAC18`, `readFileMetaData`,
 * `getSectionBuffer18`, `decryptDataSection`; `IO/DWG/DwgStreamReaders/DwgLZ77AC18Decompressor.cs`;
 * `IO/DWG/CRC32StreamHandler.cs` y `DwgCheckSumCalculator.cs`; MIT, commit d9f3de8, citado en
 * `NOTICE`).
 *
 * El fichero es una lista de páginas. La cabecera (cifrada con una secuencia fija) dice dónde está el
 * mapa de páginas; éste, dónde empieza cada página; y el mapa de secciones, qué páginas forman cada
 * sección («AcDb:Header», «AcDb:Classes», «AcDb:Handles», «AcDb:AcDbObjects»…) y en qué posición.
 * Las páginas van comprimidas con una variante de LZ77.
 *
 * Todo lo que el fichero lleva para comprobarse se comprueba (ACadSharp no lo hace): el CRC32 de la
 * cabecera, la suma de cada página del sistema y las dos sumas de cada página de datos. Una que no
 * cuadra es un `ErrorDxf`: el fichero está dañado.
 *
 * Puro: sin IO, sin React ni DOM.
 */

import { ErrorDxf } from "../dxf/lector.ts";
import { DWG_CORTADO } from "./bits.ts";

const TABLA_CRC32 = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/** El CRC32 (el de ZIP: polinomio reflejado 0xEDB88320) de buf, con semilla 0. */
export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ TABLA_CRC32[(c ^ buf[i]!) & 0xff]!;
  return (c ^ 0xffffffff) >>> 0;
}

/** La suma de una página (una variante de Adler-32 en trozos de 0x15B0, `DwgCheckSumCalculator`). */
export function sumaPagina(semilla: number, buf: Uint8Array, desde: number, n: number): number {
  let s1 = semilla & 0xffff;
  let s2 = (semilla >>> 16) & 0xffff;
  let i = desde;
  let queda = n;
  while (queda > 0) {
    const trozo = Math.min(0x15b0, queda);
    queda -= trozo;
    for (let k = 0; k < trozo; k++) {
      s1 += buf[i++]!;
      s2 += s1;
    }
    s1 %= 0xfff1;
    s2 %= 0xfff1;
  }
  return ((s2 << 16) | (s1 & 0xffff)) >>> 0;
}

/** La secuencia que cifra la cabecera de 0x80 (la de `rand()` de C con semilla 1). */
function secuencia(n: number): Uint8Array {
  const r = new Uint8Array(n);
  let s = 1;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 0x343fd) + 0x269ec3) | 0;
    r[i] = (s >> 16) & 0xff;
  }
  return r;
}

// ─── LZ77 ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Descomprime lo que empieza en `src[desde]` hasta el código de fin (0x11), en un buffer de `n`
 * bytes como mucho. Da lo descomprimido. Leer fuera de `src`, escribir más de `n` o copiar desde
 * antes del principio es un `ErrorDxf`.
 */
export function lz77(src: Uint8Array, desde: number, hasta: number, n: number): Uint8Array {
  const dst = new Uint8Array(n);
  let o = 0;
  let i = desde;
  const roto = () => new ErrorDxf("El DWG está dañado: una página comprimida no se puede descomprimir.");
  const byte = () => {
    if (i >= hasta) throw roto();
    return src[i++]!;
  };
  const literales = (k: number) => {
    if (k < 0 || i + k > hasta || o + k > n) throw roto();
    dst.set(src.subarray(i, i + k), o);
    i += k;
    o += k;
    return byte();
  };
  const cuentaLiteral = (c: number) => {
    let v = c & 0x0f;
    if (v === 0) {
      let b = byte();
      for (; b === 0; b = byte()) v += 0xff;
      v += 0x0f + b;
    }
    return v;
  };
  const cuentaComprimida = (c: number, bits: number) => {
    let v = c & bits;
    if (v === 0) {
      let b = byte();
      for (; b === 0; b = byte()) v += 0xff;
      v += b + bits;
    }
    return v + 2;
  };

  let op = byte();
  if (op > 0x11) op = literales(op - 17);
  if ((op & 0xf0) === 0) op = literales(cuentaLiteral(op) + 3);
  for (let vueltas = 0; op !== 0x11; vueltas++) {
    if (vueltas > n + hasta) throw roto();
    let desplazamiento: number;
    let k: number;
    if (op < 0x10 || op >= 0x40) {
      k = (op >> 4) - 1;
      const op2 = byte();
      desplazamiento = (((op >> 2) & 3) | (op2 << 2)) + 1;
    } else if (op < 0x20) {
      k = cuentaComprimida(op, 0x07);
      desplazamiento = (op & 8) << 11;
      const b1 = byte();
      desplazamiento |= b1 >> 2;
      desplazamiento |= byte() << 6;
      desplazamiento += 0x4000;
      op = b1;
    } else {
      k = cuentaComprimida(op, 0x1f);
      const b1 = byte();
      desplazamiento = (b1 >> 2) | (byte() << 6);
      desplazamiento += 1;
      op = b1;
    }
    if (desplazamiento > o || o + k > n || k < 0) throw roto();
    // La copia puede solaparse consigo misma (repite los últimos `desplazamiento` bytes)
    for (let j = 0; j < k; j++, o++) dst[o] = dst[o - desplazamiento]!;
    let lit = op & 3;
    if (lit === 0) {
      op = byte();
      if ((op & 0xf0) === 0) lit = cuentaLiteral(op) + 3;
    }
    if (lit > 0) op = literales(lit);
  }
  return o === n ? dst : dst.subarray(0, o);
}

// ─── La cabecera, los mapas y las secciones ─────────────────────────────────────────────────────

export interface Secciones2004 {
  /** El de mantenimiento (0x0B): en 2010 y 2013, con > 3 la cabecera y las clases llevan un RL más. */
  mantenimiento: number;
  /** El índice de la página de códigos (0x13). */
  pagina: number;
  /** Los bytes descomprimidos de una sección por su nombre, o null si no está. */
  seccion(nombre: string): Uint8Array | null;
}

const vista = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Un RL sin signo de bytes en p, comprobando que esté. */
function rl(b: Uint8Array, p: number): number {
  if (p < 0 || p + 4 > b.length) throw new ErrorDxf(DWG_CORTADO);
  return vista(b).getUint32(p, true);
}

/** Un entero de 8 bytes (que quepa en un double). */
function rll(b: Uint8Array, p: number): number {
  return rl(b, p) + rl(b, p + 4) * 2 ** 32;
}

const ID_CABECERA = "AcFssFcAJMB\0";
const TIPO_MAPA_PAGINAS = 0x41630e3b;
const TIPO_MAPA_SECCIONES = 0x4163003b;
const TIPO_DATOS = 0x4163043b;

/**
 * Una página del sistema (el mapa de páginas o el de secciones): 20 bytes de cabecera (tipo, tamaño
 * descomprimido, comprimido, tipo de compresión y suma) y los datos comprimidos.
 */
function paginaSistema(bytes: Uint8Array, p: number, tipo: number): Uint8Array {
  if (rl(bytes, p) !== tipo) throw new ErrorDxf("El DWG está dañado: una página del sistema no es del tipo que se espera.");
  const n = rl(bytes, p + 4);
  const comprimido = rl(bytes, p + 8);
  const compresion = rl(bytes, p + 12);
  const suma = rl(bytes, p + 16);
  if (p + 20 + comprimido > bytes.length || n > 0x10000000) throw new ErrorDxf(DWG_CORTADO);
  // La suma: la de los datos comprimidos, con la de la cabecera (con su suma a 0) como semilla
  const cab = bytes.slice(p, p + 20);
  vista(cab).setUint32(16, 0, true);
  const calculada = sumaPagina(sumaPagina(0, cab, 0, 20), bytes, p + 20, comprimido);
  if (calculada !== suma) throw new ErrorDxf("El DWG está dañado: una página del sistema no pasa su suma de comprobación.");
  if (compresion !== 2) return bytes.slice(p + 20, p + 20 + comprimido);
  const d = lz77(bytes, p + 20, p + 20 + comprimido, n);
  if (d.length !== n) throw new ErrorDxf("El DWG está dañado: una página del sistema no tiene el tamaño que dice.");
  return d;
}

interface PaginaLocal {
  numero: number;
  comprimido: number;
  /** Posición en la sección descomprimida. */
  posicion: number;
}

interface Descriptor {
  nombre: string;
  tamano: number;
  maximo: number;
  comprimida: boolean;
  cifrada: number;
  paginas: PaginaLocal[];
}

export function leerSecciones2004(bytes: Uint8Array): Secciones2004 {
  if (bytes.length < 0x100) throw new ErrorDxf(DWG_CORTADO);
  const mantenimiento = bytes[0x0b]!;
  const pagina = vista(bytes).getInt16(0x13, true);

  // 0x80: la cabecera cifrada, con su CRC32 (calculado con el campo del CRC a 0)
  const cab = bytes.slice(0x80, 0x80 + 0x6c);
  const xor = secuencia(0x6c);
  for (let i = 0; i < cab.length; i++) cab[i]! ^= xor[i]!;
  if (String.fromCharCode(...cab.subarray(0, 12)) !== ID_CABECERA) throw new ErrorDxf("El DWG está dañado: la cabecera del fichero no se descifra.");
  const crc = rl(cab, 0x68);
  const sinCrc = cab.slice();
  vista(sinCrc).setUint32(0x68, 0, true);
  if (crc32(sinCrc) !== crc) throw new ErrorDxf("El DWG está dañado: la cabecera del fichero no pasa su CRC.");
  const idMapaSecciones = rl(cab, 0x5c);
  const direccionMapaPaginas = rll(cab, 0x54) + 0x100;

  // El mapa de páginas: número y tamaño de cada una, seguidas desde 0x100 (las negativas son huecos)
  const mp = paginaSistema(bytes, direccionMapaPaginas, TIPO_MAPA_PAGINAS);
  const posiciones = new Map<number, number>();
  for (let q = 0, total = 0x100; q + 8 <= mp.length; ) {
    const numero = vista(mp).getInt32(q, true);
    const tam = rl(mp, q + 4);
    q += 8;
    if (numero >= 0) posiciones.set(numero, total);
    else q += 16;
    total += tam;
  }

  // El mapa de secciones
  const pms = posiciones.get(idMapaSecciones);
  if (pms === undefined) throw new ErrorDxf("El DWG está dañado: falta el mapa de secciones.");
  const ms = paginaSistema(bytes, pms, TIPO_MAPA_SECCIONES);
  const nd = rl(ms, 0);
  const descriptores = new Map<string, Descriptor>();
  let q = 20;
  for (let i = 0; i < nd; i++) {
    if (q + 0x60 > ms.length) throw new ErrorDxf("El DWG está dañado: el mapa de secciones está cortado.");
    const tamano = rll(ms, q);
    const np = rl(ms, q + 8);
    const maximo = rl(ms, q + 12);
    const comprimida = rl(ms, q + 20) === 2;
    const cifrada = rl(ms, q + 28);
    const nombre = String.fromCharCode(...ms.subarray(q + 32, q + 96)).split("\0")[0]!;
    q += 96;
    const paginas: PaginaLocal[] = [];
    for (let j = 0; j < np; j++) {
      if (q + 16 > ms.length) throw new ErrorDxf("El DWG está dañado: el mapa de secciones está cortado.");
      paginas.push({ numero: rl(ms, q), comprimido: rl(ms, q + 4), posicion: rll(ms, q + 8) });
      q += 16;
    }
    descriptores.set(nombre, { nombre, tamano, maximo, comprimida, cifrada, paginas });
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
      if (d.tamano > 0x40000000 || d.maximo <= 0) throw new ErrorDxf(`El DWG está dañado: la sección ${nombre} dice que mide ${d.tamano} bytes.`);
      // Las páginas que faltan (sólo ceros) quedan a 0
      const s = new Uint8Array(d.tamano);
      for (const pl of d.paginas) {
        const p = posiciones.get(pl.numero);
        if (p === undefined) throw new ErrorDxf(`El DWG está dañado: falta una página de la sección ${nombre}.`);
        // La cabecera de la página de datos: 8 RL cifrados con 0x4164536B ^ su posición
        const mascara = (0x4164536b ^ p) >>> 0;
        const c = new Uint8Array(32);
        for (let k = 0; k < 8; k++) vista(c).setUint32(4 * k, (rl(bytes, p + 4 * k) ^ mascara) >>> 0, true);
        const v = vista(c);
        if (v.getUint32(0, true) !== TIPO_DATOS) throw new ErrorDxf(`El DWG está dañado: una página de la sección ${nombre} no es de datos.`);
        const comprimido = v.getUint32(8, true);
        const tamPagina = v.getUint32(12, true);
        // 0x10: la posición en la sección (8 bytes); 0x18: la suma de la cabecera; 0x1C: la de los datos
        // (DW3-1: ACadSharp lee estos campos un RL antes, pero no los usa)
        const posicion = v.getUint32(16, true) + v.getUint32(20, true) * 2 ** 32;
        const sumaCab = v.getUint32(24, true);
        const sumaDatos = v.getUint32(28, true);
        if (p + 32 + comprimido > bytes.length) throw new ErrorDxf(DWG_CORTADO);
        // La de los datos, de los comprimidos con semilla 0; la de la cabecera, de sus 32 bytes con su campo a 0 y la de los datos como semilla
        if (sumaPagina(0, bytes, p + 32, comprimido) !== sumaDatos) throw new ErrorDxf(`El DWG está dañado: una página de la sección ${nombre} no pasa su suma de comprobación.`);
        const cs = c.slice();
        vista(cs).setUint32(24, 0, true);
        if (sumaPagina(sumaDatos, cs, 0, 32) !== sumaCab) throw new ErrorDxf(`El DWG está dañado: la cabecera de una página de la sección ${nombre} no pasa su suma de comprobación.`);
        if (posicion !== pl.posicion || posicion >= s.length) throw new ErrorDxf(`El DWG está dañado: una página de la sección ${nombre} está fuera de su sitio.`);
        const cabe = Math.min(d.maximo, s.length - posicion);
        // Cada página se descomprime a su tamaño máximo (0x7400), con relleno detrás de lo de la sección (DW3-2)
        const datos = d.comprimida ? lz77(bytes, p + 32, p + 32 + comprimido, Math.max(d.maximo, tamPagina)) : bytes.subarray(p + 32, p + 32 + comprimido);
        if (datos.length < cabe) throw new ErrorDxf(`El DWG está dañado: una página de la sección ${nombre} no tiene el tamaño que dice.`);
        s.set(datos.subarray(0, cabe), posicion);
      }
      hechas.set(nombre, s);
      return s;
    },
  };
}
