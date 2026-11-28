/**
 * VC3 (`docs/fem3d/coherencia-vistas.md`): la comprobación en el alzado y en el 3D, con los colores de
 * la planta (CO6-d): cada parte del color de su aprovechamiento (`claseAprovechamiento`).
 *
 * - Alzado (`vistaAlzadoComprobacion`): sobre el alzado del modelo en gris, lo que el plano ve de cada
 *   parte del tipo: un tramo de pilar, de su base a su cabeza, con el ancho que se ve de su huella;
 *   un vano de viga, con su canto, entre las caras de sus apoyos (cortado, si la viga cruza el plano);
 *   una losa, su corte; una unión del punzonamiento, la losa cortada a 2·d de las caras del pilar.
 *   Cada una, rotulada con su aprovechamiento.
 * - 3D (`clasesSolido`): la clase de cada triángulo del sólido de la sesión: el de un tramo de pilar
 *   (el pilar y la planta de su cabeza), el de un vano de viga (el vano más cercano a su centroide a lo
 *   largo de la viga) o el de una losa; lo demás, 0. La app lo pinta con los colores de la planta.
 *
 * Los aprovechamientos son los de las fichas (`alDia`, lo mismo que la tabla y la planta). Puro: sin IO.
 */
import type { ArmadoProyecto } from "../agente/armaduraBase.ts";
import { cantoSeccion, intervalosRecta, PROFUNDIDAD_ALZADO, SENO_PARALELO, vistaAlzado, type OpcionesAlzado, type PlanoAlzado } from "../agente/render/alzado.ts";
import { cajaDe, numeroFijo, type EntradaLeyenda, type Escena, type ExtremoRotulado, type Primitiva } from "../agente/render/escena.ts";
import { anchoViga, huellaSeccion, porId, type DatosVista } from "../agente/render/modelo.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import { desnivelesVigasFisico } from "../compilador/desniveles.ts";
import type { Vec2 } from "../compilador/fisico.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { alDia, claseAprovechamiento, COLOR_APROVECHAMIENTO, TEXTO_CLASE, type ClaseAprovechamiento, type FichaComprobacion, type TipoComprobacion } from "./comprobaciones.ts";
import type { Sesion } from "./sesion.ts";
import type { Solido } from "./solido.ts";

type Resultado<T> = { valido: true; valor: T } | { valido: false; diagnosticos: Diagnostico[] };

/** Las clases, en el orden de `clasesSolido` (1 la primera; 0, lo que no es del tipo) y de las leyendas. */
export const CLASES: readonly ClaseAprovechamiento[] = ["no-cumple", "alto", "cumple", "sin-armado", "no-aplica"];

const rect = (u0: number, u1: number, z0: number, z1: number): Vec2[] => [
  [u0, z0],
  [u1, z0],
  [u1, z1],
  [u0, z1],
];

const valor = (p: FichaComprobacion) => (p.aprovechamiento === null ? "—" : numeroFijo(p.aprovechamiento, 2));

const NOMBRE: Record<TipoComprobacion, string> = { pilares: "los tramos de pilar", vigas: "los vanos de las vigas", losas: "las losas", punzonamiento: "el punzonamiento junto a cada pilar" };

/** Lo que una ficha dice de sí misma en un extremo rotulado. */
const extremo = (p: FichaComprobacion, punto: Vec2): ExtremoRotulado => ({
  que: `aprovechamiento de ${p.clave}${p.manda ? ` (${p.manda.descripcion})` : ""}`,
  valor: p.aprovechamiento!,
  unidad: "",
  objeto: p.pieza,
  punto,
  ...(p.manda?.comb ? { comb: p.manda.comb } : {}),
});

/**
 * La leyenda de las clases usadas, como la de la planta.
 * @param prefijo — lo que va delante de cada texto («Perímetro crítico · …»); sin él, el texto de la clase.
 */
export function leyendaClases(usadas: ReadonlySet<ClaseAprovechamiento>, prefijo?: string): EntradaLeyenda[] {
  return CLASES.filter((x) => usadas.has(x)).map((x) => ({ relleno: COLOR_APROVECHAMIENTO[x], texto: prefijo ? `${prefijo} · ${TEXTO_CLASE[x].charAt(0).toLowerCase()}${TEXTO_CLASE[x].slice(1)}` : TEXTO_CLASE[x] }));
}

// ─── Alzado ─────────────────────────────────────────────────────────────────────────────────────

export function vistaAlzadoComprobacion(s: Sesion, plano: PlanoAlzado, tipo: TipoComprobacion, armado: ArmadoProyecto | undefined, d: DatosVista, o: Pick<OpcionesAlzado, "modo" | "analitico"> = {}): Resultado<Escena> {
  const r = alDia(s, tipo, armado);
  if (!r.valido) return r;
  const f = s.proyecto.modelo;
  const base = vistaAlzado(f, plano, d, { ...o, atenuado: true });
  const prof = plano.profundidad ?? PROFUNDIDAD_ALZADO;
  const L = Math.hypot(plano.hasta[0] - plano.desde[0], plano.hasta[1] - plano.desde[1]);
  const dir: Vec2 = L > 0 ? [(plano.hasta[0] - plano.desde[0]) / L, (plano.hasta[1] - plano.desde[1]) / L] : [1, 0];
  const nor: Vec2 = [-dir[1], dir[0]];
  const uu = (q: readonly number[]) => (q[0]! - plano.desde[0]) * dir[0] + (q[1]! - plano.desde[1]) * dir[1];
  const ww = (q: readonly number[]) => (q[0]! - plano.desde[0]) * nor[0] + (q[1]! - plano.desde[1]) * nor[1];
  const plantas = f.plantas ?? [];
  const cotas = cotasPlantas(plantas);
  const indice = new Map(plantas.map((p, i) => [p.id, i]));
  const cotaDe = (id: string | undefined) => (id === undefined ? null : (cotas[indice.get(id) ?? -1] ?? null));
  const seccion = (id: string | undefined) => f.secciones?.find((x) => x.id === id);

  const P: Primitiva[] = [];
  const textos: Primitiva[] = [];
  const extremos: ExtremoRotulado[] = [];
  const nuevos: Vec2[] = [];
  const usadas = new Set<ClaseAprovechamiento>();
  const anotar = (p: FichaComprobacion, anillos: Vec2[][], donde: Vec2, rotulo: string) => {
    if (!anillos.length) return;
    const clase = claseAprovechamiento(p);
    usadas.add(clase);
    for (const a of anillos) {
      P.push({ tipo: "poligono", anillos: [a], estilo: "contorno", relleno: COLOR_APROVECHAMIENTO[clase], objeto: p.pieza });
      nuevos.push(...a);
    }
    textos.push({ tipo: "texto", p: donde, texto: rotulo, tamano: 11, ancla: "medio", dy: 4, fondo: true, prioridad: clase === "no-cumple" ? 60 : 50, objeto: p.pieza });
    if (p.aprovechamiento !== null) extremos.push(extremo(p, donde));
  };
  // El ancho que el plano ve de la huella de un pilar en un tramo (u), o null
  const anchoPilar = (id: string, cabeza: string): [number, number] | null => {
    const p = f.pilares?.find((x) => x.id === id);
    if (!p || Math.abs(ww([p.x, p.y])) > prof) return null;
    const h = huellaSeccion(p, seccion(p.tramos?.find((t) => t.planta === cabeza)?.seccion ?? p.seccion));
    if (!h) return null;
    if ("radio" in h) return [uu(h.centro) - h.radio, uu(h.centro) + h.radio];
    const us = h.anillo.map(uu);
    return [Math.min(...us), Math.max(...us)];
  };
  // Las losas de una planta cortadas por el plano: [a, b] en u, cara superior y espesor
  const cortesLosas = (planta: string, id?: string) =>
    porId(f.losas ?? [])
      .filter((l) => l.planta === planta && (id === undefined || l.id === id))
      .flatMap((l) => {
        const z = cotaDe(l.planta);
        return z === null ? [] : intervalosRecta([l.contorno as Vec2[], ...((l.huecos ?? []) as Vec2[][])], plano.desde, dir).map(([a, b]) => ({ a, b, z: z + (l.desnivel ?? 0), e: l.espesor }));
      });

  const fichas = r.valor.fichas;
  if (tipo === "pilares") {
    for (const p of fichas) {
      const k = indice.get(p.planta ?? "");
      if (k === undefined) continue;
      const ancho = anchoPilar(p.pieza, p.planta!);
      const [z1, z0] = [cotas[k], cotas[k + 1]];
      if (!ancho || z1 === null || z0 === null || z0 === undefined || z1 === undefined) continue;
      anotar(p, [rect(ancho[0], ancho[1], z0, z1)], [(ancho[0] + ancho[1]) / 2, (z0 + z1) / 2], `${p.pieza} ${valor(p)}`);
    }
  } else if (tipo === "vigas") {
    const desnivel = desnivelesVigasFisico(f);
    const vigas = new Map((f.vigas ?? []).map((v) => [v.id, v]));
    for (const p of fichas) {
      const v = vigas.get(p.pieza);
      const zp = cotaDe(v?.planta);
      if (!v || !p.tramo || zp === null) continue;
      const z = zp + (desnivel.get(v.id) ?? 0);
      const sc = seccion(v.seccion);
      const h = cantoSeccion(sc) || 0.3;
      const b = anchoViga(sc);
      const anillos: Vec2[][] = [];
      let s = 0;
      for (let i = 1; i < v.puntos.length; i++) {
        const [pa, pb] = [v.puntos[i - 1]!, v.puntos[i]!];
        const l = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        if (l === 0) continue;
        const [s0, s1] = [Math.max(p.tramo[0], s), Math.min(p.tramo[1], s + l)];
        const en = (t: number): Vec2 => [pa[0] + ((pb[0] - pa[0]) * (t - s)) / l, pa[1] + ((pb[1] - pa[1]) * (t - s)) / l];
        const seno = Math.abs(((pb[0] - pa[0]) / l) * nor[0] + ((pb[1] - pa[1]) / l) * nor[1]);
        const [wa, wb] = [ww(pa), ww(pb)];
        if (seno < SENO_PARALELO) {
          if (s1 > s0 && Math.abs(wa) <= prof + b / 2 && Math.abs(wb) <= prof + b / 2) {
            const [ua, ub] = [uu(en(s0)), uu(en(s1))];
            anillos.push(rect(Math.min(ua, ub), Math.max(ua, ub), z - h, z));
          }
        } else if (wa > 0 !== wb > 0 || wa === 0 || wb === 0) {
          // Cruza el plano: su sección, si el cruce cae en el vano
          const t = wa / (wa - wb || 1);
          const sc0 = s + t * l;
          if (sc0 >= p.tramo[0] && sc0 <= p.tramo[1]) {
            const uc = uu(en(sc0));
            const e = (b || 0.05) / 2 / seno;
            anillos.push(rect(uc - e, uc + e, z - h, z));
          }
        }
        s += l;
      }
      const mayor = anillos.reduce<Vec2[] | null>((m, a) => (!m || a[1]![0] - a[0]![0] > m[1]![0] - m[0]![0] ? a : m), null);
      if (mayor) anotar(p, anillos, [(mayor[0]![0] + mayor[1]![0]) / 2, z - h / 2], valor(p));
    }
  } else if (tipo === "losas") {
    for (const p of fichas) {
      const l = f.losas?.find((x) => x.id === p.pieza);
      if (!l) continue;
      const cs = cortesLosas(l.planta, l.id);
      const mayor = cs.reduce<(typeof cs)[number] | null>((m, c) => (!m || c.b - c.a > m.b - m.a ? c : m), null);
      if (mayor) anotar(p, cs.map((c) => rect(c.a, c.b, c.z - c.e, c.z)), [(mayor.a + mayor.b) / 2, mayor.z - mayor.e / 2], `${p.pieza} ${valor(p)}`);
    }
  } else {
    // La unión: la losa de la planta cortada, de 2·d antes de la cara del pilar a 2·d después
    for (const p of fichas) {
      const gm = p.geometria.tipo === "punzonamiento" ? p.geometria : undefined;
      const ancho = anchoPilar(p.pieza, p.planta ?? "");
      if (!ancho || !p.planta) continue;
      const dd = gm?.d ? (2 * gm.d) / 1000 : 0;
      const [a0, b0] = [ancho[0] - dd, ancho[1] + dd];
      const anillos = cortesLosas(p.planta)
        .map((c) => ({ ...c, a: Math.max(c.a, a0), b: Math.min(c.b, b0) }))
        .filter((c) => c.b > c.a)
        .map((c) => rect(c.a, c.b, c.z - c.e, c.z));
      const z = anillos[0]?.[2]?.[1];
      if (z !== undefined) anotar(p, anillos, [(ancho[0] + ancho[1]) / 2, z], `${p.pieza} ${valor(p)}`);
    }
  }

  const c = base.caja;
  return {
    valido: true,
    valor: {
      ...base,
      cabecera: [...base.cabecera, `Comprobación de ${NOMBRE[tipo]}, con su armado`],
      primitivas: [...base.primitivas, ...P, ...textos],
      leyenda: [...leyendaClases(usadas), ...base.leyenda],
      tituloLeyenda: "Aprovechamiento (la comprobación que manda)",
      notas: [
        "Rótulo: el aprovechamiento de la comprobación que manda (la que no cumple, si la hay; si no, la de agotamiento más alta). Todas, en la ficha de cada pieza.",
        ...(tipo === "vigas" ? ["Cada vano, entre las caras de sus apoyos."] : tipo === "punzonamiento" ? ["De cada unión, la losa cortada a 2·d de las caras del pilar (el perímetro crítico, visto en el plano)."] : []),
        ...(!usadas.size ? [`El plano no ve ninguna parte de ${NOMBRE[tipo]}.`] : []),
        ...base.notas,
      ],
      extremos: extremos.sort((a, b) => b.valor - a.valor),
      caja: nuevos.length ? cajaDe([...nuevos, [c[0], c[1]], [c[2], c[3]]]) : c,
    },
  };
}

// ─── 3D ─────────────────────────────────────────────────────────────────────────────────────────

/** La clase de cada triángulo del sólido en la comprobación de un tipo (y la leyenda de lo que se ve). */
export interface ClasesSolido {
  /** Una por triángulo de `sol`: 1 + su índice en `CLASES`, o 0 si no es de una parte del tipo. */
  clase: Uint8Array;
  /** Los triángulos del sólido del que salen (la app no lo aplica a otro). */
  n: number;
  leyenda: EntradaLeyenda[];
  tituloLeyenda: string;
  notas: string[];
}

export function clasesSolido(s: Sesion, tipo: Exclude<TipoComprobacion, "punzonamiento">, armado: ArmadoProyecto | undefined, sol: Solido): Resultado<ClasesSolido> {
  const r = alDia(s, tipo, armado);
  if (!r.valido) return r;
  const f = s.proyecto.modelo;
  const n = sol.objeto.length;
  const clase = new Uint8Array(n);
  const usadas = new Set<ClaseAprovechamiento>();
  const de = (p: FichaComprobacion) => {
    const c = claseAprovechamiento(p);
    usadas.add(c);
    return 1 + CLASES.indexOf(c);
  };
  const tipoSolido = tipo === "pilares" ? "pilar" : tipo === "vigas" ? "viga" : "losa";
  if (tipo === "pilares") {
    // Por el pilar y la planta de la cabeza de su tramo (la del triángulo)
    const por = new Map(r.valor.fichas.map((p) => [`${p.pieza}@${p.planta}`, de(p)]));
    for (let t = 0; t < n; t++) {
      const o = sol.objetos[sol.objeto[t]!]!;
      if (o.tipo === tipoSolido) clase[t] = por.get(`${o.id}@${sol.plantas[sol.planta[t]!]}`) ?? 0;
    }
  } else if (tipo === "losas") {
    const por = new Map(r.valor.fichas.map((p) => [p.pieza, de(p)]));
    for (let t = 0; t < n; t++) {
      const o = sol.objetos[sol.objeto[t]!]!;
      if (o.tipo === tipoSolido) clase[t] = por.get(o.id) ?? 0;
    }
  } else {
    // Por el vano más cercano al centroide del triángulo a lo largo de su viga (lo de sobre los apoyos, al de al lado)
    const vanos = new Map<string, { t0: number; t1: number; c: number }[]>();
    for (const p of r.valor.fichas) if (p.tramo) (vanos.get(p.pieza) ?? vanos.set(p.pieza, []).get(p.pieza)!).push({ t0: p.tramo[0], t1: p.tramo[1], c: de(p) });
    const vigas = new Map((f.vigas ?? []).map((v) => [v.id, v]));
    const T = sol.triangulos;
    const [ox, oy] = sol.origen;
    for (let t = 0; t < n; t++) {
      const o = sol.objetos[sol.objeto[t]!]!;
      const vs = o.tipo === tipoSolido ? vanos.get(o.id) : undefined;
      const v = vs && vigas.get(o.id);
      if (!vs || !v) continue;
      const x = (T[9 * t]! + T[9 * t + 3]! + T[9 * t + 6]!) / 3 + ox;
      const y = (T[9 * t + 1]! + T[9 * t + 4]! + T[9 * t + 7]!) / 3 + oy;
      const sv = estacion(v.puntos, [x, y]);
      let mejor = 0;
      let dm = Infinity;
      for (const z of vs) {
        const dz = sv < z.t0 ? z.t0 - sv : sv > z.t1 ? sv - z.t1 : 0;
        if (dz < dm) [dm, mejor] = [dz, z.c];
      }
      clase[t] = mejor;
    }
  }
  return {
    valido: true,
    valor: {
      clase,
      n,
      leyenda: leyendaClases(usadas),
      tituloLeyenda: "Aprovechamiento (la comprobación que manda)",
      notas: [
        `Cada ${tipo === "pilares" ? "tramo de pilar" : tipo === "vigas" ? "vano de viga" : "losa"}, del color del aprovechamiento de la comprobación que manda; lo demás, en gris. Los valores, en la planta y en la tabla.`,
        ...(tipo === "vigas" ? ["Lo de sobre un apoyo, con el vano más cercano."] : []),
      ],
    },
  };
}

/** La estación (m a lo largo) del punto de una polilínea más cercano a q. */
function estacion(p: readonly (readonly number[])[], q: Vec2): number {
  let s = 0;
  let mejor = 0;
  let dm = Infinity;
  for (let i = 1; i < p.length; i++) {
    const [a, b] = [p[i - 1]!, p[i]!];
    const [ex, ey] = [b[0]! - a[0]!, b[1]! - a[1]!];
    const l2 = ex * ex + ey * ey;
    const l = Math.sqrt(l2);
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((q[0] - a[0]!) * ex + (q[1] - a[1]!) * ey) / l2)) : 0;
    const d = Math.hypot(q[0] - a[0]! - t * ex, q[1] - a[1]! - t * ey);
    if (d < dm) [dm, mejor] = [d, s + t * l];
    s += l;
  }
  return mejor;
}
