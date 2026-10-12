/**
 * Texto de las celdas del editor (V2a): cómo se escribe y se lee cada tipo de dato en una tabla, en
 * el formato que pega Excel en español.
 *
 * - Números: coma o punto decimal («3,5» o «3.5»), signo «-» o «−», sin separador de miles. Se
 *   escriben con coma y todas sus cifras (el valor exacto que se guarda).
 * - Puntos: «x y; x y; …» (las coordenadas separadas por espacios, los puntos por «;»).
 * - Polígonos (huecos): los de puntos separados por «|».
 * - Grupos de números (huecos de un muro): «a b c d | a b c d».
 * - Valores con nombre (multiplicadores): «m11=0,32 m22=0,27», sólo los que se dan.
 * - Vectores (F, M, q): «x y z».
 * - GDL (coartados, liberaciones): seis cifras 1 o 0, «111000», en el orden del tipo.
 * - Sí o no: «sí» o «no»; vacío es «sin dar» (el valor por defecto).
 *
 * Una celda vacía es un dato opcional sin dar. Puro: sin IO.
 */
import type { Vec2 } from "../compilador/fisico.ts";

export type Fila = Readonly<Record<string, string>>;

export interface ErrorCelda {
  columna: string;
  mensaje: string;
}

const NUMERO = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** Número de una celda, o un mensaje de por qué no lo es. */
export function leerNumero(t: string): number | string {
  const s = t.replace(/[\s   ]/g, "").replace(/−/g, "-");
  if (s.includes(",") && s.includes(".")) return `«${t}» no es un número (¿coma y punto a la vez?)`;
  const n = s.replace(",", ".");
  if (!NUMERO.test(n)) return `«${t}» no es un número`;
  const v = Number(n);
  return Number.isFinite(v) ? v : `«${t}» no es un número finito`;
}

/** Un número con coma decimal y todas sus cifras. */
export const textoNumero = (v: number): string => (Object.is(v, -0) ? "0" : String(v).replace(".", ","));

export const textoPuntos = (p: readonly Vec2[]): string => p.map(([x, y]) => `${textoNumero(x)} ${textoNumero(y)}`).join("; ");
export const textoPoligonos = (p: readonly (readonly Vec2[])[]): string => p.map(textoPuntos).join(" | ");
export const textoVector = (v: readonly number[]): string => v.map(textoNumero).join(" ");
export const textoGdl = (v: readonly boolean[]): string => v.map((x) => (x ? "1" : "0")).join("");
export const textoGrupos = (g: readonly (readonly number[])[]): string => g.map(textoVector).join(" | ");
/** Los valores de `claves` que hay en `o`, en ese orden: «m11=0,32 m22=0,27». */
export const textoClaves = (o: Readonly<Record<string, number | undefined>>, claves: readonly string[]): string =>
  claves
    .filter((k) => o[k] !== undefined)
    .map((k) => `${k}=${textoNumero(o[k]!)}`)
    .join(" ");
export const textoBooleano = (v: boolean | undefined): string => (v === undefined ? "" : v ? "sí" : "no");

/** Lee las celdas de una fila y acumula los errores, columna a columna. */
export class Lector {
  readonly errores: ErrorCelda[] = [];
  private readonly fila: Fila;
  constructor(fila: Fila) {
    this.fila = fila;
  }

  private mal(columna: string, mensaje: string): undefined {
    this.errores.push({ columna, mensaje });
    return undefined;
  }

  /** El texto de la celda sin espacios a los lados; undefined si está vacía. */
  texto(c: string, o: { obligatorio?: boolean } = {}): string | undefined {
    const t = (this.fila[c] ?? "").trim();
    if (t === "") return o.obligatorio ? this.mal(c, "falta el dato") : undefined;
    return t;
  }

  numero(c: string, o: { obligatorio?: boolean; min?: number; mayorQue?: number; max?: number } = {}): number | undefined {
    const t = this.texto(c, o);
    if (t === undefined) return undefined;
    const v = leerNumero(t);
    if (typeof v === "string") return this.mal(c, v);
    if (o.mayorQue !== undefined && !(v > o.mayorQue)) return this.mal(c, `tiene que ser mayor que ${textoNumero(o.mayorQue)}`);
    if (o.min !== undefined && v < o.min) return this.mal(c, `no puede ser menor que ${textoNumero(o.min)}`);
    if (o.max !== undefined && v > o.max) return this.mal(c, `no puede ser mayor que ${textoNumero(o.max)}`);
    return v;
  }

  opcion<T extends string>(c: string, valores: readonly T[], o: { obligatorio?: boolean } = {}): T | undefined {
    const t = this.texto(c, o);
    if (t === undefined) return undefined;
    const v = valores.find((x) => x.toLowerCase() === t.toLowerCase());
    return v ?? this.mal(c, `«${t}» no vale: tiene que ser ${valores.map((x) => `«${x}»`).join(", ")}`);
  }

  booleano(c: string): boolean | undefined {
    const t = this.texto(c);
    if (t === undefined) return undefined;
    const s = t.toLowerCase();
    if (["sí", "si", "s", "x", "1", "true"].includes(s)) return true;
    if (["no", "n", "0", "false"].includes(s)) return false;
    return this.mal(c, `«${t}» no vale: tiene que ser «sí» o «no»`);
  }

  private numeros(c: string, t: string, n: number | null): number[] | undefined {
    const partes = t.split(/\s+/).filter(Boolean);
    if (n !== null && partes.length !== n) return this.mal(c, `«${t}» tiene que ser ${n} números separados por espacios`);
    const r: number[] = [];
    for (const p of partes) {
      const v = leerNumero(p);
      if (typeof v === "string") return this.mal(c, v);
      r.push(v);
    }
    return r;
  }

  vector(c: string, o: { obligatorio?: boolean } = {}): [number, number, number] | undefined {
    const t = this.texto(c, o);
    if (t === undefined) return undefined;
    return this.numeros(c, t, 3) as [number, number, number] | undefined;
  }

  private puntosDe(c: string, t: string, min: number): Vec2[] | undefined {
    const r: Vec2[] = [];
    for (const p of t.split(";").map((x) => x.trim()).filter(Boolean)) {
      const v = this.numeros(c, p, 2);
      if (!v) return undefined;
      r.push([v[0]!, v[1]!]);
    }
    if (r.length < min) return this.mal(c, `hacen falta al menos ${min} puntos («x y; x y; …»)`);
    return r;
  }

  puntos(c: string, o: { obligatorio?: boolean; min: number }): Vec2[] | undefined {
    const t = this.texto(c, o);
    return t === undefined ? undefined : this.puntosDe(c, t, o.min);
  }

  poligonos(c: string): Vec2[][] | undefined {
    const t = this.texto(c);
    if (t === undefined) return undefined;
    const r: Vec2[][] = [];
    for (const p of t.split("|")) {
      const v = this.puntosDe(c, p, 3);
      if (!v) return undefined;
      r.push(v);
    }
    return r;
  }

  /** Grupos de `n` números separados por «|» (los huecos de un muro: «desde hasta z0 z1 | …»). */
  grupos(c: string, n: number): number[][] | undefined {
    const t = this.texto(c);
    if (t === undefined) return undefined;
    const r: number[][] = [];
    for (const g of t.split("|")) {
      const v = this.numeros(c, g.trim(), n);
      if (!v) return undefined;
      r.push(v);
    }
    return r;
  }

  /** Valores con nombre, «m11=0,32 m22=0,27», de entre `claves`, cada uno > 0 y ≤ `max`. */
  claves(c: string, claves: readonly string[], o: { max?: number } = {}): Record<string, number> | undefined {
    const t = this.texto(c);
    if (t === undefined) return undefined;
    const r: Record<string, number> = {};
    for (const x of t.replace(/\s*=\s*/g, "=").split(/\s+/).filter(Boolean)) {
      const m = /^([^=]+)=(.+)$/.exec(x);
      const k = m ? claves.find((y) => y.toLowerCase() === m[1]!.toLowerCase()) : undefined;
      if (!m || !k) return this.mal(c, `«${x}» tiene que ser «nombre=valor», con un nombre de ${claves.join(", ")}`);
      if (k in r) return this.mal(c, `${k} está dos veces`);
      const v = leerNumero(m[2]!);
      if (typeof v === "string") return this.mal(c, v);
      if (!(v > 0) || (o.max !== undefined && v > o.max)) return this.mal(c, `${k} tiene que estar en (0, ${textoNumero(o.max ?? Infinity)}]`);
      r[k] = v;
    }
    return Object.keys(r).length ? Object.fromEntries(claves.filter((k) => k in r).map((k) => [k, r[k]!])) : undefined;
  }

  gdl(c: string, o: { obligatorio?: boolean } = {}): [boolean, boolean, boolean, boolean, boolean, boolean] | undefined {
    const t = this.texto(c, o);
    if (t === undefined) return undefined;
    const s = t.replace(/\s+/g, "");
    if (!/^[01]{6}$/.test(s)) return this.mal(c, `«${t}» tiene que ser seis cifras 1 o 0 («111000»)`);
    return [...s].map((x) => x === "1") as [boolean, boolean, boolean, boolean, boolean, boolean];
  }

  /** Las columnas que no aplican tienen que estar vacías. */
  vacias(columnas: readonly string[], motivo: string): void {
    for (const c of columnas) if ((this.fila[c] ?? "").trim() !== "") this.mal(c, `no aplica ${motivo}`);
  }
}

/** Celdas de un texto pegado de una hoja de cálculo: filas por salto de línea y celdas por tabulador, con comillas como Excel. */
export function leerTsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let i = 0;
  const t = texto.replace(/\r\n?/g, "\n");
  while (i < t.length) {
    const ch = t[i]!;
    if (celda === "" && ch === '"') {
      // Celda entre comillas: hasta la comilla de cierre; «""» es una comilla
      let j = i + 1;
      let v = "";
      for (; j < t.length; j++) {
        if (t[j] === '"') {
          if (t[j + 1] === '"') {
            v += '"';
            j++;
          } else break;
        } else v += t[j];
      }
      if (j < t.length && (t[j + 1] === "\t" || t[j + 1] === "\n" || j + 1 === t.length)) {
        celda = v;
        i = j + 1;
        continue;
      }
    }
    if (ch === "\t") {
      fila.push(celda);
      celda = "";
    } else if (ch === "\n") {
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else celda += ch;
    i++;
  }
  if (celda !== "" || fila.length) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((x) => x.trim() !== ""));
}

/** Texto para pegar en una hoja de cálculo: celdas por tabulador, con comillas si hace falta. */
export function escribirTsv(filas: readonly (readonly string[])[]): string {
  const celda = (x: string) => (/[\t\n"]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
  return filas.map((f) => f.map(celda).join("\t")).join("\n") + "\n";
}
