/**
 * Fase IG (`docs/fem3d/imperfeccion.md`): los casos derivados del motor (`CasoDerivado`).
 * - A mano: con cargas nodales, de barra y de lámina cuyo reparto se conoce, el caso derivado da lo
 *   mismo que un caso con las fuerzas θ·P escritas nudo a nudo.
 * - La resultante: θ·ΣP en su dirección, a la altura de las cargas; equilibrio a 1e-9.
 * - **La estructura inclinada** (lo que la norma define, CE A19 §5.2 y su figura 5.1): un pórtico con
 *   los pilares inclinados θ bajo las cargas verticales, menos el mismo pórtico recto, es el caso
 *   derivado (momentos y cortantes de los extremos de las barras y desplazamientos horizontales).
 * - `FuerzasNodales` da las mismas cargas nodales que el cálculo: Σ g = P + R en cada nudo.
 * - Lo que no vale es un error, no un resultado.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { carga } from "../pruebas/constructor.ts";
import { compararInclinada, conCasos, derivadoDeG, porticoIG } from "../../validacion/ig/portico.ts";
import { calcular } from "./calcular.ts";
import { FuerzasNodales } from "./fuerzasNodales.ts";
import type { CargaNodal, CasoCarga } from "./modelo.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const THETA = 1 / 300;
const edificio = porticoIG;
const derivado = (id: string, gdl: 0 | 1, factor = THETA): CasoCarga => derivadoDeG(id, gdl, factor);
const con = conCasos;

const maxAbs = (a: ArrayLike<number>) => Array.from(a).reduce((s, v) => Math.max(s, Math.abs(v)), 0);
const dif = (a: ArrayLike<number>, b: ArrayLike<number>) => Array.from(a).reduce((s, v, i) => Math.max(s, Math.abs(v - b[i]!)), 0);

describe.each([false, true])("caso derivado, con diafragma: %s", (diafragma) => {
  const e = edificio({ diafragma });
  const aMano = (id: string, gdl: 0 | 1): CasoCarga => ({
    id,
    nodales: Array.from(e.pesos, (p, v) => (p ? carga(v, gdl === 0 ? { fx: THETA * p } : { fy: THETA * p }) : null)).filter((c): c is CargaNodal => c !== null),
  });

  it("da lo mismo que las fuerzas θ·P escritas a mano en cada nudo", () => {
    const r = casosValidos(calcular(con(e.modelo, derivado("IX", 0), derivado("IY", 1), aMano("MX", 0), aMano("MY", 1))));
    for (const [d, a] of [
      [r[1]!, r[3]!],
      [r[2]!, r[4]!],
    ] as const) {
      for (const campo of ["u", "reacciones", "esfuerzosBarras", "esfuerzosLaminas"] as const) expect(dif(d[campo], a[campo]), `${d.id} ${campo}`).toBeLessThanOrEqual(1e-11 * maxAbs(a[campo]));
      expect(maxAbs(d.u)).toBeGreaterThan(0);
    }
  });

  it("su resultante es θ·ΣP, a la altura de las cargas, y cumple el equilibrio", () => {
    const [g, ix, iy] = casosValidos(calcular(con(e.modelo, derivado("IX", 0), derivado("IY", 1))));
    const P = e.pesos.reduce((s, p) => s + p, 0);
    const zP = e.pesos.reduce((s, p, v) => s + p * e.modelo.nudos[v]!.z, 0);
    expect(g!.cargas.F[2]).toBeCloseTo(-P, 9);
    expect(ix!.cargas.F[0]).toBeCloseTo(THETA * P, 10);
    expect(ix!.cargas.F[1]).toBe(0);
    expect(ix!.cargas.F[2]).toBe(0);
    expect(ix!.cargas.zF[0]).toBeCloseTo(THETA * zP, 9);
    expect(iy!.cargas.F[1]).toBeCloseTo(THETA * P, 10);
    expect(iy!.cargas.zF[1]).toBeCloseTo(THETA * zP, 9);
    for (const c of [ix!, iy!]) {
      expect(c.equilibrio.fuerzas).toBeLessThanOrEqual(1e-9);
      expect(c.equilibrio.momentos).toBeLessThanOrEqual(1e-9);
      // Las reacciones horizontales suman −θ·ΣP
      let R = 0;
      for (let v = 0; v < e.modelo.nudos.length; v++) R += c.reacciones[6 * v + (c.id === "IX" ? 0 : 1)]!;
      expect(R).toBeCloseTo(-THETA * P, 9);
      // No lleva carga vertical: no cuenta en el P·δ de nadie
      expect(g!.cargas.pdelta[2 * (c.id === "IX" ? 1 : 2)]).toBe(0);
    }
  });

  it("el caso de origen sale con los mismos bits, y el orden de los casos no importa", () => {
    const solo = casosValidos(calcular(e.modelo))[0]!;
    const detras = casosValidos(calcular(con(e.modelo, derivado("IX", 0))));
    const delante = casosValidos(calcular({ ...e.modelo, casos: [derivado("IX", 0), ...e.modelo.casos] }));
    expect(detras[0]!.u).toEqual(solo.u);
    expect(detras[0]!.reacciones).toEqual(solo.reacciones);
    expect(delante[1]!.u).toEqual(solo.u);
    expect(delante[0]!.u).toEqual(detras[1]!.u);
    expect(delante[0]!.reacciones).toEqual(detras[1]!.reacciones);
  });

  it("FuerzasNodales da las cargas nodales del cálculo: Σ g = P + R en cada nudo", () => {
    const modelo = con(e.modelo, derivado("IX", 0), derivado("IY", 1));
    const casos = casosValidos(calcular(modelo));
    const fn = new FuerzasNodales(modelo);
    const nudos = modelo.nudos.map((_, v) => v);
    const suma = fn.sumaEnNudos(nudos, casos);
    const enRestriccion = new Set((modelo.restricciones ?? []).flatMap((r) => [r.maestro, ...r.esclavos]));
    for (const k of [1, 2]) {
      const P = fn.cargasNodales(k);
      const gdl = k === 1 ? 0 : 1;
      // Las cargas: θ·P en su GDL y nada más
      for (let v = 0; v < nudos.length; v++) for (let c = 0; c < 6; c++) expect(P[6 * v + c]).toBeCloseTo(c === gdl ? THETA * e.pesos[v]! : 0, 12);
      const escala = maxAbs(P);
      for (const v of nudos) {
        // (en un diafragma, la restricción lleva la diferencia en ux, uy y rz)
        for (let c = 0; c < 6; c++) {
          if (enRestriccion.has(v) && (c === 0 || c === 1 || c === 5)) continue;
          expect(Math.abs(suma[k]![6 * v + c]! - P[6 * v + c]! - casos[k]!.reacciones[6 * v + c]!), `caso ${k}, nudo ${v}, gdl ${c}`).toBeLessThanOrEqual(1e-9 * escala);
        }
      }
    }
  });
});

describe("la estructura inclinada", () => {
  // Un ángulo pequeño (lo que se compara es de primer orden en θ) y los pilares sin acortamiento: en
  // el pórtico inclinado el acortamiento de un pilar tiene una componente horizontal θ·δ, que las
  // fuerzas equivalentes no tienen (12·I/(A·h²), del orden del 1 % con un pilar de 30 × 30 y 3 m).
  // Lo medido, en `validacion/ig/out_inclinada.txt`: 4e-4 sin acortamiento; 3e-3 en los esfuerzos y
  // 8e-3 en los desplazamientos con los pilares de verdad, igual con θ = 1e-5 que con 1/200
  it.each([false, true])("con los pilares sin acortamiento, es el caso derivado (diafragma: %s)", (diafragma) => {
    const r = compararInclinada({ diafragma, axil: 1e4, inclinacion: 1e-5 });
    expect(r.sM).toBeGreaterThan(0);
    expect(r.M, "momentos").toBeLessThan(1e-3);
    expect(r.V, "cortantes").toBeLessThan(1e-3);
    expect(r.u, "desplazamientos").toBeLessThan(1e-3);
  });

  it.each([1e-5, 1 / 200])("con los pilares de verdad y θ = %s, a menos del 1 % (su acortamiento, que las fuerzas equivalentes no ven)", (inclinacion) => {
    const r = compararInclinada({ diafragma: true, axil: 1, inclinacion });
    expect(r.M, "momentos").toBeLessThan(5e-3);
    expect(r.V, "cortantes").toBeLessThan(5e-3);
    expect(r.u, "desplazamientos").toBeLessThan(1e-2);
  });
});

describe("lo que no vale es un error", () => {
  const e = edificio();
  const codigos = (casos: CasoCarga[]) => {
    const r = calcular(con(e.modelo, ...casos));
    return r.valido ? [] : r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.codigo);
  };

  it.each([
    ["un origen que no existe", [{ id: "I", derivado: { de: "nada", gdl: 0, factor: THETA } }]],
    ["un origen que es derivado", [derivado("I1", 0), { id: "I2", derivado: { de: "I1", gdl: 0, factor: THETA } }]],
    ["un GDL que no es X ni Y", [{ id: "I", derivado: { de: "G", gdl: 2, factor: THETA } }]],
    ["un factor no finito", [{ id: "I", derivado: { de: "G", gdl: 0, factor: NaN } }]],
    ["con cargas propias", [{ id: "I", derivado: { de: "G", gdl: 0, factor: THETA }, nodales: [carga(3, { fx: 1 })] }]],
  ] as [string, CasoCarga[]][])("%s", (_, casos) => {
    expect(codigos(casos as CasoCarga[])).toContain("carga/derivado-no-valido");
  });
});
