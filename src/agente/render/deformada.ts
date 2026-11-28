/**
 * VC2 (`docs/fem3d/coherencia-vistas.md`): la deformada en planta y en alzado, como la del 3D
 * (`app/src/vistas/vista3d.ts`): el modelo analítico con sus nudos desplazados u·escala, cada barra
 * de nudo a nudo (sin su curvatura ni el giro de sus zonas rígidas), sobre el modelo sin deformar en
 * gris.
 *
 * - Alzado: las barras y los muros del plano (a menos de su profundidad), proyectados en él (u, z), y el
 *   corte deformado de las losas que lo cruzan (la flecha a lo largo del eje).
 *   Con los desplazamientos de una combinación (`factores`), cada pilar del plano rotula en cada
 *   planta su desplazamiento en el plano (δ, mm) y en cada tramo su desplome relativo d/h, el de la
 *   consulta `desplomes` (el de la tabla: con las dos componentes, no sólo la del plano). Lo que se
 *   mueve normal al plano no se ve: lo dice una nota.
 * - Planta: las barras de la planta (vigas, viguetas) y el borde de sus losas, en (x, y); cada pilar
 *   que llega, su cabeza desplazada con su desplome relativo d/h, y el maestro del diafragma.
 * - La forma de un modo (Modal) se dibuja igual, sin rótulos: no tiene unidades.
 *
 * Los números rotulados salen de las consultas: los desplazamientos en doble precisión de los casos
 * con los factores de la combinación, y los desplomes de `Consultas.desplomes`. Con el sismo del
 * programa no hay deformada de la combinación (VS-o): lo decide quien llama (`desplazamientos`).
 *
 * Puro: sin IO.
 */
import { PROFUNDIDAD_ALZADO, SENO_PARALELO, vistaAlzado, type ModoAlzado, type PlanoAlzado } from "./alzado.ts";
import { cajaDe, rotulo, type EntradaLeyenda, type Escena, type ExtremoRotulado, type Primitiva, type Vec2 } from "./escena.ts";
import { cabeceraPlanta, cajaPlanta, fondoModelo, PlantaFisica, porId, type DatosVista } from "./modelo.ts";
import type { ResultadosRender } from "./resultados.ts";

/** Lo que se dibuja deformado. */
export interface DeformadaDibujo {
  /** ux, uy, uz de cada nudo del modelo analítico (m o, en un modo, adimensional). */
  u: ArrayLike<number>;
  escala: number;
  /** Qué es: la combinación (su etiqueta) o el modo. */
  etiqueta: string;
  /** Los factores de la combinación (sin el sismo del programa): con ellos, δ y d/h rotulados. Sin ellos (un modo), la forma sola. */
  factores?: ArrayLike<number>;
  /** El nombre corto de la combinación, para los extremos. */
  comb?: string;
}

/** «1/850»: un desplome relativo como fracción de la altura. */
export function fraccionAltura(rel: number): string {
  return rel > 1e-9 ? `1/${Math.round(1 / rel)}` : "0";
}

/** u del nudo n en la componente c, en doble precisión, con los factores (sin espectrales). */
function desplazamiento(r: ResultadosRender, factores: ArrayLike<number>): (n: number, c: number) => number {
  const fl = r.q.sup.partes(factores).lineal;
  const casos = r.q.casos;
  return (n, c) => {
    let v = 0;
    for (let j = 0; j < fl.length; j++) if (fl[j]) v += fl[j]! * casos[j]!.u[6 * n + c]!;
    return v;
  };
}

/** Los desplomes relativos de los pilares entre la planta y la de debajo (la consulta), por pilar; vacío en la más baja. */
function desplomesPlanta(r: ResultadosRender, planta: string, factores: ArrayLike<number>): Map<string, number> {
  const d = r.q.desplomes(planta, factores);
  return new Map(d.valido ? d.valor.pilares.map((p) => [p.pilar, p.relativo]) : []);
}

const ESCALA = (def: DeformadaDibujo) => `Escala de la deformada: ×${rotulo(def.escala)}.`;
const LEYENDA_BASE: EntradaLeyenda[] = [
  { estilo: "deformada", texto: "Deformada: los nudos del modelo analítico desplazados por la escala, cada barra de nudo a nudo" },
  { estilo: "atenuado-linea", texto: "Sin deformar" },
];

// ─── Alzado ─────────────────────────────────────────────────────────────────────────────────────

export function vistaAlzadoDeformada(r: ResultadosRender, plano: PlanoAlzado, def: DeformadaDibujo, d: DatosVista, modo: ModoAlzado = "analitico"): Escena {
  const { modelo: ma, mapeo } = r.q;
  const f = r.q.fisico;
  const prof = plano.profundidad ?? PROFUNDIDAD_ALZADO;
  const L = Math.hypot(plano.hasta[0] - plano.desde[0], plano.hasta[1] - plano.desde[1]);
  const dir: Vec2 = L > 0 ? [(plano.hasta[0] - plano.desde[0]) / L, (plano.hasta[1] - plano.desde[1]) / L] : [1, 0];
  const nor: Vec2 = [-dir[1], dir[0]];
  const uu = (x: number, y: number) => (x - plano.desde[0]) * dir[0] + (y - plano.desde[1]) * dir[1];
  const ww = (x: number, y: number) => (x - plano.desde[0]) * nor[0] + (y - plano.desde[1]) * nor[1];
  const N = ma.nudos;
  const enBanda = (n: number) => Math.abs(ww(N[n]!.x, N[n]!.y)) <= prof;
  const s = def.escala;
  const U = def.u;
  /** El nudo desplazado, en (u, z). */
  const movido = (n: number): Vec2 => {
    const q = N[n]!;
    return [uu(q.x + s * U[3 * n]!, q.y + s * U[3 * n + 1]!), q.z + s * U[3 * n + 2]!];
  };
  const quieto = (n: number): Vec2 => [uu(N[n]!.x, N[n]!.y), N[n]!.z];

  // El modelo sin deformar, en gris (con su modo: por defecto, el analítico)
  const base = vistaAlzado(f, plano, d, { modo, analitico: { modelo: ma, mapeo }, atenuado: true });
  const P: Primitiva[] = [...base.primitivas];
  const nuevos: Vec2[] = [];

  for (let i = 0; i < (ma.barras?.length ?? 0); i++) {
    const [a, c] = ma.barras![i]!.nudos;
    if (!enBanda(a) || !enBanda(c)) continue;
    const [qa, qc] = [quieto(a), quieto(c)];
    // Perpendicular al plano: sólo un punto
    if (Math.hypot(qc[0] - qa[0], qc[1] - qa[1]) <= 1e-6) continue;
    const mb = mapeo.barras[i]!;
    const [pa, pc] = [movido(a), movido(c)];
    P.push({ tipo: "linea", puntos: [pa, pc], estilo: "deformada", objeto: mb.pano ?? mb.pieza });
    nuevos.push(pa, pc);
  }
  // Los muros del plano: cada lámina paralela, deformada; las losas que lo cruzan, su corte deformado
  // (el punto de cada lado en w = 0, con el desplazamiento interpolado entre sus dos nudos)
  for (let i = 0; i < (ma.laminas?.length ?? 0); i++) {
    const l = ma.laminas![i]!;
    const P3 = l.nudos.map((n) => N[n]!);
    const ws = P3.map((q) => ww(q.x, q.y));
    if (Math.min(...ws) > prof || Math.max(...ws) < -prof) continue;
    if (!l.nudos.every(enBanda)) {
      const cs: { q: Vec2; d: Vec2 }[] = [];
      for (let k = 0; k < l.nudos.length; k++) {
        const k2 = (k + 1) % l.nudos.length;
        const [wa, wb] = [ws[k]!, ws[k2]!];
        if (!(wa > 0 !== wb > 0) || wa === wb) continue;
        const t = wa / (wa - wb);
        const [qa, qb] = [quieto(l.nudos[k]!), quieto(l.nudos[k2]!)];
        const [ma_, mb_] = [movido(l.nudos[k]!), movido(l.nudos[k2]!)];
        cs.push({ q: [qa[0] + t * (qb[0] - qa[0]), qa[1] + t * (qb[1] - qa[1])], d: [ma_[0] + t * (mb_[0] - ma_[0]), ma_[1] + t * (mb_[1] - ma_[1])] });
      }
      if (cs.length < 2) continue;
      cs.sort((x, y) => x.q[0] - y.q[0] || x.q[1] - y.q[1]);
      const [c0, c1] = [cs[0]!, cs[cs.length - 1]!];
      if (Math.hypot(c1.q[0] - c0.q[0], c1.q[1] - c0.q[1]) <= 1e-9) continue;
      const id = mapeo.laminas?.[i]?.losa;
      P.push({ tipo: "linea", puntos: [c0.d, c1.d], estilo: "deformada-lamina", ...(id ? { objeto: id } : {}) });
      nuevos.push(c0.d, c1.d);
      continue;
    }
    const [d1, d2] = [
      [P3[2]!.x - P3[0]!.x, P3[2]!.y - P3[0]!.y, P3[2]!.z - P3[0]!.z],
      [P3[3]!.x - P3[1]!.x, P3[3]!.y - P3[1]!.y, P3[3]!.z - P3[1]!.z],
    ] as const;
    const nn = [d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]];
    const nl = Math.hypot(nn[0]!, nn[1]!, nn[2]!) || 1;
    if (Math.abs((nn[0]! * nor[0] + nn[1]! * nor[1]) / nl) < Math.cos(Math.asin(SENO_PARALELO))) continue;
    const q = l.nudos.map(movido);
    const id = mapeo.laminas?.[i]?.muro;
    P.push({ tipo: "linea", puntos: [...q, q[0]!], estilo: "deformada-lamina", ...(id ? { objeto: id } : {}) });
  }

  // δ en cada planta y d/h en cada tramo de los pilares del plano
  const extremos: ExtremoRotulado[] = [];
  const notas: string[] = [];
  if (def.factores) {
    const ud = desplazamiento(r, def.factores);
    const plantas = f.plantas.map((p) => p.id);
    const desplomes = new Map(plantas.map((p) => [p, desplomesPlanta(r, p, def.factores!)]));
    // En un apoyo no se rotula δ (el arranque empotrado: 0)
    const apoyados = new Set((ma.apoyos ?? []).filter((a) => a.coartados[0] && a.coartados[1]).map((a) => a.nudo));
    for (const p of porId(f.pilares ?? [])) {
      // Los nudos del pilar en cada planta del plano, de arriba abajo
      const enPlantas = plantas.map((pl) => ({ pl, n: mapeo.nudosPilar[`${p.id}@${pl}`] })).filter((x): x is { pl: string; n: number } => x.n !== undefined && enBanda(x.n));
      enPlantas.forEach(({ pl, n }, k) => {
        const du = ud(n, 0) * dir[0] + ud(n, 1) * dir[1];
        const m = movido(n);
        P.push({ tipo: "marca", p: m, forma: "circulo", radio: 3, estilo: "deformada-nudo", objeto: p.id });
        if (!apoyados.has(n)) {
          P.push({ tipo: "texto", p: m, texto: `${rotulo(1000 * du)}`, tamano: 11, fondo: true, dx: 6, dy: -6, ancla: "inicio", alternativas: [{ dx: -6, dy: -6, ancla: "fin" }], prioridad: 40, clase: "dato", objeto: p.id });
          extremos.push({ que: "δ en el plano", valor: 1000 * du, unidad: "mm", objeto: `${p.id} · ${pl}`, punto: [N[n]!.x, N[n]!.y], ...(def.comb ? { comb: def.comb } : {}) });
        }
        const abajo = enPlantas[k + 1];
        const rel = desplomes.get(pl)?.get(p.id);
        if (abajo && rel !== undefined) {
          const mb = movido(abajo.n);
          const c: Vec2 = [(m[0] + mb[0]) / 2, (m[1] + mb[1]) / 2];
          P.push({ tipo: "texto", p: c, texto: fraccionAltura(rel), tamano: 11, fondo: true, dx: 6, ancla: "inicio", alternativas: [{ dx: -6, ancla: "fin" }], prioridad: 30, clase: "dato", objeto: p.id });
          extremos.push({ que: "d/h", valor: rel, unidad: "", objeto: `${p.id} · ${pl}`, punto: [N[n]!.x, N[n]!.y], ...(def.comb ? { comb: def.comb } : {}) });
        }
      });
    }
    extremos.sort((a, b) => (a.que === b.que ? Math.abs(b.valor) - Math.abs(a.valor) : a.que < b.que ? 1 : -1));
    notas.push("En cada pilar del plano: δ, su desplazamiento en el plano del alzado en cada planta (mm, positivo según el alzado), y d/h, el desplome relativo de cada tramo (con las dos componentes, el de la tabla).");
  } else notas.push("La forma del modo: sin unidades, normalizada; los rótulos no tienen sentido.");
  notas.push(ESCALA(def), "Lo que se mueve normal al plano del alzado no se ve aquí: en el 3D.", ...base.notas);

  const c = base.caja;
  return {
    ...base,
    cabecera: [...base.cabecera, `Deformada: ${def.etiqueta}`],
    primitivas: P,
    leyenda: [...LEYENDA_BASE, ...(def.factores ? [{ estilo: "deformada-nudo" as const, texto: "Nudo de un pilar en una planta: δ (mm) y, en cada tramo, d/h" }] : []), ...base.leyenda.filter((x) => x.estilo !== "atenuado-linea")],
    notas,
    extremos,
    caja: nuevos.length ? cajaDe([...nuevos, [c[0], c[1]], [c[2], c[3]]]) : c,
  };
}

// ─── Planta ─────────────────────────────────────────────────────────────────────────────────────

export function vistaPlantaDeformada(r: ResultadosRender, planta: string, def: DeformadaDibujo, d: DatosVista): Escena {
  const { modelo: ma, mapeo } = r.q;
  const f = r.q.fisico;
  const pl = new PlantaFisica(f, planta);
  const fondo = fondoModelo(pl, { atenuado: true });
  const N = ma.nudos;
  const s = def.escala;
  const U = def.u;
  const movido = (n: number): Vec2 => [N[n]!.x + s * U[3 * n]!, N[n]!.y + s * U[3 * n + 1]!];
  const dePlanta = (n: number) => mapeo.nudos[n]?.planta === planta;
  const P: Primitiva[] = [...fondo.primitivas];
  const nuevos: Vec2[] = [];

  // Las barras de la planta (vigas, viguetas…): las de los pilares llegan a ella desde otra
  for (let i = 0; i < (ma.barras?.length ?? 0); i++) {
    const mb = mapeo.barras[i]!;
    const [a, c] = ma.barras![i]!.nudos;
    if (mb.tipo === "pilar" || !dePlanta(a) || !dePlanta(c)) continue;
    const [pa, pc] = [movido(a), movido(c)];
    P.push({ tipo: "linea", puntos: [pa, pc], estilo: "deformada", objeto: mb.pano ?? mb.pieza });
    nuevos.push(pa, pc);
  }
  // El borde de cada losa de la planta: los lados de sus láminas que son de una sola
  const losas = (f.losas ?? []).filter((l) => l.planta === planta);
  for (const l of porId(losas)) {
    const ids = mapeo.losas?.[l.id] ?? [];
    const lados = new Map<string, [number, number, number]>();
    for (const i of ids) {
      const nn = ma.laminas![i]!.nudos;
      for (let k = 0; k < nn.length; k++) {
        const [a, b] = [nn[k]!, nn[(k + 1) % nn.length]!];
        const clave = a < b ? `${a},${b}` : `${b},${a}`;
        const ya = lados.get(clave);
        lados.set(clave, [a, b, (ya?.[2] ?? 0) + 1]);
      }
    }
    for (const [a, b, veces] of lados.values()) if (veces === 1) P.push({ tipo: "linea", puntos: [movido(a), movido(b)], estilo: "deformada-lamina", objeto: l.id });
  }

  const extremos: ExtremoRotulado[] = [];
  const notas: string[] = [];
  const pilares = porId((f.pilares ?? []).filter((p) => mapeo.nudosPilar[`${p.id}@${planta}`] !== undefined));
  const desplomes = def.factores ? desplomesPlanta(r, planta, def.factores) : new Map<string, number>();
  for (const p of pilares) {
    const n = mapeo.nudosPilar[`${p.id}@${planta}`]!;
    const m = movido(n);
    P.push({ tipo: "marca", p: m, forma: "circulo", radio: 3, estilo: "deformada-nudo", objeto: p.id });
    nuevos.push(m);
    const rel = desplomes.get(p.id);
    if (rel !== undefined) {
      P.push({ tipo: "texto", p: m, texto: fraccionAltura(rel), tamano: 11, fondo: true, dx: 6, dy: -6, ancla: "inicio", alternativas: [{ dx: -6, dy: -6, ancla: "fin" }, { dx: 6, dy: 14, ancla: "inicio" }], prioridad: 30 + Math.min(40, 40000 * rel), clase: "dato", objeto: p.id });
      extremos.push({ que: "d/h", valor: rel, unidad: "", objeto: p.id, punto: [N[n]!.x, N[n]!.y], ...(def.comb ? { comb: def.comb } : {}) });
    }
  }
  extremos.sort((a, b) => b.valor - a.valor);
  if (def.factores) {
    const pc = r.q.planta(planta);
    const m = pc.valido ? pc.valor.maestro : null;
    if (m) {
      const u = r.q.combinar(m.u, 3, def.factores, true);
      notas.push(`Maestro del diafragma (${rotulo(m.punto[0]!)}; ${rotulo(m.punto[1]!)}): ux ${rotulo(1000 * u[0]!)} mm, uy ${rotulo(1000 * u[1]!)} mm, giro ${rotulo(u[2]!)} rad.`);
    }
    notas.push(desplomes.size ? "En cada pilar que llega, d/h: el desplome relativo de su tramo bajo la planta (el de la tabla)." : "Es la planta más baja: sus pilares no tienen desplome.");
  } else notas.push("La forma del modo: sin unidades, normalizada.");
  notas.push(ESCALA(def), "En planta, sólo lo horizontal (ux, uy): el descenso, en el alzado y en el 3D.", ...fondo.notas);

  const c = cajaPlanta(fondo.primitivas);
  return {
    titulo: d.nombre ?? "Proyecto",
    cabecera: [cabeceraPlanta(pl), `Vista: deformada, ${def.etiqueta}`, `Huella ${d.huella.slice(0, 12)}`],
    primitivas: P,
    leyenda: [...LEYENDA_BASE, ...(pilares.length ? [{ estilo: "deformada-nudo" as const, texto: def.factores ? "Cabeza de un pilar, desplazada, con su d/h" : "Cabeza de un pilar, desplazada" }] : []), ...fondo.leyenda],
    notas,
    extremos,
    caja: nuevos.length ? cajaDe([...nuevos, [c[0], c[1]], [c[2], c[3]]]) : c,
  };
}
