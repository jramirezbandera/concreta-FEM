/**
 * Losas de cimentación sobre balasto (fase LC, `docs/fem3d/losa-cimentacion.md`). Cálculo lineal
 * (Winkler): un muelle vertical por nudo de la malla de la losa, con k por el área tributaria del nudo
 * (CB-b: la fila sumada de ∫ k·N dA, la misma integral que el vector de cargas de superficie de la
 * lámina, así que una carga uniforme da w = q/k exacto en todos los nudos). El motor no cambia: son
 * `Muelle` a tierra en ejes globales.
 *
 * - **Lo horizontal (CB-a):** "coartado" (por defecto) coarta ux y uy en todos los nudos de la losa;
 *   en un nudo de un enlace rígido (la huella de un pilar, la cara de una viga), en el maestro de su
 *   cadena, con rz (coartar ux y uy en los esclavos de un enlace en el plano es coartar ux, uy y rz de
 *   su maestro). `{ kh }`: muelles en ux y uy con kh por el área tributaria.
 * - **El ancho de las vigas** que se unen a la losa por sus caras (LV) no es losa: su área (las piezas
 *   del ancho y de las tiras de borde) apoya en los dos nudos del eje de la viga que rodean su
 *   centroide, en proporción lineal (LC-g; exacto en la fuerza y en su momento a lo largo del eje).
 * - **La malla (LC-e):** h = min(tamanoMalla, l/n) en la planta de la losa, con l = (D/k)^¼.
 * - **Los pilares y muros sin `base` escrita** que arrancan en la losa se apoyan en ella (LC-c,
 *   `resolverCimentacion`): base "ninguno", unidos por su huella (C2-d) o sus nudos (C3-f).
 */
import type { Diagnosticos } from "../motor/diagnosticos.ts";
import { MALLA_CIMENTACION, type Losa, type ModeloFisico, type Vec2 } from "./fisico.ts";
import type { Losas } from "./losas.ts";
import type { Piezas } from "./piezas.ts";
import { distanciaABorde, puntoEnPoligono } from "./poligonos.ts";
import { ejeSeccion } from "./puntoFijo.ts";
import type { Topologia } from "./topologia.ts";
import type { Contexto } from "./validar.ts";

const coma = (x: number, d = 2) => Number(x.toFixed(d)).toString().replace(".", ",");

/** Longitud característica de una losa sobre balasto, l = (D/k)^¼, m (D = E·t³/(12·(1 − ν²))). */
export function longitudCaracteristica(m: { E: number; nu: number; t: number }, k: number): number {
  return Math.pow((m.E * m.t ** 3) / (12 * (1 - m.nu * m.nu)) / k, 0.25);
}

/** El error del campo `cimentacion` de una losa, o null. */
export function cimentacionNoValida(l: Losa): string | null {
  const c = l.cimentacion as unknown;
  if (c === undefined) return null;
  if (typeof c !== "object" || c === null || Array.isArray(c)) return "la cimentación tiene que ser { balasto, horizontal?, tensionAdmisible? }";
  const o = c as Record<string, unknown>;
  const pos = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x > 0;
  if (!pos(o.balasto)) return "el balasto de la cimentación tiene que ser un número > 0 (kN/m³)";
  const h = o.horizontal;
  if (h !== undefined && h !== "coartado" && !(typeof h === "object" && h !== null && !Array.isArray(h) && Object.keys(h).every((k) => k === "kh") && pos((h as Record<string, unknown>).kh)))
    return 'lo horizontal de la cimentación tiene que ser "coartado" o { kh } con kh > 0 (kN/m³)';
  if (o.tensionAdmisible !== undefined && !pos(o.tensionAdmisible)) return "la tensión admisible de la cimentación tiene que ser un número > 0 (kN/m²)";
  if (l.reticular !== undefined) return "una losa de cimentación tiene que ser maciza (sin reticular)";
  return null;
}

/** ¿Cae q en la losa (dentro de su contorno, o a ≤ eps de él, y fuera de sus huecos)? */
function enLosa(q: Vec2, l: Losa, eps: number): boolean {
  const c = l.contorno;
  if (!Array.isArray(c) || c.length < 3) return false;
  if (!puntoEnPoligono(q, c) && distanciaABorde(q, c) > eps) return false;
  for (const h of l.huecos ?? []) if (puntoEnPoligono(q, h) && distanciaABorde(q, h) > eps) return false;
  return true;
}

/** Las losas de cimentación de una planta. */
const deCimentacion = (f: ModeloFisico, planta: string) => (f.losas ?? []).filter((l) => l.cimentacion !== undefined && l.planta === planta);

/** El eje del tramo más bajo de un pilar (su base). */
function ejeBase(f: ModeloFisico, p: NonNullable<ModeloFisico["pilares"]>[number]): Vec2 {
  const k = f.plantas.findIndex((x) => x.id === p.desde);
  const encima = k > 0 ? f.plantas[k - 1]!.id : undefined;
  const sec = p.tramos?.find((t) => t.planta === encima)?.seccion ?? p.seccion;
  return ejeSeccion(p, f.secciones.find((s) => s.id === sec));
}

/** ¿Arranca el muro en la losa? (el punto medio de alguno de sus tramos cae en ella) */
function muroEn(puntos: readonly Vec2[], l: Losa, eps: number): boolean {
  for (let i = 0; i + 1 < puntos.length; i++) {
    const [a, b] = [puntos[i]!, puntos[i + 1]!];
    if (enLosa([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], l, eps)) return true;
  }
  return false;
}

/**
 * LC-c: los pilares y muros sin `base` escrita que arrancan en una losa de cimentación, con base
 * "ninguno". Sin losas de cimentación, el mismo objeto.
 */
export function resolverCimentacion(f: ModeloFisico, eps: number): ModeloFisico {
  if (!(f.losas ?? []).some((l) => l.cimentacion !== undefined)) return f;
  const valida = (l: Losa) => cimentacionNoValida(l) === null;
  let cambia = false;
  const pilares = (f.pilares ?? []).map((p) => {
    if (p.base !== undefined || typeof p.desde !== "string") return p;
    const q = ejeBase(f, p);
    if (!deCimentacion(f, p.desde).some((l) => valida(l) && enLosa(q, l, eps))) return p;
    cambia = true;
    return { ...p, base: "ninguno" as const };
  });
  const muros = (f.muros ?? []).map((m) => {
    if (m.base !== undefined || !Array.isArray(m.puntos)) return m;
    if (!deCimentacion(f, m.desde).some((l) => valida(l) && muroEn(m.puntos, l, eps))) return m;
    cambia = true;
    return { ...m, base: "ninguno" as const };
  });
  return cambia ? { ...f, ...(f.pilares ? { pilares } : {}), ...(f.muros ? { muros } : {}) } : f;
}

/**
 * Los errores de las losas de cimentación que sólo se ven con el modelo entero, sobre el modelo tal
 * como se escribió (`crudo`, antes de `resolverCimentacion`): una base escrita en la losa (LC-c), un
 * pilar o un muro que sigue por debajo de ella, un diafragma rígido escrito en su planta (sus nudos
 * van coartados en ux y uy) y lo horizontal por kh con el sismo (la masa de la losa no tiene adónde ir).
 */
export function erroresCimentacion(ctx: Contexto, crudo: ModeloFisico, diag: Diagnosticos): void {
  const losas = ctx.losas.filter((l) => l.losa.cimentacion !== undefined);
  if (!losas.length) return;
  const eps = ctx.op.epsSnap;
  for (const lc of losas) {
    const l = lc.losa;
    const kS = ctx.planta.get(l.planta)!;
    if (ctx.plantas[kS]!.diafragma === "rigido")
      diag.error(
        "cimentacion/diafragma",
        `La planta ${l.planta} tiene escrito un diafragma rígido y en ella está la losa de cimentación ${l.id}, cuyos nudos van sujetos al terreno en horizontal: un nudo no puede ir en un diafragma y llevar apoyo. Quite el diafragma de la planta (por defecto, ninguno con una losa de cimentación).`,
        [l.planta, l.id],
      );
    if (typeof l.cimentacion!.horizontal === "object" && crudo.acciones?.sismo !== undefined)
      diag.error(
        "cimentacion/kh-con-sismo",
        `La losa de cimentación ${l.id} va con un balasto horizontal (kh) y el modelo tiene sismo: la masa de la losa, que no va en ningún diafragma, se repartiría por su cota con la de la planta de encima. Con el sismo, use lo horizontal coartado (por defecto).`,
        [l.id],
      );
    for (const p of crudo.pilares ?? []) {
      const [kb, kh] = [ctx.planta.get(p.desde), ctx.planta.get(p.hasta)];
      if (kb === undefined || kh === undefined) continue;
      const q = ejeBase(crudo, p);
      if (kb === kS && p.base !== undefined && p.base !== "ninguno" && enLosa(q, l, eps))
        diag.error(
          "pilar/apoyo-sobre-cimentacion",
          `El pilar ${p.id} arranca en la losa de cimentación ${l.id} con la base «${p.base}» escrita: quedaría apoyado dos veces (en el terreno y en la losa). Quite la base para que se apoye en la losa.`,
          [p.id, l.id],
        );
      // Un pilar que sigue por debajo de la losa (o llega a ella desde abajo), en el eje de su tramo en esa planta
      if (kb > kS && kh <= kS && enLosa(ejeSeccion(p, crudo.secciones.find((s) => s.id === (p.tramos?.find((t) => t.planta === ctx.plantas[kS - 1]?.id)?.seccion ?? p.seccion))), l, eps))
        diag.error("cimentacion/pilar-debajo", `El pilar ${p.id} sigue por debajo de la losa de cimentación ${l.id}: lo que está bajo una losa de cimentación es terreno.`, [p.id, l.id]);
    }
    for (const m of crudo.muros ?? []) {
      const [kb, kh] = [ctx.planta.get(m.desde), ctx.planta.get(m.hasta)];
      if (kb === undefined || kh === undefined || !Array.isArray(m.puntos)) continue;
      if (!muroEn(m.puntos, l, eps)) continue;
      if (kb === kS && m.base !== undefined && m.base !== "ninguno")
        diag.error(
          "muro/apoyo-sobre-cimentacion",
          `El muro ${m.id} arranca en la losa de cimentación ${l.id} con la base «${m.base}» escrita: quedaría apoyado dos veces (en el terreno y en la losa). Quite la base para que se apoye en la losa.`,
          [m.id, l.id],
        );
      if (kb > kS && kh <= kS) diag.error("cimentacion/muro-debajo", `El muro ${m.id} sigue por debajo de la losa de cimentación ${l.id}: lo que está bajo una losa de cimentación es terreno.`, [m.id, l.id]);
    }
  }
}

/** n de la malla de las losas de cimentación (LC-e). */
export const nMalla = (ctx: Contexto) => ctx.op.mallaCimentacion ?? MALLA_CIMENTACION;

/** Tamaño de malla de la planta k: min(h, l/n) con las losas de cimentación de la planta; sin ellas, h. */
export function tamanoMallaPlanta(ctx: Contexto, k: number): number {
  const h = ctx.op.tamanoMalla;
  let r = h;
  for (const l of ctx.losas) {
    if (l.losa.cimentacion === undefined || ctx.planta.get(l.losa.planta) !== k) continue;
    r = Math.min(r, longitudCaracteristica(l.material, l.losa.cimentacion.balasto) / nMalla(ctx));
  }
  return r;
}

/** Lo que una losa de cimentación apoya en el terreno: por nudo (de la topología), su área tributaria. */
export interface CimentacionL {
  /** Índice de la losa en `ctx.losas`. */
  losa: number;
  areas: Map<number, number>;
  /** Con lo horizontal coartado: los nudos que llevan su apoyo (los de la losa o el maestro de su enlace). */
  apoyados: Set<number>;
}

/**
 * Los muelles de las losas de cimentación (por nudo de la topología: [kx, ky, kz]) y lo que apoya
 * cada losa. Con lo horizontal coartado, añade los apoyos a `piezas.apoyos`.
 */
export function construirCimentacion(ctx: Contexto, topo: Topologia, losas: Losas, piezas: Piezas): { muelles: Map<number, [number, number, number]>; porLosa: CimentacionL[] } {
  const muelles = new Map<number, [number, number, number]>();
  const porLosa: CimentacionL[] = [];
  const de = new Map<number, CimentacionL>();
  ctx.losas.forEach((l, i) => {
    if (l.losa.cimentacion === undefined) return;
    const x: CimentacionL = { losa: i, areas: new Map(), apoyados: new Set() };
    de.set(i, x);
    porLosa.push(x);
  });
  if (!porLosa.length) return { muelles, porLosa };
  const sumar = (x: CimentacionL, n: number, a: number) => x.areas.set(n, (x.areas.get(n) ?? 0) + a);
  // 1. Las láminas: ∫ Nₐ dA = j0 + (j1·ξₐ + j2·ηₐ)/3 (la de la carga de superficie del motor)
  const XI = [-1, 1, 1, -1];
  const ETA = [-1, -1, 1, 1];
  for (const lm of losas.laminas) {
    const x = de.get(lm.losa);
    if (!x) continue;
    const P = lm.nudos.map((n) => topo.nudos[n]!);
    const a1 = (-P[0]!.x + P[1]!.x + P[2]!.x - P[3]!.x) / 4;
    const a2 = (-P[0]!.x - P[1]!.x + P[2]!.x + P[3]!.x) / 4;
    const a3 = (P[0]!.x - P[1]!.x + P[2]!.x - P[3]!.x) / 4;
    const b1 = (-P[0]!.y + P[1]!.y + P[2]!.y - P[3]!.y) / 4;
    const b2 = (-P[0]!.y - P[1]!.y + P[2]!.y + P[3]!.y) / 4;
    const b3 = (P[0]!.y - P[1]!.y + P[2]!.y - P[3]!.y) / 4;
    const j0 = a1 * b2 - a2 * b1;
    const j1 = a1 * b3 - a3 * b1;
    const j2 = a3 * b2 - a2 * b3;
    for (let a = 0; a < 4; a++) sumar(x, lm.nudos[a]!, j0 + (j1 * XI[a]! + j2 * ETA[a]!) / 3);
  }
  // 2. El ancho de las vigas (y sus tiras de borde) en la losa: a los dos nudos del eje que rodean el centroide de cada pieza
  for (const pz of losas.piezasAncho) {
    const x = de.get(pz.losa);
    if (!x || !(pz.area > 0)) continue;
    const t = losas.anchos[pz.ancho]!.tramo;
    const cad = t.cadena;
    const s = (pz.c[0] - t.t.A[0]) * t.t.u[0] + (pz.c[1] - t.t.A[1]) * t.t.u[1];
    if (cad.length === 1 || s <= cad[0]!.sigma) sumar(x, cad[0]!.nudo, pz.area);
    else if (s >= cad[cad.length - 1]!.sigma) sumar(x, cad[cad.length - 1]!.nudo, pz.area);
    else {
      let k = 0;
      while (cad[k + 1]!.sigma < s) k++;
      const r = (s - cad[k]!.sigma) / (cad[k + 1]!.sigma - cad[k]!.sigma);
      sumar(x, cad[k]!.nudo, pz.area * (1 - r));
      sumar(x, cad[k + 1]!.nudo, pz.area * r);
    }
  }
  // 3. Los muelles y lo horizontal
  const maestroDe = new Map<number, number>();
  for (const h of [...losas.huellas, ...losas.enlacesVigas, ...losas.huellasVigas]) for (const n of h.esclavos) maestroDe.set(n, h.maestro);
  const raiz = (n: number) => {
    let r = n;
    for (let i = 0; i < 64 && maestroDe.has(r); i++) r = maestroDe.get(r)!;
    return r;
  };
  const apoyar = (n: number, c: readonly boolean[]) => {
    const antes = piezas.apoyos.get(n);
    piezas.apoyos.set(n, antes ? antes.map((v, i) => v || c[i]!) : [...c]);
  };
  for (const x of porLosa) {
    const c = ctx.losas[x.losa]!.losa.cimentacion!;
    const kh = typeof c.horizontal === "object" ? c.horizontal.kh : 0;
    for (const [n, a] of [...x.areas].sort((p, q) => p[0] - q[0])) {
      const m = muelles.get(n) ?? [0, 0, 0];
      m[0] += kh * a;
      m[1] += kh * a;
      m[2] += c.balasto * a;
      muelles.set(n, m);
      if (kh > 0) continue;
      const r = raiz(n);
      apoyar(r, r === n ? [true, true, false, false, false, false] : [true, true, false, false, false, true]);
      x.apoyados.add(r);
    }
  }
  return { muelles, porLosa };
}

/** La hipótesis de las losas de cimentación, o null sin ellas. */
export function hipotesisCimentacion(ctx: Contexto, porLosa: readonly CimentacionL[]): string | null {
  if (!porLosa.length) return null;
  const n = nMalla(ctx);
  const partes = porLosa.map((x) => {
    const lc = ctx.losas[x.losa]!;
    const c = lc.losa.cimentacion!;
    const l = longitudCaracteristica(lc.material, c.balasto);
    const h = Math.min(ctx.op.tamanoMalla, l / n);
    const area = [...x.areas.values()].reduce((s, a) => s + a, 0);
    const hz = typeof c.horizontal === "object" ? `muelles horizontales con kh = ${coma(c.horizontal.kh, 0)} kN/m³` : "desplazamientos horizontales coartados en sus nudos";
    return `${lc.losa.id} (balasto ${coma(c.balasto, 0)} kN/m³, l = ${coma(l)} m, malla de ${coma(h, 3)} m, ${coma(area)} m² sobre el terreno; ${hz})`;
  });
  return `Losas de cimentación sobre balasto (LC, modelo de Winkler): ${partes.join("; ")}. Cada nudo de su malla lleva un muelle vertical de rigidez k por su área tributaria (∫ k·N dA), y lo que cae en el ancho de una viga apoya en los nudos de su eje; la malla es min(h, l/${coma(n, 0)}) con l = (D/k)^¼. El cálculo es lineal: un muelle en tracción (la losa que despega) no se quita, se avisa. Los pilares y muros que arrancan en ellas se apoyan en ellas.`;
}
