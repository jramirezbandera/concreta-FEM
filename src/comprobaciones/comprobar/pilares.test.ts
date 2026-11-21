/**
 * Fase CO1 (`docs/fem3d/comprobaciones.md` §7, criterios 7 a 9): comprobar un pilar con un armado dado.
 *
 * El edificio de las pruebas del segundo orden (pilares de 40 × 40, sólo barras), como en
 * `../demandas/pilares.test.ts`.
 * - Identidad: el aprovechamiento de cada fila es el máximo de llamar al módulo con las entradas
 *   escritas aquí a mano, demanda a demanda, y la combinación que se da es una de las que lo alcanzan.
 * - Con los pilares girados 90° y el armado de las caras cambiado, lo mismo.
 * - Con el sismo, nunca menos que sin él.
 * - El cortante, con las fórmulas del CE escritas aparte; la flexotracción, con el equilibrio de la
 *   sección por fibras y las capas de barras escritas a mano.
 * - El cortante de un pilar circular (CO1-b), por el cuadrado inscrito, con las fórmulas escritas aparte.
 * - Lo que no se comprueba no cumple: β = 1 sin el segundo orden y el tramo sin demandas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioSO, type VarianteSO } from "../../../validacion/so/modelos.ts";
import { compilar } from "../../compilador/compilar.ts";
import { Consultas } from "../../compilador/consultas.ts";
import type { ModeloFisico } from "../../compilador/fisico.ts";
import { calcular } from "../../motor/calcular.ts";
import { iniciarNucleo } from "../../nucleo/index.ts";
import { getConcrete } from "../concreta/data/materials.ts";
import { calcRCColumn, computeAxis, type BarGroup, type PRDiagram } from "../concreta/lib/calculations/rcColumns.ts";
import { demandasPilar, type DemandasPilar } from "../demandas/pilares.ts";
import { comprobarPilar, comprobarTramo, type ArmadoPilar } from "./pilares.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function consultas(f: ModeloFisico): Consultas {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return new Consultas(f, c, r.casos, {}, r.modal);
}
function demandas(f: ModeloFisico, id: string): DemandasPilar {
  const d = demandasPilar(consultas(f), id);
  if (!d.valido) throw new Error(d.diagnosticos.map((x) => x.mensaje).join("\n"));
  return d.valor;
}
const edificio = (v: VarianteSO = {}) => edificioSO(v);
const girado = (f: ModeloFisico): ModeloFisico => ({ ...f, pilares: f.pilares!.map((p) => ({ ...p, giro: 90 })) });

/** 4Ø16 en las esquinas y 2Ø12 intermedias sólo en las caras de ancho b: distinto en cada plano. */
const ARMADO: ArmadoPilar = { recubrimiento: 30, fyk: 500, cercos: { diametro: 8, separacion: 150 }, esquinas: 16, caraB: { n: 2, diametro: 12 }, caraH: { n: 0, diametro: 12 } };
const ARMADO_GIRADO: ArmadoPilar = { ...ARMADO, caraB: ARMADO.caraH!, caraH: ARMADO.caraB! };
const CIRCULAR: ArmadoPilar = { recubrimiento: 30, fyk: 500, cercos: { diametro: 8, separacion: 150 }, anillo: { n: 10, diametro: 16 } };

describe("CO1: comprobar un pilar con un armado dado", () => {
  it("cada fila es el máximo de llamar al módulo a mano, demanda a demanda", () => {
    const d = demandas(edificio(), "P1");
    const c = comprobarPilar(d, () => ARMADO);
    expect(c.tramos.length).toBe(d.tramos.length);
    d.tramos.forEach((t, i) => {
      const maximos = new Map<string, number>();
      const alcanzan = new Map<string, Set<string>>();
      const informativas = new Set<string>();
      let llamadas = 0;
      for (const [nombre, ext] of [["base", t.base], ["cabeza", t.cabeza]] as const)
        for (const dm of ext.demandas) {
          const [N, , , , My, Mz] = dm.esfuerzos as [number, number, number, number, number, number];
          expect(-N).toBeGreaterThan(1); // todo comprimido en este edificio
          // La entrada, escrita aparte: 40 × 40 cm, HA-25… lo del modelo, en mm y con compresión positiva
          const r = calcRCColumn({
            title: "", b: 400, h: 400, cover: 30, cornerBarDiam: 16, nBarsX: 2, barDiamX: 12, nBarsY: 0, barDiamY: 12,
            stirrupDiam: 8, stirrupSpacing: 150, fck: t.material.tipo === "hormigon" ? t.material.fck : NaN, fyk: 500,
            Nd: -N, MEdy: Math.abs(My), MEdz: Math.abs(Mz), L: 2.5, beta: 1, sectionType: "rectangular",
          });
          expect(r.valid).toBe(true);
          llamadas++;
          for (const f of r.checks) {
            // Las informativas del módulo (NaN, nunca fallan) no tienen máximo
            if (!Number.isFinite(f.utilization)) {
              expect(f.status).toBe("ok");
              informativas.add(f.id);
              continue;
            }
            const m = maximos.get(f.id);
            if (m === undefined || f.utilization > m) {
              maximos.set(f.id, f.utilization);
              alcanzan.set(f.id, new Set([`${nombre}|${dm.comb}`]));
            } else if (f.utilization === m) alcanzan.get(f.id)!.add(`${nombre}|${dm.comb}`);
          }
        }
      const tramo = c.tramos[i]!;
      expect(tramo.llamadas).toBe(llamadas);
      expect(tramo.pendientes).toEqual([]);
      // Las del cortante no son del módulo de pilares: van en su prueba
      const delModulo = tramo.filas.filter((f) => !/^(cortante|biela)-/.test(f.id));
      expect(tramo.filas.length).toBeGreaterThan(delModulo.length);
      expect(new Set(delModulo.map((f) => f.id))).toEqual(new Set([...maximos.keys(), ...informativas]));
      expect(new Set(tramo.filas.filter((f) => f.informativa).map((f) => f.id))).toEqual(informativas);
      expect([...informativas].sort()).toEqual(["cond-5.38a", "cond-5.38b"]);
      for (const f of delModulo) {
        if (f.informativa) {
          expect(f.aprovechamiento).toBe(0);
          continue;
        }
        expect(f.aprovechamiento).toBe(maximos.get(f.id));
        expect(alcanzan.get(f.id)!.has(`${f.extremo}|${f.comb}`)).toBe(true);
      }
      expect(tramo.aprovechamiento).toBeGreaterThanOrEqual(Math.max(...maximos.values()));
      expect(tramo.cumple).toBe(tramo.filas.every((f) => f.estado !== "fail"));
    });
    // El pilar del modelo está bien de sección: con este armado cumple, y las filas de agotamiento están
    expect(c.cumple).toBe(true);
    expect(c.tramos[0]!.filas.some((f) => f.id === "nm-y")).toBe(true);
  });

  it("girados 90° los pilares y cambiadas las caras del armado, las mismas filas", () => {
    const a = comprobarPilar(demandas(edificio(), "P1"), () => ARMADO);
    const b = comprobarPilar(demandas(girado(edificio()), "P1"), () => ARMADO_GIRADO);
    // Con el armado sin cambiar de cara no sale lo mismo: la prueba distingue los dos planos
    const c = comprobarPilar(demandas(girado(edificio()), "P1"), () => ARMADO);
    const porId = (x: typeof a, i: number, id: string) => x.tramos[i]!.filas.find((f) => f.id === id)!.aprovechamiento;
    a.tramos.forEach((_, i) => {
      for (const [y, z] of [["nm-y", "nm-z"], ["lambda-y", "lambda-z"]] as const) {
        expect(porId(b, i, z)).toBeCloseTo(porId(a, i, y), 9);
        expect(porId(b, i, y)).toBeCloseTo(porId(a, i, z), 9);
      }
      expect(porId(b, i, "biaxial-check")).toBeCloseTo(porId(a, i, "biaxial-check"), 9);
    });
    expect(Math.abs(porId(c, 0, "nm-z") - porId(a, 0, "nm-y"))).toBeGreaterThan(1e-3);
  });

  it("con el sismo, ninguna fila sale con menos que sin él", () => {
    const sin = comprobarPilar(demandas(edificio(), "P1"), () => ARMADO);
    const con = comprobarPilar(demandas(edificio({ sismo: true }), "P1"), () => ARMADO);
    con.tramos.forEach((t, i) => {
      expect(t.llamadas).toBeGreaterThan(sin.tramos[i]!.llamadas);
      for (const f of sin.tramos[i]!.filas) {
        const g = t.filas.find((x) => x.id === f.id)!;
        expect(g.aprovechamiento).toBeGreaterThanOrEqual(f.aprovechamiento - 1e-12);
      }
    });
    expect(con.tramos.some((t) => t.filas.some((f) => f.pesimos))).toBe(true);
  });

  it("un armado escaso falla, y lo dice con su fila y su combinación", () => {
    const d = demandas(edificio({ G: 1200, Q: 400 }), "P5");
    const escaso = comprobarPilar(d, () => ({ ...ARMADO, esquinas: 12, caraB: { n: 0, diametro: 12 } }));
    expect(escaso.cumple).toBe(false);
    const falla = escaso.tramos.flatMap((t) => t.filas).filter((f) => f.estado === "fail");
    expect(falla.length).toBeGreaterThan(0);
    for (const f of falla) expect(f.comb.length).toBeGreaterThan(0);
  });

  it("el cortante: en cada dirección, las fórmulas del CE escritas aparte, con el axil de la demanda", () => {
    const t = demandas(edificio(), "P1").tramos[0]!;
    // Una sola demanda: 600 kN de compresión, Vy = 40 y Vz = 90 kN
    const uno = { ...t, base: { ...t.base, demandas: [{ comb: "a mano", esfuerzos: [-600, 40, -90, 0, 30, 10] }] }, cabeza: { ...t.cabeza, demandas: [] } };
    const r = comprobarTramo(uno, ARMADO);
    const fck = t.material.tipo === "hormigon" ? t.material.fck : NaN;
    const fcd = getConcrete(fck).fcd;
    const fyd = 500 / 1.15;
    // Las áreas de barra y el fcd, los tabulados del módulo (redondeados a la décima)
    const A = (d: 8 | 12 | 16) => ({ 8: 50.3, 12: 113.1, 16: 201.1 })[d];
    const d = 400 - (30 + 8 + 8);
    const sigma = Math.min(600e3 / (400 * 400), 0.2 * fcd);
    const k = Math.min(1 + Math.sqrt(200 / d), 2);
    const VRd = (As: number) => {
      const rho = Math.min(As / (400 * d), 0.02);
      const c = Math.max((0.18 / 1.5) * k * Math.cbrt(100 * rho * fck), 0.051 / 1.5 * k ** 1.5 * Math.sqrt(fck)) * 400 * d + 0.15 * sigma * 400 * d;
      const z = 0.9 * d;
      const s = ((2 * A(8)) / 150) * z * fyd * 2;
      const max = (Math.min(1 + sigma / fcd, 1.25) * 0.6 * (1 - fck / 250) * fcd * 400 * z) / 2.5;
      return { VRd: Math.max(c, Math.min(s, max)) / 1e3, max: max / 1e3 };
    };
    // Vz flecta con el canto h: su cara traccionada es la de ancho b (2Ø16 + 2Ø12); Vy, la de canto h (2Ø16)
    const z = VRd(2 * A(16) + 2 * A(12));
    const y = VRd(2 * A(16));
    const u = (id: string) => r.filas.find((f) => f.id === id)!.aprovechamiento;
    expect(u("cortante-z")).toBeCloseTo(90 / z.VRd, 9);
    expect(u("biela-z")).toBeCloseTo(90 / z.max, 9);
    expect(u("cortante-y")).toBeCloseTo(40 / y.VRd, 9);
    expect(u("biela-y")).toBeCloseTo(40 / y.max, 9);
    expect(u("cortante-esviado")).toBeCloseTo(90 / z.VRd + 40 / y.VRd, 9);
    expect(z.VRd).toBeGreaterThan(y.VRd * 0.99);
    // La tracción baja VRd,c: con el pilar traccionado, más aprovechamiento
    const tirante = comprobarTramo({ ...uno, base: { ...uno.base, demandas: [{ comb: "a mano", esfuerzos: [100, 40, -90, 0, 30, 10] }] } }, { ...ARMADO, cercos: { diametro: 8, separacion: 0 } });
    const sinCercos = comprobarTramo(uno, { ...ARMADO, cercos: { diametro: 8, separacion: 0 } });
    expect(tirante.filas.find((f) => f.id === "cortante-z")!.aprovechamiento).toBeGreaterThan(sinCercos.filas.find((f) => f.id === "cortante-z")!.aprovechamiento);
  });

  it("el cortante de un pilar circular (CO1-b): el cuadrado inscrito, con las fórmulas del CE escritas aparte, y del lado seguro", () => {
    const t = demandas(edificio(), "P1").tramos[0]!;
    const sec = { ...t, seccion: { id: "c", forma: "circular" as const, D: 0.5, material: t.seccion.material } };
    const una = (e: number[]) => ({ ...sec, base: { ...sec.base, demandas: [{ comb: "a mano", esfuerzos: e }] }, cabeza: { ...sec.cabeza, demandas: [] } });
    const fck = t.material.tipo === "hormigon" ? t.material.fck : NaN;
    const fcd = getConcrete(fck).fcd;
    const fyd = 500 / 1.15;
    const A = (d: 8 | 16) => ({ 8: 50.3, 16: 201.1 })[d];
    const s = 500 / Math.SQRT2;
    const d = s - (30 + 8 + 8);
    // 10Ø16: a tracción, ⌊10/4⌋ = 2 barras; el cerco circular, 2 ramas por π/4
    const As = 2 * A(16);
    const Asw = ((Math.PI / 4) * 2 * A(8)) / 150;
    const k = Math.min(1 + Math.sqrt(200 / d), 2);
    const VRd = (sigma: number) => {
      const rho = Math.min(As / (s * d), 0.02);
      const c = Math.max((0.18 / 1.5) * k * Math.cbrt(100 * rho * fck), (0.051 / 1.5) * k ** 1.5 * Math.sqrt(fck)) * s * d + 0.15 * sigma * s * d;
      const z = 0.9 * d;
      const st = Asw * z * fyd * 2;
      const alfa = sigma >= 0 ? Math.min(1 + sigma / fcd, 1.25) : 1;
      const max = (alfa * 0.6 * (1 - fck / 250) * fcd * s * z) / 2.5;
      return { VRd: Math.max(c, Math.min(st, max)) / 1e3, max: max / 1e3 };
    };
    // Compresión: σcp con el área del círculo; el cortante resultante de Vy = 60 y Vz = 80 (100 kN)
    const r = comprobarTramo(una([-900, 60, -80, 0, 20, 10]), CIRCULAR);
    const sigma = Math.min(900e3 / ((Math.PI * 500 * 500) / 4), 0.2 * fcd);
    const u = (x: typeof r, id: string) => x.filas.find((f) => f.id === id)!.aprovechamiento;
    expect(u(r, "cortante")).toBeCloseTo(100 / VRd(sigma).VRd, 9);
    expect(u(r, "biela")).toBeCloseTo(100 / VRd(sigma).max, 9);
    expect(r.filas.some((f) => f.id === "cortante-esviado")).toBe(false);
    // Del lado seguro: menos capacidad que el cuadrado circunscrito (el rectangular de lado D con su armado)
    const cuadrado = comprobarTramo({ ...una([-900, 0, -100, 0, 20, 10]), seccion: { id: "q", forma: "rectangular", b: 0.5, h: 0.5, material: t.seccion.material } }, { ...ARMADO, esquinas: 16, caraB: { n: 1, diametro: 16 }, caraH: { n: 1, diametro: 16 } });
    expect(u(r, "cortante")).toBeGreaterThan(u(cuadrado, "cortante-z"));
    // Tracción: σcp con el área del cuadrado, que penaliza más
    const t2 = comprobarTramo(una([200, 60, -80, 0, 20, 10]), { ...CIRCULAR, cercos: { diametro: 8, separacion: 0 } });
    const c2 = comprobarTramo(una([-900, 60, -80, 0, 20, 10]), { ...CIRCULAR, cercos: { diametro: 8, separacion: 0 } });
    expect(u(t2, "cortante")).toBeGreaterThan(u(c2, "cortante"));
  });

  it("la flexotracción: contra el equilibrio de la sección escrito aparte, del lado seguro y a menos del 3 %", () => {
    const t = demandas(edificio(), "P1").tramos[0]!;
    const fck = t.material.tipo === "hormigon" ? t.material.fck : NaN;
    const mat = getConcrete(fck);
    const pr: PRDiagram = { epsC2: mat.eps_c2, epsCu: mat.eps_cu, nExp: mat.n };
    const fyd = 500 / 1.15;
    // Las áreas de barra y el fcd, los tabulados del módulo (redondeados a la décima)
    const A = (d: 8 | 12 | 16) => ({ 8: 50.3, 12: 113.1, 16: 201.1 })[d];
    const dp = 30 + 8 + 8;
    // Las capas de barras, a mano: según h (My), dos caras con 2Ø16 + 2Ø12; según b (Mz), dos caras con 2Ø16 y las
    // intermedias de las caras de ancho b repartidas a lo largo de b
    const capasY: BarGroup[] = [{ y: dp, area: 2 * A(16) + 2 * A(12) }, { y: 400 - dp, area: 2 * A(16) + 2 * A(12) }];
    const capasZ: BarGroup[] = [{ y: dp, area: 2 * A(16) }, { y: dp + (400 - 2 * dp) / 3, area: 2 * A(12) }, { y: dp + (2 * (400 - 2 * dp)) / 3, area: 2 * A(12) }, { y: 400 - dp, area: 2 * A(16) }];
    const AsTot = 4 * A(16) + 4 * A(12);
    const NtRd = (AsTot * fyd) / 1e3;
    const NRdMax = mat.fcd * (400 * 400 - AsTot) + Math.min(fyd, 400) * AsTot;
    const MRd = (capas: BarGroup[], N: number) => computeAxis(-N * 1e3, 400, 400, capas, mat.fcd, fyd, pr, NRdMax).MRd_Nmm / 1e6;
    for (const [N, My, Mz] of [[120, 25, 0], [120, 0, 18], [60, 20, 12], [0.3 * NtRd, 30, 10], [-0.5, 40, 0]] as const) {
      const uno = { ...t, base: { ...t.base, demandas: [{ comb: "a mano", esfuerzos: [N, 0, 0, 0, My, -Mz] }] }, cabeza: { ...t.cabeza, demandas: [] } };
      const r = comprobarTramo(uno, ARMADO);
      expect(r.pendientes).toEqual([]);
      expect(r.llamadas).toBe(0);
      const exacto = My / MRd(capasY, N) + Mz / MRd(capasZ, N);
      const u = r.filas.find((f) => f.id === "flexotraccion")!.aprovechamiento;
      expect(u).toBeGreaterThanOrEqual(exacto - 1e-9);
      expect(u).toBeLessThan(exacto * 1.03);
      if (N > 0) expect(r.filas.find((f) => f.id === "traccion")!.aprovechamiento).toBeCloseTo(N / NtRd, 9);
      else expect(r.filas.some((f) => f.id === "traccion")).toBe(false);
      // Un pilar que sólo tracciona lleva también las reglas de armado del módulo
      expect(r.filas.some((f) => f.id === "nBars-min")).toBe(true);
    }
    // Más tracción de la que aguanta el acero: falla, sin cociente
    const roto = comprobarTramo({ ...t, base: { ...t.base, demandas: [{ comb: "a mano", esfuerzos: [1.01 * NtRd, 0, 0, 0, 5, 0] }] }, cabeza: { ...t.cabeza, demandas: [] } }, ARMADO);
    expect(roto.cumple).toBe(false);
    expect(roto.filas.find((f) => f.id === "traccion")!.estado).toBe("fail");
    expect(roto.filas.find((f) => f.id === "flexotraccion")!.aprovechamiento).toBe(Infinity);
    expect(roto.aprovechamiento).toBe(Infinity);
  });

  it("lo que no se comprueba no cumple: β = 1 sin el segundo orden, y un tramo sin demandas (el circular, ya sin pendientes)", () => {
    const d = demandas(edificio(), "P1");
    const t = d.tramos[0]!;
    // Una demanda de tracción entre las demás se comprueba, y las filas de las demás siguen saliendo
    const conTraccion = { ...t, base: { ...t.base, demandas: [...t.base.demandas, { comb: "a mano", esfuerzos: [50, 0, 0, 0, 10, 0] }] } };
    const r = comprobarTramo(conTraccion, ARMADO);
    expect(r.pendientes).toEqual([]);
    expect(r.filas.find((f) => f.id === "flexotraccion")!.comb).toBe("a mano");
    expect(r.filas.length).toBe(comprobarTramo(t, ARMADO).filas.length + 2);

    // El circular ya no deja el cortante pendiente (CO1-b, cuadrado inscrito)
    const circular = comprobarTramo({ ...t, seccion: { id: "c", forma: "circular", D: 0.4, material: t.seccion.material } }, CIRCULAR);
    expect(circular.pendientes).toEqual([]);
    expect(circular.filas.some((f) => f.id === "nm-res")).toBe(true);
    expect(circular.cumple).toBe(circular.filas.every((f) => f.estado !== "fail"));

    const sinBeta = comprobarTramo(t, ARMADO, false);
    expect(sinBeta.cumple).toBe(false);
    expect(sinBeta.pendientes[0]!.motivo).toContain("β = 1");

    const vacio = comprobarTramo({ ...t, base: { ...t.base, demandas: [] }, cabeza: { ...t.cabeza, demandas: [] } }, ARMADO);
    expect(vacio.cumple).toBe(false);
    expect(vacio.llamadas).toBe(0);

    // Lo que el módulo rechaza (un armado que no cabe) tampoco cumple
    const noCabe = comprobarTramo(t, { ...ARMADO, esquinas: 4 });
    expect(noCabe.cumple).toBe(false);
    expect(noCabe.pendientes[0]!.motivo).toContain("no admite");
  });

  it("β = 1 no vale: el pilar entero no cumple", () => {
    const d = demandas(edificio({ G: 3000, segundoOrden: { amplificar: false } }), "P1");
    expect(d.betaUno).toBe(false);
    expect(comprobarPilar(d, () => ARMADO).cumple).toBe(false);
  });
});
