/**
 * Fase CO5 (`docs/fem3d/comprobaciones.md` §8.9): comprobar la zapata aislada de un pilar con sus
 * dimensiones y sus parrillas.
 *
 * El juez es el módulo de zapatas de Concreta (`calcIsolatedFooting`, copiado sin tocar en
 * `../concreta/`): la presión sobre el área equivalente frente a la tensión admisible (DB SE-C
 * 4.3.1.3), con la distribución trapecial, bitriangular o de contacto parcial; el vuelco (FS ≥ 2) y el
 * deslizamiento (FS ≥ 1,5) con acciones características; y, con las de cálculo, la flexión o la biela
 * y tirante (rígida si el vuelo no pasa de 2h), el cortante a un canto útil, el punzonamiento en los
 * perímetros dentro de 2d, los anclajes, las cuantías y la parrilla superior si hay despegue. Toma un
 * juego de esfuerzos y un γ global; lo que le falta va aquí:
 *
 *  - **Tres llamadas por terna,** cada una con sus filas (las demás se tiran): una con la carga
 *    característica de una combinación GEO o GEO-SIS para el terreno (presión y vuelco); otra con la
 *    misma y su H, para el deslizamiento; y una con la de cálculo de una combinación de ELU (ELU-PT,
 *    ELU-ACC, ELU-SIS) para el armado, sin mayorar (γ = 1). La presión y el armado van sin H: su
 *    momento en la cara inferior (H·h) ya está en la carga con su dirección (el módulo, que no la
 *    conoce, pondría todo |H| en una sola).
 *  - **La posición.** El módulo tiene el lindero de una medianera en x = −B/2 y la esquina en (−B/2,
 *    −L/2). Una zapata con otros linderos se le da girada o reflejada para que caigan ahí (con un
 *    lindero según y, con x e y cambiados), y sus filas vuelven a los ejes de la zapata.
 *  - **Las vigas centradoras:** la luz es la distancia del eje del pilar al del pilar al que va,
 *    proyectada en la dirección perpendicular al lindero; si esa dirección y la de la viga se separan
 *    más de `ANGULO_CENTRADORA`, pendiente. La descarga al pilar interior no se descuenta de su zapata
 *    (del lado seguro en la presión) y la viga no se comprueba: sus esfuerzos van como información.
 *  - **Un pilar circular** de diámetro D se le da como uno cuadrado de lado π·D/4: el perímetro a
 *    cualquier distancia es el del círculo (el del punzonamiento, exacto), y su cara queda más cerca
 *    del centro que la del círculo (la flexión de los vuelos, del lado seguro).
 *  - **Las tierras:** la profundidad del módulo es Df = h + las tierras sobre la zapata.
 *
 * Lo que no se comprueba no sale nunca como «cumple»: va a `pendientes`. El pilar que tira de la
 * zapata (N ≤ 0 en una combinación) también: el módulo sólo conoce la compresión.
 */
import { isolatedFootingDefaults, type IsolatedFootingInputs, type TipoZapata } from "../concreta/data/defaults.ts";
import { calcIsolatedFooting, type IsolatedFootingResult } from "../concreta/lib/calculations/isolatedFooting.ts";
import type { CheckRow, CheckStatus } from "../concreta/lib/calculations/types.ts";
import { DATOS_ARMADO, tipoZapata, type DatosArmado, type ParrillaZapata, type Zapata } from "../armado.ts";
import type { CargaZapata, DemandasZapata } from "../demandas/zapatas.ts";

/** Una viga centradora que se separa más que esto (grados) de la perpendicular al lindero no se le da al módulo. */
export const ANGULO_CENTRADORA = 15;
/** Sin compresión (N ≤ 0), el pilar tira de la zapata: el módulo no lo comprueba. */
export const N_MINIMO = 0;

/** Lo que hay que cambiar si una fila falla: el tamaño en planta, el canto o una parrilla. */
export type GrupoZapata = "planta" | "canto" | "inferior-x" | "inferior-y" | "superior-x" | "superior-y";

export interface FilaZapata {
  /** El del módulo, en los ejes de la zapata (`bearing`, `overturn-x`, `flexion-y`…). */
  id: string;
  descripcion: string;
  articulo: string;
  /** El del módulo; infinito si falla sin cociente. */
  aprovechamiento: number;
  estado: CheckStatus;
  comb?: string;
  grupo: GrupoZapata;
  valor?: string;
  limite?: string;
  /** Un aviso del módulo que no es un incumplimiento (la excentricidad de más de un tercio del lado, el anclaje con patilla). */
  informativa?: true;
}

/** Los datos de la zapata que no son suyos: el hormigón, el acero, el recubrimiento y el terreno. */
export interface DatosZapata {
  /** MPa. */
  fck: number;
  fyk: number;
  /** mm, hasta la cara de la barra. */
  recubrimiento: number;
  /** kPa; sin ella, el terreno no se comprueba. */
  tensionAdmisible?: number;
  /** En GEO-SIS, kPa. */
  tensionAdmisibleSismo?: number;
  /** kN/m³. */
  pesoEspecifico: number;
  rozamiento: number;
  /** m sobre la zapata. */
  tierras: number;
}

/** Una viga centradora: el pilar al que va y su luz (m) proyectada; y, como información, lo más que lleva en ELU. */
export interface CentradoraZapata {
  pilar: string;
  /** En los ejes de la zapata. */
  direccion: "x" | "y";
  luz: number;
  /** El ángulo con la perpendicular al lindero, grados. */
  angulo: number;
  /** De cálculo: cortante y momento en la cara interior de la zapata, kN y kN·m, y su combinación. */
  Vd?: number;
  Md?: number;
  comb?: string;
}

/** El otro pilar de una viga centradora: su eje en planta, m. */
export interface OtroPilar {
  id: string;
  punto: readonly [number, number];
}

export interface ComprobacionZapata {
  pilar: string;
  tipo: TipoZapata;
  cumple: boolean;
  filas: FilaZapata[];
  /** Lo que no se comprueba; `arranque`, una combinación en la que el pilar tira de la zapata (las demás sí se comprueban). */
  pendientes: { motivo: string; comb?: string; arranque?: true }[];
  /** De la combinación de mayor presión: la presión sobre el área equivalente y la máxima (kPa), y la distribución. */
  presion?: { qb: number; sigmaMax: number; sigmaMin: number; distribucion: IsolatedFootingResult["distributionType"]; fraccionApoyada: number; tensionAdmisible: number; comb: string };
  /** Rígida (vuelo ≤ 2h): biela y tirante; flexible: flexión, cortante. De la combinación de ELU que manda. */
  rigida?: boolean;
  centradoras: CentradoraZapata[];
  llamadas: number;
  /** La terna que tumbó la comprobación: con ella empieza la siguiente (al proponer). */
  primera?: { grupo: "geo" | "elu"; i: number };
}

export interface OpcionesComprobarZapata {
  /** Cortar en la primera fila que falla (al proponer). */
  parar?: boolean;
  /** Empezar por esta terna. */
  primero?: { grupo: "geo" | "elu"; i: number };
}

/** Una zapata con dimensiones y parrilla inferior: la que se puede comprobar. */
export type ZapataCompleta = Zapata & { B: number; L: number; h: number; inferior: ParrillaZapata };

export const completa = (z: Zapata | undefined): z is ZapataCompleta => !!z && z.B !== undefined && z.L !== undefined && z.h !== undefined && !!z.inferior;

/**
 * Los datos de la zapata: el hormigón (el suyo, el de la obra o HA-25), el acero y el recubrimiento
 * de la obra, y el terreno.
 */
export function datosZapata(fck: number, armado: DatosArmado | undefined, terreno: { tensionAdmisible?: number; tensionAdmisibleSismo?: number; pesoEspecifico?: number; rozamiento?: number; tierras?: number } | undefined, tierras?: number): DatosZapata {
  return {
    fck,
    fyk: armado?.fyk ?? DATOS_ARMADO.fyk,
    recubrimiento: armado?.recubrimientoZapatas ?? DATOS_ARMADO.recubrimientoZapatas,
    ...(terreno?.tensionAdmisible !== undefined ? { tensionAdmisible: terreno.tensionAdmisible } : {}),
    ...(terreno?.tensionAdmisibleSismo !== undefined ? { tensionAdmisibleSismo: terreno.tensionAdmisibleSismo } : {}),
    pesoEspecifico: terreno?.pesoEspecifico ?? 18,
    rozamiento: terreno?.rozamiento ?? 0.5,
    tierras: tierras ?? terreno?.tierras ?? 0,
  };
}

/**
 * Cómo se le da la zapata al módulo: sus ejes (u, v) son los de la zapata (x, y), cambiados si
 * `cambia`, y con el signo `su`, `sv`: u = su·x (o su·y), v = sv·y (o sv·x).
 */
export interface Orientacion {
  tipo: TipoZapata;
  cambia: boolean;
  su: 1 | -1;
  sv: 1 | -1;
}

export function orientacion(z: Zapata): Orientacion {
  const ls = z.linderos ?? [];
  const tipo = tipoZapata(z);
  if (tipo === "centrada") return { tipo, cambia: false, su: 1, sv: 1 };
  // El lindero del módulo está en −u: una cara «+» va a −u con su = −1
  const signo = (l: string): 1 | -1 => (l[0] === "+" ? -1 : 1);
  if (tipo === "medianera") {
    const l = ls[0]!;
    return l[1] === "x" ? { tipo, cambia: false, su: signo(l), sv: 1 } : { tipo, cambia: true, su: signo(l), sv: 1 };
  }
  const lx = ls.find((l) => l[1] === "x")!;
  const ly = ls.find((l) => l[1] === "y")!;
  return { tipo, cambia: false, su: signo(lx), sv: signo(ly) };
}

/** Un vector (x, y) de la zapata en los ejes del módulo. */
const aModulo = (o: Orientacion, x: number, y: number): [number, number] => (o.cambia ? [o.su * y, o.sv * x] : [o.su * x, o.sv * y]);

/** Un id o un texto del módulo en los ejes de la zapata: con los ejes cambiados, x por y. */
function aZapata(o: Orientacion, t: string): string {
  if (!o.cambia) return t;
  return t.replace(/-([xy])\b/g, (_, e: string) => `-${e === "x" ? "y" : "x"}`).replace(/dir\. ([xy])\b/g, (_, e: string) => `dir. ${e === "x" ? "y" : "x"}`);
}

/** Las filas de cada llamada. */
const FILAS_TERRENO = new Set(["bearing", "excentricidad-x", "excentricidad-y", "overturn-x", "overturn-y"]);
const FILA_DESLIZAMIENTO = "sliding";

/** El grupo de una fila (en los ejes de la zapata). */
function grupoDe(id: string, r: CheckRow): GrupoZapata {
  if (FILAS_TERRENO.has(id) || id === FILA_DESLIZAMIENTO || /^(bearing|overturn|excentricidad)/.test(id)) return "planta";
  if (/^punzonamiento|^cortante-/.test(id)) return "canto";
  // Sobrearmada: no la arregla una parrilla
  if (/^(flexion|biela-tirante)-/.test(id) && r.value === "∞") return "canto";
  const d = id.endsWith("-y") ? "y" : "x";
  if (/^(armado-sup|traccion-sup|separacion-sup)-/.test(id)) return `superior-${d}`;
  return `inferior-${d}`;
}

const UNIDAD: Record<string, string> = { soilPressure: "kPa", stress: "MPa", linearLoad: "kN/m" };
const num = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(Math.abs(x) >= 10 ? 1 : 2)).replace(".", ",");
const valorDe = (r: CheckRow): string | undefined => r.value ?? r.valueStr ?? (r.valueNum !== undefined ? `${num(r.valueNum)}${r.valueQty ? ` ${UNIDAD[r.valueQty] ?? ""}`.trimEnd() : ""}` : undefined);
const limiteDe = (r: CheckRow): string | undefined => r.limit ?? r.limitStr ?? (r.limitNum !== undefined ? `${num(r.limitNum)}${r.limitQty ? ` ${UNIDAD[r.limitQty] ?? ""}`.trimEnd() : ""}` : undefined);

/** Lo que va igual en las tres llamadas: la geometría, los materiales, el terreno y la armadura, en los ejes del módulo. */
export function entradaBase(D: DemandasZapata, z: ZapataCompleta, d: DatosZapata, o: Orientacion, vigas: { x?: number; y?: number }): IsolatedFootingInputs {
  const [cx, cy] = D.circular ? [(Math.PI * D.cx) / 4, (Math.PI * D.cx) / 4] : [D.cx, D.cy];
  const [B, L] = o.cambia ? [z.L, z.B] : [z.B, z.L];
  const [bc, hc] = o.cambia ? [cy, cx] : [cx, cy];
  const inf = o.cambia ? { x: z.inferior.y, y: z.inferior.x } : z.inferior;
  const sup = z.superior && (o.cambia ? { x: z.superior.y, y: z.superior.x } : z.superior);
  return {
    ...isolatedFootingDefaults,
    title: "",
    B,
    L,
    h: z.h,
    bc,
    hc,
    Df: z.h + d.tierras,
    cover: d.recubrimiento,
    // Sin la tensión admisible, las filas del terreno no se toman
    sigma_adm: d.tensionAdmisible ?? 1,
    loadsAreFactored: false,
    loadFactor: 1,
    N: 0,
    Mx: 0,
    My: 0,
    H: 0,
    fck: d.fck,
    fyk: d.fyk,
    phi_x: inf.x.diametro,
    s_x: inf.x.separacion,
    phi_y: inf.y.diametro,
    s_y: inf.y.separacion,
    gamma_soil_kN_m3: d.pesoEspecifico,
    mu_friction: d.rozamiento,
    tipo: o.tipo,
    vigaX: vigas.x !== undefined,
    luzX: vigas.x ?? isolatedFootingDefaults.luzX,
    vigaY: vigas.y !== undefined,
    luzY: vigas.y ?? isolatedFootingDefaults.luzY,
    supLleva: !!sup,
    phi_sup_x: sup?.x.diametro ?? isolatedFootingDefaults.phi_sup_x,
    s_sup_x: sup?.x.separacion ?? isolatedFootingDefaults.s_sup_x,
    phi_sup_y: sup?.y.diametro ?? isolatedFootingDefaults.phi_sup_y,
    s_sup_y: sup?.y.separacion ?? isolatedFootingDefaults.s_sup_y,
  };
}

/** Una carga en los ejes del módulo: N, y Mx y My con su convenio (la excentricidad de la resultante es M/N, ey con Mx y ex con My). */
export function cargaModulo(c: CargaZapata, o: Orientacion): { N: number; Mx: number; My: number; H: number } {
  // En los ejes de la zapata: ex = My/N, ey = −Mx/N
  const [eu, ev] = aModulo(o, c.My, -c.Mx);
  return { N: c.N, Mx: ev, My: eu, H: Math.hypot(c.Hx, c.Hy) };
}

/** Las vigas centradoras de una zapata, en los ejes del módulo; o por qué no se le pueden dar. */
export function centradorasDe(D: DemandasZapata, z: Zapata, o: Orientacion, otros: readonly OtroPilar[]): { vigas: { x?: number; y?: number }; lista: CentradoraZapata[]; pendientes: string[] } {
  const vigas: { x?: number; y?: number } = {};
  const lista: CentradoraZapata[] = [];
  const pendientes: string[] = [];
  const t = (D.giro * Math.PI) / 180;
  const [c, s] = [Math.cos(t), Math.sin(t)];
  for (const id of z.centradoras ?? []) {
    const p = otros.find((x) => x.id === id);
    if (!p) {
      pendientes.push(`la viga centradora va a ${id}, que no tiene posición`);
      continue;
    }
    const [gx, gy] = [p.punto[0] - D.punto[0], p.punto[1] - D.punto[1]];
    const [dx, dy] = [c * gx + s * gy, -s * gx + c * gy];
    const [du, dv] = aModulo(o, dx, dy);
    // La viga del módulo según u va hacia +u (el interior de una medianera o de una esquina); según v, sólo en esquina
    const enU = du > 0 && (o.tipo === "medianera" || o.tipo === "esquina");
    const enV = dv > 0 && o.tipo === "esquina";
    const angU = enU ? (Math.atan2(Math.abs(dv), du) * 180) / Math.PI : Infinity;
    const angV = enV ? (Math.atan2(Math.abs(du), dv) * 180) / Math.PI : Infinity;
    const porU = angU <= angV;
    const ang = porU ? angU : angV;
    if (!(ang <= ANGULO_CENTRADORA)) {
      pendientes.push(`la viga centradora a ${id} no va hacia el interior en perpendicular a un lindero (se separa ${Number.isFinite(ang) ? `${ang.toFixed(0)}°` : "más de 90°"})`);
      continue;
    }
    const k = porU ? "x" : "y";
    if (vigas[k] !== undefined) {
      pendientes.push(`hay dos vigas centradoras en la misma dirección (la de ${id} sobra)`);
      continue;
    }
    vigas[k] = porU ? du : dv;
    // Su dirección en los ejes de la zapata: la que va a u (o a v) en el módulo
    const direccion: "x" | "y" = (porU ? !o.cambia : o.cambia) ? "x" : "y";
    lista.push({ pilar: id, direccion, luz: porU ? du : dv, angulo: ang });
  }
  return { vigas, lista, pendientes };
}

const reducidas = new WeakMap<object, Map<string, { geo: CargaZapata[]; elu: CargaZapata[] }>>();

/**
 * Lo que el módulo da al terreno (la presión, la excentricidad, el vuelco y el deslizamiento) no
 * depende de las parrillas: sale de las dimensiones, el pilar, las cargas y el terreno. Al proponer,
 * las zapatas que sólo cambian de parrilla repiten esas llamadas (más de la mitad de las de una
 * comprobación entera); aquí se guardan por pilar, con la entrada sin las parrillas, sólo de lo que
 * se toma de ellas. Sólo cuando las parrillas no pueden hacer que el módulo la rechace (sus
 * diámetros y separaciones, y el canto útil), así que da lo mismo que llamarlo.
 */
interface Terreno {
  checks: CheckRow[];
  qb: number;
  sigma_max: number;
  sigma_min: number;
  distributionType: IsolatedFootingResult["distributionType"];
  loaded_area_fraction: number;
}
const terrenos = new WeakMap<DemandasZapata, Map<string, Map<string, Terreno>>>();
const PARRILLAS = new Set(["phi_x", "s_x", "phi_y", "s_y", "supLleva", "phi_sup_x", "s_sup_x", "phi_sup_y", "s_sup_y"]);
/** Lo que cambia de una llamada del terreno a otra con la misma zapata: la terna y la tensión admisible. */
const VARIAN = new Set(["sigma_adm", "N", "Mx", "My", "H"]);
const texto = (v: unknown) => (typeof v === "number" && Object.is(v, -0) ? "-0" : String(v));
/** La zapata, sin sus parrillas: todo lo de la entrada salvo lo que cambia de una terna a otra. */
const claveZapata = (inp: IsolatedFootingInputs): string => {
  let k = "";
  for (const [c, v] of Object.entries(inp)) if (!PARRILLAS.has(c) && !VARIAN.has(c)) k += `${c}=${texto(v)};`;
  return k;
};
const claveTerna = (inp: IsolatedFootingInputs): string => `${texto(inp.sigma_adm)}|${texto(inp.N)}|${texto(inp.Mx)}|${texto(inp.My)}|${texto(inp.H)}`;
/** Las parrillas no hacen que el módulo la rechace (`calcIsolatedFooting`: sus diámetros, separaciones y cantos útiles). */
const parrillasValidas = (inp: IsolatedFootingInputs): boolean =>
  inp.phi_x > 0 && inp.phi_y > 0 && inp.s_x > 0 && inp.s_y > 0 && (!inp.supLleva || (inp.phi_sup_x > 0 && inp.phi_sup_y > 0 && inp.s_sup_x > 0 && inp.s_sup_y > 0)) && inp.h * 1000 - inp.cover - inp.phi_x / 2 > 0 && inp.h * 1000 - inp.cover - inp.phi_x - inp.phi_y / 2 > 0;

/**
 * Las ternas que cuentan para una zapata: sin las que son la imagen especular de otra. El módulo es
 * simétrico respecto a los ejes de una zapata centrada (sólo cuentan |Mx| y |My|) y, en una de
 * medianera, respecto al perpendicular al lindero (sólo cuenta |Mx| del módulo): dos ternas que sólo
 * difieren en esos signos dan lo mismo, y va una. No se queda con la de mayor |M| de las que difieren
 * en su valor: el módulo no es monótono en la excentricidad (al concentrarse la presión cambia lo que
 * se descuenta bajo el pilar en el punzonamiento), y se perdería la pésima.
 */
export function ternasDe(c: { geo: CargaZapata[]; elu: CargaZapata[] }, o: Orientacion): { geo: CargaZapata[]; elu: CargaZapata[] } {
  let porTipo = reducidas.get(c);
  if (!porTipo) reducidas.set(c, (porTipo = new Map()));
  const k = `${o.tipo}|${o.cambia}|${o.su}|${o.sv}`;
  const hit = porTipo.get(k);
  if (hit) return hit;
  const reducir = (l: CargaZapata[]) => {
    const r: CargaZapata[] = [];
    const vistos = new Set<string>();
    for (const x of l) {
      // Los momentos del módulo: Mx según v y My según u; sin signo, lo simétrico
      const m = cargaModulo(x, o);
      const u = o.tipo === "centrada" ? Math.abs(m.My) : m.My;
      const v = o.tipo === "esquina" ? m.Mx : Math.abs(m.Mx);
      const clave = `${x.comb}|${m.N}|${u}|${v}|${m.H}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      r.push(x);
    }
    return r;
  };
  const x = { geo: reducir(c.geo), elu: reducir(c.elu) };
  porTipo.set(k, x);
  return x;
}

/**
 * Comprueba la zapata de un pilar en todas sus combinaciones: de cada fila, la peor, con su
 * combinación. `otros`, los ejes de los pilares a los que van sus vigas centradoras.
 */
export function comprobarZapata(D: DemandasZapata, z: ZapataCompleta, d: DatosZapata, otros: readonly OtroPilar[] = [], op: OpcionesComprobarZapata = {}): ComprobacionZapata {
  const o = orientacion(z);
  const filas = new Map<string, FilaZapata>();
  const pendientes: { motivo: string; comb?: string; arranque?: true }[] = [];
  const pendiente = (motivo: string, comb?: string) => {
    if (!pendientes.some((p) => p.motivo === motivo)) pendientes.push({ motivo, ...(comb ? { comb } : {}) });
  };
  /** La combinación en la que más tira el pilar de la zapata. */
  let tira: { N: number; comb: string } | undefined;
  const cen = centradorasDe(D, z, o, otros);
  for (const m of cen.pendientes) pendiente(m);
  const base: ComprobacionZapata = { pilar: D.pilar, tipo: o.tipo, cumple: false, filas: [], pendientes, centradoras: cen.lista, llamadas: 0 };
  if (D.cx <= 0 || D.cy <= 0) {
    pendiente(`la sección ${D.seccion.id} del pilar no es rectangular ni circular`);
    return base;
  }
  if (cen.pendientes.length) return base;
  const e0 = entradaBase(D, z, d, o, cen.vigas);
  const { geo, elu } = ternasDe(D.cargas(z.h), o);
  let llamadas = 0;
  let presion: ComprobacionZapata["presion"];
  let rigida: boolean | undefined;
  let peorElu = -Infinity;
  let primera: ComprobacionZapata["primera"];
  let parado = false;
  const tomar = (rs: readonly CheckRow[], quiere: (id: string) => boolean, comb: string, terna: { grupo: "geo" | "elu"; i: number }) => {
    let falla = false;
    for (const r of rs) {
      if (r.status === "neutral" || !quiere(r.id)) continue;
      const id = aZapata(o, r.id);
      const u = Number.isFinite(r.utilization) ? r.utilization : Infinity;
      const f: FilaZapata = { id, descripcion: aZapata(o, r.description), articulo: r.article, aprovechamiento: u, estado: r.status, comb, grupo: grupoDe(id, r), ...(valorDe(r) ? { valor: valorDe(r) } : {}), ...(limiteDe(r) ? { limite: limiteDe(r) } : {}), ...(r.status === "warn" && u >= 1 ? { informativa: true as const } : {}) };
      const prev = filas.get(id);
      const peso = (x: FilaZapata) => (x.estado === "fail" ? 1 : 0);
      if (!prev || peso(f) > peso(prev) || (peso(f) === peso(prev) && f.aprovechamiento > prev.aprovechamiento)) filas.set(id, f);
      if (r.status === "fail") falla = true;
    }
    if (falla && !primera) primera = terna;
    if (falla && op.parar) parado = true;
  };
  const llamar = (inp: IsolatedFootingInputs, comb: string): IsolatedFootingResult | null => {
    llamadas++;
    const r = calcIsolatedFooting(inp);
    if (r.error) {
      pendiente(`el módulo de zapatas no la admite: ${r.error}`, comb);
      return null;
    }
    return r;
  };
  let porZapata = terrenos.get(D);
  if (!porZapata) terrenos.set(D, (porZapata = new Map()));
  const validas = parrillasValidas(e0);
  const kz = validas ? claveZapata(e0) : "";
  let guardados = validas ? porZapata.get(kz) : undefined;
  if (validas && !guardados) porZapata.set(kz, (guardados = new Map()));
  /** La llamada del terreno, o la que ya se hizo con la misma entrada salvo las parrillas. */
  const delTerreno = (inp: IsolatedFootingInputs, comb: string, quiere: (id: string) => boolean): Terreno | null => {
    const k = validas ? claveTerna(inp) : "";
    const hit = validas ? guardados!.get(k) : undefined;
    if (hit) return hit;
    const r = llamar(inp, comb);
    if (!r) return null;
    const x: Terreno = { checks: r.checks.filter((f) => quiere(f.id)), qb: r.qb, sigma_max: r.sigma_max, sigma_min: r.sigma_min, distributionType: r.distributionType, loaded_area_fraction: r.loaded_area_fraction };
    if (validas) guardados!.set(k, x);
    return x;
  };
  const terreno = (c: CargaZapata, i: number) => {
    const m = cargaModulo(c, o);
    if (!(m.N > N_MINIMO)) return void (tira = !tira || m.N < tira.N ? { N: m.N, comb: c.comb } : tira);
    if (d.tensionAdmisible === undefined) return void pendiente("sin la tensión admisible del terreno (obra.terreno.tensionAdmisible), la presión, el vuelco y el deslizamiento no se comprueban");
    const sigma = c.situacion === "GEO-SIS" ? (d.tensionAdmisibleSismo ?? d.tensionAdmisible) : d.tensionAdmisible;
    const inp = { ...e0, sigma_adm: sigma, N: m.N, Mx: m.Mx, My: m.My, H: 0 };
    const r = delTerreno(inp, c.comb, (id) => FILAS_TERRENO.has(id));
    if (!r) return;
    tomar(r.checks, (id) => FILAS_TERRENO.has(id), c.comb, { grupo: "geo", i });
    if (!presion || r.qb > presion.qb) presion = { qb: r.qb, sigmaMax: r.sigma_max, sigmaMin: r.sigma_min, distribucion: r.distributionType, fraccionApoyada: r.loaded_area_fraction, tensionAdmisible: sigma, comb: c.comb };
    if (parado || !(m.H > 0)) return;
    const rd = delTerreno({ ...inp, H: m.H }, c.comb, (id) => id === FILA_DESLIZAMIENTO);
    if (rd) tomar(rd.checks, (id) => id === FILA_DESLIZAMIENTO, c.comb, { grupo: "geo", i });
  };
  const armado = (c: CargaZapata, i: number) => {
    const m = cargaModulo(c, o);
    if (!(m.N > N_MINIMO)) return void (tira = !tira || m.N < tira.N ? { N: m.N, comb: c.comb } : tira);
    const r = llamar({ ...e0, loadsAreFactored: true, N: m.N, Mx: m.Mx, My: m.My, H: 0 }, c.comb);
    if (!r) return;
    tomar(r.checks, (id) => !FILAS_TERRENO.has(id) && id !== FILA_DESLIZAMIENTO, c.comb, { grupo: "elu", i });
    const u = Math.max(...r.checks.filter((x) => x.status !== "neutral" && !FILAS_TERRENO.has(x.id) && x.id !== FILA_DESLIZAMIENTO && Number.isFinite(x.utilization)).map((x) => x.utilization));
    if (u > peorElu) {
      peorElu = u;
      rigida = r.isRigid;
    }
    for (const [k, v] of [["x", r.vigaX], ["y", r.vigaY]] as const) {
      if (!v) continue;
      const x = cen.lista.find((y) => (o.cambia ? (k === "x" ? "y" : "x") : k) === y.direccion);
      if (x && !(v.Vd <= (x.Vd ?? -1))) Object.assign(x, { Vd: v.Vd, Md: v.Md, comb: c.comb });
    }
  };
  // El orden: la terna que tumbó la anterior, el terreno y el armado
  const orden: { grupo: "geo" | "elu"; i: number }[] = [...geo.map((_, i) => ({ grupo: "geo" as const, i })), ...elu.map((_, i) => ({ grupo: "elu" as const, i }))];
  if (op.primero) {
    const k = orden.findIndex((x) => x.grupo === op.primero!.grupo && x.i === op.primero!.i);
    if (k > 0) orden.unshift(...orden.splice(k, 1));
  }
  for (const t of orden) {
    if (t.grupo === "geo") terreno(geo[t.i]!, t.i);
    else armado(elu[t.i]!, t.i);
    if (parado) break;
  }
  if (tira) pendientes.push({ motivo: `el pilar tira de la zapata (N = ${tira.N.toFixed(1).replace(".", ",")} kN): el arranque (su peso frente a la tracción y el anclaje del pilar) no se comprueba`, comb: tira.comb, arranque: true });
  const lista = [...filas.values()];
  const cumple = !parado && !pendientes.length && lista.length > 0 && !lista.some((f) => f.estado === "fail");
  return { ...base, cumple, filas: lista, llamadas, ...(presion ? { presion } : {}), ...(rigida !== undefined ? { rigida } : {}), ...(primera ? { primera } : {}) };
}
