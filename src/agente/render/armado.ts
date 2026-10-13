/**
 * Vistas `armado-x-inf`, `armado-x-sup`, `armado-y-inf` y `armado-y-sup` de una planta (fase F,
 * `docs/fem3d/franjas.md` §2.5; fase AB, `armado.md` §2): las franjas de armado de sus losas en una
 * dirección, coloreadas por tramos según la demanda de Wood–Armer de su armadura inferior o superior
 * (kN·m/m), que es la de «fem consultar franja» bit a bit.
 *
 * - X es la dirección 1 de cada losa (su eje 1) e Y, la 2 (la perpendicular).
 * - Cada estación colorea su tramo de la franja (`refuerzos.ts`).
 * - Inferior en rojos y superior en azules, con la escala de los mapas (`limitesMapa`).
 * - La leyenda lleva su título con la unidad (AB, §2.1).
 * - Sin base: se rotulan los picos de cada franja (prominencia ≥ 5 % del mayor de la planta, AB-a).
 * - Con la base del proyecto (§2.6) y `soloExceso`: lo cubierto, en gris; lo demás, por la demanda
 *   total desde la base; cada zona de refuerzo, con su contorno y su máximo rotulado con el exceso.
 *   Sin `soloExceso`, el mapa entero con los picos, y el contorno de las zonas encima.
 *
 * Puro: sin IO.
 */
import type { ArmadoProyecto } from "../armaduraBase.ts";
import { baseDe, hayBase } from "../armaduraBase.ts";
import type { ConjuntoCombinaciones } from "../combinaciones.ts";
import type { Vec2 } from "../../compilador/fisico.ts";
import { ARMADURAS, caraDe, franjasTramos, losasDe, picos, PROMINENCIA_PICOS, zonasRefuerzo, type Armadura, type FranjaTramos, type TramoArmado, type ZonaRefuerzo } from "../refuerzos.ts";
import { rotulo, type EntradaLeyenda, type Escena, type ExtremoRotulado, type Primitiva } from "./escena.ts";
import { coloresBandas, limitesMapa, type EscalaMapa, type LimitesMapa } from "./isovalores.ts";
import { capaEjes } from "./ejes.ts";
import { fondoModelo, PlantaFisica, type DatosVista } from "./modelo.ts";
import { cabecera, caja, trazoModelo, type ResultadosRender } from "./resultados.ts";

export { ARMADURAS, type Armadura, type TramoArmado };
export const VISTAS_ARMADO = ARMADURAS.map((a) => `armado-${a}` as const);

const NOMBRE: Record<Armadura, string> = {
  "x-inf": "armadura inferior en X (dirección 1 de cada losa)",
  "x-sup": "armadura superior en X (dirección 1 de cada losa)",
  "y-inf": "armadura inferior en Y (dirección 2 de cada losa)",
  "y-sup": "armadura superior en Y (dirección 2 de cada losa)",
};

/** El nombre corto de una armadura («X inferior»). */
export const NOMBRE_CORTO: Record<Armadura, string> = { "x-inf": "X inferior", "x-sup": "X superior", "y-inf": "Y inferior", "y-sup": "Y superior" };
export const UNIDAD_ARMADO = "kN·m/m";
/** El exceso sobre la base de un rótulo, con un decimal: «+4,5». */
export const textoExceso = (x: number): string => `+${(Math.round(x * 10) / 10).toFixed(1).replace(".", ",")}`;

/** El título de la leyenda de una armadura (AB, §2.1). */
export const tituloArmado = (a: Armadura): string => `${NOMBRE_CORTO[a]} · M_Ed (Wood–Armer) · ${UNIDAD_ARMADO}`;

/** Los tramos de las franjas de la planta en una armadura, con su demanda (de «fem consultar franja»). */
export function tramosArmado(r: ResultadosRender, planta: string, armadura: Armadura, conjunto: ConjuntoCombinaciones): { tramos: TramoArmado[]; franjas: number } {
  const fs = franjasTramos(r.q, losasDe(r.q, { planta }), armadura, conjunto);
  if (!fs.valido) return { tramos: [], franjas: 0 };
  return { tramos: fs.valor.flatMap((f) => f.tramos), franjas: fs.valor.length };
}

export interface OpcionesArmado {
  escala?: EscalaMapa;
  /** La armadura base del proyecto (AB, §2.5). */
  armado?: ArmadoProyecto;
  /** Con base, sólo lo que no cubre (AB-g; por defecto, sí). */
  soloExceso?: boolean;
  /** Los tramos de la planta ya calculados (`franjasTramos`), para no repetirlos (el visor los guarda). */
  franjas?: FranjaTramos[];
}

/** Lo que dibuja el mapa de armado de una planta: tramos, zonas y la escala; lo comparten la planta y el 3D. */
export interface MapaArmado {
  franjas: FranjaTramos[];
  zonas: ZonaRefuerzo[];
  /** Los tramos que se colorean (los demás, cubiertos por la base) y su banda. */
  coloreados: { t: TramoArmado; banda: number }[];
  cubiertos: TramoArmado[];
  limites: LimitesMapa | null;
  colores: string[];
  leyenda: EntradaLeyenda[];
  notas: string[];
  /** Con base y `soloExceso`. */
  conBase: boolean;
  vmax: number;
}

/**
 * Tramos, zonas, límites y colores de unas franjas (las de una planta, o las de todas para el 3D, con
 * una escala común).
 */
export function mapaArmado(fs: FranjaTramos[], armadura: Armadura, op: OpcionesArmado = {}): MapaArmado {
  const superior = caraDe(armadura) === "superior";
  const armado = op.armado;
  const conBase = hayBase(armado, armadura) && op.soloExceso !== false;
  const base = (losa: string) => baseDe(armado, losa, armadura);
  const notas: string[] = [];
  const leyenda: EntradaLeyenda[] = [];
  const tramos = fs.flatMap((f) => f.tramos);
  const losas = [...new Set(fs.map((f) => f.franja.losa))];
  const zonas = hayBase(armado, armadura) ? losas.filter((l) => base(l) !== null).flatMap((l) => zonasRefuerzo(l, armadura, base(l)!, fs)) : [];
  const cubierto = (t: TramoArmado) => conBase && base(t.losa) !== null && !(t.v > base(t.losa)!);
  const cubiertos = tramos.filter(cubierto);
  const visibles = tramos.filter((t) => !cubierto(t));
  const vmax = Math.max(0, ...tramos.map((t) => t.v));
  let limites: LimitesMapa | null = null;
  let colores: string[] = [];
  const coloreados: { t: TramoArmado; banda: number }[] = [];
  if (visibles.length) {
    // Con base, las bandas empiezan en la menor base de lo que se colorea (0 en las losas sin base)
    const desde = conBase ? Math.min(...visibles.map((t) => base(t.losa) ?? 0)) : 0;
    const hasta = Math.max(...visibles.map((t) => t.v));
    const sup = hasta > desde ? hasta : desde + 1;
    let lm = limitesMapa(desde, sup, op.escala ?? {});
    if ("error" in lm) {
      notas.push(`Escala no válida (${lm.error}): se dibuja la completa.`);
      lm = limitesMapa(desde, sup) as LimitesMapa;
    }
    limites = lm;
    const { L, fueraAbajo, fueraArriba } = lm;
    const nb = L.length - 1;
    // Superior en azules: los colores de los límites cambiados de signo, en el mismo orden
    colores = superior ? coloresBandas(L.map((x) => -x).reverse(), { abajo: fueraArriba, arriba: fueraAbajo }).reverse() : coloresBandas(L, { abajo: fueraAbajo, arriba: fueraArriba });
    const banda = (v: number) => {
      for (let b = 0; b < nb; b++) if (v <= L[b + 1]! || b === nb - 1) return b;
      return nb - 1;
    };
    for (const t of visibles) coloreados.push({ t, banda: banda(t.v) });
    for (let b = nb - 1; b >= 0; b--) {
      const texto = fueraArriba && b === nb - 1 ? `más de ${rotulo(L[b]!, 4)} (fuera de la escala)` : fueraAbajo && b === 0 ? `menos de ${rotulo(L[1]!, 4)} (fuera de la escala)` : `${rotulo(L[b]!, 4)} a ${rotulo(L[b + 1]!, 4)}`;
      leyenda.push({ relleno: colores[b]!, texto });
    }
  }
  if (conBase) {
    const bs = [...new Set(losas.map(base).filter((x): x is number => x !== null))].sort((a, b) => a - b);
    const que = bs.length === 1 ? `≤ ${rotulo(bs[0]!, 4)}` : `≤ su base, de ${rotulo(bs[0]!, 4)} a ${rotulo(bs[bs.length - 1]!, 4)}`;
    leyenda.push({ estilo: "armado-cubierto", texto: `cubierto por la base (${que})` });
    if (zonas.length) leyenda.push({ estilo: "zona-refuerzo", texto: "zona de refuerzo" });
    notas.push(`Lo que supera la base, por la demanda total; rotulado, el máximo de cada zona de refuerzo con el exceso entre paréntesis (${zonas.length} zonas).`);
    const sin = losas.filter((l) => base(l) === null);
    if (sin.length) notas.push(`Sin base (el mapa entero): ${sin.join(", ")}.`);
  } else {
    if (zonas.length) leyenda.push({ estilo: "zona-refuerzo", texto: "zona de refuerzo (supera la base)" });
    notas.push("Rotulados: los picos de cada franja (prominencia ≥ 5 % del mayor de la planta). Acerque para ver más.");
  }
  return { franjas: fs, zonas, coloreados, cubiertos, limites, colores, leyenda, notas, conBase, vmax };
}

export function vistaArmado(r: ResultadosRender, planta: string, armadura: Armadura, conjunto: ConjuntoCombinaciones, d: DatosVista, op: OpcionesArmado = {}): Escena {
  const pl = new PlantaFisica(r.q.fisico, planta);
  const P: Primitiva[] = [...fondoModelo(pl, { atenuado: true }).primitivas];
  const fs = op.franjas ? { valido: true as const, valor: op.franjas } : franjasTramos(r.q, losasDe(r.q, { planta }), armadura, conjunto);
  const m = mapaArmado(fs.valido ? fs.valor : [], armadura, op);
  const superior = caraDe(armadura) === "superior";
  const notas: string[] = [...m.notas];
  const u = UNIDAD_ARMADO;
  // Los tramos seguidos de una franja en la misma banda, en un solo rectángulo, y los de cada banda
  // en una sola región con un anillo por rectángulo (no se solapan): el mismo dibujo con una región
  // por banda, como los mapas, en vez de miles
  const porBanda = new Map<number, Vec2[][]>();
  const cs = m.coloreados;
  for (let i = 0; i < cs.length; ) {
    const { t, banda: b } = cs[i]!;
    let j = i + 1;
    while (j < cs.length && cs[j]!.t.franja === t.franja && cs[j]!.banda === b && cs[j]!.t.a === cs[j - 1]!.t.b) j++;
    const w = cs[j - 1]!.t;
    const anillos = porBanda.get(b) ?? [];
    anillos.push([t.rectangulo[0]!, w.rectangulo[1]!, w.rectangulo[2]!, t.rectangulo[3]!]);
    porBanda.set(b, anillos);
    i = j;
  }
  // Lo cubierto, por corridas de tramos seguidos de cada franja, un polígono de un anillo por corrida
  // (uno con miles de anillos se orienta en tiempo cuadrático)
  const cu = m.cubiertos;
  for (let i = 0; i < cu.length; ) {
    let j = i + 1;
    while (j < cu.length && cu[j]!.franja === cu[i]!.franja && cu[j]!.a === cu[j - 1]!.b) j++;
    const [a, b] = [cu[i]!, cu[j - 1]!];
    P.push({ tipo: "poligono", anillos: [[a.rectangulo[0]!, b.rectangulo[1]!, b.rectangulo[2]!, a.rectangulo[3]!]], estilo: "armado-cubierto" });
    i = j;
  }
  for (const [b, anillos] of [...porBanda].sort((x, y) => x[0] - y[0])) P.push({ tipo: "region", anillos, estilo: "isobanda", relleno: m.colores[b]!, banda: b });
  P.push(...trazoModelo(pl));
  for (const z of m.zonas) for (const [a, b] of z.contorno) P.push({ tipo: "linea", puntos: [a, b], estilo: "zona-refuerzo", objeto: z.id });
  const ejes = capaEjes(pl.f, { cotas: false });
  P.push(...ejes.primitivas);
  notas.push(...ejes.notas);
  // Rótulos: con base, el máximo de cada zona con su exceso; sin ella, los picos de cada franja
  const extremos: ExtremoRotulado[] = [];
  const color = superior ? "#1d4ed8" : "#b91c1c";
  const centro = (t: TramoArmado): Vec2 => [t.rectangulo.reduce((a, p) => a + p[0], 0) / 4, t.rectangulo.reduce((a, p) => a + p[1], 0) / 4];
  const vmax = m.vmax || 1;
  if (m.conBase) {
    for (const z of m.zonas) {
      const t = z.tramos.find((x) => x.franja === z.maximo.franja && x.s === z.maximo.s && x.v === z.maximo.v)!;
      const c = centro(t);
      P.push({ tipo: "texto", p: c, texto: `${rotulo(z.maximo.v)} (${textoExceso(z.maximo.exceso)})`, tamano: 10, color, fondo: true, ancla: "medio", dy: 4, prioridad: (z.maximo.v / vmax) * 60 + 5, objeto: z.id });
      extremos.push({ que: `Máximo de ${z.id} (base ${rotulo(z.base)})`, valor: z.maximo.v, unidad: u, objeto: z.id, punto: c, comb: z.maximo.comb });
    }
  } else {
    const minima = PROMINENCIA_PICOS * m.vmax;
    for (const f of m.franjas)
      for (const t of picos(f.tramos, minima)) {
        const c = centro(t);
        P.push({ tipo: "texto", p: c, texto: rotulo(t.v), tamano: 10, color, fondo: true, ancla: "medio", dy: 4, prioridad: (t.v / vmax) * 60 + 5, objeto: t.franja });
        extremos.push({ que: `${superior ? "Superior" : "Inferior"}: pico de ${t.franja} en s = ${rotulo(t.s, 4)} m`, valor: t.v, unidad: u, objeto: t.franja, punto: c, comb: t.comb });
      }
  }
  const ordenados = extremos.sort((a, b) => b.valor - a.valor || ((a.objeto ?? "") < (b.objeto ?? "") ? -1 : (a.objeto ?? "") > (b.objeto ?? "") ? 1 : 0));
  const paños = pl.enPlanta(pl.f.panos);
  if (paños.length) notas.push(`Los paños (${paños.map((p) => p.id).join(", ")}) no llevan franjas: sus viguetas, con «fem consultar pieza».`);
  if (!m.franjas.length) notas.push("La planta no tiene losas macizas ni reticulares: no hay franjas.");
  const mayor = m.franjas.flatMap((f) => f.tramos).reduce<TramoArmado | null>((a, t) => (t.v > (a?.v ?? 0) ? t : a), null);
  if (mayor) notas.push(`Mayor: ${rotulo(mayor.v)} ${u} en ${mayor.franja} (${mayor.comb}).`);
  const lm = m.limites;
  return {
    titulo: d.nombre ?? "Proyecto",
    cabecera: cabecera(pl, `Vista: ${NOMBRE[armadura]}, momento de dimensionado (${u}), envolvente de ${conjunto.descripcion}${m.conBase ? ", sobre la armadura base" : ""}`, d),
    primitivas: P,
    leyenda: m.leyenda,
    tituloLeyenda: tituloArmado(armadura),
    notas,
    extremos: ordenados,
    caja: caja(pl),
    ...(lm
      ? {
          mapa: {
            limites: lm.L.slice(lm.fueraAbajo ? 1 : 0, lm.fueraArriba ? lm.L.length - 1 : lm.L.length),
            paso: lm.paso,
            fueraAbajo: lm.fueraAbajo,
            fueraArriba: lm.fueraArriba,
            picos: false,
            minimo: Math.min(...m.coloreados.map((x) => x.t.v)),
            maximo: Math.max(...m.coloreados.map((x) => x.t.v)),
            combinacion: "",
          },
        }
      : {}),
  };
}
