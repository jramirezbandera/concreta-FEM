/**
 * Vistas `armado-x-inf`, `armado-x-sup`, `armado-y-inf` y `armado-y-sup` de una planta (fase F,
 * `docs/fem3d/franjas.md` §2.5): las franjas de armado de sus losas en una dirección, coloreadas por
 * tramos según la demanda de Wood–Armer de su armadura inferior o superior (kN·m/m), que es la de
 * «fem consultar franja» bit a bit.
 *
 * - X es la dirección 1 de cada losa (su eje 1) e Y, la 2 (la perpendicular).
 * - Cada estación colorea su tramo de la franja: de la mitad hasta la estación anterior a la mitad
 *   hasta la siguiente, y no más de un paso (junto a un hueco); las dos de una línea de apoyo, cada
 *   una hacia su lado. Entre las caras de un pilar que toca la franja no hay estaciones: ese tramo lo
 *   cubren las de las caras.
 * - Inferior en rojos y superior en azules, con la escala de los mapas (`limitesMapa`).
 * - Rotulado, el mayor de cada franja, con prioridad por su valor (los que no caben, fuera).
 *
 * Puro: sin IO.
 */
import { franjas as consultaFranjas, franja as consultaFranja } from "../consultas.ts";
import type { ConjuntoCombinaciones } from "../combinaciones.ts";
import type { Vec2 } from "../../compilador/fisico.ts";
import { PASO_ESTACIONES } from "../../compilador/franjas.ts";
import { rotulo, type EntradaLeyenda, type Escena, type ExtremoRotulado, type Primitiva } from "./escena.ts";
import { coloresBandas, limitesMapa, type EscalaMapa, type LimitesMapa } from "./isovalores.ts";
import { capaEjes } from "./ejes.ts";
import { fondoModelo, PlantaFisica, type DatosVista } from "./modelo.ts";
import { cabecera, caja, trazoModelo, type ResultadosRender } from "./resultados.ts";

export const ARMADURAS = ["x-inf", "x-sup", "y-inf", "y-sup"] as const;
export type Armadura = (typeof ARMADURAS)[number];
export const VISTAS_ARMADO = ARMADURAS.map((a) => `armado-${a}` as const);

const NOMBRE: Record<Armadura, string> = {
  "x-inf": "armadura inferior en X (dirección 1 de cada losa)",
  "x-sup": "armadura superior en X (dirección 1 de cada losa)",
  "y-inf": "armadura inferior en Y (dirección 2 de cada losa)",
  "y-sup": "armadura superior en Y (dirección 2 de cada losa)",
};

/** Un tramo coloreado de una franja: su rectángulo en planta y su demanda. */
export interface TramoArmado {
  franja: string;
  /** Estación que lo colorea (a lo largo, m). */
  s: number;
  v: number;
  comb: string;
  rectangulo: Vec2[];
}

/** Los tramos de las franjas de la planta en una armadura, con su demanda (de «fem consultar franja»). */
export function tramosArmado(r: ResultadosRender, planta: string, armadura: Armadura, conjunto: ConjuntoCombinaciones): { tramos: TramoArmado[]; franjas: number } {
  const q = r.q;
  const direccion = armadura[0] === "x" ? 1 : 2;
  const cara = armadura.endsWith("inf") ? "inferior" : "superior";
  const tramos: TramoArmado[] = [];
  let nf = 0;
  const lista = consultaFranjas(q, conjunto, { planta });
  if (!lista.valido) return { tramos, franjas: 0 };
  for (const fila of lista.valor.franjas) {
    if (fila.direccion !== direccion) continue;
    const g = q.franja(fila.id);
    const c = consultaFranja(q, conjunto, fila.id);
    if (!g.valido || !c.valido) continue;
    nf++;
    const f = g.valor.franja;
    const es = c.valor.estaciones;
    const P = (s: number, t: number): Vec2 => [s * f.d[0] + t * f.n[0], s * f.d[1] + t * f.n[1]];
    es.forEach((e, i) => {
      if (e.valido === false) return;
      // Hasta la mitad de sus vecinas, y no más de un paso (junto a un hueco, la vecina no vale)
      const a = Math.max(i > 0 ? (es[i - 1]!.s + e.s) / 2 : f.s0, e.s - PASO_ESTACIONES);
      const b = Math.min(i + 1 < es.length ? (e.s + es[i + 1]!.s) / 2 : f.s1, e.s + PASO_ESTACIONES);
      if (!(b > a)) return;
      const [v, comb] = e[cara];
      tramos.push({ franja: f.id, s: e.s, v, comb, rectangulo: [P(a, f.t0), P(b, f.t0), P(b, f.t1), P(a, f.t1)] });
    });
  }
  return { tramos, franjas: nf };
}

export function vistaArmado(r: ResultadosRender, planta: string, armadura: Armadura, conjunto: ConjuntoCombinaciones, d: DatosVista, escala: EscalaMapa = {}): Escena {
  const pl = new PlantaFisica(r.q.fisico, planta);
  const P: Primitiva[] = [...fondoModelo(pl, { atenuado: true }).primitivas];
  const { tramos, franjas } = tramosArmado(r, planta, armadura, conjunto);
  const superior = armadura.endsWith("sup");
  const notas: string[] = [];
  const leyenda: EntradaLeyenda[] = [];
  let mapa: Escena["mapa"];
  const vmax = Math.max(0, ...tramos.map((t) => t.v));
  const u = "kN·m/m";
  if (tramos.length) {
    let lm = limitesMapa(0, vmax > 0 ? vmax : 1, escala);
    if ("error" in lm) {
      notas.push(`Escala no válida (${lm.error}): se dibuja la completa.`);
      lm = limitesMapa(0, vmax > 0 ? vmax : 1) as LimitesMapa;
    }
    const { L, fueraAbajo, fueraArriba } = lm;
    const nb = L.length - 1;
    // Superior en azules: los colores de los límites cambiados de signo, en el mismo orden
    const colores = superior
      ? coloresBandas(
          L.map((x) => -x).reverse(),
          { abajo: fueraArriba, arriba: fueraAbajo },
        ).reverse()
      : coloresBandas(L, { abajo: fueraAbajo, arriba: fueraArriba });
    const banda = (v: number) => {
      for (let b = 0; b < nb; b++) if (v <= L[b + 1]! || b === nb - 1) return b;
      return nb - 1;
    };
    // Los tramos seguidos de una franja en la misma banda, en un solo rectángulo, y los de cada banda
    // en una sola región con un anillo por rectángulo (no se solapan): el mismo dibujo con una región
    // por banda, como los mapas, en vez de miles
    const porBanda = new Map<number, Vec2[][]>();
    for (let i = 0; i < tramos.length; ) {
      const t = tramos[i]!;
      const b = banda(t.v);
      let j = i + 1;
      while (j < tramos.length && tramos[j]!.franja === t.franja && banda(tramos[j]!.v) === b && tramos[j]!.rectangulo[0]![0] === tramos[j - 1]!.rectangulo[1]![0] && tramos[j]!.rectangulo[0]![1] === tramos[j - 1]!.rectangulo[1]![1]) j++;
      const u = tramos[j - 1]!;
      const anillos = porBanda.get(b) ?? [];
      anillos.push([t.rectangulo[0]!, u.rectangulo[1]!, u.rectangulo[2]!, t.rectangulo[3]!]);
      porBanda.set(b, anillos);
      i = j;
    }
    for (const [b, anillos] of [...porBanda].sort((x, y) => x[0] - y[0])) P.push({ tipo: "region", anillos, estilo: "isobanda", relleno: colores[b]!, banda: b });
    for (let b = nb - 1; b >= 0; b--) {
      const texto = fueraArriba && b === nb - 1 ? `más de ${rotulo(L[b]!, 4)} (fuera de la escala)` : fueraAbajo && b === 0 ? `menos de ${rotulo(L[1]!, 4)} (fuera de la escala)` : `${rotulo(L[b]!, 4)} a ${rotulo(L[b + 1]!, 4)}`;
      leyenda.push({ relleno: colores[b]!, texto });
    }
    const dentro = L.slice(fueraAbajo ? 1 : 0, fueraArriba ? nb : nb + 1);
    mapa = { limites: dentro, paso: lm.paso, fueraAbajo, fueraArriba, picos: false, minimo: Math.min(...tramos.map((t) => t.v)), maximo: vmax, combinacion: "" };
  }
  P.push(...trazoModelo(pl));
  const ejes = capaEjes(pl.f, { cotas: false });
  P.push(...ejes.primitivas);
  notas.push(...ejes.notas);
  // El mayor de cada franja, rotulado
  const mayor = new Map<string, TramoArmado>();
  for (const t of tramos) if (t.v > (mayor.get(t.franja)?.v ?? 0)) mayor.set(t.franja, t);
  const extremos: ExtremoRotulado[] = [];
  for (const t of mayor.values()) {
    const c: Vec2 = [t.rectangulo.reduce((a, p) => a + p[0], 0) / 4, t.rectangulo.reduce((a, p) => a + p[1], 0) / 4];
    P.push({ tipo: "texto", p: c, texto: rotulo(t.v), tamano: 10, color: superior ? "#1d4ed8" : "#b91c1c", fondo: true, ancla: "medio", dy: 4, prioridad: (t.v / (vmax || 1)) * 60 + 5, objeto: t.franja });
    extremos.push({ que: `${superior ? "Superior" : "Inferior"} máxima de ${t.franja}`, valor: t.v, unidad: u, objeto: t.franja, punto: c, comb: t.comb });
  }
  const ordenados = extremos.sort((a, b) => b.valor - a.valor || ((a.objeto ?? "") < (b.objeto ?? "") ? -1 : 1));
  notas.push(
    "Momento de dimensionado de Wood–Armer por metro de la franja (kN·m/m), por combinación con los momentos medios de su ancho, en la dirección de la franja (fase F): de «fem consultar franja». En las caras de los pilares y en las líneas de apoyo, exacto (por fuerzas nodales); entre ellas, cada 0,25 m, por campos.",
    "Cada estación colorea su tramo de la franja, hasta la mitad de sus vecinas. Rotulado, el mayor de cada franja.",
  );
  const paños = pl.enPlanta(pl.f.panos);
  if (paños.length) notas.push(`Los paños (${paños.map((p) => p.id).join(", ")}) no llevan franjas: sus viguetas, con «fem consultar pieza».`);
  if (!franjas) notas.push("La planta no tiene losas macizas ni reticulares: no hay franjas.");
  if (ordenados.length) notas.push(`Mayor: ${rotulo(ordenados[0]!.valor)} ${u} en ${ordenados[0]!.objeto} (${ordenados[0]!.comb}).`);
  return {
    titulo: d.nombre ?? "Proyecto",
    cabecera: cabecera(pl, `Vista: ${NOMBRE[armadura]}, momento de dimensionado (kN·m/m), envolvente de ${conjunto.descripcion}`, d),
    primitivas: P,
    leyenda,
    notas,
    extremos: ordenados,
    caja: caja(pl),
    ...(mapa ? { mapa } : {}),
  };
}
