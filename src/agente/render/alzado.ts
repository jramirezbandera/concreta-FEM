/**
 * Vista de alzado (I2, `docs/fem3d/interfaz.md` §5.1 y §14): el plano vertical de un eje de
 * replanteo (o el que pasa por dos puntos), como una escena de A4 en coordenadas (u, z): u a lo
 * largo del plano desde su punto `desde`, z la cota. Sólo necesita el modelo físico, así que se
 * dibuja también si no compila.
 *
 * Qué se dibuja (lo que está a menos de `profundidad` del plano, medido en planta):
 * - las plantas, con una línea de nivel y su id y su cota;
 * - los ejes que cruzan el plano, en vertical, con sus burbujas arriba y abajo;
 * - los pilares, tramo a tramo, con el ancho que se ve desde el plano (la huella de su sección
 *   proyectada en él), de la cota de la planta de su base a la de su cabeza; su arranque, con el
 *   símbolo de su vínculo;
 * - los muros paralelos al plano, de su base a su cabeza y con sus huecos, y los que lo cruzan,
 *   cortados con su espesor;
 * - las vigas paralelas al plano con su canto, con la cara superior en la planta (C1-c), y las que
 *   lo cruzan, cortadas (su ancho medido a lo largo del plano);
 * - las losas y los paños cortados por el plano, con su espesor (el del paño, el canto de sus
 *   viguetas), y los apoyos, bajo la losa: los lineales paralelos al plano, a lo largo de él con sus
 *   triángulos; los que lo cruzan, como un puntual.
 *
 * No hay líneas ocultas: se dibuja en ese orden y lo cortado va encima.
 *
 * Puro: sin IO.
 */
import { cotasPlantas } from "../../compilador/cotas.ts";
import { ejesDe } from "../../compilador/ejes.ts";
import type { ModeloFisico, Pilar, Seccion, Vec2 } from "../../compilador/fisico.ts";
import type { Mapeo } from "../../compilador/mapeo.ts";
import type { ModeloAnalitico } from "../../motor/modelo.ts";
import { capaEjesAlzado } from "./ejes.ts";
import { cajaDe, longitud, puntoEnPolilinea, puntosDe, rotulo, type EntradaLeyenda, type Escena, type Estilo, type Primitiva } from "./escena.ts";
import { anchoViga, ejeSeccion, espesorLosaEn, huellaSeccion, porId, textoCoartados, triangulosApoyo, type DatosVista } from "./modelo.ts";

/** El plano de un alzado: la recta en planta de `desde` a `hasta` y lo que se ve a cada lado, m. */
export interface PlanoAlzado {
  desde: Vec2;
  hasta: Vec2;
  /** ±d, m. Por defecto, PROFUNDIDAD_ALZADO. */
  profundidad?: number;
  /** Cómo se llama (el eje): para la cabecera. */
  nombre?: string;
  /** El eje del que sale, para no dibujarlo cruzándose consigo. */
  eje?: string;
}

export const PROFUNDIDAD_ALZADO = 0.5;
/** Un tramo es paralelo al plano si forma con él menos de este ángulo (seno). */
export const SENO_PARALELO = Math.sin((10 * Math.PI) / 180);

/** El plano del alzado de un eje (los del modelo o los propuestos), o null si no hay ningún eje con ese id. */
export function planoDeEje(f: ModeloFisico, eje: string, profundidad?: number): PlanoAlzado | null {
  const e = ejesDe(f).ejes.find((x) => x.id === eje);
  if (!e || (e.desde[0] === e.hasta[0] && e.desde[1] === e.hasta[1])) return null;
  return { desde: e.desde, hasta: e.hasta, nombre: e.nombre ?? e.id, eje: e.id, ...(profundidad !== undefined ? { profundidad } : {}) };
}

/** Canto de una sección (0 si no se conoce). */
export function cantoSeccion(s: Seccion | undefined): number {
  if (!s) return 0;
  switch (s.forma) {
    case "rectangular":
    case "T":
      return s.h;
    case "circular":
      return s.D;
    case "I":
      return s.perfil.h * 1e-3;
    case "general":
      return s.h ?? 0;
  }
}

/** Intervalos [a, b] del parámetro de la recta p0 + λ·d dentro de unos anillos (par-impar). */
export function intervalosRecta(anillos: readonly (readonly Vec2[])[], p0: Vec2, d: Vec2): [number, number][] {
  const n: Vec2 = [-d[1], d[0]];
  const ls: number[] = [];
  for (const r of anillos)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [a, b] = [r[j]!, r[i]!];
      const wa = (a[0] - p0[0]) * n[0] + (a[1] - p0[1]) * n[1];
      const wb = (b[0] - p0[0]) * n[0] + (b[1] - p0[1]) * n[1];
      if (wa > 0 === wb > 0) continue;
      const t = wa / (wa - wb);
      const q: Vec2 = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      ls.push((q[0] - p0[0]) * d[0] + (q[1] - p0[1]) * d[1]);
    }
  ls.sort((a, b) => a - b);
  const r: [number, number][] = [];
  for (let i = 0; i + 1 < ls.length; i += 2) if (ls[i + 1]! > ls[i]!) r.push([ls[i]!, ls[i + 1]!]);
  return r;
}

const rect = (u0: number, u1: number, z0: number, z1: number): Vec2[] => [
  [u0, z0],
  [u1, z0],
  [u1, z1],
  [u0, z1],
];

/**
 * Cómo se dibujan las piezas de un alzado: «solido», con su canto y su ancho; «alambrico», por sus
 * ejes (los pilares por el de su sección, las vigas y las losas en la cota de su planta, como el 3D
 * alámbrico); «analitico», el modelo que se calcula (`ModeloAnaliticoAlzado`).
 */
export type ModoAlzado = "solido" | "alambrico" | "analitico";

/** Lo que necesita el modo «analitico»: la compilación. */
export interface ModeloAnaliticoAlzado {
  modelo: ModeloAnalitico;
  mapeo: Mapeo;
}

export interface OpcionesAlzado {
  abajo?: number;
  arriba?: number;
  atenuado?: boolean;
  /** Por defecto, «solido». «analitico» sin `analitico` dibuja sólo las plantas y los ejes. */
  modo?: ModoAlzado;
  analitico?: ModeloAnaliticoAlzado | null;
}

/**
 * `abajo`: lo que se deja libre (m) entre la planta más baja y las burbujas de los ejes (I4: las
 * flechas de las reacciones); `arriba`, lo mismo sobre la más alta (las cargas). `atenuado`: las
 * piezas en gris y sin sus ids, de fondo (las cargas); las plantas y los ejes no cambian.
 */
export function vistaAlzado(f: ModeloFisico, plano: PlanoAlzado, d: DatosVista, o: OpcionesAlzado = {}): Escena {
  const modo = o.modo ?? "solido";
  const fisico = modo !== "analitico";
  const P: Primitiva[] = [];
  const usados = new Set<Estilo>();
  const notas: string[] = [];
  // Los apoyos, tampoco: son condiciones de contorno
  const FONDO: ReadonlySet<Estilo> = new Set(["nivel", "eje", "eje-burbuja", "apoyo", "apoyo-lineal"]);
  const poner = (p: Primitiva) => {
    if (o.atenuado && p.tipo !== "texto" && !FONDO.has(p.estilo)) p = { ...p, estilo: p.tipo === "linea" ? "atenuado-linea" : "atenuado" } as Primitiva;
    else if (o.atenuado && p.tipo === "texto" && p.clase === "id") return;
    if (p.tipo !== "texto") usados.add(p.estilo);
    P.push(p);
  };
  const prof = plano.profundidad ?? PROFUNDIDAD_ALZADO;
  const L = Math.hypot(plano.hasta[0] - plano.desde[0], plano.hasta[1] - plano.desde[1]);
  const dir: Vec2 = L > 0 ? [(plano.hasta[0] - plano.desde[0]) / L, (plano.hasta[1] - plano.desde[1]) / L] : [1, 0];
  const nor: Vec2 = [-dir[1], dir[0]];
  const u = (p: Vec2) => (p[0] - plano.desde[0]) * dir[0] + (p[1] - plano.desde[1]) * dir[1];
  const w = (p: Vec2) => (p[0] - plano.desde[0]) * nor[0] + (p[1] - plano.desde[1]) * nor[1];

  const plantas = f.plantas ?? [];
  const cotas = cotasPlantas(plantas);
  const indice = new Map(plantas.map((p, i) => [p.id, i]));
  const cotaDe = (id: string) => cotas[indice.get(id) ?? -1] ?? null;
  const seccion = (id: string | undefined) => f.secciones?.find((s) => s.id === id);
  const zs = cotas.filter((z): z is number => z !== null);
  const [zmin, zmax] = zs.length ? [Math.min(...zs), Math.max(...zs)] : [0, 3];

  // ─── Pilares ──────────────────────────────────────────────────────────────────────────────────
  const anchoVisto = (p: Pilar, s: Seccion | undefined): [number, number] | null => {
    const h = huellaSeccion(p, s);
    if (!h) return null;
    // Desde el punto (x, y) del pilar: con un punto fijo (PF), la huella no está centrada en él
    if ("radio" in h) {
      const c = (h.centro[0] - p.x) * dir[0] + (h.centro[1] - p.y) * dir[1];
      return [c - h.radio, c + h.radio];
    }
    const us = h.anillo.map((q) => (q[0] - p.x) * dir[0] + (q[1] - p.y) * dir[1]);
    return [Math.min(...us), Math.max(...us)];
  };
  for (const p of fisico ? porId(f.pilares ?? []) : []) {
    const q: Vec2 = [p.x, p.y];
    if (Math.abs(w(q)) > prof) continue;
    const a = indice.get(p.desde);
    const b = indice.get(p.hasta);
    if (a === undefined || b === undefined || b >= a) continue;
    const up = u(q);
    let arriba = -Infinity;
    for (let k = a - 1; k >= b; k--) {
      const z0 = cotas[k + 1];
      const z1 = cotas[k];
      if (z0 === null || z1 === null || z0 === undefined || z1 === undefined) continue;
      const cabeza = plantas[k]!.id;
      const s = seccion(p.tramos?.find((t) => t.planta === cabeza)?.seccion ?? p.seccion);
      const ancho = anchoVisto(p, s);
      if (modo === "alambrico") {
        const ue = u(ejeSeccion(p, s));
        poner({ tipo: "linea", puntos: [[ue, z0], [ue, z1]], estilo: "eje-pilar", objeto: p.id });
      } else if (ancho) poner({ tipo: "poligono", anillos: [rect(up + ancho[0], up + ancho[1], z0, z1)], estilo: "pilar-alzado", objeto: p.id });
      else poner({ tipo: "linea", puntos: [[up, z0], [up, z1]], estilo: "vigueta", objeto: p.id });
      arriba = Math.max(arriba, z1);
    }
    const zb = cotas[a];
    if (zb !== null && zb !== undefined) {
      // El arranque: empotrado, una base rayada; articulado, un triángulo; apeado, nada. En el eje del
      // primer tramo (PF)
      const up = u(ejeSeccion(p, seccion(p.tramos?.find((t) => t.planta === plantas[a - 1]?.id)?.seccion ?? p.seccion)));
      const base = p.base ?? "empotrado";
      if (base === "empotrado") {
        const m = 0.45;
        poner({ tipo: "linea", puntos: [[up - m, zb], [up + m, zb]], estilo: "apoyo", objeto: p.id });
        for (let i = 0; i <= 6; i++) {
          const x = up - m + (2 * m * i) / 6;
          poner({ tipo: "linea", puntos: [[x, zb], [x - 0.15, zb - 0.15]], estilo: "apoyo", objeto: p.id });
        }
      } else if (base === "articulado") poner({ tipo: "marca", p: [up, zb], forma: "triangulo", radio: 7, estilo: "apoyo", objeto: p.id });
    }
    if (Number.isFinite(arriba)) poner({ tipo: "texto", p: [up, arriba], texto: p.id, tamano: 11, negrita: true, ancla: "medio", dy: -6, fondo: true, prioridad: 50, clase: "id", objeto: p.id });
  }

  // ─── Muros ────────────────────────────────────────────────────────────────────────────────────
  for (const m of fisico ? porId(f.muros ?? []) : []) {
    const zb = cotaDe(m.desde);
    const zc = cotaDe(m.hasta);
    if (zb === null || zc === null || zc <= zb) continue;
    let s0 = 0;
    for (let i = 1; i < m.puntos.length; i++) {
      const [a, b] = [m.puntos[i - 1]!, m.puntos[i]!];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l === 0) continue;
      const seno = Math.abs(((b[0] - a[0]) / l) * nor[0] + ((b[1] - a[1]) / l) * nor[1]);
      const [ua, ub, wa, wb] = [u(a), u(b), w(a), w(b)];
      if (seno < SENO_PARALELO) {
        if (Math.abs(wa) <= prof + m.espesor / 2 && Math.abs(wb) <= prof + m.espesor / 2) {
          // Paralelo: el paño entero con sus huecos en este tramo
          const huecos: Vec2[][] = [];
          for (const h of m.huecos ?? []) {
            const [d0, d1] = [Math.max(h.desde, s0), Math.min(h.hasta, s0 + l)];
            if (d1 <= d0) continue;
            const [h0, h1] = [ua + ((ub - ua) * (d0 - s0)) / l, ua + ((ub - ua) * (d1 - s0)) / l];
            huecos.push(rect(Math.min(h0, h1), Math.max(h0, h1), zb + h.z0, zb + h.z1));
          }
          const anillos = [rect(Math.min(ua, ub), Math.max(ua, ub), zb, zc), ...huecos];
          // Alámbrico: su contorno y el de sus huecos
          if (modo === "alambrico") for (const r of anillos) poner({ tipo: "linea", puntos: [...r, r[0]!], estilo: "muro-alambrico", objeto: m.id });
          else poner({ tipo: "poligono", anillos, estilo: "muro-alzado", objeto: m.id });
        }
      } else if (wa > 0 !== wb > 0 || wa === 0 || wb === 0) {
        // Lo cruza: cortado (alámbrico, su eje)
        const t = wa / (wa - wb || 1);
        const uc = ua + t * (ub - ua);
        const e = m.espesor / 2 / seno;
        if (modo === "alambrico") poner({ tipo: "linea", puntos: [[uc, zb], [uc, zc]], estilo: "muro-alambrico", objeto: m.id });
        else poner({ tipo: "poligono", anillos: [rect(uc - e, uc + e, zb, zc)], estilo: "seccion-cortada", objeto: m.id });
      }
      s0 += l;
    }
    const centro = puntoEnPolilinea(m.puntos, longitud(m.puntos) / 2).p;
    if (Math.abs(w(centro)) <= prof + m.espesor / 2) poner({ tipo: "texto", p: [u(centro), (zb + zc) / 2], texto: m.id, tamano: 11, ancla: "medio", fondo: true, prioridad: 40, clase: "id", objeto: m.id });
  }

  // ─── Losas y paños, cortados ─────────────────────────────────────────────────────────────────
  const cortes: { id: string; anillos: Vec2[][]; espesor: number; planta: string; estilo: Estilo }[] = [
    ...porId(f.losas ?? []).map((l) => ({ id: l.id, anillos: [l.contorno as Vec2[], ...((l.huecos ?? []) as Vec2[][])], espesor: l.espesor, planta: l.planta, estilo: "losa-cortada" as const })),
    ...porId(f.panos ?? []).map((p) => ({ id: p.id, anillos: [p.contorno as Vec2[], ...((p.huecos ?? []) as Vec2[][])], espesor: cantoSeccion(seccion(p.seccion)) || 0.3, planta: p.planta, estilo: "pano-cortado" as const })),
  ];
  for (const c of fisico ? cortes : []) {
    const z = cotaDe(c.planta);
    if (z === null) continue;
    for (const [a, b] of intervalosRecta(c.anillos, plano.desde, dir))
      if (modo === "alambrico") poner({ tipo: "linea", puntos: [[a, z], [b, z]], estilo: c.estilo === "losa-cortada" ? "losa-alambrico" : "pano-alambrico", objeto: c.id });
      else poner({ tipo: "poligono", anillos: [rect(a, b, z - c.espesor, z)], estilo: c.estilo, objeto: c.id });
  }

  // ─── Vigas ────────────────────────────────────────────────────────────────────────────────────
  for (const v of fisico ? porId(f.vigas ?? []) : []) {
    const z = cotaDe(v.planta);
    if (z === null) continue;
    const s = seccion(v.seccion);
    const h = cantoSeccion(s) || 0.3;
    const b = anchoViga(s);
    let rotulada = false;
    for (let i = 1; i < v.puntos.length; i++) {
      const [pa, pb] = [v.puntos[i - 1]!, v.puntos[i]!];
      const l = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      if (l === 0) continue;
      const seno = Math.abs(((pb[0] - pa[0]) / l) * nor[0] + ((pb[1] - pa[1]) / l) * nor[1]);
      const [ua, ub, wa, wb] = [u(pa), u(pb), w(pa), w(pb)];
      if (seno < SENO_PARALELO) {
        if (Math.abs(wa) > prof + b / 2 || Math.abs(wb) > prof + b / 2) continue;
        if (modo === "alambrico") poner({ tipo: "linea", puntos: [[ua, z], [ub, z]], estilo: "eje-viga", objeto: v.id });
        else poner({ tipo: "poligono", anillos: [rect(Math.min(ua, ub), Math.max(ua, ub), z - h, z)], estilo: "viga-alzado", objeto: v.id });
        if (!rotulada) {
          poner({ tipo: "texto", p: [(ua + ub) / 2, modo === "alambrico" ? z : z - h / 2], texto: `${v.id}`, tamano: 11, ancla: "medio", dy: modo === "alambrico" ? 14 : 4, fondo: true, prioridad: 30, clase: "id", objeto: v.id });
          rotulada = true;
        }
      } else if (wa > 0 !== wb > 0 || wa === 0 || wb === 0) {
        const t = wa / (wa - wb || 1);
        const uc = ua + t * (ub - ua);
        const e = (b || 0.05) / 2 / seno;
        if (modo === "alambrico") poner({ tipo: "marca", p: [uc, z], forma: "cuadrado", radio: 3.5, estilo: "eje-viga", objeto: v.id });
        else poner({ tipo: "poligono", anillos: [rect(uc - e, uc + e, z - h, z)], estilo: "seccion-cortada", objeto: v.id });
      }
    }
  }

  // ─── Apoyos ───────────────────────────────────────────────────────────────────────────────────
  const rotuloApoyo = (p: Vec2, id: string, c: readonly boolean[]) =>
    poner({ tipo: "texto", p, texto: `${id} · ${textoCoartados(c)}`, tamano: 11, ancla: "medio", dy: 22, fondo: true, prioridad: 45, clase: "id", objeto: id });
  for (const a of fisico ? porId(f.apoyos ?? []) : []) {
    const z = cotaDe(a.planta);
    if (z === null || Math.abs(w([a.x, a.y])) > prof) continue;
    // Bajo la losa, si cae en una; en el alámbrico, en la cota
    const zf = modo === "alambrico" ? z : z - espesorLosaEn(f, a.planta, [a.x, a.y]);
    poner({ tipo: "marca", p: [u([a.x, a.y]), zf], forma: "triangulo", radio: 7, estilo: "apoyo", objeto: a.id });
    rotuloApoyo([u([a.x, a.y]), zf], a.id, a.coartados);
  }
  // Los lineales: lo que corre por el plano, con sus triángulos debajo; lo que lo cruza, un triángulo
  for (const a of fisico ? porId(f.apoyosLineales ?? []) : []) {
    const z = cotaDe(a.planta);
    if (z === null) continue;
    let rotulado = false;
    for (let i = 1; i < a.puntos.length; i++) {
      const [A, B] = [a.puntos[i - 1]!, a.puntos[i]!];
      const l = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (l === 0) continue;
      // El trozo a menos de prof del plano: |w(A) + t·(w(B) − w(A))| ≤ prof, t ∈ [0, 1]
      const [wa, wb] = [w(A), w(B)];
      let [t0, t1] = [0, 1];
      if (wa !== wb) {
        const [ta, tb] = [(-prof - wa) / (wb - wa), (prof - wa) / (wb - wa)];
        [t0, t1] = [Math.max(0, Math.min(ta, tb)), Math.min(1, Math.max(ta, tb))];
      } else if (Math.abs(wa) > prof) continue;
      if (t1 < t0) continue;
      const en = (t: number): Vec2 => [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])];
      const seno = Math.abs(wb - wa) / l;
      const zf = modo === "alambrico" ? z : z - espesorLosaEn(f, a.planta, en((t0 + t1) / 2));
      if (seno < SENO_PARALELO) {
        const [ua, ub] = [u(en(t0)), u(en(t1))].sort((x, y) => x - y) as [number, number];
        if (ub - ua <= 1e-9) continue;
        const linea: Vec2[] = [[ua, zf], [ub, zf]];
        poner({ tipo: "linea", puntos: linea, estilo: "apoyo-lineal", objeto: a.id });
        for (const t of triangulosApoyo(linea)) poner({ tipo: "poligono", anillos: [t], estilo: "apoyo", objeto: a.id });
        if (!rotulado) rotuloApoyo([(ua + ub) / 2, zf], a.id, a.coartados);
      } else {
        const t = wa === wb ? (t0 + t1) / 2 : Math.max(t0, Math.min(t1, wa / (wa - wb)));
        poner({ tipo: "marca", p: [u(en(t)), zf], forma: "triangulo", radio: 7, estilo: "apoyo", objeto: a.id });
        if (!rotulado) rotuloApoyo([u(en(t)), zf], a.id, a.coartados);
      }
      rotulado = true;
    }
  }

  // ─── El modelo analítico ──────────────────────────────────────────────────────────────────────
  if (modo === "analitico" && o.analitico) {
    const { modelo: ma, mapeo } = o.analitico;
    const N = ma.nudos;
    const enBanda = (n: number) => Math.abs(w([N[n]!.x, N[n]!.y])) <= prof;
    const uz = (x: number, y: number, z: number): Vec2 => [u([x, y]), z];
    const nudosVistos = new Set<number>();
    // El tramo más largo de cada pieza, para su rótulo
    const rotulos = new Map<string, { p: Vec2; l: number; pilar: boolean }>();

    for (let i = 0; i < (ma.barras?.length ?? 0); i++) {
      const b = ma.barras![i]!;
      const [a, c] = b.nudos;
      if (!enBanda(a) || !enBanda(c)) continue;
      const mb = mapeo.barras[i]!;
      const id = mb.pano ?? mb.pieza;
      const [A, C] = [N[a]!, N[c]!];
      const di = b.offsets?.i ?? [0, 0, 0];
      const dj = b.offsets?.j ?? [0, 0, 0];
      const pA = uz(A.x, A.y, A.z);
      const pC = uz(C.x, C.y, C.z);
      const pI = uz(A.x + di[0], A.y + di[1], A.z + di[2]);
      const pJ = uz(C.x + dj[0], C.y + dj[1], C.z + dj[2]);
      nudosVistos.add(a).add(c);
      // Perpendicular al plano: sólo sus nudos
      const lf = Math.hypot(pJ[0] - pI[0], pJ[1] - pI[1]);
      if (lf <= 1e-6) continue;
      for (const [n, e] of [[pA, pI], [pC, pJ]] as const) if (Math.hypot(e[0] - n[0], e[1] - n[1]) > 1e-6) poner({ tipo: "linea", puntos: [n, e], estilo: "zona-rigida", objeto: id });
      poner({ tipo: "linea", puntos: [pI, pJ], estilo: mb.tipo === "vigueta" ? "vigueta" : "barra-analitica", objeto: id });
      // Articulación (algún momento liberado) o empotramiento parcial (CY2), en el extremo del tramo flexible
      for (const [k, p] of [["i", pI], ["j", pJ]] as const) {
        const lib = b.liberaciones?.[k];
        const emp = b.empotramiento?.[k];
        if (lib && (lib[4] || lib[5])) poner({ tipo: "marca", p, forma: "circulo", radio: 4, estilo: "articulacion", objeto: id });
        else if (emp !== undefined && emp < 1) poner({ tipo: "marca", p, forma: "cuadrado", radio: 3.5, estilo: "semiempotrado", objeto: id });
      }
      if (mb.tipo !== "vigueta" && !mb.auxiliar && lf > (rotulos.get(id)?.l ?? 0)) rotulos.set(id, { p: [(pI[0] + pJ[0]) / 2, (pI[1] + pJ[1]) / 2], l: lf, pilar: mb.tipo === "pilar" });
    }

    // Láminas: las paralelas al plano (los muros) con su malla; las que lo cruzan (las losas), cortadas
    for (let i = 0; i < (ma.laminas?.length ?? 0); i++) {
      const l = ma.laminas![i]!;
      const ml = mapeo.laminas?.[i];
      const id = ml?.losa ?? ml?.muro;
      const P3 = l.nudos.map((n) => N[n]!);
      const ws = P3.map((q) => w([q.x, q.y]));
      if (Math.min(...ws) > prof || Math.max(...ws) < -prof) continue;
      // Normal por las diagonales
      const [d1, d2] = [
        [P3[2]!.x - P3[0]!.x, P3[2]!.y - P3[0]!.y, P3[2]!.z - P3[0]!.z],
        [P3[3]!.x - P3[1]!.x, P3[3]!.y - P3[1]!.y, P3[3]!.z - P3[1]!.z],
      ] as const;
      const nn = [d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]];
      const nl = Math.hypot(nn[0]!, nn[1]!, nn[2]!) || 1;
      if (Math.abs((nn[0]! * nor[0] + nn[1]! * nor[1]) / nl) >= Math.cos(Math.asin(SENO_PARALELO))) {
        if (ws.some((x) => Math.abs(x) > prof)) continue;
        const r = P3.map((q) => uz(q.x, q.y, q.z));
        poner({ tipo: "linea", puntos: [...r, r[0]!], estilo: "lamina-analitica", ...(id ? { objeto: id } : {}) });
        for (const n of l.nudos) nudosVistos.add(n);
        continue;
      }
      // El corte con el plano: los puntos de sus lados en w = 0
      const cs: Vec2[] = [];
      for (let k = 0; k < 4; k++) {
        const [qa, qb, wa, wb] = [P3[k]!, P3[(k + 1) % 4]!, ws[k]!, ws[(k + 1) % 4]!];
        if (wa === 0) cs.push(uz(qa.x, qa.y, qa.z));
        else if (wa > 0 !== wb > 0 && wb !== 0) {
          const t = wa / (wa - wb);
          cs.push(uz(qa.x + t * (qb.x - qa.x), qa.y + t * (qb.y - qa.y), qa.z + t * (qb.z - qa.z)));
        }
      }
      if (cs.length < 2) continue;
      cs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
      const [c0, c1] = [cs[0]!, cs[cs.length - 1]!];
      if (Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) > 1e-9) poner({ tipo: "linea", puntos: [c0, c1], estilo: "lamina-cortada", ...(id ? { objeto: id } : {}) });
    }

    // Enlaces rígidos (huellas de los pilares, uniones de la losa a las vigas…): del maestro a cada esclavo; el diafragma no
    (ma.restricciones ?? []).forEach((r, i) => {
      if (r.tipo !== "enlace-rigido" || !enBanda(r.maestro)) return;
      const M = N[r.maestro]!;
      const pm = uz(M.x, M.y, M.z);
      const id = mapeo.restricciones[i]?.pilar ?? mapeo.restricciones[i]?.viga;
      for (const e of r.esclavos) {
        if (!enBanda(e)) continue;
        const pe = uz(N[e]!.x, N[e]!.y, N[e]!.z);
        if (Math.hypot(pe[0] - pm[0], pe[1] - pm[1]) <= 1e-6) continue;
        poner({ tipo: "linea", puntos: [pm, pe], estilo: "enlace-rigido", ...(id ? { objeto: id } : {}) });
      }
    });

    // Apoyos: empotrado (los seis coartados), rayado; si no, un triángulo
    for (const a of ma.apoyos ?? []) {
      if (!enBanda(a.nudo)) continue;
      const q = N[a.nudo]!;
      const [ua, za] = uz(q.x, q.y, q.z);
      const id = mapeo.nudos[a.nudo]?.fisicos[0];
      const ob = id ? { objeto: id } : {};
      if (a.coartados.every(Boolean)) {
        const m = 0.45;
        poner({ tipo: "linea", puntos: [[ua - m, za], [ua + m, za]], estilo: "apoyo", ...ob });
        for (let k = 0; k <= 6; k++) {
          const x = ua - m + (2 * m * k) / 6;
          poner({ tipo: "linea", puntos: [[x, za], [x - 0.15, za - 0.15]], estilo: "apoyo", ...ob });
        }
      } else poner({ tipo: "marca", p: [ua, za], forma: "triangulo", radio: 7, estilo: "apoyo", ...ob });
    }

    for (const n of [...nudosVistos].sort((x, y) => x - y)) poner({ tipo: "marca", p: uz(N[n]!.x, N[n]!.y, N[n]!.z), forma: "circulo", radio: 2, estilo: "nudo-analitico" });
    for (const [id, r] of [...rotulos].sort((x, y) => (x[0] < y[0] ? -1 : 1)))
      poner({ tipo: "texto", p: r.p, texto: id, tamano: 11, ancla: "medio", ...(r.pilar ? { dx: 0 } : { dy: 14 }), fondo: true, prioridad: r.pilar ? 50 : 30, clase: "id", objeto: id });
    notas.push("Modelo analítico: las barras por sus nudos, con las zonas rígidas (offsets) aparte; el diafragma rígido de las plantas no se dibuja.");
  } else if (modo === "analitico") notas.push("El modelo analítico necesita que el modelo compile.");

  // ─── Plantas y ejes ───────────────────────────────────────────────────────────────────────────
  const dibujado = cajaDe(P.filter((p) => p.tipo !== "texto").flatMap(puntosDe));
  const [u0, u1] = P.some((p) => p.tipo !== "texto") ? [Math.min(0, dibujado[0]), Math.max(L, dibujado[2])] : [0, L];
  plantas.forEach((p, i) => {
    const z = cotas[i];
    if (z === null || z === undefined) return;
    poner({ tipo: "linea", puntos: [[u0 - 1, z], [u1 + 1, z]], estilo: "nivel", objeto: p.id });
    P.push({ tipo: "texto", p: [u0 - 1, z], texto: `${p.id} ${z >= 0 ? "+" : ""}${rotulo(z, 4)}`, tamano: 11, negrita: true, dx: 2, dy: -4, prioridad: 90, clase: "eje", objeto: p.id });
  });
  const ejes = capaEjesAlzado(f, plano, { u: (p) => u(p), w: (p) => w(p) }, [u0 - 1, u1 + 1], [zmin - 1.2 - (o.abajo ?? 0), zmax + 1.6 + (o.arriba ?? 0)]);
  for (const x of ejes) poner(x);

  const leyenda: EntradaLeyenda[] = [];
  const entrada = (e: Estilo, t: string) => {
    if (usados.has(e)) leyenda.push({ estilo: e, texto: t });
  };
  entrada("pilar-alzado", "Pilar, con el ancho que se ve desde el plano");
  entrada("muro-alzado", "Muro paralelo al plano, con sus huecos");
  entrada("viga-alzado", "Viga paralela al plano, con su canto y la cara superior en la planta");
  entrada("seccion-cortada", "Viga o muro que cruza el plano, cortado");
  entrada("losa-cortada", "Losa cortada, con su espesor");
  entrada("pano-cortado", "Paño unidireccional cortado, con el canto de sus viguetas");
  entrada("eje-pilar", "Pilar, por el eje de su sección");
  entrada("eje-viga", "Viga paralela al plano, en la cota de su planta; si lo cruza, un cuadrado");
  entrada("muro-alambrico", "Muro paralelo al plano, su contorno; si lo cruza, su eje");
  entrada("losa-alambrico", "Losa cortada, en la cota de su planta");
  entrada("pano-alambrico", "Paño unidireccional cortado, en la cota de su planta");
  entrada("barra-analitica", "Barra del modelo analítico: su tramo flexible");
  entrada("zona-rigida", "Zona rígida u offset de una barra, del nudo al tramo flexible");
  entrada("articulacion", "Momento liberado en el extremo del tramo flexible");
  entrada("semiempotrado", "Empotramiento parcial (coeficiente < 1)");
  entrada("lamina-analitica", "Láminas paralelas al plano (muros), su malla");
  entrada("lamina-cortada", "Láminas que cruzan el plano (losas), cortadas");
  entrada("enlace-rigido", "Enlace rígido, del maestro a cada esclavo");
  entrada("nudo-analitico", "Nudo del modelo analítico");
  entrada("vigueta", modo === "analitico" ? "Vigueta" : "Pilar sin sección conocida (su eje)");
  entrada("apoyo", "Arranque empotrado (rayado), articulado o apoyo (triángulo, bajo la losa, con lo que coacciona)");
  entrada("apoyo-lineal", "Apoyo lineal paralelo al plano, bajo la losa, con triángulos; si lo cruza, un triángulo");
  entrada("nivel", "Planta, con su cota (m)");
  entrada("eje", "Eje de replanteo que cruza el plano");
  const caja = cajaDe(P.filter((p) => p.tipo !== "texto").flatMap(puntosDe));
  notas.push(
    `u, a lo largo del plano desde (${rotulo(plano.desde[0], 4)}; ${rotulo(plano.desde[1], 4)}) hacia (${rotulo(plano.hasta[0], 4)}; ${rotulo(plano.hasta[1], 4)}); z, la cota; m.`,
    `Se dibuja lo que está a menos de ${rotulo(prof)} m del plano en planta; lo cortado, oscuro y encima.`,
  );
  return {
    titulo: d.nombre ?? "Proyecto",
    cabecera: [`Alzado ${plano.nombre ?? ""}`.trim(), ...(modo === "solido" ? [] : [modo === "alambrico" ? "Alámbrico" : "Analítico"]), `Profundidad ±${rotulo(prof)} m`, `Huella ${d.huella.slice(0, 12)}`],
    primitivas: P,
    leyenda,
    notas,
    extremos: [],
    caja,
  };
}
