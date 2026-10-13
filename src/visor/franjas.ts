/**
 * Resultados · Armado del visor (fase F, `docs/fem3d/franjas.md` §2.6): lo que enseña la pantalla
 * de las franjas de armado de una planta, todo de las consultas:
 * - la escena `armado-<x|y>-<inf|sup>` de A4 (la de `fem render`);
 * - una fila por franja de esa dirección con su mayor demanda inferior y superior (`fem consultar
 *   franjas`);
 * - el detalle de una franja: sus estaciones con el mx máximo y mínimo y Wood–Armer (`fem consultar
 *   franja`).
 *
 * Puro: sin IO.
 */
import type { ConjuntoCombinaciones } from "../agente/combinaciones.ts";
import { baseDe, type ArmadoProyecto } from "../agente/armaduraBase.ts";
import { franja as consultaFranja, franjas as consultaFranjas, type DemandaFranja, type EstacionFranjaEnvolvente, type FilaRefuerzo } from "../agente/consultas.ts";
import { losasDe, zonasRefuerzo } from "../agente/refuerzos.ts";
import { tramosPlanta } from "./armado.ts";
import type { Armadura, FiltroArmado } from "../agente/render/armado.ts";
import type { EscalaMapa } from "../agente/render/isovalores.ts";
import type { Vec2 } from "../compilador/fisico.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { Resultado } from "./datos.ts";
import type { EscenaPreparada } from "./escena.ts";
import type { EleccionCombinaciones, Sesion } from "./sesion.ts";

const no = <T>(codigo: string, mensaje: string): Resultado<T> => ({ valido: false, diagnosticos: [{ codigo, severidad: "error", mensaje }] });

export interface CombinacionesArmado {
  descripcion: string;
  nombres: string[];
  etiquetas: string[];
}

const resumen = (c: ConjuntoCombinaciones): CombinacionesArmado => ({ descripcion: c.descripcion, nombres: c.nombres, etiquetas: c.etiquetas });

export interface FilaArmado {
  id: string;
  losa: string;
  direccion: 1 | 2;
  /** Extensión transversal [t0, t1], m, y su ancho. */
  t: [number, number];
  ancho: number;
  /** Mayor demanda de Wood–Armer inferior y superior (kN·m/m), con su estación y su combinación. */
  inferior: DemandaFranja | null;
  superior: DemandaFranja | null;
}

export interface DatosArmado {
  escena: EscenaPreparada;
  /** AB: las zonas de refuerzo de la planta con la base (las de «fem consultar refuerzos»). */
  zonas: FilaRefuerzo[];
  /** Las losas de la planta sin base en esta armadura. */
  sinBase: string[];
  combinaciones: CombinacionesArmado;
  filas: FilaArmado[];
  /** Las plantas que tienen franjas (las de losas macizas o reticulares). */
  plantas: string[];
  diagnosticos: Diagnostico[];
}

/** El mapa de una armadura en una planta, la tabla de sus franjas y sus zonas de refuerzo. */
export function datosArmado(s: Sesion, planta: string, e: EleccionCombinaciones, armadura: Armadura, op: { escala?: EscalaMapa; armado?: ArmadoProyecto; soloExceso?: boolean; filtro?: FiltroArmado } = {}): Resultado<DatosArmado> {
  const q = s.q;
  if (!q) return no("visor/sin-resultados", "No hay resultados de esta huella.");
  const esc = s.escena(planta, { vista: "armado", combinaciones: e, armadura, ...op });
  if (!esc.valido) return esc;
  const conj = s.conjunto(e, "esfuerzos");
  if (!conj.valido) return conj;
  const r = consultaFranjas(q, conj.valor, { planta });
  if (!r.valido) return r;
  const direccion = armadura[0] === "x" ? 1 : 2;
  const filas = r.valor.franjas.filter((f) => f.direccion === direccion).map((f): FilaArmado => ({ ...f, ancho: f.t[1] - f.t[0] }));
  const plantas = q.fisico.plantas.map((p) => p.id).filter((p) => (q.fisico.losas ?? []).some((l) => l.planta === p));
  // Las zonas, con los tramos que ya calculó el mapa (las mismas que «fem consultar refuerzos»)
  const fs = tramosPlanta(q, planta, armadura, conj.valor);
  if (!fs.valido) return fs;
  const losas = losasDe(q, { planta });
  const conBase = losas.filter((l) => baseDe(op.armado, l, armadura) !== null);
  const zonas = conBase.flatMap((l) => zonasRefuerzo(l, armadura, baseDe(op.armado, l, armadura)!, fs.valor)).map(({ tramos: _t, contorno: _c, ...z }): FilaRefuerzo => z);
  return { valido: true, valor: { escena: esc.valor, zonas, sinBase: losas.filter((l) => !conBase.includes(l)), combinaciones: resumen(conj.valor), filas, plantas, diagnosticos: r.diagnosticos } };
}

export interface DatosFranja {
  franja: { id: string; losa: string; planta: string; direccion: 1 | 2; ancho: number; intereje: number | null; t: [number, number]; s: [number, number]; d: Vec2; n: Vec2 };
  combinaciones: CombinacionesArmado;
  estaciones: EstacionFranjaEnvolvente[];
  diagnosticos: Diagnostico[];
}

/** El detalle de una franja: sus estaciones con mx y Wood–Armer. */
export function datosFranja(s: Sesion, id: string, e: EleccionCombinaciones): Resultado<DatosFranja> {
  const q = s.q;
  if (!q) return no("visor/sin-resultados", "No hay resultados de esta huella.");
  const g = q.franja(id);
  if (!g.valido) return g;
  const conj = s.conjunto(e, "esfuerzos");
  if (!conj.valido) return conj;
  const c = consultaFranja(q, conj.valor, id);
  if (!c.valido) return c;
  const f = g.valor.franja;
  return {
    valido: true,
    valor: {
      franja: { id: f.id, losa: f.losa, planta: f.planta, direccion: f.direccion, ancho: f.ancho, intereje: f.intereje, t: [f.t0, f.t1], s: [f.s0, f.s1], d: f.d, n: f.n },
      combinaciones: resumen(conj.valor),
      estaciones: c.valor.estaciones,
      diagnosticos: c.diagnosticos,
    },
  };
}
