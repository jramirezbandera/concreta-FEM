/**
 * Fase CO3 (`docs/fem3d/comprobaciones.md` §7, criterio 11): el módulo de forjados de Concreta, tal como
 * lo llama el adaptador, frente a un oráculo que no es de Concreta (`validacion/co/oraculo_losa.py`:
 * el integrador de la sección, las fórmulas del cortante y de la fisuración escritas aparte).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ArmadoForjado, BarrasForjado } from "./armado.ts";
import { armadoLosa, entradaGrupo, entradaLosa } from "./comprobar/losas.ts";
import { calcForjados } from "./concreta/lib/calculations/rcSlabs.ts";

interface Caso {
  id: string;
  tipo: "maciza" | "nervio";
  h: number;
  hf?: number;
  bw?: number;
  intereje?: number;
  luz?: number;
  fck: number;
  fyk: number;
  recubrimiento: number;
  inferior: [number, number];
  superior: [number, number];
  Ms: [number, number];
  bEff: number;
  MRdPositivo: number;
  MRdNegativo: number;
  VRdc: number;
  fisuraPositivo: { wk: number };
  fisuraNegativo: { wk: number };
}

const { casos } = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "validacion", "co", "oraculo-losa.json"), "utf8")) as { casos: Caso[] };

const cerca = (a: number, b: number, tol: number, que: string) => expect(Math.abs(a - b) / Math.abs(b), `${que}: ${a} frente a ${b}`).toBeLessThanOrEqual(tol);

describe("CO3: el módulo de forjados frente al oráculo independiente", () => {
  for (const c of casos) {
    it(c.id, () => {
      const barras = (x: [number, number]): BarrasForjado => (c.tipo === "maciza" ? { diametro: x[0], separacion: x[1] } : { n: x[0], diametro: x[1] });
      const [inf, sup] = [barras(c.inferior), barras(c.superior)];
      const a: ArmadoForjado = { base: { "x-inf": inf, "x-sup": sup, "y-inf": inf, "y-sup": sup } };
      const geo = { espesor: c.h / 1000, material: { id: "H", tipo: "hormigon" as const, fck: c.fck }, reticular: c.tipo === "nervio" ? { intereje: c.intereje! / 1000, nervio: c.bw! / 1000, capa: c.hf! / 1000 } : null };
      const parcial = entradaGrupo(geo, armadoLosa(a, { fyk: c.fyk, recubrimiento: c.recubrimiento }), 1, { seccion: c.tipo, inf: [], sup: [], cercos: -1 });
      if ("motivo" in parcial) throw new Error(parcial.motivo);
      const r = calcForjados(entradaLosa(parcial, { inferior: 1, superior: 1, cortante: 1, cpInferior: c.Ms[0], cpSuperior: c.Ms[1], luz: (c.luz ?? 5000) / 1000 }));
      expect(r.valid).toBe(true);
      // El ancho eficaz del módulo, mín(intereje; l0/5), no pasa del de la fórmula del Código
      if (c.tipo === "nervio") expect(r.bEff).toBeLessThanOrEqual(c.bEff + 1e-9);
      // Flexión: el bloque rectangular del módulo frente a la parábola-rectángulo del integrador
      cerca(r.vano.MRd, c.MRdPositivo, 0.015, "MRd+");
      cerca(r.apoyo.MRd, c.MRdNegativo, 0.015, "MRd−");
      // Nunca por encima del integrador en más de lo que separa los dos diagramas
      expect(r.vano.MRd / c.MRdPositivo).toBeLessThanOrEqual(1.005);
      expect(r.apoyo.MRd / c.MRdNegativo).toBeLessThanOrEqual(1.005);
      // Cortante sin armadura transversal
      cerca(r.VRdc, c.VRdc, 0.003, "VRd,c");
      // Fisuración: Ecm y fctm tabulados frente a los de su fórmula
      cerca(r.vano.wk, c.fisuraPositivo.wk, 0.02, "wk (cara inferior)");
      cerca(r.apoyo.wk, c.fisuraNegativo.wk, 0.02, "wk (cara superior)");
    });
  }
});
