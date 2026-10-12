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
 *   viguetas), y los apoyos.
 *
 * No hay líneas ocultas: se dibuja en ese orden y lo cortado va encima.
 *
 * Puro: sin IO.
 */
import { cotasPlantas } from "../../compilador/cotas.ts";
import { ejesDe } from "../../compilador/ejes.ts";
import type { ModeloFisico, Pilar, Seccion, Vec2 } from "../../compilador/fisico.ts";
import { capaEjesAlzado } from "./ejes.ts";
import { cajaDe, longitud, puntoEnPolilinea, puntosDe, rotulo, type EntradaLeyenda, type Escena, type Estilo, type Primitiva } from "./escena.ts";
import { anchoViga, huellaSeccion, porId, type DatosVista } from "./modelo.ts";

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
function intervalosRecta(anillos: readonly (readonly Vec2[])[], p0: Vec2, d: Vec2): [number, number][] {
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

/** `abajo`: lo que se deja libre (m) entre la planta más baja y las burbujas de los ejes (I4: las flechas de las reacciones). */
export function vistaAlzado(f: ModeloFisico, plano: PlanoAlzado, d: DatosVista, o: { abajo?: number } = {}): Escena {
  const P: Primitiva[] = [];
  const usados = new Set<Estilo>();
  const notas: string[] = [];
  const poner = (p: Primitiva) => {
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
    if ("radio" in h) return [-h.radio, h.radio];
    const us = h.anillo.map((q) => (q[0] - p.x) * dir[0] + (q[1] - p.y) * dir[1]);
    return [Math.min(...us), Math.max(...us)];
  };
  for (const p of porId(f.pilares ?? [])) {
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
      if (ancho) poner({ tipo: "poligono", anillos: [rect(up + ancho[0], up + ancho[1], z0, z1)], estilo: "pilar-alzado", objeto: p.id });
      else poner({ tipo: "linea", puntos: [[up, z0], [up, z1]], estilo: "vigueta", objeto: p.id });
      arriba = Math.max(arriba, z1);
    }
    const zb = cotas[a];
    if (zb !== null && zb !== undefined) {
      // El arranque: empotrado, una base rayada; articulado, un triángulo; apeado, nada
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
    if (Number.isFinite(arriba)) P.push({ tipo: "texto", p: [up, arriba], texto: p.id, tamano: 11, negrita: true, ancla: "medio", dy: -6, fondo: true, prioridad: 50, clase: "id", objeto: p.id });
  }

  // ─── Muros ────────────────────────────────────────────────────────────────────────────────────
  for (const m of porId(f.muros ?? [])) {
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
          poner({ tipo: "poligono", anillos: [rect(Math.min(ua, ub), Math.max(ua, ub), zb, zc), ...huecos], estilo: "muro-alzado", objeto: m.id });
        }
      } else if (wa > 0 !== wb > 0 || wa === 0 || wb === 0) {
        // Lo cruza: cortado
        const t = wa / (wa - wb || 1);
        const uc = ua + t * (ub - ua);
        const e = m.espesor / 2 / seno;
        poner({ tipo: "poligono", anillos: [rect(uc - e, uc + e, zb, zc)], estilo: "seccion-cortada", objeto: m.id });
      }
      s0 += l;
    }
    const centro = puntoEnPolilinea(m.puntos, longitud(m.puntos) / 2).p;
    if (Math.abs(w(centro)) <= prof + m.espesor / 2) P.push({ tipo: "texto", p: [u(centro), (zb + zc) / 2], texto: m.id, tamano: 11, ancla: "medio", fondo: true, prioridad: 40, clase: "id", objeto: m.id });
  }

  // ─── Losas y paños, cortados ─────────────────────────────────────────────────────────────────
  const cortes: { id: string; anillos: Vec2[][]; espesor: number; planta: string; estilo: Estilo }[] = [
    ...porId(f.losas ?? []).map((l) => ({ id: l.id, anillos: [l.contorno as Vec2[], ...((l.huecos ?? []) as Vec2[][])], espesor: l.espesor, planta: l.planta, estilo: "losa-cortada" as const })),
    ...porId(f.panos ?? []).map((p) => ({ id: p.id, anillos: [p.contorno as Vec2[], ...((p.huecos ?? []) as Vec2[][])], espesor: cantoSeccion(seccion(p.seccion)) || 0.3, planta: p.planta, estilo: "pano-cortado" as const })),
  ];
  for (const c of cortes) {
    const z = cotaDe(c.planta);
    if (z === null) continue;
    for (const [a, b] of intervalosRecta(c.anillos, plano.desde, dir)) poner({ tipo: "poligono", anillos: [rect(a, b, z - c.espesor, z)], estilo: c.estilo, objeto: c.id });
  }

  // ─── Vigas ────────────────────────────────────────────────────────────────────────────────────
  for (const v of porId(f.vigas ?? [])) {
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
        poner({ tipo: "poligono", anillos: [rect(Math.min(ua, ub), Math.max(ua, ub), z - h, z)], estilo: "viga-alzado", objeto: v.id });
        if (!rotulada) {
          P.push({ tipo: "texto", p: [(ua + ub) / 2, z - h / 2], texto: `${v.id}`, tamano: 11, ancla: "medio", dy: 4, fondo: true, prioridad: 30, clase: "id", objeto: v.id });
          rotulada = true;
        }
      } else if (wa > 0 !== wb > 0 || wa === 0 || wb === 0) {
        const t = wa / (wa - wb || 1);
        const uc = ua + t * (ub - ua);
        const e = (b || 0.05) / 2 / seno;
        poner({ tipo: "poligono", anillos: [rect(uc - e, uc + e, z - h, z)], estilo: "seccion-cortada", objeto: v.id });
      }
    }
  }

  // ─── Apoyos ───────────────────────────────────────────────────────────────────────────────────
  for (const a of porId(f.apoyos ?? [])) {
    const z = cotaDe(a.planta);
    if (z === null || Math.abs(w([a.x, a.y])) > prof) continue;
    poner({ tipo: "marca", p: [u([a.x, a.y]), z], forma: "triangulo", radio: 7, estilo: "apoyo", objeto: a.id });
  }

  // ─── Plantas y ejes ───────────────────────────────────────────────────────────────────────────
  const dibujado = cajaDe(P.filter((p) => p.tipo !== "texto").flatMap(puntosDe));
  const [u0, u1] = P.some((p) => p.tipo !== "texto") ? [Math.min(0, dibujado[0]), Math.max(L, dibujado[2])] : [0, L];
  plantas.forEach((p, i) => {
    const z = cotas[i];
    if (z === null || z === undefined) return;
    poner({ tipo: "linea", puntos: [[u0 - 1, z], [u1 + 1, z]], estilo: "nivel", objeto: p.id });
    P.push({ tipo: "texto", p: [u0 - 1, z], texto: `${p.id} ${z >= 0 ? "+" : ""}${rotulo(z, 4)}`, tamano: 11, negrita: true, dx: 2, dy: -4, prioridad: 90, clase: "eje", objeto: p.id });
  });
  const ejes = capaEjesAlzado(f, plano, { u: (p) => u(p), w: (p) => w(p) }, [u0 - 1, u1 + 1], [zmin - 1.2 - (o.abajo ?? 0), zmax + 1.6]);
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
  entrada("vigueta", "Pilar sin sección conocida (su eje)");
  entrada("apoyo", "Arranque empotrado (rayado), articulado o apoyo (triángulo)");
  entrada("nivel", "Planta, con su cota (m)");
  entrada("eje", "Eje de replanteo que cruza el plano");
  const caja = cajaDe(P.filter((p) => p.tipo !== "texto").flatMap(puntosDe));
  notas.push(
    `u, a lo largo del plano desde (${rotulo(plano.desde[0], 4)}; ${rotulo(plano.desde[1], 4)}) hacia (${rotulo(plano.hasta[0], 4)}; ${rotulo(plano.hasta[1], 4)}); z, la cota; m.`,
    `Se dibuja lo que está a menos de ${rotulo(prof)} m del plano en planta; lo cortado, oscuro y encima.`,
  );
  return {
    titulo: d.nombre ?? "Proyecto",
    cabecera: [`Alzado ${plano.nombre ?? ""}`.trim(), `Profundidad ±${rotulo(prof)} m`, `Huella ${d.huella.slice(0, 12)}`],
    primitivas: P,
    leyenda,
    notas,
    extremos: [],
    caja,
  };
}
