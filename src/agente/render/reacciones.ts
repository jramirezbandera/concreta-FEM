/**
 * Las reacciones en planta y en alzado (I4, `docs/fem3d/interfaz.md` §15, añadido tras I4), de `fem consultar
 * reacciones`, como las flechas del 3D (`src/visor/reacciones3d.ts`), con las que comparten la
 * elección de la combinación de cada objeto (`reaccionesObjetos`).
 *
 * - Cada objeto con reacciones (pilar o muro con base, apoyo o apoyo lineal) es de una planta: la de
 *   su base (`desde`) o la suya (`planta`). Su resultante va en el centro de sus nudos coartados.
 * - Con varias combinaciones, la de mayor |Fz| de cada objeto (la primera, si empatan); con una, esa.
 * - Planta (`reacciones`): Fz rotulada y un círculo con aspa si va hacia arriba (con punto, hacia
 *   abajo), como las cargas puntuales; (Fx, Fy), una flecha a escala con la punta en el objeto, en el
 *   sentido de la fuerza que el apoyo hace sobre la estructura. La escala de las horizontales es la
 *   de la planta (la mayor |(Fx, Fy)| ocupa ORDENADA_DIAGRAMA m por la pedida): al lado de Fz no se
 *   verían.
 * - Alzado: los objetos a menos de la profundidad del plano, con la vertical (Fz) y la horizontal en
 *   el plano (la componente según el alzado), con la misma escala, como en el 3D; la componente
 *   normal al plano y los momentos, en `extremos` y en la tabla.
 *
 * Puro: sin IO.
 */
import type { ModeloFisico } from "../../compilador/fisico.ts";
import type { Diagnostico } from "../../motor/diagnosticos.ts";
import type { ConjuntoCombinaciones } from "../combinaciones.ts";
import { reacciones } from "../consultas.ts";
import { PROFUNDIDAD_ALZADO, vistaAlzado, type PlanoAlzado } from "./alzado.ts";
import { ORDENADA_DIAGRAMA } from "./diagramas.ts";
import { cajaDe, rotulo, type EntradaLeyenda, type Escena, type Estilo, type ExtremoRotulado, type Primitiva, type Vec2 } from "./escena.ts";
import { cabeceraPlanta, cajaPlanta, fondoModelo, PlantaFisica, porId, type DatosVista } from "./modelo.ts";
import type { ResultadosRender } from "./resultados.ts";

type V3 = [number, number, number];

/** Los colores de las flechas (los mismos en los dos temas: se leen sobre el claro y el oscuro). */
export const COLOR_REACCION = { vertical: "#0d9488", horizontal: "#d97706" } as const;
/** El de los rótulos de Fz: el de la vertical, más oscuro para que se lea sobre el blanco. */
const COLOR_FZ = "#0f766e";
const COLOR_H = "#b45309";

export interface ReaccionObjeto {
  id: string;
  tipo: "pilar" | "muro" | "apoyo" | "apoyo lineal";
  /** La planta del objeto: la de su base (pilares y muros) o la suya (apoyos). */
  planta: string;
  /** El centro de sus nudos coartados (m, globales). */
  punto: V3;
  /** [Fx, Fy, Fz] (kN) y [Mx, My, Mz] (kN·m) respecto a `punto`, en la combinación dibujada. */
  R: number[];
  comb: string;
}

export interface ReaccionesObjetos {
  objetos: ReaccionObjeto[];
  /** Totales de la consulta por combinación (la suma de todas las reacciones respecto al origen). */
  totales: { comb: string; F: number[]; M: number[] }[];
  diagnosticos: Diagnostico[];
}

/** Las reacciones de la consulta por objeto, cada uno en la combinación de su mayor |Fz|, en el orden de la consulta. */
export function reaccionesObjetos(r: ResultadosRender, conjunto: ConjuntoCombinaciones): { valido: true; valor: ReaccionesObjetos } | { valido: false; diagnosticos: Diagnostico[] } {
  const q = reacciones(r.q, conjunto, { todos: true });
  if (!q.valido) return q;
  const f = r.q.fisico;
  const datos = new Map<string, { tipo: ReaccionObjeto["tipo"]; planta: string }>();
  for (const x of f.pilares ?? []) datos.set(x.id, { tipo: "pilar", planta: x.desde });
  for (const x of f.muros ?? []) datos.set(x.id, { tipo: "muro", planta: x.desde });
  for (const x of f.apoyos ?? []) datos.set(x.id, { tipo: "apoyo", planta: x.planta });
  for (const x of f.apoyosLineales ?? []) datos.set(x.id, { tipo: "apoyo lineal", planta: x.planta });
  const objetos: ReaccionObjeto[] = q.valor.objetos.map((o) => {
    let k = 0;
    o.R.forEach((v, j) => {
      if (Math.abs(v[2]!) > Math.abs(o.R[k]![2]!)) k = j;
    });
    const d = datos.get(o.id) ?? { tipo: "apoyo" as const, planta: "" };
    return { id: o.id, tipo: d.tipo, planta: d.planta, punto: [o.punto[0]!, o.punto[1]!, o.punto[2]!], R: o.R[k]!, comb: conjunto.nombres[k]! };
  });
  return { valido: true, valor: { objetos, totales: q.valor.totales, diagnosticos: q.diagnosticos } };
}

/** La nota de qué combinación es cada objeto. */
export function notaCombinaciones(conjunto: ConjuntoCombinaciones): string {
  return conjunto.factores.length > 1 ? `De las ${conjunto.factores.length} combinaciones de ${conjunto.descripcion}, la de mayor |Fz| de cada objeto.` : `Combinación ${conjunto.etiquetas[0] ?? conjunto.nombres[0] ?? ""}.`;
}

const queCombinaciones = (conjunto: ConjuntoCombinaciones) => (conjunto.factores.length > 1 ? `envolvente de ${conjunto.descripcion} (la de mayor |Fz| de cada objeto)` : `combinación ${conjunto.etiquetas[0] ?? conjunto.nombres[0] ?? ""}`);

/** Una flecha plana de F (en m del dibujo) con la punta en P: el fuste y la punta, en dos líneas. */
export function flecha2D(P: Vec2, F: Vec2, m: number, estilo: Estilo, objeto: string): Primitiva[] {
  const L = Math.hypot(F[0], F[1]);
  if (!(L > 0)) return [];
  const d: Vec2 = [F[0] / L, F[1] / L];
  const n: Vec2 = [-d[1], d[0]];
  const h = Math.min(0.3 * L, 0.18 * m);
  const w = 0.4 * h;
  const base: Vec2 = [P[0] - h * d[0], P[1] - h * d[1]];
  return [
    { tipo: "linea", puntos: [[P[0] - F[0], P[1] - F[1]], P], estilo, objeto },
    { tipo: "linea", puntos: [[base[0] + w * n[0], base[1] + w * n[1]], P, [base[0] - w * n[0], base[1] - w * n[1]]], estilo, objeto },
  ];
}

/** Las plantas con reacciones y cuántos objetos tiene cada una, en el orden del modelo. */
function plantasConReacciones(f: ModeloFisico, objetos: readonly ReaccionObjeto[]): string {
  const n = new Map<string, number>();
  for (const o of objetos) n.set(o.planta, (n.get(o.planta) ?? 0) + 1);
  return f.plantas
    .filter((p) => n.has(p.id))
    .map((p) => `${p.id} (${n.get(p.id)})`)
    .join(", ");
}

// ─── Planta ─────────────────────────────────────────────────────────────────────────────────────

export function vistaReacciones(r: ResultadosRender, planta: string, conjunto: ConjuntoCombinaciones, d: DatosVista, escala = 1): Escena {
  const f = r.q.fisico;
  const pl = new PlantaFisica(f, planta);
  const fondo = fondoModelo(pl, { atenuado: false });
  const todos = reaccionesObjetos(r, conjunto);
  const objetos = todos.valido ? todos.valor.objetos : [];
  const aqui = porId(objetos.filter((o) => o.planta === planta));

  let maxH = 0;
  let maxV = 0;
  for (const o of aqui) {
    maxH = Math.max(maxH, Math.hypot(o.R[0]!, o.R[1]!));
    maxV = Math.max(maxV, Math.abs(o.R[2]!));
  }
  const m = ORDENADA_DIAGRAMA * escala;
  const k = maxH > 0 ? m / maxH : 0;

  const P: Primitiva[] = [...fondo.primitivas];
  const nuevos: Vec2[] = [];
  const extremos: ExtremoRotulado[] = [];
  let [hayV, hayH] = [false, false];
  for (const o of aqui) {
    const p: Vec2 = [o.punto[0], o.punto[1]];
    const [Fx, Fy, Fz] = [o.R[0]!, o.R[1]!, o.R[2]!];
    const H = Math.hypot(Fx, Fy);
    if (Fz !== 0) {
      hayV = true;
      P.push({ tipo: "flecha", p, d: null, abajo: Fz < 0, estilo: "reaccion-vertical", objeto: o.id });
    }
    // La horizontal, con la punta en el objeto: la cola va hacia donde no empuja
    const F: Vec2 = [Fx * k, Fy * k];
    const flecha = flecha2D(p, F, m, "reaccion-horizontal", o.id);
    if (flecha.length) {
      hayH = true;
      P.push(...flecha);
      nuevos.push([p[0] - F[0], p[1] - F[1]]);
    }
    P.push({
      tipo: "texto",
      p,
      texto: rotulo(Fz),
      tamano: 12,
      negrita: true,
      color: COLOR_FZ,
      fondo: true,
      dx: 10,
      dy: -8,
      prioridad: 30 + (maxV > 0 ? (40 * Math.abs(Fz)) / maxV : 0),
      alternativas: [
        { dx: -10, dy: -8, ancla: "fin" },
        { dx: 10, dy: 18 },
        { dx: -10, dy: 18, ancla: "fin" },
      ],
      clase: "dato",
      objeto: o.id,
    });
    if (H > 0) {
      const cola: Vec2 = [p[0] - F[0], p[1] - F[1]];
      const izquierda = F[0] > 0;
      P.push({ tipo: "texto", p: cola, texto: rotulo(H), tamano: 11, color: COLOR_H, fondo: true, ancla: izquierda ? "fin" : "inicio", dx: izquierda ? -3 : 3, dy: 4, prioridad: 10 + (maxH > 0 ? (20 * H) / maxH : 0), clase: "dato", objeto: o.id });
    }
    extremos.push({ que: "Fz", valor: Fz, unidad: "kN", objeto: o.id, punto: p, comb: o.comb });
    extremos.push({ que: "|(Fx, Fy)|", valor: H, unidad: "kN", objeto: o.id, punto: p, comb: o.comb });
  }

  const leyenda: EntradaLeyenda[] = [
    ...(hayV || !aqui.length ? [{ estilo: "reaccion-vertical" as const, texto: "Fz (kN), la reacción vertical: positiva hacia arriba (círculo con aspa); con punto, hacia abajo" }] : []),
    ...(hayH ? [{ estilo: "reaccion-horizontal" as const, texto: "(Fx, Fy) (kN), la reacción horizontal: la punta en el objeto, a escala; rotulado, su módulo" }] : []),
    ...fondo.leyenda,
  ];
  const ordenados = extremos.filter((x) => x.que === "Fz").sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  const notas = [
    notaCombinaciones(conjunto),
    "Cada objeto, la resultante de la consulta «reacciones» en el centro de sus nudos coartados, en el sentido de la fuerza que el apoyo hace sobre la estructura.",
    ...(hayH ? [`Escala de las horizontales: ${rotulo(maxH)} kN = ${rotulo(m)} m.`] : []),
    "Mx, My y Mz (los empotramientos), en la tabla.",
    ...(aqui.length ? [`Mayor Fz: ${rotulo(ordenados[0]!.valor)} kN en ${ordenados[0]!.objeto}.`] : objetos.length ? [`En esta planta no hay apoyos. Las reacciones están en ${plantasConReacciones(f, objetos)}.`] : ["No hay objetos con reacciones."]),
    ...(todos.valido ? todos.valor.diagnosticos.map((x) => x.mensaje) : todos.diagnosticos.map((x) => x.mensaje)),
    ...fondo.notas,
  ];
  const c = cajaPlanta(fondo.primitivas);
  return {
    titulo: d.nombre ?? "Proyecto",
    cabecera: [cabeceraPlanta(pl), `Vista: reacciones (kN), ${queCombinaciones(conjunto)}`, `Huella ${d.huella.slice(0, 12)}`],
    primitivas: P,
    leyenda,
    notas,
    extremos: [...ordenados, ...extremos.filter((x) => x.que !== "Fz").sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor))],
    caja: nuevos.length ? cajaDe([...nuevos, [c[0], c[1]], [c[2], c[3]]]) : c,
  };
}

// ─── Alzado ─────────────────────────────────────────────────────────────────────────────────────

export function vistaAlzadoReacciones(r: ResultadosRender, plano: PlanoAlzado, conjunto: ConjuntoCombinaciones, d: DatosVista, escala = 1): Escena {
  const f = r.q.fisico;
  const prof = plano.profundidad ?? PROFUNDIDAD_ALZADO;
  const L = Math.hypot(plano.hasta[0] - plano.desde[0], plano.hasta[1] - plano.desde[1]);
  const dir: Vec2 = L > 0 ? [(plano.hasta[0] - plano.desde[0]) / L, (plano.hasta[1] - plano.desde[1]) / L] : [1, 0];
  const nor: Vec2 = [-dir[1], dir[0]];
  const u = (q: readonly number[]) => (q[0]! - plano.desde[0]) * dir[0] + (q[1]! - plano.desde[1]) * dir[1];
  const w = (q: readonly number[]) => (q[0]! - plano.desde[0]) * nor[0] + (q[1]! - plano.desde[1]) * nor[1];
  const todos = reaccionesObjetos(r, conjunto);
  const objetos = todos.valido ? todos.valor.objetos : [];
  const vistos = porId(objetos.filter((o) => Math.abs(w(o.punto)) <= prof));

  /** La componente en el plano (según el alzado), la normal y el momento en el plano (de eje normal). */
  const enPlano = (o: ReaccionObjeto) => ({ Fu: o.R[0]! * dir[0] + o.R[1]! * dir[1], Fn: o.R[0]! * nor[0] + o.R[1]! * nor[1], M: o.R[3]! * nor[0] + o.R[4]! * nor[1] });
  let max = 0;
  for (const o of vistos) max = Math.max(max, Math.abs(o.R[2]!), Math.abs(enPlano(o).Fu));
  const m = ORDENADA_DIAGRAMA * escala;
  const k = max > 0 ? m / max : 0;
  // Las verticales que empujan hacia arriba cuelgan bajo su objeto: las burbujas de los ejes, más abajo
  const base = vistaAlzado(f, plano, d, { abajo: vistos.some((o) => o.R[2]! > 0) ? m + 1 : 0 });

  const P: Primitiva[] = [...base.primitivas];
  const nuevos: Vec2[] = [];
  const extremos: ExtremoRotulado[] = [];
  let [hayV, hayH] = [false, false];
  for (const o of vistos) {
    const p: Vec2 = [u(o.punto), o.punto[2]];
    const Fz = o.R[2]!;
    const { Fu, Fn, M } = enPlano(o);
    const V: Vec2 = [0, Fz * k];
    const H: Vec2 = [Fu * k, 0];
    const fv = flecha2D(p, V, m, "reaccion-vertical", o.id);
    const fh = flecha2D(p, H, m, "reaccion-horizontal", o.id);
    if (fv.length) {
      hayV = true;
      P.push(...fv);
      nuevos.push([p[0], p[1] - V[1]]);
    }
    if (fh.length) {
      hayH = true;
      P.push(...fh);
      nuevos.push([p[0] - H[0], p[1]]);
    }
    // Fz, en la cola de la vertical (debajo si empuja hacia arriba)
    const colaV: Vec2 = [p[0], p[1] - V[1]];
    P.push({ tipo: "texto", p: colaV, texto: rotulo(Fz), tamano: 12, negrita: true, color: COLOR_FZ, fondo: true, ancla: "medio", dy: Fz >= 0 ? 14 : -5, prioridad: 30 + (max > 0 ? (40 * Math.abs(Fz)) / max : 0), clase: "dato", objeto: o.id });
    if (Fu !== 0) {
      const colaH: Vec2 = [p[0] - H[0], p[1]];
      const izquierda = H[0] > 0;
      P.push({ tipo: "texto", p: colaH, texto: rotulo(Fu), tamano: 11, color: COLOR_H, fondo: true, ancla: izquierda ? "fin" : "inicio", dx: izquierda ? -3 : 3, dy: -4, prioridad: 10 + (max > 0 ? (20 * Math.abs(Fu)) / max : 0), clase: "dato", objeto: o.id });
    }
    const pp: Vec2 = [o.punto[0], o.punto[1]];
    extremos.push({ que: "Fz", valor: Fz, unidad: "kN", objeto: o.id, punto: pp, comb: o.comb });
    extremos.push({ que: "F en el plano", valor: Fu, unidad: "kN", objeto: o.id, punto: pp, comb: o.comb });
    extremos.push({ que: "F normal al plano", valor: Fn, unidad: "kN", objeto: o.id, punto: pp, comb: o.comb });
    extremos.push({ que: "M en el plano", valor: M, unidad: "kN·m", objeto: o.id, punto: pp, comb: o.comb });
  }

  const leyenda: EntradaLeyenda[] = [
    ...(hayV || !vistos.length ? [{ estilo: "reaccion-vertical" as const, texto: "Fz (kN), la reacción vertical: positiva hacia arriba" }] : []),
    ...(hayH ? [{ estilo: "reaccion-horizontal" as const, texto: "La reacción horizontal en el plano del alzado (kN), positiva hacia u creciente" }] : []),
    ...base.leyenda,
  ];
  const fz = extremos.filter((x) => x.que === "Fz").sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  const notas = [
    notaCombinaciones(conjunto),
    `Escala: ${rotulo(max)} kN = ${rotulo(m)} m. Cada flecha, con la punta en el centro de los nudos coartados de su objeto, en el sentido de la fuerza que el apoyo hace sobre la estructura; los objetos a menos de ${rotulo(prof)} m del plano (${vistos.length}).`,
    "La componente normal al plano y los momentos, en la tabla.",
    ...(fz.length ? [`Mayor Fz: ${rotulo(fz[0]!.valor)} kN en ${fz[0]!.objeto}.`] : ["No hay objetos con reacciones en el plano."]),
    ...(todos.valido ? todos.valor.diagnosticos.map((x) => x.mensaje) : todos.diagnosticos.map((x) => x.mensaje)),
    ...base.notas,
  ];
  return {
    ...base,
    cabecera: [base.cabecera[0]!, `Reacciones (kN), ${queCombinaciones(conjunto)}`, ...base.cabecera.slice(1)],
    primitivas: P,
    leyenda,
    notas,
    extremos: [...fz, ...extremos.filter((x) => x.que !== "Fz")],
    caja: nuevos.length ? cajaDe([...nuevos, [base.caja[0], base.caja[1]], [base.caja[2], base.caja[3]]]) : base.caja,
  };
}
