/**
 * Fase CO4 (`docs/fem3d/comprobaciones.md` §8.7): las demandas de punzonamiento.
 *
 * Una por cada pilar y planta en la que el pilar se une a una losa maciza o reticular (también a una
 * de cimentación). De cada una:
 *  - **lo que la losa pasa al pilar** en cada combinación de ELU (`Consultas.punzonamiento`, CO-i):
 *    la fuerza vertical y los dos momentos que le da por su huella, respecto al nudo del pilar. Lo
 *    que le llega por las vigas no cuenta: es el cortante de la viga (CO2); lo de las vigas planas se
 *    da aparte, como información. Todas las combinaciones (H31): manda el mayor β·VEd, no el β mayor
 *    con el VEd mayor. Con el sismo del programa, la parte estática y la amplitud de cada componente
 *    (VS-o);
 *  - **el área cargada:** la sección del tramo de debajo de la losa (el que la sostiene) y la del de
 *    encima (el que carga sobre ella: un pilar apeado, una losa de cimentación), con su centro y sus
 *    ejes en planta;
 *  - **los bordes:** la distancia libre de cada cara del área al borde exterior del forjado (el
 *    contorno de las losas de la planta más el ancho de sus vigas y sus tiras de borde, que también
 *    son hormigón del forjado), por rayos normales a la cara; y, en un reticular, al
 *    borde de su ábaco. Los huecos van aparte: quitan del perímetro crítico lo que queda entre sus
 *    tangentes desde el centro del área (CE A19 §6.4.2(3)).
 *
 * La posición (interior, borde o esquina) y el perímetro dependen del canto útil, que sale del armado:
 * los decide la comprobación (`comprobar/punzonamiento.ts`).
 *
 * Sólo se lee por `Consultas`, sin ver vectores por caso ni factores.
 */
import { conjuntoCombinaciones } from "../../agente/combinaciones.ts";
import type { Consultas, Respuesta } from "../../compilador/consultas.ts";
import type { Material, Pilar, Vec2 } from "../../compilador/fisico.ts";
import { ejesArmado } from "../../compilador/franjas.ts";
import { huellaPilar } from "../../compilador/geometria2d.ts";
import { puntoEnPoligono } from "../../compilador/poligonos.ts";
import { ejeSeccion } from "../../compilador/puntoFijo.ts";
import type { Diagnostico } from "../../motor/diagnosticos.ts";
import { SITUACIONES_ELU } from "./pilares.ts";

/** Diferencia entre los rayos de una cara (m) a partir de la que el borde no es paralelo a ella. */
export const TOLERANCIA_OBLICUO = 0.05;

export type FormaArea = { tipo: "rectangulo"; h: number; b: number } | { tipo: "circulo"; D: number };

export interface CaraArea {
  /** Distancia libre de la cara al borde exterior del forjado, m (negativa si la cara queda fuera). */
  distancia: number;
  /** Los rayos de la cara no dan lo mismo: el borde no es paralelo a ella. */
  oblicuo: boolean;
}

export interface AreaCargada {
  seccion: string;
  /** El tramo del pilar: el de debajo de la losa o el de encima. */
  tramo: "inferior" | "superior";
  /** Centro y ejes en planta: ez según el canto h y ey según el ancho b. */
  c: Vec2;
  ez: Vec2;
  ey: Vec2;
  /** null: ni rectangular ni circular (no se comprueba). m. */
  forma: FormaArea | null;
  /** Las cuatro caras, en el orden [+ez, −ez, +ey, −ey] (en un círculo, las del cuadrado que lo envuelve). */
  caras: [CaraArea, CaraArea, CaraArea, CaraArea];
  /** En un reticular: la distancia de cada cara al borde de su ábaco, m; null si el centro no cae en ninguno. */
  abaco: [number, number, number, number] | null;
  /** El centro cae dentro del contorno de alguna losa de la planta. */
  dentro: boolean;
}

export interface ComboPunzonamiento {
  nombre: string;
  /** Parte estática de lo que la losa pasa al pilar, respecto a su nudo: Fz (kN; negativa, la losa cuelga del pilar) y Mx, My (kN·m), en ejes globales. */
  Fz: number;
  Mx: number;
  My: number;
  /** Con el sismo del programa: la amplitud de cada una (≥ 0). */
  aFz: number;
  aMx: number;
  aMy: number;
  /** Como información: la Fz estática que le pasan las vigas planas (no cuenta). */
  FzVigasPlanas: number;
}

export interface DemandaPunzonamiento {
  pilar: string;
  planta: string;
  losa: string;
  /** Canto total de la losa, m. */
  espesor: number;
  material: Material;
  reticular: boolean;
  cimentacion: boolean;
  /** Los ejes de las armaduras de la losa (X: 1, Y: 2), para saber qué refuerzos cubren al pilar. */
  ejes: ReturnType<typeof ejesArmado>;
  /** El nudo del pilar en planta: a él van referidos los momentos. */
  punto: Vec2;
  areas: { inferior?: AreaCargada; superior?: AreaCargada };
  /** Los contornos de las losas de la planta (con el ancho de sus vigas y sus tiras de borde) y sus huecos. */
  contornos: (readonly Vec2[])[];
  huecos: (readonly Vec2[])[];
  /** Las vigas planas que le llegan y las demás: lo que le pasan no cuenta (es el cortante de la viga). */
  vigasPlanas: string[];
  vigas: string[];
  combos: ComboPunzonamiento[];
}

export interface DemandasPunzonamiento {
  demandas: DemandaPunzonamiento[];
  /** Combinaciones de ELU. */
  combinaciones: number;
}

/**
 * Por dónde sale del forjado un rayo desde `o` según `u` (unitario): la distancia al primer tramo que
 * queda fuera de todos los polígonos; Infinity si no sale (no pasa con polígonos acotados) y 0 si ya
 * empieza fuera.
 */
export function salida(o: Vec2, u: Vec2, poligonos: readonly (readonly Vec2[])[]): number {
  const cortes: number[] = [];
  for (const p of poligonos)
    for (let i = 0; i < p.length; i++) {
      const a = p[i]!;
      const b = p[(i + 1) % p.length]!;
      const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
      const den = u[0] * ey - u[1] * ex;
      if (Math.abs(den) < 1e-14) continue;
      const [dx, dy] = [a[0] - o[0], a[1] - o[1]];
      const s = (dx * ey - dy * ex) / den;
      const t = (dx * u[1] - dy * u[0]) / den;
      if (s > 1e-9 && t >= -1e-12 && t <= 1 + 1e-12) cortes.push(s);
    }
  cortes.sort((x, y) => x - y);
  const dentro = (s: number) => poligonos.some((p) => puntoEnPoligono([o[0] + s * u[0], o[1] + s * u[1]], p));
  let desde = 0;
  for (const s of cortes) {
    if (s - desde > 1e-9 && !dentro((desde + s) / 2)) return desde;
    desde = Math.max(desde, s);
  }
  return dentro(desde + 1e-6) ? Infinity : desde;
}

/** El punto, si está dentro de algún polígono; si no, el primero de los que están a 1 mm de él (según u y v) que lo esté; null si ninguno. */
function dentroCerca(o: Vec2, u: Vec2, v: Vec2, poligonos: readonly (readonly Vec2[])[]): Vec2 | null {
  for (const [a, b] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const p: Vec2 = [o[0] + 1e-3 * (a * u[0] + b * v[0]), o[1] + 1e-3 * (a * u[1] + b * v[1])];
    if (poligonos.some((x) => puntoEnPoligono(p, x))) return p;
  }
  return null;
}

/** La distancia libre de cada cara de un área a la salida de unos polígonos, por tres rayos normales a ella. */
function distanciasCaras(c: Vec2, ez: Vec2, ey: Vec2, h: number, b: number, poligonos: readonly (readonly Vec2[])[]): [CaraArea, CaraArea, CaraArea, CaraArea] {
  const cara = (n: Vec2, t: Vec2, media: number, semiancho: number): CaraArea => {
    const ds: number[] = [];
    for (const f of [-0.5, 0, 0.5]) {
      const o: Vec2 = [c[0] + f * semiancho * t[0], c[1] + f * semiancho * t[1]];
      // (un punto justo en el borde, que es donde cae el eje de un pilar con la losa dibujada por los ejes, sale desde 1 mm más adentro)
      const desde = dentroCerca(o, n, t, poligonos);
      if (!desde) continue;
      ds.push(salida(desde, n, poligonos) + (desde[0] - o[0]) * n[0] + (desde[1] - o[1]) * n[1] - media);
    }
    if (!ds.length) return { distancia: -media, oblicuo: false };
    const [mn, mx] = [Math.min(...ds), Math.max(...ds)];
    return { distancia: mn, oblicuo: Number.isFinite(mn) && !(mx - mn <= TOLERANCIA_OBLICUO) };
  };
  const menos = (v: Vec2): Vec2 => [-v[0], -v[1]];
  return [cara(ez, ey, h / 2, b / 2), cara(menos(ez), ey, h / 2, b / 2), cara(ey, ez, b / 2, h / 2), cara(menos(ey), ez, b / 2, h / 2)];
}

/** Un área cargada de centro c y giro dado (grados desde +X, el del canto h), con sus distancias a los bordes del forjado y de su ábaco. */
export function areaCargada(c: Vec2, giro: number, forma: FormaArea | null, seccion: string, tramo: "inferior" | "superior", contornos: readonly (readonly Vec2[])[], abacos: readonly (readonly Vec2[])[] | null): AreaCargada {
  const { ez, ey } = huellaPilar(c[0], c[1], giro, null);
  const [h, b] = forma ? (forma.tipo === "circulo" ? [forma.D, forma.D] : [forma.h, forma.b]) : [0, 0];
  const suyo = abacos?.find((a) => puntoEnPoligono(c, a));
  const enAbaco = suyo ? distanciasCaras(c, ez, ey, h, b, [suyo]) : null;
  return {
    seccion,
    tramo,
    c,
    ez,
    ey,
    forma,
    caras: distanciasCaras(c, ez, ey, h, b, contornos),
    abaco: enAbaco ? [enAbaco[0].distancia, enAbaco[1].distancia, enAbaco[2].distancia, enAbaco[3].distancia] : null,
    // (un centro justo en el borde cuenta como dentro)
    dentro: dentroCerca(c, ez, ey, contornos) !== null,
  };
}

function area(q: Consultas, p: Pilar, seccion: string, tramo: "inferior" | "superior", contornos: readonly (readonly Vec2[])[], abacos: readonly (readonly Vec2[])[] | null): AreaCargada {
  const sc = q.fisico.secciones.find((s) => s.id === seccion);
  const forma: FormaArea | null = sc?.forma === "rectangular" ? { tipo: "rectangulo", h: sc.h, b: sc.b } : sc?.forma === "circular" ? { tipo: "circulo", D: sc.D } : null;
  return areaCargada(ejeSeccion(p, sc), p.giro ?? 0, forma, seccion, tramo, contornos, abacos);
}

const seccionEn = (p: Pilar, planta: string): string => p.tramos?.find((t) => t.planta === planta)?.seccion ?? p.seccion;

/** Las demandas de punzonamiento de los pilares dados (por defecto, todos). */
export function demandasPunzonamiento(q: Consultas, ids?: readonly string[]): Respuesta<DemandasPunzonamiento> {
  const elu = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: [...SITUACIONES_ELU] });
  if (!elu.valido) return elu;
  const diagnosticos: Diagnostico[] = [...elu.diagnosticos];
  const plantas = q.fisico.plantas;
  const orden = new Map(plantas.map((x, i) => [x.id, i]));
  const pilares = q.fisico.pilares ?? [];
  for (const id of ids ?? []) if (!pilares.some((p) => p.id === id)) return { valido: false, diagnosticos: [{ codigo: "consulta/no-existe", severidad: "error", mensaje: `El pilar «${id}» no existe en el modelo.`, ids: [id] }] };
  const losas = q.fisico.losas ?? [];
  const demandas: DemandaPunzonamiento[] = [];
  for (const p of pilares) {
    if (ids?.length && !ids.includes(p.id)) continue;
    // Las plantas van de arriba abajo: el pilar va de `desde` (abajo) a `hasta` (arriba)
    const [arriba, abajo] = [orden.get(p.hasta), orden.get(p.desde)];
    if (arriba === undefined || abajo === undefined) continue;
    for (let k = arriba; k <= abajo; k++) {
      const planta = plantas[k]!.id;
      const t = q.transmitidoPilar(p.id, planta);
      if (!t.valido) return t;
      if (!t.valor) continue;
      const losa = losas.find((l) => l.id === t.valor!.losa);
      if (!losa) continue;
      const material = q.fisico.materiales.find((m) => m.id === losa.material);
      if (!material) continue;
      const r = q.punzonamiento(p.id, planta, elu.valor.factores);
      if (!r.valido) return r;
      const dePlanta = losas.filter((l) => l.planta === planta);
      const contornos: (readonly Vec2[])[] = [...dePlanta.map((l) => l.contorno), ...(q.mapeo.anchos ?? []).filter((x) => x.planta === planta).map((x) => x.poligono)];
      const huecos = dePlanta.flatMap((l) => l.huecos ?? []);
      const areas: DemandaPunzonamiento["areas"] = {};
      if (k < abajo) areas.inferior = area(q, p, seccionEn(p, planta), "inferior", contornos, t.valor.abacos);
      if (k > arriba) areas.superior = area(q, p, seccionEn(p, plantas[k - 1]!.id), "superior", contornos, t.valor.abacos);
      demandas.push({
        pilar: p.id,
        planta,
        losa: losa.id,
        espesor: losa.espesor,
        material,
        reticular: losa.reticular !== undefined,
        cimentacion: losa.cimentacion !== undefined,
        ejes: ejesArmado(losa),
        punto: [t.valor.punto[0], t.valor.punto[1]],
        areas,
        contornos,
        huecos,
        vigasPlanas: t.valor.vigasPlanas,
        vigas: t.valor.vigas,
        combos: (r.valor ?? []).map((x, i) => ({
          nombre: elu.valor.nombres[i]!,
          Fz: x.estatica[0]!,
          Mx: x.estatica[1]!,
          My: x.estatica[2]!,
          aFz: x.sismo[0]!,
          aMx: x.sismo[1]!,
          aMy: x.sismo[2]!,
          FzVigasPlanas: x.estatica[3]!,
        })),
      });
    }
  }
  return { valido: true, valor: { demandas, combinaciones: elu.valor.factores.length }, diagnosticos };
}
