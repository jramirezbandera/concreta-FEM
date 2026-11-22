/**
 * Fase CO6 (`docs/fem3d/comprobaciones.md` §8.11): el armado dibujado pone cada barra donde la toma la
 * comprobación. Las secciones (barras dentro del cerco, con el recubrimiento hasta el cerco; tantas
 * como dice el armado), el alzado de un vano (sus zonas y sus cercos) y los refuerzos de una losa en
 * planta (con los ejes de las franjas del compilador).
 */
import { describe, expect, it } from "vitest";
import { ejesArmado } from "../compilador/franjas.ts";
import { barrasDe, type ArmadoForjado, type ArmadoTramoPilar, type ArmadoVanoViga } from "./armado.ts";
import { alzadoVano, armadoDeZona, cercosDibujados, ejesArmadura, PRIMER_CERCO, refuerzosDibujados, seccionPilarArmada, seccionVigaArmada } from "./dibujoArmado.ts";

const REC = 30;

describe("CO6: el armado dibujado", () => {
  it("pilar rectangular: tantas barras como el armado, dentro del cerco y a su recubrimiento", () => {
    const a: ArmadoTramoPilar = { esquinas: 16, caraB: { n: 2, diametro: 12 }, caraH: { n: 1, diametro: 12 }, cercos: { diametro: 8, separacion: 150 } };
    const s = seccionPilarArmada({ b: 300, h: 500 }, a, REC);
    expect(s.barras).toHaveLength(barrasDe(a));
    // x es el canto h e y el ancho b
    expect([s.ancho, s.alto, s.cotas]).toEqual([500, 300, { x: "h", y: "b" }]);
    // El eje del cerco, a recubrimiento + Øc/2 de la cara
    expect(s.cerco).toEqual({ diametro: 8, ancho: 500 - 2 * REC - 8, alto: 300 - 2 * REC - 8 });
    // Cada barra, tocando el cerco por dentro o más adentro: su cara de fuera, a ≥ rec + Øc de las del hormigón
    for (const q of s.barras) {
      expect(500 / 2 - Math.abs(q.x) - q.diametro / 2).toBeGreaterThanOrEqual(REC + 8 - 1e-9);
      expect(300 / 2 - Math.abs(q.y) - q.diametro / 2).toBeGreaterThanOrEqual(REC + 8 - 1e-9);
    }
    // Las de esquina, justo en las esquinas del cerco
    const esquinas = s.barras.filter((q) => q.grupo === "esquinas");
    expect(esquinas.map((q) => [Math.abs(q.x), Math.abs(q.y)])).toEqual(Array(4).fill([250 - REC - 8 - 8, 150 - REC - 8 - 8]));
    // Las de las caras b (las del canto: x = ±), 2 por cara repartidas en y; las de las caras h, 1 por cara en x = 0
    const cb = s.barras.filter((q) => q.grupo === "caraB");
    expect(cb).toHaveLength(4);
    expect(new Set(cb.map((q) => Math.abs(q.x)))).toEqual(new Set([250 - REC - 8 - 6]));
    expect(cb.filter((q) => q.x > 0).map((q) => q.y).sort((p, q) => p - q)).toEqual([-(150 - REC - 16) / 3, (150 - REC - 16) / 3].map((v) => expect.closeTo(v, 9)));
    const ch = s.barras.filter((q) => q.grupo === "caraH");
    expect(ch.map((q) => [q.x, Math.abs(q.y)])).toEqual([[0, 150 - REC - 8 - 6], [0, 150 - REC - 8 - 6]]);
    // Simétrica respecto a los dos ejes
    const clave = (x: number, y: number) => `${x.toFixed(6)},${y.toFixed(6)}`;
    const puestas = new Set(s.barras.map((q) => clave(q.x, q.y)));
    for (const q of s.barras) expect(puestas.has(clave(-q.x, q.y)) && puestas.has(clave(q.x, -q.y))).toBe(true);
    expect(s.avisos).toEqual([]);
  });

  it("pilar circular: las barras del anillo, repartidas en su circunferencia", () => {
    const a: ArmadoTramoPilar = { anillo: { n: 6, diametro: 16 }, cercos: { diametro: 6, separacion: 200 } };
    const s = seccionPilarArmada({ D: 400 }, a, REC);
    expect(s.forma).toBe("circular");
    expect(s.barras).toHaveLength(6);
    for (const q of s.barras) expect(Math.hypot(q.x, q.y)).toBeCloseTo(200 - REC - 6 - 8, 9);
    // Repartidas: la suma de sus posiciones es nula
    expect(Math.hypot(s.barras.reduce((t, q) => t + q.x, 0), s.barras.reduce((t, q) => t + q.y, 0))).toBeLessThan(1e-9);
  });

  it("un armado a medias (el borrador) dibuja lo que tiene, y avisa de las barras que no caben", () => {
    expect(seccionPilarArmada({ b: 300, h: 300 }, undefined, REC).barras).toEqual([]);
    expect(seccionPilarArmada({ b: 300, h: 300 }, { esquinas: 12 }, REC).barras).toHaveLength(4);
    expect(seccionPilarArmada({ b: 300, h: 300 }, { caraB: { n: Number.NaN, diametro: 12 } } as never, REC).barras).toEqual([]);
    // 8 barras de 25 por cara en 30 cm no caben
    const lleno = seccionPilarArmada({ b: 300, h: 300 }, { esquinas: 25, caraB: { n: 8, diametro: 25 }, cercos: { diametro: 8, separacion: 100 } }, REC);
    expect(lleno.avisos.length).toBe(1);
  });

  it("viga: la inferior y la superior de cada zona, las ramas interiores de los cercos y la piel", () => {
    const a: ArmadoVanoViga = { inferior: { n: 3, diametro: 16 }, superior: { n: 2, diametro: 12 }, superiorFin: { n: 4, diametro: 16 }, cercos: { diametro: 8, separacion: 200, ramas: 4 }, cercosInicio: { diametro: 8, separacion: 100 }, piel: { n: 1, diametro: 12 } };
    const centro = seccionVigaArmada({ b: 300, h: 500 }, a, "centro", REC);
    const fin = seccionVigaArmada({ b: 300, h: 500 }, a, "fin", REC);
    const inicio = seccionVigaArmada({ b: 300, h: 500 }, a, "inicio", REC);
    const cuenta = (s: typeof centro, g: string) => s.barras.filter((q) => q.grupo === g).length;
    expect([cuenta(centro, "inferior"), cuenta(centro, "superior"), cuenta(centro, "piel")]).toEqual([3, 2, 2]);
    expect(cuenta(fin, "superior")).toBe(4);
    expect(cuenta(inicio, "superior")).toBe(2);
    // Las ramas: 4 en el centro y en el fin (dos interiores), 2 en el inicio (ninguna interior)
    expect([centro.ramas.length, fin.ramas.length, inicio.ramas.length]).toEqual([2, 2, 0]);
    // La inferior, abajo y de lado a lado del cerco; la superior, arriba
    const inf = centro.barras.filter((q) => q.grupo === "inferior");
    expect(inf.map((q) => q.y)).toEqual(Array(3).fill(-250 + REC + 8 + 8));
    expect(inf.map((q) => q.x)).toEqual([-(150 - REC - 16), 0, 150 - REC - 16]);
    expect(centro.barras.filter((q) => q.grupo === "superior").every((q) => q.y === 250 - REC - 8 - 6)).toBe(true);
    expect(armadoDeZona(a, "fin")).toMatchObject({ superiorPropia: true, cercosPropios: false });
    expect(armadoDeZona(a, "inicio")).toMatchObject({ superiorPropia: false, cercosPropios: true, cercos: { separacion: 100 } });
  });

  it("alzado de un vano: los cuartos de la luz y los cercos de cada zona a su separación", () => {
    const a: ArmadoVanoViga = { inferior: { n: 2, diametro: 12 }, superior: { n: 2, diametro: 12 }, cercos: { diametro: 6, separacion: 200 }, cercosInicio: { diametro: 6, separacion: 100 } };
    const al = alzadoVano(4, a);
    expect(al.zonas.map((z) => [z.zona, z.desde, z.hasta])).toEqual([["inicio", 0, 1], ["centro", 1, 3], ["fin", 3, 4]]);
    const [ini, cen, fin] = al.zonas;
    // Inicio: de 0,05 a 1 cada 0,10; centro: de 1 a 3 cada 0,20; fin: de 3 a 3,95 cada 0,20
    expect(ini.posiciones[0]).toBe(PRIMER_CERCO);
    expect(ini.posiciones).toHaveLength(10);
    expect(cen.posiciones).toHaveLength(11);
    expect(fin.posiciones).toHaveLength(5);
    for (const z of al.zonas) {
      for (let i = 1; i < z.posiciones.length; i++) expect(z.posiciones[i]! - z.posiciones[i - 1]!).toBeCloseTo(z.cercos!.separacion / 1000, 9);
      expect(z.posiciones.every((x) => x >= z.desde - 1e-9 && x <= z.hasta + 1e-9)).toBe(true);
    }
    // Sin armado, sin cercos ni barras
    const vacio = alzadoVano(4, undefined);
    expect([vacio.inferior, vacio.zonas.flatMap((z) => z.posiciones)]).toEqual([undefined, []]);
  });

  it("los ejes de una armadura son los de las franjas del compilador, en cualquier ángulo", () => {
    for (const eje1 of [undefined, 0, 90, 180, 270, 30, -45, 123.4]) {
      const c = ejesArmado({ eje1 } as never);
      expect(ejesArmadura(eje1, "x-inf"), `eje1 ${eje1}`).toEqual(c[1]);
      expect(ejesArmadura(eje1, "y-sup"), `eje1 ${eje1}`).toEqual(c[2]);
      expect(ejesArmadura(eje1, "y")).toEqual(c[2]);
    }
  });

  it("los refuerzos y los cercos de una losa, en planta: su zona, su barra y su reparto", () => {
    const a: Pick<ArmadoForjado, "refuerzos" | "cercos"> = {
      refuerzos: [
        { armadura: "x-sup", s: [2, 5], t: [1, 2], barras: { diametro: 12, separacion: 200 } },
        { armadura: "y-inf", s: [1, 3], t: [4, 6], barras: { diametro: 16, n: 2 }, en: "nervios" },
        // A medias: no se dibuja
        { armadura: "x-inf", s: [3, 3], t: [0, 1], barras: { diametro: 12, separacion: 200 } },
      ],
      cercos: [{ direccion: "y", s: [0, 2], t: [1, 1.8], cercos: { diametro: 6, separacion: 150, ramas: 2 } }],
    };
    const r = refuerzosDibujados(0, a);
    expect(r.map((x) => x.indice)).toEqual([0, 1]);
    // X: s es x y t es y
    expect(r[0]).toMatchObject({ cara: "superior", zona: [[2, 1], [5, 1], [5, 2], [2, 2]], barra: [[2, 1.5], [5, 1.5]], reparto: [[3.5, 1], [3.5, 2]], centro: [3.5, 1.5], giro: 0, texto: "Ø12/200", largo: 3, ancho: 1 });
    // Y: s es y y t es x (d = eje 2, n = eje 1)
    expect(r[1]).toMatchObject({ cara: "inferior", barra: [[5, 1], [5, 3]], reparto: [[4, 2], [6, 2]], centro: [5, 2], giro: 90, texto: "2Ø16 por nervio", largo: 2, ancho: 2, en: "nervios" });
    const c = cercosDibujados(0, a);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ direccion: "y", centro: [1.4, 1], d: [0, 1], texto: "cØ6/150", largo: 2 });
    expect(c[0]!.ancho).toBeCloseTo(0.8, 12);
    // Girada: las medidas no cambian y la barra va según el eje 1
    const g = refuerzosDibujados(30, a)[0]!;
    expect(Math.hypot(g.barra[1][0] - g.barra[0][0], g.barra[1][1] - g.barra[0][1])).toBeCloseTo(3, 12);
    expect(Math.hypot(g.reparto[1][0] - g.reparto[0][0], g.reparto[1][1] - g.reparto[0][1])).toBeCloseTo(1, 12);
    expect(g.giro).toBeCloseTo(30, 9);
    expect(refuerzosDibujados(0, undefined)).toEqual([]);
  });
});
