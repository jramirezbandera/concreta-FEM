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
 * Los factores de un conjunto son los de los casos lógicos (VS3, cabecera de
 * `compilador/consultas.ts`): aquí nadie los aplica a mano. Lo que es por caso base se combina con
 * `q.combinar`, y los diagramas, con `q.diagramaBarra`; con los casos del sismo del programa, cada
 * valor es la combinación de los de los modos.
 *
 * Puro: entra lo compilado y calculado y salen objetos JSON; la CLI los escribe.
 */
import { DiagramaBarra } from "../elementos/cargasBarra.ts";
import { resultanteAnalitica } from "../compilador/cargas.ts";
import type { ResultadoCompilacion } from "../compilador/compilar.ts";
import type { Consultas, ExtremoDiagrama, SegundoOrdenConsulta } from "../compilador/consultas.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import { DELTA_MUESTRAS } from "../compilador/esfuerzosFranjas.ts";
import type { EmplazamientoEdificio, ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import type { ObraProyecto } from "./obra.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { esfuerzosPartidos, recorrerDiagrama, type DiagramaLeible, type EsfuerzosPartidos } from "../motor/diagramaCompuesto.ts";
import type { ModeloAnalitico } from "../motor/modelo.ts";
import type { ConjuntoCombinaciones, Proposito } from "./combinaciones.ts";
import type { Proyecto } from "./proyecto.ts";
import type { ArmadoProyecto } from "./armaduraBase.ts";
import { ARMADURAS, losasDe, refuerzosDe, type Armadura, type ZonaRefuerzo } from "./refuerzos.ts";

export type Respuesta<T> = { valido: true; valor: T; diagnosticos: Diagnostico[] } | { valido: false; diagnosticos: Diagnostico[] };

export const CONSULTAS = ["envolventes", "flechas", "deriva", "reacciones", "pieza", "banda", "franjas", "franja", "refuerzos", "modos", "sismo", "segundo-orden", "combinaciones"] as const;
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
  /**
   * Los extremos de los vanos de una viga: [N, Vy, Vz, T, My, Mz] en ese punto, los concomitantes de la
   * combinación o, con el sismo del programa (`pesimos: true`), los de sus signos pésimos
   * (`esfuerzosPesimosViga`), para las comprobaciones que juntan varios esfuerzos.
   */
  esfuerzos?: number[];
  pesimos?: true;
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
  /** DO: los datos de la obra (uso y materiales por defecto) y el emplazamiento, si los tiene. */
  obra?: ObraProyecto & { emplazamiento?: EmplazamientoEdificio };
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
  const emplazamiento = f.acciones?.emplazamiento;
  const obra = p.obra || emplazamiento ? { ...p.obra, ...(emplazamiento ? { emplazamiento } : {}) } : undefined;
  return si({
    ...(p.nombre ? { nombre: p.nombre } : {}),
    ...(obra ? { obra } : {}),
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
export const EXTREMOS: Record<"pilar" | "viga" | "vigueta" | "barra", readonly string[]> = {
  pilar: ["N+", "N-", "Vy", "Vz", "My", "Mz"],
  viga: ["N+", "N-", "Vz", "My+", "My-"],
  vigueta: ["Vz", "My+", "My-"],
  barra: ["N+", "N-", "Vy", "Vz", "My", "Mz"],
};

/** Diagrama de la barra `b` en la combinación de factores `f` (los de los casos lógicos): `Consultas.diagramaBarra`. */
export function diagramaCombinado(q: Consultas, b: number, f: ArrayLike<number>): DiagramaLeible {
  return q.diagramaBarra(b, f);
}

/** Puntos de la barra en los que se muestrea la deformada de una combinación con casos del sismo. */
const MUESTRAS_DEFORMADA = 20;

/** Mejora `actual` con un candidato según el extremo: "X+" máximo, "X-" mínimo, "X" mayor |·|. */
function mejora(extremo: string, actual: Extremo | undefined, v: number): boolean {
  if (Number.isNaN(v)) return false;
  if (!actual) return true;
  if (extremo.endsWith("+")) return v > actual.v;
  if (extremo.endsWith("-")) return v < actual.v;
  return Math.abs(v) > Math.abs(actual.v);
}

export interface GrupoEnvolvente {
  /** Una barra entre dos niveles (fase BN) va en el grupo de la planta de su inicio. */
  tipo: "pilar" | "viga" | "vigueta" | "barra";
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
  if (o.tipo && !(o.tipo in EXTREMOS)) return no("consulta/tipo", `El tipo de pieza «${o.tipo}» no existe: pilar, viga, vigueta o barra.`);
  if (o.planta && !q.fisico.plantas.some((p) => p.id === o.planta)) return no("consulta/no-existe", `La planta ${o.planta} no existe.`, [o.planta]);
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
      // La componente de cada extremo, una vez (no en cada estación de cada combinación)
      const componentes = extremos.map((ex) => COMPONENTES.indexOf(ex.replace(/[+-]$/, "") as (typeof COMPONENTES)[number]));
      const grupo = g;
      conjunto.factores.forEach((f, kc) => {
        // (VS4: con casos del sismo, cada combinación se recorre por su rejilla, sin un vector por lectura)
        recorrerDiagrama(q.diagramaBarra(b, f), (x, _lado, e) => {
          for (let i = 0; i < extremos.length; i++) {
            const ex = extremos[i]!;
            const v = e[componentes[i]!]!;
            if (mejora(ex, grupo.extremos[ex], v)) grupo.extremos[ex] = { v, pieza, s: m.s[1] + x, comb: conjunto.nombres[kc]! };
          }
        });
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
    for (const p of panos) {
      let maxima: Extremo | undefined;
      let relativa: Extremo | null = null;
      for (const vig of q.mapeo.panos?.[p.id] ?? [])
        for (const b of q.mapeo.piezas[vig] ?? []) {
          const s0 = q.mapeo.barras[b]!.s[1];
          conjunto.factores.forEach((f, kc) => {
            const D = q.diagramaBarra(b, f);
            const comb = conjunto.nombres[kc]!;
            // La parte estática de la combinación: un polinomio por tramo
            const P = D instanceof DiagramaBarra ? D : D.lineal;
            const uz = P.desplazamientos[2]!;
            const [u0, uL] = [P.desplazamientosEn(0)[2]!, P.desplazamientosEn(P.L)[2]!];
            // Puntos críticos de la deformada y de la deformada menos su cuerda (misma derivada salvo una constante)
            const xs = new Set([...puntosCriticos(uz, D.L), ...puntosCriticos(restarCuerda(uz, u0, uL, D.L), D.L)]);
            if (D instanceof DiagramaBarra) {
              for (const x of xs) {
                const u = D.desplazamientosEn(x)[2]!;
                const rel = u0 + ((uL - u0) * x) / D.L - u;
                if (!maxima || -u > maxima.v) maxima = { v: -u, pieza: vig, s: s0 + x, comb };
                if (!relativa || rel > relativa.v) relativa = { v: rel, pieza: vig, s: s0 + x, comb };
              }
              return;
            }
            // Con casos del sismo la deformada no es un polinomio: además, muestreada a lo largo de la barra
            for (let i = 0; i <= MUESTRAS_DEFORMADA; i++) xs.add(i === MUESTRAS_DEFORMADA ? D.L : (D.L * i) / MUESTRAS_DEFORMADA);
            for (const x of xs) {
              const u = D.desplazamientosEn(x)[2]!;
              const rel = D.relativoEn(x)[2]!;
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
  const r: DerivaPlanta[] = [];
  for (const p of plantas) {
    const pc = q.planta(p.id);
    if (!pc.valido) return pc;
    let maestro: DerivaPlanta["maestro"] = null;
    const m = pc.valor.maestro;
    if (m) {
      const ext: Record<"ux" | "uy" | "rz", Extremo | undefined> = { ux: undefined, uy: undefined, rz: undefined };
      conjunto.factores.forEach((f, kc) => {
        const u = q.combinar(m.u, 3, f, true);
        (["ux", "uy", "rz"] as const).forEach((c, i) => {
          const v = u[i]!;
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
  const nc = q.nb;
  const comb = (porCaso: ArrayLike<number>, n: number, f: ArrayLike<number>): number[] => Array.from(q.combinar(porCaso, n, f));
  // Totales: por caso base, la suma sobre todos los nudos respecto al origen
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
    // Los nudos que comparte con otro objeto (A2-47): lo dice, y entran con su parte
    diags.push(...r.diagnosticos);
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

/** Un pésimo de un extremo de tramo de pilar: su combinación y sus [N, Vy, Vz, T, My, Mz]. */
export interface TernaPilar {
  comb: string;
  esfuerzos: number[];
  /** VS-o: la combinación lleva el sismo del programa y los esfuerzos son los de sus signos pésimos (`ternasPesimas`), no un estado simultáneo. */
  pesimos?: true;
}

export interface TramoEnvolvente {
  planta: string;
  seccion: string;
  longitud: number;
  /** En la base y en la cabeza del tramo flexible: el máximo y el mínimo de N y el mayor |My| y |Mz|, cada uno con sus [N, Vy, Vz, T, My, Mz] concomitantes. */
  base: Record<string, TernaPilar>;
  cabeza: Record<string, TernaPilar>;
}

/**
 * VS-o: las ternas de un extremo de pilar en una combinación con el sismo del programa (`partes`, de
 * `Superposicion.partir`). Tras combinar los modos, el sismo da en cada esfuerzo una amplitud sin signo
 * y no simultánea con la de los demás, así que no hay una terna concomitante: se dan las pésimas para
 * la flexocompresión. My, Mz, Vy, Vz y T, con el signo que aumenta su valor absoluto (para una sección
 * simétrica, el peor en los dos ejes); N, con los dos: primero la menor compresión (y, así, en un
 * empate del mayor |My| o |Mz| gana ésa, la peor para un pilar poco comprimido) y luego la mayor. Las
 * demás combinaciones de signos dan ternas con menos momento a igual N: ninguna es peor que éstas.
 */
export function ternasPesimas(partes: { estatica: ArrayLike<number>; sismo: ArrayLike<number> }): number[][] {
  if (!partes.sismo[0]) return [esfuerzosPesimos(partes)];
  return [esfuerzosPesimos(partes, { 0: 1 }), esfuerzosPesimos(partes, { 0: -1 })];
}

/**
 * VS-o: los esfuerzos de un extremo de vano de una viga en una combinación con el sismo del programa
 * (`partes`, de `Consultas.vano`), con sus signos pésimos para las comprobaciones que juntan varios: el
 * cortante con la torsión (las dos tensiones tangenciales se suman en una de las caras: la interacción
 * y las armaduras crecen con |Vz| y con |T|) y la flexión con el cortante (el decalaje, y la
 * interacción M–V del acero). Como en las ternas de los pilares (`ternasPesimas`), no es un estado
 * simultáneo: Vy, Vz, T y Mz, con el signo que aumenta su valor absoluto; My, con el que pide el
 * extremo (`my`: 1, el máximo; −1, el mínimo; 0, el que aumenta su valor absoluto); y N, con la
 * menor compresión (N > 0 tracciona), que baja la resistencia a cortante y aumenta la armadura de
 * tracción.
 */
export function esfuerzosPesimosViga(partes: { estatica: ArrayLike<number>; sismo: ArrayLike<number> }, my: 1 | -1 | 0): number[] {
  return esfuerzosPesimos(partes, my ? { 0: 1, 4: my } : { 0: 1 });
}

/**
 * VS-o: [N, Vy, Vz, T, My, Mz] con el sismo del programa en sus signos pésimos: los de `fijos` (por
 * componente), S + signo·A; los demás, con el signo que aumenta su valor absoluto. La regla común de
 * las ternas de los pilares, los extremos de las vigas y los de las barras.
 */
export function esfuerzosPesimos(partes: { estatica: ArrayLike<number>; sismo: ArrayLike<number> }, fijos: Partial<Record<number, 1 | -1>> = {}): number[] {
  const { estatica: S, sismo: A } = partes;
  return [0, 1, 2, 3, 4, 5].map((c) => {
    if (!A[c]) return S[c]!;
    const signo = fijos[c] ?? (S[c]! >= 0 ? 1 : -1);
    return S[c]! + signo * A[c]!;
  });
}

/**
 * VS-o: los esfuerzos de un extremo de una barra (fase BN) con el sismo del programa, en sus signos
 * pésimos. Una barra es casi siempre de acero, que se comprueba con la interacción de N con M (y de M
 * con V), creciente en |N|: N+ y N− con el suyo y, en los demás extremos, |N| aumentado como el resto.
 */
export function esfuerzosPesimosBarra(partes: { estatica: ArrayLike<number>; sismo: ArrayLike<number> }, extremo: string): number[] {
  return esfuerzosPesimos(partes, extremo === "N+" ? { 0: 1 } : extremo === "N-" ? { 0: -1 } : {});
}

/**
 * Lo que dice cómo leer los `esfuerzos` de `fem consultar pieza`, en la propia respuesta: un agente que
 * no ha leído la skill tomaba el orden por una suposición y, con el sismo del programa, la misma
 * combinación como N− y con tracción en otra fila por un error del programa (VS-o).
 */
export interface LeyendaEsfuerzos {
  orden: readonly ["N", "Vy", "Vz", "T", "My", "Mz"];
  unidades: string;
  convenio: string;
  /** Sólo si algún extremo lleva `pesimos: true`. */
  pesimos?: string;
}

const PESIMOS_COMUN =
  "Con el sismo del programa (pesimos: true), la combinación de los modos no tiene signo: en cada combinación el sismo suma ±A a la parte estática S de cada esfuerzo, y cada fila da los esfuerzos con sus signos pésimos, no un estado simultáneo.";

const PESIMOS: Record<"pilar" | "viga" | "barra", string> = {
  pilar:
    `${PESIMOS_COMUN} En un pilar, cada combinación da dos juegos, con N = S − A (más compresión) y N = S + A (menos compresión o tracción), y en los dos Vy, Vz, T, My y Mz con el signo que aumenta su valor absoluto. Por eso una misma combinación puede salir en N− con compresión y en otra fila (N+, My o Mz) con tracción y los mismos cortantes y momentos: no es un error. Se comprueba con todas las filas.`,
  viga: `${PESIMOS_COMUN} En una viga: Vy, Vz, T y Mz con el signo que aumenta su valor absoluto; My con el del extremo (My+ el máximo, My− el mínimo); N con la menor compresión.`,
  barra: `${PESIMOS_COMUN} En una barra: N+ y N− con el suyo; en los demás extremos, todos (también |N|) con el signo que aumenta su valor absoluto.`,
};

function leyendaEsfuerzos(tipo: "pilar" | "viga" | "barra", conPesimos: boolean): LeyendaEsfuerzos {
  return {
    orden: ["N", "Vy", "Vz", "T", "My", "Mz"],
    unidades: "kN y kN·m",
    convenio: "Ejes locales de la pieza, convenio de barras de la cabecera de modelo.ts (tipo CSI): N > 0 es tracción.",
    ...(conPesimos ? { pesimos: PESIMOS[tipo] } : {}),
  };
}

const algunoPesimo = (extremos: Iterable<{ pesimos?: true }>): boolean => {
  for (const e of extremos) if (e.pesimos) return true;
  return false;
};

export function pieza(q: Consultas, conjunto: ConjuntoCombinaciones, id: string | undefined, o: { estaciones?: boolean } = {}): Respuesta<unknown> {
  if (!id) return no("consulta/sin-id", "La consulta «pieza» necesita el id de la pieza (fem consultar <proyecto> pieza <id>).");
  if (o.estaciones) {
    if (conjunto.factores.length !== 1) return no("consulta/una-combinacion", `El diagrama por estaciones es de una sola combinación y hay ${conjunto.factores.length}: use --caso o --combinacion.`);
    const d = q.diagrama(id, conjunto.factores[0]!);
    if (!d.valido) return d;
    return si({ pieza: id, comb: conjunto.nombres[0], estaciones: d.valor.map((e) => ({ s: e.s, izquierda: e.izquierda, derecha: e.derecha })) });
  }
  if (q.fisico.pilares?.some((p) => p.id === id)) {
    const r = q.pilar(id);
    if (!r.valido) return r;
    const extremo = (porCaso: Float64Array) => {
      const ext: Record<string, TernaPilar> = {};
      const valor: Record<string, number> = {};
      conjunto.factores.forEach((f, kc) => {
        // VS-o: con el sismo del programa, las ternas de los signos pésimos (`ternasPesimas`)
        const sismo = !q.sup.esLineal(f);
        const ternas = sismo ? ternasPesimas(q.sup.partir(porCaso, 6, f)) : [Array.from(q.combinar(porCaso, 6, f))];
        for (const e of ternas)
          for (const [nombre, c] of [["N+", 0], ["N-", 0], ["My", 4], ["Mz", 5]] as const) {
            const v = e[c]!;
            if (mejora(nombre, nombre in valor ? { v: valor[nombre]!, comb: "" } : undefined, v)) {
              valor[nombre] = v;
              ext[nombre] = { comb: conjunto.nombres[kc]!, esfuerzos: e, ...(sismo ? { pesimos: true as const } : {}) };
            }
          }
      });
      return ext;
    };
    const tramos: TramoEnvolvente[] = r.valor.map((t) => ({ planta: t.planta, seccion: t.seccion, longitud: t.longitud, base: extremo(t.base.esfuerzos), cabeza: extremo(t.cabeza.esfuerzos) }));
    const pesimos = algunoPesimo(tramos.flatMap((t) => [...Object.values(t.base), ...Object.values(t.cabeza)]));
    return si({ pieza: id, tipo: "pilar", combinaciones: conjunto.descripcion, leyenda: leyendaEsfuerzos("pilar", pesimos), tramos }, r.diagnosticos);
  }
  if (q.fisico.barras?.some((b) => b.id === id)) {
    // Fase BN: los extremos a lo largo de la barra, desde su inicio (sin vanos), cada uno con sus esfuerzos:
    // los concomitantes o, con el sismo del programa, los de sus signos pésimos (VS-o, `esfuerzosPesimosBarra`)
    const extremos: Record<string, Extremo> = {};
    const donde: Record<string, { D: DiagramaLeible; x: number; lado: -1 | 1; sismo: boolean }> = {};
    const tramos = q.esfuerzosPiezas.tramos(id);
    for (let kc = 0; kc < conjunto.factores.length; kc++) {
      const f = conjunto.factores[kc]!;
      const sismo = !q.sup.esLineal(f);
      for (const t of tramos) {
        const D = q.diagramaBarra(t.barra, f);
        recorrerDiagrama(D, (x, lado, e) => {
          for (const nombre of EXTREMOS.barra) {
            const v = e[COMPONENTES.indexOf(nombre.replace(/[+-]$/, "") as (typeof COMPONENTES)[number])]!;
            if (!mejora(nombre, extremos[nombre], v)) continue;
            extremos[nombre] = { v, s: t.s0 + x, comb: conjunto.nombres[kc]! };
            donde[nombre] = { D, x, lado, sismo };
          }
        });
      }
    }
    for (const [nombre, x] of Object.entries(extremos)) {
      const { D, x: xx, lado, sismo } = donde[nombre]!;
      const partes: EsfuerzosPartidos = esfuerzosPartidos(D, xx, lado);
      x.esfuerzos = sismo ? esfuerzosPesimosBarra(partes, nombre) : Array.from(partes.estatica);
      if (sismo) x.pesimos = true;
    }
    const bs = q.mapeo.piezas[id] ?? [];
    const longitud = bs.length ? q.mapeo.barras[bs[bs.length - 1]!]!.s[3] : 0;
    return si({ pieza: id, tipo: "barra", combinaciones: conjunto.descripcion, leyenda: leyendaEsfuerzos("barra", algunoPesimo(Object.values(extremos))), longitud, extremos });
  }
  const v = q.viga(id);
  if (!v.valido) return no("consulta/no-existe", `No hay ninguna pieza ${id} (ni pilar, ni viga, ni vigueta, ni barra).`, [id]);
  const vanos: VanoEnvolvente[] = [];
  for (let i = 0; i < v.valor.vanos.length; i++) {
    const va = v.valor.vanos[i]!;
    const ext: Record<string, Extremo> = {};
    for (let kc = 0; kc < conjunto.factores.length; kc++) {
      const f = conjunto.factores[kc]!;
      const e = q.vano(id, i, f);
      if (!e.valido) return e;
      const comb = conjunto.nombres[kc]!;
      const x = e.valor;
      // Con cada extremo, sus esfuerzos: los concomitantes o, con el sismo del programa, los de sus signos pésimos (VS-o)
      const sismo = !q.sup.esLineal(f);
      const extremo = (c: ExtremoDiagrama, my: 1 | -1 | 0): Extremo => ({
        v: c.valor,
        s: c.s,
        comb,
        esfuerzos: sismo ? esfuerzosPesimosViga(c.partes, my) : Array.from(c.partes.estatica),
        ...(sismo ? { pesimos: true as const } : {}),
      });
      if (mejora("My+", ext["My+"], x.maxMy.valor)) ext["My+"] = extremo(x.maxMy, 1);
      if (mejora("My-", ext["My-"], x.minMy.valor)) ext["My-"] = extremo(x.minMy, -1);
      for (const c of [x.maxVz, x.minVz]) if (mejora("Vz", ext.Vz, c.valor)) ext.Vz = extremo(c, 0);
      for (const c of [x.maxT, x.minT]) if (mejora("T", ext.T, c.valor)) ext.T = extremo(c, 0);
    }
    vanos.push({ desde: va.desde, hasta: va.hasta, apoyos: [va.apoyoInicio?.objeto ?? null, va.apoyoFin?.objeto ?? null], ...(va.torsionEquilibrio ? { torsionEquilibrio: true as const } : {}), extremos: ext });
  }
  const pesimos = algunoPesimo(vanos.flatMap((va) => Object.values(va.extremos)));
  return si({ pieza: id, tipo: v.valor.tipo, combinaciones: conjunto.descripcion, leyenda: leyendaEsfuerzos("viga", pesimos), ...(v.valor.axilSinValor ? { axilSinValor: true } : {}), vanos }, v.diagnosticos);
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
  const ancho = q.fisico.bandas!.find((b) => b.id === id)!.ancho;
  const estaciones = r.valor.map((e): EstacionEnvolvente => {
    let max: Extremo | undefined;
    let min: Extremo | undefined;
    conjunto.factores.forEach((f, kc) => {
      const v = q.combinar(e.esfuerzos, 6, f)[4]!;
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
 * de su armadura inferior y superior en las combinaciones del conjunto (kN·m/m). Con `direccion`,
 * sólo las de esa dirección (las otras no se cortan: el mapa de una armadura sólo pide las suyas).
 */
export function franjas(q: Consultas, conjunto: ConjuntoCombinaciones, o: Pick<OpcionesConsulta, "losa" | "planta"> & { direccion?: 1 | 2 }): Respuesta<{ combinaciones: string; franjas: FilaFranja[] }> {
  if (o.losa !== undefined && !(q.fisico.losas ?? []).some((l) => l.id === o.losa)) return no("consulta/no-existe", `La losa «${o.losa}» no existe en el modelo (las franjas son de las losas macizas y reticulares).`, [o.losa]);
  const losas = (q.fisico.losas ?? []).filter((l) => (o.losa === undefined || l.id === o.losa) && (o.planta === undefined || l.planta === o.planta));
  const filas: FilaFranja[] = [];
  const diagnosticos: Diagnostico[] = [];
  for (const l of losas) {
    const fs = q.franjas(l.id);
    if (!fs.valido) return fs;
    for (const f of fs.valor) {
      if (o.direccion !== undefined && f.direccion !== o.direccion) continue;
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
  /** En un reticular, la parte del ancho en ábacos (fuera de ellos, el momento del nervio de la franja es el medio por el ancho de la franja). */
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

// ─── Masas y modos de vibración (VS2) ───────────────────────────────────────────────────────────

export interface ModosAgente {
  /** Aceleración de la gravedad con la que el peso de las cargas pasa a masa, m/s². */
  g: number;
  /**
   * Masas, t: la de todas las cargas que cuentan (`total`), la que queda en las plantas con diafragma
   * rígido y vibra (`plantas`), la que va al terreno (apoyos) y, de la de las plantas, la de los nudos
   * que no son de ningún diafragma y se les asigna por su cota (`repartida`).
   */
  masas: { total: number; plantas: number; terreno: number; repartida: number };
  /** Peso que vibra, kN: `masas.plantas`·g. */
  peso: number;
  /** Centro de masas de todas las plantas, m. */
  centroDeMasas: [number, number];
  /** De abajo arriba: masa (t), peso (kN), centro de masas (m), inercia de giro respecto a él (t·m²) y su radio de giro (m). */
  plantas: { planta: string; cota: number; masa: number; peso: number; cm: [number, number]; J: number; radioDeGiro: number }[];
  /** Modos del modelo (tres por planta con masa); se listan los de mayor periodo. */
  numeroDeModos: number;
  modos: {
    modo: number;
    /** Periodo, s, y frecuencia, Hz. */
    T: number;
    f: number;
    /** Masa efectiva entre la total, en X, en Y y en el giro alrededor del centro de masas. */
    masaEfectiva: [number, number, number];
    /** La suma de las masas efectivas hasta este modo. */
    acumulada: [number, number, number];
    /** [ux, uy, rz] de cada planta en su centro de masas (en el orden de `plantas`), con la mayor traslación igual a 1 (m y rad/m). */
    forma: [number, number, number][];
  }[];
  /** Modos que no se listan (los de menor periodo). */
  omitidos?: number;
}

/** Masas por planta y modos de vibración (`fem consultar modos`): los `top` de mayor periodo, o todos. */
export function modos(q: Consultas, o: Pick<OpcionesConsulta, "top" | "todos"> = {}): Respuesta<ModosAgente> {
  const r = q.modos();
  if (!r.valido) return r;
  const md = r.valor;
  const n = o.todos ? md.modos.length : Math.min(md.modos.length, o.top ?? TOP_POR_DEFECTO);
  const acumulada: [number, number, number] = [0, 0, 0];
  const lista: ModosAgente["modos"] = [];
  md.modos.slice(0, n).forEach((m, i) => {
    for (let d = 0; d < 3; d++) acumulada[d]! += m.masaEfectiva[d]!;
    let [t, g] = [0, 0];
    for (let k = 0; k < md.plantas.length; k++) {
      t = Math.max(t, Math.abs(m.forma[3 * k]!), Math.abs(m.forma[3 * k + 1]!));
      g = Math.max(g, Math.abs(m.forma[3 * k + 2]!));
    }
    // Un modo de giro puro (sin traslación de los centros de masas): con el mayor giro igual a 1
    const escala = t > 1e-9 * g ? t : g || 1;
    lista.push({
      modo: i + 1,
      T: m.periodo,
      f: 1 / m.periodo,
      masaEfectiva: [...m.masaEfectiva],
      acumulada: [...acumulada],
      forma: md.plantas.map((_, k) => [m.forma[3 * k]! / escala, m.forma[3 * k + 1]! / escala, m.forma[3 * k + 2]! / escala]),
    });
  });
  return si({
    g: md.g,
    masas: { total: md.masas.total, plantas: md.masas.diafragmas, terreno: md.masas.terreno, repartida: md.masas.repartida },
    peso: md.masas.diafragmas * md.g,
    centroDeMasas: md.cm,
    plantas: md.plantas.map((p) => ({ planta: p.planta, cota: p.cota, masa: p.masa, peso: p.masa * md.g, cm: p.cm, J: p.J, radioDeGiro: p.masa > 0 ? Math.sqrt(p.J / p.masa) : 0 })),
    numeroDeModos: md.modos.length,
    modos: lista,
    ...(n < md.modos.length ? { omitidos: md.modos.length - n } : {}),
  });
}

// ─── El sismo del programa (VS3) ────────────────────────────────────────────────────────────────

export interface SismoAgente {
  norma: "NCSE-02";
  metodo: "espectros de respuesta (art. 3.6.2)";
  /** Los casos del sismo del programa: van al final de los casos y entran en las combinaciones sísmicas. */
  casos: string[];
  /** El emplazamiento (cap. 2): ab y ac en g; TA y TB en s. */
  emplazamiento: { ab: number; K: number; importancia: string; rho: number; terreno: string; C: number; S: number; ac: number; TA: number; TB: number };
  /** Amortiguamiento Ω (%), ν, la regla de combinación de los modos y la excentricidad accidental (fracción de la dimensión de la planta). */
  omega: number;
  nu: number;
  regla: "srss" | "cqc";
  excentricidad: number;
  /** Peso sísmico (la masa de las plantas por g), kN. */
  peso: number;
  direcciones: {
    eje: "X" | "Y";
    mu: number;
    beta: number;
    /** El modo de más masa en la dirección (da el signo de los resultados): su número, su periodo (s) y su fracción de masa. */
    dominante: { modo: number; T: number; masaEfectiva: number };
    /** Cortante combinado en la base, kN, y entre el peso sísmico. */
    cortanteBasal: number;
    coeficienteSismico: number;
    /** El mayor desplazamiento combinado (ya por μ), m, y la mayor θ = P·d/(V·h) del art. 3.8. */
    desplazamientoMaximo: number;
    thetaMaxima: number;
    /** De arriba abajo: cortante combinado bajo la planta y fuerza equivalente (kN), excentricidad (m) y par (kN·m), desplazamiento y deriva (m, por μ) y θ. */
    plantas: { plantas: string[]; cota: number; masa: number; cortante: number; fuerza: number; excentricidad: number; par: number; desplazamiento: number; deriva: number; altura: number; theta: number }[];
    /** Los modos que más cortante dan en la base: periodo, αᵢ (art. 3.6.2.2), fracción de masa en la dirección y su cortante en la base (kN, con signo). */
    modos: { modo: number; T: number; alfa: number; masaEfectiva: number; cortanteBasal: number }[];
    modosOmitidos?: number;
    /** Se ha tomado α = 2,5 por encima de TB (art. 2.4: C > 1,8 y el periodo fundamental mayor que TB). */
    mesetaLarga?: true;
    /** El cortante en la base del método simplificado (art. 3.7), para contrastar: no se calcula con él. */
    simplificado: { periodo: "el del modo dominante" | "el aproximado del art. 3.7.2.2"; TF: number; modos: number; cortanteBasal: number; frente: number }[];
  }[];
}

/** El sismo del programa (`fem consultar sismo`): espectro, cortantes, desplazamientos y θ por dirección. */
export function sismo(q: Consultas, o: Pick<OpcionesConsulta, "top" | "todos"> = {}): Respuesta<SismoAgente> {
  const r = q.sismo();
  if (!r.valido) return r;
  const { espectro, direcciones, casos } = r.valor;
  const em = espectro.emplazamiento;
  return si(
    {
      norma: "NCSE-02",
      metodo: "espectros de respuesta (art. 3.6.2)",
      casos,
      emplazamiento: { ab: em.ab, K: em.K, importancia: espectro.importancia, rho: em.rho, terreno: espectro.terreno, C: em.C, S: em.S, ac: em.ac, TA: em.TA, TB: em.TB },
      omega: espectro.omega,
      nu: espectro.nu,
      regla: espectro.regla,
      excentricidad: espectro.excentricidad,
      peso: direcciones[0].peso,
      direcciones: direcciones.map((d) => {
        const orden = d.modos.map((m, i) => ({ modo: i + 1, T: m.periodo, alfa: m.alfa, masaEfectiva: m.masaEfectiva, cortanteBasal: m.basal })).sort((a, b) => Math.abs(b.cortanteBasal) - Math.abs(a.cortanteBasal));
        const n = o.todos ? orden.length : Math.min(orden.length, o.top ?? TOP_POR_DEFECTO);
        return {
          eje: d.eje,
          mu: d.mu,
          beta: d.beta,
          dominante: { modo: d.dominante.modo, T: d.dominante.periodo, masaEfectiva: d.dominante.masaEfectiva },
          cortanteBasal: d.basal,
          coeficienteSismico: d.coeficiente,
          desplazamientoMaximo: d.desplazamientoMaximo,
          thetaMaxima: d.thetaMaxima,
          plantas: d.niveles,
          modos: orden.slice(0, n),
          ...(n < orden.length ? { modosOmitidos: orden.length - n } : {}),
          ...(d.mesetaLarga ? { mesetaLarga: true as const } : {}),
          simplificado: d.simplificado.map((s) => ({
            periodo: s.origen === "modal" ? ("el del modo dominante" as const) : ("el aproximado del art. 3.7.2.2" as const),
            TF: s.TF,
            modos: s.modos,
            cortanteBasal: s.basal,
            frente: s.basal > 0 ? d.basal / s.basal : 0,
          })),
        };
      }),
    },
    r.diagnosticos,
  );
}

// ─── Entrada común ──────────────────────────────────────────────────────────────────────────────

// ─── Segundo orden (SO) ─────────────────────────────────────────────────────────────────────────

export interface SegundoOrdenAgente extends SegundoOrdenConsulta {
  metodo: string;
  /** Las combinaciones listadas son las de mayor Q; las demás se cuentan aquí. */
  omitidas?: number;
}

/**
 * El segundo orden global (`fem consultar segundo-orden`, `docs/fem3d/segundo-orden.md`): el
 * coeficiente de estabilidad global de cada hipótesis horizontal en cada combinación del generador,
 * con lo que lo compone. Las combinaciones salen de mayor a menor Q.
 */
export function segundoOrden(q: Consultas, o: Pick<OpcionesConsulta, "top" | "todos"> = {}): Respuesta<SegundoOrdenAgente> {
  const r = q.segundoOrden();
  if (!r.valido) return r;
  const v = r.valor;
  if (!v.hipotesis.length && !v.sinCarga.length) return no("consulta/sin-hipotesis-horizontales", "El modelo no tiene hipótesis horizontales (casos con acción de viento, W, o de sismo, E): no hay segundo orden global que calcular.");
  const orden = [...v.combinaciones].sort((a, b) => b.Q - a.Q);
  const n = o.todos ? orden.length : Math.min(orden.length, o.top ?? TOP_POR_DEFECTO);
  return si(
    {
      ...v,
      metodo: `coeficiente de estabilidad global γz = 1 / (1 − Q) por hipótesis horizontal y combinación, con Q = Σ γ_k·M_Pδ,k / M_H (el método de la amplificación del CE Anejo 19 H.2); los desplazamientos, por ${v.multiplicador}${v.amplificar ? "" : "; desactivado: las combinaciones son de primer orden"}`,
      combinaciones: orden.slice(0, n),
      ...(n < orden.length ? { omitidas: orden.length - n } : {}),
    },
    r.diagnosticos,
  );
}

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
  // los modos y el sismo no dependen de las combinaciones; el segundo orden, de todas las del generador
  modos: "lineal",
  sismo: "lineal",
  "segundo-orden": "esfuerzos",
  combinaciones: "esfuerzos",
};

export function consultar(q: Consultas, consulta: NombreConsulta, o: OpcionesConsulta): Respuesta<unknown> {
  if (consulta === "modos") return modos(q, o);
  if (consulta === "sismo") return sismo(q, o);
  if (consulta === "segundo-orden") return segundoOrden(q, o);
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
  return no("consulta/no-existe", `La consulta «${consulta}» no existe.`);
}
