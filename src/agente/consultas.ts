/**
 * Resumen y consultas de la capa de agente (A1, `docs/fem3d/agente.md` §3 y §7): lo que un agente
 * necesita para iterar sobre un modelo sin volcar el JSON ni los resultados, en una salida acotada
 * (el tope del criterio 2 de A1, medido en el edificio objetivo).
 *
 * Todo sale de las consultas por objeto físico de C5 (`Consultas`) y de `EsfuerzosPiezas`, nunca
 * por proximidad, con sus convenios (cabecera de `compilador/consultas.ts`): kN y m; esfuerzos
 * [N, Vy, Vz, T, My, Mz] en los ejes locales de la pieza, con N > 0 tracción y, en una viga, My > 0
 * tracciona la cara inferior; desplazamientos y reacciones en ejes globales; flechas positivas
 * hacia abajo.
 *
 * Los máximos sobre una región (una pieza, un vano, una losa, una planta) se buscan en cada
 * combinación del conjunto (`combinaciones.ts`) y dicen cuál gobierna. En las barras son exactos:
 * los extremos del diagrama combinado en sus estaciones (extremos, cuartos, puntos de carga y los
 * ceros de Vz y Vy, H36). La flecha de una vigueta, que no tiene nudos intermedios, es el extremo
 * de su deformada (un polinomio por tramo) con sus raíces refinadas por bisección.
 *
 * Puro: entra lo compilado y calculado y salen objetos JSON; la CLI los escribe.
 */
import { DiagramaBarra } from "../elementos/cargasBarra.ts";
import { resultanteAnalitica } from "../compilador/cargas.ts";
import type { ResultadoCompilacion } from "../compilador/compilar.ts";
import type { Consultas } from "../compilador/consultas.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import { DELTA_MUESTRAS } from "../compilador/esfuerzosFranjas.ts";
import type { ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { EsfuerzosPiezas } from "../compilador/resultados.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { ModeloAnalitico } from "../motor/modelo.ts";
import type { ConjuntoCombinaciones, Proposito } from "./combinaciones.ts";
import type { Proyecto } from "./proyecto.ts";
import type { ArmadoProyecto } from "./armaduraBase.ts";
import { ARMADURAS, losasDe, refuerzosDe, type Armadura, type ZonaRefuerzo } from "./refuerzos.ts";

export type Respuesta<T> = { valido: true; valor: T; diagnosticos: Diagnostico[] } | { valido: false; diagnosticos: Diagnostico[] };

export const CONSULTAS = ["envolventes", "flechas", "deriva", "reacciones", "pieza", "banda", "franjas", "franja", "refuerzos", "combinaciones"] as const;
export type NombreConsulta = (typeof CONSULTAS)[number];

/** Elementos de una lista que se dan por defecto (los mayores); `todos` los da todos. */
export const TOP_POR_DEFECTO = 10;

export interface OpcionesConsulta {
  /** Sólo esta planta (envolventes, deriva). */
  planta?: string;
  /** Sólo este tipo de pieza (envolventes): pilar, viga o vigueta. */
  tipo?: string;
  /** Sólo este objeto (reacciones). */
  objeto?: string;
  /** Sólo esta losa o paño (flechas). */
  losa?: string;
  /** Id de la pieza, de la banda o de la franja (pieza, banda, franja). */
  id?: string;
  top?: number;
  todos?: boolean;
  /** pieza: el diagrama por estaciones (con una sola combinación). */
  estaciones?: boolean;
  /** refuerzos: la armadura (x-inf, x-sup, y-inf o y-sup). */
  armadura?: string;
  /** refuerzos: la armadura base del proyecto (AB). */
  armado?: ArmadoProyecto;
  /** El conjunto de combinaciones de cada propósito (el elegido o el de por defecto). */
  combinaciones: (p: Proposito) => Respuesta<ConjuntoCombinaciones>;
}

/** Un extremo: su valor, dónde (pieza y estación, o punto) y la combinación que lo da. */
export interface Extremo {
  v: number;
  pieza?: string;
  s?: number;
  punto?: readonly number[];
  comb: string;
}

const no = <T>(codigo: string, mensaje: string, ids?: string[]): Respuesta<T> => ({ valido: false, diagnosticos: [{ codigo, severidad: "error", mensaje, ...(ids ? { ids } : {}) }] });
const si = <T>(valor: T, diagnosticos: Diagnostico[] = []): Respuesta<T> => ({ valido: true, valor, diagnosticos });

const area = (p: readonly Vec2[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i]!;
    const [x1, y1] = p[(i + 1) % p.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
};
const longitud = (p: readonly Vec2[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i]![0], q[1] - p[i]![1]), 0);

// ─── Resumen ────────────────────────────────────────────────────────────────────────────────────

export interface ResumenPlanta {
  id: string;
  /** Cota del forjado y altura hasta la planta de encima, m. */
  cota: number;
  altura: number | null;
  diafragma: "rigido" | "ninguno";
  /** Tramos de pilar con su cabeza en la planta, por sección. */
  pilares?: Record<string, number>;
  vigas?: { n: number; m: number };
  losas?: { id: string; m2: number; espesor: number; tipo: "maciza" | "reticular" }[];
  panos?: { id: string; m2: number; direccion: number; intereje: number }[];
  /** Tramos de muro que llegan a la planta: número y longitud en planta. */
  muros?: { n: number; m: number };
  /** Carga vertical por caso (−ΣFz de lo que recibe la planta, kN; el peso propio incluido). */
  cargas: Record<string, number>;
  /** Carga horizontal por caso, [ΣFx, ΣFy] (kN), sólo de los casos que la tienen en la planta (A-8). */
  horizontales?: Record<string, [number, number]>;
}

export interface Resumen {
  nombre?: string;
  huella: string;
  objetos: Record<string, number>;
  analitico: { nudos: number; barras: number; laminas: number };
  plantas: ResumenPlanta[];
  /** Por caso: ΣF (kN) de todas sus cargas, el peso propio incluido. */
  casos: { id: string; accion?: string; pesoPropio?: true; F: number[] }[];
  /** Avisos de la compilación por código (los mensajes, con `fem validar`). */
  avisos: Record<string, number>;
  /** Hipótesis de modelado (el texto, con `fem compilar`). */
  hipotesis: number;
}

/**
 * Planta de cada carga analítica: la del nudo más alto del elemento que la recibe (un tramo de
 * pilar o un paño de muro cargan la planta de su cabeza, como en `TramoPilar`).
 */
export function cargasPorPlanta(c: Extract<ResultadoCompilacion, { valido: true }>, plantas: readonly string[]): Map<string, ModeloAnalitico> {
  const { modelo, mapeo } = c;
  const plantaNudos = (ns: readonly number[]) => {
    let mejor = ns[0]!;
    for (const n of ns) if (modelo.nudos[n]!.z > modelo.nudos[mejor]!.z) mejor = n;
    return mapeo.nudos[mejor]!.planta;
  };
  const r = new Map<string, ModeloAnalitico>();
  for (const p of plantas)
    r.set(p, {
      ...modelo,
      casos: modelo.casos.map((caso) => ({
        id: caso.id,
        nodales: (caso.nodales ?? []).filter((x) => mapeo.nudos[x.nudo]!.planta === p),
        barras: (caso.barras ?? []).filter((x) => plantaNudos(modelo.barras![x.barra]!.nudos) === p),
        laminas: (caso.laminas ?? []).filter((x) => plantaNudos(modelo.laminas![x.lamina]!.nudos) === p),
      })),
    });
  return r;
}

/** El modelo en unas líneas por planta (A1). No necesita el cálculo. */
export function resumen(p: Proyecto, c: Extract<ResultadoCompilacion, { valido: true }>): Respuesta<Resumen> {
  const f: ModeloFisico = p.modelo;
  const ids = f.plantas.map((x) => x.id);
  const k = new Map(ids.map((id, i) => [id, i]));
  const cotas = cotasPlantas(f.plantas) as number[];
  const porPlanta = cargasPorPlanta(c, ids);
  const secc = (pl: string, pi: { seccion: string; tramos?: readonly { planta: string; seccion: string }[] }) => pi.tramos?.find((t) => t.planta === pl)?.seccion ?? pi.seccion;
  const conDiafragma = new Set(c.modelo.restricciones?.filter((x) => x.tipo === "diafragma").map((x) => x.id.slice(0, -":diafragma".length)));
  const plantas: ResumenPlanta[] = f.plantas.map((pl, i) => {
    const r: ResumenPlanta = { id: pl.id, cota: cotas[i]!, altura: pl.altura, diafragma: conDiafragma.has(pl.id) ? "rigido" : "ninguno", cargas: {} };
    const pil: Record<string, number> = {};
    for (const x of f.pilares ?? []) {
      const [kh, kb] = [k.get(x.hasta)!, k.get(x.desde)!];
      if (i >= kh && i < kb) pil[secc(pl.id, x)] = (pil[secc(pl.id, x)] ?? 0) + 1;
    }
    if (Object.keys(pil).length) r.pilares = pil;
    const vigas = (f.vigas ?? []).filter((v) => v.planta === pl.id);
    if (vigas.length) r.vigas = { n: vigas.length, m: vigas.reduce((s, v) => s + longitud(v.puntos), 0) };
    const losas = (f.losas ?? []).filter((l) => l.planta === pl.id);
    if (losas.length) r.losas = losas.map((l) => ({ id: l.id, m2: area(l.contorno) - (l.huecos ?? []).reduce((s, h) => s + area(h), 0), espesor: l.espesor, tipo: l.reticular ? "reticular" : "maciza" }));
    const panos = (f.panos ?? []).filter((x) => x.planta === pl.id);
    if (panos.length) r.panos = panos.map((x) => ({ id: x.id, m2: area(x.contorno) - (x.huecos ?? []).reduce((s, h) => s + area(h), 0), direccion: x.direccion, intereje: x.intereje }));
    const muros = (f.muros ?? []).filter((m) => i >= k.get(m.hasta)! && i < k.get(m.desde)!);
    if (muros.length) r.muros = { n: muros.length, m: muros.reduce((s, m) => s + longitud(m.puntos), 0) };
    const sub = porPlanta.get(pl.id)!;
    const hz: Record<string, [number, number]> = {};
    c.modelo.casos.forEach((caso, kc) => {
      const R = resultanteAnalitica(sub, kc, [0, 0, 0]);
      if (R.F[2] !== 0) r.cargas[caso.id] = -R.F[2];
      if (R.F[0] !== 0 || R.F[1] !== 0) hz[caso.id] = [R.F[0], R.F[1]];
    });
    if (Object.keys(hz).length) r.horizontales = hz;
    return r;
  });
  const avisos: Record<string, number> = {};
  for (const d of c.diagnosticos) if (d.severidad !== "error") avisos[d.codigo] = (avisos[d.codigo] ?? 0) + 1;
  const objetos: Record<string, number> = {};
  for (const clave of ["plantas", "pilares", "vigas", "losas", "panos", "muros", "apoyos", "apoyosLineales", "bandas", "casos", "cargas"] as const) {
    const n = (f[clave] as readonly unknown[] | undefined)?.length ?? 0;
    if (n) objetos[clave] = n;
  }
  return si({
    ...(p.nombre ? { nombre: p.nombre } : {}),
    huella: c.huella,
    objetos,
    analitico: { nudos: c.estadisticas.nudos, barras: c.estadisticas.barras, laminas: c.estadisticas.laminas },
    plantas,
    casos: f.casos.map((caso, kc) => {
      const R = resultanteAnalitica(c.modelo, kc, [0, 0, 0]);
      return { id: caso.id, ...(caso.accion ? { accion: caso.accion.tipo } : {}), ...(caso.pesoPropio ? { pesoPropio: true as const } : {}), F: [...R.F] };
    }),
    avisos,
    hipotesis: c.hipotesis.length,
  });
}

// ─── Envolventes de las piezas ──────────────────────────────────────────────────────────────────

const COMPONENTES = ["N", "Vy", "Vz", "T", "My", "Mz"] as const;

/**
 * Qué extremos se buscan en cada tipo de pieza: con + y − el máximo y el mínimo; sin signo, el de
 * mayor valor absoluto (con su signo).
 */
export const EXTREMOS: Record<"pilar" | "viga" | "vigueta", readonly string[]> = {
  pilar: ["N+", "N-", "Vy", "Vz", "My", "Mz"],
  viga: ["N+", "N-", "Vz", "My+", "My-"],
  vigueta: ["Vz", "My+", "My-"],
};

/** Diagrama de la barra `b` en la combinación de factores `f`. */
export function diagramaCombinado(ep: EsfuerzosPiezas, b: number, f: ArrayLike<number>): DiagramaBarra {
  const ks: number[] = [];
  for (let k = 0; k < f.length; k++) if (f[k]) ks.push(k);
  if (!ks.length) return DiagramaBarra.combinar([ep.diagrama(b, 0)], [0]);
  return DiagramaBarra.combinar(
    ks.map((k) => ep.diagrama(b, k)),
    ks.map((k) => f[k]!),
  );
}

/** Mejora `actual` con un candidato según el extremo: "X+" máximo, "X-" mínimo, "X" mayor |·|. */
function mejora(extremo: string, actual: Extremo | undefined, v: number): boolean {
  if (Number.isNaN(v)) return false;
  if (!actual) return true;
  if (extremo.endsWith("+")) return v > actual.v;
  if (extremo.endsWith("-")) return v < actual.v;
  return Math.abs(v) > Math.abs(actual.v);
}

export interface GrupoEnvolvente {
  tipo: "pilar" | "viga" | "vigueta";
  planta: string;
  piezas: number;
  extremos: Record<string, Extremo>;
  /** Vigas del grupo en el plano de un diafragma rígido: su axil no tiene valor (C1-d) y no entra en N+ ni N−. */
  axilSinValor?: number;
}

/**
 * Extremos de los esfuerzos por tipo de pieza y planta en todas las combinaciones del conjunto.
 * La planta de un tramo de pilar es la de su cabeza; la de una viga o una vigueta, la suya.
 */
export function envolventes(q: Consultas, conjunto: ConjuntoCombinaciones, o: { planta?: string; tipo?: string } = {}): Respuesta<{ combinaciones: string; grupos: GrupoEnvolvente[] }> {
  const { modelo, mapeo } = q;
  if (o.tipo && !(o.tipo in EXTREMOS)) return no("consulta/tipo", `El tipo de pieza «${o.tipo}» no existe: pilar, viga o vigueta.`);
  if (o.planta && !q.fisico.plantas.some((p) => p.id === o.planta)) return no("consulta/no-existe", `La planta ${o.planta} no existe.`, [o.planta]);
  const ep = new EsfuerzosPiezas(modelo, mapeo, q.casos);
  const plantaDe = (b: number) => {
    const m = mapeo.barras[b]!;
    return m.tipo === "pilar" ? q.fisico.plantas[m.tramo]!.id : mapeo.nudos[modelo.barras![b]!.nudos[0]]!.planta;
  };
  const grupos = new Map<string, GrupoEnvolvente & { ids: Set<string>; sinAxil: Set<string> }>();
  for (const [pieza, barras] of Object.entries(mapeo.piezas)) {
    let sinAxil: boolean | undefined;
    for (const b of barras) {
      const m = mapeo.barras[b]!;
      if (o.tipo && m.tipo !== o.tipo) continue;
      const planta = plantaDe(b);
      if (o.planta && planta !== o.planta) continue;
      const clave = `${m.tipo}@${planta}`;
      let g = grupos.get(clave);
      if (!g) grupos.set(clave, (g = { tipo: m.tipo, planta, piezas: 0, extremos: {}, ids: new Set(), sinAxil: new Set() }));
      g.ids.add(pieza);
      if (m.tipo === "viga") {
        if (sinAxil === undefined) {
          const v = q.viga(pieza);
          sinAxil = v.valido && v.valor.axilSinValor;
        }
        if (sinAxil) g.sinAxil.add(pieza);
      }
      const extremos = sinAxil ? EXTREMOS[m.tipo].filter((e) => !e.startsWith("N")) : EXTREMOS[m.tipo];
      conjunto.factores.forEach((f, kc) => {
        const D = diagramaCombinado(ep, b, f);
        for (const x of D.estaciones())
          for (const lado of [-1, 1] as const) {
            if ((x === 0 && lado < 0) || (x === D.L && lado > 0)) continue;
            const e = D.esfuerzosEn(x, lado);
            for (const ex of extremos) {
              const c = COMPONENTES.indexOf(ex.replace(/[+-]$/, "") as (typeof COMPONENTES)[number]);
              const v = e[c]!;
              if (mejora(ex, g.extremos[ex], v)) g.extremos[ex] = { v, pieza, s: m.s[1] + x, comb: conjunto.nombres[kc]! };
            }
          }
      });
    }
  }
  const orden = q.fisico.plantas.map((p) => p.id);
  const lista = [...grupos.values()]
    .sort((a, b) => orden.indexOf(a.planta) - orden.indexOf(b.planta) || a.tipo.localeCompare(b.tipo))
    .map(({ ids, sinAxil, ...g }) => ({ ...g, piezas: ids.size, ...(sinAxil.size ? { axilSinValor: sinAxil.size } : {}) }));
  if (!lista.length) return no("consulta/sin-piezas", `No hay piezas${o.tipo ? ` de tipo ${o.tipo}` : ""}${o.planta ? ` en la planta ${o.planta}` : ""}.`);
  return si({ combinaciones: conjunto.descripcion, grupos: lista });
}

// ─── Flechas ────────────────────────────────────────────────────────────────────────────────────

/**
 * Extremos de un polinomio por tramos (coeficientes en x − xₖ, grado ≤ 5) en [0, L]: sus valores en
 * los cortes y en las raíces de su derivada, aisladas en 32 subintervalos por tramo y refinadas por
 * bisección hasta la precisión de la máquina.
 */
function puntosCriticos(t: { cortes: Float64Array; c: Float64Array; nTramos: number }, L: number): number[] {
  const NC = t.c.length / t.nTramos;
  const xs = new Set<number>([0, L, ...t.cortes]);
  for (let k = 0; k < t.nTramos; k++) {
    const x0 = t.cortes[k]!;
    const h = t.cortes[k + 1]! - x0;
    if (!(h > 0)) continue;
    const der = (u: number) => {
      let s = 0;
      for (let p = NC - 1; p >= 1; p--) s = s * u + p * t.c[NC * k + p]!;
      return s;
    };
    const N = 32;
    let ua = 0;
    let da = der(0);
    for (let i = 1; i <= N; i++) {
      const ub = (h * i) / N;
      const db = der(ub);
      if (da === 0) xs.add(x0 + ua);
      else if (da * db < 0) {
        let [a, b, fa] = [ua, ub, da];
        for (let it = 0; it < 200 && b - a > 1e-15 * Math.max(1, Math.abs(b)); it++) {
          const m = (a + b) / 2;
          const fm = der(m);
          if (fm === 0) [a, b] = [m, m];
          else if (fa * fm < 0) b = m;
          else [a, fa] = [m, fm];
        }
        xs.add(x0 + (a + b) / 2);
      }
      [ua, da] = [ub, db];
    }
  }
  return [...xs].filter((x) => x >= 0 && x <= L).sort((a, b) => a - b);
}

export interface FlechasLosa {
  id: string;
  planta: string;
  tipo: "losa" | "pano";
  /** La mayor flecha absoluta (hacia abajo, m). */
  maxima: Extremo;
  /** La mayor relativa: a las esquinas de su recuadro (losas) o a los extremos de su vano (viguetas). */
  relativa: (Extremo & { pilares?: readonly string[] }) | null;
}

/** Flechas de cada losa y de cada paño en todas las combinaciones del conjunto. */
export function flechas(q: Consultas, conjunto: ConjuntoCombinaciones, o: { losa?: string } = {}): Respuesta<FlechasLosa[]> {
  const r: FlechasLosa[] = [];
  const diags: Diagnostico[] = [];
  const losas = (q.fisico.losas ?? []).filter((l) => !o.losa || l.id === o.losa);
  const panos = (q.fisico.panos ?? []).filter((p) => !o.losa || p.id === o.losa);
  if (o.losa && !losas.length && !panos.length) return no("consulta/no-existe", `No hay ninguna losa ni paño ${o.losa}.`, [o.losa]);
  for (const l of losas) {
    let maxima: Extremo | undefined;
    let relativa: FlechasLosa["relativa"] = null;
    for (let kc = 0; kc < conjunto.factores.length; kc++) {
      const fl = q.flechas(l.id, conjunto.factores[kc]!);
      if (!fl.valido) return fl;
      const comb = conjunto.nombres[kc]!;
      const m = fl.valor.maxima;
      if (!maxima || m.flecha > maxima.v) maxima = { v: m.flecha, punto: m.punto, comb };
      for (const rc of fl.valor.recuadros) if (rc.maxima && (!relativa || rc.maxima.flecha > relativa.v)) relativa = { v: rc.maxima.flecha, punto: rc.maxima.punto, comb, pilares: rc.pilares };
    }
    r.push({ id: l.id, planta: l.planta, tipo: "losa", maxima: maxima!, relativa });
  }
  if (panos.length) {
    const ep = new EsfuerzosPiezas(q.modelo, q.mapeo, q.casos);
    for (const p of panos) {
      let maxima: Extremo | undefined;
      let relativa: Extremo | null = null;
      for (const vig of q.mapeo.panos?.[p.id] ?? [])
        for (const b of q.mapeo.piezas[vig] ?? []) {
          const s0 = q.mapeo.barras[b]!.s[1];
          conjunto.factores.forEach((f, kc) => {
            const D = diagramaCombinado(ep, b, f);
            const uz = D.desplazamientos[2]!;
            const [u0, uL] = [D.desplazamientosEn(0)[2]!, D.desplazamientosEn(D.L)[2]!];
            const comb = conjunto.nombres[kc]!;
            // Puntos críticos de la deformada y de la deformada menos su cuerda (misma derivada salvo una constante)
            const xs = new Set([...puntosCriticos(uz, D.L), ...puntosCriticos(restarCuerda(uz, u0, uL, D.L), D.L)]);
            for (const x of xs) {
              const u = D.desplazamientosEn(x)[2]!;
              const rel = u0 + ((uL - u0) * x) / D.L - u;
              if (!maxima || -u > maxima.v) maxima = { v: -u, pieza: vig, s: s0 + x, comb };
              if (!relativa || rel > relativa.v) relativa = { v: rel, pieza: vig, s: s0 + x, comb };
            }
          });
        }
      if (!maxima) {
        diags.push({ codigo: "consulta/sin-viguetas", severidad: "aviso", mensaje: `El paño ${p.id} no tiene viguetas.`, ids: [p.id] });
        continue;
      }
      r.push({ id: p.id, planta: p.planta, tipo: "pano", maxima, relativa });
    }
  }
  if (!r.length) return no("consulta/sin-losas", "El modelo no tiene losas ni paños.");
  return si(r, diags);
}

/** Tramos de u(x) − cuerda(x): mismos cortes, con la recta restada a cada tramo. */
function restarCuerda(t: { cortes: Float64Array; c: Float64Array; nTramos: number }, u0: number, uL: number, L: number) {
  const NC = t.c.length / t.nTramos;
  const c = Float64Array.from(t.c);
  const pendiente = (uL - u0) / L;
  for (let k = 0; k < t.nTramos; k++) {
    const x0 = t.cortes[k]!;
    c[NC * k] -= u0 + pendiente * x0;
    c[NC * k + 1] -= pendiente;
  }
  return { cortes: t.cortes, c, nTramos: t.nTramos };
}

// ─── Deriva ─────────────────────────────────────────────────────────────────────────────────────

export interface DerivaPlanta {
  planta: string;
  altura: number;
  /** El mayor desplome relativo (d/h) entre la planta y la de abajo, con su pilar. */
  desplome: (Extremo & { d: number }) | null;
  /** Desplazamiento del maestro del diafragma rígido, en su punto (ux, uy, m; rz, rad): el mayor |·| de cada uno. */
  maestro: { punto: readonly number[]; ux: Extremo; uy: Extremo; rz: Extremo } | null;
}

export function deriva(q: Consultas, conjunto: ConjuntoCombinaciones, o: { planta?: string } = {}): Respuesta<DerivaPlanta[]> {
  const plantas = q.fisico.plantas.filter((p) => !o.planta || p.id === o.planta);
  if (!plantas.length) return no("consulta/no-existe", `La planta ${o.planta} no existe.`, [o.planta!]);
  const nc = q.casos.length;
  const r: DerivaPlanta[] = [];
  for (const p of plantas) {
    const pc = q.planta(p.id);
    if (!pc.valido) return pc;
    let maestro: DerivaPlanta["maestro"] = null;
    const m = pc.valor.maestro;
    if (m) {
      const ext: Record<"ux" | "uy" | "rz", Extremo | undefined> = { ux: undefined, uy: undefined, rz: undefined };
      conjunto.factores.forEach((f, kc) => {
        (["ux", "uy", "rz"] as const).forEach((c, i) => {
          let v = 0;
          for (let k = 0; k < nc; k++) if (f[k]) v += f[k]! * m.u[3 * k + i]!;
          if (mejora(c, ext[c], v)) ext[c] = { v, comb: conjunto.nombres[kc]! };
        });
      });
      maestro = { punto: m.punto, ux: ext.ux!, uy: ext.uy!, rz: ext.rz! };
    }
    let desplome: DerivaPlanta["desplome"] = null;
    let altura = Number.NaN;
    const k = q.fisico.plantas.indexOf(p);
    if (k + 1 < q.fisico.plantas.length) {
      for (let kc = 0; kc < conjunto.factores.length; kc++) {
        const d = q.desplomes(p.id, conjunto.factores[kc]!);
        if (!d.valido) return d;
        altura = d.valor.altura;
        const x = d.valor.maximo;
        if (x && (!desplome || x.relativo > desplome.v)) desplome = { v: x.relativo, d: x.d, pieza: x.pilar, comb: conjunto.nombres[kc]! };
      }
    }
    if (!maestro && !desplome) continue;
    r.push({ planta: p.id, altura, desplome, maestro });
  }
  return si(r);
}

// ─── Reacciones ─────────────────────────────────────────────────────────────────────────────────

export interface Reacciones {
  /** Suma de todas las reacciones por combinación: [Fx, Fy, Fz] (kN) y [Mx, My, Mz] (kN·m) respecto al origen. */
  totales: { comb: string; F: number[]; M: number[] }[];
  /** Resultante de cada objeto con reacciones, respecto al centro de sus nudos: [Fx…Mz] por combinación. */
  objetos: { id: string; punto: readonly number[]; R: number[][] }[];
  /** Objetos con reacciones que no se listan (los de menor |Fz|). */
  omitidos: number;
}

export function reacciones(q: Consultas, conjunto: ConjuntoCombinaciones, o: { objeto?: string; top?: number; todos?: boolean } = {}): Respuesta<Reacciones> {
  const nc = q.casos.length;
  const comb = (porCaso: ArrayLike<number>, n: number, f: ArrayLike<number>) => {
    const v = new Array<number>(n).fill(0);
    for (let k = 0; k < nc; k++) if (f[k]) for (let i = 0; i < n; i++) v[i]! += f[k]! * porCaso[n * k + i]!;
    return v;
  };
  // Totales: por caso, la suma sobre todos los nudos respecto al origen
  const T = new Float64Array(6 * nc);
  q.casos.forEach((c, k) => {
    q.modelo.nudos.forEach((nd, n) => {
      const R = c.reacciones;
      const [Fx, Fy, Fz] = [R[6 * n]!, R[6 * n + 1]!, R[6 * n + 2]!];
      if (!Fx && !Fy && !Fz && !R[6 * n + 3] && !R[6 * n + 4] && !R[6 * n + 5]) return;
      T[6 * k] += Fx;
      T[6 * k + 1] += Fy;
      T[6 * k + 2] += Fz;
      T[6 * k + 3] += R[6 * n + 3]! + nd.y * Fz - nd.z * Fy;
      T[6 * k + 4] += R[6 * n + 4]! + nd.z * Fx - nd.x * Fz;
      T[6 * k + 5] += R[6 * n + 5]! + nd.x * Fy - nd.y * Fx;
    });
  });
  const totales = conjunto.factores.map((f, kc) => {
    const v = comb(T, 6, f);
    return { comb: conjunto.nombres[kc]!, F: v.slice(0, 3), M: v.slice(3) };
  });
  const f = q.fisico;
  const candidatos = o.objeto
    ? [o.objeto]
    : [...(f.pilares ?? []).filter((p) => p.base !== "ninguno").map((p) => p.id), ...(f.muros ?? []).filter((m) => m.base !== "ninguno").map((m) => m.id), ...(f.apoyos ?? []).map((a) => a.id), ...(f.apoyosLineales ?? []).map((a) => a.id)];
  const objetos: Reacciones["objetos"] = [];
  const diags: Diagnostico[] = [];
  for (const id of candidatos) {
    const r = q.reacciones(id);
    if (!r.valido) {
      if (o.objeto) return r;
      diags.push(...r.diagnosticos.map((d) => ({ ...d, severidad: "aviso" as const })));
      continue;
    }
    if (!r.valor.nudos && !o.objeto) continue;
    objetos.push({ id, punto: r.valor.punto, R: conjunto.factores.map((fa) => comb(r.valor.resultante, 6, fa)) });
  }
  const fz = (x: Reacciones["objetos"][number]) => Math.max(...x.R.map((v) => Math.abs(v[2]!)));
  objetos.sort((a, b) => fz(b) - fz(a));
  const n = o.todos ? objetos.length : (o.top ?? TOP_POR_DEFECTO);
  return si({ totales, objetos: objetos.slice(0, n), omitidos: Math.max(0, objetos.length - n) }, diags);
}

// ─── Una pieza ──────────────────────────────────────────────────────────────────────────────────

export interface VanoEnvolvente {
  desde: number;
  hasta: number;
  apoyos: [string | null, string | null];
  torsionEquilibrio?: true;
  extremos: Record<string, Extremo>;
}

export interface TramoEnvolvente {
  planta: string;
  seccion: string;
  longitud: number;
  /** En la base y en la cabeza del tramo flexible: el máximo y el mínimo de N y el mayor |My| y |Mz|, cada uno con sus [N, Vy, Vz, T, My, Mz] concomitantes. */
  base: Record<string, { comb: string; esfuerzos: number[] }>;
  cabeza: Record<string, { comb: string; esfuerzos: number[] }>;
}

export function pieza(q: Consultas, conjunto: ConjuntoCombinaciones, id: string | undefined, o: { estaciones?: boolean } = {}): Respuesta<unknown> {
  if (!id) return no("consulta/sin-id", "La consulta «pieza» necesita el id de la pieza (fem consultar <proyecto> pieza <id>).");
  if (o.estaciones) {
    if (conjunto.factores.length !== 1) return no("consulta/una-combinacion", `El diagrama por estaciones es de una sola combinación y hay ${conjunto.factores.length}: use --caso o --combinacion.`);
    const d = q.diagrama(id, conjunto.factores[0]!);
    if (!d.valido) return d;
    return si({ pieza: id, comb: conjunto.nombres[0], estaciones: d.valor.map((e) => ({ s: e.s, izquierda: e.izquierda, derecha: e.derecha })) });
  }
  const nc = q.casos.length;
  if (q.fisico.pilares?.some((p) => p.id === id)) {
    const r = q.pilar(id);
    if (!r.valido) return r;
    const extremo = (porCaso: Float64Array) => {
      const ext: Record<string, { comb: string; esfuerzos: number[] }> = {};
      const valor: Record<string, number> = {};
      conjunto.factores.forEach((f, kc) => {
        const e = [0, 0, 0, 0, 0, 0];
        for (let k = 0; k < nc; k++) if (f[k]) for (let i = 0; i < 6; i++) e[i]! += f[k]! * porCaso[6 * k + i]!;
        for (const [nombre, c] of [["N+", 0], ["N-", 0], ["My", 4], ["Mz", 5]] as const) {
          const v = e[c]!;
          if (mejora(nombre, nombre in valor ? { v: valor[nombre]!, comb: "" } : undefined, v)) {
            valor[nombre] = v;
            ext[nombre] = { comb: conjunto.nombres[kc]!, esfuerzos: e };
          }
        }
      });
      return ext;
    };
    const tramos: TramoEnvolvente[] = r.valor.map((t) => ({ planta: t.planta, seccion: t.seccion, longitud: t.longitud, base: extremo(t.base.esfuerzos), cabeza: extremo(t.cabeza.esfuerzos) }));
    return si({ pieza: id, tipo: "pilar", combinaciones: conjunto.descripcion, tramos }, r.diagnosticos);
  }
  const v = q.viga(id);
  if (!v.valido) return no("consulta/no-existe", `No hay ninguna pieza ${id} (ni pilar, ni viga, ni vigueta).`, [id]);
  const vanos: VanoEnvolvente[] = [];
  for (let i = 0; i < v.valor.vanos.length; i++) {
    const va = v.valor.vanos[i]!;
    const ext: Record<string, Extremo> = {};
    for (let kc = 0; kc < conjunto.factores.length; kc++) {
      const e = q.vano(id, i, conjunto.factores[kc]!);
      if (!e.valido) return e;
      const comb = conjunto.nombres[kc]!;
      const x = e.valor;
      if (mejora("My+", ext["My+"], x.maxMy.valor)) ext["My+"] = { v: x.maxMy.valor, s: x.maxMy.s, comb };
      if (mejora("My-", ext["My-"], x.minMy.valor)) ext["My-"] = { v: x.minMy.valor, s: x.minMy.s, comb };
      for (const c of [x.maxVz, x.minVz]) if (mejora("Vz", ext.Vz, c.valor)) ext.Vz = { v: c.valor, s: c.s, comb };
    }
    vanos.push({ desde: va.desde, hasta: va.hasta, apoyos: [va.apoyoInicio?.objeto ?? null, va.apoyoFin?.objeto ?? null], ...(va.torsionEquilibrio ? { torsionEquilibrio: true as const } : {}), extremos: ext });
  }
  return si({ pieza: id, tipo: v.valor.tipo, combinaciones: conjunto.descripcion, ...(v.valor.axilSinValor ? { axilSinValor: true } : {}), vanos }, v.diagnosticos);
}

// ─── Una banda ──────────────────────────────────────────────────────────────────────────────────

export interface EstacionEnvolvente {
  s: number;
  tipo: "cara" | "vano";
  /** Ancho de la banda en las losas, m, si no es el de la banda (un hueco o un borde). */
  anchoEnLosa?: number;
  /** My de la banda (kN·m, en sus ejes; > 0 tracciona la cara inferior): [máximo, su combinación] y [mínimo, la suya]. */
  max: [number, string];
  min: [number, string];
  /** Sólo si la estación no vale (cae entera en un hueco, por ejemplo). */
  valido?: false;
}

export function banda(q: Consultas, conjunto: ConjuntoCombinaciones, id: string | undefined): Respuesta<{ banda: string; combinaciones: string; ancho: number; estaciones: EstacionEnvolvente[] }> {
  if (!id) return no("consulta/sin-id", "La consulta «banda» necesita el id de la banda (fem consultar <proyecto> banda <id>).");
  const r = q.banda(id);
  if (!r.valido) return r;
  const nc = q.casos.length;
  const ancho = q.fisico.bandas!.find((b) => b.id === id)!.ancho;
  const estaciones = r.valor.map((e): EstacionEnvolvente => {
    let max: Extremo | undefined;
    let min: Extremo | undefined;
    conjunto.factores.forEach((f, kc) => {
      let v = 0;
      for (let k = 0; k < nc; k++) if (f[k]) v += f[k]! * e.esfuerzos[6 * k + 4]!;
      if (mejora("+", max, v)) max = { v, comb: conjunto.nombres[kc]! };
      if (mejora("-", min, v)) min = { v, comb: conjunto.nombres[kc]! };
    });
    return {
      s: e.s,
      tipo: e.tipo,
      ...(e.anchoEnLosa !== ancho ? { anchoEnLosa: e.anchoEnLosa } : {}),
      max: max ? [max.v, max.comb] : [Number.NaN, ""],
      min: min ? [min.v, min.comb] : [Number.NaN, ""],
      ...(e.valido ? {} : { valido: false as const }),
    };
  });
  return si({ banda: id, combinaciones: conjunto.descripcion, ancho, estaciones }, r.diagnosticos);
}

// ─── Franjas de armado (fase F) ─────────────────────────────────────────────────────────────────

/** Un máximo de Wood–Armer en una franja: kN·m/m, su estación s (m, a lo largo) y su combinación. */
export interface DemandaFranja {
  v: number;
  s: number;
  comb: string;
}

export interface FilaFranja {
  id: string;
  losa: string;
  direccion: 1 | 2;
  /** Extensión transversal [t0, t1], m (t = p·n, `franjas.ts`). */
  t: [number, number];
  /** La mayor demanda de Wood–Armer de su armadura inferior y de la superior (null si no pide). */
  inferior: DemandaFranja | null;
  superior: DemandaFranja | null;
}

/**
 * Las franjas de armado de una losa, de una planta o de todas, con la mayor demanda de Wood–Armer
 * de su armadura inferior y superior en las combinaciones del conjunto (kN·m/m).
 */
export function franjas(q: Consultas, conjunto: ConjuntoCombinaciones, o: Pick<OpcionesConsulta, "losa" | "planta">): Respuesta<{ combinaciones: string; franjas: FilaFranja[] }> {
  if (o.losa !== undefined && !(q.fisico.losas ?? []).some((l) => l.id === o.losa)) return no("consulta/no-existe", `La losa «${o.losa}» no existe en el modelo (las franjas son de las losas macizas y reticulares).`, [o.losa]);
  const losas = (q.fisico.losas ?? []).filter((l) => (o.losa === undefined || l.id === o.losa) && (o.planta === undefined || l.planta === o.planta));
  const filas: FilaFranja[] = [];
  const diagnosticos: Diagnostico[] = [];
  for (const l of losas) {
    const fs = q.franjas(l.id);
    if (!fs.valido) return fs;
    for (const f of fs.valor) {
      const r = q.franja(f.id);
      const a = q.armadoFranja(f.id, conjunto.factores);
      if (!r.valido) return r;
      if (!a.valido) return a;
      diagnosticos.push(...r.diagnosticos);
      let inferior: DemandaFranja | null = null;
      let superior: DemandaFranja | null = null;
      a.valor.forEach((e, i) => {
        const s = r.valor.estaciones[i]!.s;
        if (e.inferior > (inferior?.v ?? 0)) inferior = { v: e.inferior, s, comb: conjunto.nombres[e.combInferior]! };
        if (e.superior > (superior?.v ?? 0)) superior = { v: e.superior, s, comb: conjunto.nombres[e.combSuperior]! };
      });
      filas.push({ id: f.id, losa: f.losa, direccion: f.direccion, t: [f.t0, f.t1], inferior, superior });
    }
  }
  return si({ combinaciones: conjunto.descripcion, franjas: filas }, diagnosticos);
}

export interface EstacionFranjaEnvolvente {
  /** A lo largo de la franja (s = p·d), m. */
  s: number;
  tipo: "cara" | "apoyo" | "paso";
  /** En una cara o un apoyo, el lado que se toma (−1: s menores). */
  lado?: -1 | 1;
  /** Pilares de la cara que tocan la franja, o la pieza de la línea de apoyo. */
  piezas?: string[];
  /** Ancho en losa, m, si no es el de la franja (un hueco, un borde o una huella). */
  anchoEnLosa?: number;
  /**
   * En una cara o un apoyo, la distancia a la recta en la que se toman my y mxy, m, si no es δ (1 mm):
   * con un borde rígido detrás (el ancho de una viga, una huella, un apoyo lineal con giros coartados),
   * un canto de la losa o la mitad de lo libre hasta el siguiente apoyo (LV2-h). El mx es el de la recta.
   */
  distanciaMuestras?: number;
  /** mx medio (kN·m/m; > 0 tracciona la cara inferior): [máximo, su combinación] y [mínimo, la suya]. */
  max: [number, string];
  min: [number, string];
  /** Wood–Armer de la armadura de su dirección (kN·m/m): inferior y superior, con su combinación. */
  inferior: [number, string];
  superior: [number, string];
  /** En un reticular, la parte del ancho en ábacos (fuera de ellos, el momento por nervio es el medio por el intereje). */
  fraccionAbaco?: number;
  /** Sólo si la estación no vale. */
  valido?: false;
}

export function franja(q: Consultas, conjunto: ConjuntoCombinaciones, id: string | undefined): Respuesta<{ franja: string; losa: string; direccion: 1 | 2; ancho: number; intereje: number | null; combinaciones: string; estaciones: EstacionFranjaEnvolvente[] }> {
  if (!id) return no("consulta/sin-id", "La consulta «franja» necesita el id de la franja (fem consultar <proyecto> franja <losa>:X<i> o <losa>:Y<i>).");
  const r = q.franja(id);
  if (!r.valido) return r;
  const a = q.armadoFranja(id, conjunto.factores);
  if (!a.valido) return a;
  const f = r.valor.franja;
  const nombre = (c: number) => (c >= 0 ? conjunto.nombres[c]! : "");
  const estaciones = r.valor.estaciones.map((e, i): EstacionFranjaEnvolvente => {
    const w = a.valor[i]!;
    return {
      s: e.s,
      tipo: e.tipo,
      ...(e.lado ? { lado: e.lado } : {}),
      ...(e.piezas.length ? { piezas: e.piezas } : {}),
      ...(Math.abs(e.anchoEnLosa - f.ancho) > 1e-9 ? { anchoEnLosa: e.anchoEnLosa } : {}),
      ...(e.tipo !== "paso" && e.distanciaMuestras > DELTA_MUESTRAS + 1e-9 ? { distanciaMuestras: e.distanciaMuestras } : {}),
      max: [w.mxMax, nombre(w.combMax)],
      min: [w.mxMin, nombre(w.combMin)],
      inferior: [w.inferior, nombre(w.combInferior)],
      superior: [w.superior, nombre(w.combSuperior)],
      ...(e.fraccionAbaco !== null ? { fraccionAbaco: e.fraccionAbaco } : {}),
      ...(e.valido ? {} : { valido: false as const }),
    };
  });
  return si({ franja: id, losa: f.losa, direccion: f.direccion, ancho: f.ancho, intereje: f.intereje, combinaciones: conjunto.descripcion, estaciones }, r.diagnosticos);
}

// ─── Zonas de refuerzo (fase AB) ────────────────────────────────────────────────────────────────

/** Una zona de refuerzo sin sus tramos ni su contorno (los que dibuja la vista `armado`). */
export type FilaRefuerzo = Omit<ZonaRefuerzo, "tramos" | "contorno">;

/**
 * Las zonas de refuerzo de una armadura en una losa, una planta o todas (`docs/fem3d/armado.md`
 * §2.6): lo que supera la armadura base del proyecto, conexo, con su extensión y su máximo. Las losas
 * sin base en esa armadura se dicen aparte.
 */
export function refuerzos(q: Consultas, conjunto: ConjuntoCombinaciones, o: Pick<OpcionesConsulta, "losa" | "planta" | "armadura" | "armado">): Respuesta<{ combinaciones: string; armadura: Armadura; zonas: FilaRefuerzo[]; sinBase: string[] }> {
  const a = o.armadura;
  if (!a || !ARMADURAS.includes(a as Armadura)) return no("consulta/armadura", `La consulta «refuerzos» necesita la armadura: --armadura ${ARMADURAS.join(" | ")}.`);
  if (o.losa !== undefined && !(q.fisico.losas ?? []).some((l) => l.id === o.losa)) return no("consulta/no-existe", `La losa «${o.losa}» no existe en el modelo (las franjas son de las losas macizas y reticulares).`, [o.losa]);
  const r = refuerzosDe(q, losasDe(q, o), a as Armadura, conjunto, o.armado);
  if (!r.valido) return r;
  const zonas = r.valor.zonas.map(({ tramos: _t, contorno: _c, ...z }) => z);
  return si({ combinaciones: conjunto.descripcion, armadura: a as Armadura, zonas, sinBase: r.valor.sinBase });
}

// ─── Entrada común ──────────────────────────────────────────────────────────────────────────────

const PROPOSITO: Record<NombreConsulta, Proposito> = {
  envolventes: "esfuerzos",
  flechas: "desplazamientos",
  deriva: "desplazamientos",
  reacciones: "lineal",
  pieza: "esfuerzos",
  banda: "esfuerzos",
  franjas: "esfuerzos",
  franja: "esfuerzos",
  refuerzos: "esfuerzos",
  combinaciones: "esfuerzos",
};

export function consultar(q: Consultas, consulta: NombreConsulta, o: OpcionesConsulta): Respuesta<unknown> {
  const c = o.combinaciones(PROPOSITO[consulta]);
  if (!c.valido) return c;
  const conjunto = c.valor;
  switch (consulta) {
    case "combinaciones":
      return si({ descripcion: conjunto.descripcion, combinaciones: conjunto.nombres.map((n, i) => ({ nombre: n, etiqueta: conjunto.etiquetas[i] })) });
    case "envolventes":
      return envolventes(q, conjunto, o);
    case "flechas":
      return flechas(q, conjunto, o);
    case "deriva":
      return deriva(q, conjunto, o);
    case "reacciones":
      return reacciones(q, conjunto, o);
    case "pieza":
      return pieza(q, conjunto, o.id, o);
    case "banda":
      return banda(q, conjunto, o.id);
    case "franjas":
      return franjas(q, conjunto, o);
    case "franja":
      return franja(q, conjunto, o.id);
    case "refuerzos":
      return refuerzos(q, conjunto, o);
  }
}
