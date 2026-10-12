/**
 * Vista `bandas` de una planta (V2b, `docs/fem3d/visor.md` §7.4 d): las bandas de dimensionado con
 * el My de cada estación, que son las de «fem consultar banda» (A1) bit a bit.
 *
 * - Las estaciones son discretas: las caras de los apoyos (exactas, por fuerzas nodales) y los
 *   centros de vano (por campos, E5-6). Entre ellas no hay valores, así que cada una se dibuja como
 *   un palo perpendicular al eje de la banda, no como una curva continua.
 * - Envolvente de las combinaciones: el máximo positivo a un lado y el mínimo negativo al otro,
 *   con el lado de los positivos de los diagramas de las vigas (abajo en las bandas en X, a la
 *   derecha en las bandas en Y). Rotulado, el que gobierna la estación: el mínimo en una cara y el
 *   máximo en un vano (o el otro, si ése no tiene el signo).
 * - Las dos direcciones de una losa se cruzan: se ve una cada vez (la de su eje 1 o la
 *   perpendicular), o las dos.
 *
 * Puro: sin IO.
 */
import type { Banda, ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import { direccionEje1 } from "../../compilador/losas.ts";
import { puntoEnPoligono } from "../../compilador/poligonos.ts";
import type { ConjuntoCombinaciones } from "../combinaciones.ts";
import { banda as consultaBanda, type EstacionEnvolvente } from "../consultas.ts";
import { bandaPolilinea, rotulo, type Escena, type ExtremoRotulado, type Primitiva } from "./escena.ts";
import { fondoModelo, PlantaFisica, type DatosVista } from "./modelo.ts";
import { cabecera, caja, type ResultadosRender } from "./resultados.ts";

/** Dirección de una banda respecto a su losa: la de su eje 1 («1») o la perpendicular («2»). */
export type DireccionBanda = "1" | "2";

/** Fracción del menor ancho de banda de la planta que mide el palo del mayor |My|. */
const ORDENADA_BANDA = 0.45;

/**
 * La dirección de una banda: «1» si su eje va más según el eje 1 de la losa de su planta en la que
 * cae su punto medio (la primera de la planta, si no cae en ninguna); si no, «2».
 */
export function direccionBanda(f: ModeloFisico, b: Banda): DireccionBanda {
  const m: Vec2 = [(b.desde[0] + b.hasta[0]) / 2, (b.desde[1] + b.hasta[1]) / 2];
  const losas = (f.losas ?? []).filter((l) => l.planta === b.planta);
  const l = losas.find((x) => puntoEnPoligono(m, x.contorno)) ?? losas[0];
  const d1 = direccionEje1(l?.eje1 ?? 0);
  const [dx, dy] = [b.hasta[0] - b.desde[0], b.hasta[1] - b.desde[1]];
  const c = Math.abs(dx * d1[0] + dy * d1[1]) / Math.hypot(dx, dy);
  return c >= Math.SQRT1_2 ? "1" : "2";
}

/** Una banda con la envolvente de sus estaciones (`fem consultar banda`) y el punto de cada una en planta. */
export interface BandaEnvolvente {
  banda: Banda;
  direccion: DireccionBanda;
  estaciones: (EstacionEnvolvente & { punto: Vec2 })[];
}

/** Las bandas de la planta (de una dirección, si se da) con su envolvente; las que no se pueden consultar, fuera. */
export function envolventesBandas(r: ResultadosRender, planta: string, conjunto: ConjuntoCombinaciones, direccion?: DireccionBanda | null): BandaEnvolvente[] {
  const f = r.q.fisico;
  const res: BandaEnvolvente[] = [];
  for (const b of f.bandas ?? []) {
    if (b.planta !== planta) continue;
    const dir = direccionBanda(f, b);
    if (direccion && dir !== direccion) continue;
    const c = consultaBanda(r.q, conjunto, b.id);
    const e = r.q.banda(b.id);
    if (!c.valido || !e.valido) continue;
    res.push({ banda: b, direccion: dir, estaciones: c.valor.estaciones.map((x, i) => ({ ...x, punto: e.valor[i]!.punto })) });
  }
  return res;
}

/** El valor que gobierna una estación: el mínimo en una cara y el máximo en un vano, si tienen ese signo; si no, el de mayor |valor|. */
export function gobierna(e: EstacionEnvolvente): [number, string] {
  const [preferido, otro] = e.tipo === "cara" ? [e.min, e.max] : [e.max, e.min];
  const conSigno = e.tipo === "cara" ? preferido[0] < 0 : preferido[0] > 0;
  if (conSigno) return preferido;
  return Math.abs(otro[0]) > Math.abs(preferido[0]) ? otro : preferido;
}

export function vistaBandas(r: ResultadosRender, planta: string, conjunto: ConjuntoCombinaciones, d: DatosVista, direccion?: DireccionBanda | null): Escena {
  const pl = new PlantaFisica(r.q.fisico, planta);
  const fondo = fondoModelo(pl, { atenuado: true });
  const P: Primitiva[] = [...fondo.primitivas];
  const bandas = envolventesBandas(r, planta, conjunto, direccion);
  const validas = bandas.flatMap((b) => b.estaciones.filter((e) => e.valido !== false));
  const maxAbs = Math.max(0, ...validas.map((e) => Math.max(Math.abs(e.max[0]), Math.abs(e.min[0]))));
  const minAncho = Math.min(...bandas.map((b) => b.banda.ancho));
  const k = maxAbs > 0 ? (ORDENADA_BANDA * minAncho) / maxAbs : 0;
  const w = bandas.length ? Math.max(0.05, 0.03 * minAncho) : 0;
  const extremos: ExtremoRotulado[] = [];
  let invalidas = 0;
  for (const { banda: b, estaciones } of bandas) {
    const [dx, dy] = [b.hasta[0] - b.desde[0], b.hasta[1] - b.desde[1]];
    const L = Math.hypot(dx, dy);
    const u: Vec2 = [dx / L, dy / L];
    // Lado de los positivos, como en las vigas: leída en X creciente (o Y), My > 0 a su derecha
    const directa = Math.abs(dx) >= Math.abs(dy) ? dx > 0 : dy > 0;
    const lado = directa ? -1 : 1;
    const n: Vec2 = [-u[1] * lado, u[0] * lado];
    const en = (p: Vec2, v: number): Vec2 => [p[0] + n[0] * v * k, p[1] + n[1] * v * k];
    for (const q of bandaPolilinea([b.desde, b.hasta], b.ancho)) P.push({ tipo: "linea", puntos: [...q, q[0]!], estilo: "banda", objeto: b.id });
    P.push({ tipo: "linea", puntos: [b.desde as Vec2, b.hasta as Vec2], estilo: "diagrama-eje", objeto: b.id });
    let cara: { v: number; comb: string; p: Vec2 } | null = null;
    let vano: { v: number; comb: string; p: Vec2 } | null = null;
    for (const e of estaciones) {
      if (e.valido === false) {
        invalidas++;
        continue;
      }
      const p = e.punto;
      const palo = (v: number, estilo: "diagrama-positivo" | "diagrama-negativo") => {
        const a = en(p, v);
        P.push({ tipo: "poligono", anillos: [[[p[0] - u[0] * w, p[1] - u[1] * w], [p[0] + u[0] * w, p[1] + u[1] * w], [a[0] + u[0] * w, a[1] + u[1] * w], [a[0] - u[0] * w, a[1] - u[1] * w]]], estilo, objeto: b.id });
      };
      if (e.max[0] > 0) palo(e.max[0], "diagrama-positivo");
      if (e.min[0] < 0) palo(e.min[0], "diagrama-negativo");
      const [v] = gobierna(e);
      if (v !== 0) {
        const t = en(p, v);
        P.push({ tipo: "texto", p: t, texto: rotulo(v), tamano: 10.5, color: v > 0 ? "#b91c1c" : "#1d4ed8", fondo: true, ancla: "medio", dy: t[1] >= p[1] ? -3 : 11, prioridad: (Math.abs(v) / (maxAbs || 1)) * 50 + 10, objeto: b.id });
      }
      if (e.tipo === "cara" && e.min[0] < 0 && (!cara || e.min[0] < cara.v)) cara = { v: e.min[0], comb: e.min[1], p };
      if (e.tipo === "vano" && e.max[0] > 0 && (!vano || e.max[0] > vano.v)) vano = { v: e.max[0], comb: e.max[1], p };
    }
    if (cara) extremos.push({ que: `My mínimo en las caras de ${b.id}`, valor: cara.v, unidad: "kN·m", objeto: b.id, punto: cara.p, comb: cara.comb });
    if (vano) extremos.push({ que: `My máximo en los vanos de ${b.id}`, valor: vano.v, unidad: "kN·m", objeto: b.id, punto: vano.p, comb: vano.comb });
  }
  const ordenados = [...extremos].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  const cuales = direccion ? `dirección ${direccion} (${direccion === "1" ? "la del eje 1 de su losa" : "la perpendicular al eje 1"})` : "las dos direcciones";
  const sinBandas = !(pl.f.bandas ?? []).some((b) => b.planta === planta);
  return {
    titulo: d.nombre ?? "Proyecto",
    cabecera: cabecera(pl, `Vista: My de las bandas (kN·m), ${cuales}, envolvente de ${conjunto.descripcion}`, d),
    primitivas: P,
    leyenda: [
      { estilo: "banda", texto: "Banda de dimensionado" },
      { estilo: "diagrama-positivo", texto: "My máximo de la estación (> 0, tracción abajo): abajo en las bandas en X y a la derecha en las bandas en Y" },
      { estilo: "diagrama-negativo", texto: "My mínimo de la estación (< 0): al otro lado" },
    ],
    notas: [
      "My de toda la banda en cada estación, de «fem consultar banda»: en las caras de los apoyos, exacto (por fuerzas nodales); en los centros de vano, por campos. Entre estaciones no hay valores.",
      "Rotulado, el que gobierna cada estación: el mínimo en una cara y el máximo en un vano.",
      ...(maxAbs > 0 ? [`Escala: ${rotulo(maxAbs)} kN·m = ${rotulo(k * maxAbs)} m.`] : []),
      ...(invalidas ? [invalidas === 1 ? "Una estación cae entera en un hueco o fuera de las losas: no tiene esfuerzos." : `${invalidas} estaciones caen enteras en un hueco o fuera de las losas: no tienen esfuerzos.`] : []),
      ...(sinBandas ? ["La planta no tiene bandas: se proponen en Modelo («Proponer bandas») o se escriben en su tabla."] : !bandas.length ? [`La planta no tiene bandas en la ${cuales}.`] : []),
      ...(ordenados.length ? [`Mayor |My|: ${rotulo(ordenados[0]!.valor)} kN·m en ${ordenados[0]!.objeto} (${ordenados[0]!.comb}).`] : []),
    ],
    extremos: ordenados,
    caja: caja(pl),
  };
}
