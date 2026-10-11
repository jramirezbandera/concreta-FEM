/**
 * Datos de las pantallas del visor (V1, `docs/fem3d/visor.md` §3.2), calculados en la sesión.
 *
 * Regla (criterio 1 de V1): cada número sale de una consulta existente, nunca de un cálculo propio
 * del visor: `Consultas` (C5), las de A1 (`pieza`, `flechas`, `deriva`), el render de A4
 * (`vistaCampo`, `envolventePieza`, `valoresCampo`) y la revisión de A3. Lo único que se añade aquí
 * es elegir qué consulta y con qué combinaciones, y la interpolación de un punto del mapa, que es la
 * misma de las bandas de A4 (lineal en los dos triángulos de cada lámina).
 *
 * Puro: sin IO.
 */
import type { ConjuntoCombinaciones } from "../agente/combinaciones.ts";
import { deriva, diagramaCombinado, flechas, pieza, type DerivaPlanta, type FlechasLosa, type TramoEnvolvente, type VanoEnvolvente } from "../agente/consultas.ts";
import { envolventePieza, valoresCampo, type Campo, type PuntoEnvolvente } from "../agente/render/resultados.ts";
import { estadoFirma, leerFirmas, revisar, type EstadoFirma } from "../agente/revision.ts";
import type { Bloque } from "../agente/informe.ts";
import { areaSeccion, UMBRALES, type Comprobacion } from "../agente/sensatez.ts";
import { sha256 } from "../compilador/huella.ts";
import type { ApoyoPieza } from "../compilador/consultas.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { EleccionCombinaciones, Sesion } from "./sesion.ts";
import type { EscenaPreparada } from "./escena.ts";

export type Resultado<T> = { valido: true; valor: T } | { valido: false; diagnosticos: Diagnostico[] };

const no = <T>(codigo: string, mensaje: string): Resultado<T> => ({ valido: false, diagnosticos: [{ codigo, severidad: "error", mensaje }] });

/** Componentes de [N, Vy, Vz, T, My, Mz]. */
export const COMPONENTE = { N: 0, Vy: 1, Vz: 2, T: 3, My: 4, Mz: 5 } as const;
export type Esfuerzo = keyof typeof COMPONENTE;

/** Lo que la interfaz enseña de un conjunto de combinaciones. */
export interface Combinaciones {
  descripcion: string;
  nombres: string[];
  etiquetas: string[];
}

const resumenConjunto = (c: ConjuntoCombinaciones): Combinaciones => ({ descripcion: c.descripcion, nombres: c.nombres, etiquetas: c.etiquetas });

// ─── Un objeto (inspector) ──────────────────────────────────────────────────────────────────────

export interface DatosObjeto {
  id: string;
  tipo: string;
  /** El objeto tal como está en el proyecto. */
  datos: Record<string, unknown>;
  diagnosticos: Diagnostico[];
}

const LISTAS = [
  ["plantas", "planta"],
  ["pilares", "pilar"],
  ["vigas", "viga"],
  ["losas", "losa"],
  ["panos", "paño"],
  ["muros", "muro"],
  ["apoyos", "apoyo"],
  ["apoyosLineales", "apoyo lineal"],
  ["bandas", "banda"],
  ["cargas", "carga"],
  ["casos", "caso"],
  ["secciones", "sección"],
  ["materiales", "material"],
] as const;

export function datosObjeto(s: Sesion, id: string): Resultado<DatosObjeto> {
  const f = s.proyecto.modelo as unknown as Record<string, { id: string }[] | undefined>;
  for (const [lista, tipo] of LISTAS) {
    const x = f[lista]?.find((o) => o.id === id);
    if (x) return { valido: true, valor: { id, tipo, datos: x as unknown as Record<string, unknown>, diagnosticos: s.diagnosticos.filter((d) => d.ids?.includes(id)) } };
  }
  // Las viguetas de un paño son piezas del compilador (C4: «<paño>:v<n>»)
  const c = s.compilado;
  if (c?.mapeo.piezas[id]) return { valido: true, valor: { id, tipo: "vigueta", datos: { id, pano: id.split(":")[0] }, diagnosticos: s.diagnosticos.filter((d) => d.ids?.includes(id)) } };
  return no("visor/objeto", `No hay ningún objeto ${id}.`);
}

// ─── Losas ──────────────────────────────────────────────────────────────────────────────────────

export interface DatosLosas {
  escena: EscenaPreparada;
  campo: Campo;
  /** Las combinaciones del mapa y, de ellas, la que se dibuja (la de mayor |valor| en la planta). */
  combinaciones: Combinaciones;
  dibujada: { nombre: string; etiqueta: string } | null;
  /** Flechas de las losas y paños de la planta (`fem consultar flechas`), con sus combinaciones. */
  flechas: FlechasLosa[];
  combinacionesFlechas: Combinaciones;
}

/** El propósito de las flechas: el de la elección si el mapa es de uz, si no las de desplazamientos por defecto. */
export function datosLosas(s: Sesion, planta: string, campo: Campo, e: EleccionCombinaciones): Resultado<DatosLosas> {
  const esc = s.escena(planta, { vista: "campo", campo, combinaciones: e });
  if (!esc.valido) return esc;
  const conj = s.conjunto(e, campo === "uz" ? "desplazamientos" : "esfuerzos");
  if (!conj.valido) return conj;
  const cjF = campo === "uz" ? conj : s.conjunto({ tipo: "defecto" }, "desplazamientos");
  if (!cjF.valido) return cjF;
  const q = s.q!;
  const losas = new Set([...(q.fisico.losas ?? []), ...(q.fisico.panos ?? [])].filter((l) => l.planta === planta).map((l) => l.id));
  const flr = flechas(q, cjF.valor);
  // Un modelo sin losas ni paños no tiene flechas, pero sí mapa (vacío) y planta
  const fl = flr.valido ? flr : flr.diagnosticos.every((d) => d.codigo === "consulta/sin-losas") ? { valido: true as const, valor: [] } : flr;
  if (!fl.valido) return fl;
  const comb = esc.valor.extremos[0]?.comb;
  const k = comb === undefined ? -1 : conj.valor.nombres.indexOf(comb);
  return {
    valido: true,
    valor: {
      escena: esc.valor,
      campo,
      combinaciones: resumenConjunto(conj.valor),
      dibujada: k >= 0 ? { nombre: conj.valor.nombres[k]!, etiqueta: conj.valor.etiquetas[k]! } : null,
      flechas: fl.valor.filter((x) => losas.has(x.id)),
      combinacionesFlechas: resumenConjunto(cjF.valor),
    },
  };
}

export interface ValorPunto {
  valor: number;
  unidad: string;
  losa: string;
  /** Lámina del modelo analítico que contiene el punto. */
  lamina: number;
  comb: string;
  /**
   * Los otros valores del punto si cae en el borde de láminas de regiones distintas (el pliegue
   * losa–muro, el borde de un ábaco, E5-7): ahí el campo salta y no se promedia.
   */
  otros?: number[];
}

const UNIDAD: Record<Campo, string> = { uz: "mm", m11: "kN·m/m", m22: "kN·m/m", m12: "kN·m/m", v13: "kN/m", v23: "kN/m" };

/**
 * Valor del mapa en un punto: el de la combinación dibujada, interpolado como las bandas de A4
 * (lineal en los triángulos 0-1-2 y 0-2-3 de cada lámina, con los valores de `valoresCampo`).
 * null fuera de las losas o en una lámina sin mapa (las rígidas de las huellas).
 */
export function valorEnPunto(s: Sesion, planta: string, campo: Campo, e: EleccionCombinaciones, x: number, y: number): Resultado<ValorPunto | null> {
  const d = datosLosas(s, planta, campo, e);
  if (!d.valido) return d;
  const dib = d.valor.dibujada;
  if (!dib) return { valido: true, valor: null };
  const conj = s.conjunto(e, campo === "uz" ? "desplazamientos" : "esfuerzos");
  if (!conj.valido) return conj;
  const k = conj.valor.nombres.indexOf(dib.nombre);
  const rr = s.rr!;
  const c = s.compilado!;
  const { laminas, v } = valoresCampo(rr, planta, campo, conj.valor.factores[k]!);
  let hallado: ValorPunto | null = null;
  const otros: number[] = [];
  for (let i = 0; i < laminas.length; i++) {
    const ns = c.modelo.laminas![laminas[i]!]!.nudos;
    const p = ns.map((n) => [c.modelo.nudos[n]!.x, c.modelo.nudos[n]!.y] as const);
    for (const [a, b, cc] of [
      [0, 1, 2],
      [0, 2, 3],
    ] as const) {
      const [x0, y0] = p[a]!;
      const [x1, y1] = p[b]!;
      const [x2, y2] = p[cc]!;
      const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (det === 0) continue;
      const l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / det;
      const l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / det;
      const l2 = 1 - l0 - l1;
      const eps = -1e-9;
      if (l0 < eps || l1 < eps || l2 < eps) continue;
      const w = [v[4 * i + a]!, v[4 * i + b]!, v[4 * i + cc]!];
      // Una lámina sin mapa (rígida): el punto puede estar también en una vecina que sí lo tiene
      if (w.some(Number.isNaN)) break;
      const valor = l0 * w[0]! + l1 * w[1]! + l2 * w[2]!;
      if (!hallado) hallado = { valor, unidad: UNIDAD[campo], losa: c.mapeo.laminas![laminas[i]!]!.losa ?? "", lamina: laminas[i]!, comb: dib.nombre };
      else if (valor !== hallado.valor && !otros.includes(valor)) otros.push(valor);
      break;
    }
  }
  return { valido: true, valor: hallado && otros.length ? { ...hallado, otros } : hallado };
}

// ─── Vigas ──────────────────────────────────────────────────────────────────────────────────────

export interface PiezaListada {
  id: string;
  tipo: "viga" | "vigueta";
  /** Paño de una vigueta. */
  pano?: string;
  seccion?: string;
  longitud: number;
}

/** Vigas y viguetas de una planta (las viguetas, de los paños, con su pieza del compilador). */
export function piezasPlanta(s: Sesion, planta: string): PiezaListada[] {
  const f = s.proyecto.modelo;
  const r: PiezaListada[] = [];
  const largo = (p: readonly (readonly number[])[]) => p.slice(1).reduce((t, q, i) => t + Math.hypot(q[0]! - p[i]![0]!, q[1]! - p[i]![1]!), 0);
  for (const v of f.vigas ?? []) if (v.planta === planta) r.push({ id: v.id, tipo: "viga", seccion: v.seccion, longitud: largo(v.puntos) });
  const c = s.compilado;
  for (const p of f.panos ?? [])
    if (p.planta === planta)
      for (const id of c?.mapeo.panos?.[p.id] ?? []) {
        const bs = c!.mapeo.piezas[id] ?? [];
        const L = bs.length ? c!.mapeo.barras[bs[bs.length - 1]!]!.s[3] : 0;
        r.push({ id, tipo: "vigueta", pano: p.id, longitud: L });
      }
  return r;
}

export interface DatosViga {
  id: string;
  tipo: "viga" | "vigueta";
  esfuerzo: Esfuerzo;
  combinaciones: Combinaciones;
  /** Longitud de la pieza (estación final), m. */
  longitud: number;
  apoyos: ApoyoPieza[];
  axilSinValor: boolean;
  /** Envolvente de la componente a lo largo de la pieza (`envolventePieza`, A4). */
  envolvente: PuntoEnvolvente[];
  /** Vanos de cara a cara con sus extremos y combinaciones (`fem consultar pieza`, A1). */
  vanos: VanoEnvolvente[];
  /** Tramos flexibles: fuera de ellos (las zonas rígidas, dentro de los apoyos) no hay esfuerzos. */
  flexibles: [number, number][];
}

export function datosViga(s: Sesion, id: string, esfuerzo: Esfuerzo, e: EleccionCombinaciones): Resultado<DatosViga> {
  const q = s.q;
  const rr = s.rr;
  if (!q || !rr) return no("visor/sin-resultados", "No hay resultados de esta huella.");
  const conj = s.conjunto(e, "esfuerzos");
  if (!conj.valido) return conj;
  const v = q.viga(id);
  if (!v.valido) return v;
  const p = pieza(q, conj.valor, id);
  if (!p.valido) return p;
  const c = s.compilado!;
  const bs = c.mapeo.piezas[id] ?? [];
  return {
    valido: true,
    valor: {
      id,
      tipo: v.valor.tipo,
      esfuerzo,
      combinaciones: resumenConjunto(conj.valor),
      longitud: bs.length ? c.mapeo.barras[bs[bs.length - 1]!]!.s[3] : 0,
      apoyos: v.valor.apoyos,
      axilSinValor: v.valor.axilSinValor,
      envolvente: envolventePieza(rr, id, conj.valor, COMPONENTE[esfuerzo]),
      vanos: (p.valor as { vanos: VanoEnvolvente[] }).vanos,
      flexibles: rr.ep.tramos(id).map((t) => [t.s0, t.s1]),
    },
  };
}

export interface ValorEstacion {
  v: number;
  comb: string;
  etiqueta: string;
}

export interface DatosEstacion {
  s: number;
  /** Dentro de una zona rígida (un apoyo): sin esfuerzos. */
  rigida: boolean;
  /** Por cada lado de la estación (en un salto difieren): máximo y mínimo con su combinación. */
  izquierda: { max: ValorEstacion; min: ValorEstacion } | null;
  derecha: { max: ValorEstacion; min: ValorEstacion } | null;
}

/** Máximo y mínimo de la componente en una estación, con la combinación de cada uno (los diagramas de `envolventePieza`). */
export function estacionViga(s: Sesion, id: string, esfuerzo: Esfuerzo, e: EleccionCombinaciones, st: number): Resultado<DatosEstacion> {
  const rr = s.rr;
  if (!rr) return no("visor/sin-resultados", "No hay resultados de esta huella.");
  const conj = s.conjunto(e, "esfuerzos");
  if (!conj.valido) return conj;
  const comp = COMPONENTE[esfuerzo];
  const ts = rr.ep.tramos(id).filter((t) => st >= t.s0 - 1e-9 && st <= t.s1 + 1e-9);
  if (!ts.length) return { valido: true, valor: { s: st, rigida: true, izquierda: null, derecha: null } };
  const lado = (lad: -1 | 1) => {
    const t = lad < 0 ? ts[0]! : ts[ts.length - 1]!;
    const x = Math.min(t.s1 - t.s0, Math.max(0, st - t.s0));
    let max: ValorEstacion | null = null;
    let min: ValorEstacion | null = null;
    conj.valor.factores.forEach((f, kc) => {
      const v = diagramaCombinado(rr.ep, t.barra, f).esfuerzosEn(x, lad)[comp]!;
      if (!max || v > max.v) max = { v, comb: conj.valor.nombres[kc]!, etiqueta: conj.valor.etiquetas[kc]! };
      if (!min || v < min.v) min = { v, comb: conj.valor.nombres[kc]!, etiqueta: conj.valor.etiquetas[kc]! };
    });
    return max && min ? { max: max as ValorEstacion, min: min as ValorEstacion } : null;
  };
  return { valido: true, valor: { s: st, rigida: false, izquierda: lado(-1), derecha: lado(1) } };
}

// ─── Pilares ────────────────────────────────────────────────────────────────────────────────────

export interface AxilReducido {
  /** ν = Nd/(Ac·fcd), fcd = fck/1,5 (como A3: un aviso de orden de magnitud, no una comprobación de norma). */
  nu: number;
  Nd: number;
  comb: string;
}

export interface FilaPilar {
  pilar: string;
  /** Planta de la cabeza del tramo y de su base. */
  planta: string;
  tramo: TramoEnvolvente;
  /** Sólo en los tramos de hormigón. */
  nu: AxilReducido | null;
  giro: number;
}

export const LIMITE_AXIL_REDUCIDO = UMBRALES.axilReducido;

function filasPilar(s: Sesion, id: string, conj: ConjuntoCombinaciones): Resultado<FilaPilar[]> {
  const q = s.q!;
  const p = pieza(q, conj, id);
  if (!p.valido) return p;
  const r = q.pilar(id);
  if (!r.valido) return r;
  const f = s.proyecto.modelo;
  const tramos = (p.valor as { tramos: TramoEnvolvente[] }).tramos;
  return {
    valido: true,
    valor: r.valor.map((t, i) => {
      const sec = f.secciones.find((x) => x.id === t.seccion);
      const mat = sec && f.materiales.find((m) => m.id === sec.material);
      let nu: AxilReducido | null = null;
      if (sec && mat && mat.tipo === "hormigon") {
        const fcd = (mat.fck / 1.5) * 1000;
        conj.factores.forEach((fa, kc) => {
          for (const e of [t.base.esfuerzos, t.cabeza.esfuerzos]) {
            let N = 0;
            for (let k = 0; k < fa.length; k++) if (fa[k]) N += fa[k]! * e[6 * k]!;
            const x = -N / (areaSeccion(sec) * fcd);
            if (!nu || x > nu.nu) nu = { nu: x, Nd: -N, comb: conj.nombres[kc]! };
          }
        });
      }
      return { pilar: id, planta: t.planta, tramo: tramos[i]!, nu, giro: t.giro };
    }),
  };
}

export interface DatosPilares {
  escena: EscenaPreparada;
  combinaciones: Combinaciones;
  /** Un tramo por pilar: el que tiene la cabeza en la planta. */
  filas: FilaPilar[];
}

export function datosPilares(s: Sesion, planta: string, e: EleccionCombinaciones): Resultado<DatosPilares> {
  const esc = s.escena(planta, { vista: "pilares-n", combinaciones: e });
  if (!esc.valido) return esc;
  const conj = s.conjunto(e, "esfuerzos");
  if (!conj.valido) return conj;
  const filas: FilaPilar[] = [];
  for (const p of s.proyecto.modelo.pilares ?? []) {
    const r = filasPilar(s, p.id, conj.valor);
    if (!r.valido) continue;
    const fila = r.valor.find((x) => x.planta === planta);
    if (fila) filas.push(fila);
  }
  filas.sort((a, b) => (a.pilar < b.pilar ? -1 : a.pilar > b.pilar ? 1 : 0));
  return { valido: true, valor: { escena: esc.valor, combinaciones: resumenConjunto(conj.valor), filas } };
}

export function datosPilar(s: Sesion, id: string, e: EleccionCombinaciones): Resultado<{ combinaciones: Combinaciones; filas: FilaPilar[] }> {
  if (!s.q) return no("visor/sin-resultados", "No hay resultados de esta huella.");
  const conj = s.conjunto(e, "esfuerzos");
  if (!conj.valido) return conj;
  const r = filasPilar(s, id, conj.valor);
  return r.valido ? { valido: true, valor: { combinaciones: resumenConjunto(conj.valor), filas: r.valor } } : r;
}

// ─── Desplomes ──────────────────────────────────────────────────────────────────────────────────

export interface DatosDesplomes {
  combinaciones: Combinaciones;
  /** Por planta, de arriba abajo (`fem consultar deriva`, A1). */
  plantas: DerivaPlanta[];
  /** Límite del desplome relativo de A3 (d/h). */
  limiteRelativo: number;
  /** La combinación del mayor desplome relativo de todas las plantas (la que se dibuja deformada). */
  pesima: string | null;
}

export function datosDesplomes(s: Sesion, e: EleccionCombinaciones): Resultado<DatosDesplomes> {
  const q = s.q;
  if (!q) return no("visor/sin-resultados", "No hay resultados de esta huella.");
  const conj = s.conjunto(e, "desplazamientos");
  if (!conj.valido) return conj;
  const d = deriva(q, conj.valor);
  if (!d.valido) return d;
  let pesima: { x: number; comb: string } | null = null;
  for (const p of d.valor) if (p.desplome && (!pesima || p.desplome.v > pesima.x)) pesima = { x: p.desplome.v, comb: p.desplome.comb };
  return { valido: true, valor: { combinaciones: resumenConjunto(conj.valor), plantas: d.valor, limiteRelativo: UMBRALES.desplome, pesima: pesima?.comb ?? null } };
}

// ─── 3D ─────────────────────────────────────────────────────────────────────────────────────────

/** Tipos de barra en la geometría 3D. */
export const TIPOS_BARRA = ["pilar", "viga", "vigueta", "otra"] as const;

export interface Geometria3D {
  /** x, y, z de cada nudo del modelo analítico (m). */
  nudos: Float32Array;
  /** Nudos de cada barra (pares) y su tipo (índice de TIPOS_BARRA) y planta (índice; la de su cabeza en los pilares). */
  barras: Uint32Array;
  tipoBarra: Uint8Array;
  plantaBarra: Uint16Array;
  /** Nudos de cada lámina (cuatro) y su planta (las de muro, la de su nudo más alto). */
  laminas: Uint32Array;
  plantaLamina: Uint16Array;
  esMuro: Uint8Array;
  plantas: string[];
}

export function geometria3D(s: Sesion): Resultado<Geometria3D> {
  const c = s.compilado;
  if (!c) return no("visor/no-compila", "El modelo no compila.");
  const m = c.modelo;
  const plantas = s.proyecto.modelo.plantas.map((p) => p.id);
  const idx = new Map(plantas.map((p, i) => [p, i]));
  const nudos = new Float32Array(3 * m.nudos.length);
  m.nudos.forEach((n, i) => nudos.set([n.x, n.y, n.z], 3 * i));
  const plantaNudo = (n: number) => idx.get(c.mapeo.nudos[n]?.planta ?? "") ?? 0;
  const nb = m.barras?.length ?? 0;
  const barras = new Uint32Array(2 * nb);
  const tipoBarra = new Uint8Array(nb);
  const plantaBarra = new Uint16Array(nb);
  (m.barras ?? []).forEach((b, i) => {
    barras.set(b.nudos, 2 * i);
    const mb = c.mapeo.barras[i]!;
    const t = TIPOS_BARRA.indexOf(mb.tipo as (typeof TIPOS_BARRA)[number]);
    tipoBarra[i] = t < 0 ? 3 : t;
    plantaBarra[i] = mb.tipo === "pilar" ? mb.tramo : Math.min(plantaNudo(b.nudos[0]), plantaNudo(b.nudos[1]));
  });
  const nl = m.laminas?.length ?? 0;
  const laminas = new Uint32Array(4 * nl);
  const plantaLamina = new Uint16Array(nl);
  const esMuro = new Uint8Array(nl);
  (m.laminas ?? []).forEach((l, i) => {
    laminas.set(l.nudos, 4 * i);
    plantaLamina[i] = Math.min(...l.nudos.map(plantaNudo));
    esMuro[i] = c.mapeo.laminas?.[i]?.muro ? 1 : 0;
  });
  return { valido: true, valor: { nudos, barras, tipoBarra, plantaBarra, laminas, plantaLamina, esMuro, plantas } };
}

/** Desplazamientos ux, uy, uz de cada nudo en una combinación (m). */
export function desplazamientos(s: Sesion, e: EleccionCombinaciones): Resultado<{ comb: string; etiqueta: string; u: Float32Array }> {
  const casos = s.casos;
  if (!casos) return no("visor/sin-resultados", "No hay resultados de esta huella.");
  const conj = s.conjunto(e, "desplazamientos");
  if (!conj.valido) return conj;
  if (conj.valor.factores.length !== 1) return no("visor/una-combinacion", "La deformada es de una sola combinación.");
  const f = conj.valor.factores[0]!;
  const n = casos[0]!.u.length / 6;
  const u = new Float32Array(3 * n);
  for (let i = 0; i < n; i++)
    for (let a = 0; a < 3; a++) {
      let v = 0;
      for (let k = 0; k < f.length; k++) if (f[k]) v += f[k]! * casos[k]!.u[6 * i + a]!;
      u[3 * i + a] = v;
    }
  return { valido: true, valor: { comb: conj.valor.nombres[0]!, etiqueta: conj.valor.etiquetas[0]!, u } };
}

// ─── Revisión ───────────────────────────────────────────────────────────────────────────────────

export interface DatosRevision {
  documento: Bloque[];
  comprobaciones: Pick<Comprobacion, "codigo" | "titulo" | "estado" | "peor">[];
  avisos: number;
  /** sha256 del informe en Markdown: el que firma `fem firmar`. */
  sha256: string;
  firma: EstadoFirma | { error: string };
  /** Firmas de otras huellas en el fichero (el proyecto cambió desde que se firmaron). */
  otrasHuellas: number;
}

/** La revisión de A3, como `fem revisar`, y el estado de su firma en el fichero de firmas (su texto, o vacío). */
export function datosRevision(s: Sesion, textoFirmas: string, ficheroFirmas: string): Resultado<DatosRevision> {
  const q = s.q;
  const c = s.compilado;
  const cab = s.cabeceraResultados;
  if (!q || !c || !cab) return no("visor/sin-resultados", "No hay resultados de esta huella.");
  const rev = revisar(s.proyecto, c, q, {
    motor: s.motor,
    diagnosticos: [...c.diagnosticos, ...cab.diagnosticos],
    equilibrio: cab.casos.map((x) => ({ id: x.id, ...x.equilibrio })),
    ficheroFirmas,
  });
  const sha = sha256(rev.markdown);
  const fichero = leerFirmas(textoFirmas);
  return {
    valido: true,
    valor: {
      documento: rev.documento,
      comprobaciones: rev.comprobaciones.map((x) => ({ codigo: x.codigo, titulo: x.titulo, estado: x.estado, ...(x.peor ? { peor: x.peor } : {}) })),
      avisos: rev.avisos.length,
      sha256: sha,
      firma: "error" in fichero ? fichero : estadoFirma(fichero, s.huella, sha),
      otrasHuellas: "error" in fichero ? 0 : fichero.firmas.filter((x) => x.huella !== s.huella).length,
    },
  };
}
