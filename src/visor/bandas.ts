/**
 * Resultados · Bandas del visor (V2b, `docs/fem3d/visor.md` §7.4 d): lo que enseña la pantalla de
 * las bandas de dimensionado de una planta, todo de las consultas:
 * - la escena `bandas` de A4 (la de `fem render`);
 * - una fila por banda con su My mínimo en las caras y máximo en los vanos (`fem consultar banda`);
 * - el detalle de una banda: en cada estación, My, el momento medio por metro (My/b, con b el ancho
 *   en losa), Wood–Armer con los momentos medios (C5-c, `woodArmerEstacion`) y, en un reticular, el
 *   momento por nervio (C4-j);
 * - el reparto entre bandas de pilares y centrales de cada línea (C5-d), en la combinación de mayor
 *   |momento total| de la línea, con el aviso de las combinaciones en que sale de la tabla I.1.
 *
 * Puro: sin IO.
 */
import { banda as consultaBanda } from "../agente/consultas.ts";
import { direccionBanda, type DireccionBanda } from "../agente/render/bandas.ts";
import type { ConjuntoCombinaciones } from "../agente/combinaciones.ts";
import { combinar } from "../compilador/envolventes.ts";
import { woodArmerEstacion } from "../compilador/esfuerzosBandas.ts";
import type { Banda, Vec2 } from "../compilador/fisico.ts";
import { direccionEje1 } from "../compilador/losas.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { Resultado } from "./datos.ts";
import type { EscenaPreparada } from "./escena.ts";
import type { EleccionCombinaciones, Sesion } from "./sesion.ts";

const no = <T>(codigo: string, mensaje: string): Resultado<T> => ({ valido: false, diagnosticos: [{ codigo, severidad: "error", mensaje }] });

/** Un valor y la combinación que lo da. */
export type ConComb = [number, string];

export interface CombinacionesBandas {
  descripcion: string;
  nombres: string[];
  etiquetas: string[];
}

export interface FilaBanda {
  id: string;
  tipo: "pilares" | "central" | null;
  origen: "propuesta" | "usuario";
  direccion: DireccionBanda;
  ancho: number;
  /** Tramos de apoyo (caras) que tiene. */
  apoyos: number;
  /** El menor My de sus caras (< 0) y el mayor de sus vanos (> 0), kN·m; null si no lo hay. */
  cara: ConComb | null;
  vano: ConComb | null;
  /** Estaciones que caen en un hueco o fuera de las losas. */
  invalidas: number;
}

export interface LineaRepartoVista {
  losa: string;
  direccion: DireccionBanda;
  tipo: "cara" | "vano";
  /** Coordenada de la línea a lo largo de la dirección, m. */
  s: number;
  /** La combinación de mayor |pilares + centrales|, y en ella las dos sumas de My (kN·m) y la parte de las de pilares. */
  comb: string;
  pilares: number;
  centrales: number;
  fraccion: number;
  rango: [number, number];
  /** Combinaciones en las que la parte de las de pilares sale del rango de la tabla I.1. */
  fuera: string[];
  bandas: string[];
}

export interface DatosBandas {
  escena: EscenaPreparada;
  combinaciones: CombinacionesBandas;
  filas: FilaBanda[];
  reparto: LineaRepartoVista[];
  /** Las plantas que tienen bandas (para ir a ellas desde una que no tiene). */
  plantas: string[];
  diagnosticos: Diagnostico[];
}

const resumen = (c: ConjuntoCombinaciones): CombinacionesBandas => ({ descripcion: c.descripcion, nombres: c.nombres, etiquetas: c.etiquetas });

/** La tabla de las bandas de una planta (de una dirección, si se da), su escena y su reparto. */
export function datosBandas(s: Sesion, planta: string, e: EleccionCombinaciones, direccion: DireccionBanda | null): Resultado<DatosBandas> {
  const q = s.q;
  if (!q) return no("visor/sin-resultados", "No hay resultados de esta huella.");
  const esc = s.escena(planta, { vista: "bandas", combinaciones: e, ...(direccion ? { direccion } : {}) });
  if (!esc.valido) return esc;
  const conj = s.conjunto(e, "esfuerzos");
  if (!conj.valido) return conj;
  const f = q.fisico;
  const filas: FilaBanda[] = [];
  const diagnosticos: Diagnostico[] = [];
  for (const b of f.bandas ?? []) {
    if (b.planta !== planta) continue;
    const dir = direccionBanda(f, b);
    if (direccion && dir !== direccion) continue;
    const r = consultaBanda(q, conj.valor, b.id);
    if (!r.valido) {
      diagnosticos.push(...r.diagnosticos);
      continue;
    }
    diagnosticos.push(...r.diagnosticos);
    let cara: ConComb | null = null;
    let vano: ConComb | null = null;
    let invalidas = 0;
    for (const x of r.valor.estaciones) {
      if (x.valido === false) {
        invalidas++;
        continue;
      }
      if (x.tipo === "cara" && x.min[0] < 0 && (!cara || x.min[0] < cara[0])) cara = x.min;
      if (x.tipo === "vano" && x.max[0] > 0 && (!vano || x.max[0] > vano[0])) vano = x.max;
    }
    filas.push({ id: b.id, tipo: b.tipo ?? null, origen: b.origen ?? "usuario", direccion: dir, ancho: b.ancho, apoyos: b.apoyos?.length ?? 0, cara, vano, invalidas });
  }
  const plantas = f.plantas.map((p) => p.id).filter((p) => (f.bandas ?? []).some((b) => b.planta === p));
  return { valido: true, valor: { escena: esc.valor, combinaciones: resumen(conj.valor), filas, reparto: repartoPlanta(s, planta, conj.valor, direccion), plantas, diagnosticos } };
}

/** El reparto de cada línea de las losas de la planta, en las direcciones de sus bandas con tipo. */
function repartoPlanta(s: Sesion, planta: string, conj: ConjuntoCombinaciones, direccion: DireccionBanda | null): LineaRepartoVista[] {
  const q = s.q!;
  const f = q.fisico;
  const r: LineaRepartoVista[] = [];
  for (const l of f.losas ?? []) {
    if (l.planta !== planta) continue;
    const d1 = direccionEje1(l.eje1 ?? 0);
    for (const dir of ["1", "2"] as const) {
      if (direccion && dir !== direccion) continue;
      const d: Vec2 = dir === "1" ? d1 : [-d1[1], d1[0]];
      const lineas = new Map<string, LineaRepartoVista & { total: number }>();
      conj.factores.forEach((fa, kc) => {
        const x = q.reparto(l.id, d, fa);
        if (!x.valido) return;
        for (const li of x.valor) {
          const clave = `${li.tipo}@${li.s.toFixed(6)}`;
          const total = Math.abs(li.pilares + li.centrales);
          let v = lineas.get(clave);
          if (!v) lineas.set(clave, (v = { losa: l.id, direccion: dir, tipo: li.tipo, s: li.s, comb: "", pilares: 0, centrales: 0, fraccion: Number.NaN, rango: li.rango, fuera: [], bandas: li.bandas, total: -1 }));
          if (total > v.total) Object.assign(v, { total, comb: conj.nombres[kc]!, pilares: li.pilares, centrales: li.centrales, fraccion: li.fraccion });
          if (li.fuera) v.fuera.push(conj.nombres[kc]!);
        }
      });
      for (const { total: _t, ...v } of lineas.values()) if (v.bandas.length) r.push(v);
    }
  }
  return r.sort((a, b) => (a.losa < b.losa ? -1 : a.losa > b.losa ? 1 : 0) || (a.direccion < b.direccion ? -1 : a.direccion > b.direccion ? 1 : 0) || a.s - b.s || (a.tipo < b.tipo ? -1 : 1));
}

export interface EstacionBanda {
  s: number;
  tipo: "cara" | "vano";
  punto: Vec2;
  /** Ancho de la banda en losa en la estación, m (el de los momentos medios). */
  anchoEnLosa: number;
  valido: boolean;
  /** My de la banda, kN·m: el máximo y el mínimo de las combinaciones (los de `fem consultar banda`). */
  max: ConComb;
  min: ConComb;
  /** Wood–Armer con los momentos medios (kN·m/m), en los ejes de la banda: X a lo largo; null si la estación no tiene muestras para my y mxy. */
  woodArmer: { inferiorX: ConComb; superiorX: ConComb; inferiorY: ConComb; superiorY: ConComb } | null;
  /** En un reticular, el momento por nervio (kN·m por nervio) y la fracción del ancho en ábacos. */
  nervio: { intereje: number; max: ConComb; min: ConComb; fraccionAbaco: number } | null;
  /** Barras que atraviesan el corte (vigas embebidas). */
  barras: string[];
}

export interface DatosBanda {
  banda: Banda;
  direccion: DireccionBanda;
  combinaciones: CombinacionesBandas;
  estaciones: EstacionBanda[];
  diagnosticos: Diagnostico[];
}

/** Envolvente [máx, mín] de un valor por caso combinado en cada combinación del conjunto. */
function envolvente(porCaso: ArrayLike<number>, n: number, k: number, conj: ConjuntoCombinaciones): [ConComb, ConComb] {
  let max: ConComb = [-Infinity, ""];
  let min: ConComb = [Infinity, ""];
  conj.factores.forEach((fa, kc) => {
    const v = combinar(porCaso, n, fa)[k]!;
    if (v > max[0]) max = [v, conj.nombres[kc]!];
    if (v < min[0]) min = [v, conj.nombres[kc]!];
  });
  return [max, min];
}

/** El detalle de una banda: sus estaciones con My, Wood–Armer y el momento por nervio. */
export function datosBanda(s: Sesion, id: string, e: EleccionCombinaciones): Resultado<DatosBanda> {
  const q = s.q;
  if (!q) return no("visor/sin-resultados", "No hay resultados de esta huella.");
  const b = (q.fisico.bandas ?? []).find((x) => x.id === id);
  if (!b) return no("visor/banda", `No hay ninguna banda ${id}.`);
  const conj = s.conjunto(e, "esfuerzos");
  if (!conj.valido) return conj;
  const c = consultaBanda(q, conj.valor, id);
  if (!c.valido) return c;
  const r = q.banda(id);
  if (!r.valido) return r;
  const estaciones = r.valor.map((x, i): EstacionBanda => {
    const env = c.valor.estaciones[i]!;
    const conMuestras = Number.isFinite(x.medios[1]!) && Number.isFinite(x.medios[2]!);
    let woodArmer: EstacionBanda["woodArmer"] = null;
    if (x.valido && conMuestras) {
      const w = woodArmerEstacion(x, conj.valor.factores).envolvente;
      const de = (k: "inferiorX" | "superiorX" | "inferiorY" | "superiorY"): ConComb => [w.valores[k], w.combinacion[k] >= 0 ? conj.valor.nombres[w.combinacion[k]]! : ""];
      woodArmer = { inferiorX: de("inferiorX"), superiorX: de("superiorX"), inferiorY: de("inferiorY"), superiorY: de("superiorY") };
    }
    let nervio: EstacionBanda["nervio"] = null;
    if (x.nervio && x.valido) {
      const [max, min] = envolvente(x.nervio.momentos, 1, 0, conj.valor);
      nervio = { intereje: x.nervio.intereje, max, min, fraccionAbaco: x.nervio.fraccionAbaco };
    }
    return { s: x.s, tipo: x.tipo, punto: x.punto, anchoEnLosa: x.anchoEnLosa, valido: x.valido, max: env.max, min: env.min, woodArmer, nervio, barras: x.barras };
  });
  return { valido: true, valor: { banda: b, direccion: direccionBanda(q.fisico, b), combinaciones: resumen(conj.valor), estaciones, diagnosticos: c.diagnosticos } };
}
