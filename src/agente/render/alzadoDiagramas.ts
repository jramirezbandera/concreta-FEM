/**
 * Alzado con los diagramas de las barras (I4, `docs/fem3d/interfaz.md` §5.1 y §7): el alzado de
 * `vistaAlzado` con, encima, los diagramas de las barras del plano. Es la vista de un pórtico, como
 * la de SAP2000.
 *
 * - Barras del plano: los tramos flexibles con sus dos extremos (i', j') a menos de la profundidad
 *   del plano y paralelos a él (menos de 10°): las vigas del pórtico y los pilares que están en él.
 * - Qué se dibuja, en el plano (n, su normal horizontal; la pieza leída en u creciente, o en z
 *   creciente si es vertical):
 *   · M, el momento de eje n (el que flecta la barra en el plano), del lado de las tracciones. En
 *     una viga del plano es su My, y en un pilar, su My o su Mz según cómo esté girado;
 *   · V, el cortante en el plano, perpendicular a la barra; en una viga del plano, su Vz;
 *   · N y T, como en la pieza.
 *   Hacia arriba (o hacia u creciente en un pilar) van los positivos de V, N y T.
 * - Los valores son los de `envolventeTramo` (A4) con esa combinación de componentes: cuando la
 *   barra está en los ejes del plano (lo normal), la componente misma, bit a bit.
 * - Rotulados, el máximo (si es positivo) y el mínimo (si es negativo) de cada pieza.
 *
 * Puro: sin IO.
 */
import type { ConjuntoCombinaciones } from "../combinaciones.ts";
import { PROFUNDIDAD_ALZADO, SENO_PARALELO, vistaAlzado, type ModoAlzado, type PlanoAlzado } from "./alzado.ts";
import { axilSinValor, envolventeGuardada, extremosCurva, ORDENADA_DIAGRAMA, pe, piezasConDiagrama, por, pv, tramosEspacio, trozosTramo, type TramoEspacio, type V3 } from "./diagramas.ts";
import { cajaDe, rotulo, type EntradaLeyenda, type Escena, type ExtremoRotulado, type Primitiva, type Vec2 } from "./escena.ts";
import type { DatosVista } from "./modelo.ts";
import type { PuntoEnvolvente, ResultadosRender } from "./resultados.ts";

export const ESFUERZOS_PLANO = ["M", "V", "N", "T"] as const;
export type EsfuerzoPlano = (typeof ESFUERZOS_PLANO)[number];

const UNIDAD: Record<EsfuerzoPlano, string> = { M: "kN·m", V: "kN", N: "kN", T: "kN·m" };
const NOMBRE: Record<EsfuerzoPlano, string> = {
  M: "M, momento en el plano del alzado (kN·m), del lado de las tracciones",
  V: "V, cortante en el plano del alzado (kN)",
  N: "N, axil (kN); positivo, tracción",
  T: "T, torsor (kN·m)",
};

/** Redondea a 0 y a ±1 lo que lo es salvo por el redondeo (una barra en los ejes del plano). */
const limpio = (x: number) => (Math.abs(x) < 1e-12 ? 0 : Math.abs(Math.abs(x) - 1) < 1e-12 ? Math.sign(x) : x);

/**
 * La combinación de componentes [N, Vy, Vz, T, My, Mz] que da el esfuerzo en el plano en un tramo,
 * y la dirección de sus positivos. null si el tramo no está en el plano.
 */
export function enPlano(e: EsfuerzoPlano, tr: TramoEspacio, n: V3): { comp: [number, number][]; d: V3 } | null {
  const q = pv(tr.e1, n);
  const l = Math.hypot(...q);
  if (l < 1e-9) return null;
  const p: V3 = [limpio(q[0] / l), limpio(q[1] / l), limpio(q[2] / l)];
  const s = tr.signo;
  const terminos = (xs: [number, number][]) => xs.map(([c, k]) => [c, limpio(k)] as [number, number]).filter(([, k]) => k !== 0);
  switch (e) {
    case "M":
      return { comp: terminos([[4, s * pe(tr.e2, n)], [5, s * pe(tr.e3, n)], [3, s * pe(tr.e1, n)]]), d: por(p, -s) };
    case "V":
      return { comp: terminos([[2, pe(tr.e3, p)], [1, pe(tr.e2, p)]]), d: por(p, s) };
    case "N":
      return { comp: [[0, 1]], d: por(p, s) };
    case "T":
      return { comp: [[3, 1]], d: por(p, s) };
  }
}

export function vistaAlzadoDiagramas(r: ResultadosRender, plano: PlanoAlzado, esfuerzo: EsfuerzoPlano, conjunto: ConjuntoCombinaciones, d: DatosVista, escala = 1, modo: ModoAlzado = "solido"): Escena {
  const base = vistaAlzado(r.q.fisico, plano, d, { modo, analitico: { modelo: r.q.modelo, mapeo: r.q.mapeo } });
  const prof = plano.profundidad ?? PROFUNDIDAD_ALZADO;
  const L = Math.hypot(plano.hasta[0] - plano.desde[0], plano.hasta[1] - plano.desde[1]);
  const dir: Vec2 = L > 0 ? [(plano.hasta[0] - plano.desde[0]) / L, (plano.hasta[1] - plano.desde[1]) / L] : [1, 0];
  const n: V3 = [-dir[1], dir[0], 0];
  const u = (q: V3) => (q[0] - plano.desde[0]) * dir[0] + (q[1] - plano.desde[1]) * dir[1];
  const w = (q: V3) => (q[0] - plano.desde[0]) * n[0] + (q[1] - plano.desde[1]) * n[1];
  const uz = (q: V3): Vec2 => [u(q), q[2]];
  // En el alzado, la pieza se lee en u creciente, o en z creciente si va más en vertical
  const canonico = (D: V3): 1 | -1 => {
    const du = D[0] * dir[0] + D[1] * dir[1];
    const c = Math.abs(D[2]) > Math.abs(du) ? D[2] : du;
    return c < 0 ? -1 : 1;
  };
  const una = conjunto.factores.length === 1;
  const vistos: { tr: TramoEspacio; puntos: PuntoEnvolvente[]; d: V3 }[] = [];
  const sinAxil = new Set<string>();
  for (const id of piezasConDiagrama(r))
    for (const tr of tramosEspacio(r, id, canonico)) {
      if (Math.abs(w(tr.a)) > prof || Math.abs(w(tr.b)) > prof || Math.abs(pe(tr.e1, n)) > SENO_PARALELO) continue;
      if (esfuerzo === "N" && axilSinValor(r, tr)) {
        sinAxil.add(id);
        continue;
      }
      const x = enPlano(esfuerzo, tr, n);
      if (!x) continue;
      vistos.push({ tr, puntos: envolventeGuardada(r, tr.t, conjunto, x.comp.length ? x.comp : [[0, 0]]), d: x.d });
    }
  let maxAbs = 0;
  for (const { puntos } of vistos) for (const p of puntos) maxAbs = Math.max(maxAbs, Math.abs(p.max), Math.abs(p.min));
  const m = ORDENADA_DIAGRAMA * escala;
  const k = maxAbs > 0 ? m / maxAbs : 0;

  const P: Primitiva[] = [...base.primitivas];
  const nuevos: Vec2[] = [];
  let [hayPos, hayNeg] = [false, false];
  for (const { tr, puntos, d: dd } of vistos)
    for (const t of trozosTramo(tr, puntos, dd, k, una)) {
      const estilo = t.signo > 0 ? "diagrama-positivo" : "diagrama-negativo";
      if (t.signo > 0) hayPos = true;
      else hayNeg = true;
      const puntas = t.puntas.map(uz);
      nuevos.push(...puntas);
      if (t.relleno) P.push({ tipo: "poligono", anillos: [[uz(t.pies[0]!), ...puntas, uz(t.pies[t.pies.length - 1]!)]], estilo, objeto: tr.pieza });
      else P.push({ tipo: "linea", puntos: puntas, estilo, objeto: tr.pieza });
    }

  // Rótulos: el máximo y el mínimo de cada pieza
  const unidad = UNIDAD[esfuerzo];
  const extremos: ExtremoRotulado[] = [];
  const porPieza = new Map<string, typeof vistos>();
  for (const x of vistos) porPieza.set(x.tr.pieza, [...(porPieza.get(x.tr.pieza) ?? []), x]);
  for (const [id, xs] of porPieza) {
    let mx: { v: number; p: Vec2; pie: Vec2 } | null = null;
    let mn: { v: number; p: Vec2; pie: Vec2 } | null = null;
    for (const { tr, puntos, d: dd } of xs) {
      const e = extremosCurva(puntos);
      const Lt = tr.t.s1 - tr.t.s0;
      const en = (s: number, v: number) => {
        const f = Lt > 0 ? (s - tr.t.s0) / Lt : 0;
        const pie: V3 = [tr.a[0] + f * (tr.b[0] - tr.a[0]), tr.a[1] + f * (tr.b[1] - tr.a[1]), tr.a[2] + f * (tr.b[2] - tr.a[2])];
        return { pie: uz(pie), p: uz([pie[0] + dd[0] * v * k, pie[1] + dd[1] * v * k, pie[2] + dd[2] * v * k]) };
      };
      if (e.max && (!mx || e.max.v > mx.v)) mx = { v: e.max.v, ...en(e.max.s, e.max.v) };
      if (e.min && (!mn || e.min.v < mn.v)) mn = { v: e.min.v, ...en(e.min.s, e.min.v) };
    }
    for (const [que, x, color] of [
      ["máximo", mx, "#b91c1c"],
      ["mínimo", mn, "#1d4ed8"],
    ] as const) {
      const e = x as { v: number; p: Vec2; pie: Vec2 } | null;
      if (!e || e.v === 0 || (que === "máximo" && e.v < 0) || (que === "mínimo" && e.v > 0)) continue;
      // Por fuera de la punta: hacia donde va la ordenada
      const [ox, oy] = [e.p[0] - e.pie[0], e.p[1] - e.pie[1]];
      const vertical = Math.abs(oy) >= Math.abs(ox);
      P.push({
        tipo: "texto",
        p: e.p,
        texto: rotulo(e.v),
        tamano: 11,
        color,
        fondo: true,
        ancla: vertical ? "medio" : ox > 0 ? "inicio" : "fin",
        dx: vertical ? 0 : ox > 0 ? 3 : -3,
        dy: vertical ? (oy > 0 ? -3 : 12) : 4,
        prioridad: (Math.abs(e.v) / (maxAbs || 1)) * 50 + 10,
        objeto: id,
      });
      extremos.push({ que: `${esfuerzo} ${que} de la pieza`, valor: e.v, unidad, objeto: id, punto: e.pie });
    }
  }

  const leyenda: EntradaLeyenda[] = [
    ...(hayPos || !vistos.length ? [{ estilo: "diagrama-positivo" as const, texto: esfuerzo === "M" ? "M > 0, del lado de las tracciones (el momento de vano de las vigas)" : `${esfuerzo} > 0, hacia arriba (hacia u creciente en los pilares)` }] : []),
    ...(hayNeg ? [{ estilo: "diagrama-negativo" as const, texto: esfuerzo === "M" ? "M < 0, del lado de las tracciones" : `${esfuerzo} < 0` }] : []),
    ...base.leyenda,
  ];
  const ordenados = [...extremos].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  const notas = [
    `${NOMBRE[esfuerzo]}. ${conjunto.factores.length > 1 ? `Envolvente de ${conjunto.descripcion} (${conjunto.factores.length} combinaciones): rellena por fuera y con las dos curvas.` : `Combinación ${conjunto.etiquetas[0] ?? conjunto.nombres[0] ?? ""}.`}`,
    esfuerzo === "M" ? "M es el momento de eje normal al plano: en las vigas del plano, su My; en los pilares, su My o su Mz según su giro." : esfuerzo === "V" ? "V es el cortante en el plano, normal a la barra: en las vigas del plano, su Vz." : "Con el convenio de las barras (cabecera del motor).",
    `Escala: ${rotulo(maxAbs)} ${unidad} = ${rotulo(m)} m. Se dibujan las barras con sus dos extremos a menos de ${rotulo(prof)} m del plano y paralelas a él (${vistos.length} tramos).`,
    ...(sinAxil.size ? [`${sinAxil.size} vigas en el plano de un diafragma rígido, sin N: su axil no tiene valor (C1-d).`] : []),
    ...(ordenados.length ? [`Mayor |${esfuerzo}|: ${rotulo(ordenados[0]!.valor)} ${unidad} en ${ordenados[0]!.objeto}.`] : [vistos.length ? `Las barras del plano no tienen ${esfuerzo} en él.` : "No hay barras en el plano."]),
    ...base.notas,
  ];
  return {
    ...base,
    cabecera: [base.cabecera[0]!, `${NOMBRE[esfuerzo]}; ${conjunto.factores.length > 1 ? `envolvente de ${conjunto.descripcion}` : `combinación ${conjunto.etiquetas[0] ?? conjunto.nombres[0]}`}`, ...base.cabecera.slice(1)],
    primitivas: P,
    leyenda,
    notas,
    extremos: ordenados,
    caja: nuevos.length ? cajaDe([...nuevos, [base.caja[0], base.caja[1]], [base.caja[2], base.caja[3]]]) : base.caja,
  };
}
