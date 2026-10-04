/**
 * Paso 3 del compilador: de la topología a las barras, apoyos y diafragmas del modelo analítico.
 *
 * Nudos de dimensión finita (C1-a, C1-b): el nudo de un pilar es su eje. Una viga que llega o pasa
 * por él tiene su tramo flexible sobre su propia recta, desde la proyección del eje del pilar más
 * `factorZonaRigida` veces lo que su recta recorre dentro de la huella; el offset (del nudo al
 * extremo del tramo flexible) lleva a la vez la zona rígida y la excentricidad. El tramo de un
 * pilar es rígido en su cabeza a lo largo del canto de la viga más alta (o de la losa) que le llega.
 *
 * Con losas (C2): los apoyos lineales y los puntuales que caen en una losa van a sus nudos de la
 * malla, y el diafragma rígido de una planta con losas abarca los nudos sobre ellas (C2-f).
 *
 * Cada pieza se describe además como una o varias «rectas» (el eje analítico, P(σ) = O + σ·e)
 * partidas en trozos: tramos flexibles de barras y zonas rígidas o tramos fuera de la cadena, que
 * van a un nudo. Las cargas se reparten sobre esos trozos (`cargas.ts`).
 */
import type { SeccionBarra } from "../elementos/barra.ts";
import { Diagnosticos } from "../motor/diagnosticos.ts";
import type { Seis, Vec3 } from "../motor/modelo.ts";
import type { Liberacion, Pilar } from "./fisico.ts";
import type { Losas } from "./losas.ts";
import type { SeccionCompilada } from "./secciones.ts";
import { cuerdaEnTramo, seccionTramo, type Topologia, type TramoViga } from "./topologia.ts";
import type { Contexto } from "./validar.ts";

/** Trozo de una recta: [desde, hasta] en σ, que va a un nudo o al tramo flexible de una barra. */
export type Trozo = { desde: number; hasta: number; nudo: number } | { desde: number; hasta: number; barra: number; ip: number };

export interface Recta {
  pieza: string;
  tipo: "viga" | "pilar";
  /** Eje analítico: P(σ) = O + σ·e (globales). */
  O: Vec3;
  e: Vec3;
  /** Estación de σ = 0 en la pieza, y longitud cargable de la recta ([0, len] en σ). */
  s0: number;
  len: number;
  /** Ejes locales de la pieza (para las cargas "local"). */
  ex: Vec3;
  ey: Vec3;
  ez: Vec3;
  /** Trozos en orden; el primero empieza en −∞ y el último acaba en +∞. */
  trozos: Trozo[];
  /** El tramo de viga del que sale (sólo vigas). */
  tramo?: TramoViga;
}

export interface BarraP {
  id: string;
  pieza: string;
  tipo: "viga" | "pilar";
  /** Tramo de la polilínea (vigas) o planta de la cabeza (pilares). */
  tramo: number;
  i: number;
  j: number;
  /** Extremos del tramo flexible, globales. */
  ip: Vec3;
  jp: Vec3;
  seccion: SeccionBarra;
  /** Tipo de material de la sección (para los modificadores por material). */
  material: SeccionCompilada["material"];
  vz: Vec3;
  liberaciones?: { i?: Seis<boolean>; j?: Seis<boolean> };
  /** Estaciones de i, i', j' y j a lo largo de la pieza. */
  s: [number, number, number, number];
}

export interface Piezas {
  barras: BarraP[];
  rectas: Recta[];
  /** Recta de cada pieza (un pilar: una; una viga: una por tramo). */
  rectasDe: Map<string, Recta[]>;
  /** Apoyos por nudo provisional. */
  apoyos: Map<number, boolean[]>;
  /** Diafragmas: planta y nudos provisionales. */
  diafragmas: { k: number; nudos: number[] }[];
}

const libera = (l?: Liberacion): Seis<boolean> | undefined => (l && l.some(Boolean) ? l : undefined);

export function construirPiezas(ctx: Contexto, topo: Topologia, losas: Losas, diag: Diagnosticos): Piezas {
  const { epsGeom, factorZonaRigida: f } = ctx.op;
  const barras: BarraP[] = [];
  const rectas: Recta[] = [];
  const rectasDe = new Map<string, Recta[]>();
  // Espesor de la losa en la huella de cada nudo de pilar (C2-e: cuenta como canto en la cabeza)
  const espesorHuella = new Map(losas.huellas.map((h) => [h.maestro, h.espesor] as const));

  // Pilares: una recta por pilar, de su base a su cabeza; un tramo por planta
  for (const p of ctx.pilares) {
    const kb = ctx.planta.get(p.desde)!;
    const kh = ctx.planta.get(p.hasta)!;
    const zb = ctx.cotas[kb]!;
    const rad = ((p.giro ?? 0) * Math.PI) / 180;
    const g = (((p.giro ?? 0) % 360) + 360) % 360;
    const [c, s] = g % 90 === 0 ? ([[1, 0], [0, 1], [-1, 0], [0, -1]][g / 90]! as [number, number]) : [Math.cos(rad), Math.sin(rad)];
    const ez: Vec3 = [c, s, 0];
    const recta: Recta = { pieza: p.id, tipo: "pilar", O: [p.x, p.y, zb], e: [0, 0, 1], s0: 0, len: ctx.cotas[kh]! - zb, ex: [0, 0, 1], ey: [s, -c, 0], ez, trozos: [] };
    const nudoEn = (k: number) => topo.nudoPilar.get(`${p.id}@${k}`);
    if (nudoEn(kb) === undefined || nudoEn(kh) === undefined) continue; // pilar solapado: ya hay un error
    let sigmaAnt = -Infinity;
    for (let k = kb; k > kh; k--) {
      const ni = nudoEn(k)!;
      const nj = nudoEn(k - 1)!;
      const zi = ctx.cotas[k]!;
      const zj = ctx.cotas[k - 1]!;
      const vigas = topo.vigasEn.get(nj) ?? new Set<string>();
      const canto = Math.max(espesorHuella.get(nj) ?? 0, ...[...vigas].map((v) => ctx.secciones.get(ctx.vigaDe.get(v)!.seccion)!.canto));
      const rz = f * canto;
      const ip: Vec3 = [p.x, p.y, zi];
      const jp: Vec3 = [p.x, p.y, zj - rz];
      if (!(jp[2] - ip[2] > epsGeom)) {
        diag.error("pilar/tramo-flexible-nulo", `El tramo del pilar ${p.id} bajo la planta ${ctx.plantas[k - 1]!.id} queda entero dentro del canto de las vigas o de la losa que le llegan (${canto} m).`, [p.id, ...vigas]);
        continue;
      }
      const lib: { i?: Seis<boolean>; j?: Seis<boolean> } = {};
      if (k === kb && libera(p.liberaciones?.base)) lib.i = p.liberaciones!.base!;
      if (k - 1 === kh && libera(p.liberaciones?.cabeza)) lib.j = p.liberaciones!.cabeza!;
      const sI = zi - zb;
      const sJp = jp[2] - zb;
      const sJ = zj - zb;
      barras.push({
        id: `${p.id}:${ctx.plantas[k - 1]!.id}`,
        pieza: p.id,
        tipo: "pilar",
        tramo: k - 1,
        i: ni,
        j: nj,
        ip,
        jp,
        seccion: ctx.secciones.get(seccionTramo(ctx, p, k - 1))!.barra,
        material: ctx.secciones.get(seccionTramo(ctx, p, k - 1))!.material,
        vz: ez,
        liberaciones: lib.i || lib.j ? lib : undefined,
        s: [sI, sI, sJp, sJ],
      });
      recta.trozos.push({ desde: sigmaAnt, hasta: sI, nudo: ni });
      recta.trozos.push({ desde: sI, hasta: sJp, barra: barras.length - 1, ip: sI });
      sigmaAnt = sJp;
      if (k - 1 === kh) recta.trozos.push({ desde: sJp, hasta: Infinity, nudo: nj });
    }
    rectas.push(recta);
    rectasDe.set(p.id, [recta]);
  }

  // Vigas: una recta por tramo de la polilínea
  for (const v of ctx.vigas) {
    const tramos = topo.tramosDe.get(v.id) ?? [];
    const sc = ctx.secciones.get(v.seccion)!;
    const z = ctx.cotas[ctx.planta.get(v.planta)!]!;
    const e = v.insercion === "superior" ? sc.canto / 2 : 0;
    const lista: Recta[] = [];
    const idxBarras: number[] = [];
    for (const tv of tramos) {
      const { A, u } = tv.t;
      const recta: Recta = {
        pieza: v.id,
        tipo: "viga",
        O: [A[0], A[1], z - e],
        e: [u[0], u[1], 0],
        s0: tv.s0,
        len: tv.t.len,
        ex: [u[0], u[1], 0],
        ey: [-u[1], u[0], 0],
        ez: [0, 0, 1],
        trozos: [],
        tramo: tv,
      };
      const P = (sigma: number): Vec3 => [A[0] + sigma * u[0], A[1] + sigma * u[1], z - e];
      const cad = tv.cadena;
      if (cad.length === 0) continue;
      recta.trozos.push({ desde: -Infinity, hasta: cad[0]!.sigma, nudo: cad[0]!.nudo });
      for (let a = 0; a + 1 < cad.length; a++) {
        const na = cad[a]!;
        const nb = cad[a + 1]!;
        let si = na.sigma;
        let sj = nb.sigma;
        const ppA = topo.nudos[na.nudo]!.pilar;
        const ppB = topo.nudos[nb.nudo]!.pilar;
        if (ppA) {
          const cu = cuerdaEnTramo(tv, ppA);
          if (cu) si += f * Math.max(0, cu[1] - na.sigma);
        }
        if (ppB) {
          const cu = cuerdaEnTramo(tv, ppB);
          if (cu) sj -= f * Math.max(0, nb.sigma - cu[0]);
        }
        if (!(sj - si > epsGeom)) {
          diag.error(
            "viga/tramo-flexible-nulo",
            `La viga ${v.id} no tiene tramo flexible entre ${[...topo.nudos[na.nudo]!.fisicos].join(", ")} y ${[...topo.nudos[nb.nudo]!.fisicos].join(", ")}: las zonas rígidas se tocan o se solapan.`,
            [v.id],
          );
          recta.trozos.push({ desde: na.sigma, hasta: nb.sigma, nudo: na.nudo });
          continue;
        }
        barras.push({
          id: `${v.id}:${idxBarras.length + 1}`,
          pieza: v.id,
          tipo: "viga",
          tramo: tv.indice,
          i: na.nudo,
          j: nb.nudo,
          ip: P(si),
          jp: P(sj),
          seccion: sc.barra,
          material: sc.material,
          vz: [0, 0, 1],
          s: [tv.s0 + na.sigma, tv.s0 + si, tv.s0 + sj, tv.s0 + nb.sigma],
        });
        idxBarras.push(barras.length - 1);
        recta.trozos.push({ desde: na.sigma, hasta: si, nudo: na.nudo });
        recta.trozos.push({ desde: si, hasta: sj, barra: barras.length - 1, ip: si });
        recta.trozos.push({ desde: sj, hasta: nb.sigma, nudo: nb.nudo });
      }
      recta.trozos.push({ desde: cad[cad.length - 1]!.sigma, hasta: Infinity, nudo: cad[cad.length - 1]!.nudo });
      lista.push(recta);
      rectas.push(recta);
    }
    rectasDe.set(v.id, lista);
    if (idxBarras.length === 0) {
      diag.error("viga/sin-tramo-flexible", `La viga ${v.id} no tiene ningún tramo flexible: queda entera dentro de un pilar o de sus zonas rígidas.`, [v.id]);
      continue;
    }
    const ini = libera(v.liberaciones?.inicio);
    const fin = libera(v.liberaciones?.fin);
    if (ini) barras[idxBarras[0]!]!.liberaciones = { i: ini };
    if (fin) {
      const b = barras[idxBarras[idxBarras.length - 1]!]!;
      b.liberaciones = { ...b.liberaciones, j: fin };
    }
    if (v.insercion === "superior") {
      const k = ctx.planta.get(v.planta)!;
      if (diafragmaDe(ctx, k) === "rigido")
        diag.aviso(
          "viga/insercion-con-diafragma",
          `La viga ${v.id} tiene el eje ${(e * 100).toFixed(1)} cm por debajo del forjado y la planta ${v.planta} tiene diafragma rígido: trabaja como una T con un ala infinitamente rígida (su rigidez a flexión aumenta en EA·e²).`,
          [v.id],
        );
    }
  }

  // Apoyos: vínculos de las bases de los pilares y apoyos físicos (se suman)
  const apoyos = new Map<number, boolean[]>();
  const origen = new Map<number, string>();
  const apoyar = (n: number, c: readonly boolean[], id: string) => {
    const antes = apoyos.get(n);
    if (antes) {
      diag.aviso("apoyo/repetido", `${id} y ${origen.get(n)} apoyan el mismo nudo: se suman sus coacciones.`, [id, origen.get(n)!]);
      apoyos.set(
        n,
        antes.map((x, i) => x || c[i]!),
      );
    } else {
      apoyos.set(n, [...c]);
      origen.set(n, id);
    }
  };
  for (const p of ctx.pilares) {
    const n = topo.nudoPilar.get(`${p.id}@${ctx.planta.get(p.desde)!}`);
    if (n === undefined) continue;
    const base = p.base ?? "empotrado";
    if (base === "empotrado") apoyar(n, [true, true, true, true, true, true], p.id);
    else if (base === "articulado") apoyar(n, [true, true, true, false, false, false], p.id);
    else if (!arranqueSobrePieza(topo, n, p)) {
      diag.error("pilar/arranque-sin-apoyo", `El pilar ${p.id} nace en la planta ${p.desde} sin vínculo («ninguno») y no le llega ninguna viga ni otro pilar.`, [p.id]);
    }
  }
  for (const a of ctx.apoyos) {
    const n = topo.apoyoEn.get(a.id) ?? losas.apoyosPuntuales.get(a.id);
    if (n !== undefined) apoyar(n, a.coartados, a.id);
  }
  for (const a of ctx.apoyosLineales) for (const n of losas.apoyosLineales.get(a.id) ?? []) apoyar(n, a.coartados, a.id);
  // Un apoyo en un esclavo de una huella: el motor no lo admite (como C1-f)
  const esclavos = new Map<number, string>();
  for (const h of losas.huellas) for (const n of h.esclavos) esclavos.set(n, h.pilar);
  for (const n of apoyos.keys()) {
    if (!esclavos.has(n)) continue;
    diag.error(
      "apoyo/en-huella",
      `${origen.get(n)} apoya un nudo de la losa dentro de la huella del pilar ${esclavos.get(n)}, que se mueve con él: el motor no admite apoyos en los nudos de un enlace rígido. Apoye el pilar.`,
      [origen.get(n)!, esclavos.get(n)!],
    );
  }

  // Diafragmas: en una planta con losas, los nudos sobre ellas (C2-f); si no, todos (C1-e)
  const diafragmas: { k: number; nudos: number[] }[] = [];
  const porK = new Map<number, number[]>();
  topo.nudos.forEach((nd, n) => {
    let l = porK.get(nd.k);
    if (!l) porK.set(nd.k, (l = []));
    l.push(n);
  });
  for (const [k, l] of losas.diafragma) porK.set(k, l);
  for (const [k, lista] of [...porK].sort((a, b) => b[0] - a[0])) {
    if (diafragmaDe(ctx, k) !== "rigido" || lista.length < 2) continue;
    const malos = lista.filter((n) => {
      const c = apoyos.get(n);
      return c && (c[0] || c[1] || c[5]);
    });
    if (malos.length) {
      const ids = [...new Set(malos.flatMap((n) => [...topo.nudos[n]!.fisicos]))];
      diag.error(
        "apoyo/en-diafragma",
        `La planta ${ctx.plantas[k]!.id} tiene diafragma rígido y hay apoyos que coartan ux, uy o rz en ella (${ids.join(", ")}): el motor no admite apoyos en los GDL del diafragma. Quite el diafragma de esa planta o esas coacciones.`,
        [ctx.plantas[k]!.id, ...ids],
      );
      continue;
    }
    diafragmas.push({ k, nudos: lista });
  }
  return { barras, rectas, rectasDe, apoyos, diafragmas };
}

export function diafragmaDe(ctx: Contexto, k: number): "rigido" | "ninguno" {
  return ctx.plantas[k]!.diafragma ?? (k === ctx.plantaBaja ? "ninguno" : "rigido");
}

/** ¿Al nudo de arranque de un pilar «ninguno» le llega otra pieza? */
function arranqueSobrePieza(topo: Topologia, n: number, p: Pilar): boolean {
  if (topo.vigasEn.has(n)) return true;
  const nd = topo.nudos[n]!;
  return (nd.pilar?.pilares.length ?? 0) > 1 || [...nd.fisicos].some((f) => f !== p.id);
}
