/**
 * Huella del modelo (H13, COM-12): SHA-256 de una serialización canónica, con las claves de los
 * objetos ordenadas. Los números se escriben con `Number.prototype.toString` (exacto por ECMA-262)
 * o, si se pide, redondeados a unas cifras significativas con `toPrecision` (también exacto), que
 * absorbe la diferencia de 1–2 ulp de `Math.cbrt`, `Math.hypot`… entre V8 y JavaScriptCore.
 *
 * El SHA-256 es una implementación propia de FIPS 180-4, síncrona y sin dependencias, para que la
 * compilación no tenga que ser asíncrona (`crypto.subtle` lo es).
 */

/** Serialización canónica: claves ordenadas; `undefined` se omite, como en JSON. */
export function canonico(valor: unknown, cifras?: number): string {
  const numero = (x: number): string => {
    if (!Number.isFinite(x)) return JSON.stringify(String(x));
    if (x === 0) return "0";
    return cifras === undefined ? String(x) : String(Number(x.toPrecision(cifras)));
  };
  const ir = (v: unknown): string => {
    if (v === null) return "null";
    if (typeof v === "number") return numero(v);
    if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
    if (ArrayBuffer.isView(v)) return ir(Array.from(v as unknown as ArrayLike<number>));
    if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : ir(x))).join(",")}]`;
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      const claves = Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort();
      return `{${claves.map((k) => `${JSON.stringify(k)}:${ir(o[k])}`).join(",")}}`;
    }
    return "null";
  };
  return ir(valor);
}

/** Huella SHA-256 (hex) de un valor, con su serialización canónica. */
export function huellaDe(valor: unknown, cifras?: number): string {
  return sha256(canonico(valor, cifras));
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74,
  0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d,
  0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e,
  0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 (FIPS 180-4) de un texto en UTF-8 o de unos bytes, en hexadecimal. */
export function sha256(entrada: string | Uint8Array): string {
  const datos = typeof entrada === "string" ? new TextEncoder().encode(entrada) : entrada;
  const n = datos.length;
  // Relleno: 0x80, ceros y la longitud en bits (64 bits, big-endian) hasta un múltiplo de 64 bytes
  const total = Math.ceil((n + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(datos);
  m[n] = 0x80;
  const bits = n * 8;
  const vista = new DataView(m.buffer);
  vista.setUint32(total - 8, Math.floor(bits / 2 ** 32));
  vista.setUint32(total - 4, bits >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x: number, r: number) => (x >>> r) | (x << (32 - r));
  for (let bloque = 0; bloque < total; bloque += 64) {
    for (let t = 0; t < 16; t++) W[t] = vista.getUint32(bloque + 4 * t);
    for (let t = 16; t < 64; t++) {
      const w15 = W[t - 15]!;
      const w2 = W[t - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      W[t] = (W[t - 16]! + s0 + W[t - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = [H[0]!, H[1]!, H[2]!, H[3]!, H[4]!, H[5]!, H[6]!, H[7]!];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t]! + W[t]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0]! + a) >>> 0;
    H[1] = (H[1]! + b) >>> 0;
    H[2] = (H[2]! + c) >>> 0;
    H[3] = (H[3]! + d) >>> 0;
    H[4] = (H[4]! + e) >>> 0;
    H[5] = (H[5]! + f) >>> 0;
    H[6] = (H[6]! + g) >>> 0;
    H[7] = (H[7]! + h) >>> 0;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, "0")).join("");
}
