/**
 * La geometría de un DXF en el plano (V2c-4, `docs/fem3d/dibujo.md` §10): las entidades de
 * `leerDxf` con sus bloques expandidos y proyectadas en XY, en las unidades del fichero.
 *
 * - Bloques: `INSERT` anidados (punto base, escala, giro, extrusión) y `MINSERT`; las cotas
 *   (`DIMENSION`), por su bloque anónimo en su OCS, como ezdxf. Un bloque que se inserta a sí mismo
 *   se corta y se avisa.
 * - OCS: el algoritmo del eje arbitrario de AutoCAD. Con la extrusión +Z, nada cambia (los mismos
 *   doubles); con −Z, x → −x exacto.
 * - Curvas (`ARC`, `CIRCLE`, `ELLIPSE`, `SPLINE` y los bulges de las polilíneas): cuerdas de 5° como
 *   mucho, calculadas en su plano y llevadas al dibujo, así que una curva escalada o inclinada queda
 *   sobre su imagen. Sus extremos son los de verdad, no los de la discretización.
 * - Lo que sale: segmentos rectos (`lineas`) y cuerdas de curvas (`curvas`), los puntos para
 *   enganchar (extremos, vértices, centros y puntos medios de arcos) y los textos. Los puntos medios
 *   de los segmentos rectos los pone quien engancha.
 * - Capas: cada cosa lleva su grupo, el par (capa efectiva, capa de la entidad del espacio modelo).
 *   La capa "0" dentro de un bloque toma la de su `INSERT`. Ocultar una capa oculta lo que la tiene
 *   en cualquiera de las dos.
 * - Lo que no se lee (`HATCH`, `MLINE`, `XLINE`, sólidos 3D, imágenes…) se cuenta por tipo.
 *
 * Puro: sin IO, sin React ni DOM.
 */
import { leerDxf, num, nums, texto, tiene, type Bloque, type Dxf, type Entidad } from "./lector.ts";

export type TipoPuntoDxf = "extremo" | "vertice" | "centro" | "medio";
export const TIPOS_PUNTO_DXF: readonly TipoPuntoDxf[] = ["extremo", "vertice", "centro", "medio"];

export interface CapaDxf {
  nombre: string;
  /** Apagada o congelada en el DXF: empieza oculta. */
  oculta: boolean;
  /** Entidades del espacio modelo en ella. */
  entidades: number;
}

export interface TextoDxf {
  x: number;
  y: number;
  altura: number;
  /** Ángulo de la dirección del texto, rad desde +X. */
  giro: number;
  texto: string;
  /** Alineación horizontal: 0 izquierda, 1 centro, 2 derecha. */
  h: 0 | 1 | 2;
  /** Vertical: 0 línea base, 1 abajo, 2 en medio, 3 arriba. */
  v: 0 | 1 | 2 | 3;
  grupo: number;
}

export interface DibujoDxf {
  version: string | null;
  codificacion: string;
  insunits: number | null;
  capas: CapaDxf[];
  /** Pares (capa efectiva, capa raíz) como índices de `capas`: [c0, r0, c1, r1, …]. */
  grupos: Uint32Array;
  /** Segmentos rectos: x0 y0 x1 y1. */
  lineas: Float64Array;
  grupoLineas: Uint32Array;
  /** Cuerdas de las curvas: x0 y0 x1 y1. */
  curvas: Float64Array;
  grupoCurvas: Uint32Array;
  /** Puntos para enganchar: x y. */
  puntos: Float64Array;
  /** Índice en `TIPOS_PUNTO_DXF`. */
  tipoPuntos: Uint8Array;
  grupoPuntos: Uint32Array;
  textos: TextoDxf[];
  /** Entidades no leídas, por tipo. */
  ignoradas: Record<string, number>;
  avisos: string[];
  /** [xmin, ymin, xmax, ymax], o null si no hay nada. */
  extension: [number, number, number, number] | null;
}

// ─── Transformaciones afines 3D (3 × 4, por filas) ──────────────────────────────────────────────

type Mat = Float64Array;

const IDENTIDAD: Mat = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);

/** A ∘ B: primero B, luego A. */
function componer(a: Mat, b: Mat): Mat {
  if (a === IDENTIDAD) return b;
  if (b === IDENTIDAD) return a;
  const r = new Float64Array(12);
  for (let i = 0; i < 3; i++) {
    const [a0, a1, a2, a3] = [a[4 * i]!, a[4 * i + 1]!, a[4 * i + 2]!, a[4 * i + 3]!];
    for (let j = 0; j < 4; j++) r[4 * i + j] = a0 * b[j]! + a1 * b[4 + j]! + a2 * b[8 + j]! + (j === 3 ? a3 : 0);
  }
  return r;
}

/** El punto (x, y, z) por M, en XY. Con la identidad, los mismos doubles. */
function xy(m: Mat, x: number, y: number, z: number): [number, number] {
  if (m === IDENTIDAD) return [x, y];
  return [m[0]! * x + m[1]! * y + m[2]! * z + m[3]!, m[4]! * x + m[5]! * y + m[6]! * z + m[7]!];
}

/** El vector (x, y, z) por la parte lineal de M, en XY. */
function vxy(m: Mat, x: number, y: number, z: number): [number, number] {
  if (m === IDENTIDAD) return [x, y];
  return [m[0]! * x + m[1]! * y + m[2]! * z, m[4]! * x + m[5]! * y + m[6]! * z];
}

const traslacion = (x: number, y: number, z: number): Mat => (x === 0 && y === 0 && z === 0 ? IDENTIDAD : new Float64Array([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]));

/** Coseno y seno de g grados, exactos en los múltiplos de 90°. */
export function cosSin(g: number): [number, number] {
  const r = ((g % 360) + 360) % 360;
  if (r === 0) return [1, 0];
  if (r === 90) return [0, 1];
  if (r === 180) return [-1, 0];
  if (r === 270) return [0, -1];
  const a = (g * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

type Vec3 = [number, number, number];

const cruz = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function unitario3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l === 0 || l === 1 ? v : [v[0] / l, v[1] / l, v[2] / l];
}

/** La extrusión de una entidad (210, 220, 230), +Z si no la dice. */
const extrusion = (e: Entidad): Vec3 => (tiene(e, 210) || tiene(e, 230) ? [num(e, 210), num(e, 220), num(e, 230, 1)] : [0, 0, 1]);

/** Del OCS de la extrusión n al WCS (algoritmo del eje arbitrario). */
function ocs(n0: Vec3): Mat {
  if (n0[0] === 0 && n0[1] === 0 && n0[2] > 0) return IDENTIDAD;
  const n = unitario3(n0);
  const ax = unitario3(Math.abs(n[0]) < 1 / 64 && Math.abs(n[1]) < 1 / 64 ? cruz([0, 1, 0], n) : cruz([0, 0, 1], n));
  const ay = unitario3(cruz(n, ax));
  return new Float64Array([ax[0], ay[0], n[0], 0, ax[1], ay[1], n[1], 0, ax[2], ay[2], n[2], 0]);
}

// ─── Textos ─────────────────────────────────────────────────────────────────────────────────────

const ESPECIALES: Record<string, string> = { c: "Ø", d: "°", p: "±" };

/** Los códigos %% de un TEXT y los \U+XXXX. */
export function textoPlano(s: string): string {
  return s
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/%%(\d{3}|[cdpuokCDPUOK%])/g, (_, c: string) => {
      if (/^\d{3}$/.test(c)) return String.fromCharCode(Number(c));
      if (c === "%") return "%";
      return ESPECIALES[c.toLowerCase()] ?? "";
    });
}

/** Códigos de MTEXT con argumento hasta «;». */
const CON_ARGUMENTO = new Set(["A", "C", "c", "F", "f", "H", "h", "Q", "q", "T", "t", "W", "w", "p"]);

/** El texto de un MTEXT sin su formato, como `plain_mtext` de ezdxf: \P es un salto de línea. */
export function textoMtext(s: string): string {
  let r = "";
  for (let i = 0; i < s.length; ) {
    const ch = s[i]!;
    if (ch === "{" || ch === "}") {
      i++;
      continue;
    }
    if (ch !== "\\" || i + 1 >= s.length) {
      r += ch;
      i++;
      continue;
    }
    const c = s[i + 1]!;
    if (c === "P" || c === "N" || c === "X") {
      r += "\n";
      i += 2;
    } else if (c === "~") {
      r += " ";
      i += 2;
    } else if (c === "\\" || c === "{" || c === "}") {
      r += c;
      i += 2;
    } else if (c === "U" && s[i + 2] === "+" && /^[0-9A-Fa-f]{4}$/.test(s.slice(i + 3, i + 7))) {
      r += String.fromCharCode(Number.parseInt(s.slice(i + 3, i + 7), 16));
      i += 7;
    } else if (c === "S") {
      const fin = s.indexOf(";", i + 2);
      const cuerpo = s.slice(i + 2, fin < 0 ? s.length : fin);
      const m = /^(.*?)([\^/#])(.*)$/.exec(cuerpo);
      r += m ? `${m[1]!.replace(/^ +/, "")}${m[2]}${m[3]}` : cuerpo;
      i = fin < 0 ? s.length : fin + 1;
    } else if (CON_ARGUMENTO.has(c)) {
      const fin = s.indexOf(";", i + 2);
      i = fin < 0 ? s.length : fin + 1;
    } else i += 2;
  }
  return textoPlano(r.replace(/\t/g, "    "));
}

// ─── Aplanar ────────────────────────────────────────────────────────────────────────────────────

/** Paso máximo de las curvas, grados. */
export const PASO_CURVA = 5;
/** Profundidad máxima de bloques anidados. */
const PROFUNDIDAD = 32;
/** Inserciones de un MINSERT como mucho. */
const TOPE_MINSERT = 10_000;

/** Lo que no se dibuja ni se cuenta: plantillas de atributos, vistas, el fin de secuencias. */
const SIN_DIBUJO = new Set(["ATTDEF", "VIEWPORT", "SEQEND", "ENDBLK"]);

class Salida {
  lineas: number[] = [];
  gl: number[] = [];
  curvas: number[] = [];
  gc: number[] = [];
  puntos: number[] = [];
  tp: number[] = [];
  gp: number[] = [];
  textos: TextoDxf[] = [];
  ignoradas: Record<string, number> = {};
  avisos: string[] = [];
  private grupos = new Map<string, number>();
  pares: number[] = [];
  private capa: (nombre: string) => number;
  constructor(capa: (nombre: string) => number) {
    this.capa = capa;
  }

  grupo(capa: string, raiz: string): number {
    const k = `${capa}\u0000${raiz}`;
    let g = this.grupos.get(k);
    if (g === undefined) {
      g = this.pares.length / 2;
      this.pares.push(this.capa(capa), this.capa(raiz));
      this.grupos.set(k, g);
    }
    return g;
  }
  linea(a: [number, number], b: [number, number], g: number): void {
    this.lineas.push(a[0], a[1], b[0], b[1]);
    this.gl.push(g);
  }
  /** Los puntos de una curva, como cuerdas. */
  curva(ps: [number, number][], g: number): void {
    for (let i = 1; i < ps.length; i++) {
      this.curvas.push(ps[i - 1]![0], ps[i - 1]![1], ps[i]![0], ps[i]![1]);
      this.gc.push(g);
    }
  }
  punto(p: [number, number], tipo: TipoPuntoDxf, g: number): void {
    this.puntos.push(p[0], p[1]);
    this.tp.push(TIPOS_PUNTO_DXF.indexOf(tipo));
    this.gp.push(g);
  }
  ignorar(tipo: string): void {
    this.ignoradas[tipo] = (this.ignoradas[tipo] ?? 0) + 1;
  }
}

/** Número de cuerdas de un arco de `barrido` radianes. */
const cuerdas = (barrido: number) => Math.max(2, Math.ceil(Math.abs(barrido) / ((PASO_CURVA * Math.PI) / 180) - 1e-9));

/**
 * Un arco de centro (cx, cy) y radio r en el plano local a la cota z, de a0 a a1 (grados, a1 > a0),
 * por M. Los extremos, con el seno y el coseno exactos en los múltiplos de 90°.
 */
function puntosArco(m: Mat, cx: number, cy: number, z: number, r: number, a0: number, a1: number): [number, number][] {
  const n = cuerdas(((a1 - a0) * Math.PI) / 180);
  const ps: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const [c, s] = k === 0 ? cosSin(a0) : k === n ? cosSin(a1) : cosSin(a0 + ((a1 - a0) * k) / n);
    ps.push(xy(m, cx + r * c, cy + r * s, z));
  }
  return ps;
}

/** El tramo de polilínea de p a q con bulge b (≠ 0) en el plano local, como arco: puntos, centro y punto medio. */
function tramoBulge(m: Mat, p: [number, number], q: [number, number], b: number, z: number): { ps: [number, number][]; centro: [number, number]; medio: [number, number] } {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const f = (1 - b * b) / (4 * b);
  const cx = (p[0] + q[0]) / 2 - dy * f;
  const cy = (p[1] + q[1]) / 2 + dx * f;
  const r = Math.hypot(p[0] - cx, p[1] - cy);
  const a0 = Math.atan2(p[1] - cy, p[0] - cx);
  const barrido = 4 * Math.atan(b);
  const n = cuerdas(barrido);
  const ps: [number, number][] = [xy(m, p[0], p[1], z)];
  for (let k = 1; k < n; k++) {
    const a = a0 + (barrido * k) / n;
    ps.push(xy(m, cx + r * Math.cos(a), cy + r * Math.sin(a), z));
  }
  ps.push(xy(m, q[0], q[1], z));
  const am = a0 + barrido / 2;
  return { ps, centro: xy(m, cx, cy, z), medio: xy(m, cx + r * Math.cos(am), cy + r * Math.sin(am), z) };
}

/** El punto de un B-spline (racional si hay pesos) en u, por de Boor. */
export function puntoSpline(grado: number, nudos: readonly number[], ctrl: readonly Vec3[], pesos: readonly number[] | null, u: number): Vec3 {
  const p = grado;
  const nc = ctrl.length;
  // El tramo: nudos[s] ≤ u < nudos[s+1], con s en [p, nc − 1]; en el final del dominio, el último no nulo
  let s = p;
  while (s < nc - 1 && !(u < nudos[s + 1]!)) s++;
  while (s > p && nudos[s] === nudos[s + 1]) s--;
  const d: [number, number, number, number][] = [];
  for (let j = 0; j <= p; j++) {
    const c = ctrl[s - p + j]!;
    const w = pesos ? pesos[s - p + j]! : 1;
    d.push([c[0] * w, c[1] * w, c[2] * w, w]);
  }
  for (let r = 1; r <= p; r++)
    for (let j = p; j >= r; j--) {
      const i = s - p + j;
      const den = nudos[i + p - r + 1]! - nudos[i]!;
      const a = den === 0 ? 0 : (u - nudos[i]!) / den;
      const x = d[j]!;
      const y = d[j - 1]!;
      d[j] = [(1 - a) * y[0] + a * x[0], (1 - a) * y[1] + a * x[1], (1 - a) * y[2] + a * x[2], (1 - a) * y[3] + a * x[3]];
    }
  const [x, y, z, w] = d[p]!;
  return [x / w, y / w, z / w];
}

/** El centroide del área de un polígono (respecto a su primer vértice, para no perder cifras), o null si no tiene área. */
export function centroide(ps: readonly [number, number][]): [number, number] | null {
  const [x0, y0] = ps[0]!;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ps.length; i++) {
    const [xi, yi] = ps[i]!;
    const [xj, yj] = ps[(i + 1) % ps.length]!;
    const [ax, ay, bx, by] = [xi - x0, yi - y0, xj - x0, yj - y0];
    const k = ax * by - bx * ay;
    a += k;
    cx += (ax + bx) * k;
    cy += (ay + by) * k;
  }
  if (a === 0) return null;
  return [x0 + cx / (3 * a), y0 + cy / (3 * a)];
}

/** Muestras de un B-spline por tramo de nudos. */
const MUESTRAS_TRAMO = 8;

/** Aplana un DXF ya leído. */
export function aplanarDxf(dxf: Dxf): DibujoDxf {
  const indiceCapa = new Map<string, number>();
  const capas: CapaDxf[] = [];
  for (const c of dxf.capas)
    if (!indiceCapa.has(c.nombre)) {
      indiceCapa.set(c.nombre, capas.length);
      capas.push({ nombre: c.nombre, oculta: c.apagada || c.congelada, entidades: 0 });
    }
  const capa = (nombre: string): number => {
    let i = indiceCapa.get(nombre);
    if (i === undefined) {
      i = capas.length;
      indiceCapa.set(nombre, i);
      capas.push({ nombre, oculta: false, entidades: 0 });
    }
    return i;
  };
  const out = new Salida(capa);
  const avisados = new Set<string>();
  const avisar = (s: string) => {
    if (!avisados.has(s)) {
      avisados.add(s);
      out.avisos.push(s);
    }
  };

  /** Un texto en el punto local (x, y, z) con su giro (rad) y altura, por M. */
  const ponerTexto = (m: Mat, x: number, y: number, z: number, giro: number, altura: number, s: string, h: 0 | 1 | 2, v: 0 | 1 | 2 | 3, g: number) => {
    if (!s.trim()) return;
    const [px, py] = xy(m, x, y, z);
    const c = Math.cos(giro);
    const sn = Math.sin(giro);
    const dx = vxy(m, c, sn, 0);
    const dy = vxy(m, -sn * altura, c * altura, 0);
    out.textos.push({ x: px, y: py, altura: Math.hypot(dy[0], dy[1]), giro: Math.atan2(dx[1], dx[0]), texto: s, h, v, grupo: g });
  };

  /** Un TEXT o un ATTRIB (con su código de alineación vertical). */
  const textoSimple = (e: Entidad, m0: Mat, g: number, codigoV: number) => {
    const m = componer(m0, ocs(extrusion(e)));
    const ah = num(e, 72);
    const av = num(e, codigoV);
    const alineado = (ah !== 0 || av !== 0) && ah !== 3 && ah !== 5 && tiene(e, 11);
    const [x, y, z] = alineado ? [num(e, 11), num(e, 21), num(e, 31)] : [num(e, 10), num(e, 20), num(e, 30)];
    const h: 0 | 1 | 2 = ah === 1 || ah === 4 ? 1 : ah === 2 ? 2 : 0;
    const v: 0 | 1 | 2 | 3 = ah === 4 ? 2 : av >= 0 && av <= 3 && alineado ? (av as 0 | 1 | 2 | 3) : 0;
    ponerTexto(m, x, y, z, (num(e, 50) * Math.PI) / 180, num(e, 40, 1), textoPlano(texto(e, 1)), h, v, g);
  };

  const dibujar = (e: Entidad, m: Mat, capaPadre: string | null, raiz: string, activos: string[]): void => {
    const efectiva = e.capa === "0" && capaPadre !== null ? capaPadre : e.capa;
    const g = out.grupo(efectiva, raiz);
    switch (e.tipo) {
      case "LINE": {
        const a = xy(m, num(e, 10), num(e, 20), num(e, 30));
        const b = xy(m, num(e, 11), num(e, 21), num(e, 31));
        out.linea(a, b, g);
        out.punto(a, "extremo", g);
        out.punto(b, "extremo", g);
        return;
      }
      case "POINT":
        out.punto(xy(m, num(e, 10), num(e, 20), num(e, 30)), "vertice", g);
        return;
      case "CIRCLE":
      case "ARC": {
        const ml = componer(m, ocs(extrusion(e)));
        const [cx, cy, z, r] = [num(e, 10), num(e, 20), num(e, 30), num(e, 40)];
        out.punto(xy(ml, cx, cy, z), "centro", g);
        if (e.tipo === "CIRCLE") {
          out.curva(puntosArco(ml, cx, cy, z, r, 0, 360), g);
          for (const a of [0, 90, 180, 270]) {
            const [c, s] = cosSin(a);
            out.punto(xy(ml, cx + r * c, cy + r * s, z), "vertice", g);
          }
          return;
        }
        const a0 = num(e, 50);
        let a1 = num(e, 51);
        while (a1 <= a0) a1 += 360;
        const ps = puntosArco(ml, cx, cy, z, r, a0, a1);
        out.curva(ps, g);
        out.punto(ps[0]!, "extremo", g);
        out.punto(ps[ps.length - 1]!, "extremo", g);
        const [c, s] = cosSin((a0 + a1) / 2);
        out.punto(xy(ml, cx + r * c, cy + r * s, z), "medio", g);
        return;
      }
      case "ELLIPSE": {
        const n = unitario3(extrusion(e));
        const c: Vec3 = [num(e, 10), num(e, 20), num(e, 30)];
        const mayor: Vec3 = [num(e, 11), num(e, 21), num(e, 31)];
        const k = num(e, 40, 1);
        const menor = cruz(n, mayor).map((x) => x * k) as Vec3;
        const t0 = num(e, 41, 0);
        let t1 = num(e, 42, 2 * Math.PI);
        while (t1 <= t0) t1 += 2 * Math.PI;
        const entera = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-12;
        const pt = (t: number): [number, number] => {
          const [ct, st] = [Math.cos(t), Math.sin(t)];
          return xy(m, c[0] + ct * mayor[0] + st * menor[0], c[1] + ct * mayor[1] + st * menor[1], c[2] + ct * mayor[2] + st * menor[2]);
        };
        const nc = cuerdas(t1 - t0);
        out.curva(Array.from({ length: nc + 1 }, (_, i) => pt(t0 + ((t1 - t0) * i) / nc)), g);
        out.punto(xy(m, c[0], c[1], c[2]), "centro", g);
        if (entera) for (const t of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) out.punto(pt(t), "vertice", g);
        else {
          out.punto(pt(t0), "extremo", g);
          out.punto(pt(t1), "extremo", g);
          out.punto(pt((t0 + t1) / 2), "medio", g);
        }
        return;
      }
      case "LWPOLYLINE": {
        const vs: { p: [number, number]; b: number }[] = [];
        for (let i = 0; i < e.codigos.length; i++) {
          const c = e.codigos[i]!;
          const v = Number.parseFloat(e.valores[i]!);
          if (c === 10) vs.push({ p: [v, 0], b: 0 });
          else if (c === 20 && vs.length) vs[vs.length - 1]!.p[1] = v;
          else if (c === 42 && vs.length) vs[vs.length - 1]!.b = v;
        }
        polilinea(vs, (num(e, 70) & 1) !== 0, componer(m, ocs(extrusion(e))), num(e, 38), g);
        return;
      }
      case "POLYLINE": {
        const f = num(e, 70);
        if (f & (16 | 64)) {
          out.ignorar("POLYLINE (malla)");
          return;
        }
        const tresD = (f & 8) !== 0;
        const vs: { p: [number, number]; b: number; z: number }[] = [];
        for (const h of e.hijos ?? []) if (!(num(h, 70) & 16)) vs.push({ p: [num(h, 10), num(h, 20)], b: tresD ? 0 : num(h, 42), z: num(h, 30) });
        if (tresD) {
          const ps = vs.map((v) => xy(m, v.p[0], v.p[1], v.z));
          const cerrada = (f & 1) !== 0 && ps.length > 2;
          ps.forEach((p, i) => out.punto(p, cerrada || (i > 0 && i < ps.length - 1) ? "vertice" : "extremo", g));
          for (let i = 1; i < ps.length; i++) out.linea(ps[i - 1]!, ps[i]!, g);
          if (cerrada) out.linea(ps[ps.length - 1]!, ps[0]!, g);
        } else polilinea(vs, (f & 1) !== 0, componer(m, ocs(extrusion(e))), num(e, 30), g);
        return;
      }
      case "SPLINE": {
        const grado = num(e, 71, 3);
        const nudos = nums(e, 40);
        const xs = nums(e, 10);
        const ys = nums(e, 20);
        const zs = nums(e, 30);
        const ctrl: Vec3[] = xs.map((x, i) => [x, ys[i] ?? 0, zs[i] ?? 0]);
        const w = nums(e, 41);
        const pesos = w.length === ctrl.length && w.some((x) => x !== 1) ? w : null;
        let ps: [number, number][];
        if (ctrl.length > grado && nudos.length === ctrl.length + grado + 1) {
          ps = [];
          for (let i = grado; i < ctrl.length; i++) {
            const [u0, u1] = [nudos[i]!, nudos[i + 1]!];
            if (!(u1 > u0)) continue;
            for (let j = 0; j < MUESTRAS_TRAMO; j++) {
              const q = puntoSpline(grado, nudos, ctrl, pesos, u0 + ((u1 - u0) * j) / MUESTRAS_TRAMO);
              ps.push(xy(m, q[0], q[1], q[2]));
            }
          }
          const q = puntoSpline(grado, nudos, ctrl, pesos, nudos[ctrl.length]!);
          ps.push(xy(m, q[0], q[1], q[2]));
        } else {
          const fx = nums(e, 11);
          const fy = nums(e, 21);
          const fz = nums(e, 31);
          ps = fx.map((x, i) => xy(m, x, fy[i] ?? 0, fz[i] ?? 0));
        }
        if (ps.length < 2) return;
        out.curva(ps, g);
        out.punto(ps[0]!, "extremo", g);
        out.punto(ps[ps.length - 1]!, "extremo", g);
        return;
      }
      case "SOLID":
      case "TRACE": {
        const ml = componer(m, ocs(extrusion(e)));
        const z = num(e, 30);
        const p = [10, 11, 12, 13].map((c) => [num(e, c), num(e, c + 10)] as const);
        const ps = (p[2]![0] === p[3]![0] && p[2]![1] === p[3]![1] ? [p[0], p[1], p[2]] : [p[0], p[1], p[3], p[2]]).map((q) => xy(ml, q![0], q![1], z));
        for (let i = 0; i < ps.length; i++) out.linea(ps[i]!, ps[(i + 1) % ps.length]!, g);
        return;
      }
      case "3DFACE": {
        const ps = [10, 11, 12, 13].map((c) => xy(m, num(e, c), num(e, c + 10), num(e, c + 20)));
        const f = num(e, 70);
        for (let i = 0; i < 4; i++) if (!(f & (1 << i))) out.linea(ps[i]!, ps[(i + 1) % 4]!, g);
        return;
      }
      case "LEADER": {
        const xs = nums(e, 10);
        const ys = nums(e, 20);
        const zs = nums(e, 30);
        const ps = xs.map((x, i) => xy(m, x, ys[i] ?? 0, zs[i] ?? 0));
        for (let i = 1; i < ps.length; i++) out.linea(ps[i - 1]!, ps[i]!, g);
        return;
      }
      case "TEXT":
        textoSimple(e, m, g, 73);
        return;
      case "MTEXT": {
        const n = extrusion(e);
        let dir: [number, number];
        if (tiene(e, 11)) dir = vxy(m, num(e, 11), num(e, 21), num(e, 31));
        else {
          // En grados, aunque la referencia de DXF dice radianes: es lo que escriben AutoCAD y ezdxf
          const [c, s] = cosSin(num(e, 50));
          dir = vxy(componer(m, ocs(n)), c, s, 0);
        }
        let s = "";
        for (let i = 0; i < e.codigos.length; i++) if (e.codigos[i] === 3) s += e.valores[i];
        s += texto(e, 1);
        const at = num(e, 71, 1);
        const h = ((at - 1) % 3) as 0 | 1 | 2;
        const v = ([3, 2, 1] as const)[Math.floor((at - 1) / 3)] ?? 3;
        // En el sistema de M: la dirección ya va por M; el texto se pone con la identidad
        const [px, py] = xy(m, num(e, 10), num(e, 20), num(e, 30));
        const giro = Math.atan2(dir[1], dir[0]);
        const dy = vxy(m, 0, num(e, 40, 1), 0);
        const mtx = textoMtext(s);
        if (mtx.trim()) out.textos.push({ x: px, y: py, altura: m === IDENTIDAD ? num(e, 40, 1) : Math.hypot(dy[0], dy[1]), giro, texto: mtx, h, v, grupo: g });
        return;
      }
      case "INSERT": {
        const b = dxf.bloques.get(texto(e, 2));
        if (b) {
          const ml = componer(m, ocs(extrusion(e)));
          const [sx, sy, sz] = [num(e, 41, 1), num(e, 42, 1), num(e, 43, 1)];
          const [c, s] = cosSin(num(e, 50));
          const cols = Math.max(1, num(e, 70, 1));
          const filas = Math.max(1, num(e, 71, 1));
          const [dc, df] = [num(e, 44), num(e, 45)];
          if (cols * filas > TOPE_MINSERT) avisar(`Un MINSERT de ${cols} × ${filas} bloques «${b.nombre}»: se dibujan los ${TOPE_MINSERT} primeros.`);
          let hechas = 0;
          for (let fi = 0; fi < filas; fi++)
            for (let co = 0; co < cols; co++) {
              if (hechas++ >= TOPE_MINSERT) break;
              const ox = co * dc;
              const oy = fi * df;
              const ix = num(e, 10) + c * ox - s * oy;
              const iy = num(e, 20) + s * ox + c * oy;
              const local = new Float64Array([c * sx, -s * sy, 0, ix - (c * sx * b.base[0] - s * sy * b.base[1]), s * sx, c * sy, 0, iy - (s * sx * b.base[0] + c * sy * b.base[1]), 0, 0, sz, num(e, 30) - sz * b.base[2]]);
              const identidad = c === 1 && s === 0 && sx === 1 && sy === 1 && sz === 1 && local[3] === 0 && local[7] === 0 && local[11] === 0;
              bloque(b, componer(ml, identidad ? IDENTIDAD : local), efectiva, raiz, activos);
            }
        } else avisar(`Falta el bloque «${texto(e, 2)}».`);
        for (const a of e.hijos ?? []) if (!(num(a, 70) & 1)) textoSimple(a, m, out.grupo(a.capa === "0" ? efectiva : a.capa, raiz), 74);
        return;
      }
      case "DIMENSION": {
        const b = dxf.bloques.get(texto(e, 2));
        if (!b) {
          out.ignorar("DIMENSION (sin bloque)");
          return;
        }
        const o = ocs(extrusion(e));
        const ins = tiene(e, 12) ? vxy(o, num(e, 12), num(e, 22), num(e, 32)) : null;
        const mo = componer(componer(m, ins ? traslacion(ins[0], ins[1], 0) : IDENTIDAD), o);
        bloque({ ...b, base: [0, 0, 0] }, mo, efectiva, raiz, activos);
        return;
      }
      default:
        if (!SIN_DIBUJO.has(e.tipo)) out.ignorar(e.tipo);
    }
  };

  /** Una polilínea 2D (LWPOLYLINE o POLYLINE) en el plano local a la cota z. */
  const polilinea = (vs: { p: [number, number]; b: number }[], cerrada: boolean, ml: Mat, z: number, g: number) => {
    const n = vs.length;
    if (n === 0) return;
    const ps = vs.map((v) => xy(ml, v.p[0], v.p[1], z));
    const cerr = cerrada && n > 2;
    ps.forEach((p, i) => out.punto(p, cerr || (i > 0 && i < n - 1) ? "vertice" : "extremo", g));
    const tramos = cerr ? n : n - 1;
    // El centro geométrico de una cerrada sin arcos (el de un pilar dibujado como rectángulo)
    if (cerr && vs.every((v) => v.b === 0)) {
      const c = centroide(ps);
      if (c) out.punto(c, "centro", g);
    }
    for (let i = 0; i < tramos; i++) {
      const j = (i + 1) % n;
      const b = vs[i]!.b;
      if (b === 0 || !Number.isFinite(b)) out.linea(ps[i]!, ps[j]!, g);
      else {
        const t = tramoBulge(ml, vs[i]!.p, vs[j]!.p, b, z);
        t.ps[0] = ps[i]!;
        t.ps[t.ps.length - 1] = ps[j]!;
        out.curva(t.ps, g);
        out.punto(t.centro, "centro", g);
        out.punto(t.medio, "medio", g);
      }
    }
  };

  const bloque = (b: Bloque, m: Mat, capaPadre: string, raiz: string, activos: string[]) => {
    if (activos.includes(b.nombre) || activos.length >= PROFUNDIDAD) {
      avisar(`El bloque «${b.nombre}» se inserta a sí mismo o anida más de ${PROFUNDIDAD} niveles: se corta.`);
      return;
    }
    activos.push(b.nombre);
    for (const x of b.entidades) dibujar(x, m, capaPadre, raiz, activos);
    activos.pop();
  };

  for (const e of dxf.entidades) {
    capas[capa(e.capa)]!.entidades++;
    dibujar(e, IDENTIDAD, null, e.capa, []);
  }

  // La extensión
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const ver = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  for (const a of [out.lineas, out.curvas, out.puntos]) for (let i = 0; i < a.length; i += 2) ver(a[i]!, a[i + 1]!);
  for (const t of out.textos) ver(t.x, t.y);

  return {
    version: dxf.version,
    codificacion: dxf.codificacion,
    insunits: dxf.insunits,
    capas,
    grupos: Uint32Array.from(out.pares),
    lineas: Float64Array.from(out.lineas),
    grupoLineas: Uint32Array.from(out.gl),
    curvas: Float64Array.from(out.curvas),
    grupoCurvas: Uint32Array.from(out.gc),
    puntos: Float64Array.from(out.puntos),
    tipoPuntos: Uint8Array.from(out.tp),
    grupoPuntos: Uint32Array.from(out.gp),
    textos: out.textos,
    ignoradas: out.ignoradas,
    avisos: out.avisos,
    extension: x0 <= x1 ? [x0, y0, x1, y1] : null,
  };
}

/** Lee y aplana un DXF. Lanza `ErrorDxf` si no se puede leer. */
export const dibujoDxf = (bytes: Uint8Array): DibujoDxf => aplanarDxf(leerDxf(bytes));
