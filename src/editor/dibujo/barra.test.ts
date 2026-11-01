/**
 * BN3 (`docs/fem3d/barras.md` §6): la herramienta Barra en un alzado y en planta. Lo dibujado es, byte
 * a byte, lo que da su fila de la tabla Barras (el criterio); el índice del alzado vuelve de (u, z) al
 * punto del modelo exacto (nudos de pilares con punto fijo y cambio de sección, cruces, caras, líneas
 * de nivel); y el primer extremo sigue al pasar a otra vista.
 */
import { describe, expect, it } from "vitest";
import { planoDeEje, type PlanoAlzado } from "../../agente/render/alzado.ts";
import type { Proyecto } from "../../agente/proyecto.ts";
import { compilar } from "../../compilador/compilar.ts";
import type { Barra, ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import { porticoArriostrado } from "../../pruebas/barras.ts";
import { escribirFila } from "../edicion.ts";
import { deshacer, hacer, historial } from "../historial.ts";
import { aplicar } from "../operaciones.ts";
import { proyectoNuevo } from "../plantilla.ts";
import { serializar } from "../serializar.ts";
import { contexto, DEF_TABLAS } from "../tablas.ts";
import { indiceAlzado, puntoEnVista, puntoModeloAlzado } from "./alzado.ts";
import { barraDe, LIBERACIONES_ARTICULADA } from "./barra.ts";
import { apuntar, enganchar, indiceEnganches, RADIO_ENGANCHE, type IndiceEnganches } from "./enganches.ts";
import { ESTADO_INICIAL, borrador, paso, ultimoPunto, type ContextoHerramienta, type EstadoHerramienta, type Evento, type Plantillas } from "./herramientas.ts";
import { leerEntrada, resolverEntrada } from "./teclado.ts";

/** El pórtico arriostrado sin sus barras (ni la carga de T1): lo que se dibuja encima. */
function sinBarras(): Proyecto {
  const f = porticoArriostrado();
  return { ...proyectoNuevo("bn3"), modelo: { ...f, barras: [], cargas: f.cargas!.filter((c) => c.tipo !== "barra") } };
}

const RADIO = RADIO_ENGANCHE / 50;
const X: Plantillas = { pilar: {}, viga: {}, barraNiveles: { seccion: "r", soloTraccion: true, articulada: true } };
const T: Plantillas = { pilar: {}, viga: {}, barraNiveles: { seccion: "t" } };

/** Una vista: un alzado (por su eje) o una planta. */
type Lugar = { eje: string } | { planta: string };
const plano = (m: ModeloFisico, eje: string): PlanoAlzado => planoDeEje(m, eje)!;
const indice = (m: ModeloFisico, l: Lugar): IndiceEnganches => ("eje" in l ? indiceAlzado(m, plano(m, l.eje), `alzado ${l.eje}`) : indiceEnganches(m, l.planta));
const ctx = (p: Proyecto, l: Lugar, t: Plantillas): ContextoHerramienta => ({ modelo: p.modelo, planta: "planta" in l ? l.planta : `alzado ${l.eje}`, indice: indice(p.modelo, l), plantillas: t });

/** Un clic enganchado en q de la vista l (10 px a 50 px/m), como lo da el controlador. */
function clic(p: Proyecto, l: Lugar, q: Vec2, e: EstadoHerramienta): Evento {
  const ix = indice(p.modelo, l);
  const a = apuntar(ix, q, RADIO, { ultimo: ultimoPunto(e, ix) });
  return { tipo: "punto", p: a.p, enganche: a.enganche, cursor: q, radio: RADIO };
}

/** Un punto tecleado en la vista l («u; z» en un alzado), sin enganche. */
function tecleado(p: Proyecto, l: Lugar, texto: string, e: EstadoHerramienta): Evento {
  const ix = indice(p.modelo, l);
  const v = leerEntrada(texto);
  if (!v.ok) throw new Error(v.mensaje);
  const r = resolverEntrada(v.valor, { ultimo: ultimoPunto(e, ix), cursor: null, direccion: ix.direccion, orto: false, mayus: false });
  if (!r.ok) throw new Error(r.mensaje);
  return { tipo: "punto", p: r.valor };
}

/** Dónde se ve en la vista l el punto (planta, x, y). */
const en = (p: Proyecto, l: Lugar, planta: string, xy: Vec2): Vec2 => puntoEnVista({ planta, p: xy }, indice(p.modelo, l))!;

/** Dibuja paso a paso; cada paso, su vista, su plantilla y su evento (que puede depender del estado). */
function dibujar(p: Proyecto, pasos: [Lugar, Plantillas, (q: Proyecto, e: EstadoHerramienta) => Evento][]) {
  let q = p;
  let e: EstadoHerramienta = ESTADO_INICIAL;
  const errores: string[] = [];
  const etiquetas: string[] = [];
  for (const [l, t, ev] of pasos) {
    const r = paso("barraNiveles", e, ev(q, e), ctx(q, l, t));
    e = r.estado;
    if (r.error) errores.push(r.error);
    if (r.hecho) {
      const a = aplicar(q, r.hecho.operacion);
      if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
      q = a.proyecto;
      etiquetas.push(r.hecho.etiqueta);
    }
  }
  return { proyecto: q, estado: e, errores, etiquetas };
}

/** La fila de la tabla de una barra (sin id: la tabla le da el siguiente). */
function conFila(p: Proyecto, b: Barra): Proyecto {
  const { id: _, ...fila } = DEF_TABLAS.barras.fila(b as never, contexto(p.modelo));
  const a = escribirFila(p, "barras", null, fila);
  if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
  return a.proyecto;
}

const A = { eje: "eje-A" }; // y = 0, u = x + 2
const B = { eje: "eje-B" }; // y = 4

describe("Barra: lo dibujado es la fila de la tabla (criterio de BN3)", () => {
  it("las cuatro barras del pórtico arriostrado: la cruz y el tornapuntas en sus alzados, la diagonal en planta", () => {
    const p = sinBarras();
    const r = dibujar(p, [
      // La cruz, en el alzado de y = 0: del nudo de A en C al de B en P1, y del de B en C al de A en P1
      [A, X, (q) => clic(q, A, en(q, A, "C", [0, 0]), ESTADO_INICIAL)],
      [A, X, (q, e) => clic(q, A, en(q, A, "P1", [5, 0]), e)],
      [A, X, (q) => clic(q, A, [7.03, 0.04], ESTADO_INICIAL)],
      [A, X, (q, e) => clic(q, A, [1.98, 2.97], e)],
      // El tornapuntas, en el de y = 4: del nudo de C1 en P1, 1,5 m a lo largo y 3 arriba (tecleado)
      [B, T, (q) => clic(q, B, en(q, B, "P1", [0, 4]), ESTADO_INICIAL)],
      [B, T, (q, e) => tecleado(q, B, "@1,5; 3", e)],
      // La diagonal, en planta: del nudo de D en C a un punto de la losa de P1 (la de la plantilla)
      [{ planta: "C" }, { ...T, barraNiveles: { seccion: "t", giro: 30, fin: "P1" } }, (q) => clic(q, { planta: "C" }, [5.01, 3.99], ESTADO_INICIAL)],
      [{ planta: "C" }, { ...T, barraNiveles: { seccion: "t", giro: 30, fin: "P1" } }, (q, e) => tecleado(q, { planta: "C" }, "3,5; 3", e)],
    ]);
    expect(r.errores).toEqual([]);
    expect(r.etiquetas).toEqual(["Barra B1, de C a P1", "Barra B2, de C a P1", "Barra B3, de P1 a P2", "Barra B4, de C a P1"]);
    // Las del pórtico, con los ids de lo dibujado
    const ref = porticoArriostrado().barras!.map((b, i) => ({ ...b, id: `B${i + 1}` }));
    expect(r.proyecto.modelo.barras).toEqual(ref);
    // Byte a byte con sus filas de la tabla, una a una
    let t = p;
    for (const b of ref) t = conFila(t, b);
    expect(serializar(r.proyecto)).toBe(serializar(t));
    // Y compila con los extremos en sus nudos, sin fusiones ni errores
    const c = compilar(r.proyecto.modelo);
    expect(c.valido).toBe(true);
    expect(c.diagnosticos.filter((d) => d.severidad === "error" || d.codigo === "topologia/fusion")).toEqual([]);
  });

  it("deshacer cada barra deja el proyecto de partida", () => {
    const p = sinBarras();
    let h = historial(p);
    let e: EstadoHerramienta = ESTADO_INICIAL;
    for (const [m, xy] of [["C", [0, 0]], ["P1", [5, 0]], ["P1", [0, 0]], ["P2", [5, 0]]] as const) {
      const r = paso("barraNiveles", e, clic(h.actual, A, en(h.actual, A, m, xy as Vec2), e), ctx(h.actual, A, X));
      e = r.estado;
      if (!r.hecho) continue;
      const a = aplicar(h.actual, r.hecho.operacion);
      if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
      h = hacer(h, a.proyecto, r.hecho.etiqueta);
    }
    expect(h.actual.modelo.barras?.map((b) => b.id)).toEqual(["B1", "B2"]);
    h = deshacer(deshacer(h));
    expect(serializar(h.actual)).toBe(serializar(p));
  });
});

describe("Barra: el índice del alzado", () => {
  it("el nudo de un pilar es el eje del tramo de debajo; en su base, el de encima; y sus caras se ven desde el plano", () => {
    const f = porticoArriostrado();
    // A con el punto fijo en su esquina inferior izquierda y un 40 × 40 en el tramo de C a P1
    const m: ModeloFisico = {
      ...f,
      secciones: [...f.secciones, { id: "p40", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 }],
      pilares: f.pilares!.map((x) => (x.id === "A" ? { ...x, x: -0.15, y: -0.15, fijo: "esquina-inferior-izquierda" as const, tramos: [{ planta: "P1", seccion: "p40" }] } : x)),
      ejes: [{ id: "EA", desde: [-2, 0], hasta: [7, 0] }],
    };
    const ix = indiceAlzado(m, plano(m, "EA"), "a");
    const de = (tipo: string, planta: string) => ix.puntos.filter((x) => x.objeto === "A" && x.tipo === tipo && x.modelo!.planta === planta).map((x) => x.modelo!.p);
    // C (la base) y P1, con el tramo de C a P1 (40 × 40); P2, con el de encima (30 × 30)
    expect(de("centro", "C")).toEqual([[-0.15 + 0.2, -0.15 + 0.2]]);
    expect(de("centro", "P1")).toEqual([[-0.15 + 0.2, -0.15 + 0.2]]);
    expect(de("centro", "P2")).toEqual([[0, 0]]);
    expect(de("cara", "P1")).toEqual([[-0.15, -0.15 + 0.2], [0.25, -0.15 + 0.2]]);
    expect(de("cara", "P2")).toEqual([[-0.15, 0], [0.15, 0]]);
    // En la vista, en (u, z): u = x + 2
    const c = ix.puntos.find((x) => x.objeto === "A" && x.tipo === "centro" && x.modelo!.planta === "P2")!;
    expect(c.p).toEqual([2, 6]);
  });

  it("una viga que cruza el plano, un eje y un muro: su cruce exacto en cada nivel", () => {
    const f = porticoArriostrado();
    const m: ModeloFisico = {
      ...f,
      ejes: [
        { id: "EA", desde: [-2, 0], hasta: [7, 0] },
        { id: "E3", desde: [2.7, -1], hasta: [2.7, 5] },
      ],
      vigas: [...f.vigas!, { id: "Vy", planta: "P2", puntos: [[3.3, -1], [3.3, 4]], seccion: "v" }],
      muros: [{ id: "M", puntos: [[4.1, -2], [4.1, 1]], desde: "C", hasta: "P1", espesor: 0.25, material: "HA" }],
    };
    const ix = indiceAlzado(m, plano(m, "EA"), "a");
    const cruces = (id: string) => ix.puntos.filter((x) => x.objeto === id && x.tipo === "cruce").map((x) => [x.modelo!.planta, ...x.modelo!.p]);
    expect(cruces("Vy")).toEqual([["P2", 3.3, 0]]);
    expect(cruces("E3")).toEqual([["P2", 2.7, 0], ["P1", 2.7, 0], ["C", 2.7, 0]]);
    expect(cruces("M")).toEqual([["P1", 4.1, 0], ["C", 4.1, 0]]);
    // Las vigas paralelas: sus extremos y su punto medio, en su planta
    const v = ix.puntos.filter((x) => x.objeto === "V-P1-0").map((x) => [x.tipo, ...x.modelo!.p]);
    expect(v).toEqual([["extremo", 0, 0], ["extremo", 5, 0], ["medio", 2.5, 0]]);
  });

  it("un punto fuera de los niveles no es un extremo; a 1 mm de uno, sí, en el plano y redondeado", () => {
    const p = sinBarras();
    const ix = indiceAlzado(p.modelo, plano(p.modelo, "eje-A"), "a");
    const a = ix.alzado!;
    expect(puntoModeloAlzado(a, [3.1, 1.5])).toBeNull();
    expect(puntoModeloAlzado(a, [3.1, 3.0009])).toEqual({ planta: "P1", p: [1.1, 0] });
    const r = dibujar(p, [[A, X, () => ({ tipo: "punto", p: [3.1, 1.5] })]]);
    expect(r.errores[0]).toMatch(/de planta a planta/);
    expect(r.estado.extremo).toBeUndefined();
    // En la línea de nivel, sin nada cerca: el más cercano, redondeado
    const e = enganchar(ix, [3.3000000000000003, 3.05], RADIO);
    expect(e?.tipo).toBe("cercano");
    expect(e?.modelo).toEqual({ planta: "P1", p: [1.3, 0] });
  });

  it("una barra vertical: la perpendicular desde el primer extremo a otro nivel", () => {
    const p = sinBarras();
    // Del punto medio de la viga de P1 a la línea de nivel de C, bajo él
    const r = dibujar(p, [
      [A, T, (q) => clic(q, A, [4.52, 2.98], ESTADO_INICIAL)],
      [A, T, (q, e) => clic(q, A, [4.45, 0.08], e)],
    ]);
    expect(r.errores).toEqual([]);
    const b = r.proyecto.modelo.barras![0]!;
    expect([b.inicio, b.fin]).toEqual([{ planta: "P1", x: 2.5, y: 0 }, { planta: "C", x: 2.5, y: 0 }]);
  });

  it("en un alzado girado, el nudo de un pilar es su (x, y) bit a bit", () => {
    const f = porticoArriostrado();
    const g = (30 * Math.PI) / 180;
    const rot = ([x, y]: Vec2): Vec2 => [x * Math.cos(g) - y * Math.sin(g), x * Math.sin(g) + y * Math.cos(g)];
    const pilares = f.pilares!.map((x) => {
      const [a, b] = rot([x.x, x.y]);
      return { ...x, x: a, y: b, giro: 30 };
    });
    const m: ModeloFisico = { ...f, pilares, vigas: [], losas: [], barras: [], ejes: [{ id: "R", desde: rot([-2, 0]), hasta: rot([7, 0]) }] };
    const ix = indiceAlzado(m, plano(m, "R"), "a");
    const B = m.pilares!.find((x) => x.id === "B")!;
    const e = enganchar(ix, puntoEnVista({ planta: "P1", p: [B.x, B.y] }, ix)!, RADIO);
    expect(e?.tipo).toBe("centro");
    expect(e?.modelo).toEqual({ planta: "P1", p: [B.x, B.y] });
  });
});

describe("Barra: entre vistas y en planta", () => {
  it("el primer extremo, en un alzado; el segundo, en la planta de otra vista", () => {
    const p = sinBarras();
    const r0 = dibujar(p, [[A, X, (q) => clic(q, A, en(q, A, "C", [0, 0]), ESTADO_INICIAL)]]);
    expect(r0.estado.extremo).toEqual({ planta: "C", p: [0, 0] });
    // En la planta P1, el primer extremo se ve en su (x, y) y la línea va hasta el cursor
    const c = ctx(p, { planta: "P1" }, X);
    const b = borrador("barraNiveles", r0.estado, [5, 4], c);
    expect(b.puntos).toEqual([[0, 0]]);
    expect(b.lineas).toEqual([[[0, 0], [5, 4]]]);
    // El segundo clic, en la planta P1: el nudo de D
    const r = paso("barraNiveles", r0.estado, clic(p, { planta: "P1" }, [5.02, 3.98], r0.estado), c);
    expect(r.hecho).toBeDefined();
    expect(r.hecho!.operacion).toEqual({ op: "crear", coleccion: "barras", objeto: { id: "B1", ...barraDe({ planta: "C", p: [0, 0] }, { planta: "P1", p: [5, 4] }, X.barraNiveles!) } });
  });

  it("en planta, sin planta del fin en la plantilla, la barra va en el plano de la vista", () => {
    const p = sinBarras();
    const r = dibujar(p, [
      [{ planta: "P2" }, T, (q) => clic(q, { planta: "P2" }, [5.02, 0.01], ESTADO_INICIAL)],
      [{ planta: "P2" }, T, (q, e) => clic(q, { planta: "P2" }, [0.01, 3.99], e)],
    ]);
    expect(r.proyecto.modelo.barras).toEqual([{ id: "B1", inicio: { planta: "P2", x: 5, y: 0 }, fin: { planta: "P2", x: 0, y: 4 }, seccion: "t" }]);
  });

  it("sin sección, un doble clic, Retroceso y Esc", () => {
    const p = sinBarras();
    const sin = dibujar(p, [[A, { pilar: {}, viga: {} }, (q) => clic(q, A, en(q, A, "C", [0, 0]), ESTADO_INICIAL)]]);
    expect(sin.errores).toEqual(["Elija en Propiedades la sección de la barra (o cree una)."]);
    const q0 = en(p, A, "C", [0, 0]);
    // El segundo clic de un doble clic, en el mismo punto, no es una barra
    const doble = dibujar(p, [
      [A, X, (q) => clic(q, A, q0, ESTADO_INICIAL)],
      [A, X, (q, e) => clic(q, A, q0, e)],
    ]);
    expect(doble.etiquetas).toEqual([]);
    expect(doble.estado.extremo).toBeDefined();
    expect(paso("barraNiveles", doble.estado, { tipo: "retroceso" }, ctx(p, A, X)).estado).toBe(ESTADO_INICIAL);
    expect(paso("barraNiveles", doble.estado, { tipo: "anular" }, ctx(p, A, X)).estado).toBe(ESTADO_INICIAL);
    expect(paso("barraNiveles", ESTADO_INICIAL, { tipo: "anular" }, ctx(p, A, X)).salir).toBe(true);
  });

  it("articulada: las liberaciones de la diagonal del pórtico", () => {
    expect(LIBERACIONES_ARTICULADA).toEqual(porticoArriostrado().barras![0]!.liberaciones);
  });
});
