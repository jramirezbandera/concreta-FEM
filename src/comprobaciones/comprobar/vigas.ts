/**
 * Fase CO2 (`docs/fem3d/comprobaciones.md` §4.3): comprobar un vano de viga con un armado dado.
 *
 * El juez es el módulo de vigas de Concreta (`calcRCBeam`, copiado sin tocar en `../concreta/`): una
 * llamada por zona del vano (inicio, centro y fin), con su sección «vano» (tracción abajo: la armadura
 * inferior con el mayor My de la zona) y su sección «apoyo» (tracción arriba: la superior de esa zona
 * con el menor My). Como en una viga cada fila depende de un solo esfuerzo (la flexión, de My; el
 * cortante, de Vz; la fisuración, del momento cuasipermanente), basta la envolvente de cada uno.
 *
 * Qué filas del módulo se toman de cada sección:
 *  - las de la flexión (momento, cuantía mínima, separación de barras, fisuración), sólo si esa cara
 *    tracciona en alguna combinación; si no, sólo que sus barras quepan;
 *  - las del cortante, de la sección cuya cara tracciona donde el cortante es mayor;
 *  - la cuantía máxima, una vez por zona.
 *
 * Además de las filas del módulo:
 *  - la flecha (CO-k), de la deformada del modelo por el factor de sección fisurada y fluencia del
 *    módulo (`crackedDeflectionFactor`): la total a plazo infinito y la activa;
 *  - la torsión (CO-h, `torsion.ts`): la de equilibrio se comprueba; la de compatibilidad se da;
 *  - la flexión con tracción, con el M–N del módulo (`beamMNCapacity`).
 *
 * Lo que no se comprueba no sale nunca como «cumple» (§4.2, punto 9): va a `pendientes`.
 *
 * Unidades del armado: mm y MPa, las del módulo.
 */
import { calcRCBeam, type RCBeamSectionResult } from "../concreta/lib/calculations/rcBeams.ts";
import { beamMNCapacity } from "../concreta/lib/calculations/rcBeamMN.ts";
import { crackedDeflectionFactor } from "../concreta/lib/calculations/crackedDeflection.ts";
import { toStatus, type CheckRow, type CheckStatus } from "../concreta/lib/calculations/types.ts";
import { getConcrete } from "../concreta/data/materials.ts";
import { getBarArea } from "../concreta/data/rebar.ts";
import { dec } from "../concreta/lib/units/format.ts";
import type { RCBeamInputs } from "../concreta/data/defaults.ts";
import { ramasDe, type ArmadoViga, type BarrasCara, type CercosViga } from "../armado.ts";
import type { DemandasVano, DemandasViga, DemandasZona, ExtremoViga, ZonaViga } from "../demandas/vigas.ts";
import { filaTorsionCompatibilidad, filasTorsion, torsionRC } from "./torsion.ts";

export type { ArmadoVanoViga, ArmadoViga } from "../armado.ts";

/** Lo que hay que aumentar si una fila falla: una armadura del vano, o la sección (nada que proponer). */
export type GrupoArmado = "inferior" | "superior" | "superiorInicio" | "superiorFin" | "cercos" | "cercosInicio" | "cercosFin" | "piel" | "seccion";

export interface FilaViga {
  /** `<zona>/<cara>-<fila del módulo>`, `<zona>/<fila>` o, las del vano entero, `flecha-…`. */
  id: string;
  zona?: ZonaViga;
  descripcion: string;
  articulo: string;
  /** El del módulo; infinito si la fila falla sin cociente, y 0 en las informativas. */
  aprovechamiento: number;
  estado: CheckStatus;
  informativa?: true;
  /** La combinación y la estación de la demanda de la fila (las reglas de armado no tienen). */
  comb?: string;
  s?: number;
  /** Con los signos pésimos del sismo (VS-o). */
  pesimos?: true;
  grupo: GrupoArmado;
  /** La fila del módulo, entera. */
  fila: CheckRow;
}

export interface PendienteViga {
  motivo: string;
  zona?: ZonaViga;
}

export interface ComprobacionVano {
  indice: number;
  desde: number;
  hasta: number;
  apoyos: [string | null, string | null];
  filas: FilaViga[];
  /** El mayor de las filas (0 sin ninguna; infinito si alguna falla sin cociente). */
  aprovechamiento: number;
  pendientes: PendienteViga[];
  /** Ninguna fila falla y nada queda pendiente. */
  cumple: boolean;
  /** Llamadas al módulo. */
  llamadas: number;
}

export interface ComprobacionViga {
  viga: string;
  cumple: boolean;
  vanos: ComprobacionVano[];
}

/** La sección y el hormigón de la viga en las unidades del módulo; o por qué no se comprueba. */
export interface GeometriaViga {
  /** mm */
  b: number;
  h: number;
  /** MPa */
  fck: number;
}

export function geometriaViga(d: Pick<DemandasViga, "seccion" | "material">): GeometriaViga | { motivo: string } {
  if (d.material.tipo !== "hormigon") return { motivo: `el material ${d.material.id} no es hormigón` };
  const s = d.seccion;
  if (s.forma !== "rectangular") return { motivo: `la sección ${s.id} (${s.forma}) no es rectangular` };
  return { b: 1000 * s.b, h: 1000 * s.h, fck: d.material.fck };
}

/** Por debajo de esto (kN·m), una cara no tracciona. */
export const MOMENTO_MINIMO = 1e-6;
/** Tracción (kN) desde la que la flexión se comprueba con su axil. */
export const TRACCION_MINIMA = 1;
/** Compresión, en fracción de fcd·Ac, desde la que la viga trabaja como un pilar y no se comprueba. */
export const COMPRESION_RELEVANTE = 0.1;
/** La torsión de compatibilidad se da desde esta fracción del torsor de fisuración TRd,c. */
export const TORSION_INFORMATIVA = 0.05;
/** El momento en la cara de un apoyo, no menos que esta parte del de empotramiento perfecto (CE A19 §5.3.2.2(3)). */
export const FRACCION_EMPOTRAMIENTO = 0.65;
/** La flecha total admisible: L/300 (DB SE 4.3.3.1(3), apariencia, combinación casi permanente). */
export const FLECHA_TOTAL = 300;

const FILAS_FLEXION = new Set(["bending", "bending-over", "as-min", "bar-spacing", "cracking"]);
const FILAS_CORTANTE = new Set(["shear", "shear-max", "rho-w-min", "stirrup-spacing-max", "stirrup-legs-spacing"]);
const NOMBRE_ZONA: Record<ZonaViga, string> = { inicio: "Apoyo de inicio", centro: "Centro del vano", fin: "Apoyo del fin" };

/** La armadura superior y los cercos de una zona. */
export function armaduraZona(a: Pick<ArmadoViga, "superior" | "superiorInicio" | "superiorFin" | "cercos" | "cercosInicio" | "cercosFin">, zona: ZonaViga): { superior: BarrasCara; cercos: CercosViga } {
  return {
    superior: (zona === "inicio" ? a.superiorInicio : zona === "fin" ? a.superiorFin : undefined) ?? a.superior,
    cercos: (zona === "inicio" ? a.cercosInicio : zona === "fin" ? a.cercosFin : undefined) ?? a.cercos,
  };
}

/** Lo que una zona le pide al módulo, kN y kN·m en valor absoluto. */
export interface EsfuerzosZona {
  /** ELU: el momento que tracciona la cara inferior y el que tracciona la superior. */
  positivo: number;
  negativo: number;
  cortante: number;
  /** ELS cuasipermanente. */
  cpPositivo: number;
  cpNegativo: number;
}

export function esfuerzosZona(z: DemandasZona): EsfuerzosZona {
  return {
    positivo: Math.max(0, z.positivo.valor),
    negativo: Math.max(0, -z.negativo.valor),
    cortante: z.cortante.valor,
    cpPositivo: Math.max(0, z.cpPositivo?.valor ?? 0),
    cpNegativo: Math.max(0, -(z.cpNegativo?.valor ?? 0)),
  };
}

/**
 * La entrada del módulo para una zona: «vano» es la sección con la tracción abajo y «apoyo», con la
 * tracción arriba. El momento cuasipermanente va entero (`loadType: "custom"` con ψ₂ = 0, §4.2 punto
 * 7) y la flecha del módulo, que es de una fórmula de viga, no se pide (L = 0): sale del modelo.
 */
export function entradaModuloViga(g: GeometriaViga, a: ArmadoViga, zona: ZonaViga, e: EsfuerzosZona): RCBeamInputs {
  const { superior, cercos } = armaduraZona(a, zona);
  const estribos = { diam: cercos.diametro, sep: cercos.separacion, ramas: ramasDe(cercos) };
  return {
    mode: "portico",
    title: "",
    b: g.b,
    h: g.h,
    cover: a.recubrimiento,
    fck: g.fck,
    fyk: a.fyk,
    exposureClass: a.exposicion,
    loadType: "custom",
    psi2Custom: 0,
    L: 0,
    structSystem: "ss",
    vano_Md: e.positivo,
    vano_VEd: e.cortante,
    vano_M_G: e.cpPositivo,
    vano_M_Q: 0,
    vano_bot_nBars: a.inferior.n,
    vano_bot_barDiam: a.inferior.diametro,
    vano_top_nBars: superior.n,
    vano_top_barDiam: superior.diametro,
    vano_stirrupDiam: estribos.diam,
    vano_stirrupSpacing: estribos.sep,
    vano_stirrupLegs: estribos.ramas,
    apoyo_Md: e.negativo,
    apoyo_VEd: e.cortante,
    apoyo_M_G: e.cpNegativo,
    apoyo_M_Q: 0,
    apoyo_top_nBars: superior.n,
    apoyo_top_barDiam: superior.diametro,
    apoyo_bot_nBars: a.inferior.n,
    apoyo_bot_barDiam: a.inferior.diametro,
    apoyo_stirrupDiam: estribos.diam,
    apoyo_stirrupSpacing: estribos.sep,
    apoyo_stirrupLegs: estribos.ramas,
  };
}

const gravedad = (e: CheckStatus) => (e === "fail" ? 2 : e === "warn" ? 1 : 0);
const informativa = (f: CheckRow) => f.status !== "fail" && (f.neutral === true || f.status === "neutral" || !Number.isFinite(f.utilization));
const aprovechamientoDe = (f: CheckRow) => (f.status === "neutral" ? 0 : Number.isFinite(f.utilization) ? f.utilization : f.status === "fail" ? Infinity : 0);

/** La flecha de un vano con su armado: la total a plazo infinito y la activa, m, con sus factores. */
export interface FlechaComprobada {
  /** Factor de la flecha cuasipermanente a plazo infinito (fisuración y fluencia) y de la instantánea (fisuración). */
  kDiferida: number;
  kInstantanea: number;
  /** Factor de la instantánea del peso propio (0 si no se descuenta). */
  kPesoPropio: number;
  zeta: number;
  /** m, en valor absoluto, con la estación y las combinaciones que las dan. */
  total: { valor: number; s: number; comb: string };
  activa: { valor: number; s: number; comb: string };
}

/**
 * La flecha (CO-k): la elástica del modelo por el factor de sección fisurada del módulo.
 *
 *   total  = k_dif·δ_cp                                   (apariencia: ≤ L/300)
 *   activa = k_dif·δ_cp + k_inst·(δ_c − δ_cp) − k_pp·δ_pp  (lo que se deforma tras la tabiquería)
 *
 * δ_cp, δ_c y δ_pp: las flechas elásticas relativas en la ELS cuasipermanente, en la característica y
 * con el peso propio solo. k_dif lleva la fisuración y la fluencia (φef) con el mayor momento
 * cuasipermanente del vano; k_inst, la fisuración sin fluencia con el mayor momento característico; y
 * k_pp, la del peso propio con su momento (lo que ya se había deformado al levantar la tabiquería:
 * sólo su flecha instantánea, que es del lado seguro). Sin caso de peso propio, no se descuenta nada.
 * La armadura, la de la cara que gobierna la flecha: la inferior o, en un voladizo, la superior de su
 * apoyo (como el módulo).
 */
export function flechaVano(g: GeometriaViga, a: ArmadoViga, v: DemandasVano): FlechaComprobada | null {
  const f = v.flecha;
  if (!f) return null;
  const zona: ZonaViga | null = f.voladizo === "fin" ? "inicio" : f.voladizo === "inicio" ? "fin" : null;
  const barras = zona ? armaduraZona(a, zona).superior : a.inferior;
  const cercos = zona ? armaduraZona(a, zona).cercos : a.cercos;
  const d = g.h - a.recubrimiento - cercos.diametro - barras.diametro / 2;
  const As = barras.n * getBarArea(barras.diametro);
  const factor = (M: number, phiEf: number) => crackedDeflectionFactor({ b: g.b, h: g.h, fck: g.fck, As, d, Mcp: M, phiEf });
  const mayor = (l: readonly { momento: number }[]) => l.reduce((m, x) => Math.max(m, x.momento), 0);
  const dif = factor(mayor(f.cuasipermanente), Math.max(0, a.phiEf));
  const kInst = factor(mayor(f.caracteristica), 0).k;
  const kPp = f.pesoPropio ? factor(f.pesoPropio.momento, 0).k : 0;
  let total = { valor: 0, s: f.s[0]!, comb: f.cuasipermanente[0]?.comb ?? "" };
  let activa = { valor: 0, s: f.s[0]!, comb: f.caracteristica[0]?.comb ?? "" };
  // 0 × ∞ (sin flecha y k = ∞ por una cara sin armadura) es 0, no NaN
  const por = (k: number, x: number) => (x === 0 ? 0 : k * x);
  for (const cp of f.cuasipermanente) {
    for (let j = 0; j < f.s.length; j++) {
      const t = Math.abs(por(dif.k, cp.relativa[j]!));
      if (t > total.valor) total = { valor: t, s: f.s[j]!, comb: cp.comb };
      for (const c of f.caracteristica) {
        const x = Math.abs(por(dif.k, cp.relativa[j]!) + por(kInst, c.relativa[j]! - cp.relativa[j]!) - por(kPp, f.pesoPropio?.relativa[j] ?? 0));
        if (x > activa.valor) activa = { valor: x, s: f.s[j]!, comb: c.comb };
      }
    }
  }
  return { kDiferida: dif.k, kInstantanea: kInst, kPesoPropio: kPp, zeta: dif.zeta, total, activa };
}

/** Comprueba un vano de una viga con su armado. */
export function comprobarVano(d: DemandasViga, v: DemandasVano, a: ArmadoViga): ComprobacionVano {
  const filas = new Map<string, FilaViga>();
  const pendientes = new Map<string, PendienteViga>();
  let llamadas = 0;
  const pendiente = (motivo: string, zona?: ZonaViga) => {
    if (!pendientes.has(motivo)) pendientes.set(motivo, { motivo, ...(zona ? { zona } : {}) });
  };
  /** Se queda con la peor de cada fila. */
  const anotar = (id: string, fila: CheckRow, grupo: GrupoArmado, descripcion: string, zona?: ZonaViga, e?: ExtremoViga | null) => {
    const u = aprovechamientoDe(fila);
    const previa = filas.get(id);
    if (previa && !(gravedad(fila.status) > gravedad(previa.estado) || (gravedad(fila.status) === gravedad(previa.estado) && u > previa.aprovechamiento))) return;
    filas.set(id, {
      id,
      ...(zona ? { zona } : {}),
      descripcion,
      articulo: fila.article,
      aprovechamiento: u,
      estado: fila.status,
      ...(informativa(fila) ? { informativa: true as const } : {}),
      ...(e ? { comb: e.comb, s: e.s, ...(e.pesimos ? { pesimos: true as const } : {}) } : {}),
      grupo,
      fila,
    });
  };
  const acabar = (): ComprobacionVano => {
    const lista = [...filas.values()];
    return {
      indice: v.indice,
      desde: v.desde,
      hasta: v.hasta,
      apoyos: v.apoyos,
      filas: lista,
      aprovechamiento: lista.reduce((m, f) => Math.max(m, f.aprovechamiento), 0),
      pendientes: [...pendientes.values()],
      cumple: pendientes.size === 0 && lista.length > 0 && lista.every((f) => f.estado !== "fail"),
      llamadas,
    };
  };

  const g = geometriaViga(d);
  if ("motivo" in g) {
    pendiente(g.motivo);
    return acabar();
  }
  const mat = getConcrete(g.fck);
  const sinEls = v.zonas.some((z) => !z.cpPositivo || !z.cpNegativo);
  if (sinEls) pendiente("sin combinaciones de ELS (casos sin su acción): la fisuración no se comprueba");

  for (const z of v.zonas) {
    const { superior, cercos } = armaduraZona(a, z.zona);
    const e = esfuerzosZona(z);
    const entrada = entradaModuloViga(g, a, z.zona, e);
    const r = calcRCBeam(entrada);
    llamadas++;
    if (!r.valid || !r.vano.valid || !r.apoyo.valid) {
      pendiente(`el módulo no admite la entrada: ${r.error ?? r.vano.error ?? r.apoyo.error ?? "sin motivo"}`, z.zona);
      continue;
    }
    const grupoSuperior: GrupoArmado = z.zona === "inicio" ? "superiorInicio" : z.zona === "fin" ? "superiorFin" : "superior";
    const grupoCercos: GrupoArmado = z.zona === "inicio" ? "cercosInicio" : z.zona === "fin" ? "cercosFin" : "cercos";
    const nombre = NOMBRE_ZONA[z.zona];
    const caras = [
      { cara: "inf", texto: "cara inferior", sec: r.vano, grupo: "inferior" as GrupoArmado, M: e.positivo, Ms: e.cpPositivo, elu: z.positivo, cp: z.cpPositivo, traccion: a.inferior, compresion: superior },
      { cara: "sup", texto: "cara superior", sec: r.apoyo, grupo: grupoSuperior, M: e.negativo, Ms: e.cpNegativo, elu: z.negativo, cp: z.cpNegativo, traccion: superior, compresion: a.inferior },
    ];
    // ─── Flexión, cuantías y fisuración de cada cara ───────────────────────────────────────────
    for (const c of caras) {
      const tracciona = c.M > MOMENTO_MINIMO || c.Ms > MOMENTO_MINIMO;
      for (const fila of c.sec.checks) {
        if (fila.id === "bar-spacing-impossible") anotar(`${z.zona}/${c.cara}-${fila.id}`, fila, c.grupo, `${nombre}, ${c.texto}: ${fila.description}`, z.zona);
        if (!tracciona || !FILAS_FLEXION.has(fila.id)) continue;
        if (fila.id === "cracking" && sinEls) continue;
        const demanda = fila.id === "cracking" ? c.cp : fila.id === "bending" || fila.id === "bending-over" ? c.elu : null;
        anotar(`${z.zona}/${c.cara}-${fila.id}`, fila, c.grupo, `${nombre}, ${c.texto}: ${fila.description}`, z.zona, demanda);
      }
      // Con tracción en la viga (su axil tiene valor), la flexión con su axil: el M–N del módulo
      const N = c.elu.esfuerzos[0]!;
      if (!d.axilSinValor && c.M > MOMENTO_MINIMO && N > TRACCION_MINIMA) {
        const mn = beamMNCapacity(
          { b: g.b, h: g.h, fck: g.fck, fyk: a.fyk, cover: a.recubrimiento, stirrupDiam: cercos.diametro, tensNBars: c.traccion.n, tensBarDiam: c.traccion.diametro, compNBars: c.compresion.n, compBarDiam: c.compresion.diametro },
          -N,
        );
        const u = mn.mode === "ok" && mn.MRd > 0 ? c.M / mn.MRd : Infinity;
        anotar(
          `${z.zona}/${c.cara}-flexotraccion`,
          { id: "flexotraccion", description: "Flexion con traccion: MEd <= MRd(N)", value: `${dec(c.M, 1)} kN·m (N = ${dec(N, 1)} kN)`, limit: `${dec(Math.max(0, mn.MRd), 1)} kN·m`, utilization: u, status: toStatus(u), article: "CE Anejo 19 §6.1" },
          c.grupo,
          `${nombre}, ${c.texto}: Flexion con traccion: MEd <= MRd(N)`,
          z.zona,
          c.elu,
        );
      }
    }
    // ─── El momento mínimo en la cara de un apoyo con continuidad (CO2-j, CE A19 §5.3.2.2(3)) ───
    const emp = z.zona === "inicio" ? v.empotramiento?.[0] : z.zona === "fin" ? v.empotramiento?.[1] : null;
    if (emp && emp.valor < -MOMENTO_MINIMO) {
      const M = FRACCION_EMPOTRAMIENTO * -emp.valor;
      const u = r.apoyo.MRd > 0 ? M / r.apoyo.MRd : Infinity;
      const descripcion = "Momento minimo en la cara del apoyo: 0,65·M de empotramiento perfecto <= MRd";
      anotar(
        `${z.zona}/sup-empotramiento`,
        { id: "empotramiento", description: descripcion, value: `${dec(M, 1)} kN·m (0,65 × ${dec(-emp.valor, 1)})`, limit: `${dec(Math.max(0, r.apoyo.MRd), 1)} kN·m`, utilization: u, status: toStatus(u), article: "CE Anejo 19 §5.3.2.2(3)" },
        grupoSuperior,
        `${nombre}, cara superior: ${descripcion}`,
        z.zona,
        emp,
      );
    }
    anotar(`${z.zona}/as-max`, r.vano.checks.find((f) => f.id === "as-max")!, "seccion", `${nombre}: Armadura maxima (traccion o compresion)`, z.zona);

    // ─── Cortante: la sección cuya cara tracciona donde el cortante es mayor ────────────────────
    const delCortante = z.cortante.esfuerzos[4]! >= 0 ? r.vano : r.apoyo;
    for (const fila of delCortante.checks) {
      if (!FILAS_CORTANTE.has(fila.id)) continue;
      const esfuerzo = fila.id === "shear" || fila.id === "shear-max";
      anotar(`${z.zona}/${fila.id}`, fila, fila.id === "shear-max" ? "seccion" : grupoCercos, `${nombre}: ${fila.description}`, z.zona, esfuerzo ? z.cortante : null);
    }

    // ─── Lo que el módulo no comprueba: compresión de pilar y flexión lateral ───────────────────
    for (const x of [z.positivo, z.negativo, z.cortante, z.torsion]) {
      const [N, Vy, Vz, , My, Mz] = x.esfuerzos as [number, number, number, number, number, number];
      if (!d.axilSinValor && -N > (COMPRESION_RELEVANTE * mat.fcd * g.b * g.h) / 1000)
        pendiente(`la viga lleva una compresión de más del ${Math.round(100 * COMPRESION_RELEVANTE)} % de fcd·Ac: trabaja como un pilar y el módulo de vigas no la comprueba`);
      if (Math.abs(Mz) > Math.max(1, 0.1 * Math.abs(My)) || Math.abs(Vy) > Math.max(1, 0.1 * Math.abs(Vz))) pendiente("la viga tiene flexión lateral (Mz, Vy) que el módulo de vigas no comprueba");
    }

    // ─── Torsión (CO-h) ────────────────────────────────────────────────────────────────────────
    if (z.torsion.valor > MOMENTO_MINIMO) {
      const cPrima = a.recubrimiento + cercos.diametro + Math.max(a.inferior.diametro, superior.diametro) / 2;
      const seccion = { b: g.b, h: g.h, fck: g.fck, fyk: a.fyk, cPrima };
      const t = torsionRC(seccion);
      if (!t) pendiente("la sección es demasiado pequeña para su recubrimiento: la torsión no se comprueba", z.zona);
      else if (!v.torsionEquilibrio) {
        // La de compatibilidad sólo se da si no es ruido: desde el 5 % del torsor de fisuración
        if (z.torsion.valor < TORSION_INFORMATIVA * t.TRdC) continue;
        const sec = z.torsion.esfuerzos[4]! >= 0 ? r.vano : r.apoyo;
        anotar(`${z.zona}/torsion-compatibilidad`, filaTorsionCompatibilidad(t, z.torsion.valor, Math.abs(z.torsion.esfuerzos[2]!), sec.VRdc), grupoCercos, `${nombre}: Torsion de compatibilidad (no se comprueba)`, z.zona, z.torsion);
      } else {
        // Las barras, a lo largo del perímetro: en cada cara y entre las dos (con las de piel)
        const libre = (b: BarrasCara) => (g.b - 2 * (a.recubrimiento + cercos.diametro) - b.diametro) / Math.max(1, b.n - 1);
        const lateral = (g.h - 2 * cPrima) / ((a.piel?.n ?? 0) + 1);
        const separaciones: [number, GrupoArmado][] = [
          [lateral, "piel"],
          [libre(a.inferior), "inferior"],
          [libre(superior), grupoSuperior],
        ];
        const [separacionBarras, grupoBarras] = separaciones.reduce((m, x) => (x[0] > m[0] ? x : m));
        // En el extremo de la torsión y en el del cortante, cada uno con lo que le acompaña
        for (const x of [z.torsion, z.cortante]) {
          const [, , Vz, T, My] = x.esfuerzos as [number, number, number, number, number, number];
          if (!(Math.abs(T) > MOMENTO_MINIMO)) continue;
          const traccionAbajo = My >= 0;
          const sec: RCBeamSectionResult = traccionAbajo ? r.vano : r.apoyo;
          for (const fila of filasTorsion(t, seccion, {
            TEd: Math.abs(T),
            VEd: Math.abs(Vz),
            MEd: Math.abs(My),
            MRd: sec.MRd,
            VRdMax: sec.VRdmax,
            VRdC: sec.VRdc,
            d: sec.d,
            AsTraccion: sec.As,
            AsCompresion: sec.AsComp,
            cercoDiametro: cercos.diametro,
            cercoSeparacion: cercos.separacion,
            ramas: ramasDe(cercos),
            separacionBarras,
          })) {
            const grupo: GrupoArmado =
              fila.id === "torsion-biela"
                ? "seccion"
                : fila.id === "torsion-barras"
                  ? grupoBarras
                  : fila.id === "torsion-longitudinal"
                    ? (fila.value ?? "").includes("comprimido") === traccionAbajo
                      ? grupoSuperior
                      : "inferior"
                    : grupoCercos;
            anotar(`${z.zona}/${fila.id}`, fila, grupo, `${nombre}: ${fila.description}`, z.zona, fila.id === "torsion-separacion" || fila.id === "torsion-barras" ? null : x);
          }
        }
      }
    }
  }

  // ─── Flecha (CO-k) ───────────────────────────────────────────────────────────────────────────
  if (v.sinFlecha) pendiente(v.sinFlecha);
  if (v.sobreCimentacion) {
    const fila: CheckRow = {
      id: "flecha-no-aplica",
      description: `Flecha (no se comprueba): la viga va sobre la losa de cimentación ${v.sobreCimentacion}`,
      value: "apoya en el terreno",
      limit: "—",
      utilization: 0,
      status: "neutral",
      neutral: true,
      article: "CTE DB-SE 4.3.3.1",
    };
    anotar(fila.id, fila, "inferior", fila.description);
  }
  const fl = flechaVano(g, a, v);
  if (fl && v.flecha) {
    const luz = v.flecha.luz;
    const grupo: GrupoArmado = v.flecha.voladizo === "fin" ? "superiorInicio" : v.flecha.voladizo === "inicio" ? "superiorFin" : "inferior";
    const k = (x: number) => (Number.isFinite(x) ? dec(x, 2) : "∞");
    const fila = (id: string, description: string, valor: number, denominador: number, detalle: string, article: string): CheckRow => {
      const adm = luz / denominador;
      const u = valor / adm;
      return { id, description, value: `δ = ${Number.isFinite(valor) ? dec(1000 * valor, 1) : "∞"} mm (${detalle})`, limit: `${v.flecha!.voladizo ? "2L" : "L"}/${denominador} = ${dec(1000 * adm, 1)} mm`, utilization: u, status: toStatus(u), article };
    };
    const total = fila("flecha-total", "Flecha total a plazo infinito (ELS cuasipermanente, seccion fisurada)", fl.total.valor, FLECHA_TOTAL, `k = ${k(fl.kDiferida)}, ζ = ${dec(fl.zeta, 2)}`, "CE Anejo 19 §7.4.3 · CTE DB-SE 4.3.3.1(3)");
    anotar(total.id, total, grupo, total.description, undefined, { valor: fl.total.valor, s: fl.total.s, comb: fl.total.comb, esfuerzos: [] });
    const activa = fila(
      "flecha-activa",
      v.flecha.pesoPropio ? "Flecha activa (ELS caracteristica, tras la instantanea del peso propio)" : "Flecha activa (ELS caracteristica, sin descontar nada)",
      fl.activa.valor,
      a.flechaActiva,
      `k = ${k(fl.kDiferida)} y ${k(fl.kInstantanea)}`,
      "CE Anejo 19 §7.4.3 · CTE DB-SE 4.3.3.1(1)",
    );
    anotar(activa.id, activa, grupo, activa.description, undefined, { valor: fl.activa.valor, s: fl.activa.s, comb: fl.activa.comb, esfuerzos: [] });
  }
  return acabar();
}

/** Comprueba una viga: `armado` da el de cada vano (null si no lo tiene: ese vano no cumple). */
export function comprobarViga(d: DemandasViga, armado: (v: DemandasVano) => ArmadoViga | null): ComprobacionViga {
  const vanos = d.vanos.map((v) => {
    const a = armado(v);
    if (a) return comprobarVano(d, v, a);
    return { indice: v.indice, desde: v.desde, hasta: v.hasta, apoyos: v.apoyos, filas: [], aprovechamiento: 0, pendientes: [{ motivo: "el vano no tiene armado" }], cumple: false, llamadas: 0 };
  });
  return { viga: d.viga, cumple: vanos.every((v) => v.cumple), vanos };
}
