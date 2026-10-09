/**
 * Comprobaciones de sensatez de A3 (`docs/fem3d/agente.md` §8):
 * - cada comprobación previa avisa con su error típico y calla en los modelos de referencia;
 * - el peso propio esperado (sin la malla) es el del cálculo;
 * - la bajada tributaria: un caso a mano y la conservación de la carga en edificios;
 * - criterio 1: las mutaciones graves se detectan todas (el banco de `validacion/a3/mutaciones.ts`);
 * - el informe es determinista y las firmas valen para su huella y su informe.
 * El criterio 2 (avisos en las referencias a tamaño completo) lo mide `validacion/a3/referencias.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { fisico1022 } from "../../validacion/c1/modelos.ts";
import { edificioObjetivoLosas } from "../../validacion/c2/modelos.ts";
import { edificioObjetivoMuros, reticulaConNucleo } from "../../validacion/c3/modelos.ts";
import { edificioReticular, edificioUnidireccional } from "../../validacion/c4/modelos.ts";
import { MODELOS, MUTACIONES, nuevos } from "../../validacion/a3/mutaciones.ts";
import { prepararNucleo, proyectoDe, revisarProyecto } from "../../validacion/a3/revisar.ts";
import { compilar } from "../compilador/compilar.ts";
import { resultanteAnalitica } from "../compilador/cargas.ts";
import type { ModeloFisico } from "../compilador/fisico.ts";
import { anadirFirma, estadoFirma, leerFirmas, VERSION_FIRMAS } from "./revision.ts";
import { leerProyecto } from "./proyecto.ts";
import { pesoPropioCalculado, pesoPropioEsperado, Plantas, sensatezPrevia } from "./sensatez.ts";
import { bajadaTributaria } from "./tributaria.ts";

beforeAll(async () => {
  await prepararNucleo();
});

const avisos = (f: ModeloFisico) => sensatezPrevia(f).flatMap((c) => c.avisos);
const codigos = (f: ModeloFisico) => new Set(avisos(f).map((a) => a.codigo));
const copia = (f: ModeloFisico) => structuredClone(f) as ModeloFisico;

/** Una losa de 6 × 6 m sobre cuatro pilares en sus esquinas, con su peso propio y una carga de superficie. */
function losaCuatroPilares(q = 10): ModeloFisico {
  const esquinas: [number, number][] = [
    [0, 0],
    [6, 0],
    [6, 6],
    [0, 6],
  ];
  return {
    plantas: [
      { id: "N1", altura: null },
      { id: "C", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [{ id: "P30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 }],
    pilares: esquinas.map(([x, y], i) => ({ id: `P${i + 1}`, x, y, desde: "C", hasta: "N1", seccion: "P30" })),
    losas: [{ id: "L", planta: "N1", contorno: esquinas, espesor: 0.2, material: "HA" }],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [{ tipo: "superficie", id: "q", caso: "Q", planta: "N1", losa: "L", q: [0, 0, -q] }],
  };
}

describe("comprobaciones previas (sin calcular)", () => {
  it("no avisan en los modelos de referencia ni en el ejemplo de la skill", () => {
    const ejemplo = leerProyecto(readFileSync(join(import.meta.dirname, "..", "..", ".claude", "skills", "fem", "ejemplo.json"), "utf8"));
    expect(ejemplo.valido).toBe(true);
    for (const f of [fisico1022(), reticulaConNucleo(), edificioObjetivoLosas(2, 3, 2), edificioObjetivoMuros(3, 6, 5), edificioReticular(2, 3, 2), edificioUnidireccional(2, 3, 2), losaCuatroPilares(), ...(ejemplo.valido ? [ejemplo.proyecto.modelo] : [])])
      expect(avisos(f).map((a) => a.mensaje)).toEqual([]);
  });

  it("cada una avisa de su error típico, nombrando el objeto", () => {
    const base = edificioObjetivoLosas(2, 3, 2);
    const casos: [string, (f: ModeloFisico) => void, string][] = [
      ["altura en cm", (f) => ((f.plantas[1] as { altura: number }).altura = 300), "sensatez/altura"],
      ["espesor en cm", (f) => ((f.losas![0] as { espesor: number }).espesor = 25), "sensatez/espesor"],
      ["canto en cm", (f) => ((f.secciones[2] as { h: number }).h = 60), "sensatez/seccion"],
      ["fck en kN/m²", (f) => ((f.materiales[0] as { fck: number }).fck = 30000), "sensatez/material"],
      ["peso en kg/m³", (f) => ((f.materiales[0] as { peso?: number }).peso = 2500), "sensatez/material"],
      ["pp en kN/m³", (f) => ((f.losas![0] as { pp?: number }).pp = 25), "sensatez/pp"],
      ["carga duplicada", (f) => (f.cargas = [...f.cargas!, { ...f.cargas!.find((c) => c.tipo === "superficie")!, id: "otra" }]), "sensatez/carga-duplicada"],
      ["carga hacia arriba", (f) => ((f.cargas!.find((c) => c.tipo === "superficie") as unknown as { q: number[] }).q = [0, 0, 2]), "sensatez/carga-hacia-arriba"],
      ["sin peso propio", (f) => (f.casos = f.casos.map(({ pesoPropio: _, ...c }) => c)), "sensatez/sin-peso-propio"],
      ["caso vacío", (f) => (f.casos = [...f.casos, { id: "VACIO" }]), "sensatez/caso-vacio"],
      ["pilar que arranca arriba", (f) => ((f.pilares![0] as { desde: string }).desde = "N1"), "sensatez/pilar-arranque"],
      ["pilar interrumpido", (f) => ((f.pilares!.find((p) => p.x === 6 && p.y === 5) as { hasta: string }).hasta = "N1"), "sensatez/pilar-interrumpido"],
    ];
    for (const [nombre, mutar, codigo] of casos) {
      const f = copia(base);
      mutar(f);
      expect(codigos(f), nombre).toContain(codigo);
      expect(avisos(f).find((a) => a.codigo === codigo)!.ids!.length, nombre).toBeGreaterThan(0);
    }
    // El pp de un paño y el E de un material general
    const u = copia(edificioUnidireccional(2, 3, 2));
    (u.panos![0] as { pp: number }).pp = 25;
    expect(codigos(u)).toContain("sensatez/pp");
    const m = copia(fisico1022());
    (m.materiales[0] as { E: number }).E /= 1000;
    expect(codigos(m)).toContain("sensatez/material");
  });

  it("un modelo con referencias rotas no las rompe", () => {
    const f = copia(edificioObjetivoLosas(2, 3, 2));
    (f.pilares![0] as { desde: string }).desde = "NO-EXISTE";
    (f.losas![0] as { material: string }).material = "NO-EXISTE";
    expect(() => sensatezPrevia(f)).not.toThrow();
  });
});

describe("peso propio esperado", () => {
  it("es el del cálculo, por planta (los muros, salvo las esquinas de sus huellas)", () => {
    for (const [f, tol] of [
      [reticulaConNucleo(), 1e-9],
      [edificioObjetivoLosas(2, 3, 2), 1e-9],
      [edificioReticular(2, 3, 2), 1e-9],
      [edificioUnidireccional(2, 3, 2), 1e-9],
      [losaCuatroPilares(), 1e-9],
      [edificioObjetivoMuros(3, 6, 5), 1e-3],
    ] as const) {
      const calc = pesoPropioCalculado(f, undefined)!;
      for (const x of pesoPropioEsperado(f, new Plantas(f))) {
        const c = calc.get(x.planta)!;
        expect(Math.abs(c - x.esperado), x.planta).toBeLessThanOrEqual(tol * Math.max(1, c));
      }
    }
  });

  it("a mano: losa de 6 × 6 × 0,2 y cuatro pilares de 0,3 × 0,3 × 3 m", () => {
    const f = losaCuatroPilares();
    const n1 = pesoPropioEsperado(f, new Plantas(f)).find((x) => x.planta === "N1")!;
    expect(n1.losas).toBeCloseTo(25 * 0.2 * 36, 9);
    expect(n1.pilares).toBeCloseTo(4 * 25 * 0.09 * 3, 9);
  });
});

describe("bajada tributaria", () => {
  it("a mano: cada pilar de la losa simétrica se lleva la cuarta parte", () => {
    const f = losaCuatroPilares(10);
    const b = bajadaTributaria(f, new Set(["G", "Q"]));
    expect(b).toHaveLength(4);
    for (const x of b) expect(x.bajada).toBeCloseTo(((10 + 25 * 0.2) * 36) / 4, 9);
    // Sólo la carga de uso
    for (const x of bajadaTributaria(f, new Set(["Q"]))) expect(x.bajada).toBeCloseTo(90, 9);
  });

  it("conserva la carga: lo que baja a los tramos de la planta más baja más su peso es toda la carga vertical", () => {
    for (const f of [edificioObjetivoLosas(2, 3, 2), edificioReticular(2, 3, 2), edificioUnidireccional(2, 3, 2)]) {
      const casos = new Set(["G", "Q"]);
      const P = new Plantas(f);
      const abajo = P.ids[P.ids.length - 2]!; // la cabeza de los tramos que arrancan en la cimentación
      const b = bajadaTributaria(f, casos).filter((x) => x.planta === abajo);
      const peso = pesoPropioEsperado(f, P).find((x) => x.planta === abajo)!.pilares;
      const c = compilar(f);
      if (!c.valido) throw new Error("no compila");
      const total = [0, 1].reduce((s, k) => s - resultanteAnalitica(c.modelo, k, [0, 0, 0]).F[2], 0);
      const suma = b.reduce((s, x) => s + x.bajada, 0) + peso;
      expect(Math.abs(suma - total) / total).toBeLessThan(1e-3);
    }
  });
});

describe("criterio 1: mutaciones graves", () => {
  it("se detectan todas en los modelos de referencia", { timeout: 600_000 }, () => {
    const sin: string[] = [];
    let aplicadas = 0;
    for (const m of MODELOS) {
      const f = m.f();
      const base = revisarProyecto(proyectoDe(f));
      if (!base.valido) throw new Error(m.nombre);
      expect(base.revision.avisos.map((a) => a.mensaje), m.nombre).toEqual([]);
      for (const mu of MUTACIONES) {
        const x = mu.aplicar(f);
        if (!x) continue;
        aplicadas++;
        const r = revisarProyecto(proyectoDe(x.modelo));
        if (r.valido && !nuevos(base.revision, r.revision).size) sin.push(`${m.nombre}: ${mu.nombre}`);
      }
    }
    expect(aplicadas).toBe(46);
    expect(sin).toEqual([]);
  });
});

describe("informe y firmas", () => {
  it("el informe es determinista y lleva la huella", () => {
    const p = proyectoDe(losaCuatroPilares(), undefined, "Losa <de> prueba");
    const [a, b] = [revisarProyecto(p), revisarProyecto(p)];
    if (!a.valido || !b.valido) throw new Error("no se revisa");
    expect(a.revision.markdown).toBe(b.revision.markdown);
    expect(a.revision.html).toBe(b.revision.html);
    expect(a.revision.markdown).toContain(a.huella);
    expect(a.revision.html).toContain("Losa &lt;de&gt; prueba");
    expect(a.revision.html).not.toContain("<de>");
  });

  it("una firma vale para su huella y dice si el informe es el mismo", () => {
    let f = leerFirmas("");
    if ("error" in f) throw new Error(f.error);
    expect(estadoFirma(f, "h1", "s1")).toEqual({ firmado: false });
    f = anadirFirma(f, { huella: "h1", por: "A", fecha: "2026-10-09T10:00:00Z", informe: "s1" });
    expect(anadirFirma(f, { huella: "h1", por: "A", fecha: "2026-10-10T10:00:00Z", informe: "s1" }).firmas).toHaveLength(1);
    expect(estadoFirma(f, "h1", "s1")).toEqual({ firmado: true, por: "A", fecha: "2026-10-09T10:00:00Z", mismoInforme: true });
    expect(estadoFirma(f, "h1", "s2")).toMatchObject({ firmado: true, mismoInforme: false });
    expect(estadoFirma(f, "h2", "s1")).toEqual({ firmado: false });
    const otra = leerFirmas(JSON.stringify(f));
    expect(otra).toEqual({ esquema: VERSION_FIRMAS, firmas: f.firmas });
    expect(leerFirmas('{"esquema":"otro","firmas":[]}')).toHaveProperty("error");
    expect(leerFirmas("{roto")).toHaveProperty("error");
  });
});
