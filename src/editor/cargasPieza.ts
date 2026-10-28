/**
 * Las cargas que actúan sobre una pieza, para el espacio Cargas: al elegir un forjado, una viga, un
 * pilar o un muro, Propiedades dice qué le cae en cada caso y cuánto (la resultante, kN, ejes
 * globales), como están dibujadas en el modelo físico (`geometriaCargas`):
 *
 * - **Forjado** (losa o paño): las de superficie sobre él (su parte en la zona, si la tienen) y las
 *   de superficie por zona de su planta, por el área de la zona dentro de él (C2-h); las lineales y
 *   las puntuales de su planta, por lo que cae dentro (sin sus huecos).
 * - **Viga, pilar o muro:** las que lo nombran (en barra, empujes).
 *
 * Es lo dibujado, no el reparto del compilador: con la unión por las caras (LV), lo que cae en el
 * ancho de una viga lo lleva la viga, y una lineal por el eje de un muro, el muro.
 *
 * El peso propio va aparte, en el caso que lo lleva: el de un forjado, con su `pp` (`pesoLosa`, el
 * del compilador, A3-1); el de las barras y los muros, por metro o por m² (γ·A, γ·e), sin lo que el
 * compilador descuenta por los solapes (C2-g, C3-g).
 *
 * Puro: sin IO.
 */
import { areaRegion, areaSeccion, gammaMaterial, pesoLosa, ppDePano, regionDe } from "../agente/sensatez.ts";
import { geometriaCargas, presionEn, type GeometriaCarga, type V3 } from "../agente/render/cargas.ts";
import type { CargaFisica, ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { fraccionEnRegiones, momentosInterseccion, puntoEnRegion } from "../compilador/poligonos.ts";
import type { Vec3 } from "../motor/modelo.ts";
import type { PlantillaCargas } from "./dibujo/cargas.ts";
import type { Operacion } from "./operaciones.ts";
import type { Objeto } from "./referencias.ts";
import { idNuevo } from "./tablas.ts";

export type TipoPieza = "losa" | "pano" | "viga" | "pilar" | "muro";

export interface CargaSobrePieza {
  carga: CargaFisica;
  /** Resultante de lo que cae en la pieza, kN, ejes globales. */
  F: V3;
  /** Sólo una parte de la carga cae en la pieza (una zona o una lineal que se sale de ella). */
  parte: boolean;
}

export interface PesoPropioPieza {
  /** El caso que lleva el peso propio (como mucho uno), o null si ninguno. */
  caso: string | null;
  /** Por unidad: kN/m² en forjados y muros, kN/m en vigas y pilares (del primer tramo). */
  unidad: number;
  queUnidad: "kN/m²" | "kN/m";
  /** El total en kN, sólo en los forjados (el del compilador). */
  total?: number;
}

export interface CargasPieza {
  tipo: TipoPieza;
  id: string;
  /** Por caso, en el orden de los casos; los casos sin cargas sobre la pieza, con la lista vacía. */
  casos: { caso: string; cargas: CargaSobrePieza[]; F: V3 }[];
  pesoPropio: PesoPropioPieza | null;
}

const cero = (): V3 => [0, 0, 0];
const sumar = (a: V3, b: readonly number[], k = 1): V3 => [a[0] + k * b[0]!, a[1] + k * b[1]!, a[2] + k * b[2]!];

/** El tipo de pieza de un id, o null si no es una pieza que reciba cargas. */
export function tipoPieza(f: ModeloFisico, id: string): TipoPieza | null {
  if (f.losas?.some((x) => x.id === id)) return "losa";
  if (f.panos?.some((x) => x.id === id)) return "pano";
  if (f.vigas?.some((x) => x.id === id)) return "viga";
  if (f.pilares?.some((x) => x.id === id)) return "pilar";
  if (f.muros?.some((x) => x.id === id)) return "muro";
  return null;
}

/** La resultante de una carga situada, kN: integrada exacta (q lineal en cada tramo y en cada empuje). */
function resultante(g: GeometriaCarga): V3 {
  let F = cero();
  for (const l of g.lineas) F = sumar(F, sumar(l.qa, l.qb), Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1], l.b[2] - l.a[2]) / 2);
  for (const p of g.puntos) F = sumar(F, p.F);
  for (const pr of g.presiones) {
    const L = Math.hypot(pr.B[0] - pr.A[0], pr.B[1] - pr.A[1]);
    const integral = (s0: number, s1: number, za: number, zb: number) => (s1 > s0 && zb > za ? (s1 - s0) * ((presionEn(pr, za) + presionEn(pr, zb)) / 2) * (zb - za) : 0);
    let I = integral(0, L, pr.zs[0], pr.zs[1]);
    for (const h of pr.huecos) I -= integral(Math.max(h.s0, 0), Math.min(h.s1, L), Math.max(h.z0, pr.zs[0]), Math.min(h.z1, pr.zs[1]));
    F = sumar(F, pr.n, I);
  }
  return F;
}

/** Lo que una carga de la planta deja en el forjado x (null si nada). */
function enForjado(c: CargaFisica, x: { id: string; planta: string; contorno: readonly Vec2[]; huecos?: readonly (readonly Vec2[])[] }, tipo: "losa" | "pano"): { F: V3; parte: boolean } | null {
  if (!("planta" in c) || c.planta !== x.planta) return null;
  const r = regionDe(x);
  switch (c.tipo) {
    case "superficie": {
      // Sobre este forjado o, sin forjado, por su zona (C2-h)
      const sobre = c.losa ?? c.pano;
      const suyo = sobre === undefined ? !!c.zona : sobre === x.id && (tipo === "losa" ? c.losa : c.pano) === x.id;
      if (!suyo) return null;
      const A = c.zona ? Math.abs(momentosInterseccion(r, c.zona).A) : areaRegion(x);
      if (!(A > 0)) return null;
      return { F: [c.q[0] * A, c.q[1] * A, c.q[2] * A], parte: !!c.zona };
    }
    case "lineal": {
      let L = 0;
      let total = 0;
      for (let i = 1; i < c.puntos.length; i++) {
        const [a, b] = [c.puntos[i - 1]!, c.puntos[i]!];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        total += l;
        if (l > 0) L += fraccionEnRegiones(a, b, [r]) * l;
      }
      if (!(L > 0)) return null;
      return { F: [c.q[0] * L, c.q[1] * L, c.q[2] * L], parte: L < total * (1 - 1e-12) };
    }
    case "puntual":
      return puntoEnRegion([c.x, c.y], r) ? { F: [...(c.F ?? [0, 0, 0])] as V3, parte: false } : null;
    default:
      return null;
  }
}

/** Las cargas que actúan sobre la pieza id, por caso, y su peso propio; null si id no es una pieza que las reciba. */
export function cargasPieza(f: ModeloFisico, id: string): CargasPieza | null {
  const tipo = tipoPieza(f, id);
  if (!tipo) return null;
  const casos: CargasPieza["casos"] = [];
  const forjado = tipo === "losa" ? f.losas!.find((x) => x.id === id)! : tipo === "pano" ? f.panos!.find((x) => x.id === id)! : null;
  for (const caso of f.casos) {
    const cargas: CargaSobrePieza[] = [];
    if (forjado) {
      for (const c of f.cargas ?? []) {
        if (c.caso !== caso.id) continue;
        const r = enForjado(c, forjado, tipo as "losa" | "pano");
        if (r) cargas.push({ carga: c, ...r });
      }
    } else {
      const nombra = (c: CargaFisica) => (c.tipo === "viga" && c.viga === id) || (c.tipo === "pilar" && c.pilar === id) || (c.tipo === "empuje" && c.muro === id);
      if ((f.cargas ?? []).some((c) => c.caso === caso.id && nombra(c)))
        for (const g of geometriaCargas(f, caso.id).cargas) if (nombra(g.carga)) cargas.push({ carga: g.carga, F: resultante(g), parte: false });
    }
    casos.push({ caso: caso.id, cargas, F: cargas.reduce((s, x) => sumar(s, x.F), cero()) });
  }
  return { tipo, id, casos, pesoPropio: pesoPropioPieza(f, tipo, id) };
}

function pesoPropioPieza(f: ModeloFisico, tipo: TipoPieza, id: string): PesoPropioPieza | null {
  const caso = f.casos.find((c) => c.pesoPropio)?.id ?? null;
  const material = (mid: string) => f.materiales.find((m) => m.id === mid);
  const seccion = (sid: string) => f.secciones.find((s) => s.id === sid);
  const porSeccion = (sid: string): PesoPropioPieza | null => {
    const s = seccion(sid);
    const m = s && material(s.material);
    return s && m ? { caso, unidad: areaSeccion(s) * gammaMaterial(m), queUnidad: "kN/m" } : null;
  };
  switch (tipo) {
    case "losa": {
      const l = f.losas!.find((x) => x.id === id)!;
      const m = material(l.material);
      if (!m) return null;
      const A = areaRegion(l);
      const total = pesoLosa(l, m);
      return { caso, unidad: A > 0 ? total / A : 0, queUnidad: "kN/m²", total };
    }
    case "pano": {
      const p = f.panos!.find((x) => x.id === id)!;
      const pp = ppDePano(f, p);
      return pp === undefined ? null : { caso, unidad: pp, queUnidad: "kN/m²", total: pp * areaRegion(p) };
    }
    case "viga":
      return porSeccion(f.vigas!.find((x) => x.id === id)!.seccion);
    case "pilar":
      return porSeccion(f.pilares!.find((x) => x.id === id)!.seccion);
    case "muro": {
      const w = f.muros!.find((x) => x.id === id)!;
      const m = material(w.material);
      return m ? { caso, unidad: gammaMaterial(m) * w.espesor, queUnidad: "kN/m²" } : null;
    }
  }
}

const noNulo = (v: Vec3 | undefined): v is Vec3 => !!v && v.some((x) => x !== 0);

/**
 * Una carga nueva en la pieza id, en el caso de la plantilla, con sus valores (los de la herramienta
 * de su tipo, `dibujo/cargas.ts`): de superficie en todo un forjado, en barra en toda una viga o un
 * pilar, o un empuje en un muro del lado dado. El mismo objeto que la herramienta con un clic en la
 * pieza; o por qué no se puede.
 */
export function cargaEnPieza(f: ModeloFisico, t: PlantillaCargas, id: string, lado?: "izquierdo" | "derecho"): { operacion: Operacion; etiqueta: string } | string {
  const caso = t.caso;
  if (!caso || !f.casos.some((x) => x.id === caso)) return "Elija el caso activo en la barra (o cree uno con Casos).";
  const tipo = tipoPieza(f, id);
  let c: Record<string, unknown> & { tipo: CargaFisica["tipo"] };
  let que: string;
  switch (tipo) {
    case "losa":
    case "pano": {
      const q = t.superficie?.q;
      if (!noNulo(q)) return "Escriba el valor de la carga de superficie (kN/m²).";
      const x = (tipo === "losa" ? f.losas : f.panos)!.find((y) => y.id === id)!;
      c = { tipo: "superficie", planta: x.planta, q, ...(tipo === "losa" ? { losa: id } : { pano: id }) };
      que = `superficie en ${id}`;
      break;
    }
    case "viga":
    case "pilar": {
      const b = t.barra ?? {};
      if (!noNulo(b.q)) return "Escriba el valor de la carga (kN/m).";
      c = { tipo, [tipo]: id, ejes: b.ejes ?? "global", q: b.q, ...(noNulo(b.qb) ? { qb: b.qb } : {}) };
      que = `en ${id}`;
      break;
    }
    case "muro": {
      const e = t.empuje ?? {};
      if (!lado) return "Elija el lado del terreno.";
      const [z0, p1] = [e.z0 ?? 0, e.p1 ?? 0];
      if (e.z1 === undefined || e.p0 === undefined) return "Escriba la altura z1 y la presión p0 del empuje.";
      if (!(e.z1 > z0)) return "z1 tiene que ser mayor que z0.";
      c = { tipo: "empuje", muro: id, lado, z0, z1: e.z1, p0: e.p0, p1 };
      que = `empuje en ${id}, lado ${lado}`;
      break;
    }
    default:
      return `${id} no es un forjado, una viga, un pilar ni un muro.`;
  }
  const nuevo = idNuevo(f, "Q");
  const objeto = { ...c, id: nuevo, caso } as unknown as Objeto;
  return { operacion: { op: "crear", coleccion: "cargas", objeto }, etiqueta: `Carga ${nuevo} (${que}, ${caso})` };
}

export interface ResumenTipo {
  tipo: CargaFisica["tipo"];
  n: number;
  /** Resultante, kN, ejes globales: la de superficie, la parte en los forjados de la planta (C2-h). */
  F: V3;
}

/**
 * Las cargas de un caso en una planta, por tipo: las de la planta (superficie, lineal, puntual), las
 * de sus vigas, y las de los pilares y los muros que acaban en ella (su cabeza).
 */
export function resumenCaso(f: ModeloFisico, caso: string, planta: string): ResumenTipo[] {
  const vigas = new Set((f.vigas ?? []).filter((v) => v.planta === planta).map((v) => v.id));
  const pilares = new Set((f.pilares ?? []).filter((p) => p.hasta === planta).map((p) => p.id));
  const muros = new Set((f.muros ?? []).filter((m) => m.hasta === planta).map((m) => m.id));
  const forjados = [...(f.losas ?? []).map((x) => [x, "losa"] as const), ...(f.panos ?? []).map((x) => [x, "pano"] as const)].filter(([x]) => x.planta === planta);
  const r = new Map<CargaFisica["tipo"], ResumenTipo>();
  const anotar = (c: CargaFisica, F: V3) => {
    const x = r.get(c.tipo) ?? { tipo: c.tipo, n: 0, F: cero() };
    r.set(c.tipo, { tipo: c.tipo, n: x.n + 1, F: sumar(x.F, F) });
  };
  const deLaPlanta = (c: CargaFisica) =>
    ("planta" in c && c.planta === planta) || (c.tipo === "viga" && vigas.has(c.viga)) || (c.tipo === "pilar" && pilares.has(c.pilar)) || (c.tipo === "empuje" && muros.has(c.muro));
  if (!(f.cargas ?? []).some((c) => c.caso === caso && deLaPlanta(c))) return [];
  for (const g of geometriaCargas(f, caso).cargas) {
    const c = g.carga;
    if (!deLaPlanta(c)) continue;
    if (c.tipo === "superficie") anotar(c, forjados.reduce((s, [x, t]) => sumar(s, enForjado(c, x, t)?.F ?? cero()), cero()));
    else anotar(c, resultante(g));
  }
  const orden: CargaFisica["tipo"][] = ["superficie", "lineal", "puntual", "viga", "pilar", "empuje"];
  return orden.filter((t) => r.has(t)).map((t) => r.get(t)!);
}
