/**
 * Fase CO1 (`docs/fem3d/comprobaciones.md` §4.1 y §4.3): comprobar un pilar con un armado dado.
 *
 * El juez es el módulo de pilares de Concreta (`calcRCColumn`, copiado sin tocar en `../concreta/`).
 * Aquí sólo se le llama, demanda a demanda, y de cada fila suya se guarda la peor: su mayor
 * aprovechamiento, con la combinación y el extremo que la dan (§4.2, punto 2: donde hay interacción,
 * todas las combinaciones).
 *
 * Lo que el módulo no comprueba no sale nunca como «cumple» (§4.2, punto 9): va a `pendientes` y el
 * tramo no cumple. Hoy, lo que no es hormigón rectangular o circular y β = 1 cuando el segundo orden
 * global no está en los esfuerzos. El cortante de un pilar circular, por el cuadrado inscrito (CO1-b).
 *
 * Además de las filas del módulo: el cortante en las dos direcciones (`calcRcShear`, del módulo de
 * vigas, como hace Concreta en sus pórticos) y, donde el pilar tracciona, la flexotracción contra la
 * envolvente N–M que da el propio módulo para ese armado.
 *
 * Unidades del armado: mm y MPa, las del módulo.
 */
import { buildColumnInteraction, calcRCColumn, type CheckRow, type CheckStatus, type InteractionPoint } from "../concreta/lib/calculations/rcColumns.ts";
import { calcRcShear } from "../concreta/lib/calculations/rcBeams.ts";
import { makeCheck, toStatus } from "../concreta/lib/calculations/types.ts";
import { getConcrete, getFyd } from "../concreta/data/materials.ts";
import { getBarArea } from "../concreta/data/rebar.ts";
import { dec } from "../concreta/lib/units/format.ts";
import type { RCColumnInputs } from "../concreta/data/defaults.ts";
import type { ArmadoPilar } from "../armado.ts";
import type { Demanda, DemandasPilar, DemandasTramo } from "../demandas/pilares.ts";
import { entradaPilar, geometriaPilar, ND_MINIMO, type EntradaPilar } from "./entradaPilar.ts";

export type { ArmadoPilar, BarrasCara } from "../armado.ts";

export type Extremo = "base" | "cabeza";

export interface FilaPilar {
  id: string;
  descripcion: string;
  articulo: string;
  /** El del módulo; infinito si la fila falla sin cociente, y 0 en las informativas. */
  aprovechamiento: number;
  estado: CheckStatus;
  /** La fila no comprueba nada: da un dato (una condición de la norma, una clase). */
  informativa?: true;
  /** La combinación y el extremo del tramo que dan ese aprovechamiento. */
  comb: string;
  extremo: Extremo;
  /** Con los signos pésimos del sismo (VS-o). */
  pesimos?: true;
  /** La fila del módulo, entera. */
  fila: CheckRow;
}

export interface Pendiente {
  motivo: string;
  /** Cuántas demandas quedan sin comprobar por ese motivo, y la primera. */
  demandas: number;
  comb?: string;
  extremo?: Extremo;
}

export interface ComprobacionTramo {
  planta: string;
  plantaBase: string;
  seccion: string;
  /** Una por fila del módulo, con su peor demanda. */
  filas: FilaPilar[];
  /** El mayor de las filas (0 sin ninguna; infinito si alguna falla sin cociente). */
  aprovechamiento: number;
  pendientes: Pendiente[];
  /** Ninguna fila falla y nada queda pendiente. */
  cumple: boolean;
  /** Llamadas al módulo. */
  llamadas: number;
}

export interface ComprobacionPilar {
  pilar: string;
  betaUno: boolean;
  cumple: boolean;
  tramos: ComprobacionTramo[];
}

/** La entrada del módulo: la de la demanda más el armado. */
export function entradaModulo(e: EntradaPilar, a: ArmadoPilar): RCColumnInputs {
  return {
    title: "",
    b: e.b,
    h: e.h,
    cover: a.recubrimiento,
    cornerBarDiam: a.esquinas ?? 0,
    nBarsX: a.caraB?.n ?? 0,
    barDiamX: a.caraB?.diametro ?? 0,
    nBarsY: a.caraH?.n ?? 0,
    barDiamY: a.caraH?.diametro ?? 0,
    stirrupDiam: a.cercos.diametro,
    stirrupSpacing: a.cercos.separacion,
    fck: e.fck,
    fyk: a.fyk,
    Nd: e.Nd,
    MEdy: e.MEdy,
    MEdz: e.MEdz,
    L: e.L,
    beta: e.beta,
    ...(a.phiEf !== undefined ? { phiEf: a.phiEf } : {}),
    sectionType: e.sectionType,
    ...(e.sectionType === "circular" ? { D: e.D!, nBarsCirc: a.anillo?.n ?? 0, circBarDiam: a.anillo?.diametro ?? 0 } : {}),
  };
}

/**
 * El veredicto de una fila es su `status`, no su número: el módulo da NaN a las filas informativas
 * (que nunca fallan) y NaN o infinito a las que fallan sin cociente (la sección aplastada).
 */
const gravedad = (e: CheckStatus) => (e === "fail" ? 2 : e === "warn" ? 1 : 0);
const informativa = (f: CheckRow) => f.status !== "fail" && (f.neutral === true || !Number.isFinite(f.utilization));
const aprovechamientoDe = (f: CheckRow) => (Number.isFinite(f.utilization) ? f.utilization : f.status === "fail" ? Infinity : 0);

/** Capacidad a flexión de una envolvente N–M del módulo con el axil N (kN, compresión positiva). */
function capacidad(curva: InteractionPoint[], N: number): number | null {
  if (curva.length < 2 || N < curva[0]!.N || N > curva[curva.length - 1]!.N) return null;
  for (let i = 0; i < curva.length - 1; i++) {
    const p = curva[i]!;
    const q = curva[i + 1]!;
    if (N >= p.N && N <= q.N) return q.N - p.N < 1e-9 ? Math.max(p.M, q.M) : p.M + ((N - p.N) / (q.N - p.N)) * (q.M - p.M);
  }
  return null;
}

/**
 * Lo del tramo que no depende de la demanda: las envolventes N–M del armado, que da el propio módulo
 * (`buildColumnInteraction`, con su modelo de la sección), y las filas de una llamada con la
 * compresión mínima, de las que salen las reglas de armado de un pilar que sólo tracciona.
 */
interface Envolventes {
  y: InteractionPoint[];
  /** Sin ella en la sección circular: una sola envolvente, con el momento resultante. */
  z: InteractionPoint[] | null;
  filas: CheckRow[];
}

function envolventes(e: Omit<EntradaPilar, "Nd" | "MEdy" | "MEdz">, a: ArmadoPilar): Envolventes | { error: string } {
  const entrada = entradaModulo({ ...e, Nd: ND_MINIMO, MEdy: 0, MEdz: 0 }, a);
  const r = calcRCColumn(entrada);
  if (!r.valid) return { error: r.error ?? "sin motivo" };
  const i = buildColumnInteraction(entrada, r);
  if (!i.valid || !i.y) return { error: "sin envolvente N–M" };
  return { y: i.y.reinforced, z: i.z?.reinforced ?? null, filas: r.checks };
}

/**
 * Flexotracción (y la compresión de menos de 1 kN, que el módulo no admite): la demanda, de primer
 * orden y sin excentricidad mínima (no hay pandeo), contra la envolvente N–M del armado en su rama
 * de tracción. Entre dos puntos de la envolvente se interpola en línea recta, que queda por dentro
 * (del lado seguro). En rectangular, los dos planos se suman (el exponente 1 de 5.8.9 con poco axil).
 */
function filasTraccion(env: Envolventes, N: number, My: number, Mz: number): CheckRow[] {
  const NtRd = -env.y[0]!.N;
  const filas: CheckRow[] = [];
  if (N > 0) filas.push(makeCheck("traccion", "Tracción: NEd ≤ As·fyd", N, NtRd, `${dec(N, 1)} kN`, `${dec(NtRd, 1)} kN`, "CE Anejo 19 §6.1"));
  const cociente = (curva: InteractionPoint[], M: number) => {
    const MRd = capacidad(curva, -N);
    return M <= 0 ? 0 : MRd !== null && MRd > 1e-9 ? M / MRd : Infinity;
  };
  const u = env.z ? cociente(env.y, Math.abs(My)) + cociente(env.z, Math.abs(Mz)) : cociente(env.y, Math.hypot(My, Mz));
  filas.push({
    id: "flexotraccion",
    description: env.z ? "Flexotracción: MEdy/MRdy(N) + MEdz/MRdz(N) ≤ 1" : "Flexotracción: MEd/MRd(N) ≤ 1",
    value: Number.isFinite(u) ? dec(u, 3) : "—",
    limit: "≤ 1,0",
    utilization: u,
    status: toStatus(u),
    article: "CE Anejo 19 §6.1",
  });
  return filas;
}

/**
 * Cortante de un pilar rectangular, como lo hace Concreta en sus pórticos (`fem2d/checks.ts`): en
 * cada dirección, `calcRcShear` con la cara traccionada de esa flexión, las dos ramas del cerco y
 * σcp con su signo, del axil de la misma demanda; VRd = máx(VRd,c; mín(VRd,s; VRd,máx)) (§6.2.1(4)).
 * Con cortante en las dos direcciones se suman los dos aprovechamientos (del lado seguro).
 */
function filasCortante(e: Pick<EntradaPilar, "b" | "h" | "fck">, a: ArmadoPilar, N: number, Vy: number, Vz: number): CheckRow[] {
  const mat = getConcrete(e.fck);
  const fyd = getFyd(a.fyk);
  const esquina = getBarArea(a.esquinas ?? 0);
  const dPrima = a.recubrimiento + a.cercos.diametro + (a.esquinas ?? 0) / 2;
  const Asw = a.cercos.separacion > 0 ? (2 * getBarArea(a.cercos.diametro)) / a.cercos.separacion : 0;
  const sigmaCp = (-N * 1000) / (e.b * e.h);
  const filas: CheckRow[] = [];
  let suma = 0;
  let direcciones = 0;
  for (const [eje, V, ancho, canto, cara] of [
    ["z", Math.abs(Vz), e.b, e.h, a.caraB],
    ["y", Math.abs(Vy), e.h, e.b, a.caraH],
  ] as const) {
    if (!(V > 1e-6)) continue;
    const As = 2 * esquina + (cara?.n ?? 0) * getBarArea(cara?.diametro ?? 0);
    const c = calcRcShear({ b: ancho, d: canto - dPrima, fck: e.fck, fcd: mat.fcd, fyd, As, Asw, hasStirrups: Asw > 0, sigmaCp });
    const VRd = Math.max(c.VRdc, Math.min(c.VRds, c.VRdmax));
    filas.push(makeCheck(`cortante-${eje}`, `Cortante V${eje}: VEd ≤ VRd`, V, VRd, `${dec(V, 1)} kN`, `${dec(VRd, 1)} kN`, "CE Anejo 19 §6.2"));
    filas.push(makeCheck(`biela-${eje}`, `Biela comprimida V${eje}: VEd ≤ VRd,máx`, V, c.VRdmax, `${dec(V, 1)} kN`, `${dec(c.VRdmax, 1)} kN`, "CE Anejo 19 §6.2.3(3)"));
    suma += VRd > 0 ? V / VRd : Infinity;
    direcciones++;
  }
  if (direcciones === 2)
    filas.push({
      id: "cortante-esviado",
      description: "Cortante en las dos direcciones: VEdy/VRdy + VEdz/VRdz ≤ 1",
      value: Number.isFinite(suma) ? dec(suma, 3) : "—",
      limit: "≤ 1,0",
      utilization: suma,
      status: toStatus(suma),
      article: "CE Anejo 19 §6.2",
    });
  return filas;
}

/**
 * Cortante de un pilar circular (CO1-b, provisional y del lado seguro: el módulo no lo tiene). La
 * sección es isótropa, así que se comprueba el cortante resultante, no la suma de las dos direcciones,
 * en el cuadrado inscrito en el círculo (lado s = D/√2), con todo lo que da menos capacidad:
 *  - d = s − (recubrimiento + Ø cerco + Ø/2), medido desde la cara del cuadrado (las barras reales
 *    están más fuera, en el anillo);
 *  - la armadura de tracción, la cuarta parte de las barras del anillo (por abajo);
 *  - el cerco circular, con sus dos ramas reducidas por π/4 (su inclinación sobre la fisura);
 *  - σcp con el área del círculo si comprime y la del cuadrado si tracciona.
 */
export const CORTANTE_CIRCULAR = "cuadrado inscrito en el círculo, del lado seguro (CO1-b)";

function filasCortanteCircular(e: Pick<EntradaPilar, "D" | "fck">, a: ArmadoPilar, N: number, Vy: number, Vz: number): CheckRow[] {
  const V = Math.hypot(Vy, Vz);
  if (!(V > 1e-6)) return [];
  const D = e.D!;
  const s = D / Math.SQRT2;
  const mat = getConcrete(e.fck);
  const fyd = getFyd(a.fyk);
  const diam = a.anillo?.diametro ?? 0;
  const d = s - (a.recubrimiento + a.cercos.diametro + diam / 2);
  const As = Math.floor((a.anillo?.n ?? 0) / 4) * getBarArea(diam);
  const Asw = a.cercos.separacion > 0 ? ((Math.PI / 4) * 2 * getBarArea(a.cercos.diametro)) / a.cercos.separacion : 0;
  const area = N > 0 ? s * s : (Math.PI * D * D) / 4;
  const sigmaCp = (-N * 1000) / area;
  if (!(d > 0)) return [makeCheck("cortante", "Cortante (cuadrado inscrito): VEd ≤ VRd", V, 0, `${dec(V, 1)} kN`, "—", "CE Anejo 19 §6.2")];
  const c = calcRcShear({ b: s, d, fck: e.fck, fcd: mat.fcd, fyd, As, Asw, hasStirrups: Asw > 0, sigmaCp });
  const VRd = Math.max(c.VRdc, Math.min(c.VRds, c.VRdmax));
  return [
    makeCheck("cortante", "Cortante (cuadrado inscrito, del lado seguro): VEd ≤ VRd", V, VRd, `${dec(V, 1)} kN`, `${dec(VRd, 1)} kN`, "CE Anejo 19 §6.2"),
    makeCheck("biela", "Biela comprimida (cuadrado inscrito): VEd ≤ VRd,máx", V, c.VRdmax, `${dec(V, 1)} kN`, `${dec(c.VRdmax, 1)} kN`, "CE Anejo 19 §6.2.3(3)"),
  ];
}

/** `hastaFallo`: lo deja en la primera fila que falla (para probar armados de una tabla). */
export function comprobarTramo(t: DemandasTramo, a: ArmadoPilar, betaUno = true, hastaFallo = false): ComprobacionTramo {
  const filas = new Map<string, FilaPilar>();
  const pendientes = new Map<string, Pendiente>();
  let llamadas = 0;
  const pendiente = (motivo: string, d?: Demanda, extremo?: Extremo) => {
    const p = pendientes.get(motivo);
    if (p) p.demandas++;
    else pendientes.set(motivo, { motivo, demandas: 1, ...(d ? { comb: d.comb } : {}), ...(extremo ? { extremo } : {}) });
  };
  /** Se queda con la peor de cada fila. `siFalta`: sólo si esa fila no ha salido de ninguna demanda. */
  const anotar = (lista: CheckRow[], d: Demanda, extremo: Extremo, siFalta = false) => {
    for (const fila of lista) {
      const u = aprovechamientoDe(fila);
      const previa = filas.get(fila.id);
      if (previa && siFalta) continue;
      const peor = !previa || gravedad(fila.status) > gravedad(previa.estado) || (gravedad(fila.status) === gravedad(previa.estado) && u > previa.aprovechamiento);
      if (fila.status === "fail") falla = true;
      if (peor)
        filas.set(fila.id, {
          id: fila.id,
          descripcion: fila.description,
          articulo: fila.article,
          aprovechamiento: u,
          estado: fila.status,
          ...(informativa(fila) ? { informativa: true as const } : {}),
          comb: d.comb,
          extremo,
          ...(d.pesimos ? { pesimos: true as const } : {}),
          fila,
        });
    }
  };
  if (!betaUno) pendiente("β = 1 no vale: el segundo orden global está desactivado y la estructura es traslacional");
  const geo = geometriaPilar(t);
  let env: Envolventes | { error: string } | undefined;
  let traccionada: { d: Demanda; extremo: Extremo } | undefined;
  let falla = false;
  recorrido: for (const [extremo, ext] of [["base", t.base], ["cabeza", t.cabeza]] as const) {
    for (const d of ext.demandas) {
      if (hastaFallo && falla) break recorrido;
      if ("motivo" in geo) {
        pendiente(geo.motivo, d, extremo);
        continue;
      }
      const e = entradaPilar(t, d);
      if (e.tipo === "pendiente") {
        pendiente(e.motivo, d, extremo);
        continue;
      }
      const [N, Vy, Vz] = d.esfuerzos as [number, number, number];
      if (geo.sectionType === "rectangular") anotar(filasCortante(geo, a, N, Vy, Vz), d, extremo);
      else anotar(filasCortanteCircular(geo, a, N, Vy, Vz), d, extremo);
      if (e.tipo === "traccion") {
        env ??= envolventes({ ...geo, L: t.longitudLibre, beta: 1 }, a);
        if ("error" in env) {
          pendiente(`el módulo no admite la entrada: ${env.error}`, d, extremo);
          continue;
        }
        traccionada ??= { d, extremo };
        anotar(filasTraccion(env, e.N, e.My, e.Mz), d, extremo);
        continue;
      }
      const r = calcRCColumn(entradaModulo(e.entrada, a));
      llamadas++;
      if (!r.valid) {
        pendiente(`el módulo no admite la entrada: ${r.error ?? "sin motivo"}`, d, extremo);
        continue;
      }
      anotar(r.checks, d, extremo);
    }
  }
  // Un pilar que sólo tracciona: las reglas de armado, de la llamada con la compresión mínima
  if (traccionada && env && !("error" in env))
    anotar(
      env.filas.filter((f) => !informativa(f)),
      traccionada.d,
      traccionada.extremo,
      true,
    );
  const lista = [...filas.values()];
  if (lista.length === 0 && pendientes.size === 0) pendiente("el tramo no tiene demandas: sin combinaciones de ELU no hay comprobación");
  const aprovechamiento = lista.reduce((m, f) => Math.max(m, f.aprovechamiento), 0);
  return {
    planta: t.planta,
    plantaBase: t.plantaBase,
    seccion: t.seccion.id,
    filas: lista,
    aprovechamiento,
    pendientes: [...pendientes.values()],
    cumple: pendientes.size === 0 && lista.every((f) => f.estado !== "fail"),
    llamadas,
  };
}

/** Comprueba un pilar: `armado` da el de cada tramo (con su índice en `tramos`). */
export function comprobarPilar(d: DemandasPilar, armado: (t: DemandasTramo, i: number) => ArmadoPilar): ComprobacionPilar {
  const tramos = d.tramos.map((t, i) => comprobarTramo(t, armado(t, i), d.betaUno));
  return { pilar: d.pilar, betaUno: d.betaUno, cumple: tramos.every((t) => t.cumple), tramos };
}
