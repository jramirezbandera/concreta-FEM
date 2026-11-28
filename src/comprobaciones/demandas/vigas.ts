/**
 * Fase CO2 (`docs/fem3d/comprobaciones.md` §4.2 y §4.3): las demandas de las vigas.
 *
 * Cada vano de una viga (entre las caras de sus apoyos, `Consultas.viga`) va en tres zonas: el cuarto
 * de su luz junto a cada apoyo y el centro (`FRACCIONES_ZONAS`). De cada zona:
 *  - en ELU, el mayor My (tracciona la cara inferior) y el menor (la superior), el mayor |Vz| y el
 *    mayor |T|, cada uno con su combinación y sus seis esfuerzos: los concomitantes o, con el sismo del
 *    programa, los de sus signos pésimos (VS-o, `esfuerzosPesimosViga`);
 *  - en la ELS cuasipermanente, el mayor y el menor My (fisuración).
 * Y del vano, su flecha elástica relativa en la ELS cuasipermanente, en la característica y con el
 * peso propio solo (CO-k: la flecha sale de la deformada del modelo).
 *
 * El contrato, como en los pilares: sólo se lee por `Consultas` (`vanoZonas`, `diagramaBarra`), sin
 * ver vectores por caso ni factores. En las vigas no hay interacción entre esfuerzos que pida todas
 * las combinaciones: bastan los extremos de cada mecanismo (§4.2, punto 2).
 */
import { conjuntoCombinaciones, type ConjuntoCombinaciones } from "../../agente/combinaciones.ts";
import { esfuerzosPesimosViga } from "../../agente/consultas.ts";
import type { Consultas, ExtremoDiagrama, Respuesta } from "../../compilador/consultas.ts";
import type { Material, Seccion } from "../../compilador/fisico.ts";
import type { Situacion } from "../../combinaciones/generador.ts";
import type { Diagnostico } from "../../motor/diagnosticos.ts";
import { porticoDe } from "../porticos.ts";
import { momentosEmpotramiento, type TrozoMomentos } from "./empotramiento.ts";
import { SITUACIONES_ELU } from "./pilares.ts";

/** Las zonas de un vano: el cuarto de la luz junto a cada apoyo y el centro. */
export const FRACCIONES_ZONAS = [0.25, 0.75] as const;
export const ZONAS = ["inicio", "centro", "fin"] as const;
export type ZonaViga = (typeof ZONAS)[number];

/** Muestras de la flecha a lo largo del vano (además de sus extremos). */
export const MUESTRAS_FLECHA = 20;

export interface ExtremoViga {
  /** My (kN·m, con su signo), |Vz| (kN) o |T| (kN·m). */
  valor: number;
  /** Estación a lo largo de la viga, m. */
  s: number;
  comb: string;
  /** [N, Vy, Vz, T, My, Mz] en ese punto: los concomitantes o, con el sismo del programa, los de sus signos pésimos. */
  esfuerzos: number[];
  pesimos?: true;
}

export interface DemandasZona {
  zona: ZonaViga;
  desde: number;
  hasta: number;
  /** ELU: el mayor My de la zona (si es > 0, tracciona la cara inferior). */
  positivo: ExtremoViga;
  /** ELU: el menor My (si es < 0, tracciona la cara superior). */
  negativo: ExtremoViga;
  /** ELU: el mayor |Vz|. */
  cortante: ExtremoViga;
  /** ELU: el mayor |T|. */
  torsion: ExtremoViga;
  /** ELS cuasipermanente: el mayor y el menor My; null sin combinaciones de ELS. */
  cpPositivo: ExtremoViga | null;
  cpNegativo: ExtremoViga | null;
}

/** La flecha elástica relativa de un vano en una combinación, muestra a muestra. */
export interface FlechaCombinacion {
  comb: string;
  /** m en cada muestra, positiva hacia abajo (hacia −z local): respecto a la cuerda entre las caras o, en un voladizo, respecto a su apoyo. */
  relativa: number[];
  /** El mayor |My| del vano en esa combinación, kN·m: lo que fisura la sección. */
  momento: number;
}

export interface FlechaVano {
  /** La luz de la comprobación, m: la del vano entre caras o, en un voladizo, el doble de su vuelo (DB SE 4.3.3.1(4)). */
  luz: number;
  /** El extremo libre de un voladizo; null entre dos apoyos. */
  voladizo: "inicio" | "fin" | null;
  /** Estaciones de las muestras, m. */
  s: number[];
  /** ELS cuasipermanente y característica. */
  cuasipermanente: FlechaCombinacion[];
  caracteristica: FlechaCombinacion[];
  /** El caso del peso propio solo (lo que hay cuando se levanta la tabiquería); null si no lo hay o si lleva cargas del usuario. */
  pesoPropio: FlechaCombinacion | null;
}

export interface DemandasVano {
  indice: number;
  /** Las caras de sus apoyos (o el extremo libre), m a lo largo de la viga. */
  desde: number;
  hasta: number;
  apoyos: [string | null, string | null];
  /** Algún tramo suyo lleva torsión de equilibrio (C4-k): hay que comprobarla. */
  torsionEquilibrio: boolean;
  zonas: DemandasZona[];
  /**
   * CO2-j: el momento de empotramiento perfecto del vano en la cara de cada apoyo por el que la viga
   * continúa ([inicio, fin]; kN·m con su signo, el mayor en valor absoluto de las combinaciones de ELU
   * sin sismo), para el momento mínimo del CE A19 §5.3.2.2(3). null: no hay apoyo, la viga no sigue
   * al otro lado o no se puede calcular.
   */
  empotramiento: [ExtremoViga | null, ExtremoViga | null];
  /** null si no se puede: sin combinaciones de ELS o sin ningún apoyo (`sinFlecha` dice por qué). */
  flecha: FlechaVano | null;
  sinFlecha?: string;
  /**
   * La losa de cimentación sobre la que va el vano entero (todos los nudos de sus tramos flexibles
   * llevan su muelle, LC-g): la viga apoya en el terreno y su flecha no tiene sentido (no se pide:
   * `flecha` es null y no queda pendiente).
   */
  sobreCimentacion?: string;
}

export interface DemandasViga {
  viga: string;
  seccion: Seccion;
  material: Material;
  /** El axil de la viga no tiene valor: está en el plano de un diafragma rígido (C1-d). */
  axilSinValor: boolean;
  situaciones: Situacion[];
  /** Combinaciones de ELU. */
  combinaciones: number;
  vanos: DemandasVano[];
}

const error = (codigo: string, mensaje: string, ids: string[]): { valido: false; diagnosticos: Diagnostico[] } => ({ valido: false, diagnosticos: [{ codigo, severidad: "error", mensaje, ids }] });

/** Las demandas ya hechas, por consultas y viga (como las de los pilares: no dependen del armado). */
const GUARDADAS = new WeakMap<Consultas, Map<string, Respuesta<DemandasViga>>>();

/** Las demandas de una viga (por defecto, con las situaciones de ELU; la fisuración y la flecha, con las de ELS). */
export function demandasViga(q: Consultas, id: string, situaciones: readonly Situacion[] = SITUACIONES_ELU): Respuesta<DemandasViga> {
  if (situaciones !== SITUACIONES_ELU) return calcularDemandasViga(q, id, situaciones);
  let m = GUARDADAS.get(q);
  if (!m) GUARDADAS.set(q, (m = new Map()));
  let r = m.get(id);
  if (!r) m.set(id, (r = calcularDemandasViga(q, id, situaciones)));
  return r;
}

/**
 * En qué apoyos del vano continúa la viga al otro lado ([inicio, fin]): otro vano del mismo pórtico
 * (de esta viga o de la que la sigue) que se apoya en él. En un apoyo extremo, no: allí el momento es
 * el que da la rigidez de lo que sujeta a la viga.
 */
function continuidad(q: Consultas, viga: string, vano: number): [boolean, boolean] {
  const p = porticoDe(q, viga);
  const v = p?.vanos.find((x) => x.viga === viga && x.vano === vano);
  if (!p || !v) return [false, false];
  const lado = (l: 0 | 1) => v.apoyos[l] !== null && p.vanos.some((w) => w !== v && w.apoyos[1 - l] === v.apoyos[l]);
  return v.invertida ? [lado(1), lado(0)] : [lado(0), lado(1)];
}

/** Los nudos con muelle de cada losa de cimentación, por consultas. */
const NUDOS_CIMENTACION = new WeakMap<Consultas, Map<number, string>>();

/**
 * La losa de cimentación sobre la que va entero el tramo [desde, hasta] de la viga: todos los nudos de
 * sus tramos flexibles llevan el muelle de una losa de cimentación (los del eje lo llevan por el ancho de la viga,
 * LC-g). Si algún nudo no lo lleva (un vano que sale de la losa), null: su flecha se comprueba.
 */
export function sobreCimentacion(q: Consultas, id: string, desde: number, hasta: number): string | null {
  const cim = q.mapeo.cimentacion;
  if (!cim) return null;
  let nudos = NUDOS_CIMENTACION.get(q);
  if (!nudos) {
    nudos = new Map();
    for (const [losa, c] of Object.entries(cim)) c.nudos.forEach((n, k) => (c.areas[k]! > 0 ? nudos!.set(n, losa) : undefined));
    NUDOS_CIMENTACION.set(q, nudos);
  }
  const barras = q.modelo.barras ?? [];
  const ts = q.esfuerzosPiezas.tramos(id).filter((t) => t.s1 > desde + 1e-9 && t.s0 < hasta - 1e-9);
  let losa: string | null = null;
  for (const t of ts) {
    for (const n of barras[t.barra]!.nudos) {
      const l = nudos.get(n);
      if (l === undefined) return null;
      // Por la junta de dos losas de cimentación, la primera
      losa ??= l;
    }
  }
  return losa;
}

function calcularDemandasViga(q: Consultas, id: string, situaciones: readonly Situacion[]): Respuesta<DemandasViga> {
  const viga = q.fisico.vigas?.find((v) => v.id === id);
  if (!viga) return error("consulta/no-existe", `La viga «${id}» no existe en el modelo.`, [id]);
  const v = q.viga(id);
  if (!v.valido) return v;
  const seccion = q.fisico.secciones.find((x) => x.id === viga.seccion);
  const material = seccion && q.fisico.materiales.find((m) => m.id === seccion.material);
  if (!seccion || !material) return error("comprobacion/sin-seccion", `La viga ${id} no tiene la sección ${viga.seccion} o su material.`, [id]);
  const elu = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: [...situaciones] });
  if (!elu.valido) return elu;
  const diagnosticos: Diagnostico[] = [...v.diagnosticos, ...elu.diagnosticos];
  // Las de ELS pueden no existir (casos sin acción): la fisuración y la flecha quedan sin comprobar
  const conjunto = (s: Situacion): ConjuntoCombinaciones | null => {
    const c = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: [s] });
    return c.valido ? c.valor : null;
  };
  const cp = conjunto("ELS-CP");
  const car = conjunto("ELS-C");

  const vanos: DemandasVano[] = [];
  vano: for (let i = 0; i < v.valor.vanos.length; i++) {
    const va = v.valor.vanos[i]!;
    // ─── Los extremos de cada zona ─────────────────────────────────────────────────────────────
    const zonas: DemandasZona[] = [];
    type Parcial = { positivo?: ExtremoViga; negativo?: ExtremoViga; cortante?: ExtremoViga; torsion?: ExtremoViga; cpPositivo?: ExtremoViga; cpNegativo?: ExtremoViga; desde: number; hasta: number };
    const parciales: Parcial[] = ZONAS.map(() => ({ desde: 0, hasta: 0 }));
    /** El extremo de una combinación: con el sismo del programa, sus esfuerzos pésimos (`my`: el signo de My que pide el extremo). */
    const extremo = (c: ExtremoDiagrama, comb: string, sismo: boolean, my: 1 | -1 | 0, valor: (e: number[]) => number): ExtremoViga => {
      const esfuerzos = sismo ? esfuerzosPesimosViga(c.partes, my) : Array.from(c.partes.estatica);
      return { valor: valor(esfuerzos), s: c.s, comb, esfuerzos, ...(sismo ? { pesimos: true as const } : {}) };
    };
    for (let kc = 0; kc < elu.valor.factores.length; kc++) {
      const f = elu.valor.factores[kc]!;
      const z = q.vanoZonas(id, i, f, FRACCIONES_ZONAS);
      if (!z.valido) {
        // Un vano entero dentro de las zonas rígidas de sus apoyos (dos pilares muy juntos) no tiene nada que comprobar
        if (z.diagnosticos.some((x) => x.codigo === "consulta/sin-tramo-flexible")) {
          diagnosticos.push({ codigo: "comprobacion/vano-rigido", severidad: "info", mensaje: `El vano ${i} de la viga ${id} cae entero en las zonas rígidas de sus apoyos: no tiene tramo flexible y no se comprueba.`, ids: [id] });
          continue vano;
        }
        return z;
      }
      const comb = elu.valor.nombres[kc]!;
      const sismo = !q.sup.esLineal(f);
      z.valor.forEach((x, k) => {
        const p = parciales[k]!;
        p.desde = x.inicio.s;
        p.hasta = x.fin.s;
        const pos = extremo(x.maxMy, comb, sismo, 1, (e) => e[4]!);
        if (!p.positivo || pos.valor > p.positivo.valor) p.positivo = pos;
        const neg = extremo(x.minMy, comb, sismo, -1, (e) => e[4]!);
        if (!p.negativo || neg.valor < p.negativo.valor) p.negativo = neg;
        for (const c of [x.maxVz, x.minVz]) {
          const e = extremo(c, comb, sismo, 0, (y) => Math.abs(y[2]!));
          if (!p.cortante || e.valor > p.cortante.valor) p.cortante = e;
        }
        for (const c of [x.maxT, x.minT]) {
          const e = extremo(c, comb, sismo, 0, (y) => Math.abs(y[3]!));
          if (!p.torsion || e.valor > p.torsion.valor) p.torsion = e;
        }
      });
    }
    for (let kc = 0; cp && kc < cp.factores.length; kc++) {
      const f = cp.factores[kc]!;
      const z = q.vanoZonas(id, i, f, FRACCIONES_ZONAS);
      if (!z.valido) return z;
      const comb = cp.nombres[kc]!;
      const sismo = !q.sup.esLineal(f);
      z.valor.forEach((x, k) => {
        const p = parciales[k]!;
        const pos = extremo(x.maxMy, comb, sismo, 1, (e) => e[4]!);
        if (!p.cpPositivo || pos.valor > p.cpPositivo.valor) p.cpPositivo = pos;
        const neg = extremo(x.minMy, comb, sismo, -1, (e) => e[4]!);
        if (!p.cpNegativo || neg.valor < p.cpNegativo.valor) p.cpNegativo = neg;
      });
    }
    // ─── El momento de empotramiento perfecto en las caras con continuidad (CO2-j) ─────────────
    const empotramiento: [ExtremoViga | null, ExtremoViga | null] = [null, null];
    // Sólo entre dos apoyos: en un voladizo el momento del apoyo es el de la estática
    const sigue: [boolean, boolean] = va.apoyoInicio && va.apoyoFin ? continuidad(q, id, i) : [false, false];
    if (sigue[0] || sigue[1]) {
      const todos = q.esfuerzosPiezas.tramos(id);
      const suyos = todos.filter((t) => t.s1 > va.desde + 1e-9 && t.s0 < va.hasta - 1e-9).sort((a, b) => a.s0 - b.s0);
      // Entre las caras o, si una cae en una zona rígida, desde el extremo del tramo flexible; sin huecos
      const [xa, xb] = suyos.length ? [Math.max(va.desde, suyos[0]!.s0), Math.min(va.hasta, suyos[suyos.length - 1]!.s1)] : [0, 0];
      const seguidos = suyos.every((t, k) => k === 0 || Math.abs(t.s0 - suyos[k - 1]!.s1) <= 1e-6);
      for (let kc = 0; suyos.length && seguidos && xb - xa > 1e-6 && kc < elu.valor.factores.length; kc++) {
        const f = elu.valor.factores[kc]!;
        // Con el sismo del programa la ley no es la de unas cargas (modos combinados): no entra
        if (!q.sup.esLineal(f)) continue;
        const trozos: TrozoMomentos[] = [];
        let [Ma, Mb] = [0, 0];
        suyos.forEach((t, k) => {
          const D = q.diagramaBarra(t.barra, f);
          const [a, b] = [Math.max(xa, t.s0) - t.s0, Math.min(xb, t.s1) - t.s0];
          if (!(b > a)) return;
          if (k === 0) Ma = D.esfuerzosEn(a, 1)[4]!;
          if (k === suyos.length - 1) Mb = D.esfuerzosEn(b, -1)[4]!;
          const cortes = [a, ...D.estaciones().filter((y) => y > a + 1e-9 && y < b - 1e-9), b];
          for (let j = 0; j + 1 < cortes.length; j++) trozos.push({ x0: t.s0 + cortes[j]!, x1: t.s0 + cortes[j + 1]!, M: (x) => D.esfuerzosEn(x - t.s0, 1)[4]! });
        });
        const m = momentosEmpotramiento(trozos, xa, xb, Ma, Mb);
        if (!m) continue;
        ([0, 1] as const).forEach((lado) => {
          if (!sigue[lado] || !Number.isFinite(m[lado])) return;
          const previo = empotramiento[lado];
          if (!previo || Math.abs(m[lado]) > Math.abs(previo.valor)) empotramiento[lado] = { valor: m[lado], s: lado ? xb : xa, comb: elu.valor.nombres[kc]!, esfuerzos: [] };
        });
      }
    }

    ZONAS.forEach((zona, k) => {
      const p = parciales[k]!;
      zonas.push({ zona, desde: p.desde, hasta: p.hasta, positivo: p.positivo!, negativo: p.negativo!, cortante: p.cortante!, torsion: p.torsion!, cpPositivo: p.cpPositivo ?? null, cpNegativo: p.cpNegativo ?? null });
    });

    // ─── La flecha elástica relativa ───────────────────────────────────────────────────────────
    let flecha: FlechaVano | null = null;
    let sinFlecha: string | undefined;
    const voladizo = !va.apoyoInicio && !va.apoyoFin ? undefined : !va.apoyoInicio ? ("inicio" as const) : !va.apoyoFin ? ("fin" as const) : null;
    const L = va.hasta - va.desde;
    const cimentacion = sobreCimentacion(q, id, va.desde, va.hasta);
    if (cimentacion) {
      // Sobre el terreno: ni flecha ni pendiente
    } else if (voladizo === undefined) sinFlecha = "la viga no tiene apoyos (pilares, muros, apoyos u otras vigas en sus extremos): su flecha no se comprueba";
    else if (!cp || !car) sinFlecha = "sin combinaciones de ELS (casos sin su acción) no hay flecha";
    else if (!(L > 0)) sinFlecha = "el vano no tiene longitud";
    else {
      // Los tramos flexibles del vano (los de toda la viga no hacen falta: una viga de nueve vanos tiene cientos)
      const todos = q.esfuerzosPiezas.tramos(id);
      const delVano = todos.filter((t) => t.s1 > va.desde + 1e-9 && t.s0 < va.hasta - 1e-9);
      const ts = delVano.length ? delVano : todos;
      const s = Array.from({ length: MUESTRAS_FLECHA + 1 }, (_, j) => va.desde + (L * j) / MUESTRAS_FLECHA);
      /** La flecha relativa de una combinación (sus factores) en las muestras, y el mayor |My| del vano, con un diagrama por tramo. */
      const relativa = (f: ArrayLike<number>, comb: string): FlechaCombinacion => {
        const Ds = ts.map((t) => ({ ...t, D: q.diagramaBarra(t.barra, f) }));
        const u = (x: number) => {
          let t = Ds[0]!;
          for (const y of Ds) if (x >= y.s0 - 1e-9) t = y;
          return t.D.desplazamientosEn(Math.min(t.D.L, Math.max(0, x - t.s0)))[2]!;
        };
        const [ua, ub] = [u(va.desde), u(va.hasta)];
        const rel = s.map((x) => (voladizo === "fin" ? ua : voladizo === "inicio" ? ub : ua + ((ub - ua) * (x - va.desde)) / L) - u(x));
        // El mayor |My| entre las caras: en los extremos de cada tramo y en las estaciones de su diagrama
        let momento = 0;
        for (const t of Ds) {
          const [a, b] = [Math.max(va.desde, t.s0) - t.s0, Math.min(va.hasta, t.s1) - t.s0];
          if (!(b > a)) continue;
          for (const x of [a, b, ...t.D.estaciones().filter((y) => y > a && y < b)]) for (const lado of [-1, 1] as const) momento = Math.max(momento, Math.abs(t.D.esfuerzosEn(x, lado)[4]!));
        }
        return { comb, relativa: rel, momento };
      };
      const cuasipermanente = cp.factores.map((f, kc) => relativa(f, cp.nombres[kc]!));
      const caracteristica = car.factores.map((f, kc) => relativa(f, car.nombres[kc]!));
      // El peso propio solo: el caso que lo lleva, si no tiene además cargas del usuario
      const kpp = q.fisico.casos.findIndex((c) => c.pesoPropio);
      const pesoPropio = kpp >= 0 && !(q.fisico.cargas ?? []).some((c) => c.caso === q.fisico.casos[kpp]!.id) ? relativa(q.sup.factoresCaso(kpp), q.fisico.casos[kpp]!.id) : null;
      flecha = { luz: voladizo ? 2 * L : L, voladizo, s, cuasipermanente, caracteristica, pesoPropio };
    }
    vanos.push({
      indice: i,
      desde: va.desde,
      hasta: va.hasta,
      apoyos: [va.apoyoInicio?.objeto ?? null, va.apoyoFin?.objeto ?? null],
      torsionEquilibrio: va.torsionEquilibrio,
      zonas,
      empotramiento,
      flecha,
      ...(sinFlecha ? { sinFlecha } : {}),
      ...(cimentacion ? { sobreCimentacion: cimentacion } : {}),
    });
  }
  return { valido: true, valor: { viga: id, seccion, material, axilSinValor: v.valor.axilSinValor, situaciones: [...situaciones], combinaciones: elu.valor.factores.length, vanos }, diagnosticos };
}
