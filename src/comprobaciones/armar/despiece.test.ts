/**
 * CO6-g (`docs/fem3d/comprobaciones.md` §8.12): el despiece de los refuerzos y de las zonas de cercos
 * de una losa. Las zonas que piden refuerzo se alargan con su anclaje, se unen si casi forman un
 * rectángulo, se cortan donde se pisan y llevan sus puntas a 5 cm.
 */
import { describe, expect, it } from "vitest";
import { despiece, HOLGURA_UNION_CERCOS, LARGO_MINIMO, LARGO_MINIMO_CERCOS, MODULO_LARGO, type PiezaDespiece, type Rectangulo } from "./losas.ts";

const pieza = (s: [number, number], t: [number, number], limite: [number, number] = [-100, 100], id = ""): PiezaDespiece<string> => ({ nucleo: { s, t }, limite, estaciones: [id] });
const enModulo = (v: number) => Math.abs(v / MODULO_LARGO - Math.round(v / MODULO_LARGO)) < 1e-6;
const pisan = (x: Rectangulo, y: Rectangulo) => Math.min(x.s[1], y.s[1]) - Math.max(x.s[0], y.s[0]) > 1e-9 && Math.min(x.t[1], y.t[1]) - Math.max(x.t[0], y.t[0]) > 1e-9;

describe("CO6-g: el despiece de los refuerzos de una losa", () => {
  it("una zona se alarga su anclaje por cada punta, hasta el largo mínimo, y sus puntas van a 5 cm", () => {
    // 2,31 m de zona y 0,62 de anclaje: de 1,00 − 0,62 = 0,38 a 3,31 + 0,62 = 3,93, hacia fuera a 5 cm
    const [r] = despiece([pieza([1, 3.31], [0, 0.72])], () => 0.62, LARGO_MINIMO);
    expect(r!.caja).toEqual({ s: [0.35, 3.95], t: [0, 0.72] });
    // Una zona de 2 cm con 0,30 de anclaje daría 0,62 m: el mínimo, centrado
    const [corta] = despiece([pieza([2, 2.02], [0, 1])], () => 0.3, LARGO_MINIMO);
    expect(corta!.caja.s[1] - corta!.caja.s[0]).toBeGreaterThanOrEqual(LARGO_MINIMO - 1e-9);
    expect(corta!.caja.s[1] - corta!.caja.s[0]).toBeLessThanOrEqual(LARGO_MINIMO + 2 * MODULO_LARGO + 1e-9);
    expect((corta!.caja.s[0] + corta!.caja.s[1]) / 2).toBeCloseTo(2.01, 1);
    for (const v of [...r!.caja.s, ...corta!.caja.s]) expect(enModulo(v)).toBe(true);
  });

  it("no sale de la losa: la punta que llega al borde se queda en él y lo que falta del mínimo va al otro lado", () => {
    const [r] = despiece([pieza([0.13, 0.4], [0, 1], [0.13, 8])], () => 0.5, LARGO_MINIMO);
    expect(r!.caja.s[0]).toBe(0.13);
    expect(r!.caja.s[1] - r!.caja.s[0]).toBeGreaterThanOrEqual(LARGO_MINIMO - 1e-9);
    expect(enModulo(r!.caja.s[1])).toBe(true);
    // Una losa más corta que el mínimo: toda ella
    const [toda] = despiece([pieza([0.2, 0.3], [0, 1], [0, 0.6])], () => 0.5, LARGO_MINIMO);
    expect(toda!.caja.s).toEqual([0, 0.6]);
  });

  it("los trozos seguidos de un nervio y los nervios vecinos de casi el mismo largo se unen en uno", () => {
    const trozos = [pieza([10.91, 11.08], [12.5, 13.22], undefined, "a"), pieza([11.2, 11.36], [12.5, 13.22], undefined, "b"), pieza([11.48, 11.66], [12.5, 13.22], undefined, "c")];
    const r = despiece(trozos, () => 0.6, LARGO_MINIMO);
    expect(r).toHaveLength(1);
    expect(r[0]!.caja).toEqual({ s: [10.3, 12.3], t: [12.5, 13.22] });
    expect(r[0]!.pieza.estaciones).toEqual(["a", "b", "c"]);
    // Dos nervios vecinos (se tocan en t) con casi la misma longitud: uno, con la mayor
    const vecinos = despiece([pieza([2, 5], [0, 0.72]), pieza([2.2, 5.3], [0.72, 1.44])], () => 0.5, LARGO_MINIMO);
    expect(vecinos).toHaveLength(1);
    expect(vecinos[0]!.caja).toEqual({ s: [1.5, 5.8], t: [0, 1.44] });
    // Si uno es mucho más corto, cada uno el suyo (se tocan, no se pisan)
    const distintos = despiece([pieza([2, 8], [0, 0.72]), pieza([2, 3], [0.72, 1.44])], () => 0.5, LARGO_MINIMO);
    expect(distintos.map((x) => x.caja.s)).toEqual([[1.5, 8.5], [1.5, 3.5]]);
  });

  it("dos vanos seguidos que al alargarse se pisan se cortan a mitad del hueco entre sus zonas, y ninguno pisa a otro", () => {
    // Un vano ancho y otro estrecho, a 0,43 m: el rectángulo común cubriría mucho más que los dos
    const r = despiece([pieza([-7.68, -6.18], [12.88, 15.04]), pieza([-5.75, -1.43], [4, 15.04])], () => 0.7, LARGO_MINIMO);
    expect(r).toHaveLength(2);
    expect(pisan(r[0]!.caja, r[1]!.caja)).toBe(false);
    // El corte, entre las dos zonas y en el módulo
    expect(r[0]!.caja.s[1]).toBe(r[1]!.caja.s[0]);
    expect(r[0]!.caja.s[1]).toBeGreaterThanOrEqual(-6.18);
    expect(r[0]!.caja.s[1]).toBeLessThanOrEqual(-5.75);
    expect(enModulo(r[0]!.caja.s[1])).toBe(true);
    // Las otras puntas, con su anclaje
    expect(r[0]!.caja.s[0]).toBeCloseTo(-8.4, 9);
    expect(r[1]!.caja.s[1]).toBeCloseTo(-0.7, 9);
    // Cada zona sigue cubierta por su rectángulo
    for (const { caja, pieza: p } of r) {
      expect(caja.s[0]).toBeLessThanOrEqual(p.nucleo.s[0] + 1e-9);
      expect(caja.s[1]).toBeGreaterThanOrEqual(p.nucleo.s[1] - 1e-9);
    }
  });

  it("dos zonas que se pisan de origen (una en la muesca de la otra) se unen siempre", () => {
    const r = despiece([pieza([0, 6], [0, 1]), pieza([2, 2.5], [0.5, 4])], () => 0.3, LARGO_MINIMO);
    expect(r).toHaveLength(1);
    expect(r[0]!.caja.t).toEqual([0, 4]);
  });

  it("las zonas de cercos: sin anclaje, con su largo mínimo, y se unen con más holgura", () => {
    const zonas = [pieza([7.62, 7.88], [11.45, 13.61]), pieza([7.88, 8.13], [12.89, 13.61])];
    expect(despiece(zonas, () => 0, LARGO_MINIMO_CERCOS)).toHaveLength(2);
    const r = despiece(zonas, () => 0, LARGO_MINIMO_CERCOS, HOLGURA_UNION_CERCOS);
    expect(r).toHaveLength(1);
    expect(r[0]!.caja).toEqual({ s: [7.6, 8.15], t: [11.45, 13.61] });
    const [sola] = despiece([pieza([3.07, 3.32], [8.55, 9.28])], () => 0, LARGO_MINIMO_CERCOS, HOLGURA_UNION_CERCOS);
    expect(sola!.caja.s[1] - sola!.caja.s[0]).toBeGreaterThanOrEqual(LARGO_MINIMO_CERCOS - 1e-9);
    expect(sola!.caja.s[1] - sola!.caja.s[0]).toBeLessThanOrEqual(LARGO_MINIMO_CERCOS + 2 * MODULO_LARGO + 1e-9);
  });

  it("es determinista y no depende de quién se une antes: unas piezas al azar, sin pisarse y cubriendo sus zonas", () => {
    let semilla = 12345;
    const azar = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let caso = 0; caso < 200; caso++) {
      const n = 2 + Math.floor(azar() * 6);
      const ps: PiezaDespiece<string>[] = [];
      for (let i = 0; i < n; i++) {
        const [s0, t0] = [20 * azar(), Math.floor(10 * azar()) * 0.72];
        ps.push(pieza([s0, s0 + 0.02 + 4 * azar()], [t0, t0 + 0.72 * (1 + Math.floor(3 * azar()))], [0, 25], `${i}`));
      }
      const r = despiece(ps, () => 0.5, LARGO_MINIMO);
      expect(JSON.stringify(despiece(ps, () => 0.5, LARGO_MINIMO))).toBe(JSON.stringify(r));
      // Todas las zonas, en algún rectángulo, y cada una cubierta por el suyo
      expect(r.flatMap((x) => x.pieza.estaciones).sort()).toEqual(ps.map((p) => p.estaciones[0]!).sort());
      for (const p of ps) {
        const suyo = r.find((x) => x.pieza.estaciones.includes(p.estaciones[0]!))!.caja;
        expect(suyo.s[0] <= p.nucleo.s[0] + 1e-9 && suyo.s[1] >= p.nucleo.s[1] - 1e-9 && suyo.t[0] <= p.nucleo.t[0] + 1e-9 && suyo.t[1] >= p.nucleo.t[1] - 1e-9, `caso ${caso}`).toBe(true);
      }
      for (let i = 0; i < r.length; i++) {
        expect(r[i]!.caja.s[0]).toBeGreaterThanOrEqual(0);
        expect(r[i]!.caja.s[1]).toBeLessThanOrEqual(25);
        for (let j = i + 1; j < r.length; j++) expect(pisan(r[i]!.caja, r[j]!.caja), `caso ${caso}: ${i} y ${j}`).toBe(false);
      }
    }
  });
});
