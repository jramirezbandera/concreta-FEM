/**
 * Paso 2b del compilador (C2): las losas de cada planta, malladas y unidas a lo que las rodea.
 * Corre tras la topología de C1 y añade a `topo.nudos` los nudos de la malla.
 *
 * Por planta con losas:
 * 1. Comprueba C2-c: ningún borde de losa corre dentro del ancho de una viga sin ir por su eje.
 * 2. Monta el arreglo plano (`arreglo.ts`) por prioridad: los nudos de C1 (fijos), los ejes de las
 *    vigas, las huellas de los pilares, los contornos y huecos de las losas, las bandas, las zonas
 *    y líneas de carga, los apoyos lineales y los puntos (cargas y apoyos que C1 no ha colocado).
 *    Lo que se mueve más de ε_geom al unirse se avisa (C2-b).
 * 3. Malla (`mallado.ts`) y lleva los problemas del validador a diagnósticos con la losa.
 * 4. Une la malla al resto:
 *    - los nudos de la malla que son nudos de C1 se reutilizan; los demás son nudos nuevos;
 *    - huellas (C2-d): los nudos de la malla en la huella de un pilar, o a ≤ ε_snap de ella, son
 *      esclavos de un enlace rígido con maestro en el nudo del pilar;
 *    - vigas embebidas (C2-e): sus tramos se parten en los nudos de la malla sobre su eje, salvo
 *      en los de las huellas;
 *    - apoyos lineales, cargas lineales, zonas y puntos: los nudos, aristas o láminas que les tocan.
 *
 * Las láminas salen en orden canónico (cota, centroide x, y, losa), así que sus índices ya son los
 * del modelo analítico.
 */
import { Diagnosticos } from "../motor/diagnosticos.ts";
import { Arreglo, type Trazo, type TipoTrazo } from "./arreglo.ts";
import type { CargaFisica, Vec2 } from "./fisico.ts";
import { mallarPlanta, type LosaMallar } from "./mallado.ts";
import { areaConSigno, distanciaABorde, momentosRegion, puntoEnPoligono, type Region } from "./poligonos.ts";
import { ordenarCadena, type NudoT, type Topologia } from "./topologia.ts";
import type { Contexto } from "./validar.ts";

export interface LaminaL {
  /** Nudos de la topología, antihorario (normal +Z). */
  nudos: [number, number, number, number];
  /** Índice de la losa en `ctx.losas`. */
  losa: number;
  k: number;
}

export interface HuellaL {
  pilar: string;
  k: number;
  maestro: number;
  esclavos: number[];
  /** Espesor de la losa más gruesa de la huella (para la zona rígida de la cabeza del pilar, C2-e). */
  espesor: number;
}

export interface Losas {
  laminas: LaminaL[];
  huellas: HuellaL[];
  /** Nudos de cada apoyo lineal. */
  apoyosLineales: Map<string, number[]>;
  /** Nudo de cada apoyo puntual que C1 no ha colocado (cae en una losa). */
  apoyosPuntuales: Map<string, number>;
  /** Por carga lineal: sus aristas (pares de nudos) a lo largo de la polilínea unida. */
  lineas: Map<string, [number, number][]>;
  /** Polilínea unida de cada carga lineal (la geometría física tras unir, C2-b). */
  lineasUnidas: Map<string, Vec2[]>;
  /** Por carga de superficie: las láminas que cubre. */
  superficies: Map<string, number[]>;
  /** Zona unida de cada carga de superficie con zona. */
  zonasUnidas: Map<string, Vec2[]>;
  /** Nudo de cada carga puntual que cae en una losa. */
  puntos: Map<string, number>;
  /** Región unida de cada losa (por índice en `ctx.losas`). */
  regiones: Region[];
  /** Nudos que entran en el diafragma de su planta (C2-f), por planta. */
  diafragma: Map<number, number[]>;
  /** Estadísticas de la malla. */
  malla: { nudos: number; laminas: number; jacobianoMin: number; bajos: number };
}

const cm = (d: number) => `${(d * 100).toFixed(1)} cm`;

/** Polígono de la huella de un pilar: rectángulo, u octógono inscrito en el círculo. */
function poligonoHuella(nd: NudoT): Vec2[] | null {
  const h = nd.pilar?.huella;
  const f = h?.forma;
  if (!h || !f) return null;
  const [cx, cy] = h.c;
  if (f.tipo === "circulo") {
    const r = f.D / 2;
    const s = Math.SQRT1_2 * r;
    return [
      [cx + r, cy],
      [cx + s, cy + s],
      [cx, cy + r],
      [cx - s, cy + s],
      [cx - r, cy],
      [cx - s, cy - s],
      [cx, cy - r],
      [cx + s, cy - s],
    ];
  }
  const [zx, zy] = [(h.ez[0] * f.h) / 2, (h.ez[1] * f.h) / 2];
  const [yx, yy] = [(h.ey[0] * f.b) / 2, (h.ey[1] * f.b) / 2];
  return [
    [cx - zx - yx, cy - zy - yy],
    [cx + zx - yx, cy + zy - yy],
    [cx + zx + yx, cy + zy + yy],
    [cx - zx + yx, cy - zy + yy],
  ];
}

/**
 * Partes del segmento AB (en t ∈ [0, 1]) fuera de unos polígonos convexos (Cyrus–Beck): lo que de
 * un eje de viga queda fuera de las huellas de sus pilares.
 */
function fueraDeHuellas(A: Vec2, B: Vec2, polis: readonly (readonly Vec2[])[]): [number, number][] {
  const dentro: [number, number][] = [];
  const d: Vec2 = [B[0] - A[0], B[1] - A[1]];
  for (const p of polis) {
    const s = Math.sign(areaConSigno(p));
    let t0 = 0;
    let t1 = 1;
    for (let i = 0; i < p.length && t0 < t1; i++) {
      const [P, Q] = [p[i]!, p[(i + 1) % p.length]!];
      const e: Vec2 = [Q[0] - P[0], Q[1] - P[1]];
      // Interior: s·(e × (X − P)) > 0, con X = A + t·d: num + t·den > 0
      const num = s * (e[0] * (A[1] - P[1]) - e[1] * (A[0] - P[0]));
      const den = s * (e[0] * d[1] - e[1] * d[0]);
      if (den === 0) {
        if (num <= 0) t1 = -1;
      } else if (den > 0) t0 = Math.max(t0, -num / den);
      else t1 = Math.min(t1, -num / den);
    }
    if (t1 > t0) dentro.push([t0, t1]);
  }
  dentro.sort((x, y) => x[0] - y[0]);
  const fuera: [number, number][] = [];
  let t = 0;
  for (const [a, b] of dentro) {
    if (a > t) fuera.push([t, a]);
    t = Math.max(t, b);
  }
  if (t < 1) fuera.push([t, 1]);
  return fuera;
}

/** Rectángulo de una banda: eje desde → hasta y ancho. */
function rectanguloBanda(d: Vec2, h: Vec2, ancho: number): Vec2[] {
  const L = Math.sqrt((h[0] - d[0]) * (h[0] - d[0]) + (h[1] - d[1]) * (h[1] - d[1]));
  const [nx, ny] = [(-(h[1] - d[1]) / L) * (ancho / 2), ((h[0] - d[0]) / L) * (ancho / 2)];
  return [
    [d[0] - nx, d[1] - ny],
    [h[0] - nx, h[1] - ny],
    [h[0] + nx, h[1] + ny],
    [d[0] + nx, d[1] + ny],
  ];
}

/** Dirección del eje 1 de una losa: exacta en los múltiplos de 90°. */
export function direccionEje1(grados: number): Vec2 {
  const g = (((grados % 360) + 360) % 360) / 90;
  const ejes: Vec2[] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  if (Number.isInteger(g)) return ejes[g]!;
  return [Math.cos((grados * Math.PI) / 180), Math.sin((grados * Math.PI) / 180)];
}

/**
 * C2-c: longitud de un lado PQ que corre dentro del ancho de una viga (a más de ε_snap de su eje y
 * a ≤ b/2), dentro de su tramo.
 */
function dentroDelAncho(P: Vec2, Q: Vec2, A: Vec2, u: Vec2, len: number, b: number, eps: number): number {
  const s = (X: Vec2) => (X[0] - A[0]) * u[1] - (X[1] - A[1]) * u[0]; // distancia con signo a la recta
  const sg = (X: Vec2) => (X[0] - A[0]) * u[0] + (X[1] - A[1]) * u[1]; // σ a lo largo del tramo
  const [s0, s1, g0, g1] = [s(P), s(Q), sg(P), sg(Q)];
  // Intervalo de t ∈ [0, 1] con σ ∈ [0, len]
  let lo = 0;
  let hi = 1;
  const recortar = (a0: number, a1: number, min: number, max: number) => {
    if (a0 === a1) {
      if (a0 < min || a0 > max) hi = -1;
      return;
    }
    let ta = (min - a0) / (a1 - a0);
    let tb = (max - a0) / (a1 - a0);
    if (ta > tb) [ta, tb] = [tb, ta];
    lo = Math.max(lo, ta);
    hi = Math.min(hi, tb);
  };
  recortar(g0, g1, 0, len);
  if (!(hi > lo)) return 0;
  // Dentro de ese intervalo, la parte con eps < |s| ≤ b/2 (s es lineal en t): muestreo fino exacto por tramos
  const L = Math.sqrt((Q[0] - P[0]) * (Q[0] - P[0]) + (Q[1] - P[1]) * (Q[1] - P[1]));
  let r = 0;
  for (const signo of [1, -1]) {
    let a = lo;
    let c = hi;
    const sa = (t: number) => signo * (s0 + (s1 - s0) * t);
    // eps < sa(t) ≤ b/2
    const corte = (min: number, max: number) => {
      const v0 = sa(0);
      const v1 = sa(1);
      if (v0 === v1) {
        if (!(v0 > min && v0 <= max)) c = -1;
        return;
      }
      let ta = (min - v0) / (v1 - v0);
      let tb = (max - v0) / (v1 - v0);
      if (ta > tb) [ta, tb] = [tb, ta];
      a = Math.max(a, ta);
      c = Math.min(c, tb);
    };
    corte(eps, b / 2);
    if (c > a) r += (c - a) * L;
  }
  return r;
}

export function construirLosas(ctx: Contexto, topo: Topologia, cargas: readonly CargaFisica[], diag: Diagnosticos): Losas {
  const { epsGeom, epsSnap, tamanoMalla: h } = ctx.op;
  const r: Losas = {
    laminas: [],
    huellas: [],
    apoyosLineales: new Map(),
    apoyosPuntuales: new Map(),
    lineas: new Map(),
    lineasUnidas: new Map(),
    superficies: new Map(),
    zonasUnidas: new Map(),
    puntos: new Map(),
    regiones: ctx.losas.map((l) => l.region),
    diafragma: new Map(),
    malla: { nudos: 0, laminas: 0, jacobianoMin: 1, bajos: 0 },
  };
  const nudosAntes = topo.nudos.length;
  const indiceLosa = new Map(ctx.losas.map((l, i) => [l.losa.id, i] as const));
  const plantas = [...new Set(ctx.losas.map((l) => ctx.planta.get(l.losa.planta)!))].sort((a, b) => b - a);
  const laminasSinOrden: (LaminaL & { c: Vec2 })[] = [];

  for (const k of plantas) {
    const idPlanta = ctx.plantas[k]!.id;
    const losasK = ctx.losas.map((l, i) => ({ l, i })).filter(({ l }) => l.losa.planta === idPlanta);
    const tramosK = topo.tramos.filter((tv) => tv.k === k);

    // 1. C2-c: bordes de losa dentro del ancho de una viga
    for (const { l } of losasK) {
      const polis = [l.region.contorno, ...l.region.huecos];
      for (const tv of tramosK) {
        const f = ctx.secciones.get(tv.viga.seccion)!.huella;
        const b = !f ? 0 : f.tipo === "rectangulo" ? f.b : f.D;
        if (!(b / 2 > epsSnap)) continue;
        let largo = 0;
        for (const p of polis) for (let i = 0; i < p.length; i++) largo += dentroDelAncho(p[i]!, p[(i + 1) % p.length]!, tv.t.A, tv.t.u, tv.t.len, b, epsSnap);
        if (largo > Math.max(2 * b, 4 * epsSnap))
          diag.error(
            "losa/borde-en-viga",
            `El borde de la losa ${l.losa.id} corre ${largo.toFixed(2)} m dentro del ancho de la viga ${tv.viga.id} sin ir por su eje (C2-c): la losa quedaría suelta de la viga. Dibuje el borde sobre el eje de la viga.`,
            [l.losa.id, tv.viga.id],
          );
      }
    }
    if (diag.hayErrores) continue;

    // 2. Arreglo plano. Dentro de una huella todo es rígido: ni el nudo del pilar (el maestro de su
    // enlace) ni los ejes de las vigas que le llegan hacen falta en la malla, y la partirían en
    // triángulos diminutos.
    const a = new Arreglo(epsGeom, epsSnap);
    const nudosK = topo.nudos.map((_, n) => n).filter((n) => topo.nudos[n]!.k === k);
    const huellasK = new Map<number, Vec2[]>();
    for (const n of nudosK) {
      const poli = poligonoHuella(topo.nudos[n]!);
      if (poli) huellasK.set(n, poli);
    }
    for (const n of nudosK) if (!huellasK.has(n)) a.fijo(topo.nudos[n]!.x, topo.nudos[n]!.y, n);
    for (const tv of tramosK) {
      const polis = tv.cadena.flatMap((c) => (huellasK.has(c.nudo) ? [huellasK.get(c.nudo)!] : []));
      const { A, B } = tv.t;
      for (const [t0, t1] of fueraDeHuellas(A, B, polis)) {
        if (!((t1 - t0) * tv.t.len > epsGeom)) continue;
        const P = (t: number): Vec2 => (t === 0 ? A : t === 1 ? B : [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])]);
        a.trazo(tv.viga.id, "viga", tv.id, [P(t0), P(t1)], false);
      }
    }
    for (const [n, poli] of huellasK) a.trazo(topo.nudos[n]!.pilar!.pilares[0]!, "huella", n, poli, true);
    const mallar: LosaMallar[] = [];
    const losaDeMallar: number[] = [];
    for (const { l, i } of losasK) {
      const contorno = a.trazo(l.losa.id, "losa", -1, l.region.contorno, true);
      const huecos = l.region.huecos.map((hh, j) => a.trazo(l.losa.id, "hueco", j, hh, true));
      if (!contorno || huecos.some((x) => !x)) {
        diag.error("losa/degenerada", `La losa ${l.losa.id} (o uno de sus huecos) se queda sin área al unir sus vértices a lo cercano (tolerancia ${cm(epsSnap)}).`, [l.losa.id]);
        continue;
      }
      mallar.push({ id: l.losa.id, contorno, huecos: huecos as Trazo[], eje1: direccionEje1(l.losa.eje1 ?? 0) });
      losaDeMallar.push(i);
    }
    for (const b of ctx.bandas) if (b.planta === idPlanta) a.trazo(b.id, "banda", -1, rectanguloBanda(b.desde, b.hasta, b.ancho), true);
    const trazoCarga = new Map<string, Trazo>();
    for (const c of cargas) {
      if (c.tipo === "superficie" && c.planta === idPlanta && c.zona) {
        const t = a.trazo(c.id, "zona", -1, c.zona, true);
        if (t) trazoCarga.set(c.id, t);
        else diag.error("carga/degenerada", `La zona de la carga ${c.id} se queda sin área al unir sus vértices a lo cercano.`, [c.id]);
      } else if (c.tipo === "lineal" && c.planta === idPlanta) {
        const t = a.trazo(c.id, "linea", -1, c.puntos, false);
        if (t) trazoCarga.set(c.id, t);
        else diag.error("carga/degenerada", `La carga lineal ${c.id} se queda sin longitud al unir sus vértices a lo cercano.`, [c.id]);
      }
    }
    const trazoApoyo = new Map<string, Trazo>();
    for (const ap of ctx.apoyosLineales) {
      if (ap.planta !== idPlanta) continue;
      const t = a.trazo(ap.id, "apoyo-lineal", -1, ap.puntos, false);
      if (t) trazoApoyo.set(ap.id, t);
      else diag.error("apoyo/degenerado", `El apoyo lineal ${ap.id} se queda sin longitud al unir sus vértices a lo cercano.`, [ap.id]);
    }
    const puntoDe = new Map<string, { i: number; Q: Vec2 }>();
    for (const c of cargas) {
      if (c.tipo !== "puntual" || c.planta !== idPlanta || topo.localizar(k, [c.x, c.y])) continue;
      puntoDe.set(c.id, { i: a.punto([c.x, c.y], c.id, "punto", "su punto"), Q: [c.x, c.y] });
    }
    for (const ap of ctx.apoyos) {
      if (ap.planta !== idPlanta || topo.apoyoEn.has(ap.id)) continue;
      puntoDe.set(ap.id, { i: a.punto([ap.x, ap.y], ap.id, "punto", "su punto"), Q: [ap.x, ap.y] });
    }
    if (diag.hayErrores) continue;
    if (!a.resolver()) {
      diag.error("malla/arreglo", `No se ha podido ordenar la geometría de la planta ${idPlanta} para mallarla: hay rasgos más pequeños que ${cm(epsSnap)} que se cruzan entre sí.`, [idPlanta, ...losasK.map(({ l }) => l.losa.id)]);
      continue;
    }
    const defecto = a.defecto();
    if (defecto) {
      diag.error("malla/arreglo", `La geometría de la planta ${idPlanta} no se ha podido preparar para mallarla (${defecto}). Es un fallo del compilador.`, [idPlanta]);
      continue;
    }
    // Avisos de lo que se ha movido (el mayor por objeto)
    const mov = new Map<string, { tipo: TipoTrazo | "punto"; d: number }>();
    for (const m of a.movimientos) if ((mov.get(m.id)?.d ?? 0) < m.distancia) mov.set(m.id, { tipo: m.tipo, d: m.distancia });
    for (const [id, m] of [...mov].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      if (m.tipo === "huella") continue;
      if (m.tipo === "losa" || m.tipo === "hueco") {
        const li = indiceLosa.get(id)!;
        const t = mallar.find((x) => x.id === id);
        const antes = momentosRegion(ctx.losas[li]!.region).A;
        const despues = t ? Math.abs(areaConSigno(t.contorno.puntos.map((p) => [a.puntos[p]!.x, a.puntos[p]!.y] as Vec2))) - t.huecos.reduce((s, hh) => s + Math.abs(areaConSigno(hh.puntos.map((p) => [a.puntos[p]!.x, a.puntos[p]!.y] as Vec2))), 0) : antes;
        diag.aviso("losa/ajuste", `La losa ${id} se ajusta a lo que la rodea: su borde se mueve hasta ${cm(m.d)} y su área cambia ${(despues - antes).toFixed(4)} m² (C2-b).`, [id], { distancia: m.d, area: despues - antes });
      } else diag.aviso("losa/ajuste", `${m.tipo === "punto" ? "El punto de" : "La geometría de"} ${id} se mueve hasta ${cm(m.d)} para unirse a lo cercano (C2-b).`, [id], { distancia: m.d });
    }

    // 3. Malla
    if (!mallar.length) continue;
    const m = mallarPlanta(a, mallar, h);
    if (!m.ok) {
      diag.error("malla/triangulacion", `La triangulación de la planta ${idPlanta} ha fallado (${m.mensaje}). Es un fallo del compilador.`, [idPlanta, ...mallar.map((x) => x.id)]);
      continue;
    }
    for (const p of m.problemas) {
      const ids = p.losa >= 0 ? [mallar[p.losa]!.id] : mallar.map((x) => x.id);
      if (p.severidad === "error") diag.error(p.codigo, p.mensaje, ids);
      else diag.aviso(p.codigo, p.mensaje, ids);
    }
    r.malla.jacobianoMin = Math.min(r.malla.jacobianoMin, m.calidad.jacobianoMin);
    r.malla.bajos += m.calidad.bajos;
    if (m.problemas.some((p) => p.severidad === "error")) continue;
    mallar.forEach((_, j) => (r.regiones[losaDeMallar[j]!] = m.regiones[j]!));

    // 4. Nudos de la malla → nudos de la topología
    const nudoT = m.nudos.map((nm) => {
      const p = nm.punto >= 0 ? a.puntos[nm.punto]! : null;
      if (p && p.nudo >= 0) return p.nudo;
      topo.nudos.push({ k, x: nm.x, y: nm.y, fisicos: new Set(), pilar: null });
      return topo.nudos.length - 1;
    });
    for (const q of m.quads) {
      const li = losaDeMallar[q.losa]!;
      const ns = q.nudos.map((n) => nudoT[n]!) as [number, number, number, number];
      for (const n of ns) topo.nudos[n]!.fisicos.add(ctx.losas[li]!.losa.id);
      const c: Vec2 = [(topo.nudos[ns[0]]!.x + topo.nudos[ns[1]]!.x + topo.nudos[ns[2]]!.x + topo.nudos[ns[3]]!.x) / 4, (topo.nudos[ns[0]]!.y + topo.nudos[ns[1]]!.y + topo.nudos[ns[2]]!.y + topo.nudos[ns[3]]!.y) / 4];
      laminasSinOrden.push({ nudos: ns, losa: li, k, c });
    }
    const nudosMalla = [...new Set(m.quads.flatMap((q) => q.nudos.map((n) => nudoT[n]!)))].sort((x, y) => x - y);

    // Huellas (C2-d)
    const esclavoDe = new Map<number, string>();
    const huellasPlanta: HuellaL[] = [];
    for (const [n, poli] of huellasK) {
      const pilar = topo.nudos[n]!.pilar!.pilares[0]!;
      const esclavos = nudosMalla.filter((x) => {
        if (x === n) return false;
        const q: Vec2 = [topo.nudos[x]!.x, topo.nudos[x]!.y];
        return puntoEnPoligono(q, poli) || distanciaABorde(q, poli) <= epsSnap;
      });
      if (!esclavos.length) continue;
      const dobles = esclavos.filter((x) => esclavoDe.has(x));
      if (dobles.length) {
        diag.error("losa/huellas-solapadas", `Las huellas de los pilares ${esclavoDe.get(dobles[0]!)} y ${pilar} se solapan (o quedan a menos de ${cm(epsSnap)}) en la losa de la planta ${idPlanta}.`, [esclavoDe.get(dobles[0]!)!, pilar]);
        continue;
      }
      for (const x of esclavos) esclavoDe.set(x, pilar);
      const espesor = Math.max(
        ...m.quads.filter((q) => q.nudos.some((nn) => esclavos.includes(nudoT[nn]!))).map((q) => ctx.losas[losaDeMallar[q.losa]!]!.material.t),
      );
      huellasPlanta.push({ pilar, k, maestro: n, esclavos, espesor });
    }
    // Pilares unidos a la losa en un punto (sin huella)
    for (const n of nudosK) {
      const nd = topo.nudos[n]!;
      if (nd.pilar && !huellasK.has(n) && nudosMalla.includes(n))
        diag.aviso("losa/union-puntual", `El pilar ${nd.pilar.pilares[0]} no tiene dimensiones y se une a la losa en un punto: el momento de la losa en su nudo no converge al refinar (H09). Dé su sección con b y h.`, [nd.pilar.pilares[0]!]);
    }
    r.huellas.push(...huellasPlanta);

    // Vigas embebidas (C2-e)
    const ladosDe = (pred: (t: Trazo) => boolean) => m.lados.map((l, i) => ({ l, i })).filter(({ l }) => l.trazos.some((t) => pred(a.trazos[t]!)));
    for (const tv of tramosK) {
      const nuevos = new Set<number>();
      for (const { i } of ladosDe((t) => t.tipo === "viga" && t.ref === tv.id)) {
        for (const nm of m.nudosLado[i]!) {
          const n = nudoT[nm]!;
          if (!esclavoDe.has(n)) nuevos.add(n);
        }
      }
      const antes = new Set([tv.ini, tv.fin, ...tv.partes]);
      const add = [...nuevos].filter((n) => !antes.has(n));
      if (!add.length) continue;
      tv.partes.push(...add);
      ordenarCadena(ctx, topo.nudos, tv, diag);
      for (const n of add) {
        let s = topo.vigasEn.get(n);
        if (!s) topo.vigasEn.set(n, (s = new Set()));
        s.add(tv.viga.id);
      }
    }

    // Apoyos lineales y cargas lineales: nudos y aristas a lo largo de sus lados
    const recorrer = (t: Trazo): { aristas: [number, number][]; fuera: boolean } => {
      const aristas: [number, number][] = [];
      let fuera = false;
      const n = t.puntos.length;
      for (let i = 0; i < (t.cerrado ? n : n - 1); i++) {
        const [pa, pb] = [t.puntos[i]!, t.puntos[(i + 1) % n]!];
        const li = m.lados.findIndex((l) => (l.a === pa && l.b === pb) || (l.a === pb && l.b === pa));
        const c = m.nudosLado[li]!;
        if (!c.length) {
          fuera = true;
          continue;
        }
        const ordenada = m.lados[li]!.a === pa ? c : [...c].reverse();
        for (let j = 0; j + 1 < ordenada.length; j++) aristas.push([nudoT[ordenada[j]!]!, nudoT[ordenada[j + 1]!]!]);
      }
      return { aristas, fuera };
    };
    for (const [id, t] of trazoApoyo) {
      const { aristas, fuera } = recorrer(t);
      if (fuera) diag.error("apoyo/fuera-de-losa", `El apoyo lineal ${id} no va entero sobre las losas de la planta ${idPlanta}.`, [id]);
      r.apoyosLineales.set(id, [...new Set(aristas.flat())]);
    }
    for (const [id, t] of trazoCarga) {
      const xy = (p: number): Vec2 => [a.puntos[p]!.x, a.puntos[p]!.y];
      if (t.tipo === "linea") {
        const { aristas, fuera } = recorrer(t);
        if (fuera) diag.error("carga/fuera-de-losa", `La carga lineal ${id} no va entera sobre las losas de la planta ${idPlanta}: lo que cae fuera se perdería.`, [id]);
        r.lineas.set(id, aristas);
        r.lineasUnidas.set(id, t.puntos.map(xy));
      } else r.zonasUnidas.set(id, t.puntos.map(xy));
    }
    // Cargas de superficie: láminas cuyo triángulo cae en la zona (y en su losa, si la da)
    for (const c of cargas) {
      if (c.tipo !== "superficie" || c.planta !== idPlanta) continue;
      const zona = r.zonasUnidas.get(c.id);
      const li = c.losa !== undefined ? indiceLosa.get(c.losa) : undefined;
      const tris = new Set<number>();
      m.triangulos.forEach((t, ti) => {
        if (li !== undefined && losaDeMallar[t.losa] !== li) return;
        if (zona && !puntoEnPoligono(t.c, zona)) return;
        tris.add(ti);
      });
      const base = r.laminas.length + laminasSinOrden.length - m.quads.length;
      r.superficies.set(
        c.id,
        m.quads.flatMap((q, qi) => (tris.has(q.triangulo) ? [base + qi] : [])),
      );
    }
    // Puntos sueltos
    const usado = new Map(m.nudos.map((nm, i) => [nm.punto, i] as const).filter(([p]) => p >= 0));
    for (const [id, { i }] of puntoDe) {
      const nm = usado.get(i);
      const esApoyo = ctx.apoyos.some((x) => x.id === id);
      if (nm === undefined) {
        diag.error(esApoyo ? "apoyo/sin-destino" : "carga/sin-destino", `${esApoyo ? "El apoyo" : "La carga"} ${id} no cae sobre ningún pilar, nudo, viga ni losa de la planta ${idPlanta} (tolerancia ${cm(epsSnap)}).`, [id]);
        continue;
      }
      const n = nudoT[nm]!;
      if (esApoyo) {
        r.apoyosPuntuales.set(id, n);
        topo.nudos[n]!.fisicos.add(id);
      } else r.puntos.set(id, n);
    }

    // Diafragma (C2-f): los nudos de la malla que no son esclavos de una huella, y los maestros
    r.diafragma.set(k, [...new Set([...nudosMalla.filter((n) => !esclavoDe.has(n)), ...huellasPlanta.map((x) => x.maestro)])].sort((x, y) => x - y));
  }

  // Cargas puntuales de plantas sin losa o fuera de ellas: las que C1 no coloca dan error en cargas.ts
  // Orden canónico de las láminas: cota, centroide x, y, losa
  const orden = laminasSinOrden.map((_, i) => i).sort((x, y) => {
    const [a, b] = [laminasSinOrden[x]!, laminasSinOrden[y]!];
    return ctx.cotas[a.k]! - ctx.cotas[b.k]! || a.c[0] - b.c[0] || a.c[1] - b.c[1] || a.losa - b.losa || x - y;
  });
  const nuevo = new Int32Array(orden.length);
  orden.forEach((v, i) => (nuevo[v] = i));
  r.laminas = orden.map((i) => {
    const { nudos, losa, k } = laminasSinOrden[i]!;
    return { nudos, losa, k };
  });
  for (const [id, l] of r.superficies) r.superficies.set(id, l.map((i) => nuevo[i]!).sort((x, y) => x - y));
  r.malla.nudos = topo.nudos.length - nudosAntes;
  r.malla.laminas = r.laminas.length;
  return r;
}
