/**
 * Lector de DXF (V2c-4, `docs/fem3d/dibujo.md` §10; V2c4-a: propio, sin dependencias). Convierte
 * los bytes de un DXF ASCII en su cabecera, sus capas, sus bloques y sus entidades, sin
 * interpretarlas: la geometría la saca `aplanar.ts`.
 *
 * - Codificación: UTF-8 desde AutoCAD 2007 (AC1021); antes, la página de `$DWGCODEPAGE`
 *   (ANSI_1252 → windows-1252). Los `\U+XXXX` de los textos los resuelve quien los lee.
 * - El DXF binario y el DWG se rechazan con un mensaje (`ErrorDxf`).
 * - Una entidad es su tipo, su capa y sus pares (código, valor) en el orden del fichero: los
 *   vértices de una `LWPOLYLINE` o los nudos de un `SPLINE` son códigos repetidos. Los `VERTEX` de
 *   una `POLYLINE` y los `ATTRIB` de un `INSERT` van en `hijos`.
 * - Lo del espacio papel (código 67 = 1) no se lee.
 *
 * Puro: sin IO, sin React ni DOM.
 */

export class ErrorDxf extends Error {}

export interface Entidad {
  tipo: string;
  /** Capa (código 8; "0" si no la dice). */
  capa: string;
  /** Los pares de la entidad, sin el 0 de su tipo. */
  codigos: number[];
  valores: string[];
  /** Los `VERTEX` de una `POLYLINE` o los `ATTRIB` de un `INSERT`. */
  hijos?: Entidad[];
}

export interface Bloque {
  nombre: string;
  base: [number, number, number];
  entidades: Entidad[];
}

export interface CapaLeida {
  nombre: string;
  /** Color negativo en la tabla. */
  apagada: boolean;
  /** Bit 1 de las banderas. */
  congelada: boolean;
}

export interface Dxf {
  /** `$ACADVER` (AC1009 = R12, AC1015 = 2000, AC1032 = 2018…), o null si no hay cabecera. */
  version: string | null;
  /** La codificación con la que se leyó el texto. */
  codificacion: string;
  /** `$INSUNITS`, o null si no lo dice. */
  insunits: number | null;
  capas: CapaLeida[];
  bloques: Map<string, Bloque>;
  /** Las entidades del espacio modelo. */
  entidades: Entidad[];
}

// ─── Acceso a los pares de una entidad ──────────────────────────────────────────────────────────

/** El primer valor numérico del código c, o `def`. */
export function num(e: Entidad, c: number, def = 0): number {
  const i = e.codigos.indexOf(c);
  if (i < 0) return def;
  const v = Number.parseFloat(e.valores[i]!);
  return Number.isFinite(v) ? v : def;
}

/** El primer valor del código c, o `def`. */
export function texto(e: Entidad, c: number, def = ""): string {
  const i = e.codigos.indexOf(c);
  return i < 0 ? def : e.valores[i]!;
}

/** Todos los valores numéricos del código c, en orden. */
export function nums(e: Entidad, c: number): number[] {
  const r: number[] = [];
  for (let i = 0; i < e.codigos.length; i++) if (e.codigos[i] === c) r.push(Number.parseFloat(e.valores[i]!));
  return r;
}

export const tiene = (e: Entidad, c: number): boolean => e.codigos.includes(c);

// ─── Codificación ───────────────────────────────────────────────────────────────────────────────

const decodificador = (etiqueta: string): TextDecoder => {
  try {
    return new TextDecoder(etiqueta);
  } catch {
    return new TextDecoder("windows-1252");
  }
};

/** La variable de cabecera `nombre` con su código, leída como latin1 del principio del fichero. */
function variable(cabeza: string, nombre: string, codigo: number): string | null {
  const re = new RegExp(`\\${nombre}\\s*\\r?\\n\\s*${codigo}\\s*\\r?\\n([^\\r\\n]*)`);
  const m = re.exec(cabeza);
  return m ? m[1]!.trim() : null;
}

/** La etiqueta de `TextDecoder` de un `$DWGCODEPAGE` (ANSI_1252 → windows-1252). */
function paginaDeCodigos(pagina: string | null): string {
  const m = pagina ? /^ANSI_(\d+)$/i.exec(pagina) : null;
  if (!m) return "windows-1252";
  const n = Number(m[1]);
  const asiaticas: Record<number, string> = { 874: "windows-874", 932: "shift_jis", 936: "gbk", 949: "euc-kr", 950: "big5" };
  return asiaticas[n] ?? (n >= 1250 && n <= 1258 ? `windows-${n}` : "windows-1252");
}

const empieza = (b: Uint8Array, s: string) => b.length >= s.length && [...s].every((ch, i) => b[i] === ch.charCodeAt(0));

/** El texto del fichero con su codificación. */
export function decodificar(bytes: Uint8Array): { texto: string; codificacion: string; version: string | null } {
  if (empieza(bytes, "AutoCAD Binary DXF")) throw new ErrorDxf("Es un DXF binario: guárdalo como DXF ASCII.");
  if (empieza(bytes, "AC10") || empieza(bytes, "AC1.")) throw new ErrorDxf("Es un DWG: expórtalo a DXF (ASCII) desde el programa de CAD.");
  const cabeza = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 1 << 16)));
  const version = variable(cabeza, "$ACADVER", 1);
  const n = version ? Number.parseInt(version.replace(/^AC/i, ""), 10) : Number.NaN;
  const codificacion = Number.isFinite(n) && n >= 1021 ? "utf-8" : paginaDeCodigos(variable(cabeza, "$DWGCODEPAGE", 3));
  return { texto: decodificador(codificacion).decode(bytes), codificacion, version };
}

// ─── Lectura ────────────────────────────────────────────────────────────────────────────────────

/** Los pares del fichero: códigos y valores en dos listas. */
function pares(txt: string): { codigos: Int32Array; valores: string[] } {
  const lineas = txt.split(/\r\n|\n|\r/);
  // Un salto al final deja una línea vacía de sobra
  while (lineas.length > 0 && lineas[lineas.length - 1]!.trim() === "") lineas.pop();
  const n = lineas.length >> 1;
  const codigos = new Int32Array(n);
  const valores = new Array<string>(n);
  for (let k = 0; k < n; k++) {
    const c = lineas[2 * k]!.trim();
    if (!/^-?\d+$/.test(c)) throw new ErrorDxf(`Línea ${2 * k + 1}: se esperaba un código de grupo y hay «${c.slice(0, 40)}». ¿Es un DXF?`);
    codigos[k] = Number.parseInt(c, 10);
    valores[k] = lineas[2 * k + 1]!;
  }
  return { codigos, valores };
}

/** Códigos cuyo valor es un nombre (se quitan los espacios de los lados). */
const NOMBRES = new Set([2, 3, 6, 7, 8]);

/** Lee el DXF. Lanza `ErrorDxf` si no lo es o no se puede leer. */
export function leerDxf(bytes: Uint8Array): Dxf {
  const { texto: txt, codificacion, version } = decodificar(bytes);
  const { codigos, valores } = pares(txt);
  const n = codigos.length;
  const es = (k: number, v: string) => codigos[k] === 0 && valores[k]!.trim() === v;
  if (n === 0 || !Array.from({ length: Math.min(n, 64) }, (_, k) => es(k, "SECTION")).some(Boolean)) throw new ErrorDxf("No tiene ninguna sección: no es un DXF.");

  let insunits: number | null = null;
  const capas: CapaLeida[] = [];
  const bloques = new Map<string, Bloque>();
  const entidades: Entidad[] = [];

  /** La entidad que empieza en k (un 0 con su tipo) y el índice del siguiente 0. */
  const entidad = (k: number): { e: Entidad; sig: number } => {
    const e: Entidad = { tipo: valores[k]!.trim(), capa: "0", codigos: [], valores: [] };
    let j = k + 1;
    for (; j < n && codigos[j] !== 0; j++) {
      const c = codigos[j]!;
      const v = NOMBRES.has(c) ? valores[j]!.trim() : valores[j]!;
      e.codigos.push(c);
      e.valores.push(v);
      if (c === 8) e.capa = v;
    }
    return { e, sig: j };
  };

  /** Las entidades desde k hasta un 0 con uno de los `fin` (ENDSEC, ENDBLK); el índice de ese 0. */
  const listaEntidades = (k: number, fin: readonly string[], destino: Entidad[]): number => {
    while (k < n && !fin.some((f) => es(k, f))) {
      if (codigos[k] !== 0) {
        k++;
        continue;
      }
      const { e, sig } = entidad(k);
      k = sig;
      // Los VERTEX de una POLYLINE y los ATTRIB de un INSERT con atributos, hasta su SEQEND
      if (e.tipo === "POLYLINE" || (e.tipo === "INSERT" && num(e, 66) === 1)) {
        const hijo = e.tipo === "POLYLINE" ? "VERTEX" : "ATTRIB";
        e.hijos = [];
        while (k < n && codigos[k] === 0 && valores[k]!.trim() === hijo) {
          const h = entidad(k);
          e.hijos.push(h.e);
          k = h.sig;
        }
        if (k < n && es(k, "SEQEND")) k = entidad(k).sig;
      }
      if (num(e, 67) === 1) continue;
      destino.push(e);
    }
    return k;
  };

  let k = 0;
  while (k < n) {
    if (!es(k, "SECTION")) {
      k++;
      continue;
    }
    const seccion = codigos[k + 1] === 2 ? valores[k + 1]!.trim() : "";
    k += 2;
    if (seccion === "HEADER") {
      for (; k < n && !es(k, "ENDSEC"); k++)
        if (codigos[k] === 9 && valores[k]!.trim() === "$INSUNITS" && codigos[k + 1] === 70) insunits = Number.parseInt(valores[k + 1]!, 10);
    } else if (seccion === "TABLES") {
      for (; k < n && !es(k, "ENDSEC"); ) {
        if (!es(k, "LAYER")) {
          k++;
          continue;
        }
        const { e, sig } = entidad(k);
        k = sig;
        const nombre = texto(e, 2);
        if (!nombre) continue;
        capas.push({ nombre, apagada: num(e, 62, 7) < 0, congelada: (num(e, 70) & 1) !== 0 });
      }
    } else if (seccion === "BLOCKS") {
      for (; k < n && !es(k, "ENDSEC"); ) {
        if (!es(k, "BLOCK")) {
          k++;
          continue;
        }
        const { e, sig } = entidad(k);
        const b: Bloque = { nombre: texto(e, 2), base: [num(e, 10), num(e, 20), num(e, 30)], entidades: [] };
        k = listaEntidades(sig, ["ENDBLK", "ENDSEC"], b.entidades);
        if (es(k, "ENDBLK")) k = entidad(k).sig;
        bloques.set(b.nombre, b);
      }
    } else if (seccion === "ENTITIES") {
      k = listaEntidades(k, ["ENDSEC"], entidades);
    } else {
      while (k < n && !es(k, "ENDSEC")) k++;
    }
    if (k < n) k++;
  }

  return { version, codificacion, insunits, capas, bloques, entidades };
}
