/**
 * Fase CO1 (`docs/fem3d/comprobaciones.md` §4.2 y §7, criterios 7 a 10): las demandas de los pilares
 * y su entrada al módulo de pilares de Concreta.
 *
 * El edificio de las pruebas del segundo orden (3 plantas de 2 × 2 vanos de 6 m, pilares de 40 × 40 y
 * vigas de 30 × 50, sólo barras), con su viento, la imperfección global de IG y, en una variante, el
 * sismo del programa.
 * - Las demandas son, combinación a combinación, las de `Consultas`: sin el sismo, la combinación de
 *   los esfuerzos de los casos; con él, las ternas de los signos pésimos, que nunca dan menos momento
 *   que la combinación con el signo dominante.
 * - My flecta en el plano del canto h: con todos los pilares girados 90°, lo de My pasa a Mz, y la
 *   entrada del módulo cambia MEdy por MEdz.
 * - La longitud libre es la del tramo flexible: 3 m de cota a cota menos el canto de la viga (RV-b).
 * - Con el segundo orden desactivado y la estructura traslacional, β = 1 no vale.
 * - La entrada del módulo: mm, compresión positiva, la tracción y lo que no es de hormigón, aparte.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioSO, type VarianteSO } from "../../../validacion/so/modelos.ts";
import { conjuntoCombinaciones } from "../../agente/combinaciones.ts";
import { ternasPesimas } from "../../agente/consultas.ts";
import { compilar } from "../../compilador/compilar.ts";
import { Consultas } from "../../compilador/consultas.ts";
import type { ModeloFisico } from "../../compilador/fisico.ts";
import { calcular } from "../../motor/calcular.ts";
import { iniciarNucleo } from "../../nucleo/index.ts";
import { entradaPilar } from "../comprobar/entradaPilar.ts";
import { demandasPilar, SITUACIONES_ELU, type DemandasTramo } from "./pilares.ts";

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
const edificio = (v: VarianteSO = {}) => consultas(edificioSO(v));
const girado = (f: ModeloFisico): ModeloFisico => ({ ...f, pilares: f.pilares!.map((p) => ({ ...p, giro: 90 })) });

describe("CO1: las demandas de los pilares", () => {
  it("sin el sismo, una demanda por combinación: la de los esfuerzos de sus casos", () => {
    const q = edificio();
    const d = demandasPilar(q, "P1");
    expect(d.valido).toBe(true);
    if (!d.valido) return;
    const cj = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: [...SITUACIONES_ELU] });
    if (!cj.valido) throw new Error("sin combinaciones");
    expect(d.valor.combinaciones).toBe(cj.valor.factores.length);
    expect(d.valor.betaUno).toBe(true);
    const tr = q.pilar("P1");
    if (!tr.valido) throw new Error("sin pilar");
    // La imperfección global (IG) entra como un caso más
    expect(q.fisico.casos.some((c) => c.id.startsWith("IMP-X"))).toBe(true);
    d.valor.tramos.forEach((t, i) => {
      for (const [ext, porCaso] of [
        [t.base, tr.valor[i]!.base.esfuerzos],
        [t.cabeza, tr.valor[i]!.cabeza.esfuerzos],
      ] as const) {
        expect(ext.demandas.length).toBe(cj.valor.factores.length);
        ext.demandas.forEach((dm, k) => {
          expect(dm.comb).toBe(cj.valor.nombres[k]);
          expect(dm.pesimos).toBeUndefined();
          // La superposición escrita aparte: Σ factor·esfuerzos del caso
          const f = cj.valor.factores[k]!;
          for (let c = 0; c < 6; c++) {
            let v = 0;
            for (let j = 0; j < f.length; j++) v += f[j]! * porCaso[6 * j + c]!;
            expect(dm.esfuerzos[c]).toBeCloseTo(v, 9);
          }
        });
      }
    });
  });

  it("con el sismo, las ternas de los signos pésimos, nunca con menos momento que el signo dominante", () => {
    const q = edificio({ sismo: true });
    const d = demandasPilar(q, "P1");
    if (!d.valido) throw new Error("no vale");
    const cj = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: [...SITUACIONES_ELU] });
    if (!cj.valido) throw new Error("sin combinaciones");
    const tr = q.pilar("P1");
    if (!tr.valido) throw new Error("sin pilar");
    let conSismo = 0;
    d.valor.tramos.forEach((t, i) => {
      const porCaso = tr.valor[i]!.base.esfuerzos;
      cj.valor.factores.forEach((f, k) => {
        const deEsta = t.base.demandas.filter((x) => x.comb === cj.valor.nombres[k]);
        if (q.sup.esLineal(f)) {
          expect(deEsta.length).toBe(1);
          return;
        }
        conSismo++;
        const ternas = ternasPesimas(q.sup.partir(porCaso, 6, f));
        expect(deEsta.map((x) => x.esfuerzos)).toEqual(ternas);
        expect(deEsta.every((x) => x.pesimos)).toBe(true);
        const dominante = q.combinar(porCaso, 6, f);
        for (const c of [4, 5]) expect(Math.max(...deEsta.map((x) => Math.abs(x.esfuerzos[c]!)))).toBeGreaterThanOrEqual(Math.abs(dominante[c]!) - 1e-9);
      });
    });
    expect(conSismo).toBeGreaterThan(0);
  });

  it("My flecta en el plano del canto h: girados 90°, MEdy pasa a MEdz", () => {
    const f = edificioSO();
    const [a, b] = [demandasPilar(consultas(f), "P1"), demandasPilar(consultas(girado(f)), "P1")];
    if (!a.valido || !b.valido) throw new Error("no vale");
    let conMomento = 0;
    a.valor.tramos.forEach((ta, i) => {
      const tb = b.valor.tramos[i]!;
      for (const [ea, eb] of [
        [ta.base, tb.base],
        [ta.cabeza, tb.cabeza],
      ] as const)
        ea.demandas.forEach((da, k) => {
          const db = eb.demandas[k]!;
          expect(Math.abs(db.esfuerzos[5]!)).toBeCloseTo(Math.abs(da.esfuerzos[4]!), 8);
          expect(Math.abs(db.esfuerzos[4]!)).toBeCloseTo(Math.abs(da.esfuerzos[5]!), 8);
          const [xa, xb] = [entradaPilar(ta, da), entradaPilar(tb, db)];
          if (xa.tipo !== "flexocompresion" || xb.tipo !== "flexocompresion") throw new Error("no es flexocompresión");
          expect(xb.entrada.MEdz).toBeCloseTo(xa.entrada.MEdy, 8);
          expect(xb.entrada.MEdy).toBeCloseTo(xa.entrada.MEdz, 8);
          if (xa.entrada.MEdy > 1) conMomento++;
        });
    });
    // Con el viento según X y la imperfección, hay momento con el canto h
    expect(conMomento).toBeGreaterThan(0);
  });

  it("la longitud libre es la del tramo flexible, entre las caras", () => {
    const d = demandasPilar(edificio(), "P5");
    if (!d.valido) throw new Error("no vale");
    expect(d.valor.tramos.map((t) => t.planta)).toEqual(["F1", "F2", "F3"]);
    for (const t of d.valor.tramos) {
      expect(t.longitud).toBe(3);
      // RV-b: el pilar es rígido en el canto de la viga (0,5 m) bajo cada forjado, y la base arranca en el nudo
      expect(t.longitudLibre).toBeCloseTo(2.5, 12);
    }
  });

  it("con el segundo orden desactivado y la estructura traslacional, β = 1 no vale", () => {
    const q = edificio({ G: 3000, segundoOrden: { amplificar: false } });
    const d = demandasPilar(q, "P1");
    if (!d.valido) throw new Error("no vale");
    expect(d.valor.betaUno).toBe(false);
    expect(d.diagnosticos.map((x) => x.codigo)).toContain("comprobacion/beta-no-vale");
    // Con la estructura intraslacional, sí, aunque esté desactivado
    const e = demandasPilar(edificio({ segundoOrden: { amplificar: false } }), "P1");
    if (!e.valido) throw new Error("no vale");
    expect(e.valor.betaUno).toBe(true);
  });

  it("un pilar que no existe es un error", () => {
    expect(demandasPilar(edificio(), "P99").valido).toBe(false);
  });
});

describe("CO1: la entrada del módulo de pilares", () => {
  const tramo = (o: Partial<DemandasTramo> = {}): DemandasTramo => ({
    planta: "F1",
    plantaBase: "CIM",
    seccion: { id: "p", material: "H", forma: "rectangular", b: 0.3, h: 0.5 },
    material: { id: "H", tipo: "hormigon", fck: 30 },
    giro: 0,
    longitud: 3,
    longitudLibre: 2.7,
    base: { s: 0, demandas: [] },
    cabeza: { s: 2.7, demandas: [] },
    ...o,
  });

  it("mm, compresión positiva, momentos en valor absoluto y β = 1 con la longitud libre", () => {
    const x = entradaPilar(tramo(), { comb: "c", esfuerzos: [-850, 3, -4, 0.2, -61, 17] });
    expect(x).toEqual({ tipo: "flexocompresion", entrada: { sectionType: "rectangular", b: 300, h: 500, fck: 30, Nd: 850, MEdy: 61, MEdz: 17, L: 2.7, beta: 1 } });
  });

  it("circular, con su diámetro", () => {
    const x = entradaPilar(tramo({ seccion: { id: "c", material: "H", forma: "circular", D: 0.45 } }), { comb: "c", esfuerzos: [-500, 0, 0, 0, 10, -20] });
    expect(x).toEqual({ tipo: "flexocompresion", entrada: { sectionType: "circular", b: 450, h: 450, D: 450, fck: 30, Nd: 500, MEdy: 10, MEdz: 20, L: 2.7, beta: 1 } });
  });

  it("la tracción (y la compresión de menos de 1 kN) va aparte", () => {
    expect(entradaPilar(tramo(), { comb: "c", esfuerzos: [120, 0, 0, 0, 8, -3] })).toEqual({ tipo: "traccion", N: 120, My: 8, Mz: -3 });
    expect(entradaPilar(tramo(), { comb: "c", esfuerzos: [-0.5, 0, 0, 0, 8, 3] }).tipo).toBe("traccion");
  });

  it("lo que no es hormigón ni rectangular o circular queda pendiente", () => {
    expect(entradaPilar(tramo({ material: { id: "S", tipo: "acero" } }), { comb: "c", esfuerzos: [-100, 0, 0, 0, 0, 0] }).tipo).toBe("pendiente");
    expect(entradaPilar(tramo({ seccion: { id: "t", material: "H", forma: "T", bf: 0.6, hf: 0.1, bw: 0.3, h: 0.5 } }), { comb: "c", esfuerzos: [-100, 0, 0, 0, 0, 0] }).tipo).toBe("pendiente");
  });
});
