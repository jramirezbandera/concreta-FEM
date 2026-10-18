/**
 * Fase LV2, §14 de `docs/fem3d/refinamiento-vigas.md`: el metro de un pilar que el ancho de su viga
 * tapa pero cuya huella cruza las caras de la viga (un 40 × 40 bajo una de 30), y las estaciones de
 * apoyo sin los nudos esclavos de un pilar.
 *
 * En la retícula al azar 1, P3-1 (40 × 40 en la fachada x = 15,7, bajo el zuncho Y3 de 30) tapa la
 * viga salvo 5 cm por cada lado: los nudos de la cara x = 15,55 delante de su huella son rígidos con
 * él. Antes se saltaba («se apoya en la viga») y la estación de apoyo de la franja X7 en esa cara
 * cargaba con la parte empotrada sólo cuando la malla no dejaba láminas rígidas enteras delante de la
 * huella: −13,7 kN·m/m con h = 0,25 y −53 con 0,125 (y −49 con 0,75). Ahora tiene su metro en su cara
 * (x = 15,5), por el escalón desde la cara de la viga, con la ventana centrada en él (F-h): −48 con
 * h = 0,75 y −51 con 0,25. La estación de apoyo deja fuera lo suyo (y, si con eso cubre menos de la
 * mitad de la franja, no hay estación: la franja apoya en el pilar).
 *
 * Un pilar circular o girado bajo una viga que cruza sus caras va igual, por la recta de la viga
 * (aleatorio-3-lv: P1-2, circular de 40 bajo una viga de 25, en la franja X10).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MODELOS_CONGELADOS_F } from "../../validacion/f/congelar.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { reticulaAleatoria } from "../pruebas/reticulasAleatorias.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const ELU = (f: ModeloFisico): number[] => (f.casos ?? []).map((x) => (x.id === "G" ? 1.35 : x.id === "Q" ? 1.5 : 0));

function estaciones(f: ModeloFisico, op: OpcionesCompilacion, franja: string) {
  const c = valido(compilar(f, op));
  const q = new Consultas(f, c, casosValidos(calcular(c.modelo)), op);
  const est = q.franja(franja);
  if (!est.valido) throw new Error(franja);
  const fac = ELU(f);
  return {
    diagnosticos: est.valor.diagnosticos ?? [],
    estaciones: est.valor.estaciones.map((x) => ({ ...x, mx: fac.reduce((a, co, kc) => a + co * (x.medios[3 * kc] ?? 0), 0) })),
  };
}

describe("el metro de un pilar tapado que cruza las caras de su viga (LV2 §14)", () => {
  const f = reticulaAleatoria(1);

  it("P3-1 tiene su estación de cara en X7, con la ventana centrada, y el apoyo en la cara de la viga ya no carga con su parte", () => {
    const { estaciones: e, diagnosticos } = estaciones(f, { refinoEsquinas: true }, "L-N1:X7");
    const cara = e.filter((x) => x.tipo === "cara" && Math.abs(x.s - 15.5) < 1e-6);
    expect(cara).toHaveLength(1);
    expect(cara[0]!.lado).toBe(-1);
    expect(cara[0]!.piezas).toEqual(["P3-1"]);
    expect(cara[0]!.ventana!.map((v) => Math.round(v * 100) / 100)).toEqual([5.75, 6.75]);
    expect(cara[0]!.anchoEnLosa).toBeCloseTo(1, 6);
    // El empotramiento en el pilar: mucho más que el apoyo en la viga de las franjas vecinas
    expect(cara[0]!.mx).toBeLessThan(-40);
    // La de apoyo en la cara de la viga, sin los nudos del pilar, cubre menos de la mitad de la franja: no hay
    expect(e.filter((x) => x.tipo === "apoyo" && Math.abs(x.s - 15.55) < 1e-6)).toEqual([]);
    expect(diagnosticos.map((d) => d.codigo)).not.toContain("franja/pilar-sin-cara");
  });

  it("su metro no depende de la malla: h = 0,75 a ≤ 10 % de h = 0,25 (antes, la de apoyo pasaba de −49 a −14)", () => {
    const mx = (h: number) => estaciones(f, { refinoEsquinas: true, tamanoMalla: h }, "L-N1:X7").estaciones.find((x) => x.tipo === "cara" && Math.abs(x.s - 15.5) < 1e-6)!.mx;
    const [grueso, fino] = [mx(0.75), mx(0.25)];
    expect(Math.abs(grueso - fino) / Math.abs(fino)).toBeLessThan(0.1);
  });

  it("en la franja vecina X6, la estación de apoyo en la cara de la viga sigue (el pilar no la toca)", () => {
    const { estaciones: e } = estaciones(f, { refinoEsquinas: true }, "L-N1:X6");
    expect(e.filter((x) => x.tipo === "apoyo" && Math.abs(x.s - 15.55) < 1e-6)).toHaveLength(1);
  });
});

describe("un pilar circular bajo una viga que cruza sus caras (aleatorio-3-lv)", () => {
  it("P1-2 (circular de 40 bajo una viga de 25) tiene sus dos caras en X10, sin el aviso franja/pilar-sin-cara", () => {
    const m = MODELOS_CONGELADOS_F["aleatorio-3-lv"]!();
    const { estaciones: e, diagnosticos } = estaciones(m.fisico, m.opciones ?? {}, "L-N1:X10");
    const caras = e.filter((x) => x.tipo === "cara" && x.piezas.includes("P1-2"));
    expect(caras.map((x) => [Math.round(x.s * 1000) / 1000, x.lado])).toEqual([
      [4.95, -1],
      [5.35, 1],
    ]);
    expect(diagnosticos.map((d) => d.codigo)).not.toContain("franja/pilar-sin-cara");
  });
});
