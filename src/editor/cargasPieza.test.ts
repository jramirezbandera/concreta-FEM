/**
 * Las cargas sobre una pieza (`cargasPieza.ts`) frente a sus valores a mano: áreas, longitudes y
 * presiones en números redondos, sin el compilador. Y la carga que se añade desde la pieza, frente a
 * la de su herramienta con un clic en ella (`dibujo/cargas.ts`), byte a byte.
 */
import { describe, expect, it } from "vitest";
import type { Proyecto } from "../agente/proyecto.ts";
import type { ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { cargaEnPieza, cargasPieza, resumenCaso, tipoPieza } from "./cargasPieza.ts";
import { apuntar, indiceEnganches, RADIO_ENGANCHE } from "./dibujo/enganches.ts";
import { ESTADO_INICIAL, paso, type NombreHerramienta, type Plantillas } from "./dibujo/herramientas.ts";
import { escribirFila } from "./edicion.ts";
import { aplicar } from "./operaciones.ts";
import { proyectoNuevo } from "./plantilla.ts";
import { serializar } from "./serializar.ts";

const modelo = (): ModeloFisico => ({
  plantas: [
    { id: "N1", altura: null },
    { id: "N0", altura: 3 },
  ],
  materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
  secciones: [
    { id: "P30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
    { id: "V30", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
  ],
  pilares: [{ id: "P1", x: 0, y: 0, desde: "N0", hasta: "N1", seccion: "P30" }],
  vigas: [{ id: "V1", planta: "N1", puntos: [[0, 0], [4, 0], [4, 3]], seccion: "V30" }],
  muros: [{ id: "M1", puntos: [[0, 0], [0, 4]], desde: "N0", hasta: "N1", espesor: 0.25, material: "HA", huecos: [{ desde: 1, hasta: 2, z0: 0, z1: 1 }] }],
  // 8 × 6 = 48 m², con un hueco de 2 × 2: 44 m²
  losas: [
    { id: "L", planta: "N1", contorno: [[0, 0], [8, 0], [8, 6], [0, 6]], huecos: [[[3, 2], [5, 2], [5, 4], [3, 4]]], espesor: 0.25, material: "HA", pp: 6 },
    { id: "L2", planta: "N1", contorno: [[8, 0], [10, 0], [10, 6], [8, 6]], espesor: 0.2, material: "HA" },
  ],
  casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
  cargas: [
    { tipo: "superficie", id: "S1", caso: "G", planta: "N1", losa: "L", q: [0, 0, -2] },
    // La zona de x = 6 a 10: 12 m² en L y 12 en L2
    { tipo: "superficie", id: "S2", caso: "Q", planta: "N1", zona: [[6, 0], [10, 0], [10, 6], [6, 6]], q: [0, 0, -3] },
    { tipo: "superficie", id: "S3", caso: "Q", planta: "N1", losa: "L2", q: [0, 0, -1] },
    // De x = −2 a 9 por y = 1: 8 m en L y 1 en L2
    { tipo: "lineal", id: "Li", caso: "Q", planta: "N1", puntos: [[-2, 1], [9, 1]], q: [0, 0, -5] },
    { tipo: "puntual", id: "F1", caso: "Q", planta: "N1", x: 1, y: 5, F: [1, 0, -10] },
    // En el hueco: no cae en L
    { tipo: "puntual", id: "F2", caso: "Q", planta: "N1", x: 4, y: 3, F: [0, 0, -7] },
    // En V1, de 1 a 6 (pasa la esquina): 5 m a −4 kN/m
    { tipo: "viga", id: "Bv", caso: "Q", viga: "V1", ejes: "global", q: [0, 0, -4], desde: 1, hasta: 6 },
    // En V1, local, y hacia +y local en el primer tramo: −Y… en global, entera (7 m)
    { tipo: "viga", id: "Bl", caso: "G", viga: "V1", ejes: "local", q: [0, 0, -1] },
    { tipo: "pilar", id: "Bp", caso: "Q", pilar: "P1", ejes: "global", q: [2, 0, 0], qb: [4, 0, 0] },
    // Muro de 4 m y 3 de alto, 0 → 10 kN/m² de 0 a 3, sin el hueco de 1 × 1 (de 0 a 1 de alto)
    { tipo: "empuje", id: "E", caso: "Q", muro: "M1", lado: "izquierdo", z0: 0, z1: 3, p0: 0, p1: 10 },
  ],
});

const de = (r: ReturnType<typeof cargasPieza>, caso: string) => r!.casos.find((c) => c.caso === caso)!;
const F = (r: ReturnType<typeof cargasPieza>, caso: string, id: string) => de(r, caso).cargas.find((c) => c.carga.id === id);

describe("cargas sobre una pieza", () => {
  it("el tipo de cada id; lo que no recibe cargas, null", () => {
    const m = modelo();
    expect(["L", "V1", "P1", "M1", "N1", "S1", "nada"].map((id) => tipoPieza(m, id))).toEqual(["losa", "viga", "pilar", "muro", null, null, null]);
    expect(cargasPieza(m, "S1")).toBeNull();
  });

  it("forjado: su superficie, su parte de una zona y de una lineal, y las puntuales dentro (no en el hueco)", () => {
    const r = cargasPieza(modelo(), "L");
    expect(de(r, "G").cargas.map((c) => c.carga.id)).toEqual(["S1"]);
    expect(F(r, "G", "S1")!.F[2]).toBeCloseTo(-2 * 44, 10);
    expect(de(r, "Q").cargas.map((c) => c.carga.id)).toEqual(["S2", "Li", "F1"]);
    expect(F(r, "Q", "S2")).toMatchObject({ parte: true });
    expect(F(r, "Q", "S2")!.F[2]).toBeCloseTo(-3 * 12, 10);
    expect(F(r, "Q", "Li")).toMatchObject({ parte: true });
    expect(F(r, "Q", "Li")!.F[2]).toBeCloseTo(-5 * 8, 10);
    expect(F(r, "Q", "F1")!.F).toEqual([1, 0, -10]);
    expect(de(r, "Q").F[2]).toBeCloseTo(-36 - 40 - 10, 10);
    expect(de(r, "Q").F[0]).toBeCloseTo(1, 12);
    // El de L2: su carga, su parte de la zona y su metro de lineal
    const r2 = cargasPieza(modelo(), "L2");
    expect(de(r2, "Q").cargas.map((c) => c.carga.id)).toEqual(["S2", "S3", "Li"]);
    expect(de(r2, "Q").F[2]).toBeCloseTo(-36 - 12 - 5, 10);
  });

  it("viga: un tramo que pasa la esquina y una local; pilar con q lineal; muro sin su hueco", () => {
    const v = cargasPieza(modelo(), "V1");
    expect(F(v, "Q", "Bv")!.F[2]).toBeCloseTo(-4 * 5, 10);
    expect(F(v, "G", "Bl")!.F[2]).toBeCloseTo(-7, 10);
    const p = cargasPieza(modelo(), "P1");
    // 3 m de 2 a 4 kN/m
    expect(F(p, "Q", "Bp")!.F[0]).toBeCloseTo(9, 10);
    const w = cargasPieza(modelo(), "M1");
    // ½·10·3·4 = 60, menos el hueco: 1 m × ∫₀¹ (10/3)·z dz = 5/3
    const e = F(w, "Q", "E")!.F;
    expect(Math.hypot(...e)).toBeCloseTo(60 - 5 / 3, 10);
    expect(e[2]).toBe(0);
  });

  it("el peso propio, en el caso que lo lleva: el del forjado con su pp; el de las barras, γ·A", () => {
    const r = cargasPieza(modelo(), "L")!;
    expect(r.pesoPropio).toMatchObject({ caso: "G", unidad: 6, queUnidad: "kN/m²" });
    expect(r.pesoPropio!.total).toBeCloseTo(6 * 44, 10);
    const v = cargasPieza(modelo(), "V1")!;
    expect(v.pesoPropio).toMatchObject({ caso: "G", queUnidad: "kN/m" });
    expect(v.pesoPropio!.unidad).toBeCloseTo(25 * 0.3 * 0.5, 10);
    const m = { ...modelo(), casos: [{ id: "G" }, { id: "Q" }] };
    expect(cargasPieza(m, "L")!.pesoPropio!.caso).toBeNull();
  });
});

describe("resumen de un caso en una planta", () => {
  it("por tipo, con la superficie por zona sólo en los forjados y las de pilares y muros en su cabeza", () => {
    const r = resumenCaso(modelo(), "Q", "N1");
    expect(r.map((x) => [x.tipo, x.n])).toEqual([["superficie", 2], ["lineal", 1], ["puntual", 2], ["viga", 1], ["pilar", 1], ["empuje", 1]]);
    const de = (t: string) => r.find((x) => x.tipo === t)!.F;
    // La zona: 12 m² en L y 12 en L2, a 3; S3: 12 m² de L2, a 1
    expect(de("superficie")[2]).toBeCloseTo(-72 - 12, 10);
    // La lineal entera: 11 m
    expect(de("lineal")[2]).toBeCloseTo(-55, 10);
    expect(de("puntual")[2]).toBeCloseTo(-17, 12);
    expect(resumenCaso(modelo(), "Q", "N0")).toEqual([]);
  });
});

describe("añadir una carga desde la pieza", () => {
  const conTabla = (p: Proyecto, tabla: Parameters<typeof escribirFila>[1], fila: Record<string, string>) => {
    const a = escribirFila(p, tabla, null, fila);
    if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
    return a.proyecto;
  };
  const proyecto = (): Proyecto => {
    const p0 = proyectoNuevo("cargas");
    const secciones = [
      { id: "P30", material: "HA-30", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "V30x50", material: "HA-30", forma: "rectangular", b: 0.3, h: 0.5 },
    ] as unknown as ModeloFisico["secciones"];
    let p: Proyecto = { ...p0, modelo: { ...p0.modelo, secciones } };
    for (const [x, y] of [[0, 0], [5, 0], [0, 6], [5, 6]]) p = conTabla(p, "pilares", { x: String(x), y: String(y), desde: "Cim", hasta: "N1", seccion: "P30" });
    for (const ps of ["0 0; 5 0", "0 6; 5 6", "0 0; 0 6", "5 0; 5 6"]) p = conTabla(p, "vigas", { planta: "N1", puntos: ps, seccion: "V30x50" });
    p = conTabla(p, "forjados", { planta: "N1", tipo: "maciza", contorno: "0 0; 5 0; 5 6; 0 6", espesor: "0,25", material: "HA-30" });
    return conTabla(p, "muros", { puntos: "7 1; 9 1", desde: "Cim", hasta: "N1", espesor: "0,25", material: "HA-30" });
  };
  /** Lo que deja la herramienta h con un clic en q. */
  const conHerramienta = (p: Proyecto, h: NombreHerramienta, q: Vec2, plantillas: Plantillas) => {
    const radio = RADIO_ENGANCHE / 50;
    const indice = indiceEnganches(p.modelo, "N1");
    const a = apuntar(indice, q, radio, { ultimo: null });
    const r = paso(h, ESTADO_INICIAL, { tipo: "punto", p: a.p, enganche: a.enganche, cursor: q, radio }, { modelo: p.modelo, planta: "N1", indice, plantillas });
    if (!r.hecho) throw new Error(r.error ?? "sin carga");
    const x = aplicar(p, r.hecho.operacion);
    if (!x.ok) throw new Error(x.errores.map((y) => y.mensaje).join(" "));
    return { texto: serializar(x.proyecto), etiqueta: r.hecho.etiqueta };
  };
  const desdePieza = (p: Proyecto, id: string, t: NonNullable<Plantillas["cargas"]>, lado?: "izquierdo" | "derecho") => {
    const r = cargaEnPieza(p.modelo, t, id, lado);
    if (typeof r === "string") throw new Error(r);
    const a = aplicar(p, r.operacion);
    if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
    return { texto: serializar(a.proyecto), etiqueta: r.etiqueta };
  };

  it("superficie en un forjado, en barra en una viga y un pilar, y un empuje: lo mismo que la herramienta", () => {
    const p = proyecto();
    const casos: [NombreHerramienta, Vec2, string, NonNullable<Plantillas["cargas"]>, ("izquierdo" | "derecho")?][] = [
      ["superficie", [2, 3], "L1", { caso: "G", superficie: { q: [0, 0, -2] } }],
      ["barra", [2.5, 0.02], "V1", { caso: "Q", barra: { q: [0, 0, -5], qb: [0, 0, -7] } }],
      ["barra", [5.02, 6.02], "P4", { caso: "G", barra: { q: [2, 0, 0], ejes: "local" } }],
      ["empuje", [8, 0.92], "M1", { caso: "G", empuje: { z1: 3, p0: 20 } }, "derecho"],
    ];
    for (const [h, q, id, t, lado] of casos) {
      expect(tipoPieza(p.modelo, id)).not.toBeNull();
      expect(desdePieza(p, id, t, lado)).toEqual(conHerramienta(p, h, q, { pilar: {}, viga: {}, cargas: t }));
    }
  });

  it("sin caso, sin valor, sin lado o con z1 ≤ z0, por qué no", () => {
    const m = proyecto().modelo;
    expect(cargaEnPieza(m, { superficie: { q: [0, 0, -2] } }, "L1")).toMatch(/caso activo/);
    expect(cargaEnPieza(m, { caso: "G" }, "L1")).toMatch(/kN\/m²/);
    expect(cargaEnPieza(m, { caso: "G", barra: { q: [0, 0, 0] } }, "V1")).toMatch(/kN\/m/);
    expect(cargaEnPieza(m, { caso: "G", empuje: { z1: 3, p0: 20 } }, "M1")).toMatch(/lado/);
    expect(cargaEnPieza(m, { caso: "G", empuje: { z0: 3, z1: 3, p0: 20 } }, "M1", "derecho")).toMatch(/mayor que z0/);
    expect(cargaEnPieza(m, { caso: "G" }, "N1")).toMatch(/no es un forjado/);
  });
});
