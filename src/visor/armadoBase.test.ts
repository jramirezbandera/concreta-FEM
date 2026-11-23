/**
 * CO6 (`docs/fem3d/comprobaciones.md` §8.20): la armadura base de una losa, barra a barra; el armado de
 * las losas en el 3D con el objeto de cada línea; y el sólido sin los casetones de los reticulares.
 */
import { describe, expect, it } from "vitest";
import { regionesLosas } from "../agente/render/armado.ts";
import { nerviosLosa } from "../compilador/abacos.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import type { Losa, ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import type { ArmadoForjado } from "../comprobaciones/armado.ts";
import { baseDibujada, BARRAS_BASE_MAXIMAS, DESVIO_BASE } from "./armadoBase.ts";
import { armadoLosas3D } from "./armadoLosas3d.ts";
import { CLASE_BASE, CLASE_CERCOS, SIN_OBJETO } from "./diagramas3d.ts";
import { piezasSolido, volumen } from "./solido.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const MACIZA: Losa = { id: "L1", planta: "P1", material: "HA", espesor: 0.25, contorno: rect(0, 0, 6, 4), huecos: [rect(2, 1, 3, 2)] } as Losa;
const RETICULAR: Losa = { id: "L2", planta: "P1", material: "HA", espesor: 0.3, contorno: rect(10, 0, 16, 5), reticular: { intereje: 0.8, nervio: 0.12, capa: 0.05, abacos: [rect(10, 0, 11.2, 1.2)] } } as Losa;
const parrilla = { diametro: 12, separacion: 200 };
const A_MACIZA: ArmadoForjado = { base: { "x-inf": parrilla, "x-sup": parrilla, "y-inf": parrilla, "y-sup": { diametro: 10, separacion: 250 } }, refuerzos: [{ armadura: "x-sup", s: [1, 3], t: [0.5, 1.5], barras: parrilla }] };
const nervio = { diametro: 8, n: 2 };
const A_RETICULAR: ArmadoForjado = {
  base: { "x-inf": nervio, "x-sup": { diametro: 16, n: 1 }, "y-inf": nervio, "y-sup": { diametro: 16, n: 1 } },
  refuerzos: [{ armadura: "x-inf", s: [12, 15], t: [1.6, 3.2], barras: { diametro: 12, n: 2 }, en: "nervios" }],
  cercos: [{ direccion: "y", s: [1, 3], t: [12, 13.6], cercos: { diametro: 6, separacion: 150 } }],
} as ArmadoForjado;
const MODELO = {
  plantas: [{ id: "P1", altura: 3 }, { id: "PB", altura: 0 }],
  materiales: [{ id: "HA", tipo: "hormigon", E: 3e7, nu: 0.2, gamma: 25 }],
  secciones: [],
  pilares: [],
  vigas: [],
  losas: [MACIZA, RETICULAR],
  casos: [],
  cargas: [],
} as unknown as ModeloFisico;
const regiones = regionesLosas(MODELO.losas);

describe("§8.20: la armadura base de una losa, barra a barra", () => {
  it("maciza: una barra cada separación, recortada con la losa y su hueco; cada cara, a un lado de su sitio", () => {
    const b = baseDibujada(MACIZA, A_MACIZA, regiones.get("L1"));
    expect(b.map((x) => x.armadura)).toEqual(["x-inf", "x-sup", "y-inf", "y-sup"]);
    const xi = b[0]!;
    expect(xi).toMatchObject({ cara: "inferior", porNervio: false, texto: "Ø12/200", una: 1 });
    // 4 m a 0,20: 20 barras según X; las que cruzan el hueco (y de 1 a 2), en dos trozos
    const ys = [...new Set(xi.tramos.map((t) => Math.round(t[0][1] * 1e6) / 1e6))];
    expect(ys).toHaveLength(20);
    expect(ys[1]! - ys[0]!).toBeCloseTo(0.2, 9);
    // La inferior, DESVIO_BASE hacia −n; la superior, hacia +n: entre las dos, el doble
    const ysSup = [...new Set(b[1]!.tramos.map((t) => Math.round(t[0][1] * 1e6) / 1e6))];
    expect(ysSup[0]! - ys[0]!).toBeCloseTo(2 * DESVIO_BASE, 9);
    for (const [p, q] of xi.tramos) {
      expect(p[1]).toBe(q[1]);
      const enHueco = p[1] > 1 && p[1] < 2;
      // Ningún trozo pasa por dentro del hueco
      if (enHueco) expect(Math.max(p[0], q[0]) <= 2 + 1e-9 || Math.min(p[0], q[0]) >= 3 - 1e-9).toBe(true);
      else expect(Math.abs(q[0] - p[0])).toBeCloseTo(6, 9);
    }
    // Y superior, a 250: 6 m / 0,25 = 24 barras según Y
    expect(new Set(b[3]!.tramos.map((t) => Math.round(t[0][0] * 1e6))).size).toBe(24);
  });

  it("con muchas barras, una de cada pocas; con una cara, sólo la suya; con «cercos» o sin armado, nada", () => {
    const grande: Losa = { ...MACIZA, contorno: rect(0, 0, 6, 40), huecos: [] } as Losa;
    const x = baseDibujada(grande, A_MACIZA, undefined, "inferior");
    expect(x.map((b) => b.armadura)).toEqual(["x-inf", "y-inf"]);
    expect(x[0]!.una).toBe(Math.ceil(200 / BARRAS_BASE_MAXIMAS));
    expect(x[0]!.tramos.length).toBeLessThanOrEqual(BARRAS_BASE_MAXIMAS);
    expect(baseDibujada(MACIZA, A_MACIZA, undefined, "cercos")).toEqual([]);
    expect(baseDibujada(MACIZA, undefined, undefined)).toEqual([]);
  });

  it("reticular: una línea por nervio paralelo a la armadura, en su zona aligerada", () => {
    const b = baseDibujada(RETICULAR, A_RETICULAR, regiones.get("L2"));
    const nervios = nerviosLosa(RETICULAR);
    const segunX = nervios.filter(([p, q]) => Math.abs(q[1] - p[1]) < 1e-9);
    const xi = b.find((x) => x.armadura === "x-inf")!;
    expect(xi).toMatchObject({ porNervio: true, texto: "2Ø8" });
    expect(xi.tramos).toHaveLength(segunX.length);
    expect(b.find((x) => x.armadura === "y-sup")!.tramos).toHaveLength(nervios.length - segunX.length);
    // Cada tramo, el del nervio desplazado como mucho un cuarto de su ancho
    xi.tramos.forEach(([p], i) => {
      expect(p[0]).toBeCloseTo(segunX[i]![0][0], 9);
      expect(Math.abs(p[1] - segunX[i]![0][1])).toBeCloseTo(Math.min(DESVIO_BASE, 0.12 / 4), 9);
    });
  });
});

describe("§8.20: el armado de las losas en el 3D, con el objeto de cada línea", () => {
  const armado = { forjados: { L1: A_MACIZA, L2: A_RETICULAR } };
  const O: [number, number, number] = [0, 0, 0];

  it("cada línea lleva su refuerzo o sus cercos, con los ids de la planta", () => {
    const d = armadoLosas3D(MODELO, O, armado, undefined, { planta: null });
    expect(d.objetos).toEqual(["L1/R1", "L2/R1", "L2/C1"]);
    const n = d.lineas.length / 6;
    expect([d.signoLinea.length, d.objetoLinea!.length, d.claseLinea!.length]).toEqual([n, n, n]);
    expect([...d.objetoLinea!].every((k) => k < d.objetos!.length)).toBe(true);
    // Los cercos, en su clase y a media altura de su losa (canto 0,30)
    const cercos = [...d.objetoLinea!.keys()].filter((i) => d.objetos![d.objetoLinea![i]!] === "L2/C1");
    expect(cercos.length).toBe(4);
    for (const i of cercos) {
      expect(d.claseLinea![i]).toBe(CLASE_CERCOS);
      expect(d.lineas[6 * i + 2]).toBeCloseTo(cotasPlantas(MODELO.plantas)[0]! - 0.15, 5);
    }
    // El refuerzo por nervio: su contorno y una barra por cada uno de sus dos nervios
    expect([...d.objetoLinea!].filter((k) => d.objetos![k] === "L2/R1")).toHaveLength(4 + 2);
  });

  it("la base, sólo si se pide: más tenue, sin objeto, y lo demás igual", () => {
    const sin = armadoLosas3D(MODELO, O, armado, undefined, { planta: null });
    const con = armadoLosas3D(MODELO, O, armado, undefined, { planta: null, base: true });
    expect([...sin.claseLinea!].includes(CLASE_BASE)).toBe(false);
    const base = [...con.claseLinea!.keys()].filter((i) => con.claseLinea![i] === CLASE_BASE);
    expect(base.length).toBeGreaterThan(50);
    for (const i of base) expect(con.objetoLinea![i]).toBe(SIN_OBJETO);
    expect(con.objetos).toEqual(sin.objetos);
    expect(con.lineas.length - 6 * base.length).toBe(sin.lineas.length);
    // Con una cara, la base de esa cara
    const inf = armadoLosas3D(MODELO, O, armado, undefined, { planta: null, base: true, cara: "inferior" });
    expect([...inf.signoLinea].every((x) => x === 0)).toBe(true);
    expect(armadoLosas3D(MODELO, O, armado, undefined, { planta: null, base: true, cara: "cercos" }).objetos).toEqual(["L2/C1"]);
  });
});

describe("§8.20: el sólido sin los casetones de los reticulares", () => {
  it("el reticular queda como una maciza de su canto; lo demás, igual", () => {
    const con = piezasSolido(MODELO).piezas;
    const sin = piezasSolido(MODELO, null, { casetones: false }).piezas;
    const de = (ps: typeof con, id: string) => ps.find((p) => p.id === id)!;
    expect(volumen(de(sin, "L2").caras)).toBeCloseTo(6 * 5 * 0.3, 9);
    expect(volumen(de(con, "L2").caras)).toBeLessThan(6 * 5 * 0.3 - 1);
    expect(de(sin, "L2").casetones).toBeUndefined();
    expect(de(sin, "L1")).toEqual(de(con, "L1"));
  });
});
