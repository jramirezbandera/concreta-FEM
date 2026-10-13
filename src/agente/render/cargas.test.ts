/**
 * Las cargas en el alzado y en el 3D (tras I4): lo dibujado es lo que se calcula.
 * - La resultante (F y M) de `geometriaCargas`, integrada exacta, es la del modelo analítico que
 *   monta el compilador, caso a caso y sin el peso propio, a 1e-9 (modelos al azar con losas, muros
 *   con empujes y huecos, reticulares y unidireccionales). Donde el compilador une a ε_snap una zona
 *   o una polilínea (C2-b) o ajusta el eje o los huecos de un muro (el dibujo, como la planta,
 *   enseña el dato), la diferencia es la de mover sus vértices hasta ε_snap.
 * - El 3D: un objeto por carga dibujada, y cada segmento de un pilar o un muro, en la planta de la
 *   cabeza de su tramo (para filtrar por plantas).
 * - Los momentos de las puntuales: un arco para la componente normal al dibujo y una flecha de doble
 *   punta para la del plano, en planta y en alzado.
 * - El alzado de un modelo hecho a mano: cada bloque, con su ordenada a escala y hacia donde va la
 *   carga; lo que cruza el plano, en el cruce; lo que queda fuera, nada.
 */
import { describe, expect, it } from "vitest";
import { compilar } from "../../compilador/compilar.ts";
import { resultanteAnalitica } from "../../compilador/cargas.ts";
import type { ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import { fisicoAleatorio } from "../../pruebas/fisicoAleatorio.ts";
import { conForjadosAleatorios } from "../../pruebas/forjadosAleatorios.ts";
import { conLosasAleatorias } from "../../pruebas/losasAleatorias.ts";
import { conMurosAleatorios } from "../../pruebas/murosAleatorios.ts";
import { cargas3D } from "../../visor/cargas3d.ts";
import { descomponer } from "../../visor/solido.ts";
import { geometriaCargas, presionEn, vistaAlzadoCargas, type GeometriaCarga, type V3 } from "./cargas.ts";
import { ORDENADA_DIAGRAMA } from "./diagramas.ts";
import { cajaDe, R_MOMENTO, type Escena, type Primitiva } from "./escena.ts";
import { vistaCargas } from "./modelo.ts";
import { cotasPlantas } from "../../compilador/cotas.ts";
import { escenaASvg } from "./svg.ts";

const cruz = (a: readonly number[], b: readonly number[]): V3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const mas = (a: V3, b: readonly number[], k = 1): V3 => [a[0] + k * b[0]!, a[1] + k * b[1]!, a[2] + k * b[2]!];

/** La resultante respecto al origen de lo que se dibuja, integrada exacta, con sus escalas (Σ|F| y Σ|M|). */
function resultanteDibujada(cargas: readonly GeometriaCarga[]): { F: V3; M: V3; escalaF: number; escalaM: number } {
  let F: V3 = [0, 0, 0];
  let M: V3 = [0, 0, 0];
  let [eF, eM] = [0, 0];
  const sumar = (f: V3, m: V3) => {
    F = mas(F, f);
    M = mas(M, m);
    eF += Math.hypot(...f);
    eM += Math.hypot(...m);
  };
  for (const x of cargas) {
    for (const r of x.regiones)
      for (const col of descomponer(r.P, r.capas ?? [], [1, 0]))
        for (const fr of col.franjas) {
          if (!fr.enP || (r.capas && !fr.capas.some(Boolean))) continue;
          // Dos triángulos del trapecio
          for (const t of [
            [[col.xa, fr.a0], [col.xb, fr.b0], [col.xb, fr.b1]],
            [[col.xa, fr.a0], [col.xb, fr.b1], [col.xa, fr.a1]],
          ] as Vec2[][]) {
            const A = ((t[1]![0] - t[0]![0]) * (t[2]![1] - t[0]![1]) - (t[2]![0] - t[0]![0]) * (t[1]![1] - t[0]![1])) / 2;
            const c: V3 = [(t[0]![0] + t[1]![0] + t[2]![0]) / 3, (t[0]![1] + t[1]![1] + t[2]![1]) / 3, r.z];
            const f: V3 = [r.q[0] * A, r.q[1] * A, r.q[2] * A];
            sumar(f, cruz(c, f));
          }
        }
    for (const l of x.lineas) {
      const L = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1], l.b[2] - l.a[2]);
      const qm = mas(l.qa, l.qb).map((v) => v / 2) as V3;
      const rm = mas(l.a, l.b).map((v) => v / 2) as V3;
      const f = qm.map((v) => v * L) as V3;
      // Simpson: exacto con r y q lineales
      const m = mas(mas(cruz(l.a, l.qa), cruz(rm, qm), 4), cruz(l.b, l.qb)).map((v) => (v * L) / 6) as V3;
      sumar(f, m);
    }
    for (const p of x.puntos) sumar(p.F, mas(p.M, cruz(p.p, p.F)));
    for (const pr of x.presiones) {
      const l = Math.hypot(pr.B[0] - pr.A[0], pr.B[1] - pr.A[1]);
      const t: V3 = [(pr.B[0] - pr.A[0]) / l, (pr.B[1] - pr.A[1]) / l, 0];
      /** ∫∫ de un rectángulo [s0, s1] × [za, zb]: p, s·p y z·p (p lineal en z). */
      const rect = (s0: number, s1: number, za: number, zb: number, signo: number) => {
        if (!(s1 > s0 && zb > za)) return;
        const [pa, pb, pm] = [presionEn(pr, za), presionEn(pr, zb), presionEn(pr, (za + zb) / 2)];
        const Ip = ((pa + pb) / 2) * (zb - za);
        const Izp = ((za * pa + 4 * ((za + zb) / 2) * pm + zb * pb) * (zb - za)) / 6;
        const I0 = (s1 - s0) * Ip;
        const Is = ((s1 * s1 - s0 * s0) / 2) * Ip;
        const Iz = (s1 - s0) * Izp;
        const f: V3 = [pr.n[0] * I0 * signo, pr.n[1] * I0 * signo, 0];
        const m = mas(mas(cruz([pr.A[0], pr.A[1], 0], pr.n).map((v) => v * I0) as V3, cruz(t, pr.n), Is), cruz([0, 0, 1], pr.n), Iz).map((v) => v * signo) as V3;
        sumar(f, m);
      };
      rect(0, l, pr.zs[0], pr.zs[1], 1);
      for (const h of pr.huecos) rect(Math.max(h.s0, 0), Math.min(h.s1, l), Math.max(h.z0, pr.zs[0]), Math.min(h.z1, pr.zs[1]), -1);
    }
  }
  return { F, M, escalaF: eF, escalaM: eM };
}

/** Sin el peso propio en los casos: la resultante analítica es entonces la de las cargas. */
const sinPeso = (f: ModeloFisico): ModeloFisico => ({ ...f, casos: f.casos.map(({ pesoPropio: _, ...c }) => c) });

const EPS_SNAP = 0.05;
const perimetro = (r: readonly (readonly number[])[]) => r.reduce((s, p, i) => s + Math.hypot(p[0]! - r[(i + 1) % r.length]![0]!, p[1]! - r[(i + 1) % r.length]![1]!), 0);

/** Lo más que cambia la fuerza de una carga si la unión de C2-b mueve sus vértices hasta ε_snap. */
function cotaUnion(f: ModeloFisico, g: GeometriaCarga): number {
  const c = g.carga;
  if (c.tipo === "superficie") return Math.hypot(...c.q) * EPS_SNAP * (c.zona ? perimetro(c.zona) : g.regiones.reduce((s, r) => s + r.P.reduce((t, a) => t + perimetro(a), 0), 0));
  if (c.tipo === "lineal") return Math.hypot(...c.q) * 2 * EPS_SNAP * c.puntos.length;
  if (c.tipo === "empuje") {
    const m = f.muros?.find((x) => x.id === c.muro);
    // Los huecos y los vértices del eje (`muros.ts` los ajusta igual en todas las plantas)
    const h = Math.abs(c.z1 - c.z0);
    return Math.max(Math.abs(c.p0), Math.abs(c.p1)) * EPS_SNAP * ((m?.huecos ?? []).reduce((s, x) => s + 2 * (x.hasta - x.desde + x.z1 - x.z0), 0) + h * (m?.puntos.length ?? 0));
  }
  return 0;
}

/** Los modelos y si el compilador une a ε_snap alguna de sus cargas (C2-b). */
const MODELOS: [string, () => ModeloFisico, boolean][] = [
  ...[1, 2, 3].map((s) => [`al azar ${s}`, () => fisicoAleatorio(s), false] as [string, () => ModeloFisico, boolean]),
  ["losas al azar 8", () => conLosasAleatorias(fisicoAleatorio(8), 8), false],
  ["muros al azar 7", () => conMurosAleatorios(conLosasAleatorias(fisicoAleatorio(7), 7), 7), false],
  ["unidireccional al azar 4", () => conForjadosAleatorios(fisicoAleatorio(4), 4, { tipo: "unidireccional" }), false],
  ["reticular al azar 6", () => conForjadosAleatorios(fisicoAleatorio(6), 6, { tipo: "reticular" }), false],
  // Una zona y una polilínea unidas a otros trazos, y el eje de un muro de sótano ajustado 0,9 mm
  ["losas al azar 5", () => conLosasAleatorias(fisicoAleatorio(5), 5), true],
  ["muros al azar 6", () => conMurosAleatorios(conLosasAleatorias(fisicoAleatorio(6), 6), 6), true],
  ["muros al azar 9", () => conMurosAleatorios(conLosasAleatorias(fisicoAleatorio(9), 9), 9), true],
];

describe.each(MODELOS)("cargas dibujadas de %s", (_nombre, modelo, unidas) => {
  const f = sinPeso(modelo());

  it(unidas ? "su resultante es la del modelo analítico, salvo lo que mueve la unión a ε_snap" : "su resultante es la del modelo analítico, caso a caso, a 1e-9", () => {
    const c = compilar(f, { tamanoMalla: 1 });
    expect(c.valido, c.valido ? "" : c.diagnosticos.map((x) => x.mensaje).join("\n")).toBe(true);
    if (!c.valido) return;
    let tipos = new Set<string>();
    f.casos.forEach((caso) => {
      const geo = geometriaCargas(f, caso.id);
      expect(geo.notas).toEqual([]);
      tipos = new Set([...tipos, ...geo.cargas.map((x) => x.carga.tipo)]);
      const a = resultanteDibujada(geo.cargas);
      const k = c.modelo.casos.findIndex((x) => x.id === caso.id);
      const b = resultanteAnalitica(c.modelo, k, [0, 0, 0]);
      const [eF, eM] = [Math.max(a.escalaF, b.escalaF), Math.max(a.escalaM, b.escalaM)];
      if (!eF) return;
      const dF = Math.hypot(a.F[0] - b.F[0], a.F[1] - b.F[1], a.F[2] - b.F[2]);
      const dM = Math.hypot(a.M[0] - b.M[0], a.M[1] - b.M[1], a.M[2] - b.M[2]);
      if (unidas) {
        expect(dF, `${caso.id}: F ${a.F} frente a ${b.F}`).toBeLessThanOrEqual(geo.cargas.reduce((s, x) => s + cotaUnion(f, x), 0) + 1e-9 * eF);
        return;
      }
      expect(dF / eF, `${caso.id}: F ${a.F} frente a ${b.F}`).toBeLessThan(1e-9);
      expect(dM / eM, `${caso.id}: M ${a.M} frente a ${b.M}`).toBeLessThan(1e-9);
    });
    expect(tipos.size).toBeGreaterThan(2);
  });

  it("el 3D: un objeto por carga dibujada y búferes coherentes", () => {
    for (const caso of f.casos) {
      const r = cargas3D(f, [0, 0, 0], caso.id);
      expect(r.segmentos.length).toBe(6 * r.claseSegmento.length);
      expect(r.objetoSegmento.length).toBe(r.claseSegmento.length);
      expect(r.triangulos.length).toBe(9 * r.claseTriangulo.length);
      expect(r.segmentos.every(Number.isFinite) && r.triangulos.every(Number.isFinite)).toBe(true);
      for (const k of r.objetoSegmento) expect(k).toBeLessThan(r.objetos.length);
      const ids = new Set(geometriaCargas(f, caso.id).cargas.filter((x) => x.regiones.length || x.lineas.length || x.presiones.length || x.puntos.some((p) => Math.hypot(...p.F) + Math.hypot(...p.M) > 0)).map((x) => x.carga.id));
      expect(new Set(r.objetos.map((o) => o.id))).toEqual(ids);
      expect(r.plantaSegmento.length).toBe(r.claseSegmento.length);
      expect(r.objetoTriangulo.length).toBe(r.claseTriangulo.length);
      expect(r.plantaTriangulo.length).toBe(r.claseTriangulo.length);
      // Lo de un pilar o un muro, entre la cota de la planta de su segmento y la de debajo (más lo que
      // sobresalen las puntas de las flechas horizontales: 0,4 · 0,12 · ORDENADA_DIAGRAMA)
      const cotas = cotasPlantas(f.plantas);
      const tol = 0.4 * 0.12 * ORDENADA_DIAGRAMA + 1e-5;
      for (let i = 0; i < r.claseSegmento.length; i++) {
        const o = r.objetos[r.objetoSegmento[i]!]!;
        if (o.tipo !== "pilar" && o.tipo !== "empuje") continue;
        const k = r.plantaSegmento[i]!;
        for (const z of [r.segmentos[6 * i + 2]!, r.segmentos[6 * i + 5]!]) {
          expect(z, `${o.id} en ${r.plantas[k]}`).toBeLessThanOrEqual(cotas[k]! + tol);
          expect(z, `${o.id} en ${r.plantas[k]}`).toBeGreaterThanOrEqual((cotas[k + 1] ?? -Infinity) - tol);
        }
        expect(o.plantas).toContain(r.plantas[k]);
      }
    }
  });
});

// ─── Alzado a mano ──────────────────────────────────────────────────────────────────────────────

/**
 * Dos plantas (C a ±0 y N1 a +3); el plano del alzado, y = 0 de x = 0 a 10. En él: la viga VA (q −10 kN/m), el
 * pilar PA (viento 2 kN/m según X), la puntual F1 (−20 kN) y el borde de la losa LA (−3 kN/m², de y = 0
 * a 5, con su borde en el plano, como en una fachada), la puntual M2 (sólo un momento según X); el viento PA-wy, normal al plano; cruzándolo, la lineal T1 (−5 kN/m, en x = 2) y el muro MU (empuje 30 a 0 kN/m², en x = 8);
 * fuera, la viga VB (y = 5).
 */
const MANO: ModeloFisico = {
  plantas: [
    { id: "N1", altura: 3 },
    { id: "C", altura: 3 },
  ],
  materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
  secciones: [{ id: "s", forma: "rectangular", b: 0.3, h: 0.5, material: "HA" }],
  pilares: [{ id: "PA", x: 0, y: 0, desde: "C", hasta: "N1", seccion: "s" }],
  vigas: [
    { id: "VA", planta: "N1", puntos: [[0, 0], [6, 0]], seccion: "s" },
    { id: "VB", planta: "N1", puntos: [[0, 5], [6, 5]], seccion: "s" },
  ],
  losas: [{ id: "LA", planta: "N1", contorno: [[0, 0], [6, 0], [6, 5], [0, 5]], espesor: 0.2, material: "HA" }],
  muros: [{ id: "MU", puntos: [[8, -1], [8, 1]], desde: "C", hasta: "N1", espesor: 0.3, material: "HA" }],
  casos: [{ id: "Q" }],
  cargas: [
    { tipo: "viga", id: "VA-q", caso: "Q", viga: "VA", ejes: "global", q: [0, 0, -10] },
    { tipo: "viga", id: "VB-q", caso: "Q", viga: "VB", ejes: "global", q: [0, 0, -10] },
    { tipo: "pilar", id: "PA-w", caso: "Q", pilar: "PA", ejes: "global", q: [2, 0, 0] },
    { tipo: "pilar", id: "PA-wy", caso: "Q", pilar: "PA", ejes: "global", q: [0, 1, 0] },
    { tipo: "puntual", id: "F1", caso: "Q", planta: "N1", x: 3, y: 0, F: [0, 0, -20], M: [0, 5, 0] },
    { tipo: "puntual", id: "M2", caso: "Q", planta: "N1", x: 5, y: 0, F: [0, 0, 0], M: [4, 0, 0] },
    { tipo: "superficie", id: "S1", caso: "Q", planta: "N1", losa: "LA", q: [0, 0, -3] },
    { tipo: "lineal", id: "T1", caso: "Q", planta: "N1", puntos: [[2, -2], [2, 2]], q: [0, 0, -5] },
    { tipo: "empuje", id: "E1", caso: "Q", muro: "MU", lado: "derecho", z0: 0, z1: 3, p0: 30, p1: 0 },
  ],
} as unknown as ModeloFisico;

const PLANO = { desde: [0, 0] as Vec2, hasta: [10, 0] as Vec2 };
const d = { huella: "0123456789abcdef" };
const m = ORDENADA_DIAGRAMA;
const de = (e: Escena, objeto: string) => e.primitivas.filter((p): p is Exclude<Primitiva, { tipo: "texto" }> => p.tipo !== "texto" && "objeto" in p && p.objeto === objeto);
const bloque = (e: Escena, objeto: string) => e.primitivas.find((p): p is Extract<Primitiva, { tipo: "poligono" }> => p.tipo === "poligono" && p.objeto === objeto && p.estilo.startsWith("carga-"));
const cerca = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]!) < 1e-9);

describe("alzado de las cargas, a mano", () => {
  const e = vistaAlzadoCargas(MANO, PLANO, "Q", d);

  it("la viga del plano: el bloque encima, de la mayor carga por metro a ORDENADA_DIAGRAMA m", () => {
    expect(cerca(cajaDe(bloque(e, "VA-q")!.anillos[0]!), [0, 3, 6, 3 + m])).toBe(true);
  });

  it("el pilar del plano: el viento a su escala (2/10), con la cola del lado de barlovento", () => {
    expect(cerca(cajaDe(bloque(e, "PA-w")!.anillos[0]!), [-(2 / 10) * m, 0, 0, 3])).toBe(true);
  });

  it("la losa cortada por el plano: su carga de superficie a lo largo del corte, a la escala de las de superficie", () => {
    // Las de superficie: S1 (3) y el empuje de MU (30): 3/30 de la ordenada
    expect(cerca(cajaDe(bloque(e, "S1")!.anillos[0]!), [0, 3, 6, 3 + (3 / 30) * m])).toBe(true);
  });

  it("el empuje del muro que cruza el plano: de p0 abajo a 0 arriba, del lado del terreno", () => {
    // Lado derecho del eje (de y = −1 a 1, hacia +Y): el terreno en +X, empuja hacia −X
    const an = bloque(e, "E1")!.anillos[0]!;
    expect(cerca(cajaDe(an), [8, 0, 8 + m, 3])).toBe(true);
    expect(an.some((p) => cerca(p, [8 + m, 0]))).toBe(true);
  });

  it("lo que cruza el plano y lo puntual: una flecha con la punta en la pieza", () => {
    const t = de(e, "T1").filter((p) => p.tipo === "linea");
    expect(t.some((p) => p.tipo === "linea" && cerca(p.puntos[0]!, [2, 3 + (5 / 10) * m]) && cerca(p.puntos[1]!, [2, 3]))).toBe(true);
    const f = de(e, "F1").filter((p) => p.tipo === "linea");
    expect(f.some((p) => p.tipo === "linea" && cerca(p.puntos[0]!, [3, 3 + m]) && cerca(p.puntos[1]!, [3, 3]))).toBe(true);
  });

  it("lo que está fuera del plano no se dibuja; cada carga dibujada lleva su rótulo", () => {
    expect(de(e, "VB-q")).toEqual([]);
    const rotulos = e.primitivas.filter((p) => p.tipo === "texto" && p.clase === "dato").map((p) => (p as { objeto?: string }).objeto);
    expect(new Set(rotulos)).toEqual(new Set(["VA-q", "PA-w", "PA-wy", "F1", "M2", "S1", "T1", "E1"]));
  });

  it("lo normal al plano no tiene bloque: se rotula", () => {
    expect(bloque(e, "PA-wy")).toBeUndefined();
    expect(e.primitivas.some((p) => p.tipo === "texto" && p.texto === "PA-wy: (0; 1; 0) kN/m global, normal al plano")).toBe(true);
  });

  it("el fondo, atenuado y sin ids; las plantas, con su cota", () => {
    expect(e.primitivas.some((p) => p.tipo !== "texto" && (p.estilo === "pilar-alzado" || p.estilo === "viga-alzado"))).toBe(false);
    expect(e.primitivas.some((p) => p.tipo === "texto" && p.clase === "id")).toBe(false);
    expect(e.primitivas.some((p) => p.tipo === "texto" && p.texto.startsWith("N1"))).toBe(true);
  });

  it("un muro paralelo al plano: su empuje sólo se rotula", () => {
    const g: ModeloFisico = { ...MANO, muros: [{ id: "MU", puntos: [[7, 0], [9, 0]], desde: "C", hasta: "N1", espesor: 0.3, material: "HA" }] } as ModeloFisico;
    const x = vistaAlzadoCargas(g, PLANO, "Q", d);
    expect(bloque(x, "E1")).toBeUndefined();
    expect(x.primitivas.some((p) => p.tipo === "texto" && p.texto.startsWith("E1: empuje normal al plano"))).toBe(true);
  });

  it("no depende del orden de las cargas y su SVG se dibuja", () => {
    const g: ModeloFisico = { ...MANO, cargas: [...(MANO.cargas ?? [])].reverse() };
    expect(escenaASvg(vistaAlzadoCargas(g, PLANO, "Q", d)).svg).toBe(escenaASvg(e).svg);
  });

  it("los momentos: My, normal al plano y = 0, un arco horario; Mx, en el plano, una flecha de doble punta", () => {
    const lineas = (e: Escena, id: string) => de(e, id).filter((p): p is Extract<Primitiva, { tipo: "linea" }> => p.tipo === "linea");
    // F1: M = (0, 5, 0), hacia +Y; quien mira el plano lo hace desde −Y, así que gira en sentido horario
    const arco = lineas(e, "F1").find((p) => p.puntos.length === 25)!;
    expect(arco.puntos.every((q) => Math.abs(Math.hypot(q[0] - 3, q[1] - 3) - R_MOMENTO) < 1e-9)).toBe(true);
    const ang = (q: Vec2) => Math.atan2(q[1] - 3, q[0] - 3);
    expect(ang(arco.puntos[1]!)).toBeLessThan(ang(arco.puntos[0]!));
    // M2: M = (4, 0, 0), según u: de (5, 3) hacia +u, con dos puntas; sin arco, y no es «normal al plano»
    const m2 = lineas(e, "M2");
    expect(m2.some((p) => p.puntos.length === 2 && cerca(p.puntos[0]!, [5, 3]) && cerca(p.puntos[1]!, [5 + 2 * R_MOMENTO, 3]))).toBe(true);
    expect(m2.filter((p) => p.puntos.length === 3).length).toBe(2);
    expect(m2.some((p) => p.puntos.length === 25)).toBe(false);
    expect(e.primitivas.some((p) => p.tipo === "texto" && p.objeto === "M2" && !p.texto.includes("normal al plano"))).toBe(true);
  });

  it("los momentos en planta: (Mx, My) de doble punta y Mz en un arco antihorario si es positivo", () => {
    const g: ModeloFisico = { ...MANO, cargas: [{ tipo: "puntual", id: "F3", caso: "Q", planta: "N1", x: 3, y: 2, F: [0, 0, -1], M: [0, 5, 2] }] } as ModeloFisico;
    const x = vistaCargas(g, "N1", "Q", d);
    const ls = x.primitivas.filter((p): p is Extract<Primitiva, { tipo: "linea" }> => p.tipo === "linea" && p.objeto === "F3");
    expect(ls.some((p) => p.puntos.length === 2 && cerca(p.puntos[0]!, [3, 2]) && cerca(p.puntos[1]!, [3, 2 + 2 * R_MOMENTO]))).toBe(true);
    const arco = ls.find((p) => p.puntos.length === 25)!;
    const ang = (q: Vec2) => Math.atan2(q[1] - 2, q[0] - 3);
    expect(ang(arco.puntos[1]!)).toBeGreaterThan(ang(arco.puntos[0]!));
  });

  it("los momentos en el 3D: una flecha de doble punta en la dirección de M, que sale del punto", () => {
    const r = cargas3D(MANO, [0, 0, 0], "Q");
    const k = r.objetos.findIndex((o) => o.id === "M2");
    expect(k).toBeGreaterThanOrEqual(0);
    const S = r.segmentos;
    // En Float32
    const cerca32 = (a: readonly number[], b: readonly number[]) => a.every((x, j) => Math.abs(x - b[j]!) < 1e-5);
    const fuste = [...r.objetoSegmento.keys()].filter((i) => r.objetoSegmento[i] === k && cerca32([S[6 * i]!, S[6 * i + 1]!, S[6 * i + 2]!], [5, 0, 3]));
    expect(fuste.length).toBe(1);
    const i = fuste[0]!;
    expect(cerca32([S[6 * i + 3]!, S[6 * i + 4]!, S[6 * i + 5]!], [5 + 0.6 * m, 0, 3])).toBe(true);
    // Fuste y dos puntas de cuatro trazos
    expect([...r.objetoSegmento].filter((x) => x === k).length).toBe(9);
  });

  it("la escala pedida multiplica las ordenadas", () => {
    const x = vistaAlzadoCargas(MANO, PLANO, "Q", d, 2);
    expect(cerca(cajaDe(bloque(x, "VA-q")!.anillos[0]!), [0, 3, 6, 3 + 2 * m])).toBe(true);
  });
});
