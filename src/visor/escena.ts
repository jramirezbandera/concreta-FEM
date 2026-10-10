/**
 * Escena preparada para el visor (V1, `docs/fem3d/visor.md` §3.1): la misma escena de A4
 * (`agente/render/escena.ts`), con las formas agrupadas en trazados SVG en coordenadas del modelo
 * para que el hilo principal sólo inserte unos pocos `<path>`. El orden de dibujo se conserva: se
 * agrupan las primitivas seguidas con el mismo estilo y relleno, nunca se reordenan.
 *
 * Los textos, las marcas y las flechas tienen tamaño en píxeles, así que pasan tal cual: el visor
 * los coloca en pantalla en cada encuadre. Elegir un objeto con el ratón y su resaltado se resuelven
 * aquí, sobre las primitivas exactas de la escena.
 *
 * Puro: sin IO.
 */
import { dentro, type Escena, type Estilo, type Primitiva, type Texto, type Vec2 } from "../agente/render/escena.ts";

/** Una capa: primitivas seguidas con el mismo estilo, relleno y forma, en un solo trazado. */
export interface Capa {
  estilo: Estilo;
  /** «area»: polígonos par-impar; «region»: bandas de isovalores (nonzero); «trazo»: líneas abiertas. */
  forma: "area" | "region" | "trazo";
  relleno?: string;
  /** Trazado en m, con Y hacia arriba (el visor lo voltea). */
  d: string;
}

export type Glifo = Extract<Primitiva, { tipo: "marca" } | { tipo: "flecha" }>;

export interface EscenaPreparada {
  titulo: string;
  cabecera: string[];
  capas: Capa[];
  glifos: Glifo[];
  textos: Texto[];
  leyenda: Escena["leyenda"];
  notas: string[];
  extremos: Escena["extremos"];
  caja: Escena["caja"];
}

/** Coordenada en m con 0,1 mm, sin ceros de más. */
export function coord(v: number): string {
  const r = Math.round(v * 1e4) / 1e4;
  return Object.is(r, -0) ? "0" : String(r);
}

/** Trazado SVG de unos anillos cerrados (o de una línea abierta). */
export function trazado(anillos: readonly (readonly Vec2[])[], cerrado: boolean): string {
  let d = "";
  for (const r of anillos) {
    if (!r.length) continue;
    d += `M${coord(r[0]![0])} ${coord(r[0]![1])}`;
    for (let i = 1; i < r.length; i++) d += `L${coord(r[i]![0])} ${coord(r[i]![1])}`;
    if (cerrado) d += "Z";
  }
  return d;
}

export function prepararEscena(e: Escena): EscenaPreparada {
  const capas: Capa[] = [];
  const glifos: Glifo[] = [];
  const textos: Texto[] = [];
  const anadir = (estilo: Estilo, forma: Capa["forma"], relleno: string | undefined, d: string) => {
    const ult = capas[capas.length - 1];
    if (ult && ult.estilo === estilo && ult.forma === forma && ult.relleno === relleno) ult.d += d;
    else capas.push({ estilo, forma, ...(relleno !== undefined ? { relleno } : {}), d });
  };
  for (const p of e.primitivas) {
    switch (p.tipo) {
      case "poligono":
        anadir(p.estilo, "area", p.relleno, trazado(p.anillos, true));
        break;
      case "region":
        anadir(p.estilo, "region", p.relleno, trazado(p.anillos, true));
        break;
      case "linea":
        anadir(p.estilo, "trazo", undefined, trazado([p.puntos], false));
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
  return { titulo: e.titulo, cabecera: e.cabecera, capas, glifos, textos, leyenda: e.leyenda, notas: e.notas, extremos: e.extremos, caja: e.caja };
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

export interface Eleccion {
  objeto: string;
  /** Trazados de todo lo que la escena dibuja de ese objeto: áreas (m) y glifos (puntos). */
  areas: string;
  trazos: string;
  puntos: Vec2[];
}

/**
 * El objeto de la escena bajo el punto q (m), con una tolerancia de `radio` m para las líneas y los
 * glifos. Gana lo más pequeño: un glifo o una línea cercanos antes que un polígono, y de los
 * polígonos que lo contienen, el de menor área (un pilar antes que la losa que lo rodea).
 */
export function elegir(e: Escena, q: Vec2, radio: number): Eleccion | null {
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
          if (d <= radio) proponer(p.objeto, 2, d);
        }
        break;
      case "poligono":
        if (dentroAnillos(q, p.anillos)) proponer(p.objeto, 1, areaAbs(p.anillos[0]!));
        break;
      default:
        break;
    }
  }
  if (!mejor) return null;
  return resaltar(e, (mejor as { objeto: string }).objeto);
}

/** Todo lo que la escena dibuja de un objeto, para resaltarlo. */
export function resaltar(e: Escena, objeto: string): Eleccion | null {
  let areas = "";
  let trazos = "";
  const puntos: Vec2[] = [];
  for (const p of e.primitivas) {
    if (!("objeto" in p) || p.objeto !== objeto) continue;
    if (p.tipo === "poligono") areas += trazado(p.anillos, true);
    else if (p.tipo === "linea") trazos += trazado([p.puntos], false);
    else if (p.tipo === "marca" || p.tipo === "flecha") puntos.push(p.p);
  }
  return areas || trazos || puntos.length ? { objeto, areas, trazos, puntos } : null;
}
