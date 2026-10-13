/**
 * Escena preparada para el visor (V1, `docs/fem3d/visor.md` §3.1; desde I2, para WebGL,
 * `docs/fem3d/interfaz.md` §14): la misma escena de A4 (`agente/render/escena.ts`), con las formas
 * agrupadas en capas listas para la GPU, para que el hilo principal sólo las suba. El orden de
 * dibujo se conserva: se agrupan las primitivas seguidas con el mismo estilo y relleno, nunca se
 * reordenan.
 *
 * Cada capa lleva:
 * - los abanicos de triángulos de sus anillos (v0, vi, vi+1), para rellenarlos por stencil con el
 *   número de vueltas («nonzero»), sin triangular, así que no falla con ningún polígono. Las bandas
 *   de isovalores ya vienen orientadas; en las áreas, los anillos de cada polígono se orientan por
 *   su profundidad (`orientarAnillos`), para que cada uno salga como su `<path>` par-impar del SVG y
 *   los de la capa que se solapan se sumen (con la paridad de toda la capa, el cruce de dos vigas
 *   quedaba hueco);
 * - los segmentos de sus contornos (los anillos, cerrados) o de sus líneas, para los trazos.
 *
 * Las coordenadas van en Float32 respecto a `origen` (el centro de la caja de la escena), para no
 * perder precisión lejos del origen del modelo. Los glifos y los textos tienen tamaño en píxeles,
 * así que pasan tal cual, en coordenadas del modelo: el visor los coloca en pantalla en cada
 * encuadre; también los de las líneas rotuladas (las isolíneas), que dependen de la escala. Elegir
 * un objeto con el ratón y su resaltado se resuelven aquí, sobre las primitivas exactas de la escena.
 *
 * Puro: sin IO.
 */
import { dentro, type Escena, type Estilo, type Primitiva, type Texto, type Vec2 } from "../agente/render/escena.ts";
import type { LineaRotulada } from "../agente/render/isovalores.ts";

type Caja = [number, number, number, number];

/** Una capa: primitivas seguidas con el mismo estilo, relleno y forma. */
export interface Capa {
  estilo: Estilo;
  /** «area»: polígonos con huecos; «region»: bandas de isovalores; «trazo»: líneas abiertas. */
  forma: "area" | "region" | "trazo";
  relleno?: string;
  /** Triángulos en abanico de sus anillos (regla «nonzero»): x, y de 3 vértices por triángulo, respecto al origen. Vacío en los trazos. */
  abanicos: Float32Array;
  /** Segmentos de sus contornos o sus líneas: x0, y0, x1, y1, respecto al origen. */
  segmentos: Float32Array;
  /** Caja de sus vértices, respecto al origen (el rectángulo que cubre el stencil). */
  caja: Caja;
}

export type Glifo = Extract<Primitiva, { tipo: "marca" } | { tipo: "flecha" }>;

export interface EscenaPreparada {
  titulo: string;
  cabecera: string[];
  /** Centro de la caja de la escena, en coordenadas del modelo: el origen de las capas. */
  origen: Vec2;
  capas: Capa[];
  glifos: Glifo[];
  textos: Texto[];
  /** Las líneas con un rótulo que se repite (isolíneas): sus rótulos, con `rotulosLineas` en cada escala. */
  lineasRotuladas: LineaRotulada[];
  leyenda: Escena["leyenda"];
  tituloLeyenda?: string;
  notas: string[];
  extremos: Escena["extremos"];
  caja: Escena["caja"];
  mapa?: Escena["mapa"];
}

/** El origen de las capas de una escena: el centro de su caja. */
export const origenDe = (e: Pick<Escena, "caja">): Vec2 => [(e.caja[0] + e.caja[2]) / 2, (e.caja[1] + e.caja[3]) / 2];

const areaConSigno = (r: readonly Vec2[]): number => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]![0] + r[i]![0]) * (r[i]![1] - r[j]![1]);
  return a / 2;
};

/**
 * Qué anillos de un polígono par-impar hay que recorrer al revés para que su número de vueltas sea
 * su paridad: antihorario los de profundidad par (el contorno, una isla en un hueco), horario los de
 * profundidad impar (los huecos). Así, con la regla «nonzero», cada polígono se rellena como en el
 * SVG y los de una misma capa que se solapan se suman en vez de anularse (dos vigas que se cruzan).
 */
export function orientarAnillos(anillos: readonly (readonly Vec2[])[]): boolean[] {
  return anillos.map((r, i) => {
    if (!r.length) return false;
    let prof = 0;
    for (let j = 0; j < anillos.length; j++) if (j !== i && anillos[j]!.length && dentro(r[0]!, anillos[j]!)) prof++;
    return areaConSigno(r) > 0 === (prof % 2 === 1);
  });
}

/** Lo que se va juntando de una capa, en números de JS (se pasa a Float32 al final). */
class Acumulador {
  readonly abanicos: number[] = [];
  readonly segmentos: number[] = [];
  readonly caja: Caja = [Infinity, Infinity, -Infinity, -Infinity];
  private readonly o: Vec2;
  constructor(o: Vec2) {
    this.o = o;
  }
  private punto(q: Vec2): [number, number] {
    const x = q[0] - this.o[0];
    const y = q[1] - this.o[1];
    if (x < this.caja[0]) this.caja[0] = x;
    if (y < this.caja[1]) this.caja[1] = y;
    if (x > this.caja[2]) this.caja[2] = x;
    if (y > this.caja[3]) this.caja[3] = y;
    return [x, y];
  }
  /** Un anillo: su contorno y, con `relleno`, su abanico; `invertir` lo recorre al revés (v0, vi+1, vi). */
  anillo(r: readonly Vec2[], relleno: boolean, invertir = false): void {
    if (!r.length) return;
    const p = r.map((q) => this.punto(q));
    for (let i = 0; i < p.length; i++) {
      const a = p[i]!;
      const b = p[(i + 1) % p.length]!;
      this.segmentos.push(a[0], a[1], b[0], b[1]);
    }
    if (relleno)
      for (let i = 1; i + 1 < p.length; i++) {
        const [b, c] = invertir ? [p[i + 1]!, p[i]!] : [p[i]!, p[i + 1]!];
        this.abanicos.push(p[0]![0], p[0]![1], b[0], b[1], c[0], c[1]);
      }
  }
  /** Un polígono con huecos (par-impar), con sus anillos orientados para la regla «nonzero» (`orientarAnillos`). */
  poligono(anillos: readonly (readonly Vec2[])[]): void {
    const inv = orientarAnillos(anillos);
    anillos.forEach((r, i) => this.anillo(r, true, inv[i]));
  }
  linea(r: readonly Vec2[]): void {
    const p = r.map((q) => this.punto(q));
    for (let i = 1; i < p.length; i++) this.segmentos.push(p[i - 1]![0], p[i - 1]![1], p[i]![0], p[i]![1]);
  }
}

export function prepararEscena(e: Escena): EscenaPreparada {
  const origen = origenDe(e);
  const capas: (Omit<Capa, "abanicos" | "segmentos" | "caja"> & { a: Acumulador })[] = [];
  const glifos: Glifo[] = [];
  const textos: Texto[] = [];
  const lineasRotuladas: LineaRotulada[] = [];
  const capa = (estilo: Estilo, forma: Capa["forma"], relleno: string | undefined): Acumulador => {
    const ult = capas[capas.length - 1];
    if (ult && ult.estilo === estilo && ult.forma === forma && ult.relleno === relleno) return ult.a;
    const a = new Acumulador(origen);
    capas.push({ estilo, forma, ...(relleno !== undefined ? { relleno } : {}), a });
    return a;
  };
  for (const p of e.primitivas) {
    switch (p.tipo) {
      case "poligono": {
        capa(p.estilo, "area", p.relleno).poligono(p.anillos);
        break;
      }
      case "region": {
        const a = capa(p.estilo, "region", p.relleno);
        for (const r of p.anillos) a.anillo(r, true);
        break;
      }
      case "linea":
        capa(p.estilo, "trazo", undefined).linea(p.puntos);
        if (p.rotulo) lineasRotuladas.push({ puntos: p.puntos, texto: p.rotulo });
        break;
      case "marca":
      case "flecha":
        glifos.push(p);
        break;
      case "texto":
        textos.push(p);
        break;
    }
  }
  return {
    titulo: e.titulo,
    cabecera: e.cabecera,
    origen,
    capas: capas.map(({ a, ...c }) => ({ ...c, abanicos: new Float32Array(a.abanicos), segmentos: new Float32Array(a.segmentos), caja: a.caja })),
    glifos,
    textos,
    lineasRotuladas,
    leyenda: e.leyenda,
    ...(e.tituloLeyenda ? { tituloLeyenda: e.tituloLeyenda } : {}),
    notas: e.notas,
    extremos: e.extremos,
    caja: e.caja,
    ...(e.mapa ? { mapa: e.mapa } : {}),
  };
}

// ─── Elegir con el ratón ────────────────────────────────────────────────────────────────────────

function distanciaSegmento(q: Vec2, a: Vec2, b: Vec2): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
}

function areaAbs(r: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]![0] - r[i]![0]) * (r[j]![1] + r[i]![1]);
  return Math.abs(a / 2);
}

/** Dentro de un polígono con huecos (par-impar). */
const dentroAnillos = (q: Vec2, anillos: readonly (readonly Vec2[])[]) => anillos.reduce((c, r) => (dentro(q, r) ? !c : c), false);

/** Lo que se resalta de unos objetos: sus formas como capas (relleno y trazo) y sus glifos. */
export interface Eleccion {
  /** El primero de `objetos` (el principal). */
  objeto: string;
  objetos: string[];
  origen: Vec2;
  /** Abanicos de sus polígonos y segmentos de sus contornos y líneas, respecto al origen. */
  abanicos: Float32Array;
  segmentos: Float32Array;
  caja: Caja;
  /** Dónde están sus glifos (m). */
  puntos: Vec2[];
}

/**
 * El objeto de la escena bajo el punto q (m), con una tolerancia de `radio` m para las líneas y los
 * glifos. Gana lo más pequeño: un glifo o una línea cercanos antes que un polígono, y de los
 * polígonos que lo contienen, el de menor área (un pilar antes que la losa que lo rodea). Las
 * rectas de los ejes de replanteo y de los niveles pasan por todo, así que van detrás de todo
 * (sus burbujas, no).
 */
export function objetoEn(e: Escena, q: Vec2, radio: number): string | null {
  let mejor: { objeto: string; prioridad: number; medida: number } | null = null;
  const proponer = (objeto: string | undefined, prioridad: number, medida: number) => {
    if (!objeto) return;
    if (!mejor || prioridad > mejor.prioridad || (prioridad === mejor.prioridad && medida < mejor.medida)) mejor = { objeto, prioridad, medida };
  };
  for (const p of e.primitivas) {
    switch (p.tipo) {
      case "marca":
      case "flecha": {
        const d = Math.hypot(q[0] - p.p[0], q[1] - p.p[1]);
        if (d <= radio) proponer(p.objeto, 3, d);
        break;
      }
      case "linea":
        for (let i = 1; i < p.puntos.length; i++) {
          const d = distanciaSegmento(q, p.puntos[i - 1]!, p.puntos[i]!);
          if (d <= radio) proponer(p.objeto, p.estilo === "eje" || p.estilo === "nivel" ? 0 : 2, d);
        }
        break;
      case "poligono":
        if (dentroAnillos(q, p.anillos)) proponer(p.objeto, 1, areaAbs(p.anillos[0]!));
        break;
      default:
        break;
    }
  }
  return mejor ? (mejor as { objeto: string }).objeto : null;
}

/** El objeto bajo un punto, ya resaltado (null si no hay ninguno). */
export function elegir(e: Escena, q: Vec2, radio: number): Eleccion | null {
  const o = objetoEn(e, q, radio);
  return o ? resaltar(e, [o]) : null;
}

/** Todo lo que la escena dibuja de unos objetos, para resaltarlo (null si no dibuja ninguno). */
export function resaltar(e: Escena, objetos: readonly string[]): Eleccion | null {
  const ids = new Set(objetos);
  const origen = origenDe(e);
  const a = new Acumulador(origen);
  const puntos: Vec2[] = [];
  const vistos = new Set<string>();
  for (const p of e.primitivas) {
    if (!("objeto" in p) || p.objeto === undefined || !ids.has(p.objeto)) continue;
    vistos.add(p.objeto);
    if (p.tipo === "poligono") a.poligono(p.anillos);
    else if (p.tipo === "linea") a.linea(p.puntos);
    else if (p.tipo === "marca" || p.tipo === "flecha") puntos.push(p.p);
  }
  const presentes = objetos.filter((o) => vistos.has(o));
  if (!presentes.length) return null;
  return { objeto: presentes[0]!, objetos: presentes, origen, abanicos: new Float32Array(a.abanicos), segmentos: new Float32Array(a.segmentos), caja: a.caja, puntos };
}

// ─── Elegir por ventana ─────────────────────────────────────────────────────────────────────────

/** ¿Corta el segmento ab el rectángulo? */
function segmentoToca(a: Vec2, b: Vec2, c: Caja): boolean {
  const en = (q: Vec2) => q[0] >= c[0] && q[0] <= c[2] && q[1] >= c[1] && q[1] <= c[3];
  if (en(a) || en(b)) return true;
  // Liang–Barsky
  let [t0, t1] = [0, 1];
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  for (const [p, q] of [
    [-d[0], a[0] - c[0]],
    [d[0], c[2] - a[0]],
    [-d[1], a[1] - c[1]],
    [d[1], c[3] - a[1]],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Los objetos de una ventana (m): con «dentro», los que tienen todo lo dibujado dentro de ella (de
 * izquierda a derecha, como CYPECAD y AutoCAD); con «toca», los que tienen algo dentro o la cortan
 * (de derecha a izquierda). En el orden de la escena.
 */
export function elegirVentana(e: Escena, c: Caja, modo: "dentro" | "toca"): string[] {
  const en = (q: Vec2) => q[0] >= c[0] && q[0] <= c[2] && q[1] >= c[1] && q[1] <= c[3];
  const estado = new Map<string, boolean>();
  const orden: string[] = [];
  const marcar = (o: string, v: boolean) => {
    if (!estado.has(o)) orden.push(o);
    estado.set(o, modo === "dentro" ? (estado.get(o) ?? true) && v : (estado.get(o) ?? false) || v);
  };
  const esquinas: Vec2[] = [
    [c[0], c[1]],
    [c[2], c[1]],
    [c[2], c[3]],
    [c[0], c[3]],
  ];
  for (const p of e.primitivas) {
    if (!("objeto" in p) || p.objeto === undefined || p.tipo === "texto") continue;
    if (p.tipo === "marca" || p.tipo === "flecha") {
      marcar(p.objeto, en(p.p));
      continue;
    }
    const anillos = p.tipo === "linea" ? [p.puntos] : p.anillos;
    if (modo === "dentro") marcar(p.objeto, anillos.every((r) => r.every(en)));
    else {
      let toca = false;
      for (const r of anillos) {
        const n = p.tipo === "linea" ? r.length - 1 : r.length;
        for (let i = 0; i < n && !toca; i++) toca = segmentoToca(r[i]!, r[(i + 1) % r.length]!, c);
      }
      // La ventana entera dentro de un polígono también lo toca
      if (!toca && p.tipo !== "linea") toca = esquinas.some((q) => dentroAnillos(q, p.anillos));
      marcar(p.objeto, toca);
    }
  }
  return orden.filter((o) => estado.get(o));
}
