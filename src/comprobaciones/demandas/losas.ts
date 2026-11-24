/**
 * Fase CO3 (`docs/fem3d/comprobaciones.md` §4.3): las demandas de las losas macizas y reticulares.
 *
 * Son las de sus franjas de armado (fase F): en cada estación de cada franja, y para la armadura de la
 * dirección de la franja,
 *  - en ELU, el momento de dimensionado de la cara inferior y de la superior (Wood–Armer con los
 *    momentos medios, `Consultas.armadoFranja`; con el sismo del programa, el pésimo, VS-o) y el mayor
 *    cortante medio (`Consultas.cortanteFranja`);
 *  - en la ELS cuasipermanente, los mismos momentos (fisuración).
 * Por metro de ancho; en los nervios de un reticular se pasan a su nervio con `ancho`.
 *
 * El cortante de una estación no cuenta (`cortante: null`):
 *  - en el metro de un pilar (lo que pasa por su huella): es del punzonamiento (CO4);
 *  - en una estación de paso cuya recta, en el ancho de la franja, pasa a menos de
 *    `CANTOS_PUNZONAMIENTO` cantos de un pilar que llega a la planta: ahí la losa no trabaja como una
 *    viga ancha, y lo que la cruza llega a la huella del pilar (punzonamiento) o a la cara de una viga
 *    o un apoyo, cuya estación sí se comprueba. Por campos, junto a la esquina de un pilar y una viga
 *    no converge (en la vivienda, de 138 a 91 kN/m al pasar de h = 0,75 a 0,375);
 *  - CO4-7 (decisión del usuario, 2026-11-22): en una estación con menos de un canto de losa en el
 *    ancho de la franja (`anchoEnLosa` < espesor), una astilla de losa junto a una viga que corre a lo
 *    largo de la franja, o junto al borde. No trabaja como una losa ancha sino con la viga; en la
 *    vivienda, 8 cm de losa en la esquina de dos vigas que se cruzan en P4 daban 22,5 kN repartidos en
 *    ellos, 281 kN/m. Se avisa (`comprobacion/cortante-astilla`).
 * El de una estación de apoyo (la cara de una viga, de un muro o un apoyo lineal) se comprueba
 * siempre, también junto a un pilar: lo que pasa por ella va a la viga o al apoyo, no a la huella del
 * pilar, y el punzonamiento no lo ve (CO4-4). Es exacto (por fuerzas nodales).
 *
 * El contrato, como en los pilares y las vigas: sólo se lee por `Consultas`, sin ver vectores por caso
 * ni factores. Cada fila del módulo depende de un solo esfuerzo, así que bastan sus envolventes.
 */
import { conjuntoCombinaciones } from "../../agente/combinaciones.ts";
import { abacosDe } from "../../compilador/abacos.ts";
import type { Consultas, Respuesta } from "../../compilador/consultas.ts";
import type { Material, Vec2 } from "../../compilador/fisico.ts";
import { PASO_ESTACIONES, type Franja } from "../../compilador/franjas.ts";
import type { Diagnostico } from "../../motor/diagnosticos.ts";
import type { ArmaduraForjado } from "../armado.ts";
import { agotar, type Paso } from "../pasos.ts";
import { SITUACIONES_ELU } from "./pilares.ts";

/** Distancia a la cara de un pilar, en cantos de la losa, hasta la que el cortante es del punzonamiento (el perímetro crítico, a 2·d). */
export const CANTOS_PUNZONAMIENTO = 2;
/**
 * Parte del ancho de una estación de un reticular que tiene que ser de ábaco para que su sección sea
 * la maciza: la mitad, es decir, que el nervio de la franja (su centro) esté en el ábaco. La franja
 * del último nervio de un ábaco sale medio casetón de él.
 */
export const FRACCION_ABACO = 0.5;
/** Distancia mínima entre dos apoyos de una franja para contarla como una luz, m. */
const LUZ_MINIMA = 1;

export type SeccionLosa = "maciza" | "nervio" | "abaco";

export interface EstacionLosa {
  franja: string;
  /** Su índice entre las estaciones de la franja. */
  indice: number;
  /** A lo largo de la franja (s = p·d), m. */
  s: number;
  tipo: "cara" | "apoyo" | "paso";
  /** Lo que colorea en el mapa de armado: [a, b] a lo largo (hasta la mitad de sus vecinas) y [t0, t1] en transversal, m. */
  a: number;
  b: number;
  t0: number;
  t1: number;
  /** La sección que trabaja: la losa maciza, el nervio de un reticular o su ábaco (macizo). */
  seccion: SeccionLosa;
  /** Ancho que lleva un nervio, m: el de la franja o, en el metro de un pilar, el de su ventana. 1 en una maciza y en un ábaco. */
  ancho: number;
  /** ELU: momento de dimensionado de cada cara (≥ 0), kN·m/m, con su combinación. */
  inferior: number;
  superior: number;
  combInferior: string;
  combSuperior: string;
  /** ELU: el mayor cortante medio, kN/m; null en el metro de un pilar (punzonamiento) y en las estaciones de paso junto a un pilar. */
  cortante: number | null;
  combCortante: string;
  /** Por qué no tiene cortante: el punzonamiento («pilar») o menos de un canto de losa en la franja («astilla», CO4-7). */
  sinCortante: "pilar" | "astilla" | null;
  /** ELS cuasipermanente: momento de cada cara, kN·m/m (0 sin combinaciones de ELS). */
  cpInferior: number;
  cpSuperior: number;
  /** La menor luz de su franja entre apoyos, m (para el ancho eficaz del nervio). */
  luz: number;
}

export interface DemandasDireccion {
  /** 1: las armaduras X (según el eje 1 de la losa); 2: las Y. */
  direccion: 1 | 2;
  d: Vec2;
  n: Vec2;
  franjas: Franja[];
  /** Las estaciones válidas de todas sus franjas, por franja y por s. */
  estaciones: EstacionLosa[];
  /** Estaciones sin valor (un corte que no sigue la malla): no se comprueban. */
  sinValor: number;
}

export interface DemandasLosa {
  losa: string;
  planta: string;
  /** Canto total, m. */
  espesor: number;
  material: Material;
  /** Reticular: intereje, ancho del nervio y capa de compresión, m. */
  reticular: { intereje: number; nervio: number; capa: number } | null;
  /** Los ábacos de un reticular, como los usa el cálculo (polígonos en planta); sin ellos, ninguno. */
  abacos: Vec2[][];
  cimentacion: boolean;
  direcciones: [DemandasDireccion, DemandasDireccion];
  /** Combinaciones de ELU. */
  combinaciones: number;
  /** Sin combinaciones de ELS cuasipermanente: la fisuración no se puede comprobar. */
  sinELS: boolean;
}

export const direccionArmadura = (a: ArmaduraForjado): 1 | 2 => (a[0] === "x" ? 1 : 2);
export const caraArmadura = (a: ArmaduraForjado): "inferior" | "superior" => (a.endsWith("inf") ? "inferior" : "superior");
export const armaduraDe = (k: 1 | 2, cara: "inferior" | "superior"): ArmaduraForjado => `${k === 1 ? "x" : "y"}-${cara === "inferior" ? "inf" : "sup"}` as ArmaduraForjado;

const error = (codigo: string, mensaje: string, ids: string[]): { valido: false; diagnosticos: Diagnostico[] } => ({ valido: false, diagnosticos: [{ codigo, severidad: "error", mensaje, ids }] });

/**
 * Los pilares que llegan a la planta de una losa: su punto en planta y el radio que lo envuelve (media
 * diagonal de su mayor sección; con un punto fijo que no es el centro, la diagonal entera).
 */
function pilaresDePlanta(q: Consultas, planta: string): { id: string; p: Vec2; r: number }[] {
  const orden = new Map(q.fisico.plantas.map((x, i) => [x.id, i]));
  const k = orden.get(planta);
  if (k === undefined) return [];
  const r: { id: string; p: Vec2; r: number }[] = [];
  for (const p of q.fisico.pilares ?? []) {
    // Las plantas van de arriba abajo: el pilar va de `desde` (abajo) a `hasta` (arriba)
    const [a, b] = [orden.get(p.hasta), orden.get(p.desde)];
    if (a === undefined || b === undefined || k < a || k > b) continue;
    let diagonal = 0;
    for (const id of [p.seccion, ...(p.tramos ?? []).map((t) => t.seccion)]) {
      const sc = q.fisico.secciones.find((x) => x.id === id);
      if (sc?.forma === "rectangular") diagonal = Math.max(diagonal, Math.hypot(sc.b, sc.h));
      else if (sc?.forma === "circular") diagonal = Math.max(diagonal, sc.D);
    }
    r.push({ id: p.id, p: [p.x, p.y], r: p.fijo && p.fijo !== "centro" ? diagonal : diagonal / 2 });
  }
  return r;
}

/** Las demandas ya hechas, por consultas y losa (como las de los pilares: no dependen del armado). */
const GUARDADAS = new WeakMap<Consultas, Map<string, Respuesta<DemandasLosa>>>();

/** Las demandas de una losa (maciza o reticular). */
export function demandasLosa(q: Consultas, id: string): Respuesta<DemandasLosa> {
  return agotar(pasosDemandasLosa(q, id));
}

/**
 * `demandasLosa`, avisando tras cada franja (`../pasos.ts`): los esfuerzos de las franjas de una losa
 * de un edificio grande son decenas de segundos (con el sismo, los cortes de cada modo), y de una vez
 * no se podía decir por dónde iba ni atender otra cosa entre medias. Si se deja a medias no se guarda
 * nada de la losa aquí; los cortes ya hechos de sus franjas los guardan las consultas.
 */
export function* pasosDemandasLosa(q: Consultas, id: string): Generator<Paso, Respuesta<DemandasLosa>> {
  let m = GUARDADAS.get(q);
  if (!m) GUARDADAS.set(q, (m = new Map()));
  let r = m.get(id);
  if (!r) m.set(id, (r = yield* calcularDemandasLosa(q, id)));
  return r;
}

function* calcularDemandasLosa(q: Consultas, id: string): Generator<Paso, Respuesta<DemandasLosa>> {
  const losa = q.fisico.losas?.find((l) => l.id === id);
  if (!losa) return error("consulta/no-existe", `La losa «${id}» no existe en el modelo (se comprueban las losas macizas y reticulares).`, [id]);
  const material = q.fisico.materiales.find((m) => m.id === losa.material);
  if (!material) return error("comprobacion/sin-seccion", `La losa ${id} no tiene su material ${losa.material}.`, [id]);
  const elu = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: [...SITUACIONES_ELU] });
  if (!elu.valido) return elu;
  const cpR = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: ["ELS-CP"] });
  const cp = cpR.valido && cpR.valor.factores.length ? cpR.valor : null;
  const fs = q.franjas(id);
  if (!fs.valido) return fs;
  const diagnosticos: Diagnostico[] = [...elu.diagnosticos];
  const vistos = new Set<string>();
  const anotar = (ds: readonly Diagnostico[]) => {
    for (const x of ds) {
      const clave = `${x.codigo}|${x.mensaje}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      diagnosticos.push(x);
    }
  };
  const direcciones: DemandasDireccion[] = [];
  const pilaresPlanta = pilaresDePlanta(q, losa.planta);
  const radio = CANTOS_PUNZONAMIENTO * losa.espesor;
  const astillas: string[] = [];
  let hechas = 0;
  for (const k of [1, 2] as const) {
    const franjas = fs.valor.filter((f) => f.direccion === k);
    const estaciones: EstacionLosa[] = [];
    let sinValor = 0;
    for (const f of franjas) {
      if (hechas > 0) yield { fase: "esfuerzos de las franjas", hecho: hechas, total: fs.valor.length, pieza: id, unidad: "franjas" };
      hechas++;
      const g = q.franja(f.id);
      if (!g.valido) return g;
      anotar(g.diagnosticos);
      const w = q.armadoFranja(f.id, elu.valor.factores);
      if (!w.valido) return w;
      const v = q.cortanteFranja(f.id, elu.valor.factores);
      if (!v.valido) return v;
      const wcp = cp ? q.armadoFranja(f.id, cp.factores) : null;
      if (wcp && !wcp.valido) return wcp;
      const es = g.valor.estaciones;
      // La menor luz entre apoyos (caras de pilares y líneas de apoyo); sin dos apoyos, el largo de la franja
      const apoyos = es.filter((e) => e.tipo !== "paso").map((e) => e.s);
      let luz = Infinity;
      for (let i = 1; i < apoyos.length; i++) if (apoyos[i]! - apoyos[i - 1]! >= LUZ_MINIMA) luz = Math.min(luz, apoyos[i]! - apoyos[i - 1]!);
      if (!Number.isFinite(luz)) luz = f.s1 - f.s0;
      // Los pilares cerca de la franja, en sus ejes (s, t): junto a ellos el cortante es del punzonamiento
      const cerca = pilaresPlanta
        .map((x) => ({ s: x.p[0] * f.d[0] + x.p[1] * f.d[1], t: x.p[0] * f.n[0] + x.p[1] * f.n[1], r: x.r + radio }))
        .filter((x) => x.t > f.t0 - x.r && x.t < f.t1 + x.r);
      es.forEach((e, i) => {
        if (!e.valido) return void sinValor++;
        const a = Math.max(i > 0 ? (es[i - 1]!.s + e.s) / 2 : f.s0, e.s - PASO_ESTACIONES);
        const b = Math.min(i + 1 < es.length ? (e.s + es[i + 1]!.s) / 2 : f.s1, e.s + PASO_ESTACIONES);
        const x = w.valor[i]!;
        const xc = wcp?.valor[i];
        const seccion: SeccionLosa = losa.reticular ? ((e.fraccionAbaco ?? 0) >= FRACCION_ABACO ? "abaco" : "nervio") : "maciza";
        const punzonamiento = e.ventana !== undefined || (e.tipo !== "apoyo" && cerca.some((x) => Math.hypot(e.s - x.s, Math.max(0, f.t0 - x.t, x.t - f.t1)) < x.r - 1e-9));
        const astilla = !punzonamiento && e.anchoEnLosa < losa.espesor - 1e-9;
        if (astilla) astillas.push(`${f.id} s = ${e.s.toFixed(2)} (${Math.round(100 * e.anchoEnLosa)} cm)`);
        const sinCortante = punzonamiento ? "pilar" : astilla ? "astilla" : null;
        estaciones.push({
          franja: f.id,
          indice: i,
          s: e.s,
          tipo: e.tipo,
          a,
          b,
          t0: f.t0,
          t1: f.t1,
          seccion,
          ancho: seccion === "nervio" ? (e.ventana ? e.ventana[1] - e.ventana[0] : f.ancho) : 1,
          inferior: x.inferior,
          superior: x.superior,
          combInferior: x.combInferior >= 0 ? elu.valor.nombres[x.combInferior]! : "",
          combSuperior: x.combSuperior >= 0 ? elu.valor.nombres[x.combSuperior]! : "",
          cortante: sinCortante ? null : v.valor[i]!.v,
          combCortante: v.valor[i]!.comb >= 0 ? elu.valor.nombres[v.valor[i]!.comb]! : "",
          sinCortante,
          cpInferior: xc?.inferior ?? 0,
          cpSuperior: xc?.superior ?? 0,
          luz,
        });
      });
    }
    const ejes = franjas[0];
    direcciones.push({ direccion: k, d: ejes?.d ?? [1, 0], n: ejes?.n ?? [0, 1], franjas, estaciones, sinValor });
  }
  if (astillas.length) {
    const lista = astillas.length > 6 ? `${astillas.slice(0, 6).join("; ")} y ${astillas.length - 6} más` : astillas.join("; ");
    diagnosticos.push({ codigo: "comprobacion/cortante-astilla", severidad: "aviso", mensaje: `${astillas.length} estaciones de las franjas de la losa ${id} tienen menos de un canto de losa en su ancho (${lista}): es una astilla junto a una viga o un borde, que trabaja con la viga, y su cortante no se comprueba como el de una losa.`, ids: [id] });
  }
  const sinValor = direcciones[0]!.sinValor + direcciones[1]!.sinValor;
  if (sinValor) diagnosticos.push({ codigo: "comprobacion/estaciones-sin-valor", severidad: "aviso", mensaje: `${sinValor} estaciones de las franjas de la losa ${id} no tienen valor (su corte no sigue la malla) y no se comprueban: revise ahí el armado.`, ids: [id] });
  return {
    valido: true,
    valor: {
      losa: id,
      planta: losa.planta,
      espesor: losa.espesor,
      material,
      reticular: losa.reticular ? { intereje: losa.reticular.intereje, nervio: losa.reticular.nervio, capa: losa.reticular.capa } : null,
      abacos: losa.reticular ? abacosDe(q.fisico, losa).map((p) => p.map((v): Vec2 => [v[0], v[1]])) : [],
      cimentacion: losa.cimentacion !== undefined,
      direcciones: [direcciones[0]!, direcciones[1]!],
      combinaciones: elu.valor.factores.length,
      sinELS: cp === null,
    },
    diagnosticos,
  };
}
